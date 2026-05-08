#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
paths=(
  "extensions/delegate"
  "extensions/gemma-4-thinking-token"
  "extensions/replace-opening"
  "extensions/replace-prompt"
  "extensions/session"
  "extensions/tickets"
  "services/familyos"
)

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo 'ERROR: failed to resolve repository root for tracked file scan.' >&2
  exit 2
fi

tracked_files=()
while IFS= read -r -d '' file; do
  tracked_files+=("$file")
done < <(git -C "$repo_root" ls-files -z -- "${paths[@]}") || {
  git_exit=$?
  echo "ERROR: git ls-files failed while enumerating tracked files (exit code $git_exit)." >&2
  exit "$git_exit"
}

scan_files=()
for file in "${tracked_files[@]}"; do
  case "$file" in
    */package-lock.json|*/README.md|*/docs/*|*/.pi/*|*/examples/*)
      continue
      ;;
  esac

  case "$file" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.mts|*.cts|*.json)
      scan_files+=("$repo_root/$file")
      ;;
  esac
done

if [ "${#scan_files[@]}" -eq 0 ]; then
  echo 'PASS: tracked code/manifests only use non-legacy Pi scopes.'
  exit 0
fi

if rg -n '@mariozechner/' -- "${scan_files[@]}"; then
  echo
  echo 'FAIL: legacy @mariozechner scope still exists in tracked code/manifests.' >&2
  exit 1
else
  rg_exit=$?
  if [ "$rg_exit" -eq 1 ]; then
    echo 'PASS: tracked code/manifests only use non-legacy Pi scopes.'
  else
    echo "ERROR: rg encountered an error (exit code $rg_exit)." >&2
    exit "$rg_exit"
  fi
fi
