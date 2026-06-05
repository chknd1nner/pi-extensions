> **ARCHIVED / SUPERSEDED (2026-06-05).** This design grew an on-disk dispatcher/variant file format and a manual-override state machine — both unnecessary scope creep. Replaced by the leaner auto-switch design: routing lives only in `_config.json`, "variants" are just separate style files, and manual selection stays sticky (no override machinery). See `../../specs/2026-06-05-styles-auto-switch-design.md` and `../../plans/2026-06-05-styles-auto-switch-impl.md`. Kept for the reasoning trail.

---

# Model-Aware Auto Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add variant selection within complex styles (subdirectory + `dispatcher.json` + multiple `.md` variant files) and an auto-config layer (`_config.json`) that maps `modelId` patterns to style names, while preserving full backwards compatibility with existing flat `<name>.md` styles.

**Architecture:** Introduce a new `extensions/styles/resolver.ts` module that is **ctx-free and UI-free** — given `(manualName, manualOverride, modelId, stylesDir)`, it returns `{ result, warnings }` where `result` is either `null` or a `{ name, isAuto, content }` triple ready for the injector. `extensions/styles/index.ts` becomes a thin orchestrator that owns per-session state (`manualName`, `manualOverride`, `lastModelId`, `lastResult`, `warnedKeys`), funnels every user-initiated `/style` action through a single `setActiveManual` helper, calls `resolveStyle` on every `before_provider_request`, and dispatches the resulting content through the existing `INJECTORS[ctx.model.api]` table. `extensions/styles/injectors.ts` is **unchanged** — variant resolution happens above it.

**Tech Stack:** TypeScript (ES2022, strict mode, ESNext modules, Bundler resolution), Node `fs`/`path`, vitest, `@earendil-works/pi-coding-agent` SDK. Zero external parsing dependencies — `JSON.parse` and plain string ops only.

**Spec:** `docs/superpowers/specs/2026-06-05-styles-model-aware-auto-design.md` (committed at `93610ee`).

**Worktree:** If executing in isolation, create one via the `superpowers:using-git-worktrees` skill before starting Task 1.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `extensions/styles/resolver.ts` | **Create** | Pure-ish resolver: matcher compilation, name/path validation, file existence, mtime-cached loaders, the §5 `resolveStyle` algorithm. No `ctx` import. No UI calls. |
| `extensions/styles/index.ts` | **Modify** | Owns session state, command registration, picker UX, persistence; uses `resolver.ts` for all model→content logic. |
| `extensions/styles/injectors.ts` | **Unchanged** | Existing `INJECTORS` registry dispatched on `model.api`. |
| `extensions/styles/package.json` | **Modify** | Add `test` script, vitest devDep, expand `files` glob for `**/*.json` and `**/*.md` inside `styles/`. |
| `extensions/styles/tests/` | **Create** | Vitest tests. One file per major surface: `matcher.test.ts`, `validators.test.ts`, `loaders.test.ts`, `resolver.test.ts`, `integration.test.ts`. |
| `extensions/styles/styles/_config.json` | **Not created by this plan** | Documented in README; users create it. Optional example file deferred to README appendix. |
| `extensions/styles/README.md` | **Modify** | Document complex styles, `_config.json`, manual-override semantics, `/style off` persistence, resume semantics. |

---

## Task 1: Test infrastructure and smoke

**Files:**
- Modify: `extensions/styles/package.json`
- Create: `extensions/styles/tests/smoke.test.ts`

- [ ] **Step 1: Add `test` script and `vitest` devDep to `extensions/styles/package.json`**

Replace `extensions/styles/package.json` with:

```json
{
  "name": "pi-styles",
  "version": "0.1.0",
  "description": "claude.ai-style ephemeral output styles for Pi, injected as a trailing <userStyle> block after cache_control so prompt caching is preserved.",
  "keywords": ["pi-package", "pi-extension", "styles", "userStyle", "prompt"],
  "license": "MIT",
  "type": "module",
  "files": ["*.ts", "styles/**/*.md", "styles/**/*.json", "README.md"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run --cache=false"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

The `files` glob change ensures `_config.json` and `dispatcher.json` are included when the extension is packaged.

- [ ] **Step 2: Update `tsconfig.json` include glob**

The existing `"include": ["*.ts"]` will not pick up files in `tests/`. Edit `extensions/styles/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create the smoke test**

Create `extensions/styles/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import styles from "../index";

describe("styles extension module", () => {
  it("default export is a registration function", () => {
    expect(typeof styles).toBe("function");
  });
});
```

- [ ] **Step 4: Install workspace dependencies**

Run from repo root:

```bash
npm install
```

Expected: `vitest@^3.2.4` resolved at the workspace root (already present in root devDeps). No `node_modules` should appear inside `extensions/styles/`.

- [ ] **Step 5: Run smoke test**

Run:

```bash
npm test -w pi-styles
```

Expected: PASS. One test passing: `default export is a registration function`.

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck -w pi-styles
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/package.json extensions/styles/tsconfig.json extensions/styles/tests/smoke.test.ts
git commit -m "test(styles): add vitest infrastructure and smoke test"
```

---

## Task 2: `compileMatcher` — string + regex matching primitive

**Files:**
- Create: `extensions/styles/resolver.ts` (initial skeleton)
- Create: `extensions/styles/tests/matcher.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `extensions/styles/tests/matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileMatcher } from "../resolver";

describe("compileMatcher", () => {
  describe("plain strings (exact, case-sensitive)", () => {
    it("matches exact string", () => {
      const m = compileMatcher("claude-sonnet-4-5");
      expect(m).not.toBeNull();
      expect(m!.test("claude-sonnet-4-5")).toBe(true);
    });

    it("does not match different string", () => {
      const m = compileMatcher("claude-sonnet-4-5");
      expect(m!.test("claude-haiku-4-5")).toBe(false);
    });

    it("is case-sensitive by default", () => {
      const m = compileMatcher("claude-sonnet-4-5");
      expect(m!.test("Claude-Sonnet-4-5")).toBe(false);
    });

    it("returns non-null for empty string", () => {
      const m = compileMatcher("");
      expect(m).not.toBeNull();
      expect(m!.test("")).toBe(true);
      expect(m!.test("anything")).toBe(false);
    });
  });

  describe("slash-delimited regex", () => {
    it("matches a prefix anchor regex", () => {
      const m = compileMatcher("/^claude-/");
      expect(m!.test("claude-sonnet-4-5")).toBe(true);
      expect(m!.test("gpt-5")).toBe(false);
    });

    it("respects case-insensitive flag", () => {
      const m = compileMatcher("/^claude-/i");
      expect(m!.test("Claude-Sonnet-4-5")).toBe(true);
    });

    it("accepts allowed flags i, m, s, u in any combination", () => {
      expect(compileMatcher("/foo/imsu")).not.toBeNull();
      expect(compileMatcher("/foo/i")).not.toBeNull();
      expect(compileMatcher("/foo/m")).not.toBeNull();
      expect(compileMatcher("/foo/s")).not.toBeNull();
      expect(compileMatcher("/foo/u")).not.toBeNull();
      expect(compileMatcher("/foo/")).not.toBeNull();
    });
  });

  describe("rejection cases", () => {
    it("rejects disallowed flag g", () => {
      expect(compileMatcher("/foo/g")).toBeNull();
    });

    it("rejects disallowed flag y", () => {
      expect(compileMatcher("/foo/y")).toBeNull();
    });

    it("rejects mixed allowed+disallowed flags", () => {
      expect(compileMatcher("/foo/gi")).toBeNull();
    });

    it("rejects malformed regex pattern", () => {
      expect(compileMatcher("/[unbalanced/")).toBeNull();
    });
  });

  describe("documented limitation: literal looks like regex", () => {
    it("parses /foo/ as regex (cannot exact-match a literal '/foo/' model id)", () => {
      const m = compileMatcher("/foo/");
      // This is the documented limitation. A spec of '/foo/' is parsed as a
      // RegExp matching 'foo' as a substring — not as an exact match against
      // the literal string '/foo/'. The latter is unreachable from this
      // serialization. Real-world model IDs from supported providers never
      // contain leading/trailing slashes, so this is accepted as YAGNI.
      expect(m!.test("foo")).toBe(true);
      expect(m!.test("foobar")).toBe(true);
      expect(m!.test("/foo/")).toBe(true); // because '/foo/' contains 'foo'
      expect(m!.test("xyz")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -w pi-styles -- matcher
```

Expected: FAIL — `Cannot find module '../resolver'` or all 13 tests failing.

- [ ] **Step 3: Implement `compileMatcher` in `resolver.ts`**

Create `extensions/styles/resolver.ts`:

```ts
/**
 * Resolver — given (manualName, manualOverride, modelId, stylesDir), returns
 * the final injectable content or null, plus diagnostic warnings.
 *
 * This module is ctx-free and UI-free. It reads the filesystem (with mtime
 * caches) but emits no side effects on ctx or the UI. Diagnostics flow
 * exclusively through the returned `warnings` array; index.ts is responsible
 * for deduping and surfacing them via ctx.ui.notify.
 *
 * See docs/superpowers/specs/2026-06-05-styles-model-aware-auto-design.md.
 */

/**
 * Detects slash-delimited regex form. Captures any letters in the flags
 * position; flag validity is checked separately so that disallowed flags
 * cause the matcher to be REJECTED rather than misinterpreted as a literal
 * string. (If this regex itself required `[imsu]*`, '/foo/g' would fail the
 * match and silently fall through to exact-string mode — a critical bug.)
 */
const REGEX_FORM = /^\/(.+)\/([A-Za-z]*)$/;
const ALLOWED_FLAGS = /^[imsu]*$/;

export interface Matcher {
  test(modelId: string): boolean;
}

/**
 * Compile a match specification (plain string = exact equality, case-sensitive;
 * `/pattern/flags` = JavaScript RegExp with flags restricted to [imsu]) into a
 * Matcher. Returns null on invalid input (bad regex pattern, disallowed flag).
 */
export function compileMatcher(spec: string): Matcher | null {
  const regex = REGEX_FORM.exec(spec);
  if (regex) {
    const [, pattern, flags] = regex;
    if (!ALLOWED_FLAGS.test(flags)) return null;
    try {
      const re = new RegExp(pattern, flags);
      return { test: (id) => re.test(id) };
    } catch {
      return null;
    }
  }
  return { test: (id) => id === spec };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w pi-styles -- matcher
```

Expected: PASS — all 13 tests passing.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w pi-styles
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/styles/resolver.ts extensions/styles/tests/matcher.test.ts
git commit -m "feat(styles): add compileMatcher for string/regex matching primitive"
```

---

## Task 3: `validateStyleName` and `styleExists` helpers

**Files:**
- Modify: `extensions/styles/resolver.ts`
- Create: `extensions/styles/tests/validators.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `extensions/styles/tests/validators.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateStyleName, styleExists } from "../resolver";

describe("validateStyleName", () => {
  it("accepts simple alphanumeric names", () => {
    expect(validateStyleName("concise")).toBe(true);
    expect(validateStyleName("thought-catalyst")).toBe(true);
    expect(validateStyleName("style.v2")).toBe(true);
    expect(validateStyleName("_internal-debug")).toBe(true);
    expect(validateStyleName("a")).toBe(true);
    expect(validateStyleName("A1")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validateStyleName("../foo")).toBe(false);
    expect(validateStyleName("..")).toBe(false);
  });

  it("rejects slashes", () => {
    expect(validateStyleName("foo/bar")).toBe(false);
    expect(validateStyleName("/abs")).toBe(false);
    expect(validateStyleName("foo\\bar")).toBe(false);
  });

  it("rejects leading dot", () => {
    expect(validateStyleName(".hidden")).toBe(false);
    expect(validateStyleName(".")).toBe(false);
  });

  it("rejects empty and whitespace", () => {
    expect(validateStyleName("")).toBe(false);
    expect(validateStyleName(" ")).toBe(false);
    expect(validateStyleName("foo bar")).toBe(false);
  });
});

describe("styleExists", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 'none' when neither form exists", () => {
    expect(styleExists(tmp, "missing")).toBe("none");
  });

  it("returns 'simple' for a .md file", () => {
    fs.writeFileSync(path.join(tmp, "concise.md"), "be concise");
    expect(styleExists(tmp, "concise")).toBe("simple");
  });

  it("returns 'complex' for a directory containing dispatcher.json", () => {
    fs.mkdirSync(path.join(tmp, "thought-catalyst"));
    fs.writeFileSync(
      path.join(tmp, "thought-catalyst", "dispatcher.json"),
      JSON.stringify({ default: "default.md", variants: [] }),
    );
    expect(styleExists(tmp, "thought-catalyst")).toBe("complex");
  });

  it("returns 'none' for a directory without dispatcher.json", () => {
    fs.mkdirSync(path.join(tmp, "incomplete"));
    fs.writeFileSync(path.join(tmp, "incomplete", "notes.md"), "x");
    expect(styleExists(tmp, "incomplete")).toBe("none");
  });

  it("returns 'both' when simple and complex coexist", () => {
    fs.writeFileSync(path.join(tmp, "foo.md"), "simple");
    fs.mkdirSync(path.join(tmp, "foo"));
    fs.writeFileSync(
      path.join(tmp, "foo", "dispatcher.json"),
      JSON.stringify({ default: "default.md", variants: [] }),
    );
    expect(styleExists(tmp, "foo")).toBe("both");
  });

  it("returns 'none' for invalid names without throwing", () => {
    expect(styleExists(tmp, "../escape")).toBe("none");
    expect(styleExists(tmp, "")).toBe("none");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w pi-styles -- validators
```

Expected: FAIL — `validateStyleName` and `styleExists` not exported.

- [ ] **Step 3: Implement the helpers in `resolver.ts`**

Append to `extensions/styles/resolver.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

/** Valid style basename. No slashes, no leading dot, no traversal. */
const STYLE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;

/**
 * Validate that a style name is a safe basename (no path traversal, no slashes,
 * no leading dot). Used to gate any value that flows from _config.json or other
 * user input into a path.join under stylesDir.
 */
export function validateStyleName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name === "." || name === "..") return false;
  return STYLE_NAME_RE.test(name);
}

export type StyleKind = "none" | "simple" | "complex" | "both";

/**
 * Determine which form(s) of a style exist under stylesDir.
 *   "none"    — neither styles/<name>.md nor styles/<name>/dispatcher.json
 *   "simple"  — styles/<name>.md exists and is a file
 *   "complex" — styles/<name>/dispatcher.json exists
 *   "both"    — both forms exist (collision case; simple wins downstream)
 *
 * Returns "none" for invalid names without throwing.
 */
export function styleExists(stylesDir: string, name: string): StyleKind {
  if (!validateStyleName(name)) return "none";
  const simplePath = path.join(stylesDir, `${name}.md`);
  const dispatcherPath = path.join(stylesDir, name, "dispatcher.json");
  const hasSimple = fileExistsAsFile(simplePath);
  const hasComplex = fileExistsAsFile(dispatcherPath);
  if (hasSimple && hasComplex) return "both";
  if (hasSimple) return "simple";
  if (hasComplex) return "complex";
  return "none";
}

function fileExistsAsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w pi-styles -- validators
```

Expected: PASS — all 14 tests passing.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck -w pi-styles
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add extensions/styles/resolver.ts extensions/styles/tests/validators.test.ts
git commit -m "feat(styles): add validateStyleName and styleExists helpers"
```

---

## Task 4: Cached file readers and JSON loaders

**Files:**
- Modify: `extensions/styles/resolver.ts`
- Create: `extensions/styles/tests/loaders.test.ts`

This task adds three mtime-cached loaders: `readContent` for arbitrary text files, `loadAutoConfig` for `_config.json`, and `loadDispatcher` for `dispatcher.json`. All emit `Warning[]` for parse/validation errors rather than throwing.

- [ ] **Step 1: Define shared types**

Edit `extensions/styles/resolver.ts` — add these exports near the top, after the `Matcher` interface:

```ts
export interface Warning {
  /** Stable dedup key. index.ts dedupes by this against a session-scoped set. */
  key: string;
  /** User-facing message for ctx.ui.notify(..., "warning"). */
  message: string;
}

export interface CompiledAutoRule {
  /** Original raw match spec, kept for warning messages. */
  spec: string;
  matcher: Matcher;
  style: string;
}

export interface CompiledVariant {
  spec: string;
  matcher: Matcher;
  file: string;
}

export interface Dispatcher {
  /** Optional file (relative to the dispatcher directory) prepended to every variant. */
  preamble?: string;
  /** File (relative to dispatcher dir) used when no variant matches. */
  default: string;
  variants: CompiledVariant[];
}
```

- [ ] **Step 2: Write the failing loader tests**

Create `extensions/styles/tests/loaders.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readContent, loadAutoConfig, loadDispatcher } from "../resolver";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-loaders-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("readContent", () => {
  it("returns file contents", () => {
    const f = path.join(tmp, "a.md");
    fs.writeFileSync(f, "hello");
    expect(readContent(f)).toBe("hello");
  });

  it("returns null for missing file", () => {
    expect(readContent(path.join(tmp, "nope.md"))).toBeNull();
  });

  it("reflects mtime-based updates", () => {
    const f = path.join(tmp, "a.md");
    fs.writeFileSync(f, "v1");
    expect(readContent(f)).toBe("v1");
    // Advance mtime by 2 seconds to survive filesystems with 1-second mtime
    // resolution (some Linux ext4, some network filesystems).
    const future = new Date(Date.now() + 2000);
    fs.writeFileSync(f, "v2");
    fs.utimesSync(f, future, future);
    expect(readContent(f)).toBe("v2");
  });
});

describe("loadAutoConfig", () => {
  it("returns empty rules and no warnings when _config.json is missing", () => {
    const out = loadAutoConfig(tmp);
    expect(out.rules).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("compiles a simple list of rules", () => {
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({
        auto: [
          { match: "claude-sonnet-4-5", style: "concise" },
          { match: "/^gpt-/", style: "thought-catalyst" },
        ],
      }),
    );
    const out = loadAutoConfig(tmp);
    expect(out.warnings).toEqual([]);
    expect(out.rules).toHaveLength(2);
    expect(out.rules[0].style).toBe("concise");
    expect(out.rules[0].matcher.test("claude-sonnet-4-5")).toBe(true);
    expect(out.rules[1].matcher.test("gpt-5")).toBe(true);
  });

  it("warns and skips a rule with an invalid regex", () => {
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({
        auto: [
          { match: "/[unbalanced/", style: "concise" },
          { match: "claude", style: "thought-catalyst" },
        ],
      }),
    );
    const out = loadAutoConfig(tmp);
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].style).toBe("thought-catalyst");
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].key).toMatch(/^auto:badmatch:/);
  });

  it("warns and skips a rule with a disallowed flag", () => {
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({ auto: [{ match: "/foo/g", style: "concise" }] }),
    );
    const out = loadAutoConfig(tmp);
    expect(out.rules).toHaveLength(0);
    expect(out.warnings[0].key).toMatch(/^auto:badmatch:/);
  });

  it("warns and skips a rule with an invalid style name", () => {
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({ auto: [{ match: "x", style: "../escape" }] }),
    );
    const out = loadAutoConfig(tmp);
    expect(out.rules).toHaveLength(0);
    expect(out.warnings[0].key).toBe("auto:badname:../escape");
  });

  it("warns once on malformed JSON and returns no rules", () => {
    fs.writeFileSync(path.join(tmp, "_config.json"), "{ not json");
    const out = loadAutoConfig(tmp);
    expect(out.rules).toEqual([]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].key).toBe("auto:parse");
  });

  it("warns when top-level shape is wrong", () => {
    fs.writeFileSync(path.join(tmp, "_config.json"), JSON.stringify({ foo: "bar" }));
    const out = loadAutoConfig(tmp);
    expect(out.warnings[0].key).toBe("auto:shape");
  });

  it("reflects mtime-based edits to _config.json", () => {
    const f = path.join(tmp, "_config.json");
    fs.writeFileSync(f, JSON.stringify({ auto: [{ match: "a", style: "concise" }] }));
    // Seed cache by exercising once.
    expect(loadAutoConfig(tmp).rules).toHaveLength(1);
    // Rewrite with a different rule and advance mtime well past any fs resolution.
    const future = new Date(Date.now() + 2000);
    fs.writeFileSync(f, JSON.stringify({ auto: [{ match: "b", style: "thought-catalyst" }] }));
    fs.utimesSync(f, future, future);
    const out = loadAutoConfig(tmp);
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].style).toBe("thought-catalyst");
  });

  it("invalidates auto cache when _config.json is deleted and re-created", () => {
    const f = path.join(tmp, "_config.json");
    fs.writeFileSync(f, JSON.stringify({ auto: [{ match: "a", style: "concise" }] }));
    expect(loadAutoConfig(tmp).rules).toHaveLength(1);
    fs.rmSync(f);
    expect(loadAutoConfig(tmp).rules).toEqual([]);
    // Recreate with a different rule and verify the cache picks it up.
    fs.writeFileSync(f, JSON.stringify({ auto: [{ match: "b", style: "thought-catalyst" }] }));
    const out = loadAutoConfig(tmp);
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].style).toBe("thought-catalyst");
  });
});

describe("loadDispatcher", () => {
  it("returns null dispatcher and warning when file is missing", () => {
    const out = loadDispatcher(path.join(tmp, "missing"));
    expect(out.dispatcher).toBeNull();
    expect(out.warnings[0].key).toMatch(/^dispatcher:missing:/);
  });

  it("parses a minimal dispatcher", () => {
    const dir = path.join(tmp, "concise");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({ default: "default.md", variants: [] }),
    );
    const out = loadDispatcher(dir);
    expect(out.warnings).toEqual([]);
    expect(out.dispatcher).not.toBeNull();
    expect(out.dispatcher!.default).toBe("default.md");
    expect(out.dispatcher!.variants).toEqual([]);
  });

  it("compiles variants", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({
        preamble: "preamble.md",
        default: "default.md",
        variants: [
          { match: "/^claude-/", file: "anthropic.md" },
          { match: "gpt-5", file: "openai.md" },
        ],
      }),
    );
    const out = loadDispatcher(dir);
    expect(out.warnings).toEqual([]);
    expect(out.dispatcher!.preamble).toBe("preamble.md");
    expect(out.dispatcher!.variants).toHaveLength(2);
    expect(out.dispatcher!.variants[0].matcher.test("claude-sonnet-4-5")).toBe(true);
    expect(out.dispatcher!.variants[1].file).toBe("openai.md");
  });

  it("warns and skips an invalid variant match", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({
        default: "default.md",
        variants: [
          { match: "/foo/g", file: "bad.md" },
          { match: "/^claude-/", file: "good.md" },
        ],
      }),
    );
    const out = loadDispatcher(dir);
    expect(out.dispatcher!.variants).toHaveLength(1);
    expect(out.dispatcher!.variants[0].file).toBe("good.md");
    expect(out.warnings[0].key).toMatch(/^variant:badmatch:/);
  });

  it("rejects variant files that escape the dispatcher directory", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({
        default: "default.md",
        variants: [{ match: "x", file: "../escape.md" }],
      }),
    );
    const out = loadDispatcher(dir);
    expect(out.dispatcher!.variants).toHaveLength(0);
    expect(out.warnings[0].key).toMatch(/^variant:badfile:/);
  });

  it("rejects variant files with an internal '..' segment (sub/../default.md)", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({
        default: "default.md",
        variants: [{ match: "x", file: "sub/../default.md" }],
      }),
    );
    const out = loadDispatcher(dir);
    expect(out.dispatcher!.variants).toHaveLength(0);
    expect(out.warnings[0].key).toMatch(/^variant:badfile:/);
  });

  it("scopes warning keys by dispatcher directory so two broken styles don't dedup together", () => {
    const dirA = path.join(tmp, "a");
    const dirB = path.join(tmp, "b");
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);
    fs.writeFileSync(path.join(dirA, "dispatcher.json"), "{ not json");
    fs.writeFileSync(path.join(dirB, "dispatcher.json"), "{ also broken");
    const outA = loadDispatcher(dirA);
    const outB = loadDispatcher(dirB);
    expect(outA.warnings[0].key).not.toBe(outB.warnings[0].key);
    expect(outA.warnings[0].key).toMatch(/^dispatcher:parse:/);
    expect(outB.warnings[0].key).toMatch(/^dispatcher:parse:/);
  });

  it("rejects an escaping default path", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "dispatcher.json"),
      JSON.stringify({ default: "../escape.md", variants: [] }),
    );
    const out = loadDispatcher(dir);
    expect(out.dispatcher).toBeNull();
    expect(out.warnings[0].key).toMatch(/^dispatcher:baddefault:/);
  });

  it("warns when default field is missing", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "dispatcher.json"), JSON.stringify({ variants: [] }));
    const out = loadDispatcher(dir);
    expect(out.dispatcher).toBeNull();
    expect(out.warnings[0].key).toBe("dispatcher:nodefault:tc");
  });

  it("warns on malformed JSON (key scoped by style directory)", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "dispatcher.json"), "{");
    const out = loadDispatcher(dir);
    expect(out.dispatcher).toBeNull();
    expect(out.warnings[0].key).toBe("dispatcher:parse:tc");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -w pi-styles -- loaders
```

Expected: FAIL — `readContent`, `loadAutoConfig`, `loadDispatcher` not exported.

- [ ] **Step 4: Implement the loaders**

Append to `extensions/styles/resolver.ts`:

```ts
/**
 * Reject a relative path that contains any '..' segment or that is absolute.
 * Checks raw segments BEFORE normalization, so 'sub/../default.md' is
 * rejected even though it normalizes to 'default.md' (which doesn't escape).
 * This matches the spec contract: "paths containing '..' are rejected".
 */
function isSafeRelative(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (path.isAbsolute(rel)) return false;
  const segments = rel.split(/[/\\]/);
  if (segments.includes("..")) return false;
  return true;
}

// ---- readContent (mtime-cached) ---------------------------------------------

interface ContentCacheEntry {
  mtimeMs: number;
  content: string;
}
const contentCache = new Map<string, ContentCacheEntry>();

/** Read a UTF-8 file with an mtime cache. Returns null on any IO error. */
export function readContent(file: string): string | null {
  try {
    const st = fs.statSync(file);
    const cached = contentCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached.content;
    const content = fs.readFileSync(file, "utf8");
    contentCache.set(file, { mtimeMs: st.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}

// ---- loadAutoConfig (mtime-cached) ------------------------------------------

export interface AutoConfigResult {
  rules: CompiledAutoRule[];
  warnings: Warning[];
}

interface AutoCacheEntry {
  mtimeMs: number;
  result: AutoConfigResult;
}
const autoCache = new Map<string, AutoCacheEntry>();

const EMPTY_AUTO: AutoConfigResult = { rules: [], warnings: [] };

export function loadAutoConfig(stylesDir: string): AutoConfigResult {
  const file = path.join(stylesDir, "_config.json");
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    autoCache.delete(file);
    return EMPTY_AUTO;
  }
  const cached = autoCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.result;

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    const result: AutoConfigResult = {
      rules: [],
      warnings: [
        {
          key: "auto:read",
          message: `styles: failed to read _config.json: ${(e as Error).message}`,
        },
      ],
    };
    autoCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const result: AutoConfigResult = {
      rules: [],
      warnings: [
        {
          key: "auto:parse",
          message: `styles: _config.json is not valid JSON: ${(e as Error).message}`,
        },
      ],
    };
    autoCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  const warnings: Warning[] = [];
  const rules: CompiledAutoRule[] = [];

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).auto)) {
    warnings.push({
      key: "auto:shape",
      message: "styles: _config.json must be { auto: [...] } — ignored.",
    });
    const result: AutoConfigResult = { rules, warnings };
    autoCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  for (const entry of (parsed as any).auto as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { match?: unknown; style?: unknown };
    const spec = typeof e.match === "string" ? e.match : "";
    const style = typeof e.style === "string" ? e.style : "";
    if (!spec) {
      warnings.push({
        key: "auto:badmatch:(empty)",
        message: "styles: skipped auto rule with missing/empty match.",
      });
      continue;
    }
    const matcher = compileMatcher(spec);
    if (!matcher) {
      warnings.push({
        key: `auto:badmatch:${spec}`,
        message: `styles: skipped auto rule — invalid match '${spec}' (bad regex or disallowed flag).`,
      });
      continue;
    }
    if (!validateStyleName(style)) {
      warnings.push({
        key: `auto:badname:${style}`,
        message: `styles: skipped auto rule — invalid style name '${style}'.`,
      });
      continue;
    }
    rules.push({ spec, matcher, style });
  }

  const result: AutoConfigResult = { rules, warnings };
  autoCache.set(file, { mtimeMs: st.mtimeMs, result });
  return result;
}

// ---- loadDispatcher (mtime-cached) ------------------------------------------

export interface DispatcherResult {
  dispatcher: Dispatcher | null;
  warnings: Warning[];
}

interface DispatcherCacheEntry {
  mtimeMs: number;
  result: DispatcherResult;
}
const dispatcherCache = new Map<string, DispatcherCacheEntry>();

export function loadDispatcher(styleDir: string): DispatcherResult {
  const file = path.join(styleDir, "dispatcher.json");
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    dispatcherCache.delete(file);
    return {
      dispatcher: null,
      warnings: [
        {
          key: `dispatcher:missing:${path.basename(styleDir)}`,
          message: `styles: dispatcher.json not found under '${path.basename(styleDir)}'.`,
        },
      ],
    };
  }
  const cached = dispatcherCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.result;

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    const result: DispatcherResult = {
      dispatcher: null,
      warnings: [
        {
          key: `dispatcher:read:${path.basename(styleDir)}`,
          message: `styles: failed to read dispatcher.json under '${path.basename(styleDir)}': ${(e as Error).message}`,
        },
      ],
    };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  // Style-name scoped suffix for warning keys: prevents two broken styles
  // from collapsing into a single ctx.ui.notify call via index.ts's dedup.
  const styleTag = path.basename(styleDir);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const result: DispatcherResult = {
      dispatcher: null,
      warnings: [
        {
          key: `dispatcher:parse:${styleTag}`,
          message: `styles: dispatcher.json under '${styleTag}' is not valid JSON: ${(e as Error).message}`,
        },
      ],
    };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  const warnings: Warning[] = [];
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as {
    preamble?: unknown;
    default?: unknown;
    variants?: unknown;
  };

  const defaultFile = typeof obj.default === "string" ? obj.default : "";
  if (!defaultFile) {
    warnings.push({
      key: `dispatcher:nodefault:${styleTag}`,
      message: `styles: dispatcher.json under '${styleTag}' missing 'default' field.`,
    });
    const result: DispatcherResult = { dispatcher: null, warnings };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }
  if (!isSafeRelative(defaultFile)) {
    warnings.push({
      key: `dispatcher:baddefault:${styleTag}:${defaultFile}`,
      message: `styles: dispatcher 'default' path '${defaultFile}' under '${styleTag}' must be a safe relative path.`,
    });
    const result: DispatcherResult = { dispatcher: null, warnings };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  let preamble: string | undefined;
  if (typeof obj.preamble === "string" && obj.preamble.length > 0) {
    if (isSafeRelative(obj.preamble)) {
      preamble = obj.preamble;
    } else {
      warnings.push({
        key: `dispatcher:badpreamble:${styleTag}:${obj.preamble}`,
        message: `styles: dispatcher 'preamble' path '${obj.preamble}' under '${styleTag}' must be a safe relative path; ignored.`,
      });
    }
  }

  const variants: CompiledVariant[] = [];
  const rawVariants = Array.isArray(obj.variants) ? obj.variants : [];
  for (const v of rawVariants) {
    if (!v || typeof v !== "object") continue;
    const vv = v as { match?: unknown; file?: unknown };
    const spec = typeof vv.match === "string" ? vv.match : "";
    const vfile = typeof vv.file === "string" ? vv.file : "";
    if (!spec || !vfile) {
      warnings.push({
        key: `variant:badshape:${styleTag}:${spec || "(empty)"}`,
        message: `styles: skipped variant with missing match or file under '${styleTag}'.`,
      });
      continue;
    }
    const matcher = compileMatcher(spec);
    if (!matcher) {
      warnings.push({
        key: `variant:badmatch:${styleTag}:${spec}`,
        message: `styles: skipped variant — invalid match '${spec}' under '${styleTag}'.`,
      });
      continue;
    }
    if (!isSafeRelative(vfile)) {
      warnings.push({
        key: `variant:badfile:${styleTag}:${vfile}`,
        message: `styles: skipped variant — file '${vfile}' under '${styleTag}' must be a safe relative path.`,
      });
      continue;
    }
    variants.push({ spec, matcher, file: vfile });
  }

  const dispatcher: Dispatcher = { preamble, default: defaultFile, variants };
  const result: DispatcherResult = { dispatcher, warnings };
  dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -w pi-styles -- loaders
```

Expected: PASS — all loader tests passing.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck -w pi-styles
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/resolver.ts extensions/styles/tests/loaders.test.ts
git commit -m "feat(styles): add mtime-cached loaders for content, _config.json, dispatcher.json"
```

---

## Task 5: `resolveStyle` core function

**Files:**
- Modify: `extensions/styles/resolver.ts`
- Create: `extensions/styles/tests/resolver.test.ts`

This task implements the §5 algorithm end-to-end as one TDD cycle, since the branches are tightly coupled. Tests cover the full matrix.

- [ ] **Step 1: Write the failing tests**

Create `extensions/styles/tests/resolver.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStyle } from "../resolver";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-resolver-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSimple(name: string, body: string) {
  fs.writeFileSync(path.join(tmp, `${name}.md`), body);
}

function writeComplex(
  name: string,
  dispatcher: Record<string, unknown>,
  files: Record<string, string>,
) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "dispatcher.json"), JSON.stringify(dispatcher));
  for (const [f, body] of Object.entries(files)) {
    const target = path.join(dir, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

function writeAuto(rules: Array<{ match: string; style: string }>) {
  fs.writeFileSync(path.join(tmp, "_config.json"), JSON.stringify({ auto: rules }));
}

// ---- null / no-style cases --------------------------------------------------

describe("resolveStyle: null cases", () => {
  it("returns null result when no manual and no auto match", () => {
    const out = resolveStyle({
      manualName: null,
      manualOverride: false,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });

  it("returns null when modelId is undefined and no manual", () => {
    const out = resolveStyle({
      manualName: null,
      manualOverride: false,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });
});

// ---- manual override branch -------------------------------------------------

describe("resolveStyle: manual override", () => {
  it("returns the manual style when override is set", () => {
    writeSimple("concise", "be concise");
    writeAuto([{ match: "/.*/", style: "thought-catalyst" }]);
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.name).toBe("concise");
    expect(out.result?.isAuto).toBe(false);
    expect(out.result?.content).toBe("<userStyle>\nbe concise\n</userStyle>");
  });

  it("returns null and skips auto when manualOverride is true and manualName is null (/style off)", () => {
    writeSimple("concise", "be concise");
    writeAuto([{ match: "/.*/", style: "concise" }]);
    const out = resolveStyle({
      manualName: null,
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });
});

// ---- auto-config branch -----------------------------------------------------

describe("resolveStyle: auto-config", () => {
  it("fires when manualOverride is false and a rule matches", () => {
    writeSimple("concise", "be concise");
    writeAuto([{ match: "claude-sonnet-4-5", style: "concise" }]);
    const out = resolveStyle({
      manualName: null,
      manualOverride: false,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.name).toBe("concise");
    expect(out.result?.isAuto).toBe(true);
  });

  it("walks past a rule whose target style does not exist", () => {
    writeSimple("present", "x");
    writeAuto([
      { match: "/.*/", style: "missing" },
      { match: "/.*/", style: "present" },
    ]);
    const out = resolveStyle({
      manualName: null,
      manualOverride: false,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result?.name).toBe("present");
    expect(out.warnings.some((w) => w.key.startsWith("auto:missing:missing"))).toBe(true);
  });

  it("falls back to manualName when no rule matches", () => {
    writeSimple("concise", "be concise");
    writeAuto([{ match: "gpt-4", style: "concise" }]);
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: false,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.name).toBe("concise");
    expect(out.result?.isAuto).toBe(false);
  });

  it("does not evaluate auto when modelId is undefined", () => {
    writeSimple("concise", "be concise");
    writeAuto([{ match: "/.*/", style: "concise" }]);
    const out = resolveStyle({
      manualName: null,
      manualOverride: false,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });
});

// ---- simple style content ---------------------------------------------------

describe("resolveStyle: simple style content", () => {
  it("wraps content in <userStyle> tags", () => {
    writeSimple("concise", "be brief");
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nbe brief\n</userStyle>");
  });

  it("trims surrounding whitespace before wrapping", () => {
    writeSimple("concise", "\n\n  be brief  \n\n");
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nbe brief\n</userStyle>");
  });

  it("returns null when the file is empty (after trim)", () => {
    writeSimple("blank", "   \n\n  ");
    const out = resolveStyle({
      manualName: "blank",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });

  it("returns null and warns when the file is missing", () => {
    const out = resolveStyle({
      manualName: "ghost",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
    expect(out.warnings.some((w) => w.key === "style:missing:ghost")).toBe(true);
  });
});

// ---- complex style content --------------------------------------------------

describe("resolveStyle: complex style content", () => {
  it("returns the default variant when no variant matches", () => {
    writeComplex(
      "tc",
      { default: "default.md", variants: [{ match: "gpt-5", file: "openai.md" }] },
      { "default.md": "default body", "openai.md": "openai body" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\ndefault body\n</userStyle>");
  });

  it("returns the first matching variant", () => {
    writeComplex(
      "tc",
      {
        default: "default.md",
        variants: [
          { match: "/^claude-/", file: "anthropic.md" },
          { match: "/^gpt-/", file: "openai.md" },
        ],
      },
      { "default.md": "d", "anthropic.md": "anth", "openai.md": "oai" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nanth\n</userStyle>");
  });

  it("falls through to default when the matched variant file is missing", () => {
    writeComplex(
      "tc",
      {
        default: "default.md",
        variants: [{ match: "/^claude-/", file: "anthropic.md" }],
      },
      { "default.md": "fallback" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nfallback\n</userStyle>");
    expect(out.warnings.some((w) => w.key.startsWith("variant:missing:"))).toBe(true);
  });

  it("prepends preamble when present and non-empty", () => {
    writeComplex(
      "tc",
      { preamble: "preamble.md", default: "default.md", variants: [] },
      { "preamble.md": "PRE", "default.md": "BODY" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nPRE\n\nBODY\n</userStyle>");
  });

  it("skips preamble when it trims to empty", () => {
    writeComplex(
      "tc",
      { preamble: "preamble.md", default: "default.md", variants: [] },
      { "preamble.md": "   \n\n ", "default.md": "BODY" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nBODY\n</userStyle>");
  });

  it("warns and treats preamble as empty when missing", () => {
    writeComplex(
      "tc",
      { preamble: "preamble.md", default: "default.md", variants: [] },
      { "default.md": "BODY" },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nBODY\n</userStyle>");
    expect(out.warnings.some((w) => w.key.startsWith("preamble:missing:"))).toBe(true);
  });

  it("returns null when the default file is missing", () => {
    writeComplex("tc", { default: "default.md", variants: [] }, {});
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
    expect(out.warnings.some((w) => w.key.startsWith("default:missing:"))).toBe(true);
  });

  it("returns null when dispatcher itself is malformed", () => {
    fs.mkdirSync(path.join(tmp, "tc"));
    fs.writeFileSync(path.join(tmp, "tc", "dispatcher.json"), "{ not json");
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "anything",
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
    expect(out.warnings.some((w) => w.key.startsWith("dispatcher:parse:"))).toBe(true);
  });
});

// ---- edge cases -------------------------------------------------------------

describe("resolveStyle: edge cases", () => {
  it("simple wins when both forms exist (with collision warning)", () => {
    writeSimple("foo", "simple body");
    writeComplex("foo", { default: "default.md", variants: [] }, { "default.md": "complex body" });
    const out = resolveStyle({
      manualName: "foo",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nsimple body\n</userStyle>");
    expect(out.warnings.some((w) => w.key === "collision:foo")).toBe(true);
  });

  it("rejects manualName that fails path validation", () => {
    const out = resolveStyle({
      manualName: "../escape",
      manualOverride: true,
      modelId: undefined,
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
    expect(out.warnings.some((w) => w.key === "style:badname:../escape")).toBe(true);
  });

  it("does NOT surface loadAutoConfig warnings when manual override wins", () => {
    writeSimple("concise", "x");
    fs.writeFileSync(path.join(tmp, "_config.json"), "{ not json");
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    // The resolver only consults auto when manualOverride is false, so it must
    // NOT surface auto-config parse warnings on this path.
    expect(out.warnings.some((w) => w.key === "auto:parse")).toBe(false);
    expect(out.result?.name).toBe("concise");
  });

  it("falls through to default when matched variant content trims empty (with non-empty preamble)", () => {
    writeComplex(
      "tc",
      {
        preamble: "preamble.md",
        default: "default.md",
        variants: [{ match: "/^claude-/", file: "anthropic.md" }],
      },
      { "preamble.md": "PRE", "default.md": "DEF", "anthropic.md": "   \n  " },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result?.content).toBe("<userStyle>\nPRE\n\nDEF\n</userStyle>");
    expect(out.warnings.some((w) => w.key.startsWith("variant:empty:"))).toBe(true);
  });

  it("returns null when both variant and default content trim empty", () => {
    writeComplex(
      "tc",
      {
        preamble: "preamble.md",
        default: "default.md",
        variants: [{ match: "/^claude-/", file: "anthropic.md" }],
      },
      { "preamble.md": "PRE", "default.md": "   ", "anthropic.md": "   " },
    );
    const out = resolveStyle({
      manualName: "tc",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    expect(out.result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w pi-styles -- resolver
```

Expected: FAIL — `resolveStyle` not exported.

- [ ] **Step 3: Implement `resolveStyle`**

Append to `extensions/styles/resolver.ts`:

```ts
// ---- resolveStyle -----------------------------------------------------------

export interface ResolveInput {
  /** Persisted manual baseline; null means "off" or never set (disambiguated by manualOverride). */
  manualName: string | null;
  /** True when the user has explicitly chosen (including /style off). Skips auto entirely. */
  manualOverride: boolean;
  modelId: string | undefined;
  stylesDir: string;
}

export interface ResolvedStyle {
  name: string;
  isAuto: boolean;
  /** Already wrapped in <userStyle>…</userStyle> and ready for the injector. */
  content: string;
}

export interface ResolveOutput {
  result: ResolvedStyle | null;
  warnings: Warning[];
}

const NO_RESULT = (warnings: Warning[]): ResolveOutput => ({ result: null, warnings });

/**
 * Resolve the active style for a given (manualName, manualOverride, modelId)
 * combination. See spec §5 for the full algorithm.
 */
export function resolveStyle(input: ResolveInput): ResolveOutput {
  const { manualName, manualOverride, modelId, stylesDir } = input;
  const warnings: Warning[] = [];

  // 1. Choose name + isAuto.
  let chosenName: string | null;
  let isAuto: boolean;

  if (manualOverride) {
    // Manual selection wins (including /style off, where manualName === null).
    chosenName = manualName;
    isAuto = false;
  } else if (typeof modelId === "string") {
    const auto = loadAutoConfig(stylesDir);
    warnings.push(...auto.warnings);

    let picked: string | null = null;
    for (const rule of auto.rules) {
      if (!rule.matcher.test(modelId)) continue;
      const kind = styleExists(stylesDir, rule.style);
      if (kind === "none") {
        warnings.push({
          key: `auto:missing:${rule.style}`,
          message: `styles: auto-rule matched but style '${rule.style}' is missing; skipped.`,
        });
        continue;
      }
      picked = rule.style;
      break;
    }
    if (picked !== null) {
      chosenName = picked;
      isAuto = true;
    } else {
      chosenName = manualName;
      isAuto = false;
    }
  } else {
    chosenName = manualName;
    isAuto = false;
  }

  // 2. If no name chosen → no injection.
  if (chosenName === null) return NO_RESULT(warnings);

  // 3. Validate the chosen name before any path.join.
  if (!validateStyleName(chosenName)) {
    warnings.push({
      key: `style:badname:${chosenName}`,
      message: `styles: '${chosenName}' is not a valid style name.`,
    });
    return NO_RESULT(warnings);
  }

  // 4. Detect kind and read raw content.
  const kind = styleExists(stylesDir, chosenName);
  if (kind === "none") {
    warnings.push({
      key: `style:missing:${chosenName}`,
      message: `styles: style '${chosenName}' not found under '${stylesDir}'.`,
    });
    return NO_RESULT(warnings);
  }

  if (kind === "both") {
    warnings.push({
      key: `collision:${chosenName}`,
      message: `styles: both '${chosenName}.md' and '${chosenName}/dispatcher.json' exist; simple form wins.`,
    });
  }

  let rawContent: string | null = null;

  if (kind === "simple" || kind === "both") {
    rawContent = readContent(path.join(stylesDir, `${chosenName}.md`));
    if (rawContent === null) {
      warnings.push({
        key: `style:read:${chosenName}`,
        message: `styles: failed to read '${chosenName}.md'.`,
      });
      return NO_RESULT(warnings);
    }
  } else {
    // complex
    const styleDir = path.join(stylesDir, chosenName);
    const dispatcherResult = loadDispatcher(styleDir);
    warnings.push(...dispatcherResult.warnings);
    const dispatcher = dispatcherResult.dispatcher;
    if (!dispatcher) return NO_RESULT(warnings);

    // Pick variant file or default.
    let variantFile: string | null = null;
    if (typeof modelId === "string") {
      for (const v of dispatcher.variants) {
        if (v.matcher.test(modelId)) {
          variantFile = v.file;
          break;
        }
      }
    }

    let body: string | null = null;
    if (variantFile !== null) {
      const candidate = readContent(path.join(styleDir, variantFile));
      if (candidate === null) {
        warnings.push({
          key: `variant:missing:${chosenName}:${variantFile}`,
          message: `styles: variant file '${variantFile}' missing under '${chosenName}'; falling back to default.`,
        });
      } else if (candidate.trim().length === 0) {
        // Treat an empty-after-trim variant as a soft miss — fall through to
        // the default rather than rendering preamble alone or an empty body.
        warnings.push({
          key: `variant:empty:${chosenName}:${variantFile}`,
          message: `styles: variant file '${variantFile}' under '${chosenName}' is empty; falling back to default.`,
        });
      } else {
        body = candidate;
      }
    }

    if (body === null) {
      const defaultBody = readContent(path.join(styleDir, dispatcher.default));
      if (defaultBody === null) {
        warnings.push({
          key: `default:missing:${chosenName}`,
          message: `styles: default file '${dispatcher.default}' missing under '${chosenName}'.`,
        });
        return NO_RESULT(warnings);
      }
      if (defaultBody.trim().length === 0) {
        // Both variant and default empty — no useful content. Drop injection.
        return NO_RESULT(warnings);
      }
      body = defaultBody;
    }

    if (dispatcher.preamble) {
      const preambleRaw = readContent(path.join(styleDir, dispatcher.preamble));
      if (preambleRaw === null) {
        warnings.push({
          key: `preamble:missing:${chosenName}`,
          message: `styles: preamble file '${dispatcher.preamble}' missing under '${chosenName}'; treated as empty.`,
        });
      } else {
        const preambleTrimmed = preambleRaw.trim();
        if (preambleTrimmed.length > 0) {
          body = `${preambleTrimmed}\n\n${body}`;
        }
      }
    }

    rawContent = body;
  }

  // 5. Trim and gate empty.
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) return NO_RESULT(warnings);

  return {
    result: {
      name: chosenName,
      isAuto,
      content: `<userStyle>\n${trimmed}\n</userStyle>`,
    },
    warnings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w pi-styles -- resolver
```

Expected: PASS — all resolver tests passing.

- [ ] **Step 5: Run all tests to check for regressions**

```bash
npm test -w pi-styles
```

Expected: every test from Tasks 1–5 passing.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck -w pi-styles
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/resolver.ts extensions/styles/tests/resolver.test.ts
git commit -m "feat(styles): implement resolveStyle covering manual override, auto-config, simple and complex variants"
```

---

## Task 6: `index.ts` — picker enumeration for simple + complex styles

This task updates only the picker enumeration so that both flat `.md` files and complex directories are listed. State and resolver integration come in Tasks 7–8.

**Files:**
- Modify: `extensions/styles/index.ts`
- Create: `extensions/styles/tests/list-styles.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `extensions/styles/tests/list-styles.test.ts`. (`listStyles` will be exported from `index.ts` in Step 2 so the test can target it directly with a synthetic directory.)

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listStyles } from "../index";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-list-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSimple(name: string, body = "x") {
  fs.writeFileSync(path.join(tmp, `${name}.md`), body);
}

function writeComplex(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, "dispatcher.json"),
    JSON.stringify({ default: "default.md", variants: [] }),
  );
  fs.writeFileSync(path.join(dir, "default.md"), "d");
}

describe("listStyles", () => {
  it("returns an empty array when the directory has no styles", () => {
    expect(listStyles(tmp)).toEqual([]);
  });

  it("enumerates simple .md files", () => {
    writeSimple("concise");
    writeSimple("thought-catalyst");
    expect(listStyles(tmp)).toEqual(["concise", "thought-catalyst"]);
  });

  it("enumerates complex style directories containing dispatcher.json", () => {
    writeComplex("tc");
    expect(listStyles(tmp)).toEqual(["tc"]);
  });

  it("mixes simple and complex styles, sorted by name", () => {
    writeSimple("zeta");
    writeComplex("alpha");
    writeSimple("mu");
    expect(listStyles(tmp)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("skips directories without dispatcher.json", () => {
    fs.mkdirSync(path.join(tmp, "incomplete"));
    fs.writeFileSync(path.join(tmp, "incomplete", "notes.md"), "x");
    expect(listStyles(tmp)).toEqual([]);
  });

  it("excludes underscore- and dot-prefixed directories from the picker", () => {
    // _config.json sits at the top level. Directories starting with _ or .
    // are reserved for internal use and never shown in the picker even if
    // they contain a dispatcher.json.
    fs.writeFileSync(path.join(tmp, "_config.json"), JSON.stringify({ auto: [] }));
    writeComplex("_internal");
    writeComplex(".hidden");
    writeSimple("public");
    expect(listStyles(tmp)).toEqual(["public"]);
  });

  it("de-duplicates when both forms exist for the same name (simple listed first)", () => {
    writeSimple("foo");
    writeComplex("foo");
    // The picker lists each name once; the collision is surfaced as a warning
    // by the resolver, not by the picker.
    expect(listStyles(tmp)).toEqual(["foo"]);
  });

  it("returns [] when the directory does not exist", () => {
    expect(listStyles(path.join(tmp, "nonexistent"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w pi-styles -- list-styles
```

Expected: FAIL — `listStyles` not exported, or signature mismatch.

- [ ] **Step 3: Refactor `listStyles` to take a directory argument and export it**

Replace the existing `listStyles` function in `extensions/styles/index.ts` (currently around line 53) with:

```ts
export function listStyles(dir: string = STYLE_DIR): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const names: string[] = [];
  // Simple .md files.
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (!lower.endsWith(".md")) continue;
    const name = e.name.slice(0, -3);
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  // Complex style directories (must contain dispatcher.json).
  // Underscore- and dot-prefixed directories are reserved for internal use.
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    try {
      const st = fs.statSync(path.join(dir, e.name, "dispatcher.json"));
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    if (!seen.has(e.name)) {
      seen.add(e.name);
      names.push(e.name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}
```

Note: `listStyles()` (no args) still works because `dir` defaults to `STYLE_DIR`. Existing callers inside the default export do not need to change. The `ensureDir()` side effect from the previous version is dropped — callers that need it (`runCreate`) already call `ensureDir()` directly.

Also delete the now-unused helper `styleFile` (currently around line 49):

```ts
function styleFile(name: string): string {
  return path.join(STYLE_DIR, `${name}.md`);
}
```

…and update its remaining callers. The references are:

- inside `readStyleText` (will be deleted entirely in Task 8 — for now, inline the path):

  ```ts
  const file = path.join(STYLE_DIR, `${name}.md`);
  ```

- inside `session_start`:

  ```ts
  if (activeName && !fs.existsSync(path.join(STYLE_DIR, `${activeName}.md`))) activeName = null;
  ```

- inside `runCreate`:

  ```ts
  const file = path.join(STYLE_DIR, `${name}.md`);
  ```

Inlining these keeps the diff smaller now; Task 8 will replace `readStyleText` and the session-start existence check entirely.

- [ ] **Step 4: Run the list-styles test to verify it passes**

```bash
npm test -w pi-styles -- list-styles
```

Expected: PASS — all 8 `listStyles` tests passing.

- [ ] **Step 5: Run the full test suite and typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every test from Tasks 1–6 passing; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add extensions/styles/index.ts extensions/styles/tests/list-styles.test.ts
git commit -m "refactor(styles): enumerate both simple and complex styles via testable listStyles(dir)"
```

---

## Task 7: `index.ts` — state machine and `setActiveManual`

Introduce the new state model: `manualName`, `manualOverride`, `lastModelId`, `lastResult`, `warnedKeys`. Funnel every user-initiated activation through `setActiveManual`. Update `session_start` to restore `manualOverride := true` whenever an entry exists. This task leaves the `before_provider_request` handler untouched (still using the old `activeName` shim); the resolver integration comes in Task 8.

**Files:**
- Modify: `extensions/styles/index.ts`

- [ ] **Step 1: Replace the entire default-export function**

Locate the existing `export default function styles(pi: ExtensionAPI) { ... }` block (the whole function, including signature and closing brace) and replace it with the block below. **Do not touch** the module-level helpers above it (`HERE`, `STYLE_DIR`, `ACTIVE_ENTRY`, `DEBUG`, `ACT_CREATE`, `ACT_OFF`, `debug`, `ensureDir`, `slugify`, and the now-exported `listStyles` from Task 6) — those stay as-is.

The replacement keeps the same function signature (`export default function styles(pi: ExtensionAPI)`) but rewrites the inner closure to introduce the new state and the `setActiveManual` mutation helper. Sections in the body marked `// (unchanged in this task)` carry over verbatim from the current code; Task 8 will revise them.

```ts
export default function styles(pi: ExtensionAPI) {
  // ---- session state ----
  let manualName: string | null = null;
  let manualOverride = false;
  let lastModelId: string | undefined = undefined;
  // ResolvedStyle from the last request; used in Task 8 for autoFired transition detection.
  let lastResultName: string | null = null;
  let lastResultIsAuto = false;
  const warnedKeys = new Set<string>();
  const warnedApis = new Set<string>();

  // Old cache used by the legacy readStyleText path; will be removed in Task 8.
  let cache: { name: string; mtimeMs: number; text: string } | null = null;

  function updateFooter(ctx: any) {
    const suffix = manualOverride ? "" : (lastResultIsAuto ? " (auto)" : "");
    ctx?.ui?.setStatus?.(
      "style",
      manualName ? `style: ${manualName}${suffix}` : lastResultName ? `style: ${lastResultName}${suffix}` : undefined,
    );
  }

  /**
   * The single mutation point for every user-initiated style change.
   * Sets manualOverride=true and persists the choice.
   */
  function setActiveManual(name: string | null, ctx: any) {
    manualName = name;
    manualOverride = true;
    cache = null;
    try {
      pi.appendEntry(ACTIVE_ENTRY, { name });
    } catch {
      /* ephemeral session: in-memory only */
    }
    updateFooter(ctx);
    debug("setActiveManual", { name, manualOverride });
  }

  /** Read + wrap a simple-style file (legacy path used until Task 8). */
  function readStyleText(name: string): string | null {
    const file = path.join(STYLE_DIR, `${name}.md`);
    try {
      const st = fs.statSync(file);
      if (cache && cache.name === name && cache.mtimeMs === st.mtimeMs) return cache.text;
      const raw = fs.readFileSync(file, "utf8").trim();
      const text = raw ? `<userStyle>\n${raw}\n</userStyle>` : "";
      cache = { name, mtimeMs: st.mtimeMs, text };
      return text;
    } catch {
      return null;
    }
  }

  // ---- restore active style on session start / reload / resume ----
  pi.on("session_start", async (_event, ctx) => {
    manualName = null;
    manualOverride = false;
    lastModelId = undefined;
    lastResultName = null;
    lastResultIsAuto = false;
    cache = null;
    warnedKeys.clear();

    let foundEntry = false;
    try {
      const sm: any = ctx.sessionManager;
      const entries = sm.getBranch?.() ?? sm.getEntries?.() ?? [];
      for (const entry of entries) {
        if (entry?.type === "custom" && entry?.customType === ACTIVE_ENTRY) {
          const n = entry?.data?.name;
          manualName = typeof n === "string" ? n : null;
          foundEntry = true;
        }
      }
    } catch {
      /* ignore */
    }
    // Any persisted entry — including { name: null } for "off" — counts as an
    // explicit user choice and is restored as an active override.
    manualOverride = foundEntry;

    // Legacy guard: clear an obviously-broken simple manual name.
    // (Task 8 will replace this check with a resolver-driven one.)
    if (manualName && !fs.existsSync(path.join(STYLE_DIR, `${manualName}.md`))) {
      const complexDispatcher = path.join(STYLE_DIR, manualName, "dispatcher.json");
      if (!fs.existsSync(complexDispatcher)) {
        manualName = null;
        // manualOverride stays as it was — even an explicit override pointing
        // at a now-missing style is still a deliberate choice; the resolver
        // (Task 8) will surface a warning on the next request.
      }
    }

    updateFooter(ctx);
    debug("session_start", { manualName, manualOverride });
  });

  // ---- ephemeral payload-layer injection (unchanged in this task — Task 8 replaces this block) ----
  pi.on("before_provider_request", (event, ctx) => {
    if (!manualName) return;
    const text = readStyleText(manualName);
    if (!text) return;

    const api = (ctx as any).model?.api as string | undefined;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, text);
        debug("injected", { api, style: manualName });
        return event.payload;
      }
      const key = api ?? "unknown";
      const ok = genericFallback(event.payload, text);
      if (!warnedApis.has(key)) {
        warnedApis.add(key);
        ctx.ui?.notify?.(
          `styles: '${key}' not explicitly supported — using generic injection; caching path unverified.`,
          "warning",
        );
      }
      return ok ? event.payload : undefined;
    } catch (e) {
      ctx.ui?.notify?.(
        `styles: skipped injection (${api ?? "?"}): ${(e as Error).message}`,
        "warning",
      );
      return;
    }
  });

  // ---- create-new-style flow ----
  async function runCreate(ctx: any) {
    const rawName = await ctx.ui.input("New style name:", "e.g. concise, socratic, code-only");
    if (!rawName) return;
    const name = slugify(rawName);
    const file = path.join(STYLE_DIR, `${name}.md`);
    if (fs.existsSync(file)) {
      const ok = await ctx.ui.confirm("Overwrite?", `Style '${name}' already exists. Overwrite it?`);
      if (!ok) return;
    }
    const seed =
      "Write the instructions that should shape responses here.\n\n" +
      "- Tone and voice\n- Length and structure\n- Formatting preferences\n";
    const content = await ctx.ui.editor(`Style: ${name}`, seed);
    if (content == null) return;
    ensureDir();
    fs.writeFileSync(file, `${content.trim()}\n`, "utf8");
    setActiveManual(name, ctx);
    ctx.ui.notify(`Created and activated style '${name}'.`, "info");
  }

  /** Direct activation via `/style <name|off>`. Returns true if it consumed the arg. */
  function activateByName(arg: string, ctx: any): boolean {
    const a = arg.trim();
    if (!a) return false;
    if (/^(off|none|clear)$/i.test(a)) {
      setActiveManual(null, ctx);
      ctx.ui.notify("Styles turned off.", "info");
      return true;
    }
    const names = listStyles();
    const slug = slugify(a);
    const match =
      names.find((n) => n === a) ??
      names.find((n) => n === slug) ??
      names.find((n) => n.toLowerCase() === a.toLowerCase());
    if (!match) {
      ctx.ui.notify(`No style named '${a}'.`, "warning");
      return true;
    }
    setActiveManual(match, ctx);
    ctx.ui.notify(`Style '${match}' activated.`, "info");
    return true;
  }

  pi.registerCommand("style", {
    description: "Select, create, or turn off an output style (ephemeral <userStyle> injection)",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        ...listStyles().map((n) => ({ value: n, label: n })),
        { value: "off", label: "off (turn off)" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length ? filtered : null;
    },
    handler: async (args: string, ctx: any) => {
      if (args && args.trim()) {
        activateByName(args, ctx);
        return;
      }
      const names = listStyles();
      const options = [
        ...names.map((n) => (n === manualName ? `✓ ${n}` : `  ${n}`)),
        ACT_OFF,
        ACT_CREATE,
      ];
      const choice = await ctx.ui.select("Output style", options);
      if (!choice) return;
      if (choice === ACT_CREATE) {
        await runCreate(ctx);
        return;
      }
      if (choice === ACT_OFF) {
        setActiveManual(null, ctx);
        ctx.ui.notify("Styles turned off.", "info");
        return;
      }
      const name = choice.replace(/^(✓ |  )/, "");
      setActiveManual(name, ctx);
      ctx.ui.notify(`Style '${name}' activated.`, "info");
    },
  });
}
```

Note: every call site that previously used `setActive(name, ctx)` or `setActive(null, ctx)` now uses `setActiveManual(name, ctx)`. The picker tick comparison and footer text continue to use `manualName` for the "user has chosen X" case; Task 8 adds the `(auto)` rendering driven by resolver results.

- [ ] **Step 2: Run tests and typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: smoke test still passes; typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add extensions/styles/index.ts
git commit -m "refactor(styles): introduce manualName/manualOverride state and setActiveManual helper"
```

---

## Task 8: `index.ts` — wire `resolveStyle` into `before_provider_request`

Replace the legacy `readStyleText` path with `resolveStyle`. Implement the `modelChanged` predicate, the `manualName !== null` guard on `manualOverride` reset, warning dedup, the autoFired transition check, the `(auto)` footer suffix, and notification on auto-fire.

**Files:**
- Modify: `extensions/styles/index.ts`

- [ ] **Step 1: Add the resolver import at the top of `index.ts`**

```ts
import { resolveStyle, type ResolvedStyle } from "./resolver";
```

- [ ] **Step 2: Extract a shared per-request transition function**

The state-machine integration tests in Task 9 must exercise the **same** transition logic that runs at request time — a hand-rolled copy would silently drift. Extract the pure state transition (the resolver call, the `manualOverride` reset rule, the autoFired diff, the lastModelId tracking) into a top-level exported helper. The `before_provider_request` handler becomes a thin wrapper that performs the transition and then does the ctx-side effects.

Add these exports at the **module level** of `extensions/styles/index.ts`, above the default export:

```ts
export interface RequestState {
  manualName: string | null;
  manualOverride: boolean;
  /** Last DEFINED modelId we've seen. Undefined transitions do NOT update this. */
  lastModelId: string | undefined;
  lastResultName: string | null;
  lastResultIsAuto: boolean;
}

export function modelChanged(
  prev: string | undefined,
  curr: string | undefined,
): boolean {
  return prev !== undefined && curr !== undefined && prev !== curr;
}

export interface TransitionOutput {
  state: RequestState;
  result: ResolvedStyle | null;
  autoFired: boolean;
  warnings: Warning[];
}

/**
 * Compute the next RequestState and resolved style for an incoming model id.
 * Pure: no ctx, no UI, no persistence. The caller is responsible for
 * surfacing warnings, notifying on autoFired, updating the footer, and
 * dispatching the injection.
 *
 * `state` is treated as immutable input; a new state is returned.
 */
export function processModelRequest(
  state: RequestState,
  modelId: string | undefined,
  stylesDir: string,
): TransitionOutput {
  // 1. Reset per-model stickiness only on defined→different-defined AND a
  //    non-`/style off` previous choice.
  let nextManualOverride = state.manualOverride;
  if (modelChanged(state.lastModelId, modelId) && state.manualName !== null) {
    nextManualOverride = false;
  }

  // 2. Resolve.
  const out = resolveStyle({
    manualName: state.manualName,
    manualOverride: nextManualOverride,
    modelId,
    stylesDir,
  });
  const result = out.result;

  // 3. autoFired purely from result transition.
  const autoFired =
    !!result &&
    result.isAuto &&
    (state.lastResultName !== result.name || !state.lastResultIsAuto);

  // 4. lastModelId tracks the last DEFINED model id only. Transient undefined
  //    requests do not erase the last known model — essential for the
  //    edge case 'defined → undefined → different defined' to correctly
  //    trigger a reset on the third step.
  const nextLastModelId = modelId === undefined ? state.lastModelId : modelId;

  return {
    state: {
      manualName: state.manualName,
      manualOverride: nextManualOverride,
      lastModelId: nextLastModelId,
      lastResultName: result ? result.name : null,
      lastResultIsAuto: result ? result.isAuto : false,
    },
    result,
    autoFired,
    warnings: out.warnings,
  };
}
```

Also import `Warning` from the resolver at the top of `index.ts`:

```ts
import { resolveStyle, type ResolvedStyle, type Warning } from "./resolver";
```

(Supersedes the import added in Step 1.)

- [ ] **Step 3: Replace `before_provider_request` handler and remove dead code**

Find the existing `before_provider_request` handler (the block from Task 7 marked `// ---- ephemeral payload-layer injection (unchanged in this task — Task 8 replaces this block) ----`) and replace it with:

```ts
  // ---- ephemeral payload-layer injection (resolver-driven) ----
  pi.on("before_provider_request", (event, ctx) => {
    const currentModelId = ctx.model?.id;

    const transition = processModelRequest(
      {
        manualName,
        manualOverride,
        lastModelId,
        lastResultName,
        lastResultIsAuto,
      },
      currentModelId,
      STYLE_DIR,
    );

    // Commit state updates.
    manualOverride = transition.state.manualOverride;
    lastModelId = transition.state.lastModelId;
    lastResultName = transition.state.lastResultName;
    lastResultIsAuto = transition.state.lastResultIsAuto;

    // Surface deduped warnings.
    for (const w of transition.warnings) {
      if (warnedKeys.has(w.key)) continue;
      warnedKeys.add(w.key);
      ctx.ui?.notify?.(w.message, "warning");
    }

    const result = transition.result;

    if (transition.autoFired && result) {
      ctx.ui?.notify?.(
        `Auto-applied style '${result.name}' for model '${currentModelId}'.`,
        "info",
      );
    }

    renderFooter(ctx, result);

    if (!result) return;

    const api = ctx.model?.api;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, result.content);
        debug("injected", { api, style: result.name, isAuto: result.isAuto });
        return event.payload;
      }
      const key = api ?? "unknown";
      const ok = genericFallback(event.payload, result.content);
      if (!warnedApis.has(key)) {
        warnedApis.add(key);
        ctx.ui?.notify?.(
          `styles: '${key}' not explicitly supported — using generic injection; caching path unverified.`,
          "warning",
        );
      }
      return ok ? event.payload : undefined;
    } catch (e) {
      ctx.ui?.notify?.(
        `styles: skipped injection (${api ?? "?"}): ${(e as Error).message}`,
        "warning",
      );
      return;
    }
  });
```

If the TypeScript compiler reports that `ctx.model` is `unknown` or `any` (i.e. the installed SDK types don't expose `model`), fall back to `(ctx as any).model?.id` and `(ctx as any).model?.api` and add a TODO to revisit when SDK types catch up. Run `npm run typecheck -w pi-styles` after this step to confirm.

- [ ] **Step 4: Replace the old `updateFooter` with the result-aware `renderFooter`, and fix the picker checkmark**

Delete the existing `updateFooter` introduced in Task 7 and replace it with:

```ts
  /**
   * Footer rendering:
   *   - Resolver returned a named style → "style: <name>" + " (auto)" iff isAuto.
   *   - Resolver returned null but manualOverride+manualName is set → "style: <name>".
   *   - Resolver returned null and manualName is null → cleared.
   */
  function renderFooter(ctx: any, result: ResolvedStyle | null) {
    if (result) {
      const suffix = result.isAuto ? " (auto)" : "";
      ctx?.ui?.setStatus?.("style", `style: ${result.name}${suffix}`);
      return;
    }
    if (manualOverride && manualName) {
      ctx?.ui?.setStatus?.("style", `style: ${manualName}`);
      return;
    }
    ctx?.ui?.setStatus?.("style", undefined);
  }
```

Update the two existing callers in `setActiveManual` and `session_start` to call `renderFooter(ctx, null)` instead of `updateFooter(ctx)`. After this change, every footer update flows through `renderFooter`, so the rendering is single-sourced.

**Fix the picker active-marker (spec §7):** an auto-applied style must show `✓` in the picker too, not only manual picks. Find the picker handler's `options` construction:

```ts
      const options = [
        ...names.map((n) => (n === manualName ? `✓ ${n}` : `  ${n}`)),
```

…and replace the comparand with the most recently *resolved* name, falling back to `manualName` for the case where the user opens the picker before any request has fired (so `lastResultName` is still null):

```ts
      const activeForPicker = lastResultName ?? manualName;
      const options = [
        ...names.map((n) => (n === activeForPicker ? `✓ ${n}` : `  ${n}`)),
```

- [ ] **Step 5: Remove the now-dead `readStyleText` function and `cache` variable**

Delete:

```ts
  let cache: { name: string; mtimeMs: number; text: string } | null = null;
```

…and the entire `readStyleText` function. Remove the `cache = null;` lines in `setActiveManual` and `session_start`.

- [ ] **Step 6: Remove the now-stale `manualName` existence check from `session_start`**

The post-restore block:

```ts
    if (manualName && !fs.existsSync(path.join(STYLE_DIR, `${manualName}.md`))) {
      const complexDispatcher = path.join(STYLE_DIR, manualName, "dispatcher.json");
      if (!fs.existsSync(complexDispatcher)) {
        manualName = null;
      }
    }
```

…is no longer required: the resolver will surface a `style:missing:<name>` warning on the first request if the persisted name does not exist. Keeping the persisted `manualName` in place preserves the user's choice if the file is temporarily missing (e.g. unsynced project), matching the "explicit user choice is sacrosanct" axiom from the spec. **Delete this block.**

- [ ] **Step 7: Run all tests and typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every prior test still passes; smoke test still passes; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add extensions/styles/index.ts
git commit -m "feat(styles): drive injection through resolver with autoFired transition + warning dedup"
```

---

## Task 9: Integration tests — state machine lifecycle

This task verifies the lifecycle invariants from §5–§8 of the spec by calling **the same `processModelRequest` function** that the production handler calls (exported in Task 8). Because the test and the handler share one transition function, they cannot drift. We also add a fake-`ExtensionAPI` harness test that exercises the actual registered handlers end-to-end — covering plumbing the unit tests can't (UI calls, warning dedup, session_start scan, picker active-marker, payload mutation).

**Files:**
- Create: `extensions/styles/tests/integration.test.ts`
- Create: `extensions/styles/tests/harness.test.ts`

- [ ] **Step 1: Write the failing state-machine integration tests**

Create `extensions/styles/tests/integration.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processModelRequest, type RequestState } from "../index";

/**
 * These tests verify the lifecycle invariants from spec §5–§8 by calling the
 * SAME processModelRequest function that the production handler calls. They
 * cannot drift from the handler.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-integration-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function freshState(): RequestState {
  return {
    manualName: null,
    manualOverride: false,
    lastModelId: undefined,
    lastResultName: null,
    lastResultIsAuto: false,
  };
}

function step(state: RequestState, modelId: string | undefined) {
  const out = processModelRequest(state, modelId, tmp);
  return { ...out };
}

function setManual(state: RequestState, name: string | null): RequestState {
  return { ...state, manualName: name, manualOverride: true };
}

function writeStyles() {
  fs.writeFileSync(path.join(tmp, "concise.md"), "be concise");
  fs.writeFileSync(path.join(tmp, "thought-catalyst.md"), "think hard");
  fs.writeFileSync(
    path.join(tmp, "_config.json"),
    JSON.stringify({
      auto: [
        { match: "/^claude-/", style: "thought-catalyst" },
        { match: "/^gpt-/", style: "concise" },
      ],
    }),
  );
}

describe("state machine: auto-fire transitions", () => {
  it("fires on first request when auto rule matches", () => {
    writeStyles();
    let s = freshState();
    const r = step(s, "claude-sonnet-4-5");
    s = r.state;
    expect(r.autoFired).toBe(true);
    expect(r.result?.name).toBe("thought-catalyst");
    expect(r.result?.isAuto).toBe(true);
  });

  it("does not re-fire on same model + same result", () => {
    writeStyles();
    let s = freshState();
    s = step(s, "claude-sonnet-4-5").state;
    const r = step(s, "claude-sonnet-4-5");
    expect(r.autoFired).toBe(false);
  });

  it("does not re-fire when switching to another model that resolves to the same style", () => {
    fs.writeFileSync(path.join(tmp, "concise.md"), "x");
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({ auto: [{ match: "/.*/", style: "concise" }] }),
    );
    let s = freshState();
    s = step(s, "claude-sonnet-4-5").state;
    const r = step(s, "gpt-5");
    expect(r.autoFired).toBe(false);
    expect(r.result?.name).toBe("concise");
  });

  it("re-fires when switching to a model that resolves to a different style", () => {
    writeStyles();
    let s = freshState();
    s = step(s, "claude-sonnet-4-5").state;
    const r = step(s, "gpt-5");
    expect(r.autoFired).toBe(true);
    expect(r.result?.name).toBe("concise");
  });
});

describe("state machine: manual override lifecycle", () => {
  it("manual /style <name> sticks until model change", () => {
    writeStyles();
    let s = freshState();
    s = step(s, "claude-sonnet-4-5").state; // auto → thought-catalyst
    s = setManual(s, "concise");
    const r1 = step(s, "claude-sonnet-4-5");
    s = r1.state;
    expect(r1.result?.name).toBe("concise");
    expect(r1.result?.isAuto).toBe(false);
    // Model change resets override; auto evaluates for the new model.
    const r2 = step(s, "gpt-5");
    expect(r2.state.manualOverride).toBe(false);
    expect(r2.result?.name).toBe("concise");
    expect(r2.result?.isAuto).toBe(true);
  });

  it("/style off persists across model changes", () => {
    writeStyles();
    let s = freshState();
    s = step(s, "claude-sonnet-4-5").state;
    s = setManual(s, null); // /style off
    const r1 = step(s, "claude-sonnet-4-5");
    s = r1.state;
    expect(r1.result).toBeNull();
    const r2 = step(s, "gpt-5");
    s = r2.state;
    expect(r2.result).toBeNull();
    const r3 = step(s, "claude-opus-4-5");
    s = r3.state;
    expect(r3.result).toBeNull();
    expect(s.manualOverride).toBe(true);
  });
});

describe("state machine: modelId undefined transitions", () => {
  it("undefined → defined does NOT reset manualOverride", () => {
    writeStyles();
    let s = setManual(freshState(), "concise");
    const r1 = step(s, undefined);
    s = r1.state;
    expect(r1.result?.name).toBe("concise");
    expect(s.manualOverride).toBe(true);
    const r2 = step(s, "claude-sonnet-4-5");
    s = r2.state;
    expect(r2.result?.name).toBe("concise"); // override survived
    expect(s.manualOverride).toBe(true);
  });

  it("defined → undefined → same defined does NOT reset manualOverride", () => {
    writeStyles();
    let s = setManual(freshState(), "concise");
    s = step(s, "claude-sonnet-4-5").state;
    s = step(s, undefined).state;
    const r = step(s, "claude-sonnet-4-5");
    s = r.state;
    expect(s.manualOverride).toBe(true);
    expect(r.result?.name).toBe("concise");
  });

  it("defined → undefined → DIFFERENT defined DOES reset manualOverride", () => {
    // This is the bug-prone case: a transient undefined between two distinct
    // defined models must NOT erase the model-change signal.
    writeStyles();
    let s = setManual(freshState(), "concise");
    s = step(s, "claude-sonnet-4-5").state;
    s = step(s, undefined).state;
    expect(s.lastModelId).toBe("claude-sonnet-4-5"); // last DEFINED preserved
    const r = step(s, "gpt-5");
    s = r.state;
    expect(s.manualOverride).toBe(false);
    expect(r.result?.isAuto).toBe(true);
    expect(r.result?.name).toBe("concise"); // gpt-5 → concise via auto
  });
});

describe("state machine: resume semantics", () => {
  it("persisted manualName applies on first request after resume (no auto eval)", () => {
    writeStyles();
    const s: RequestState = {
      manualName: "concise",
      manualOverride: true, // restored because an entry was found
      lastModelId: undefined,
      lastResultName: null,
      lastResultIsAuto: false,
    };
    const r = step(s, "claude-sonnet-4-5");
    expect(r.result?.name).toBe("concise");
    expect(r.result?.isAuto).toBe(false);
    expect(r.autoFired).toBe(false);
  });

  it("persisted off survives resume and subsequent model changes", () => {
    writeStyles();
    let s: RequestState = {
      manualName: null,
      manualOverride: true,
      lastModelId: undefined,
      lastResultName: null,
      lastResultIsAuto: false,
    };
    s = step(s, "claude-sonnet-4-5").state;
    s = step(s, "gpt-5").state;
    expect(s.manualOverride).toBe(true);
  });

  it("no persisted entry → auto evaluates from first request", () => {
    writeStyles();
    const r = step(freshState(), "claude-sonnet-4-5");
    expect(r.result?.name).toBe("thought-catalyst");
    expect(r.result?.isAuto).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w pi-styles -- integration
```

Expected: FAIL — either `processModelRequest` not exported (if Task 8 wasn't completed properly) or actual assertion failures.

- [ ] **Step 3: Verify `processModelRequest` is exported from `index.ts`** (per Task 8 Step 2)

If the tests fail with an import error, return to Task 8 Step 2 and confirm the helper was exported at the module level above the default export. If they fail with an assertion error, that's a real bug — fix it before continuing.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w pi-styles -- integration
```

Expected: PASS — all 12 state-machine integration tests passing.

- [ ] **Step 5: Write the fake-`pi` harness test**

This test wires up a minimal fake `ExtensionAPI` + `ctx` to drive the **actual registered handlers** in `index.ts` end-to-end. It covers ground the pure transition tests can't: warning dedup against `ctx.ui.notify`, session_start scan of `ctx.sessionManager` entries, picker active-marker for auto-applied styles, and payload mutation through `INJECTORS`.

Create `extensions/styles/tests/harness.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import styles from "../index";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = path.resolve(HERE, "..", "styles");

/**
 * Minimal fake of the Pi ExtensionAPI / context surface that the styles
 * extension touches. Captures handler registrations, notify/setStatus calls,
 * and session entries so tests can assert on them.
 */
function makeFakePi() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const sessionEntries: any[] = [];
  return {
    handlers,
    commands,
    sessionEntries,
    pi: {
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      registerCommand(name: string, def: any) {
        commands.set(name, def);
      },
      appendEntry(customType: string, data: any) {
        sessionEntries.push({ type: "custom", customType, data });
      },
    },
  };
}

function makeFakeCtx(opts: {
  modelId?: string;
  api?: string;
  branchEntries?: any[];
}) {
  const notifyCalls: Array<{ message: string; level?: string }> = [];
  const statusCalls: Array<{ key: string; value: string | undefined }> = [];
  const ctx: any = {
    model: opts.modelId ? { id: opts.modelId, api: opts.api ?? "anthropic-messages" } : undefined,
    sessionManager: {
      getBranch() {
        return opts.branchEntries ?? [];
      },
    },
    ui: {
      notify(message: string, level?: string) {
        notifyCalls.push({ message, level });
      },
      setStatus(key: string, value: string | undefined) {
        statusCalls.push({ key, value });
      },
      async select(_label: string, options: string[]) {
        return options[0] ?? null;
      },
      async input() {
        return null;
      },
      async confirm() {
        return false;
      },
      async editor() {
        return null;
      },
    },
    notifyCalls,
    statusCalls,
  };
  return ctx;
}

describe("harness: registered handlers fire correctly", () => {
  it("registers session_start, before_provider_request, and the /style command", () => {
    const { pi, handlers, commands } = makeFakePi();
    styles(pi as any);
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("before_provider_request")).toBe(true);
    expect(commands.has("style")).toBe(true);
  });

  it("session_start restores manualName and manualOverride from a persisted entry", async () => {
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    const ctx = makeFakeCtx({
      branchEntries: [
        { type: "custom", customType: "styles:active", data: { name: "concise" } },
      ],
    });
    await handlers.get("session_start")!({}, ctx);
    // Footer reflects the restored manual choice.
    const lastStatus = ctx.statusCalls.at(-1);
    expect(lastStatus?.key).toBe("style");
    expect(lastStatus?.value).toBe("style: concise");
  });

  it("session_start restores /style off (persisted { name: null })", async () => {
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    const ctx = makeFakeCtx({
      branchEntries: [
        { type: "custom", customType: "styles:active", data: { name: null } },
      ],
    });
    await handlers.get("session_start")!({}, ctx);
    // Footer cleared.
    const lastStatus = ctx.statusCalls.at(-1);
    expect(lastStatus?.value).toBeUndefined();
  });

  it("warning is surfaced exactly once across many requests (dedup)", async () => {
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    const ctxStart = makeFakeCtx({
      branchEntries: [
        // Reference a style that does not exist in the shipped styles dir.
        { type: "custom", customType: "styles:active", data: { name: "ghost-style" } },
      ],
    });
    await handlers.get("session_start")!({}, ctxStart);

    const handler = handlers.get("before_provider_request")!;
    let totalMissingWarnings = 0;
    for (let i = 0; i < 5; i++) {
      const ctx = makeFakeCtx({ modelId: "claude-sonnet-4-5" });
      await handler({ payload: {} }, ctx);
      totalMissingWarnings += ctx.notifyCalls.filter((c) =>
        c.message.includes("ghost-style"),
      ).length;
    }
    // Warning must fire exactly once across the session, regardless of how
    // many requests reference the missing style.
    expect(totalMissingWarnings).toBe(1);
  });

  it("before_provider_request mutates the payload for an existing shipped style", async () => {
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    // Restore a known shipped manual style.
    const ctxStart = makeFakeCtx({
      branchEntries: [
        { type: "custom", customType: "styles:active", data: { name: "concise" } },
      ],
    });
    await handlers.get("session_start")!({}, ctxStart);

    const ctx = makeFakeCtx({ modelId: "claude-sonnet-4-5", api: "anthropic-messages" });
    // Minimum payload shape required by the anthropic injector.
    const payload: any = { messages: [{ role: "user", content: "hi" }] };
    await handlers.get("before_provider_request")!({ payload }, ctx);

    // The injector should have appended a <userStyle> block somewhere in the
    // payload. We assert that the wrapped concise.md content reaches the wire.
    const conciseBody = fs.readFileSync(path.join(STYLE_DIR, "concise.md"), "utf8").trim();
    expect(JSON.stringify(payload)).toContain(`<userStyle>\n${conciseBody}\n</userStyle>`);
  });
});
```

- [ ] **Step 6: Run the harness tests**

```bash
npm test -w pi-styles -- harness
```

Expected: PASS — 5 tests passing. If the payload-mutation test fails because the anthropic injector requires a different shape than `{ messages: [...] }`, inspect `extensions/styles/injectors.ts` to determine the minimal required shape and update the test fixture. Do **not** modify `injectors.ts` itself — the spec mandates it stays unchanged.

- [ ] **Step 7: Run full test suite + typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every test from Tasks 1–9 passing; no type errors.

- [ ] **Step 8: Commit**

```bash
git add extensions/styles/tests/integration.test.ts extensions/styles/tests/harness.test.ts
git commit -m "test(styles): state machine integration + fake-pi handler harness"
```

---

## Task 10: Backwards-compatibility regression and cross-injector coverage

Verify the three shipped styles (`concise.md`, `thought-catalyst.md`, `test-style.md`) produce byte-identical injected content via the resolver as they did via the legacy `readStyleText` path. Then verify the wrapped content reaches the payload through **each** `INJECTORS[api]` (the spec's testing strategy explicitly asks for cross-api coverage). Because `injectors.ts` is unchanged and the content is byte-identical, the cross-injector test is technically transitive — but the explicit assertion guards against future regressions if someone *does* edit `injectors.ts`.

**Files:**
- Create: `extensions/styles/tests/backwards-compat.test.ts`

- [ ] **Step 1: Write the regression tests**

Create `extensions/styles/tests/backwards-compat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStyle } from "../resolver";
import { INJECTORS } from "../injectors";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = path.resolve(HERE, "..", "styles");

/**
 * Mirrors the legacy readStyleText behaviour: read, trim, wrap in <userStyle>
 * tags, or empty string if the trimmed content is empty.
 */
function legacyWrap(name: string): string {
  const raw = fs.readFileSync(path.join(STYLE_DIR, `${name}.md`), "utf8").trim();
  return raw ? `<userStyle>\n${raw}\n</userStyle>` : "";
}

/**
 * Minimal payload fixtures sufficient to exercise each INJECTORS branch.
 * Inspect `extensions/styles/injectors.ts` if any of these need adjustment
 * for the local SDK version; do NOT modify injectors.ts itself.
 */
function emptyPayloadFor(api: string): any {
  if (api === "anthropic-messages") return { messages: [{ role: "user", content: "hi" }] };
  if (api === "openai-responses") return { input: [{ role: "user", content: "hi" }] };
  if (api === "openai-completions") return { messages: [{ role: "user", content: "hi" }] };
  // Fall back to a generic shape; the injector may decline to mutate it.
  return { messages: [{ role: "user", content: "hi" }] };
}

describe("backwards compatibility: shipped styles", () => {
  for (const name of ["concise", "thought-catalyst", "test-style"]) {
    it(`'${name}' resolves to byte-identical content via the resolver`, () => {
      const out = resolveStyle({
        manualName: name,
        manualOverride: true,
        modelId: undefined,
        stylesDir: STYLE_DIR,
      });
      expect(out.result).not.toBeNull();
      expect(out.result!.content).toBe(legacyWrap(name));
      expect(out.result!.isAuto).toBe(false);
    });
  }

  it("no _config.json present → no auto-config warnings", () => {
    expect(fs.existsSync(path.join(STYLE_DIR, "_config.json"))).toBe(false);
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: false,
      modelId: "claude-sonnet-4-5",
      stylesDir: STYLE_DIR,
    });
    expect(out.warnings).toEqual([]);
    expect(out.result?.name).toBe("concise");
    expect(out.result?.isAuto).toBe(false);
  });
});

describe("backwards compatibility: every INJECTORS api propagates the wrapped content", () => {
  const out = resolveStyle({
    manualName: "concise",
    manualOverride: true,
    modelId: undefined,
    stylesDir: STYLE_DIR,
  });
  const wrapped = out.result!.content;

  for (const api of Object.keys(INJECTORS)) {
    it(`'${api}' embeds the wrapped <userStyle> block in the payload`, () => {
      const payload = emptyPayloadFor(api);
      INJECTORS[api](payload, wrapped);
      // The wrapped block must appear somewhere in the mutated payload. We
      // don't assert WHERE — that's the injector's job, and the unchanged
      // injector code is the source of truth.
      expect(JSON.stringify(payload)).toContain("<userStyle>");
      expect(JSON.stringify(payload)).toContain("</userStyle>");
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they pass immediately**

```bash
npm test -w pi-styles -- backwards-compat
```

Expected: PASS — 4 regression tests plus one per `INJECTORS` api. If any payload-mutation case fails, inspect `extensions/styles/injectors.ts` to discover the minimal required payload shape for that api and update `emptyPayloadFor`; do **not** modify `injectors.ts`.

- [ ] **Step 3: Commit**

```bash
git add extensions/styles/tests/backwards-compat.test.ts
git commit -m "test(styles): backwards-compat regression for shipped styles + cross-injector coverage"
```

---

## Task 11: README and documentation

**Files:**
- Modify: `extensions/styles/README.md`

- [ ] **Step 1: Append the new sections to the existing README**

Open `extensions/styles/README.md` and append the following content after the current "Concepts" / "Usage" sections (preserve everything above; this is additive). If the current structure differs, integrate the sections into the natural reading flow.

```markdown
## Complex styles (variants per model)

A style can be a single flat file (`styles/<name>.md`) or a **directory** containing a `dispatcher.json` plus one or more content files. The picker and the `/style <name>` command treat both forms uniformly.

A complex style:

```
styles/
└── thought-catalyst/
    ├── dispatcher.json
    ├── preamble.md        (optional, prepended to every variant)
    ├── default.md         (used when no variant matches)
    ├── anthropic.md
    └── openai.md
```

`dispatcher.json` shape:

```json
{
  "preamble": "preamble.md",
  "default": "default.md",
  "variants": [
    { "match": "/^claude-/", "file": "anthropic.md" },
    { "match": "/^gpt-/",    "file": "openai.md" }
  ]
}
```

- All paths are **relative to the dispatcher's directory**. Paths containing `..` or leading `/` are rejected.
- `default` is required. `preamble` and `variants` are optional.
- Variants are evaluated **in order**; first match wins.
- If a matched variant file is missing, the resolver warns and falls through to `default`.
- If `default` is missing, the style is treated as inactive for that request.

## Auto-config (`styles/_config.json`)

Map model IDs to style names so that switching models automatically activates the right style:

```json
{
  "auto": [
    { "match": "/^claude-/",  "style": "thought-catalyst" },
    { "match": "/^gpt-/",     "style": "concise" },
    { "match": "gpt-5-codex", "style": "test-style" }
  ]
}
```

- Rules are evaluated **in order**; first **resolvable** match wins (rules that name a missing style are skipped with a warning).
- Auto-applied styles are flagged in the footer with an `(auto)` suffix and a one-shot notification.
- Auto-config is **not consulted** while a manual override is in force (see below).

## Match syntax (shared by `_config.json` and `dispatcher.json`)

- **Plain string** → exact equality, **case-sensitive**. E.g. `"claude-sonnet-4-5"`.
- **`/pattern/flags`** → JavaScript regex. Allowed flags: `i`, `m`, `s`, `u`. The `g` and `y` flags are disallowed (they make `.test()` stateful).
- Case-insensitive matching: use `/.../i`.

Invalid rules (bad regex, disallowed flag, invalid style name) emit a one-time warning and are skipped.

## Manual override semantics

- `/style <name>` and selecting from the picker set an explicit override. It sticks for the current model and is automatically lifted on the next **model change**, after which auto-config takes over again.
- `/style off` is treated as a **persistent, system-level disable**: it survives model changes. Re-enable styling by issuing `/style <name>` (or by picking from the picker).
- Session resume defers to your last persisted choice: a saved `/style <name>` is re-applied on the first request after resume (with no auto evaluation); a saved `/style off` continues to disable styling across resume and subsequent model changes.

The principle: an explicit user choice is sacrosanct. The system never silently undoes a deliberate decision; it only re-evaluates when no choice is in force, or when the user themselves changes their mind.
```

- [ ] **Step 2: Verify the README renders sanely**

Scan the file end-to-end for broken Markdown headings, code-fence imbalance, or contradictions with text earlier in the README.

- [ ] **Step 3: Commit**

```bash
git add extensions/styles/README.md
git commit -m "docs(styles): document complex styles, auto-config, and manual-override semantics"
```

---

## Task 12: Manual end-to-end smoke test

This task verifies the extension works end-to-end against a live π session, exercising paths that unit tests cannot reach (the actual `ctx.ui` surface, `pi.appendEntry`, the picker UI, real model IDs from a provider).

**Files:**
- Temporary: `extensions/styles/styles/_e2e-tc/{dispatcher.json,default.md,anthropic.md,openai.md}` (deleted at the end of the task)
- Temporary: `extensions/styles/styles/_config.json` (deleted at the end of the task)

- [ ] **Step 1: Set up a temporary complex style for the smoke test**

```bash
mkdir -p extensions/styles/styles/e2e-tc
cat > extensions/styles/styles/e2e-tc/dispatcher.json <<'EOF'
{
  "preamble": "preamble.md",
  "default": "default.md",
  "variants": [
    { "match": "/^claude-/", "file": "anthropic.md" },
    { "match": "/^gpt-/",    "file": "openai.md" }
  ]
}
EOF
cat > extensions/styles/styles/e2e-tc/preamble.md <<'EOF'
[E2E SMOKE PREAMBLE]
EOF
cat > extensions/styles/styles/e2e-tc/default.md <<'EOF'
[E2E SMOKE DEFAULT]
EOF
cat > extensions/styles/styles/e2e-tc/anthropic.md <<'EOF'
[E2E SMOKE ANTHROPIC]
EOF
cat > extensions/styles/styles/e2e-tc/openai.md <<'EOF'
[E2E SMOKE OPENAI]
EOF
cat > extensions/styles/styles/_config.json <<'EOF'
{
  "auto": [
    { "match": "/^claude-/", "style": "e2e-tc" }
  ]
}
EOF
```

- [ ] **Step 2: Confirm `.pi/settings.json` loads the local extension**

Verify `.pi/settings.json` in the repo root points to `../extensions/styles` (per the workspace dogfood convention from `AGENTS.md`). If it doesn't, the smoke test will exercise the installed package instead of your edits.

- [ ] **Step 3: Start a π session and run the manual checklist**

In a separate terminal, start a π session against this repository. Then run through the following checklist, marking each as you go.

- [ ] (a) `/style` lists `concise`, `thought-catalyst`, `test-style`, **and** `e2e-tc`. No `_e2e-*` / `_config.json` noise.
- [ ] (b) Under a Claude model (e.g. `claude-sonnet-4-5`), send any prompt. Notification fires: `Auto-applied style 'e2e-tc' for model 'claude-sonnet-4-5'.` Footer shows `style: e2e-tc (auto)`.
- [ ] (c) Inspect the request payload (via `PI_STYLES_DEBUG=1` or your provider's debug log). Confirm the injected `<userStyle>` block contains both `[E2E SMOKE PREAMBLE]` and `[E2E SMOKE ANTHROPIC]` separated by a blank line.
- [ ] (d) Send another prompt with no model change. No new notification. Footer unchanged. Injected content unchanged.
- [ ] (e) Switch to a different Claude model that still matches `/^claude-/` (e.g. `claude-opus-4-5`). No new notification (same resolved style). Footer unchanged.
- [ ] (f) Switch to a model that does **not** match (e.g. `gpt-5`). No auto notification (no rule matches). Footer clears.
- [ ] (g) Run `/style concise`. Footer shows `style: concise` (no `(auto)`). Notification: `Style 'concise' activated.` Switch to a different model. The override is dropped; if `_config.json` has a rule for the new model the auto notification fires, otherwise footer shows `style: concise` as fallback.
- [ ] (h) Run `/style off`. Footer clears. Switch to a Claude model. **No auto activation.** Footer stays clear. This is the persistence of explicit user disable.
- [ ] (i) Run `/style e2e-tc`. Footer shows `style: e2e-tc`. Restart the π session (resume). Footer immediately shows `style: e2e-tc` on resume. First request under any model uses `e2e-tc` without an auto notification.
- [ ] (j) Run `/style off`. Restart the π session. Footer is clear on resume. Switch models. Off persists.
- [ ] (k) Edit `extensions/styles/styles/_config.json` mid-session to add a rule for the currently-active manual model; verify the change takes effect on the next request **only after** clearing the manual override (e.g. by re-issuing `/style <name>` then switching models). The cache is mtime-driven so no restart needed.

- [ ] **Step 4: Clean up the smoke fixtures**

```bash
rm -rf extensions/styles/styles/e2e-tc
rm -f extensions/styles/styles/_config.json
```

- [ ] **Step 5: Confirm nothing was accidentally staged**

```bash
git status extensions/styles/
```

Expected: clean. No leftover smoke fixtures.

- [ ] **Step 6: Commit (only if any documentation or fix was made during smoke testing)**

If smoke testing revealed an issue, fix it in a new task by going back to the most relevant earlier task's file and addressing it with TDD. Do not paper over real bugs with no test coverage. If everything passed, this task has no commit — just mark the checklist complete.

---

## Self-Review Notes

**Spec coverage:**
- §1 two-tier layout → Tasks 3 (`styleExists`), 6 (picker enumeration + unit test).
- §2 dispatcher format → Task 4 (`loadDispatcher`).
- §3 auto-config format → Task 4 (`loadAutoConfig`).
- §4 matching primitive → Task 2 (`compileMatcher`; flag-rejection bug from C1 review fixed).
- §5 resolution algorithm → Task 5 (`resolveStyle`).
- §6 auto-firing semantics → Tasks 8 (`processModelRequest`), 9 (integration tests).
- §7 UX surfaces → Tasks 7, 8 (footer + warnings + notifications + picker `✓` covers auto styles too).
- §8 session persistence → Tasks 7, 9 (resume restores `manualOverride := true`; tested in integration and harness).
- §9 caching → Tasks 4, 5 (mtime caches; delete-and-reappear invalidation covered in Task 4 tests).
- Module structure (`resolver.ts`, `index.ts` slim, `injectors.ts` untouched) → Tasks 2–8.
- Backwards compatibility → Task 10 (byte-identical content + cross-injector payload propagation).
- Edge cases (all 20 rows in the spec's table) → covered across Tasks 5 (resolver edge cases), 9 (state machine including defined→undefined→different-defined), 12 (manual).
- Testing strategy → Tasks 2 (matcher), 3 (validators), 4 (loaders), 5 (resolver), 9 (state machine integration + fake-pi harness for warning dedup, session_start scan, payload mutation), 10 (backwards-compat + every-api propagation), 12 (manual e2e).

**Placeholder scan:** none.

**Type consistency:**
- `Matcher` (Task 2) referenced by `CompiledAutoRule`, `CompiledVariant` (Task 4), and `resolveStyle` (Task 5).
- `Warning` (Task 4) used by all `*Result` types, `ResolveOutput`, and `TransitionOutput` (Task 8). Re-exported through `index.ts` for the integration test.
- `ResolvedStyle` (Task 5) imported in `index.ts` Task 8, used in `renderFooter`, `processModelRequest`, and `TransitionOutput`.
- `RequestState` and `TransitionOutput` (Task 8) consumed by integration test (Task 9) directly via `processModelRequest`.
- `compileMatcher` returns `Matcher | null`; callers check for null and emit warnings — consistent across Tasks 4–5.
- `setActiveManual(name: string | null, ctx: any)` signature is identical at all five call sites in Task 7.
- `modelChanged(prev: string | undefined, curr: string | undefined): boolean` exported from `index.ts` in Task 8, used by both `processModelRequest` and exposed for any external test.
- `listStyles(dir?: string): string[]` (Task 6 refactor) is callable with or without the explicit dir argument; in-extension callers omit it; tests pass a tmp dir.

**Review responses (Pi gpt-5.5/xhigh review of the plan):**
- **C1 (compileMatcher flag rejection):** fixed in Task 2 Step 3 by widening the slash-form detection regex to `[A-Za-z]*` and validating the flag set separately against `^[imsu]*$`. Previously the regex itself required `[imsu]*`, causing `/foo/g` to fall through to literal exact-match.
- **C2 (lastModelId erased by undefined transition):** fixed in Task 8 Step 2 by tracking `lastModelId` as "last DEFINED model id only" inside `processModelRequest`. Verified by the new `defined → undefined → different-defined DOES reset manualOverride` test in Task 9 Step 1.
- **I1 (handler/test drift risk):** addressed by extracting `processModelRequest` (Task 8 Step 2) used by both the production handler and the integration tests — they cannot drift. Additionally, the fake-pi harness in Task 9 Step 5 covers the side-effect surface (notify/setStatus/payload).
- **I2 (TDD ordering inversion):** dissolved by the Task 8 restructure; `processModelRequest` is exported as part of Task 8 (the handler refactor), so Task 9 is purely test-writing.
- **I3 (picker enumeration untested):** Task 6 Step 1 adds a dedicated `list-styles.test.ts` exercising 8 cases.
- **I4 (picker `✓` for auto styles):** fixed in Task 8 Step 4 (`activeForPicker = lastResultName ?? manualName`).
- **I5 (`isSafeRelative` accepts internal `..`):** fixed in Task 4 Step 4 by checking raw segments before normalization. New test in Task 4 Step 2 covers `sub/../default.md`.
- **I6 (warning keys not style-scoped):** fixed in Task 4 Step 4 by suffixing dispatcher/variant keys with `path.basename(styleDir)`. New test in Task 4 Step 2 verifies two broken styles produce distinct keys.
- **I7 (mtime test flakiness):** mtime delta changed from `+10ms` to `+2000ms` in Task 4 Step 2.
- **M1 (Task 7 wording ambiguity):** clarified to "replace the entire default-export function" with explicit list of preserved module-level helpers.
- **M2 (Task 6 Step 2 confusing scratch step):** removed; replaced by the proper `list-styles.test.ts` unit test.
- **M3 (misleading test name):** renamed to "does NOT surface loadAutoConfig warnings when manual override wins".
- **M5 (`ctx.model` typed):** Task 8 Step 3 drops `as any` casts; fallback instruction added if the local SDK version lacks the typed surface.
- **SG2 (defined→undefined→different-defined test):** added explicitly in Task 9 Step 1 alongside two related transitions.
- **SG4/SG5 (warning dedup + session_start scan tests):** covered by the fake-pi harness in Task 9 Step 5.
- **SG6 (`_config.json` delete/reappear cache test):** added in Task 4 Step 2.
- **SG7 / I8 (cross-injector matrix):** partially addressed in Task 10 Step 1 with an automated loop over `Object.keys(INJECTORS)` asserting `<userStyle>` propagation. Pushed back on the full "verify exact payload mutation byte-for-byte across every api" because `injectors.ts` is unchanged and content is byte-identical (Task 10's other tests), making the rest transitive.
- **M4 (`foo..bar` accepted by `validateStyleName`):** pushed back. `foo..bar` is a legitimate basename; `path.join(stylesDir, "foo..bar")` does not escape `stylesDir`. The spec's "no `..`" applies to path segments, not arbitrary substrings, and the explicit `name === ".."` guard plus the `STYLE_NAME_RE` regex are sufficient.
- **SG1 (malformed complex directories silently ignored in picker):** pushed back. The spec's Edge Cases table reads: "Complex style directory missing `dispatcher.json` | Not listed in picker. If referenced by name, one-time warning; treated as missing." The picker silence is the **specified** behavior. The warning fires (via the resolver) only when the malformed style is referenced.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-styles-model-aware-auto-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
