import { execSync } from "node:child_process";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RPCClient } from "./rpc-client";
import { ProgressAccumulator } from "./progress";
import { ProgressLogWriter } from "./visibility";
import { WorkerManager } from "./worker-manager";
import type { DelegateStartParams } from "./types";

function resolveGitRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return cwd;
  }
}

function todayDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

const DELEGATE_TOOLS = ["delegate_start", "delegate_check", "delegate_steer", "delegate_abort", "delegate_result"];

export default function delegate(pi: ExtensionAPI) {
  const initialCwd = process.cwd();
  const projectRoot = resolveGitRoot(initialCwd);

  // Session ID is resolved from ctx.sessionManager inside event handlers.
  // Cached here and updated on each session_start event.
  let sessionId = `run-${Date.now().toString(36)}`;

  pi.on("session_start", async (_event, ctx) => {
    try {
      const id = ctx.sessionManager.getSessionId?.();
      if (id) sessionId = id;
    } catch {
      // keep fallback run-id
    }
  });

  const manager = new WorkerManager({
    maxWorkers: 2,
    projectRoot,
    maxWorkersEnv: process.env.DELEGATE_MAX_WORKERS,
  });

  pi.registerTool({
    name: "delegate_start",
    label: "Delegate Start",
    description: "Spawn a worker agent as an isolated Pi RPC subprocess to execute a task.",
    promptSnippet: "Spawn a worker agent to execute a task in an isolated subprocess.",
    promptGuidelines: [
      "Use delegate_start to offload tasks to a worker agent (code review, implementation, research).",
      "The worker runs as a separate Pi process with its own context window.",
      "Check progress with delegate_check, steer with delegate_steer, abort with delegate_abort, read result with delegate_result.",
      "Maximum 2 concurrent workers by default.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Prompt/instructions for the worker" }),
      model: Type.String({ description: 'Model ID, e.g. "claude-sonnet-4-6"' }),
      provider: Type.String({ description: 'Provider ID, e.g. "anthropic", "github-copilot"' }),
      thinking: Type.Optional(
        StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, {
          description: "Thinking level for the worker",
        }),
      ),
      tools: Type.Optional(
        Type.Array(Type.String(), { description: "Tool allowlist — only these tools enabled. Mutually exclusive with denied_tools." }),
      ),
      denied_tools: Type.Optional(
        Type.Array(Type.String(), { description: "Tool deny list — all tools except these. Mutually exclusive with tools. delegate_* tools are always denied." }),
      ),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (default 1800)", default: 1800 }),
      ),
      system_prompt: Type.Optional(
        Type.String({ description: "Additional system prompt appended to worker" }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the worker (default: project root)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.tools && params.denied_tools) {
        return {
          content: [{ type: "text" as const, text: "Cannot specify both 'tools' (allowlist) and 'denied_tools' (denylist). Pick one." }],
          details: { error: "invalid_params" },
          isError: true,
        };
      }

      if (!manager.canStart()) {
        const active = manager.activeWorkerDescriptions();
        const desc = active.map((w) => `  ${w.taskId}: ${w.task.slice(0, 80)}`).join("\n");
        return {
          content: [{ type: "text" as const, text: `Cannot start: ${active.length} workers already running.\n\nActive workers:\n${desc}\n\nAbort one with delegate_abort before starting a new task.` }],
          details: { error: "concurrency_limit" },
          isError: true,
        };
      }

      const taskId = manager.nextTaskId();
      const workerCwd = params.cwd ?? projectRoot;
      const timeout = params.timeout ?? 1800;

      // Resolve tool allowlist: always exclude delegate_* tools to prevent recursive delegation.
      let toolsAllowlist: string[] | undefined = params.tools;
      if (toolsAllowlist) {
        toolsAllowlist = toolsAllowlist.filter((t) => !DELEGATE_TOOLS.includes(t));
      }

      // For denied_tools mode, we need the full list of available tool names.
      const allToolNames = pi.getAllTools().map((t) => t.name);
      const deniedTools = params.denied_tools
        ? [...new Set([...params.denied_tools, ...DELEGATE_TOOLS])]
        : DELEGATE_TOOLS;

      const entry = manager.register(taskId, params as DelegateStartParams);

      const progress = new ProgressAccumulator();
      entry.progress = progress;

      const logWriter = new ProgressLogWriter(projectRoot, todayDate(), sessionId, taskId);
      entry.logWriter = logWriter;

      let logWriterFailed = false;
      const tryAppendText = (text: string) => {
        if (logWriterFailed) return;
        try {
          logWriter.appendText(text);
        } catch {
          logWriterFailed = true;
        }
      };
      const tryAppendToolCall = (toolName: string, args: string) => {
        if (logWriterFailed) return;
        try {
          logWriter.appendToolCall(toolName, args);
        } catch {
          logWriterFailed = true;
        }
      };
      const tryCloseLogWriter = () => {
        try {
          logWriter.close();
        } catch {
          // ignore close errors
        }
      };

      const rpcClient = new RPCClient(
        {
          model: params.model,
          provider: params.provider,
          thinking: params.thinking,
          tools: toolsAllowlist,
          deniedTools: toolsAllowlist ? undefined : deniedTools,
          allToolNames: toolsAllowlist ? undefined : allToolNames,
          systemPrompt: params.system_prompt,
          cwd: workerCwd,
        },
        {
          onEvent(event) {
            progress.handleEvent(event);

            if (event.type === "message_update") {
              const ame = event.assistantMessageEvent as { type: string; delta?: string } | undefined;
              if (ame?.type === "text_delta" && ame.delta) {
                tryAppendText(ame.delta);
              }
            } else if (event.type === "tool_execution_start") {
              const args = JSON.stringify(event.args ?? {}).slice(0, 80);
              tryAppendToolCall(event.toolName as string, args);
            }

            if (event.type === "agent_end") {
              manager.setStatus(taskId, "completed");
              rpcClient.closeStdin();
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onExit(code, _signal) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", `Process exited unexpectedly (code ${code})`);
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onError(err) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", err);
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
        },
      );

      entry.rpcClient = rpcClient;

      try {
        rpcClient.start();
        rpcClient.send({ type: "prompt", message: params.task });
      } catch (err) {
        manager.setStatus(taskId, "failed", err instanceof Error ? err.message : String(err));
        tryCloseLogWriter();
        return {
          content: [{ type: "text" as const, text: `Failed to start worker ${taskId}.` }],
          details: { error: "start_failed" },
          isError: true,
        };
      }

      entry.timeoutTimer = setTimeout(async () => {
        const current = manager.get(taskId);
        if (current && current.status === "running") {
          manager.setStatus(taskId, "aborted", `Timed out after ${timeout}s`);
          await rpcClient.kill();
          tryCloseLogWriter();
        }
      }, timeout * 1000);

      return {
        content: [{ type: "text" as const, text: `Worker ${taskId} started. Use delegate_check("${taskId}") to monitor progress.` }],
        details: { task_id: taskId, status: "running" },
      };
    },
  });

  // Remaining tools (delegate_check, delegate_steer, delegate_abort, delegate_result)
  // are registered in subsequent tasks.
}
