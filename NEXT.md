# Project Execution Queue

- **Last Refined:** 2026-10-20 10:35 EDT
- **Repository:** gordonpn/snaptally
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#103: Ops: Codify automated pre-flight D1 snapshot and backup recipe](https://github.com/gordonpn/snaptally/issues/103)
- **Priority:** P0 (Critical blocker)
- **Effort:** XS
- **Readiness:** READY
- **Why this task is next:** Protects production data against catastrophic loss or corruption before executing historical backfill (#101). Takes under 30 minutes, requires zero risky dependencies, and provides instant rollback capability.
- **First implementation action:** Add `scripts/db-backup.sh` that calls `wrangler d1 export budget-db --remote --output=.backups/budget-db_<timestamp>.sql` and wire it into `Justfile` as `just db:backup:remote`.
- **Definition of Done:**
  - `just db:backup:remote` executes cleanly and exports a non-empty SQL dump to `.backups/`.
  - `.backups/` is in `.gitignore` to prevent sensitive financial data leakage.
  - Script aborts with an error if the exported SQL file is empty or missing.
- **Unblocks:** [#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101).

## NEXT - Upcoming Work

1. **[#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** BLOCKED (by #103)
   - **Dependencies:** #103
   - **Reason:** Ingests 1,680 verified transactions across 12 sheets, giving SnapTally an authoritative historical ledger.

2. **[#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** #95 (Completed in PR #102)
   - **Reason:** Closes [Epic #94](https://github.com/gordonpn/snaptally/issues/94). Exposes Dead-Letter Queue items, retry actions, and manual sync controls directly to the mobile user.

3. **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Remediates 12 active security vulnerabilities reported by `pnpm audit` (undici/miniflare/wrangler) and automates monthly maintenance.

4. **[#80: Test: Codify Playwright end-to-end browser and offline PWA test suites](https://github.com/gordonpn/snaptally/issues/80)**
   - **Priority:** P1 | **Effort:** M | **Readiness:** READY
   - **Dependencies:** #96
   - **Reason:** Automates real-browser testing for service worker caching, IndexedDB transactions, and touch keypad interactions across Chromium, Firefox, and WebKit.

5. **[#77: Ops: Codify reproducible local toolchains and versions using mise (.mise.toml)](https://github.com/gordonpn/snaptally/issues/77)**
   - **Priority:** P2 | **Effort:** XS | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Quick win. Guarantees deterministic runtime parity (Node 22, pnpm, Biome) across workstations and GitHub Actions.

## BLOCKERS

- **Execution Safety for #101:** Issue #101 must not be executed against the remote production database until #103 is implemented and verified.

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Foundational Schemas & Tooling:** #81 (Deterministic Seeds), #104 (Monthly Budgets Schema), #105 (iOS Viewport Hardening)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
