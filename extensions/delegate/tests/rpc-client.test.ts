import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockStream extends EventEmitter {
  writable = true;
  write = vi.fn();
  end = vi.fn(() => {
    this.writable = false;
  });
}

class MockChild extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  stdin = new MockStream();
  kill = vi.fn();
}

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

import { parseJsonlBuffer, RPCClient } from "../rpc-client";

describe("parseJsonlBuffer", () => {
  it("extracts complete lines and returns remainder", () => {
    const { lines, remainder } = parseJsonlBuffer(
      '{"type":"agent_start"}\n{"type":"message_update"}\npartial'
    );
    expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"message_update"}']);
    expect(remainder).toBe("partial");
  });

  it("returns empty lines for buffer with no newline", () => {
    const { lines, remainder } = parseJsonlBuffer("no-newline-yet");
    expect(lines).toEqual([]);
    expect(remainder).toBe("no-newline-yet");
  });

  it("handles empty buffer", () => {
    const { lines, remainder } = parseJsonlBuffer("");
    expect(lines).toEqual([]);
    expect(remainder).toBe("");
  });

  it("handles trailing newline with no remainder", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"done"}\n');
    expect(lines).toEqual(['{"type":"done"}']);
    expect(remainder).toBe("");
  });

  it("splits only on LF, not Unicode line separators", () => {
    const unicodeLine = `{"text":"has \u2028 and \u2029 inside"}\n`;
    const { lines, remainder } = parseJsonlBuffer(unicodeLine);
    expect(lines).toEqual([`{"text":"has \u2028 and \u2029 inside"}`]);
    expect(remainder).toBe("");
  });

  it("strips trailing CR from CRLF lines", () => {
    const { lines, remainder } = parseJsonlBuffer('{"type":"ok"}\r\n');
    expect(lines).toEqual(['{"type":"ok"}']);
    expect(remainder).toBe("");
  });
});

describe("RPCClient.start ordering", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("emits onExit only after close, after buffered stdout events are delivered", () => {
    const child = new MockChild();
    spawnMock.mockReturnValue(child);
    const calls: string[] = [];

    const client = new RPCClient(
      { model: "test", provider: "test", cwd: "/tmp" },
      {
        onEvent: (event) => calls.push(`event:${String(event.type)}`),
        onExit: () => calls.push("exit"),
        onError: () => calls.push("error"),
      },
    );

    client.start();

    child.emit("exit", 0, null);
    expect(calls).toEqual([]);

    child.stdout.emit("data", Buffer.from('{"type":"agent_end","messages":[]}\n'));
    child.emit("close", 0, null);

    expect(calls).toEqual(["event:agent_end", "exit"]);
  });
});

describe("RPCClient.sendAndWait", () => {
  it("returns null on timeout when no response arrives", async () => {
    const client = new RPCClient(
      { model: "test", provider: "test", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    // Don't start — just test sendAndWait returns null when stdin isn't writable
    const result = await client.sendAndWait({ type: "get_session_stats" }, 100);
    expect(result).toBeNull();
  });
});

describe("RPCClient.buildArgs", () => {
  it("emits --no-session when sessionPath is not set", () => {
    const client = new RPCClient(
      { model: "claude-sonnet-4-5", provider: "anthropic", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args).toContain("--no-session");
    expect(args).not.toContain("--session");
  });

  it("emits --session <path> when sessionPath is set", () => {
    const client = new RPCClient(
      {
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        cwd: "/tmp",
        sessionPath: "/tmp/snap.jsonl",
      },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    const idx = args.indexOf("--session");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("/tmp/snap.jsonl");
    expect(args).not.toContain("--no-session");
  });

  it("always includes --model and --provider", () => {
    const client = new RPCClient(
      { model: "gpt-5.4", provider: "github-copilot", cwd: "/tmp" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.4");
    expect(args[args.indexOf("--provider") + 1]).toBe("github-copilot");
  });

  it("includes --thinking when set", () => {
    const client = new RPCClient(
      { model: "m", provider: "p", cwd: "/tmp", thinking: "high" },
      { onEvent: () => {}, onExit: () => {}, onError: () => {} },
    );
    const args = client.buildArgs();
    expect(args[args.indexOf("--thinking") + 1]).toBe("high");
  });
});
