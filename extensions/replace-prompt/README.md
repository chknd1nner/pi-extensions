# pi-replace-prompt

`pi-replace-prompt` is a Pi extension package that rewrites Pi's computed `systemPrompt` using ordered literal and regex rules.

It supports:
- global and project-local `rules.ts`
- project overrides by rule `id`
- disable-only overrides
- inline replacement text or `replacementFile`
- `mode: "first" | "all"`
- optional file logging

## Install

Local folder:

```bash
pi install ./extensions/replace-prompt
```

If you publish this folder as npm or its own git repo later, the same package is ready for:

```bash
pi install npm:pi-replace-prompt
pi install git:github.com/<you>/pi-replace-prompt
```

## Configure

The extension reads active config from the standard Pi extension locations:

- Global: `~/.pi/agent/extensions/replace-prompt/`
- Project: `.pi/extensions/replace-prompt/`

Create a `rules.ts` file in either location.

Minimal example:

```ts
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

And the replacement text file next to it:

```md
You are a specialised assistant focused on pragmatic, step-by-step code changes and clear explanations.
```

## Scope behavior

- global rules are loaded first
- project rules override global rules by matching `id`
- project-only rules are appended after inherited global rules
- `replacementFile` resolves from the project scope first, then the global scope

## Logging

Enable logging in `rules.ts`:

```ts
export default {
  logging: { file: true },
  rules: [/* ... */],
};
```

Logs are written to `replace-prompt.log` in the most specific installed scope.

## More docs

See [`docs/usage.md`](./docs/usage.md) for the full rule format and advanced examples.
