# Styles Auto-Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to work task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an `auto` mode that maps the current model ID to a style via an optional `styles/_config.json`. The default mode is `off` (identical to today); `auto` is an explicit opt-in the user enables after authoring a config. All three modes (`style`/`off`/`auto`) are sticky — they only change when the user changes them. No dispatcher files, no variant folders, no override state machine.

**Spec:** `docs/superpowers/specs/2026-06-05-styles-auto-switch-design.md` (supersedes the archived model-aware-auto design).

**Architecture:** New `extensions/styles/auto-config.ts` (ctx-free, unit-tested) exports `compileMatcher`, `validateStyleName`, `loadAutoConfig`, and `resolveAuto`. `extensions/styles/index.ts` replaces its single `activeName` with a three-mode value (`{ kind: "style", name } | { kind: "off" } | { kind: "auto" }`), threads it through `setMode`/persistence/footer, and on `before_provider_request` resolves the mode (calling `resolveAuto` in the auto branch) and dispatches through the **unchanged** `INJECTORS` table. One nullable `lastInjectedName` de-dupes the auto notification.

**Tech Stack:** TypeScript (ES2022, strict, ESNext/Bundler), Node `fs`/`path`, vitest. No external deps — `JSON.parse` + string ops only.

**Worktree:** If executing in isolation, create one via `superpowers:using-git-worktrees` before Task 1.

---

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `extensions/styles/auto-config.ts` | **Create** | `compileMatcher`, `validateStyleName`, `loadAutoConfig` (mtime-cached), `resolveAuto`. No `ctx`, no UI. |
| `extensions/styles/index.ts` | **Modify** | Three-mode state, `setMode` writer, picker (adds Auto), footer/notify, resolution + injection dispatch. |
| `extensions/styles/injectors.ts` | **Unchanged** | — |
| `extensions/styles/package.json` | **Modify** | Add `test` script + vitest devDep; widen `files` to include `styles/**/*.json`. |
| `extensions/styles/tsconfig.json` | **Modify** | Add `tests/**/*.ts` to `include`. |
| `extensions/styles/tests/` | **Create** | `auto-config.test.ts`, `index.test.ts` (fake-pi harness). |
| `extensions/styles/README.md` | **Modify** | Document modes + `_config.json`. |

---

## Task 1: Test infrastructure

**Files:** Modify `package.json`, `tsconfig.json`; create `tests/smoke.test.ts`.

- [ ] **Step 1:** In `extensions/styles/package.json`, add a `test` script and `vitest` devDep, and widen `files`:
  - `"files": ["*.ts", "styles/**/*.md", "styles/**/*.json", "README.md"]`
  - `"scripts"`: add `"test": "vitest run --cache=false"`
  - `"devDependencies"`: add `"vitest": "^3.2.4"`

- [ ] **Step 2:** In `extensions/styles/tsconfig.json`, change `"include": ["*.ts"]` → `"include": ["*.ts", "tests/**/*.ts"]`.

- [ ] **Step 3:** Create `extensions/styles/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import styles from "../index";

describe("styles extension module", () => {
  it("default export is a registration function", () => {
    expect(typeof styles).toBe("function");
  });
});
```

- [ ] **Step 4:** From repo root run `npm install` (vitest is already a root devDep; confirm no `node_modules` appears under `extensions/styles/`).

- [ ] **Step 5:** Run `npm test -w pi-styles` → PASS (1 test). Run `npm run typecheck -w pi-styles` → clean.

- [ ] **Step 6:** Commit: `test(styles): add vitest infrastructure and smoke test`.

---

## Task 2: `compileMatcher` + `validateStyleName`

These two helpers are carried over verbatim from the archived plan (they were the good parts). TDD.

**Files:** Create `auto-config.ts` (skeleton) and `tests/auto-config.test.ts`.

- [ ] **Step 1:** Create `extensions/styles/tests/auto-config.test.ts` with the matcher + validator suites:

```ts
import { describe, expect, it } from "vitest";
import { compileMatcher, validateStyleName } from "../auto-config";

describe("compileMatcher", () => {
  it("matches exact, case-sensitive", () => {
    const m = compileMatcher("claude-sonnet-4-5")!;
    expect(m.test("claude-sonnet-4-5")).toBe(true);
    expect(m.test("claude-haiku-4-5")).toBe(false);
    expect(m.test("Claude-Sonnet-4-5")).toBe(false);
  });

  it("compiles slash-delimited regex with allowed flags", () => {
    expect(compileMatcher("/^claude-/")!.test("claude-x")).toBe(true);
    expect(compileMatcher("/^claude-/i")!.test("Claude-X")).toBe(true);
    for (const f of ["", "i", "m", "s", "u", "imsu"]) {
      expect(compileMatcher(`/foo/${f}`)).not.toBeNull();
    }
  });

  it("rejects disallowed flags and bad patterns (returns null)", () => {
    expect(compileMatcher("/foo/g")).toBeNull();
    expect(compileMatcher("/foo/y")).toBeNull();
    expect(compileMatcher("/foo/gi")).toBeNull();
    expect(compileMatcher("/[unbalanced/")).toBeNull();
  });

  it("documented limitation: /foo/ parses as regex, not literal", () => {
    const m = compileMatcher("/foo/")!;
    expect(m.test("foobar")).toBe(true);
  });
});

describe("validateStyleName", () => {
  it("accepts safe basenames", () => {
    for (const n of ["concise", "thought-catalyst", "style.v2", "_debug", "A1"]) {
      expect(validateStyleName(n)).toBe(true);
    }
  });
  it("rejects traversal, slashes, leading dot, empty", () => {
    for (const n of ["../x", "..", "a/b", "/abs", "a\\b", ".hidden", ".", "", " ", "a b"]) {
      expect(validateStyleName(n)).toBe(false);
    }
  });
});
```

- [ ] **Step 2:** Run `npm test -w pi-styles -- auto-config` → FAIL (module missing).

- [ ] **Step 3:** Create `extensions/styles/auto-config.ts`:

```ts
/**
 * auto-config — model-ID → style-name resolution for the styles extension.
 *
 * ctx-free and UI-free. Reads styles/_config.json (mtime-cached) and returns a
 * resolved style name plus diagnostic warnings. index.ts owns all ctx/UI/state.
 *
 * See docs/superpowers/specs/2026-06-05-styles-auto-switch-design.md.
 */
import fs from "node:fs";
import path from "node:path";

// ---- matcher ----------------------------------------------------------------

// Capture ANY letters in the flags slot so disallowed flags are REJECTED (below)
// rather than silently making the whole spec fall through to exact-match.
const REGEX_FORM = /^\/(.+)\/([A-Za-z]*)$/;
const ALLOWED_FLAGS = /^[imsu]*$/;

export interface Matcher {
  test(modelId: string): boolean;
}

/** Plain string = exact (case-sensitive); `/pat/flags` = RegExp (flags ⊆ imsu). null = invalid. */
export function compileMatcher(spec: string): Matcher | null {
  const m = REGEX_FORM.exec(spec);
  if (m) {
    const [, pattern, flags] = m;
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

// ---- name validation --------------------------------------------------------

const STYLE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;

/** Safe style basename: no slashes, no leading dot, no traversal. */
export function validateStyleName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name === "." || name === "..") return false;
  return STYLE_NAME_RE.test(name);
}
```

- [ ] **Step 4:** Run `npm test -w pi-styles -- auto-config` → PASS. `npm run typecheck -w pi-styles` → clean.

- [ ] **Step 5:** Commit: `feat(styles): add compileMatcher and validateStyleName for auto-config`.

---

## Task 3: `loadAutoConfig` + `resolveAuto`

**Files:** Modify `auto-config.ts`; extend `tests/auto-config.test.ts`.

- [ ] **Step 1:** Append loader + resolver tests to `tests/auto-config.test.ts` (add the imports `loadAutoConfig`, `resolveAuto`, plus `fs`/`os`/`path` and a tmp-dir `beforeEach`/`afterEach`):

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach } from "vitest";
import { loadAutoConfig, resolveAuto } from "../auto-config";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "styles-ac-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function writeConfig(rules: Array<{ match: string; style: string }>) {
  fs.writeFileSync(path.join(tmp, "_config.json"), JSON.stringify({ auto: rules }));
}
function writeStyle(name: string) { fs.writeFileSync(path.join(tmp, `${name}.md`), "x"); }

describe("loadAutoConfig", () => {
  it("missing file → empty rules, no warnings", () => {
    expect(loadAutoConfig(tmp)).toEqual({ rules: [], warnings: [] });
  });
  it("compiles rules in order", () => {
    writeConfig([{ match: "a", style: "concise" }, { match: "/^gpt-/", style: "tc" }]);
    const out = loadAutoConfig(tmp);
    expect(out.warnings).toEqual([]);
    expect(out.rules.map((r) => r.style)).toEqual(["concise", "tc"]);
    expect(out.rules[1].matcher.test("gpt-5")).toBe(true);
  });
  it("skips bad regex / disallowed flag / bad name with warnings", () => {
    writeConfig([
      { match: "/[bad/", style: "concise" },
      { match: "/foo/g", style: "concise" },
      { match: "x", style: "../escape" },
      { match: "ok", style: "good" },
    ]);
    const out = loadAutoConfig(tmp);
    expect(out.rules.map((r) => r.style)).toEqual(["good"]);
    expect(out.warnings.map((w) => w.key).sort()).toEqual(
      ["auto:badmatch:/[bad/", "auto:badmatch:/foo/g", "auto:badname:../escape"].sort(),
    );
  });
  it("warns on malformed JSON and wrong shape", () => {
    fs.writeFileSync(path.join(tmp, "_config.json"), "{ not json");
    expect(loadAutoConfig(tmp).warnings[0].key).toBe("auto:parse");
    fs.writeFileSync(path.join(tmp, "_config.json"), JSON.stringify({ foo: 1 }));
    // mtime bump to bust cache
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(tmp, "_config.json"), future, future);
    expect(loadAutoConfig(tmp).warnings[0].key).toBe("auto:shape");
  });
  it("reflects mtime edits", () => {
    writeConfig([{ match: "a", style: "concise" }]);
    expect(loadAutoConfig(tmp).rules).toHaveLength(1);
    const future = new Date(Date.now() + 2000);
    writeConfig([{ match: "b", style: "tc" }, { match: "c", style: "tc2" }]);
    fs.utimesSync(path.join(tmp, "_config.json"), future, future);
    expect(loadAutoConfig(tmp).rules).toHaveLength(2);
  });
});

describe("resolveAuto", () => {
  it("no config → null, no warnings", () => {
    expect(resolveAuto(tmp, "claude-x")).toEqual({ style: null, warnings: [] });
  });
  it("first resolvable match wins", () => {
    writeStyle("concise"); writeStyle("tc");
    writeConfig([{ match: "/^claude-/", style: "tc" }, { match: "/.*/", style: "concise" }]);
    expect(resolveAuto(tmp, "claude-x").style).toBe("tc");
  });
  it("skips a matched-but-missing style and warns", () => {
    writeStyle("present");
    writeConfig([{ match: "/.*/", style: "missing" }, { match: "/.*/", style: "present" }]);
    const out = resolveAuto(tmp, "anything");
    expect(out.style).toBe("present");
    expect(out.warnings.some((w) => w.key === "auto:missing:missing")).toBe(true);
  });
  it("no rule matches → null", () => {
    writeStyle("concise");
    writeConfig([{ match: "gpt-5", style: "concise" }]);
    expect(resolveAuto(tmp, "claude-x").style).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `npm test -w pi-styles -- auto-config` → FAIL.

- [ ] **Step 3:** Append to `extensions/styles/auto-config.ts`:

```ts
// ---- warnings + rule types --------------------------------------------------

export interface Warning {
  key: string;     // stable dedup key for index.ts's session-scoped set
  message: string; // user-facing, for ctx.ui.notify(..., "warning")
}

export interface CompiledRule {
  spec: string;
  matcher: Matcher;
  style: string;
}

export interface AutoConfig {
  rules: CompiledRule[];
  warnings: Warning[];
}

// ---- loadAutoConfig (mtime-cached) ------------------------------------------

interface AutoCacheEntry { mtimeMs: number; result: AutoConfig; }
const autoCache = new Map<string, AutoCacheEntry>();
const EMPTY: AutoConfig = { rules: [], warnings: [] };

export function loadAutoConfig(stylesDir: string): AutoConfig {
  const file = path.join(stylesDir, "_config.json");
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    autoCache.delete(file);
    return EMPTY;
  }
  const cached = autoCache.get(file);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.result;

  const finish = (result: AutoConfig): AutoConfig => {
    autoCache.set(file, { mtimeMs: st.mtimeMs, result });
    return result;
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return finish({ rules: [], warnings: [{ key: "auto:parse", message: `styles: _config.json is not valid JSON: ${(e as Error).message}` }] });
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).auto)) {
    return finish({ rules: [], warnings: [{ key: "auto:shape", message: "styles: _config.json must be { auto: [...] } — ignored." }] });
  }

  const rules: CompiledRule[] = [];
  const warnings: Warning[] = [];
  for (const entry of (parsed as any).auto as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { match?: unknown; style?: unknown };
    const spec = typeof e.match === "string" ? e.match : "";
    const style = typeof e.style === "string" ? e.style : "";
    if (!spec) {
      warnings.push({ key: "auto:badmatch:(empty)", message: "styles: skipped auto rule with empty match." });
      continue;
    }
    const matcher = compileMatcher(spec);
    if (!matcher) {
      warnings.push({ key: `auto:badmatch:${spec}`, message: `styles: skipped auto rule — invalid match '${spec}'.` });
      continue;
    }
    if (!validateStyleName(style)) {
      warnings.push({ key: `auto:badname:${style}`, message: `styles: skipped auto rule — invalid style name '${style}'.` });
      continue;
    }
    rules.push({ spec, matcher, style });
  }
  return finish({ rules, warnings });
}

// ---- resolveAuto ------------------------------------------------------------

export interface ResolveAutoResult {
  style: string | null;
  warnings: Warning[];
}

/** Walk the auto rules; first match whose style file exists wins. */
export function resolveAuto(stylesDir: string, modelId: string): ResolveAutoResult {
  const cfg = loadAutoConfig(stylesDir);
  const warnings = [...cfg.warnings];
  for (const rule of cfg.rules) {
    if (!rule.matcher.test(modelId)) continue;
    if (styleFileExists(stylesDir, rule.style)) return { style: rule.style, warnings };
    warnings.push({ key: `auto:missing:${rule.style}`, message: `styles: auto-rule matched but style '${rule.style}' is missing; skipped.` });
  }
  return { style: null, warnings };
}

function styleFileExists(stylesDir: string, name: string): boolean {
  if (!validateStyleName(name)) return false;
  try {
    return fs.statSync(path.join(stylesDir, `${name}.md`)).isFile();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4:** Run `npm test -w pi-styles -- auto-config` → PASS. Typecheck clean.

- [ ] **Step 5:** Commit: `feat(styles): add mtime-cached loadAutoConfig and resolveAuto`.

---

## Task 4: `index.ts` — three-mode state + auto resolution

Rewrite the inner closure of the default export to replace `activeName` with a three-mode value, add `setMode`, resolve the mode on each request (calling `resolveAuto` in the auto branch), and de-dupe the auto notification via `lastInjectedName`. Keep the existing `INJECTORS` dispatch and the create-new-style flow intact.

**Files:** Modify `extensions/styles/index.ts`.

- [ ] **Step 1: Add the import** at the top of `index.ts`:

```ts
import { resolveAuto, type Warning } from "./auto-config";
```

- [ ] **Step 2: Introduce a mode type** at module level (above the default export, near the other consts):

```ts
const ACT_AUTO = "◆  Auto (match style to model)";

type Mode =
  | { kind: "style"; name: string }
  | { kind: "off" }
  | { kind: "auto" };
```

Also add `auto` to the picker action constants already present (`ACT_CREATE`, `ACT_OFF`).

- [ ] **Step 3: Replace the inner closure** of `export default function styles(pi)`. Preserve the module-level helpers (`HERE`, `STYLE_DIR`, `ACTIVE_ENTRY`, `DEBUG`, `debug`, `ensureDir`, `slugify`, `listStyles`, the action consts). The new closure:

```ts
export default function styles(pi: ExtensionAPI) {
  let mode: Mode = { kind: "off" }; // default mode (auto is an explicit opt-in)
  let lastInjectedName: string | null = null; // de-dupes the auto notification
  let cache: { name: string; mtimeMs: number; text: string } | null = null;
  const warnedApis = new Set<string>();
  const warnedKeys = new Set<string>();

  /** Read + wrap a simple style file, cached by mtime. */
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

  function footerLabel(): string | undefined {
    if (mode.kind === "style") return `style: ${mode.name}`;
    if (mode.kind === "auto") return lastInjectedName ? `style: ${lastInjectedName} (auto)` : undefined;
    return undefined; // off
  }

  function updateFooter(ctx: any) {
    ctx?.ui?.setStatus?.("style", footerLabel());
  }

  function surfaceWarnings(ctx: any, warnings: Warning[]) {
    for (const w of warnings) {
      if (warnedKeys.has(w.key)) continue;
      warnedKeys.add(w.key);
      ctx?.ui?.notify?.(w.message, "warning");
    }
  }

  /** The single writer for user-initiated mode changes. Persists + updates footer. */
  function setMode(next: Mode, ctx: any) {
    mode = next;
    cache = null;
    lastInjectedName = null;
    const data =
      next.kind === "style" ? { name: next.name } :
      next.kind === "off" ? { name: null } :
      { auto: true };
    try {
      pi.appendEntry(ACTIVE_ENTRY, data);
    } catch {
      /* ephemeral session: in-memory only */
    }
    updateFooter(ctx);
    debug("setMode", next);
  }

  // ---- restore mode on session start / reload / resume ----
  pi.on("session_start", async (_event, ctx) => {
    mode = { kind: "off" }; // default until a persisted selection is found
    lastInjectedName = null;
    cache = null;
    warnedKeys.clear();
    try {
      const sm: any = ctx.sessionManager;
      const entries = sm.getBranch?.() ?? sm.getEntries?.() ?? [];
      for (const entry of entries) {
        if (entry?.type === "custom" && entry?.customType === ACTIVE_ENTRY) {
          const d = entry?.data ?? {};
          if (d.auto === true) mode = { kind: "auto" };
          else if (typeof d.name === "string") mode = { kind: "style", name: d.name };
          else mode = { kind: "off" }; // { name: null }
        }
      }
    } catch {
      /* ignore */
    }
    updateFooter(ctx);
    debug("session_start", mode);
  });

  // ---- ephemeral payload-layer injection ----
  pi.on("before_provider_request", (event, ctx) => {
    // Resolve the chosen style name for this request.
    let chosen: string | null = null;
    if (mode.kind === "style") {
      chosen = mode.name;
    } else if (mode.kind === "auto") {
      const modelId = (ctx as any).model?.id as string | undefined;
      if (typeof modelId === "string") {
        const out = resolveAuto(STYLE_DIR, modelId);
        surfaceWarnings(ctx, out.warnings);
        if (out.style && out.style !== lastInjectedName) {
          ctx.ui?.notify?.(`Auto-applied style '${out.style}' for model '${modelId}'.`, "info");
        }
        chosen = out.style;
      }
    }
    // mode.kind === "off" → chosen stays null

    lastInjectedName = chosen;
    updateFooter(ctx);

    if (!chosen) return;
    const text = readStyleText(chosen);
    if (!text) {
      // Missing/empty manual style: warn once (auto-missing is handled in resolveAuto).
      if (mode.kind === "style") {
        const key = `style:missing:${chosen}`;
        if (!warnedKeys.has(key)) {
          warnedKeys.add(key);
          ctx.ui?.notify?.(`styles: style '${chosen}' not found or empty.`, "warning");
        }
      }
      return;
    }

    const api = (ctx as any).model?.api as string | undefined;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, text);
        debug("injected", { api, style: chosen, mode: mode.kind });
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
      ctx.ui?.notify?.(`styles: skipped injection (${api ?? "?"}): ${(e as Error).message}`, "warning");
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
    setMode({ kind: "style", name }, ctx);
    ctx.ui.notify(`Created and activated style '${name}'.`, "info");
  }

  /** Direct activation via `/style <name|off|auto>`. */
  function activateByName(arg: string, ctx: any): void {
    const a = arg.trim();
    if (!a) return;
    if (/^(off|none|clear)$/i.test(a)) {
      setMode({ kind: "off" }, ctx);
      ctx.ui.notify("Styles turned off.", "info");
      return;
    }
    if (/^auto$/i.test(a)) {
      setMode({ kind: "auto" }, ctx);
      ctx.ui.notify("Styles set to auto (match style to model).", "info");
      return;
    }
    const names = listStyles();
    const slug = slugify(a);
    const match =
      names.find((n) => n === a) ??
      names.find((n) => n === slug) ??
      names.find((n) => n.toLowerCase() === a.toLowerCase());
    if (!match) {
      ctx.ui.notify(`No style named '${a}'.`, "warning");
      return;
    }
    setMode({ kind: "style", name: match }, ctx);
    ctx.ui.notify(`Style '${match}' activated.`, "info");
  }

  pi.registerCommand("style", {
    description: "Select a style, set auto/off, or create one (ephemeral <userStyle> injection)",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        ...listStyles().map((n) => ({ value: n, label: n })),
        { value: "auto", label: "auto (match style to model)" },
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
      const activeName = mode.kind === "style" ? mode.name : null;
      const options = [
        ...names.map((n) => (n === activeName ? `✓ ${n}` : `  ${n}`)),
        mode.kind === "auto" ? `✓ ${ACT_AUTO}` : ACT_AUTO,
        mode.kind === "off" ? `✓ ${ACT_OFF}` : ACT_OFF,
        ACT_CREATE,
      ];
      const choice = await ctx.ui.select("Output style", options);
      if (!choice) return;
      const cleaned = choice.replace(/^✓ /, "");
      if (cleaned === ACT_CREATE) { await runCreate(ctx); return; }
      if (cleaned === ACT_AUTO) {
        setMode({ kind: "auto" }, ctx);
        ctx.ui.notify("Styles set to auto.", "info");
        return;
      }
      if (cleaned === ACT_OFF) {
        setMode({ kind: "off" }, ctx);
        ctx.ui.notify("Styles turned off.", "info");
        return;
      }
      const name = cleaned.replace(/^ {2}/, "");
      setMode({ kind: "style", name }, ctx);
      ctx.ui.notify(`Style '${name}' activated.`, "info");
    },
  });
}
```

Notes:
- The picker now marks `✓` for whichever mode is active (style name, Auto, or Off).
- `lastInjectedName` is updated every request so the `(auto)` footer reflects the actually-injected style and the notification fires only on a *change*.
- `getArgumentCompletions`, `runCreate`, `slugify`, `listStyles`, `ensureDir` and the const definitions are otherwise unchanged from today.

- [ ] **Step 4:** Run `npm test -w pi-styles` (smoke still passes) and `npm run typecheck -w pi-styles` → clean. If the SDK lacks a typed `ctx.model`, the `(ctx as any).model` casts above already handle it.

- [ ] **Step 5:** Commit: `feat(styles): three-mode state (style/off/auto) with model-aware auto resolution`.

---

## Task 5: Fake-pi harness tests for `index.ts`

Drive the **actual registered handlers** through a minimal fake `ExtensionAPI` + `ctx`, covering: default mode, session_start restore of all three shapes, auto resolution + one-shot notification dedup, sticky manual across model changes, and payload mutation through a real injector.

**Files:** Create `extensions/styles/tests/index.test.ts`.

- [ ] **Step 1:** Create `extensions/styles/tests/index.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import styles from "../index";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLE_DIR = path.resolve(HERE, "..", "styles");
const CONFIG = path.join(STYLE_DIR, "_config.json");

// These tests touch the real styles/ dir. Guard the shipped state: no _config.json.
beforeEach(() => { if (fs.existsSync(CONFIG)) fs.rmSync(CONFIG); });
afterEach(() => { if (fs.existsSync(CONFIG)) fs.rmSync(CONFIG); });

function makeFakePi() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const entries: any[] = [];
  return {
    handlers, commands, entries,
    pi: {
      on(e: string, h: Function) { handlers.set(e, h); },
      registerCommand(n: string, d: any) { commands.set(n, d); },
      appendEntry(customType: string, data: any) { entries.push({ type: "custom", customType, data }); },
    },
  };
}

function makeCtx(opts: { modelId?: string; api?: string; branchEntries?: any[] } = {}) {
  const notifyCalls: Array<{ message: string; level?: string }> = [];
  const statusCalls: Array<{ key: string; value: string | undefined }> = [];
  return {
    model: opts.modelId ? { id: opts.modelId, api: opts.api ?? "anthropic-messages" } : undefined,
    sessionManager: { getBranch: () => opts.branchEntries ?? [] },
    ui: {
      notify: (message: string, level?: string) => notifyCalls.push({ message, level }),
      setStatus: (key: string, value: string | undefined) => statusCalls.push({ key, value }),
      select: async (_l: string, o: string[]) => o[0] ?? null,
      input: async () => null, confirm: async () => false, editor: async () => null,
    },
    notifyCalls, statusCalls,
  } as any;
}

function writeConfig(rules: Array<{ match: string; style: string }>) {
  fs.writeFileSync(CONFIG, JSON.stringify({ auto: rules }));
}

describe("registration", () => {
  it("registers session_start, before_provider_request, /style", () => {
    const { pi, handlers, commands } = makeFakePi();
    styles(pi as any);
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("before_provider_request")).toBe(true);
    expect(commands.has("style")).toBe(true);
  });
});

describe("session_start restore", () => {
  async function restore(branchEntries: any[]) {
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    const ctx = makeCtx({ branchEntries });
    await handlers.get("session_start")!({}, ctx);
    return ctx;
  }
  it("no entry → off (default), footer cleared", async () => {
    const ctx = await restore([]);
    expect(ctx.statusCalls.at(-1)?.value).toBeUndefined();
  });
  it("{ name } → manual footer", async () => {
    const ctx = await restore([{ type: "custom", customType: "styles:active", data: { name: "concise" } }]);
    expect(ctx.statusCalls.at(-1)?.value).toBe("style: concise");
  });
  it("{ name: null } → off, footer cleared", async () => {
    const ctx = await restore([{ type: "custom", customType: "styles:active", data: { name: null } }]);
    expect(ctx.statusCalls.at(-1)?.value).toBeUndefined();
  });
  it("{ auto: true } → auto, footer cleared until resolved", async () => {
    const ctx = await restore([{ type: "custom", customType: "styles:active", data: { auto: true } }]);
    expect(ctx.statusCalls.at(-1)?.value).toBeUndefined();
  });
});

describe("default mode is off", () => {
  it("no prior selection → no injection even with a matching config", async () => {
    writeConfig([{ match: "/^claude-/", style: "concise" }]);
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    await handlers.get("session_start")!({}, makeCtx({ branchEntries: [] }));
    const ctx = makeCtx({ modelId: "claude-sonnet-4-5", api: "anthropic-messages" });
    const payload: any = { messages: [{ role: "user", content: "hi" }] };
    await handlers.get("before_provider_request")!({ payload }, ctx);
    expect(JSON.stringify(payload)).not.toContain("<userStyle>");
    expect(ctx.notifyCalls.some((c) => c.message.includes("Auto-applied"))).toBe(false);
  });
});

describe("auto resolution + notification dedup", () => {
  it("auto applies a config-mapped style and notifies once across repeats", async () => {
    writeConfig([{ match: "/^claude-/", style: "concise" }]);
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    await handlers.get("session_start")!({}, makeCtx({ branchEntries: [{ type: "custom", customType: "styles:active", data: { auto: true } }] }));
    const h = handlers.get("before_provider_request")!;

    let autoNotes = 0;
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx({ modelId: "claude-sonnet-4-5", api: "anthropic-messages" });
      const payload: any = { messages: [{ role: "user", content: "hi" }] };
      await h({ payload }, ctx);
      autoNotes += ctx.notifyCalls.filter((c) => c.message.includes("Auto-applied")).length;
      const body = fs.readFileSync(path.join(STYLE_DIR, "concise.md"), "utf8").trim();
      expect(JSON.stringify(payload)).toContain(`<userStyle>\n${body}\n</userStyle>`);
    }
    expect(autoNotes).toBe(1); // notified once, not per request
  });

  it("re-notifies when the resolved style changes (different model)", async () => {
    writeConfig([{ match: "/^claude-/", style: "concise" }, { match: "/^gpt-/", style: "thought-catalyst" }]);
    const { pi, handlers } = makeFakePi();
    styles(pi as any);
    await handlers.get("session_start")!({}, makeCtx({ branchEntries: [{ type: "custom", customType: "styles:active", data: { auto: true } }] }));
    const h = handlers.get("before_provider_request")!;

    const c1 = makeCtx({ modelId: "claude-sonnet-4-5" });
    await h({ payload: { messages: [{ role: "user", content: "hi" }] } }, c1);
    const c2 = makeCtx({ modelId: "gpt-5" });
    await h({ payload: { messages: [{ role: "user", content: "hi" }] } }, c2);
    expect(c2.notifyCalls.some((c) => c.message.includes("thought-catalyst"))).toBe(true);
  });
});

describe("manual mode is sticky", () => {
  it("a manual style ignores the model and never auto-switches", async () => {
    writeConfig([{ match: "/^claude-/", style: "thought-catalyst" }]);
    const { pi, handlers, commands } = makeFakePi();
    styles(pi as any);
    await handlers.get("session_start")!({}, makeCtx({ branchEntries: [] }));
    // Pick concise manually.
    await commands.get("style")!.handler("concise", makeCtx({}));
    const h = handlers.get("before_provider_request")!;
    const ctx = makeCtx({ modelId: "claude-sonnet-4-5", api: "anthropic-messages" });
    const payload: any = { messages: [{ role: "user", content: "hi" }] };
    await h({ payload }, ctx);
    const conc = fs.readFileSync(path.join(STYLE_DIR, "concise.md"), "utf8").trim();
    expect(JSON.stringify(payload)).toContain(conc); // concise, not thought-catalyst
    expect(ctx.notifyCalls.some((c) => c.message.includes("Auto-applied"))).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npm test -w pi-styles -- index` → PASS. If the anthropic injector needs a different minimal payload shape, inspect `injectors.ts` and adjust the fixture — do **not** modify `injectors.ts`.

- [ ] **Step 3:** Run full suite `npm test -w pi-styles` and `npm run typecheck -w pi-styles` → all green.

- [ ] **Step 4:** Commit: `test(styles): fake-pi harness for modes, auto resolution, dedup, sticky manual`.

---

## Task 6: README + cleanup

**Files:** Modify `extensions/styles/README.md`.

- [ ] **Step 1:** Append to the README, after the existing "Usage" section:

```markdown
## Modes: style, off, auto

The active selection is always one of three modes:

- **A style** — `/style <name>` applies it to every request, regardless of
  model. Sticky until you change it.
- **Off** — `/style off` injects nothing. Sticky.
- **Auto** — `/style auto` follows `styles/_config.json`, mapping the current
  model to a style on each request. Switching models re-styles automatically.
  Enable it once you've authored a config; it's an explicit opt-in.

A fresh session starts in **off** (no injection) until you choose otherwise.
All three modes are sticky and never silently revert — they only change when you
change them.

## Auto-config: `styles/_config.json`

Optional. Maps model IDs to style names:

```json
{
  "auto": [
    { "match": "/^claude-/", "style": "thought-catalyst-claude" },
    { "match": "/^gpt-/",    "style": "thought-catalyst-gpt" },
    { "match": "claude-haiku-4-5", "style": "concise" }
  ]
}
```

- Rules are evaluated in order; the **first resolvable match wins** (a rule
  naming a missing style is skipped with a warning).
- `match` is either an exact, case-sensitive string, or a `/pattern/flags`
  regex. Allowed flags: `i`, `m`, `s`, `u` (`g`/`y` are rejected).
- A "variant per model" is just two ordinary style files plus two rules — style
  `.md` files are never parsed for embedded routing.
- Absent file → auto matches nothing → identical to having no styles active.
```

- [ ] **Step 2:** Scan the README for heading/fence balance. Confirm `npm test -w pi-styles` and `npm run typecheck -w pi-styles` are both green.

- [ ] **Step 3:** Commit: `docs(styles): document style/off/auto modes and _config.json`.

---

## Task 7: Manual smoke test (live π session)

- [ ] **Step 1:** Create a temporary `extensions/styles/styles/_config.json`:

```json
{ "auto": [ { "match": "/^claude-/", "style": "thought-catalyst" }, { "match": "/^gpt-/", "style": "concise" } ] }
```

- [ ] **Step 2:** Confirm `.pi/settings.json` loads `../extensions/styles` (it does per repo convention).

- [ ] **Step 3:** In a live π session, run the checklist:
  - [ ] (a) Fresh session → no injection (default off). Then `/style auto` on a Claude model → `thought-catalyst` auto-applies; footer `style: thought-catalyst (auto)`; one "Auto-applied…" notification.
  - [ ] (b) Send another prompt, no model change → no new notification; footer unchanged.
  - [ ] (c) Switch to a GPT model → `concise` auto-applies; new notification; footer `style: concise (auto)`.
  - [ ] (d) `/style thought-catalyst` → footer `style: thought-catalyst` (no `(auto)`). Switch models → style does **not** change (sticky). No auto notification.
  - [ ] (e) `/style auto` → returns to model-aware; switching models re-styles again.
  - [ ] (f) `/style off` → footer clears; switch models → stays off (sticky).
  - [ ] (g) `/style auto`, then restart the session → resumes in auto; first request notifies. `/style off`, restart → resumes off. `/style concise`, restart → resumes `style: concise`.
  - [ ] (h) Edit `_config.json` mid-session while in auto mode → change takes effect on the next request (mtime cache).

- [ ] **Step 4:** Delete the temporary `_config.json`. Confirm `git status extensions/styles/` is clean of smoke fixtures.

- [ ] **Step 5:** If smoke surfaced a bug, fix it via TDD in the relevant earlier task's files. Otherwise no commit.

---

## Self-review notes

**Spec coverage:**
- Three modes + default off (auto is opt-in) → Task 4 (`Mode`, `setMode`, `session_start`) + Task 5 "default mode is off" test.
- `_config.json` + matching → Tasks 2–3 (`compileMatcher`, `validateStyleName`, `loadAutoConfig`, `resolveAuto`).
- Sticky manual (no override state machine) → Task 4 (mode never auto-mutates) + Task 5 stickiness test.
- Footer + one-shot notify via `lastInjectedName` → Task 4 + Task 5 dedup test.
- Persistence (additive `{ auto: true }`) → Task 4 + Task 5 restore tests.
- Backwards compat (existing `.md`, existing `{ name }` entries, no `injectors.ts` change) → Task 5 + unchanged injector.

**Dropped vs archived plan:** dispatcher.json, variant folders, preamble, `styleExists` four-state, path-traversal-in-dispatcher, `manualOverride`/`lastModelId`/`modelChanged`/`processModelRequest`, collision handling. None are referenced here.

**Type consistency:** `Matcher` → `CompiledRule` → `AutoConfig`/`ResolveAutoResult`; `Warning` shared by loader + resolver + surfaced in `index.ts`; `Mode` is internal to `index.ts`. `resolveAuto(stylesDir, modelId)` returns `{ style: string | null, warnings }` consumed once per request.

**Placeholder scan:** none.
