# AGENTS.md

This repository is for building and experimenting with Pi extensions.

Before starting any work on a Pi extension, consult the Pi documentation in `docs/pi/docs/` first. That path is a symlink to the installed `@mariozechner/pi-coding-agent` package docs.

## Tool usage notes

- `edit`: each `edits[]` entry accepts **only** `oldText` and `newText` (schema is `additionalProperties: false`). Never add extra keys like `newText2` or `_` — any stray key fails the entire call. To stage variants, finalize the value in `newText`; don't park drafts in extra fields.
