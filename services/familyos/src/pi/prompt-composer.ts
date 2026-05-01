import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

function dedupe(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function composeGuidelines(activeTools: Array<Pick<ToolDefinition, "name" | "promptSnippet" | "promptGuidelines">>) {
  const snippetLines = activeTools
    .filter((tool) => typeof tool.promptSnippet === "string" && tool.promptSnippet.trim().length > 0)
    .map((tool) => `- ${tool.name}: ${tool.promptSnippet!.trim()}`);

  const guidelineLines = dedupe(
    activeTools.flatMap((tool) => (tool.promptGuidelines ?? []).map((line) => line.trim())),
  );

  const sections: string[] = [];
  if (snippetLines.length > 0) {
    sections.push(["## Available tools", ...snippetLines].join("\n"));
  }
  if (guidelineLines.length > 0) {
    sections.push(["## Guidelines", ...guidelineLines.map((line) => `- ${line}`)].join("\n"));
  }

  return sections.join("\n\n");
}

export function composeSystemPrompt(
  soul: string,
  activeTools: Array<Pick<ToolDefinition, "name" | "promptSnippet" | "promptGuidelines">>,
) {
  const guidelineBlock = composeGuidelines(activeTools);
  return guidelineBlock ? `${soul.trim()}\n\n${guidelineBlock}` : soul.trim();
}
