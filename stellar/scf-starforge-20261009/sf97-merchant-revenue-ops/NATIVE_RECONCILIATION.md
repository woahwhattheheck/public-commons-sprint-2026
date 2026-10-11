# SF97 native settlement-to-merchant reconciliation

**Original seller traffic × original SF98 native settlement events × merchant delivery state.** This is a read-only commercial operations integration, not another x402 seller, ledger, payment verifier or dashboard backend. The existing SF97 analyzer can only price merchant targets and HTTP 2xx counterfactuals. This companion joins the **actual** SF98 native-success journal and callback-delivery journal, filters events by the original SF30 session observation window, checks exact route/method/network/atomic amount/asset digest, and exports an actionable owner-private operational view.

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

- Original SF97 report has the **actual original seller HTTP traffic**, a known mode and actual source session timestamps; its owner-entered USD quote is **not** a payment.
- Original SF98 events.ndjson contains original SDK processSettlement-success events with immutable IDs, route, original assetDigest, method, network and atomic amount. An event is included in the observation-window column only when its original at timestamp falls within SF97 observedFrom..observedUntil. Outbox events outside that window are counted separately, not silently converted into demand for this session.
- Every included native event is mapped to the *same seller route* by route ID, method, Stellar network, original amountAtomic and SHA-256(original payment asset). Route/payment mismatches become review actions rather than fabricated per-route counts.
- Original SF98 deliveries.ndjson is interpreted by last recorded state per event: DELIVERED means the *sender received HTTP 2xx from the merchant inbox*, RETRY/REQUEUE/unattempted means callback pending, and EXHAUSTED requires explicit operator repair. HTTP webhook acceptance does **not** prove the merchant fulfilled an order.
- The report deliberately leaves recognized revenue and independent chain settlement status unasserted. An original SDK success plus an HMAC delivery acknowledgment is not a bank deposit, customer acceptance, Stellar ledger finality or legally enforceable invoice.

## Runtime safety and shared ownership

Inputs are operator-private and read only. The tool requires an exact-mode 0600 original SF97 report and native SF98 journal files in a private 0700 original outbox directory. Missing journals represent an empty original outbox; a truncated journal, bad schema, duplicate contradictory event, orphan delivery or source identity conflict fails or opens a clear review item. Nothing is rewritten, re-queued, signed or posted. The output is itself private 0700/0600 and includes the original source hashes, not raw customer request headers or bodies.

SF30 remains seller/traffic owner. SF98 remains native settlement-event and HTTPS sender owner. SF97 remains commercial valuation owner. SF49 and the SCF #46 founder remain merchant relationship and grant narrative owners. This addition gives those owners one practical **actual native payment-event to merchant-receipt funnel** without promoting HTTP traffic to cash or modifying the existing sender.

### Source-native execution handoff

For the existing Muse/merchant operator already running the original seller, rerun the above commands against **the original same merchant and its genuine source**. Return the source commit, original SF30 session ID/mode, original SF98 native event count/delivery state, mismatch queue and CLI outcome to #sim-data. A challenge-only local session with zero SF98 native events is valid for service readiness, but cannot be called a successful paid-pilot test. A real settled testnet transaction, if independently authorized and already captured by the original operator, should be independently reconciled with the original SF82/SF86 provider records.
