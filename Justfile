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

# Build static assets with Astro
build:
    pnpm run build

# Build static assets and start Cloudflare Pages local development server
dev: build
    pnpm wrangler pages dev ./dist
