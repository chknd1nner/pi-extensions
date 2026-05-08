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
