# replace-prompt extension guide

This extension lets you rewrite Pi's computed `systemPrompt` with an ordered set of literal and regex rules.

It supports:
- global and project-local `rules.ts`
- project overrides by rule `id`
- disable-only overrides
- inline replacement text or `replacementFile`
- `mode: "first" | "all"`
- optional file logging

## Config locations

Put your `rules.ts` file in one or both of these places:

- User-scoped: `~/.pi/agent/replace-prompt/rules.ts`
- Project-scoped: `<your-project>/.pi/replace-prompt/rules.ts`

Use the user-scoped file for defaults you want across all projects. Use the project-scoped file when one repo needs its own overrides.

The extension looks for a `rules.ts` file inside each replace-prompt config folder. It does not read deprecated extension install folders such as `.pi/extensions/replace-prompt/` or `~/.pi/agent/extensions/replace-prompt/`.

## Minimal file layout

### Global-only

```text
~/.pi/agent/replace-prompt/
├── rules.ts
└── opening.md
```

### Global + project override

```text
~/.pi/agent/replace-prompt/
├── rules.ts
└── opening.md

<project>/.pi/replace-prompt/
├── rules.ts
└── opening.md
```

If both files exist, project scope wins for matching rule ids. That means you can keep a general user-scoped rule set and override or disable specific rules per project without touching your global defaults.

## `rules.ts` shape

`rules.ts` must `export default` an object:

```ts
export default {
  logging: { file: true },
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target: "Hello",
      replacement: "Hi",
      mode: "first",
    },
  ],
};
```

## Top-level config

### `logging`

```ts
logging: { file: true }
```

- `true` enables file logging
- `false` disables file logging for that scope
- omitted means "inherit from global" for project config

### `rules`

`rules` is an ordered array. Rules run top-to-bottom.

## Rule fields

Every rule needs an `id`.

```ts
id: "replace-opening"
```

Rule ids must be **kebab-case**:
- valid: `replace-opening`, `remove-guidelines`
- invalid: `replace_opening`, `ReplaceOpening`

### Enabled rule

```ts
{
  id: "replace-opening",
  type: "literal",
  target: "Hello",
  replacement: "Hi"
}
```

### Disable-only override

Use this in project config to turn off an inherited user-scoped rule:

```ts
{
  id: "replace-opening",
  enabled: false,
}
```

## Literal rules

Use `type: "literal"` for exact text matching.

```ts
{
  id: "replace-opening",
  type: "literal",
  target: "You are an expert coding assistant operating inside pi.",
  replacement: "You are a concise assistant specialised in prompt rewriting.",
  mode: "first",
}
```

Notes:
- `target` must be a non-empty string
- literal replacements treat replacement text as plain text
- `$&`, `$$`, `$'`, and ``$` `` are **not** expanded for literal rules

## Regex rules

Use `type: "regex"` when exact text is too brittle.

```ts
{
  id: "remove-guidelines-block",
  type: "regex",
  target: /Guidelines:[\s\S]*?End Guidelines/,
  replacement: "",
  mode: "first",
}
```

Notes:
- `target` must be a real `RegExp`
- regex replacements use normal JavaScript `String.replace(...)` behavior
- capture-group substitutions work normally for regex rules

## Replacement sources

You must provide **exactly one** of:
- `replacement`
- `replacementFile`

### Inline replacement

```ts
{
  id: "replace-opening",
  type: "literal",
  target: "Hello",
  replacement: "Hi",
}
```

### File-backed replacement

```ts
{
  id: "replace-opening",
  type: "literal",
  target: "Hello",
  replacementFile: "opening.md",
}
```

The file path is resolved relative to the config folder.

## `mode`

`mode` controls whether the first match or all matches are replaced.

### First match only

```ts
mode: "first"
```

### All matches

```ts
mode: "all"
```

If omitted, `mode` defaults to `"first"`.

### Important regex note

If you use a regex with the `g` flag, the extension ignores that flag and uses `mode` instead.

So these behave the same:

```ts
{ target: /abc/g, mode: "all", ... }
{ target: /abc/, mode: "all", ... }
```

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
},
{
  id: "note-original-greeting",
  type: "literal",
  target: "[CLAUDE]",
  replacement: "[CLAUDE-ORIGINAL-HELLO]",
  condition: (ctx) => ctx.originalSystemPrompt.startsWith("Hello"),
},
```

### Condition result handling

- `true` → rule continues normally
- `false` → rule is skipped and logs `rule skipped by condition`
- non-boolean → rule is skipped and logs `condition returned non-boolean`
- throw → rule is skipped and logs `condition threw`

Conditions are intentionally synchronous and should stay limited to fast environment checks.

## Line ending normalization

The extension normalizes line endings to `\n` before matching and replacement.

That means CRLF/LF differences alone should not stop a rule from matching.

## Merge behavior: global + project

If both scopes exist:
- global rules load first
- project rules override global rules by matching `id`
- an override keeps the original global position
- project-only rules append at the end

### Example

### Global `rules.ts`

```ts
export default {
  logging: { file: true },
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target: "Hello",
      replacementFile: "opening.md",
    },
    {
      id: "strip-guidelines",
      type: "regex",
      target: /Guidelines:[\s\S]*?End/,
      replacement: "",
      mode: "first",
    },
  ],
};
```

### Project `rules.ts`

```ts
export default {
  rules: [
    {
      id: "replace-opening",
      enabled: false,
    },
    {
      id: "append-project-note",
      type: "literal",
      target: "Hi",
      replacement: "Hi from project",
      mode: "first",
    },
  ],
};
```

### Effective order

1. `replace-opening` → overridden in place with `{ enabled: false }`
2. `strip-guidelines` → inherited from global
3. `append-project-note` → appended from project

## Project replacement files win over global replacement files

If an enabled rule uses `replacementFile`, the extension checks for that file in this order:

1. project config folder
2. global config folder

This means a project can reuse an inherited global rule id and just provide a local replacement file.

### Example

### Global `rules.ts`

```ts
export default {
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target: "Hello",
      replacementFile: "opening.md",
    },
  ],
};
```

### Global file

`~/.pi/agent/replace-prompt/opening.md`

```md
Global opening text
```

### Project file only

`<project>/.pi/replace-prompt/opening.md`

```md
Project opening text
```

With no project `rules.ts` override at all, the inherited rule still uses the project file first if the project config folder exists.

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

The environment fingerprint deliberately covers every environment entry because conditions receive the complete `process.env`. Consequently, even a change to an environment variable unrelated to a particular rule causes a conservative fail-open no-op. If the environment changes between `before_agent_start` and the first provider request, path learning is skipped for that request; a later normal agent start records a fresh identity.

The exact source/result strings already capture conditions based on `originalSystemPrompt` and sequential `systemPrompt` state.

Condition functions can technically read external process state through JavaScript closures. State outside the documented `ConditionContext` cannot be tracked and should not be used when reliable automatic fallback restoration matters.

### Extension ordering limitation

Fallback restoration assumes `replace-prompt` is the only extension mutating the system prompt through `before_agent_start`.

- An earlier mutator can make the recorded source differ from Pi's base fallback prompt.
- A later mutator can make the recorded result differ from the final provider-facing prompt.

Ordinary replacement still participates in Pi's normal extension chaining. This limitation applies specifically to the provider-boundary repair of automatic post-tool turns.

### Dynamic tool loading

Pi's dynamic tool loading lets an extension activate additional tools mid-run with `pi.setActiveTools()`. This interacts with restoration only when a newly activated tool contributes `promptSnippet` or `promptGuidelines`, because that metadata rebuilds the system prompt after a transformation has already been recorded.

- Activating a tool whose definition changes only the payload tool block (no `promptSnippet` or `promptGuidelines`) does not affect the learned system-prompt path, and restoration continues normally.
- Activating a tool that contributes `promptSnippet` or `promptGuidelines` rebuilds the system prompt. The recorded source and result then no longer match the rebuilt prompt, so the next provider request fails open with a single `provider prompt path was stale` log. Restoration resumes only after the next normal `before_agent_start` re-applies the rules to the new prompt.

Tools that are active from session start are unaffected: their prompt metadata is part of the initial prefix and never triggers a mid-run rebuild.

### Cache expectations

Sending the same exact replaced prompt preserves a necessary cache-prefix invariant. Actual cache reads, accounting, and quota behavior still depend on the provider, model, request shape, and provider-side cache support.

## Logging behavior

Logging is silent by default unless `logging.file: true` is enabled.

When enabled, logs are written to:
- project config folder when `<project>/.pi/replace-prompt/` exists
- otherwise global config folder when `~/.pi/agent/replace-prompt/` exists

Log file name:

```text
replace-prompt.log
```

Typical events include:
- rule applied
- rule disabled
- rule did not match at application time
- replacement file not found
- provider prompt path learned
- provider fallback prompt restored
- provider prompt path was not found or was ambiguous
- provider prompt path was stale

Provider-boundary logs contain event descriptions only. They never include the source prompt, replacement prompt, provider payload, or environment contents. Discovery and stale-path warnings are emitted at most once per remembered transformation.

## Soft-failure behavior

The extension skips bad or unusable rules instead of crashing Pi startup.

Examples of skipped inputs:
- invalid rule id
- duplicate id later in the same `rules.ts`
- empty literal target
- both `replacement` and `replacementFile`
- neither `replacement` nor `replacementFile`
- missing/unreadable `replacementFile`

## Complete examples

## Example 1: simple global literal replacement

```ts
// ~/.pi/agent/replace-prompt/rules.ts
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
<!-- ~/.pi/agent/replace-prompt/opening.md -->
You are a specialised assistant focused on pragmatic, step-by-step code changes and clear explanations.
```

## Example 2: project disables a global rule and adds a regex cleanup

```ts
// <project>/.pi/replace-prompt/rules.ts
export default {
  rules: [
    {
      id: "replace-opening",
      enabled: false,
    },
    {
      id: "remove-extra-guidelines",
      type: "regex",
      target: /Extra Guidelines:[\s\S]*?End Extra Guidelines/,
      replacement: "",
      mode: "first",
    },
  ],
};
```

## Example 3: project-specific replacement text via file override

```ts
// global rules.ts
export default {
  logging: { file: true },
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target: "Hello",
      replacementFile: "opening.md",
    },
  ],
};
```

```md
<!-- global opening.md -->
Global hello
```

```md
<!-- project opening.md -->
Project hello
```

Result in that project:
- prompt uses `Project hello`
- logs write to `<project>/.pi/replace-prompt/replace-prompt.log` if that directory exists

## Authoring checklist

Before using a config, check:
- `rules.ts` uses `export default`
- each rule id is unique within that file
- rule ids are kebab-case
- each enabled rule has exactly one of `replacement` or `replacementFile`
- literal `target` strings are non-empty
- regex `target` values are real regex literals
- `mode` is only `"first"` or `"all"`
- `condition` callbacks, if used, must return an explicit boolean

## Good default pattern

If you're unsure where to start, use this:

```ts
export default {
  logging: { file: true },
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
      replacementFile: "opening.md",
      mode: "first",
    },
  ],
};
```
