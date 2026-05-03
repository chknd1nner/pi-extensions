import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import delegate from "../index";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
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
  const registeredTools: RegisteredTool[] = [];

  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
    getAllTools: () => [{ name: "read" }, { name: "bash" }],
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name: string) => registeredTools.find((tool) => tool.name === name),
  };
}

describe("delegate tools registration", () => {
  it("registers delegate_start", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("delegate_start");
  });

  it("rejects tools and denied_tools used together", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
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

  it("registers delegate_check", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("delegate_check");
  });

  it("throws for unknown task IDs in delegate_check", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_check");
    expect(tool).toBeDefined();

    await expect(tool!.execute("call-2", { task_id: "w999" })).rejects.toThrow(
      "Unknown task ID: w999",
    );
  });
});
