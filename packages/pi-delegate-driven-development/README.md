# pi-delegate-driven-development

A Pi package bundling a subagent-driven workflow:

- **delegate** extension — RPC-driven worker spawning (`delegate_start`, `delegate_check`, `delegate_steer`, `delegate_result`, `delegate_abort`, `delegate_anchor`, `delegate_pack`). `delegate_pack` freezes files (e.g. spec + plan) into a reusable context pack consumed via `delegate_start({ context_pack })`; `system_prompt_file` loads role prompts from disk at spawn time.
- **session** extension — session entry inspection (`session_entries`).
- **tickets** extension — ticket sharding and lifecycle (`ticket_shard`, `ticket_list`, `ticket_show`, `ticket_move`, `ticket_set`, `ticket_next`, `ticket_get`).
- **delegate-driven-development** skill — orchestrates implementer → reviewer → fixer per ticket using the three extensions above.

## Install

```jsonc
// .pi/settings.json
{
  "packages": [
    "git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.2"
  ]
}
```

Or via CLI:

```bash
pi install git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.2
```

To install just one extension from the bundle:

```jsonc
{
  "packages": [
    {
      "source": "git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.2",
      "extensions": ["extensions/delegate/index.ts"],
      "skills": []
    }
  ]
}
```

## Delegate worker concurrency

The delegate extension allows up to five concurrent workers by default. Set
`DELEGATE_MAX_WORKERS` to a positive integer before starting Pi to override the
limit:

```bash
DELEGATE_MAX_WORKERS=8 pi
```

Unset, empty, invalid, and non-positive values fall back to the default of five.

## Delegate worker monitoring

`delegate_start` returns worker artifact paths and a self-contained status-file wait recipe:

- `details.progress_file` / `details.progress_file_relative` — append-only markdown progress log. Worker text and `[TOOL: name]` lines are interleaved with lifecycle markers: `[RETRY 1/3 in 2000ms: 529 overloaded]` when π schedules an automatic retry, `[RETRY succeeded on retry 2]` or `[RETRY gave up after 3 retries: <error>]` when it resolves, `[COMPACT overflow: summarizing context]` and `[COMPACT done: 150000 → 32000 tokens, resuming interrupted turn]` around automatic compaction, and `[FAILED] <error>` when the worker ends as failed.
- `details.status_file` / `details.status_file_relative` — machine-readable lifecycle status file. A worker is finalized when π reports `agent_settled`, not at the end of the first low-level run, so automatic retries, overflow recovery, and queued follow-up work all continue. Events arriving after settle are ignored. When a worker fails, `delegate_check` and `delegate_result` report the reason — the assistant error message if the model produced one, otherwise the worker's stderr — collapsed to a single line and capped at 500 characters. A prompt rejected before acceptance (bad model, missing credentials) fails immediately with that reason rather than running until its timeout.
- `details.watch.command` — the only watcher. A Bash command that waits for the status file to hold one of `completed`, `failed`, or `aborted`, then emits `DELEGATE_WATCH_DONE task_id=<id> status=<s>` (exit 0) or, on timeout, `DELEGATE_WATCH_TIMEOUT task_id=<id> last=<last observed state>` (exit 124). The status file holds exactly one of `running | completed | failed | aborted` and never a timeout state — a timeout exists only in the sentinel line, while the file still reads `running`.

If an async/background command runner is available, run `details.watch.command` there and watch for `DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT`. If not, run the same command in a shell; it blocks, but avoids frequent `delegate_check` polling. After any sentinel or timeout, call `delegate_check` once because in-memory delegate state is authoritative.

`delegate_check` reports `last_activity_seconds_ago`, which measures process liveness: the last event π sent, including retry and compaction bookkeeping. Terminal events (`agent_end`, `agent_settled`) do not count, so a finished worker's idle time keeps growing from its last real output. A small value means the worker process is still talking, not that it is producing visible text.

## Source

Development happens upstream at [chknd1nner/pi-extensions](https://github.com/chknd1nner/pi-extensions) under `packages/pi-delegate-driven-development/`. This repo is a publish mirror; PRs welcome upstream.
