# pi-anchor-resolver

A Pi tool that resolves **living-spec anchors** to current code/test locations and reports drift.

A "living spec" (`docs/living/*.md`) describes how a system works now. Each section id is
`<domain>/<heading-slug>` (the domain is the doc stem, the slug is the GitHub heading slug). A sidecar
`docs/living/anchors.yml` maps `id → anchors[]`, where each anchor is either:

- `code:` — an ast-grep rule expected to match exactly one place (0 → dangling, >1 → loose);
- `behavior:` — a stable `path::testName` identifier resolved best-effort by grep.

## Tool: `anchor_resolve`

| param | type | default | meaning |
| --- | --- | --- | --- |
| `mode` | `full` \| `changed` \| `section` | — | which sections to resolve |
| `anchorsPath` | string | `docs/living/anchors.yml` | registry path (relative to cwd) |
| `changed` | string[] | — | for `changed`: sections resolving into these files |
| `section` | string | — | for `section`: a single `<domain>/<slug>` id |
| `report` | bool | `true` | include the markdown drift report as text |

### Modes

- **full** — resolve all sections → sections map + drift report.
- **changed `<files…>`** — only sections whose anchors resolve into these files (pre-planning retrieval).
- **section `<id>`** — resolve one section.

Drift is **warnings-only**. The tool throws only for unusable input: missing/malformed `anchors.yml`, a
bad id shape, unknown language, unknown section id in `section` mode, a referenced living doc that does
not exist, a section id whose slug is not an actual heading in its doc, or a **duplicate heading-slug**
within a doc (the spec's sole hard constraint). "The heading *is* the id," so a key that maps to no real
heading is treated as unusable config rather than silently-clean drift.

### anchors.yml example

```yaml
daemon/session-lifecycle:
  - code:
      language: typescript
      rule: { kind: class_declaration, has: { field: name, regex: '^SessionTimeline$' } }
      files: ["apps/radius/daemon/src/**/*.ts"]
daemon/reducer-determinism:
  - behavior: "apps/radius/daemon/test/reducer.test.ts::deterministic replay"
```

## Language support

v1 uses `@ast-grep/napi`'s built-in grammars (TypeScript/TSX/JavaScript) in-process. A future Swift phase
can add a `@ast-grep/cli`-spawn fallback for languages napi does not bundle.

## Install

**Requires the `mdedit` CLI on `PATH`.** Heading/anchor identity is delegated to mdedit (not reimplemented
in JS): build it from source (`cargo install --path .` in the mdedit repo) so `mdedit headings <doc> --json`
works. The tool feature-detects mdedit at runtime and errors clearly if it is missing or too old.

Add to `.pi/settings.json`:

```json
{ "packages": ["git:github.com/chknd1nner/pi-anchor-resolver@v0.1.0"] }
```

During local development, point at the workspace copy instead:

```json
{ "packages": ["../packages/pi-anchor-resolver"] }
```

## Development

```bash
npm test -w pi-anchor-resolver
npm run typecheck -w pi-anchor-resolver
```
