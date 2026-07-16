# Replace-prompt Provider Fallback Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve `replace-prompt`'s exact transformed system prompt across Pi automatic post-tool continuations so providers that support prompt caching can retain cache-prefix continuity.

**Architecture:** Keep rule application in `before_agent_start`, remember the exact source/result transformation with a model/cwd/environment identity, and learn the unique provider-payload path containing the result. On later provider requests, inspect only that learned path and replace the exact source with the exact result; all ambiguous or stale states fail open.

**Tech Stack:** TypeScript ES2022, Pi extension hooks, Node.js `crypto`, Vitest, npm workspaces.

**Design:** [`docs/superpowers/specs/2026-07-16-replace-prompt-provider-fallback-design.md`](../specs/2026-07-16-replace-prompt-provider-fallback-design.md)

## Global Constraints

- Modify only `packages/replace-prompt` plus this repository's documentation and tests; do not modify Pi, `pi-processes`, delegate tooling, or third-party packages.
- Keep the implementation provider agnostic: do not branch on provider names or encode provider payload field names.
- Treat the exact `before_agent_start` input as the fallback comparator and document the assumption that `replace-prompt` is the only effective system-prompt-mutating `before_agent_start` extension.
- Never re-run replacement rules from `before_provider_request`; arbitrary and non-idempotent rules must execute only once.
- Replace only the exact source string at a uniquely learned result path; never search arbitrary user/tool message bodies during repair.
- Isolate remembered results by provider, API family, model ID, cwd, and the complete supported environment condition context.
- Fail open when context, path, or value is uncertain.
- Do not log or persist prompt contents, payload contents, environment names, environment values, credentials, or provider headers.
- Do not add runtime dependencies; use Node.js built-ins and the existing workspace dependencies.
- Use TDD for every behavior change and commit after each independently reviewable task.

## File structure

- Create `packages/replace-prompt/payload-path.ts`: provider-agnostic exact-string path discovery, path lookup, and copy-on-write replacement.
- Create `packages/replace-prompt/transformation-context.ts`: stable model identity and environment fingerprinting.
- Create `packages/replace-prompt/fallback-restoration.ts`: in-memory transformation lifecycle, path learning, context checks, fail-open repair, and deduplicated diagnostic events.
- Modify `packages/replace-prompt/index.ts`: connect rule application to `session_start` and `before_provider_request` hooks.
- Modify `packages/replace-prompt/types.ts`: add shared immutable prompt-path and transformation-context types.
- Create `packages/replace-prompt/tests/payload-path.test.ts`: pure payload helper coverage.
- Create `packages/replace-prompt/tests/transformation-context.test.ts`: stable context identity coverage.
- Create `packages/replace-prompt/tests/fallback-restoration.test.ts`: pure restoration state-machine coverage.
- Create `packages/replace-prompt/tests/provider-fallback.test.ts`: Pi-hook integration and regression coverage.
- Modify `packages/replace-prompt/README.md`: concise feature, behavior, and ordering caveat.
- Modify `packages/replace-prompt/docs/usage.md`: detailed cache-continuity, path-discovery, conditional-context, and logging documentation.

---

### Task 1: Provider-agnostic payload path operations

**Files:**
- Create: `packages/replace-prompt/payload-path.ts`
- Create: `packages/replace-prompt/tests/payload-path.test.ts`
- Modify: `packages/replace-prompt/types.ts`

**Interfaces:**
- Consumes: JSON-like provider payloads typed as `unknown`.
- Produces: `PromptPath`, `PathLookupResult`, `findExactStringPaths(payload, expected)`, `getValueAtPath(payload, path)`, and `replaceValueAtPath(payload, path, expected, replacement)`.
- Later tasks rely on exact signatures shown in Step 3.

- [ ] **Step 1: Add the shared prompt-path type**

Append this type near the top of `packages/replace-prompt/types.ts`, after `ScopeName`:

```ts
export type PromptPathSegment = string | number;
export type PromptPath = readonly PromptPathSegment[];
```

- [ ] **Step 2: Write failing path-discovery and replacement tests**

Create `packages/replace-prompt/tests/payload-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  findExactStringPaths,
  getValueAtPath,
  replaceValueAtPath,
} from "../payload-path";

describe("provider payload paths", () => {
  it("finds exact string values through objects and arrays without matching keys or substrings", () => {
    const payload = {
      RP: "not the prompt",
      system: [{ text: "prefix RP suffix" }, { text: "RP" }],
      messages: [{ content: "unrelated" }],
    };

    expect(findExactStringPaths(payload, "RP")).toEqual([["system", 1, "text"]]);
  });

  it("reports every path when an exact string is ambiguous", () => {
    const payload = {
      system: { text: "RP" },
      messages: [{ content: "RP" }],
    };

    expect(findExactStringPaths(payload, "RP")).toEqual([
      ["system", "text"],
      ["messages", 0, "content"],
    ]);
  });

  it("visits shared objects at each path but stops cycles", () => {
    const shared = { text: "RP" };
    const cyclic: Record<string, unknown> = { prompt: "RP" };
    cyclic.self = cyclic;

    expect(findExactStringPaths({ first: shared, second: shared }, "RP")).toEqual([
      ["first", "text"],
      ["second", "text"],
    ]);
    expect(findExactStringPaths(cyclic, "RP")).toEqual([["prompt"]]);
  });

  it("returns a found result for valid paths and a miss for stale paths", () => {
    const payload = { system: [{ text: "RP" }] };

    expect(getValueAtPath(payload, ["system", 0, "text"])).toEqual({ found: true, value: "RP" });
    expect(getValueAtPath(payload, ["system", 1, "text"])).toEqual({ found: false });
    expect(getValueAtPath(payload, ["system", "0", "text"])).toEqual({ found: false });
  });

  it("replaces only the learned path with copy-on-write structural sharing", () => {
    const cacheControl = { type: "ephemeral" };
    const messages = [{ content: "BP" }];
    const payload = {
      system: [{ text: "BP", cache_control: cacheControl }],
      messages,
      temperature: 0,
    };

    const outcome = replaceValueAtPath(payload, ["system", 0, "text"], "BP", "RP");

    expect(outcome.changed).toBe(true);
    expect(outcome.value).toEqual({
      system: [{ text: "RP", cache_control: cacheControl }],
      messages: [{ content: "BP" }],
      temperature: 0,
    });
    expect(outcome.value).not.toBe(payload);
    expect((outcome.value as typeof payload).system).not.toBe(payload.system);
    expect((outcome.value as typeof payload).system[0]).not.toBe(payload.system[0]);
    expect((outcome.value as typeof payload).system[0].cache_control).toBe(cacheControl);
    expect((outcome.value as typeof payload).messages).toBe(messages);
    expect(payload.system[0].text).toBe("BP");
  });

  it("fails open when the path or expected value is stale", () => {
    const payload = { system: [{ text: "something else" }] };

    expect(replaceValueAtPath(payload, ["system", 0, "text"], "BP", "RP")).toEqual({
      value: payload,
      changed: false,
    });
    expect(replaceValueAtPath(payload, ["missing"], "BP", "RP")).toEqual({
      value: payload,
      changed: false,
    });
  });

  it("can discover and replace a root string payload", () => {
    expect(findExactStringPaths("RP", "RP")).toEqual([[]]);
    expect(replaceValueAtPath("BP", [], "BP", "RP")).toEqual({ value: "RP", changed: true });
  });

  it("ignores null, primitives, functions, and non-plain objects", () => {
    expect(findExactStringPaths(null, "RP")).toEqual([]);
    expect(findExactStringPaths(42, "RP")).toEqual([]);
    expect(findExactStringPaths(() => "RP", "RP")).toEqual([]);
    expect(findExactStringPaths(new Date(), "RP")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the focused test and verify the missing module failure**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/payload-path.test.ts
```

Expected: FAIL because `../payload-path` does not exist.

- [ ] **Step 4: Implement exact path discovery, lookup, and copy-on-write replacement**

Create `packages/replace-prompt/payload-path.ts`:

```ts
import type { PromptPath, PromptPathSegment } from "./types";

export type PathLookupResult =
  | { found: true; value: unknown }
  | { found: false };

export type PathReplacementResult = {
  value: unknown;
  changed: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function findExactStringPaths(payload: unknown, expected: string): PromptPath[] {
  const paths: PromptPath[] = [];
  const ancestors = new WeakSet<object>();

  function visit(value: unknown, path: PromptPathSegment[]): void {
    if (typeof value === "string") {
      if (value === expected) {
        paths.push([...path]);
      }
      return;
    }

    if (value === null || typeof value !== "object" || ancestors.has(value)) {
      return;
    }

    if (!Array.isArray(value) && !isPlainObject(value)) {
      return;
    }

    ancestors.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (Object.prototype.hasOwnProperty.call(value, index)) {
          visit(value[index], [...path, index]);
        }
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...path, key]);
      }
    }
    ancestors.delete(value);
  }

  visit(payload, []);
  return paths;
}

export function getValueAtPath(payload: unknown, path: PromptPath): PathLookupResult {
  let current = payload;

  for (const segment of path) {
    if (typeof segment === "number") {
      if (
        !Array.isArray(current) ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        return { found: false };
      }
      current = current[segment];
      continue;
    }

    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }

  return { found: true, value: current };
}

export function replaceValueAtPath(
  payload: unknown,
  path: PromptPath,
  expected: string,
  replacement: string,
): PathReplacementResult {
  function replaceAt(value: unknown, pathIndex: number): PathReplacementResult {
    if (pathIndex === path.length) {
      return value === expected
        ? { value: replacement, changed: true }
        : { value, changed: false };
    }

    const segment = path[pathIndex];
    if (typeof segment === "number") {
      if (
        !Array.isArray(value) ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        !Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        return { value, changed: false };
      }

      const child = replaceAt(value[segment], pathIndex + 1);
      if (!child.changed) {
        return { value, changed: false };
      }

      const next = value.slice();
      next[segment] = child.value;
      return { value: next, changed: true };
    }

    if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return { value, changed: false };
    }

    const child = replaceAt(value[segment], pathIndex + 1);
    if (!child.changed) {
      return { value, changed: false };
    }

    const next = Object.assign(Object.create(Object.getPrototypeOf(value)), value) as Record<string, unknown>;
    next[segment] = child.value;
    return { value: next, changed: true };
  }

  return replaceAt(payload, 0);
}
```

- [ ] **Step 5: Run focused tests and package typecheck**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/payload-path.test.ts
npm run typecheck -w pi-replace-prompt
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the payload helper**

```bash
git add packages/replace-prompt/types.ts packages/replace-prompt/payload-path.ts packages/replace-prompt/tests/payload-path.test.ts
git commit -m "feat(replace-prompt): add provider payload path helpers"
```

---

### Task 2: Conditional-context identity and fingerprints

**Files:**
- Create: `packages/replace-prompt/transformation-context.ts`
- Create: `packages/replace-prompt/tests/transformation-context.test.ts`
- Modify: `packages/replace-prompt/types.ts`

**Interfaces:**
- Consumes: cwd, Pi's current model descriptor, and `NodeJS.ProcessEnv`.
- Produces: `TransformationContextIdentity`, `createModelKey(model)`, `fingerprintEnvironment(env)`, `createTransformationContext(cwd, model, env)`, and `sameTransformationContext(left, right)`.
- Task 3 consumes `TransformationContextIdentity` and `sameTransformationContext`; Task 4 consumes `createTransformationContext`.

- [ ] **Step 1: Add the shared transformation-context type**

Append to `packages/replace-prompt/types.ts` after the prompt-path types:

```ts
export type TransformationContextIdentity = {
  cwd: string;
  modelKey: string;
  environmentFingerprint: string;
};
```

- [ ] **Step 2: Write failing context-identity tests**

Create `packages/replace-prompt/tests/transformation-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createModelKey,
  createTransformationContext,
  fingerprintEnvironment,
  sameTransformationContext,
} from "../transformation-context";

describe("transformation context identity", () => {
  it("includes provider, API family, and model ID in the model key", () => {
    const baseline = createModelKey({ provider: "provider-a", api: "api-a", id: "model-a" });

    expect(createModelKey({ provider: "provider-b", api: "api-a", id: "model-a" })).not.toBe(baseline);
    expect(createModelKey({ provider: "provider-a", api: "api-b", id: "model-a" })).not.toBe(baseline);
    expect(createModelKey({ provider: "provider-a", api: "api-a", id: "model-b" })).not.toBe(baseline);
    expect(createModelKey(undefined)).toBe(createModelKey(null));
  });

  it("fingerprints environment entries independently of insertion order", () => {
    const first = { BETA: "two", ALPHA: "one" } as NodeJS.ProcessEnv;
    const second = { ALPHA: "one", BETA: "two" } as NodeJS.ProcessEnv;

    expect(fingerprintEnvironment(first)).toBe(fingerprintEnvironment(second));
  });

  it("changes the environment fingerprint when a supported condition input changes", () => {
    const baseline = fingerprintEnvironment({ FEATURE: "on" } as NodeJS.ProcessEnv);

    expect(fingerprintEnvironment({ FEATURE: "off" } as NodeJS.ProcessEnv)).not.toBe(baseline);
    expect(fingerprintEnvironment({ FEATURE: "on", EXTRA: "1" } as NodeJS.ProcessEnv)).not.toBe(baseline);
  });

  it("returns an opaque SHA-256 digest rather than environment contents", () => {
    const fingerprint = fingerprintEnvironment({ TOKEN: "super-secret-value" } as NodeJS.ProcessEnv);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("TOKEN");
    expect(fingerprint).not.toContain("super-secret-value");
  });

  it("compares cwd, model, and environment as one identity", () => {
    const baseline = createTransformationContext(
      "/repo",
      { provider: "provider-a", api: "api-a", id: "model-a" },
      { FEATURE: "on" } as NodeJS.ProcessEnv,
    );

    expect(sameTransformationContext(baseline, { ...baseline })).toBe(true);
    expect(sameTransformationContext(baseline, { ...baseline, cwd: "/other" })).toBe(false);
    expect(sameTransformationContext(baseline, { ...baseline, modelKey: "other" })).toBe(false);
    expect(
      sameTransformationContext(baseline, { ...baseline, environmentFingerprint: "other" }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run the focused test and verify the missing module failure**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/transformation-context.test.ts
```

Expected: FAIL because `../transformation-context` does not exist.

- [ ] **Step 4: Implement stable, secret-free context identity**

Create `packages/replace-prompt/transformation-context.ts`:

```ts
import { createHash } from "node:crypto";
import type { TransformationContextIdentity } from "./types";

export type ModelIdentityInput =
  | {
      provider?: unknown;
      api?: unknown;
      id?: unknown;
    }
  | null
  | undefined;

function stringPart(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createModelKey(model: ModelIdentityInput): string {
  return JSON.stringify([
    stringPart(model?.provider),
    stringPart(model?.api),
    stringPart(model?.id),
  ]);
}

export function fingerprintEnvironment(env: NodeJS.ProcessEnv): string {
  const entries = Object.keys(env)
    .sort()
    .flatMap((key) => {
      const value = env[key];
      return value === undefined ? [] : [[key, value] as const];
    });

  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

export function createTransformationContext(
  cwd: string,
  model: ModelIdentityInput,
  env: NodeJS.ProcessEnv,
): TransformationContextIdentity {
  return {
    cwd,
    modelKey: createModelKey(model),
    environmentFingerprint: fingerprintEnvironment(env),
  };
}

export function sameTransformationContext(
  left: TransformationContextIdentity,
  right: TransformationContextIdentity,
): boolean {
  return (
    left.cwd === right.cwd &&
    left.modelKey === right.modelKey &&
    left.environmentFingerprint === right.environmentFingerprint
  );
}
```

- [ ] **Step 5: Run focused tests and package typecheck**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/transformation-context.test.ts
npm run typecheck -w pi-replace-prompt
```

Expected: both commands PASS.

- [ ] **Step 6: Commit context identity support**

```bash
git add packages/replace-prompt/types.ts packages/replace-prompt/transformation-context.ts packages/replace-prompt/tests/transformation-context.test.ts
git commit -m "feat(replace-prompt): isolate prompt transformations by context"
```

---

### Task 3: Fail-open fallback restoration state machine

**Files:**
- Create: `packages/replace-prompt/fallback-restoration.ts`
- Create: `packages/replace-prompt/tests/fallback-restoration.test.ts`

**Interfaces:**
- Consumes: `PromptPath`, `TransformationContextIdentity`, payload helpers from Task 1, and context comparison from Task 2.
- Produces: `PromptFallbackRestorer`, `BeginTransformationInput`, and `ProviderPayloadOutcome`.
- Task 4 creates one `PromptFallbackRestorer` per extension instance, calls `begin()` after a changed prompt, `clear()` on invalidation, and `handleProviderPayload()` for each provider request.

- [ ] **Step 1: Write failing state-machine tests**

Create `packages/replace-prompt/tests/fallback-restoration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PromptFallbackRestorer } from "../fallback-restoration";
import type { TransformationContextIdentity } from "../types";

const context: TransformationContextIdentity = {
  cwd: "/repo",
  modelKey: "model-key",
  environmentFingerprint: "environment-key",
};

function begin(restorer: PromptFallbackRestorer, source = "BP", result = "RP") {
  restorer.begin({ source, result, context });
}

describe("PromptFallbackRestorer", () => {
  it("learns one exact result path without changing the discovery payload", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    const payload = { system: [{ text: "RP" }], messages: [{ content: "hello" }] };

    expect(restorer.handleProviderPayload(payload, context)).toEqual({
      events: [{ level: "info", message: "provider prompt path learned" }],
    });
    expect(restorer.handleProviderPayload(payload, context)).toEqual({ events: [] });
  });

  it("repairs only the learned path and never reapplies replacement rules", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer, "foo", "foobar");
    restorer.handleProviderPayload({ system: { text: "foobar" } }, context);

    const userMessages = [{ content: "foo" }];
    const payload = { system: { text: "foo" }, messages: userMessages };
    const outcome = restorer.handleProviderPayload(payload, context);

    expect(outcome.events).toEqual([
      { level: "info", message: "provider fallback prompt restored" },
    ]);
    expect(outcome.replacement).toEqual({
      system: { text: "foobar" },
      messages: [{ content: "foo" }],
    });
    expect((outcome.replacement as typeof payload).messages).toBe(userMessages);
    expect((outcome.replacement as typeof payload).system.text).toBe("foobar");
    expect((outcome.replacement as typeof payload).system.text).not.toBe("foobarbar");
  });

  it("does not learn an ambiguous path and deduplicates its warning", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    const payload = { system: { text: "RP" }, messages: [{ content: "RP" }] };

    expect(restorer.handleProviderPayload(payload, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path discovery was ambiguous" }],
    });
    expect(restorer.handleProviderPayload(payload, context)).toEqual({ events: [] });
    expect(restorer.handleProviderPayload({ system: { text: "BP" } }, context)).toEqual({
      events: [],
    });
  });

  it("deduplicates the warning when no exact result path exists", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);

    expect(restorer.handleProviderPayload({ system: { text: "other" } }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was not found" }],
    });
    expect(restorer.handleProviderPayload({ system: { text: "other" } }, context)).toEqual({
      events: [],
    });
  });

  it("fails open when cwd, model, or environment identity differs", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    restorer.handleProviderPayload({ system: { text: "RP" } }, context);

    for (const mismatch of [
      { ...context, cwd: "/other" },
      { ...context, modelKey: "other-model" },
      { ...context, environmentFingerprint: "other-environment" },
    ]) {
      expect(restorer.handleProviderPayload({ system: { text: "BP" } }, mismatch)).toEqual({
        events: [],
      });
    }
  });

  it("fails open for a stale learned path and logs only one warning", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer);
    restorer.handleProviderPayload({ system: { text: "RP" } }, context);

    expect(restorer.handleProviderPayload({ instructions: "BP" }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was stale" }],
    });
    expect(restorer.handleProviderPayload({ instructions: "BP" }, context)).toEqual({ events: [] });
  });

  it("clears state and replaces an older transformation when begin is called again", () => {
    const restorer = new PromptFallbackRestorer();
    begin(restorer, "old BP", "old RP");
    restorer.handleProviderPayload({ system: "old RP" }, context);

    begin(restorer, "new BP", "new RP");
    expect(restorer.handleProviderPayload({ system: "new RP" }, context).events).toEqual([
      { level: "info", message: "provider prompt path learned" },
    ]);
    expect(restorer.handleProviderPayload({ system: "old BP" }, context)).toEqual({
      events: [{ level: "warn", message: "provider prompt path was stale" }],
    });

    restorer.clear();
    expect(restorer.handleProviderPayload({ system: "new BP" }, context)).toEqual({ events: [] });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/fallback-restoration.test.ts
```

Expected: FAIL because `../fallback-restoration` does not exist.

- [ ] **Step 3: Implement the restoration state machine**

Create `packages/replace-prompt/fallback-restoration.ts`:

```ts
import { findExactStringPaths, getValueAtPath, replaceValueAtPath } from "./payload-path";
import { sameTransformationContext } from "./transformation-context";
import type { LogEvent, PromptPath, TransformationContextIdentity } from "./types";

export type BeginTransformationInput = {
  source: string;
  result: string;
  context: TransformationContextIdentity;
};

export type ProviderPayloadOutcome = {
  replacement?: unknown;
  events: LogEvent[];
};

type ActiveTransformation = BeginTransformationInput & {
  promptPath?: PromptPath;
  discoveryWarningLogged: boolean;
  stalePathWarningLogged: boolean;
};

export class PromptFallbackRestorer {
  private active: ActiveTransformation | null = null;

  begin(input: BeginTransformationInput): void {
    this.active = {
      ...input,
      context: { ...input.context },
      discoveryWarningLogged: false,
      stalePathWarningLogged: false,
    };
  }

  clear(): void {
    this.active = null;
  }

  handleProviderPayload(
    payload: unknown,
    context: TransformationContextIdentity,
  ): ProviderPayloadOutcome {
    const active = this.active;
    if (!active || !sameTransformationContext(active.context, context)) {
      return { events: [] };
    }

    if (active.promptPath === undefined) {
      const matches = findExactStringPaths(payload, active.result);
      if (matches.length === 1) {
        active.promptPath = matches[0];
        return {
          events: [{ level: "info", message: "provider prompt path learned" }],
        };
      }

      if (active.discoveryWarningLogged) {
        return { events: [] };
      }

      active.discoveryWarningLogged = true;
      return {
        events: [
          {
            level: "warn",
            message:
              matches.length === 0
                ? "provider prompt path was not found"
                : "provider prompt path discovery was ambiguous",
          },
        ],
      };
    }

    const lookup = getValueAtPath(payload, active.promptPath);
    if (!lookup.found || (lookup.value !== active.source && lookup.value !== active.result)) {
      if (active.stalePathWarningLogged) {
        return { events: [] };
      }

      active.stalePathWarningLogged = true;
      return {
        events: [{ level: "warn", message: "provider prompt path was stale" }],
      };
    }

    if (lookup.value === active.result) {
      return { events: [] };
    }

    const replacement = replaceValueAtPath(
      payload,
      active.promptPath,
      active.source,
      active.result,
    );
    if (!replacement.changed) {
      return { events: [] };
    }

    return {
      replacement: replacement.value,
      events: [{ level: "info", message: "provider fallback prompt restored" }],
    };
  }
}
```

- [ ] **Step 4: Run focused tests and package typecheck**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/fallback-restoration.test.ts
npm run typecheck -w pi-replace-prompt
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the state machine**

```bash
git add packages/replace-prompt/fallback-restoration.ts packages/replace-prompt/tests/fallback-restoration.test.ts
git commit -m "feat(replace-prompt): add prompt fallback restorer"
```

---

### Task 4: Integrate provider repair with Pi extension lifecycle

**Files:**
- Modify: `packages/replace-prompt/index.ts`
- Create: `packages/replace-prompt/tests/provider-fallback.test.ts`
- Verify: `packages/replace-prompt/tests/index.test.ts`

**Interfaces:**
- Consumes: `PromptFallbackRestorer` from Task 3 and `createTransformationContext()` from Task 2.
- Produces: registered `session_start`, `before_agent_start`, and `before_provider_request` handlers in the package's existing default extension export.
- Preserves the existing return contract: `before_agent_start` returns `{ systemPrompt } | undefined`; `before_provider_request` returns a replacement payload only when exact repair occurs.

- [ ] **Step 1: Write failing end-to-end hook tests**

Create `packages/replace-prompt/tests/provider-fallback.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import replacePrompt from "../index";

type Handler = (event: any, ctx: any) => unknown | Promise<unknown>;

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalConditionValue = process.env.REPLACE_PROMPT_TEST_CONTEXT;

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalConditionValue === undefined) {
    delete process.env.REPLACE_PROMPT_TEST_CONTEXT;
  } else {
    process.env.REPLACE_PROMPT_TEST_CONTEXT = originalConditionValue;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function configuredProject(config: string) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-project-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-prompt-home-"));
  tempDirs.push(projectRoot, homeDir);
  process.env.HOME = homeDir;

  const configDir = path.join(projectRoot, ".pi/replace-prompt");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "rules.ts"), config);
  return { projectRoot, configDir };
}

function registerHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  replacePrompt({
    on(eventName: string, handler: Handler) {
      handlers[eventName] = handler;
    },
  } as any);
  return handlers;
}

function context(cwd: string, overrides: Record<string, unknown> = {}) {
  const { model, ...rest } = overrides;
  return {
    cwd,
    ...rest,
    model: {
      provider: "provider-a",
      api: "api-a",
      id: "model-a",
      ...(model as Record<string, unknown> | undefined),
    },
  };
}

async function transform(
  handler: Handler,
  systemPrompt: string,
  cwd: string,
  ctx = context(cwd),
) {
  return handler(
    { type: "before_agent_start", prompt: "test", systemPrompt, systemPromptOptions: {} },
    ctx,
  );
}

describe("provider fallback integration", () => {
  it("registers lifecycle, agent-start, and provider-boundary handlers", () => {
    const handlers = registerHandlers();

    expect(handlers.session_start).toEqual(expect.any(Function));
    expect(handlers.before_agent_start).toEqual(expect.any(Function));
    expect(handlers.before_provider_request).toEqual(expect.any(Function));
  });

  it("learns RP once and restores exact BP only at the learned path", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "grow-foo", type: "literal", target: "foo", replacement: "foobar" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    expect(await transform(handlers.before_agent_start, "foo", projectRoot, ctx)).toEqual({
      systemPrompt: "foobar",
    });

    const learnedPayload = {
      system: [{ text: "foobar" }],
      messages: [{ content: "hello" }],
    };
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: learnedPayload },
        ctx,
      ),
    ).toBeUndefined();

    const cacheControl = { type: "ephemeral" };
    const userMessages = [{ content: "foo" }];
    const fallbackPayload = {
      system: [{ text: "foo", cache_control: cacheControl }],
      messages: userMessages,
    };
    const repaired = await handlers.before_provider_request(
      { type: "before_provider_request", payload: fallbackPayload },
      ctx,
    );

    expect(repaired).toEqual({
      system: [{ text: "foobar", cache_control: cacheControl }],
      messages: [{ content: "foo" }],
    });
    expect((repaired as typeof fallbackPayload).messages).toBe(userMessages);
    expect((repaired as typeof fallbackPayload).system[0].cache_control).toBe(cacheControl);
    expect(fallbackPayload.system[0].text).toBe("foo");
  });

  it("clears an obsolete transformation after an unchanged agent start or new session", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );
    expect(await transform(handlers.before_agent_start, "No match", projectRoot, ctx)).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );
    await handlers.session_start({ type: "session_start", reason: "resume" }, ctx);
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("clears remembered state when configuration reload fails", async () => {
    const { projectRoot, configDir } = configuredProject(`export default { rules: [
      { id: "replace-opening", type: "literal", target: "Hello", replacement: "Hi" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "Hello", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Hi" } },
      ctx,
    );

    fs.writeFileSync(path.join(configDir, "rules.ts"), "export default {");
    expect(await transform(handlers.before_agent_start, "Hello", projectRoot, ctx)).toBeUndefined();
    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { system: "Hello" } },
        ctx,
      ),
    ).toBeUndefined();
  });

  it("does not reuse a conditional result across model, cwd, or environment changes", async () => {
    process.env.REPLACE_PROMPT_TEST_CONTEXT = "enabled";
    const { projectRoot } = configuredProject(`export default { rules: [
      {
        id: "conditional-opening",
        type: "literal",
        target: "Hello",
        replacement: "Conditional hi",
        condition: (ctx) =>
          ctx.model === "model-a" &&
          ctx.cwd.includes("replace-prompt-project-") &&
          ctx.env.REPLACE_PROMPT_TEST_CONTEXT === "enabled"
      }
    ] };`);
    const handlers = registerHandlers();
    const originalContext = context(projectRoot);

    expect(
      await transform(handlers.before_agent_start, "Hello", projectRoot, originalContext),
    ).toEqual({ systemPrompt: "Conditional hi" });
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "Conditional hi" } },
      originalContext,
    );

    const fallback = { type: "before_provider_request", payload: { system: "Hello" } };
    expect(
      await handlers.before_provider_request(
        fallback,
        context(projectRoot, { model: { id: "model-b" } }),
      ),
    ).toBeUndefined();
    expect(
      await handlers.before_provider_request(fallback, context(path.join(projectRoot, "other"))),
    ).toBeUndefined();

    process.env.REPLACE_PROMPT_TEST_CONTEXT = "disabled";
    expect(await handlers.before_provider_request(fallback, originalContext)).toBeUndefined();
  });

  it("treats assembled SYSTEM content as opaque while preserving exact CRLF and Unicode comparison", async () => {
    const { projectRoot } = configuredProject(`export default { rules: [
      { id: "unicode-opening", type: "literal", target: "Hello\\n🌍", replacement: "Hi\\n🌍" }
    ] };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);
    const source = "Project SYSTEM.md persona\r\nHello\r\n🌍\r\n";
    const result = "Project SYSTEM.md persona\nHi\n🌍\n";

    expect(await transform(handlers.before_agent_start, source, projectRoot, ctx)).toEqual({
      systemPrompt: result,
    });
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { instructions: result } },
      ctx,
    );

    expect(
      await handlers.before_provider_request(
        { type: "before_provider_request", payload: { instructions: source } },
        ctx,
      ),
    ).toEqual({ instructions: result });
  });

  it("logs path learning and restoration without logging prompt contents", async () => {
    const { projectRoot, configDir } = configuredProject(`export default {
      logging: { file: true },
      rules: [
        {
          id: "secret-opening",
          type: "literal",
          target: "VERY_SECRET_BP",
          replacement: "VERY_SECRET_RP"
        }
      ]
    };`);
    const handlers = registerHandlers();
    const ctx = context(projectRoot);

    await transform(handlers.before_agent_start, "VERY_SECRET_BP", projectRoot, ctx);
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "VERY_SECRET_RP" } },
      ctx,
    );
    await handlers.before_provider_request(
      { type: "before_provider_request", payload: { system: "VERY_SECRET_BP" } },
      ctx,
    );

    const logText = fs.readFileSync(path.join(configDir, "replace-prompt.log"), "utf8");
    expect(logText).toContain("[info] provider prompt path learned");
    expect(logText).toContain("[info] provider fallback prompt restored");
    expect(logText).not.toContain("VERY_SECRET_BP");
    expect(logText).not.toContain("VERY_SECRET_RP");
  });
});
```

- [ ] **Step 2: Run the integration test and verify missing handlers fail**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/provider-fallback.test.ts
```

Expected: FAIL because `session_start` and `before_provider_request` are not registered and fallback restoration is absent.

- [ ] **Step 3: Integrate the restorer and provider hook**

Replace `packages/replace-prompt/index.ts` with:

```ts
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyRulesToPrompt } from "./apply-rules";
import { PromptFallbackRestorer } from "./fallback-restoration";
import { appendLog } from "./logging";
import { loadScopeConfig, selectLogPath } from "./load-config";
import { mergeScopeConfigs } from "./merge-rules";
import { resolveReplacementText } from "./resolve-replacement";
import { createTransformationContext } from "./transformation-context";

function getScopeDirs(cwd: string) {
  const globalCandidate = process.env.HOME
    ? path.join(process.env.HOME, ".pi/agent/replace-prompt")
    : null;
  const projectCandidate = path.join(cwd, ".pi/replace-prompt");

  return {
    globalDir: globalCandidate && fs.existsSync(globalCandidate) ? globalCandidate : null,
    projectDir: fs.existsSync(projectCandidate) ? projectCandidate : null,
  };
}

export default function replacePrompt(pi: ExtensionAPI) {
  const restorer = new PromptFallbackRestorer();
  let providerLogPath: string | null = null;

  pi.on("session_start", () => {
    restorer.clear();
    providerLogPath = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const compatibilityEvent = event as typeof event & { cwd?: string };
    const cwd = ctx?.cwd ?? compatibilityEvent.cwd ?? process.cwd();
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
              model: ctx?.model?.id,
              env: process.env,
            },
          );

    const allEvents = [...merged.events, ...result.events];
    const logPath = merged.logging.file
      ? selectLogPath({
          projectDir: merged.projectDir,
          globalDir: merged.globalDir,
        })
      : null;

    if (logPath) {
      appendLog(logPath, allEvents);
    }

    if (!result.changed) {
      restorer.clear();
      providerLogPath = null;
      return undefined;
    }

    restorer.begin({
      source: basePrompt,
      result: result.systemPrompt,
      context: createTransformationContext(cwd, ctx?.model, process.env),
    });
    providerLogPath = logPath;

    return { systemPrompt: result.systemPrompt };
  });

  pi.on("before_provider_request", (event, ctx) => {
    const outcome = restorer.handleProviderPayload(
      event.payload,
      createTransformationContext(ctx.cwd, ctx.model, process.env),
    );

    if (providerLogPath) {
      appendLog(providerLogPath, outcome.events);
    }

    return outcome.replacement;
  });
}
```

- [ ] **Step 4: Run provider integration and all existing package tests**

Run:

```bash
npx vitest run --cache=false packages/replace-prompt/tests/provider-fallback.test.ts
npm test -w pi-replace-prompt
```

Expected: both commands PASS, including the pre-existing `index.test.ts` behavior.

- [ ] **Step 5: Run package typecheck**

Run:

```bash
npm run typecheck -w pi-replace-prompt
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit Pi lifecycle integration**

```bash
git add packages/replace-prompt/index.ts packages/replace-prompt/tests/provider-fallback.test.ts
git commit -m "fix(replace-prompt): restore prompt fallback at provider boundary"
```

---

### Task 5: Document behavior, caveats, and verification

**Files:**
- Modify: `packages/replace-prompt/README.md`
- Modify: `packages/replace-prompt/docs/usage.md`
- Verify: all `packages/replace-prompt` source and tests

**Interfaces:**
- Consumes: final behavior implemented in Tasks 1–4.
- Produces: user-facing installation guidance, provider-agnostic cache-continuity explanation, ordering limitation, conditional-context behavior, and diagnostic event descriptions.

- [ ] **Step 1: Add cache continuity to the README feature list**

In `packages/replace-prompt/README.md`, extend the opening feature list with:

```markdown
- provider-agnostic cache continuity for automatic post-tool turns
```

- [ ] **Step 2: Add a concise README behavior and limitation section**

Insert this section before `## Logging` in `packages/replace-prompt/README.md`:

```markdown
## Automatic post-tool cache continuity

Pi can restore its base system prompt during a post-tool continuation of an automatically triggered turn. When a normal turn changes the system prompt, `replace-prompt` remembers the exact source and result and learns the unique provider-payload location containing that result. Later requests inspect only that learned location; if Pi restores the exact source there, the extension restores the exact result without running your rules again.

This is provider agnostic: the extension learns the payload path at runtime and does not contain provider-specific field mappings. Ambiguous, missing, stale, or context-mismatched paths fail open and leave the request unchanged.

This safety net assumes `replace-prompt` is the only extension mutating the system prompt through `before_agent_start`. If another extension also mutates the prompt, extension ordering can make the remembered source or result differ from Pi's actual fallback/final prompt. Ordinary rule chaining still follows Pi's normal extension order; the limitation matters specifically to automatic post-tool fallback restoration.

Identical prompts can improve cache-hit behavior only for providers and request paths that support prompt caching. The extension does not guarantee cache accounting or quota outcomes.
```

- [ ] **Step 3: Add detailed behavior to the usage guide**

Insert this section before `## Logging behavior` in `packages/replace-prompt/docs/usage.md`:

```markdown
## Automatic post-tool cache continuity

Some automatically triggered Pi turns can start with the replaced system prompt but restore Pi's base prompt after a tool result. That changes the provider's prompt prefix and can reduce cache hits.

`replace-prompt` protects these continuations in three phases:

1. `before_agent_start` applies configured rules once and remembers the exact source and result.
2. The next provider request is scanned once to find the unique exact location containing the result.
3. Later requests inspect only that learned location. An exact source value is replaced with the exact remembered result.

Rules are never re-run at the provider boundary, so non-idempotent rules such as `foo → foobar` cannot become `foo → foobarbar`.

### Provider independence and message safety

The extension learns paths such as `system[1].text`, `instructions`, or `messages[0].content` from the outgoing payload. These examples are not hard-coded mappings.

Path discovery succeeds only when the exact replaced prompt appears once. Zero matches or multiple matches are ambiguous and leave the payload unchanged. After discovery, the extension reads only the learned path, so an exact copy of the base prompt in a user message or tool result elsewhere in the payload is not rewritten.

A missing path or a value other than the exact source/result also leaves the payload unchanged.

### Conditional context isolation

Remembered transformations are isolated by:

- provider identity
- API family
- model ID
- cwd
- a secret-free fingerprint of the complete environment exposed to rule conditions

If any of these values changes, provider-boundary restoration is skipped until a later normal `before_agent_start` evaluates the rules and records a new transformation. The fingerprint is held in memory and logs neither environment names nor values.

The exact source/result strings already capture conditions based on `originalSystemPrompt` and sequential `systemPrompt` state.

Condition functions can technically read external process state through JavaScript closures. State outside the documented `ConditionContext` cannot be tracked and should not be used when reliable automatic fallback restoration matters.

### Extension ordering limitation

Fallback restoration assumes `replace-prompt` is the only extension mutating the system prompt through `before_agent_start`.

- An earlier mutator can make the recorded source differ from Pi's base fallback prompt.
- A later mutator can make the recorded result differ from the final provider-facing prompt.

Ordinary replacement still participates in Pi's normal extension chaining. This limitation applies specifically to the provider-boundary repair of automatic post-tool turns.

### Cache expectations

Sending the same exact replaced prompt preserves a necessary cache-prefix invariant. Actual cache reads, accounting, and quota behavior still depend on the provider, model, request shape, and provider-side cache support.
```

- [ ] **Step 4: Extend the logging guide with provider-boundary events**

In `packages/replace-prompt/docs/usage.md`, extend the `Typical events include:` list with:

```markdown
- provider prompt path learned
- provider fallback prompt restored
- provider prompt path was not found or was ambiguous
- provider prompt path was stale
```

Then append this paragraph immediately after that list:

```markdown
Provider-boundary logs contain event descriptions only. They never include the source prompt, replacement prompt, provider payload, or environment contents. Discovery and stale-path warnings are emitted at most once per remembered transformation.
```

- [ ] **Step 5: Run focused and workspace verification**

Run:

```bash
npm test -w pi-replace-prompt
npm run typecheck -w pi-replace-prompt
npm test
npm run typecheck
```

Expected: all four commands PASS. The package test output includes the new payload-path, transformation-context, fallback-restoration, and provider-fallback suites.

- [ ] **Step 6: Inspect the final diff for provider-specific branching or sensitive logs**

Run:

```bash
git diff --check
git diff -- packages/replace-prompt
git grep -nE 'anthropic|openai|google|bedrock|mistral' -- packages/replace-prompt/*.ts packages/replace-prompt/tests/*.ts
git grep -nE 'source:|result:|environment' -- packages/replace-prompt/index.ts packages/replace-prompt/fallback-restoration.ts packages/replace-prompt/logging.ts
```

Expected:

- `git diff --check` prints nothing and exits 0.
- The implementation contains no provider-name branching or provider-specific payload fields.
- The final grep may show generic transformation field names and environment fingerprint calls, but no code passes prompt strings, payloads, environment names, or environment values to `appendLog`.
- Documentation examples may mention generic learned path shapes; runtime code must not encode them.

- [ ] **Step 7: Commit documentation and final verification state**

```bash
git add packages/replace-prompt/README.md packages/replace-prompt/docs/usage.md
git commit -m "docs(replace-prompt): explain automatic cache continuity"
```

## Manual regression check after implementation

This check requires a configured provider and an automatic custom-message source, so it is intentionally performed after the deterministic implementation tasks:

1. Start a fresh Pi session with the local `pi-replace-prompt` package and file logging enabled.
2. Send a normal prompt that invokes a tool, ensuring the first provider request can learn the transformed prompt path.
3. Let a process completion notification or delegate watcher trigger an automatic turn.
4. Allow that turn to call `delegate_check` or another tool and continue without sending a manual `continue`.
5. Verify the automatic post-tool response succeeds.
6. Verify `replace-prompt.log` contains `provider prompt path learned` followed by `provider fallback prompt restored` and contains no prompt text.
7. Where the provider exposes cache metrics, compare the initial and post-tool prompt/cache behavior. Treat cache accounting as observational evidence rather than a universal pass/fail guarantee.
