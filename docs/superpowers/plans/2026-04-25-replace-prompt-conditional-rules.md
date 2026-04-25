# Replace Prompt Conditional Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronous conditional rule support to `extensions/replace-prompt`, including model-aware conditions, strict boolean evaluation, `originalSystemPrompt`, soft-failure logging, and updated authoring docs.

**Architecture:** Extend the existing replace-prompt pipeline rather than adding a parallel system. Validation and normalization stay in `load-config.ts`, ordered condition evaluation stays in `apply-rules.ts`, and `index.ts` remains the single runtime hook that gathers Pi metadata, invokes the rule engine, and writes all accumulated log events.

**Tech Stack:** TypeScript, Vitest, jiti, Node.js built-ins (`fs`, `path`, `os`), Pi Extension API

---

## File structure

### Existing files to modify

- `extensions/replace-prompt/types.ts` — add condition-related types, runtime context types, and internal event containers for normalization warnings
- `extensions/replace-prompt/load-config.ts` — validate `condition`, ignore it on disable-only rules, and capture load-time warning events for invalid condition values
- `extensions/replace-prompt/merge-rules.ts` — carry load-time warning events forward into the merged runtime config
- `extensions/replace-prompt/apply-rules.ts` — evaluate conditions in rule order with strict boolean semantics, `systemPrompt`, and `originalSystemPrompt`
- `extensions/replace-prompt/index.ts` — read model metadata from the `before_agent_start` context, pass stable runtime values into `applyRulesToPrompt`, and append both normalization and application events to the log
- `extensions/replace-prompt/tests/load-config.test.ts` — cover condition normalization, disable-only ignore semantics, and invalid-condition rejection
- `extensions/replace-prompt/tests/apply-rules.test.ts` — cover strict boolean evaluation, thrown conditions, current/original prompt semantics, and pipeline continuation
- `extensions/replace-prompt/tests/index.test.ts` — cover model-aware runtime wiring and load-time warning logging through the extension entrypoint
- `extensions/replace-prompt/docs/usage.md` — document the `condition` field, `ConditionContext`, strict boolean behavior, and model-specific examples

### No new files required

The feature fits cleanly into the existing replace-prompt module layout. Keep the implementation focused and avoid adding helper modules unless an existing file becomes unreasonably large during implementation.

---

### Task 1: Extend rule normalization and internal types for conditional rules

**Files:**
- Modify: `extensions/replace-prompt/types.ts`
- Modify: `extensions/replace-prompt/load-config.ts`
- Modify: `extensions/replace-prompt/merge-rules.ts`
- Test: `extensions/replace-prompt/tests/load-config.test.ts`

- [ ] **Step 1: Write the failing normalization tests for valid, invalid, and disable-only conditions**

```ts
// extensions/replace-prompt/tests/load-config.test.ts
it("accepts function conditions, ignores condition on disable-only rules, and rejects non-function conditions", async () => {
  const dir = makeDir();
  fs.writeFileSync(
    path.join(dir, "rules.ts"),
    `export default { logging: { file: true }, rules: [
      {
        id: "claude-only",
        type: "literal",
        target: "Hello",
        replacement: "Hi",
        condition: (ctx) => ctx.model?.includes("claude") ?? false
      },
      {
        id: "disable-me",
        enabled: false,
        condition: "ignored"
      },
      {
        id: "bad-condition",
        type: "literal",
        target: "Nope",
        replacement: "Still nope",
        condition: "claude"
      }
    ] };`,
  );

  const config = await loadScopeConfig("project", dir);
  expect(config?.rules.map((rule) => rule.id)).toEqual(["claude-only", "disable-me"]);

  const conditionalRule = config?.rules[0];
  if (!conditionalRule || conditionalRule.enabled === false) throw new Error("expected enabled rule");
  expect(typeof conditionalRule.condition).toBe("function");

  expect(config?.rules[1]).toEqual({ id: "disable-me", enabled: false });
  expect(config?.events).toContainEqual({
    level: "warn",
    message: "invalid condition; expected function",
    ruleId: "bad-condition",
  });
});
```

- [ ] **Step 2: Run the targeted test to verify the current code fails**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/load-config.test.ts
```

Expected: FAIL with TypeScript/runtime errors because `condition` is not part of the normalized rule types and `loadScopeConfig()` does not yet return `events`.

- [ ] **Step 3: Add condition and runtime context types to `types.ts`**

```ts
// extensions/replace-prompt/types.ts
export type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  originalSystemPrompt: string;
  env: NodeJS.ProcessEnv;
};

export type RuleCondition = (ctx: ConditionContext) => boolean;

export type ApplyRuntimeContext = {
  model?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type NormalizedLiteralRule = {
  id: string;
  enabled: true;
  type: "literal";
  target: string;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
  condition?: RuleCondition;
};

export type NormalizedRegexRule = {
  id: string;
  enabled: true;
  type: "regex";
  target: RegExp;
  replacementSource: ReplacementSource;
  mode: RuleMode;
  sourceScope: ScopeName;
  condition?: RuleCondition;
};

export type ScopeConfig = {
  scope: ScopeName;
  baseDir: string;
  logging: { file?: boolean };
  rules: NormalizedRule[];
  events: LogEvent[];
};

export type MergedConfig = {
  logging: { file: boolean };
  rules: NormalizedRule[];
  events: LogEvent[];
  projectDir: string | null;
  globalDir: string | null;
  logBaseDir: string | null;
};

export type RawRule =
  | {
      id: string;
      enabled: false;
      type?: "literal" | "regex";
      target?: string | RegExp;
      replacement?: string;
      replacementFile?: string;
      mode?: RuleMode;
      condition?: unknown;
    }
  | {
      id: string;
      enabled?: true;
      type: "literal";
      target: string;
      replacement?: string;
      replacementFile?: string;
      mode?: RuleMode;
      condition?: unknown;
    }
  | {
      id: string;
      enabled?: true;
      type: "regex";
      target: RegExp;
      replacement?: string;
      replacementFile?: string;
      mode?: RuleMode;
      condition?: unknown;
    };
```

- [ ] **Step 4: Normalize `condition` in `load-config.ts` and carry load-time warnings through `merge-rules.ts`**

```ts
// extensions/replace-prompt/load-config.ts
export async function loadScopeConfig(scope: ScopeName, baseDir: string): Promise<ScopeConfig | null> {
  const rulesPath = path.join(baseDir, "rules.ts");
  if (!fs.existsSync(rulesPath)) {
    return null;
  }

  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const loaded = (await jiti.import(rulesPath)) as { default?: RawConfig } | RawConfig;
  const config = getRawConfig(loaded);
  const seen = new Set<string>();
  const rules: ScopeConfig["rules"] = [];
  const events: LogEvent[] = [];

  for (const rawRule of config.rules ?? []) {
    const { rule, event } = normalizeRawRule(rawRule, scope);
    if (event) {
      events.push(event);
    }
    if (!rule) {
      continue;
    }
    if (seen.has(rule.id)) {
      continue;
    }

    seen.add(rule.id);
    rules.push(rule);
  }

  return {
    scope,
    baseDir,
    logging: { file: config.logging?.file },
    rules,
    events,
  };
}

function normalizeRawRule(
  rawRule: RawRule,
  scope: ScopeName,
): { rule: ScopeConfig["rules"][number] | null; event?: LogEvent } {
  if (!rawRule || typeof rawRule !== "object") {
    return { rule: null };
  }

  if (typeof rawRule.id !== "string" || !kebabCaseId.test(rawRule.id)) {
    return { rule: null };
  }

  if (rawRule.enabled === false) {
    return { rule: { id: rawRule.id, enabled: false } };
  }

  if (rawRule.condition !== undefined && typeof rawRule.condition !== "function") {
    return {
      rule: null,
      event: {
        level: "warn",
        message: "invalid condition; expected function",
        ruleId: rawRule.id,
      },
    };
  }

  const mode = rawRule.mode ?? "first";
  if (mode !== "first" && mode !== "all") {
    return { rule: null };
  }

  const hasInlineReplacement = rawRule.replacement !== undefined;
  const hasFileReplacement = rawRule.replacementFile !== undefined;
  if (hasInlineReplacement === hasFileReplacement) {
    return { rule: null };
  }

  if (rawRule.type === "literal") {
    if (typeof rawRule.target !== "string" || rawRule.target === "") {
      return { rule: null };
    }

    const replacementSource = hasFileReplacement
      ? { kind: "file" as const, value: rawRule.replacementFile! }
      : { kind: "inline" as const, value: rawRule.replacement ?? "" };

    return {
      rule: {
        id: rawRule.id,
        enabled: true,
        type: "literal",
        target: rawRule.target,
        replacementSource,
        mode,
        sourceScope: scope,
        condition: rawRule.condition as RuleCondition | undefined,
      },
    };
  }

  if (rawRule.type === "regex") {
    if (!(rawRule.target instanceof RegExp)) {
      return { rule: null };
    }

    const replacementSource = hasFileReplacement
      ? { kind: "file" as const, value: rawRule.replacementFile! }
      : { kind: "inline" as const, value: rawRule.replacement ?? "" };

    return {
      rule: {
        id: rawRule.id,
        enabled: true,
        type: "regex",
        target: rawRule.target,
        replacementSource,
        mode,
        sourceScope: scope,
        condition: rawRule.condition as RuleCondition | undefined,
      },
    };
  }

  return { rule: null };
}
```

```ts
// extensions/replace-prompt/merge-rules.ts
return {
  logging: {
    file: projectConfig?.logging.file ?? globalConfig?.logging.file ?? false,
  },
  rules: mergedRules,
  events: [...(globalConfig?.events ?? []), ...(projectConfig?.events ?? [])],
  projectDir: installedDirs.projectDir,
  globalDir: installedDirs.globalDir,
  logBaseDir: installedDirs.projectDir ?? installedDirs.globalDir,
};
```

- [ ] **Step 5: Run the normalization test again to verify the new behavior passes**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/load-config.test.ts
```

Expected:
```text
✓ tests/load-config.test.ts
```

- [ ] **Step 6: Commit the normalization and typing work**

```bash
git add extensions/replace-prompt/types.ts extensions/replace-prompt/load-config.ts extensions/replace-prompt/merge-rules.ts extensions/replace-prompt/tests/load-config.test.ts
git commit -m "feat: normalize replace-prompt conditions"
```

---

### Task 2: Implement ordered condition evaluation in `apply-rules.ts`

**Files:**
- Modify: `extensions/replace-prompt/apply-rules.ts`
- Test: `extensions/replace-prompt/tests/apply-rules.test.ts`

- [ ] **Step 1: Write the failing runtime tests for strict boolean conditions and prompt-state semantics**

```ts
// extensions/replace-prompt/tests/apply-rules.test.ts
const runtime = {
  cwd: "/repo",
  model: "claude-3-7-sonnet",
  env: {} as NodeJS.ProcessEnv,
};

it("skips rules whose condition returns false", () => {
  const rule: NormalizedRule = {
    ...literalRule,
    id: "condition-false",
    target: "Hello",
    replacementSource: { kind: "inline", value: "Hi" },
    condition: () => false,
  };

  const result = applyRulesToPrompt("Hello World", [rule], () => "Hi", runtime);
  expect(result.systemPrompt).toBe("Hello World");
  expect(result.events).toContainEqual({
    level: "info",
    message: "rule skipped by condition",
    ruleId: "condition-false",
  });
});

it("skips truthy non-boolean condition results with a warning", () => {
  const rule: NormalizedRule = {
    ...literalRule,
    id: "condition-non-boolean",
    target: "Hello",
    replacementSource: { kind: "inline", value: "Hi" },
    condition: (() => "claude") as any,
  };

  const result = applyRulesToPrompt("Hello World", [rule], () => "Hi", runtime);
  expect(result.systemPrompt).toBe("Hello World");
  expect(result.events).toContainEqual({
    level: "warn",
    message: "condition returned non-boolean",
    ruleId: "condition-non-boolean",
  });
});

it("continues the pipeline after a condition throws", () => {
  const rules: NormalizedRule[] = [
    {
      ...literalRule,
      id: "condition-throws",
      target: "Hello",
      replacementSource: { kind: "inline", value: "Hi" },
      condition: () => {
        throw new Error("boom");
      },
    },
    {
      ...literalRule,
      id: "second-rule-still-runs",
      target: "World",
      replacementSource: { kind: "inline", value: "Pi" },
    },
  ];

  const result = applyRulesToPrompt(
    "Hello World",
    rules,
    (rule) => (rule.replacementSource.kind === "inline" ? rule.replacementSource.value : null),
    runtime,
  );

  expect(result.systemPrompt).toBe("Hello Pi");
  expect(result.events).toContainEqual({
    level: "warn",
    message: "condition threw",
    ruleId: "condition-throws",
  });
  expect(result.events).toContainEqual({
    level: "info",
    message: "rule applied",
    ruleId: "second-rule-still-runs",
  });
});

it("exposes current and original prompt states to later rules", () => {
  const rules: NormalizedRule[] = [
    {
      ...literalRule,
      id: "add-claude-marker",
      target: "Hello",
      replacementSource: { kind: "inline", value: "[CLAUDE]\nHello" },
      condition: (ctx) => ctx.model?.includes("claude") ?? false,
    },
    {
      ...literalRule,
      id: "expand-claude-guidance",
      target: "Hello",
      replacementSource: { kind: "inline", value: "Hello with Claude-specific guidance" },
      condition: (ctx) => ctx.systemPrompt.includes("[CLAUDE]"),
    },
    {
      ...literalRule,
      id: "note-original-greeting",
      target: "[CLAUDE]",
      replacementSource: { kind: "inline", value: "[CLAUDE-ORIGINAL-HELLO]" },
      condition: (ctx) => ctx.originalSystemPrompt.startsWith("Hello"),
    },
  ];

  const result = applyRulesToPrompt(
    "Hello there",
    rules,
    (rule) => (rule.replacementSource.kind === "inline" ? rule.replacementSource.value : null),
    runtime,
  );

  expect(result.systemPrompt).toBe("[CLAUDE-ORIGINAL-HELLO]\nHello with Claude-specific guidance there");
});
```

- [ ] **Step 2: Run the targeted rule-engine tests to verify they fail against the current signature**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/apply-rules.test.ts
```

Expected: FAIL because `applyRulesToPrompt()` does not yet accept runtime context or evaluate `condition`.

- [ ] **Step 3: Implement strict boolean condition handling in `apply-rules.ts`**

```ts
// extensions/replace-prompt/apply-rules.ts
import type { ApplyResult, ApplyRuntimeContext, ConditionContext, LogEvent, NormalizedRule } from "./types";

export function applyRulesToPrompt(
  systemPrompt: string,
  rules: NormalizedRule[],
  resolveReplacement: (rule: Exclude<NormalizedRule, { enabled: false }>) => string | null,
  runtime: ApplyRuntimeContext,
): ApplyResult {
  const events: LogEvent[] = [];
  const normalizedOriginal = normalizeLineEndings(systemPrompt);
  let nextPrompt = normalizedOriginal;

  for (const rule of rules) {
    if (rule.enabled === false) {
      events.push({ level: "info", message: "rule disabled", ruleId: rule.id });
      continue;
    }

    if (rule.condition) {
      const conditionContext: ConditionContext = {
        model: runtime.model,
        cwd: runtime.cwd,
        systemPrompt: nextPrompt,
        originalSystemPrompt: normalizedOriginal,
        env: runtime.env,
      };

      let conditionResult: unknown;
      try {
        conditionResult = rule.condition(conditionContext);
      } catch {
        events.push({ level: "warn", message: "condition threw", ruleId: rule.id });
        continue;
      }

      if (typeof conditionResult !== "boolean") {
        events.push({ level: "warn", message: "condition returned non-boolean", ruleId: rule.id });
        continue;
      }

      if (conditionResult === false) {
        events.push({ level: "info", message: "rule skipped by condition", ruleId: rule.id });
        continue;
      }
    }

    const resolvedReplacement = resolveReplacement(rule);
    if (resolvedReplacement === null) {
      events.push({ level: "warn", message: "replacement file not found", ruleId: rule.id });
      continue;
    }

    const replacement = normalizeLineEndings(resolvedReplacement);

    if (rule.type === "literal") {
      const target = normalizeLineEndings(rule.target);
      if (!nextPrompt.includes(target)) {
        events.push({ level: "warn", message: "rule did not match at application time", ruleId: rule.id });
        continue;
      }

      nextPrompt =
        rule.mode === "all"
          ? nextPrompt.split(target).join(replacement)
          : nextPrompt.replace(target, () => replacement);
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
    changed: nextPrompt !== normalizedOriginal,
    systemPrompt: nextPrompt,
    events,
  };
}
```

- [ ] **Step 4: Run the rule-engine tests again and confirm the condition behavior passes**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/apply-rules.test.ts
```

Expected:
```text
✓ tests/apply-rules.test.ts
```

- [ ] **Step 5: Commit the rule-engine changes**

```bash
git add extensions/replace-prompt/apply-rules.ts extensions/replace-prompt/tests/apply-rules.test.ts
git commit -m "feat: evaluate replace-prompt rule conditions"
```

---

### Task 3: Wire Pi metadata and config warning events through the entrypoint

**Files:**
- Modify: `extensions/replace-prompt/index.ts`
- Test: `extensions/replace-prompt/tests/index.test.ts`

- [ ] **Step 1: Write the failing integration tests for model-aware rules and load-time warning logging**

```ts
// extensions/replace-prompt/tests/index.test.ts
it("passes model metadata into condition evaluation and logs condition skips", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
  tempDirs.push(projectRoot, homeDir);
  process.env.HOME = homeDir;

  const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
  fs.mkdirSync(globalExtDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalExtDir, "rules.ts"),
    `export default { logging: { file: true }, rules: [
      {
        id: "claude-only",
        type: "literal",
        target: "Hello",
        replacement: "Claude hi",
        condition: (ctx) => ctx.model?.includes("claude") ?? false
      }
    ] };`,
  );

  let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
  replacePrompt({
    on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
      if (eventName === "before_agent_start") {
        handler = fn;
      }
    },
  } as any);

  const changed = await handler?.(
    { systemPrompt: "Hello there", cwd: projectRoot },
    { model: { id: "claude-3-7-sonnet" } },
  );
  expect(changed).toEqual({ systemPrompt: "Claude hi there" });

  const skipped = await handler?.(
    { systemPrompt: "Hello there", cwd: projectRoot },
    { model: { id: "gpt-4o" } },
  );
  expect(skipped).toBeUndefined();

  const logText = fs.readFileSync(path.join(globalExtDir, "replace-prompt.log"), "utf8");
  expect(logText).toContain("[info] [claude-only] rule applied");
  expect(logText).toContain("[info] [claude-only] rule skipped by condition");
});

it("writes invalid-condition warnings collected during config loading", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
  tempDirs.push(projectRoot, homeDir);
  process.env.HOME = homeDir;

  const globalExtDir = path.join(homeDir, ".pi/agent/extensions/replace-prompt");
  fs.mkdirSync(globalExtDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalExtDir, "rules.ts"),
    `export default { logging: { file: true }, rules: [
      {
        id: "bad-condition",
        type: "literal",
        target: "Hello",
        replacement: "Hi",
        condition: "claude"
      }
    ] };`,
  );

  let handler: ((event: any, ctx?: any) => Promise<any>) | undefined;
  replacePrompt({
    on(eventName: string, fn: (event: any, ctx?: any) => Promise<any>) {
      if (eventName === "before_agent_start") {
        handler = fn;
      }
    },
  } as any);

  const result = await handler?.(
    { systemPrompt: "Hello there", cwd: projectRoot },
    { model: { id: "claude-3-7-sonnet" } },
  );
  expect(result).toBeUndefined();

  const logText = fs.readFileSync(path.join(globalExtDir, "replace-prompt.log"), "utf8");
  expect(logText).toContain("[warn] [bad-condition] invalid condition; expected function");
});
```

- [ ] **Step 2: Run the targeted integration tests to verify they fail before entrypoint wiring changes**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/index.test.ts
```

Expected: FAIL because `index.ts` does not read `ctx.model?.id`, does not pass runtime context into `applyRulesToPrompt()`, and returns early before writing load-time warning events when no valid rules remain.

- [ ] **Step 3: Update `index.ts` to pass runtime metadata and append all events**

```ts
// extensions/replace-prompt/index.ts
export default function replacePrompt(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    const cwd = event.cwd ?? process.cwd();
    const installedDirs = getScopeDirs(cwd);

    const globalConfig = installedDirs.globalDir
      ? await loadScopeConfig("global", installedDirs.globalDir).catch(() => null)
      : null;
    const projectConfig = installedDirs.projectDir
      ? await loadScopeConfig("project", installedDirs.projectDir).catch(() => null)
      : null;
    const merged = mergeScopeConfigs(globalConfig, projectConfig, installedDirs);

    const basePrompt = event.systemPrompt ?? "";
    const result =
      merged.rules.length === 0
        ? { changed: false, systemPrompt: basePrompt, events: [] }
        : applyRulesToPrompt(
            basePrompt,
            merged.rules,
            (rule) =>
              resolveReplacementText(rule, {
                globalDir: merged.globalDir,
                projectDir: merged.projectDir,
              }),
            {
              cwd,
              model: ctx.model?.id,
              env: process.env,
            },
          );

    const allEvents = [...merged.events, ...result.events];

    if (merged.logging.file) {
      appendLog(
        selectLogPath({
          projectDir: merged.projectDir,
          globalDir: merged.globalDir,
        }),
        allEvents,
      );
    }

    if (!result.changed) {
      return undefined;
    }

    return { systemPrompt: result.systemPrompt };
  });
}
```

- [ ] **Step 4: Run the integration tests again and confirm model-aware behavior works end-to-end**

Run:
```bash
cd extensions/replace-prompt
npm test -- tests/index.test.ts
```

Expected:
```text
✓ tests/index.test.ts
```

- [ ] **Step 5: Commit the entrypoint wiring changes**

```bash
git add extensions/replace-prompt/index.ts extensions/replace-prompt/tests/index.test.ts
git commit -m "feat: wire replace-prompt conditions to runtime metadata"
```

---

### Task 4: Update the usage guide and run the full replace-prompt test suite

**Files:**
- Modify: `extensions/replace-prompt/docs/usage.md`
- Verify: `extensions/replace-prompt/tests/load-config.test.ts`
- Verify: `extensions/replace-prompt/tests/apply-rules.test.ts`
- Verify: `extensions/replace-prompt/tests/index.test.ts`

- [ ] **Step 1: Document conditional rules, `ConditionContext`, and strict boolean behavior in `usage.md`**

````md
## Conditional rules

Enabled literal and regex rules may include a synchronous `condition` callback:

```ts
type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  originalSystemPrompt: string;
  env: NodeJS.ProcessEnv;
};
```

A rule runs only when `condition(ctx)` returns exactly `true`.

- `systemPrompt` is the current prompt state when the rule is evaluated
- `originalSystemPrompt` is the unmodified prompt from the start of `before_agent_start`
- `env` is provided for convenience; it does not expand the trust boundary because `rules.ts` already runs as full Node.js code

### Model-specific example

```ts
{
  id: "claude-only-opening",
  type: "literal",
  target: "Hello",
  replacement: "Hello Claude",
  condition: (ctx) => ctx.model?.includes("claude") ?? false,
}
```

The `?? false` matters because `ctx.model?.includes("claude")` evaluates to `boolean | undefined`, and conditions must return an explicit boolean.

### Current vs original prompt example

```ts
{
  id: "expand-claude-guidance",
  type: "literal",
  target: "Hello",
  replacement: "Hello with Claude-specific guidance",
  condition: (ctx) => ctx.systemPrompt.includes("[CLAUDE]"),
}

{
  id: "note-original-greeting",
  type: "literal",
  target: "[CLAUDE]",
  replacement: "[CLAUDE-ORIGINAL-HELLO]",
  condition: (ctx) => ctx.originalSystemPrompt.startsWith("Hello"),
}
```

### Condition result handling

- `true` → rule continues normally
- `false` → rule is skipped and logs `rule skipped by condition`
- non-boolean → rule is skipped and logs `condition returned non-boolean`
- throw → rule is skipped and logs `condition threw`

Conditions are intentionally synchronous and should stay limited to fast environment checks.
````

- [ ] **Step 2: Run the full replace-prompt test suite to verify the feature is complete**

Run:
```bash
cd extensions/replace-prompt
npm test
```

Expected: PASS across `tests/load-config.test.ts`, `tests/apply-rules.test.ts`, and `tests/index.test.ts`.

- [ ] **Step 3: Commit the documentation update**

```bash
git add extensions/replace-prompt/docs/usage.md
git commit -m "docs: add replace-prompt conditional rules guide"
```

---

## Self-review checklist

- Spec coverage: Task 1 covers `ConditionContext`, disable-only ignore semantics, invalid non-function handling, and warning accumulation. Task 2 covers strict boolean evaluation, thrown-condition continuation, `systemPrompt`, and `originalSystemPrompt`. Task 3 covers model sourcing from `ctx.model?.id` and end-to-end event logging. Task 4 covers the documentation updates and final verification.
- Placeholder scan: no `TBD`, `TODO`, or implied follow-up tasks remain.
- Type consistency: the plan uses `ConditionContext`, `RuleCondition`, `ApplyRuntimeContext`, `events`, `condition returned non-boolean`, and `invalid condition; expected function` consistently across code, tests, and docs.
