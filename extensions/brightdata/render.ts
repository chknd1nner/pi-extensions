import { Text } from "@earendil-works/pi-tui";

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

export function renderSearchCall(args: { query?: unknown; queries?: unknown }, theme: { fg: (color: any, text: string) => string; bold: (text: string) => string }) {
  const queries = Array.isArray(args.queries) ? args.queries : args.query ? [args.query] : [];
  const title = theme.fg("toolTitle", theme.bold("brightdata_search "));
  if (queries.length === 1 && typeof queries[0] === "string") return new Text(title + theme.fg("accent", `"${queries[0].slice(0, 80)}"`), 0, 0);
  return new Text(title + theme.fg(queries.length > 0 ? "accent" : "error", queries.length > 0 ? `${queries.length} queries` : "no query"), 0, 0);
}

export function renderFetchCall(args: { url?: unknown; urls?: unknown }, theme: { fg: (color: any, text: string) => string; bold: (text: string) => string }) {
  const urls = Array.isArray(args.urls) ? args.urls : args.url ? [args.url] : [];
  const title = theme.fg("toolTitle", theme.bold("brightdata_fetch "));
  if (urls.length === 1 && typeof urls[0] === "string") return new Text(title + theme.fg("accent", urls[0].slice(0, 90)), 0, 0);
  return new Text(title + theme.fg(urls.length > 0 ? "accent" : "error", urls.length > 0 ? `${urls.length} URLs` : "no URL"), 0, 0);
}

export function renderTextResult(result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }, options: { expanded?: boolean; isPartial?: boolean }, theme: { fg: (color: any, text: string) => string }) {
  if (options.isPartial) return new Text(theme.fg("warning", "Working..."), 0, 0);
  if (result.details?.error) return new Text(theme.fg("error", String(result.details.error)), 0, 0);
  const text = firstText(result);
  const preview = text.length > 500 && !options.expanded ? text.slice(0, 500) + "..." : text;
  return new Text(theme.fg("dim", preview), 0, 0);
}
