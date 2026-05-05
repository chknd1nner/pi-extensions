# Delegate Context Inheritance Design

**Date:** 2026-05-04  
**Status:** Draft (post-review revision)
**Extensions affected:** `extensions/delegate/`, `extensions/session/` (new)

---

## Overview

Workers spawned by `delegate_start` currently run with `--no-session` — a blank slate with no awareness of the parent session. This forces each worker to re-read files, specs, and context it needs, paying the full token cost every time with no provider-side cache hits.

This feature adds optional context inheritance: a worker can start with a snapshot of the parent session's conversation history loaded as its initial context. When multiple workers share the same starting snapshot, the inherited conversation content is identical across all of them, enabling provider prompt cache hits on that shared prefix.

Two usage patterns are supported:

- **Pattern A (burst):** snapshot the current session leaf at spawn time. All workers launched together share an identical conversation prefix before any per-task divergence.
- **Pattern B (sequential):** declare a named anchor early in the session (e.g. after reading the spec and sharding tickets). Later workers always branch from that fixed point, regardless of how much orchestrator context has accumulated from completed tickets since.

Workers without `inherit_context` are unchanged — fully ephemeral, `--no-session`, no files.

---

## New Extension: `extensions/session/`

A thin, general-purpose session inspection extension. Independent of delegate — composes with it but has no dependency on it.

### Tool: `session_entries()`

No parameters. Calls `ctx.sessionManager.getBranch()` internally and returns the current active branch from root to current leaf, formatted for agent consumption.

**Returns:** array of entries, each with:
- `id` — 8-character hex entry ID
- `entry_type` — the session entry type (`message`, `compaction`, `model_change`, `thinking_level_change`, `label`, `session_info`, `custom`, `custom_message`, `branch_summary`)
- `message_role` — present only when `entry_type === "message"`: `user`, `assistant`, `toolResult`, etc.
- `timestamp` — ISO string
- `preview` — truncated text summary. For messages: first ~120 characters of text content. For tool calls with no text: tool name(s). For `compaction`: summary excerpt. For `model_change`: provider/model string. For `thinking_level_change`: level. For `label`: target id + label text. Empty string for entry types with no meaningful preview.

**Note:** `entry_type` is the primary discriminator, not `message_role`. Many session entries are not messages at all. Relying on `role` alone would silently drop compaction, model changes, and other structural entries.

**Primary use case:** agent browses the branch to identify the right entry ID for a retroactive anchor. The user never needs to inspect entry IDs directly or touch the session JSONL file.

This tool is general purpose. Future session tools (`session_name`, `session_compact`, etc.) belong here.

---

## Changes to `extensions/delegate/`

### Anchor Storage

`anchorMap` is defined **inside the extension factory function** (not at true module scope, consistent with how `WorkerManager` is defined today):

```typescript
const anchorMap = new Map<string, string | null>(); // name → entryId | null
```

`null` is a valid value representing "anchor at session start — no entries, empty branch."

**Lifetime:** anchors live for the duration of the current loaded extension instance. They are cleared on `/reload`, `/new`, `/resume`, `/fork`, and pi process exit. This is consistent with all other in-memory delegate state (`WorkerManager`, worker entries, etc.). If an anchor needs to survive one of these events, the user re-declares it — the session tree entries it points to are still there and immutable.

---

### New Tool: `delegate_anchor`

```typescript
delegate_anchor({
  name?: string,    // default: "default"
  entry_id?: string // if omitted, anchors to current leaf
})
```

**Behaviour:**
- No `entry_id` → calls `ctx.sessionManager.getLeafId()` which returns `string | null`. Stores the result (including `null` if the session has no entries yet).
- With `entry_id` → validates the ID exists in `getBranch()` (i.e. on the **current active branch**) before storing. Fails immediately if not found.

**Branch-membership constraint:** validation uses `getBranch()`, not `getEntry()`. This means `entry_id` must be on the current active branch — entries that exist elsewhere in the session tree (other branches) are rejected. This is an intentional design choice, not just an existence check. Anchoring to a non-active branch entry is not supported.

Calling `delegate_anchor` again with the same name overwrites the previous anchor silently.

**Returns:** confirmation including the anchor name and the number of branch entries the snapshot will contain.

`delegate_anchor` must be added to the `DELEGATE_TOOLS` denylist in `index.ts` to prevent workers from creating anchors in the parent session.

---

### Modified Tool: `delegate_start`

One new optional parameter:

```typescript
inherit_context?: boolean | string
```

TypeBox schema must use `Type.String({ minLength: 1 })` for the string branch to reject empty strings. Runtime branching must use explicit type checks, not truthy checks, to avoid mishandling `"false"` or `"true"` as strings:

```typescript
if (params.inherit_context === undefined || params.inherit_context === false) {
  // --no-session, existing path
} else if (params.inherit_context === true) {
  // snapshot current leaf
} else if (typeof params.inherit_context === "string") {
  // named anchor lookup
}
```

| Value | Behaviour |
|---|---|
| Absent or `false` | `--no-session`, current ephemeral behaviour, no file |
| `true` | Snapshot from current leaf via `getBranch()` |
| `"name"` | Look up entry ID from `anchorMap`, snapshot via `getBranch(entryId)` |

All other parameters and behaviour are unchanged.

---

### Snapshot Serialisation

Shared by both the `true` and `"name"` paths:

```
Resolve entryId (null | string):
  true  → ctx.sessionManager.getLeafId()
  "name" → anchorMap.get(name)   [error if name not registered]

Build JSONL:
  1. Fresh session header — NOT the parent header. A new header must be written with:
       - new session UUID
       - cwd: workerCwd (from delegate_start params, not parent cwd)
       - version: current session format version
  2. Branch entries: entryId === null → [] (empty branch)
                     entryId is string → ctx.sessionManager.getBranch(entryId)
  → join as JSONL
  → fs.writeFileSync to os.tmpdir() temp file
  → pass path to RPCClient as sessionPath
```

**Why a fresh header is required:** `SessionManager.open()` uses `header.cwd` to set the session's working directory when no override is passed, and the Pi CLI `--session` path does not pass a cwd override. Copying the parent header would silently set the worker's Pi cwd to the parent's cwd, overriding `delegate_start.cwd`. A fresh header with `cwd: workerCwd` ensures the worker runs in the correct directory. It also avoids reusing the parent session ID across all workers.

**Why the fresh header does not break cache hits:** Provider cache hits depend on the conversation messages sent in the API request, not the session file header. The header is Pi-internal metadata that is never sent to the model. All workers sharing the same anchor will send identical conversation content to the provider — that is what produces the cache hit.

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

Note: `--session` is a supported Pi CLI flag confirmed in `docs/pi/docs/usage.md`. No other changes to the RPC client.

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

**Creation:** immediately before `rpcClient.start()`, after the JSONL is serialised. If the write fails, error is surfaced and the worker never starts (see Pre-start Failure Handling below).

**Storage:** `WorkerEntry.tempFilePath` holds the path. Workers without `inherit_context` have no `tempFilePath` and are unaffected.

**Cleanup helper:** `tryCleanupTempFile(entry)` — silent `fs.rmSync` on `entry.tempFilePath` if set. Errors ignored (already-deleted is fine). May be called from multiple paths; the silent no-op on missing file makes duplication harmless.

**Cleanup placement:** `tryCleanupTempFile` is called at the **top of `onExit`, unconditionally before any status checks**. This is required because `agent_end` fires and sets status to `"completed"` before the process exits — the existing `status === "running"` guard in `onExit` would otherwise skip cleanup for normally completed workers. `onError` also calls it unconditionally.

**Coverage:** cleanup is best-effort across normal delegate-managed exit paths:

| Path | Trigger |
|---|---|
| Normal completion | `onExit` (unconditional, top) |
| Unexpected exit | `onExit` (unconditional, top) |
| Spawn error | `onError` |
| Timeout | `rpcClient.kill()` → `onExit` |
| `delegate_abort` | `rpcClient.kill()` → `onExit` |
| Session shutdown | `disposeAll` → `rpcClient.kill()` → `onExit` |

Cleanup is **not** guaranteed on parent process crash, SIGKILL, or catastrophic termination. Temp files in `os.tmpdir()` will be cleaned by the OS eventually in those cases.

---

## Pre-start Failure Handling

Several new failure points occur **after** `manager.register()` but **before** `rpcClient.start()`:

- anchor name not found in `anchorMap`
- `getBranch()` or `getLeafId()` throws
- temp file write fails

In all these cases, the spec requires:

1. `manager.setStatus(taskId, "failed", errorMessage)`
2. log writer closed
3. temp file deleted if it was created before the failure
4. timeout timer NOT started
5. error surfaced to caller

Without this, a failed pre-start leaves a phantom worker stuck in `running`, consuming a worker slot.

---

## Error Handling

| Situation | Behaviour |
|---|---|
| `inherit_context: "name"` and name not in `anchorMap` | Pre-start fail: *"No anchor named 'foundation'. Call delegate_anchor({ name: 'foundation' }) first."* |
| `entry_id` passed to `delegate_anchor` not found in current branch | Fail immediately at declaration time with the bad ID in the error message |
| `entry_id` exists in session tree but on a different branch | Rejected — branch-membership validation via `getBranch()`. Not a bug, intentional constraint. |
| `getLeafId()` returns `null` (session start) | Valid — stored as `null` in `anchorMap`, produces empty branch (fresh header only) |
| `getBranch()` returns empty for a string `entryId` | Indicates entry not on current branch; treat as invalid, same error as not-found |
| Temp file write fails | Pre-start fail, worker never starts, no phantom entry |
| `sessionManager` unavailable or throws | Defensive catch, pre-start fail |

---

## Session Tree Immutability

Entries in the session JSONL are immutable once written. Compaction appends a new `CompactionEntry` node but never modifies existing entries. This means `getBranch(anchorEntryId)` always produces the same conversation content regardless of when it is called — before or after compaction, before or after additional work has accumulated. No frozen snapshot files are needed. The session file itself is the source of truth.

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
→ [{ id: "a1b2c3d4", entry_type: "message", message_role: "user", preview: "Read the spec..." }, ...]

delegate_anchor({ name: "foundation", entry_id: "a1b2c3d4" })
```

---

## Out of Scope

- Anchor persistence across extension instance reloads (`/reload`, `/new`, `/resume`, `/fork`)
- Anchoring to entries on non-active session branches
- Passing anchors between different sessions
- "Read-only session" mode (load context but skip persistence to temp file) — not supported by the Pi CLI
- Automatic anchor detection (agent always declares explicitly)
- Pagination or search in `session_entries()` — returns full branch; deferred
