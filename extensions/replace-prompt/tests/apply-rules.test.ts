import { describe, expect, it } from "vitest";
import { applyRulesToPrompt } from "../apply-rules";
import type { NormalizedRule } from "../types";

const literalRule: NormalizedRule = {
  id: "replace-opening",
  enabled: true,
  type: "literal",
  target: "Hello\r\nWorld",
  replacementSource: { kind: "inline", value: "Hi\nWorld" },
  mode: "first",
  sourceScope: "global",
};

const regexRule: NormalizedRule = {
  id: "remove-guidelines",
  enabled: true,
  type: "regex",
  target: /Guidelines:[\s\S]*?End/i,
  replacementSource: { kind: "inline", value: "Rules: trimmed End" },
  mode: "first",
  sourceScope: "project",
};

describe("applyRulesToPrompt", () => {
  it("normalizes line endings and applies literal replacements", () => {
    const result = applyRulesToPrompt("Hello\nWorld", [literalRule], () => "Hi\nWorld");
    expect(result.systemPrompt).toBe("Hi\nWorld");
    expect(result.changed).toBe(true);
  });

  it("uses mode all for regex replacements even when the regex has the g flag", () => {
    const allRule: NormalizedRule = {
      ...regexRule,
      id: "replace-all",
      target: /abc/g,
      replacementSource: { kind: "inline", value: "z" },
      mode: "all",
    };
    const result = applyRulesToPrompt("abc abc", [allRule], () => "z");
    expect(result.systemPrompt).toBe("z z");
  });

  it("allows empty replacement strings to delete matches", () => {
    const deleteRule: NormalizedRule = {
      ...literalRule,
      id: "delete-line",
      target: "remove me",
      replacementSource: { kind: "inline", value: "" },
    };
    const result = applyRulesToPrompt("keep remove me done", [deleteRule], () => "");
    expect(result.systemPrompt).toBe("keep  done");
  });

  it("treats literal mode first replacements as plain text even when they contain dollar patterns", () => {
    const dollarRule: NormalizedRule = {
      ...literalRule,
      id: "literal-dollar-text",
      target: "Hello",
      replacementSource: { kind: "inline", value: "Hi $& there" },
      mode: "first",
    };
    const result = applyRulesToPrompt("Hello World", [dollarRule], () => "Hi $& there");
    expect(result.systemPrompt).toBe("Hi $& there World");
  });

  it("records a miss when an enabled rule no longer matches", () => {
    const result = applyRulesToPrompt("nothing here", [regexRule], () => "Rules: trimmed End");
    expect(result.events.some((event) => event.level === "warn" && event.ruleId === "remove-guidelines")).toBe(true);
  });
});
