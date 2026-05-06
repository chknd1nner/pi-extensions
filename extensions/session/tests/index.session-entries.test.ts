import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import session from "../index";

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
  }>;
};

function createFakePi() {
  const registeredTools: RegisteredTool[] = [];
  const pi = {
    on: () => {},
    registerTool: (tool: RegisteredTool) => {
      registeredTools.push(tool);
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    getTool: (name: string) => registeredTools.find((t) => t.name === name),
  };
}

function makeCtx(branch: object[]) {
  return { sessionManager: { getBranch: vi.fn(() => branch) } };
}

describe("session_entries", () => {
  it("registers the session_entries tool", () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    expect(getTool("session_entries")).toBeDefined();
  });

  it("returns an empty array when the branch has no entries", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx([]));
    expect((result.details as { entries: unknown[] }).entries).toEqual([]);
  });

  it("maps a user message entry to the correct shape", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "a1b2c3d4",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:00:00.000Z",
      message: { role: "user", content: "Hello, please read the spec" },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect(entries).toEqual([{
      id: "a1b2c3d4",
      entry_type: "message",
      message_role: "user",
      timestamp: "2026-05-04T10:00:00.000Z",
      preview: "Hello, please read the spec",
    }]);
  });

  it("omits message_role for non-message entries", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "b2c3d4e5",
      type: "compaction",
      parentId: "a1b2c3d4",
      timestamp: "2026-05-04T10:05:00.000Z",
      summary: "User read the spec and sharded tickets",
      tokensBefore: 50000,
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect(entries).toEqual([{
      id: "b2c3d4e5",
      entry_type: "compaction",
      timestamp: "2026-05-04T10:05:00.000Z",
      preview: "[compaction] User read the spec and sharded tickets",
    }]);
    expect(Object.prototype.hasOwnProperty.call(entries[0] as object, "message_role")).toBe(false);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0]).not.toHaveProperty("message_role");
  });

  it("previews model_change entries as provider/modelId", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "c3d4e5f6",
      type: "model_change",
      parentId: "b2c3d4e5",
      timestamp: "2026-05-04T10:10:00.000Z",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("anthropic/claude-opus-4-5");
  });

  it("previews assistant messages with only tool calls using [tool: name]", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "d4e5f6g7",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:15:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }],
      },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("[tool: bash]");
  });

  it("previews assistant messages with multiple tool calls using [tool: name1, name2]", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "f6g7h8i9",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:16:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
          { type: "toolCall", id: "call_2", name: "read", arguments: { path: "README.md" } },
        ],
      },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("[tool: bash, read]");
  });

  it("previews custom_message entries with string content", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "g7h8i9j0",
      type: "custom_message",
      parentId: null,
      timestamp: "2026-05-04T10:17:00.000Z",
      content: "Custom string payload",
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("Custom string payload");
  });

  it("previews custom_message entries with text block array content", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "h8i9j0k1",
      type: "custom_message",
      parentId: null,
      timestamp: "2026-05-04T10:18:00.000Z",
      content: [
        { type: "text", text: "Custom block payload" },
        { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
      ],
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toBe("Custom block payload");
  });

  it("truncates long text previews to 120 characters", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "e5f6g7h8",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:20:00.000Z",
      message: { role: "user", content: "a".repeat(200) },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const entries = (result.details as { entries: unknown[] }).entries;
    expect((entries[0] as { preview: string }).preview).toHaveLength(120);
  });

  it("serialises entries to JSON in content[0].text", async () => {
    const { pi, getTool } = createFakePi();
    session(pi);
    const branch = [{
      id: "a1b2c3d4",
      type: "message",
      parentId: null,
      timestamp: "2026-05-04T10:00:00.000Z",
      message: { role: "user", content: "Hi" },
    }];
    const result = await getTool("session_entries")!.execute("c1", {}, undefined, undefined, makeCtx(branch));
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("a1b2c3d4");
  });
});
