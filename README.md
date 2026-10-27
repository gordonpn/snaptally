# SnapTally

SnapTally is a lightweight, mobile-first progressive web application (PWA) designed for rapid point-of-sale expense logging. It delivers a sub-5-second checkout entry experience with an offline-first client queue, backed by Cloudflare Pages Functions and Cloudflare D1.

## Overview

Logging transactions at checkout using full spreadsheet applications or heavy personal finance tools is slow and error-prone on mobile devices. SnapTally delivers an ultra-fast checkout entry experience paired with planned Conscious Spending Plan analysis:

- Single-tap pill chips and numeric amount entry for sub-5-second logging.
- Custom merchant, card, and API token fields opt out of browser autofill and keyboard text correction while retaining local merchant suggestions.
- Instant submission with an optimistic client-side outbox using IndexedDB.
- Planned monthly Conscious Spending Plan budget analysis, burn-rate pacing, and sinking fund balance tracking.
- Zero server maintenance and durable persistence on Cloudflare edge infrastructure.
- Periodic reconciliation or export back to macro budget spreadsheets (such as Google Sheets).

## Tech Stack

- **Frontend**: Astro (static output mode), DaisyUI, Tailwind CSS v4, Neumorphic design system, Alpine.js (for reactive category filtering and state), Tabler Icons (`@tabler/icons-astro`), Web App Manifest (standalone PWA), Service Worker (offline shell caching).
- **Client Offline Storage**: Native IndexedDB (`snaptally_db`) with local storage fallback for queueing transactions offline without external runtime libraries.
- **Compute / Routing**: Cloudflare Pages Functions running Hono (TypeScript).
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
│   └── RUNBOOK.md            # Production provisioning, deployment, and operational runbook
├── functions/
│   └── api/
│       └── [[route]].ts      # Hono API router and D1 queries
├── migrations/
│   └── 0000_init.sql         # D1 database schema
├── public/                   # Static pass-through assets (manifest, sw.js, icons)
├── queries/
│   └── select_distinct_merchants.sql # Reusable D1 SQL queries
├── src/
│   ├── layouts/
│   │   └── Layout.astro      # Root HTML shell and Alpine.js bootstrap
│   ├── pages/
│   │   └── index.astro       # Intake UI page with Neumorphic keypad, chips, and Tabler icons
│   ├── scripts/
│   │   ├── app.ts            # Alpine.js registration and bootstrap
│   │   ├── intake-form.ts    # Keypad state machine and API integration
│   │   ├── outbox.ts         # Native IndexedDB outbox and background sync runner
│   │   └── sw-register.ts    # Service worker registration helper
│   └── styles/
│       └── global.css        # Tailwind CSS, DaisyUI, and Neumorphic design tokens and utilities
├── package.json
├── README.md
└── wrangler.jsonc            # Cloudflare Pages and D1 binding config
```

## Getting Started

### Prerequisites

- Node.js (v22.18.0 or higher)
- pnpm
- Cloudflare Wrangler CLI

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
`just typecheck` checks both the API and the backfill scripts and tests.
 
- [Architecture & Design](docs/architecture.md): Detailed system design, data flows, database schemas, and free-tier operational limits.
- [Budgeting Methodology & Category Taxonomy](docs/budgeting.md): Conscious Spending Plan parent buckets, subcategories, sinking funds, travel categorization, and expense credit rules.
- [Operational Runbook](docs/RUNBOOK.md): Step-by-step procedures for production Cloudflare D1 provisioning, Pages configuration, deployments, and diagnostics.

### Sync Status

Tap the amber pending badge or red failed badge to open Sync Status. The Pending
view shows saved transactions and retry counts, with **Sync Now** for a manual
retry. The Failed view shows rejection details and offers **Retry** or
**Discard**; discarding requires confirmation. These queues live in this browser.
Authentication and failed-transaction warnings stay visible during intake until
resolved. A failed network request keeps the transaction queued for automatic retry.
