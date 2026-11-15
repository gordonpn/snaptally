#!/usr/bin/env bash
set -euo pipefail

# Read pins from the repository file, not a user's global mise configuration.
verify() {
  local tool="$1" actual="$2" expected
  expected="$(mise config get --file .mise.toml "tools.$tool")"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected %s, got %s\n' "$tool" "$expected" "$actual" >&2
    return 1
  fi
  printf '%s %s\n' "$tool" "$actual"
}

verify node "$(node --version | sed 's/^v//')"
verify pnpm "$(pnpm --version)"
verify biome "$(biome --version | sed 's/^Version: //')"
verify actionlint "$(actionlint --version | head -n 1)"
