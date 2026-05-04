---
task_number: 6
title: Wire Up `delegate_start` Tool
status: done
plan_path: docs/superpowers/plans/2026-04-26-delegate-extension.md
spec_path: docs/superpowers/specs/2026-04-26-delegate-extension-design.md
next_prompt: |-
  Read the Plan excerpt section below and execute each step in order.
  Check off steps as you complete them (- [x]).
  Run verification commands and confirm they pass.
  Commit when all steps are complete.

  Hint: the visibility calls are caller-side responsibilities here. Format tool args before appendToolCall (JSON.stringify + truncate to ~80 chars), append only text deltas to appendText, and make sure log-writer failures don't take down delegate_start startup. Close the writer on every terminal path.
review_prompt_template: |-
  Review Task 6: Wire Up `delegate_start` Tool

  Perform a TWO-STAGE REVIEW:

  ## Stage 1: Spec Review
  Compare implementation against the design spec.
  - Read the spec_path document (if provided)
  - Check: Does implementation match spec intent?
  - Check: Any divergences from spec requirements?
  - Check: Missing spec requirements?

  If MAJOR spec issues found, you may terminate review early.
  If minor spec divergences, note them and continue to Stage 2.

  ## Stage 2: Code Review
  Use the superpowers:requesting-code-review skill approach.
  - Get git diff for this task's changes
  - Check code quality, architecture, testing
  - Categorize issues: Critical / Important / Minor

  ## Review Output

  ### Spec Compliance
  [Matches spec / Minor divergences / Major divergences]
  [List any divergences with spec section references]

  ### Code Quality
  [Strengths and issues per code-reviewer format]

  ### Verdict
  If task passes BOTH stages:
  - Move ticket to done status (ticket_move task-06 done)
  - Add approval_note field with verification evidence

  If task needs changes:
  - Move ticket to needs-fix status (ticket_move task-06 needs-fix)
  - Update next_prompt with specific fix instructions
  - Record findings in ## Notes section
approval_note: |-
  |-
    PASS (two-stage review).

    Spec: matches design spec for delegate_start. One minor divergence: `visibility` parameter not exposed in schema (only "log" supported in v1; tmux deferred per spec). Non-blocking.

    Code: log-writer failures isolated via try/catch wrappers (tryAppendText/tryAppendToolCall/tryCloseLogWriter); spawn wrapped in try/catch; tool args JSON-stringified + truncated to 80 chars before appendToolCall; only text_delta values reach appendText; log writer closed on every terminal path (agent_end, onExit, onError, spawn-failure, timeout); terminal-state guards prevent double transitions; DELEGATE_TOOLS denylist deduped via Set; session ID read defensively with run-<base36> fallback.

    Verification:
    - `cd extensions/delegate && npx tsc --noEmit` → exit 0
    - `npx vitest run` → 5 files, 31 tests passed (incl. tests/index.delegate-start.test.ts 2/2)
    - smoke: `pi -e extensions/delegate/index.ts --print "List ... delegate ..."` → output: `delegate_start`
    - commit on feature/delegate-extension-impl: 296b950

    Deferred minor items (not blocking this ticket):
    - MIN-2: no session_shutdown handler wires manager.disposeAll(); likely covered by Task 10/11.
    - MIN-3: types.ts DelegateStartParams.visibility is unused; either drop or wire to schema later.
---

# Task 06 — Wire Up `delegate_start` Tool

## Plan excerpt

**Files:**
- Modify: `extensions/delegate/index.ts`

- [x] **Step 1: Implement `delegate_start` tool registration in `index.ts`**

Replace the stub `index.ts` with:

```typescript
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
    } catch {}
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
        Type.Array(Type.String(), { description: 'Tool allowlist — only these tools enabled. Mutually exclusive with denied_tools.' }),
      ),
      denied_tools: Type.Optional(
        Type.Array(Type.String(), { description: 'Tool deny list — all tools except these. Mutually exclusive with tools. delegate_* tools are always denied.' }),
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
                logWriter.appendText(ame.delta);
              }
            } else if (event.type === "tool_execution_start") {
              const args = JSON.stringify(event.args ?? {}).slice(0, 80);
              logWriter.appendToolCall(event.toolName as string, args);
            }

            if (event.type === "agent_end") {
              manager.setStatus(taskId, "completed");
              rpcClient.closeStdin();
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onExit(code, _signal) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", `Process exited unexpectedly (code ${code})`);
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
          onError(err) {
            const current = manager.get(taskId);
            if (current && current.status === "running") {
              manager.setStatus(taskId, "failed", err);
              logWriter.close();
              if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
            }
          },
        },
      );

      entry.rpcClient = rpcClient;
      rpcClient.start();
      rpcClient.send({ type: "prompt", message: params.task });

      entry.timeoutTimer = setTimeout(async () => {
        const current = manager.get(taskId);
        if (current && current.status === "running") {
          manager.setStatus(taskId, "aborted", `Timed out after ${timeout}s`);
          await rpcClient.kill();
          logWriter.close();
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
```

- [x] **Step 2: Run typecheck**

Run: `cd extensions/delegate && npx tsc --noEmit`
Expected: No errors

- [x] **Step 3: Smoke test with Pi**

Run: `pi -e extensions/delegate/index.ts --print "What tools do you have that start with delegate?"`
Expected: Pi lists `delegate_start` in its response.

- [x] **Step 4: Commit**

```bash
git add extensions/delegate/index.ts
git commit -m "feat(delegate): wire up delegate_start tool with full worker lifecycle"
```

---


---

## Notes

- TDD red: `npx vitest run tests/index.delegate-start.test.ts` (failed as expected before implementation: `delegate_start` not registered).
- TDD green: `npx vitest run tests/index.delegate-start.test.ts` (2 passed).
- Ticket verification: `cd extensions/delegate && npx tsc --noEmit` (pass, no output).
- Ticket smoke test: `pi -e extensions/delegate/index.ts --print "What tools do you have that start with delegate?"` (lists `delegate_start`).
- Additional safety check: `cd extensions/delegate && npm test` (31 passed).
