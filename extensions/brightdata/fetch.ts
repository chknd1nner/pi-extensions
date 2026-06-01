import { readFileSync } from "node:fs";
import pLimit from "p-limit";
import { brightDataRequest } from "./brightdata-client.js";
import { formatLargePdfStoredContent, formatStoredContentForTool } from "./output-safety.js";
import { extractPdfFromBytes, fetchPdfBytesWithFallback, isPdfPayload, shouldTreatAsPdfUrl } from "./pdf.js";
import { validatePublicHttpUrl } from "./request-safety.js";
import { generateResponseId, getStoredResult, saveLargeMarkdown, storeResult, type StoredBrightDataResult } from "./storage.js";
import type { FetchPageResult } from "./types.js";

export interface FetchOptions {
  zone: string;
  country: string;
  preferMarkdown: boolean;
  maxUrls: number;
  maxInlineChars: number;
  outputDir: string;
  cwd: string;
  concurrency: number;
  pdfEnabled: boolean;
  pdfOutputDir: string;
  pdfInlineMaxPages: number;
  pdfInlineMaxChars: number;
  pdfPreviewChars: number;
  pdfMaxPages: number;
  pdfMaxBytes: number;
  signal?: AbortSignal;
}

export interface FetchOutput {
  markdown: string;
  data: StoredBrightDataResult;
}

function titleFromContent(content: string, url: string): string {
  const heading = content.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function pageOutput(url: string, content: string, options: FetchOptions): FetchPageResult {
  const title = titleFromContent(content, url);
  if (content.length <= options.maxInlineChars) {
    return { url, title, content, error: null, kind: "page", chars: content.length };
  }
  const savedPath = saveLargeMarkdown({ outputDir: options.outputDir, title, url, content, cwd: options.cwd });
  const preview = content.slice(0, options.maxInlineChars);
  return {
    url,
    title,
    content: `${preview}\n\n[Content truncated. Saved full content to: ${savedPath}]`,
    error: null,
    kind: "page",
    savedPath,
    truncated: true,
    chars: content.length,
  };
}

async function extractPdfPage(url: string, bytes: ArrayBuffer, options: FetchOptions): Promise<FetchPageResult> {
  return extractPdfFromBytes({
    url,
    bytes,
    outputDir: options.pdfOutputDir,
    cwd: options.cwd,
    inlineMaxPages: options.pdfInlineMaxPages,
    inlineMaxChars: options.pdfInlineMaxChars,
    previewChars: options.pdfPreviewChars,
    maxPages: options.pdfMaxPages,
  });
}

function formatFetchMarkdown(pages: FetchPageResult[], responseId: string): string {
  if (pages.length === 1) {
    const page = pages[0];
    if (page.error) return `Error: ${page.error}\n\nResponse ID: ${responseId}`;
    return `${page.content}\n\n---\nResponse ID: ${responseId}`;
  }
  const lines = ["## Fetched URLs", ""];
  for (const page of pages) {
    if (page.error) lines.push(`- ${page.url}: Error - ${page.error}`);
    else lines.push(`- ${page.title || page.url}: ${page.chars ?? page.content.length} chars${page.savedPath ? `, saved: ${page.savedPath}` : ""}`);
  }
  lines.push("", `Response ID: ${responseId}`);
  return lines.join("\n");
}

export async function fetchBrightDataPages(urls: string[], options: FetchOptions): Promise<FetchOutput> {
  const normalized = urls.map((url) => validatePublicHttpUrl(url).toString());
  if (normalized.length === 0) throw new Error("No URL provided. Use url or urls.");
  if (normalized.length > options.maxUrls) throw new Error(`Too many URLs: ${normalized.length}. Maximum is ${options.maxUrls}.`);

  const limit = pLimit(options.concurrency);
  const pages = await Promise.all(normalized.map((url) => limit(async (): Promise<FetchPageResult> => {
    try {
      if (options.pdfEnabled && await shouldTreatAsPdfUrl(url, options.signal)) {
        const bytes = await fetchPdfBytesWithFallback({
          url,
          zone: options.zone,
          country: options.country,
          maxBytes: options.pdfMaxBytes,
          signal: options.signal,
        });
        return extractPdfPage(url, bytes, options);
      }

      const response = await brightDataRequest({
        zone: options.zone,
        url,
        format: "raw",
        country: options.country,
        ...(options.preferMarkdown ? { data_format: "markdown" as const } : {}),
      }, options.signal);

      // URL-based routing already happened pre-fetch via shouldTreatAsPdfUrl, so
      // post-fetch detection must be payload-based to avoid misrouting non-PDF bytes.
      if (options.pdfEnabled && isPdfPayload(response.headers, response.bytes)) {
        if (response.bytes.byteLength > options.pdfMaxBytes) throw new Error(`PDF too large (${response.bytes.byteLength} bytes)`);
        return extractPdfPage(url, response.bytes, options);
      }

      return pageOutput(url, response.text, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { url, title: "", content: "", error: message, kind: "page" };
    }
  })));

  const id = generateResponseId();
  const data: StoredBrightDataResult = { id, provider: "brightdata", type: "fetch", timestamp: Date.now(), urls: pages };
  storeResult(data);
  return { markdown: formatFetchMarkdown(pages, id), data };
}

export function getStoredContentText(selector: { responseId: string; urlIndex?: number; url?: string; queryIndex?: number; query?: string; maxOutputChars?: number }): string {
  const data = getStoredResult(selector.responseId);
  if (!data) return `Error: No stored result for ${selector.responseId}`;
  if (data.type === "fetch") {
    const pages = data.urls ?? [];
    const page = selector.url !== undefined
      ? pages.find((item) => item.url === selector.url)
      : pages[selector.urlIndex ?? 0];
    if (!page) return "Error: URL selection not found.";
    if (page.savedPath) {
      const content = readFileSync(page.savedPath, "utf8");
      if (page.kind === "pdf") {
        return formatLargePdfStoredContent({ title: page.title, url: page.url, savedPath: page.savedPath, content, pages: page.pages, chars: page.chars });
      }
      return formatStoredContentForTool({ content, savedPath: page.savedPath, maxOutputChars: selector.maxOutputChars });
    }
    return formatStoredContentForTool({ content: page.content, maxOutputChars: selector.maxOutputChars });
  }
  const queries = data.queries ?? [];
  const query = selector.query !== undefined
    ? queries.find((item) => item.query === selector.query)
    : queries[selector.queryIndex ?? 0];
  if (!query) return "Error: Query selection not found.";
  return formatStoredContentForTool({ content: JSON.stringify(query.results, null, 2), maxOutputChars: selector.maxOutputChars });
}
