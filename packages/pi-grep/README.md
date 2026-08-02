# pi-grep

Activates Pi's built-in `grep` tool in ordinary sessions. It does **not** replace
or reimplement the tool: Pi's installed version continues to provide the schema,
`rg` execution, output truncation, cancellation, and renderer.

## Why

Pi already ships an `rg`-backed `grep` tool, but leaves it inactive in the
ordinary default tool set. With this package installed, repository content
searches can use that structured read-only tool instead of falling back to
`grep` or `rg` through Bash.

This is intentionally an activation-only first release. It does not add prompt
instructions, prohibit Bash searches, or activate `find` and `ls`.

## Install

```bash
pi install git:github.com/chknd1nner/pi-grep@v0.1.0
```

For the current development version:

```bash
pi install git:github.com/chknd1nner/pi-grep@main
```

Or add the package to project-local `.pi/settings.json`:

```json
{
  "packages": [
    "git:github.com/chknd1nner/pi-grep@v0.1.0"
  ]
}
```

## Built-in interface

The active tool searches file contents using regex or literal matching and
supports the installed Pi version's current options:

- `pattern` — required regex or literal pattern
- `path` — optional file or directory
- `glob` — optional file glob filter
- `ignoreCase` — optional case-insensitive matching
- `literal` — optional fixed-string matching
- `context` — optional symmetric context-line count
- `limit` — optional match limit

The exact schema and behavior follow the installed Pi version and may evolve
with it.

## Tool-selection controls

The extension only appends `grep` when Pi reports it as available. Existing
active tools and their order are preserved, and repeated session starts are
idempotent.

Pi's explicit selections remain authoritative:

- `--exclude-tools grep` prevents activation.
- An explicit `--tools` list must include `grep` for activation.
- `--no-tools` remains tool-free.
- `--no-builtin-tools` leaves Pi's built-in definitions available but inactive
  in the current Pi runtime, so this package intentionally reactivates `grep`.
  Combine it with `--exclude-tools grep` if that is not wanted.

To suppress it after installing the package, use `--exclude-tools grep` or
`--no-tools`.

## Development

```bash
npm test -w pi-grep
npm run typecheck -w pi-grep
```
