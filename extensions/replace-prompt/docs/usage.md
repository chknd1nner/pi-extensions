# replace-prompt extension guide

This extension lets you rewrite Pi's computed `systemPrompt` with an ordered set of literal and regex rules.

It supports:
- global and project-local `rules.ts`
- project overrides by rule `id`
- disable-only overrides
- inline replacement text or `replacementFile`
- `mode: "first" | "all"`
- optional file logging

## Installation locations

You can install the extension in either or both of these places:

- Global: `~/.pi/agent/extensions/replace-prompt/`
- Project: `<your-project>/.pi/extensions/replace-prompt/`

The extension looks for a `rules.ts` file inside each installed scope.

## Minimal file layout

### Global-only

```text
~/.pi/agent/extensions/replace-prompt/
├── index.ts
├── rules.ts
└── opening.md
```

### Global + project override

```text
~/.pi/agent/extensions/replace-prompt/
├── index.ts
├── rules.ts
└── opening.md

<project>/.pi/extensions/replace-prompt/
├── index.ts
├── rules.ts
└── opening.md
```

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

Use this in project config to turn off an inherited global rule:

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

The file path is resolved relative to the extension directory.

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

1. project extension directory
2. global extension directory

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

`~/.pi/agent/extensions/replace-prompt/opening.md`

```md
Global opening text
```

### Project file only

`<project>/.pi/extensions/replace-prompt/opening.md`

```md
Project opening text
```

With no project `rules.ts` override at all, the inherited rule still uses the project file first if the project extension directory exists.

## Logging behavior

Logging is silent by default unless `logging.file: true` is enabled.

When enabled, logs are written to:
- project extension dir if it is actually installed
- otherwise global extension dir

Log file name:

```text
replace-prompt.log
```

Typical events include:
- rule applied
- rule disabled
- rule did not match at application time
- replacement file not found

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
// ~/.pi/agent/extensions/replace-prompt/rules.ts
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
<!-- ~/.pi/agent/extensions/replace-prompt/opening.md -->
You are a specialised assistant focused on pragmatic, step-by-step code changes and clear explanations.
```

## Example 2: project disables a global rule and adds a regex cleanup

```ts
// <project>/.pi/extensions/replace-prompt/rules.ts
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
- logs write to `<project>/.pi/extensions/replace-prompt/replace-prompt.log` if that directory exists

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
