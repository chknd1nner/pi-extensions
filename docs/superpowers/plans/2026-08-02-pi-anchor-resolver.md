# pi-anchor-resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/pi-anchor-resolver/` — a Pi extension exposing one tool `anchor_resolve` that resolves living-spec anchors (`docs/living/anchors.yml`) to precise code/test locations and reports drift (dangling / loose / unresolved-behavior).

**Architecture:** A stateless tool. Each call: load + validate `anchors.yml`, lint referenced living docs for duplicate heading-slugs (hard error), resolve each section's anchors — `code:` anchors via `@ast-grep/napi` structural match over globbed files, `behavior:` anchors via best-effort grep of `path::testName` — then classify drift with pure functions and render a compact markdown report. No session persistence; recompute every call.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers, Bundler resolution), Vitest, `@ast-grep/napi` (in-process TS grammar), `yaml`, `mdast-util-from-markdown` + `mdast-util-to-string` + `github-slugger` (GitHub-exact heading identity), Node built-in `fs.globSync`. Pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`) as `peerDependencies:"*"`.

## Global Constraints

- Package name: `pi-anchor-resolver`. One tool only: `anchor_resolve`. `promptGuidelines` MUST name the tool.
- Warnings-only for drift: NEVER throw for dangling/loose/unresolved. Throw ONLY for unusable input (missing/malformed `anchors.yml`, unknown language, unknown section id in `section` mode, duplicate heading-slug).
- Section id = `<domain>/<heading-slug>`; domain (`daemon`) implies doc `docs/living/daemon.md`. Slug uniqueness within a doc is the sole hard constraint from the spec.
- Stateless: no `pi.appendEntry`, no `session_start` restore.
- ast-grep via `@ast-grep/napi` in-process (TS-only pilot; napi's built-in TS grammar suffices). Document a `@ast-grep/cli`-spawn fallback for a future Swift phase in the README only.
- Line numbers in output are 1-indexed (napi `range()` is 0-indexed → add 1).
- Node engine floor `>=22` (for `fs.globSync`). Add `"engines": { "node": ">=22" }`.
- Deps: `@ast-grep/napi@^0.45.0`, `yaml@^2.9.0`, `github-slugger@^2.0.0`, `mdast-util-from-markdown@^2.0.3`, `mdast-util-to-string@^4.0.0` in the package `dependencies` AND root `devDependencies` (all already added to the root during de-risking; keep them). All but `@ast-grep/napi` are pure JS. Do not create a per-package lockfile.
- **Do not hand-roll CommonMark.** Heading identity is derived with the real parser (`mdast-util-from-markdown` + `mdast-util-to-string`) and the real slugger (`github-slugger`). Hand-rolled regex scanning was tried and rejected: it kept producing wrong ids for fence runs, indented code, setext-vs-thematic-break, list interruption, and emphasis-delimiter runs.
- `package.json`: `"type":"module"`, `keywords:["pi-package","pi-extension",…]`, `"license":"MIT"`, `"pi":{"extensions":["./index.ts"]}`, `files:["*.ts","README.md"]`, scripts `test:"vitest run"` / `typecheck:"tsc --noEmit -p tsconfig.json"`.
- Copy `packages/pi-grep/tsconfig.json` **verbatim** (ES2022, ESNext, Bundler, strict, `types:["vitest/globals","node"]`, `include:["*.ts","tests/**/*.ts"]`). Do NOT add `resolveJsonModule`; tests that need `package.json` read it via `node:fs` + `JSON.parse`, not an import assertion.
- Registration exemplar is `packages/brightdata/`. Registration test uses a hand-rolled fake `ExtensionAPI` cast `as unknown as ExtensionAPI`. Temp dirs via `mkdtempSync(tmpdir())` cleaned in `afterEach`.
- **Wire `details` as a fresh object literal**, never a named-interface variable. Returning a variable typed as `ResolveResult` for `details` fails typecheck against the renderer's `Record<string, unknown>` parameter; a fresh literal `{ responseId, sections, drift }` is assignable (this is exactly the brightdata pattern).
- **Registry integrity is throw-on-unusable, not drift.** Warnings-only applies to *anchor resolution* (code/behavior). Structural problems — malformed/missing `anchors.yml`, bad id shape, unknown `language`, a referenced living doc that does not exist, a section id whose slug is not an actual heading in its doc, or a duplicate heading-slug — all THROW. Rationale: “the heading *is* the id” (spec §5), so a key that maps to no real heading is unusable config, and silently reporting it as clean drift would hide a rename.
- **Path handling:** never build paths by string concatenation. Use `node:path` (`join`/`resolve`/`relative`) and compare repo-relative paths in POSIX form.

---

## Shared Interfaces (worker-visible contract)

> This section is part of every task's implicit context. A worker sees only its own task plus Global Constraints + this block, so every cross-module type and signature a task consumes or produces is defined here **once**, canonically. Where a task's own Interfaces block repeats a signature, it must match this section exactly.

**`types.ts` (Task 2) — all shared data types:**
```ts
export interface CodeAnchor { language: string; rule: Record<string, unknown>; files: string[]; }
export interface BehaviorAnchor { raw: string; path: string; testName: string; }
export type Anchor =
  | { kind: "code"; label: string; code: CodeAnchor }
  | { kind: "behavior"; label: string; behavior: BehaviorAnchor };
export interface AnchorRegistry { sections: Map<string, Anchor[]>; }
export interface ResolvedLocation { file: string; startLine: number; endLine: number; symbol?: string; }
export interface ResolvedSection { type: "code" | "behavior" | "mixed"; locations: ResolvedLocation[]; }
export interface AnchorResolution { section: string; anchor: Anchor; locations: ResolvedLocation[]; }
export interface DriftReport {
  dangling: Array<{ section: string; anchor: string }>;
  loose: Array<{ section: string; anchor: string; count: number }>;
  unresolvedBehavior: Array<{ section: string; id: string }>;
}
export interface ResolveResult { responseId: string; sections: Record<string, ResolvedSection>; drift: DriftReport; }
export type ResolveMode = "full" | "changed" | "section";
```

**Cross-module function signatures (producer task in parentheses):**
```ts
// doc-lint.ts (Task 2)
export function slugify(heading: string): string;               // github-slugger over ALREADY-RENDERED text; fresh slugger per call (no -1 dedupe)
export function enumerateHeadings(markdown: string): string[];  // real CommonMark parse; rendered heading text, document order
export function lintDoc(markdown: string, docLabel: string): void; // THROWS on duplicate heading-slug
export function headingSlugs(markdown: string): Set<string>;    // slugs of every heading, for id↔heading checks

// anchors.ts (Task 3)
export function loadAnchors(absPath: string): AnchorRegistry;   // THROWS on any unusable registry (see Task 3)

// resolve-code.ts (Task 4)
export function languageToLang(language: string): Lang;         // Lang from "@ast-grep/napi"; THROWS on unknown
export function resolveCodeAnchor(anchor: CodeAnchor, cwd: string): ResolvedLocation[]; // 1-indexed lines; repo-relative file

// resolve-behavior.ts (Task 5)
export function resolveBehaviorAnchor(anchor: BehaviorAnchor, cwd: string): ResolvedLocation | null;

// drift.ts (Task 6)
export function classifyDrift(resolutions: AnchorResolution[]): DriftReport;              // pure
export function buildSections(resolutions: AnchorResolution[]): Record<string, ResolvedSection>; // pure
export function formatReport(result: ResolveResult): string;                              // pure, uncapped (index.ts caps the tool text)

// resolve.ts (Task 7)
export interface RunResolveParams { mode: ResolveMode; anchorsPath?: string; changed?: string[]; section?: string; }
export function generateResponseId(): string;                                             // "anchor_<uuid>"
export function runResolve(params: RunResolveParams, cwd: string): ResolveResult;         // THROWS on unusable registry/doc

// render.ts (Task 8)
export function renderCall(args: { mode?: unknown; section?: unknown; changed?: unknown }, theme: { fg: (c: any, t: string) => string; bold: (t: string) => string }): unknown;
export function renderResult(result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> }, options: { expanded?: boolean; isPartial?: boolean }, theme: { fg: (c: any, t: string) => string }): unknown;
```

**Contract notes every consumer relies on:**
- `loadAnchors` guarantees each `Anchor` is well-formed: a `code` anchor has non-empty `language`, an object (non-array) `rule`, and a non-empty `files` array of non-empty, **repo-relative** globs; a `behavior` anchor has non-empty `path` + `testName`. Section arrays are non-empty. Every id has the shape `<domain>/<slug>` (exactly two non-empty `/`-separated segments).
- `resolveCodeAnchor` emits one `ResolvedLocation` per match (0 = dangling, >1 = loose, decided later in `drift.ts`); `file` is repo-relative POSIX; `symbol` is the match's `name` field when present.
- `resolveBehaviorAnchor` returns `null` when the file is missing or the test name is not found (→ `unresolvedBehavior`).
- `runResolve` performs registry-integrity checks (throwing) before resolving; drift is warnings-only.

---

## File Structure

```
packages/pi-anchor-resolver/
  package.json        # manifest, deps, scripts (Task 1)
  tsconfig.json       # copy of pi-grep tsconfig (Task 1)
  README.md           # install + 3 usage modes + CLI-fallback note (Task 1 stub, Task 8 fill)
  types.ts            # shared interfaces (Task 2)
  doc-lint.ts         # slugify / enumerateHeadings / lintDoc / headingSlugs (Task 2)
  anchors.ts          # loadAnchors: read + parse + validate anchors.yml (Task 3)
  resolve-code.ts     # languageToLang + resolveCodeAnchor via @ast-grep/napi (Task 4)
  resolve-behavior.ts # resolveBehaviorAnchor via grep (Task 5)
  drift.ts            # classifyDrift / buildSections / formatReport (pure) (Task 6)
  resolve.ts          # runResolve orchestrator, all 3 modes (Task 7)
  render.ts           # renderCall / renderResult (@earendil-works/pi-tui) (Task 8)
  index.ts            # default export, registerTool("anchor_resolve") (Task 8)
  tests/
    doc-lint.test.ts       (Task 2)
    anchors.test.ts        (Task 3)
    resolve-code.test.ts   (Task 4)
    resolve-behavior.test.ts (Task 5)
    drift.test.ts          (Task 6)
    resolve.test.ts        (Task 7)
    index.test.ts          (Task 8)
    fixtures/ts/…          (Task 4/7 fixtures + anchors.yml + living doc)
```

Root files touched: `.pi/settings.json` (local dogfood package, Task 8 — uncommitted). Root `package.json` + `package-lock.json` already carry all five runtime deps — `@ast-grep/napi`, `yaml`, `github-slugger`, `mdast-util-from-markdown`, `mdast-util-to-string` (added during de-risking); confirm, do not duplicate.

---

### Task 1: Package scaffolding

**Files:**
- Create: `packages/pi-anchor-resolver/package.json`
- Create: `packages/pi-anchor-resolver/tsconfig.json`
- Create: `packages/pi-anchor-resolver/README.md` (stub)
- Create: `packages/pi-anchor-resolver/index.ts` (temporary trivial export, replaced in Task 8)
- Test: `packages/pi-anchor-resolver/tests/scaffold.test.ts` (temporary; deleted in Task 8)

**Interfaces:**
- Produces: an installable package whose `vitest run` and `tsc --noEmit` both succeed. Later tasks add modules under this package.

- [ ] **Step 1: Write the failing test**

`packages/pi-anchor-resolver/tests/scaffold.test.ts` (reads `package.json` via `node:fs` so tsconfig stays verbatim — no `resolveJsonModule`):
```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

describe("pi-anchor-resolver package", () => {
  it("declares the anchor_resolve extension manifest", () => {
    expect(pkg.name).toBe("pi-anchor-resolver");
    expect(pkg.pi.extensions).toEqual(["./index.ts"]);
    expect(pkg.dependencies["@ast-grep/napi"]).toBeDefined();
    expect(pkg.dependencies.yaml).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver`
Expected: FAIL — package.json / workspace does not exist yet.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "pi-anchor-resolver",
  "version": "0.1.0",
  "description": "Resolve living-spec anchors to current code/test locations and report drift, as a Pi tool.",
  "keywords": ["pi-package", "pi-extension", "ast-grep", "living-spec", "anchors"],
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=22" },
  "files": ["*.ts", "README.md"],
  "pi": { "extensions": ["./index.ts"] },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@ast-grep/napi": "^0.45.0",
    "github-slugger": "^2.0.0",
    "mdast-util-from-markdown": "^2.0.3",
    "mdast-util-to-string": "^4.0.0",
    "yaml": "^2.9.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

**No package-level `devDependencies`.** Per AGENTS.md, Pi-provided packages go in `peerDependencies: "*"`,
and tooling (`typescript`, `vitest`) plus the development install live only in the ROOT `package.json`
(follow `packages/pi-grep/package.json`, not the older `packages/brightdata/package.json`, which predates
this policy). `@ast-grep/napi` and `yaml` are real runtime imports, so they belong in this package's
`dependencies` for packaging **and** in root `devDependencies` for local dedup — both were already added
to the root during de-risking, so no further root change is needed.

- [ ] **Step 4: Create `tsconfig.json`** (verbatim copy of `packages/pi-grep/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 5: Create temporary `index.ts`**

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function anchorResolverExtension(_pi: ExtensionAPI): void {
  // Replaced in Task 8.
}
```

- [ ] **Step 6: Create README stub**

```markdown
# pi-anchor-resolver

Resolve living-spec anchors to current code/test locations and report drift, as a Pi tool. (WIP)
```

- [ ] **Step 7: Install workspace + run tests**

Run: `npm install && npm test -w pi-anchor-resolver && npm run typecheck -w pi-anchor-resolver`
Expected: install adds the new workspace; scaffold test PASSES; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/pi-anchor-resolver package.json package-lock.json
git commit -m "feat(anchor-resolver): scaffold pi-anchor-resolver package"
```

---

### Task 2: Types + doc-lint

**Files:**
- Create: `packages/pi-anchor-resolver/types.ts`
- Create: `packages/pi-anchor-resolver/doc-lint.ts`
- Test: `packages/pi-anchor-resolver/tests/doc-lint.test.ts`

**Interfaces:**
- Produces (`types.ts`):
```ts
export interface CodeAnchor { language: string; rule: Record<string, unknown>; files: string[]; }
export interface BehaviorAnchor { raw: string; path: string; testName: string; }
export type Anchor =
  | { kind: "code"; label: string; code: CodeAnchor }
  | { kind: "behavior"; label: string; behavior: BehaviorAnchor };
export interface AnchorRegistry { sections: Map<string, Anchor[]>; }
export interface ResolvedLocation { file: string; startLine: number; endLine: number; symbol?: string; }
export interface ResolvedSection { type: "code" | "behavior" | "mixed"; locations: ResolvedLocation[]; }
export interface AnchorResolution { section: string; anchor: Anchor; locations: ResolvedLocation[]; }
export interface DriftReport {
  dangling: Array<{ section: string; anchor: string }>;
  loose: Array<{ section: string; anchor: string; count: number }>;
  unresolvedBehavior: Array<{ section: string; id: string }>;
}
export interface ResolveResult { responseId: string; sections: Record<string, ResolvedSection>; drift: DriftReport; }
export type ResolveMode = "full" | "changed" | "section";
```
- Produces (`doc-lint.ts`): `slugify(heading: string): string`, `enumerateHeadings(markdown: string): string[]`, `lintDoc(markdown: string, docLabel: string): void`, `headingSlugs(markdown: string): Set<string>` (used by Task 7 for id↔heading checks). See Shared Interfaces for the canonical signatures.
- Consumes: `github-slugger`, `mdast-util-from-markdown`, `mdast-util-to-string`. **Division of labour:** `enumerateHeadings` resolves markdown → rendered heading text (links→label, code→contents, emphasis stripped); `slugify` is then pure `github-slugger`. Do not re-implement either half by hand.

- [ ] **Step 1: Write the failing test**

`packages/pi-anchor-resolver/tests/doc-lint.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { slugify, enumerateHeadings, lintDoc, headingSlugs } from "../doc-lint.js";

// slugify is exactly github-slugger over ALREADY-RENDERED heading text.
// Inline markdown is resolved earlier, by enumerateHeadings.
describe("slugify", () => {
  it("lowercases, drops punctuation, hyphenates spaces without collapsing runs", () => {
    expect(slugify("Session Lifecycle")).toBe("session-lifecycle");
    expect(slugify("Reducer: Determinism!")).toBe("reducer-determinism");
    expect(slugify("Multiple   Spaces")).toBe("multiple---spaces");
  });
  it("preserves underscores and authored hyphen runs", () => {
    expect(slugify("foo_bar")).toBe("foo_bar");
    expect(slugify("session_id lookup")).toBe("session_id-lookup");
    expect(slugify("foo_bar_baz")).toBe("foo_bar_baz");
    expect(slugify("foo__bar__")).toBe("foo__bar__");
    expect(slugify("foo--bar")).toBe("foo--bar");
  });
  it("preserves Unicode letters and digits", () => {
    expect(slugify("café résumé")).toBe("café-résumé");
    expect(slugify("Phase 2")).toBe("phase-2");
  });
  it("does not dedupe across calls (a fresh slugger per call)", () => {
    expect(slugify("Same")).toBe("same");
    expect(slugify("Same")).toBe("same"); // NOT "same-1"
  });
});

describe("enumerateHeadings", () => {
  it("returns ATX heading text and ignores headings inside fenced code", () => {
    const md = ["# Title", "text", "## Session Lifecycle", "```", "## Not A Heading", "```", "### Reducer"].join("\n");
    expect(enumerateHeadings(md)).toEqual(["Title", "Session Lifecycle", "Reducer"]);
  });
  it("does not let a ~~~ line close a ``` fence (fence char must match)", () => {
    const md = ["```", "~~~", "## Still In Code", "```", "## Real Heading"].join("\n");
    expect(enumerateHeadings(md)).toEqual(["Real Heading"]);
  });
  it("does not let a shorter backtick run close a longer opener", () => {
    const md = ["````", "```", "## Still In Code", "````", "## Real Heading"].join("\n");
    expect(enumerateHeadings(md)).toEqual(["Real Heading"]);
  });
  it("renders inline markdown to text (links, code, emphasis, nested runs)", () => {
    expect(enumerateHeadings("## [Session](#details)")).toEqual(["Session"]);
    expect(enumerateHeadings("## `openSession` flow")).toEqual(["openSession flow"]);
    expect(enumerateHeadings("## **Bold** _text_")).toEqual(["Bold text"]);
    expect(enumerateHeadings("## __Strong__ here")).toEqual(["Strong here"]);
    expect(enumerateHeadings("## ____Strong____ here")).toEqual(["Strong here"]);
  });
  it("drops raw inline HTML tags, keeping their text (GitHub renders them)", () => {
    expect(enumerateHeadings("## A <span>HTML</span> heading")).toEqual(["A HTML heading"]);
  });
  it("finds headings nested in block quotes and list items, in document order", () => {
    expect(enumerateHeadings("> ## Quoted *Heading*")).toEqual(["Quoted Heading"]);
    expect(enumerateHeadings("- # Listed `Heading`")).toEqual(["Listed Heading"]);
    expect(enumerateHeadings("> Quoted Setext\n> ===")).toEqual(["Quoted Setext"]);
    expect(enumerateHeadings("# A\n\n> ## B\n\n### C")).toEqual(["A", "B", "C"]);
  });
  it("recognizes ATX indented up to three spaces and setext headings", () => {
    expect(enumerateHeadings("   ## Indented")).toEqual(["Indented"]);
    expect(enumerateHeadings("Setext Title\n===\n\nBody\n\nSub\n---")).toEqual(["Setext Title", "Sub"]);
  });
  it("keeps a multiline setext heading's line break in its text", () => {
    expect(enumerateHeadings("Line One\nLine Two\n===")).toEqual(["Line One\nLine Two"]);
  });
  it("distinguishes setext underlines from thematic breaks and other blocks", () => {
    expect(enumerateHeadings("    code line\n---")).toEqual([]);      // indented code, then rule
    expect(enumerateHeadings("# Real\n\n---\n\n# Also Real")).toEqual(["Real", "Also Real"]);
    expect(enumerateHeadings("---\nText\n---")).toEqual(["Text"]);    // leading rule is not text
    expect(enumerateHeadings("===\nText\n---")).toEqual(["===\nText"]); // `===` is NOT a rule
    expect(enumerateHeadings("- item\n---")).toEqual([]);             // list, then rule
  });
});

describe("lintDoc", () => {
  it("passes when all heading slugs are unique", () => {
    expect(() => lintDoc("# One\n## Two Words\n", "daemon.md")).not.toThrow();
  });
  it("throws on duplicate heading-slug within a doc (distinct text, same slug)", () => {
    expect(() => lintDoc("## Session Lifecycle\n## session lifecycle\n", "daemon.md"))
      .toThrow(/duplicate heading slug/i);
  });
  it("detects duplicates across nesting levels and raw-HTML spellings", () => {
    expect(() => lintDoc("> ## Same\n\n## same", "daemon.md")).toThrow(/duplicate heading slug/i);
    expect(() => lintDoc("## <span>Same</span>\n\n## Same", "daemon.md")).toThrow(/duplicate heading slug/i);
  });
});

describe("headingSlugs", () => {
  it("returns the slug set for every heading", () => {
    expect(headingSlugs("# Daemon\n## Session Lifecycle")).toEqual(new Set(["daemon", "session-lifecycle"]));
  });
  it("composes rendering + slugging the way GitHub does", () => {
    expect(headingSlugs("## __Strong__ here")).toEqual(new Set(["strong-here"]));
    expect(headingSlugs("## `openSession` flow")).toEqual(new Set(["opensession-flow"]));
    expect(headingSlugs("## [Session](#details)")).toEqual(new Set(["session"]));
    expect(headingSlugs("## A <span>HTML</span> heading")).toEqual(new Set(["a-html-heading"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- doc-lint`
Expected: FAIL — `../doc-lint.js` not found.

- [ ] **Step 3: Write `types.ts`** (exact content from the Shared Interfaces `types.ts` block above).

- [ ] **Step 4: Write `doc-lint.ts`**

```ts
import GithubSlugger from "github-slugger";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

// Heading identity must match GitHub exactly, because a section id IS the heading
// anchor an author sees. Rather than hand-roll CommonMark (fences, indented code,
// setext underlines vs thematic breaks, list interruption, emphasis-delimiter runs),
// we use the real parser + the real slugger. See Global Constraints for why.

// EVERY heading in document order, as RENDERED text (inline markdown resolved:
// links -> label, code -> contents, emphasis stripped, raw HTML tags dropped).
// Code blocks are never headings because the parser, not a regex, decides what a
// heading is.
//
// Two subtleties, both load-bearing:
//  1. Recursive walk, not `tree.children`: CommonMark allows headings inside
//     block quotes and list items (`> ## Quoted`, `- # Listed`). A root-only scan
//     silently drops them, which would reject valid ids and miss duplicates.
//     Depth-first pre-order preserves document order.
//  2. `includeHtml: false`: mdast-util-to-string defaults to `true` and would
//     emit raw tag source, so `## A <span>HTML</span> heading` would slug as
//     `a-spanhtmlspan-heading` instead of GitHub's `a-html-heading`.
export function enumerateHeadings(markdown: string): string[] {
  const headings: string[] = [];
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes as Array<{ type: string; children?: unknown[] }>) {
      if (node.type === "heading") {
        headings.push(toString(node as never, { includeHtml: false }));
        continue;
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(fromMarkdown(markdown).children);
  return headings;
}

// A FRESH slugger per call: GithubSlugger instances dedupe across calls by
// appending "-1", which would silently mask the duplicate-slug error we must throw.
export function slugify(heading: string): string {
  return new GithubSlugger().slug(heading);
}

export function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const heading of enumerateHeadings(markdown)) {
    const slug = slugify(heading);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

export function lintDoc(markdown: string, docLabel: string): void {
  const seen = new Map<string, string>();
  for (const heading of enumerateHeadings(markdown)) {
    const slug = slugify(heading);
    if (!slug) continue;
    const prior = seen.get(slug);
    if (prior !== undefined) {
      throw new Error(
        `${docLabel}: duplicate heading slug "${slug}" (from "${prior}" and "${heading}") — ids must be unique within a doc.`,
      );
    }
    seen.set(slug, heading);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- doc-lint`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-anchor-resolver/types.ts packages/pi-anchor-resolver/doc-lint.ts packages/pi-anchor-resolver/tests/doc-lint.test.ts
git commit -m "feat(anchor-resolver): add types and doc-lint (slug uniqueness)"
```

---

### Task 3: anchors.ts — load + validate registry

**Files:**
- Create: `packages/pi-anchor-resolver/anchors.ts`
- Test: `packages/pi-anchor-resolver/tests/anchors.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`AnchorRegistry`, `Anchor`, `CodeAnchor`, `BehaviorAnchor`).
- Produces: `loadAnchors(absPath: string): AnchorRegistry`. Throws on: missing file, YAML parse error, non-object root, malformed id (not exactly `<domain>/<slug>`), non-array or empty section value, an item that is neither/both `code` and `behavior`, malformed `code` (missing `language`; `rule` not a plain object; `files` absent/empty/containing a blank or absolute entry), malformed `behavior` (not a `path::testName` string). `label` for a code anchor = `JSON.stringify(rule)`; for a behavior anchor = the raw `path::testName`. See Shared Interfaces for the guarantees consumers rely on.

- [ ] **Step 1: Write the failing test**

`packages/pi-anchor-resolver/tests/anchors.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAnchors } from "../anchors.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "anchors-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function write(yaml: string): string {
  const p = join(dir, "anchors.yml");
  writeFileSync(p, yaml);
  return p;
}

describe("loadAnchors", () => {
  it("parses code and behavior anchors", () => {
    const p = write([
      "daemon/session-lifecycle:",
      "  - code:",
      "      language: typescript",
      "      rule: { kind: class_declaration, has: { field: name, regex: '^SessionTimeline$' } }",
      "      files: [\"src/**/*.ts\"]",
      "daemon/reducer-determinism:",
      "  - behavior: \"test/reducer.test.ts::deterministic replay\"",
    ].join("\n"));
    const reg = loadAnchors(p);
    const code = reg.sections.get("daemon/session-lifecycle");
    expect(code?.[0].kind).toBe("code");
    if (code?.[0].kind === "code") {
      expect(code[0].code.language).toBe("typescript");
      expect(code[0].code.files).toEqual(["src/**/*.ts"]);
    }
    const beh = reg.sections.get("daemon/reducer-determinism");
    expect(beh?.[0].kind).toBe("behavior");
    if (beh?.[0].kind === "behavior") {
      expect(beh[0].behavior.path).toBe("test/reducer.test.ts");
      expect(beh[0].behavior.testName).toBe("deterministic replay");
    }
  });

  it("throws when the file is missing", () => {
    expect(() => loadAnchors(join(dir, "nope.yml"))).toThrow(/not found/i);
  });

  it("throws on malformed YAML", () => {
    const p = write("daemon/x:\n  - code: [unclosed");
    expect(() => loadAnchors(p)).toThrow();
  });

  it("throws when a section value is not a list", () => {
    const p = write("daemon/x: 42\n");
    expect(() => loadAnchors(p)).toThrow(/must be a list/i);
  });

  it("throws when an anchor is neither code nor behavior", () => {
    const p = write("daemon/x:\n  - note: hi\n");
    expect(() => loadAnchors(p)).toThrow(/code.*behavior/i);
  });

  it("throws on a code anchor missing files", () => {
    const p = write("daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n");
    expect(() => loadAnchors(p)).toThrow(/files/i);
  });

  it("throws on a behavior anchor without ::", () => {
    const p = write('daemon/x:\n  - behavior: "no-separator"\n');
    expect(() => loadAnchors(p)).toThrow(/path::testName/i);
  });

  it("throws when rule is an array (arrays are typeof object)", () => {
    const p = write('daemon/x:\n  - code:\n      language: typescript\n      rule: []\n      files: ["a.ts"]\n');
    expect(() => loadAnchors(p)).toThrow(/rule/i);
  });

  it("throws when a files entry is empty or absolute", () => {
    const blank = write('daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n      files: [""]\n');
    expect(() => loadAnchors(blank)).toThrow(/files/i);
    const abs = write('daemon/x:\n  - code:\n      language: typescript\n      rule: { kind: x }\n      files: ["/etc/passwd"]\n');
    expect(() => loadAnchors(abs)).toThrow(/relative/i);
  });

  it("throws on an empty anchor list for a section", () => {
    const p = write("daemon/x: []\n");
    expect(() => loadAnchors(p)).toThrow(/at least one anchor/i);
  });

  it("throws on a malformed id (not <domain>/<slug>)", () => {
    for (const bad of ["daemon", "/slug", "daemon/", "daemon/a/b"]) {
      const p = write(`${bad}:\n  - behavior: "a.test.ts::t"\n`);
      expect(() => loadAnchors(p)).toThrow(/id must be/i);
    }
  });

  it("throws when an anchor has both code and behavior", () => {
    const p = write('daemon/x:\n  - code: { language: typescript, rule: { kind: x }, files: ["a.ts"] }\n    behavior: "a.test.ts::t"\n');
    expect(() => loadAnchors(p)).toThrow(/exactly one/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- anchors`
Expected: FAIL — `../anchors.js` not found.

- [ ] **Step 3: Write `anchors.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Anchor, AnchorRegistry, CodeAnchor } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateId(id: string): void {
  const segments = id.split("/");
  if (segments.length !== 2 || segments.some((s) => s.trim() === "")) {
    throw new Error(`"${id}": id must be "<domain>/<slug>" (exactly two non-empty segments).`);
  }
}

function parseCodeAnchor(raw: unknown, id: string): CodeAnchor {
  if (!isPlainObject(raw)) throw new Error(`${id}: code anchor must be an object.`);
  const { language, rule, files } = raw;
  if (typeof language !== "string" || language.trim() === "") throw new Error(`${id}: code anchor requires a string "language".`);
  if (!isPlainObject(rule)) throw new Error(`${id}: code anchor "rule" must be an object (not an array or scalar).`);
  if (!Array.isArray(files) || files.length === 0) throw new Error(`${id}: code anchor requires a non-empty "files" array.`);
  const cleaned: string[] = [];
  for (const f of files) {
    if (typeof f !== "string" || f.trim() === "") throw new Error(`${id}: every "files" entry must be a non-empty string.`);
    if (isAbsolute(f)) throw new Error(`${id}: "files" globs must be repo-relative, got absolute "${f}".`);
    cleaned.push(f.trim());
  }
  return { language: language.trim(), rule, files: cleaned };
}

function parseAnchor(item: unknown, id: string): Anchor {
  if (!isPlainObject(item)) throw new Error(`${id}: each anchor must be an object with "code" or "behavior".`);
  const hasCode = "code" in item;
  const hasBehavior = "behavior" in item;
  if (hasCode === hasBehavior) throw new Error(`${id}: each anchor must have exactly one of "code" or "behavior".`);
  if (hasCode) {
    const code = parseCodeAnchor(item.code, id);
    return { kind: "code", label: JSON.stringify(code.rule), code };
  }
  const value = item.behavior;
  if (typeof value !== "string" || !value.includes("::")) {
    throw new Error(`${id}: behavior anchor must be a "path::testName" string.`);
  }
  const idx = value.indexOf("::");
  const path = value.slice(0, idx).trim();
  const testName = value.slice(idx + 2).trim();
  if (!path || !testName) throw new Error(`${id}: behavior anchor must be a "path::testName" string.`);
  return { kind: "behavior", label: value, behavior: { raw: value, path, testName } };
}

export function loadAnchors(absPath: string): AnchorRegistry {
  if (!existsSync(absPath)) throw new Error(`anchors file not found: ${absPath}`);
  const text = readFileSync(absPath, "utf8");
  const doc = parseYaml(text) as unknown; // throws on malformed YAML
  if (!isPlainObject(doc)) {
    throw new Error(`anchors file must be a mapping of "<domain>/<slug>" to a list of anchors: ${absPath}`);
  }
  const sections = new Map<string, Anchor[]>();
  for (const [id, value] of Object.entries(doc)) {
    validateId(id);
    if (!Array.isArray(value)) throw new Error(`${id}: section value must be a list of anchors.`);
    if (value.length === 0) throw new Error(`${id}: a section must declare at least one anchor.`);
    sections.set(id, value.map((item) => parseAnchor(item, id)));
  }
  return { sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- anchors`
Expected: PASS (every case in the file — happy path plus each validation branch).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-anchor-resolver/anchors.ts packages/pi-anchor-resolver/tests/anchors.test.ts
git commit -m "feat(anchor-resolver): load and validate anchors.yml"
```

---

### Task 4: resolve-code.ts — ast-grep resolution

**Files:**
- Create: `packages/pi-anchor-resolver/resolve-code.ts`
- Create fixtures: `packages/pi-anchor-resolver/tests/fixtures/ts/session.ts`, `.../tests/fixtures/ts/split.ts`
- Test: `packages/pi-anchor-resolver/tests/resolve-code.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`CodeAnchor`, `ResolvedLocation`).
- Produces: `languageToLang(language: string): Lang` (throws on unknown), `resolveCodeAnchor(anchor: CodeAnchor, cwd: string): ResolvedLocation[]`. Each location has 1-indexed `startLine`/`endLine` and `symbol` from the match's `name` field when present. Globs resolved relative to `cwd` via `fs.globSync`.

- [ ] **Step 1: Create fixtures**

`packages/pi-anchor-resolver/tests/fixtures/ts/session.ts`:
```ts
export class SessionTimeline {
  openSession(): number {
    return 1;
  }
}
```

`packages/pi-anchor-resolver/tests/fixtures/ts/split.ts`:
```ts
export function handleA(): void {}
export function handleB(): void {}
```

- [ ] **Step 2: Write the failing test**

`packages/pi-anchor-resolver/tests/resolve-code.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { languageToLang, resolveCodeAnchor } from "../resolve-code.js";
import type { CodeAnchor } from "../types.js";

const cwd = join(__dirname, "fixtures", "ts");

describe("languageToLang", () => {
  it("maps typescript and throws on unknown", () => {
    expect(() => languageToLang("typescript")).not.toThrow();
    expect(() => languageToLang("cobol")).toThrow(/unsupported language/i);
  });
});

describe("resolveCodeAnchor", () => {
  it("resolves a single class match with symbol and 1-indexed lines", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^SessionTimeline$" } },
      files: ["*.ts"],
    };
    const locs = resolveCodeAnchor(anchor, cwd);
    expect(locs).toHaveLength(1);
    expect(locs[0].file).toBe("session.ts");
    expect(locs[0].startLine).toBe(1);
    expect(locs[0].symbol).toBe("SessionTimeline");
  });

  it("returns zero matches when the rule matches nothing (dangling case)", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "class_declaration", has: { field: "name", regex: "^DoesNotExist$" } },
      files: ["*.ts"],
    };
    expect(resolveCodeAnchor(anchor, cwd)).toHaveLength(0);
  });

  it("returns multiple matches for an over-broad rule (loose case)", () => {
    const anchor: CodeAnchor = {
      language: "typescript",
      rule: { kind: "function_declaration" },
      files: ["split.ts"],
    };
    expect(resolveCodeAnchor(anchor, cwd).length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- resolve-code`
Expected: FAIL — `../resolve-code.js` not found.

- [ ] **Step 4: Write `resolve-code.ts`**

```ts
import { globSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { Lang, parse } from "@ast-grep/napi";
import type { CodeAnchor, ResolvedLocation } from "./types.js";

const LANG_MAP: Record<string, Lang> = {
  typescript: Lang.TypeScript,
  ts: Lang.TypeScript,
  tsx: Lang.Tsx,
  javascript: Lang.JavaScript,
  js: Lang.JavaScript,
};

export function languageToLang(language: string): Lang {
  const lang = LANG_MAP[language.toLowerCase()];
  if (lang === undefined) {
    throw new Error(`unsupported language "${language}"; supported: ${Object.keys(LANG_MAP).join(", ")}.`);
  }
  return lang;
}

function toPosixRelative(file: string, cwd: string): string {
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  return rel.split(sep).join("/");
}

export function resolveCodeAnchor(anchor: CodeAnchor, cwd: string): ResolvedLocation[] {
  const lang = languageToLang(anchor.language);
  // anchors.ts guarantees repo-relative globs; globSync yields cwd-relative matches.
  const files = new Set<string>();
  for (const pattern of anchor.files) {
    for (const match of globSync(pattern, { cwd })) files.add(match);
  }
  const locations: ResolvedLocation[] = [];
  for (const file of [...files].sort()) {
    const abs = isAbsolute(file) ? file : join(cwd, file);
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue; // globbed path unreadable (e.g. a directory match); skip
    }
    const root = parse(lang, source).root();
    for (const node of root.findAll({ rule: anchor.rule })) {
      const range = node.range();
      let symbol: string | undefined;
      try {
        symbol = node.field("name")?.text();
      } catch {
        symbol = undefined;
      }
      locations.push({
        file: toPosixRelative(file, cwd),
        startLine: range.start.line + 1,
        endLine: range.end.line + 1,
        ...(symbol ? { symbol } : {}),
      });
    }
  }
  return locations;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- resolve-code`
Expected: PASS (single/zero/multiple matches).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-anchor-resolver/resolve-code.ts packages/pi-anchor-resolver/tests/resolve-code.test.ts packages/pi-anchor-resolver/tests/fixtures
git commit -m "feat(anchor-resolver): resolve code anchors via @ast-grep/napi"
```

---

### Task 5: resolve-behavior.ts — best-effort test-id resolution

**Files:**
- Create: `packages/pi-anchor-resolver/resolve-behavior.ts`
- Test: `packages/pi-anchor-resolver/tests/resolve-behavior.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`BehaviorAnchor`, `ResolvedLocation`).
- Produces: `resolveBehaviorAnchor(anchor: BehaviorAnchor, cwd: string): ResolvedLocation | null`. Reads `join(cwd, anchor.path)`; returns the first line containing `testName` as a 1-indexed single-line location with `symbol = testName`; returns `null` when the file is missing or the name is not found.

- [ ] **Step 1: Write the failing test**

`packages/pi-anchor-resolver/tests/resolve-behavior.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBehaviorAnchor } from "../resolve-behavior.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "behavior-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("resolveBehaviorAnchor", () => {
  it("locates the line declaring the named test", () => {
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "reducer.test.ts"),
      ["import x;", 'it("deterministic replay", () => {', "  expect(1).toBe(1);", "});"].join("\n"));
    const loc = resolveBehaviorAnchor({ raw: "", path: "test/reducer.test.ts", testName: "deterministic replay" }, dir);
    expect(loc).not.toBeNull();
    expect(loc?.file).toBe("test/reducer.test.ts");
    expect(loc?.startLine).toBe(2);
    expect(loc?.symbol).toBe("deterministic replay");
  });

  it("returns null when the file does not exist", () => {
    expect(resolveBehaviorAnchor({ raw: "", path: "missing.test.ts", testName: "x" }, dir)).toBeNull();
  });

  it("returns null when the test name is not present", () => {
    writeFileSync(join(dir, "a.test.ts"), 'it("other", () => {});');
    expect(resolveBehaviorAnchor({ raw: "", path: "a.test.ts", testName: "nope" }, dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- resolve-behavior`
Expected: FAIL — `../resolve-behavior.js` not found.

- [ ] **Step 3: Write `resolve-behavior.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BehaviorAnchor, ResolvedLocation } from "./types.js";

export function resolveBehaviorAnchor(anchor: BehaviorAnchor, cwd: string): ResolvedLocation | null {
  const abs = join(cwd, anchor.path);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(anchor.testName)) {
      return { file: anchor.path, startLine: i + 1, endLine: i + 1, symbol: anchor.testName };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- resolve-behavior`
Expected: PASS (found / missing-file / missing-name).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-anchor-resolver/resolve-behavior.ts packages/pi-anchor-resolver/tests/resolve-behavior.test.ts
git commit -m "feat(anchor-resolver): best-effort behavior-anchor resolution"
```

---

### Task 6: drift.ts — classification, section-build, report (pure)

**Files:**
- Create: `packages/pi-anchor-resolver/drift.ts`
- Test: `packages/pi-anchor-resolver/tests/drift.test.ts`

**Interfaces:**
- Consumes: `types.ts` (`AnchorResolution`, `DriftReport`, `ResolvedSection`, `ResolveResult`).
- Produces:
  - `classifyDrift(resolutions: AnchorResolution[]): DriftReport` — code anchor with 0 locations → `dangling`; >1 → `loose` (with `count`); behavior anchor with 0 locations → `unresolvedBehavior`. Uses `anchor.label` for the `anchor`/`id` field.
  - `buildSections(resolutions: AnchorResolution[]): Record<string, ResolvedSection>` — groups by section, concatenates locations, `type` = `"code"` / `"behavior"` / `"mixed"` based on which anchor kinds are present.
  - `formatReport(result: ResolveResult): string` — compact markdown. Header line with counts, a `## Drift` block listing each dangling/loose/unresolved entry, and a `## Sections` block listing `id → file:line` per location. When drift is empty, states "No drift detected."

- [ ] **Step 1: Write the failing test**

`packages/pi-anchor-resolver/tests/drift.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildSections, classifyDrift, formatReport } from "../drift.js";
import type { AnchorResolution } from "../types.js";

const codeAnchor = (label: string) => ({ kind: "code" as const, label, code: { language: "typescript", rule: {}, files: [] } });
const behaviorAnchor = (label: string) => ({ kind: "behavior" as const, label, behavior: { raw: label, path: "p", testName: "t" } });

describe("classifyDrift", () => {
  it("flags a code anchor with zero matches as dangling", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [] }];
    expect(classifyDrift(r).dangling).toEqual([{ section: "d/a", anchor: "R" }]);
  });
  it("flags a code anchor with >1 match as loose with count", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [
      { file: "a.ts", startLine: 1, endLine: 1 }, { file: "b.ts", startLine: 2, endLine: 2 }] }];
    expect(classifyDrift(r).loose).toEqual([{ section: "d/a", anchor: "R", count: 2 }]);
  });
  it("flags an unresolved behavior anchor", () => {
    const r: AnchorResolution[] = [{ section: "d/b", anchor: behaviorAnchor("p::t"), locations: [] }];
    expect(classifyDrift(r).unresolvedBehavior).toEqual([{ section: "d/b", id: "p::t" }]);
  });
  it("reports no drift for a clean single-match resolution", () => {
    const r: AnchorResolution[] = [{ section: "d/a", anchor: codeAnchor("R"), locations: [{ file: "a.ts", startLine: 1, endLine: 3 }] }];
    const d = classifyDrift(r);
    expect([d.dangling, d.loose, d.unresolvedBehavior]).toEqual([[], [], []]);
  });
});

describe("buildSections", () => {
  it("marks a section with both anchor kinds as mixed and merges locations", () => {
    const r: AnchorResolution[] = [
      { section: "d/a", anchor: codeAnchor("R"), locations: [{ file: "a.ts", startLine: 1, endLine: 3 }] },
      { section: "d/a", anchor: behaviorAnchor("p::t"), locations: [{ file: "p", startLine: 5, endLine: 5 }] },
    ];
    const s = buildSections(r);
    expect(s["d/a"].type).toBe("mixed");
    expect(s["d/a"].locations).toHaveLength(2);
  });
  it("marks pure code and pure behavior sections", () => {
    const s = buildSections([
      { section: "c", anchor: codeAnchor("R"), locations: [] },
      { section: "b", anchor: behaviorAnchor("p::t"), locations: [] },
    ]);
    expect(s.c.type).toBe("code");
    expect(s.b.type).toBe("behavior");
  });
});

describe("formatReport", () => {
  it("summarizes every drift kind and section locations", () => {
    const text = formatReport({
      responseId: "r1",
      sections: { "d/a": { type: "code", locations: [{ file: "a.ts", startLine: 1, endLine: 3, symbol: "X" }] } },
      drift: {
        dangling: [{ section: "d/z", anchor: "R" }],
        loose: [{ section: "d/l", anchor: "F", count: 3 }],
        unresolvedBehavior: [{ section: "d/b", id: "p::t" }],
      },
    });
    expect(text).toContain("DANGLING d/z");
    expect(text).toContain("LOOSE d/l");
    expect(text).toContain("3 matches");
    expect(text).toContain("UNRESOLVED d/b");
    expect(text).toContain("a.ts:1 (X)");
  });
  it("states clean and (none) when there is no drift and no sections", () => {
    const text = formatReport({ responseId: "r1", sections: {}, drift: { dangling: [], loose: [], unresolvedBehavior: [] } });
    expect(text).toMatch(/no drift/i);
    expect(text).toContain("(none)");
  });
  it("renders an unresolved location as (unresolved)", () => {
    const text = formatReport({
      responseId: "r1",
      sections: { "d/a": { type: "code", locations: [] } },
      drift: { dangling: [], loose: [], unresolvedBehavior: [] },
    });
    expect(text).toContain("(unresolved)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- drift`
Expected: FAIL — `../drift.js` not found.

- [ ] **Step 3: Write `drift.ts`**

```ts
import type { AnchorResolution, DriftReport, ResolveResult, ResolvedSection } from "./types.js";

export function classifyDrift(resolutions: AnchorResolution[]): DriftReport {
  const drift: DriftReport = { dangling: [], loose: [], unresolvedBehavior: [] };
  for (const { section, anchor, locations } of resolutions) {
    if (anchor.kind === "code") {
      if (locations.length === 0) drift.dangling.push({ section, anchor: anchor.label });
      else if (locations.length > 1) drift.loose.push({ section, anchor: anchor.label, count: locations.length });
    } else {
      if (locations.length === 0) drift.unresolvedBehavior.push({ section, id: anchor.label });
    }
  }
  return drift;
}

export function buildSections(resolutions: AnchorResolution[]): Record<string, ResolvedSection> {
  const sections: Record<string, ResolvedSection> = {};
  const kinds = new Map<string, Set<"code" | "behavior">>();
  for (const { section, anchor, locations } of resolutions) {
    if (!sections[section]) sections[section] = { type: "code", locations: [] };
    sections[section].locations.push(...locations);
    if (!kinds.has(section)) kinds.set(section, new Set());
    kinds.get(section)!.add(anchor.kind);
  }
  for (const [section, set] of kinds) {
    sections[section].type = set.size > 1 ? "mixed" : set.has("code") ? "code" : "behavior";
  }
  return sections;
}

export function formatReport(result: ResolveResult): string {
  const { drift, sections } = result;
  const total = drift.dangling.length + drift.loose.length + drift.unresolvedBehavior.length;
  const lines: string[] = [];
  lines.push(`# anchor_resolve — ${Object.keys(sections).length} section(s), ${total} drift signal(s)`);
  lines.push("");
  lines.push("## Drift");
  if (total === 0) {
    lines.push("No drift detected.");
  } else {
    for (const d of drift.dangling) lines.push(`- DANGLING ${d.section} — 0 matches for \`${d.anchor}\``);
    for (const l of drift.loose) lines.push(`- LOOSE ${l.section} — ${l.count} matches for \`${l.anchor}\``);
    for (const u of drift.unresolvedBehavior) lines.push(`- UNRESOLVED ${u.section} — behavior \`${u.id}\``);
  }
  lines.push("");
  lines.push("## Sections");
  const ids = Object.keys(sections).sort();
  if (ids.length === 0) {
    lines.push("(none)");
  } else {
    for (const id of ids) {
      const s = sections[id];
      const locs = s.locations.map((l) => `${l.file}:${l.startLine}${l.symbol ? ` (${l.symbol})` : ""}`).join(", ");
      lines.push(`- ${id} [${s.type}] → ${locs || "(unresolved)"}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- drift`
Expected: PASS (all classify/build/format cases).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-anchor-resolver/drift.ts packages/pi-anchor-resolver/tests/drift.test.ts
git commit -m "feat(anchor-resolver): pure drift classification and report"
```

---

### Task 7: resolve.ts — orchestrator (all three modes + doc-lint)

**Files:**
- Create: `packages/pi-anchor-resolver/resolve.ts`
- Create fixtures:
  - `tests/fixtures/repo/` — clean mini repo (`docs/living/daemon.md`, `docs/living/anchors.yml`, `src/session.ts`, `test/reducer.test.ts`)
  - `tests/fixtures/repo-drift/` — a code anchor matching 0 (dangling) and one matching 2 (loose)
  - `tests/fixtures/repo-dup/` — duplicate heading-slug doc
  - `tests/fixtures/repo-nodoc/` — an id whose `docs/living/<domain>.md` is missing
  - `tests/fixtures/repo-badheading/` — an id whose slug is not an actual heading in its doc
- Test: `packages/pi-anchor-resolver/tests/resolve.test.ts`

**Interfaces:**
- Consumes: `anchors.ts` (`loadAnchors`), `doc-lint.ts` (`lintDoc`, `headingSlugs`), `resolve-code.ts` (`resolveCodeAnchor`), `resolve-behavior.ts` (`resolveBehaviorAnchor`), `drift.ts` (`classifyDrift`, `buildSections`), `types.ts`. Signatures are in Shared Interfaces.
- Produces: `runResolve(params: RunResolveParams, cwd: string): ResolveResult`, `generateResponseId(): string`, and the exported `RunResolveParams` interface (all per Shared Interfaces).

Behavior:
1. Load the registry (`loadAnchors` throws on any structural problem).
2. **Registry-integrity pass (throwing), for every id in the registry regardless of mode.** Group ids by domain (segment before `/`). For each domain: the doc `docs/living/<domain>.md` **must exist** (else throw “referenced living doc not found”); run `lintDoc` (throws on duplicate slug); compute `headingSlugs(doc)` and require each id’s slug to be present (else throw “has no matching heading”). This makes “the heading *is* the id” an enforced invariant, so a stale key can never masquerade as clean drift.
3. Select ids per mode — `full`/`changed`: all; `section`: only `params.section` (throw “unknown section” if absent).
4. Resolve every selected id’s anchors into `AnchorResolution[]`.
5. For `changed`: keep only sections with a location whose canonical repo-relative path is in the canonicalized `changed` set (`relative(cwd, resolve(cwd, p))` → POSIX; handles `./`, `..`, duplicate and native separators, and absolute inputs).
6. `classifyDrift` + `buildSections` over the (possibly filtered) resolutions. Drift stays warnings-only.

- [ ] **Step 1: Create fixtures**

`tests/fixtures/repo/docs/living/daemon.md`:
```markdown
# Daemon

## Session Lifecycle

The session timeline.

## Reducer Determinism

Replay is deterministic.
```

`tests/fixtures/repo/docs/living/anchors.yml`:
```yaml
daemon/session-lifecycle:
  - code:
      language: typescript
      rule: { kind: class_declaration, has: { field: name, regex: '^SessionTimeline$' } }
      files: ["src/**/*.ts"]
daemon/reducer-determinism:
  - behavior: "test/reducer.test.ts::deterministic replay"
```

`tests/fixtures/repo/src/session.ts`:
```ts
export class SessionTimeline {
  openSession(): number { return 1; }
}
```

`tests/fixtures/repo/test/reducer.test.ts`:
```ts
import { it } from "vitest";
it("deterministic replay", () => {});
```

`tests/fixtures/repo-drift/docs/living/daemon.md`:
```markdown
# Daemon

## Dangling Class

## Loose Funcs
```
`tests/fixtures/repo-drift/docs/living/anchors.yml`:
```yaml
daemon/dangling-class:
  - code:
      language: typescript
      rule: { kind: class_declaration, has: { field: name, regex: '^Renamed$' } }
      files: ["src/**/*.ts"]
daemon/loose-funcs:
  - code:
      language: typescript
      rule: { kind: function_declaration }
      files: ["src/**/*.ts"]
```
`tests/fixtures/repo-drift/src/things.ts`:
```ts
export function handleA(): void {}
export function handleB(): void {}
```

`tests/fixtures/repo-dup/docs/living/daemon.md` (dup-slug doc) + `tests/fixtures/repo-dup/docs/living/anchors.yml` (a single `daemon/session-lifecycle` behavior anchor, so resolution is reached only if lint passes):
```markdown
# Daemon

## Session Lifecycle
one

## session lifecycle
two
```
```yaml
daemon/session-lifecycle:
  - behavior: "x.test.ts::t"
```

`tests/fixtures/repo-nodoc/docs/living/anchors.yml` (no `daemon.md` alongside it):
```yaml
daemon/session-lifecycle:
  - behavior: "x.test.ts::t"
```

`tests/fixtures/repo-badheading/docs/living/daemon.md` + `.../anchors.yml` (key slug absent from the doc):
```markdown
# Daemon

## Session Lifecycle
```
```yaml
daemon/not-a-heading:
  - behavior: "x.test.ts::t"
```

- [ ] **Step 2: Write the failing test**

`packages/pi-anchor-resolver/tests/resolve.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { runResolve } from "../resolve.js";

const fx = (name: string) => join(__dirname, "fixtures", name);
const repo = fx("repo");

describe("runResolve", () => {
  it("full mode resolves code + behavior with no drift", () => {
    const res = runResolve({ mode: "full" }, repo);
    expect(res.sections["daemon/session-lifecycle"].locations[0].symbol).toBe("SessionTimeline");
    expect(res.sections["daemon/reducer-determinism"].type).toBe("behavior");
    expect(res.drift.dangling).toEqual([]);
    expect(res.drift.unresolvedBehavior).toEqual([]);
  });

  it("section mode resolves only the requested id", () => {
    const res = runResolve({ mode: "section", section: "daemon/session-lifecycle" }, repo);
    expect(Object.keys(res.sections)).toEqual(["daemon/session-lifecycle"]);
  });

  it("section mode throws on an unknown id", () => {
    expect(() => runResolve({ mode: "section", section: "daemon/nope" }, repo)).toThrow(/unknown section/i);
  });

  it("changed mode returns only sections resolving into the changed files (tolerates ./ and native separators)", () => {
    const res = runResolve({ mode: "changed", changed: ["./src/session.ts"] }, repo);
    expect(Object.keys(res.sections)).toEqual(["daemon/session-lifecycle"]);
    const none = runResolve({ mode: "changed", changed: ["src/other.ts"] }, repo);
    expect(Object.keys(none.sections)).toEqual([]);
  });

  it("integration: a rule matching nothing is DANGLING; a rule matching many is LOOSE(count)", () => {
    const res = runResolve({ mode: "full" }, fx("repo-drift"));
    expect(res.drift.dangling.map((d) => d.section)).toContain("daemon/dangling-class");
    const loose = res.drift.loose.find((l) => l.section === "daemon/loose-funcs");
    expect(loose?.count).toBe(2);
  });

  it("throws on a duplicate heading slug in a referenced doc", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-dup"))).toThrow(/duplicate heading slug/i);
  });

  it("throws when a referenced living doc is missing", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-nodoc"))).toThrow(/living doc not found/i);
  });

  it("throws when a section id's slug is not an actual heading", () => {
    expect(() => runResolve({ mode: "full" }, fx("repo-badheading"))).toThrow(/no matching heading/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- resolve.test`
Expected: FAIL — `../resolve.js` not found.

- [ ] **Step 4: Write `resolve.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { loadAnchors } from "./anchors.js";
import { headingSlugs, lintDoc } from "./doc-lint.js";
import { classifyDrift, buildSections } from "./drift.js";
import { resolveCodeAnchor } from "./resolve-code.js";
import { resolveBehaviorAnchor } from "./resolve-behavior.js";
import type { Anchor, AnchorResolution, ResolveMode, ResolveResult } from "./types.js";

export interface RunResolveParams {
  mode: ResolveMode;
  anchorsPath?: string;
  changed?: string[];
  section?: string;
}

export function generateResponseId(): string {
  return `anchor_${randomUUID()}`;
}

// Canonical repo-relative POSIX path (handles ./, .., duplicate/native separators, absolute inputs).
function toRel(p: string, cwd: string): string {
  return relative(cwd, resolve(cwd, p)).split(sep).join("/");
}

function resolveAnchor(section: string, anchor: Anchor, cwd: string): AnchorResolution {
  const locations = anchor.kind === "code"
    ? resolveCodeAnchor(anchor.code, cwd)
    : (() => { const loc = resolveBehaviorAnchor(anchor.behavior, cwd); return loc ? [loc] : []; })();
  return { section, anchor, locations };
}

// Registry integrity: enforce "the heading is the id" before resolving anything.
function assertRegistryIntegrity(ids: string[], cwd: string): void {
  const byDomain = new Map<string, string[]>();
  for (const id of ids) {
    const domain = id.split("/")[0];
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), id]);
  }
  for (const [domain, domainIds] of byDomain) {
    const docPath = join(cwd, "docs", "living", `${domain}.md`);
    if (!existsSync(docPath)) {
      throw new Error(`referenced living doc not found: docs/living/${domain}.md (required by ${domainIds[0]}).`);
    }
    const markdown = readFileSync(docPath, "utf8");
    lintDoc(markdown, `docs/living/${domain}.md`); // throws on duplicate slug
    const slugs = headingSlugs(markdown);
    for (const id of domainIds) {
      const slug = id.slice(domain.length + 1);
      if (!slugs.has(slug)) {
        throw new Error(`section "${id}" has no matching heading in docs/living/${domain}.md.`);
      }
    }
  }
}

export function runResolve(params: RunResolveParams, cwd: string): ResolveResult {
  const anchorsPath = join(cwd, params.anchorsPath ?? "docs/living/anchors.yml");
  const registry = loadAnchors(anchorsPath);

  assertRegistryIntegrity([...registry.sections.keys()], cwd);

  // Select section ids.
  let ids: string[];
  if (params.mode === "section") {
    const id = params.section ?? "";
    if (!registry.sections.has(id)) throw new Error(`unknown section "${id}" in anchors registry.`);
    ids = [id];
  } else {
    ids = [...registry.sections.keys()];
  }

  let resolutions: AnchorResolution[] = [];
  for (const id of ids) {
    for (const anchor of registry.sections.get(id)!) resolutions.push(resolveAnchor(id, anchor, cwd));
  }

  if (params.mode === "changed") {
    const changed = new Set((params.changed ?? []).map((p) => toRel(p, cwd)));
    const keep = new Set<string>();
    for (const r of resolutions) {
      if (r.locations.some((l) => changed.has(toRel(l.file, cwd)))) keep.add(r.section);
    }
    resolutions = resolutions.filter((r) => keep.has(r.section));
  }

  return {
    responseId: generateResponseId(),
    sections: buildSections(resolutions),
    drift: classifyDrift(resolutions),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w pi-anchor-resolver -- resolve.test`
Expected: PASS (full / section / unknown-throw / changed / drift-integration / dup-slug-throw / missing-doc-throw / unknown-heading-throw).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-anchor-resolver/resolve.ts packages/pi-anchor-resolver/tests/resolve.test.ts packages/pi-anchor-resolver/tests/fixtures
git commit -m "feat(anchor-resolver): orchestrate resolve modes with doc-lint"
```

---

### Task 8: render.ts + index.ts registration, README, dogfood wiring

**Files:**
- Create: `packages/pi-anchor-resolver/render.ts`
- Replace: `packages/pi-anchor-resolver/index.ts`
- Replace: `packages/pi-anchor-resolver/README.md`
- Delete: `packages/pi-anchor-resolver/tests/scaffold.test.ts`
- Create: `packages/pi-anchor-resolver/tests/index.test.ts`
- Modify (uncommitted): `.pi/settings.json` (local dogfood entry, reverted before commit)

**Interfaces:**
- Consumes: `resolve.ts` (`runResolve`, `RunResolveParams`), `drift.ts` (`formatReport`), `@earendil-works/pi-ai` (`StringEnum`), `typebox` (`Type`), `@earendil-works/pi-tui` (`Text`). Signatures per Shared Interfaces.
- Produces: default export `(pi: ExtensionAPI) => void` registering exactly one tool named `anchor_resolve`. No `session_start` handler. `execute` returns `{ content: [{ type, text }], details }` where **`details` is a fresh object literal** `{ responseId, sections, drift }` (per Global Constraints) and `text` is capped for the LLM (full data lives in `details`).

- [ ] **Step 1: Write the failing registration test**

`packages/pi-anchor-resolver/tests/index.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.js";

type RegisteredTool = { name: string; promptGuidelines?: string[]; execute: (...a: unknown[]) => Promise<any> };

function fakePi() {
  const tools: RegisteredTool[] = [];
  const handlers: Record<string, Function[]> = {};
  const appendEntry = vi.fn();
  const pi = {
    registerTool: (t: RegisteredTool) => tools.push(t),
    on: (e: string, h: Function) => { handlers[e] = [...(handlers[e] ?? []), h]; },
    appendEntry,
  } as unknown as ExtensionAPI;
  return { pi, tools, handlers, appendEntry };
}

const repo = join(__dirname, "fixtures", "repo"); // created in Task 7

describe("anchor-resolver extension", () => {
  it("registers exactly one anchor_resolve tool", () => {
    const { pi, tools } = fakePi();
    extension(pi);
    expect(tools.map((t) => t.name)).toEqual(["anchor_resolve"]);
  });

  it("names the tool in its promptGuidelines and registers no session_start handler (stateless)", () => {
    const { pi, tools, handlers } = fakePi();
    extension(pi);
    expect(tools[0].promptGuidelines?.some((g) => g.includes("anchor_resolve"))).toBe(true);
    expect(handlers.session_start).toBeUndefined();
  });

  it("executes the tool: report text + full details, terse report:false, and never appendEntry (stateless)", async () => {
    const { pi, tools, appendEntry } = fakePi();
    extension(pi);
    const full = await tools[0].execute("id", { mode: "full" }, undefined, undefined, { cwd: repo });
    expect(full.content[0].text).toContain("anchor_resolve");
    expect(full.details.responseId).toMatch(/^anchor_/);
    expect(Object.keys(full.details.sections)).toContain("daemon/session-lifecycle");
    expect(full.details.drift).toEqual({ dangling: [], loose: [], unresolvedBehavior: [] });
    const terse = await tools[0].execute("id", { mode: "full", report: false }, undefined, undefined, { cwd: repo });
    expect(terse.content[0].text).toMatch(/section\(s\) resolved/);
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
```


- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w pi-anchor-resolver -- index.test`
Expected: FAIL — current `index.ts` registers no tool.

- [ ] **Step 3: Write `render.ts`**

```ts
import { Text } from "@earendil-works/pi-tui";

function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

export function renderCall(
  args: { mode?: unknown; section?: unknown; changed?: unknown },
  theme: { fg: (color: any, text: string) => string; bold: (text: string) => string },
) {
  const mode = typeof args.mode === "string" ? args.mode : "full";
  let suffix = "";
  if (mode === "section" && typeof args.section === "string") suffix = ` ${args.section}`;
  else if (mode === "changed" && Array.isArray(args.changed)) suffix = ` ${args.changed.length} file(s)`;
  const title = theme.fg("toolTitle", theme.bold("anchor_resolve "));
  return new Text(title + theme.fg("accent", mode + suffix), 0, 0);
}

export function renderResult(
  result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
  options: { expanded?: boolean; isPartial?: boolean },
  theme: { fg: (color: any, text: string) => string },
) {
  if (options.isPartial) return new Text(theme.fg("warning", "Resolving..."), 0, 0);
  if (result.details?.error) return new Text(theme.fg("error", String(result.details.error)), 0, 0);
  const text = firstText(result);
  const preview = text.length > 800 && !options.expanded ? text.slice(0, 800) + "..." : text;
  return new Text(theme.fg("dim", preview), 0, 0);
}
```

- [ ] **Step 4: Write `index.ts`**

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runResolve, type RunResolveParams } from "./resolve.js";
import { formatReport } from "./drift.js";
import { renderCall, renderResult } from "./render.js";

// Cap the LLM-facing text; the complete structured result always remains in details.
const MAX_REPORT_CHARS = 24000;
function capText(text: string): string {
  return text.length <= MAX_REPORT_CHARS
    ? text
    : `${text.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated at ${MAX_REPORT_CHARS} chars — full sections/drift are in details]`;
}

const AnchorResolveParams = Type.Object({
  mode: StringEnum(["full", "changed", "section"] as const, {
    description: "full: resolve all sections. changed: only sections whose anchors resolve into the given files. section: a single section id.",
  }),
  anchorsPath: Type.Optional(Type.String({
    description: "Path to the anchors registry, relative to the working directory. Default docs/living/anchors.yml.",
  })),
  changed: Type.Optional(Type.Array(Type.String(), {
    description: "For mode=changed: repo-relative file paths; sections whose anchors resolve into any of these are returned.",
  })),
  section: Type.Optional(Type.String({
    description: "For mode=section: the section id <domain>/<heading-slug>, e.g. daemon/session-lifecycle.",
  })),
  report: Type.Optional(Type.Boolean({
    description: "Include the compact markdown drift report as text output. Default true.",
  })),
});

export default function anchorResolverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "anchor_resolve",
    label: "Anchor Resolve",
    description: "Resolve living-spec anchors (docs/living/anchors.yml) to current code/test locations and report drift (dangling / loose / unresolved-behavior).",
    promptSnippet: "Resolve living-spec anchors to code/test locations and surface drift.",
    promptGuidelines: [
      "Use anchor_resolve(mode=\"section\", section=\"<domain>/<heading-slug>\") to jump from a living-spec section to its exact code/test location.",
      "Use anchor_resolve(mode=\"changed\", changed=[...files]) before planning a change to find which documented sections cover those files.",
      "Use anchor_resolve(mode=\"full\") after a change to surface dangling/loose/unresolved anchors (drift).",
    ],
    parameters: AnchorResolveParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const runParams: RunResolveParams = {
        mode: params.mode,
        anchorsPath: params.anchorsPath,
        changed: params.changed,
        section: params.section,
      };
      const result = runResolve(runParams, ctx.cwd);
      const raw = params.report === false
        ? `anchor_resolve: ${Object.keys(result.sections).length} section(s) resolved. Response ID: ${result.responseId}`
        : `${formatReport(result)}\n\n---\nResponse ID: ${result.responseId}`;
      const text = capText(raw);
      // details MUST be a fresh object literal (see Global Constraints), not the ResolveResult variable.
      return {
        content: [{ type: "text" as const, text }],
        details: { responseId: result.responseId, sections: result.sections, drift: result.drift },
      };
    },
    renderCall,
    renderResult,
  });
}
```

- [ ] **Step 5: Delete the scaffold test and run the full suite + typecheck**

```bash
rm packages/pi-anchor-resolver/tests/scaffold.test.ts
npm test -w pi-anchor-resolver
npm run typecheck -w pi-anchor-resolver
```
Expected: all tests PASS; typecheck clean. (`details` is returned as a fresh object literal, so it typechecks against the renderer's `Record<string, unknown>`; returning the `ResolveResult` variable directly would fail — see Global Constraints. `ctx.cwd` is provided per `packages/brightdata/index.ts`.)

- [ ] **Step 6: Write README** (`packages/pi-anchor-resolver/README.md`)

```markdown
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
- **changed `<files…>`** — only sections whose anchors resolve into those files (pre-planning retrieval).
- **section `<id>`** — resolve one section.

Drift is **warnings-only**. The tool throws only for unusable input: missing/malformed `anchors.yml`, a
bad id shape, unknown language, unknown section id in `section` mode, a referenced living doc that does
not exist, a section id whose slug is not an actual heading in its doc, or a **duplicate heading-slug**
within a doc (the spec's sole hard constraint). "The heading *is* the id," so a key that maps to no real
heading is treated as unusable config rather than silently-clean drift.

### anchors.yml example

\`\`\`yaml
daemon/session-lifecycle:
  - code:
      language: typescript
      rule: { kind: class_declaration, has: { field: name, regex: '^SessionTimeline$' } }
      files: ["apps/radius/daemon/src/**/*.ts"]
daemon/reducer-determinism:
  - behavior: "apps/radius/daemon/test/reducer.test.ts::deterministic replay"
\`\`\`

## Language support

v1 uses `@ast-grep/napi`'s built-in grammars (TypeScript/TSX/JavaScript) in-process. A future Swift phase
can add a `@ast-grep/cli`-spawn fallback for languages napi does not bundle.

## Install

Add to `.pi/settings.json`:

\`\`\`json
{ "packages": ["git:github.com/chknd1nner/pi-anchor-resolver@v0.1.0"] }
\`\`\`

During local development, point at the workspace copy instead:

\`\`\`json
{ "packages": ["../packages/pi-anchor-resolver"] }
\`\`\`

## Development

\`\`\`bash
npm test -w pi-anchor-resolver
npm run typecheck -w pi-anchor-resolver
\`\`\`
```

- [ ] **Step 7: Dogfood locally (uncommitted)**

Per AGENTS.md, a local-path `packages` entry is fine for hot-loop dev but must NOT be committed; the committed install spec is a mirror reference added in Phase 3 after release. Temporarily add `"../packages/pi-anchor-resolver"` to `.pi/settings.json` `packages`, launch Pi, and confirm `anchor_resolve` appears and resolves against the fixture repo (or a real `docs/living/`). Then **revert the local edit** so `.pi/settings.json` is unchanged in the commit:
```bash
git checkout -- .pi/settings.json   # discard the local dogfood entry before committing
```

- [ ] **Step 8: Final verification (whole workspace)**

```bash
npm test -w pi-anchor-resolver && npm run typecheck -w pi-anchor-resolver
git status --short   # expect only packages/pi-anchor-resolver/** staged; .pi/settings.json clean
```
Expected: all suites green, typecheck clean, no `.pi/settings.json` diff.

- [ ] **Step 9: Commit**

```bash
git add packages/pi-anchor-resolver
git commit -m "feat(anchor-resolver): register anchor_resolve tool + README"
```

---

## Definition of Done (v1)

`anchor_resolve` registered and working against the TS fixture repo: resolves code + behavior anchors to
precise locations; `mode=changed` filters sections by canonical file path; an integration run classifies
a renamed rule as DANGLING and an over-broad rule as LOOSE(count); duplicate heading-slug, missing
referenced doc, unknown heading-slug, bad id shape, and malformed `anchors.yml` all throw; the registered
tool executes end-to-end returning capped `content[0].text` + full `details{responseId,sections,drift}`
and never calls `appendEntry`; all tests + typecheck green; README documents install + the three usage
modes. Radius consumes it later via the git mirror (Phase 3 — out of scope for this plan).

## Self-Review

- **Spec coverage:** §7 package layout (Task 1), one `anchor_resolve` tool + `promptGuidelines` (Task 8),
  input schema `mode`/`anchorsPath`/`changed`/`section`/`report` (Task 8), output `content[0].text` +
  `details{responseId,sections,drift}` (Tasks 6–8), three modes (Task 7), warnings-only + throw-on-unusable
  (Tasks 3/7), doc-lint duplicate-slug hard error + "heading is the id" enforcement (Tasks 2/7),
  `@ast-grep/napi` in-process (Task 4), behavior best-effort grep (Task 5), stateless — no
  appendEntry/restore (Task 8), deps added (Task 1; all five already installed at the root). All covered.
- **Type consistency:** all shared types live once in Shared Interfaces (`types.ts`, Task 2) and are reused
  verbatim; `runResolve`/`RunResolveParams`/`generateResponseId` (Task 7) match their Task 8 consumption;
  `slugify`/`enumerateHeadings`/`lintDoc`/`headingSlugs`, `resolveCodeAnchor`/`resolveBehaviorAnchor`,
  `classifyDrift`/`buildSections`/`formatReport` names match across producer/consumer tasks and the
  Shared Interfaces block.
- **Open questions resolved:** behavior granularity = grep (Task 5); doc-lint = self-parse Node heading
  scan via the real CommonMark parser + `github-slugger`, not a hand-rolled scanner (Task 2); symbol =
  `field("name")` (Task 4); changed matching = canonical repo-relative path (Task 7).

## Review Concerns Addressed (openai-codex/gpt-5.6-sol, high)

- **BLOCKER — renderResult/details typecheck:** `execute` now returns `details` as a fresh object literal
  `{ responseId, sections, drift }` (assignable to the renderer's `Record<string, unknown>`), codified in
  Global Constraints and Task 8 (verified against the brightdata pattern in the installed types).
- **MAJOR — registry keys never matched to headings:** Task 7 adds an integrity pass (throwing) requiring
  each domain doc to exist and each id's slug to be an actual heading (`headingSlugs`), for all ids
  regardless of mode; fixtures/tests `repo-nodoc` + `repo-badheading` cover it.
- **MAJOR — doc-lint correctness:** Task 2 rewrites `enumerateHeadings` to track the open fence's char +
  run length (mismatched/shorter fences can't close), support ≤3-space-indented ATX and setext headings,
  and `slugify` strips inline markdown and preserves Unicode letters/digits; tests added for each.
  *(Superseded in Round 4 — the hand-rolled scanner was replaced wholesale by the real parser + slugger.)*
- **MAJOR — YAML validation gaps:** Task 3 rejects array/scalar `rule`, blank/absolute `files` entries,
  empty anchor lists, both/neither `code`+`behavior`, and bad id shapes; tests added for each branch.
- **MAJOR — required test coverage:** Task 7 adds an integration test (rename→DANGLING, over-broad→
  LOOSE(count)); Task 8 adds a tool-execution test asserting `content`/`details`/`report:false`/no
  `appendEntry`.
- **MAJOR — isolated-worker interfaces:** a worker-visible **Shared Interfaces** section now defines every
  cross-module type + signature once, canonically.
- **MINOR — changed normalization:** Task 7 canonicalizes both inputs and locations via
  `relative(cwd, resolve(cwd, p))` → POSIX (handles `./`, `..`, duplicate/native separators, absolute).
- **MINOR — globbed reads:** Task 4 uses `node:path` join/resolve and emits POSIX repo-relative `file`;
  Task 3 rejects absolute globs so matches stay repo-relative.
- **MINOR — unbounded output:** Task 8 caps `content[0].text` (`MAX_REPORT_CHARS`) with a notice; full
  data stays in `details`.
- **MINOR — dogfood commit policy:** Task 8 makes the local `.pi/settings.json` entry an uncommitted
  dogfood step, reverted before the commit (mirror entry lands in Phase 3).
- **NIT — verbatim tsconfig:** Task 1 drops `resolveJsonModule`; the scaffold test reads `package.json`
  via `node:fs`.

### Round 2 (re-review: 10/11 confirmed resolved; 2 remaining findings)

*(Rounds 2–3 below are retained for traceability but are SUPERSEDED by the Round 4 design change: the
hand-rolled `stripInline`/`enumerateHeadings` they describe no longer exist.)*

- **MAJOR — heading identity not github-slugger-faithful:** `slugify` no longer blanket-strips `[*_~]` or
  collapses hyphen runs. It now strips emphasis only as delimiter **pairs** (with non-word lookarounds for
  `_`, matching CommonMark's no-intraword-`_` rule), keeps `\p{Pc}` so `session_id`/`foo_bar_baz` survive,
  preserves authored runs (`foo--bar`), and maps each whitespace char to a hyphen (`multiple---spaces`) —
  the stale collapsing assertion was corrected. Verified against the real `github-slugger` package: outputs
  match on every case except leading/trailing whitespace, which `slugify` trims because
  `enumerateHeadings` always supplies pre-trimmed heading text (documented inline in the test). `enumerateHeadings` now buffers a real paragraph, so a
  setext heading takes the whole preceding paragraph, `    code` + `---` is not a heading, and `---` with
  no open paragraph is a thematic break. Tests added for every case.
- **MAJOR — package manifest violated dependency policy:** Task 1 drops the package-level
  `devDependencies` block entirely (Pi packages stay `peerDependencies: "*"`; `typescript`/`vitest` live
  only at the root), following `packages/pi-grep/package.json`; the note flags `packages/brightdata` as
  pre-policy drift so an implementing worker doesn't copy it.
- Re-review independently reconstructed the plan's code and ran it: **typecheck clean, all tests passing**,
  and all five fixtures (`repo`, `repo-drift`, `repo-nodoc`, `repo-badheading`, `repo-dup`) produced
  exactly the asserted outcomes.

### Round 5 (two library-usage defects in the new Task 2)

- **MAJOR — root-only AST traversal dropped nested headings:** `tree.children.flatMap(...)` missed headings
  inside block quotes and list items (`> ## Quoted`, `- # Listed`, quoted setext), so valid ids would be
  rejected and duplicates missed. `enumerateHeadings` now walks the tree depth-first pre-order (document
  order preserved: `# A / > ## B / ### C` → `["A","B","C"]`).
- **MAJOR — raw inline HTML leaked into slugs:** `mdast-util-to-string` defaults `includeHtml: true`, so
  `## A <span>HTML</span> heading` slugged as `a-spanhtmlspan-heading`. Now called with
  `{ includeHtml: false }`, matching GitHub's rendered `a-html-heading`; a `<span>Same</span>` vs `Same`
  duplicate is now correctly detected. Tests added for both defects.
- Non-blocking fix: Task 8's test block now contains `import { join } from "node:path"` directly instead
  of relying on following prose; the stale "all 7 cases" count in Task 3 is gone; Rounds 2–3 notes are
  marked superseded; the root-deps line lists all five packages.

### Round 4 — root cause fixed by design change

Round 4 found three more hand-rolled-CommonMark defects (`===` wrongly treated as a thematic break;
list lines polluting the paragraph buffer; `____Strong____` mangled by overlapping underscore rules).
Rounds 2–4 each surfaced a new defect of the same class, which is the real signal: **hand-rolling
CommonMark was the wrong approach.** `doc-lint.ts` now delegates to the actual parser and slugger:

- `enumerateHeadings` = `fromMarkdown(...)` + `toString(node)` — the parser decides what a heading is, so
  fences, indented code, setext-vs-thematic-break, and list interruption are all correct by construction;
  inline markdown is resolved to rendered text for free.
- `slugify` = `new GithubSlugger().slug(text)` — exact GitHub parity, with a fresh instance per call
  because `GithubSlugger` otherwise dedupes to `-1` suffixes and would mask our duplicate-slug error.
- All three round-4 counterexamples plus every earlier case were re-verified against the real packages:
  `===\nText\n---` → `["===\nText"]`, `- item\n---` → `[]`, `____Strong____ here` → `strong-here`.
- **Adjudication accepted:** rendered-text parity is the correct target, so `## __Strong__ here` →
  `strong-here`. This now falls out of `toString` rather than bespoke regex.
- Division of labour changed: `slugify` no longer strips inline markdown (that is `enumerateHeadings`'
  job via `toString`); the Task 2 tests were reorganised accordingly.
- Deps added: `github-slugger`, `mdast-util-from-markdown`, `mdast-util-to-string` (pure JS, types resolve
  under Bundler resolution — verified with a `tsc` probe), installed at the root during de-risking.

### Round 3 (both remaining findings fixed)

- **Intraword `__` corruption:** the single-`_` emphasis rule could start on the SECOND underscore of a
  `__` run, rewriting `foo__bar__` to `foo_bar_`. Both underscore lookarounds now include `_`
  (`(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}_])`), so intraword `__` is left alone. Verified against real
  `github-slugger`: `foo__bar__` → `foo__bar__`.
- **Thematic break polluted the paragraph buffer:** a rule line with no open paragraph was pushed as text,
  so `"---\nText\n---"` yielded `"--- Text"`. Rule lines (`-`, `=`, `***`, `___`) are now skipped when no
  paragraph is open; the case is covered by a test without a blank-line separator.
- **Reference-pipeline note:** GitHub slugs the *rendered* text, so `## __Strong__ here` → `strong-here`,
  whereas raw `github-slugger` on raw markdown returns `__strong__-here`. `enumerateHeadings` (via
  `toString`) + `slugify` together model the rendered pipeline; a test pins this.
