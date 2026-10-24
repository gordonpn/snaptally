# Project Execution Queue

- **Last Refined:** 2026-10-20 15:08 EDT
- **Repository:** gordonpn/snaptally
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)
- **Priority:** P0
- **Effort:** S
- **Readiness:** IN REVIEW ([draft PR #111](https://github.com/gordonpn/snaptally/pull/111))
- **Why this task is next:** Completes the high-priority mobile sync status workflow and closes Epic #94; its prerequisite #95 is complete.
- **Next action:** Review PR #111 and its checks. Implementation is verified locally with 376 passing tests and mobile browser interaction checks; merge remains with the maintainer.
- **Definition of Done:** The drawer, retry/discard actions, and persistent failure banner meet the issue acceptance criteria with tests and mobile UI verification.
- **Unblocks:** Closes [Epic #94](https://github.com/gordonpn/snaptally/issues/94).

## NEXT - Upcoming Work

1. **[#108: Data: Triage and resolve 121 statement items in batch-4 reconciliation review queue](https://github.com/gordonpn/snaptally/issues/108)**
   - **Priority:** P2 | **Effort:** M | **Readiness:** READY (unblocked by #107)
   - **Dependencies:** #106 and #107 (dataset promotion and held FX transactions are complete)
   - **Reason:** Resolves 84 candidate matches and 37 unmatched debits/refunds from statement extracts.

2. **[#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101)**
   - **Priority:** P0 | **Effort:** S | **Readiness:** BLOCKED (requires explicit authorization for production writes)
   - **Dependencies:** #103, #106, and #107 (all completed)
   - **Reason:** Populates production D1 after a pre-flight backup; the verified active dataset now has 2,372 rows (1,971 USD, 401 CAD, 35 skipped, 0 duplicate IDs) across 13 sheets including RSU income and held FX transactions.

3. **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Remediates active security vulnerabilities reported by `pnpm audit` (undici/miniflare/wrangler) and automates monthly maintenance.

## COMPLETED RECENTLY

- **[#103: Ops: Codify automated pre-flight D1 snapshot and backup recipe](https://github.com/gordonpn/snaptally/issues/103)**: Resolved in PR #110. Created `scripts/db-backup.sh`, added `just db-backup-remote` and `just db-backup-local`, gitignored `.backups/`, and updated backfill runbook.
- **[#106: Data: Promote reconciled batch-4 budget CSVs (2,353 transactions) to primary backfill source](https://github.com/gordonpn/snaptally/issues/106)**: Resolved in PR #109. Primary backfill dataset promoted to 2,353 valid transactions across 12 sheets with BOM-hardened CSV parsing.
- **[#107: Data: Categorize and ingest 7 held international FX transactions ($538.28 USD)](https://github.com/gordonpn/snaptally/issues/107)**: Appended seven converted transactions to the ignored active Stuff sheet; dry-run reports 2,360 valid transactions and a direct parse confirmed unique IDs. Issue remains open for maintainer review.

## BLOCKERS

- Production execution in #101 requires explicit authorization before writing to Cloudflare D1.

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Testing & Tooling:** #80 (Playwright E2E Tests), #77 (Mise Toolchain), #81 (Deterministic Seeds)
- **Foundational Schemas & Hardening:** #104 (Monthly Budgets Schema), #105 (iOS Viewport Hardening)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
