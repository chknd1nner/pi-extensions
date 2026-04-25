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

    let handler: ((event: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const changed = await handler?.({ systemPrompt: "Hello there", cwd: projectRoot });
    expect(changed).toEqual({ systemPrompt: "Project hi there" });

    const unchanged = await handler?.({ systemPrompt: "Nothing to replace", cwd: projectRoot });
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

    let handler: ((event: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any) => Promise<any>) {
        if (eventName === "before_agent_start") {
          handler = fn;
        }
      },
    } as any);

    const changed = await handler?.({ systemPrompt: "Hello there", cwd: projectRoot });
    expect(changed).toEqual({ systemPrompt: "Global hi there" });

    const globalLogPath = path.join(globalExtDir, "replace-prompt.log");
    expect(fs.existsSync(globalLogPath)).toBe(true);
    expect(fs.readFileSync(globalLogPath, "utf8")).toContain("[info] [replace-opening] rule applied");
  });
});
