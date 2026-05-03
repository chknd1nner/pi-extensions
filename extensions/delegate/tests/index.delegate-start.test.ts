import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: {
      task: string;
      model: string;
      provider: string;
      tools?: string[];
      denied_tools?: string[];
    },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: Record<string, unknown>;
    isError?: boolean;
  }>;
};

function createFakePi() {
  let registeredTool: RegisteredTool | undefined;

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  return {
    pi,
    getRegisteredTool: () => registeredTool,
  };
}

describe("delegate_start tool registration", () => {
  it("registers delegate_start", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getRegisteredTool();
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("delegate_start");
  });

  it("rejects tools and denied_tools used together", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getRegisteredTool();
    expect(tool).toBeDefined();

    const result = await tool!.execute("call-1", {
      task: "Do something",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      tools: ["read"],
      denied_tools: ["bash"],
    });

    expect(result.isError).toBe(true);
    expect(result.details?.error).toBe("invalid_params");
    expect(result.content[0]?.text).toContain("Cannot specify both");
  });
});
