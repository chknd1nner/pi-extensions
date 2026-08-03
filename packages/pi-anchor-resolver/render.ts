import { Text } from "@earendil-works/pi-tui";

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

export function renderCall(
  args: { mode?: unknown; section?: unknown; changed?: unknown },
  theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
) {
  const mode = typeof args.mode === "string" ? args.mode : "full";
  let suffix = "";
  if (mode === "section" && typeof args.section === "string") suffix = ` ${args.section}`;
  else if (mode === "changed" && Array.isArray(args.changed)) suffix = ` ${args.changed.length} file(s)`;
  const title = theme.fg("toolTitle", theme.bold("anchor_resolve "));
  return new Text(title + theme.fg("accent", mode + suffix), 0, 0);
}

export function renderResult(
  result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
  options: { expanded?: boolean; isPartial?: boolean },
  theme: { fg: (color: any, text: string) => string },
) {
  if (options.isPartial) return new Text(theme.fg("warning", "Resolving..."), 0, 0);
  if (result.details?.error) return new Text(theme.fg("error", String(result.details.error)), 0, 0);
  const text = firstText(result);
  const preview = text.length > 800 && !options.expanded ? text.slice(0, 800) + "..." : text;
  return new Text(theme.fg("dim", preview), 0, 0);
}
