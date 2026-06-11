import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import delegate from "../index";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];
  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;
  return { pi, getTool: (name: string) => registeredTools.find((t) => t.name === name) };
}

describe("delegate_pack", () => {
  let root: string;
  let originalCwd: string;
  let tool: RegisteredTool;

  beforeEach(() => {
    originalCwd = process.cwd();
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "delegate-pack-")));
    process.chdir(root);

    fs.writeFileSync(path.join(root, "spec.md"), "SPEC BODY", "utf8");
    fs.writeFileSync(path.join(root, "plan.md"), "PLAN BODY", "utf8");
    fs.writeFileSync(path.join(root, "empty.md"), "  \n", "utf8");

    const { pi, getTool } = createFakePi();
    delegate(pi);
    tool = getTool("delegate_pack")!;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function todayDate(): string {
    return new Date().toLocaleDateString("en-CA");
  }

  it("compiles files into a frozen pack under .pi/delegate/<date>/packs/", async () => {
    const result = await tool.execute("c1", { name: "plan-foundation", files: ["spec.md", "plan.md"] });

    const expected = path.join(root, ".pi", "delegate", todayDate(), "packs", "plan-foundation.jsonl");
    expect(result.details?.path).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);

    const lines = fs.readFileSync(expected, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]).type).toBe("pack");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1]).message.content[0].text).toContain("SPEC BODY");

    expect(result.details?.items).toBe(2);
    expect(typeof result.details?.bytes).toBe("number");
    expect(typeof result.details?.token_estimate).toBe("number");
    expect(result.content[0].text).toContain("plan-foundation");
  });

  it("appends the note after the files", async () => {
    const result = await tool.execute("c1", { name: "p", files: ["spec.md"], note: "Be strict." });

    const lines = fs.readFileSync(result.details?.path as string, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]).message.content[0].text).toContain("Note from orchestrator:");
  });

  it("rejects invalid names", async () => {
    await expect(tool.execute("c1", { name: "Bad/Name", files: ["spec.md"] })).rejects.toThrow(/Invalid pack name/);
  });

  it("rejects an empty pack (no files, no note)", async () => {
    await expect(tool.execute("c1", { name: "p", files: [] })).rejects.toThrow(/at least one file or a note/);
  });

  it("allows note-only packs", async () => {
    const result = await tool.execute("c1", { name: "p", files: [], note: "Just guidance." });
    expect(fs.existsSync(result.details?.path as string)).toBe(true);
  });

  it("fails fast on a missing source file, naming the path", async () => {
    await expect(tool.execute("c1", { name: "p", files: ["nope.md"] })).rejects.toThrow(/nope\.md/);
  });

  it("fails on an empty source file", async () => {
    await expect(tool.execute("c1", { name: "p", files: ["empty.md"] })).rejects.toThrow(/empty/i);
  });

  it("refuses to overwrite an existing pack without overwrite: true", async () => {
    await tool.execute("c1", { name: "p", files: ["spec.md"] });
    await expect(tool.execute("c2", { name: "p", files: ["plan.md"] })).rejects.toThrow(/already exists/);
  });

  it("overwrites with overwrite: true", async () => {
    await tool.execute("c1", { name: "p", files: ["spec.md"] });
    const result = await tool.execute("c2", { name: "p", files: ["plan.md"], overwrite: true });

    const lines = fs.readFileSync(result.details?.path as string, "utf8").trim().split("\n");
    expect(JSON.parse(lines[1]).message.content[0].text).toContain("PLAN BODY");
  });
});
