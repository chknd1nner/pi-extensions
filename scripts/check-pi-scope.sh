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
abs_paths=()
for p in "${paths[@]}"; do
  abs_paths+=("$repo_root/$p")
done

rg -n '@mariozechner/' "${abs_paths[@]}" --glob '!**/package-lock.json' --glob '!**/README.md'
rg_exit=$?
if [ $rg_exit -eq 0 ]; then
  echo
  echo 'FAIL: legacy @mariozechner scope still exists in tracked code/manifests.' >&2
  exit 1
elif [ $rg_exit -eq 1 ]; then
  echo 'PASS: tracked code/manifests only use non-legacy Pi scopes.'
else
  echo 'ERROR: rg encountered an error (exit code '$rg_exit').' >&2
  exit $rg_exit
fi
