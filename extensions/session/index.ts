import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function session(pi: ExtensionAPI) {
  pi.registerTool({
    name: "session_entries",
    label: "Session Entries",
    description:
      "Return all entries on the current session branch, root to leaf. Use to identify entry IDs for delegate_anchor.",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text" as const, text: "[]" }],
        details: { entries: [] },
      };
    },
  });
}
