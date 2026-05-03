import type { RPCEvent, ToolCallRecord } from "./types";

function truncateArgs(args: unknown): string {
  const str = JSON.stringify(args);
  if (str.length <= 80) return str;
  return str.slice(0, 77) + "...";
}

export class ProgressAccumulator {
  private transcript = "";
  private toolCalls: ToolCallRecord[] = [];
  private pendingTools = new Map<string, ToolCallRecord>();
  private lastActivityAt = Date.now();
  private finished = false;
  private finalMessages: unknown[] = [];

  handleEvent(event: RPCEvent): void {
    this.lastActivityAt = Date.now();

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
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        const pending = this.pendingTools.get(id);
        if (pending) {
          pending.endedAt = Date.now();
          this.toolCalls.push(pending);
          this.pendingTools.delete(id);
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

  getFinalMessages(): unknown[] {
    return this.finalMessages;
  }

  isFinished(): boolean {
    return this.finished;
  }
}
