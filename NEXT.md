# Project Execution Queue

- **Last Refined:** 2026-10-28
- **Repository:** gordonpn/snaptally
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#78: Codify automated dependency maintenance and vulnerability remediation](https://github.com/gordonpn/snaptally/issues/78)
- **Priority:** P1 | **Effort:** S | **Readiness:** READY
- **Why this task is next:** The merchant defaults work is merged, and dependency maintenance remains the highest-priority ready task.
- **First action:** Inspect existing dependency workflows, then add the Dependabot configuration described in the issue.
- **Definition of Done:** Grouped npm and GitHub Actions updates validate against the Dependabot schema, run through CI, and have a documented review process.
- **Unblocks:** Routine dependency and security update pull requests.

## NEXT - Upcoming Work

1. **[#80: Codify Playwright end-to-end browser and offline PWA test suites](https://github.com/gordonpn/snaptally/issues/80)**
   - **Priority:** P1 | **Effort:** M | **Readiness:** Review requirements before starting.
   - **Parallel:** Independent of #78.

2. **[#114: Interactive merchant autocomplete dropdown from transaction history](https://github.com/gordonpn/snaptally/issues/114)**
   - **Priority:** P2 | **Effort:** S | **Readiness:** Review ranking data availability; #113 is closed.
   - **Reason:** Adds touch and keyboard suggestions for merchant entry.

3. **[#105: Hardened viewport and safe-area handling for standalone iOS PWA](https://github.com/gordonpn/snaptally/issues/105)**
   - **Priority:** P2 | **Effort:** S | **Readiness:** Review requirements before starting.
   - **Parallel:** Independent of #78.


## COMPLETED RECENTLY

- **[#115: Infer category and card defaults from merchant transaction history](https://github.com/gordonpn/snaptally/issues/115)**: Closed after PR #119 merged; merchant rules and recent history now suggest category and card defaults while preserving manual choices.
- **[#113: Disable native text assistance on intake inputs](https://github.com/gordonpn/snaptally/issues/113)**: Closed after PR #118 merged, with the documented iOS Safari limitation.
- **[#108: Triage the batch-4 reconciliation queue](https://github.com/gordonpn/snaptally/issues/108)**: Closed after local review of 121 items: 19 confirmed duplicates, 91 locally appended transactions, and 11 excluded with reasons. The dry-run parsed 2,463 transactions with unique IDs and zero database writes.
- **[#96: Feat: Implement Outbox and Sync Status Drawer in mobile intake UI](https://github.com/gordonpn/snaptally/issues/96)**: Resolved in merged PR #111.
- **[#116: Refactor: Remove Reimbursement from Income and simplify to Salary and Other](https://github.com/gordonpn/snaptally/issues/116)**: Resolved in merged PR #117; Income is now Salary or Other, expense credits stay in their original categories, and historical records remain unchanged.
- **[#107: Data: Categorize and ingest 7 held international FX transactions ($538.28 USD)](https://github.com/gordonpn/snaptally/issues/107)**: Local CSV ingestion completed and issue closed; seven transactions totaling $538.28 USD (CAD 753.45) were added, with no production D1 writes.
- **[#103: Ops: Codify automated pre-flight D1 snapshot and backup recipe](https://github.com/gordonpn/snaptally/issues/103)**: Resolved in PR #110. Created `scripts/db-backup.sh`, added `just db-backup-remote` and `just db-backup-local`, gitignored `.backups/`, and updated backfill runbook.
- **[#106: Data: Promote reconciled batch-4 budget CSVs (2,353 transactions) to primary backfill source](https://github.com/gordonpn/snaptally/issues/106)**: Resolved in PR #109. Primary backfill dataset promoted to 2,353 valid transactions across 12 sheets with BOM-hardened CSV parsing.

## BLOCKERS

- [#101: Execute historical backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101) remains open pending maintainer closure. Its latest update records completed production execution and a separate paycheck verification question.

## LATER

All remaining medium- and low-priority enhancements are tracked directly in the GitHub Backlog:
- **Testing & Tooling:** #77 (Mise Toolchain), #81 (Deterministic Seeds)
- **Foundational Schemas & Hardening:** #104 (Monthly Budgets Schema)
- **Analysis & Dashboard:** #42 (Monthly Aggregation API), #44 (Mobile Analysis Dashboard), #36 (In-App Pacing Toast), #40 (Income Entry Polish), #41 (Category Taxonomy Profile)
- **Deferred Streams:** #21-#23 (Multi-tenancy), #37 (Webhook Alerts), #39 (Scheduled Cron Digests), #43 (Sinking Funds Engine), #52 (Edge Runtime Tests), #53 (Synthetic Canary Probes), #60 (Merchant Rulebook), #62 (Receipt Splitting), #63 (Montreal Property Tracker), #76 (OpenTofu IaC), #79 (OpenAPI 3.1 Spec)
- View complete filtered view: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
