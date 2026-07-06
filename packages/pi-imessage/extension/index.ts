import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import { Type } from "typebox";
import { computeContext, defaultConfigPath, loadProConfig, sendNotification } from "./lib.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "send_imessage",
    label: "Send iMessage",
    description:
      "Send the user a push notification via iMessage (delivered from the household agent identity). " +
      "Use when: a long-running job finishes, you need user input to proceed and the user may be away from the machine, " +
      "or something failed that is worth interrupting the user for. Do NOT use for routine progress updates. " +
      "Keep the message short and self-contained; provenance (host · project) is appended automatically.",
    promptSnippet: "Notify the user via iMessage when a job finishes, fails, or needs their input",
    parameters: Type.Object({
      message: Type.String({
        description: "The notification text. Short, self-contained, no markdown.",
      }),
      emoji: Type.Optional(
        Type.String({
          maxLength: 16,
          description:
            "Optional single status emoji prefixed to the message, e.g. ✅ done, ⏸️ input needed, ❌ failed. Omit if no status glyph fits.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const config = loadProConfig(defaultConfigPath());
      const context = computeContext(os.hostname(), ctx.cwd);
      await sendNotification({
        config,
        message: params.message,
        emoji: params.emoji,
        context,
        signal,
      });
      return {
        content: [{ type: "text", text: `iMessage sent (${context})` }],
        details: {},
      };
    },
  });
}
