#!/usr/bin/env bash
set -euo pipefail

# Ensure backup files and directories are readable and writable only by the invoking user
umask 077

# Scripts directory and project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

DB_NAME="budget-db"
TARGET=""
OUTPUT_DIR=".backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      if [[ -n "$TARGET" ]]; then
        echo "Error: Cannot specify both --remote and --local" >&2
        exit 1
      fi
      TARGET="--remote"
      shift
      ;;
    --local)
      if [[ -n "$TARGET" ]]; then
        echo "Error: Cannot specify both --remote and --local" >&2
        exit 1
      fi
      TARGET="--local"
      shift
      ;;
    --db)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --db requires a database name" >&2
        exit 1
      fi
      DB_NAME="$2"
      shift 2
      ;;
    --output-dir)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --output-dir requires a directory path" >&2
        exit 1
      fi
      OUTPUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 <--remote|--local> [--db <name>] [--output-dir <path>]"
      exit 0
      ;;
    *)
      echo "Error: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Error: Target is required: specify either --remote or --local" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
chmod 0700 "$OUTPUT_DIR"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
OUTPUT_FILE="${OUTPUT_DIR}/${DB_NAME}_${TIMESTAMP}.sql"
if [[ -f "$OUTPUT_FILE" ]]; then
  OUTPUT_FILE="${OUTPUT_DIR}/${DB_NAME}_${TIMESTAMP}_$$.sql"
fi

TMP_FILE="${OUTPUT_FILE}.tmp.$$"
trap 'rm -f "$TMP_FILE"' EXIT INT TERM

echo "Exporting Cloudflare D1 database '${DB_NAME}' (${TARGET})..."
pnpm wrangler d1 export "$DB_NAME" "$TARGET" -y --output "$TMP_FILE"

# Post-export validation
if [[ ! -f "$TMP_FILE" ]]; then
  echo "Error: Expected backup file does not exist: $TMP_FILE" >&2
  exit 1
fi

if [[ ! -s "$TMP_FILE" ]]; then
  echo "Error: Backup file is empty (0 bytes): $TMP_FILE" >&2
  exit 1
fi

if ! grep -q -E 'CREATE TABLE.*transactions' "$TMP_FILE"; then
  echo "Error: Backup file is missing required application schema ('transactions' table): $OUTPUT_FILE" >&2
  exit 1
fi

# Atomically move the validated export into place
mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 0600 "$OUTPUT_FILE"
trap - EXIT INT TERM

FILE_SIZE=$(wc -c < "$OUTPUT_FILE" | tr -d ' ')
echo "Backup created successfully: $OUTPUT_FILE ($FILE_SIZE bytes)"
