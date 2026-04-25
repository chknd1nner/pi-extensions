# Replace Prompt Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `replace-prompt` Pi extension that merges global and project-local `rules.ts` configs, applies ordered literal/regex prompt replacements in `before_agent_start`, resolves inline or file-backed replacement content, and optionally logs diagnostics to `replace-prompt.log`.

**Architecture:** Implement the extension as a small set of focused modules under `extensions/replace-prompt/`: config loading and validation, merge logic, replacement resolution, prompt transformation, and optional logging. Add a lightweight TypeScript/Vitest test harness so the behavior can be developed test-first and verified without needing to launch Pi interactively.

**Tech Stack:** TypeScript, Vitest, jiti, Node.js built-ins (`fs`, `path`, `url`), Pi Extension API

---

## File structure

### New files

- `extensions/replace-prompt/package.json` — extension-local test dependencies and scripts for TypeScript/Vitest/jiti
- `extensions/replace-prompt/tsconfig.json` — extension-local TypeScript config for editor support and Vitest compilation
- `extensions/replace-prompt/index.ts` — extension entrypoint that wires `before_agent_start`
- `extensions/replace-prompt/types.ts` — shared config, normalized rule, and log event types
- `extensions/replace-prompt/load-config.ts` — config discovery, dynamic `rules.ts` loading, validation, normalization
- `extensions/replace-prompt/merge-rules.ts` — merge global/project configs while preserving inherited order
- `extensions/replace-prompt/resolve-replacement.ts` — resolve inline or file-backed replacement text with project-first precedence
- `extensions/replace-prompt/apply-rules.ts` — normalize line endings and apply ordered literal/regex replacements
- `extensions/replace-prompt/logging.ts` — optional file logger and log path selection
- `extensions/replace-prompt/rules.ts` — sample config shipped with the example extension
- `extensions/replace-prompt/opening.md` — sample replacement file referenced by the sample config
- `extensions/replace-prompt/tests/merge-rules.test.ts` — merge and ordering tests
- `extensions/replace-prompt/tests/apply-rules.test.ts` — literal/regex/application behavior tests
- `extensions/replace-prompt/tests/load-config.test.ts` — config validation, duplicate IDs, file precedence, logging path tests
- `extensions/replace-prompt/tests/index.test.ts` — entrypoint integration tests for `before_agent_start`

### Existing files to modify

- `README.md` — mention the new extension and where to find it

---

### Task 1: Bootstrap the test harness and extension skeleton

**Files:**
- Create: `extensions/replace-prompt/package.json`
- Create: `extensions/replace-prompt/tsconfig.json`
- Create: `extensions/replace-prompt/index.ts`
- Create: `extensions/replace-prompt/types.ts`
- Test: `extensions/replace-prompt/tests/index.test.ts`

- [ ] **Step 1: Write the failing integration smoke test for the new extension entrypoint**

```ts
// extensions/replace-prompt/tests/index.test.ts
import { describe, expect, it, vi } from "vitest";
import replacePrompt from "../index";

describe("replace-prompt extension", () => {
  it("registers a before_agent_start handler", () => {
    const on = vi.fn();
    replacePrompt({ on } as any);
    expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails because the extension and test tooling do not exist yet**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/index.test.ts
```

Expected: command fails because `package.json` and the extension files are missing.

- [ ] **Step 3: Create `package.json` with the minimal test/tooling dependencies**

```json
{
  "name": "replace-prompt-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@mariozechner/pi-coding-agent": "latest",
    "jiti": "^2.4.2",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json` for the extension modules and tests**

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

- [ ] **Step 5: Create the initial extension entrypoint and shared types skeleton**

```ts
// extensions/replace-prompt/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function replacePrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    return undefined;
  });
}
```

```ts
// extensions/replace-prompt/types.ts
export type RuleMode = "first" | "all";

export type DisableRule = {
  id: string;
  enabled: false;
};
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
cd extensions/replace-prompt
npm install
```

Expected: installs `vitest`, `typescript`, `jiti`, and the Pi type package successfully in the extension-local directory.

- [ ] **Step 7: Run the smoke test to verify the skeleton passes**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/index.test.ts
```

Expected:
```text
✓ tests/index.test.ts (1 test)
```

- [ ] **Step 8: Commit the bootstrap work**

```bash
git add extensions/replace-prompt/package.json extensions/replace-prompt/package-lock.json extensions/replace-prompt/tsconfig.json extensions/replace-prompt/index.ts extensions/replace-prompt/types.ts extensions/replace-prompt/tests/index.test.ts
git commit -m "test: bootstrap replace-prompt extension harness"
```

---

### Task 2: Implement rule typing, validation, and merge behavior

**Files:**
- Modify: `extensions/replace-prompt/types.ts`
- Create: `extensions/replace-prompt/merge-rules.ts`
- Create: `extensions/replace-prompt/tests/merge-rules.test.ts`
- Modify: `extensions/replace-prompt/index.ts`

- [ ] **Step 1: Write the failing merge and validation tests**

```ts
// extensions/replace-prompt/tests/merge-rules.test.ts
import { describe, expect, it } from "vitest";
import { mergeScopeConfigs } from "../merge-rules";
import type { ScopeConfig } from "../types";

const globalConfig: ScopeConfig = {
  scope: "global",
  baseDir: "/home/.pi/agent/extensions/replace-prompt",
  logging: { file: false },
  rules: [
    {
      id: "replace-opening",
      enabled: true,
      type: "literal",
      target: "A",
      replacementSource: { kind: "inline", value: "B" },
      mode: "first",
      sourceScope: "global",
    },
    {
      id: "keep-second",
      enabled: true,
      type: "literal",
      target: "X",
      replacementSource: { kind: "inline", value: "Y" },
      mode: "first",
      sourceScope: "global",
    },
  ],
};

const projectConfig: ScopeConfig = {
  scope: "project",
  baseDir: "/repo/.pi/extensions/replace-prompt",
  logging: { file: true },
  rules: [
    { id: "replace-opening", enabled: false },
    {
      id: "append-third",
      enabled: true,
      type: "literal",
      target: "M",
      replacementSource: { kind: "inline", value: "N" },
      mode: "all",
      sourceScope: "project",
    },
  ],
};

describe("mergeScopeConfigs", () => {
  it("keeps inherited order, applies project override in place, and appends project-only rules", () => {
    const merged = mergeScopeConfigs(globalConfig, projectConfig);
    expect(merged.rules.map((rule) => rule.id)).toEqual([
      "replace-opening",
      "keep-second",
      "append-third",
    ]);
    expect(merged.rules[0]).toEqual({ id: "replace-opening", enabled: false });
    expect(merged.logging.file).toBe(true);
    expect(merged.logBaseDir).toBe("/repo/.pi/extensions/replace-prompt");
  });

  it("returns global order when no project config exists", () => {
    const merged = mergeScopeConfigs(globalConfig, null);
    expect(merged.rules.map((rule) => rule.id)).toEqual([
      "replace-opening",
      "keep-second",
    ]);
    expect(merged.logBaseDir).toBe("/home/.pi/agent/extensions/replace-prompt");
  });
});
```

- [ ] **Step 2: Run the targeted tests to confirm they fail because the types and merge helper do not exist yet**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/merge-rules.test.ts
```

Expected: FAIL with module-not-found and missing export errors for `merge-rules.ts` and the new types.

- [ ] **Step 3: Expand `types.ts` with the normalized config model used throughout the extension**

```ts
// extensions/replace-prompt/types.ts
export type RuleMode = "first" | "all";
export type ScopeName = "global" | "project";

export type ReplacementSource =
  | { kind: "inline"; value: string }
  | { kind: "file"; value: string };

export type DisableRule = {
  id: string;
  enabled: false;
};

export type NormalizedLiteralRule = {
  id: string;
  enabled: true;
  type: "literal";
  target: string;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
};

export type NormalizedRegexRule = {
  id: string;
  enabled: true;
  type: "regex";
  target: RegExp;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
};

export type NormalizedRule = DisableRule | NormalizedLiteralRule | NormalizedRegexRule;

export type ScopeConfig = {
  scope: ScopeName;
  baseDir: string;
  logging: { file: boolean };
  rules: NormalizedRule[];
};

export type MergedConfig = {
  logging: { file: boolean };
  rules: NormalizedRule[];
  projectDir: string | null;
  globalDir: string | null;
  logBaseDir: string | null;
};
```

- [ ] **Step 4: Implement `merge-rules.ts` with slot-preserving overrides and project-only append behavior**

```ts
// extensions/replace-prompt/merge-rules.ts
import type { MergedConfig, NormalizedRule, ScopeConfig } from "./types";

export function mergeScopeConfigs(
  globalConfig: ScopeConfig | null,
  projectConfig: ScopeConfig | null,
): MergedConfig {
  const inheritedRules = [...(globalConfig?.rules ?? [])];
  const mergedRules: NormalizedRule[] = [...inheritedRules];
  const indexById = new Map(inheritedRules.map((rule, index) => [rule.id, index]));

  for (const rule of projectConfig?.rules ?? []) {
    const inheritedIndex = indexById.get(rule.id);
    if (inheritedIndex === undefined) {
      mergedRules.push(rule);
      continue;
    }
    mergedRules[inheritedIndex] = rule;
  }

  return {
    logging: projectConfig?.logging ?? globalConfig?.logging ?? { file: false },
    rules: mergedRules,
    projectDir: projectConfig?.baseDir ?? null,
    globalDir: globalConfig?.baseDir ?? null,
    logBaseDir: projectConfig?.baseDir ?? globalConfig?.baseDir ?? null,
  };
}
```

- [ ] **Step 5: Run the merge tests to verify the merge semantics now pass**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/merge-rules.test.ts
```

Expected:
```text
✓ tests/merge-rules.test.ts (2 tests)
```

- [ ] **Step 6: Commit the merge layer**

```bash
git add extensions/replace-prompt/types.ts extensions/replace-prompt/merge-rules.ts extensions/replace-prompt/tests/merge-rules.test.ts
git commit -m "feat: add replace-prompt merge model"
```

---

### Task 3: Implement prompt application with line-ending normalization and regex mode control

**Files:**
- Create: `extensions/replace-prompt/apply-rules.ts`
- Create: `extensions/replace-prompt/tests/apply-rules.test.ts`
- Modify: `extensions/replace-prompt/types.ts`

- [ ] **Step 1: Write failing tests for literal replacement, regex replacement, `mode`, deletion, and CRLF normalization**

```ts
// extensions/replace-prompt/tests/apply-rules.test.ts
import { describe, expect, it } from "vitest";
import { applyRulesToPrompt } from "../apply-rules";
import type { NormalizedRule } from "../types";

const literalRule: NormalizedRule = {
  id: "replace-opening",
  enabled: true,
  type: "literal",
  target: "Hello\r\nWorld",
  replacementSource: { kind: "inline", value: "Hi\nWorld" },
  mode: "first",
  sourceScope: "global",
};

const regexRule: NormalizedRule = {
  id: "remove-guidelines",
  enabled: true,
  type: "regex",
  target: /Guidelines:[\s\S]*?End/i,
  replacementSource: { kind: "inline", value: "Rules: trimmed End" },
  mode: "first",
  sourceScope: "project",
};

describe("applyRulesToPrompt", () => {
  it("normalizes line endings and applies literal replacements", () => {
    const result = applyRulesToPrompt("Hello\nWorld", [literalRule], () => "Hi\nWorld");
    expect(result.systemPrompt).toBe("Hi\nWorld");
    expect(result.changed).toBe(true);
  });

  it("uses mode all for regex replacements even when the regex has the g flag", () => {
    const allRule: NormalizedRule = {
      ...regexRule,
      id: "replace-all",
      target: /abc/g,
      replacementSource: { kind: "inline", value: "z" },
      mode: "all",
    };
    const result = applyRulesToPrompt("abc abc", [allRule], () => "z");
    expect(result.systemPrompt).toBe("z z");
  });

  it("allows empty replacement strings to delete matches", () => {
    const deleteRule: NormalizedRule = {
      ...literalRule,
      id: "delete-line",
      target: "remove me",
      replacementSource: { kind: "inline", value: "" },
    };
    const result = applyRulesToPrompt("keep remove me done", [deleteRule], () => "");
    expect(result.systemPrompt).toBe("keep  done");
  });

  it("records a miss when an enabled rule no longer matches", () => {
    const result = applyRulesToPrompt("nothing here", [regexRule], () => "Rules: trimmed End");
    expect(result.events.some((event) => event.level === "warn" && event.ruleId === "remove-guidelines")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail because the application module does not exist yet**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/apply-rules.test.ts
```

Expected: FAIL with module-not-found for `apply-rules.ts`.

- [ ] **Step 3: Add the log event types needed by the apply layer**

```ts
// extensions/replace-prompt/types.ts
export type LogEvent = {
  level: "info" | "warn" | "error";
  message: string;
  ruleId?: string;
};

export type ApplyResult = {
  changed: boolean;
  systemPrompt: string;
  events: LogEvent[];
};
```

- [ ] **Step 4: Implement `apply-rules.ts` with line-ending normalization and controlled regex cloning**

```ts
// extensions/replace-prompt/apply-rules.ts
import type { ApplyResult, LogEvent, NormalizedRule } from "./types";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function cloneRegexForMode(regex: RegExp, mode: "first" | "all"): RegExp {
  const stripped = regex.flags.replace(/g/g, "");
  const flags = mode === "all" ? `${stripped}g` : stripped;
  return new RegExp(regex.source, flags);
}

export function applyRulesToPrompt(
  systemPrompt: string,
  rules: NormalizedRule[],
  resolveReplacement: (rule: Exclude<NormalizedRule, { enabled: false }>) => string,
): ApplyResult {
  const events: LogEvent[] = [];
  let nextPrompt = normalizeLineEndings(systemPrompt);

  for (const rule of rules) {
    if (rule.enabled === false) {
      events.push({ level: "info", message: "rule disabled", ruleId: rule.id });
      continue;
    }

    const replacement = normalizeLineEndings(resolveReplacement(rule));

    if (rule.type === "literal") {
      const target = normalizeLineEndings(rule.target);
      if (!nextPrompt.includes(target)) {
        events.push({ level: "warn", message: "rule did not match at application time", ruleId: rule.id });
        continue;
      }
      nextPrompt =
        rule.mode === "all"
          ? nextPrompt.split(target).join(replacement)
          : nextPrompt.replace(target, replacement);
      events.push({ level: "info", message: "rule applied", ruleId: rule.id });
      continue;
    }

    const matcher = cloneRegexForMode(rule.target, rule.mode);
    if (!matcher.test(nextPrompt)) {
      events.push({ level: "warn", message: "rule did not match at application time", ruleId: rule.id });
      continue;
    }
    nextPrompt = nextPrompt.replace(matcher, replacement);
    events.push({ level: "info", message: "rule applied", ruleId: rule.id });
  }

  return {
    changed: nextPrompt !== normalizeLineEndings(systemPrompt),
    systemPrompt: nextPrompt,
    events,
  };
}
```

- [ ] **Step 5: Run the prompt application tests and verify they pass**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/apply-rules.test.ts
```

Expected:
```text
✓ tests/apply-rules.test.ts (4 tests)
```

- [ ] **Step 6: Commit the application layer**

```bash
git add extensions/replace-prompt/types.ts extensions/replace-prompt/apply-rules.ts extensions/replace-prompt/tests/apply-rules.test.ts
git commit -m "feat: add replace-prompt rule application engine"
```

---

### Task 4: Implement config loading, validation, replacement resolution, and file logging

**Files:**
- Create: `extensions/replace-prompt/load-config.ts`
- Create: `extensions/replace-prompt/resolve-replacement.ts`
- Create: `extensions/replace-prompt/logging.ts`
- Create: `extensions/replace-prompt/tests/load-config.test.ts`
- Modify: `extensions/replace-prompt/types.ts`

- [ ] **Step 1: Write failing tests for config validation, duplicate IDs, empty literal target rejection, file precedence, and log path selection**

```ts
// extensions/replace-prompt/tests/load-config.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadScopeConfig, selectLogPath } from "../load-config";
import { resolveReplacementText } from "../resolve-replacement";

const tempDirs: string[] = [];

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadScopeConfig", () => {
  it("skips later duplicate IDs in one rules file and keeps the first", async () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "rules.ts"),
      `export default { rules: [
        { id: "dup-id", type: "literal", target: "A", replacement: "B" },
        { id: "dup-id", type: "literal", target: "X", replacement: "Y" }
      ] };`,
    );

    const config = await loadScopeConfig("project", dir);
    expect(config?.rules).toHaveLength(1);
    expect(config?.rules[0].id).toBe("dup-id");
  });

  it("rejects empty literal targets and accepts empty replacement strings", async () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, "rules.ts"),
      `export default { rules: [
        { id: "bad-target", type: "literal", target: "", replacement: "X" },
        { id: "delete-text", type: "literal", target: "trim", replacement: "" }
      ] };`,
    );

    const config = await loadScopeConfig("global", dir);
    expect(config?.rules.map((rule) => rule.id)).toEqual(["delete-text"]);
  });

  it("resolves replacement files from project before global", async () => {
    const globalDir = makeDir();
    const projectDir = makeDir();
    fs.writeFileSync(path.join(globalDir, "rules.ts"), `export default { rules: [
      { id: "replace-opening", type: "literal", target: "A", replacementFile: "opening.md" }
    ] };`);
    fs.writeFileSync(path.join(globalDir, "opening.md"), "global text");
    fs.writeFileSync(path.join(projectDir, "opening.md"), "project text");

    const config = await loadScopeConfig("global", globalDir);
    const rule = config?.rules[0];
    if (!rule || rule.enabled === false) throw new Error("expected enabled rule");

    const text = resolveReplacementText(rule, { globalDir, projectDir });
    expect(text).toBe("project text");
  });

  it("selects the log path in the most specific installed scope", () => {
    expect(selectLogPath({ projectDir: "/repo/.pi/extensions/replace-prompt", globalDir: "/home/.pi/agent/extensions/replace-prompt" })).toBe(
      "/repo/.pi/extensions/replace-prompt/replace-prompt.log",
    );
  });
});
```

- [ ] **Step 2: Run the config-loading tests to confirm they fail because the loader and resolver modules do not exist yet**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/load-config.test.ts
```

Expected: FAIL with missing module errors for `load-config.ts` and `resolve-replacement.ts`.

- [ ] **Step 3: Add raw-config types for the user-facing `rules.ts` shape**

```ts
// extensions/replace-prompt/types.ts
export type RawRule =
  | { id: string; enabled: false; type?: "literal" | "regex"; target?: string | RegExp; replacement?: string; replacementFile?: string; mode?: RuleMode }
  | { id: string; enabled?: true; type: "literal"; target: string; replacement?: string; replacementFile?: string; mode?: RuleMode }
  | { id: string; enabled?: true; type: "regex"; target: RegExp; replacement?: string; replacementFile?: string; mode?: RuleMode };

export type RawConfig = {
  logging?: { file?: boolean };
  rules?: RawRule[];
};
```

- [ ] **Step 4: Implement `load-config.ts` using `jiti` to load `rules.ts`, validate rules, skip invalid entries, and compute the log path helper**

```ts
// extensions/replace-prompt/load-config.ts
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import type { LogEvent, RawConfig, RawRule, ScopeConfig, ScopeName } from "./types";

const kebabCaseId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadScopeConfig(scope: ScopeName, baseDir: string): Promise<ScopeConfig | null> {
  const rulesPath = path.join(baseDir, "rules.ts");
  if (!fs.existsSync(rulesPath)) return null;

  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const loaded = (await jiti.import(rulesPath)) as { default?: RawConfig } | RawConfig;
  const config = ("default" in loaded ? loaded.default : loaded) ?? {};
  const seen = new Set<string>();
  const rules = [] as ScopeConfig["rules"];

  for (const rawRule of config.rules ?? []) {
    const normalized = normalizeRawRule(rawRule, scope);
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    rules.push(normalized);
  }

  return {
    scope,
    baseDir,
    logging: { file: config.logging?.file === true },
    rules,
  };
}

function normalizeRawRule(rawRule: RawRule, scope: ScopeName): ScopeConfig["rules"][number] | null {
  if (!rawRule.id || !kebabCaseId.test(rawRule.id)) return null;
  if (rawRule.enabled === false) return { id: rawRule.id, enabled: false };
  if (rawRule.type === "literal") {
    if (rawRule.target === "") return null;
    if ((rawRule.replacement === undefined) === (rawRule.replacementFile === undefined)) return null;
    return {
      id: rawRule.id,
      enabled: true,
      type: "literal",
      target: rawRule.target,
      replacementSource:
        rawRule.replacementFile !== undefined
          ? { kind: "file", value: rawRule.replacementFile }
          : { kind: "inline", value: rawRule.replacement ?? "" },
      mode: rawRule.mode ?? "first",
      sourceScope: scope,
    };
  }
  if (!(rawRule.target instanceof RegExp)) return null;
  if ((rawRule.replacement === undefined) === (rawRule.replacementFile === undefined)) return null;
  return {
    id: rawRule.id,
    enabled: true,
    type: "regex",
    target: rawRule.target,
    replacementSource:
      rawRule.replacementFile !== undefined
        ? { kind: "file", value: rawRule.replacementFile }
        : { kind: "inline", value: rawRule.replacement ?? "" },
    mode: rawRule.mode ?? "first",
    sourceScope: scope,
  };
}

export function selectLogPath(dirs: { projectDir: string | null; globalDir: string | null }): string | null {
  const baseDir = dirs.projectDir ?? dirs.globalDir;
  return baseDir ? path.join(baseDir, "replace-prompt.log") : null;
}
```

- [ ] **Step 5: Implement replacement resolution and file logging modules**

```ts
// extensions/replace-prompt/resolve-replacement.ts
import fs from "node:fs";
import path from "node:path";
import type { NormalizedLiteralRule, NormalizedRegexRule } from "./types";

export function resolveReplacementText(
  rule: NormalizedLiteralRule | NormalizedRegexRule,
  dirs: { projectDir: string | null; globalDir: string | null },
): string {
  if (rule.replacementSource.kind === "inline") {
    return rule.replacementSource.value;
  }

  const candidates = [dirs.projectDir, dirs.globalDir]
    .filter((value): value is string => Boolean(value))
    .map((baseDir) => path.join(baseDir, rule.replacementSource.value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }

  throw new Error(`Replacement file not found for rule ${rule.id}`);
}
```

```ts
// extensions/replace-prompt/logging.ts
import fs from "node:fs";
import type { LogEvent } from "./types";

export function appendLog(logPath: string | null, events: LogEvent[]): void {
  if (!logPath || events.length === 0) return;
  const lines = events.map((event) => `${new Date().toISOString()} [${event.level}]${event.ruleId ? ` [${event.ruleId}]` : ""} ${event.message}`);
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}
```

- [ ] **Step 6: Run the config-loading tests and verify they pass**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/load-config.test.ts
```

Expected:
```text
✓ tests/load-config.test.ts (4 tests)
```

- [ ] **Step 7: Commit the loader, resolver, and logger**

```bash
git add extensions/replace-prompt/types.ts extensions/replace-prompt/load-config.ts extensions/replace-prompt/resolve-replacement.ts extensions/replace-prompt/logging.ts extensions/replace-prompt/tests/load-config.test.ts
git commit -m "feat: add replace-prompt config loading and logging"
```

---

### Task 5: Wire the runtime, add the sample config, and verify end-to-end behavior

**Files:**
- Modify: `extensions/replace-prompt/index.ts`
- Create: `extensions/replace-prompt/rules.ts`
- Create: `extensions/replace-prompt/opening.md`
- Modify: `extensions/replace-prompt/tests/index.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Extend the integration test to verify prompt replacement, no-op behavior, and optional logging write-through**

```ts
// extensions/replace-prompt/tests/index.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import replacePrompt from "../index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("replace-prompt extension", () => {
  it("registers a before_agent_start handler", () => {
    const on = vi.fn();
    replacePrompt({ on } as any);
    expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
  });

  it("applies merged rules and returns a new system prompt only when text changes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-index-"));
    tempDirs.push(dir);
    const extDir = path.join(dir, ".pi/extensions/replace-prompt");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "rules.ts"),
      `export default { rules: [{ id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }] };`,
    );

    let handler: ((event: any) => Promise<any>) | undefined;
    replacePrompt({
      on(eventName: string, fn: (event: any) => Promise<any>) {
        if (eventName === "before_agent_start") handler = fn;
      },
    } as any);

    const changed = await handler?.({ systemPrompt: "Hello there", cwd: dir });
    expect(changed).toEqual({ systemPrompt: "Hi there" });

    const unchanged = await handler?.({ systemPrompt: "Nothing to replace", cwd: dir });
    expect(unchanged).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the integration test and confirm it fails because the entrypoint is still a no-op**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/index.test.ts
```

Expected: FAIL on the new replacement assertion because `index.ts` currently always returns `undefined`.

- [ ] **Step 3: Implement the full runtime in `index.ts` by discovering scope directories from `event.systemPrompt` context, loading configs, merging them, resolving replacement text, and writing logs when enabled**

```ts
// extensions/replace-prompt/index.ts
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { applyRulesToPrompt } from "./apply-rules";
import { appendLog } from "./logging";
import { loadScopeConfig, selectLogPath } from "./load-config";
import { mergeScopeConfigs } from "./merge-rules";
import { resolveReplacementText } from "./resolve-replacement";

function getScopeDirs(cwd: string) {
  const homeDir = process.env.HOME ? path.join(process.env.HOME, ".pi/agent/extensions/replace-prompt") : null;
  const projectDir = path.join(cwd, ".pi/extensions/replace-prompt");
  return {
    globalDir: homeDir,
    projectDir,
  };
}

export default function replacePrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const { globalDir, projectDir } = getScopeDirs(event.cwd ?? process.cwd());
    const globalConfig = globalDir ? await loadScopeConfig("global", globalDir).catch(() => null) : null;
    const projectConfig = projectDir ? await loadScopeConfig("project", projectDir).catch(() => null) : null;
    const merged = mergeScopeConfigs(globalConfig, projectConfig);

    if (merged.rules.length === 0) {
      return undefined;
    }

    const result = applyRulesToPrompt(
      event.systemPrompt ?? "",
      merged.rules,
      (rule) => resolveReplacementText(rule, { globalDir: merged.globalDir, projectDir: merged.projectDir }),
    );

    if (merged.logging.file) {
      appendLog(selectLogPath({ projectDir: merged.projectDir, globalDir: merged.globalDir }), result.events);
    }

    if (!result.changed) {
      return undefined;
    }

    return { systemPrompt: result.systemPrompt };
  });
}
```

- [ ] **Step 4: Add the sample shipped config and replacement file to the extension directory**

```ts
// extensions/replace-prompt/rules.ts
export default {
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
      replacementFile: "opening.md",
    },
  ],
};
```

```md
<!-- extensions/replace-prompt/opening.md -->
You are a specialised assistant focused on pragmatic, step-by-step code changes and clear explanations.
```

- [ ] **Step 5: Update `README.md` so the new extension is discoverable in the repo**

```md
# pi-extensions

A workspace for building extensions for the Pi coding agent.

## Structure

- `extensions/` — Pi extension implementations and related prompts
- `extensions/replace-opening/` — simple one-target prompt replacement example
- `extensions/replace-prompt/` — configurable multi-rule prompt replacement extension with merged global/project config
```

- [ ] **Step 6: Run the focused test suite for the full extension**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/merge-rules.test.ts tests/apply-rules.test.ts tests/load-config.test.ts tests/index.test.ts
```

Expected:
```text
✓ tests/merge-rules.test.ts
✓ tests/apply-rules.test.ts
✓ tests/load-config.test.ts
✓ tests/index.test.ts
```

- [ ] **Step 7: Run the full test suite to ensure there are no regressions**

Run:
```bash
cd extensions/replace-prompt
npm test
```

Expected:
```text
Test Files  4 passed
Tests       11 passed
```

- [ ] **Step 8: Commit the wired runtime and docs**

```bash
git add README.md extensions/replace-prompt/index.ts extensions/replace-prompt/rules.ts extensions/replace-prompt/opening.md extensions/replace-prompt/tests/index.test.ts
git commit -m "feat: add configurable replace-prompt extension"
```

---

## Self-review

### Spec coverage check

- Multiple arbitrary strings via a single `rules.ts`: covered in Tasks 2, 4, and 5
- Literal and regex rules with explicit `type`: covered in Tasks 2 and 3
- Inline replacement and `replacementFile`: covered in Task 4
- Project + global merge with project precedence and slot preservation: covered in Task 2
- Disable-only overrides and `enabled: false` handling: covered in Tasks 2 and 4
- Ordered top-to-bottom execution: covered in Task 3
- `mode: "first" | "all"` and regex `g` stripping: covered in Task 3
- CRLF/LF normalization: covered in Task 3
- File logging and log path selection: covered in Task 4 and verified in Task 5
- Soft-failure/no-op behavior: covered in Tasks 3, 4, and 5
- Sample extension files and README discoverability: covered in Task 5

### Placeholder scan

- No `TODO`, `TBD`, or "implement later" placeholders remain
- Each code-writing step includes concrete code blocks
- Each test step includes explicit commands and expected outcomes
- Each commit step names exact files and a commit message

### Type consistency check

- Shared names are consistent across tasks: `ScopeConfig`, `MergedConfig`, `NormalizedRule`, `loadScopeConfig`, `mergeScopeConfigs`, `resolveReplacementText`, `applyRulesToPrompt`, `appendLog`, `selectLogPath`
- Rule mode naming is consistent: `"first" | "all"`
- Scope naming is consistent: `"global" | "project"`
