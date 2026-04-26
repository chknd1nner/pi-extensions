# Delegate Extension Implementation Plan Review

Review of `2026-04-26-delegate-extension.md`. Cross-checked against the design spec (and its review), `pi --help` output, and Pi's installed docs (`docs/pi/docs/rpc.md`, `docs/pi/docs/extensions.md`, `docs/pi/docs/session.md`).

The plan incorporates several recommendations from the design review: sequential task IDs (`w1`, `w2`...), env-overridable concurrency cap (`DELEGATE_MAX_WORKERS`), `--no-extensions` to suppress recursive delegation, RPC `abort` before SIGTERM/SIGKILL escalation, and dynamic session ID resolution per `delegate_start` call. Reconnect / follow-up is correctly deferred to v1.1.

The remaining issues fall into three buckets: bugs that will break implementation, unresolved design decisions implicit in the plan, and smaller polish items.

Citation paths are relative to the project root. The `docs/pi/` path is a symlink to the installed `@mariozechner/pi-coding-agent` package.

## Critical — bugs that will break implementation

### 1. Missing `typebox` dependency

Task 6 (line 1025) imports `Type` from `typebox`, but `package.json` (Task 1, lines 46–62) doesn't declare `typebox`. The extension will fail to load.

Citation: `docs/pi/docs/extensions.md:143` — typebox is listed as a separate import alongside `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`.

Fix: add `"typebox": "<version>"` to `devDependencies` in Task 1, alongside the existing pi packages.

### 2. `delegate_result` extracts assistant content as a string, but it's an array of content blocks

Task 9, lines 1480–1485:

```typescript
for (const msg of finalMessages) {
  const m = msg as { role?: string; content?: string };
  if (m.role === "assistant" && m.content) {
    resultText += m.content + "\n";
  }
}
```

`AssistantMessage.content` is an array of `TextContent | ThinkingContent | ToolCall` blocks, never a string. `m.content` will be truthy (arrays are), and `+= m.content` will stringify to `[object Object]` (or comma-joined garbage).

Citations:
- `docs/pi/docs/session.md:81–83` — `AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]`
- `docs/pi/docs/rpc.md:1248–1252` — same shape in JSON form

The fallback to `transcript` on lines 1487–1489 usually saves the output (transcript is the streamed text deltas concatenated), so this looks like it works in smoke tests for the wrong reason. Fix:

```typescript
if (m.role === "assistant" && Array.isArray(m.content)) {
  for (const block of m.content) {
    if ((block as any).type === "text") resultText += (block as any).text;
  }
}
```

### 3. `pi.sessionManager` is undocumented and likely doesn't exist on `ExtensionAPI`

Task 6, lines 1042–1048:

```typescript
function getSessionId(pi: ExtensionAPI): string {
  try {
    const sm = (pi as any).sessionManager;
    if (sm?.getSessionId) return sm.getSessionId();
  } catch {}
  return `run-${Date.now().toString(36)}`;
}
```

The original spec said the orchestrator session ID is "obtained from Pi's context (`ctx.sessionManager`)". `ctx` in Pi's extension model is the per-event `ExtensionContext`, not `pi: ExtensionAPI`. The `ExtensionAPI` documented surface (`pi.on`, `pi.registerTool`, `pi.registerCommand`, `pi.appendEntry`, etc.) does not include a `sessionManager` field.

The `as any` will silently return `undefined` and fall through to `run-${Date.now()}` for every worker. Smoke tests won't catch this — they just produce a fallback ID.

Citation: `docs/pi/docs/extensions.md:36–46` (ExtensionAPI methods) and `docs/pi/docs/extensions.md:158–175` (factory signature receives only `pi: ExtensionAPI`).

Recommended fix: investigate the actual API in `node_modules/@mariozechner/pi-coding-agent/dist/`. Options:
- Resolve session ID inside an event handler where `ctx: ExtensionContext` is available, cache the result.
- Use `pi.appendEntry` semantics to discover the active session indirectly.
- Worst case, accept that the `run-XXX` fallback is the only path and remove the dead branch.

### 4. `pi.on("session_end" as any, ...)` — that event likely doesn't exist

Task 9, lines 1524–1526:

```typescript
pi.on("session_end" as any, () => {
  manager.disposeAll();
});
```

Pi's documented lifecycle includes `session_start`, `session_before_switch`, and `session_before_fork` — but no `session_end`. The `as any` allows it to compile, but the handler will never fire and `disposeAll()` won't run on shutdown.

Citation: `docs/pi/docs/extensions.md:267–305` — lifecycle diagram and event list.

Fix: identify the real shutdown hook (Pi-level event, or fall back to `process.on("exit", ...)` from Node).

### 5. `disposeAll()` doesn't terminate child processes

Task 5, lines 986–991:

```typescript
disposeAll(): void {
  for (const entry of this.workers.values()) {
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
    entry.logWriter?.close();
  }
}
```

Clears timers and closes log files but never kills running RPC subprocesses. Combined with item 4, every Pi session restart leaks any in-flight workers as zombies.

Fix: iterate and `await entry.rpcClient?.kill()` for any worker still in `running` state. Note that `disposeAll` would then need to be `async`.

### 6. Task 10 ships broken code in Task 7 then fixes it

Task 7 (lines 1252–1271) sets up an `_statsHandler` field that no part of the RPC client ever calls. The stats fetch always falls through to `setTimeout` resolving with zeros. No tests cover this path. Task 10 then rewrites the entire approach.

This stages two commits where one is incorrect-but-passing. Recommend collapsing Tasks 7 + 10: implement `sendAndWait` on the RPC client first, then build `delegate_check` on top of it. Saves a commit cycle and avoids landing dead code that gets immediately replaced.

## Design gaps

### 7. `--no-extensions` is too aggressive as a hardcoded default

Task 2 line 369 hardcodes `--no-extensions` for every worker. The design review (item #8) suggested this for *recursive* delegation suppression, but a blanket disable means workers can't use any of the user's other extensions — skills, custom tools, and so on. A worker doing a code review can't use a custom git extension or a project-specific skill.

Better approaches:
- Load extensions but exclude `delegate_*` from the worker's tool allowlist (worker still sees all user tools, just can't recurse).
- Expose `include_extensions: bool` as a `delegate_start` parameter, default `false` for safety.

At minimum, document the trade-off in `rpc-client.ts:buildArgs()` so the next reader understands workers run in a stripped-down environment.

Citation: `pi --help` — `--no-extensions, -ne Disable extension discovery (explicit -e paths still work)`.

### 8. `--no-context-files` decision is implicit

The plan does NOT pass `--no-context-files`, so workers auto-load AGENTS.md and CLAUDE.md by default. This is probably correct (workers do project work) but the spec and plan never make the choice explicit. A one-line comment in `buildArgs()` documenting the decision would save future readers from wondering.

Citation: `pi --help` — `--no-context-files, -nc Disable AGENTS.md and CLAUDE.md discovery and loading`.

### 9. `delegate_steer` doesn't handle the not-streaming case

Task 8 line 1370 unconditionally sends `{type: "steer", message: ...}`. Per Pi's RPC docs, `steer` queues the message "while the agent is running" — when the agent isn't streaming, the RPC layer returns an error response, not a successful queue.

Citation: `docs/pi/docs/rpc.md:79–99` — `steer` semantics.

In our one-shot model the worker streams from spawn through `agent_end`, but compaction (`compaction_start` → `compaction_end`) creates a window where streaming is paused. The plan ignores this. Either:
- Document that steers issued during compaction may error and let the orchestrator retry, or
- Fall back to `prompt` with `streamingBehavior: "steer"` (per `docs/pi/docs/rpc.md:55–64`).

### 10. `kill()` stacks `on("exit")` listeners

Task 2, lines 326–355: `kill()` registers `this.proc!.on("exit", ...)` three times across three Promise.race blocks. None use `.once()`. If the process exits during the first race, the listener fires and resolves; the second race's listener never fires (exit has already happened) and falls back to its 2s timeout. Net effect: the kill path takes longer than necessary, and listeners pile up if `kill()` is called more than once.

Fix: track exit on the class (`private exited = false`, set in the `proc.on("exit")` from `start()`) and have `kill()` poll/await that flag rather than registering more listeners.

### 11. `RPCClient.onError` is dead code; spawn errors aren't handled

Task 2:
- `RPCClientCallbacks.onError` (line 267) is declared but never invoked from `start()`.
- `proc.on("error", ...)` (Node's spawn-error event for ENOENT, EACCES, etc.) is not wired. If `pi` isn't on PATH, the spawn error becomes an unhandled error event, which can crash the process.

Fix: in `start()`, add `this.proc.on("error", (err) => this.callbacks.onError(err.message))`.

## Smaller things

### 12. `promptSnippet` and `promptGuidelines` aren't documented `registerTool` fields

Task 6 lines 1068–1074 pass `promptSnippet` and `promptGuidelines` to `pi.registerTool`. The Pi extensions docs only show `name`, `label`, `description`, `parameters`, and `execute`.

Citation: `docs/pi/docs/extensions.md:76–89` (Quick Start example).

These extra fields may be silently ignored, accepted as recent additions, or rejected. Verify against actual types in `node_modules/@mariozechner/pi-coding-agent/dist/` rather than assuming. If unsupported, drop them.

### 13. `types.ts` `DelegateStartParams.thinking` is `string`, but tool registration uses a literal enum

Task 1 line 92: `thinking?: string;`. Task 6 lines 1079–1083: `StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const)`.

The runtime validation is correct but the static type loses the constraint, allowing typos in internal callers. Use the literal union: `thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"`.

### 14. `types.ts` has a dead import

Task 1 line 84: `import type { ChildProcess } from "node:child_process";` — unused in `types.ts` itself. Remove it.

### 15. `WorkerSummary` shape doesn't match `ProgressAccumulator.getSummary()` return shape

`WorkerSummary` in `types.ts` (lines 108–118) has `status`, `elapsed_seconds`, `error`, etc.; `ProgressAccumulator.getSummary()` (Task 3, lines 598–615) returns `tool_calls`, `last_activity_seconds_ago`, `recent_activity`, `transcript`. The two are never reconciled — `delegate_check` builds an ad-hoc object instead.

Either delete `WorkerSummary` or unify the two shapes. Unused type definitions drift from the implementation over time.

### 16. Log directory date uses UTC

Task 6 line 1051: `new Date().toISOString().slice(0, 10)` is UTC. A worker spawned at 4pm PST goes into the next day's directory. Cosmetic, but easy to switch to local time: `new Date().toLocaleDateString("en-CA")` yields `YYYY-MM-DD` in the system's local zone.

### 17. Synchronous fs writes on every text delta

Task 4 uses `fs.writeSync` and `fs.closeSync`. For a chatty worker that's hundreds of blocking syscalls per second on every text delta. Acceptable for v1; consider a `WriteStream` or in-memory buffering for v1.1 if log writing becomes a bottleneck.

### 18. `parseJsonlBuffer` U+2028 test may be vacuous

Task 2, lines 215–220: the test name says "splits only on LF, not Unicode line separators" but the source string `'has  inside'` may not contain actual U+2028/U+2029 characters — depending on how the plan was authored, those may just be regular spaces. If they're regular spaces, the test passes trivially regardless of what the implementation does.

Verify the literal contains ` `, or rewrite as:

```typescript
const unicodeLine = '{"text":"has inside"}\n';
```

Citation: `docs/pi/docs/rpc.md:31–36` — explicit warning that Pi's JSONL framing must split on LF only, not Unicode separators, because Node's `readline` will split on U+2028/U+2029.

### 19. `worker-manager.ts` `setStatus` has no state-machine guard

Nothing prevents `setStatus("w1", "running")` after a worker completed. Not a correctness bug today (no caller does this), but a footgun. Consider rejecting transitions out of terminal states (`completed`, `failed`, `aborted`).

### 20. Task 6 step 3 smoke test may not trigger tool use

Task 6 step 3 (line 1203): `pi -e ... --print "What tools do you have that start with delegate?"` asks Pi to *describe* tools, not invoke them. With `--print`, Pi may answer from the registered tool descriptions without ever exercising `execute()`. That's fine for "did registration succeed" but doesn't validate the spawn path. The end-to-end exercise in Task 12 step 4 covers that — keep it as the real validation.

## Bigger-picture observations

- **v1.1 reconnect deferral is clean.** Scanned the plan for `reconnect`, `delegate_continue`, follow-up logic — none present. Good.
- **Test coverage is solid** for `parseJsonlBuffer`, `ProgressAccumulator`, `ProgressLogWriter`, and `WorkerManager` (state machine + concurrency). Gaps: no tests for `RPCClient.kill()` race handling, no tests for the `delegate_*` tool execute functions (only their underlying modules). The integration test in Task 11 covers the happy path but not abort, steer-during-compaction, or timeout. Acceptable for v1.
- **Task ordering is otherwise good.** Modules first, then tools, then integration, then smoke. Only Tasks 7 and 10 need collapsing.

## Recommendation

Fix the critical bugs (items 1–6) before kicking off the plan — at least items 3 and 4 fail silently and won't be caught by the planned smoke tests. Items 7–11 are design decisions worth resolving with a one-line note in the plan rather than leaving for the implementer to discover.

Suggested order of pre-implementation fixes:

1. Add `typebox` to `devDependencies`.
2. Verify `pi.sessionManager`, `session_end` event, and `promptSnippet`/`promptGuidelines` against actual types in `node_modules/@mariozechner/pi-coding-agent/dist/`. Adjust or remove based on what you find.
3. Fix `delegate_result` content extraction to iterate content blocks.
4. Make `disposeAll()` actually kill running workers; pick a real shutdown hook.
5. Collapse Tasks 7 + 10 — implement `sendAndWait` first, then build `delegate_check` on top of it in a single task.
6. Decide and document the `--no-extensions` and `--no-context-files` policies (one-line comments in `buildArgs()` are sufficient).
