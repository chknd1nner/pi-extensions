import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getBrightDataApiKey, loadBrightDataConfig } from "./config.js";
import { fetchBrightDataPages, getStoredContentText } from "./fetch.js";
import { formatSearchMarkdown, searchBrightData } from "./search.js";
import { BRIGHTDATA_RESULTS_CUSTOM_TYPE, generateResponseId, restoreFromSession, storeResult, type StoredBrightDataResult } from "./storage.js";
import { renderFetchCall, renderSearchCall, renderTextResult } from "./render.js";

const SearchParams = Type.Object({
  query: Type.Optional(Type.String({ description: "Single search query. Use queries for multiple angles." })),
  queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple search queries." })),
  engine: Type.Optional(StringEnum(["google", "bing", "duckduckgo", "yandex"] as const, { description: "Search engine. Defaults to config." })),
  country: Type.Optional(Type.String({ description: "Two-letter country code. Defaults to config." })),
  language: Type.Optional(Type.String({ description: "Language code. Defaults to config." })),
  numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Results per query." })),
});

const FetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "Single public http/https URL to fetch." })),
  urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple public http/https URLs to fetch." })),
  country: Type.Optional(Type.String({ description: "Two-letter country code. Defaults to config." })),
  maxCharsPerPage: Type.Optional(Type.Integer({ minimum: 1000, maximum: 100000, description: "Inline character cap per page." })),
});

const GetContentParams = Type.Object({
  responseId: Type.String({ description: "Response ID from brightdata_search or brightdata_fetch." }),
  query: Type.Optional(Type.String({ description: "Search query to retrieve." })),
  queryIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Search query index to retrieve." })),
  url: Type.Optional(Type.String({ description: "Fetched URL to retrieve." })),
  urlIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Fetched URL index to retrieve." })),
});

function assertApiKeyConfigured(): void {
  if (!getBrightDataApiKey()) {
    throw new Error("Bright Data API key not found. Set BRIGHT_DATA_KEY or BRIGHTDATA_API_KEY.");
  }
}

function queryList(params: { query?: string; queries?: string[] }): string[] {
  return (Array.isArray(params.queries) ? params.queries : params.query ? [params.query] : [])
    .map((query) => query.trim())
    .filter(Boolean);
}

function urlList(params: { url?: string; urls?: string[] }): string[] {
  return (Array.isArray(params.urls) ? params.urls : params.url ? [params.url] : [])
    .map((url) => url.trim())
    .filter(Boolean);
}

export default function brightdataExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.registerTool({
    name: "brightdata_search",
    label: "Bright Data Search",
    description: "Search the web using Bright Data SERP and return normalized ranked results. Does not synthesize an AI answer in v1.",
    promptSnippet: "Search live web SERPs through Bright Data and return ranked result URLs/snippets.",
    promptGuidelines: [
      "Use brightdata_search when the user asks for current web search results and Bright Data is the intended provider.",
      "Use brightdata_fetch after brightdata_search to read selected result URLs."
    ],
    parameters: SearchParams,
    async execute(_toolCallId, params, signal) {
      assertApiKeyConfigured();
      const config = loadBrightDataConfig();
      const queries = queryList(params);
      const entries = await searchBrightData(queries, {
        zone: config.brightdata.serpZone,
        engine: params.engine ?? config.search.defaultEngine,
        country: params.country ?? config.brightdata.defaultCountry,
        language: params.language ?? config.brightdata.defaultLanguage,
        limit: Math.min(params.numResults ?? config.search.defaultLimit, config.search.maxResults),
        maxQueries: config.search.maxQueries,
        signal,
      });
      const id = generateResponseId();
      const data: StoredBrightDataResult = { id, provider: "brightdata", type: "search", timestamp: Date.now(), queries: entries };
      storeResult(data);
      pi.appendEntry(BRIGHTDATA_RESULTS_CUSTOM_TYPE, data);
      return { content: [{ type: "text" as const, text: `${formatSearchMarkdown(entries)}\n\n---\nResponse ID: ${id}` }], details: { responseId: id, queries: entries } };
    },
    renderCall: renderSearchCall,
    renderResult: renderTextResult,
  });

  pi.registerTool({
    name: "brightdata_fetch",
    label: "Bright Data Fetch",
    description: "Fetch public URL(s) through Bright Data Unlocker as Markdown. PDFs are parsed adaptively and large content is saved to disk.",
    promptSnippet: "Fetch public URLs through Bright Data Unlocker and return readable content or saved Markdown paths.",
    promptGuidelines: [
      "Use brightdata_fetch when the user provides public URLs or after brightdata_search finds relevant pages.",
      "Do not use brightdata_fetch for YouTube transcript workflows; use the YouTube skills."
    ],
    parameters: FetchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      assertApiKeyConfigured();
      const config = loadBrightDataConfig();
      const urls = urlList(params);
      onUpdate?.({ content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }], details: { phase: "fetch", progress: 0 } });
      const result = await fetchBrightDataPages(urls, {
        zone: config.brightdata.unlockerZone,
        country: params.country ?? config.brightdata.defaultCountry,
        preferMarkdown: config.fetch.preferMarkdown,
        maxUrls: config.fetch.maxUrls,
        maxInlineChars: Math.min(params.maxCharsPerPage ?? config.fetch.maxInlineChars, config.fetch.maxInlineChars),
        outputDir: config.fetch.outputDir,
        cwd: ctx.cwd,
        concurrency: config.brightdata.concurrency,
        pdfEnabled: config.pdf.enabled,
        pdfOutputDir: config.pdf.outputDir,
        pdfInlineMaxPages: config.pdf.inlineMaxPages,
        pdfInlineMaxChars: config.pdf.inlineMaxChars,
        pdfPreviewChars: config.pdf.previewChars,
        pdfMaxPages: config.pdf.maxPages,
        pdfMaxBytes: config.pdf.maxBytes,
        signal,
      });
      pi.appendEntry(BRIGHTDATA_RESULTS_CUSTOM_TYPE, result.data);
      return { content: [{ type: "text" as const, text: result.markdown }], details: { responseId: result.data.id, urls: result.data.urls } };
    },
    renderCall: renderFetchCall,
    renderResult: renderTextResult,
  });

  pi.registerTool({
    name: "brightdata_get_content",
    label: "Bright Data Get Content",
    description: "Retrieve stored full content from a previous brightdata_search or brightdata_fetch call.",
    promptSnippet: "Retrieve stored Bright Data search/fetch content by responseId and selector.",
    parameters: GetContentParams,
    async execute(_toolCallId, params) {
      const text = getStoredContentText(params);
      return { content: [{ type: "text" as const, text }], details: { responseId: params.responseId } };
    },
    renderResult: renderTextResult,
  });
}
