import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RPCClient } from "./rpc-client";
import { ProgressAccumulator } from "./progress";
import { buildPackFile, PACK_NAME_PATTERN, parsePackFile, resolvePackPath } from "./pack";
import type { PackItem } from "./pack";
import { buildSessionSnapshot } from "./snapshot";
import { ProgressLogWriter, StatusFileWriter } from "./visibility";
import { WorkerManager } from "./worker-manager";
import type { DelegateStartParams, WorkerStatus } from "./types";

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

function relativeToProject(projectRoot: string, artifactPath: string): string {
  try {
    const relative = path.relative(projectRoot, artifactPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return artifactPath;
    }
    return relative.split(path.sep).join("/");
  } catch {
    return artifactPath;
  }
}

function shellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

type DelegateWatchRecipe = {
  command: string;
  timeout_seconds: number;
  poll_seconds: number;
  sentinel_pattern: string;
  preferred_mode: "async_background_if_available";
  fallback_mode: "blocking_shell";
  authoritative_followup: "delegate_check";
};

function buildDelegateWatchRecipe(
  statusFile: string,
  taskId: string,
  timeoutSeconds: number,
  pollSeconds = 5,
): DelegateWatchRecipe {
  const normalizedTimeout = Math.max(1, Math.floor(timeoutSeconds));
  const normalizedPoll = Math.max(1, Math.floor(pollSeconds));
  const script = [
    `status_file=${shellSingleQuote(statusFile)}`,
    `task_id=${shellSingleQuote(taskId)}`,
    `timeout_seconds=${normalizedTimeout}`,
    `poll_seconds=${normalizedPoll}`,
    `last_status="unknown"`,
    `start_seconds=$SECONDS`,
    `while true; do`,
    `  if [[ -f "$status_file" ]]; then`,
    `    status=""`,
    `    if read -r status < "$status_file"; then`,
    `      case "$status" in`,
    `        completed|failed|aborted)`,
    `          echo "DELEGATE_WATCH_DONE task_id=$task_id status=$status"`,
    `          exit 0`,
    `          ;;`,
    `        running)`,
    `          last_status="$status"`,
    `          ;;`,
    `        *)`,
    `          if [[ -n "$status" ]]; then last_status="$status"; fi`,
    `          ;;`,
    `      esac`,
    `    fi`,
    `  fi`,
    ``,
    `  elapsed=$((SECONDS - start_seconds))`,
    `  if (( elapsed >= timeout_seconds )); then`,
    `    echo "DELEGATE_WATCH_TIMEOUT task_id=$task_id last=$last_status"`,
    `    exit 124`,
    `  fi`,
    ``,
    `  sleep "$poll_seconds"`,
    `done`,
  ].join("\n");

  return {
    command: `bash -lc ${shellSingleQuote(script)}`,
    timeout_seconds: normalizedTimeout,
    poll_seconds: normalizedPoll,
    sentinel_pattern: "DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT",
    preferred_mode: "async_background_if_available",
    fallback_mode: "blocking_shell",
    authoritative_followup: "delegate_check",
  };
}

function formatDelegateStartMessage(
  taskId: string,
  progressFileRelative: string,
  statusFileRelative: string,
): string {
  return [
    `Worker ${taskId} started.`,
    ``,
    `Artifacts:`,
    `- progress: ${progressFileRelative}`,
    `- status: ${statusFileRelative}`,
    ``,
    `Recommended wait pattern:`,
    `- If an async/background command runner is available, run details.watch.command there and watch for: DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT.`,
    `- If no async/background runner is available, run the same command in a shell; it will block, but avoids frequent delegate_check polling.`,
    `- After any sentinel or timeout, call delegate_check("${taskId}") once; delegate_check is authoritative.`,
  ].join("\n");
}

function statusFromAgentEndMessages(messages: unknown[] | undefined): WorkerStatus {
  if (!Array.isArray(messages)) return "completed";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; stopReason?: string };
    if (message.role !== "assistant") continue;
    if (message.stopReason === "aborted") return "aborted";
    if (message.stopReason === "error") return "failed";
    return "completed";
  }

  return "completed";
}

const DELEGATE_TOOLS = ["delegate_start", "delegate_check", "delegate_steer", "delegate_abort", "delegate_result", "delegate_anchor"];

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
  const anchorMap = new Map<string, string | null>();

  pi.registerTool({
    name: "delegate_start",
    label: "Delegate Start",
    description: "Spawn a worker agent as an isolated Pi RPC subprocess to execute a task.",
    promptSnippet: "Spawn a worker agent to execute a task in an isolated subprocess and return artifact paths plus a status-file wait recipe.",
    promptGuidelines: [
      "Use delegate_start to offload tasks to a worker agent (code review, implementation, research).",
      "The worker runs as a separate Pi process with its own context window.",
      "delegate_start returns progress/status artifact paths and a self-contained status-file wait command in details.watch.command.",
      "Prefer running details.watch.command with an async/background command runner when one is available; otherwise run it in a blocking shell rather than polling frequently.",
      "After the wait command emits DELEGATE_WATCH_DONE or DELEGATE_WATCH_TIMEOUT, call delegate_check once for authoritative state, then delegate_result when terminal.",
      "Avoid tight polling loops around delegate_check; if polling is unavoidable, use a slow cadence.",
      "Use delegate_steer to send instructions to a running worker and delegate_abort to stop one.",
      "Use delegate_pack + context_pack to give many workers an identical frozen file-based prefix (spec/plan); context_pack composes with inherit_context (anchor first, pack appended).",
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
      visibility: Type.Optional(
        StringEnum(["log"] as const, { description: 'Visibility mode (currently only "log")' }),
      ),
      system_prompt: Type.Optional(
        Type.String({ description: "Additional system prompt appended to worker" }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the worker (default: project root)" }),
      ),
      inherit_context: Type.Optional(
        Type.Union([Type.Boolean(), Type.String({ minLength: 1 })], {
          description:
            'false/absent = ephemeral (--no-session). true = inherit current session context. "name" = inherit from named anchor set by delegate_anchor.',
        }),
      ),
      context_pack: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            'Context pack created by delegate_pack: a name (resolved newest-date-first under .pi/delegate/*/packs/) or an explicit path (contains "/" or ends with .jsonl). Appended to the worker session after any inherit_context content.',
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

      const artifactDate = todayDate();
      const logWriter = new ProgressLogWriter(projectRoot, artifactDate, sessionId, taskId);
      entry.logWriter = logWriter;

      const statusWriter = new StatusFileWriter(projectRoot, artifactDate, sessionId, taskId);
      entry.statusWriter = statusWriter;

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

      const tryCleanupTempFile = () => {
        if (!entry.tempFilePath) return;
        try {
          rmSync(entry.tempFilePath, { force: true });
        } catch {
          // ignore
        }
      };

      const transitionWorker = (status: WorkerStatus, error?: string): boolean => {
        const applied = manager.setStatus(taskId, status, error);
        if (applied) {
          statusWriter.writeStatus(status);
        }
        return applied;
      };

      let sessionPath: string | undefined;
      let resolvedPackPath: string | undefined;

      const usesAnchor = params.inherit_context === true || typeof params.inherit_context === "string";
      const usesPack = typeof params.context_pack === "string" && params.context_pack.length > 0;

      if (usesAnchor || usesPack) {
        let tmpPath: string | undefined;

        try {
          let snapshotManager: {
            getLeafId(): string | null;
            getBranch(fromId?: string): object[];
          } | null = null;
          let anchorEntryId: string | null = null;

          if (usesAnchor) {
            const sessionManager = (
              ctx as {
                sessionManager: {
                  getLeafId(): string | null;
                  getBranch(fromId?: string): object[];
                };
              }
            ).sessionManager;

            if (params.inherit_context === true) {
              anchorEntryId = sessionManager.getLeafId();
            } else {
              const anchorName = params.inherit_context as string;
              if (!anchorMap.has(anchorName)) {
                throw new Error(
                  `No anchor named '${anchorName}'. Call delegate_anchor({ name: '${anchorName}' }) first.`,
                );
              }
              anchorEntryId = anchorMap.get(anchorName)!;
            }
            snapshotManager = sessionManager;
          }

          let packEntries: object[] = [];
          if (usesPack) {
            resolvedPackPath = resolvePackPath(projectRoot, params.context_pack as string, initialCwd);
            const parsed = parsePackFile(readFileSync(resolvedPackPath, "utf8"));
            packEntries = parsed.entries;
          }

          tmpPath = `${tmpdir()}/pi-worker-${taskId}-${Date.now()}.jsonl`;
          const snapshot = buildSessionSnapshot(snapshotManager, workerCwd, anchorEntryId, packEntries);
          writeFileSync(tmpPath, snapshot, "utf8");
          entry.tempFilePath = tmpPath;
          sessionPath = tmpPath;
        } catch (err) {
          if (tmpPath) {
            try {
              rmSync(tmpPath, { force: true });
            } catch {
              // ignore
            }
          }
          const msg = err instanceof Error ? err.message : String(err);
          transitionWorker("failed", msg);
          tryCloseLogWriter();
          throw new Error(msg);
        }
      }

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
          sessionPath,
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
              const nextStatus = statusFromAgentEndMessages((event as { messages?: unknown[] }).messages);
              transitionWorker(nextStatus);
              rpcClient.closeStdin();
              tryCloseLogWriter();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onExit(code, _signal) {
            tryCleanupTempFile();
            transitionWorker("failed", `Process exited unexpectedly (code ${code})`);
            tryCloseLogWriter();
            if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
          },
          onError(err) {
            tryCleanupTempFile();
            transitionWorker("failed", err);
            tryCloseLogWriter();
            if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
          },
        },
      );

      entry.rpcClient = rpcClient;

      try {
        statusWriter.writeStatus("running");
        rpcClient.start();
        rpcClient.send({ type: "prompt", message: params.task });
      } catch (err) {
        tryCleanupTempFile();
        const message = err instanceof Error ? err.message : String(err);
        transitionWorker("failed", message);
        tryCloseLogWriter();
        throw new Error(`Failed to start worker ${taskId}: ${message}`);
      }

      entry.timeoutTimer = setTimeout(async () => {
        const applied = transitionWorker("aborted", `Timed out after ${timeout}s`);
        if (applied) {
          await rpcClient.kill();
        }
        tryCloseLogWriter();
      }, timeout * 1000);

      const progressFile = logWriter.getFilePath();
      const statusFile = statusWriter.getFilePath();
      const progressFileRelative = relativeToProject(projectRoot, progressFile);
      const statusFileRelative = relativeToProject(projectRoot, statusFile);
      const watch = buildDelegateWatchRecipe(statusFile, taskId, timeout);

      return {
        content: [
          {
            type: "text" as const,
            text: formatDelegateStartMessage(taskId, progressFileRelative, statusFileRelative),
          },
        ],
        details: {
          task_id: taskId,
          status: "running",
          progress_file: progressFile,
          status_file: statusFile,
          progress_file_relative: progressFileRelative,
          status_file_relative: statusFileRelative,
          ...(resolvedPackPath ? { context_pack_path: resolvedPackPath } : {}),
          watch,
        },
      };
    },
  });

  pi.registerTool({
    name: "delegate_anchor",
    label: "Delegate Anchor",
    description: "Save a named session anchor for later context inheritance.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: 'Anchor name (default: "default")' })),
      entry_id: Type.Optional(Type.String({ description: "Optional entry ID on the current branch" })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const name = params.name ?? "default";
      const sessionManager = ctx.sessionManager as {
        getLeafId(): string | null;
        getBranch(entryId?: string): Array<{ id: string }>;
      };

      let entryId: string | null;
      if (params.entry_id !== undefined) {
        const currentBranch = sessionManager.getBranch();
        const inCurrentBranch = currentBranch.some((entry) => entry.id === params.entry_id);
        if (!inCurrentBranch) {
          throw new Error(`Entry '${params.entry_id}' not found on current branch`);
        }
        entryId = params.entry_id;
      } else {
        entryId = sessionManager.getLeafId();
      }

      anchorMap.set(name, entryId);

      const entryCount = entryId === null ? 0 : sessionManager.getBranch(entryId).length;

      return {
        content: [
          {
            type: "text" as const,
            text: `Anchor '${name}' saved (${entryCount} entries).`,
          },
        ],
        details: { name, entryId, entryCount },
      };
    },
  });

  pi.registerTool({
    name: "delegate_pack",
    label: "Delegate Pack",
    description:
      "Compile an ordered list of files (plus optional note) into a frozen, named context pack that delegate_start workers can share as a cached prefix.",
    promptSnippet:
      "Use to convert files like spec and plan into a frozen context pack reusable across many delegate_start workers.",
    promptGuidelines: [
      "Use delegate_pack to freeze spec/plan files into a named context pack before dispatching workers.",
      "Packs are immutable; pass overwrite: true only when you intend to start a new cache prefix generation.",
      "Consume packs via delegate_start({ context_pack: \"<name>\" }).",
    ],
    parameters: Type.Object({
      name: Type.String({
        description: "Pack name: lowercase letters, digits, '-', '_' (must start alphanumeric)",
      }),
      files: Type.Array(Type.String(), {
        description: "Ordered file paths to embed, resolved against the orchestrator cwd",
      }),
      note: Type.Optional(
        Type.String({ description: "Optional freeform note appended after the files" }),
      ),
      overwrite: Type.Optional(
        Type.Boolean({ description: "Replace an existing same-name pack from today (default false)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!PACK_NAME_PATTERN.test(params.name)) {
        throw new Error(
          `Invalid pack name '${params.name}'. Use lowercase letters, digits, '-', '_' (must start alphanumeric).`,
        );
      }
      if (params.files.length === 0 && !params.note) {
        throw new Error("Pack needs at least one file or a note.");
      }

      const items: PackItem[] = [];
      for (const file of params.files) {
        const resolved = path.resolve(initialCwd, file);
        let content: string;
        try {
          content = readFileSync(resolved, "utf8");
        } catch {
          throw new Error(`Cannot read pack source file: ${resolved}`);
        }
        if (content.trim().length === 0) {
          throw new Error(`Pack source file is empty: ${resolved}`);
        }
        items.push({ kind: "file", path: file, content });
      }
      if (params.note) {
        items.push({ kind: "note", content: params.note });
      }

      const packPath = path.join(
        projectRoot,
        ".pi",
        "delegate",
        todayDate(),
        "packs",
        `${params.name}.jsonl`,
      );
      if (existsSync(packPath) && !params.overwrite) {
        throw new Error(
          `Pack '${params.name}' already exists at ${packPath}. Pass overwrite: true to replace it (this starts a new cache prefix), or pick a new name.`,
        );
      }

      const content = buildPackFile(params.name, items);
      mkdirSync(path.dirname(packPath), { recursive: true });
      writeFileSync(packPath, content, "utf8");

      const bytes = Buffer.byteLength(content, "utf8");
      const tokenEstimate = Math.round(bytes / 4);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Pack '${params.name}' frozen (${items.length} items, ${bytes} bytes, ~${tokenEstimate} tokens).`,
              `Path: ${packPath}`,
              `Use with delegate_start({ context_pack: "${params.name}" }).`,
            ].join("\n"),
          },
        ],
        details: {
          name: params.name,
          path: packPath,
          items: items.length,
          bytes,
          token_estimate: tokenEstimate,
        },
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

      const applied = manager.setStatus(params.task_id, "aborted", "Aborted by orchestrator");
      if (!applied) {
        return {
          content: [{ type: "text" as const, text: `Worker ${params.task_id} is already ${entry.status}.` }],
          details: { success: false },
        };
      }

      entry.statusWriter?.writeStatus("aborted");
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

  pi.registerTool({
    name: "delegate_result",
    label: "Delegate Result",
    description: "Read the final output of a completed worker.",
    parameters: Type.Object({
      task_id: Type.String({ description: "Worker task ID" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const entry = manager.get(params.task_id);
      if (!entry) {
        throw new Error(`Unknown task ID: ${params.task_id}`);
      }

      if (entry.status === "running") {
        throw new Error(
          `Worker ${params.task_id} is still running. Use delegate_check to monitor progress, or delegate_abort to stop it.`,
        );
      }

      const transcript = entry.progress?.getFullTranscript() ?? "";
      const finalMessages = entry.progress?.getFinalMessages() ?? [];
      const usage = entry.progress?.getUsage?.() ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        lastAssistantInput: null,
      };

      // AssistantMessage.content is (TextContent | ThinkingContent | ToolCall)[], not a string.
      let resultText = "";
      for (const msg of finalMessages) {
        const m = msg as { role?: string; content?: unknown[] };
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const block of m.content) {
            if ((block as { type: string }).type === "text") {
              resultText += (block as { text: string }).text;
            }
          }
        }
      }

      if (!resultText) {
        resultText = transcript;
      }

      const result: Record<string, unknown> = {
        status: entry.status,
        result: resultText.trim(),
        usage: {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        },
      };

      if (entry.error) {
        result.error = entry.error;
        if (entry.rpcClient) {
          result.stderr = entry.rpcClient.getStderr().slice(-2000);
        }
      }

      return {
        content: [{ type: "text" as const, text: resultText.trim() || `Worker ${params.task_id} ${entry.status} with no output.${entry.error ? ` Error: ${entry.error}` : ""}` }],
        details: result,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    await manager.disposeAll();
  });
}
