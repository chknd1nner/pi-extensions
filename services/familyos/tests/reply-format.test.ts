import { describe, expect, it } from "vitest";
import { formatReplyForTelegram } from "../src/reply-format";

function countToken(text: string, token: string) {
  return text.split(token).length - 1;
}

function hasBalancedCodeWrappers(chunk: string) {
  return countToken(chunk, "<pre><code>") === countToken(chunk, "</code></pre>");
}

describe("formatReplyForTelegram", () => {
  it("keeps fenced code blocks intact across split messages", () => {
    const limit = 1000;
    const text = `Before\n\n\`\`\`ts\n${"line\n".repeat(1000)}\`\`\`\n\nAfter`;
    const chunks = formatReplyForTelegram(text, limit);

    expect(chunks.some((chunk) => chunk.includes("<pre><code>"))).toBe(true);
    expect(chunks.every((chunk) => !chunk.includes("```"))).toBe(true);
    expect(chunks.every((chunk) => hasBalancedCodeWrappers(chunk))).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= limit)).toBe(true);
  });

  it("splits oversized code blocks into independently wrapped valid HTML chunks", () => {
    const limit = 120;
    const text = `\`\`\`ts\n${"const value = 42;\n".repeat(80)}\`\`\``;
    const chunks = formatReplyForTelegram(text, limit);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= limit)).toBe(true);
    expect(chunks.every((chunk) => hasBalancedCodeWrappers(chunk))).toBe(true);
    expect(chunks.every((chunk) => chunk.includes("<pre><code>"))).toBe(true);
    expect(chunks.every((chunk) => chunk.includes("</code></pre>"))).toBe(true);
  });
});
