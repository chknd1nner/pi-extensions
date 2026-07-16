# pi-replace-prompt

`pi-replace-prompt` is a Pi extension package that rewrites Pi's computed `systemPrompt` using ordered literal and regex rules.

It supports:
- global and project-local `rules.ts`
- project overrides by rule `id`
- disable-only overrides
- inline replacement text or `replacementFile`
- `mode: "first" | "all"`
- optional file logging
- provider-agnostic cache continuity for automatic post-tool turns

## Install

Local folder from this repository:

```bash
pi install ./packages/replace-prompt
```

If you publish this folder as npm or its own git repo later, the same package is ready for:

```bash
pi install npm:pi-replace-prompt
pi install git:github.com/<you>/pi-replace-prompt
```

## Configure

Drop your `rules.ts` file into one or both of these dedicated replace-prompt config folders:

- User-scoped: `~/.pi/agent/replace-prompt/rules.ts`
- Project-scoped: `<your-project>/.pi/replace-prompt/rules.ts`

Use the user-scoped file for defaults you want in every project. Use the project-scoped file when a single repo needs different prompt rewrites. The extension does not read config from Pi extension install folders such as `.pi/extensions/replace-prompt/`.

Minimal `rules.ts` example:

```ts
export default {
  rules: [
    {
      enabled: false,
      id: "replace-opening",
      type: "literal",
      target:
        "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.",
      replacementFile: "opening.md",
    },
  ],
};
```

And the replacement text file next to it in the same `replace-prompt` config folder:

```md
You are a specialised assistant focused on pragmatic, step-by-step code changes and clear explanations.
```

## Scope behavior

If both files exist, Pi loads them like this:

- user-scoped rules load first
- project-scoped rules override user-scoped rules when they use the same `id`
- project-only rules are appended after inherited user-scoped rules
- a project rule can disable an inherited user rule with `{ id: "same-id", enabled: false }`
- `replacementFile` resolves from the project scope first, then falls back to the user scope

## Automatic post-tool cache continuity

Pi can restore its base system prompt during a post-tool continuation of an automatically triggered turn. When a normal turn changes the system prompt, `replace-prompt` remembers the exact source and result and learns the unique provider-payload location containing that result. Later requests inspect only that learned location; if Pi restores the exact source there, the extension restores the exact result without running your rules again.

This is provider agnostic: the extension learns the payload path at runtime and does not contain provider-specific field mappings. Ambiguous, missing, stale, or context-mismatched paths fail open and leave the request unchanged.

This safety net assumes `replace-prompt` is the only extension mutating the system prompt through `before_agent_start`. If another extension also mutates the prompt, extension ordering can make the remembered source or result differ from Pi's actual fallback/final prompt. Ordinary rule chaining still follows Pi's normal extension order; the limitation matters specifically to automatic post-tool fallback restoration.

Identical prompts can improve cache-hit behavior only for providers and request paths that support prompt caching. The extension does not guarantee cache accounting or quota outcomes.

## Logging

Enable logging in `rules.ts`:

```ts
export default {
  logging: { file: true },
  rules: [/* ... */],
};
```

Logs are written to `replace-prompt.log` in the most specific config scope.

## More docs

See [`docs/usage.md`](./docs/usage.md) for the full rule format and advanced examples.
