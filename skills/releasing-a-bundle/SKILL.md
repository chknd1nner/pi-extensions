---
name: releasing-a-bundle
description: Use when the user asks to release, publish, or ship a Pi package bundle from this monorepo. Encodes pre-flight checks, version-picking policy, invocation of scripts/release-bundle.sh, and post-flight verification against the mirror repo.
---

# Releasing a Bundle

## When to use

The user says things like:
- "Release delegate-driven-development v0.2.0"
- "Publish the latest changes to <bundle>"
- "Ship a patch for <bundle>"
- "Cut a new version of <bundle>"

If the user names a version, use it. If they don't, follow the version-picking decision tree below before invoking the script.

## What this skill does (and does not) do

This skill is the **policy** layer. The **mechanics** live in `scripts/release-bundle.sh` — a single deterministic bash script that handles version bump, changelog entry, monorepo commit + tag, `git subtree split` to the mirror, mirror tag, and push.

Do not re-derive git commands. Always invoke the script.

## Pre-flight checklist

Before running the script, verify each of these. If any fails, stop and report to the user.

1. **Bundle exists.** `ls packages/<bundle>/package.json` succeeds.
2. **Tests pass for the bundle.** Run `npm test -w <bundle>`. All pass.
3. **Typecheck clean.** Run `npm run typecheck -w <bundle>`. No errors.
4. **README accurately describes what consumers get.** Read `packages/<bundle>/README.md` and the `pi` field in `packages/<bundle>/package.json`. The README's "Install" example must match the bundle name; the list of extensions/skills described must match what's actually in the `pi` manifest.
5. **No unresolved TODOs in changed bundle source.** `git log --oneline -- packages/<bundle>/` since the last tag — scan for WIP/TODO/FIXME commit messages.
6. **Working tree clean and on `main`, in sync with `origin/main`.** The script enforces this, but check before doing version-picking work so you don't lose effort.
7. **For first release of a bundle:** the mirror repo must exist. Run:

   ```bash
   gh repo view chknd1nner/<bundle> >/dev/null 2>&1 || \
     gh repo create chknd1nner/<bundle> --public \
       --description "Pi package: <bundle>" \
       --homepage "https://github.com/chknd1nner/pi-extensions"
   ```

   The mirror starts empty; the first `release-bundle.sh` run will populate it via `--force-with-lease`.
8. **Signing key (optional but recommended).** `git config --get user.signingkey` — if set, tags will be signed. If not, the script warns and proceeds with unsigned tags. Ask the user whether they want to set up signing before publishing (one-time setup).

## Version-picking decision tree

If the user named a version, skip this. Otherwise:

1. Read the bundle's current version from `packages/<bundle>/package.json`.
2. Diff against the last release tag: `git diff <bundle>-v<current> -- packages/<bundle>/`.
3. Classify the change:
   - **MAJOR** (`v1.0.0` → `v2.0.0`): breaking changes to tool names, tool parameter schemas, skill names, or required settings shape.
   - **MINOR** (`v1.2.0` → `v1.3.0`): new tools, new skill capabilities, new optional parameters, additive changes.
   - **PATCH** (`v1.2.0` → `v1.2.1`): bug fixes, doc improvements, internal refactors with no consumer-visible change.
4. Propose the version to the user and confirm before invoking the script.

For first release of a bundle, use `v0.1.0` (pre-1.0, expect breaking changes; minor bumps for breaking changes are acceptable under semver convention for `0.x`).

## Invocation

```bash
./scripts/release-bundle.sh <bundle> <version>
```

Example:
```bash
./scripts/release-bundle.sh delegate-driven-development v0.2.0
```

The script will:
- Open `$EDITOR` on the CHANGELOG for you to write the entry. Fill in real bullet points; do not leave the placeholder.
- Commit the version bump + changelog, tag the monorepo, subtree-split the bundle, push to the mirror, tag the mirror, push everything.

If the script aborts mid-flight, do not improvise recovery. Read the error, fix the underlying condition, and re-run. The script refuses to create duplicate tags, so partial re-runs are safe up to the point where the monorepo tag was created.

## Post-flight verification (mandatory — evidence before declaring done)

After the script reports success, verify the published mirror actually installs cleanly:

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
pi -e git:github.com/chknd1nner/<bundle>@<version> --print \
  "List the tools and skills provided by the <bundle> package, then exit. Do not call any tools."
cd - && rm -rf "$TMPDIR"
```

Expected: Pi clones the mirror at the new tag, then lists the expected tools/skills.

If the listing is missing a tool or skill that should be there, the publish technically succeeded but the bundle's `pi` manifest is wrong. Open an issue, do not re-publish under the same tag — bump to the next patch version with a fix.

## Reporting back

Report to the user:
- Mirror URL and tag URL.
- Install spec they can paste into `.pi/settings.json`.
- Output of the post-flight verification (the tool/skill list Pi printed).

Do not declare success without the verification output.
