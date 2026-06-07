# agent-switcher

A global Pi extension adding `/agent` — swap the persona that backs
`.pi/SYSTEM.md` (the "soul doc") without editing files by hand.

## How it works

`.pi/SYSTEM.md` is a **symlink** into an agent persona file. Pi reads it raw as
the system prompt, so the symlink is a transparent pipe: whatever the link
points at *is* the prompt.

- **Persona files** are plain `*.md` discovered from two scopes:
  - project: `<cwd>/.pi/agents/*.md`
  - home (global): `~/.pi/agent/agents/*.md`
- **`/agent`** opens a picker. Selecting an agent atomically repoints the
  symlink at it (relative target for project agents, absolute for home agents).
- **`default`** is a synthetic entry: it *removes* `.pi/SYSTEM.md` so the
  harness falls through to its built-in prompt (or `~/.pi/agent/SYSTEM.md`).
- **`/agent <name>`** switches directly without the menu.
- Changes apply on the next system-prompt build, so the command offers to
  `/reload` for you (or use `/new`).

## Descriptions (sidecar, not frontmatter)

Optional per-scope `agents.json` supplies one-line descriptions for the picker:

```json
{ "pyrite": { "desc": "twisted, devoted creative + info assistant" } }
```

This file is read **only by the extension**, never by Pi — so descriptions
never leak into the prompt. (Frontmatter inside a linked `.md` *would* leak,
because Pi `readFileSync`s the file verbatim with no parsing.)

## Safety

- Atomic swap (temp symlink + rename) — `SYSTEM.md` is never half-written.
- If `SYSTEM.md` is ever an unmanaged *real file*, it is backed up to
  `SYSTEM.md.bak-<timestamp>` before being replaced or removed.

## Dependencies

Runtime: **none** — only node built-ins; the type import is erased on load.
The workspace root (`~/.pi/agent/extensions/package.json`) provides the
toolchain for `npm run typecheck` / `npm test` only.
