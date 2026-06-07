# delegate-driven-development

A Pi package bundling a subagent-driven workflow:

- **delegate** extension — RPC-driven worker spawning (`delegate_start`, `delegate_check`, `delegate_steer`, `delegate_result`, `delegate_abort`, `delegate_anchor`).
- **session** extension — session entry inspection (`session_entries`).
- **tickets** extension — ticket sharding and lifecycle (`ticket_shard`, `ticket_list`, `ticket_show`, `ticket_move`, `ticket_set`, `ticket_next`, `ticket_get`).
- **delegate-driven-development** skill — orchestrates implementer → reviewer → fixer per ticket using the three extensions above.

## Install

```jsonc
// .pi/settings.json
{
  "packages": [
    "git:github.com/chknd1nner/delegate-driven-development@v0.1.0"
  ]
}
```

Or via CLI:

```bash
pi install git:github.com/chknd1nner/delegate-driven-development@v0.1.0
```

To install just one extension from the bundle:

```jsonc
{
  "packages": [
    {
      "source": "git:github.com/chknd1nner/delegate-driven-development@v0.1.0",
      "extensions": ["extensions/delegate/index.ts"],
      "skills": []
    }
  ]
}
```

## Source

Development happens upstream at [chknd1nner/pi-extensions](https://github.com/chknd1nner/pi-extensions) under `packages/delegate-driven-development/`. This repo is a publish mirror; PRs welcome upstream.
