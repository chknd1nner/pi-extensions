import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import delegate from "../index";

type RegisteredTool = {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: {
    properties?: Record<string, unknown>;
  };
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

  it("exposes a log-only visibility parameter on delegate_start", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();
    expect(tool?.parameters?.properties?.visibility).toMatchObject({
      description: expect.stringContaining("log"),
      enum: ["log"],
    });
  });

  it("guides agents toward status-file waiting without naming optional third-party tools", () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();

    const guidance = [tool?.promptSnippet, ...(tool?.promptGuidelines ?? [])].join("\n");
    expect(guidance).toContain("details.watch.command");
    expect(guidance).toContain("async/background command runner");
    expect(guidance).toContain("blocking shell");
    expect(guidance).toContain("After the wait command emits");
    expect(guidance).toContain("Avoid tight polling loops around delegate_check");
    expect(guidance).not.toContain("process tool");
    expect(guidance).not.toContain("pi-processes");
  });

  it("throws when tools and denied_tools are used together", async () => {
    const fake = createFakePi();
    delegate(fake.pi);

    const tool = fake.getTool("delegate_start");
    expect(tool).toBeDefined();

    await expect(
      tool!.execute("call-1", {
        task: "Do something",
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        tools: ["read"],
        denied_tools: ["bash"],
      }),
    ).rejects.toThrow("Cannot specify both");
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
