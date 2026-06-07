import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadClient() {
  vi.resetModules();
  return await import("../brightdata-client.js");
}

describe("brightDataRequest", () => {
  it("throws a useful error when the API key is missing", async () => {
    delete process.env.BRIGHT_DATA_KEY;
    delete process.env.BRIGHTDATA_API_KEY;
    const { brightDataRequest } = await loadClient();

    await expect(brightDataRequest({ zone: "z", url: "https://example.com", format: "raw" })).rejects.toThrow(/BRIGHT_DATA_KEY/);
  });

  it("sends documented Bright Data request fields", async () => {
    process.env.BRIGHT_DATA_KEY = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { brightDataRequest } = await loadClient();

    const result = await brightDataRequest({ zone: "unlock", url: "https://example.com", format: "raw", data_format: "markdown", country: "au" });

    expect(result.text).toBe(JSON.stringify({ ok: true }));
    expect(result.json).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.brightdata.com/request", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer secret", "Content-Type": "application/json" }),
      body: JSON.stringify({ zone: "unlock", url: "https://example.com", format: "raw", data_format: "markdown", country: "au" })
    }));
  });

  it("maps HTTP errors with response text", async () => {
    process.env.BRIGHT_DATA_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429, statusText: "Too Many Requests" })));
    const { brightDataRequest } = await loadClient();

    await expect(brightDataRequest({ zone: "z", url: "https://example.com", format: "raw" })).rejects.toThrow(/rate limit or quota.*quota exceeded/i);
  });
});
