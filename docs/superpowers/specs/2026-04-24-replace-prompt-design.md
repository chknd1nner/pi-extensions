# Replace Prompt Extension Design

Date: 2026-04-24
Status: Proposed

## Overview

Build a new Pi extension named `replace-prompt` modelled after `extensions/replace-opening/index.ts`, but generalized so users can configure multiple prompt replacements from a single TypeScript config file stored beside the extension entrypoint.

The extension supports installation in either or both of these locations:

- Global: `~/.pi/agent/extensions/replace-prompt/`
- Project-local: `.pi/extensions/replace-prompt/`

When installed in both locations, configuration is merged. Project-local configuration takes precedence over global configuration.

## Goals

- Replace multiple arbitrary strings in Pi's computed system prompt
- Keep configuration user-editable and ergonomic
- Use a single all-in-one `rules.ts` file per extension location
- Allow rules to use either inline replacement text or replacement files
- Support both literal and regex matching
- Support global + project-local configuration merging
- Preserve intuitive rule ordering after merge
- Allow projects to disable inherited global rules with minimal config
- Keep runtime behavior silent by default
- Provide optional file logging for diagnostics

## Non-goals

- Supporting prompt modifications outside `before_agent_start` in v1
- Supporting JSON or YAML config formats in v1
- Supporting arbitrary transform types beyond replacement
- Providing UI notifications for normal operation or warnings
- Reordering rules via priority fields

## User-facing folder layout

Each installed scope uses this structure:

```text
replace-prompt/
  index.ts
  rules.ts
  *.md
  replace-prompt.log   # optional, if file logging is enabled
```

Examples:

```text
~/.pi/agent/extensions/replace-prompt/
  index.ts
  rules.ts
  opening.md
  replace-prompt.log

.pi/extensions/replace-prompt/
  index.ts
  rules.ts
  project-guidance.md
  replace-prompt.log
```

## Configuration format

The config file is `rules.ts` and exports a single default object.

Example:

```ts
export default {
  logging: {
    file: true,
  },
  rules: [
    {
      id: "replace-opening",
      type: "literal",
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
      replacementFile: "opening.md",
    },
    {
      id: "style-guidance",
      type: "literal",
      target: "Be concise in your responses",
      replacement: "Be concise but not cryptic. Prefer short, clear explanations.",
      mode: "all",
    },
    {
      id: "multiline-guidance",
      type: "regex",
      target: /Be concise[\s\S]*?Show file paths clearly when working with files/i,
      replacementFile: "style-block.md",
    },
  ],
};
```

Minimal disable-only override:

```ts
export default {
  rules: [
    {
      id: "replace-opening",
      enabled: false,
    },
  ],
};
```

## Rule schema

The extension supports three rule shapes.

### Disable-only override rule

Used mainly in project-local config to disable an inherited global rule.

```ts
{
  id: string;
  enabled: false;
}
```

No other fields are required.

### Literal rule

```ts
{
  id: string;
  enabled?: true;
  type: "literal";
  target: string;
  replacement?: string;
  replacementFile?: string;
  mode?: "first" | "all";
}
```

### Regex rule

```ts
{
  id: string;
  enabled?: true;
  type: "regex";
  target: RegExp;
  replacement?: string;
  replacementFile?: string;
  mode?: "first" | "all";
}
```

### Validation rules

- `id` is required for every rule
- `id` must be a non-empty kebab-case string
- duplicate rule IDs within the same `rules.ts` file are invalid; the first occurrence wins, later duplicates are skipped, and the issue is logged
- `enabled` defaults to `true` for full rules
- a full rule with `enabled: false` behaves the same as a disable-only override for the same `id`
- `type` is required for full rules and must be either `"literal"` or `"regex"`
- `target` must be a string for `literal` rules and a native `RegExp` for `regex` rules
- `target: ""` is invalid for literal rules and is skipped with a log entry
- exactly one of `replacement` or `replacementFile` must be present for full rules
- `replacement: ""` is valid and means delete the matched text
- `mode` defaults to `"first"`
- a disable-only rule with `enabled: false` may omit all other fields
- invalid rules are skipped and logged rather than crashing the extension

## Merge model

If both global and project-local configs exist, the extension loads both and merges them by rule `id`.

### Precedence

- Project-local config wins over global config on `id` collisions
- Project-local config options also win over global config options
- A project-local disable-only rule suppresses the corresponding global rule entirely

### Ordering

The final rule list is ordered as follows:

1. Start with global rules in their declared order
2. For each project-local rule:
   - if its `id` matches an existing inherited rule, replace that rule in place and keep the inherited slot
   - if its `id` is new, append it to the end in project declaration order

This preserves user expectations:

- overridden rules keep their relative position
- new project rules appear after inherited ones

## Replacement content resolution

Each full rule can specify replacement content in one of two ways.

### Inline replacement

```ts
{
  replacement: "new prompt text"
}
```

### File-backed replacement

```ts
{
  replacementFile: "opening.md"
}
```

When `replacementFile` is used, file lookup order is:

1. project-local extension directory
2. global extension directory

This precedence applies regardless of where the rule originated. If both scopes contain the same replacement filename, the project-local file wins.

If no matching file is found or a file cannot be read, the rule is skipped and the issue is logged.

When file logging is enabled, file-resolution log lines must be explicit about:

- the rule `id`
- the candidate project path
- the candidate global path
- which path won, if any

This is required because project-first lookup intentionally allows local file content to override inherited global rules without redefining the rule itself.

## Matching and replacement behavior

### Hook choice

The extension modifies the prompt only in `before_agent_start`.

Reasoning:

- `before_agent_start` is the documented hook for modifying the system prompt
- the feature goal is to keep replacements active for each user prompt
- additional hooks such as `context` or `before_provider_request` are unnecessary for v1

### Literal rules

- match exact string content only
- default to replacing the first occurrence
- support replacing all occurrences via `mode: "all"`

### Regex rules

- use native JavaScript `RegExp` values in `target`
- require explicit `type: "regex"` to avoid ambiguity
- support multiline and flag-based matching through the supplied regex
- default to replacing the first occurrence
- support replacing all occurrences via `mode: "all"`

### `g` flag behavior

`mode` is the single source of truth for replacement cardinality.

Implementation behavior:

- the extension normalizes user regexes before use
- the user-supplied `g` flag is ignored/stripped
- when `mode === "first"`, replacement behaves as non-global
- when `mode === "all"`, replacement behaves as global

This avoids JavaScript `RegExp.lastIndex` pitfalls and keeps string and regex rule semantics aligned.

### Line ending normalization

To reduce silent mismatches between authored config and Pi's runtime prompt, the extension should normalize line endings to `\n` before matching and replacement.

Normalization applies to:

- the incoming `systemPrompt`
- inline literal targets
- replacement text loaded from files
- inline replacement text

Regex sources themselves are not rewritten, but matching is performed against the normalized prompt text. This makes LF/CRLF differences predictable while keeping the user-facing behavior simple.

## Ordered rule execution

Enabled rules are applied top-to-bottom using the final merged rule list.

Consequences:

- earlier replacements may change or remove text that later rules expect to match
- later rules are still attempted in order
- if an enabled rule finds no match at application time, the extension logs that outcome and continues

The extension should not claim certainty about why a rule did not match. Diagnostics should say that the rule did not match at application time and may have been affected by earlier replacements.

## Logging and diagnostics

### Default behavior

The extension is silent by default:

- no UI notifications
- no normal console noise
- no file output unless enabled

### File logging

File logging can be enabled via config:

```ts
export default {
  logging: {
    file: true,
  },
  rules: [],
};
```

### Log destination

When file logging is enabled, the log file is written to the most specific installed extension directory:

- if the project-local extension exists, write to `.pi/extensions/replace-prompt/replace-prompt.log`
- otherwise, if only the global extension exists, write to `~/.pi/agent/extensions/replace-prompt/replace-prompt.log`

This keeps logs beside the config and replacement files the user is most likely editing.

### Logged events

File logging should capture at least:

- config files discovered
- config load/import failures
- invalid rule definitions
- duplicate rule IDs skipped within a single scope
- merge decisions by rule `id`
- disable-only overrides
- replacement file resolution decisions, including both candidate paths and the winning path
- replacement file read failures
- rule applied successfully
- rule enabled but no match found
- prompt line-ending normalization behavior when relevant to troubleshooting
- overall no-op outcomes

Severity can be represented in log lines, but normal runtime behavior remains non-interactive.

## Failure handling

The extension should fail softly and avoid disrupting Pi startup or normal prompt handling.

### Expected soft-failure cases

- one config file fails to import: continue with the other scope if available
- an individual rule is invalid: skip it and log the reason
- a replacement file is missing or unreadable: skip that rule and log the reason
- an enabled rule finds no match: log it and continue
- no config exists in either scope: behave as a no-op

The extension only returns a modified `systemPrompt` when at least one valid replacement was applied.

## Internal architecture

The implementation should use a small set of focused modules rather than placing all logic in a single file.

Recommended structure:

- `index.ts` — registers the `before_agent_start` hook and coordinates the pipeline
- `load-config.ts` — discovers scope directories, imports `rules.ts`, validates and normalizes config
- `merge-rules.ts` — merges global and project-local configs by `id` while preserving ordering semantics
- `resolve-replacement.ts` — resolves inline text or file-backed replacement content with project-first file precedence
- `apply-rules.ts` — applies normalized rules in order and records outcomes
- `logging.ts` — optional file logger and log event formatting

This keeps loading, merging, execution, and logging concerns separate and makes the extension easier to evolve.

## Suggested internal normalized model

The runtime should normalize user config into explicit internal structures before applying rules.

Suggested concepts:

- `ScopeConfig`
  - scope: `"global" | "project"`
  - baseDir
  - logging config
  - validated rules
- `MergedConfig`
  - final ordered rules
  - effective logging config
  - discovered directories
  - active log path
- `NormalizedRule`
  - id
  - enabled
  - matcher kind
  - normalized target
  - replacement source kind
  - replacement source value
  - mode
  - source scope

This normalization layer keeps the runtime predictable and reduces special cases during application.

## Testing strategy

Core automated tests should cover:

1. single-scope literal replacement
2. single-scope regex replacement
3. default `first` behavior
4. explicit `all` behavior
5. regex `g` ignored in favor of `mode`
6. global + project merge by `id`
7. project disable-only override
8. project override preserving inherited order
9. new project rule appending at the end
10. project replacement file winning over global file
11. enabled rule with no match
12. missing replacement file
13. invalid rule skipped safely
14. no-op behavior when nothing changes
15. logging path selection based on most specific installed scope

## Example user scenarios

### Scenario 1: Replace Pi's opening line globally

A user installs `replace-prompt` in `~/.pi/agent/extensions/replace-prompt/`, defines one literal rule, and stores replacement text in `opening.md`. The extension replaces the standard opening line for all projects.

### Scenario 2: Override one inherited rule in a project

A project also installs `replace-prompt` locally and defines a rule with the same `id` as the global rule. The project version replaces the global version but keeps the same slot in the execution order.

### Scenario 3: Disable a global rule in one project

The project defines only:

```ts
{ id: "replace-opening", enabled: false }
```

The inherited global rule is suppressed without redefining its target or replacement.

### Scenario 4: Share a global rule but override its file content locally

A global rule references `opening.md`. A project creates its own `opening.md` in the local extension folder. The project-local file is used automatically, even if the rule itself came from the global config.

## Open implementation decisions intentionally deferred

The design leaves the following as implementation details rather than user-facing contract:

- exact log line format and timestamp format
- whether config loading is cached between prompts or re-read every `before_agent_start`
- whether tests are colocated beside modules or grouped separately
- exact TypeScript type organization across modules

These can be decided during planning and implementation without changing the user-facing behavior.

## Recommended implementation approach

Implement this as a lightweight extension-specific engine with clear modules and a single runtime hook (`before_agent_start`). Avoid building a generalized prompt transform framework in v1.

This gives the extension enough structure to remain maintainable while keeping the user-facing model simple and aligned with the original `replace-opening` extension.