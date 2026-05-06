import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type SessionEntry = Record<string, unknown>;

function buildPreview(entry: SessionEntry): string {
  const type = entry.type as string;

  if (type === "message") {
    const msg = entry.message as { role: string; content: unknown };
    const { content } = msg;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => (b as { type: string }).type === "text") as
        | { text?: string }
        | undefined;
      if (textBlock?.text) return textBlock.text.slice(0, 120);
      const toolCall = content.find((b) => (b as { type: string }).type === "toolCall") as
        | { name?: string }
        | undefined;
      if (Array.isArray(content)) {
        const toolCalls = content.filter((b) => (b as { type: string }).type === "toolCall") as
          Array<{ name?: string }>;
        if (toolCalls.length > 0) {
          return `[tool: ${toolCalls.map((t) => t.name ?? "unknown").join(", ")}]`;
        }
      }
    }
    return "";
  }

  if (type === "compaction") {
    return `[compaction] ${((entry.summary as string) ?? "").slice(0, 100)}`;
  }
  if (type === "model_change") return `${entry.provider}/${entry.modelId}`;
  if (type === "thinking_level_change") return `thinking: ${entry.thinkingLevel}`;
  if (type === "label") return `label "${entry.label}" on ${entry.targetId}`;
  if (type === "session_info") return `name: ${entry.name}`;
  if (type === "branch_summary") {
    return `[branch_summary] ${((entry.summary as string) ?? "").slice(0, 100)}`;
  }
  if (type === "custom_message") {
    const content = entry.content;
    if (typeof content === "string") return content.slice(0, 120);
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => (b as { type: string }).type === "text") as
        | { text?: string }
        | undefined;
      if (textBlock?.text) return textBlock.text.slice(0, 120);
    }
  }
  return "";
}

export default function session(pi: ExtensionAPI) {
  pi.registerTool({
    name: "session_entries",
    label: "Session Entries",
    description:
      "Return all entries on the current session branch, root to leaf. Use to identify entry IDs for delegate_anchor.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionManager = (ctx as unknown as { sessionManager: { getBranch(): SessionEntry[] } })
        .sessionManager;
      const branch = sessionManager.getBranch();

      const entries = branch.map((entry) => ({
        id: entry.id as string,
        entry_type: entry.type as string,
        message_role:
          entry.type === "message"
            ? ((entry.message as { role: string }).role as string)
            : undefined,
        timestamp: entry.timestamp as string,
        preview: buildPreview(entry),
      }));

      const text = JSON.stringify(entries, null, 2);
      return {
        content: [{ type: "text" as const, text }],
        details: { entries },
      };
    },
  });
}
