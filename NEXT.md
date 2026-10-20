# Project Execution Queue

- **Last Refined:** 2026-10-20 14:25 EDT
- **Repository:** gordonpn/snaptally
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#107: Data: Categorize and ingest 7 held international FX transactions ($538.28 USD)](https://github.com/gordonpn/snaptally/issues/107)
- **Priority:** P1
- **Effort:** XS
- **Readiness:** READY
- **Why this task is next:** Captures $538.28 USD of converted CAD expenses (Klarna Walmart Canada, Sapporo Stellar Place, Don Quijote) into `data/sheets/`, bringing verified transactions from 2,353 to 2,360 before the production backfill (#101) is executed.
- **First implementation action:** Append the 7 rows into their target CSV sheets (`Budgeting - Canada food expenses.csv` and `Budgeting - Stuff.csv`).
- **Definition of Done:** `just backfill-dry-run` reports exactly 2,360 valid transactions with zero duplicate IDs and 35 skipped rows.
- **Unblocks:** Ingesting the complete 2,360-transaction ledger in [#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101).

## NEXT - Upcoming Work

1. **[#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** READY (unblocked by #103)
   - **Dependencies:** #103 (Merged in PR #110), optionally #107 (to include all 2,360 transactions)
   - **Reason:** Ingests the complete verified transaction dataset into production D1 using `just db-backup-remote` pre-flight snapshot, establishing SnapTally's live ledger.

2. **[#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** #95 (Completed in PR #102)
   - **Reason:** Closes [Epic #94](https://github.com/gordonpn/snaptally/issues/94). Exposes Dead-Letter Queue items, retry actions, and manual sync controls directly to the mobile user.

3. **[#108: Data: Triage and resolve 121 statement items in batch-4 reconciliation review queue](https://github.com/gordonpn/snaptally/issues/108)**
   - **Priority:** P2 | **Effort:** M | **Readiness:** BLOCKED (by #107)
   - **Dependencies:** #107
   - **Reason:** Resolves 84 candidate matches and 37 unmatched debits/refunds from statement extracts (PayPal, Capital One, Discover).

4. **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Remediates active security vulnerabilities reported by `pnpm audit` (undici/miniflare/wrangler) and automates monthly maintenance.

## COMPLETED RECENTLY

- **[#103: Ops: Codify automated pre-flight D1 snapshot and backup recipe](https://github.com/gordonpn/snaptally/issues/103)**: Resolved in PR #110. Created `scripts/db-backup.sh`, added `just db-backup-remote` and `just db-backup-local`, gitignored `.backups/`, and updated backfill runbook.
- **[#106: Data: Promote reconciled batch-4 budget CSVs (2,353 transactions) to primary backfill source](https://github.com/gordonpn/snaptally/issues/106)**: Resolved in PR #109. Primary backfill dataset promoted to 2,353 valid transactions across 12 sheets with BOM-hardened CSV parsing.

## BLOCKERS

- None. (Issue #101 is now unblocked following the merge of #103 in PR #110.)

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Testing & Tooling:** #80 (Playwright E2E Tests), #77 (Mise Toolchain), #81 (Deterministic Seeds)
- **Foundational Schemas & Hardening:** #104 (Monthly Budgets Schema), #105 (iOS Viewport Hardening)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
