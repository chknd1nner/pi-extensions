import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";
import { clearStoredResults, getStoredResult } from "../storage.js";

vi.mock("../brightdata-client.js", () => ({ brightDataRequest: vi.fn() }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({
    numPages: 1,
    getMetadata: async () => ({ info: { Title: "Mock PDF" } }),
    getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Mock body" }] }) }),
  })),
}));
const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { fetchBrightDataPages, getStoredContentText } = await import("../fetch.js");

const PDF_OPTIONS = {
  zone: "unlock",
  country: "au",
  preferMarkdown: true,
  maxUrls: 10,
  maxInlineChars: 30000,
  cwd: process.cwd(),
  concurrency: 3,
  pdfEnabled: true,
  pdfInlineMaxPages: 5,
  pdfInlineMaxChars: 20000,
  pdfPreviewChars: 2000,
  pdfMaxPages: 200,
  pdfMaxBytes: 52428800,
  signal: undefined,
} as const;

function bytesResponse(contentType: string, bytes: Uint8Array): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": contentType }), text: "", json: null, bytes: bytes.buffer as ArrayBuffer };
}

const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearStoredResults();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-fetch-"));
  tempDirs.push(dir);
  return dir;
}

function response(text: string): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": "text/markdown" }), text, json: null, bytes: new TextEncoder().encode(text).buffer };
}

describe("fetchBrightDataPages", () => {
  it("fetches pages with data_format markdown", async () => {
    brightDataRequest.mockResolvedValue(response("# Title\n\nBody"));
    const output = await fetchBrightDataPages(["https://example.com/a"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 30000,
      outputDir: makeDir(),
      cwd: process.cwd(),
      concurrency: 3,
      pdfEnabled: false,
      pdfOutputDir: makeDir(),
      pdfInlineMaxPages: 5,
      pdfInlineMaxChars: 20000,
      pdfPreviewChars: 2000,
      pdfMaxPages: 200,
      pdfMaxBytes: 52428800,
      signal: undefined
    });

    expect(output.data.urls?.[0].content).toContain("Body");
    expect(brightDataRequest).toHaveBeenCalledWith(expect.objectContaining({
      zone: "unlock",
      url: "https://example.com/a",
      format: "raw",
      data_format: "markdown",
      country: "au"
    }), undefined);
    expect(getStoredResult(output.data.id)).toEqual(output.data);
  });

  it("saves large page content to disk", async () => {
    const dir = makeDir();
    brightDataRequest.mockResolvedValue(response("x".repeat(100)));
    const output = await fetchBrightDataPages(["https://example.com/large"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 20,
      outputDir: dir,
      cwd: process.cwd(),
      concurrency: 3,
      pdfEnabled: false,
      pdfOutputDir: makeDir(),
      pdfInlineMaxPages: 5,
      pdfInlineMaxChars: 20000,
      pdfPreviewChars: 2000,
      pdfMaxPages: 200,
      pdfMaxBytes: 52428800,
      signal: undefined
    });

    const page = output.data.urls?.[0];
    expect(page?.savedPath).toBeDefined();
    expect(page?.content).toContain("Saved full content to");
    expect(readFileSync(page!.savedPath!, "utf8")).toHaveLength(100);
  });
});

describe("fetchBrightDataPages PDF routing", () => {
  it("routes an extensionless URL with a HEAD application/pdf to PDF extraction", async () => {
    // HEAD probe (global fetch) and direct GET both report application/pdf with %PDF magic bytes.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70, 1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf" } })));

    const output = await fetchBrightDataPages(["https://example.com/download?id=1"], {
      ...PDF_OPTIONS,
      outputDir: makeDir(),
      pdfOutputDir: makeDir(),
    });

    const page = output.data.urls?.[0];
    expect(page?.kind).toBe("pdf");
    expect(page?.error).toBeNull();
    expect(page?.content).toContain("Mock body");
    // Direct fetch served the PDF, so Bright Data is never called.
    expect(brightDataRequest).not.toHaveBeenCalled();
  });

  it("routes a failed-HEAD URL whose Bright Data response has PDF magic bytes to PDF extraction", async () => {
    // HEAD probe is inconclusive (405), so pre-routing declines and the normal page path runs.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 405 })));
    // Bright Data returns PDF magic bytes under a generic content-type.
    brightDataRequest.mockResolvedValue(bytesResponse("application/octet-stream", new Uint8Array([37, 80, 68, 70, 9, 9])));

    const output = await fetchBrightDataPages(["https://example.com/download?id=2"], {
      ...PDF_OPTIONS,
      outputDir: makeDir(),
      pdfOutputDir: makeDir(),
    });

    const page = output.data.urls?.[0];
    expect(page?.kind).toBe("pdf");
    expect(page?.error).toBeNull();
    expect(page?.content).toContain("Mock body");
    expect(brightDataRequest).toHaveBeenCalledTimes(1);
  });
});

describe("getStoredContentText", () => {
  it("returns selected fetched content by urlIndex", async () => {
    brightDataRequest.mockResolvedValue(response("# Page"));
    const output = await fetchBrightDataPages(["https://example.com/a"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 30000,
      outputDir: makeDir(),
      cwd: process.cwd(),
      concurrency: 3,
      pdfEnabled: false,
      pdfOutputDir: makeDir(),
      pdfInlineMaxPages: 5,
      pdfInlineMaxChars: 20000,
      pdfPreviewChars: 2000,
      pdfMaxPages: 200,
      pdfMaxBytes: 52428800,
      signal: undefined
    });

    expect(getStoredContentText({ responseId: output.data.id, urlIndex: 0 })).toContain("# Page");
  });

  it("does not return unbounded saved content", async () => {
    const dir = makeDir();
    brightDataRequest.mockResolvedValue(response("x".repeat(100)));
    const output = await fetchBrightDataPages(["https://example.com/large"], {
      zone: "unlock",
      country: "au",
      preferMarkdown: true,
      maxUrls: 10,
      maxInlineChars: 20,
      outputDir: dir,
      cwd: process.cwd(),
      concurrency: 3,
      pdfEnabled: false,
      pdfOutputDir: makeDir(),
      pdfInlineMaxPages: 5,
      pdfInlineMaxChars: 20000,
      pdfPreviewChars: 2000,
      pdfMaxPages: 200,
      pdfMaxBytes: 52428800,
      signal: undefined
    });

    const savedPath = output.data.urls?.[0].savedPath!;
    const text = getStoredContentText({ responseId: output.data.id, urlIndex: 0, maxOutputChars: 30 });

    expect(text).not.toContain("x".repeat(100));
    expect(text.length).toBeLessThan(savedPath.length + 100);
    expect(text).toContain("Output truncated");
    expect(text).toContain(savedPath);
    expect(text).toContain("Full content saved to");
  });
});
