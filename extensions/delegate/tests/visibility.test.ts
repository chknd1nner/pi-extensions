import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProgressLogWriter } from "../visibility";

describe("ProgressLogWriter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "delegate-vis-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates nested directory structure and writes progress file", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendText("Hello world");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("Hello world");
  });

  it("appends tool call markers", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendToolCall("bash", '{"command":"ls"}');
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("[TOOL: bash]");
    expect(content).toContain("ls");
  });

  it("appends multiple writes in order", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.appendText("first ");
    writer.appendText("second");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.readFileSync(filePath, "utf8")).toBe("first second");
  });

  it("handles close when no writes occurred", () => {
    const writer = new ProgressLogWriter(tmpDir, "2026-04-26", "sess-abc", "w1");
    writer.close();

    const filePath = path.join(tmpDir, ".pi", "delegate", "2026-04-26", "sess-abc", "w1.progress.md");
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
