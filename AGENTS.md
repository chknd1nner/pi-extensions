# AGENTS.md

This repository is for building and experimenting with Pi extensions.

Before starting any work on a Pi extension, consult the Pi documentation in `docs/pi/docs/` first. That path is a symlink to the installed `@earendil/pi` package docs.

## Dependency and extension layout

This repo is the source of truth for Pi extensions. Finished or in-progress extension source lives under `extensions/<name>/`.

- Do **not** copy extension source into `.pi/extensions/` for dogfooding.
- Do **not** run `npm install` inside `.pi/extensions/<name>/` or commit nested `node_modules` trees.
- Dogfood local extensions through `.pi/settings.json` package entries that point back to `../extensions/<name>` (paths are relative to `.pi/settings.json`). `.pi/extensions/` is only for tiny project-local runtime config files such as `replace-prompt/rules.ts`.
- Manage Node dependencies from the repository root npm workspace. Use `npm install`, `npm test -w <workspace-name>`, and `npm run typecheck -w <workspace-name>`.
- Keep one workspace lockfile at the repo root (`package-lock.json`). Do not create per-extension lockfiles during normal repo development.
- Each extension directory should still remain packageable on its own: keep its own `package.json`, `pi.extensions` manifest, and runtime source/assets in that directory.
- For package manifests, put Pi-provided packages in `peerDependencies` with `"*"`: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, and `typebox`.
- Put real third-party runtime imports in the extension's `dependencies`; keep test/build-only tooling like `typescript` and `vitest` out of extension runtime deps.
- The root `package.json` owns the development install, and `.npmrc` pins npm's hoisted install strategy. Extension-level `devDependencies` are OK for future standalone extraction, but mirror common dev tools and workspace runtime deps in root `devDependencies` so npm hoists them to the root `node_modules` instead of recreating nested workspace installs. When adding a runtime dependency to an extension, add it to that extension's `dependencies` for packaging and to root `devDependencies` for local deduplication, then run `npm install` at the root.
- Before deleting old dogfood copies under `.pi/extensions/`, diff them against `extensions/<name>/` excluding `node_modules` and lockfiles, and preserve any intentional local config.

## Tool usage notes

- `edit`: each `edits[]` entry accepts **only** `oldText` and `newText` (schema is `additionalProperties: false`). Never add extra keys like `newText2` or `_` — any stray key fails the entire call. To stage variants, finalize the value in `newText`; don't park drafts in extra fields.
