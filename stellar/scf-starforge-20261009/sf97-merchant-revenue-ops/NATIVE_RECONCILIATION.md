# SF97 native settlement-to-merchant reconciliation

**Original seller traffic × original SF98 native settlement events × merchant delivery state.** This is a read-only commercial operations integration, not another x402 seller, ledger, payment verifier or dashboard backend. The existing SF97 analyzer prices merchant targets and HTTP 2xx counterfactuals. This companion joins the actual SF98 native-success journal and callback-delivery journal, filters events by the original SF30 process capture or retained session/day/route coverage, checks exact route/method/network/atomic amount/asset/recipient identity across every configured payment choice, and exports an owner-private operational view.

## One source-native operator journey

1. Start the original SF30 seller and original SF30 operations listener with the real merchant-owned configuration. Capture real observed traffic in original SF97 with either --ops-url or an original SF30 snapshot. Keep merchant costs unknown/null when unknown.
2. Operate the original SF98 post-settlement outbox decorator only with a legitimate SF30 native-compatible facilitator and independently authorized merchant run. Original SF98 outbox events are recorded ONLY on native processSettlement success. Its original explicit deliver.mjs drain sends already-signed merchant callbacks and records receipt statuses.
3. From the same operator-private workstation, join the ORIGINAL SF97 report and ORIGINAL SF98 outbox directory without modifying either source. The utility loads actual append-only journals from disk rather than interpolating a simulated settlement, paid response, merchant invoice or replacement native proof.

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
R=stellar/scf-starforge-20261009/sf97-merchant-revenue-ops
node "$S/operations/launch.mjs" --operations-port 8424 -- --config /private/merchant/seller.json --port 8423
# With the original running seller and its real owner-priced terms:
node "$R/analyze.mjs" --config /private/merchant/seller.json --terms /private/merchant/pricing.json --ops-url http://127.0.0.1:8424 --output /private/reviews/sf97-http-001
# The actual SF98 settlement outbox comes from the same merchant's original native runtime.
node "$R/native-reconcile.mjs" --report /private/reviews/sf97-http-001/report.json --outbox /private/merchant/sf98-outbox --out /private/reviews/sf97-native-001
```

Open /private/reviews/sf97-native-001/native-ops.html locally. The output directory must not exist. The four create-only private files are native-ops.json, native-ops.html, operator-actions.md, and manifest.json, with source SHA-256 digests and file hashes. No npm dependency, hosted Actions, network request, wallet, payment operation or automated job.

## What is actually counted

- Original SF97 report has the **actual original seller HTTP traffic**, actual modes and source session timestamps; its owner-entered USD quote is **not** a payment. A retained period preserves every matching session rather than inventing a single process identity.
- Original SF98 events.ndjson contains original SDK processSettlement-success events with immutable IDs, route, original assetDigest, method, network and atomic amount. Current events also carry `recipientDigest`, the SHA-256 of the selected original `payTo`. For a process report, the original event time must fall within SF97 observedFrom..observedUntil. For a retained period it must also match the selected day and actual saved session/route coverage described below. Out-of-scope events are counted separately.
- Every included native event is matched to a complete configured option by route ID, method, Stellar network, original amountAtomic, SHA-256(original payment asset), and recorded recipient digest. All six maintained SF30 methods (`GET`, `HEAD`, `DELETE`, `POST`, `PUT`, `PATCH`) use the original `supportsSellerMethod` helper. Testnet and pubnet notices can coexist in one journal and report. This view does not assign independent chain status to either network.
- Original SF98 deliveries.ndjson is interpreted by last recorded state per event: DELIVERED means the *sender received HTTP 2xx from the merchant inbox*, RETRY/REQUEUE/unattempted means callback pending, and EXHAUSTED requires explicit operator repair. HTTP webhook acceptance does **not** prove the merchant fulfilled an order.
- The report deliberately leaves recognized revenue and independent chain settlement status unasserted. An original SDK success plus an HMAC delivery acknowledgment is not a bank deposit, customer acceptance, Stellar ledger finality or legally enforceable invoice.

## Payment options, recipients and older captures

The modern SF97 source report carries complete `paymentOptions` in merchant order. This companion validates them through the same original SF30 normalizer as the analyzer. A legacy report containing only the original single `payment` object is still readable; its absent timeout is displayed as not recorded. When both fields are present on a single-option report, their payment identities must agree. A multi-option report cannot also assert one legacy `payment` as its sole identity.

Matching uses the recorded recipient when available. Older original journals can omit the digest or carry `null`; that absence stays visible in the exported event row. The result is explicit:

| `termsMatch` | Meaning | Route/option counts |
| --- | --- | --- |
| `EXACT_OPTION` | All six route/method/network/asset/amount/recipient fields match one configured option. | Included. |
| `LEGACY_UNIQUE_OPTION` | The event has no recipient digest, and the other five fields identify exactly one configured option. | Included with a separate legacy count. |
| `AMBIGUOUS_LEGACY_OPTIONS` | An older event could belong to multiple offered recipients. | Unassigned; candidate option IDs are exported. |
| `OPTION_TERMS_MISMATCH` | A recorded recipient or other payment field differs, or no option matches. | Unassigned; event identity and callback state remain visible. |
| `MISSING_ROUTE_TERMS` | The native event belongs to a route absent from this source report. | Unassigned. |
| `HISTORICAL_ROUTE_VARIANT` | Saved session coverage identifies an older method/path for that route. | Unassigned; the current route quote is not applied. |
| `AMBIGUOUS_ROUTE_VARIANTS` | Saved coverage could refer to both current and older method/path variants. | Unassigned; the source does not identify one current variant. |

A wrong recorded recipient never falls back to the first alternative or to legacy matching. Multiple recipients with the same network, asset and amount remain distinguishable for new events. Existing events and delivery journals are read in place; the companion does not replace missing recipient data. Use the retained configuration and original merchant order records to investigate historical mismatches. Updated SF98 records selected-recipient digests for subsequent native events.

## Retained period and session coverage

Create the same SF97 report from the original operations history export, then use this companion unchanged:

```sh
node "$R/analyze.mjs" \
  --config /private/merchant/seller.json \
  --terms /private/merchant/pricing.json \
  --history /private/captures/original-history.json \
  --native-outbox /private/merchant/sf98-outbox \
  --output /private/reviews/merchant-retained-period
```

The original live `/history.json` or `/api/history` endpoint can be selected with `--ops-url`, including its `from`, `to` and optional `routeId` parameters. The [period reporting guide](README.md#review-a-retained-period-across-seller-restarts) gives the complete operator workflow and pricing semantics. Existing process reports and legacy single-payment reports remain supported.

A report with `observationKind: "DURABLE_HISTORY"` contains its normalized original `usageHistory`. The companion validates that source through the original history normalizer, checks the session/mode identity and route HTTP counters, and then uses the retained coverage for each event:

1. Select the actual effective retained UTC dates and optional route filter.
2. Require a saved day and an actual original session interval containing the event time. A quiet gap between stopped/restarted sessions remains a gap even if both sessions occurred on the same day.
3. Match the original route ID and method to the saved day. Modern exports also specify the exact session/day route keys, so an old path is not confused with a new path sharing the same route ID.
4. Apply the existing complete payment-option and selected-recipient matching only when that coverage identifies the current route variant. Retain older or ambiguous variants as unassigned events.

The exported exclusions make the decision reviewable:

| `excludedEvents[].reason` | Meaning |
| --- | --- |
| `OUTSIDE_SELECTED_PERIOD` | Event date falls outside the actual effective retained date range. |
| `OUTSIDE_ROUTE_SELECTION` | A route-filtered history export selected a different route. |
| `NO_SAVED_DAY` | The original export has no saved observations for that UTC day. |
| `SESSION_GAP` | No selected original session interval contains the event time. |
| `NO_SAVED_ROUTE_COVERAGE` | A session exists, but the selected saved day does not cover that event's route and method. |

These events remain in the original outbox. The report preserves their IDs, dates and reasons, and excludes them from route/option sums. `outsideObservationWindow` continues to count all excluded events; period results also expose `outsideSelectedPeriod`, `outsideRouteSelection` and `outsideSavedCoverage`. The envelope `observedFrom..observedUntil` is descriptive, not a continuous coverage claim.

Included period events add `coverageBasis`, `observedSessionIds`, `observedSessionModes` and `usageRouteKeys`. Overlapping observed sessions can be listed without counting an event twice. Modes remain tied to the actual candidate sessions: a native notice falling only within challenge-only coverage is visible for source correlation even when the overall period is `MIXED`.

Modern original history exports add per-session `retainedDays` under `coverageFormat: "stellar-forge.seller-usage-day-routes.v1"`. For earlier exports, the companion uses the original session intervals and retained day route variants. It labels that basis `LEGACY_SESSION_AND_DAY`, and keeps ambiguous current/old variants unassigned. It does not infer missing per-session membership from total request counts. Re-exporting the still-retained original history through the current operations listener provides the additional membership directly from the original saved records, without replaying traffic or payments.

The native HTML shows saved session intervals and states, exclusion reasons, and each event's coverage basis alongside the existing option cards and callback states. `usageSummary` retains the selected range, modes, session details and exclusions in the native JSON. An interrupted checkpoint describes only what the original observer saved; absence from its coverage does not establish that no later native payment occurred.

### Report and operator view

The original JSON schema, route counters, totals, source hashes and four output filenames remain. Additive `options` and `events` arrays provide the complete attribution:

- `routes` retains actual HTTP 2xx/402 counts and aligned native/delivery counts. `paymentOptionCount` shows how many alternatives belong to each route.
- `options` includes every configured choice, including choices with zero events. Each row carries route/method/network/asset digest/amount/recipient digest, original option order, timeout when recorded, and whether extra metadata exists in the private SF97 source. The source report retains the full metadata.
- Option counts separate native notices, inbox acceptance, pending callbacks, exhausted callbacks, exact-recipient events and uniquely resolved legacy events. `nativeAtomicAmount`, `inboxAcceptedAtomicAmount`, `pendingAtomicAmount` and `exhaustedAtomicAmount` use decimal-string BigInt sums inside that one complete option. There is no cross-asset or cross-network atomic total.
- `events` retains the original event ID, receipt fingerprint, recorded recipient digest, matched terms recipient, `termsMatch`, candidate count and IDs, selected `optionId`, and latest callback state. Unassigned in-window notices remain in this array even though they contribute to no option count. Raw recipient addresses, order references and request bodies are not copied into the native view.
- Option `http2xx` and `http402` are `null`: the original observer did not record payment-option attribution. `quotedUsd` is the route's common merchant-entered valuation and is labeled `SHARED_ROUTE_QUOTE`; it is not multiplied into receipts or split using a guessed payment mix.

`optionId` is shared with [merchant settlement accounting](../merchant-settlement-accounting/README.md): SHA-256 of `stellar-forge.merchant-option.v1`, a newline, then route ID, method, network, asset digest, atomic amount and recipient digest separated by newlines. It stays stable when presentation order or a commercial USD quote changes. SF97's recipient matching identifies native notices; independent official-testnet proof matching remains owned by the existing SF86/accounting path.

The offline HTML shows route totals, one card per complete option with native and callback atomic totals, and a native-event assignment table. Matched events link to their option card; ambiguous and mismatched events appear in the repair queue. This gives the operator a usable option-to-delivery view without reallocating route traffic.

## Runtime safety and shared ownership

Inputs are operator-private and read only. The tool requires an exact-mode 0600 original SF97 report and native SF98 journal files in a private 0700 original outbox directory. Missing journals represent an empty original outbox; a truncated journal, bad schema, duplicate contradictory event, orphan delivery or source identity conflict fails or opens a clear review item. Nothing is rewritten, re-queued, signed or posted. The output is itself private 0700/0600 and includes the original source hashes, not raw customer request headers or bodies.

SF30 remains seller/traffic owner. SF98 remains native settlement-event and HTTPS sender owner. SF97 remains commercial valuation owner. SF49 and the SCF #46 founder remain merchant relationship and grant narrative owners. This addition gives those owners one practical **actual native payment-event to merchant-receipt funnel** without promoting HTTP traffic to cash or modifying the existing sender.

### Source-native execution handoff

For the existing Muse/merchant operator, use the original same merchant's retained configuration, traffic capture, and native journals. Existing source captures can be reprocessed by this read-only view without replaying payments or rerunning the seller. Return the source commit, original SF30 session ID/mode, option and recipient match counts, original SF98 delivery state, mismatch queue and CLI outcome to #sim-data. Keep a challenge-only source labeled as such. Existing independently captured testnet transactions can continue through the original SF82/SF86 provider reconciliation.
