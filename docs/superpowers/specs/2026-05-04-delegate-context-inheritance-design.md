# Delegate Context Inheritance Design

**Date:** 2026-05-04  
**Status:** Draft  
**Extensions affected:** `extensions/delegate/`, `extensions/session/` (new)

---

## Overview

Workers spawned by `delegate_start` currently run with `--no-session` — a blank slate with no awareness of the parent session. This forces each worker to re-read files, specs, and context it needs, paying the full token cost every time with no provider-side cache hits.

This feature adds optional context inheritance: a worker can start with a snapshot of the parent session's conversation history loaded as its initial context. When multiple workers share the same starting snapshot, the prefix is byte-identical across all of them, enabling provider prompt cache hits.

Two usage patterns are supported:

- **Pattern A (burst):** snapshot the current session leaf at spawn time. All workers launched together share an identical prefix before any per-task divergence.
- **Pattern B (sequential):** declare a named anchor early in the session (e.g. after reading the spec and sharding tickets). Later workers always branch from that fixed point, regardless of how much orchestrator context has accumulated from completed tickets since.

Workers without `inherit_context` are unchanged — fully ephemeral, `--no-session`, no files.

---

## New Extension: `extensions/session/`

A thin, general-purpose session inspection extension. Independent of delegate — composes with it but has no dependency on it.

### Tool: `session_entries()`

No parameters. Calls `ctx.sessionManager.getBranch()` internally and returns the current active branch from root to current leaf, formatted for agent consumption.

**Returns:** array of entries, each with:
- `id` — 8-character hex entry ID
- `role` — `user`, `assistant`, `toolResult`, `compaction`, etc.
- `timestamp` — ISO string
- `preview` — truncated content (first ~120 characters of text)

**Primary use case:** agent browses the branch to identify the right entry ID for a retroactive anchor. The user never needs to inspect entry IDs directly or touch the session JSONL file.

This tool is general purpose. Future session tools (`session_name`, `session_compact`, etc.) belong here.

---

## Changes to `extensions/delegate/`

### New Tool: `delegate_anchor`

```typescript
delegate_anchor({
  name?: string,    // default: "default"
  entry_id?: string // if omitted, anchors to current leaf
})
```

Stores an entry ID in `anchorMap` — a `Map<string, string>` (name → entry ID) held in module scope alongside the existing `WorkerManager`. Survives for the duration of the pi session; cleared when pi exits.

**Behaviour:**
- No `entry_id` → calls `ctx.sessionManager.getLeafId()`, stores result
- With `entry_id` → validates the ID exists in `getBranch()` first, then stores it directly. Fails immediately with a clear error if the ID is not found — rather than surfacing the problem later at worker spawn time

Calling `delegate_anchor` again with the same name overwrites the previous anchor.

**Returns:** confirmation including the anchor name and entry count in the snapshot it will produce (i.e. `getBranch(storedId).length`).

---

### Modified Tool: `delegate_start`

One new optional parameter:

```typescript
inherit_context?: boolean | string
```

| Value | Behaviour |
|---|---|
| Absent or `false` | `--no-session`, current ephemeral behaviour, no file |
| `true` | Snapshot from current leaf via `getBranch()` |
| `"name"` | Look up entry ID from `anchorMap`, snapshot via `getBranch(entryId)` |

All other parameters and behaviour are unchanged.

**Snapshot serialisation** (shared by both `true` and `"name"` paths):

```
ctx.sessionManager.getHeader()  +  ctx.sessionManager.getBranch(entryId?)
  → serialize each to JSON, join with newlines → JSONL string
  → fs.writeFileSync to os.tmpdir() temp file
  → pass path to RPCClient as sessionPath
```

The resulting temp file is byte-identical across all workers that share the same anchor — this is what enables provider cache hits.

---

## Changes to `rpc-client.ts`

`RPCClientOptions` gains:

```typescript
sessionPath?: string
```

`buildArgs()` is updated:

```typescript
if (this.options.sessionPath) {
  args.push("--session", this.options.sessionPath);
} else {
  args.push("--no-session");
}
```

No other changes to the RPC client.

---

## Changes to `types.ts`

`DelegateStartParams` gains:

```typescript
inherit_context?: boolean | string;
```

`WorkerEntry` gains:

```typescript
tempFilePath?: string;
```

---

## Temp File Lifecycle

The temp file serves a dual role: it is both the context source (read at worker startup) and the worker's live session persistence target (pi appends new entries to it as the worker runs). The file cannot be deleted after spawn — it must remain for the full worker lifetime.

**Creation:** immediately before `rpcClient.start()`, after the JSONL is serialised. If the write fails, the error is surfaced and the worker never starts.

**Storage:** `WorkerEntry.tempFilePath` holds the path. Workers without `inherit_context` have no `tempFilePath` and are unaffected.

**Cleanup helper:** `tryCleanupTempFile(entry)` — silent `fs.rmSync` on `entry.tempFilePath` if set. Errors ignored (already-deleted is fine).

**Cleanup is called from:**

| Path | Trigger |
|---|---|
| Normal completion | `onExit` (unconditional) |
| Unexpected exit | `onExit` (unconditional) |
| Spawn error | `onError` |
| Timeout | `rpcClient.kill()` → `onExit` (unconditional) |
| `delegate_abort` | `rpcClient.kill()` → `onExit` (unconditional) |
| Session shutdown | `disposeAll` → `rpcClient.kill()` → `onExit` (unconditional) |

`tryCleanupTempFile` is called at the **top of `onExit`, before any status checks**. The current `onExit` handler has a `status === "running"` guard — for normal completion, `agent_end` fires first and sets status to `"completed"` before `onExit` runs, which would cause the guard to skip cleanup. Unconditional placement avoids this. `onError` is also unconditional. Cleanup is not duplicated across paths.

---

## Error Handling

| Situation | Behaviour |
|---|---|
| `inherit_context: "name"` and name not in `anchorMap` | Fail at spawn with: *"No anchor named 'foundation'. Call delegate_anchor({ name: 'foundation' }) first."* |
| `entry_id` passed to `delegate_anchor` not found in branch | Validate against `getBranch()` at declaration time. Fail immediately with the bad ID in the error message |
| `getBranch()` returns empty | Allowed — worker starts with just the session header. Valid at the very start of a session |
| Temp file write fails | Caught before `rpcClient.start()`, error surfaced, worker never starts |
| `sessionManager` unavailable or throws | Defensive catch, error surfaced |

---

## Anchor Storage Notes

`anchorMap` is module-scope alongside `WorkerManager` — plain JavaScript `Map`, no disk I/O, no pi session persistence. Anchors live for the pi process lifetime and are cleared on exit.

This is sufficient for all intended workflows: anchors are declared and consumed within the same session. If an anchor needs to survive a session restart, the user re-declares it — the session tree entries it points to are still there and immutable.

---

## Session Tree Immutability

Entries in the session JSONL are immutable once written. Compaction appends a new `CompactionEntry` node but never modifies existing entries. This means `getBranch(anchorEntryId)` always produces the same result regardless of when it is called — before or after compaction, before or after additional work has accumulated. No frozen snapshot files are needed. The session file itself is the source of truth.

---

## Composition Example

**Pattern B — sequential ticket workflow:**

```
// After reading spec and sharding tickets:
delegate_anchor({ name: "foundation" })

// Implement ticket 1, review it, mark done...
// Orchestrator context has now grown with ticket-1 results.

// Spawn ticket 2 worker — still branches from "foundation", not current leaf:
delegate_start({
  task: "Implement ticket 2...",
  model: "claude-sonnet-4-5",
  provider: "anthropic",
  inherit_context: "foundation"
})

// Retroactive recovery — missed the anchor moment:
session_entries()
→ [{ id: "a1b2c3d4", role: "user", preview: "Read the spec..." }, ...]

delegate_anchor({ name: "foundation", entry_id: "a1b2c3d4" })
```

---

## Out of Scope

- Anchor persistence across pi process restarts
- Passing anchors between different sessions
- "Read-only session" mode (load context but skip persistence to temp file) — not supported by the pi CLI
- Automatic anchor detection (agent always declares explicitly)
