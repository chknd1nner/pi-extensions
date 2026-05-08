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
