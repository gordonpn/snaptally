# Project Execution Queue

- **Last Refined:** 2026-11-15 UTC (2026-11-14 EST)
- **Repository:** [gordonpn/snaptally](https://github.com/gordonpn/snaptally)
- **Verified `main` Commit SHA:** `88cd562fb81173b6a60d42c590f49a91f258b4b9`
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#204: test(intake): make browser storage fixtures and coverage deterministic](https://github.com/gordonpn/snaptally/issues/204)

- **Priority:** P1 | **Effort:** S (Medium-High confidence) | **Readiness:** READY
- **Why this task is next:** Intermittent 1-branch timing variance in `src/scripts/outbox.ts` (`96.44%`/`96.84%` vs `97.21%`) and shared `localStorage`/init fixture coupling tripped `codecov/project` (`threshold: 0%`) on both PR #198 and PR #199, forcing manual CI reruns before unrelated PRs could merge.
- **First action:** On a new task branch off `origin/main` (`88cd562`), audit `tests/outbox.test.ts` (`syncOutbox` / `scheduleDueRetry` `Date.now()` and timer branches) and `tests/intake-form.test.ts` global storage/async cleanup.
- **Definition of Done:** Isolated browser-global/storage fixtures with settled async teardown across intake and outbox suites; deterministic tests covering `syncOutbox`/`scheduleDueRetry` deadline and cached-merchant startup branches; three consecutive fresh-process runs of `pnpm run test:coverage` yielding identical line and branch coverage on `src/scripts/outbox.ts` and `src/scripts/intake-form.ts`; and `just typecheck`, `just test-coverage`, and `just lint` passing.
- **Unblocks:** Deterministic `codecov/project` CI gating across all upcoming PRs (#193, #205, #146, #40, #41).

## NEXT - Upcoming Work

1. **[#193: Ops: Enable GitHub Dependabot alerts and remediate existing dependency vulnerabilities](https://github.com/gordonpn/snaptally/issues/193)**
   - **Priority:** P1 | **Effort:** S | **Readiness:** READY (Repo settings verified enabled; 9 `pnpm audit` vulnerabilities remain on `sharp` and `undici`, where Dependabot run `43669247513` failed upstream semver resolution).
   - **Parallel:** Independent of #204, #205, and UI work.

2. **[#205: Restrict e2e workflow concurrency cancellation to pull_request events](https://github.com/gordonpn/snaptally/issues/205)**
   - **Priority:** P2 | **Effort:** XS | **Readiness:** READY (Quick win).
   - **Why next:** `.github/workflows/e2e.yml` sets `cancel-in-progress: true` unconditionally and cancelled 5 `main` push runs (`43667386374`, `43666189892`, `43665917242`, `43665807566`, `43665714045`).
   - **Parallel:** Independent of application source changes.

3. **[#146: Fix: Keypad button outer shadows clipped by container overflow on mobile intake screen](https://github.com/gordonpn/snaptally/issues/146)**
   - **Priority:** P2 | **Effort:** XS | **Readiness:** READY (Quick win).
   - **Parallel:** Independent of backend and CI tasks.

4. **[#189: Spike: Prepare SnapTally for month-long travel to Taipei, Hong Kong, and Vietnam](https://github.com/gordonpn/snaptally/issues/189)**
   - **Priority:** P2 | **Effort:** S | **Readiness:** READY (Time-sensitive ahead of trip).
   - **Parallel:** Can run alongside #204, #205, and #146; informs #191 (token/device-loss purge).

5. **[#41: Define canonical category taxonomy and budget profile schema](https://github.com/gordonpn/snaptally/issues/41)**
   - **Priority:** P2 | **Effort:** S | **Readiness:** READY (#104 prerequisite merged via `migrations/0006_monthly_budgets_schema.sql`).
   - **Unblocks:** #42, #44, and #36 (per `docs/monthly-budgets.md` lines 46-53).

## BLOCKERS

- **Taxonomy reconciliation (#41):** Blocks #42 (monthly budget aggregation API), #44 (mobile analysis dashboard), and #36 (in-app budget pacing feedback) due to `Savings -> Investments` vs 4-bucket `Investments` target mapping (`docs/monthly-budgets.md` lines 46-53).
- **Upstream transitive semver bounds (#193):** Patched `sharp` (`>=0.35.5`) and `undici` (`>=8.12.2` / `>=7.30.2`) currently fail automatic Dependabot resolution (`43669247513`) under `astro`/`wrangler` constraints.
- **Contract decision (#151):** Needs maintainer confirmation on whether bounded negative expense credits remain permanent before closing #151.

## CLOSED IN AUDIT (2026-11-15)

Closed against verified `main` (`88cd562`) after maintainer approval:

- **[#78: Ops: Codify automated dependency maintenance and vulnerability remediation (.github/dependabot.yml)](https://github.com/gordonpn/snaptally/issues/78)** -- Completed (`.github/dependabot.yml`, `docs/RUNBOOK.md`, grouped PRs #197/#198 verified; repo security controls enabled; active vuln remediation tracked in #193).
- **[#101: Ops: Execute historical Google Sheets backfill against production Cloudflare D1](https://github.com/gordonpn/snaptally/issues/101)** -- Completed (2,463 Historical rows imported to production D1, idempotency verified; optional October 23 paycheck check noted separately).
- **[#141: [Reliability] Preserve currency field in client OutboxItem and sync payload](https://github.com/gordonpn/snaptally/issues/141)** -- Completed (`src/scripts/outbox.ts`, `src/scripts/intake-form.ts`, `tests/outbox.test.ts` verified on `88cd562`).
- **[#155: [Security][P3] Purge cached sensitive client data on token removal and expand logger secret redaction patterns](https://github.com/gordonpn/snaptally/issues/155)** -- Duplicate of [#191](https://github.com/gordonpn/snaptally/issues/191) (logger redaction landed in PR #182; remaining client-cleanup requirements consolidated into #191).
- **[#137: [Infrastructure] Apply D1 database migrations to budget-db-preview in pull request deployments](https://github.com/gordonpn/snaptally/issues/137)** -- Not planned / superseded (PR #176 blocks unmerged PRs from mutating shared `budget-db-preview` and runs preview migrations only on `main` push).

## LATER

All active P2 quick wins outside the top 5 (#40, #77, #81, #169, #192), open questions (#151, #161), and deferred P3 streams (#21-#23, #37, #39, #43, #52, #53, #60, #62, #63, #76, #79, #123-#125, #136, #158, #191, #194, #195, #203) are maintained on GitHub:
- View full backlog: [SnapTally Open Issues](https://github.com/gordonpn/snaptally/issues)
