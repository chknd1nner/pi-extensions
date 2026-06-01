import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrightDataSearchResult, FetchPageResult } from "./types.js";

export const BRIGHTDATA_RESULTS_CUSTOM_TYPE = "brightdata-results";
export const RESULT_TTL_MS = 60 * 60 * 1000;

export interface StoredSearchQuery {
  query: string;
  results: BrightDataSearchResult[];
  raw?: unknown;
  error?: string;
}

export interface StoredBrightDataResult {
  id: string;
  provider: "brightdata";
  type: "search" | "fetch";
  timestamp: number;
  queries?: StoredSearchQuery[];
  urls?: FetchPageResult[];
}

const stored = new Map<string, StoredBrightDataResult>();

export function generateResponseId(): string {
  return `bd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clearStoredResults(): void {
  stored.clear();
}

export function storeResult(data: StoredBrightDataResult): void {
  stored.set(data.id, data);
}

export function getStoredResult(id: string): StoredBrightDataResult | undefined {
  return stored.get(id);
}

function isStoredBrightDataResult(value: unknown): value is StoredBrightDataResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && record.provider === "brightdata"
    && (record.type === "search" || record.type === "fetch")
    && typeof record.timestamp === "number";
}

export function restoreFromSession(ctx: unknown, now = Date.now()): void {
  clearStoredResults();
  const branch = (ctx as { sessionManager?: { getBranch?: () => unknown[] } })?.sessionManager?.getBranch?.() ?? [];
  for (const entry of branch) {
    const record = entry as Record<string, unknown>;
    if (record.type !== "custom" || record.customType !== BRIGHTDATA_RESULTS_CUSTOM_TYPE) continue;
    if (!isStoredBrightDataResult(record.data)) continue;
    if (now - record.data.timestamp > RESULT_TTL_MS) continue;
    storeResult(record.data);
  }
}

function sanitizeFilename(title: string): string {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "content";
}

export function saveLargeMarkdown(input: { outputDir: string; title: string; url: string; content: string; cwd?: string }): string {
  const baseDir = input.cwd ? resolve(input.cwd, input.outputDir) : resolve(input.outputDir);
  mkdirSync(baseDir, { recursive: true });
  const hash = createHash("sha256").update(input.url).digest("hex").slice(0, 8);
  const filename = `${sanitizeFilename(input.title || new URL(input.url).hostname)}-${hash}.md`;
  const outputPath = join(baseDir, filename);
  writeFileSync(outputPath, input.content, "utf8");
  return outputPath;
}
