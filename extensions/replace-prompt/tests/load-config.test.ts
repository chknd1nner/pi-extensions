import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendLog } from "../logging";
import { loadScopeConfig, selectLogPath } from "../load-config";
import { resolveReplacementText } from "../resolve-replacement";

const tempDirs: string[] = [];

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadScopeConfig", () => {
  it("skips later duplicate IDs in one rules file and keeps the first", async () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "rules.ts"),
      `export default { rules: [
        { id: "dup-id", type: "literal", target: "A", replacement: "B" },
        { id: "dup-id", type: "literal", target: "X", replacement: "Y" }
      ] };`,
    );

    const config = await loadScopeConfig("project", dir);
    expect(config?.rules).toHaveLength(1);
    expect(config?.rules[0].id).toBe("dup-id");
  });

  it("rejects empty literal targets and accepts empty replacement strings", async () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "rules.ts"),
      `export default { rules: [
        { id: "bad-target", type: "literal", target: "", replacement: "X" },
        { id: "delete-text", type: "literal", target: "trim", replacement: "" }
      ] };`,
    );

    const config = await loadScopeConfig("global", dir);
    expect(config?.rules.map((rule) => rule.id)).toEqual(["delete-text"]);
  });

  it("preserves explicit false logging and leaves omitted logging unset", async () => {
    const explicitFalseDir = makeDir();
    fs.writeFileSync(
      path.join(explicitFalseDir, "rules.ts"),
      `export default { logging: { file: false }, rules: [
        { id: "keep", type: "literal", target: "A", replacement: "B" }
      ] };`,
    );

    const omittedDir = makeDir();
    fs.writeFileSync(
      path.join(omittedDir, "rules.ts"),
      `export default { rules: [
        { id: "keep", type: "literal", target: "A", replacement: "B" }
      ] };`,
    );

    const explicitFalse = await loadScopeConfig("global", explicitFalseDir);
    const omitted = await loadScopeConfig("project", omittedDir);

    expect(explicitFalse?.logging.file).toBe(false);
    expect(omitted?.logging.file).toBeUndefined();
  });

  it("resolves replacement files from project before global", async () => {
    const globalDir = makeDir();
    const projectDir = makeDir();
    fs.writeFileSync(
      path.join(globalDir, "rules.ts"),
      `export default { rules: [
        { id: "replace-opening", type: "literal", target: "A", replacementFile: "opening.md" }
      ] };`,
    );
    fs.writeFileSync(path.join(globalDir, "opening.md"), "global text");
    fs.writeFileSync(path.join(projectDir, "opening.md"), "project text");

    const config = await loadScopeConfig("global", globalDir);
    const rule = config?.rules[0];
    if (!rule || rule.enabled === false) throw new Error("expected enabled rule");

    const text = resolveReplacementText(rule, { globalDir, projectDir });
    expect(text).toBe("project text");
  });

  it("returns null instead of throwing when a replacement file is missing", async () => {
    const globalDir = makeDir();
    fs.writeFileSync(
      path.join(globalDir, "rules.ts"),
      `export default { rules: [
        { id: "missing-file", type: "literal", target: "A", replacementFile: "missing.md" }
      ] };`,
    );

    const config = await loadScopeConfig("global", globalDir);
    const rule = config?.rules[0];
    if (!rule || rule.enabled === false) throw new Error("expected enabled rule");

    expect(resolveReplacementText(rule, { globalDir, projectDir: null })).toBeNull();
  });

  it("selects the log path in the most specific installed scope", () => {
    expect(
      selectLogPath({
        projectDir: "/repo/.pi/extensions/replace-prompt",
        globalDir: "/home/.pi/agent/extensions/replace-prompt",
      }),
    ).toBe("/repo/.pi/extensions/replace-prompt/replace-prompt.log");
  });

  it("accepts function conditions, ignores condition on disable-only rules, and rejects non-function conditions", async () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "rules.ts"),
      `export default { logging: { file: true }, rules: [
      {
        id: "claude-only",
        type: "literal",
        target: "Hello",
        replacement: "Hi",
        condition: (ctx) => ctx.model?.includes("claude") ?? false
      },
      {
        id: "disable-me",
        enabled: false,
        condition: "ignored"
      },
      {
        id: "bad-condition",
        type: "literal",
        target: "Nope",
        replacement: "Still nope",
        condition: "claude"
      }
    ] };`,
    );

    const config = await loadScopeConfig("project", dir);
    expect(config?.rules.map((rule) => rule.id)).toEqual(["claude-only", "disable-me"]);

    const conditionalRule = config?.rules[0];
    if (!conditionalRule || conditionalRule.enabled === false) throw new Error("expected enabled rule");
    expect(typeof conditionalRule.condition).toBe("function");

    expect(config?.rules[1]).toEqual({ id: "disable-me", enabled: false });
    expect(config?.events).toContainEqual({
      level: "warn",
      message: "invalid condition; expected function",
      ruleId: "bad-condition",
    });
  });

  it("appends log events to the selected log file", () => {
    const dir = makeDir();
    const logPath = path.join(dir, "replace-prompt.log");

    appendLog(logPath, [
      { level: "info", message: "rule applied", ruleId: "replace-opening" },
      { level: "warn", message: "rule did not match", ruleId: "missing-rule" },
    ]);

    const text = fs.readFileSync(logPath, "utf8");
    expect(text).toContain("[info] [replace-opening] rule applied");
    expect(text).toContain("[warn] [missing-rule] rule did not match");
  });
});
