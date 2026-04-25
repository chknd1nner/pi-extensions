import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function replacePrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    return undefined;
  });
}
