# Releasing a Bundle

Repo-specific reference guidance for agents (and humans) publishing a π package
bundle from this monorepo to its mirror repo. This is **not** an installed skill —
it is project reference material, kept out of `AGENTS.md` so it only loads when a
release is actually happening. `AGENTS.md` points here.

## When to use

The task is to release, publish, or ship a bundle — e.g.:
- "Release pi-delegate-driven-development v0.2.0"
- "Publish the latest changes to <bundle>"
- "Ship a patch for <bundle>"
- "Cut a new version of <bundle>"

Pi package bundles in this repo conventionally use a `pi-` prefix (e.g.
`pi-delegate-driven-development`, `pi-skills`). The bundle directory name under
`packages/`, the `name` field in `package.json`, and the mirror repo name on GitHub
all match.

If the task names a version, use it. Otherwise follow the version-picking decision
tree below before invoking the script.

## Two bundle shapes

Bundles come in two shapes, and a few checks below differ between them:

- **Extension bundles** (e.g. `pi-delegate-driven-development`): ship tools via a
  `pi.extensions` manifest, have TypeScript source, tests, and a typecheck script.
- **Skills-only / docs-only collections** (e.g. `pi-skills`): ship only skills via
  `pi.skills`, contain Markdown, and have **no** test or typecheck scripts and
  **no** tools. Wherever a step below assumes tests, typecheck, or tool surface,
  the "skills-only" note tells you the substitute.

To tell them apart: `node -e "const p=require('./packages/<bundle>/package.json'); console.log(Object.keys(p.pi), Object.keys(p.scripts||{}))"`.

## What this document does (and does not) cover

This is the **policy** layer. The **mechanics** live in `scripts/release-bundle.sh`
— a single deterministic bash script that handles version bump, changelog entry,
monorepo commit + tag, `git subtree split` to the mirror, mirror tag, and push.

Do not re-derive git commands. Always invoke the script.

## Pre-flight checklist

Before running the script, verify each of these. If any fails, stop and report.

1. **Bundle exists.** `ls packages/<bundle>/package.json` succeeds.
2. **Tests pass for the bundle.** Run `npm test -w <bundle>`. All pass.
   - **Skills-only note:** a docs-only bundle has no `test` script; `npm test -w
     <bundle>` errors with "Missing script: test" — that is expected, not a
     failure. Substitute: run `mdedit validate` on every `SKILL.md` and every
     reference file in the bundle, and confirm no `VALID` line reports issues.
3. **Typecheck clean.** Run `npm run typecheck -w <bundle>`. No errors.
   - **Skills-only note:** no `typecheck` script and no TypeScript — skip. Instead
     confirm each skill's frontmatter is exactly `name` + `description`, combined
     under 1024 characters (`awk '/^---$/{n++} n==1' SKILL.md | wc -c`).
4. **README accurately describes what consumers get.** Read
   `packages/<bundle>/README.md` and the `pi` field in
   `packages/<bundle>/package.json`. The README's "Install" example must match the
   bundle name; the list of extensions/skills described must match what's actually
   in the `pi` manifest.
   - **Skills-only note:** every skill directory under `skills/` must have a
     matching section in the README, and vice versa.
5. **No unresolved TODOs in changed bundle source.** `git log --oneline --
   packages/<bundle>/` since the last tag — scan for WIP/TODO/FIXME commit messages.
6. **Working tree clean and on `main`, in sync with `origin/main`.** The script
   enforces this, but check before doing version-picking work so you don't lose
   effort.
7. **For first release of a bundle:** the mirror repo must exist. Run:

   ```bash
   gh repo view chknd1nner/<bundle> >/dev/null 2>&1 || \
     gh repo create chknd1nner/<bundle> --public \
       --description "Pi package: <bundle>" \
       --homepage "https://github.com/chknd1nner/pi-extensions"
   ```

   The mirror starts empty; the first `release-bundle.sh` run will populate it via
   `--force-with-lease`.
8. **Signing key (optional but recommended).** `git config --get user.signingkey` —
   if set, tags will be signed. If not, the script warns and proceeds with unsigned
   tags. Ask whether to set up signing before publishing (one-time setup).

## Version-picking decision tree

If the task named a version, skip this. Otherwise:

1. Read the bundle's current version from `packages/<bundle>/package.json`.
2. Diff against the last release tag: `git diff <bundle>-v<current> --
   packages/<bundle>/`.
3. Classify the change:
   - **MAJOR** (`v1.0.0` → `v2.0.0`): breaking changes to tool names, tool
     parameter schemas, skill names, or required settings shape. For a skills
     collection, **renaming or removing a skill** is MAJOR — consumers reference
     skills by name.
   - **MINOR** (`v1.2.0` → `v1.3.0`): new tools, new skill capabilities, new
     optional parameters, additive changes. For a skills collection, **adding a new
     skill to the bundle** is MINOR.
   - **PATCH** (`v1.2.0` → `v1.2.1`): bug fixes, doc improvements, internal
     refactors with no consumer-visible change. For a skills collection, editing an
     existing skill's body or reference files (name/description unchanged) is PATCH.
4. Propose the version and confirm before invoking the script.

For the first release of a bundle, use `v0.1.0` (pre-1.0, expect breaking changes;
minor bumps for breaking changes are acceptable under semver convention for `0.x`).

## Invocation

```bash
./scripts/release-bundle.sh <bundle> <version>
```

Example:
```bash
./scripts/release-bundle.sh pi-delegate-driven-development v0.2.0
```

The script will:
- Open `$EDITOR` on the CHANGELOG for you to write the entry. Fill in real bullet
  points; do not leave the placeholder. (For non-interactive execution, set
  `EDITOR` to a small shim script — outside the repo so it doesn't dirty the tree —
  that overwrites the changelog path it receives as `$1` with the final content.)
- Commit the version bump + changelog, tag the monorepo, subtree-split the bundle,
  push to the mirror, tag the mirror, push everything.

If the script aborts mid-flight, do not improvise recovery. Read the error, fix the
underlying condition, and re-run. The script refuses to create duplicate tags, so
partial re-runs are safe up to the point where the monorepo tag was created.

## Post-flight verification (mandatory — evidence before declaring done)

After the script reports success, verify the published mirror actually installs
cleanly. Use a **project-local install in a throwaway directory** (`pi install -l`)
— it is fully isolated: settings and the git clone both land under the tmp dir's
`.pi/`, touching nothing global.

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
pi install -l git:github.com/chknd1nner/<bundle>@<version>
# Evidence 1: the cache contains the released commit
git -C .pi/git/github.com/chknd1nner/<bundle> log --oneline -1
```

**Evidence 2 — the session actually loads the new surface area.** This differs by
bundle shape (the `-a`/`--approve` flag is required: non-interactive `--print`
otherwise ignores untrusted project-local settings and silently skips the package):

- **Extension bundle:** ask about a new/changed tool.

  ```bash
  pi -a --print "Without calling any tools: does <new-or-changed tool> exist? \
  Quote its one-line description and any new parameters this release added."
  ```

  Expected: the session quotes the new tool/parameter descriptions verbatim.

- **Skills-only bundle:** there are no tools to quote — verify **skill
  discoverability** instead.

  ```bash
  pi -a --print "Without calling any tools: list the skills available to you whose \
  name contains '<skill-substring>'. Quote each one's description verbatim."
  ```

  Expected: the new/changed skill appears with its frontmatter `description` quoted
  verbatim.

```bash
cd - && rm -rf "$TMPDIR"
```

**Pitfalls (learned the hard way):**
- **Do not use `pi -e git:...` for verification.** It caches clones under
  `~/.pi/agent/tmp/extensions/git-github.com/<hash>/` keyed without the ref — a
  stale clone from an earlier run is silently served even when you request the new
  tag, making the new release look broken (or an old one look verified). If you must
  use `-e`, clear that cache first: `rm -rf ~/.pi/agent/tmp/extensions/git-github.com/*`.
- **Do not use bare `pi install`** (no `-l`) for verification: it installs
  **globally**, mutating `~/.pi/agent/settings.json` and leaking the bundle into
  every project until manually reverted. (Bare `pi install` is correct only when the
  intent is an explicit global install.)
- **Ask pointed questions about the release's new surface area**, not "list
  everything". A generic listing can look plausible even when a stale version
  loaded; quoting a brand-new tool description or skill description cannot.

If the new tool/skill is missing despite the cache showing the right commit, the
publish technically succeeded but the bundle's `pi` manifest is wrong. Open an
issue; do not re-publish under the same tag — bump to the next patch version with a
fix.

## Reporting back

Report:
- Mirror URL and tag URL.
- Install spec to paste into `.pi/settings.json`, or apply directly with
  `pi install -l git:github.com/chknd1nner/<bundle>@<version>` from the consuming
  project's root (updates that project's `.pi/settings.json` AND refreshes its
  `.pi/git/` cache in one step — editing settings.json alone leaves a stale cache).
- Output of the post-flight verification (the quoted tool/parameter or skill
  description).

Do not declare success without the verification output.
