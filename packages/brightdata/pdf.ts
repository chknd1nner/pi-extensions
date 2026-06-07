import { getDocumentProxy } from "unpdf";
import { basename } from "node:path";
import { brightDataRequest } from "./brightdata-client.js";
import { UnsafeUrlError, fetchPublicWithManualRedirects, validatePublicHttpUrl } from "./request-safety.js";
import { saveLargeMarkdown } from "./storage.js";
import type { FetchPageResult } from "./types.js";

export interface ParsedPdf {
  title: string;
  author?: string;
  pages: number;
  markdown: string;
  truncated: boolean;
}

export type PdfParser = (bytes: ArrayBuffer, url: string, maxPages: number) => Promise<ParsedPdf>;

export function isLikelyPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function isPdfContentType(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("application/pdf");
}

function hasPdfMagicBytes(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 4));
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

export function isPdfResponse(url: string, headers: Headers, bytes: ArrayBuffer): boolean {
  return isLikelyPdfUrl(url) || isPdfContentType(headers) || hasPdfMagicBytes(bytes);
}

// Payload-only PDF detection: inspects the response bytes/headers, never the URL.
// A `.pdf` URL that returns HTML/text must NOT be accepted as a PDF, so use this
// (not `isPdfResponse`) to validate fetched bytes before parsing.
export function isPdfPayload(headers: Headers, bytes: ArrayBuffer): boolean {
  return isPdfContentType(headers) || hasPdfMagicBytes(bytes);
}

export async function shouldTreatAsPdfUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  if (isLikelyPdfUrl(url)) return true;
  try {
    validatePublicHttpUrl(url);
    const response = await fetchPublicWithManualRedirects(url, { method: "HEAD", signal });
    return response.ok && isPdfContentType(response.headers);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    return false;
  }
}

export function shouldInlinePdf(input: { pages: number; chars: number; inlineMaxPages: number; inlineMaxChars: number }): boolean {
  return input.pages <= input.inlineMaxPages && input.chars <= input.inlineMaxChars;
}

async function directPdfFetch(url: string, maxBytes: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const response = await fetchPublicWithManualRedirects(url, { signal });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new Error(`PDF too large (${bytes.byteLength} bytes)`);
  return isPdfPayload(response.headers, bytes) ? bytes : null;
}

function isPdfTooLargeError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("PDF too large");
}

export async function fetchPdfBytesWithFallback(input: {
  url: string;
  zone: string;
  country: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  try {
    const direct = await directPdfFetch(input.url, input.maxBytes, input.signal);
    if (direct) return direct;
  } catch (err) {
    if (err instanceof UnsafeUrlError || isPdfTooLargeError(err)) throw err;
  }

  const response = await brightDataRequest({ zone: input.zone, url: input.url, format: "raw", country: input.country }, input.signal);
  if (response.bytes.byteLength > input.maxBytes) throw new Error(`PDF too large (${response.bytes.byteLength} bytes)`);
  if (!isPdfPayload(response.headers, response.bytes)) throw new Error("Bright Data fallback did not return a PDF response.");
  return response.bytes;
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname, ".pdf").replace(/[-_]+/g, " ").trim();
    return name || parsed.hostname;
  } catch {
    return "document";
  }
}

export async function parsePdfWithUnpdf(bytes: ArrayBuffer, url: string, maxPages: number): Promise<ParsedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const metadata = await pdf.getMetadata();
  const info = metadata.info && typeof metadata.info === "object" ? metadata.info as Record<string, unknown> : {};
  const title = typeof info.Title === "string" && info.Title.trim() ? info.Title.trim() : titleFromUrl(url);
  const author = typeof info.Author === "string" && info.Author.trim() ? info.Author.trim() : undefined;
  const pagesToExtract = Math.min(pdf.numPages, maxPages);

  const parts: string[] = [
    `# ${title}`,
    "",
    `> Source: ${url}`,
    `> Pages: ${pdf.numPages}${pdf.numPages > maxPages ? ` (extracted first ${pagesToExtract})` : ""}`,
  ];
  if (author) parts.push(`> Author: ${author}`);
  parts.push("", "---", "");

  for (let pageNumber = 1; pageNumber <= pagesToExtract; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: unknown) => (item as { str?: string }).str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageNumber > 1) parts.push("", `<!-- Page ${pageNumber} -->`, "");
    if (pageText) parts.push(pageText);
  }

  const truncated = pdf.numPages > maxPages;
  if (truncated) parts.push("", "---", "", `*[Truncated: extracted first ${pagesToExtract} of ${pdf.numPages} pages]*`);

  return { title, author, pages: pdf.numPages, markdown: parts.join("\n"), truncated };
}

export async function extractPdfFromBytes(input: {
  url: string;
  bytes: ArrayBuffer;
  outputDir: string;
  cwd: string;
  inlineMaxPages: number;
  inlineMaxChars: number;
  previewChars: number;
  maxPages: number;
  parsePdf?: PdfParser;
}): Promise<FetchPageResult> {
  const parsed = await (input.parsePdf ?? parsePdfWithUnpdf)(input.bytes, input.url, input.maxPages);
  const chars = parsed.markdown.length;

  if (shouldInlinePdf({ pages: parsed.pages, chars, inlineMaxPages: input.inlineMaxPages, inlineMaxChars: input.inlineMaxChars })) {
    return {
      url: input.url,
      title: parsed.title,
      content: parsed.markdown,
      error: null,
      kind: "pdf",
      pages: parsed.pages,
      chars,
      truncated: parsed.truncated,
    };
  }

  const savedPath = saveLargeMarkdown({ outputDir: input.outputDir, title: parsed.title, url: input.url, content: parsed.markdown, cwd: input.cwd });
  const preview = parsed.markdown.slice(0, input.previewChars);
  const content = [
    "PDF extracted successfully.",
    "",
    `Title: ${parsed.title}`,
    `Pages: ${parsed.pages}`,
    `Characters: ${chars}`,
    `Saved markdown: ${savedPath}`,
    parsed.truncated ? "Extraction truncated by maxPages setting." : "Extraction complete.",
    "",
    "Preview:",
    preview,
    "",
    "Use read on the saved Markdown file for the full content, or brightdata_get_content with the responseId for stored metadata/content retrieval.",
  ].join("\n");

  return {
    url: input.url,
    title: parsed.title,
    content,
    error: null,
    kind: "pdf",
    savedPath,
    pages: parsed.pages,
    chars,
    truncated: true,
  };
}
