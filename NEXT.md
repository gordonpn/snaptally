# Project Execution Queue

- **Last Refined:** 2026-11-15
- **Repository:** [gordonpn/snaptally](https://github.com/gordonpn/snaptally)
- **Verified `main` Commit SHA:** `b5c140d`
- **Product Strategy:** [docs/product-direction.md](docs/product-direction.md)
- **GitHub Backlog:** https://github.com/gordonpn/snaptally/issues

## NOW - Recommended Next Task

### [#204: test(intake): make browser storage fixtures and coverage deterministic](https://github.com/gordonpn/snaptally/issues/204)

- **Priority:** P1 | **Effort:** S | **Readiness:** PR [#210](https://github.com/gordonpn/snaptally/pull/210) in review
- **Why this task is next:** Prevents intermittent 1-branch `codecov/project` failures from blocking every Horizon 1 PR ahead of the December 12 departure.
- **Definition of Done:** Isolated browser-global/storage fixtures with settled async teardown across intake and outbox suites; deterministic tests covering `syncOutbox`/`scheduleDueRetry` deadline and cached-merchant startup branches; three consecutive fresh-process runs of `pnpm run test:coverage` yielding identical line and branch coverage on `src/scripts/outbox.ts` and `src/scripts/intake-form.ts`; and `just typecheck`, `just test-coverage`, and `just lint` passing.

## NEXT - Horizon 1 (Before December 12 Departure)

1. **[#63: Non-card Checking/e-Transfer payment rail and ring-fenced Property / CAD category](https://github.com/gordonpn/snaptally/issues/63)**
   - **Priority:** P1 | **Effort:** S | **Why now:** Covers Dec 1 and Jan 1 Canadian mortgage/rent cycles without distorting personal daily spend gauges.
2. **[#215: Native TWD, HKD, and VND cash accounting with cached editable fx_rate](https://github.com/gordonpn/snaptally/issues/215)**
   - **Priority:** P1 | **Effort:** M | **Why now:** Supports 0ms offline street-cash logging abroad (0-decimal keypad for VND/TWD, raised numeric cap, persisted `fx_rate`), while no-FX cards continue logging USD directly.
3. **[#216: Travel timezone boundaries and local calendar date validation](https://github.com/gordonpn/snaptally/issues/216)**
   - **Priority:** P1 | **Effort:** S | **Why now:** Validates `Asia/Taipei`, `Asia/Hong_Kong`, and `Asia/Ho_Chi_Minh` date boundaries across open forms, offline queue, and Activity.
4. **[#224: Optional trip tag, Active Trip toggle, and Trip Allowance tracking](https://github.com/gordonpn/snaptally/issues/224)**
   - **Priority:** P1 | **Effort:** S | **Why now:** Lets trip dining/bars/transit keep normal categories while tracking against a dedicated Trip Allowance instead of distorting regular monthly `Guilt-Free`.
5. **[#225: Non-blocking Store % budget used guardrail strip on intake view](https://github.com/gordonpn/snaptally/issues/225)**
   - **Priority:** P1 | **Effort:** S | **Why now:** Closes the point-of-decision read gap at stores and abroad (Rolling 30-day or Active Trip primary gauge, 1-tap toggle to Rollover).

*(Active maintenance PRs already in flight: [#207/#205](https://github.com/gordonpn/snaptally/pull/207), [#208/#195](https://github.com/gordonpn/snaptally/pull/208), [#209/#40](https://github.com/gordonpn/snaptally/pull/209), [#211/#41](https://github.com/gordonpn/snaptally/pull/211), [#213/#193](https://github.com/gordonpn/snaptally/pull/213), [#217/#146](https://github.com/gordonpn/snaptally/pull/217), [#220/#189](https://github.com/gordonpn/snaptally/pull/220).)*

## BLOCKERS

- **Pre-trip CI stability (#204 / PR #210):** Landing deterministic coverage fixtures unblocks clean merges across Horizon 1 PRs.
- **Upstream transitive semver bounds (#193 / PR #213):** Patched `sharp` and `undici` versions constrained under `astro`/`wrangler`.
- **Contract decision (#151):** Needs confirmation on keeping bounded negative expense credits permanent.

## RETIRED & CLOSED (2026-11-15)

- **Closed in direction convergence (not planned):** `#21`, `#22`, `#23` (multi-tenancy), `#53` (synthetic canaries), `#79` (OpenAPI 3.1), `#123` (Workers telemetry), `#124` (OTel/Prometheus).
- **Closed in prior backlog audit:** `#78`, `#101`, `#141` (`completed`), `#155` (`duplicate` of `#191`), `#137` (`not planned`).

## LATER - Horizon 2 & Deferred

- **Horizon 2 (Home Overview & Direction, post-Dec 12):** `#42` (non-resetting longitudinal aggregation: Rolling, Rollover, YTD, same-day MTD, deterministic anomalies), `#44` (Home Overview dashboard, net-worth snapshots dropped), `#226` (simple CSV export).
- **Deferred (Post-Horizon 2):** `#36`, `#37`, `#39` (alert streams/digests), `#43` (sinking funds engine), `#60` (rulebook), `#62` (receipt splitting), `#158` (submit confirmation modal), plus remaining tooling/hardening tasks (`#76`, `#77`, `#81`, `#125`, `#136`, `#161`, `#169`, `#191`, `#192`, `#194`, `#195`, `#203`) tracked on [GitHub Issues](https://github.com/gordonpn/snaptally/issues).
