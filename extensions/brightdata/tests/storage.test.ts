import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredResults,
  generateResponseId,
  getStoredResult,
  restoreFromSession,
  saveLargeMarkdown,
  storeResult,
  type StoredBrightDataResult
} from "../storage.js";

const tempDirs: string[] = [];

afterEach(() => {
  clearStoredResults();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-storage-"));
  tempDirs.push(dir);
  return dir;
}

describe("storage", () => {
  it("generates brightdata-prefixed IDs", () => {
    expect(generateResponseId()).toMatch(/^bd_[a-z0-9]+$/);
  });

  it("stores and retrieves results", () => {
    const data: StoredBrightDataResult = { id: "bd_1", provider: "brightdata", type: "fetch", timestamp: Date.now(), urls: [] };
    storeResult(data);
    expect(getStoredResult("bd_1")).toEqual(data);
  });

  it("restores fresh brightdata-results entries from session branch", () => {
    const data: StoredBrightDataResult = { id: "bd_2", provider: "brightdata", type: "search", timestamp: Date.now(), queries: [] };
    restoreFromSession({ sessionManager: { getBranch: () => [{ type: "custom", customType: "brightdata-results", data }] } });
    expect(getStoredResult("bd_2")).toEqual(data);
  });

  it("discards entries older than the TTL", () => {
    const old: StoredBrightDataResult = { id: "bd_old", provider: "brightdata", type: "fetch", timestamp: Date.now() - 7200_000, urls: [] };
    restoreFromSession({ sessionManager: { getBranch: () => [{ type: "custom", customType: "brightdata-results", data: old }] } });
    expect(getStoredResult("bd_old")).toBeUndefined();
  });

  it("saves large markdown to a safe file name", () => {
    const dir = makeDir();
    const saved = saveLargeMarkdown({ outputDir: dir, title: "A/B: C?", url: "https://example.com/doc", content: "hello" });
    expect(saved).toMatch(/a-b-c-[a-f0-9]{8}\.md$/);
    expect(readFileSync(saved, "utf8")).toBe("hello");
  });
});
