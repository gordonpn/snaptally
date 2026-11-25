# Project Execution Queue

- **Refreshed:** 2026-11-24
- **Verified base:** `origin/main` at `7d89495`
- **Canonical backlog:** [GitHub Issues](https://github.com/gordonpn/snaptally/issues)
- **Direction:** [Product direction](docs/product-direction.md); offline capture remains the priority before December 12.

## NOW

### [#221: Consecutive intake with an active service worker](https://github.com/gordonpn/snaptally/issues/221)

- **Audit estimate:** P2 / M. **Readiness:** Ready; no open PR covered it at this refresh.
- **Why:** Completes combined offline/consecutive-entry coverage without waiting for unresolved financial policies.
- **First action:** Delay the first POST at the disposable backend boundary while the production worker remains active; avoid page routing that the worker can bypass.
- **Done:** Both mobile engines verify a second distinct durable payload before the first response, then offline/reconnect recovery with exact-once persistence. Record browser-specific worker automation limits.
- **Unblocks:** Confidence in the queue while adding travel payloads.

## NEXT

1. [#63: Checking/e-Transfer and Property/CAD](https://github.com/gordonpn/snaptally/issues/63), P1 / S. Highest-value product work before December/January banking cycles. First pin the representation of rental inflows versus mortgage outflows and the Property category contract. Independent of worker tests once the contract is explicit; retired unit-level accounting stays excluded.
2. [#191: Token-removal cache cleanup](https://github.com/gordonpn/snaptally/issues/191), P3 / S. Ready for reconciliation of existing local work, not a fresh overwrite. Preserve queued money records through an explicit retain/discard flow and verify stale-response guards. Avoid concurrent intake/outbox edits with travel work.
3. [#215: Native foreign cash and FX](https://github.com/gordonpn/snaptally/issues/215), P1 / M. Policy refinement needed: quote direction, rounding, missing/stale rates, and manual override precedence. Preserve confirmed native-cash and non-blocking offline requirements.
4. [#216: Travel date boundaries](https://github.com/gordonpn/snaptally/issues/216), P1 / S. Define open-form midnight, timezone-change and displayed-time semantics first. Automated timezone tests can follow independently of FX; physical device/PWA rehearsal remains separate evidence.
5. [#254: Architecture documentation drift](https://github.com/gordonpn/snaptally/issues/254), P2 / S. Ready and independent: align direct Pages handlers, planned endpoints and retired scope with source and confirmed direction, without changing runtime behavior.

Priority and effort follow existing issue metadata where present; #221's estimate is this audit's recommendation.

## Work delivered for review

The November 24 batch uses independent branches from the same default-branch base:

- [#237 fixture safety](https://github.com/gordonpn/snaptally/issues/237): [PR #250](https://github.com/gordonpn/snaptally/pull/250).
- [#238 Activity DOM coverage](https://github.com/gordonpn/snaptally/issues/238): [PR #251](https://github.com/gordonpn/snaptally/pull/251).
- [#246 haptics investigation](https://github.com/gordonpn/snaptally/issues/246): [PR #249](https://github.com/gordonpn/snaptally/pull/249); recommends no runtime change.
- [#231](https://github.com/gordonpn/snaptally/issues/231) and [#222](https://github.com/gordonpn/snaptally/issues/222): [PR #252](https://github.com/gordonpn/snaptally/pull/252); do not create competing implementations.
- [#245 merchant keyboard dismissal](https://github.com/gordonpn/snaptally/issues/245): [PR #253](https://github.com/gordonpn/snaptally/pull/253), preserving keyboard combobox focus while releasing pointer-selected input focus.

Check the [live PR list](https://github.com/gordonpn/snaptally/pulls) for hosted results and merge status. Local verification or a requested automated review is not hosted success. Only the maintainer merges PRs.

## BLOCKERS AND DEPENDENCIES

- [#224 trip allowance](https://github.com/gordonpn/snaptally/issues/224) needs absent/zero-target behavior; full converted totals also depend on the FX contract. Basic trip tagging can be designed independently.
- [#225 store guardrail](https://github.com/gordonpn/snaptally/issues/225) needs trustworthy rolling/rollover math, pending-spend reconciliation, trip ring-fencing and the trip-summary contract. Cached server totals do not include newly queued expenses.
- [#169 PWA viewport artifact](https://github.com/gordonpn/snaptally/issues/169) needs a reproducible target-device observation; static inspection is not defect reproduction.
- [#192 preview protection](https://github.com/gordonpn/snaptally/issues/192) requires an explicitly authorized Cloudflare configuration change and live access verification.

## Pending Closure Review

These remain open; this audit does not close them:

- [#193 dependency vulnerabilities](https://github.com/gordonpn/snaptally/issues/193): fresh lockfile audit reports zero vulnerabilities and GitHub reports zero open Dependabot alerts. Review remaining original acceptance evidence.
- [#205](https://github.com/gordonpn/snaptally/issues/205) and [#136](https://github.com/gordonpn/snaptally/issues/136): concurrency configuration is already present; verify requested overlapping-event behavior rather than submit duplicate changes.
- [#239 reviewers](https://github.com/gordonpn/snaptally/issues/239): implementation merged and hosted invocation recorded; reconcile all criteria before closure.
- [#81 development fixtures](https://github.com/gordonpn/snaptally/issues/81): substantial scope is in main; compare its remaining checklist with existing implementation and fixture-safety follow-up.

## LATER

Use the [GitHub backlog](https://github.com/gordonpn/snaptally/issues) for deferred Home Overview, aggregation, CSV export, alerts and other work. This queue is a snapshot, not a second backlog; retired enterprise/multi-user scope stays retired.
