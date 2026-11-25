# Justfile for snaptally

default:
    @just --list

# Install the exact developer tools declared in .mise.toml
toolchain-install:
    mise install

# Probe executables in the mise environment against the declared pins
toolchain-verify:
    mise exec -- bash scripts/verify-toolchain.sh

# Check committed tool declarations without installing workstation executables
toolchain-parity:
    node scripts/check-toolchain.ts

# Install project dependencies
install:
    pnpm install

# Run static analysis and formatting checks
lint:
    pnpm run lint

# Apply automatic formatting fixes
format:
    pnpm run format

# Run TypeScript compiler checks
typecheck:
    pnpm run typecheck

# Run unit tests
test:
    pnpm test

# Run mobile browser journeys against disposable local Pages and D1
test-e2e:
    pnpm run test:e2e

# Run API HTTP integration tests against disposable local Pages and D1
test-integration:
    pnpm run test:integration

# Run unit tests with coverage reporting
test-coverage:
    pnpm run test:coverage

# Apply D1 migrations to local SQLite database
db-migrate-local:
    echo y | pnpm wrangler d1 migrations apply budget-db --local

# Seed dedicated disposable local D1 state (never remote)
db-seed-local:
    node scripts/local-fixtures.mjs seed

# Reset only dedicated owned fixture state, then migrate and seed
db-reset-local:
    node scripts/local-fixtures.mjs reset

# Validate SQLite schema, queries and SQL conventions
db-lint:
    node scripts/sql-lint.mjs

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

