# Model-Friendly Edit Tools for Pi

## Status

Proposed new Pi extension.

Working package name: `pi-edit-tools`  
Final package name: TBD.

This extension is a new project. It does not replace or evolve `edit-field-guard`; that package remains a compatibility guard for Pi's native `edit` schema.

## Summary

`pi-edit-tools` replaces Pi's model-facing `edit` tool contract and adds a dedicated `multi_edit` tool while continuing to use Pi's native edit implementation as the filesystem mutation backend.

The extension exists to reduce tool-call failures at their source rather than merely repairing malformed calls after the model has attempted to use Pi's current nested edit schema.

The extension exposes two model-facing operations:

```text
edit(path, oldText, newText)
```

for the common case of one targeted replacement, and:

```text
multi_edit(path, edits[])
```

for multiple independent replacements in one file.

Both tools translate their inputs into Pi's native representation:

```ts
{
  path,
  edits: [
    { oldText, newText }
  ]
}
```

and delegate execution to Pi's `createEditToolDefinition()` implementation.

The extension therefore changes the **LLM-facing API**, not Pi's underlying editing semantics.

---

# Motivation

Pi currently exposes a single `edit` tool with this conceptual schema:

```ts
{
  path: string,
  edits: [
    {
      oldText: string,
      newText: string
    }
  ]
}
```

Pi's current implementation requires even a single replacement to be placed inside `edits[]`; multiple replacements are represented through that same array.

In practice, models sometimes struggle with this contract. Pi's own compatibility code documents cases where models emit `edits` as a JSON string, and Pi also retains compatibility for legacy top-level `oldText` / `newText` arguments.

The existing `edit-field-guard` extension was created from similar empirical failures: malformed fields, numbered fields, misplaced top-level fields, stringified arrays and related schema errors.

The new extension addresses the likely root causes instead:

1. Make the overwhelmingly common single-replacement operation structurally trivial.
2. Separate single-edit and batch-edit concepts.
3. Align with editing patterns already common in major coding-agent harnesses.
4. Avoid unnecessary nested JSON for large source-code strings where model-native tool-call formats can represent top-level strings more naturally.
5. Retain limited, deterministic compatibility recovery for common model mistakes.

---

# Design Principles

## 1. Optimise the happy path before repairing the unhappy path

The primary tool contract should be easy for a model to emit correctly.

Compatibility logic exists as defence in depth. It must not compensate for an unnecessarily difficult canonical schema.

## 2. One edit is a scalar operation

A single targeted replacement should require exactly three conceptual values:

```text
path
oldText
newText
```

No array and no nested object are required.

## 3. Multiple edits deserve a separate operation

Batching has genuinely different semantics and structural requirements.

It should therefore be represented by a distinct `multi_edit` tool rather than making every ordinary `edit` call pay the complexity cost of batching.

## 4. Reuse Pi's backend

This extension must not fork or reimplement Pi's matching, diffing, line-ending handling, BOM handling, file writes or mutation queue.

Pi's current edit implementation already performs those functions and serialises mutations to the same file through its file mutation queue.

The extension is an adapter around that implementation.

## 5. Be forgiving only when intent is unambiguous

Known aliases and common typographical mistakes may be repaired automatically.

Ambiguous input must fail rather than risk changing the wrong text.

The extension must never partially execute a request merely because part of it could be understood.

---

# Research Basis

The canonical interface is informed by publicly observable tool conventions, but the design must not claim knowledge of proprietary model training data.

Claude Code has historically exposed separate `Edit` and `MultiEdit` concepts. Public Claude Code transcripts and issue reports show `MultiEdit` receiving `file_path` plus an `edits` array containing `old_string` and `new_string`, while ordinary `Edit` uses top-level `file_path`, `old_string` and `new_string`.

OpenCode similarly exposes an ordinary edit operation with top-level file, old-string and new-string arguments.

These systems therefore share a broad structural convention:

```text
single edit
    file
    old string
    new string
```

even though their naming conventions differ.

The existence of these patterns in widely used coding harnesses makes it reasonable to assume that frontier coding models may have strong behavioural priors around them. This is an inference, not a claim about any model's private post-training corpus.

OpenAI Codex follows another major convention: patch-oriented editing through `apply_patch`. This extension should not imitate that interface because doing so would require replacing Pi's editing semantics rather than adapting them.

Open-weight model chat templates provide an additional structural reason to prefer scalar parameters. Some templates give top-level scalar string arguments special handling while nested mappings and sequences are JSON-serialised. Large source strings placed inside an `edits` array can therefore incur escaping requirements that equivalent top-level strings avoid.

No single schema can perfectly reproduce every model's native harness conventions. The goal is instead to choose a low-complexity structure that overlaps with several established conventions and provide narrow compatibility aliases around it.

---

# Tool 1: `edit`

## Purpose

Perform exactly one targeted replacement in one existing file.

This is the preferred editing tool unless more than one independent region of the same file needs to change.

## Canonical Schema

```ts
const editSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to the file to edit, relative or absolute."
    }),

    oldText: Type.String({
      description:
        "Exact existing text to replace. Keep it as small as possible while still uniquely identifying the intended location."
    }),

    newText: Type.String({
      description:
        "Replacement text."
    }),
  },
  {
    additionalProperties: false
  }
);
```

All three properties are required.

The provider-visible JSON schema must remain simple and strict.

There must be no `edits` array in the advertised `edit` schema.

## Description

Suggested tool description:

> Edit one location in one file using exact text replacement. Provide the file path, the exact existing text, and its replacement. Use `multi_edit` instead when changing multiple separate locations in the same file.

## Prompt Guidance

The extension should contribute concise system-prompt guidance:

```text
Use edit for one exact replacement in a file.

oldText must identify one unique region. Keep it as small as possible while remaining unique.

For multiple separate replacements in the same file, use multi_edit rather than inventing numbered fields or issuing parallel edits to that file.
```

The tool description should explicitly distinguish `edit` from `multi_edit`.

---

# Tool 2: `multi_edit`

## Purpose

Perform multiple non-overlapping targeted replacements against one file in a single filesystem operation.

## Canonical Schema

```ts
const editItemSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact existing text for this replacement. It must uniquely identify a region of the original file."
    }),

    newText: Type.String({
      description:
        "Replacement text for this region."
    }),
  },
  {
    additionalProperties: false
  }
);

const multiEditSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to the file to edit, relative or absolute."
    }),

    edits: Type.Array(editItemSchema, {
      minItems: 1,
      description:
        "Targeted replacements to apply to the same file."
    }),
  },
  {
    additionalProperties: false
  }
);
```

Although the description should recommend `multi_edit` for two or more replacements, the implementation should accept a one-item array rather than forcing an unnecessary retry.

## Semantics

`multi_edit` inherits Pi's native batch semantics.

Every `oldText` is matched against the **original file contents**, not against the result of earlier edits in the same call.

Entries therefore must not overlap or nest.

Nearby changes that affect the same logical block should be combined into one replacement.

## Description

Suggested tool description:

> Apply one or more independent exact-text replacements to a single file in one operation. Each oldText is matched against the original file, so edits must not overlap or nest. Prefer `edit` for a single replacement.

---

# Pre-Validation Compatibility Layer

The extension should use Pi's `ToolDefinition.prepareArguments` hook for compatibility repair.

Pi defines `prepareArguments` as a compatibility shim that runs before schema validation, and Pi's native `edit` uses this mechanism for argument compatibility.

This is preferable to the current `edit-field-guard` technique of advertising an intentionally loose schema.

The model should see a strict canonical contract.

Malformed but recognisable calls should be normalised before that contract is validated.

---

# Canonical Naming

The extension's canonical names are:

```text
path
oldText
newText
edits
```

These retain Pi's existing terminology and avoid introducing gratuitous naming changes.

Compatibility aliases should nevertheless recognise conventions commonly seen in other coding harnesses.

## Path Aliases

Recognise:

```text
path
filePath
file_path
filepath
file
filename
```

Canonical output:

```text
path
```

## Old Text Aliases

Recognise at minimum:

```text
oldText
oldString
old_string
old_text
oldtext
oldTex
search
find
from
before
target
original
```

Canonical output:

```text
oldText
```

## New Text Aliases

Recognise at minimum:

```text
newText
newString
new_string
new_text
newtext
newTex
replacement
replaceWith
replace_with
to
after
updated
```

Canonical output:

```text
newText
```

Alias matching should normalise casing and common separators where safe.

The implementation should use an explicit alias table rather than treating every property beginning with `old` or `new` as valid.

---

# Repair Rules for `edit`

`prepareArguments` should perform the following operations in order.

## Canonical input

```ts
{
  path,
  oldText,
  newText
}
```

Return unchanged.

## Known field aliases

For example:

```ts
{
  file_path,
  old_string,
  new_string
}
```

normalises to:

```ts
{
  path,
  oldText,
  newText
}
```

## One-item nested edit

For compatibility with Pi-style or MultiEdit-style output:

```ts
{
  path,
  edits: [
    {
      oldText,
      newText
    }
  ]
}
```

may be flattened into the scalar schema.

Nested aliases should also be recognised.

## Stringified one-item `edits`

If `edits` is supplied as a JSON string, parse it only when it produces a valid one-entry edit array.

## Numbered typo with one apparent pair

For an input such as:

```ts
{
  path,
  oldText,
  newText2
}
```

where there is exactly one identifiable old value and one identifiable new value, treat `newText2` as `newText`.

Likewise for the inverse.

## Multiple apparent replacements

If an `edit` call clearly contains more than one old/new pair, do **not** execute only the first pair.

Do not guess.

Return an actionable failure such as:

```text
edit accepts one replacement. This call contains multiple replacement pairs. Use multi_edit for multiple changes to the same file.
```

This case should become uncommon because the model is explicitly given `multi_edit`.

---

# Repair Rules for `multi_edit`

`prepareArguments` for `multi_edit` may be more permissive because batching is the purpose of the tool.

It should recognise:

- canonical `edits[]`;
- Claude Code-style `old_string` / `new_string`;
- OpenCode-style `oldString` / `newString`;
- Pi-style `oldText` / `newText`;
- `edits` accidentally encoded as a JSON string;
- top-level single `oldText` / `newText`, wrapping them as one item;
- safely identifiable numbered pairs such as `oldText2` / `newText2`;
- common path aliases.

Numbered fields should be paired by suffix.

For example:

```ts
{
  path,
  oldText: "A",
  newText: "B",
  oldText2: "C",
  newText2: "D"
}
```

may safely become:

```ts
{
  path,
  edits: [
    { oldText: "A", newText: "B" },
    { oldText: "C", newText: "D" }
  ]
}
```

Unpaired numbered fields must not be guessed.

---

# Ambiguity Policy

Automatic repair is allowed only where there is one reasonable interpretation.

The extension must reject rather than guess when:

- multiple possible path fields contain different values;
- multiple candidate old-text fields conflict;
- multiple candidate new-text fields conflict;
- numbered old/new fields cannot be paired safely;
- an `edit` call contains several complete replacement pairs;
- parsing a stringified `edits` value does not produce the expected structure.

Unknown properties that are irrelevant after a complete, unambiguous canonical call has been recovered may be discarded.

No repair may alter the contents of an `oldText` or `newText` string.

---

# Native Pi Adapter

Both model-facing tools route into the same native backend.

The extension should import:

```ts
createEditToolDefinition
```

from `@earendil-works/pi-coding-agent`.

Maintain native definitions per working directory:

```ts
const realByCwd = new Map<string, ReturnType<typeof createEditToolDefinition>>();

function realFor(cwd: string) {
  let tool = realByCwd.get(cwd);

  if (!tool) {
    tool = createEditToolDefinition(cwd);
    realByCwd.set(cwd, tool);
  }

  return tool;
}
```

## `edit` Transformation

Model-facing:

```ts
{
  path,
  oldText,
  newText
}
```

becomes:

```ts
{
  path,
  edits: [
    {
      oldText,
      newText
    }
  ]
}
```

Then delegates to the native edit definition's `execute` method.

## `multi_edit` Transformation

Model-facing:

```ts
{
  path,
  edits
}
```

already matches Pi's backend representation after compatibility normalisation.

It is passed directly to the native implementation.

---

# Behaviour Preserved From Pi

By routing all actual edits through `createEditToolDefinition`, the extension must preserve:

- Pi's exact-text matching behaviour;
- uniqueness requirements;
- non-overlapping batch-edit rules;
- LF/CRLF handling;
- BOM handling;
- filesystem access behaviour;
- generated diff text;
- unified patch details;
- first-changed-line metadata;
- abort handling;
- Pi's per-file mutation queue.

The extension must not duplicate this logic.

---

# Rendering

The replacement should preserve Pi's native edit preview and result presentation.

For `multi_edit`, native rendering can be reused almost directly after normalisation.

For scalar `edit`, rendering should adapt the visible scalar arguments into native form:

```ts
{
  path,
  edits: [
    { oldText, newText }
  ]
}
```

before delegating to the native renderer.

Any renderer context containing the original tool arguments should likewise be adapted so Pi's diff-preview machinery sees the native representation it expects.

The model-facing schema must not be changed merely to simplify TUI rendering.

---

# Registration

The extension registers a tool named:

```text
edit
```

thereby replacing Pi's built-in tool of the same name.

The extension additionally registers:

```text
multi_edit
```

as a new tool.

The original native edit implementation remains available internally through `createEditToolDefinition()` but is no longer exposed directly to the model.

---

# Execution and Concurrency

The extension should not force global sequential tool execution.

Pi may execute sibling tool calls concurrently, but its native edit backend serialises mutations targeting the same resolved file.

The system prompt should nevertheless encourage `multi_edit` when several regions of one file are known in advance.

This reduces:

- repeated file reads and writes;
- stale-context failures between related edits;
- unnecessary tool calls;
- ambiguity about ordering.

Edits to unrelated files remain free to execute concurrently.

---

# Repair Feedback

Compatibility recovery should favour reliability over nagging the model.

Routine recognised aliases such as:

```text
file_path -> path
old_string -> oldText
new_string -> newText
```

do not need to inject warnings into the model context.

More substantial repairs may optionally be exposed in debug logging or a transient TUI notification.

The extension should not add verbose warning text to every successful tool result because that consumes context and may reinforce malformed forms by repeatedly showing them to the model.

A debug mode may record:

```text
tool
repair type
original field names
canonical field names
model/provider
timestamp
```

for evaluation.

No source-code string contents should be logged by default.

---

# Errors

Errors produced by the compatibility layer should be short and corrective.

Examples:

```text
edit requires path, oldText, and newText.
```

```text
edit received multiple replacement pairs. Use multi_edit for multiple changes to one file.
```

```text
multi_edit could not pair oldText2 with a corresponding newText2.
```

Once canonicalisation succeeds, backend errors should pass through from Pi unchanged wherever practical.

---

# Non-Goals

This extension does not:

- create a new matching algorithm;
- make fuzzy matching more permissive;
- implement `apply_patch`;
- emulate Codex's patch DSL;
- add file creation or deletion;
- add `replaceAll`;
- bypass Pi path or filesystem behaviour;
- implement its own mutation locking;
- change Pi's diff format;
- silently choose among ambiguous edits.

Any future work in those areas should be separate from the model-interface problem this extension is intended to solve.

---

# Suggested Project Structure

```text
packages/pi-edit-tools/
├── index.ts
├── schemas.ts
├── normalize.ts
├── native-adapter.ts
├── README.md
├── package.json
└── tests/
    ├── normalize-edit.test.ts
    ├── normalize-multi-edit.test.ts
    ├── adapter.test.ts
    └── schemas.test.ts
```

`normalize.ts` should be framework-light and independently testable.

`native-adapter.ts` should contain the smallest possible Pi-specific translation layer.

---

# Testing

## Schema Tests

Assert that the provider-visible `edit` schema contains exactly:

```text
path: string
oldText: string
newText: string
```

with all fields required and no `edits` property.

Assert that `multi_edit` exposes only:

```text
path
edits[]
```

with canonical `oldText` / `newText` entries.

## Compatibility Tests

Test aliases from:

- Pi;
- Claude Code conventions;
- OpenCode conventions;
- observed common typos.

Test stringified `edits`.

Test numbered pairs.

Test conflicting aliases.

Test malformed and ambiguous inputs.

## Backend Tests

Mock or wrap `createEditToolDefinition()` and verify that:

```ts
edit({ path, oldText, newText })
```

results in exactly:

```ts
native.execute({
  path,
  edits: [{ oldText, newText }]
})
```

Verify that `multi_edit` preserves edit ordering and contents.

## Integration Tests

Against real temporary files, verify parity with native Pi for:

- ordinary replacement;
- multiline replacement;
- quotes;
- backslashes;
- template literals;
- JSON;
- JSX/HTML;
- CRLF files;
- BOM files;
- duplicate matches;
- missing matches;
- multiple disjoint edits;
- overlapping edits;
- concurrent calls targeting the same file.

---

# Model Evaluation

The extension should be evaluated empirically against:

1. native Pi `edit`;
2. `edit-field-guard`;
3. the new scalar `edit` / `multi_edit` replacement.

Primary initial models should be current frontier Claude and GPT coding models, with selected open-weight tool-calling models used to test portability.

Measure:

```text
first-call schema validity
prepareArguments repair rate
backend success rate
number of retries
tool-call output tokens
reasoning tokens where observable
malformed field patterns
wrong-tool selection: edit vs multi_edit
```

The benchmark should include source strings deliberately hostile to JSON escaping:

```text
quotes
backslashes
embedded JSON
regular expressions
multiline strings
template literals
JSX
Python triple-quoted strings
mixed indentation
```

The purpose is not merely to prove that the new tool works.

The key hypothesis is:

> A dedicated scalar `edit` tool will materially reduce malformed calls and retries compared with exposing Pi's nested `edits[]` representation for every edit.

A secondary hypothesis is:

> A dedicated `multi_edit` tool will be more reliable than asking models to infer that the ordinary `edit` tool changes shape when multiple replacements are required.

---

# Acceptance Criteria

The first release is complete when:

1. `edit` exposes only required top-level `path`, `oldText`, and `newText` strings.
2. `multi_edit` exposes `path` plus an `edits` array.
3. Both use strict provider-visible schemas.
4. `prepareArguments` repairs documented aliases and common unambiguous mistakes before validation.
5. Ambiguous repairs fail without modifying files.
6. Every successful mutation is executed by Pi's native edit backend.
7. Native diff, patch, line-ending, BOM and mutation-queue behaviour is preserved.
8. Scalar and multi-edit calls retain native TUI diff previews.
9. Unit and integration tests cover canonical input, compatibility input and failure cases.
10. No functionality from `edit-field-guard` is required for this extension to operate.
11. `edit-field-guard` can remain installed only if explicitly desired for separate testing; production configuration should not expose two competing overrides for the same `edit` tool.

---

# Architectural Principle

The extension should remain conceptually simple:

```text
                     MODEL
                       │
             ┌─────────┴─────────┐
             │                   │
           edit              multi_edit
    path / oldText /       path / edits[]
        newText                 │
             │                   │
             └─────────┬─────────┘
                       │
                prepareArguments
             aliases + typo repair
                       │
                       ▼
             Native Pi representation
             { path, edits: [...] }
                       │
                       ▼
            createEditToolDefinition
                       │
                       ▼
                    FILE
```

The extension owns the **interface**.

Pi continues to own the **editing engine**.

The design succeeds when the compatibility layer becomes boring because models usually call the canonical tools correctly on the first attempt.
