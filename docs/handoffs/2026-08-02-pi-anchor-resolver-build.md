# Handoff: build `pi-anchor-resolver` (living-spec anchor resolver tool)

**Date:** 2026-08-02
**Status of prior work:** Design COMPLETE and committed in the *radius* repo (Phase 1). This is Phase 2 — build the tool.
**Next goal:** implement `packages/pi-anchor-resolver/` — a Pi extension that resolves living-spec anchors to current code/test locations and surfaces drift.

> Cross-repo note: this tool is designed *for* the Radius project but *lives here* in `pi-extensions`.
> The authoritative design lives in the radius repo; you have read access to those paths from here.

## Authoritative design docs (read these first — radius repo, absolute paths)

- **Design spec (idea + tool):** `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/specs/2026-08-02-living-spec-layer-design.md`
  — §7 is the tool spec; Appendix A shows the intended usage/benefits.
- **Build recon (this repo's conventions, cited):** `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/research/2026-08-02-anchor-resolver-pi-extension-build-recon.md`
  — Part A = extracted `pi-extensions` conventions; Part B = the proposed package design.
- Background research (optional, for context on *why*):
  - `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/research/2026-08-02-structural-doc-to-code-anchoring-prior-art.md`
  - `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/research/2026-08-02-keeping-living-docs-current-methodologies.md`
  - `/Users/martinkuek/Documents/Projects/radius/docs/superpowers/research/2026-08-02-sdd-landscape-and-spec-first-failure-modes.md`

## What the tool does (one paragraph)

A "living spec" (`docs/living/*.md` in a consuming repo) describes how a system works *now*. Each
section is identified by **its heading slug** (`<domain>/<heading-slug>`, e.g. `daemon/session-lifecycle`).
A sidecar `docs/living/anchors.yml` maps `id → anchors[]`, where each anchor is either **`code:`** (an
ast-grep rule expected to match exactly one place) or **`behavior:`** (a stable `path::testName`
identifier). The tool resolves anchors to `{file, startLine, endLine, symbol}` locations for agents, and
reports **drift**: DANGLING (code anchor, 0 matches → likely rename), LOOSE (>1 match → rule too broad),
and unresolved behavior anchors. See spec Appendix A for the three agent use cases (orient, locate,
blast-radius) this enables.

## Decisions already settled (do NOT relitigate — from spec §7)

- **Package name:** `pi-anchor-resolver`.
- **One tool:** `anchor_resolve` (single verb + mode args). `promptGuidelines` must name it.
- **ast-grep via `@ast-grep/napi`** (in-process). The first pilot consumer (Radius daemon) is **pure
  TypeScript**, so napi's built-in TS grammar suffices — no native-language registration, no Swift
  concern for v1. Document a `@ast-grep/cli`-spawn fallback for a future Swift phase.
- **YAML:** add a `yaml` dependency (none in-repo today). `code:` anchors are ast-grep's native YAML rule
  object (`kind`/`has`/`inside` + `files`).
- **Stateless:** recompute each call. No `appendEntry`/session persistence in v1.
- **One registry:** `anchorsPath` default `docs/living/anchors.yml`; key `<domain>/<heading-slug>` implies
  the doc (`daemon` → `docs/living/daemon.md`); locate a section by slugifying that doc's headings.
- **Warnings-only for drift** (never throw). Throw only for unusable input.
- **Hard-error doc lint:** slugify every heading in a referenced living doc and **throw on duplicate slug
  within a doc** (ambiguous id). This is *slug*-level — stricter than `mdedit validate`'s text-level
  check. Heading enumeration MAY reuse `mdedit outline`, but a small Node heading scan is fine (note:
  `mdedit outline` has no `--json`, so its text output is brittle to parse — your call).

## Build shape (from recon Part B — mirror `packages/brightdata/`)

```
packages/pi-anchor-resolver/
  package.json      # "type":"module"; keywords pi-package/pi-extension; "pi":{"extensions":["./index.ts"]};
                    # Pi pkgs as peerDependencies:"*"; scripts test:"vitest run", typecheck
  tsconfig.json     # copy packages/pi-grep/tsconfig.json (Bundler res, vitest+node types, .js specifiers)
  README.md         # install section like packages/pi-grep/README.md
  index.ts          # default-export (pi)=>{ pi.registerTool({...}) }
  types.ts          # AnchorSpec, ResolvedAnchor, DriftReport
  anchors.ts        # load + validate anchors.yml (defensive, like brightdata/config.ts)
  resolve-code.ts   # @ast-grep/napi resolution → {file,startLine,endLine,symbol}
  resolve-behavior.ts # path::testName → best-effort location (grep); else unresolved
  drift.ts          # DANGLING / LOOSE / unresolvedBehavior classification (pure)
  doc-lint.ts       # heading slugify + duplicate-slug detection (throws)
  render.ts         # renderCall/renderResult (@earendil-works/pi-tui), like brightdata/render.ts
  tests/
    anchors.test.ts resolve-code.test.ts drift.test.ts doc-lint.test.ts index.test.ts
    fixtures/ts/...  (+ a sample anchors.yml + a sample living doc)
```

**Input schema (TypeBox, `StringEnum` from `@earendil-works/pi-ai`):**
`mode` (`full|changed|section`), `anchorsPath` (default `docs/living/anchors.yml`), `changed` (string[]),
`section` (string), `report` (bool, default true). Every field described.

**Output:** `content[0].text` = compact markdown drift report; `details` =
```
{ responseId,
  sections: Record<id, { type:"code"|"behavior"|"mixed",
                         locations:[{file,startLine,endLine,symbol?}] }>,
  drift: { dangling:[{section,anchor}], loose:[{section,anchor,count}],
           unresolvedBehavior:[{section,id}] } }
```

**Modes:** `full` (resolve all → JSON + report); `changed <files…>` (only sections whose anchors resolve
into those files — pre-planning retrieval); `section <id>`.

## How to run Phase 2 (methodology)

1. **Read** the spec §7 + Appendix A and the recon note (paths above).
2. **Write an implementation plan** (`writing-plans` skill) — small, task-sharded, TDD-first. The recon's
   "files to create/modify" + testing section is your task seed.
3. **Execute TDD** (Vitest-first, per `packages/brightdata/tests/` patterns: fake-`ExtensionAPI`
   registration test; TS fixtures; rename→DANGLING, over-broad→LOOSE(count), malformed yaml→throw,
   duplicate-slug→throw; full branch coverage of `drift.ts`/`doc-lint.ts`/`anchors.ts`). Consider
   delegate-driven-development for the plan.
4. **Verify** with real `npm test -w pi-anchor-resolver` + `npm run typecheck -w pi-anchor-resolver`.
5. **Deps:** add `@ast-grep/napi` + `yaml` to the package `dependencies` AND root `devDependencies`
   (hoisting; `.npmrc` install-strategy=hoisted). NOTE: `@ast-grep/napi` is the repo's **first native /
   prebuilt-binary dependency** — verify root `npm install` resolves prebuilts cleanly and the package
   stays installable on its own.
6. **Wiring/dogfood:** local `../packages/pi-anchor-resolver` in `.pi/settings.json` during dev; before
   Radius consumes it, release via the mirror (`git:github.com/chknd1nner/pi-anchor-resolver@vX`) per
   `docs/agents/releasing-a-bundle.md`.

## Open questions to decide at build time

1. **`behavior:` id resolution granularity** — is best-effort grep for the test name enough for v1, or do
   you want a `describe`/`it`-title ast-grep pass? (Spec says grep is fine for v1.)
2. **`mdedit` reuse vs. self-parse** for heading enumeration in `doc-lint.ts` (no `--json` on `mdedit
   outline`; a Node `^#+ ` scan may be simpler/robust).
3. **Symbol extraction** — what to put in `symbol` for a `code:` match (nearest named ancestor?).
4. **`changed` matching** — exact file path match, or also directory globs?

## Definition of done (v1)

`anchor_resolve` registered and working against a TS fixture: resolves code+behavior anchors to precise
locations; `--changed` filters sections by file; drift report classifies dangling/loose/unresolved;
duplicate heading-slug throws; all tests + typecheck green; README documents install + the three usage
modes. Then update the Radius spec's success criteria by dogfooding on `docs/living/daemon.md` (Phase 3).
