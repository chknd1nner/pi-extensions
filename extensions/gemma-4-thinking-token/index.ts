import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const THINK_PREFIX = "<|think|>\n";
const GEMMA_4_PREFIX = "gemma-4";

export default function gemma4ThinkingToken(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const modelId = ctx.model?.id ?? "";
    const systemPrompt = event.systemPrompt ?? "";

    if (!modelId.startsWith(GEMMA_4_PREFIX)) {
      return undefined;
    }

    if (systemPrompt.startsWith(THINK_PREFIX)) {
      return undefined;
    }

    return {
      systemPrompt: `${THINK_PREFIX}${systemPrompt}`,
    };
  });
}
