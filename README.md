# SnapTally

SnapTally is a lightweight, mobile-first progressive web application (PWA) designed for rapid point-of-sale expense logging. It delivers a sub-5-second checkout entry experience with an offline-first client queue, backed by Cloudflare Pages Functions and Cloudflare D1.

## Overview

Logging transactions at checkout using full spreadsheet applications or heavy personal finance tools is slow and error-prone on mobile devices. SnapTally delivers an ultra-fast checkout entry experience paired with planned Conscious Spending Plan analysis:

- Single-tap pill chips and numeric amount entry for sub-5-second logging.
- Instant submission with an optimistic client-side outbox using IndexedDB.
- Planned monthly Conscious Spending Plan budget analysis, burn-rate pacing, and sinking fund balance tracking.
- Zero server maintenance and durable persistence on Cloudflare edge infrastructure.
- Periodic reconciliation or export back to macro budget spreadsheets (such as Google Sheets).

## Tech Stack

- **Frontend**: Astro (static output mode), DaisyUI, Tailwind CSS v4, Alpine.js (for reactive category filtering and state), Tabler Icons (`@tabler/icons-astro`), Web App Manifest (standalone PWA).
- **Client Offline Storage**: IndexedDB via `idb-keyval` for queueing transactions offline.
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
│   └── budgeting.md          # Conscious Spending Plan framework, taxonomy, and rules
├── functions/
│   └── api/
│       └── [[route]].ts      # Hono API router and D1 queries
├── migrations/
│   └── 0000_init.sql         # D1 database schema
├── public/                   # Static pass-through assets
├── queries/
│   └── select_distinct_merchants.sql # Reusable D1 SQL queries
├── src/
│   ├── layouts/
│   │   └── Layout.astro      # Root HTML shell and Alpine.js bootstrap
│   ├── pages/
│   │   └── index.astro       # Intake UI page with DaisyUI and Tabler icons
│   └── styles/
│       └── global.css        # Tailwind CSS and DaisyUI theme directives
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

5. Open `http://localhost:8788` in your browser.

## Documentation
 
- [Architecture & Design](docs/architecture.md): Detailed system design, data flows, database schemas, and free-tier operational limits.
- [Budgeting Methodology & Category Taxonomy](docs/budgeting.md): Conscious Spending Plan parent buckets, subcategories, sinking funds, travel categorization, and reimbursement rules.
