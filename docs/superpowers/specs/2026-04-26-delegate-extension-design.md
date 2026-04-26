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
├── visibility.ts         # Write progress to disk or spawn tmux pane
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
              |-- delegate_abort(task_id) --> SIGTERM/SIGKILL worker process
              |-- delegate_result(task_id) --> read final output
```

Workers are `pi --mode rpc` subprocesses. Each worker is fully isolated: own context window, own session, own model/provider configuration. The extension manages the RPC connection and event stream. The orchestrator LLM retains all supervisory authority.

## Tool Interfaces

### delegate_start

Spawns a new worker. Fails immediately if the concurrency cap (2) is reached.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| task | string | yes | | Prompt/instructions for the worker |
| model | string | yes | | Model ID, e.g. "claude-sonnet-4.6" |
| provider | string | yes | | Provider ID, e.g. "anthropic", "github-copilot" |
| thinking | string | no | (none) | "low", "medium", "high", or "max" |
| tools | string[] | no | all | Restrict worker's available tools |
| timeout | number | no | 1800 | Seconds before the worker is considered timed out |
| visibility | string | no | "log" | "log" (progress file on disk) or "tmux" (named tmux pane) |
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
| recent_activity | string[] | Last 5 tool calls: name + primary arg |
| error | string | Stderr/diagnostic output (only present when status is "failed") |

Full response adds:

| Field | Type | Description |
|-------|------|-------------|
| transcript | string | Full accumulated text output |

### delegate_steer

Send a steering message to a running worker. Delivered between turns via RPC `steer` command.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| task_id | string | yes | Worker to steer |
| message | string | yes | Steering instruction |

Returns: `{ success: boolean }`

### delegate_abort

Terminate a running worker. Sends SIGTERM, waits 5 seconds, then SIGKILL.

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
| usage | object | Token counts (input, output, cache hits) if available |

## Module Details

### rpc-client.ts

Manages a single Pi RPC subprocess.

**Spawning:**

```
pi --mode rpc --no-session --model <model> --provider <provider> \
  [--thinking-level <level>] [--tools <tools>] \
  [--system-prompt <prompt> | --append-system-prompt <prompt>]
```

- `--no-session` prevents workers from creating persistent session files in the user's session history.
- `cwd` set via `spawn()` options, not CLI flag.

**JSONL framing:** Splits strictly on `\n` only, per Pi's RPC docs. Does not use generic line readers that split on Unicode line separators (U+2028/U+2029).

**Interface:**

- `send(command: RPCCommand): void` — write JSON + `\n` to stdin
- `onEvent(callback: (event: RPCEvent) => void): void` — parse stdout lines, dispatch
- `kill(): Promise<void>` — SIGTERM, wait 5s, SIGKILL
- Detects unexpected process exit, captures stderr for diagnostics

**One client per worker, no reuse.** Worker finishes, client is disposed.

### worker-manager.ts

Central registry of active workers.

**State per worker:**

- `taskId` — 8-char random hex
- `status` — "running" | "completed" | "failed" | "aborted"
- `rpcClient` — the RPCClient instance
- `progress` — the ProgressAccumulator instance
- `params` — original DelegateStartParams (for diagnostics)
- `startedAt` — timestamp

**Concurrency:** Hard cap at 2 concurrent workers. `start()` returns an error with details of active workers if the cap is reached.

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
| `agent_end` | Mark worker finished, capture final messages |

**Internal state:**

- `transcript: string` — full running text
- `toolCalls: ToolCallRecord[]` — name, args, result, timestamps
- `lastActivityAt: number` — most recent event timestamp

**Query interface:**

- `getSummary()` — status, elapsed, tool count, last activity, recent 5 tool calls
- `getFullTranscript()` — everything above plus full transcript text

Stuck detection is the orchestrator's responsibility. This module only reports `last_activity_seconds_ago`.

### visibility.ts

Side-channel output for human observability.

**Log mode (`"log"`):**

- Writes to `{cwd}/.pi/delegate/{yyyy-mm-dd}/{orchestrator-session-id}/{taskId}.progress.md`
- Appends in real-time as RPC events arrive
- Format: tool calls as `[TOOL: bash] ls src/`, text deltas appended inline
- Human-readable when tailed: `tail -f` works

**Tmux mode (`"tmux"`):**

- Spawns the Pi RPC worker inside a named tmux pane: `delegate-{taskId}`
- Extension still reads stdout for progress tracking (piped through the tmux pane)
- Falls back to `"log"` if tmux is unavailable

The orchestrator's session ID is obtained from Pi's context (`ctx.sessionManager`) at extension init. The date is the day the worker was spawned.

## Default Working Directory

At extension init, `cwd` is resolved to the git repository root via `git rev-parse --show-toplevel`. This prevents cwd drift when the orchestrator uses bash `cd` commands during the session. The resolved root is used as the default for all `delegate_start` calls unless overridden by the `cwd` parameter.

## Configuration Philosophy

No config files. The orchestrator LLM decides model, provider, thinking level, tools, timeout, and visibility for each task based on:

- User's AGENTS.md / CLAUDE.md instructions (e.g. "use Haiku for quick lookups, Sonnet for implementation, high thinking for security reviews")
- Task context and complexity
- Prior experience within the session (e.g. a model that got stuck earlier)

This replaces the rigid TOML routing table with LLM judgment, allowing the orchestrator to adapt strategy mid-session based on results.

## Error Handling

The extension is a dumb pipe. All error handling and recovery decisions are made by the orchestrator LLM:

- Worker crashes: `delegate_check` returns `status: "failed"` with stderr diagnostics. Orchestrator decides whether to retry (same model, different model, different prompt) or escalate to the user.
- Worker times out: `delegate_check` returns high `last_activity_seconds_ago`. Orchestrator decides whether to steer, abort, or wait longer.
- Worker produces bad output: `delegate_result` returns the output. Orchestrator evaluates quality and decides next steps.

Recovery strategy is shaped by the user's standing instructions in AGENTS.md — anything from "stop and ask me" to "work it out yourself."

## Future Enhancements (out of v1 scope)

1. **Worker reconnect / follow-up** — Keep RPC client alive after completion, allow the orchestrator to send follow-up messages in the same worker session. Enables the review-then-fix pattern without re-reading files. Significant token savings when a review uses half its context and the fix is a few line changes.

2. **Tmux JSONL renderer** — Standalone pipe script (~100-150 lines) that formats RPC JSONL into human-readable colored terminal output. Quality-of-life for tmux users so they see formatted output instead of raw JSON.

3. **Configurable concurrency cap** — Expose the worker cap as a setting rather than hardcoded at 2.

4. **Orphan detection** — On extension reload, detect Pi processes from a previous session that are still running. Clean up or offer to reconnect.
