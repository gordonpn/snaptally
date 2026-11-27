# SnapTally

SnapTally is a lightweight, mobile-first progressive web application (PWA) designed for rapid point-of-sale expense logging. It delivers a sub-5-second checkout entry experience with an offline-first client queue, backed by Cloudflare Pages Functions and Cloudflare D1.

## Overview

Logging transactions at checkout using full spreadsheet applications or heavy personal finance tools is slow and error-prone on mobile devices. SnapTally delivers an ultra-fast checkout entry experience paired with planned Conscious Spending Plan analysis:

- Single-tap pill chips and numeric amount entry for sub-5-second logging.
- Custom merchant, card, and API token fields ask browsers and keyboards to suppress text assistance while retaining local merchant suggestions.
- Instant submission with an optimistic client-side outbox using IndexedDB.
- USD and CAD transaction entry, retained while queued offline and synchronized in the selected currency.
- Planned monthly Conscious Spending Plan budget analysis, burn-rate pacing, and sinking fund balance tracking.
- Zero server maintenance and durable persistence on Cloudflare edge infrastructure.
- Planned authenticated CSV export for local backups.

## Tech Stack

- **Frontend**: Astro (static output mode), DaisyUI, Tailwind CSS v4, Neumorphic design system, Alpine.js (for reactive category filtering and state), Tabler Icons (`@tabler/icons-astro`), Web App Manifest (standalone PWA), Service Worker (offline shell caching).
- **Client Offline Storage**: Native IndexedDB (`snaptally_db`) with local storage fallback for queueing transactions offline without external runtime libraries.
- **Compute / Routing**: Cloudflare Pages Functions with direct file-based TypeScript route handlers.
- **Database**: Cloudflare D1 (serverless SQLite at the edge).
- **Authentication**: Pre-shared API bearer token stored in client local storage.
- **Tooling**: Cloudflare Wrangler CLI, Astro CLI, Biome.

## Repository Layout

```text
snaptally/
├── astro.config.mjs          # Astro static build configuration
├── docs/
│   ├── architecture.md       # Detailed system design, data flows, and trade-offs
│   ├── budgeting.md          # Conscious Spending Plan framework, taxonomy, and rules
│   ├── product-direction.md  # Confirmed single-user product direction and roadmap
│   └── RUNBOOK.md            # Production provisioning, deployment, and operational runbook
├── functions/
│   └── api/
│       ├── _middleware.ts    # Shared auth and D1 rate-limiting guard
│       ├── auth.ts           # Timing-safe Bearer token validation
│       ├── client-ip.ts      # Trusted client network hashing for rate limits
│       ├── logger.ts         # Structured redacting JSON logger
│       ├── merchants.ts      # GET /api/merchants Pages Function handler
│       ├── query.ts          # Query parameter parsing (limit, offset)
│       ├── rate-limit.ts     # Per-IP fixed-window D1 rate limiter
│       └── transactions.ts   # POST /api/transactions and GET /api/transactions handlers
├── migrations/               # D1 SQLite schema migrations (0000_init.sql - 0007_api_rate_limits.sql)
├── public/                   # Static pass-through assets (manifest, sw.js, icons)
├── queries/
│   └── select_distinct_merchants.sql # Reusable D1 SQL queries
├── src/
│   ├── config/
│   │   ├── budget-profile.ts # Four-bucket analysis profile constants
│   │   └── intake.ts         # Canonical bucket/subcategory taxonomy and default merchants
│   ├── layouts/
│   │   └── Layout.astro      # Root HTML shell and Alpine.js bootstrap
│   ├── pages/
│   │   ├── activity.astro    # Fullscreen Activity Log page
│   │   └── index.astro       # Intake UI page with Neumorphic keypad, chips, and Tabler icons
│   ├── scripts/
│   │   ├── activity.ts       # Activity view filtering, pagination, and cache
│   │   ├── app.ts            # Alpine.js registration and bootstrap
│   │   ├── intake-form.ts    # Keypad state machine and API integration
│   │   ├── outbox.ts         # Native IndexedDB outbox and background sync runner
│   │   ├── preview-mock.ts   # Preview-mode mock API handler
│   │   └── sw-register.ts    # Service worker registration helper
│   └── styles/
│       └── global.css        # Tailwind CSS, DaisyUI, and Neumorphic design tokens and utilities
├── package.json
├── README.md
└── wrangler.jsonc            # Cloudflare Pages and D1 binding config
```

## Getting Started

### Prerequisites

- [mise](https://mise.jdx.dev/getting-started.html) to install the exact Node.js,
  pnpm, Biome, and actionlint versions in [.mise.toml](.mise.toml).
- [just](https://just.systems/man/en/) for the optional task runner recipes.

From the repository root, review and trust the config, then install and verify:

```bash
mise trust
mise install
mise exec -- bash scripts/verify-toolchain.sh
```

Activate mise in your shell before the commands below, or prefix commands with
`mise exec --`. With just installed, use `just toolchain-install` and
`just toolchain-verify`. See [toolchain onboarding](docs/toolchain.md) for shell
setup and version upgrades. Wrangler is installed with the project dependencies.

### Environment Variables

| Variable | Description |
| :--- | :--- |
| `API_BEARER_TOKEN` | Secret pre-shared bearer token used to authenticate incoming API requests. |

For local development with Cloudflare Pages Functions, configure this variable in `.dev.vars` (or `.env` when using `--env-file`). In Cloudflare Pages production deployments, set this as an encrypted secret binding in the Cloudflare dashboard.

### Local Development

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .dev.vars
   ```
   Set `API_BEARER_TOKEN` in `.dev.vars` with your pre-shared secret.

3. Apply local D1 database migrations:
   ```bash
   pnpm wrangler d1 migrations apply budget-db --local
   ```

4. Build static assets and start the local Pages development server:
   ```bash
   pnpm dev
   ```
   Or using the task runner:
   ```bash
   just dev
   ```
   To access the development server from other devices on your local network (for example, a mobile phone):
   ```bash
   just dev-network
   ```

5. Open `http://localhost:8788` in your browser (or your local network IP when using `just dev-network`).

## Testing

Run `pnpm test:integration` or `just test-integration` to exercise the API over real
HTTP through local Cloudflare Pages Functions and D1. The suite applies all
migrations to a fresh temporary database, generates a test bearer token, and
starts Wrangler on `127.0.0.1:8798`. Keep that port free. It stops the server and
removes its temporary assets and database after the run. No Cloudflare login,
remote database, browser installation, or application build is required. CI runs
this suite alongside `pnpm test` and `pnpm run typecheck`.
The local harness supports macOS and Linux process groups; Windows is rejected
before creating state. SIGINT and SIGTERM stop child processes before removing
temporary state and exiting. Unauthorized requests still use D1 rate-limit
bookkeeping before authentication, but cannot read or write transaction data.

## Documentation

Historical CSV imports use `just backfill-dry-run` to validate local exports before
`just backfill-local`. Imports preserve USD/CAD and skip invalid calendar dates,
malformed amounts, and amounts that round to zero. See the
[backfill procedure](docs/RUNBOOK.md#8-historical-google-sheets-backfill).
Refunds and repayments for tracked expenses use credit mode in the original expense
category; standalone non-salary inflows belong under `Income -> Other`.
The CLI rejects unknown flags and conflicting local/remote targets.
Missing input files or directories fail explicitly.
Unterminated CSV quotes stop the import before database writes.
`just typecheck` checks the API, backfill scripts, configuration and toolchain
checks. `just toolchain-parity` verifies workstation/CI version declarations;
see the [toolchain policy](docs/toolchain.md#keeping-versions-aligned).
 
- [Architecture & Design](docs/architecture.md): Detailed system design, data flows, database schemas, and free-tier operational limits.
- [Product Direction](docs/product-direction.md): Confirmed single-user product direction, Horizon roadmap, and retired scope.
- [Budgeting Methodology & Category Taxonomy](docs/budgeting.md): Conscious Spending Plan parent buckets, subcategories, sinking funds, travel categorization, and expense credit rules.
- [Monthly Budget Targets](docs/monthly-budgets.md): Category target schema, opt-in local examples, and USD reporting and taxonomy contracts for analysis.
- [Operational Runbook](docs/RUNBOOK.md): Step-by-step procedures for production Cloudflare D1 provisioning, Pages configuration, deployments, and diagnostics.

### Sync Status

Tap the amber pending badge or red failed badge to open Sync Status. The Pending
view shows saved transactions and retry counts, with **Sync Now** for a manual
retry. The Failed view shows rejection details and offers **Retry** or
**Discard**; discarding requires confirmation. These queues live in this browser.
Authentication and failed-transaction warnings stay visible during intake until
resolved. A failed network request keeps the transaction queued for automatic retry.
