import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import replacePrompt from "../index";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  process.env.HOME = originalHome;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("replace-prompt extension", () => {
  it("registers a before_agent_start handler", () => {
    const on = vi.fn();
    replacePrompt({ on } as any);
    expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
  });

  it("applies merged rules, prefers project replacement files, and logs to the most specific installed scope", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
    tempDirs.push(projectRoot, homeDir);
    process.env.HOME = homeDir;

    const projectExtDir = path.join(projectRoot, ".pi/extensions/replace-prompt");
    const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
    fs.mkdirSync(projectExtDir, { recursive: true });
    fs.mkdirSync(globalExtDir, { recursive: true });

    fs.writeFileSync(
      path.join(globalExtDir, "rules.ts"),
      `export default { logging: { file: true }, rules: [
        { id: "replace-opening", type: "literal", target: "Hello", replacementFile: "opening.md" }
      ] };`,
    );
    fs.writeFileSync(path.join(globalExtDir, "opening.md"), "Global hi");
    fs.writeFileSync(path.join(projectExtDir, "opening.md"), "Project hi");

    let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const changed = await handler?.({ systemPrompt: "Hello there", cwd: projectRoot }, {});
    expect(changed).toEqual({ systemPrompt: "Project hi there" });

    const unchanged = await handler?.({ systemPrompt: "Nothing to replace", cwd: projectRoot }, {});
    expect(unchanged).toBeUndefined();

    const logPath = path.join(projectExtDir, "replace-prompt.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const logText = fs.readFileSync(logPath, "utf8");
    expect(logText).toContain("[info] [replace-opening] rule applied");
    expect(logText).toContain("[warn] [replace-opening] rule did not match at application time");
  });

  it("falls back to the global log directory when no project extension directory is installed", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
    tempDirs.push(projectRoot, homeDir);
    process.env.HOME = homeDir;

    const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
    fs.mkdirSync(globalExtDir, { recursive: true });

    fs.writeFileSync(
      path.join(globalExtDir, "rules.ts"),
      `export default { logging: { file: true }, rules: [
        { id: "replace-opening", type: "literal", target: "Hello", replacementFile: "opening.md" }
      ] };`,
    );
    fs.writeFileSync(path.join(globalExtDir, "opening.md"), "Global hi");

    let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const changed = await handler?.({ systemPrompt: "Hello there", cwd: projectRoot }, {});
    expect(changed).toEqual({ systemPrompt: "Global hi there" });

    const globalLogPath = path.join(globalExtDir, "replace-prompt.log");
    expect(fs.existsSync(globalLogPath)).toBe(true);
    expect(fs.readFileSync(globalLogPath, "utf8")).toContain("[info] [replace-opening] rule applied");
  });

  it("passes model metadata into condition evaluation and logs condition skips", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
    tempDirs.push(projectRoot, homeDir);
    process.env.HOME = homeDir;

    const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
    fs.mkdirSync(globalExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalExtDir, "rules.ts"),
      `export default { logging: { file: true }, rules: [
      {
        id: "claude-only",
        type: "literal",
        target: "Hello",
        replacement: "Claude hi",
        condition: (ctx) => ctx.model?.includes("claude") ?? false
      }
    ] };`,
    );

    let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const changed = await handler?.(
      { systemPrompt: "Hello there", cwd: projectRoot },
      { model: { id: "claude-3-7-sonnet" } },
    );
    expect(changed).toEqual({ systemPrompt: "Claude hi there" });

    const skipped = await handler?.(
      { systemPrompt: "Hello there", cwd: projectRoot },
      { model: { id: "gpt-4o" } },
    );
    expect(skipped).toBeUndefined();

    const logText = fs.readFileSync(path.join(globalExtDir, "replace-prompt.log"), "utf8");
    expect(logText).toContain("[info] [claude-only] rule applied");
    expect(logText).toContain("[info] [claude-only] rule skipped by condition");
  });

  it("writes invalid-condition warnings collected during config loading", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
    tempDirs.push(projectRoot, homeDir);
    process.env.HOME = homeDir;

    const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
    fs.mkdirSync(globalExtDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalExtDir, "rules.ts"),
      `export default { logging: { file: true }, rules: [
      {
        id: "bad-condition",
        type: "literal",
        target: "Hello",
        replacement: "Hi",
        condition: "claude"
      }
    ] };`,
    );

    let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const result = await handler?.(
      { systemPrompt: "Hello there", cwd: projectRoot },
      { model: { id: "claude-3-7-sonnet" } },
    );
    expect(result).toBeUndefined();

    const logText = fs.readFileSync(path.join(globalExtDir, "replace-prompt.log"), "utf8");
    expect(logText).toContain("[warn] [bad-condition] invalid condition; expected function");
  });
});
