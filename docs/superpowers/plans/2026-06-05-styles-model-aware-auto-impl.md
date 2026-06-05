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
    it("parses /foo/ as regex even if caller meant a literal model id", () => {
      const m = compileMatcher("/foo/");
      // This is the documented limitation. /foo/ is treated as regex matching 'foo' anywhere.
      expect(m!.test("foo")).toBe(true);
      expect(m!.test("/foo/")).toBe(false);
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

/** Detects slash-delimited regex form. Allows only [imsu] flags. */
const REGEX_FORM = /^\/(.+)\/([imsu]*)$/;

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
    // Advance mtime by 10ms to guarantee different stat.
    const future = new Date(Date.now() + 10);
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
    expect(out.warnings[0].key).toBe("dispatcher:nodefault");
  });

  it("warns on malformed JSON", () => {
    const dir = path.join(tmp, "tc");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "dispatcher.json"), "{");
    const out = loadDispatcher(dir);
    expect(out.dispatcher).toBeNull();
    expect(out.warnings[0].key).toBe("dispatcher:parse");
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
/** Reject a relative path that escapes its base directory. */
function isSafeRelative(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false;
  if (path.isAbsolute(rel)) return false;
  // Normalize and check it does not climb above ".".
  const norm = path.normalize(rel);
  if (norm.startsWith("..")) return false;
  if (norm.split(path.sep).includes("..")) return false;
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
          key: `dispatcher:missing:${styleDir}`,
          message: `styles: dispatcher.json not found under '${styleDir}'.`,
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
          key: `dispatcher:read:${styleDir}`,
          message: `styles: failed to read dispatcher.json: ${(e as Error).message}`,
        },
      ],
    };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const result: DispatcherResult = {
      dispatcher: null,
      warnings: [
        {
          key: "dispatcher:parse",
          message: `styles: dispatcher.json is not valid JSON: ${(e as Error).message}`,
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
      key: "dispatcher:nodefault",
      message: `styles: dispatcher.json under '${styleDir}' missing 'default' field.`,
    });
    const result: DispatcherResult = { dispatcher: null, warnings };
    dispatcherCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  }
  if (!isSafeRelative(defaultFile)) {
    warnings.push({
      key: `dispatcher:baddefault:${defaultFile}`,
      message: `styles: dispatcher 'default' path '${defaultFile}' must be a safe relative path.`,
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
        key: `dispatcher:badpreamble:${obj.preamble}`,
        message: `styles: dispatcher 'preamble' path '${obj.preamble}' must be a safe relative path; ignored.`,
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
        key: `variant:badshape:${spec || "(empty)"}`,
        message: `styles: skipped variant with missing match or file in '${styleDir}'.`,
      });
      continue;
    }
    const matcher = compileMatcher(spec);
    if (!matcher) {
      warnings.push({
        key: `variant:badmatch:${spec}`,
        message: `styles: skipped variant — invalid match '${spec}' in '${styleDir}'.`,
      });
      continue;
    }
    if (!isSafeRelative(vfile)) {
      warnings.push({
        key: `variant:badfile:${vfile}`,
        message: `styles: skipped variant — file '${vfile}' must be a safe relative path.`,
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
    expect(out.warnings.some((w) => w.key === "dispatcher:parse")).toBe(true);
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

  it("includes loadAutoConfig warnings even when manual override wins", () => {
    writeSimple("concise", "x");
    fs.writeFileSync(path.join(tmp, "_config.json"), "{ not json");
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: true,
      modelId: "claude-sonnet-4-5",
      stylesDir: tmp,
    });
    // The resolver only consults auto when manualOverride is false, so we should
    // NOT surface auto-config parse warnings on this path.
    expect(out.warnings.some((w) => w.key === "auto:parse")).toBe(false);
    expect(out.result?.name).toBe("concise");
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
      } else {
        body = candidate;
      }
    }

    if (body === null) {
      body = readContent(path.join(styleDir, dispatcher.default));
      if (body === null) {
        warnings.push({
          key: `default:missing:${chosenName}`,
          message: `styles: default file '${dispatcher.default}' missing under '${chosenName}'.`,
        });
        return NO_RESULT(warnings);
      }
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

- [ ] **Step 1: Update the `listStyles` function**

Replace the existing `listStyles` function in `extensions/styles/index.ts` (currently around line 53) with:

```ts
function listStyles(): string[] {
  ensureDir();
  try {
    const entries = fs.readdirSync(STYLE_DIR, { withFileTypes: true });
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
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      try {
        const st = fs.statSync(path.join(STYLE_DIR, e.name, "dispatcher.json"));
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
  } catch {
    return [];
  }
}
```

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

- [ ] **Step 2: Manually verify by adding a complex style fixture and running the existing extension**

Write `extensions/styles/styles/_smoke-complex/dispatcher.json`:

```json
{ "default": "default.md", "variants": [] }
```

And `extensions/styles/styles/_smoke-complex/default.md`:

```
smoke complex body
```

(The underscore prefix in the parent style would normally be excluded. Use a non-underscored name `smoke-complex` instead — adjust the two paths above accordingly.)

Then in a quick scratch script or REPL:

```bash
cd extensions/styles
node --experimental-strip-types -e "import('./index.ts').then(()=>{}); console.log(require('fs').readdirSync('./styles'));"
```

(Or, more pragmatically, defer manual verification to Task 9's integration test, which exercises `listStyles` through the picker code path. Skip this step if running tests is sufficient confidence.)

- [ ] **Step 3: Run all tests and typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every existing test still passes; no type errors.

- [ ] **Step 4: Delete the scratch complex style fixture**

```bash
rm -rf extensions/styles/styles/smoke-complex
```

- [ ] **Step 5: Commit**

```bash
git add extensions/styles/index.ts
git commit -m "refactor(styles): enumerate both simple and complex styles in the picker"
```

---

## Task 7: `index.ts` — state machine and `setActiveManual`

Introduce the new state model: `manualName`, `manualOverride`, `lastModelId`, `lastResult`, `warnedKeys`. Funnel every user-initiated activation through `setActiveManual`. Update `session_start` to restore `manualOverride := true` whenever an entry exists. This task leaves the `before_provider_request` handler untouched (still using the old `activeName` shim); the resolver integration comes in Task 8.

**Files:**
- Modify: `extensions/styles/index.ts`

- [ ] **Step 1: Replace the entire body of the default export**

Find the start of the default export (currently `export default function styles(pi: ExtensionAPI) {`) and the closing `}` for the whole function. Replace the inner body with the following. Sections marked `// (unchanged in this task)` are preserved as-is from the current code — Task 8 will revise them.

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

- [ ] **Step 2: Replace `before_provider_request` handler and remove dead code**

Find the existing `before_provider_request` handler (the block from Task 7 marked `// ---- ephemeral payload-layer injection (unchanged in this task — Task 8 replaces this block) ----`) and replace it with:

```ts
  // ---- ephemeral payload-layer injection (resolver-driven) ----
  function modelChanged(prev: string | undefined, curr: string | undefined): boolean {
    return prev !== undefined && curr !== undefined && prev !== curr;
  }

  pi.on("before_provider_request", (event, ctx) => {
    const currentModelId = (ctx as any).model?.id as string | undefined;

    // Reset per-model stickiness only when:
    //   - the model actually changed (defined → different defined), AND
    //   - the user's choice wasn't an explicit /style off (manualName === null + override=true).
    if (modelChanged(lastModelId, currentModelId) && manualName !== null) {
      manualOverride = false;
    }

    const out = resolveStyle({
      manualName,
      manualOverride,
      modelId: currentModelId,
      stylesDir: STYLE_DIR,
    });

    // Surface deduped warnings.
    for (const w of out.warnings) {
      if (warnedKeys.has(w.key)) continue;
      warnedKeys.add(w.key);
      ctx.ui?.notify?.(w.message, "warning");
    }

    const result = out.result;

    // Detect auto-fire transition based on (name, isAuto) change.
    const autoFired =
      !!result &&
      result.isAuto &&
      (lastResultName !== result.name || !lastResultIsAuto);

    if (autoFired) {
      ctx.ui?.notify?.(
        `Auto-applied style '${result.name}' for model '${currentModelId}'.`,
        "info",
      );
    }

    // Update footer + last-* state regardless of injection outcome below.
    lastResultName = result ? result.name : null;
    lastResultIsAuto = result ? result.isAuto : false;
    lastModelId = currentModelId;
    renderFooter(ctx, result);

    if (!result) return;

    const api = (ctx as any).model?.api as string | undefined;
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

- [ ] **Step 3: Replace the old `updateFooter` with the result-aware `renderFooter`**

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

- [ ] **Step 4: Remove the now-dead `readStyleText` function and `cache` variable**

Delete:

```ts
  let cache: { name: string; mtimeMs: number; text: string } | null = null;
```

…and the entire `readStyleText` function. Remove the `cache = null;` lines in `setActiveManual` and `session_start`.

- [ ] **Step 5: Remove the now-stale `manualName` existence check from `session_start`**

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

- [ ] **Step 6: Run all tests and typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every prior test still passes; smoke test still passes; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/index.ts
git commit -m "feat(styles): drive injection through resolver with autoFired transition + warning dedup"
```

---

## Task 9: Integration tests — end-to-end state machine

This task adds tests that exercise the **state machine in `index.ts`** indirectly by extracting the model-change detector and the auto-fire transition logic into a unit-testable form. We test the lifecycle (auto fires → user overrides → model change → new auto fires; `/style off` persists across model changes; resume defers to persisted manualName) without spinning up a real Pi session.

**Files:**
- Modify: `extensions/styles/index.ts` (extract `modelChanged` as exported helper)
- Create: `extensions/styles/tests/integration.test.ts`

- [ ] **Step 1: Export the `modelChanged` helper**

In `extensions/styles/index.ts`, move `modelChanged` out of the default export's body and turn it into a module-level exported function (keep the in-handler call site referring to it):

```ts
export function modelChanged(prev: string | undefined, curr: string | undefined): boolean {
  return prev !== undefined && curr !== undefined && prev !== curr;
}
```

- [ ] **Step 2: Write the failing integration tests**

Create `extensions/styles/tests/integration.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStyle, type ResolvedStyle } from "../resolver";
import { modelChanged } from "../index";

/**
 * These tests model the index.ts state machine over a sequence of requests,
 * using the resolver directly. They verify the lifecycle invariants from the
 * spec (§5–§8) without spinning up a full Pi session.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-integration-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface State {
  manualName: string | null;
  manualOverride: boolean;
  lastModelId: string | undefined;
  lastResultName: string | null;
  lastResultIsAuto: boolean;
}

function freshState(): State {
  return {
    manualName: null,
    manualOverride: false,
    lastModelId: undefined,
    lastResultName: null,
    lastResultIsAuto: false,
  };
}

function step(
  state: State,
  modelId: string | undefined,
): { state: State; result: ResolvedStyle | null; autoFired: boolean } {
  if (modelChanged(state.lastModelId, modelId) && state.manualName !== null) {
    state.manualOverride = false;
  }
  const out = resolveStyle({
    manualName: state.manualName,
    manualOverride: state.manualOverride,
    modelId,
    stylesDir: tmp,
  });
  const result = out.result;
  const autoFired =
    !!result &&
    result.isAuto &&
    (state.lastResultName !== result.name || !state.lastResultIsAuto);
  state.lastResultName = result ? result.name : null;
  state.lastResultIsAuto = result ? result.isAuto : false;
  state.lastModelId = modelId;
  return { state, result, autoFired };
}

function setManual(state: State, name: string | null) {
  state.manualName = name;
  state.manualOverride = true;
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
    const s = freshState();
    const r = step(s, "claude-sonnet-4-5");
    expect(r.autoFired).toBe(true);
    expect(r.result?.name).toBe("thought-catalyst");
    expect(r.result?.isAuto).toBe(true);
  });

  it("does not re-fire on same model + same result", () => {
    writeStyles();
    const s = freshState();
    step(s, "claude-sonnet-4-5");
    const r = step(s, "claude-sonnet-4-5");
    expect(r.autoFired).toBe(false);
  });

  it("does not re-fire when switching to another model that resolves to the same style", () => {
    fs.writeFileSync(path.join(tmp, "concise.md"), "x");
    fs.writeFileSync(
      path.join(tmp, "_config.json"),
      JSON.stringify({ auto: [{ match: "/.*/", style: "concise" }] }),
    );
    const s = freshState();
    step(s, "claude-sonnet-4-5");
    const r = step(s, "gpt-5");
    expect(r.autoFired).toBe(false);
    expect(r.result?.name).toBe("concise");
  });

  it("re-fires when switching to a model that resolves to a different style", () => {
    writeStyles();
    const s = freshState();
    step(s, "claude-sonnet-4-5");
    const r = step(s, "gpt-5");
    expect(r.autoFired).toBe(true);
    expect(r.result?.name).toBe("concise");
  });
});

describe("state machine: manual override lifecycle", () => {
  it("manual /style <name> sticks until model change", () => {
    writeStyles();
    const s = freshState();
    step(s, "claude-sonnet-4-5"); // auto → thought-catalyst
    setManual(s, "concise");
    const r1 = step(s, "claude-sonnet-4-5");
    expect(r1.result?.name).toBe("concise");
    expect(r1.result?.isAuto).toBe(false);
    // Model change resets override; auto evaluates for the new model.
    const r2 = step(s, "gpt-5");
    expect(r2.result?.name).toBe("concise");
    expect(r2.result?.isAuto).toBe(true);
  });

  it("/style off persists across model changes", () => {
    writeStyles();
    const s = freshState();
    step(s, "claude-sonnet-4-5");
    setManual(s, null); // /style off
    const r1 = step(s, "claude-sonnet-4-5");
    expect(r1.result).toBeNull();
    const r2 = step(s, "gpt-5");
    expect(r2.result).toBeNull();
    const r3 = step(s, "claude-opus-4-5");
    expect(r3.result).toBeNull();
    expect(s.manualOverride).toBe(true);
  });

  it("model change is not triggered by undefined transitions", () => {
    writeStyles();
    const s = freshState();
    setManual(s, "concise");
    const r1 = step(s, undefined);
    expect(r1.result?.name).toBe("concise");
    const r2 = step(s, "claude-sonnet-4-5");
    expect(r2.result?.name).toBe("concise"); // override survived undefined→defined
    expect(s.manualOverride).toBe(true);
    const r3 = step(s, "gpt-5"); // now defined→different-defined
    expect(s.manualOverride).toBe(false);
    expect(r3.result?.name).toBe("concise"); // gpt-5 maps to concise via auto
    expect(r3.result?.isAuto).toBe(true);
  });
});

describe("state machine: resume semantics", () => {
  it("persisted manualName applies on first request after resume (no auto eval)", () => {
    writeStyles();
    // Simulate resume by hand-constructing the post-session_start state.
    const s: State = {
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
    const s: State = {
      manualName: null,
      manualOverride: true, // /style off persisted
      lastModelId: undefined,
      lastResultName: null,
      lastResultIsAuto: false,
    };
    const r1 = step(s, "claude-sonnet-4-5");
    expect(r1.result).toBeNull();
    const r2 = step(s, "gpt-5");
    expect(r2.result).toBeNull();
    expect(s.manualOverride).toBe(true);
  });

  it("no persisted entry → auto evaluates from first request", () => {
    writeStyles();
    const s = freshState();
    const r = step(s, "claude-sonnet-4-5");
    expect(r.result?.name).toBe("thought-catalyst");
    expect(r.result?.isAuto).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -w pi-styles -- integration
```

Expected: FAIL — `modelChanged` not exported from `../index`.

- [ ] **Step 4: Confirm `modelChanged` is exported** (per Step 1)

If you haven't already, ensure the function declaration in `extensions/styles/index.ts` reads:

```ts
export function modelChanged(prev: string | undefined, curr: string | undefined): boolean {
  return prev !== undefined && curr !== undefined && prev !== curr;
}
```

…and is referenced as `modelChanged(lastModelId, currentModelId)` inside the `before_provider_request` handler.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -w pi-styles -- integration
```

Expected: PASS — all 10 integration tests passing.

- [ ] **Step 6: Run full test suite + typecheck**

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: every test from Tasks 1–9 passing; no type errors.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/index.ts extensions/styles/tests/integration.test.ts
git commit -m "test(styles): integration tests for state machine lifecycle and resume semantics"
```

---

## Task 10: Backwards-compatibility regression

Verify the three shipped styles (`concise.md`, `thought-catalyst.md`, `test-style.md`) produce byte-identical injected content via the resolver as they did via the legacy `readStyleText` path.

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
    // Assert the shipped extension has no _config.json yet.
    expect(fs.existsSync(path.join(STYLE_DIR, "_config.json"))).toBe(false);
    const out = resolveStyle({
      manualName: "concise",
      manualOverride: false,
      modelId: "claude-sonnet-4-5",
      stylesDir: STYLE_DIR,
    });
    // Should fall back to manual baseline with no warnings.
    expect(out.warnings).toEqual([]);
    expect(out.result?.name).toBe("concise");
    expect(out.result?.isAuto).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass immediately**

```bash
npm test -w pi-styles -- backwards-compat
```

Expected: PASS — all 4 regression tests passing on first run. If any fail, the resolver has drifted from the spec's backwards-compat guarantee and must be fixed before continuing.

- [ ] **Step 3: Commit**

```bash
git add extensions/styles/tests/backwards-compat.test.ts
git commit -m "test(styles): backwards-compat regression for shipped flat styles"
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
- §1 two-tier layout → Tasks 3, 6 (`styleExists`, picker enumeration).
- §2 dispatcher format → Task 4 (`loadDispatcher`).
- §3 auto-config format → Task 4 (`loadAutoConfig`).
- §4 matching primitive → Task 2 (`compileMatcher`).
- §5 resolution algorithm → Task 5 (`resolveStyle`).
- §6 auto-firing semantics → Tasks 8, 9 (autoFired transition logic + integration tests).
- §7 UX surfaces → Tasks 7, 8 (footer + warnings + notifications).
- §8 session persistence → Tasks 7, 9 (resume restores `manualOverride := true`; tested in integration).
- §9 caching → Tasks 4, 5 (mtime caches in loaders).
- Module structure (`resolver.ts`, `index.ts` slim, `injectors.ts` untouched) → Tasks 2–8.
- Backwards compatibility → Task 10.
- Edge cases (all 20 rows in the spec's table) → covered across Tasks 5 (resolver tests), 9 (integration), 12 (manual).
- Testing strategy → Tasks 2 (matcher), 3 (validators), 4 (loaders), 5 (resolver), 9 (state machine integration), 10 (backwards-compat), 12 (manual e2e).

**Placeholder scan:** none.

**Type consistency:**
- `Matcher` (Task 2) referenced by `CompiledAutoRule`, `CompiledVariant` (Task 4), and `resolveStyle` (Task 5).
- `Warning` (Task 4) used by all `*Result` types and `ResolveOutput`.
- `ResolvedStyle` (Task 5) imported in `index.ts` Task 8 and integration test Task 9.
- `compileMatcher` returns `Matcher | null`; callers check for null and emit warnings — consistent across Tasks 4–5.
- `setActiveManual(name: string | null, ctx: any)` signature is identical at all five call sites in Task 7.
- `modelChanged(prev: string | undefined, curr: string | undefined): boolean` signature consistent between in-handler use (Task 8) and exported form (Task 9).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-styles-model-aware-auto-impl.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
