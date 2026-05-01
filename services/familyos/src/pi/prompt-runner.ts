import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { TurnInput } from "../types.js";

export function buildPromptText(input: TurnInput): string {
  const fileLines = input.attachments.map((attachment) => `- ${attachment.relativePath}`);
  if (fileLines.length === 0) return input.text;

  return `${input.text}\n\nUploaded files saved in your workspace:\n${fileLines.join("\n")}`;
}

export async function promptAndCollectReply(session: AgentSession, input: TurnInput): Promise<string> {
  let assistantText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantText += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(buildPromptText(input), {
      images: input.attachments.flatMap((attachment) => (attachment.inlineImage ? [attachment.inlineImage] : [])),
      ...(session.isStreaming ? ({ streamingBehavior: "followUp" } as const) : {}),
    });

    return assistantText.trim();
  } finally {
    unsubscribe();
  }
}
