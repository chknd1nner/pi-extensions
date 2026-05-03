import { describe, expect, it } from "vitest";
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
