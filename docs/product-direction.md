# SnapTally Product Direction

- **Last Updated:** 2026-11-15
- **Baseline:** `main` (`b5c140d`)
- **Active Direction:** Direction B -- Pre-Trip Field-Ready Cockpit (Horizon 1, before December 12, 2026) followed by Home Overview and Direction (Horizon 2, post-trip)

## 1. Product Vision

SnapTally is a single-user personal **Cash-Flow and Spending Decision System**. Because Google Sheets is retired from the owner's workflow, SnapTally serves as the sole system of record from point-of-sale capture through daily spending guardrails and longitudinal cash-flow reflection.

## 2. Guiding Product Principles

1. **Preserve 0ms offline checkout above all else:** Read features, FX rates, and trip metadata must never add network waits or modal friction to sub-5-second transaction entry.
2. **One predictable decision signal at checkout:** Point-of-sale checks show one stable primary percentage (Rolling 30-day pace, or Active Trip Allowance while traveling) with a 1-tap toggle to Rollover, rather than hidden dynamic switching.
3. **No calendar amnesia:** Avoid treating the 1st of the month or January 1 as hard resets; combine rolling windows, rollover balances, and cumulative year-to-date trajectory with same-day month-to-date comparisons (`1st-N`).
4. **Ring-fence non-lifestyle flows:** Canadian property inflows/outflows (`Property / CAD`) and active trip spending must stay cleanly separated so they never distort personal daily `% budget used`.
5. **Evolve taxonomy through real usage:** Keep `parent_bucket` and `subcategory` strings flexible in SQL (`0006_monthly_budgets_schema.sql`) rather than blocking insights behind a premature taxonomy freeze.
6. **Deterministic insights before LLM synthesis:** Establish reliable math, trends, and non-parametric anomaly flags before layering LLM commentary or credit-card rewards optimization.

## 3. Target Workflows

1. **At a store or street stall (Point-of-Decision):** Check `% budget used` on top personal categories (or **Trip Allowance `% used`** when an Active Trip is active) in under 5 seconds, then log the cash or card purchase offline-first.
2. **Canadian banking events (As they occur):** Log mortgage outflows and tenant rent inflows via non-card `Checking` / `e-Transfer` under `Property / CAD` without distorting personal spending gauges.
3. **At home (Reflective Check-In):** Review monthly and year-to-date cash-flow direction, compare `1st-N` pacing against prior periods, inspect Rolling vs. Rollover vs. Cumulative views, and act on deterministic category anomalies.

## 4. Prioritized Roadmap (Direction B)

### Horizon 1: Travel and Complete Capture Readiness (Before December 12, 2026)

1. **CI reliability (`#204`):** Stabilize browser storage fixture isolation and `outbox.ts` coverage determinism (PR `#210` in review).
2. **Non-card rails and Canadian boundary (`#63`, related `#161`):** Support `Checking` / `e-Transfer` non-card entry and a ring-fenced `Property / CAD` category excluded from personal store gauges (covers Dec 1 and Jan 1 mortgage/rent cycles).
3. **Offline-safe foreign cash (`#215`, `#216`):** Support `TWD`, `HKD`, and `VND` cash intake with background-refreshed + manually editable `fx_rate` persisted per transaction, 0-decimal keypad entry for `VND`/`TWD`, raised numeric caps, and validated Asia timezone date boundaries. (No-FX-fee credit cards abroad continue logging directly in `USD`.)
4. **Trip tagging (`#224`) and Store Guardrail (`#225`):** Add optional `trip` tag with an Active Trip Settings preset + USD Trip Allowance, surfaced in a non-blocking Store `% budget used` strip on `/`.

### Horizon 2: Home Overview and Direction (Post-December 12, 2026)

1. **Longitudinal aggregation (`#42`) and Home Overview (`#44`):** Non-resetting Rolling 30d/90d/365d, Carryover/Rollover envelopes, cumulative YTD trajectory, `1st-N` MTD comparisons, CSP income-to-bucket allocation, and deterministic anomaly flags (`1.30x` + `$75` gate).
2. **Data portability (`#226`):** Simple authenticated CSV export for local backups.

## 5. Explicit Cuts, Deferrals, and Retirements

- **Retired (Closed `not planned`):**
  - Multi-tenancy (`#21`, `#22`, `#23`): Personal-only scope for the next 12 months.
  - Complex Montreal duplex/loan P&L tables (`#63` heavy schemas dropped): Owner does not track unit-level taxes, insurance, or mortgage interest.
  - Enterprise ops/contracts (`#53` canaries, `#79` OpenAPI 3.1, `#123` Workers telemetry, `#124` OTel/Prometheus).
  - Balance / net-worth snapshots (dropped from `#44`) and live blocking FX API lookups on submit.
- **Deferred (Post-Horizon 2):**
  - Alert rule/digest pipelines (`#36`, `#37`, `#39`), LLM audit inference (`docs/analytics.md`), credit-card rewards leakage optimizer, merchant rulebook (`#60`), receipt splitting (`#62`), submit confirmation modal (`#158`), and recurring transaction templates.

## 6. Validation Checks Before Pre-Trip Implementation

1. **IndexedDB migration safety:** Verify additive `fx_rate` and `trip` outbox payloads hydrate legacy queued transactions cleanly without triggering `dead_letter_queue` quarantine while offline abroad.
2. **Historical store math sanity check:** Compare Rolling 30-day vs. Rollover percentages against existing D1 transactions and sample category caps before finalizing Store Guardrail display thresholds.
