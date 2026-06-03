# pi-extensions

A workspace for building extensions for the Pi coding agent.

## Structure

- `extensions/` — Pi extension implementations and related prompts
- `extensions/brightdata/` — Bright Data search/fetch/PDF Pi tools
- `extensions/replace-opening/` — simple one-target prompt replacement example
- `extensions/replace-prompt/` — configurable multi-rule prompt replacement extension with merged global/project config

## Development dependency model

This repo uses one npm workspace install at the repository root. Run extension tests and typechecks from the root, for example:

```bash
npm test -w delegate-extension
npm run typecheck -w pi-tickets-extension
```

Extension package manifests still declare their own runtime `dependencies` for future publishing, while the root `package.json` mirrors those dependencies as dev dependencies so local development hoists everything into one root `node_modules`.

Project dogfooding should load local packages from `.pi/settings.json` using paths like `../extensions/delegate`; `.pi/extensions/` should contain only small runtime config files, not copied extension source or nested `node_modules` folders.
