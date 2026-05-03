# Delegate Extension Design Spec

Pi extension that gives the orchestrator LLM the ability to spawn, supervise, steer, and abort worker agents running as isolated Pi RPC subprocesses.

## Motivation

The current Claude Code hook system (`intercept-review-agents.py` + `opencode-router.toml`) dispatches agent calls to OpenCode Server via a rigid TOML-configured routing table. The orchestrator has no runtime control — it polls a status file and waits. When a worker gets stuck, only the human can intervene.

This extension replaces that pattern with an LLM-supervised delegation system where:

- The orchestrator chooses model, provider, thinking level, and tools per task based on natural language guidance (AGENTS.md), not config files.
- The orchestrator actively monitors worker progress and can steer or abort.
- All error handling and retry decisions remain with the orchestrator LLM, shaped by the user's standing instructions.

## Architecture

### Extension Location

`extensions/delegate/` in the pi-extensions project.

### Module Structure

```
extensions/delegate/
├── index.ts              # Registers 5 tools, wires modules, resolves project root
├── rpc-client.ts         # Spawn pi --mode rpc, JSONL framing, send/receive
├── worker-manager.ts     # Track active workers, enforce concurrency cap
├── progress.ts           # Accumulate RPC events into queryable transcript
├── visibility.ts         # Write progress to disk for human observability
├── types.ts              # Shared interfaces
├── package.json
├── tsconfig.json
└── tests/
    ├── rpc-client.test.ts
    ├── worker-manager.test.ts
    ├── progress.test.ts
    └── visibility.test.ts
```

### Process Model

```
User <-> Pi (orchestrator, LLM)
              |
              |-- delegate_start() --> pi --mode rpc (worker 1)
              |-- delegate_start() --> pi --mode rpc (worker 2)
              |
              |-- delegate_check(task_id) --> query progress accumulator
              |-- delegate_steer(task_id, msg) --> RPC stdin: {"type":"steer",...}
              |-- delegate_abort(task_id) --> RPC abort, close stdin, SIGTERM/SIGKILL fallback
              |-- delegate_result(task_id) --> read final output
```

Workers are `pi --mode rpc` subprocesses. Each worker is fully isolated: own context window, own session, own model/provider configuration. The extension manages the RPC connection and event stream. The orchestrator LLM retains all supervisory authority.

## Tool Interfaces

### delegate_start

Spawns a new worker. Fails immediately if the concurrency cap (2) is reached.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| task | string | yes | | Prompt/instructions for the worker |
| model | string | yes | | Model ID, e.g. "claude-sonnet-4-6", "claude-haiku-4-5" |
| provider | string | yes | | Provider ID, e.g. "anthropic", "github-copilot" |
| thinking | string | no | (none) | "off", "minimal", "low", "medium", "high", or "xhigh" |
| tools | string[] | no | (none) | Tool allowlist — only these tools enabled. Mutually exclusive with `denied_tools`. |
| denied_tools | string[] | no | (none) | Tool deny list — all tools except these. Mutually exclusive with `tools`. |
| timeout | number | no | 1800 | Seconds; extension auto-aborts the worker at this limit (clean RPC abort, status becomes "aborted") |
| visibility | string | no | "log" | "log" (progress file on disk) |
| system_prompt | string | no | (none) | Additional system prompt appended to worker |
| cwd | string | no | project root | Working directory for the worker process |

Returns: `{ task_id: string, status: "running" }`

If the concurrency cap is reached, returns an error that includes the task IDs and descriptions of currently active workers so the orchestrator can decide what to abort.

### delegate_check

Query worker progress.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| task_id | string | yes | | Worker to query |
| detail | string | no | "summary" | "summary" or "full" |

Summary response:

| Field | Type | Description |
|-------|------|-------------|
| status | string | "running", "completed", "failed", or "aborted" |
| elapsed_seconds | number | Time since worker started |
| tool_calls | number | Total tool calls made |
| last_activity_seconds_ago | number | Seconds since last RPC event |
| recent_activity | string[] | Last 5 tool calls: name + truncated args (~80 chars) |
| input_tokens | number | Cumulative `usage.input` summed across all assistant turns observed so far |
| output_tokens | number | Cumulative `usage.output` summed across all assistant turns observed so far |
| context_usage_percent | number \| null | Approximate percent of the worker model's context window used by the most recent assistant turn's prompt. `null` when no assistant turn has been observed yet, or when the worker model's context window cannot be resolved from the orchestrator's `ModelRegistry`. |
| error | string | Stderr/diagnostic output (only present when status is "failed") |

All three usage fields (`input_tokens`, `output_tokens`, `context_usage_percent`) are derived from the streamed RPC event accumulator (see [progress.ts](#progressts)). They are valid for every worker state — `running`, `completed`, `failed`, `aborted` — and remain valid after the worker process has exited, including unexpected exits. `delegate_check` MUST NOT issue a live RPC call (e.g. `get_session_stats`) to obtain these fields, because the worker process may already be gone by the time the orchestrator queries.

Full response adds:

| Field | Type | Description |
|-------|------|-------------|
| transcript | string | Full accumulated text output |

### delegate_steer

Send a steering message to a running worker. Delivered between turns via RPC `steer` command. Returns an error if the worker is not actively streaming (i.e. has already reached `agent_end`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task_id | string | yes | Worker to steer |
| message | string | yes | Steering instruction |

Returns: `{ success: boolean }`

### delegate_abort

Terminate a running worker. Sends RPC `{"type":"abort"}` command first for a clean shutdown (preserves partial transcript and usage data). Waits up to 2 seconds for `agent_end` with `stopReason: "aborted"`, then closes stdin to trigger process exit. Falls back to SIGTERM/SIGKILL only if the process doesn't exit cleanly.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task_id | string | yes | Worker to abort |

Returns: `{ success: boolean }`

### delegate_result

Read the final output of a completed worker. Returns error if the worker is still running.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task_id | string | yes | Worker to read |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| status | string | "completed", "failed", or "aborted" |
| result | string | Final assistant text output |
| usage | object | Cumulative token counts (`input`, `output`, `cacheRead`, `cacheWrite`) accumulated from streamed assistant message `usage` data. Always populated for any terminal state, including `failed` workers whose process exited unexpectedly, because the data is captured passively from RPC events while the worker is alive. Fields default to `0` when no assistant turn was ever observed. |

## Module Details

### rpc-client.ts

Manages a single Pi RPC subprocess.

**Spawning:**

```
pi --mode rpc --no-session --model <model> --provider <provider> \
  [--thinking <level>] [--tools <allowlist>] \
  [--append-system-prompt <prompt>]
```

- `--no-session` prevents workers from creating persistent session files in the user's session history.
- Workers load extensions normally so they can use the user's custom tools. Recursive delegation is prevented by always excluding `delegate_*` tools from the `--tools` allowlist.
- **Tool filtering:** `tools` (allowlist) and `denied_tools` (denylist) are mutually exclusive parameters on `delegate_start`. If `tools` is provided, only those tools (minus `delegate_*`) are enabled. If `denied_tools` is provided, the extension subtracts the denied set (plus `delegate_*`) from all available tools to compute the allowlist. If neither is provided, all tools except `delegate_*` are enabled. The extension always translates to a `--tools` allowlist for the Pi CLI.
- Workers auto-load project context files (AGENTS.md, CLAUDE.md) by default. The user can include role-specific instructions in these files (e.g. "If you have been spawned as a worker agent, follow the directions here:").
- `cwd` set via `spawn()` options, not CLI flag.

**Task delivery:** RPC mode starts and waits for input on stdin. After spawning, the client sends the task as: `{"type":"prompt","message":"<task>"}\n`. The worker begins execution only after receiving this command.

**JSONL framing:** Splits strictly on `\n` only, per Pi's RPC docs. Does not use generic line readers that split on Unicode line separators (U+2028/U+2029).

**Interface:**

- `send(command: RPCCommand): void` — write JSON + `\n` to stdin
- `onEvent(callback: (event: RPCEvent) => void): void` — parse stdout lines, dispatch
- `kill(): Promise<void>` — send RPC abort, close stdin, await exit; SIGTERM/SIGKILL as fallback
- Detects unexpected process exit, captures stderr for diagnostics

**Worker completion:** The RPC process does not exit after `agent_end`. The client must close stdin to trigger process exit. Completion lifecycle: receive `agent_end` event → mark worker complete → close stdin → await process exit → dispose client.

**One client per worker, no reuse.** Worker finishes, client is disposed.

### worker-manager.ts

Central registry of active workers.

**State per worker:**

- `taskId` — sequential counter per session (`w1`, `w2`, ...)
- `status` — "running" | "completed" | "failed" | "aborted"
- `rpcClient` — the RPCClient instance
- `progress` — the ProgressAccumulator instance
- `params` — original DelegateStartParams (for diagnostics)
- `startedAt` — timestamp

**Concurrency:** Default cap at 2 concurrent workers, overridable via `DELEGATE_MAX_WORKERS` env var. `start()` returns an error with details of active workers if the cap is reached.

**Lifecycle:** Terminal states (completed/failed/aborted) dispose the RPC client but keep the worker entry in the map so `delegate_result` can still read it. Entries are cleared when the extension unloads.

### progress.ts

Consumes RPC events and builds a queryable view.

**Events consumed:**

| RPC Event | Stored |
|-----------|--------|
| `message_update` | Append text delta to transcript |
| `tool_execution_start` | Record tool name, args, timestamp |
| `tool_execution_update` | Append partial result |
| `tool_execution_end` | Record final result, mark complete |
| `turn_end` | Extract assistant `message.usage` and accumulate token totals; record `usage.input` of the latest assistant turn for context-percent estimation |
| `agent_end` | Mark worker finished, capture final messages |

**Internal state:**

- `transcript: string` — full running text
- `toolCalls: ToolCallRecord[]` — name, args, result, timestamps
- `lastActivityAt: number` — most recent event timestamp (NOT updated by `agent_end`, so terminal workers report a meaningful idle interval)
- `cumulativeInput: number` — sum of `usage.input` across all observed assistant turns
- `cumulativeOutput: number` — sum of `usage.output`
- `cumulativeCacheRead: number` — sum of `usage.cacheRead`
- `cumulativeCacheWrite: number` — sum of `usage.cacheWrite`
- `lastAssistantInput: number | null` — `usage.input` from the most recent assistant turn (proxy for current prompt size); `null` until the first turn completes

**Token & context usage (passive accumulation, no live RPC):**

Token and context-window usage are captured passively from the streamed RPC event protocol. Every `turn_end` event carries the assistant `AgentMessage`, which includes a `usage: { input, output, cacheRead, cacheWrite, cost }` block (see Pi `rpc.md`, `AssistantMessage` type). The progress accumulator extracts that `usage` block on each `turn_end` and updates the cumulative counters and `lastAssistantInput`.

This design is deliberate: usage data is delivered to the extension before the worker process can crash, so it survives any terminal state — completed, aborted, or unexpected `failed` exit. The extension MUST NOT rely on live RPC calls (such as `get_session_stats`) to obtain post-mortem stats, because the child process may already be unreachable.

`context_usage_percent` is derived at query time, not stored, since it depends on the worker's model context window:

```
context_usage_percent = round(100 * lastAssistantInput / model.contextWindow)
```

Where `model.contextWindow` is resolved from the orchestrator's `ModelRegistry` using the `provider` and `model` parameters originally passed to `delegate_start`. If `lastAssistantInput` is `null` (no assistant turn observed yet) or the model cannot be resolved, `context_usage_percent` is `null`.

The estimate is approximate. It models the prompt size of the most recent turn, which is the same quantity Pi internally uses for compaction and footer display. It does not include cache-hit tokens that were charged separately, but it is sufficient for orchestrator cost-aware supervision and matches the semantic intent of the original `get_session_stats.contextUsage.percent` field.

**Query interface:**

- `getSummary()` — status, elapsed, tool count, last activity, recent 5 tool calls
- `getUsage()` — `{ input, output, cacheRead, cacheWrite, lastAssistantInput }` cumulative totals plus latest assistant input
- `getFullTranscript()` — everything above plus full transcript text

`delegate_check` and `delegate_result` compose `getSummary()` + `getUsage()` + (for `delegate_check`) the orchestrator-side `ModelRegistry` lookup to produce their response payloads.

Stuck detection is the orchestrator's responsibility. This module only reports `last_activity_seconds_ago`.

### visibility.ts

Side-channel output for human observability.

**Log mode (`"log"`):**

- Writes to `{cwd}/.pi/delegate/{yyyy-mm-dd}/{orchestrator-session-id}/{taskId}.progress.md`
- Appends in real-time as RPC events arrive
- Format: tool calls as `[TOOL: bash] ls src/`, text deltas appended inline
- Human-readable when tailed: `tail -f` works

Tmux visibility mode is deferred to a future version (see Future Enhancements). For v1, users can observe workers via `tail -f` on the progress log file.

The orchestrator's session ID is resolved from `ctx.sessionManager.getSessionId()` in the `session_start` event handler and cached. If the session ID is unavailable (e.g. ephemeral `--no-session` orchestrator), a random run-id is generated as fallback. The date is the day the worker was spawned (local time).

## Default Working Directory

At extension init, `cwd` is resolved to the git repository root via `git rev-parse --show-toplevel`. This prevents cwd drift when the orchestrator uses bash `cd` commands during the session. The resolved root is used as the default for all `delegate_start` calls unless overridden by the `cwd` parameter.

## Configuration Philosophy

No config files. The orchestrator LLM decides model, provider, thinking level, tools, timeout, and visibility for each task based on:

- User's AGENTS.md / CLAUDE.md instructions (e.g. "use Haiku for quick lookups, Sonnet for implementation, high thinking for security reviews")
- Task context and complexity
- Prior experience within the session (e.g. a model that got stuck earlier)

This replaces the rigid TOML routing table with LLM judgment, allowing the orchestrator to adapt strategy mid-session based on results.

The recommended pattern for role-specific instructions is to reference separate files from AGENTS.md (e.g. `@orchestrator.md` and `@worker.md`). Both orchestrator and workers load the same AGENTS.md, but each agent follows the instructions addressed to its role. Workers and custom providers using `~/.pi/agent/models.json` work without additional configuration since workers run as the same user.

## Error Handling

The extension is a dumb pipe. All error handling and recovery decisions are made by the orchestrator LLM:

- Worker crashes: `delegate_check` returns `status: "failed"` with stderr diagnostics. Orchestrator decides whether to retry (same model, different model, different prompt) or escalate to the user.
- Worker times out: the extension auto-aborts at the `timeout` limit using clean RPC abort (status becomes `"aborted"`). The orchestrator decides whether to retry, escalate, or move on.
- Worker produces bad output: `delegate_result` returns the output. Orchestrator evaluates quality and decides next steps.

Recovery strategy is shaped by the user's standing instructions in AGENTS.md — anything from "stop and ask me" to "work it out yourself."

## Future Enhancements (out of v1 scope)

1. **Worker reconnect / follow-up** — Keep RPC client alive after completion, allow the orchestrator to send follow-up messages in the same worker session via a `delegate_continue` tool. Enables the review-then-fix pattern without re-reading files. Significant token savings when a review uses half its context and the fix is a few line changes.

2. **Tmux visibility mode** — Add `visibility: "tmux"` to `delegate_start`. Spawn the Pi RPC worker inside a named tmux pane (`delegate-{taskId}`) for live user observation. Requires a companion JSONL renderer (~100-150 lines) that formats RPC JSONL into human-readable colored terminal output, since raw `--mode rpc` output is JSONL, not a TUI.

3. **Orphan detection** — On extension reload, detect Pi processes from a previous session that are still running. Clean up or offer to reconnect.
