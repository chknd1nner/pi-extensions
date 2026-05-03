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
        throw new Error(
          "Cannot specify both 'tools' (allowlist) and 'denied_tools' (denylist). Pick one.",
        );
      }

      if (!manager.canStart()) {
        const active = manager.activeWorkerDescriptions();
        const desc = active.map((w) => `  ${w.taskId}: ${w.task.slice(0, 80)}`).join("\n");
        throw new Error(
          `Cannot start: ${active.length} workers already running.\n\nActive workers:\n${desc}\n\nAbort one with delegate_abort before starting a new task.`,
        );
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
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to start worker ${taskId}: ${message}`);
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

  pi.registerTool({
    name: "delegate_check",
    label: "Delegate Check",
    description: "Query the progress of a running or completed worker.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
      detail: Type.Optional(
        StringEnum(["summary", "full"] as const, { description: "Level of detail (default: summary)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      const progressSummary = entry.progress!.getSummary();
      const usage = entry.progress!.getUsage();
      const elapsed = Math.round((Date.now() - entry.startedAt) / 1000);

      let contextPercent: number | null = null;
      if (usage.lastAssistantInput !== null) {
        const model = ctx.modelRegistry?.find(entry.params.provider, entry.params.model);
        const window = model?.contextWindow;
        if (typeof window === "number" && window > 0) {
          contextPercent = Math.round((100 * usage.lastAssistantInput) / window);
        }
      }

      const summary: Record<string, unknown> = {
        status: entry.status,
        elapsed_seconds: elapsed,
        tool_calls: progressSummary.tool_calls,
        last_activity_seconds_ago: progressSummary.last_activity_seconds_ago,
        recent_activity: progressSummary.recent_activity,
        input_tokens: usage.input,
        output_tokens: usage.output,
        context_usage_percent: contextPercent,
      };

      if (entry.error) {
        summary.error = entry.error;
      }

      let text = Object.entries(summary)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${k}:\n${v.map((item) => `  - ${item}`).join("\n")}`;
          return `${k}: ${v}`;
        })
        .join("\n");

      if (params.detail === "full") {
        text += `\n\ntranscript:\n${progressSummary.transcript}`;
      }

      return {
        content: [{ type: "text" as const, text }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "delegate_steer",
    label: "Delegate Steer",
    description: "Send a steering message to a running worker. Delivered between turns.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
      message: Type.String({ description: "Steering instruction" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status !== "running") {
        throw new Error(
          `Cannot steer ${params.task_id}: worker is ${entry.status}, not running.`,
        );
      }

      if (!entry.rpcClient?.isAlive()) {
        throw new Error(
          `Cannot steer ${params.task_id}: worker process is not alive.`,
        );
      }

      // steer requires active streaming. During compaction the RPC layer may reject it.
      const resp = await entry.rpcClient.sendAndWait({ type: "steer", message: params.message });
      const respObj = resp as { success?: boolean; error?: string } | null | undefined;
      if (respObj && respObj.success === false) {
        const reason = respObj.error ?? "worker not actively streaming (possibly mid-compaction)";
        throw new Error(
          `Steer rejected by ${params.task_id}: ${reason}. Retry shortly.`,
        );
      }

      return {
        content: [{ type: "text" as const, text: `Steering message sent to ${params.task_id}.` }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "delegate_abort",
    label: "Delegate Abort",
    description: "Terminate a running worker. Sends RPC abort for clean shutdown, falls back to SIGTERM/SIGKILL.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status !== "running") {
        // Already terminal — not an error, just a no-op the orchestrator can branch on.
        return {
          content: [{ type: "text" as const, text: `Worker ${params.task_id} is already ${entry.status}.` }],
          details: { success: false },
        };
      }

      manager.setStatus(params.task_id, "aborted", "Aborted by orchestrator");
      if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);

      if (entry.rpcClient) {
        await entry.rpcClient.kill();
      }
      entry.logWriter?.close();

      return {
        content: [{ type: "text" as const, text: `Worker ${params.task_id} aborted.` }],
        details: { success: true },
      };
    },
  });

  // Remaining tool (delegate_result) is registered in a subsequent task.
}
