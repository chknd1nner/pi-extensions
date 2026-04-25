# Replace Prompt Conditional Rules Design

Date: 2026-04-25
Status: Proposed

## Overview

Add optional conditional execution to `extensions/replace-prompt` so enabled rules may decide at runtime whether they should apply.

The feature is intended to stay small and bounded:

- rule authors write plain TypeScript directly in `rules.ts`
- conditions are synchronous predicate functions
- conditions receive a documented runtime context object
- false, non-boolean, or thrown condition results skip the rule rather than disrupting Pi startup

The first motivating use case is model-specific prompt replacement, such as only applying a rule when the active model identifier contains `"claude"`. That use case was already proven viable by the existing `gemma-4-thinking-token` extension, whose model detection logic inspired bringing model-aware behavior into the more general `replace-prompt` pipeline.

## Goals

- Allow prompt replacement rules to run conditionally at runtime
- Keep the feature backward compatible with existing `rules.ts` files
- Preserve the extension's current ordered top-to-bottom rule pipeline
- Let conditions inspect a bounded context object rather than raw extension internals
- Support model-specific rules without requiring a new extension or a declarative DSL
- Keep failure handling soft and aligned with current replace-prompt behavior
- Leave room to extend the condition context later without breaking existing configs

## Non-goals

- Supporting async conditions — decided against to keep conditions fast and predictable
- Designing a condition-specific DSL such as `modelIncludes`, `cwdMatches`, or `envEquals` — unnecessary because direct TypeScript already provides flexibility
- Turning `replace-prompt` into a general context injection or memory system — outside the extension's single responsibility
- Providing helper libraries for conditions — unnecessary given direct TypeScript access in `rules.ts`
- Adding UI-level debugging or a condition trace viewer — unnecessary for a bounded logging-first feature
- Supporting long-running lookups, network access, or other expensive rule predicates as a first-class use case — decided against because conditions should remain instantaneous environment checks

## User-facing API change

Enabled rules gain one new optional field:

```ts
condition?: (ctx: ConditionContext) => boolean;
```

This field is available on enabled literal and regex rules only.

### Example

```ts
export default {
  rules: [
    {
      id: "claude-only-opening",
      type: "literal",
      target: "Hello",
      replacement: "Hello Claude",
      condition: (ctx) => ctx.model?.includes("claude") ?? false,
    },
  ],
};
```

The `?? false` is important here because optional chaining makes `ctx.model?.includes("claude")` evaluate to `boolean | undefined`, and strict condition evaluation requires an explicit boolean.

Disable-only overrides remain minimal and unchanged:

```ts
{
  id: "replace-opening",
  enabled: false,
}
```

If a disable-only rule includes `condition`, it is ignored during normalization, consistent with how other non-disable fields on disable-only rules are already ignored. Disable-only rules exist only to suppress a rule by `id`.

## Condition context

The condition function receives a bounded runtime context object:

```ts
type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  originalSystemPrompt: string;
  env: NodeJS.ProcessEnv;
};
```

### Field semantics

- `model` is the active model identifier if Pi exposes one for the current run; otherwise `undefined`
- `cwd` is the current working directory for the session
- `systemPrompt` is the current prompt state at the moment the rule is being considered
- `originalSystemPrompt` is the prompt as received at the start of `before_agent_start`, before any rule in the pipeline has modified it
- `env` is `process.env`

Use `systemPrompt` when the condition should react to changes introduced by earlier rules. Use `originalSystemPrompt` when the condition should inspect the unmodified incoming prompt regardless of pipeline position.

This context is intentionally small. Future enhancements may add more fields, but the design should not expose extension-specific merge internals or other unnecessary details.

Because `rules.ts` is user-authored TypeScript that already executes with full Node.js access, exposing `process.env` does not expand the trust boundary. Users writing conditions already have unrestricted access to the runtime environment through the module system. The `env` field is a convenience for condition predicates, not a new capability.

## Evaluation semantics

### Ordered pipeline behavior

Rule order does not change. Rules still execute top-to-bottom.

For each rule:

1. If the rule is disabled, skip it
2. If the rule has a `condition`, evaluate it synchronously against the current runtime context
3. If the condition throws, skip the rule and emit a warning log event
4. If the return value is not a boolean, skip the rule and emit a warning log event: `condition returned non-boolean`
5. If the condition returns `false`, skip the rule and emit an info log event: `rule skipped by condition`
6. If the condition returns `true`, or the rule has no condition, continue with replacement resolution and normal rule application

A rule runs only when `condition(ctx)` returns exactly `true`. Truthy non-boolean values such as `"claude"`, `1`, or `{}` do not count as success.

### Current prompt and original prompt

`ctx.systemPrompt` must reflect the prompt state at the point in the pipeline where the rule is evaluated. `ctx.originalSystemPrompt` must remain the unmodified prompt from the start of `before_agent_start`.

This gives conditions both perspectives:

- `systemPrompt` for reacting to changes introduced by earlier rules
- `originalSystemPrompt` for inspecting the incoming prompt regardless of how far the pipeline has advanced

### Example of pipeline-aware conditions

```ts
export default {
  rules: [
    {
      id: "add-claude-marker",
      type: "literal",
      target: "Hello",
      replacement: "[CLAUDE]\nHello",
      condition: (ctx) => ctx.model?.includes("claude") ?? false,
    },
    {
      id: "expand-claude-guidance",
      type: "literal",
      target: "Hello",
      replacement: "Hello with Claude-specific guidance",
      condition: (ctx) => ctx.systemPrompt.includes("[CLAUDE]"),
    },
    {
      id: "note-original-greeting",
      type: "literal",
      target: "[CLAUDE]",
      replacement: "[CLAUDE-ORIGINAL-HELLO]",
      condition: (ctx) => ctx.originalSystemPrompt.startsWith("Hello"),
    },
  ],
};
```

Under this design, the second rule can react to the marker introduced by the first rule, while the third rule can still reason about the original prompt even after earlier rules have mutated the current prompt.

## Failure handling and logging

The extension should preserve its existing soft-failure philosophy.

### Condition returns false

If `condition(ctx)` returns `false`, the rule is skipped and an info-level event is recorded:

- `rule skipped by condition`

### Condition returns non-boolean

If `condition(ctx)` returns a non-boolean value, the rule is skipped and a warn-level event is recorded:

- `condition returned non-boolean`

### Condition throws

If `condition(ctx)` throws, the rule is skipped and a warn-level event is recorded:

- `condition threw`

The thrown condition must not crash `before_agent_start` or abort the rest of the rule pipeline.

### Existing log behavior remains unchanged

Existing events such as the following remain valid and continue to work as they do today:

- `rule applied`
- `rule disabled`
- `rule did not match at application time`
- `replacement file not found`

No extra structured condition debug payloads are required for this design.

## Backward compatibility

This enhancement is fully backward compatible.

- existing `rules.ts` files continue to work unchanged
- `condition` is optional
- rules without `condition` keep current behavior
- disable-only overrides keep their current schema and semantics

Because `rules.ts` is already executable TypeScript, adding a function-valued `condition` fits the current authoring model without introducing a new config format.

## Implementation shape

### Type changes

Extend the enabled rule types to include an optional condition callback.

Conceptually:

```ts
type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  originalSystemPrompt: string;
  env: NodeJS.ProcessEnv;
};

type RuleCondition = (ctx: ConditionContext) => boolean;
```

`NormalizedLiteralRule` and `NormalizedRegexRule` gain:

```ts
condition?: RuleCondition;
```

Disable-only rules do not gain a condition field. If `condition` is present on a disable-only rule in `rules.ts`, it is ignored when the rule is normalized into `{ id, enabled: false }`.

`RawRule` types should also be updated so `rules.ts` can supply conditions without type errors.

### Runtime wiring

The extension currently modifies the prompt inside `before_agent_start`. The conditional feature should continue using that hook.

The `model` field should be sourced from Pi metadata using the same mechanism already used by `extensions/gemma-4-thinking-token/index.ts`: the metadata context passed to `before_agent_start`, specifically `ctx.model?.id` when available.

The entrypoint should therefore collect:

- `cwd` from `event.cwd ?? process.cwd()`
- `model` from `ctx.model?.id`
- `env` from `process.env`

If Pi does not expose a model identifier in a given runtime context, `model` is `undefined`.

`originalSystemPrompt` should be captured once at the start of `applyRulesToPrompt` from the incoming system prompt before any mutation. `systemPrompt` should continue to reflect the current prompt as the pipeline advances.

### Where condition evaluation belongs

Condition evaluation should happen inside `applyRulesToPrompt`, not in `index.ts`.

Reasoning:

- `applyRulesToPrompt` already owns ordered rule execution
- it already tracks the current prompt state as rules apply
- it can capture `originalSystemPrompt` once and preserve it unchanged for the lifetime of the pipeline
- evaluating conditions there guarantees `ctx.systemPrompt` reflects the current prompt, not a stale snapshot
- it keeps rule pipeline logic in one place rather than splitting it across multiple modules

A practical shape is to let `index.ts` pass stable runtime values into the application engine, and let the application engine construct the per-rule `ConditionContext` as it iterates.

### Validation expectations

No new declarative validation system is needed for `condition`.

Because `rules.ts` is executable TypeScript:

- a missing `condition` is valid
- a function-valued `condition` is valid
- a non-function `condition` makes the entire rule invalid and it is skipped during normalization with a warning

Malformed rules should not run. The extension should not strip a bad `condition` field and apply the rest of the rule anyway.

The extension does not need to inspect function internals or attempt to sandbox conditions.

## Documentation updates

Update `extensions/replace-prompt/docs/usage.md` to include:

- the new `condition` field in enabled rule examples
- the `ConditionContext` type and field meanings, including `originalSystemPrompt`
- the sync-only expectation
- the fact that conditions run against the current prompt state at rule evaluation time while also receiving `originalSystemPrompt`
- strict boolean evaluation behavior
- logging behavior for false, non-boolean, and thrown conditions
- at least one model-specific example using `ctx.model?.includes("claude") ?? false`

The documentation should also explicitly position conditions as fast predicate logic rather than a place for async or expensive work.

## Testing strategy

Add or update tests to cover:

1. enabled rule applies when `condition` returns `true`
2. enabled rule is skipped when `condition` returns `false`
3. a rule with a condition that returns a non-boolean truthy value such as `"claude"` is skipped and produces a warning event
4. thrown condition produces a warning event and skips the rule
5. when one rule's condition throws, the pipeline continues and subsequent rules still execute normally
6. later rules see prompt changes made by earlier rules through `ctx.systemPrompt`
7. `originalSystemPrompt` remains unchanged throughout the pipeline even after earlier rules modify the prompt
8. model identifier from the `before_agent_start` metadata context, using the same source as `gemma-4-thinking-token`, is exposed to the condition context
9. a disable-only rule with a `condition` field ignores the condition, remains disabled, and never evaluates the condition
10. existing rules without `condition` still behave unchanged
11. invalid non-function `condition` input makes the entire rule invalid and it is skipped during normalization

Integration coverage should include `before_agent_start` receiving both the event and the metadata context so model-aware conditions are tested end-to-end.

## Recommended scope boundary

This extension should stop at conditional replacement.

If future work needs async lookups, continuity systems, or external context retrieval, those belong in separate extensions rather than in `replace-prompt`. Expanding `replace-prompt` beyond conditional replacement would violate its single responsibility as a bounded prompt rewrite engine.

## Recommendation

Implement conditional rules as optional synchronous TypeScript predicates on enabled rules, evaluated inside the existing ordered replacement pipeline against a bounded and extensible `ConditionContext`.

This gives users direct expressive power, keeps the extension simple, avoids inventing a mini condition language, and cleanly supports the motivating model-specific use case.
