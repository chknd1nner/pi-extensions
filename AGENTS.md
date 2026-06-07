# AGENTS.md

This repository is for building and experimenting with Pi packages.

Before starting any work on a Pi package, consult the Pi documentation in `docs/pi/docs/` first. That path is a symlink to the installed `@earendil/pi` package docs.

## Package and bundle layout

This repo is the source of truth for Pi packages. Each package lives under `packages/<name>/` and is one of:

- **Single-extension package** (e.g. `replace-prompt`, `agent-switcher`): one `pi` manifest pointing at one source file or directory.
- **Bundle** (e.g. `delegate-driven-development`): a `pi` manifest exposing multiple sub-extensions (under `packages/<bundle>/extensions/<name>/`) and skills (under `packages/<bundle>/skills/<name>/`).

### Rules

- Do **not** copy package source into `.pi/extensions/` for dogfooding.
- Do **not** run `npm install` inside `.pi/extensions/<name>/` or commit nested `node_modules` trees.
- Dogfood local packages through `.pi/settings.json` entries that point at the **published git mirror** (`git:github.com/chknd1nner/<bundle>@<tag>` for stable, `@main` for ahead-of-stable). Local-path entries (`../packages/<name>`) are acceptable for active hot-loop development but should be replaced with mirror entries when the change is committed.
- `.pi/extensions/` is only for tiny project-local runtime config files such as `replace-prompt/rules.ts`.
- Manage Node dependencies from the repository root npm workspace. Use `npm install`, `npm test -w <package-name>`, and `npm run typecheck -w <package-name>`.
- Keep one workspace lockfile at the repo root (`package-lock.json`). Do not create per-package lockfiles during normal repo development.
- Each package directory must remain installable on its own as a Pi git package: keep its own `package.json` with a `pi` manifest, README, and `keywords: ["pi-package"]`.
- For package manifests, put Pi-provided packages in `peerDependencies` with `"*"`: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, and `typebox`.
- Put real third-party runtime imports in the package's `dependencies`; keep test/build-only tooling like `typescript` and `vitest` out of package runtime deps and in root `devDependencies` so npm hoists them to the root `node_modules` instead of recreating nested workspace installs.
- The root `package.json` owns the development install, and `.npmrc` pins npm's hoisted install strategy. When adding a runtime dependency to a package, add it to that package's `dependencies` for packaging and to root `devDependencies` for local deduplication, then run `npm install` at the root.
- Before deleting old dogfood copies under `.pi/extensions/`, diff them against `packages/<name>/` excluding `node_modules` and lockfiles, and preserve any intentional local config.

### Bundles: source layout

A bundle like `delegate-driven-development` looks like:

```
packages/delegate-driven-development/
  package.json              # name, version, pi manifest, peerDependencies
  tsconfig.json             # one tsconfig covering all sub-extensions
  README.md                 # consumer docs with install spec
  CHANGELOG.md              # maintained by scripts/release-bundle.sh
  extensions/
    delegate/{index.ts,...,tests/}
    session/{index.ts,tests/}
    tickets/{index.ts,tests/}
  skills/
    <skill-name>/SKILL.md
```

Sub-extension directories do **not** have their own `package.json` or `tsconfig.json` — they're code organisation, not separate publishable units.

### Releasing a bundle

Bundles publish to dedicated mirror repos (e.g. `chknd1nner/delegate-driven-development`) via `scripts/release-bundle.sh`. The release workflow is documented in `skills/releasing-a-bundle/SKILL.md` — read that skill before publishing.

The monorepo retains tags of the form `<bundle>-v<version>` (e.g. `delegate-driven-development-v0.1.0`) for traceability. The mirror repo carries the plain `v<version>` tags consumers install against.

## Tool usage notes

- `edit`: each `edits[]` entry accepts **only** `oldText` and `newText` (schema is `additionalProperties: false`). Never add extra keys like `newText2` or `_` — any stray key fails the entire call. To stage variants, finalize the value in `newText`; don't park drafts in extra fields.
