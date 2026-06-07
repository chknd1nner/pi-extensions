import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrightDataConfig, SearchEngine } from "./types.js";

export const CONFIG_PATH = join(homedir(), ".pi", "brightdata.json");

function resolveConfigPath(): string {
  return join(process.env.HOME || homedir(), ".pi", "brightdata.json");
}

const DEFAULT_CONFIG: BrightDataConfig = {
  brightdata: {
    serpZone: "pi_serp_api",
    unlockerZone: "mcp_unlocker",
    defaultCountry: "au",
    defaultLanguage: "en",
    requestTimeoutMs: 60000,
    concurrency: 3,
  },
  search: {
    defaultEngine: "google",
    defaultLimit: 10,
    maxQueries: 10,
    maxResults: 20,
  },
  fetch: {
    maxUrls: 10,
    maxInlineChars: 30000,
    preferMarkdown: true,
    outputDir: ".pi/brightdata/pages",
  },
  pdf: {
    enabled: true,
    inlineMaxPages: 5,
    inlineMaxChars: 20000,
    previewChars: 2000,
    maxPages: 200,
    maxBytes: 52428800,
    outputDir: ".pi/brightdata/pdfs",
  },
};

let cachedConfig: BrightDataConfig | null = null;
let cachedConfigPath: string | null = null;

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function searchEngine(value: unknown, fallback: SearchEngine): SearchEngine {
  return value === "google" || value === "bing" || value === "duckduckgo" || value === "yandex"
    ? value
    : fallback;
}

export function clearConfigCache(): void {
  cachedConfig = null;
  cachedConfigPath = null;
}

export function getBrightDataApiKey(): string | null {
  const primary = process.env.BRIGHT_DATA_KEY?.trim();
  if (primary) return primary;
  const fallback = process.env.BRIGHTDATA_API_KEY?.trim();
  return fallback || null;
}

export function loadBrightDataConfig(): BrightDataConfig {
  const configPath = resolveConfigPath();
  if (cachedConfig && cachedConfigPath === configPath) return cachedConfig;

  let raw: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${configPath}: ${message}`);
    }
  }

  const brightdata = (raw.brightdata && typeof raw.brightdata === "object" ? raw.brightdata : {}) as Record<string, unknown>;
  const search = (raw.search && typeof raw.search === "object" ? raw.search : {}) as Record<string, unknown>;
  const fetch = (raw.fetch && typeof raw.fetch === "object" ? raw.fetch : {}) as Record<string, unknown>;
  const pdf = (raw.pdf && typeof raw.pdf === "object" ? raw.pdf : {}) as Record<string, unknown>;

  cachedConfig = {
    brightdata: {
      serpZone: nonEmptyString(process.env.BRIGHTDATA_SERP_ZONE, nonEmptyString(brightdata.serpZone, DEFAULT_CONFIG.brightdata.serpZone)),
      unlockerZone: nonEmptyString(process.env.BRIGHTDATA_UNLOCKER_ZONE, nonEmptyString(brightdata.unlockerZone, DEFAULT_CONFIG.brightdata.unlockerZone)),
      defaultCountry: nonEmptyString(brightdata.defaultCountry, DEFAULT_CONFIG.brightdata.defaultCountry),
      defaultLanguage: nonEmptyString(brightdata.defaultLanguage, DEFAULT_CONFIG.brightdata.defaultLanguage),
      requestTimeoutMs: positiveInteger(brightdata.requestTimeoutMs, DEFAULT_CONFIG.brightdata.requestTimeoutMs),
      concurrency: positiveInteger(brightdata.concurrency, DEFAULT_CONFIG.brightdata.concurrency),
    },
    search: {
      defaultEngine: searchEngine(search.defaultEngine, DEFAULT_CONFIG.search.defaultEngine),
      defaultLimit: positiveInteger(search.defaultLimit, DEFAULT_CONFIG.search.defaultLimit),
      maxQueries: positiveInteger(search.maxQueries, DEFAULT_CONFIG.search.maxQueries),
      maxResults: positiveInteger(search.maxResults, DEFAULT_CONFIG.search.maxResults),
    },
    fetch: {
      maxUrls: positiveInteger(fetch.maxUrls, DEFAULT_CONFIG.fetch.maxUrls),
      maxInlineChars: positiveInteger(fetch.maxInlineChars, DEFAULT_CONFIG.fetch.maxInlineChars),
      preferMarkdown: booleanValue(fetch.preferMarkdown, DEFAULT_CONFIG.fetch.preferMarkdown),
      outputDir: nonEmptyString(fetch.outputDir, DEFAULT_CONFIG.fetch.outputDir),
    },
    pdf: {
      enabled: booleanValue(pdf.enabled, DEFAULT_CONFIG.pdf.enabled),
      inlineMaxPages: positiveInteger(pdf.inlineMaxPages, DEFAULT_CONFIG.pdf.inlineMaxPages),
      inlineMaxChars: positiveInteger(pdf.inlineMaxChars, DEFAULT_CONFIG.pdf.inlineMaxChars),
      previewChars: positiveInteger(pdf.previewChars, DEFAULT_CONFIG.pdf.previewChars),
      maxPages: positiveInteger(pdf.maxPages, DEFAULT_CONFIG.pdf.maxPages),
      maxBytes: positiveInteger(pdf.maxBytes, DEFAULT_CONFIG.pdf.maxBytes),
      outputDir: nonEmptyString(pdf.outputDir, DEFAULT_CONFIG.pdf.outputDir),
    },
  };

  cachedConfigPath = configPath;
  return cachedConfig;
}
