import pLimit from "p-limit";
import { brightDataRequest } from "./brightdata-client.js";
import { buildSearchUrl } from "./urls.js";
import type { BrightDataSearchResult, SearchEngine } from "./types.js";

export interface QuerySearchData {
  query: string;
  results: BrightDataSearchResult[];
  raw: unknown;
  error?: string;
}

export interface SearchBrightDataOptions {
  zone: string;
  engine: SearchEngine;
  country: string;
  language: string;
  limit: number;
  maxQueries: number;
  signal?: AbortSignal;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function resultCandidates(payload: unknown): unknown[] {
  const root = payload as Record<string, unknown>;
  const body = root.body as Record<string, unknown> | undefined;
  const candidates = root.organic ?? root.organic_results ?? root.results ?? root.items ?? body?.organic ?? body?.organic_results;
  return Array.isArray(candidates) ? candidates : [];
}

export function normalizeSearchResults(payload: unknown, limit: number): BrightDataSearchResult[] {
  return resultCandidates(payload)
    .map((item, index): BrightDataSearchResult | null => {
      const record = item as Record<string, unknown>;
      const url = pickString(record.link, record.url, record.href);
      const title = pickString(record.title, record.name);
      if (!url || !title) return null;
      const rank = typeof record.rank === "number" && Number.isFinite(record.rank) ? record.rank : index + 1;
      const snippet = pickString(record.description, record.snippet, record.text);
      const source = pickString(record.source, record.displayed_link, record.domain);
      return { rank, title, url, ...(snippet ? { snippet } : {}), ...(source ? { source } : {}) };
    })
    .filter((result): result is BrightDataSearchResult => result !== null)
    .slice(0, Math.max(1, limit));
}

export async function searchBrightData(queries: string[], options: SearchBrightDataOptions): Promise<QuerySearchData[]> {
  const normalized = queries.map((query) => query.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("No query provided. Use query or queries.");
  if (normalized.length > options.maxQueries) throw new Error(`Too many queries: ${normalized.length}. Maximum is ${options.maxQueries}.`);

  const limit = pLimit(3);
  return Promise.all(normalized.map((query) => limit(async () => {
    try {
      const response = await brightDataRequest({
        zone: options.zone,
        url: buildSearchUrl(options.engine, query, options.language),
        format: "raw",
        country: options.country,
      }, options.signal);
      const raw = response.json ?? response.text;
      return { query, results: normalizeSearchResults(raw, options.limit), raw };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { query, results: [], raw: null, error: message };
    }
  })));
}

export function formatSearchMarkdown(entries: QuerySearchData[]): string {
  return entries.map((entry) => {
    const lines = [`## Results for: ${entry.query}`, ""];
    if (entry.error) {
      lines.push(`Error: ${entry.error}`);
      return lines.join("\n");
    }
    if (entry.results.length === 0) {
      lines.push("No normalized results found.");
      return lines.join("\n");
    }
    for (const result of entry.results) {
      lines.push(`${result.rank}. ${result.title}`);
      lines.push(`   URL: ${result.url}`);
      if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
      if (result.source) lines.push(`   Source: ${result.source}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }).join("\n\n---\n\n");
}
