import { afterEach, describe, expect, it } from "vitest";
import registerExtension from "../index.js";

// Minimal structural fake of ExtensionAPI — we only use registerTool.
interface ToolDef {
  name: string;
  description: string;
  parameters: {
    required?: string[];
    properties: Record<string, { maxLength?: number }>;
  };
  execute: (
    toolCallId: string,
    params: { message: string; emoji?: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<unknown>;
}

function capture(): ToolDef[] {
  const tools: ToolDef[] = [];
  const fakePi = { registerTool: (def: ToolDef) => void tools.push(def) };
  registerExtension(fakePi as never);
  return tools;
}

afterEach(() => {
  delete process.env.IMSG_CONFIG;
});

describe("extension registration", () => {
  it("registers exactly one tool: send_imessage", () => {
    const tools = capture();
    expect(tools.map((t) => t.name)).toEqual(["send_imessage"]);
  });

  it("requires message, emoji optional with maxLength 16", () => {
    const [tool] = capture();
    expect(tool.parameters.required).toEqual(["message"]);
    expect(tool.parameters.properties.emoji.maxLength).toBe(16);
  });

  it("execute rejects with setup hint when config is missing", async () => {
    process.env.IMSG_CONFIG = "/nonexistent/imsg-config.json";
    const [tool] = capture();
    const err = await tool
      .execute("id1", { message: "hi" }, undefined, undefined, { cwd: "/tmp/x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/config not found|Setup/i);
  });
});
