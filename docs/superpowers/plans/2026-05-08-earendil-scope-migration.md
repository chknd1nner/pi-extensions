# Earendil Scope Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename repo-owned Pi extension and service code from `@mariozechner/*` to `@earendil-works/*`, then regenerate tracked lockfiles with a repeatable helper script.

**Architecture:** Add two small repo scripts: one to fail while legacy Pi scopes remain in tracked code/manifests, and one to refresh per-package lockfiles. Then apply a mechanical import/package rename across the tracked extension and FamilyOS packages, regenerate their lockfiles, and finish with package-by-package typecheck/test verification.

**Tech Stack:** Bash, Python 3 codemod, npm, TypeScript, Vitest.

---

## File Structure

### New files
- `scripts/check-pi-scope.sh` — fails if tracked in-scope code/manifests still reference `@mariozechner/`
- `scripts/refresh-pi-lockfiles.sh` — runs `npm install` in each tracked package directory to regenerate lockfiles

### Modified source and manifest files
- `extensions/delegate/index.ts`
- `extensions/delegate/tests/index.delegate-anchor.test.ts`
- `extensions/delegate/tests/index.delegate-check.test.ts`
- `extensions/delegate/tests/index.delegate-result.test.ts`
- `extensions/delegate/tests/index.delegate-start.test.ts`
- `extensions/delegate/tests/index.delegate-status-lifecycle.test.ts`
- `extensions/delegate/tests/index.delegate-status-start.test.ts`
- `extensions/delegate/tests/index.delegate-steer-abort.test.ts`
- `extensions/delegate/tests/index.inherit-context.test.ts`
- `extensions/delegate/tests/integration.test.ts`
- `extensions/delegate/package.json`
- `extensions/gemma-4-thinking-token/index.ts`
- `extensions/replace-opening/index.ts`
- `extensions/replace-prompt/index.ts`
- `extensions/replace-prompt/package.json`
- `extensions/session/index.ts`
- `extensions/session/tests/index.session-entries.test.ts`
- `extensions/session/package.json`
- `extensions/tickets/index.ts`
- `extensions/tickets/package.json`
- `services/familyos/package.json`
- `services/familyos/src/core/familyos-service.ts`
- `services/familyos/src/core/session-view.ts`
- `services/familyos/src/main.ts`
- `services/familyos/src/pi/familyos-extension.ts`
- `services/familyos/src/pi/guarded-tools.ts`
- `services/familyos/src/pi/prompt-composer.ts`
- `services/familyos/src/pi/prompt-runner.ts`
- `services/familyos/src/pi/runtime-factory.ts`
- `services/familyos/src/pi/runtime-registry.ts`
- `services/familyos/src/types.ts`
- `services/familyos/tests/integration/runtime-isolation.test.ts`
- `services/familyos/tests/runtime-factory.test.ts`
- `services/familyos/tests/runtime-registry.test.ts`

### Regenerated lockfiles
- `extensions/delegate/package-lock.json`
- `extensions/replace-prompt/package-lock.json`
- `extensions/session/package-lock.json`
- `extensions/tickets/package-lock.json`
- `services/familyos/package-lock.json`

### Out of scope
- `extensions/archive/**` — gitignored, excluded from tracked migration
- `docs/**`, `README.md`, upstream Pi examples, `.pi/**`

### Package directories to refresh and verify
- `extensions/delegate`
- `extensions/session`
- `extensions/replace-prompt`
- `extensions/tickets`
- `services/familyos`

### Task 1: Add migration verification and lockfile refresh helpers

**Files:**
- Create: `scripts/check-pi-scope.sh`
- Create: `scripts/refresh-pi-lockfiles.sh`

- [ ] **Step 1: Write the failing migration verification expectation**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
rg -n '@mariozechner/' \
  extensions/delegate \
  extensions/gemma-4-thinking-token \
  extensions/replace-opening \
  extensions/replace-prompt \
  extensions/session \
  extensions/tickets \
  services/familyos \
  --glob '!**/package-lock.json' \
  --glob '!**/README.md'
```

Expected: one or more matches, proving the repo is still on the legacy scope before the migration.

- [ ] **Step 2: Create `scripts/check-pi-scope.sh`**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
mkdir -p scripts
cat <<'EOF' > scripts/check-pi-scope.sh
#!/usr/bin/env bash
set -euo pipefail

paths=(
  "extensions/delegate"
  "extensions/gemma-4-thinking-token"
  "extensions/replace-opening"
  "extensions/replace-prompt"
  "extensions/session"
  "extensions/tickets"
  "services/familyos"
)

if rg -n '@mariozechner/' "${paths[@]}" --glob '!**/package-lock.json' --glob '!**/README.md'; then
  echo
  echo 'FAIL: legacy @mariozechner scope still exists in tracked code/manifests.' >&2
  exit 1
fi

echo 'PASS: tracked code/manifests only use non-legacy Pi scopes.'
EOF
chmod +x scripts/check-pi-scope.sh
```

- [ ] **Step 3: Run the new verification script to prove it fails before the rename**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
./scripts/check-pi-scope.sh
```

Expected: `FAIL: legacy @mariozechner scope still exists in tracked code/manifests.` and exit code `1`.

- [ ] **Step 4: Create `scripts/refresh-pi-lockfiles.sh`**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
cat <<'EOF' > scripts/refresh-pi-lockfiles.sh
#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
packages=(
  "extensions/delegate"
  "extensions/session"
  "extensions/replace-prompt"
  "extensions/tickets"
  "services/familyos"
)

for pkg in "${packages[@]}"; do
  echo "=== $pkg ==="
  (
    cd "$repo_root/$pkg"
    npm install
  )
  echo
 done
EOF
chmod +x scripts/refresh-pi-lockfiles.sh
```

- [ ] **Step 5: Smoke-test the lockfile refresh helper without changing code yet**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
bash -n scripts/check-pi-scope.sh
bash -n scripts/refresh-pi-lockfiles.sh
```

Expected: no output and exit code `0` from both `bash -n` syntax checks.

- [ ] **Step 6: Commit the helper scripts**

```bash
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration add scripts/check-pi-scope.sh scripts/refresh-pi-lockfiles.sh
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration commit -m "chore: add Pi scope migration helpers"
```

### Task 2: Rename tracked Pi imports and package references

**Files:**
- Modify: `extensions/delegate/index.ts`
- Modify: `extensions/delegate/tests/index.delegate-anchor.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-check.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-result.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-start.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-status-lifecycle.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-status-start.test.ts`
- Modify: `extensions/delegate/tests/index.delegate-steer-abort.test.ts`
- Modify: `extensions/delegate/tests/index.inherit-context.test.ts`
- Modify: `extensions/delegate/tests/integration.test.ts`
- Modify: `extensions/delegate/package.json`
- Modify: `extensions/gemma-4-thinking-token/index.ts`
- Modify: `extensions/replace-opening/index.ts`
- Modify: `extensions/replace-prompt/index.ts`
- Modify: `extensions/replace-prompt/package.json`
- Modify: `extensions/session/index.ts`
- Modify: `extensions/session/tests/index.session-entries.test.ts`
- Modify: `extensions/session/package.json`
- Modify: `extensions/tickets/index.ts`
- Modify: `extensions/tickets/package.json`
- Modify: `services/familyos/package.json`
- Modify: `services/familyos/src/core/familyos-service.ts`
- Modify: `services/familyos/src/core/session-view.ts`
- Modify: `services/familyos/src/main.ts`
- Modify: `services/familyos/src/pi/familyos-extension.ts`
- Modify: `services/familyos/src/pi/guarded-tools.ts`
- Modify: `services/familyos/src/pi/prompt-composer.ts`
- Modify: `services/familyos/src/pi/prompt-runner.ts`
- Modify: `services/familyos/src/pi/runtime-factory.ts`
- Modify: `services/familyos/src/pi/runtime-registry.ts`
- Modify: `services/familyos/src/types.ts`
- Modify: `services/familyos/tests/integration/runtime-isolation.test.ts`
- Modify: `services/familyos/tests/runtime-factory.test.ts`
- Modify: `services/familyos/tests/runtime-registry.test.ts`

- [ ] **Step 1: Re-run the failing migration verification before changing tracked code**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
./scripts/check-pi-scope.sh
```

Expected: fail with legacy-scope matches.

- [ ] **Step 2: Apply the mechanical scope rename across tracked code and manifests**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
python3 - <<'PY'
from pathlib import Path

files = [
    Path('extensions/delegate/index.ts'),
    Path('extensions/delegate/tests/index.delegate-anchor.test.ts'),
    Path('extensions/delegate/tests/index.delegate-check.test.ts'),
    Path('extensions/delegate/tests/index.delegate-result.test.ts'),
    Path('extensions/delegate/tests/index.delegate-start.test.ts'),
    Path('extensions/delegate/tests/index.delegate-status-lifecycle.test.ts'),
    Path('extensions/delegate/tests/index.delegate-status-start.test.ts'),
    Path('extensions/delegate/tests/index.delegate-steer-abort.test.ts'),
    Path('extensions/delegate/tests/index.inherit-context.test.ts'),
    Path('extensions/delegate/tests/integration.test.ts'),
    Path('extensions/delegate/package.json'),
    Path('extensions/gemma-4-thinking-token/index.ts'),
    Path('extensions/replace-opening/index.ts'),
    Path('extensions/replace-prompt/index.ts'),
    Path('extensions/replace-prompt/package.json'),
    Path('extensions/session/index.ts'),
    Path('extensions/session/tests/index.session-entries.test.ts'),
    Path('extensions/session/package.json'),
    Path('extensions/tickets/index.ts'),
    Path('extensions/tickets/package.json'),
    Path('services/familyos/package.json'),
    Path('services/familyos/src/core/familyos-service.ts'),
    Path('services/familyos/src/core/session-view.ts'),
    Path('services/familyos/src/main.ts'),
    Path('services/familyos/src/pi/familyos-extension.ts'),
    Path('services/familyos/src/pi/guarded-tools.ts'),
    Path('services/familyos/src/pi/prompt-composer.ts'),
    Path('services/familyos/src/pi/prompt-runner.ts'),
    Path('services/familyos/src/pi/runtime-factory.ts'),
    Path('services/familyos/src/pi/runtime-registry.ts'),
    Path('services/familyos/src/types.ts'),
    Path('services/familyos/tests/integration/runtime-isolation.test.ts'),
    Path('services/familyos/tests/runtime-factory.test.ts'),
    Path('services/familyos/tests/runtime-registry.test.ts'),
]

replacements = {
    '@mariozechner/pi-coding-agent': '@earendil-works/pi-coding-agent',
    '@mariozechner/pi-ai': '@earendil-works/pi-ai',
    '@mariozechner/pi-agent-core': '@earendil-works/pi-agent-core',
    '@mariozechner/pi-tui': '@earendil-works/pi-tui',
}

for path in files:
    text = path.read_text()
    original = text
    for old, new in replacements.items():
        text = text.replace(old, new)
    if text != original:
        path.write_text(text)
PY
```

- [ ] **Step 3: Inspect the rewritten files before broader verification**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
git diff -- \
  extensions/delegate \
  extensions/gemma-4-thinking-token/index.ts \
  extensions/replace-opening/index.ts \
  extensions/replace-prompt \
  extensions/session \
  extensions/tickets \
  services/familyos
```

Expected: only package-scope string replacements from `@mariozechner/*` to `@earendil-works/*` in tracked code/manifests.

- [ ] **Step 4: Re-run the migration verification to prove the tracked code/manifests are clean**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
./scripts/check-pi-scope.sh
```

Expected: `PASS: tracked code/manifests only use non-legacy Pi scopes.`

- [ ] **Step 5: Commit the tracked source and manifest rename**

```bash
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration add \
  extensions/delegate \
  extensions/gemma-4-thinking-token/index.ts \
  extensions/replace-opening/index.ts \
  extensions/replace-prompt \
  extensions/session \
  extensions/tickets \
  services/familyos
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration commit -m "chore: rename Pi packages to earendil scope"
```

### Task 3: Regenerate lockfiles and verify every tracked package

**Files:**
- Modify: `extensions/delegate/package-lock.json`
- Modify: `extensions/replace-prompt/package-lock.json`
- Modify: `extensions/session/package-lock.json`
- Modify: `extensions/tickets/package-lock.json`
- Modify: `services/familyos/package-lock.json`

- [ ] **Step 1: Run the lockfile refresh helper**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
./scripts/refresh-pi-lockfiles.sh
```

Expected: `npm install` succeeds in all five package directories and rewrites each tracked `package-lock.json`.

- [ ] **Step 2: Verify lockfiles no longer resolve legacy Pi packages**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
rg -n '@mariozechner/(pi-coding-agent|pi-ai|pi-agent-core|pi-tui)' \
  extensions/delegate/package-lock.json \
  extensions/replace-prompt/package-lock.json \
  extensions/session/package-lock.json \
  extensions/tickets/package-lock.json \
  services/familyos/package-lock.json
```

Expected: no matches.

- [ ] **Step 3: Run package typechecks after the rename**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
for pkg in \
  extensions/delegate \
  extensions/session \
  extensions/replace-prompt \
  extensions/tickets \
  services/familyos
 do
  echo "=== $pkg : typecheck ==="
  (cd "$pkg" && npm run typecheck)
 done
```

Expected: all five package typechecks pass.

- [ ] **Step 4: Run package tests after the rename**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
for pkg in \
  extensions/delegate \
  extensions/session \
  extensions/replace-prompt \
  services/familyos
 do
  echo "=== $pkg : test ==="
  (cd "$pkg" && npm test)
 done
```

Expected: all package tests pass. `extensions/tickets` is excluded because it has no `test` script.

- [ ] **Step 5: Inspect the final diff for scope-only changes plus helper scripts**

```bash
cd /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration
git diff --stat
```

Expected: tracked source/manifests, helper scripts, and tracked lockfiles only.

- [ ] **Step 6: Commit regenerated lockfiles and final verification changes**

```bash
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration add \
  scripts/check-pi-scope.sh \
  scripts/refresh-pi-lockfiles.sh \
  extensions/delegate/package-lock.json \
  extensions/replace-prompt/package-lock.json \
  extensions/session/package-lock.json \
  extensions/tickets/package-lock.json \
  services/familyos/package-lock.json
git -C /Users/martinkuek/Documents/Projects/pi-extensions/.worktrees/earendil-scope-migration commit -m "chore: refresh Pi package lockfiles"
```
