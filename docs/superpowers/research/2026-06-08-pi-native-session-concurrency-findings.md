# Pi native session concurrency findings

## Session writer model
- A session is just JSONL on disk; `SessionManager.open()` loads it once, then keeps an in-memory tree (`fileEntries`/`byId`) and appends new JSON lines.
- Writes are plain filesystem writes: `appendFileSync(...)` for normal turns, `openSync(..., "w")` for full rewrites, and `openSync(..., "wx")` for the first flush / create path. No separate ownership file exists.

## Concurrency primitives (locks/claims/none — quote code)
- In `dist/core/session-manager.js` the imports are only `fs` helpers (`appendFileSync`, `openSync`, etc.); there is no lock library import.
- Relevant code:
  ```js
  this.fileEntries = loadEntriesFromFile(this.sessionFile);
  ...
  const fd = openSync(this.sessionFile, "w");
  ...
  appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
  ...
  const fd = openSync(this.sessionFile, "wx");
  ```
- I found no `flock`/claim/session-owner logic in `session-manager.js`.

## TUI-vs-TUI behaviour
- If two TUI processes `/resume` the same file, both open it independently and there is no “session already open” detection.
- They will each mutate their own in-memory tree and write to the same JSONL path. Normal turns race on append order; any rewrite path can truncate/overwrite earlier concurrent writes.

## TUI-vs-RPC behaviour
- Same story: `rpc.md` exposes `sessionFile` in `get_state`, but it is just per-process state, not a lock/lease.
- RPC and TUI can both attach to the same file; neither process is notified that the other exists.
- `agent-session-runtime.js` resumes by calling `SessionManager.open(...)` and rebinds the runtime to that independent instance.

## File watching / external-change detection (if any)
- None in `SessionManager`: I found no `watch`, `watchFile`, or polling logic in the module.
- After open, context comes from memory only: `buildSessionContext()` uses `this.fileEntries` / `this.byId`, not the filesystem. So external appends are invisible until the session is reopened.

## Implications for a third-party bridge process spawning `pi --mode rpc`
- Do **not** treat a shared session JSONL as a coordinated bus. There is no mutual exclusion, no “owned” state, and no merge on external change.
- If the bridge and another Pi process both write the same file, expect stale in-memory trees and possible interleaved or clobbered history.
- Safer pattern: dedicate a session file to the bridge, or fork/clone into a private session before concurrent use.

## File references
- `docs/sessions.md:7-18, 39-40, 71-72`
- `docs/session-format.md:3-27, 31-37`
- `docs/rpc.md:3-18, 162-193`
- `dist/core/session-manager.js:1-10, 531-557, 606-665, 868-885, 1079-1087`
- `dist/core/agent-session-runtime.js:125-139`
- `dist/modes/rpc/rpc-mode.js:340-355`
