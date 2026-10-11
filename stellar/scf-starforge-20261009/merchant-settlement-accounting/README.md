# Merchant settlement accounting

This Node 22+ operator CLI is a read-only integration of the ORIGINAL native SF98 merchant delivery outbox and independently collected ORIGINAL SF86 Stellar testnet transfer-verification results.

It does not sign, purchase, authorize, retry payments, create invoices, or move assets. Existing SF30/SF98 native processSettlement success events come from `../sf98-merchant-delivery/outbox.mjs`, which is imported directly at runtime. Existing SF86 operator outputs retain the actual `stellar-forge.sf86.rpc-reconciliation.v1` schema and verified official testnet RPC response details.

## Operator workflow

On the original merchant host, retain its private SF98 outbox directory with its native `events.ndjson` and `deliveries.ndjson`. In another private directory retain the original authorized operator's SF86 reconciliation JSON result files. Source instructions for this first-party read-only original verification are at `../sf86-rpc-transfer-reconcile/README.md`. The report can be generated with no SF86 files, in which case all native successes remain unverified.

Prepare a private merchant terms JSON (schema `stellar-forge.merchant-accounting-terms.v1`), with a `routes` array. Each route has `routeId`, `method`, `network`, `asset`, `payTo`, `amountAtomic`, `unitPriceUsd`, `unitCostUsd`, and `priceBasis`. These values must come from the real approved original seller configuration, not a made-up example. The stellar testnet `asset` is the actual 56-character C-contract address or G-address and `payTo` is the actual 56-character G-address. USD price and cost values are decimal strings to six places or null for unknown. No automatic currency conversion occurs.

From the current original repository root:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/cli.mjs \
  --outbox /private/merchant/sf98-outbox \
  --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing.json \
  --out /private/merchant/new-reconciliation-report
```

The output directory must be absolute, normalized, private, and nonexistent. It is created at mode 0700. Five create-only mode-0600 files are written: `report.json`, `ledger.csv`, `exceptions.csv`, `review.html`, and `manifest.json`. HTML is offline, mobile/print friendly, grayscale and script-free. CSV rows expose opaque event IDs and hashed transaction/receipt/order references, not original wallet addresses or raw buyer data. Original private source inputs are unchanged. The manifest contains exact SHA256 input and output lineage.

## Operational evidence boundary

`NATIVE_SUCCESS_UNVERIFIED` means the original native SDK reported a settlement success, but no matching independent SF86 official transfer proof was provided. It is not financial recognition.

`OFFICIAL_TRANSFER_MATCHED` requires original SF86 `CHAIN_TRANSFER_MATCHED_RPC_TESTNET`, official RPC source, one exact SEP-41 transfer, the same transaction fingerprint, network, asset, recipient and atomic amount as the original route. `LOCAL_RPC_REPLAY_MATCHED` from a loopback exercise is explicitly excluded. Reused native transaction fingerprints and conflicting proof rows downgrade rather than double count. The official transfer is still bound to a seller-reported transaction hash, not automatically to customer delivery, invoices, cash, finality or refunds.

`WEBHOOK_ACCEPTED_NOT_FULFILLED` means SF98 received a 2xx webhook acknowledgment, not proof of merchant order fulfillment. Exhausted deliveries are exceptions even if the original transfer matched.

`verifiedQuotedValueUsd` is the independently transfer-matched quantity multiplied by the merchant's *own quoted USD unit price*. It is not realized revenue, an exchange-rate valuation, or a payout. Unknown costs remain unknown. No challenge-only 402 count, successful 2xx response, or unverified event is upgraded into sale or cash evidence.

This module complements existing SF97 merchant forecasting, SF93 support, SF98 delivery notifications, and SF82/SF86 chain reconciliation. It creates no new payment protocol, no controller or database, and no hosted GitHub Actions.

## Focused source exercise

Node 22 source parses, and the local private CLI flow was exercised with native SF98-shaped event journal rows and exact SF86-shaped official/local proof schemas, including distinct official matches, ignored local replay, duplicate transaction guard, exhausted delivery and all five output files. The developer exercise used an isolated temporary disk-journal adapter, not the authenticated merchant payment host; only the original operator can produce a live signed purchase and genuine official-RPC receipt.
