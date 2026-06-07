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

Drop your `rules.ts` file into one or both of these Pi extension config folders:

- User-scoped: `~/.pi/agent/extensions/replace-prompt/rules.ts`
- Project-scoped: `<your-project>/.pi/extensions/replace-prompt/rules.ts`

Use the user-scoped file for defaults you want in every project. Use the project-scoped file when a single repo needs different prompt rewrites.

This package ships with a commented starter `rules.ts` example, but the example rule is disabled by default (`enabled: false`) so nothing auto-applies until you customize it.

Minimal example:

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

And the replacement text file next to it:

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
