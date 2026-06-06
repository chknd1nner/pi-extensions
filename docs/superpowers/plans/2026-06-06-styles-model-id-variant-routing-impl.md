# Styles Model-ID Variant Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement exact model-ID style variant routing, sticky `/style off|<name>|auto` modes, and `_config.json` auto routing for `extensions/styles/`.

**Architecture:** Keep provider payload mutation in `injectors.ts` unchanged. Add a focused `styleResolver.ts` module for filesystem enumeration, config parsing, variant lookup, mtime caches, and warning de-duplication; then wire `index.ts` to use explicit off/manual/auto mode state and pass the final wrapped style text to existing injectors.

**Tech Stack:** TypeScript ES modules, Node `fs`/`path`, Pi `ExtensionAPI`, Vitest, npm workspaces.

---

## Reference documents

- Spec: `docs/superpowers/specs/2026-06-06-styles-model-id-variant-routing-design.md`
- Pi extension docs: `docs/pi/docs/extensions.md`
- Current extension entry point: `extensions/styles/index.ts`
- Current provider injectors: `extensions/styles/injectors.ts`

## File structure

- `extensions/styles/styleResolver.ts` — new resolver module. Owns:
  - exact safe model-ID filename predicate;
  - style basename validation;
  - simple style and variant-folder enumeration;
  - `_config.json` parsing and exact auto matching;
  - simple/folder collision warnings;
  - reserved-name warnings;
  - resolved-file content cache keyed by absolute file path and mtime.
- `extensions/styles/styleResolver.test.ts` — resolver unit tests using temporary style directories.
- `extensions/styles/index.ts` — keep Pi event/command wiring here; replace `activeName` with explicit mode state and call `StyleResolver` before invoking `INJECTORS`.
- `extensions/styles/index.test.ts` — fake Pi/UI/session harness tests for sticky mode, footer, command, restore, and request-time injection behavior.
- `extensions/styles/injectors.ts` — no implementation change.
- `extensions/styles/injectors.test.ts` — regression tests for existing Anthropic Messages and OpenAI Responses injection behavior.
- `extensions/styles/package.json` — add a `test` script and Vitest as a dev dependency for standalone extraction.
- `extensions/styles/README.md` — document simple styles, variant folders, `_config.json`, auto mode, bundled example assets, footer behavior, and known limitations.
- `extensions/styles/styles/_config.json` — new bundled auto-mode example mapping exact Anthropic model IDs to `thought-catalyst`.
- `extensions/styles/styles/thought-catalyst.md` — replace the current simple canary/demo-style file with a variant folder.
- `extensions/styles/styles/thought-catalyst/default.md` — new default thought-catalyst instructions using `<think>` terminology.
- `extensions/styles/styles/thought-catalyst/<anthropic-model-id>.md` — duplicated Anthropic variant instructions using `<antml:thinking>` terminology for every model ID in the sample config. This duplication is intentional in v1; there is no alias/symlink/router layer.
- `extensions/styles/styles/test-style.md` — delete the canary style so it no longer ships.
- `package-lock.json` — update via root `npm install` after package metadata changes.

---

### Task 1: Add Vitest script and injector regression tests

**Files:**
- Modify: `extensions/styles/package.json`
- Modify: `package-lock.json`
- Create: `extensions/styles/injectors.test.ts`

- [ ] **Step 1: Update package metadata for tests**

Replace `extensions/styles/package.json` with:

```json
{
  "name": "pi-styles",
  "version": "0.1.0",
  "description": "claude.ai-style ephemeral output styles for Pi, injected as a trailing <userStyle> block after cache_control so prompt caching is preserved.",
  "keywords": ["pi-package", "pi-extension", "styles", "userStyle", "prompt"],
  "license": "MIT",
  "type": "module",
  "files": ["index.ts", "injectors.ts", "styles", "README.md"],
  "pi": {
    "extensions": ["./index.ts"]
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
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

- [ ] **Step 2: Refresh workspace lockfile**

Run from the repository root:

```bash
npm install
```

Expected: command exits 0 and updates `package-lock.json` only as needed for the `pi-styles` workspace dev dependency metadata.

- [ ] **Step 3: Add injector regression tests**

Create `extensions/styles/injectors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  genericFallback,
  injectAnthropic,
  injectOpenAICompletions,
  injectOpenAIResponses,
} from "./injectors";

const STYLE = "<userStyle>\nBe concise.\n</userStyle>";

describe("injectAnthropic", () => {
  it("appends a style text block after existing user content", () => {
    const payload = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };

    injectAnthropic(payload, STYLE);

    expect(payload.messages[0].content).toEqual([
      {
        type: "text",
        text: "Hello",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: STYLE },
    ]);
  });

  it("pushes a trailing user message when the last message is not user-authored", () => {
    const payload = {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }],
    };

    injectAnthropic(payload, STYLE);

    expect(payload.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
      { role: "user", content: [{ type: "text", text: STYLE }] },
    ]);
  });
});

describe("injectOpenAIResponses", () => {
  it("appends a trailing user input item", () => {
    const payload = {
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    };

    injectOpenAIResponses(payload, STYLE);

    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { role: "user", content: [{ type: "input_text", text: STYLE }] },
    ]);
  });
});

describe("injectOpenAICompletions", () => {
  it("appends to the most recent user message when the last message is a tool result", () => {
    const payload = {
      messages: [
        { role: "user", content: "Use the tool" },
        { role: "tool", content: "tool result" },
      ],
    };

    injectOpenAICompletions(payload, STYLE);

    expect(payload.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Use the tool" },
          { type: "text", text: STYLE },
        ],
      },
      { role: "tool", content: "tool result" },
    ]);
  });
});

describe("genericFallback", () => {
  it("uses OpenAI Responses shape when payload has input[]", () => {
    const payload: any = { input: [] };

    expect(genericFallback(payload, STYLE)).toBe(true);
    expect(payload.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: STYLE }] },
    ]);
  });

  it("returns false for unrecognized payloads", () => {
    const payload = { prompt: "Hello" };

    expect(genericFallback(payload, STYLE)).toBe(false);
    expect(payload).toEqual({ prompt: "Hello" });
  });
});
```

- [ ] **Step 4: Run injector tests**

Run:

```bash
npm test -w pi-styles -- injectors.test.ts
```

Expected: all tests in `injectors.test.ts` pass.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck -w pi-styles
```

Expected: TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add extensions/styles/package.json extensions/styles/injectors.test.ts package-lock.json
git commit -m "test: add styles injector regression tests"
```

---

### Task 2: Add the style resolver module with unit tests

**Files:**
- Modify: `extensions/styles/package.json`
- Create: `extensions/styles/styleResolver.ts`
- Create: `extensions/styles/styleResolver.test.ts`

- [ ] **Step 1: Write resolver tests first**

Create `extensions/styles/styleResolver.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StyleResolver,
  isSafeVariantBasename,
  isStyleBasename,
} from "./styleResolver";

type Warning = { id: string; message: string };

type Harness = {
  dir: string;
  resolver: StyleResolver;
  warnings: Warning[];
  write(rel: string, text: string): void;
};

const tempDirs: string[] = [];

function createHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-resolver-"));
  tempDirs.push(dir);
  const warnings: Warning[] = [];
  const resolver = new StyleResolver(dir, (id, message) => warnings.push({ id, message }));
  return {
    dir,
    resolver,
    warnings,
    write(rel: string, text: string) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isSafeVariantBasename", () => {
  it("accepts exact safe model IDs", () => {
    expect(isSafeVariantBasename("claude-sonnet-4-5")).toBe(true);
    expect(isSafeVariantBasename("gpt-5.4")).toBe(true);
    expect(isSafeVariantBasename("model_1.A")).toBe(true);
  });

  it("rejects partial matches and unsafe path-like model IDs", () => {
    expect(isSafeVariantBasename("a/b")).toBe(false);
    expect(isSafeVariantBasename("a\\b")).toBe(false);
    expect(isSafeVariantBasename("model:tag")).toBe(false);
    expect(isSafeVariantBasename(" model")).toBe(false);
    expect(isSafeVariantBasename(".hidden")).toBe(false);
    expect(isSafeVariantBasename(".")).toBe(false);
    expect(isSafeVariantBasename("..")).toBe(false);
    expect(isSafeVariantBasename("")).toBe(false);
  });
});

describe("isStyleBasename", () => {
  it("accepts top-level style names", () => {
    expect(isStyleBasename("concise")).toBe(true);
    expect(isStyleBasename("thought-catalyst")).toBe(true);
    expect(isStyleBasename("Style Name")).toBe(true);
  });

  it("rejects paths, extension suffixes, control names, and dot segments", () => {
    expect(isStyleBasename("../concise")).toBe(false);
    expect(isStyleBasename("foo/bar")).toBe(false);
    expect(isStyleBasename("foo\\bar")).toBe(false);
    expect(isStyleBasename("concise.md")).toBe(false);
    expect(isStyleBasename("_config")).toBe(false);
    expect(isStyleBasename(".")).toBe(false);
    expect(isStyleBasename("..")).toBe(false);
    expect(isStyleBasename("")).toBe(false);
  });
});

describe("StyleResolver.listStyles", () => {
  it("lists simple styles and variant folders with default.md", () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("thought-catalyst/default.md", "Think deeply");
    h.write("broken/claude-sonnet-4-5.md", "Ignored without default");
    h.write("_config.json", "{\"auto\":[]}");

    expect(h.resolver.listStyles()).toEqual([
      { name: "concise", source: "file", reserved: false, label: "concise" },
      {
        name: "thought-catalyst",
        source: "folder",
        reserved: false,
        label: "thought-catalyst",
      },
    ]);
  });

  it("deduplicates simple/folder collisions and warns once", () => {
    const h = createHarness();
    h.write("foo.md", "Simple wins");
    h.write("foo/default.md", "Folder loses");

    expect(h.resolver.listStyles()).toEqual([
      { name: "foo", source: "file", reserved: false, label: "foo" },
    ]);
    expect(h.warnings.map((w) => w.id)).toEqual(["style:collision:foo"]);

    h.resolver.listStyles();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:collision:foo"]);
  });

  it("labels reserved style filenames without making them direct command targets", () => {
    const h = createHarness();
    h.write("auto.md", "Reserved file");

    expect(h.resolver.listStyles()).toEqual([
      {
        name: "auto",
        source: "file",
        reserved: true,
        label: "auto (style; direct /style auto is a command)",
      },
    ]);
    expect(h.warnings.map((w) => w.id)).toEqual(["style:reserved:auto"]);
  });
});

describe("StyleResolver.resolveAutoStyleName", () => {
  it("matches exact model strings and model arrays in order", () => {
    const h = createHarness();
    h.write("slow.md", "Slow");
    h.write("fast.md", "Fast");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "slow" },
          { model: ["gpt-5.4", "gpt-5.4-mini"], style: "fast" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("slow");
    expect(h.resolver.resolveAutoStyleName("gpt-5.4-mini")).toBe("fast");
    expect(h.resolver.resolveAutoStyleName("claude-sonnet")).toBeNull();
  });

  it("treats an empty model array as a valid never-matching rule without warning", () => {
    const h = createHarness();
    h.write("never.md", "Never");
    h.write(
      "_config.json",
      JSON.stringify({ auto: [{ model: [], style: "never" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings).toEqual([]);
  });

  it("uses the first resolvable rule when multiple rules match", () => {
    const h = createHarness();
    h.write("first.md", "First");
    h.write("second.md", "Second");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "first" },
          { model: "claude-sonnet-4-5", style: "second" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("first");
  });

  it("skips missing matched styles and continues to the next resolvable rule", () => {
    const h = createHarness();
    h.write("fallback.md", "Fallback");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "missing" },
          { model: "claude-sonnet-4-5", style: "fallback" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("fallback");
    expect(h.warnings.map((w) => w.id)).toContain("config:missing-style:0:missing");
  });

  it("warns for invalid config rules without throwing", () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ auto: [{ model: 42, style: "x" }, { model: "m", style: "../x" }] }));

    expect(h.resolver.resolveAutoStyleName("m")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual([
      "config:rule:0:model",
      "config:rule:1:style",
    ]);
  });

  it("warns once for invalid _config.json syntax", () => {
    const h = createHarness();
    h.write("_config.json", "{ not json");

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["config:parse"]);
  });

  it("warns when _config.json exists without an auto array", () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ styles: [] }));

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["config:auto"]);
  });

  it("matches config model IDs that are unsafe as variant filenames", () => {
    const h = createHarness();
    h.write("router/default.md", "Default route");
    h.write(
      "_config.json",
      JSON.stringify({ auto: [{ model: "openrouter/claude", style: "router" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("openrouter/claude")).toBe("router");
  });
});

describe("StyleResolver.resolveStyleContent", () => {
  it("reads and wraps a simple style", () => {
    const h = createHarness();
    h.write("concise.md", "Be concise.\n");

    expect(h.resolver.resolveStyleContent("concise", "claude-sonnet-4-5")).toMatchObject({
      name: "concise",
      rawText: "Be concise.",
      wrappedText: "<userStyle>\nBe concise.\n</userStyle>",
    });
  });

  it("uses an exact safe model-ID variant before default.md", () => {
    const h = createHarness();
    h.write("thought/default.md", "Default");
    h.write("thought/claude-sonnet-4-5.md", "Claude variant");

    expect(h.resolver.resolveStyleContent("thought", "claude-sonnet-4-5")?.rawText).toBe(
      "Claude variant",
    );
    expect(h.resolver.resolveStyleContent("thought", "gpt-5.4")?.rawText).toBe("Default");
  });

  it("falls back to default.md for unsafe model IDs while config matching remains independent", () => {
    const h = createHarness();
    h.write("router/default.md", "Default");
    h.write("router/openrouter.md", "Not selected by slash ID");

    expect(h.resolver.resolveStyleContent("router", "openrouter/claude")?.rawText).toBe("Default");
  });

  it("does not serve cached content across different variant files for the same style name", () => {
    const h = createHarness();
    h.write("thought/default.md", "Default");
    h.write("thought/model-a.md", "Variant A");
    h.write("thought/model-b.md", "Variant B");

    const a = h.resolver.resolveStyleContent("thought", "model-a");
    const b = h.resolver.resolveStyleContent("thought", "model-b");
    const d = h.resolver.resolveStyleContent("thought", "unknown-model");

    expect(a?.rawText).toBe("Variant A");
    expect(b?.rawText).toBe("Variant B");
    expect(d?.rawText).toBe("Default");
    expect(a?.file).not.toBe(b?.file);
    expect(b?.file).not.toBe(d?.file);
  });

  it("warns and no-ops for a variant folder without default.md", () => {
    const h = createHarness();
    h.write("broken/claude-sonnet-4-5.md", "Ignored");

    expect(h.resolver.resolveStyleContent("broken", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:variant-missing-default:broken"]);
  });

  it("warns and no-ops for invalid style names", () => {
    const h = createHarness();

    expect(h.resolver.resolveStyleContent("../missing", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:invalid"]);
  });

  it("warns and no-ops for missing manual styles", () => {
    const h = createHarness();

    expect(h.resolver.resolveStyleContent("missing", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:missing:missing"]);
  });

  it("returns null without a warning for empty style files", () => {
    const h = createHarness();
    h.write("empty.md", "\n\n");

    expect(h.resolver.resolveStyleContent("empty", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run resolver tests and observe the expected missing-module failure**

Run:

```bash
npm test -w pi-styles -- styleResolver.test.ts
```

Expected: fail because `./styleResolver` does not exist yet.

- [ ] **Step 3: Implement resolver module**

Create `extensions/styles/styleResolver.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "_config.json";
export const RESERVED_STYLE_ARGS = new Set<string>(["auto", "off", "none", "clear"]);

export type WarningSink = (id: string, message: string) => void;
export type StyleSource = "file" | "folder";

export interface ListedStyle {
  name: string;
  source: StyleSource;
  reserved: boolean;
  label: string;
}

export interface ResolvedStyleContent {
  name: string;
  file: string;
  rawText: string;
  wrappedText: string;
}

interface ParsedAutoRule {
  index: number;
  models: string[];
  style: string;
}

interface ConfigCache {
  mtimeMs: number;
  rules: ParsedAutoRule[];
}

interface TextCacheEntry {
  mtimeMs: number;
  rawText: string;
  wrappedText: string;
}

export function isSafeVariantBasename(modelId: unknown): modelId is string {
  return (
    typeof modelId === "string" &&
    /^[A-Za-z0-9_.-]+$/.test(modelId) &&
    modelId !== "." &&
    modelId !== ".." &&
    !modelId.startsWith(".")
  );
}

export function isStyleBasename(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith("_") &&
    !name.toLowerCase().endsWith(".md") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function safeStat(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function isFile(st: fs.Stats | null): st is fs.Stats {
  return !!st && st.isFile();
}

function isDirectory(st: fs.Stats | null): st is fs.Stats {
  return !!st && st.isDirectory();
}

function stripMarkdownSuffix(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

function sortedByName(styles: ListedStyle[]): ListedStyle[] {
  return [...styles].sort((a, b) => a.name.localeCompare(b.name));
}

function isReservedName(name: string): boolean {
  return RESERVED_STYLE_ARGS.has(name.toLowerCase());
}

function labelForStyle(name: string): string {
  return isReservedName(name) ? `${name} (style; direct /style ${name} is a command)` : name;
}

export class StyleResolver {
  private configCache: ConfigCache | null = null;
  private readonly contentCache = new Map<string, TextCacheEntry>();
  private readonly warned = new Set<string>();
  private warningSink: WarningSink | null;

  constructor(
    public readonly styleDir: string,
    warningSink?: WarningSink | null,
  ) {
    this.warningSink = warningSink ?? null;
  }

  setWarningSink(warningSink?: WarningSink | null): void {
    this.warningSink = warningSink ?? null;
  }

  clearCaches(): void {
    this.configCache = null;
    this.contentCache.clear();
  }

  ensureDir(): void {
    try {
      fs.mkdirSync(this.styleDir, { recursive: true });
    } catch {
      /* ignore directory creation errors; later reads/writes report their own failures */
    }
  }

  styleExists(name: string): boolean {
    if (!isStyleBasename(name)) return false;
    return isFile(safeStat(this.simpleFile(name))) || isFile(safeStat(this.defaultFile(name)));
  }

  listStyles(): ListedStyle[] {
    this.ensureDir();

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.styleDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const styles = new Map<string, ListedStyle>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("_")) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;

      const name = stripMarkdownSuffix(entry.name);
      if (!isStyleBasename(name)) continue;
      const reserved = isReservedName(name);
      if (reserved) this.warnOnce(`style:reserved:${name}`, `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`);
      styles.set(name, { name, source: "file", reserved, label: labelForStyle(name) });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!isStyleBasename(name)) continue;
      if (!isFile(safeStat(this.defaultFile(name)))) continue;

      const reserved = isReservedName(name);
      if (reserved) this.warnOnce(`style:reserved:${name}`, `styles: '${name}' is a reserved /style command word; direct activation selects the command, not the style.`);

      if (styles.has(name)) {
        this.warnOnce(
          `style:collision:${name}`,
          `styles: both '${name}.md' and '${name}/default.md' exist; using '${name}.md'.`,
        );
        continue;
      }

      styles.set(name, { name, source: "folder", reserved, label: labelForStyle(name) });
    }

    return sortedByName([...styles.values()]);
  }

  resolveAutoStyleName(modelId: unknown): string | null {
    if (typeof modelId !== "string" || modelId.length === 0) return null;

    for (const rule of this.readAutoRules()) {
      if (!rule.models.includes(modelId)) continue;
      if (this.styleExists(rule.style)) return rule.style;
      this.warnOnce(
        `config:missing-style:${rule.index}:${rule.style}`,
        `styles: auto rule ${rule.index} matched '${modelId}' but style '${rule.style}' does not exist.`,
      );
    }

    return null;
  }

  resolveStyleContent(name: unknown, modelId: unknown): ResolvedStyleContent | null {
    if (!isStyleBasename(name)) {
      this.warnOnce("style:invalid", `styles: invalid style name '${String(name)}'; expected a top-level style basename.`);
      return null;
    }

    const simplePath = this.simpleFile(name);
    const defaultPath = this.defaultFile(name);
    const simpleStat = safeStat(simplePath);
    const defaultStat = safeStat(defaultPath);
    const hasSimple = isFile(simpleStat);
    const hasDefault = isFile(defaultStat);

    if (hasSimple && hasDefault) {
      this.warnOnce(
        `style:collision:${name}`,
        `styles: both '${name}.md' and '${name}/default.md' exist; using '${name}.md'.`,
      );
    }

    if (hasSimple) return this.readMarkdown(name, simplePath, simpleStat);

    if (hasDefault) {
      let selectedPath = defaultPath;
      let selectedStat = defaultStat;
      if (isSafeVariantBasename(modelId)) {
        const variantPath = this.variantFile(name, modelId);
        const variantStat = safeStat(variantPath);
        if (isFile(variantStat)) {
          selectedPath = variantPath;
          selectedStat = variantStat;
        }
      }
      return this.readMarkdown(name, selectedPath, selectedStat);
    }

    if (isDirectory(safeStat(this.styleFolder(name)))) {
      this.warnOnce(
        `style:variant-missing-default:${name}`,
        `styles: '${name}' is a folder style but is missing default.md; no style injected.`,
      );
      return null;
    }

    this.warnOnce(`style:missing:${name}`, `styles: selected style '${name}' does not exist; no style injected.`);
    return null;
  }

  private readAutoRules(): ParsedAutoRule[] {
    const file = path.join(this.styleDir, CONFIG_FILE);
    const st = safeStat(file);
    if (!isFile(st)) {
      this.configCache = null;
      return [];
    }

    if (this.configCache && this.configCache.mtimeMs === st.mtimeMs) return this.configCache.rules;

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      this.warnOnce("config:parse", `styles: could not parse _config.json: ${(error as Error).message}`);
      this.configCache = { mtimeMs: st.mtimeMs, rules: [] };
      return [];
    }

    const auto = (parsed as { auto?: unknown } | null)?.auto;
    if (!Array.isArray(auto)) {
      this.warnOnce("config:auto", "styles: _config.json must contain an 'auto' array.");
      this.configCache = { mtimeMs: st.mtimeMs, rules: [] };
      return [];
    }

    const rules: ParsedAutoRule[] = [];
    auto.forEach((rule: unknown, index) => {
      const rawModel = (rule as { model?: unknown } | null)?.model;
      let models: string[] | null = null;

      if (typeof rawModel === "string") {
        models = [rawModel];
      } else if (Array.isArray(rawModel) && rawModel.every((item) => typeof item === "string")) {
        models = rawModel;
      }

      if (!models) {
        this.warnOnce(`config:rule:${index}:model`, `styles: _config.json auto rule ${index} has invalid 'model'; expected string or string array.`);
        return;
      }

      const style = (rule as { style?: unknown } | null)?.style;
      if (typeof style !== "string" || !isStyleBasename(style)) {
        this.warnOnce(`config:rule:${index}:style`, `styles: _config.json auto rule ${index} has invalid 'style'; expected a top-level style name.`);
        return;
      }

      rules.push({ index, models, style });
    });

    this.configCache = { mtimeMs: st.mtimeMs, rules };
    return rules;
  }

  private readMarkdown(name: string, file: string, st: fs.Stats): ResolvedStyleContent | null {
    const absoluteFile = path.resolve(file);
    const cached = this.contentCache.get(absoluteFile);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      if (!cached.wrappedText) return null;
      return { name, file: absoluteFile, rawText: cached.rawText, wrappedText: cached.wrappedText };
    }

    const rawText = fs.readFileSync(absoluteFile, "utf8").trim();
    const wrappedText = rawText ? `<userStyle>\n${rawText}\n</userStyle>` : "";
    this.contentCache.set(absoluteFile, { mtimeMs: st.mtimeMs, rawText, wrappedText });

    if (!wrappedText) return null;
    return { name, file: absoluteFile, rawText, wrappedText };
  }

  private warnOnce(id: string, message: string): void {
    if (this.warned.has(id)) return;
    if (!this.warningSink) return;
    this.warned.add(id);
    this.warningSink(id, message);
  }

  private simpleFile(name: string): string {
    return path.join(this.styleDir, `${name}.md`);
  }

  private styleFolder(name: string): string {
    return path.join(this.styleDir, name);
  }

  private defaultFile(name: string): string {
    return path.join(this.styleFolder(name), "default.md");
  }

  private variantFile(name: string, modelId: string): string {
    return path.join(this.styleFolder(name), `${modelId}.md`);
  }
}
```

- [ ] **Step 4: Add the resolver to the package file list**

Edit `extensions/styles/package.json` so the `files` array becomes:

```json
"files": ["index.ts", "injectors.ts", "styleResolver.ts", "styles", "README.md"]
```

This keeps the Task 1 package metadata from naming a not-yet-created source file while ensuring the resolver ships once it exists.

- [ ] **Step 5: Run resolver tests**

Run:

```bash
npm test -w pi-styles -- styleResolver.test.ts
```

Expected: all resolver tests pass.

- [ ] **Step 6: Run full extension tests and typecheck**

Run:

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add extensions/styles/package.json extensions/styles/styleResolver.ts extensions/styles/styleResolver.test.ts
git commit -m "feat: add styles resolver"
```

---

### Task 3: Wire resolver into the Pi extension entry point

**Files:**
- Modify: `extensions/styles/index.ts`
- Create: `extensions/styles/index.test.ts`

- [ ] **Step 1: Write index integration tests first**

Create `extensions/styles/index.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerStyles } from "./index";

type Notification = { message: string; type?: string };
type SelectCall = { title: string; options: string[] };

type Harness = {
  dir: string;
  entries: any[];
  notifications: Notification[];
  statuses: Map<string, string | undefined>;
  commands: Map<string, any>;
  handlers: Map<string, any>;
  selectCalls: SelectCall[];
  ctx: any;
  write(rel: string, text: string): void;
  chooseNext(option: string): void;
  runCommand(args: string): Promise<void>;
  triggerSessionStart(): Promise<void>;
  triggerBeforeProviderRequest(payload: any): Promise<any>;
};

const tempDirs: string[] = [];

function createHarness(model = { id: "claude-sonnet-4-5", api: "anthropic-messages" }): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-index-"));
  tempDirs.push(dir);

  const entries: any[] = [];
  const notifications: Notification[] = [];
  const statuses = new Map<string, string | undefined>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const selectCalls: SelectCall[] = [];
  let nextSelection: string | undefined;

  const ctx: any = {
    model,
    sessionManager: {
      getBranch: () => entries,
    },
    ui: {
      setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      select: async (title: string, options: string[]) => {
        selectCalls.push({ title, options });
        return nextSelection ?? options[0];
      },
      input: async () => "new style",
      editor: async (_title: string, seed: string) => seed,
      confirm: async () => true,
    },
  };

  const pi: any = {
    on: (name: string, handler: any) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  };

  registerStyles(pi, { styleDir: dir });

  return {
    dir,
    entries,
    notifications,
    statuses,
    commands,
    handlers,
    selectCalls,
    ctx,
    write(rel: string, text: string) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    },
    chooseNext(option: string) {
      nextSelection = option;
    },
    async runCommand(args: string) {
      await commands.get("style").handler(args, ctx);
    },
    async triggerSessionStart() {
      await handlers.get("session_start")({}, ctx);
    },
    async triggerBeforeProviderRequest(payload: any) {
      return handlers.get("before_provider_request")({ payload }, ctx);
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("styles extension mode restoration", () => {
  it("restores a manual variant-folder style without requiring <name>.md", async () => {
    const h = createHarness();
    h.write("thought/default.md", "Default thought style");
    h.entries.push({ type: "custom", customType: "styles:active", data: { name: "thought" } });

    await h.triggerSessionStart();

    expect(h.statuses.get("style")).toBe("style: thought");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(payload.messages[0].content.at(-1)).toEqual({
      type: "text",
      text: "<userStyle>\nDefault thought style\n</userStyle>",
    });
  });

  it("restores auto mode and shows style: auto before the first request", async () => {
    const h = createHarness();
    h.entries.push({ type: "custom", customType: "styles:active", data: { auto: true } });

    await h.triggerSessionStart();

    expect(h.statuses.get("style")).toBe("style: auto");
  });
});

describe("styles extension commands", () => {
  it("/style auto persists auto mode and confirms it in the footer immediately", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("_config.json", JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "concise" }] }));

    await h.runCommand("auto");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
    expect(h.notifications.at(-1)).toEqual({ message: "Auto style mode enabled.", type: "info" });
  });

  it("reserved direct arguments are commands even when same-named style files exist", async () => {
    const h = createHarness();
    h.write("auto.md", "This style cannot be selected by direct /style auto");

    await h.runCommand("auto");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
  });

  it("/style off persists off mode and clears the footer", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");

    await h.runCommand("concise");
    await h.runCommand("off");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: null } });
    expect(h.statuses.get("style")).toBeUndefined();
  });

  it("/style picker activates a style by its displayed label and marks the current mode", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("thought-catalyst/default.md", "Think deeply");
    h.chooseNext("  thought-catalyst");

    await h.runCommand("");

    expect(h.selectCalls[0]).toEqual({
      title: "Output style",
      options: [
        "  concise",
        "  thought-catalyst",
        "  Auto (choose style by model)",
        "✓ None (turn off styles)",
        "➕  Create new style…",
      ],
    });
    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: "thought-catalyst" } });
    expect(h.statuses.get("style")).toBe("style: thought-catalyst");
  });

  it("/style picker auto action persists auto mode", async () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.chooseNext("  Auto (choose style by model)");

    await h.runCommand("");

    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { auto: true } });
    expect(h.statuses.get("style")).toBe("style: auto");
  });

  it("/style picker create action writes and activates a simple style", async () => {
    const h = createHarness();
    h.chooseNext("➕  Create new style…");

    await h.runCommand("");

    expect(fs.existsSync(path.join(h.dir, "new-style.md"))).toBe(true);
    expect(h.entries.at(-1)).toEqual({ type: "custom", customType: "styles:active", data: { name: "new-style" } });
    expect(h.statuses.get("style")).toBe("style: new-style");
  });
});

describe("styles extension request-time resolution", () => {
  it("injects exact manual model-ID variants and falls back to default.md", async () => {
    const h = createHarness();
    h.write("thought/default.md", "Default thought style");
    h.write("thought/claude-sonnet-4-5.md", "Claude thought style");

    await h.runCommand("thought");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(payload.messages[0].content.at(-1).text).toBe(
      "<userStyle>\nClaude thought style\n</userStyle>",
    );

    h.ctx.model = { id: "openrouter/claude", api: "anthropic-messages" };
    const fallbackPayload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(fallbackPayload);

    expect(fallbackPayload.messages[0].content.at(-1).text).toBe(
      "<userStyle>\nDefault thought style\n</userStyle>",
    );
  });

  it("auto mode resolves on each request, updates footer, and injects the resolved style", async () => {
    const h = createHarness({ id: "gpt-5.4", api: "openai-responses" });
    h.write("concise.md", "Be concise");
    h.write("_config.json", JSON.stringify({ auto: [{ model: ["gpt-5.4", "gpt-5.4-mini"], style: "concise" }] }));

    await h.runCommand("auto");

    const payload: any = { input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }] };
    await h.triggerBeforeProviderRequest(payload);

    expect(h.statuses.get("style")).toBe("style: concise (auto)");
    expect(h.notifications).toContainEqual({ message: "Auto style resolved to 'concise'.", type: "info" });
    expect(payload.input.at(-1)).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "<userStyle>\nBe concise\n</userStyle>" }],
    });
  });

  it("auto mode with no matching config keeps style: auto and injects nothing", async () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ auto: [{ model: "gpt-5.4", style: "concise" }] }));

    await h.runCommand("auto");

    const payload: any = {
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    };
    await h.triggerBeforeProviderRequest(payload);

    expect(h.statuses.get("style")).toBe("style: auto");
    expect(payload.messages[0].content).toEqual([{ type: "text", text: "Hello" }]);
  });
});
```

- [ ] **Step 2: Run index tests and observe expected failures**

Run:

```bash
npm test -w pi-styles -- index.test.ts
```

Expected: fail because `index.ts` does not export `registerStyles` and does not implement auto/variant mode wiring yet.

- [ ] **Step 3: Replace the extension entry point implementation**

Replace `extensions/styles/index.ts` with:

```ts
/**
 * styles — claude.ai-style output styles for Pi.
 *
 * A `/style` command selects a sticky style mode:
 *
 *   - off: inject nothing
 *   - manual: inject one named style, with optional per-model variants
 *   - auto: choose a style from styles/_config.json by exact model ID
 *
 * The resolved style text is injected EPHEMERALLY into every provider request as
 * a trailing <userStyle> block. It is never persisted to the session and never
 * accumulates in conversation history.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { INJECTORS, genericFallback } from "./injectors";
import { RESERVED_STYLE_ARGS, StyleResolver, type ListedStyle } from "./styleResolver";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STYLE_DIR = path.join(HERE, "styles");
const ACTIVE_ENTRY = "styles:active";
const DEBUG = !!process.env.PI_STYLES_DEBUG;

const ACT_CREATE = "➕  Create new style…";
const ACT_AUTO = "Auto (choose style by model)";
const ACT_OFF = "None (turn off styles)";

type StyleMode =
  | { kind: "off" }
  | { kind: "manual"; name: string }
  | { kind: "auto" };

export interface StylesExtensionOptions {
  styleDir?: string;
}

function debug(...args: unknown[]) {
  if (DEBUG) console.error("[styles]", ...args);
}

function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "style"
  );
}

function modeEntry(mode: StyleMode): unknown {
  if (mode.kind === "auto") return { auto: true };
  if (mode.kind === "manual") return { name: mode.name };
  return { name: null };
}

function restoreModeFromEntries(entries: any[]): StyleMode {
  let mode: StyleMode = { kind: "off" };
  for (const entry of entries) {
    if (entry?.type !== "custom" || entry?.customType !== ACTIVE_ENTRY) continue;
    const data = entry.data;
    if (data?.auto === true) {
      mode = { kind: "auto" };
    } else if (data && Object.prototype.hasOwnProperty.call(data, "name")) {
      mode = typeof data.name === "string" ? { kind: "manual", name: data.name } : { kind: "off" };
    }
  }
  return mode;
}

function styleChoiceLabel(style: ListedStyle, currentMode: StyleMode): string {
  const mark = currentMode.kind === "manual" && currentMode.name === style.name ? "✓" : " ";
  return `${mark} ${style.label}`;
}

function actionChoiceLabel(active: boolean, label: string): string {
  return `${active ? "✓" : " "} ${label}`;
}

function directStyleNames(styles: ListedStyle[]): string[] {
  return styles.filter((style) => !style.reserved).map((style) => style.name);
}

export function registerStyles(pi: ExtensionAPI, options: StylesExtensionOptions = {}): void {
  const resolver = new StyleResolver(options.styleDir ?? DEFAULT_STYLE_DIR);
  let mode: StyleMode = { kind: "off" };
  let lastAutoResolved: string | null = null;
  const warnedApis = new Set<string>();

  function attachWarnings(ctx: any): void {
    resolver.setWarningSink((_id, message) => ctx?.ui?.notify?.(message, "warning"));
  }

  function updateFooter(ctx: any): void {
    if (mode.kind === "off") {
      ctx?.ui?.setStatus?.("style", undefined);
    } else if (mode.kind === "manual") {
      ctx?.ui?.setStatus?.("style", `style: ${mode.name}`);
    } else {
      ctx?.ui?.setStatus?.("style", lastAutoResolved ? `style: ${lastAutoResolved} (auto)` : "style: auto");
    }
  }

  function setMode(nextMode: StyleMode, ctx: any, persist = true): void {
    attachWarnings(ctx);
    mode = nextMode;
    lastAutoResolved = null;
    if (persist) {
      try {
        pi.appendEntry(ACTIVE_ENTRY, modeEntry(mode));
      } catch {
        /* ephemeral session: in-memory only */
      }
    }
    updateFooter(ctx);
    debug("setMode", mode);
  }

  async function runCreate(ctx: any): Promise<void> {
    attachWarnings(ctx);
    const rawName = await ctx.ui.input("New style name:", "e.g. concise, socratic, code-only");
    if (!rawName) return;

    let name = slugify(rawName);
    if (RESERVED_STYLE_ARGS.has(name)) {
      const renamed = `${name}-style`;
      ctx.ui.notify(`'${name}' is reserved for /style commands; creating '${renamed}' instead.`, "warning");
      name = renamed;
    }

    const file = path.join(options.styleDir ?? DEFAULT_STYLE_DIR, `${name}.md`);
    if (fs.existsSync(file) || resolver.styleExists(name)) {
      const ok = await ctx.ui.confirm("Overwrite?", `Style '${name}' already exists. Create or overwrite '${name}.md'?`);
      if (!ok) return;
    }

    const seed =
      "Write the instructions that should shape responses here.\n\n" +
      "- Tone and voice\n- Length and structure\n- Formatting preferences\n";
    const content = await ctx.ui.editor(`Style: ${name}`, seed);
    if (content == null) return;

    resolver.ensureDir();
    fs.writeFileSync(file, `${content.trim()}\n`, "utf8");
    resolver.clearCaches();
    setMode({ kind: "manual", name }, ctx);
    ctx.ui.notify(`Created and activated style '${name}'.`, "info");
  }

  function activateByName(arg: string, ctx: any): boolean {
    attachWarnings(ctx);
    const a = arg.trim();
    if (!a) return false;

    const lower = a.toLowerCase();
    if (lower === "auto") {
      setMode({ kind: "auto" }, ctx);
      ctx.ui.notify("Auto style mode enabled.", "info");
      return true;
    }

    if (lower === "off" || lower === "none" || lower === "clear") {
      setMode({ kind: "off" }, ctx);
      ctx.ui.notify("Styles turned off.", "info");
      return true;
    }

    const names = directStyleNames(resolver.listStyles());
    const slug = slugify(a);
    const match =
      names.find((n) => n === a) ??
      names.find((n) => n === slug) ??
      names.find((n) => n.toLowerCase() === a.toLowerCase());

    if (!match) {
      ctx.ui.notify(`No style named '${a}'.`, "warning");
      return true;
    }

    setMode({ kind: "manual", name: match }, ctx);
    ctx.ui.notify(`Style '${match}' activated.`, "info");
    return true;
  }

  pi.on("session_start", async (_event, ctx) => {
    attachWarnings(ctx);
    lastAutoResolved = null;
    try {
      const sm: any = ctx.sessionManager;
      const entries = sm.getBranch?.() ?? sm.getEntries?.() ?? [];
      mode = restoreModeFromEntries(entries);
    } catch {
      mode = { kind: "off" };
    }
    updateFooter(ctx);
    debug("session_start mode=", mode);
  });

  pi.on("before_provider_request", (event, ctx) => {
    attachWarnings(ctx);
    if (mode.kind === "off") return;

    const modelId = typeof (ctx as any).model?.id === "string" ? (ctx as any).model.id : undefined;
    let styleName: string | null = null;

    if (mode.kind === "manual") {
      styleName = mode.name;
    } else {
      const previousAutoResolved = lastAutoResolved;
      styleName = resolver.resolveAutoStyleName(modelId);
      lastAutoResolved = styleName;
      updateFooter(ctx);
      if (styleName && styleName !== previousAutoResolved) {
        ctx.ui?.notify?.(`Auto style resolved to '${styleName}'.`, "info");
      }
    }

    if (!styleName) return;

    const resolved = resolver.resolveStyleContent(styleName, modelId);
    if (!resolved) return;

    const api = (ctx as any).model?.api as string | undefined;
    try {
      const inject = api ? INJECTORS[api] : undefined;
      if (inject) {
        inject(event.payload, resolved.wrappedText);
        debug("injected", { api, style: styleName, file: resolved.file });
        return event.payload;
      }

      const key = api ?? "unknown";
      const ok = genericFallback(event.payload, resolved.wrappedText);
      if (!warnedApis.has(key)) {
        warnedApis.add(key);
        ctx.ui?.notify?.(
          `styles: '${key}' not explicitly supported — using generic injection; caching path unverified.`,
          "warning",
        );
      }
      debug(ok ? "generic injected" : "no injection (unrecognized payload)", { api });
      return ok ? event.payload : undefined;
    } catch (e) {
      ctx.ui?.notify?.(
        `styles: skipped injection (${api ?? "?"}): ${(e as Error).message}`,
        "warning",
      );
      debug("inject error", e);
      return;
    }
  });

  pi.registerCommand("style", {
    description: "Select, create, auto-route, or turn off an output style (ephemeral <userStyle> injection)",
    getArgumentCompletions: (prefix: string) => {
      resolver.setWarningSink(null);
      const items = [
        ...directStyleNames(resolver.listStyles()).map((n) => ({ value: n, label: n })),
        { value: "auto", label: "auto (choose style by model)" },
        { value: "off", label: "off (turn off)" },
      ];
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length ? filtered : null;
    },
    handler: async (args: string, ctx: any) => {
      attachWarnings(ctx);
      if (args && args.trim()) {
        activateByName(args, ctx);
        return;
      }

      const styles = resolver.listStyles();
      const optionToName = new Map<string, string>();
      const styleOptions = styles.map((style) => {
        const label = styleChoiceLabel(style, mode);
        optionToName.set(label, style.name);
        return label;
      });
      const autoChoice = actionChoiceLabel(mode.kind === "auto", ACT_AUTO);
      const offChoice = actionChoiceLabel(mode.kind === "off", ACT_OFF);
      const optionsForPicker = [...styleOptions, autoChoice, offChoice, ACT_CREATE];

      const choice = await ctx.ui.select("Output style", optionsForPicker);
      if (!choice) return;

      if (choice === ACT_CREATE) {
        await runCreate(ctx);
        return;
      }

      if (choice === autoChoice) {
        setMode({ kind: "auto" }, ctx);
        ctx.ui.notify("Auto style mode enabled.", "info");
        return;
      }

      if (choice === offChoice) {
        setMode({ kind: "off" }, ctx);
        ctx.ui.notify("Styles turned off.", "info");
        return;
      }

      const name = optionToName.get(choice);
      if (!name) return;
      setMode({ kind: "manual", name }, ctx);
      ctx.ui.notify(`Style '${name}' activated.`, "info");
    },
  });
}

export default function styles(pi: ExtensionAPI) {
  registerStyles(pi);
}
```

- [ ] **Step 4: Run index tests**

Run:

```bash
npm test -w pi-styles -- index.test.ts
```

Expected: all index tests pass.

- [ ] **Step 5: Run full extension tests and typecheck**

Run:

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add extensions/styles/index.ts extensions/styles/index.test.ts
git commit -m "feat: wire styles model-aware modes"
```

---

### Task 4: Update user docs, ship a self-demonstrating variant example, and remove canary styles

**Files:**
- Modify: `extensions/styles/README.md`
- Create: `extensions/styles/styles/_config.json`
- Delete: `extensions/styles/styles/thought-catalyst.md`
- Create: `extensions/styles/styles/thought-catalyst/default.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-haiku-4-5.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-sonnet-4-5.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-sonnet-4-6.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-opus-4-5.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-opus-4-6.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-opus-4-7.md`
- Create: `extensions/styles/styles/thought-catalyst/claude-opus-4-8.md`
- Delete: `extensions/styles/styles/test-style.md`

- [ ] **Step 1: Replace README with current behavior**

Replace `extensions/styles/README.md` with:

```md
# styles

claude.ai-style **output styles** for Pi. An active style is injected
*ephemerally* into every model request as a trailing `<userStyle>…</userStyle>`
block — it never persists to the session, never accumulates, and is added at
the provider payload layer immediately before the request is sent.

## Usage

- `/style` — open a picker: choose a style, choose **Auto**, choose **None**, or
  **Create new style…**.
- `/style <name>` — activate a style directly by name.
- `/style auto` — choose a style from `styles/_config.json` by exact current
  model ID on each request.
- `/style off` — turn styling off (`off` / `none` / `clear` all work).

Footer states:

- no footer item: styles are off;
- `style: <name>`: manual style mode;
- `style: auto`: auto mode is active, but the last request did not resolve a
  style yet or did not match a style;
- `style: <name> (auto)`: auto mode resolved `<name>` for the last request.

The footer reports the selected/resolved style name. If a style file exists but
is empty after trimming, the footer may still show that style while injection
no-ops.

## Simple styles

A simple style is a top-level Markdown file:

```text
styles/
  concise.md
```

The filename minus `.md` is the style name. Editing a style file is picked up on
the next request after the file mtime changes.

## Model-ID variant styles

A variant style is a folder with `default.md` plus optional exact model-ID files:

```text
styles/
  thought-catalyst/
    default.md
    claude-haiku-4-5.md
    claude-sonnet-4-5.md
    claude-sonnet-4-6.md
```

When the active style is `thought-catalyst`, the extension reads:

1. `styles/thought-catalyst/<ctx.model.id>.md` when the model ID is safe as a
   filename and that file exists;
2. otherwise `styles/thought-catalyst/default.md`.

`default.md` is required. A folder without `default.md` is not shown in the
picker and injects nothing if referenced by session state or config.

Variant lookup is exact filename lookup. There are no regexes, globs, template
variables, or router rules. Model IDs containing `/`, `\\`, `:`, whitespace, or a
leading `.` cannot be used as variant filenames and fall back to `default.md`.
They can still be matched in `_config.json` auto rules.

If both `foo.md` and `foo/default.md` exist, `foo.md` wins and the picker lists
`foo` once.

## Auto mode

Auto mode is explicit and sticky:

```text
/style auto
```

Auto mode reads optional JSON config from:

```text
styles/_config.json
```

Bundled example:

```json
{
  "auto": [
    {
      "model": [
        "claude-haiku-4-5",
        "claude-sonnet-4-5",
        "claude-sonnet-4-6",
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8"
      ],
      "style": "thought-catalyst"
    }
  ]
}
```

The bundled `thought-catalyst` style demonstrates variants: `default.md` uses
`<think>` terminology, while each listed Anthropic model ID has an exact
same-named `.md` variant using `<antml:thinking>` terminology.

Rules are evaluated in order. `model` is either a string or an array of strings.
Matching is exact against `ctx.model.id`. The first matching rule whose `style`
exists wins. A `style` value is a style name, not a path.

## Reserved command words

The direct command arguments `auto`, `off`, `none`, and `clear` are reserved.
For example, `/style auto` always enables auto mode, even if `styles/auto.md`
exists. The picker labels reserved style names distinctly.

`Create new style…` creates a simple top-level `.md` file. If the requested name
slugifies to a reserved command word, the extension creates `<word>-style.md`
instead.

## How injection works

Injection happens in `before_provider_request` — after Pi serializes the payload
and assigns provider-specific cache metadata. The resolved style text is spliced
in after cache breakpoints where the provider format exposes them, so style
changes do not invalidate cached conversation prefixes.

Dispatch is keyed on `model.api`, so switching models mid-session is handled at
request time:

| `model.api` | strategy |
| --- | --- |
| `anthropic-messages` | append text block to last user message, after its cache_control block |
| `openai-responses` (gpt-5.x / codex) | append trailing user input item |
| `openai-completions` | append text part after the last user text part |

Unhandled apis get a best-effort generic splice plus a one-time warning. See
[`./injectors.ts`](./injectors.ts) to add a provider.

## Debugging

Set `PI_STYLES_DEBUG=1` to log the chosen api, style name, resolved file path,
and injection outcome to stderr. Verify caching by watching `cacheRead` /
`cacheWrite` in usage across two turns on both an Anthropic and a Codex model.
```

- [ ] **Step 2: Convert the bundled thought-catalyst style into a real variant folder**

Run:

```bash
mkdir -p extensions/styles/styles/thought-catalyst

cat > extensions/styles/styles/thought-catalyst/default.md <<'EOF'
## Additional mandatory thinking process.

Seamlessly incorporate these strategies in all <think> processes.

- Spark (Ω): Start with a new idea or a fresh angle.
- Check (Σ): Run a quick sanity check. Does this idea make sense?
- Sculpt (Φ/Ψ): Keep the strong parts of the idea, and trim the weak ones.
- Question (Ξ): Ask a clarifying question to dig deeper.
- Embrace (Π): If a contradiction pops up, don't ignore it. It's often where the most interesting insights are hidden.
- Wander (∂): Toss in a random thought or analogy to see if it sparks a new connection.
- Scan (X): Look at the bigger picture. Are there any real-world constraints we're ignoring?
- Review (Λ): Briefly check in on the process itself. Is this working?
EOF

for model in \
  claude-haiku-4-5 \
  claude-sonnet-4-5 \
  claude-sonnet-4-6 \
  claude-opus-4-5 \
  claude-opus-4-6 \
  claude-opus-4-7 \
  claude-opus-4-8
 do
  cat > "extensions/styles/styles/thought-catalyst/${model}.md" <<'EOF'
## Additional mandatory thinking process.

Seamlessly incorporate these strategies in all <antml:thinking> processes.

- Spark (Ω): Start with a new idea or a fresh angle.
- Check (Σ): Run a quick sanity check. Does this idea make sense?
- Sculpt (Φ/Ψ): Keep the strong parts of the idea, and trim the weak ones.
- Question (Ξ): Ask a clarifying question to dig deeper.
- Embrace (Π): If a contradiction pops up, don't ignore it. It's often where the most interesting insights are hidden.
- Wander (∂): Toss in a random thought or analogy to see if it sparks a new connection.
- Scan (X): Look at the bigger picture. Are there any real-world constraints we're ignoring?
- Review (Λ): Briefly check in on the process itself. Is this working?
EOF
done

cat > extensions/styles/styles/_config.json <<'EOF'
{
  "auto": [
    {
      "model": [
        "claude-haiku-4-5",
        "claude-sonnet-4-5",
        "claude-sonnet-4-6",
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8"
      ],
      "style": "thought-catalyst"
    }
  ]
}
EOF

rm extensions/styles/styles/thought-catalyst.md
```

Expected:

- `extensions/styles/styles/thought-catalyst/default.md` exists and uses `<think>` terminology;
- every Anthropic model ID listed in `_config.json` has an exact same-named `.md` variant using `<antml:thinking>` terminology;
- `extensions/styles/styles/thought-catalyst.md` is removed, avoiding a simple/folder collision in the bundled package.

- [ ] **Step 3: Delete the canary style**

Run:

```bash
rm extensions/styles/styles/test-style.md
```

Expected: file is removed from the working tree.

- [ ] **Step 4: Run tests, typecheck, and package dry-run**

Run:

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
npm pack --dry-run -w pi-styles
```

Expected:

- tests pass;
- typecheck exits 0;
- dry-run package file list does not include `styles/test-style.md` or `styles/thought-catalyst.md`;
- dry-run package file list includes `index.ts`, `injectors.ts`, `styleResolver.ts`, `styles/_config.json`, `styles/thought-catalyst/default.md`, every Anthropic `styles/thought-catalyst/<model-id>.md` variant, bundled non-canary styles, and `README.md`;
- dry-run package file list excludes `index.test.ts`, `injectors.test.ts`, and `styleResolver.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add extensions/styles/README.md extensions/styles/styles
git commit -m "docs: document styles variant routing"
```

---

### Task 5: Final verification and review handoff

**Files:**
- Verify: all files changed by Tasks 1–4

- [ ] **Step 1: Run the full verification suite**

Run from the repository root:

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
npm pack --dry-run -w pi-styles
git diff --check
```

Expected:

- `npm test -w pi-styles` exits 0;
- `npm run typecheck -w pi-styles` exits 0;
- `npm pack --dry-run -w pi-styles` exits 0 and excludes `styles/test-style.md`, `styles/thought-catalyst.md`, and `*.test.ts`;
- `git diff --check` exits 0.

- [ ] **Step 2: Verify spec coverage manually**

Check these requirements against code and tests:

```text
[ ] Simple top-level *.md styles still resolve.
[ ] Variant folders require default.md.
[ ] Exact safe <modelID>.md variant lookup happens before default.md.
[ ] Unsafe model IDs fall back to default.md.
[ ] /style off persists { name: null } and clears footer.
[ ] /style <name> persists { name: "<name>" } and survives session_start for folder styles.
[ ] /style auto persists { auto: true } and shows style: auto before first request.
[ ] _config.json supports model as string and string array.
[ ] Auto rules are exact-only and ordered.
[ ] Missing matched auto style warns once and continues.
[ ] Invalid JSON warns once; invalid style basenames warn and no-op; empty model arrays do not warn.
[ ] Interactive /style picker label mapping and action branches are covered.
[ ] Simple/folder collision lists once, warns once, and simple file wins.
[ ] Content cache is keyed by resolved absolute Markdown file path.
[ ] injectors.ts behavior is unchanged and covered by regression tests.
[ ] README documents folders, _config.json, auto mode, bundled thought-catalyst variants, reserved command words, and footer states.
[ ] Bundled styles/_config.json maps the requested Anthropic model IDs to thought-catalyst.
[ ] Bundled thought-catalyst/default.md uses <think> terminology.
[ ] Every Anthropic model ID in bundled styles/_config.json has an exact thought-catalyst/<model-id>.md file using <antml:thinking> terminology.
[ ] styles/test-style.md and styles/thought-catalyst.md no longer ship.
```

- [ ] **Step 3: Request code review**

Use the requesting-code-review skill. Ask the reviewer to focus on:

```text
- Does the implementation match docs/superpowers/specs/2026-06-06-styles-model-id-variant-routing-design.md?
- Are path joins safe for config style names and model ID variant filenames?
- Does session_start avoid dropping restored folder styles?
- Is content caching keyed by resolved file path rather than style name?
- Does auto mode remain visibly distinct from off before the first request?
- Are tests meaningful for resolver edge cases, picker behavior, and provider injection behavior?
- Do the bundled thought-catalyst variants and styles/_config.json demonstrate the model-ID folder design without adding alias/router complexity?
```

- [ ] **Step 4: Address reviewed issues one at a time**

For each accepted review issue:

```bash
npm test -w pi-styles
npm run typecheck -w pi-styles
```

Expected after each fix: both commands exit 0.

- [ ] **Step 5: Final commit if review produced changes**

If review changes were made:

```bash
git add extensions/styles docs/superpowers/plans/2026-06-06-styles-model-id-variant-routing-impl.md package-lock.json
git commit -m "fix: address styles routing review"
```

If review produced no changes, do not create an empty commit.
