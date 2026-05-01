import type { SessionEntry, SessionInfo } from "@mariozechner/pi-coding-agent";
import type { SessionListItem, TreeFilter, TreePage } from "../types.js";

function formatUtcMinute(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function previewContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as any).text) : "[non-text]"))
      .join(" ");
  }
  return "[unknown]";
}

function entryPreview(entry: SessionEntry, label: string | undefined, activeLeafId: string | null): string {
  const activePrefix = entry.id === activeLeafId ? "→ " : "  ";

  if (entry.type === "message") {
    const content =
      typeof entry.message === "object" && entry.message && "content" in entry.message
        ? (entry.message as { content?: unknown }).content
        : undefined;
    const preview = previewContent(content).replace(/\s+/g, " ").slice(0, 60);
    const suffix = label ? ` [${label}]` : "";
    return `${activePrefix}${entry.message.role}: ${preview}${suffix}`;
  }

  if (entry.type === "compaction") {
    return `${activePrefix}compaction: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "branch_summary") {
    return `${activePrefix}summary: ${entry.summary.slice(0, 60)}`;
  }

  if (entry.type === "session_info") {
    return `${activePrefix}session: ${entry.name ?? "(unnamed)"}`;
  }

  if (entry.type === "label") {
    return `${activePrefix}label: ${entry.label ?? "cleared"}`;
  }

  return `${activePrefix}${entry.type}`;
}

function isSettingsEntry(entry: SessionEntry) {
  return ["label", "custom", "model_change", "thinking_level_change"].includes(entry.type);
}

function isVisible(entry: SessionEntry, filter: TreeFilter, label: string | undefined): boolean {
  switch (filter) {
    case "all":
      return true;
    case "no-tools":
      return !isSettingsEntry(entry) && !(entry.type === "message" && entry.message.role === "toolResult");
    case "user-only":
      return entry.type === "message" && entry.message.role === "user";
    case "labeled-only":
      return Boolean(label);
    case "default":
    default:
      return !isSettingsEntry(entry);
  }
}

function buildTreePrefix(
  pageItems: Array<{ entry: SessionEntry; parentId: string | null; ancestorIds: string[]; depth: number }>,
  index: number,
) {
  const item = pageItems[index]!;
  if (item.depth === 0) return "";

  const parts: string[] = [];
  for (let level = 0; level < item.depth - 1; level += 1) {
    const ancestorId = item.ancestorIds[level]!;
    const hasVisibleContinuation = pageItems
      .slice(index + 1)
      .some((candidate) => candidate.ancestorIds[level] === ancestorId);
    parts.push(hasVisibleContinuation ? "│  " : "   ");
  }

  const hasLaterSibling = pageItems.slice(index + 1).some((candidate) => candidate.parentId === item.parentId);
  parts.push(hasLaterSibling ? "├──" : "└──");
  return parts.join("");
}

export function formatSessionList(sessions: SessionInfo[]): SessionListItem[] {
  return sessions.map((session) => ({
    id: session.id,
    path: session.path,
    title: session.name ?? session.firstMessage.slice(0, 60),
    subtitle: `${formatUtcMinute(session.modified)} • ${session.messageCount} msgs`,
  }));
}

export function buildTreePage(
  entries: SessionEntry[],
  activeLeafId: string | null,
  filter: TreeFilter,
  page: number,
  pageSize: number,
  getLabel: (entryId: string) => string | undefined,
): TreePage {
  const ancestorsById = new Map<string, string[]>();

  const visible = entries
    .map((entry) => {
      const parentAncestors = entry.parentId ? (ancestorsById.get(entry.parentId) ?? []) : [];
      const ancestorIds = entry.parentId ? [...parentAncestors, entry.parentId] : [];
      ancestorsById.set(entry.id, ancestorIds);
      const label = getLabel(entry.id);
      return {
        entry,
        parentId: entry.parentId,
        ancestorIds,
        depth: ancestorIds.length,
        label,
      };
    })
    .filter(({ entry, label }) => isVisible(entry, filter, label));

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = visible.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const numbered = pageItems.map((item, index) => {
    const humanIndex = index + 1;
    const prefix = buildTreePrefix(pageItems, index);
    return {
      index: humanIndex,
      entryId: item.entry.id,
      line: `${prefix}[${humanIndex}] ${entryPreview(item.entry, item.label, activeLeafId)}`,
    };
  });

  return {
    filter,
    page: safePage,
    totalPages,
    text: [
      `Tree filter: ${filter}`,
      `Page ${safePage + 1}/${totalPages}`,
      "",
      ...numbered.map((item) => item.line),
    ].join("\n"),
    entries: numbered,
  };
}
