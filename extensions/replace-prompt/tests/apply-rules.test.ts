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

const runtime = {
  cwd: "/repo",
  model: "claude-3-7-sonnet",
  env: {} as NodeJS.ProcessEnv,
};

describe("applyRulesToPrompt", () => {
  it("normalizes line endings and applies literal replacements", () => {
    const result = applyRulesToPrompt("Hello\nWorld", [literalRule], () => "Hi\nWorld", runtime);
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
    const result = applyRulesToPrompt("abc abc", [allRule], () => "z", runtime);
    expect(result.systemPrompt).toBe("z z");
  });

  it("allows empty replacement strings to delete matches", () => {
    const deleteRule: NormalizedRule = {
      ...literalRule,
      id: "delete-line",
      target: "remove me",
      replacementSource: { kind: "inline", value: "" },
    };
    const result = applyRulesToPrompt("keep remove me done", [deleteRule], () => "", runtime);
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
    const result = applyRulesToPrompt("Hello World", [dollarRule], () => "Hi $& there", runtime);
    expect(result.systemPrompt).toBe("Hi $& there World");
  });

  it("skips a rule and records a warning when replacement resolution returns null", () => {
    const missingFileRule: NormalizedRule = {
      ...literalRule,
      id: "missing-file",
      target: "Hello",
      replacementSource: { kind: "file", value: "missing.md" },
      mode: "first",
    };
    const result = applyRulesToPrompt("Hello World", [missingFileRule], () => null, runtime);
    expect(result.systemPrompt).toBe("Hello World");
    expect(result.changed).toBe(false);
    expect(result.events).toContainEqual({
      level: "warn",
      message: "replacement file not found",
      ruleId: "missing-file",
    });
  });

  it("records a miss when an enabled rule no longer matches", () => {
    const result = applyRulesToPrompt("nothing here", [regexRule], () => "Rules: trimmed End", runtime);
    expect(result.events.some((event) => event.level === "warn" && event.ruleId === "remove-guidelines")).toBe(true);
  });

  it("skips rules whose condition returns false", () => {
    const rule: NormalizedRule = {
      ...literalRule,
      id: "condition-false",
      target: "Hello",
      replacementSource: { kind: "inline", value: "Hi" },
      condition: () => false,
    };

    const result = applyRulesToPrompt("Hello World", [rule], () => "Hi", runtime);
    expect(result.systemPrompt).toBe("Hello World");
    expect(result.events).toContainEqual({
      level: "info",
      message: "rule skipped by condition",
      ruleId: "condition-false",
    });
  });

  it("skips truthy non-boolean condition results with a warning", () => {
    const rule: NormalizedRule = {
      ...literalRule,
      id: "condition-non-boolean",
      target: "Hello",
      replacementSource: { kind: "inline", value: "Hi" },
      condition: (() => "claude") as any,
    };

    const result = applyRulesToPrompt("Hello World", [rule], () => "Hi", runtime);
    expect(result.systemPrompt).toBe("Hello World");
    expect(result.events).toContainEqual({
      level: "warn",
      message: "condition returned non-boolean",
      ruleId: "condition-non-boolean",
    });
  });

  it("continues the pipeline after a condition throws", () => {
    const rules: NormalizedRule[] = [
      {
        ...literalRule,
        id: "condition-throws",
        target: "Hello",
        replacementSource: { kind: "inline", value: "Hi" },
        condition: () => {
          throw new Error("boom");
        },
      },
      {
        ...literalRule,
        id: "second-rule-still-runs",
        target: "World",
        replacementSource: { kind: "inline", value: "Pi" },
      },
    ];

    const result = applyRulesToPrompt(
      "Hello World",
      rules,
      (rule) => (rule.replacementSource.kind === "inline" ? rule.replacementSource.value : null),
      runtime,
    );

    expect(result.systemPrompt).toBe("Hello Pi");
    expect(result.events).toContainEqual({
      level: "warn",
      message: "condition threw",
      ruleId: "condition-throws",
    });
    expect(result.events).toContainEqual({
      level: "info",
      message: "rule applied",
      ruleId: "second-rule-still-runs",
    });
  });

  it("exposes current and original prompt states to later rules", () => {
    const rules: NormalizedRule[] = [
      {
        ...literalRule,
        id: "add-claude-marker",
        target: "Hello",
        replacementSource: { kind: "inline", value: "[CLAUDE]\nHello" },
        condition: (ctx) => ctx.model?.includes("claude") ?? false,
      },
      {
        ...literalRule,
        id: "expand-claude-guidance",
        target: "Hello",
        replacementSource: { kind: "inline", value: "Hello with Claude-specific guidance" },
        condition: (ctx) => ctx.systemPrompt.includes("[CLAUDE]"),
      },
      {
        ...literalRule,
        id: "note-original-greeting",
        target: "[CLAUDE]",
        replacementSource: { kind: "inline", value: "[CLAUDE-ORIGINAL-HELLO]" },
        condition: (ctx) => ctx.originalSystemPrompt.startsWith("Hello"),
      },
    ];

    const result = applyRulesToPrompt(
      "Hello there",
      rules,
      (rule) => (rule.replacementSource.kind === "inline" ? rule.replacementSource.value : null),
      runtime,
    );

    expect(result.systemPrompt).toBe("[CLAUDE-ORIGINAL-HELLO]\nHello with Claude-specific guidance there");
  });
});
