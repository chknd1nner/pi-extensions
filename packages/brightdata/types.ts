export type SearchEngine = "google" | "bing" | "duckduckgo" | "yandex";

export interface BrightDataConfig {
  brightdata: {
    serpZone: string;
    unlockerZone: string;
    defaultCountry: string;
    defaultLanguage: string;
    requestTimeoutMs: number;
    concurrency: number;
  };
  search: {
    defaultEngine: SearchEngine;
    defaultLimit: number;
    maxQueries: number;
    maxResults: number;
  };
  fetch: {
    maxUrls: number;
    maxInlineChars: number;
    preferMarkdown: boolean;
    outputDir: string;
  };
  pdf: {
    enabled: boolean;
    inlineMaxPages: number;
    inlineMaxChars: number;
    previewChars: number;
    maxPages: number;
    maxBytes: number;
    outputDir: string;
  };
}

export interface BrightDataSearchResult {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
}

export interface FetchPageResult {
  url: string;
  title: string;
  content: string;
  error: string | null;
  kind: "page" | "pdf";
  savedPath?: string;
  truncated?: boolean;
  chars?: number;
  pages?: number;
}
