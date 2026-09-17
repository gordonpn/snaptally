# SnapTally

SnapTally is a lightweight, mobile-first progressive web application (PWA) designed for rapid point-of-sale expense logging. It delivers a sub-5-second checkout entry experience with an offline-first client queue, backed by Cloudflare Pages Functions and Cloudflare D1.

## Overview

Logging transactions at checkout using full spreadsheet applications or heavy personal finance tools is slow and error-prone on mobile devices. SnapTally isolates the point-of-sale interaction to a single intake form optimized for speed:

- Single-tap pill chips for cards and categories instead of native wheel dropdowns.
- Instant submission with an optimistic client-side outbox using IndexedDB.
- Zero server maintenance and durable persistence on Cloudflare edge infrastructure.
- Simple periodic reconciliation or export back to macro budget spreadsheets (such as Google Sheets).

## Tech Stack

- **Frontend**: Plain HTML, CSS, Alpine.js (for reactive category filtering and state), Web App Manifest (standalone PWA).
- **Client Offline Storage**: IndexedDB via `idb-keyval` for queueing transactions offline.
- **Compute / Routing**: Cloudflare Pages Functions running Hono (TypeScript).
- **Database**: Cloudflare D1 (serverless SQLite at the edge).
- **Authentication**: Pre-shared API bearer token stored in client local storage.
- **Tooling**: Cloudflare Wrangler CLI.

## Repository Layout

```text
snaptally/
├── docs/
│   └── architecture.md       # Detailed system design and trade-offs
├── functions/
│   └── api/
│       └── [[route]].ts      # Hono API router and D1 queries
├── migrations/
│   └── 0000_init.sql         # D1 database schema
├── public/
│   ├── app.js                # Form submission and outbox sync
│   ├── icons/                # PWA icons
│   ├── index.html            # Intake UI
│   ├── manifest.json         # PWA configuration
│   └── styles.css            # Touch-friendly styles
├── package.json
├── README.md
└── wrangler.jsonc            # Cloudflare Pages and D1 binding config
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or pnpm
- Cloudflare Wrangler CLI

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Apply local D1 database migrations:
   ```bash
   npx wrangler d1 migrations apply budget-db --local
   ```

3. Start the local Pages development server:
   ```bash
   npx wrangler pages dev ./public
   ```

4. Open `http://localhost:8788` in your browser.

## Documentation

For full architectural specifications, data flows, database schemas, and free-tier operational limits, see [docs/architecture.md](docs/architecture.md).
