#!/usr/bin/env bash
# Only schemas identical to main may use the shared preview database.
set -euo pipefail
if git diff --quiet "${1:?base commit required}" HEAD -- migrations/; then
  echo 'safe=true'
else
  status=$?
  if [ "$status" -ne 1 ]; then
    exit "$status"
  fi
  echo 'safe=false'
fi
