import type { RPCEvent, ToolCallRecord, WorkerUsage } from "./types";

type TextContent = { type?: unknown; text?: unknown };

function truncateArgs(args: unknown): string {
  const str = JSON.stringify(args);
  if (str.length <= 80) return str;
  return str.slice(0, 77) + "...";
}

function extractTextFromToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      const block = item as TextContent;
      if (block?.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

function mergeToolOutput(previous: string | undefined, incoming: string): string {
  if (!incoming) return previous ?? "";
  if (!previous) return incoming;

  if (incoming.startsWith(previous)) return incoming;
  if (previous.startsWith(incoming)) return previous;
  return previous + incoming;
}

export class ProgressAccumulator {
  private transcript = "";
  private toolCalls: ToolCallRecord[] = [];
  private pendingTools = new Map<string, ToolCallRecord>();
  private lastActivityAt = Date.now();
  private cumulativeInput = 0;
  private cumulativeOutput = 0;
  private cumulativeCacheRead = 0;
  private cumulativeCacheWrite = 0;
  private lastAssistantInput: number | null = null;
  private finished = false;
  private finalMessages: unknown[] = [];

  handleEvent(event: RPCEvent): void {
    if (event.type !== "agent_end") {
      this.lastActivityAt = Date.now();
    }

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent as { type: string; delta?: string } | undefined;
        if (ame?.type === "text_delta" && ame.delta) {
          this.transcript += ame.delta;
        }
        break;
      }
      case "tool_execution_start": {
        const record: ToolCallRecord = {
          name: event.toolName as string,
          args: truncateArgs(event.args),
          startedAt: Date.now(),
        };
        this.pendingTools.set(event.toolCallId as string, record);
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string;
        const pending = this.pendingTools.get(id);
        if (pending) {
          const partialResult = (event.partialResult as { content?: unknown } | undefined)
            ?.content;
          const partialText = extractTextFromToolContent(partialResult);
          pending.result = mergeToolOutput(pending.result, partialText);
        }
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        const pending = this.pendingTools.get(id);
        if (pending) {
          const finalResult = (event.result as { content?: unknown } | undefined)?.content;
          const finalText = extractTextFromToolContent(finalResult);
          pending.result = mergeToolOutput(pending.result, finalText);
          pending.endedAt = Date.now();
          this.toolCalls.push(pending);
          this.pendingTools.delete(id);
        }
        break;
      }
      case "turn_end": {
        const message = (event.message as {
          role?: string;
          usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
        } | undefined);
        if (message?.role === "assistant" && message.usage) {
          const u = message.usage;
          const input = u.input ?? 0;
          const output = u.output ?? 0;
          this.cumulativeInput += input;
          this.cumulativeOutput += output;
          this.cumulativeCacheRead += u.cacheRead ?? 0;
          this.cumulativeCacheWrite += u.cacheWrite ?? 0;
          this.lastAssistantInput = input;
        }
        break;
      }
      case "agent_end": {
        this.finished = true;
        this.finalMessages = (event.messages as unknown[]) ?? [];
        break;
      }
    }
  }

  getSummary(): {
    tool_calls: number;
    last_activity_seconds_ago: number;
    recent_activity: string[];
    transcript: string;
  } {
    const recentCount = 5;
    const recent = this.toolCalls.slice(-recentCount).map(
      (tc) => `${tc.name}: ${tc.args}`,
    );

    return {
      tool_calls: this.toolCalls.length,
      last_activity_seconds_ago: Math.round((Date.now() - this.lastActivityAt) / 1000),
      recent_activity: recent,
      transcript: this.transcript,
    };
  }

  getFullTranscript(): string {
    return this.transcript;
  }

  getUsage(): WorkerUsage {
    return {
      input: this.cumulativeInput,
      output: this.cumulativeOutput,
      cacheRead: this.cumulativeCacheRead,
      cacheWrite: this.cumulativeCacheWrite,
      lastAssistantInput: this.lastAssistantInput,
    };
  }

  getFinalMessages(): unknown[] {
    return this.finalMessages;
  }

  isFinished(): boolean {
    return this.finished;
  }
}
