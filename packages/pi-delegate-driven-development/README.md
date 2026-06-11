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
    "git:github.com/chknd1nner/pi-delegate-driven-development@v0.1.0"
  ]
}
```

Or via CLI:

```bash
pi install git:github.com/chknd1nner/pi-delegate-driven-development@v0.1.0
```

To install just one extension from the bundle:

```jsonc
{
  "packages": [
    {
      "source": "git:github.com/chknd1nner/pi-delegate-driven-development@v0.1.0",
      "extensions": ["extensions/delegate/index.ts"],
      "skills": []
    }
  ]
}
```

## Delegate worker monitoring

`delegate_start` returns worker artifact paths and a self-contained status-file wait recipe:

- `details.progress_file` / `details.progress_file_relative` — append-only markdown progress log.
- `details.status_file` / `details.status_file_relative` — machine-readable lifecycle status file.
- `details.watch.command` — Bash command that waits for `completed`, `failed`, or `aborted` status and emits `DELEGATE_WATCH_DONE` or `DELEGATE_WATCH_TIMEOUT`.

If an async/background command runner is available, run `details.watch.command` there and watch for `DELEGATE_WATCH_DONE|DELEGATE_WATCH_TIMEOUT`. If not, run the same command in a shell; it blocks, but avoids frequent `delegate_check` polling. After any sentinel or timeout, call `delegate_check` once because in-memory delegate state is authoritative.

## Source

Development happens upstream at [chknd1nner/pi-extensions](https://github.com/chknd1nner/pi-extensions) under `packages/pi-delegate-driven-development/`. This repo is a publish mirror; PRs welcome upstream.
