import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";

vi.mock("../brightdata-client.js", () => ({ brightDataRequest: vi.fn() }));
const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { UnsafeUrlError } = await import("../request-safety.js");
const { extractPdfFromBytes, fetchPdfBytesWithFallback, isLikelyPdfUrl, isPdfPayload, isPdfResponse, shouldInlinePdf, shouldTreatAsPdfUrl } = await import("../pdf.js");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "brightdata-pdf-"));
  tempDirs.push(dir);
  return dir;
}

function bdBytes(bytes: Uint8Array): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": "application/pdf" }), text: "", json: null, bytes: bytes.buffer as ArrayBuffer };
}

function bdResult(contentType: string, bytes: Uint8Array): BrightDataResult {
  return { status: 200, headers: new Headers({ "content-type": contentType }), text: "", json: null, bytes: bytes.buffer as ArrayBuffer };
}

describe("isLikelyPdfUrl", () => {
  it("detects .pdf path names", () => {
    expect(isLikelyPdfUrl("https://example.com/file.pdf")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/page")).toBe(false);
  });
});

describe("shouldInlinePdf", () => {
  it("requires both page and char thresholds", () => {
    expect(shouldInlinePdf({ pages: 2, chars: 1000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(true);
    expect(shouldInlinePdf({ pages: 6, chars: 1000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(false);
    expect(shouldInlinePdf({ pages: 2, chars: 25000, inlineMaxPages: 5, inlineMaxChars: 20000 })).toBe(false);
  });
});

describe("shouldTreatAsPdfUrl", () => {
  it("uses .pdf paths without a HEAD request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(shouldTreatAsPdfUrl("https://example.com/file.pdf")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses HEAD content-type for extensionless PDF URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "content-type": "application/pdf" } })));
    await expect(shouldTreatAsPdfUrl("https://example.com/download?id=1")).resolves.toBe(true);
  });

  it("treats failed HEAD as inconclusive", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 405 })));
    await expect(shouldTreatAsPdfUrl("https://example.com/download?id=1")).resolves.toBe(false);
  });
});

describe("isPdfPayload", () => {
  it("ignores the URL and only inspects content-type or magic bytes", () => {
    // A .pdf URL with a non-PDF payload must NOT be treated as a PDF payload.
    expect(isPdfPayload(new Headers({ "content-type": "text/html" }), new Uint8Array([60, 104]).buffer)).toBe(false);
    expect(isPdfPayload(new Headers({ "content-type": "application/pdf" }), new Uint8Array([1]).buffer)).toBe(true);
    expect(isPdfPayload(new Headers({ "content-type": "application/octet-stream" }), new Uint8Array([37, 80, 68, 70]).buffer)).toBe(true);
  });
});

describe("fetchPdfBytesWithFallback", () => {
  it("uses direct fetch when a public PDF succeeds", async () => {
    const directBytes = new Uint8Array([37, 80, 68, 70]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(directBytes, { status: 200, headers: { "content-type": "application/pdf" } })));

    const bytes = await fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 });

    expect(new Uint8Array(bytes)).toEqual(directBytes);
    expect(brightDataRequest).not.toHaveBeenCalled();
  });

  it("falls back to Bright Data raw bytes when direct fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    brightDataRequest.mockResolvedValue(bdBytes(new Uint8Array([1, 2, 3])));

    const bytes = await fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 });

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(brightDataRequest).toHaveBeenCalledWith({ zone: "unlock", url: "https://example.com/file.pdf", format: "raw", country: "au" }, undefined);
  });

  it("falls back to Bright Data when a .pdf URL direct fetch returns a non-PDF payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not a pdf</html>", { status: 200, headers: { "content-type": "text/html" } })));
    brightDataRequest.mockResolvedValue(bdBytes(new Uint8Array([37, 80, 68, 70, 1, 2])));

    const bytes = await fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 });

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([37, 80, 68, 70, 1, 2]));
    expect(brightDataRequest).toHaveBeenCalled();
  });

  it("throws when the Bright Data fallback returns a non-PDF payload for a .pdf URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    brightDataRequest.mockResolvedValue(bdResult("text/html", new TextEncoder().encode("<html>not a pdf</html>")));

    await expect(fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 })).rejects.toThrow(/did not return a PDF/);
  });

  it("does not fall back to Bright Data when the direct PDF exceeds maxBytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70, 1, 2, 3, 4, 5, 6]), { status: 200, headers: { "content-type": "application/pdf" } })));

    await expect(fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 4 })).rejects.toThrow(/PDF too large/);
    expect(brightDataRequest).not.toHaveBeenCalled();
  });

  it("rejects direct redirects to private hosts without Bright Data fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.pdf" } })));
    brightDataRequest.mockResolvedValue(bdBytes(new Uint8Array([9])));

    await expect(fetchPdfBytesWithFallback({ url: "https://example.com/file.pdf", zone: "unlock", country: "au", maxBytes: 1000 })).rejects.toThrow(UnsafeUrlError);
    expect(brightDataRequest).not.toHaveBeenCalled();
  });
});

describe("isPdfResponse", () => {
  it("detects PDFs by content-type or magic bytes", () => {
    expect(isPdfResponse("https://example.com/download", new Headers({ "content-type": "application/pdf" }), new Uint8Array([1]).buffer)).toBe(true);
    expect(isPdfResponse("https://example.com/download", new Headers({ "content-type": "application/octet-stream" }), new Uint8Array([37, 80, 68, 70]).buffer)).toBe(true);
  });
});

describe("extractPdfFromBytes", () => {
  it("returns small PDFs inline", async () => {
    const result = await extractPdfFromBytes({
      url: "https://example.com/small.pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      outputDir: makeDir(),
      cwd: process.cwd(),
      inlineMaxPages: 5,
      inlineMaxChars: 20000,
      previewChars: 2000,
      maxPages: 200,
      parsePdf: async () => ({ title: "Small", author: "Ada", pages: 2, markdown: "# Small\n\nBody", truncated: false })
    });

    expect(result.kind).toBe("pdf");
    expect(result.savedPath).toBeUndefined();
    expect(result.content).toContain("# Small");
    expect(result.pages).toBe(2);
  });

  it("saves large PDFs to disk and returns a preview", async () => {
    const dir = makeDir();
    const result = await extractPdfFromBytes({
      url: "https://example.com/large.pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      outputDir: dir,
      cwd: process.cwd(),
      inlineMaxPages: 5,
      inlineMaxChars: 50,
      previewChars: 10,
      maxPages: 200,
      parsePdf: async () => ({ title: "Large", pages: 10, markdown: "# Large\n\n" + "x".repeat(100), truncated: false })
    });

    expect(result.savedPath).toBeDefined();
    expect(result.content).toContain("PDF extracted successfully");
    expect(result.content).toContain("Preview:");
    expect(readFileSync(result.savedPath!, "utf8")).toContain("# Large");
  });
});
