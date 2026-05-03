import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProgressAccumulator } from "../progress";

describe("ProgressAccumulator", () => {
  let progress: ProgressAccumulator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    progress = new ProgressAccumulator();
  });

  it("starts with empty state", () => {
    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(0);
    expect(summary.recent_activity).toEqual([]);
    expect(summary.transcript).toBe("");
  });

  it("accumulates text deltas from message_update events", () => {
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    });
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    expect(progress.getFullTranscript()).toBe("Hello world");
  });

  it("ignores message_update events without text_delta", () => {
    progress.handleEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
    });
    expect(progress.getFullTranscript()).toBe("");
  });

  it("accumulates partial tool output from tool_execution_update events", () => {
    progress.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
    });

    progress.handleEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
      partialResult: { content: [{ type: "text", text: "file1" }] },
    });

    progress.handleEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
      partialResult: { content: [{ type: "text", text: ".ts" }] },
    });

    const pending = (progress as unknown as { pendingTools: Map<string, { result?: string }> }).pendingTools;
    expect(pending.get("t1")?.result).toBe("file1.ts");
  });

  it("captures final tool result text on tool_execution_end", () => {
    progress.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
    });

    progress.handleEvent({
      type: "tool_execution_update",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: "ls src/" },
      partialResult: { content: [{ type: "text", text: "file1" }] },
    });

    progress.handleEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [{ type: "text", text: "file1.ts" }] },
      isError: false,
    });

    const toolCalls = (progress as unknown as { toolCalls: Array<{ result?: string }> }).toolCalls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].result).toBe("file1.ts");

    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(1);
    expect(summary.recent_activity).toEqual(['bash: {"command":"ls src/"}']);
  });

  it("keeps only the last 5 tool calls in recent_activity", () => {
    for (let i = 0; i < 7; i++) {
      progress.handleEvent({
        type: "tool_execution_start",
        toolCallId: `t${i}`,
        toolName: "read",
        args: { filePath: `file${i}.ts` },
      });
      progress.handleEvent({
        type: "tool_execution_end",
        toolCallId: `t${i}`,
        result: { content: [{ type: "text", text: "content" }] },
        isError: false,
      });
    }

    const summary = progress.getSummary();
    expect(summary.tool_calls).toBe(7);
    expect(summary.recent_activity).toHaveLength(5);
    expect(summary.recent_activity[0]).toContain("file2.ts");
    expect(summary.recent_activity[4]).toContain("file6.ts");
  });

  it("truncates args to ~80 chars", () => {
    const longCommand = "a".repeat(200);
    progress.handleEvent({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "bash",
      args: { command: longCommand },
    });
    progress.handleEvent({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { content: [] },
      isError: false,
    });

    const activity = progress.getSummary().recent_activity[0];
    expect(activity.length).toBeLessThanOrEqual(90);
  });

  it("updates lastActivityAt on events", () => {
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    progress.handleEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } });

    vi.setSystemTime(new Date("2026-04-26T10:00:30Z"));
    const summary = progress.getSummary();
    expect(summary.last_activity_seconds_ago).toBe(30);
  });

  it("marks finished on agent_end", () => {
    progress.handleEvent({
      type: "agent_end",
      messages: [{ role: "assistant", content: "done" }],
    });
    expect(progress.isFinished()).toBe(true);
  });
});
