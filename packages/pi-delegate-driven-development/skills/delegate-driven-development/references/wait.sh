#!/usr/bin/env bash
# Poll a delegate status file until terminal or timeout.
# Usage: bash wait.sh <status_file> <timeout_seconds>
# Emits exactly one sentinel line:
#   DELEGATE_WATCH_DONE status=<completed|failed|aborted>   (exit 0)
#   DELEGATE_WATCH_TIMEOUT                                  (exit 1)
# The orchestrator MUST call delegate_check for authoritative status on any alert.
deadline=$(( $(date +%s) + ${2:-1800} ))
while :; do
  s=$(cat "$1" 2>/dev/null)
  case "$s" in
    completed|failed|aborted) echo "DELEGATE_WATCH_DONE status=$s"; exit 0 ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "DELEGATE_WATCH_TIMEOUT"; exit 1; fi
  sleep 5
done
