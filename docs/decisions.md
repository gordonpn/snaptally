# Implementation Decisions Log

## 2026-11-24: Enforce declared toolchain parity without changing tool provenance

- Decision: Keep CI Node/pnpm on documented major tracks, align Biome exactly across mise/package/lock/schema, and check the pinned reviewdog action against inspected bundled-version metadata while preserving the separate official local actionlint binary.
- Rationale: Dependency upgrades already caused Biome drift, while reviewdog's installer uses a different actionlint fork. Treating these executables as identical would hide that operational boundary.
- Rejected alternatives: Changing actionlint provenance, adding parser dependencies, or fetching upstream action sources during each local/CI check.
- Source: [Toolchain parity](https://github.com/gordonpn/snaptally/issues/231), [CI pin policy](https://github.com/gordonpn/snaptally/issues/222), [toolchain verification](toolchain.md).

## 2026-11-16: Preserve formatter scope during the Biome upgrade

- Decision: Align the configuration schema and hosted Biome version with the installed 2.6.7 dependency; leave Markdown and YAML formatting disabled.
- Rationale: The upgrade enables additional file formats by default, making existing local lint fail even while hosted review checks pass.
- Rejected alternatives: Reformatting unrelated documentation and configuration as part of a dependency update.
- Source: [Biome dependency update](https://github.com/gordonpn/snaptally/pull/234)

This document records non-obvious engineering and implementation decisions made in SnapTally, ordered newest first. Architectural or hard-to-reverse decisions are promoted to formal Architecture Decision Records under `docs/adr/` where adopted.

## 2026-11-15: Personal cash-flow focus, Dec 12 travel readiness cutline, and scope retirement

- Decision: Focus SnapTally over the next 12 months strictly as a personal Cash-Flow and Spending Decision System (retiring Google Sheets from the owner's workflow). Split delivery into Horizon 1 (before December 12, 2026 travel: `#204` test stability, non-card `Checking`/`e-Transfer` and ring-fenced `Property / CAD` `#63`, native `TWD`/`HKD`/`VND` cash intake with background-cached editable `fx_rate` `#215`, timezone validation `#216`, optional `trip` tag and Active Trip allowance `#224`, and a non-blocking Store `% budget used` guardrail strip `#225`) and Horizon 2 (post-trip Home Overview `#42`/`#44` with Rolling, Rollover, YTD, same-day MTD comparisons, deterministic anomaly flags, and simple CSV backup `#226`). Keep SQL taxonomy flexible rather than freezing a 6-bucket schema, drop net-worth balance snapshots and heavy duplex tax/interest accounting, defer LLM/alert/rewards automation (`#36`, `#37`, `#39`, `#60`, `#62`, `#158`), and retire multi-tenancy (`#21`-`#23`) and enterprise telemetry/OpenAPI (`#53`, `#79`, `#123`, `#124`).
- Rationale: Unlocks immediate point-of-decision and longitudinal value on real transaction data before international departure without stalling behind premature multi-user, net-worth, or taxonomy-freeze abstractions.
- Rejected alternatives: Executing the full multi-tenant/enterprise/6-bucket backlog as originally ordered, or deferring all multi-currency/trip features past departure.
- Source: [product-direction.md](product-direction.md)

## 2026-11-13: Bounded browser-local offline cache for first-page Activity data

- Decision: Persist only the latest successful first page and monthly summary of Activity transactions in browser storage keyed by the token's SHA-256 fingerprint and exact query parameters (month, bucket, search, and page size), restoring cached data on matching offline network failures with a visible notice and disabled pagination.
- Rationale: Prevent network failures after page load from wiping the Activity view without persisting raw bearer tokens or masking HTTP errors and authentication rejections.
- Rejected alternatives: Clearing the transaction list on network failures or serving stale cached data during server HTTP errors (authentication failures also purge the cache).
- Source: [#186 fix(activity): restore cached transactions when offline](https://github.com/gordonpn/snaptally/pull/186), [#140 Activity offline cache](https://github.com/gordonpn/snaptally/issues/140)

## 2026-11-13: Static response CSP headers, PWA metadata revalidation, and multi-page precaching

- Decision: Add Cloudflare Pages `_headers` CSP rules blocking framing, object embedding, inline scripts, and external API origins (keeping the documented `script-src 'unsafe-eval'` exception for standard Alpine), require HTTP revalidation for `/sw.js` and `/manifest.json`, cache hashed Astro bundles immutably for one year, and scan every precached HTML entrypoint during service worker install to precache Activity bundles as well as intake bundles.
- Rationale: Protect static documents from injection and clickjacking, avoid stale PWA metadata, and cache the `/activity` HTML before a user's first Activity visit. Its scripts are cached only when the install-time bundle fetch succeeds.
- Rejected alternatives: Immediate migration to the Alpine CSP build (deferred and documented in `docs/security-headers.md`).
- Source: [#175 fix(pwa): secure static responses and revalidate PWA metadata](https://github.com/gordonpn/snaptally/pull/175), [#180 fix(pwa): precache bundles from all application pages](https://github.com/gordonpn/snaptally/pull/180), [#133 Static security headers and PWA caching](https://github.com/gordonpn/snaptally/issues/133), [#139 Precache Activity page bundles](https://github.com/gordonpn/snaptally/issues/139), [security-headers.md](security-headers.md)

## 2026-11-10: Exclude Income from Activity monthly spend totals while preserving credits

- Decision: Exclude the `Income` bucket from Activity USD monthly spend totals and counts using indexed date boundaries while retaining expense reimbursements and credits in spend totals and keeping Income rows visible in the feed.
- Rationale: Prevent income records from inflating monthly expense metrics without sacrificing indexed date filtering or net-spend accounting.
- Rejected alternatives: Not recorded in the source.
- Source: [#167 fix(activity): exclude income from monthly spend summary](https://github.com/gordonpn/snaptally/pull/167), [#131 Exclude income from monthly spend summary](https://github.com/gordonpn/snaptally/issues/131)

## 2026-11-09: Safe repeatable backfill workflow with plan, manifest, and lock

- Decision: Build `scripts/backfill.ts` around a read-only `plan` classification step (`already_present`, `missing`, `conflicting`, `extra`), manifest tracking, and locking across 12 sheet adapters, storing amounts in original `USD` or `CAD` currency, skipping zero-amount formula anchors, and stripping UTF-8 BOMs from reconciled CSV exports.
- Rationale: Allow repeated historical Google Sheets imports to resume safely and detect conflicts against live D1 data without corrupting existing rows or baking snapshot FX rates into historical records.
- Rejected alternatives: Converting CAD amounts at snapshot exchange rates during ingestion.
- Source: [#165 feat(backfill): implement safe repeatable workflow with plan, manifest, and lock](https://github.com/gordonpn/snaptally/pull/165), [#109 feat(backfill): promote reconciled batch-4 budget CSVs to primary backfill source](https://github.com/gordonpn/snaptally/pull/109), [#100 feat: add google sheets historical backfill pipeline](https://github.com/gordonpn/snaptally/pull/100), [#163 Repeatable backfill workflow](https://github.com/gordonpn/snaptally/issues/163)

## 2026-11-03: Direct merchant autocomplete combobox and frequency-recency card ordering

- Decision: Replace horizontal merchant pill chips and the "Other..." toggle with a single permanent combobox (`merchant-input`) backed by local cached merchants and prefix/frequency ranking, infer category and card defaults without overwriting manual selections, and sort payment cards by usage frequency then recency and alphabet.
- Rationale: Eliminate horizontal scrolling and extra taps at checkout while keeping user overrides intact.
- Rejected alternatives: Retaining horizontally scrolling frequent merchant chips paired with a separate toggle button.
- Source: [#147 feat(intake): replace merchant pill chips with direct autocomplete free text box (#144)](https://github.com/gordonpn/snaptally/pull/147), [#166 feat(intake): sort credit cards by frequency and recency](https://github.com/gordonpn/snaptally/pull/166), [#119 feat(intake): infer merchant defaults](https://github.com/gordonpn/snaptally/pull/119), [#144 Direct merchant combobox](https://github.com/gordonpn/snaptally/issues/144), [#164 Sort credit cards by frequency and recency](https://github.com/gordonpn/snaptally/issues/164)

## 2026-11-02: Native dialog focus lifecycles, switchable themes, and fullscreen Activity route

- Decision: Use native HTML `<dialog>` lifecycles for Settings and Sync Status modals (discarding unsaved token edits on cancel), support Neumorphic vs Modern Minimal themes in `localStorage`, and isolate transaction browsing, search, and filtering in a dedicated `/activity` page instead of an intake-screen modal.
- Rationale: Trap keyboard focus cleanly inside open dialogs without exposing background intake controls and keep the primary intake viewport fast and uncluttered.
- Rejected alternatives: CSS visibility-toggled modal overlays and keeping transaction history inside a modal on the intake page.
- Source: [#183 fix(settings): use native modal focus lifecycle](https://github.com/gordonpn/snaptally/pull/183), [#130 feat: configurable UI themes in Settings (Modern Minimal vs Neumorphic)](https://github.com/gordonpn/snaptally/pull/130), [#126 feat: implement dedicated fullscreen Activity view (/activity)](https://github.com/gordonpn/snaptally/pull/126), [#111 feat: add outbox sync status drawer](https://github.com/gordonpn/snaptally/pull/111)

## 2026-10-27: Multi-currency persistence, negative refund validation, and Income separation

- Decision: Persist an explicit `currency` column (`USD` default, supporting `CAD`) on D1 transactions, accept negative `gross_amount` values for refunds with `reimbursement === 0` required, and replace `Income -> Reimbursement` with `Income -> Other` while disabling the `Income` bucket in credit mode.
- Rationale: Track net spend accurately for split expenses and returns while keeping incoming income separate from expense reimbursements.
- Rejected alternatives: Keeping `Reimbursement` under the `Income` category.
- Source: [#156 feat(intake): support CAD transaction entry](https://github.com/gordonpn/snaptally/pull/156), [#117 refactor(taxonomy): remove Reimbursement from Income](https://github.com/gordonpn/snaptally/pull/117), [#99 feat: add transaction currency column and expand taxonomy (#98)](https://github.com/gordonpn/snaptally/pull/99), [#90 feat: implement refund and reimbursement intake workflows for split expenses and returns (#89)](https://github.com/gordonpn/snaptally/pull/90)

## 2026-10-19: IndexedDB outbox with dead-letter quarantine and Cloudflare D1 storage

- Decision: Write intake submissions to IndexedDB (`outbox`) first, isolate HTTP 400 validation failures in a `dead_letter_queue` store while pausing sequential background sync on HTTP 401, and persist transactions in Cloudflare D1 serverless SQLite (formalized in [ADR 0001](adr/0001-use-d1-for-local-first-storage.md)).
- Rationale: Preserve 0ms perceived checkout intake offline and prevent a single malformed payload from blocking healthy queued items or suffering silent loss.
- Rejected alternatives: Blocking the entire outbox or silently dropping rejected HTTP 400 items.
- Source: [#102 feat: implement dead-letter queue for failed transaction persistence](https://github.com/gordonpn/snaptally/pull/102), [#95 Dead-letter queue for failed transaction persistence](https://github.com/gordonpn/snaptally/issues/95), [ADR 0001: Use D1 for local-first storage](adr/0001-use-d1-for-local-first-storage.md), [architecture.md](architecture.md)

## 2026-10-13: Deterministic transaction normalizer and SQLite/LLM analytics boundary

- Decision: Classify bank descriptors through deterministic boilerplate removal and greedy longest-token matching (`src/utils/merchant-normalizer.ts`), and compute statistical anomalies and credit-card rewards leakage in SQLite and TypeScript before passing pre-aggregated summaries to an LLM.
- Rationale: Ensure financial calculations and merchant normalization remain deterministic, testable, and protected from LLM arithmetic errors.
- Rejected alternatives: Relying on non-deterministic LLM inference for primary merchant normalization or financial arithmetic.
- Source: [#87 feat: implement deterministic transaction normalizer and payment rail extractor](https://github.com/gordonpn/snaptally/pull/87), [#85 docs: codify modular analytics architecture and deterministic rewards auditor](https://github.com/gordonpn/snaptally/pull/85), [normalization.md](normalization.md), [analytics.md](analytics.md)
