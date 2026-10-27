# Project Execution Queue

- **Last Refined:** 2026-10-26 22:42 EDT
- **Repository:** gordonpn/snaptally
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#108: Data: Triage and resolve 121 statement items in batch-4 reconciliation review queue](https://github.com/gordonpn/snaptally/issues/108)
- **Priority:** P2
- **Effort:** M
- **Readiness:** BLOCKED on transaction-specific confirmation for the remaining 117 items; four exact duplicate matches identified.
- **Why this task is next:** The user requested #108 before #101, and dependencies #106 and #107 are closed. The 121 statement items still need explicit dispositions before historical backfill.
- **First action:** Confirm the remaining possible matches, purchase purposes, and refund links against the local statement exports.
- **Definition of Done:** All 121 items have explicit dispositions; only confirmed purchases and linked refunds are appended to local budget CSVs; a local audit is complete; `just backfill-dry-run` reports unique IDs.
- **Unblocks:** Final review of the historical source for #101; production writes remain separately gated by backup and explicit authorization.

## NEXT - Upcoming Work

1. **[#115: feat(intake): infer category and card defaults from merchant transaction history](https://github.com/gordonpn/snaptally/issues/115)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Infers category, subcategory, and card from canonical rules and past transactions while preserving manual overrides.

2. **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Adds automated dependency and security update PRs with the repository's existing CI checks.

3. **[#113: Fix: Disable native keyboard suggestions and autocomplete for card and merchant inputs](https://github.com/gordonpn/snaptally/issues/113)**
   - **Priority:** P2 | **Effort:** XS | **Readiness:** READY
   - **Dependencies:** None
   - **Reason:** Prevents mobile autocorrect, auto-capitalization, and autofill overlays on merchant, card, and token inputs.

4. **[#114: Feat: Interactive merchant autocomplete dropdown from transaction history](https://github.com/gordonpn/snaptally/issues/114)**
   - **Priority:** P2 | **Effort:** S | **Readiness:** BLOCKED on #113
   - **Dependencies:** #113
   - **Reason:** Adds touch and keyboard suggestions after native autocomplete behavior is disabled.


## COMPLETED RECENTLY

- **[#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)**: Resolved in merged PR #111.
- **[#116: Refactor: Remove Reimbursement from Income and simplify to Salary and Other](https://github.com/gordonpn/snaptally/issues/116)**: Resolved in merged PR #117; Income is now Salary or Other, expense credits stay in their original categories, and historical records remain unchanged.
- **[#107: Data: Categorize and ingest 7 held international FX transactions ($538.28 USD)](https://github.com/gordonpn/snaptally/issues/107)**: Local CSV ingestion completed and issue closed; seven transactions totaling $538.28 USD (CAD 753.45) were added, with no production D1 writes.
- **[#103: Ops: Codify automated pre-flight D1 snapshot and backup recipe](https://github.com/gordonpn/snaptally/issues/103)**: Resolved in PR #110. Created `scripts/db-backup.sh`, added `just db-backup-remote` and `just db-backup-local`, gitignored `.backups/`, and updated backfill runbook.
- **[#106: Data: Promote reconciled batch-4 budget CSVs (2,353 transactions) to primary backfill source](https://github.com/gordonpn/snaptally/issues/106)**: Resolved in PR #109. Primary backfill dataset promoted to 2,353 valid transactions across 12 sheets with BOM-hardened CSV parsing.

## BLOCKERS

- [#101: Execute historical backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101) remains blocked on #108's 121 statement-item dispositions and coverage gaps, reconciling the local dated-folder/RSU adapter with latest `main` and its Salary taxonomy, refreshing expected counts, taking the pre-flight backup, and receiving explicit production-write authorization.

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Testing & Tooling:** #80 (Playwright E2E Tests), #77 (Mise Toolchain), #81 (Deterministic Seeds)
- **Foundational Schemas & Hardening:** #104 (Monthly Budgets Schema), #105 (iOS Viewport Hardening)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
