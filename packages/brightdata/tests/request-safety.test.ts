import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UnsafeUrlError,
  fetchPublicWithManualRedirects,
  resolvePublicRedirectUrl,
  validateBrightDataTarget,
  validatePublicHttpUrl,
} from "../request-safety.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("validatePublicHttpUrl", () => {
  it("accepts public http and https URLs", () => {
    expect(validatePublicHttpUrl("https://example.com/a?b=1").href).toBe("https://example.com/a?b=1");
    expect(validateBrightDataTarget("http://example.com/")).toBe("http://example.com/");
  });

  it("rejects non-http, localhost, private, link-local, unspecified, and IPv6 loopback targets", () => {
    const blocked = [
      "file:///etc/passwd",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0/",
      "http://10.0.0.5/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.10.20/",
      "http://[::1]/",
      "http://[::]/",
      "http://[::ffff:127.0.0.1]/",
    ];
    for (const url of blocked) {
      expect(() => validatePublicHttpUrl(url), url).toThrow(UnsafeUrlError);
    }
  });

  it("rejects the full fe80::/10 IPv6 link-local range", () => {
    const blocked = [
      "http://[fe80::1]/",
      "http://[fe90::1]/",
      "http://[fea0::1]/",
      "http://[febf::1]/",
    ];
    for (const url of blocked) {
      expect(() => validatePublicHttpUrl(url), url).toThrow(UnsafeUrlError);
    }
  });

  it("rejects trailing-dot (DNS-root) host forms that would otherwise bypass checks", () => {
    const blocked = [
      "http://localhost./",
      "http://localhost.localdomain./",
      "http://foo.localhost./",
      "http://127.0.0.1./",
    ];
    for (const url of blocked) {
      expect(() => validatePublicHttpUrl(url), url).toThrow(UnsafeUrlError);
    }
  });

  it("does not treat fec0::/10 site-local as fe80::/10 link-local", () => {
    // fec0::/10 is deprecated site-local and is intentionally not caught by the
    // fe80::/10 link-local rule.
    expect(validatePublicHttpUrl("http://[fec0::1]/").hostname).toBe("[fec0::1]");
  });
});

describe("redirect safety", () => {
  it("resolves safe relative redirects", () => {
    expect(resolvePublicRedirectUrl("https://example.com/a/b", "../c")).toBe("https://example.com/c");
  });

  it("rejects redirects to private targets", () => {
    expect(() => resolvePublicRedirectUrl("https://example.com/a", "http://127.0.0.1/private")).toThrow(UnsafeUrlError);
  });

  it("uses manual redirects for local direct fetches", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicWithManualRedirects("https://example.com/a", { method: "HEAD" });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a", expect.objectContaining({ method: "HEAD", redirect: "manual" }));
  });
});
