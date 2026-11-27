#!/usr/bin/env bash
set -euo pipefail

cmd="$(basename "$0")"
case "$cmd" in
  mise)
    if [[ "${1:-}" != "config" || "${2:-}" != "get" || "${3:-}" != "--file" ]]; then
      printf 'unexpected mise args: %s\n' "$*" >&2
      exit 1
    fi
    if [[ "${4:-}" != "$EXPECTED_MISE_FILE" ]]; then
      printf 'expected --file %s, got %s\n' "$EXPECTED_MISE_FILE" "${4:-}" >&2
      exit 1
    fi
    case "${5:-}" in
      tools.node) printf '%s\n' "${STUB_EXPECTED_NODE:-$STUB_NODE}" ;;
      tools.pnpm) printf '%s\n' "$STUB_PNPM" ;;
      tools.biome) printf '%s\n' "$STUB_BIOME" ;;
      tools.actionlint) printf '%s\n' "$STUB_ACTIONLINT" ;;
      *) exit 1 ;;
    esac
    ;;
  node)
    if [[ "${1:-}" == "--version" ]]; then
      printf 'v%s\n' "$STUB_NODE"
      exit 0
    fi
    exec "$REAL_NODE" "$@"
    ;;
  pnpm) printf '%s\n' "$STUB_PNPM" ;;
  biome) printf 'Version: %s\n' "$STUB_BIOME" ;;
  actionlint) printf '%s\n' "$STUB_ACTIONLINT" ;;
  *) exit 1 ;;
esac
