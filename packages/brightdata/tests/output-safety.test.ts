import { describe, expect, it } from "vitest";
import { formatStoredContentForTool } from "../output-safety.js";

describe("formatStoredContentForTool", () => {
  it("returns small content unchanged", () => {
    expect(formatStoredContentForTool({ content: "hello", maxOutputChars: 10 })).toBe("hello");
  });

  it("truncates large content and preserves saved path guidance", () => {
    const text = formatStoredContentForTool({ content: "x".repeat(100), savedPath: "/tmp/full.md", maxOutputChars: 20 });
    expect(text).toContain("x".repeat(20));
    expect(text).toContain("Output truncated");
    expect(text).toContain("/tmp/full.md");
  });

  it("preserves a long absolute saved path verbatim in the truncation notice", () => {
    const savedPath = "/very/long/project/path/.pi/brightdata/pages/full-content-1a2b3c4d.md";
    const text = formatStoredContentForTool({ content: "x".repeat(100), savedPath, maxOutputChars: 20 });
    expect(text).toContain("Output truncated");
    expect(text).toContain("Full content saved to");
    expect(text).toContain(savedPath);
  });
});
