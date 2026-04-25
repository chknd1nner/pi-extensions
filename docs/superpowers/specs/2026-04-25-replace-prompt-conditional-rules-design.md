# Replace Prompt Conditional Rules Design

Date: 2026-04-25
Status: Proposed

## Overview

Add optional conditional execution to `extensions/replace-prompt` so enabled rules may decide at runtime whether they should apply.

The feature is intended to stay small and bounded:

- rule authors write plain TypeScript directly in `rules.ts`
- conditions are synchronous predicate functions
- conditions receive a documented runtime context object
- false or thrown conditions skip the rule rather than disrupting Pi startup

The first motivating use case is model-specific prompt replacement, such as only applying a rule when the active model identifier contains `"claude"`.

## Goals

- Allow prompt replacement rules to run conditionally at runtime
- Keep the feature backward compatible with existing `rules.ts` files
- Preserve the extension's current ordered top-to-bottom rule pipeline
- Let conditions inspect a bounded context object rather than raw extension internals
- Support model-specific rules without requiring a new extension or a declarative DSL
- Keep failure handling soft and aligned with current replace-prompt behavior
- Leave room to extend the condition context later without breaking existing configs

## Non-goals

- Supporting async conditions in v1
- Designing a condition-specific DSL such as `modelIncludes`, `cwdMatches`, or `envEquals`
- Turning `replace-prompt` into a general context injection or memory system
- Providing helper libraries for conditions in v1
- Adding UI-level debugging or a condition trace viewer
- Supporting long-running lookups, network access, or other expensive rule predicates as a first-class use case

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

Disable-only overrides remain minimal and unchanged:

```ts
{
  id: "replace-opening",
  enabled: false,
}
```

## Condition context

The condition function receives a bounded runtime context object:

```ts
type ConditionContext = {
  model?: string;
  cwd: string;
  systemPrompt: string;
  env: NodeJS.ProcessEnv;
};
```

### Field semantics

- `model` is the active model identifier if Pi exposes one for the current run; otherwise `undefined`
- `cwd` is the current working directory for the session
- `systemPrompt` is the current prompt state at the moment the rule is being considered
- `env` is `process.env`

This context is intentionally small. Future enhancements may add more fields, but v1 should not expose extension-specific merge internals or other unnecessary details.

## Evaluation semantics

### Ordered pipeline behavior

Rule order does not change. Rules still execute top-to-bottom.

For each rule:

1. If the rule is disabled, skip it
2. If the rule has a `condition`, evaluate it synchronously against the current runtime context
3. If the condition returns `false`, skip the rule
4. If the condition throws, skip the rule and emit a warning log event
5. If the condition returns `true` or is absent, continue with replacement resolution and normal rule application

### Current prompt, not original prompt

`ctx.systemPrompt` must reflect the prompt state at the point in the pipeline where the rule is evaluated, not the original unmodified prompt from the start of `before_agent_start`.

This keeps conditions aligned with the extension's existing ordered transform model and allows later rules to react to changes introduced by earlier rules.

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
  ],
};
```

Under this design, the second rule can see the marker introduced by the first rule if the first rule already ran.

## Failure handling and logging

The extension should preserve its existing soft-failure philosophy.

### Condition returns false

If `condition(ctx)` returns `false`, the rule is skipped and an info-level event is recorded:

- `rule skipped by condition`

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

No extra structured condition debug payloads are required in v1.

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
  env: NodeJS.ProcessEnv;
};

type RuleCondition = (ctx: ConditionContext) => boolean;
```

`NormalizedLiteralRule` and `NormalizedRegexRule` gain:

```ts
condition?: RuleCondition;
```

Disable-only rules do not gain a condition field.

`RawRule` types should also be updated so `rules.ts` can supply conditions without type errors.

### Runtime wiring

The extension currently modifies the prompt inside `before_agent_start`. The conditional feature should continue using that hook.

The runtime has two sources of condition context:

- `event`, which already provides `cwd` and `systemPrompt`
- the hook context, which can provide model metadata such as `ctx.model?.id`

The entrypoint should therefore collect:

- `cwd` from `event.cwd ?? process.cwd()`
- `model` from the hook context if present
- `env` from `process.env`

However, `systemPrompt` cannot be fixed once up front, because conditions need to see the current prompt as the pipeline advances.

### Where condition evaluation belongs

Condition evaluation should happen inside `applyRulesToPrompt`, not in `index.ts`.

Reasoning:

- `applyRulesToPrompt` already owns ordered rule execution
- it already tracks the current prompt state as rules apply
- evaluating conditions there guarantees `ctx.systemPrompt` reflects the current prompt, not a stale snapshot
- it keeps rule pipeline logic in one place rather than splitting it across multiple modules

A practical shape is to let `index.ts` pass stable runtime values into the application engine, and let the application engine construct the per-rule `ConditionContext` as it iterates.

### Validation expectations

No new declarative validation system is needed for `condition`.

Because `rules.ts` is executable TypeScript:

- a missing `condition` is valid
- a function-valued `condition` is valid
- non-function `condition` values should be treated as invalid rule input and skipped under the extension's existing soft-failure approach

The extension does not need to inspect function internals or attempt to sandbox conditions in v1.

## Documentation updates

Update `extensions/replace-prompt/docs/usage.md` to include:

- the new `condition` field in enabled rule examples
- the `ConditionContext` type and field meanings
- the sync-only expectation
- the fact that conditions run against the current prompt state at rule evaluation time
- logging behavior for false and thrown conditions
- at least one model-specific example using `ctx.model?.includes("claude")`

The documentation should also explicitly position conditions as fast predicate logic rather than a place for async or expensive work.

## Testing strategy

Add or update tests to cover:

1. enabled rule applies when `condition` returns `true`
2. enabled rule is skipped when `condition` returns `false`
3. thrown condition produces a warning event and skips the rule
4. later rules see prompt changes made by earlier rules through `ctx.systemPrompt`
5. model identifier from the hook context is exposed to the condition context
6. existing rules without `condition` still behave unchanged
7. invalid non-function `condition` input is skipped safely

Integration coverage should include `before_agent_start` receiving both the event and the hook context so model-aware conditions are tested end-to-end.

## Recommended scope boundary

This feature should stop at conditional replacement.

If future work needs long-running lookups, continuity systems, or external context retrieval, that should be designed as a separate extension or system rather than expanding `replace-prompt` into a broader runtime context engine.

## Recommendation

Implement conditional rules as optional synchronous TypeScript predicates on enabled rules, evaluated inside the existing ordered replacement pipeline against a bounded and extensible `ConditionContext`.

This gives users direct expressive power, keeps the extension simple, avoids inventing a mini condition language, and cleanly supports the motivating model-specific use case.
