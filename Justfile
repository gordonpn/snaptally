# Justfile for snaptally

default:
    @just --list

# Install project dependencies
install:
    pnpm install

# Run static analysis and formatting checks
lint:
    biome check .

# Apply automatic formatting fixes
format:
    biome format --write .

# Run TypeScript compiler checks
typecheck:
    pnpm run typecheck

# Run unit tests
test:
    pnpm test

# Run unit tests with coverage reporting
test-coverage:
    pnpm run test:coverage

# Apply D1 migrations to local SQLite database
db-migrate-local:
    echo y | pnpm wrangler d1 migrations apply budget-db --local

# List all transactions from the local D1 database
db-list-local:
    pnpm wrangler d1 execute budget-db --local --command "SELECT * FROM transactions"

# Export pre-flight snapshot of production Cloudflare D1 database
db-backup-remote:
    bash scripts/db-backup.sh --remote

# Export pre-flight snapshot of local D1 database
db-backup-local:
    bash scripts/db-backup.sh --local

# Run dry-run backfill simulation across historical Google Sheets
backfill-dry-run:
    node scripts/backfill.ts --dry-run

# Ingest historical Google Sheets into local D1 SQLite database
backfill-local:
    node scripts/backfill.ts --local

# Preview historical backfill row classification against local D1
backfill-plan-local:
    node scripts/backfill.ts plan --local

# Preview historical backfill row classification against production D1
backfill-plan-remote:
    node scripts/backfill.ts plan --remote

# Verify consistency between local D1 database and source sheets
backfill-verify-local:
    node scripts/backfill.ts verify --local

# Verify consistency between production D1 database and source sheets
backfill-verify-remote:
    node scripts/backfill.ts verify --remote

# Build static assets with Astro
build:
    pnpm run build

# Build static assets and start Cloudflare Pages local development server
dev: build
    pnpm wrangler pages dev ./dist

# Build static assets and start development server accessible across local network
dev-network: build
    pnpm wrangler pages dev ./dist --ip 0.0.0.0

alias dev-host := dev-network

