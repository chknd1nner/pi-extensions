# Delegate Extension Design Review

Review of `2026-04-26-delegate-extension-design.md`. Cross-checked against `pi --help` output and Pi's installed docs (`docs/pi/docs/rpc.md`, `docs/pi/docs/extensions.md`, `docs/pi/docs/session.md`, `docs/pi/docs/models.md`).

Overall the architecture is sound: clean module separation, the "dumb pipe + LLM judgment" philosophy is the right call, and the tool surface is appropriately minimal. The issues below are worth resolving before implementation planning.

Citation paths are relative to the project root. The Pi docs path is a symlink to the installed `@mariozechner/pi-coding-agent` package.

## Critical — factual errors against Pi's API

### 1. CLI flag name and thinking levels are wrong

Spec (line 152, line 68) uses `--thinking-level <level>` and lists levels `"low", "medium", "high", or "max"`.

Actual flag is `--thinking <level>`, and the valid set is `off, minimal, low, medium, high, xhigh`. There is no `"max"`; you mean `xhigh`.

Citations:
- `pi --help` output: `--thinking <level> Set thinking level: off, minimal, low, medium, high, xhigh`
- `docs/pi/docs/rpc.md:288` — `Levels: "off", "minimal", "low", "medium", "high", "xhigh"`
- `docs/pi/docs/rpc.md:290` — `Note: "xhigh" is only supported by OpenAI codex-max models.`

There is also a shorthand: `--model sonnet:high` encodes the thinking level into the model pattern (`docs/pi/docs/rpc.md:16`). Worth deciding which form the extension uses internally.

### 2. The initial task prompt is not a CLI argument

Spec (lines 148–153) shows the spawn command but never explains how `task` is delivered to the worker. RPC mode starts and waits for stdin; the worker does not begin work until a `prompt` command is written to its stdin.

The spawn flow needs an explicit step:

1. `spawn(pi, [...flags])`
2. Write `{"type":"prompt","message":"<task>"}\n` to stdin
3. Stream events on stdout

Citation: `docs/pi/docs/rpc.md:42–77` (prompt command), `docs/pi/docs/rpc.md:1315–1349` (Python client example showing this exact pattern).

### 3. Worker process does not exit on its own after `agent_end`

Spec (line 198) says `agent_end → Mark worker finished`. After `agent_end`, the RPC subprocess stays alive waiting for the next `prompt`. To complete a worker, the rpc-client must close stdin (the process exits when stdin EOFs).

Lifecycle should be: on `agent_end`, mark complete, close stdin, await `process.exit`, dispose RPC client. Document this in `worker-manager.ts`.

Citation: implicit in the Python/Node examples — `docs/pi/docs/rpc.md:1315–1407` show the loop continuing past `agent_end` events.

### 4. `delegate_abort` should use the RPC abort command, not jump to SIGTERM

Spec (line 117) says: `Sends SIGTERM, waits 5 seconds, then SIGKILL.`

Pi exposes an RPC-level `abort` command that cleanly stops the current operation and emits a final `agent_end` with `stopReason: "aborted"`. Preferred sequence:

1. Send `{"type":"abort"}` on stdin
2. Wait briefly (e.g. 2s) for `agent_end` with `aborted` reason
3. Close stdin, await process exit
4. SIGTERM/SIGKILL only as fallback if the process doesn't exit

This preserves the partial transcript and final usage data. SIGKILL drops both, which is hostile to the orchestrator's post-mortem.

Citations:
- `docs/pi/docs/rpc.md:123–134` — `abort` command
- `docs/pi/docs/rpc.md:841` — `done` reasons include `"aborted"`

### 5. Anthropic model ID example uses wrong format

Spec (line 66) example: `"claude-sonnet-4.6"`. Anthropic model IDs use hyphens, not dots: `claude-sonnet-4-6`.

Citation: `docs/pi/docs/rpc.md:221` — `{"type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514"}`. Pi's pattern matching is forgiving enough that `sonnet-4.6` may resolve, but the example should be canonical.

## Design gaps

### 6. Steering against an idle worker

The RPC `steer` command queues a message "while the agent is running" — it requires active streaming. In our one-shot model the worker streams from spawn through `agent_end`, so this is mostly fine. Edge cases: during compaction (`compaction_start` → `compaction_end`), or after `agent_end` if we keep the process alive for the future "follow-up" enhancement.

Recommendation: define `delegate_steer` semantics for the not-streaming case. Either error explicitly, or fall back to sending a `prompt` with `streamingBehavior: "steer"` (which Pi accepts even when streaming is in flight).

Citations:
- `docs/pi/docs/rpc.md:55–64` — `streamingBehavior` semantics
- `docs/pi/docs/rpc.md:79–99` — `steer` command and modes
- `docs/pi/docs/rpc.md:325–332` — default mode is `one-at-a-time`

### 7. Worker token usage is not exposed during execution

`delegate_check` (lines 88–96) returns elapsed time, tool count, and last activity, but no token counts. Cost-aware supervision ("worker burned 80k tokens, abort") is a key use case the motivation hints at.

Pi exposes `get_session_stats` over RPC, returning running input/output/cacheRead/cacheWrite token counts and a `contextUsage` percent. Recommend the progress accumulator either calls this on demand for `delegate_check`, or sums the `usage` field from each `AssistantMessage` seen on the event stream.

Citation: `docs/pi/docs/rpc.md:497–538` — `get_session_stats` schema.

### 8. Recursive delegation is unaddressed

Auto-discovered extensions (including `delegate` itself) load by default in any Pi process. Without explicit suppression, a worker can call `delegate_start` and recurse past the cap.

Recommendation: workers spawn with `--no-extensions` by default. If users want extension-loaded workers, surface that as an explicit parameter. Consider also: should the `tools` parameter explicitly exclude `delegate_*` tools when extensions are loaded?

Citation: `pi --help` output — `--no-extensions, -ne Disable extension discovery (explicit -e paths still work)`.

### 9. Worker context files (AGENTS.md / CLAUDE.md) policy is unspecified

Pi auto-loads `AGENTS.md` and `CLAUDE.md` unless `--no-context-files` is passed. The spec discusses the orchestrator's AGENTS.md shaping its behavior but is silent on whether workers see project context.

Almost certainly workers should see project context (they're doing project work), but make this explicit. Consider exposing as a parameter (`include_context_files: bool`, default true).

Citation: `pi --help` output — `--no-context-files, -nc Disable AGENTS.md and CLAUDE.md discovery and loading`.

### 10. Tmux visibility mode is under-specified

Spec (lines 225–228) says: "Spawns the Pi RPC worker inside a named tmux pane. Extension still reads stdout for progress tracking (piped through the tmux pane)."

These are contradictory. If Pi runs inside a tmux pane, its stdout is the pane TTY — not a pipe back to the extension. Workable redesigns:

- **Option A**: Extension owns the RPC pipe (as in `log` mode); a separate `tmux` pane runs `tail -f` on the progress file. Simple, no IPC tricks.
- **Option B**: Use `tmux pipe-pane` to mirror a formatted view to a pane while the extension reads the real stdout.
- **Option C**: Defer tmux mode to v2 entirely. The `log` mode plus a documented `tail -f` recipe is sufficient for v1, and "Tmux JSONL renderer" is already in Future Enhancements.

I'd recommend C for v1.

### 11. `delegate_check` "primary arg" extraction is undefined

Spec (line 94): `recent_activity: string[] — Last 5 tool calls: name + primary arg`.

What is "primary arg" for each tool? `bash` → `command`, `read`/`edit` → `file_path`, `grep` → `pattern`, etc. Either codify a per-tool rule table in this spec, or just stringify the args object truncated to ~80 chars. Simpler is better.

### 12. `timeout` parameter behavior is ambiguous

Spec line 69 says `timeout: 1800` is "Seconds before the worker is considered timed out", but the error-handling section (lines 250–252) puts timeout decisions on the orchestrator.

Pick one:

- **Auto-abort safety net**: extension auto-aborts at timeout. Document the precise behavior — does it call `delegate_abort` semantics, mark `status: "failed"`, or `status: "aborted"`?
- **Pure reporting**: drop the parameter; orchestrator polls `last_activity_seconds_ago` and decides.

The current spec is half of each.

### 13. Orchestrator session ID — resolve dynamically, with fallback

Spec (line 230) says the orchestrator session ID is obtained from `ctx.sessionManager` at extension init.

Two issues:

- If the user runs `/new` mid-session, the session ID changes; a value cached at init is stale. Resolve at each `delegate_start` call.
- If the orchestrator runs ephemerally (`--no-session`), `getSessionId()` may still work (in-memory sessions have IDs per `docs/pi/docs/session.md:362–411`), but the spec should specify a fallback (PID, random run-id) for any environment where the call fails.

Citation: `docs/pi/docs/session.md:411` — `getSessionId() - Session UUID`.

## Smaller things

### 14. Concurrency cap of 2, hardcoded

Already noted in Future Enhancements. For v1, consider either raising to 3 or making it env-overridable (`DELEGATE_MAX_WORKERS`). Two is constraining for parallel research patterns.

### 15. Task ID format

8-char random hex (line 175) gives a 16M-key space, fine for ≤2 concurrent + history. A short counter (`w1`, `w2`, ...) would be easier for the orchestrator to retype into `delegate_check` calls. Consider counter or a 4-char prefix.

### 16. Custom providers and `models.json`

If a user delegates with a custom provider (defined in `~/.pi/agent/models.json`), the worker process needs that file readable. Usually fine since worker runs as the same user, but worth a one-liner in the spec confirming the assumption.

Citation: `docs/pi/docs/models.md:1` — `Add custom providers and models ... via ~/.pi/agent/models.json.`

### 17. Tool registration mechanics

Pi extensions register tools via `pi.registerTool({...})` with typebox schemas (`docs/pi/docs/extensions.md:76–89`). The spec doesn't show this; not strictly necessary for a design doc, but the implementation plan should include schema definitions.

## Recommendation

The architecture is good — proceed to implementation planning after addressing:

- **Must-fix before planning**: items 1–5 (factual errors that will mislead implementation).
- **Decide before planning**: items 6, 9, 10, 12 (ambiguities the implementer cannot resolve alone).
- **Worth pulling into v1**: item 7 (token usage in `delegate_check`) — directly enables the cost-aware supervision the motivation cites, low implementation cost.
- **Re-evaluate v1 scope**: Future Enhancement #1 ("worker reconnect / follow-up") is mostly "don't close stdin on `agent_end`, add `delegate_continue` tool." Probably <100 LoC and unlocks the review-then-fix pattern with significant token savings. Worth considering for v1.
