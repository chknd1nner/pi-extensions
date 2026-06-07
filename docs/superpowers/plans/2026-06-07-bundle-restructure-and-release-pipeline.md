# Bundle Restructure and Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worktree:** Before executing Task 1, the executor must use the `superpowers:using-git-worktrees` skill to create an isolated worktree for this restructure. The repo's current `.worktrees/` directory is git-ignored and ready for this.

**Goal:** Restructure the monorepo from per-extension dirs to per-bundle Pi packages, consolidate the delegate/session/tickets extensions + delegate-driven-development skill into one publishable bundle, and build a single-command release pipeline that mirrors each bundle to its own published git repo so consumers can install via `git:github.com/chknd1nner/<bundle>@<tag>`.

**Architecture:** Top-level `extensions/` becomes `packages/`. Each subdirectory is one Pi package — either a single-extension package (one source file + manifest, e.g. `replace-prompt`) or a *bundle* (multiple extensions + skills under one `pi` manifest, e.g. `delegate-driven-development`). Bundle source lives once at `packages/<bundle>/` in the monorepo and is mirrored to a dedicated public repo `chknd1nner/<bundle>` at release time via `git subtree split`. Consumers install from the mirror with a pinned ref. A 50-line bash script (`scripts/release-bundle.sh`) automates the publish; a skill (`releasing-a-bundle`) encodes when and how to use it.

**Tech Stack:** Bash, git (subtree, signed tags), `gh` CLI, Pi packages (`pi-coding-agent` git installer), Vitest (existing test runner), TypeScript (existing tsconfig pattern).

---

## File Structure

**New files:**
- `packages/delegate-driven-development/package.json` — bundle manifest with `pi` field listing all three extensions + skills dir.
- `packages/delegate-driven-development/tsconfig.json` — single tsconfig covering all sub-extensions.
- `packages/delegate-driven-development/README.md` — consumer-facing docs.
- `packages/delegate-driven-development/CHANGELOG.md` — version history (created lazily by release script).
- `packages/delegate-driven-development/.gitignore` — `node_modules/` etc. for the mirror clone.
- `scripts/release-bundle.sh` — the release mechanism.
- `skills/releasing-a-bundle/SKILL.md` — the release policy/playbook.

**Renamed (git mv, history-preserving):**
- `extensions/` → `packages/` (all subdirs).
- `extensions/delegate/{*.ts,tests/}` → `packages/delegate-driven-development/extensions/delegate/`.
- `extensions/session/{*.ts,tests/}` → `packages/delegate-driven-development/extensions/session/`.
- `extensions/tickets/{*.ts,tests/}` → `packages/delegate-driven-development/extensions/tickets/`.
- `skills/delegate-driven-development/` → `packages/delegate-driven-development/skills/delegate-driven-development/`.

**Deleted (after consolidation):**
- `packages/delegate/` (now empty — source moved into bundle).
- `packages/session/` (same).
- `packages/tickets/` (same).
- Per-extension `package.json` and `tsconfig.json` inside the three consolidated extensions (not separately publishable anymore).

**Modified:**
- `package.json` (root) — `workspaces: ["packages/*"]` and remove now-unused per-extension dev dep entries that are already at root.
- `.pi/settings.json` — collapse two local entries into one bundle entry, then later switch to mirror URL.
- `AGENTS.md` — vocabulary update (packages, not extensions, as the unit of distribution).

---

### Task 1: Establish worktree and capture baseline

**Files:**
- No code changes — this task captures the green-tests baseline so later tasks can verify nothing regressed.

- [ ] **Step 1: Create isolated worktree via skill**

Use the `superpowers:using-git-worktrees` skill. Target branch name: `feature/bundle-restructure`. All subsequent tasks run inside that worktree.

- [ ] **Step 2: Confirm `gh` CLI is authenticated**

Run: `gh auth status`
Expected output contains: `Logged in to github.com account chknd1nner`

If not authenticated: stop and ask the user to run `gh auth login` before proceeding.

- [ ] **Step 3: Capture baseline test status**

Run: `npm test -w delegate-extension -w session-extension -w pi-tickets-extension`
Expected: all three workspaces report passing (or note any pre-existing failures).

Record the test count for each in the worker's notes. Later tasks must show the same count of passing tests after the move.

- [ ] **Step 4: Capture baseline typecheck**

Run: `npm run typecheck -w delegate-extension -w session-extension -w pi-tickets-extension`
Expected: no errors from any workspace.

- [ ] **Step 5: Commit a marker (no file changes)**

```bash
git commit --allow-empty -m "chore: start bundle restructure (baseline captured)"
```

---

### Task 2: Rename `extensions/` to `packages/`

**Files:**
- Rename: `extensions/` → `packages/`
- Modify: `package.json` (root): `"workspaces": ["extensions/*"]` → `"workspaces": ["packages/*"]`
- Modify: `.pi/settings.json`: relative paths `../extensions/delegate` and `../extensions/tickets` → `../packages/delegate` and `../packages/tickets`.

- [ ] **Step 1: Rename the directory**

Run:
```bash
git mv extensions packages
```

Verify with: `ls packages/`
Expected output: `agent-switcher  archive  brightdata  delegate  replace-prompt  session  styles  tickets`

- [ ] **Step 2: Update root `package.json` workspaces**

Edit `package.json`:

```json
{
  "name": "pi-extensions-workspace",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  ...
}
```

- [ ] **Step 3: Update dogfood `.pi/settings.json`**

Edit `.pi/settings.json`:

```json
{
  "packages": [
    "../packages/delegate",
    "../packages/tickets",
    "git:github.com/obra/superpowers"
  ]
}
```

- [ ] **Step 4: Reinstall workspaces and verify tests still pass**

Run:
```bash
rm -rf node_modules packages/*/node_modules
npm install
npm test -w delegate-extension -w session-extension -w pi-tickets-extension
```

Expected: same passing test counts as Task 1 Step 3.

- [ ] **Step 5: Verify Pi still loads the dogfooded extensions**

Run: `pi config`
Expected: an interactive menu shows the `delegate` and `tickets` extensions as enabled (read the menu, then press `q` or Ctrl-C to exit without changes).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename extensions/ to packages/ (unit of distribution is the package)"
```

---

### Task 3: Scaffold the `delegate-driven-development` bundle

**Files:**
- Create: `packages/delegate-driven-development/package.json`
- Create: `packages/delegate-driven-development/tsconfig.json`
- Create: `packages/delegate-driven-development/README.md`
- Create: `packages/delegate-driven-development/.gitignore`

- [ ] **Step 1: Create the bundle directory**

```bash
mkdir -p packages/delegate-driven-development/extensions
mkdir -p packages/delegate-driven-development/skills
```

- [ ] **Step 2: Write `packages/delegate-driven-development/package.json`**

```json
{
  "name": "delegate-driven-development",
  "version": "0.0.0",
  "private": false,
  "type": "module",
  "description": "Subagent-driven workflow for π: delegate, session, and tickets extensions plus the delegate-driven-development skill.",
  "keywords": ["pi-package"],
  "repository": {
    "type": "git",
    "url": "https://github.com/chknd1nner/delegate-driven-development.git"
  },
  "license": "MIT",
  "pi": {
    "extensions": [
      "./extensions/delegate/index.ts",
      "./extensions/session/index.ts",
      "./extensions/tickets/index.ts"
    ],
    "skills": ["./skills"]
  },
  "scripts": {
    "test": "vitest run --cache=false",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "typebox": "*"
  }
}
```

- [ ] **Step 3: Write `packages/delegate-driven-development/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["extensions/**/*.ts"]
}
```

- [ ] **Step 4: Write `packages/delegate-driven-development/.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 5: Write `packages/delegate-driven-development/README.md`**

```markdown
# delegate-driven-development

A Pi package bundling a subagent-driven workflow:

- **delegate** extension — RPC-driven worker spawning (`delegate_start`, `delegate_check`, `delegate_steer`, `delegate_result`, `delegate_abort`, `delegate_anchor`).
- **session** extension — session entry inspection (`session_entries`).
- **tickets** extension — ticket sharding and lifecycle (`ticket_shard`, `ticket_list`, `ticket_show`, `ticket_move`, `ticket_set`, `ticket_next`, `ticket_get`).
- **delegate-driven-development** skill — orchestrates implementer → reviewer → fixer per ticket using the three extensions above.

## Install

```jsonc
// .pi/settings.json
{
  "packages": [
    "git:github.com/chknd1nner/delegate-driven-development@v0.1.0"
  ]
}
```

Or via CLI:

```bash
pi install git:github.com/chknd1nner/delegate-driven-development@v0.1.0
```

To install just one extension from the bundle:

```jsonc
{
  "packages": [
    {
      "source": "git:github.com/chknd1nner/delegate-driven-development@v0.1.0",
      "extensions": ["extensions/delegate/index.ts"],
      "skills": []
    }
  ]
}
```

## Source

Development happens upstream at [chknd1nner/pi-extensions](https://github.com/chknd1nner/pi-extensions) under `packages/delegate-driven-development/`. This repo is a publish mirror; PRs welcome upstream.
```

- [ ] **Step 6: Verify workspace install picks up the new bundle**

Run: `npm install`
Expected: completes without errors. Verify with `ls node_modules/delegate-driven-development` — should be a symlink to `../packages/delegate-driven-development`.

- [ ] **Step 7: Commit**

```bash
git add packages/delegate-driven-development
git commit -m "feat: scaffold delegate-driven-development bundle package"
```

---

### Task 4: Consolidate delegate, session, and tickets source into the bundle

**Files:**
- Move (git mv): `packages/delegate/{index.ts,progress.ts,rpc-client.ts,snapshot.ts,types.ts,visibility.ts,worker-manager.ts,tests/}` → `packages/delegate-driven-development/extensions/delegate/`
- Move (git mv): `packages/session/{index.ts,tests/}` → `packages/delegate-driven-development/extensions/session/`
- Move (git mv): `packages/tickets/{index.ts,tests/}` → `packages/delegate-driven-development/extensions/tickets/`
- Delete: `packages/delegate/`, `packages/session/`, `packages/tickets/` (empty after move; their `package.json` and `tsconfig.json` removed).

- [ ] **Step 1: Move delegate source**

```bash
mkdir -p packages/delegate-driven-development/extensions/delegate
git mv packages/delegate/index.ts packages/delegate-driven-development/extensions/delegate/index.ts
git mv packages/delegate/progress.ts packages/delegate-driven-development/extensions/delegate/progress.ts
git mv packages/delegate/rpc-client.ts packages/delegate-driven-development/extensions/delegate/rpc-client.ts
git mv packages/delegate/snapshot.ts packages/delegate-driven-development/extensions/delegate/snapshot.ts
git mv packages/delegate/types.ts packages/delegate-driven-development/extensions/delegate/types.ts
git mv packages/delegate/visibility.ts packages/delegate-driven-development/extensions/delegate/visibility.ts
git mv packages/delegate/worker-manager.ts packages/delegate-driven-development/extensions/delegate/worker-manager.ts
git mv packages/delegate/tests packages/delegate-driven-development/extensions/delegate/tests
```

Then delete the now-orphaned per-extension config:
```bash
git rm packages/delegate/package.json packages/delegate/tsconfig.json
rmdir packages/delegate
```

- [ ] **Step 2: Verify delegate tests still pass from bundle**

```bash
npm install
npx vitest run --cache=false --root packages/delegate-driven-development extensions/delegate
```

Expected: same number of passing tests as the Task 1 baseline for the delegate extension.

- [ ] **Step 3: Move session source**

```bash
mkdir -p packages/delegate-driven-development/extensions/session
git mv packages/session/index.ts packages/delegate-driven-development/extensions/session/index.ts
git mv packages/session/tests packages/delegate-driven-development/extensions/session/tests
git rm packages/session/package.json packages/session/tsconfig.json
rmdir packages/session
```

- [ ] **Step 4: Move tickets source**

```bash
mkdir -p packages/delegate-driven-development/extensions/tickets
git mv packages/tickets/index.ts packages/delegate-driven-development/extensions/tickets/index.ts
git mv packages/tickets/tests packages/delegate-driven-development/extensions/tickets/tests
git rm packages/tickets/package.json packages/tickets/tsconfig.json
rmdir packages/tickets
```

- [ ] **Step 5: Run the full bundle test suite**

```bash
npm test -w delegate-driven-development
```

Expected: total passing test count equals the sum of the three baseline counts from Task 1 Step 3.

- [ ] **Step 6: Run bundle typecheck**

```bash
npm run typecheck -w delegate-driven-development
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: consolidate delegate/session/tickets source into bundle"
```

---

### Task 5: Move the skill into the bundle

**Files:**
- Move (git mv): `skills/delegate-driven-development/` → `packages/delegate-driven-development/skills/delegate-driven-development/`

- [ ] **Step 1: Move the skill directory**

```bash
git mv skills/delegate-driven-development packages/delegate-driven-development/skills/delegate-driven-development
```

- [ ] **Step 2: Verify the skill is still discoverable from the bundle**

Inspect the bundle's `pi` manifest:
```bash
cat packages/delegate-driven-development/package.json | grep -A 3 '"skills"'
```
Expected: `"skills": ["./skills"]` — Pi will recursively find any `SKILL.md` under that path.

Confirm the skill file exists at the expected location:
```bash
ls packages/delegate-driven-development/skills/delegate-driven-development/SKILL.md
```
Expected: file listed.

- [ ] **Step 3: Verify the top-level `skills/` dir is now empty of bundle content**

```bash
ls skills/
```
Expected: only `SKILL-template.md` remains.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move delegate-driven-development skill into bundle"
```

---

### Task 6: Update dogfood settings to point at the local bundle

**Files:**
- Modify: `.pi/settings.json` — replace `../packages/delegate` and `../packages/tickets` with a single `../packages/delegate-driven-development` entry.

- [ ] **Step 1: Edit `.pi/settings.json`**

```json
{
  "packages": [
    "../packages/delegate-driven-development",
    "git:github.com/obra/superpowers"
  ]
}
```

Note: this also enables the `session` extension, which was not previously dogfooded. If that's not desired, use the filter form to load only the two previously-active extensions:

```jsonc
{
  "packages": [
    {
      "source": "../packages/delegate-driven-development",
      "extensions": [
        "extensions/delegate/index.ts",
        "extensions/tickets/index.ts"
      ]
    },
    "git:github.com/obra/superpowers"
  ]
}
```

Default to the unfiltered form unless the user requests otherwise.

- [ ] **Step 2: Verify Pi loads the bundle in a fresh process**

Run: `pi config`
Expected: the menu shows extensions for `delegate`, `session`, `tickets` and the `delegate-driven-development` skill, all sourced from `../packages/delegate-driven-development`. Exit without changes.

- [ ] **Step 3: Smoke-test the delegate tool is callable**

Run a one-shot Pi invocation that lists tools:
```bash
pi --print "List the names of all available tools, one per line. Do not call any tools."
```
Expected output contains: `delegate_start`, `ticket_shard`, `session_entries` (among others).

- [ ] **Step 4: Commit**

```bash
git add .pi/settings.json
git commit -m "chore: dogfood the bundle via local path"
```

---

### Task 7: Write `scripts/release-bundle.sh`

**Files:**
- Create: `scripts/release-bundle.sh`

- [ ] **Step 1: Write the script**

Create `scripts/release-bundle.sh`:

```bash
#!/usr/bin/env bash
# release-bundle.sh — publish a bundle from packages/<name>/ to its mirror repo.
#
# Usage:
#   scripts/release-bundle.sh <bundle-name> <version> [--dry-run]
#
# Example:
#   scripts/release-bundle.sh delegate-driven-development v0.1.0
#
# Preconditions:
#   - Working tree clean, on main, in sync with origin.
#   - packages/<bundle-name>/package.json exists.
#   - Mirror repo chknd1nner/<bundle-name> exists on GitHub
#     (use `gh repo create chknd1nner/<bundle-name> --public` for first release).

set -euo pipefail

DRY_RUN=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

BUNDLE="${ARGS[0]:?usage: release-bundle.sh <bundle> <version> [--dry-run]}"
VERSION="${ARGS[1]:?usage: release-bundle.sh <bundle> <version> [--dry-run]}"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

# 0. Sanity-check version format
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]] || {
  echo "error: version must look like v1.2.3 or v1.2.3-rc.1" >&2
  exit 1
}

# 1. Bundle exists
BUNDLE_DIR="packages/$BUNDLE"
[[ -d "$BUNDLE_DIR" ]] || { echo "error: $BUNDLE_DIR not found" >&2; exit 1; }
[[ -f "$BUNDLE_DIR/package.json" ]] || { echo "error: $BUNDLE_DIR/package.json missing" >&2; exit 1; }

# 2. Working tree clean
git diff --quiet && git diff --cached --quiet || {
  echo "error: working tree not clean — commit or stash first" >&2
  exit 1
}

# 3. On main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" == "main" ]] || {
  echo "error: must release from main (currently on $BRANCH)" >&2
  exit 1
}

# 4. In sync with origin/main
git fetch origin main --quiet
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
[[ "$LOCAL" == "$REMOTE" ]] || {
  echo "error: local main is out of sync with origin/main" >&2
  exit 1
}

# 5. Mirror reachable
MIRROR_URL="git@github.com:chknd1nner/$BUNDLE.git"
if ! git ls-remote --exit-code "$MIRROR_URL" >/dev/null 2>&1; then
  echo "error: cannot reach mirror $MIRROR_URL" >&2
  echo "       create it first: gh repo create chknd1nner/$BUNDLE --public --description \"Pi package: $BUNDLE\"" >&2
  exit 1
fi

VERSION_NUM="${VERSION#v}"
MONOREPO_TAG="$BUNDLE-$VERSION"

# 6. Refuse duplicate tags
if git rev-parse -q --verify "refs/tags/$MONOREPO_TAG" >/dev/null; then
  echo "error: monorepo tag $MONOREPO_TAG already exists" >&2
  exit 1
fi
if git ls-remote --tags "$MIRROR_URL" | grep -q "refs/tags/$VERSION\$"; then
  echo "error: mirror tag $VERSION already exists on $MIRROR_URL" >&2
  exit 1
fi

# 7. Bump version in bundle package.json
node -e "
  const fs = require('fs');
  const p = '$BUNDLE_DIR/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  pkg.version = '$VERSION_NUM';
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
"
echo "bumped $BUNDLE_DIR/package.json to $VERSION_NUM"

# 8. Update CHANGELOG (prepend stub, open editor)
CHANGELOG="$BUNDLE_DIR/CHANGELOG.md"
DATE=$(date +%Y-%m-%d)
if [[ ! -f "$CHANGELOG" ]]; then
  printf '# Changelog\n\n' > "$CHANGELOG"
fi
TMP=$(mktemp)
{
  echo "# Changelog"
  echo ""
  echo "## $VERSION - $DATE"
  echo ""
  echo "- (describe changes — this line will be opened in \$EDITOR)"
  echo ""
  tail -n +2 "$CHANGELOG" | sed '1{/^$/d;}'
} > "$TMP"
mv "$TMP" "$CHANGELOG"
if [[ "$DRY_RUN" != "1" ]]; then
  "${EDITOR:-vi}" "$CHANGELOG"
fi

# 9. Commit + tag in monorepo
run git add "$BUNDLE_DIR/package.json" "$CHANGELOG"
run git commit -m "release($BUNDLE): $VERSION"
if git config --get user.signingkey >/dev/null 2>&1; then
  run git tag -s "$MONOREPO_TAG" -m "$BUNDLE $VERSION"
else
  echo "warning: no signing key configured; creating unsigned tag" >&2
  run git tag -a "$MONOREPO_TAG" -m "$BUNDLE $VERSION"
fi

# 10. Subtree split + push to mirror
SPLIT_BRANCH="release/$BUNDLE-$VERSION"
run git subtree split --prefix="$BUNDLE_DIR" -b "$SPLIT_BRANCH"
run git push "$MIRROR_URL" "$SPLIT_BRANCH:main" --force-with-lease

# 11. Tag the mirror
TMPDIR=$(mktemp -d)
run git clone --quiet "$MIRROR_URL" "$TMPDIR"
if [[ "$DRY_RUN" != "1" ]]; then
  (
    cd "$TMPDIR"
    if git config --get user.signingkey >/dev/null 2>&1; then
      git tag -s "$VERSION" -m "$BUNDLE $VERSION"
    else
      git tag -a "$VERSION" -m "$BUNDLE $VERSION"
    fi
    git push origin "$VERSION"
  )
fi
rm -rf "$TMPDIR"

# 12. Push monorepo
run git push origin main
run git push origin "$MONOREPO_TAG"

# 13. Cleanup
run git branch -D "$SPLIT_BRANCH"

echo ""
echo "✅ Published $BUNDLE $VERSION"
echo "   Mirror:  https://github.com/chknd1nner/$BUNDLE"
echo "   Tag:     https://github.com/chknd1nner/$BUNDLE/releases/tag/$VERSION"
echo "   Install: pi install git:github.com/chknd1nner/$BUNDLE@$VERSION"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/release-bundle.sh
```

- [ ] **Step 3: Smoke-test with `--dry-run` against a clean monorepo state**

First commit any pending changes so the script's "working tree clean" check passes:

```bash
git add scripts/release-bundle.sh
git commit -m "feat: add release-bundle.sh"
```

Then dry-run:

```bash
./scripts/release-bundle.sh delegate-driven-development v0.1.0 --dry-run
```

Expected:
- Pre-flight checks pass (clean tree, on main, in sync).
- "bumped packages/delegate-driven-development/package.json to 0.1.0" printed.
- A series of `DRY-RUN: git ...` lines covering commit, tag, subtree split, push to mirror, push tag, push origin.
- Final "✅ Published" message.

If the mirror-reachable check fails (mirror doesn't exist yet) — that's expected at this stage. The script prints a `gh repo create` hint. Task 9 will actually create the mirror.

- [ ] **Step 4: Roll back the dry-run version bump**

The dry-run modifies `packages/delegate-driven-development/package.json` and `CHANGELOG.md` outside the `run` wrapper. Reset:

```bash
git checkout -- packages/delegate-driven-development/package.json packages/delegate-driven-development/CHANGELOG.md
# CHANGELOG.md may now be untracked if first run created it:
rm -f packages/delegate-driven-development/CHANGELOG.md
```

Verify clean:
```bash
git status --short
```
Expected: empty output.

- [ ] **Step 5: Commit (script already committed in Step 3)**

No additional commit needed — script is already in history. Move to next task.

---

### Task 8: Write `skills/releasing-a-bundle/SKILL.md`

**Files:**
- Create: `skills/releasing-a-bundle/SKILL.md`

- [ ] **Step 1: Write the skill**

Create `skills/releasing-a-bundle/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Verify skill discovery**

The repo-root `skills/` directory is not currently registered as a Pi package, but if the user runs this skill from their dogfood Pi session, the executing skill (likely the worker following this plan) will read `SKILL.md` directly from disk via the Read tool. No registration step needed at this point.

- [ ] **Step 3: Commit**

```bash
git add skills/releasing-a-bundle
git commit -m "feat: add releasing-a-bundle skill"
```

---

### Task 9: First mirror publish (`delegate-driven-development` v0.1.0)

**Files:**
- Will modify (via release script): `packages/delegate-driven-development/package.json` (version), `packages/delegate-driven-development/CHANGELOG.md` (new).
- Will create the mirror repo `chknd1nner/delegate-driven-development` on GitHub.

- [ ] **Step 1: Merge worktree work back to main**

The release script requires `main`. If still in the feature worktree, fast-forward `main`:

```bash
# From within the worktree branch feature/bundle-restructure
git push origin feature/bundle-restructure  # backup
# Then in the main worktree:
cd <path-to-main-worktree>
git pull --ff-only origin main
git merge --ff-only feature/bundle-restructure   # or rebase if non-ff
git push origin main
```

If the merge isn't fast-forward, stop and ask the user how to integrate (this plan assumes a linear history).

- [ ] **Step 2: Create the mirror repo**

```bash
gh repo create chknd1nner/delegate-driven-development --public \
  --description "Pi package: subagent-driven workflow (delegate + session + tickets + skill)" \
  --homepage "https://github.com/chknd1nner/pi-extensions"
```

Verify: `gh repo view chknd1nner/delegate-driven-development --json url,visibility`
Expected: shows public visibility and the repo URL.

- [ ] **Step 3: Pre-flight per the skill**

Follow `skills/releasing-a-bundle/SKILL.md` pre-flight checklist for `delegate-driven-development`. All items must pass.

- [ ] **Step 4: Run the release script**

```bash
./scripts/release-bundle.sh delegate-driven-development v0.1.0
```

When `$EDITOR` opens the CHANGELOG, replace the placeholder bullet with:

```
- Initial release.
- delegate extension: delegate_start, delegate_check, delegate_steer, delegate_abort, delegate_anchor, delegate_result.
- session extension: session_entries.
- tickets extension: ticket_shard, ticket_list, ticket_show, ticket_move, ticket_set, ticket_next, ticket_get.
- delegate-driven-development skill bundled.
```

Expected final output: "✅ Published delegate-driven-development v0.1.0".

- [ ] **Step 5: Post-flight verification (mandatory)**

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
pi -e git:github.com/chknd1nner/delegate-driven-development@v0.1.0 --print \
  "List all tools that start with delegate_, ticket_, or session_, one per line. Then list available skills. Do not call any tools."
cd - && rm -rf "$TMPDIR"
```

Expected output contains:
- `delegate_start`, `delegate_check`, `delegate_steer`, `delegate_abort`, `delegate_anchor`, `delegate_result`
- `ticket_shard`, `ticket_list`, `ticket_show`, `ticket_move`, `ticket_set`, `ticket_next`, `ticket_get`
- `session_entries`
- skill: `delegate-driven-development`

If any item is missing, stop and investigate the bundle's `pi` manifest before doing anything else. Do not proceed to Task 10.

- [ ] **Step 6: Verify mirror contents in a browser (manual sanity check)**

Open `https://github.com/chknd1nner/delegate-driven-development` and confirm:
- README.md renders.
- Top-level dirs: `extensions/`, `skills/`.
- `package.json` shows version `0.1.0`.
- Tag `v0.1.0` exists under Releases.

Report these to the user as visual confirmation.

- [ ] **Step 7: No commit needed**

The release script committed and pushed already. Move on.

---

### Task 10: Switch dogfood to consume the mirror

**Files:**
- Modify: `.pi/settings.json`

- [ ] **Step 1: Edit `.pi/settings.json` to use the mirror at the published tag**

```json
{
  "packages": [
    "git:github.com/chknd1nner/delegate-driven-development@v0.1.0",
    "git:github.com/obra/superpowers"
  ]
}
```

For ongoing dogfooding of unreleased changes, the user can switch to a branch pin:

```json
{
  "packages": [
    "git:github.com/chknd1nner/delegate-driven-development@main",
    "git:github.com/obra/superpowers"
  ]
}
```

Default to the tagged version (`@v0.1.0`) so the dogfood matches what consumers get. Document the `@main` option in a comment-free settings file by mentioning it in the AGENTS.md update (Task 11).

- [ ] **Step 2: Force Pi to reinstall the package from git**

```bash
rm -rf .pi/git/github.com/chknd1nner/delegate-driven-development
pi config
```

Expected: on `pi config` startup, Pi clones the mirror at `v0.1.0` to `.pi/git/github.com/chknd1nner/delegate-driven-development`. The config menu shows the extensions and skill loaded from that location (not from `../packages/...`).

Exit `pi config` without changes.

- [ ] **Step 3: Smoke test from git-installed bundle**

```bash
pi --print "List the names of tools starting with delegate_, then exit."
```

Expected output: the six `delegate_*` tools.

- [ ] **Step 4: Commit**

```bash
git add .pi/settings.json
git commit -m "chore: dogfood the published bundle from git mirror"
```

---

### Task 11: Update AGENTS.md for the new vocabulary and workflow

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Rewrite the "Dependency and extension layout" section**

Replace the existing section (lines covering "Finished or in-progress extension source lives under `extensions/<name>/`" through the npm/workspace guidance) with:

```markdown
## Package and bundle layout

This repo is the source of truth for π packages. Each package lives under `packages/<name>/` and is one of:

- **Single-extension package** (e.g. `replace-prompt`, `agent-switcher`): one `pi` manifest pointing at one source file or directory.
- **Bundle** (e.g. `delegate-driven-development`): a `pi` manifest exposing multiple sub-extensions (under `packages/<bundle>/extensions/<name>/`) and skills (under `packages/<bundle>/skills/<name>/`).

### Rules

- Do **not** copy package source into `.pi/extensions/` for dogfooding.
- Do **not** run `npm install` inside `.pi/extensions/<name>/` or commit nested `node_modules` trees.
- Dogfood local packages through `.pi/settings.json` entries that point at the **published git mirror** (`git:github.com/chknd1nner/<bundle>@<tag>` or `@main` for ahead-of-stable). Local-path entries (`../packages/<name>`) are acceptable for active hot-loop development but should be replaced with mirror entries when the change is committed.
- `.pi/extensions/` is only for tiny project-local runtime config files such as `replace-prompt/rules.ts`.
- Manage Node dependencies from the repository root npm workspace. Use `npm install`, `npm test -w <package-name>`, and `npm run typecheck -w <package-name>`.
- Keep one workspace lockfile at the repo root (`package-lock.json`). Do not create per-package lockfiles during normal repo development.
- Each package directory must remain installable on its own as a Pi git package: keep its own `package.json` with a `pi` manifest, README, and `keywords: ["pi-package"]`.
- For package manifests, put Pi-provided packages in `peerDependencies` with `"*"`: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, and `typebox`.
- Put real third-party runtime imports in the package's `dependencies`; keep test/build-only tooling like `typescript` and `vitest` out of package runtime deps and in root `devDependencies`.
- The root `package.json` owns the development install, and `.npmrc` pins npm's hoisted install strategy.

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
```

- [ ] **Step 2: Verify AGENTS.md still parses as readable Markdown**

```bash
head -80 AGENTS.md
```

Visually confirm the new section is well-formed and references to "extensions" elsewhere in the file have been updated to "packages" or "bundles" as appropriate.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for packages/bundles vocabulary and release workflow"
```

---

## Self-Review

**Spec coverage check (against the conversation that produced this plan):**

| Requirement | Task |
|---|---|
| Repo restructure `extensions/` → `packages/` | Task 2 |
| Bundle template with `pi` manifest | Task 3 |
| Consolidate delegate + session + tickets into one bundle | Task 4 |
| Move the skill into the bundle | Task 5 |
| `scripts/release-bundle.sh` with dry-run | Task 7 |
| `skills/releasing-a-bundle/SKILL.md` encoding policy + verification | Task 8 |
| First mirror bootstrap (`gh repo create`) + publish `v0.1.0` | Task 9 |
| Dogfood via mirror with branch pin option (`@main`) | Task 10 |
| `AGENTS.md` updated for new vocabulary | Task 11 |
| Avoid npm distribution | Achieved — script targets git mirror only |
| User-friendly invocation (one command) | Task 7 produces `./scripts/release-bundle.sh <bundle> <version>` |
| Inspectable mirror tree | Achieved — `git subtree split` produces a clean public-facing repo per bundle |
| Signed tags optional | Script detects `user.signingkey` and signs if available |

No gaps identified.

**Placeholder scan:** No "TBD", "add appropriate error handling", or unspecific instructions remain. Every code/script block contains the actual content.

**Type/name consistency:** The bundle is named `delegate-driven-development` everywhere. The mirror repo is `chknd1nner/delegate-driven-development`. The monorepo tag is `delegate-driven-development-v0.1.0`; the mirror tag is `v0.1.0`. Workspace name in `package.json` matches the directory name.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-07-bundle-restructure-and-release-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because Tasks 4, 7, and 9 each have meaningful failure surfaces (test regressions, script bugs, mirror bootstrap) that benefit from review checkpoints.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster end-to-end but less isolation.

**Which approach?**
