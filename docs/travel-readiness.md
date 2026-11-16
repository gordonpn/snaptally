# Month-long travel readiness spike

Scope: SnapTally expense capture during approximately one month in Taipei, Hong Kong, and Vietnam. This is a repository readiness assessment for [#189](https://github.com/gordonpn/snaptally/issues/189), inspected at `b5c140d` on 2026-11-15. It does not certify production or target-device behavior. No real-device, roaming, storage-pressure, or timezone-switch rehearsal was performed for this spike. It is not an itinerary, booking tool, or emergency service.

## Recommendation and priorities

Use SnapTally for supported, correctly labeled expenses only after the checklist below passes on the intended phone. Native local-currency capture is the highest-impact product gap. Until resolved, retain local-currency receipts and amounts in a separate record for later reconciliation; never label TWD, HKD, or VND as USD. Any manual USD conversion workflow needs an explicit owner-approved rate and reconciliation policy.

| Priority | Travel scenario and job to be done | Readiness and action |
| --- | --- | --- |
| Must-have | Record a cash meal, transport fare, hotel payment, or refund in its original units | USD/CAD only today. Resolve [#215](https://github.com/gordonpn/snaptally/issues/215) before relying on native TWD/HKD/VND capture. |
| Must-have | Save quickly on weak roaming, airplane mode, or after changing SIM/eSIM | Local queue and retry code exist. Rehearse offline reload, app termination, reconnection, and delayed server response on the phone. A network-online event does not prove API reachability. |
| Must-have | Resume at local midnight or after changing destination | Local date helpers exist; open-form defaults, month summaries and timezone rollover require [#216](https://github.com/gordonpn/snaptally/issues/216). Verify selected dates before saving. |
| Must-have | Avoid losing unsynced expenses when battery dies, storage fills, or device is lost | Validate durable persistence and maintain an independent receipt/amount record until server confirmation. Browser-local queues are not a remote backup. |
| Must-have | Recover access without exposing financial data | Confirm token recovery/revocation procedure separately from the phone. Existing token removal cleanup work is [#191](https://github.com/gordonpn/snaptally/issues/191); preview protection is [#192](https://github.com/gordonpn/snaptally/issues/192). |
| Nice-to-have | Enter Chinese or Vietnamese merchant names and reconcile localized receipts | Free-text merchant entry exists. Rehearse Unicode, diacritics, long names, search and canonical spelling. Translation, localized UI and address storage are not implemented here. |
| Nice-to-have | Split a shared meal, reimbursement or multi-category purchase | Reimbursement exists in the payload; verify chosen accounting convention. Multi-item receipt splitting belongs to [#62](https://github.com/gordonpn/snaptally/issues/62). Shared balances and companion accounts need separate product discovery. |
| Nice-to-have | Review trip spend, share selected records and clean up after returning | Activity supports search/filter and cached data. No implemented export route was found under `functions/api`; architecture's planned export is not an available feature. Use a separately verified reporting/export process. |
| Out of scope | Store flights, trains, hotels, reservation documents or itineraries | Record the associated expense if supported; keep logistics in an appropriate separate tool. |
| Out of scope | Receipt camera/OCR, automatic location, reminders or guaranteed closed-app sync | No such implementation was found in the inspected client/API. Do not depend on these for travel. |
| Out of scope | Emergency contacts, medical help or lost-device response services | Keep independently accessible contingency information; this spike only addresses expense-data recovery. |

## Evidence and gaps

The intake keypad has a lower entry ceiling than the API: `maxCents` is
10,000,000, equivalent to 100,000 in the current two-decimal currencies. The API
accepts up to 1,000,000 in magnitude. Native-currency validation must cover both
limits, particularly for VND; API acceptance alone does not establish keypad entry.

The [architecture](architecture.md) describes intended capabilities as well as implemented ones. The following paths are the evidence for current behavior.

- [Intake](../src/scripts/intake-form.ts) defaults the transaction date through `getTodayDate`, stores a client UUID and `created_at`, and queues before sync. The amount keypad shifts cents and shows two decimal places. [Outbox types](../src/scripts/outbox.ts) restrict currency to USD/CAD; [API validation](../functions/api/transactions.ts) accepts only those currencies and caps absolute amount at 1,000,000. This ceiling and minor-unit convention need review for VND. [Insertion SQL](../queries/insert_transaction.sql) stores currency but no captured FX rate; [monthly summary SQL](../queries/select_month_summary.sql) sums USD expenses only. [#63](https://github.com/gordonpn/snaptally/issues/63) proposes CAD/USD normalization and Montreal assets, not travel currencies. Adding a selector alone cannot deliver correct local-currency accounting.
- [Date helpers](../src/utils/date.ts) derive Today/Yesterday from local calendar components and validate calendar dates. Displayed creation times use the current device locale timezone with English formatting. An intake date is initialized in component state, so a form left open through midnight needs validation. The outbox preserves the selected `date` but does not POST client `created_at`; server creation time must not be assumed to be purchase time after offline delay. [Activity](../src/scripts/activity.ts) explicitly selects the local month with `getTodayDate().slice(0, 7)` when fetching; the API defaults to UTC only when callers omit a valid month. Validate resume and refetch behavior around month boundaries rather than assuming the Activity request uses that API fallback. #216 covers end-to-end validation and decisions, rather than replacing the useful local helpers without evidence.
- [Outbox](../src/scripts/outbox.ts) writes IndexedDB `snaptally_db`, with localStorage fallback and an in-memory fallback when persistence is unavailable. An in-memory fallback cannot survive process termination. Inspect Sync Status and storage warnings; a save message alone is not evidence of remote persistence. The code uses Web Locks where available, with per-tab protection otherwise. Rehearse duplicate prevention across tabs and ambiguous responses; insertion uses UUID conflict handling. `401` pauses sync, `400` quarantines invalid data, and retry/backoff handles transport/server failures including `429`. Dead-letter records need explicit review, retry or confirmed discard.
- [Service worker](../public/sw.js) caches application assets and bypasses `/api/`. [Activity](../src/scripts/activity.ts) separately caches fetched data in localStorage; that cache is not a complete server backup or proof that a fresh route opens offline. Open intake and Activity online first, then validate the exact installed-PWA route sequence offline. Sync listeners use `online` and visibility changes plus timers while the page runs. There is no guarantee of background processing after the browser suspends or terminates the app.
- [Token handling](../src/scripts/intake-form.ts) uses localStorage; [API authentication](../functions/api/auth.ts) uses a bearer token. Clearing a token does not currently guarantee cache/outbox purging or prevent all in-flight repopulation, as tracked by #191. Retaining unsynced records and preventing silent loss is part of that existing issue. No self-service account recovery should be assumed; [#23](https://github.com/gordonpn/snaptally/issues/23) covers token lifecycle/onboarding and [#22](https://github.com/gordonpn/snaptally/issues/22) covers tenant isolation. Do not treat a shared token as a travel-companion account system.
- [Permissions policy](../public/_headers) disables camera, microphone and geolocation. Current expense fields do not provide receipt attachments, coordinates, reservation addresses, or itinerary documents. Merchant text should contain only reconciliation information, not passport details, access codes or sensitive reservation documents. Long Unicode text and locale-specific number conventions remain device-validation tasks; custom keypad input does not imply localized decimal/grouping support. Activity API search also enforces an escaped UTF-8 byte limit, which can constrain multibyte names.

## Follow-up work and owner decisions

Two uncovered requirements have focused followups: [#215](https://github.com/gordonpn/snaptally/issues/215) for native TWD/HKD/VND accounting and [#216](https://github.com/gordonpn/snaptally/issues/216) for date/timezone boundaries. Before implementing #215, the owner must choose reporting currency, FX source and effective date, stale/missing offline-rate behavior, rounding/minor units, refund/reimbursement treatment and whether to reconcile to card settlement or purchase-date estimates. Preserve original units; do not silently adopt a provider or rate policy.

Before implementing #216, decide whether an untouched open form follows local midnight, what constitutes a purchase's calendar date when crossing zones, and whether displayed time represents capture or server insertion. Manually selected backfill and queued dates must remain stable. Validate `Asia/Taipei`, `Asia/Hong_Kong`, and `Asia/Ho_Chi_Minh`, including arrival from a different calendar day and month/year boundaries.

Use existing #191 and #192 for device-data cleanup and preview access, #63 for CAD-only FX, #62 for splitting, and #23 for recovery/lifecycle work. Existing [#52](https://github.com/gordonpn/snaptally/issues/52) covers edge integration tests and [#203](https://github.com/gordonpn/snaptally/issues/203) covers consecutive submission tests. Do not expand those into unrelated travel features. If the device rehearsals below reveal persistence, rendering or recovery failures, file a focused reproduction with browser/OS/version and queue state after checking the backlog. No failure is asserted solely from an unperformed rehearsal.

## Pre-trip validation checklist

Record date, phone model, OS/browser version, installed PWA versus tab, origin, app revision, expected result and actual result for each rehearsal. Use disposable test expenses and a separate test token/environment where available. Open checks below are required validation, not completed test claims.

- [ ] Resolve the native-currency decision or document the explicit separate-record/manual-conversion workflow. Test TWD/HKD/VND precision, a VND amount above the current limit, a refund and reimbursement; verify original units and reporting totals end to end if native support is added.
- [ ] Open intake and Activity online with valid access, then enable airplane mode. Save several distinct expenses; inspect pending count, reload both routes, terminate/reopen the app, and confirm exact amounts, currency, dates and identifiers survive. Repeat in browser and installed PWA.
- [ ] Restore connectivity through the intended roaming/SIM setup. Resume the app, inspect Sync Status, and confirm each entry appears exactly once on the server with no pending or quarantined records. Repeat interrupted/slow response and reconnect across two tabs; distinguish pending display from persisted server entries.
- [ ] In a controlled browser test, exercise unavailable IndexedDB/localStorage and quota failure. Verify warning and recovery behavior. On the phone, verify available storage and rehearse low-battery interruption; do not deliberately erase the only unsynced copy.
- [ ] Complete #216's timezone matrix: local midnight, an open form, explicit backfill, offline save before zone change, sync after arrival, Today/Yesterday headings, displayed time and local month summary. Confirm queued dates stay unchanged.
- [ ] Enter representative Chinese and Vietnamese merchant names, compare saved spelling, search/filter results and receipt amounts. Check amount keypad readability, large values, small screen, landscape and normal battery-saving mode.
- [ ] Verify token recovery and server-side revocation from an independent trusted device/process. Keep recovery access separate from the phone and never place tokens in screenshots or issue reports. Verify #191's unsynced-data policy before relying on token removal as cleanup.
- [ ] Confirm production origin and preview access status under #192; do not rely on a public preview URL for sensitive expense entry.
- [ ] Verify an independent receipt/amount record and a reporting/export process can be accessed after phone loss. Confirm what data exists only locally and what is durably on the server. Do not assume companion sharing, receipt capture or reminders are available.

## During the trip

- [ ] At each entry, check date, amount, currency, card and merchant against the receipt. Keep unsupported-currency information separately and retain reconciliation evidence.
- [ ] After arrival or a device timezone change, check today's date and current-month summary before continuing. Preserve original dates on pending entries.
- [ ] On reliable connectivity, open the app and inspect Sync Status until pending items are confirmed remotely. Review quarantined reasons; correct/retry or explicitly discard only after preserving needed information. Re-entering a pending expense can create a new UUID and duplicate accounting.
- [ ] If access fails or a token is lost, retain pending data and use the verified recovery process. Avoid clearing browser/site storage, reinstalling or removing the token as an improvised sync fix.
- [ ] If storage, battery or network prevents reliable capture, switch to the independent receipt/amount record and reconcile later. Device loss cannot recover an unsynced browser-only queue from the server.

## After returning

- [ ] Flush and verify all pending and quarantined entries before cleanup; reconcile server records, independent notes, receipts, refunds and card settlements without double entry.
- [ ] Review dates around travel boundaries and reporting periods; verify original currencies and conversion provenance under the chosen policy, and exclude unsupported mixed-currency totals.
- [ ] Produce the verified report/export for review or selective companion sharing. Check its coverage and omit tokens and sensitive metadata.
- [ ] Apply the agreed retention policy to receipts and local caches only after reconciliation and backup. Revoke/rotate travel access if appropriate through the verified process; token removal alone is not proof of data deletion until #191 is resolved.
- [ ] Record failed rehearsals and actual trip friction as focused followups, including device context and sanitized evidence.
