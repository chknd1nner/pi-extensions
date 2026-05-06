# Current Delegate Tool Guidance

Extracted from `extensions/delegate/index.ts` — all `description`, `promptSnippet`, and `promptGuidelines` fields across all registered delegate tools.

---

## delegate_start

**description:** `"Spawn a worker agent as an isolated Pi RPC subprocess to execute a task."`

**promptSnippet:** `"Spawn a worker agent to execute a task in an isolated subprocess."`

**promptGuidelines:**
- Use delegate_start to offload tasks to a worker agent (code review, implementation, research).
- The worker runs as a separate Pi process with its own context window.
- Check progress with delegate_check, steer with delegate_steer, abort with delegate_abort, read result with delegate_result.
- Maximum 2 concurrent workers by default.

---

## delegate_check

**description:** `"Query the progress of a running or completed worker."`

**promptSnippet:** *(none)*

**promptGuidelines:** *(none)*

---

## delegate_steer

**description:** `"Send a steering message to a running worker. Delivered between turns."`

**promptSnippet:** *(none)*

**promptGuidelines:** *(none)*

---

## delegate_abort

**description:** `"Terminate a running worker. Sends RPC abort for clean shutdown, falls back to SIGTERM/SIGKILL."`

**promptSnippet:** *(none)*

**promptGuidelines:** *(none)*

---

## delegate_result

**description:** `"Read the final output of a completed worker."`

**promptSnippet:** *(none)*

**promptGuidelines:** *(none)*

---

## Summary

Only `delegate_start` has any guidance beyond its tool description. The other four tools (`delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_result`) have descriptions and parameter descriptions only — no `promptSnippet` or `promptGuidelines`.
