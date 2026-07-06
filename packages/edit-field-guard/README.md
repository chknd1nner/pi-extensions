# edit-field-guard

A Pi extension that makes the built-in `edit` tool **forgiving**. Agents
frequently emit malformed `edit` arguments — a stray `newText2`/`newText3`, a
typo like `newTex`, numbered `oldText2`/`newText2` pairs, or top-level
`oldText`/`newText`. Because the built-in `edit` schema is
`additionalProperties: false`, any of these fails schema validation and forces
the model to **re-send the entire tool call** (every byte of `oldText` /
`newText`) — burning your token allowance for nothing.

This extension repairs those inputs in place, runs the edit anyway, and emits a
warning back to the agent so it stops making the same mistake.

## How it works

Pi validates tool arguments **before** the `tool_call` extension event fires:

```
prepareArguments  ->  validateToolArguments  ->  beforeToolCall (tool_call event)  ->  execute
                          ^ throws here on a bad field; tool_call never runs
```

So a `tool_call` hook is too late — the call is already rejected. The only
pre-validation seam available to an extension is a tool definition's own schema
and `execute`. This extension therefore **registers a tool named `edit`**, which
replaces the built-in (extension tools are applied after built-ins by name in
Pi's tool registry).

The replacement:

- Uses a **lenient schema** (extra properties allowed, fields optional) so the
  call never fails validation. Field descriptions still advertise the correct
  `{ oldText, newText }` shape.
- **Sanitises** the input via [`sanitizeEditInput`](./lib.ts):
  - strips unknown/non-conforming fields,
  - remaps typos & aliases (`newTex`, `new_text`, `replacement`, `from`/`to`, …),
  - expands numbered pairs (`oldText2`/`newText2`) into separate edits,
  - parses `edits` supplied as a JSON string,
  - lifts top-level `oldText`/`newText` into the `edits` array,
  - accepts `file_path` as `path`.
- **Delegates** the cleaned input to the real built-in edit implementation
  (`createEditToolDefinition`), so behaviour, diffing, and rendering are
  identical.
- When a repair was needed, **prepends a warning** to the tool result (so the
  agent reads it) and shows a transient UI notice.

If the input is genuinely unrecoverable (no `path`, no usable pairs), it returns
a clear, actionable error instead of a cryptic validation dump.

## Install

Dogfood locally via `.pi/settings.json`:

```json
{
  "extensions": ["../packages/edit-field-guard"]
}
```

or, once published to a git mirror, via a `packages` entry.

## Development

```bash
npm run typecheck -w edit-field-guard
npm test -w edit-field-guard
```

The repair logic in `lib.ts` is framework-free and covered by `tests/lib.test.ts`.
