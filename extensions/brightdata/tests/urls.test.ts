import { describe, expect, it } from "vitest";
import { buildSearchUrl } from "../urls.js";

describe("buildSearchUrl", () => {
  it("builds a Google SERP URL with brd_json=1", () => {
    const url = buildSearchUrl("google", "pizza near me", "en");
    expect(url).toContain("https://www.google.com/search");
    expect(url).toContain("q=pizza+near+me");
    expect(url).toContain("hl=en");
    expect(url).toContain("brd_json=1");
  });

  it("builds Bing and DuckDuckGo URLs with brd_json=1", () => {
    expect(buildSearchUrl("bing", "abc", "en")).toBe("https://www.bing.com/search?q=abc&brd_json=1");
    expect(buildSearchUrl("duckduckgo", "abc", "en")).toBe("https://duckduckgo.com/html/?q=abc&brd_json=1");
  });
});
