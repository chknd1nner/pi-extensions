import { describe, expect, it, vi, afterEach } from "vitest";
import type { BrightDataResult } from "../brightdata-client.js";

vi.mock("../brightdata-client.js", () => ({
  brightDataRequest: vi.fn()
}));

const { brightDataRequest } = await import("../brightdata-client.js") as unknown as { brightDataRequest: ReturnType<typeof vi.fn> };
const { normalizeSearchResults, searchBrightData, formatSearchMarkdown } = await import("../search.js");

afterEach(() => {
  vi.clearAllMocks();
});

function result(json: unknown): BrightDataResult {
  const text = JSON.stringify(json);
  return { status: 200, headers: new Headers(), text, json, bytes: new TextEncoder().encode(text).buffer };
}

describe("normalizeSearchResults", () => {
  it("normalizes organic results", () => {
    expect(normalizeSearchResults({ organic: [
      { title: "A", link: "https://a.test", description: "Alpha", displayed_link: "a.test" },
      { title: "B", url: "https://b.test", snippet: "Beta" }
    ]}, 10)).toEqual([
      { rank: 1, title: "A", url: "https://a.test", snippet: "Alpha", source: "a.test" },
      { rank: 2, title: "B", url: "https://b.test", snippet: "Beta" }
    ]);
  });

  it("handles body-wrapped organic_results", () => {
    expect(normalizeSearchResults({ body: { organic_results: [
      { rank: 3, title: "C", link: "https://c.test", text: "Gamma" }
    ]}}, 10)).toEqual([
      { rank: 3, title: "C", url: "https://c.test", snippet: "Gamma" }
    ]);
  });
});

describe("searchBrightData", () => {
  it("calls Bright Data with brd_json target URL and format raw", async () => {
    brightDataRequest.mockResolvedValue(result({ organic: [{ title: "A", link: "https://a.test" }] }));

    const response = await searchBrightData(["pizza"], {
      zone: "serp_zone",
      engine: "google",
      country: "au",
      language: "en",
      limit: 5,
      maxQueries: 10,
      signal: undefined
    });

    expect(response).toHaveLength(1);
    expect(response[0].results[0].url).toBe("https://a.test");
    expect(brightDataRequest).toHaveBeenCalledWith(expect.objectContaining({
      zone: "serp_zone",
      format: "raw",
      country: "au"
    }), undefined);
    expect(brightDataRequest.mock.calls[0][0].url).toContain("brd_json=1");
  });
});

describe("formatSearchMarkdown", () => {
  it("formats query sections", () => {
    const text = formatSearchMarkdown([{ query: "pizza", results: [{ rank: 1, title: "A", url: "https://a.test", snippet: "Alpha" }], raw: {} }]);
    expect(text).toContain("## Results for: pizza");
    expect(text).toContain("1. A");
    expect(text).toContain("https://a.test");
  });
});
