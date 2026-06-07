import type { SearchEngine } from "./types.js";

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function buildSearchUrl(engine: SearchEngine, query: string, language: string): string {
  switch (engine) {
    case "bing":
      return withParams("https://www.bing.com/search", { q: query, brd_json: "1" });
    case "duckduckgo":
      return withParams("https://duckduckgo.com/html/", { q: query, brd_json: "1" });
    case "yandex":
      return withParams("https://yandex.com/search/", { text: query, brd_json: "1" });
    case "google":
    default:
      return withParams("https://www.google.com/search", { q: query, hl: language, brd_json: "1" });
  }
}
