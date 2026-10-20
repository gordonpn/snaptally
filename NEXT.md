# Project Execution Queue

- **Last Refined:** 2026-10-20 10:55 EDT
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

1. **[#106: Data: Promote reconciled batch-4 budget CSVs (2,353 transactions) to primary backfill source](https://github.com/gordonpn/snaptally/issues/106)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Replaces the incomplete 1,680-row baseline with the reconciled 2,353-row dataset from `data/sheets/updated/budget_csvs/` (+673 valid transactions across 12 sheets).

2. **[#107: Data: Categorize and ingest 7 held international FX transactions ($538.28 USD)](https://github.com/gordonpn/snaptally/issues/107)**
   - **Priority:** P1 | **Effort:** XS | **Readiness:** BLOCKED (by #106)
   - **Dependencies:** #106
   - **Reason:** Ingests $538.28 USD of converted CAD expenses (Klarna Walmart Canada, Sapporo Stellar Place, Don Quijote) held for non-Boston category review.

3. **[#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** BLOCKED (by #103, #106)
   - **Dependencies:** #103, #106
   - **Reason:** Ingests the complete 2,353+ verified transactions into production D1, establishing SnapTally's live financial ledger.

4. **[#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** READY (can run in parallel with backfill)
   - **Dependencies:** #95 (Completed in PR #102)
   - **Reason:** Closes [Epic #94](https://github.com/gordonpn/snaptally/issues/94). Exposes Dead-Letter Queue items, retry actions, and manual sync controls directly to the mobile user.

5. **[#108: Data: Triage and resolve 121 statement items in batch-4 reconciliation review queue](https://github.com/gordonpn/snaptally/issues/108)**
   - **Priority:** P2 | **Effort:** M | **Readiness:** BLOCKED (by #106)
   - **Dependencies:** #106, #107
   - **Reason:** Resolves 84 candidate matches and 37 unmatched debits/refunds from statement extracts (PayPal, Capital One, Discover).

6. **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Remediates 12 active security vulnerabilities reported by `pnpm audit` (undici/miniflare/wrangler) and automates monthly maintenance.

## BLOCKERS

- **Execution Safety for #101:** Issue #101 must not be executed against the remote production database until #103 is implemented and verified.
- **Backfill Ingestion Accuracy:** Issue #101 should execute only after #106 promotes the reconciled 2,353 records to `data/sheets/`.

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Testing & Tooling:** #80 (Playwright E2E Tests), #77 (Mise Toolchain), #81 (Deterministic Seeds)
- **Foundational Schemas & Hardening:** #104 (Monthly Budgets Schema), #105 (iOS Viewport Hardening)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
