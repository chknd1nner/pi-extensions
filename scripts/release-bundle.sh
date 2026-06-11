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
MIRROR_URL="https://github.com/chknd1nner/$BUNDLE.git"
# Note: do NOT use --exit-code here; that returns non-zero for empty
# (newly-created) mirrors, which is the exact state on first publish.
if ! git ls-remote "$MIRROR_URL" >/dev/null 2>&1; then
  echo "error: cannot reach mirror $MIRROR_URL" >&2
  echo "       create it first: gh repo create chknd1nner/$BUNDLE --public --description \"Pi package: $BUNDLE\"" >&2
  exit 1
fi

VERSION_NUM="${VERSION#v}"
MONOREPO_TAG="$BUNDLE-$VERSION"

# 6. Refuse duplicate tags, except for resuming after the monorepo tag was
# created and the release stopped before publishing the mirror tag.
RESUME_AFTER_MONOREPO_TAG=0
if git rev-parse -q --verify "refs/tags/$MONOREPO_TAG" >/dev/null; then
  TAG_COMMIT=$(git rev-parse "refs/tags/$MONOREPO_TAG^{commit}")
  HEAD_COMMIT=$(git rev-parse HEAD)
  if [[ "$TAG_COMMIT" == "$HEAD_COMMIT" ]]; then
    RESUME_AFTER_MONOREPO_TAG=1
    echo "resuming from existing monorepo tag $MONOREPO_TAG at HEAD"
  else
    echo "error: monorepo tag $MONOREPO_TAG already exists but does not point at HEAD" >&2
    echo "       tag commit:  $TAG_COMMIT" >&2
    echo "       HEAD commit: $HEAD_COMMIT" >&2
    exit 1
  fi
fi
if git ls-remote --tags "$MIRROR_URL" | grep -q "refs/tags/$VERSION\$"; then
  echo "error: mirror tag $VERSION already exists on $MIRROR_URL" >&2
  exit 1
fi

if [[ "$RESUME_AFTER_MONOREPO_TAG" != "1" ]]; then
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
fi

# 10. Subtree split + push to mirror
SPLIT_BRANCH="release/$BUNDLE-$VERSION"
if git rev-parse -q --verify "refs/heads/$SPLIT_BRANCH" >/dev/null 2>&1; then
  run git branch -D "$SPLIT_BRANCH"
fi
run git subtree split --prefix="$BUNDLE_DIR" -b "$SPLIT_BRANCH"
MIRROR_MAIN_SHA=$(git ls-remote --heads "$MIRROR_URL" main | awk '{print $1}')
run git push "$MIRROR_URL" "$SPLIT_BRANCH:main" "--force-with-lease=refs/heads/main:$MIRROR_MAIN_SHA"

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
