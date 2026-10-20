#!/usr/bin/env bash
set -euo pipefail

# Scripts directory and project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

DB_NAME="budget-db"
TARGET="--remote"
OUTPUT_DIR=".backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      TARGET="--remote"
      shift
      ;;
    --local)
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
      echo "Usage: $0 [--remote|--local] [--db <name>] [--output-dir <path>]"
      exit 0
      ;;
    *)
      echo "Error: Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
OUTPUT_FILE="${OUTPUT_DIR}/${DB_NAME}_${TIMESTAMP}.sql"

echo "Exporting Cloudflare D1 database '${DB_NAME}' (${TARGET})..."
pnpm wrangler d1 export "$DB_NAME" "$TARGET" -y --output "$OUTPUT_FILE"

# Post-export validation
if [[ ! -f "$OUTPUT_FILE" ]]; then
  echo "Error: Expected backup file does not exist: $OUTPUT_FILE" >&2
  exit 1
fi

if [[ ! -s "$OUTPUT_FILE" ]]; then
  echo "Error: Backup file is empty (0 bytes): $OUTPUT_FILE" >&2
  rm -f "$OUTPUT_FILE"
  exit 1
fi

if ! grep -q -E '(CREATE TABLE|PRAGMA|INSERT INTO)' "$OUTPUT_FILE"; then
  echo "Error: Backup file does not contain recognized SQL statements: $OUTPUT_FILE" >&2
  rm -f "$OUTPUT_FILE"
  exit 1
fi

FILE_SIZE=$(wc -c < "$OUTPUT_FILE" | tr -d ' ')
echo "Backup created successfully: $OUTPUT_FILE ($FILE_SIZE bytes)"
