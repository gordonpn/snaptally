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
    pnpm tsc --noEmit

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

# Run dry-run backfill simulation across historical Google Sheets
backfill-dry-run:
    node scripts/backfill.ts --dry-run

# Ingest historical Google Sheets into local D1 SQLite database
backfill-local:
    node scripts/backfill.ts --local

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

