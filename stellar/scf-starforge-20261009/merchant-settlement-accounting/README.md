# Merchant settlement accounting

This Node 22+ operator CLI and local workspace integrate the original native SF98 merchant delivery outbox and independently collected original SF86 testnet and public-network transfer-verification results. The [retained SF86 collection workflow](../sf86-rpc-transfer-reconcile/BATCH.md) prepares original checkout files, collects and resumes network reads, and produces this same report end to end.

It does not sign, purchase, authorize, retry payments, create invoices, or move assets. Existing SF30/SF98 native processSettlement success events come from `../sf98-merchant-delivery/outbox.mjs`, which is imported directly at runtime. Existing SF86 operator outputs retain the actual `stellar-forge.sf86.rpc-reconciliation.v1` schema and verified network-specific RPC response details.

## Operator workflow

For a retained browser workflow with source imports, paginated ledger and exception review, before/after comparisons, named operator notes, and original report downloads, use the [merchant settlement workspace](workspace/README.md). It runs this same accounting engine and report writer directly; the command below remains available for one create-only report.

On the original merchant host, retain its private SF98 outbox directory with its native `events.ndjson` and `deliveries.ndjson`. In another private directory retain the original authorized operator's SF86 reconciliation JSON result files. Source instructions for this first-party read-only original verification are at `../sf86-rpc-transfer-reconcile/README.md`. The report can be generated with no SF86 files, in which case all native successes remain unverified.

Prepare a private merchant terms JSON (schema `stellar-forge.merchant-accounting-terms.v1`), with a `routes` array containing one row for **each actual payment option**, up to 200 rows. A resource offering several networks, assets or recipients repeats its `routeId` and `method`. Each row has `routeId`, `method`, `network`, `asset`, `payTo`, `amountAtomic`, `unitPriceUsd`, `unitCostUsd`, and `priceBasis`. These values come from the approved original seller configuration and the merchant's own price records.

| Terms field | Original source |
| --- | --- |
| `routeId`, `method` | Compiled original SF30 route ID and HTTP method |
| `network`, `asset`, `payTo` | The corresponding complete `offer.accepts` entry |
| `amountAtomic` | That option's `amount`, retained as an exact decimal string |
| `unitPriceUsd`, `unitCostUsd` | Merchant-provided USD values, decimal strings to six places or `null` for unknown |
| `priceBasis` | The merchant's description of the approved quote basis |

Both `stellar:testnet` and `stellar:pubnet` terms are accepted. The `asset` is the actual checked C-contract StrKey; `payTo` is the actual checked G-account or C-contract StrKey. Atomic amounts are positive signed-i128 decimal strings, matching the original verifier. No automatic currency conversion occurs. The complete key is route ID, method, network, asset digest, atomic amount and recipient digest. Duplicate complete keys are rejected, including duplicates with conflicting prices. Different actual options on the same resource are retained independently.

From the current original repository root:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/cli.mjs \
  --outbox /private/merchant/sf98-outbox \
  --proof-dir /private/merchant/sf86-results \
  --terms /private/merchant/pricing.json \
  --out /private/merchant/new-reconciliation-report
```

The output directory must be absolute, normalized, private, and nonexistent. It is created at mode 0700. Six create-only mode-0600 files are written:

| Output | Contents |
| --- | --- |
| `report.json` | Existing ledger, route totals, exceptions and lineage, with additive payment-option groups and mapping metadata |
| `ledger.csv` | Every native event, with original columns retained and selected recipient digest, option ID, mapping result, candidate count and verification scope appended |
| `options.csv` | Each configured payment option, including options with no events, plus separate unconfigured or unresolved native groups |
| `exceptions.csv` | Original event/route/reason columns, followed by method, network, option ID and terms mapping |
| `review.html` | Original route and event views, complete option identity and quote/cost terms, separate per-option atomic totals and operator exceptions |
| `manifest.json` | Exact SHA256 input and output lineage |

HTML is offline, mobile/print friendly, grayscale and script-free. Its event and exception rows link directly to the relevant option section. CSV rows expose opaque event IDs and hashed asset/recipient/transaction/receipt/order references, not original wallet addresses or raw buyer data. Original private source inputs are unchanged.

## Selected option and older journals

New original SF98 events add `recipientDigest`, the SHA256 of the selected native payment requirement's `payTo`. The native event retains its existing `stellar-forge.sf98.delivery-event.v1` schema, event ID and deduplication behavior; existing journal entries are not rewritten. No raw recipient address is added to the journal or these reports.

The accounting report records the following mapping results:

| `termsMatch` | Meaning |
| --- | --- |
| `EXACT_OPTION` | All six recorded identity fields match one configured option |
| `LEGACY_UNIQUE_OPTION` | Recipient was not recorded, and the remaining five fields match exactly one configured option |
| `AMBIGUOUS_LEGACY_OPTIONS` | Recipient was not recorded, and the remaining fields match more than one recipient option; the event remains unverified |
| `MISSING_ROUTE_TERMS` | The route and method have no configured merchant terms |
| `OPTION_TERMS_MISMATCH` | The route exists, but its configured options do not match the event's recorded identity |

`recipientDigest` in the event ledger always represents what the original journal recorded, or `null` when absent. `termsRecipientDigest` separately records the matched merchant term's recipient. This preserves the difference between a recorded recipient and a unique legacy mapping. `termsCandidateCount` shows how many actual options remain. Proof contents never choose a recipient from an ambiguous set, and the first configured option receives no preference. Resolve historical ambiguity using the merchant's original settlement/configuration records.

The opaque `optionId` joins each ledger row to its report/CSV/HTML option group. It is a deterministic hash of the six terms, not a payment receipt. Unresolved legacy rows use a distinct recipient-unknown group and cannot merge into a configured recipient group. Configured options with no events remain visible for comparison.

Each option group reports `nativeAmountAtomic` and `officialMatchedAmountAtomic` as exact integer strings. These sums stay within the same route, method, network, asset, per-event amount and resolved recipient. Route and grand totals retain event counts and verified merchant USD quotes; they never add together atomic units from different options. Unknown legacy recipients are explicitly labeled in their own groups.

## Operational evidence boundary

`NATIVE_SUCCESS_UNVERIFIED` means the original native SDK reported a settlement success, but no matching independent SF86 official transfer proof was provided. It is not financial recognition.

A valid `stellar:pubnet` native event joins its own matching original SF86 public-network proof and receives `verificationScope: OFFICIAL_PUBNET_RPC`. Without matching proof it retains `PUBLIC_NETWORK_PENDING` and the corresponding exception. Testnet rows retain `OFFICIAL_TESTNET_ONLY`. Proof lookup, transaction reuse and unused-proof counts all include the network, so identical fingerprints on different networks remain independent.

`OFFICIAL_TRANSFER_MATCHED` requires the original SF86 network-specific verdict (`CHAIN_TRANSFER_MATCHED_RPC_TESTNET` or `CHAIN_TRANSFER_MATCHED_RPC_PUBNET`), its matching RPC source, one exact SEP-41 transfer, and the same transaction fingerprint, network, asset, recipient and atomic amount as the selected original option. Public-network proof additionally binds the listed provider, canonical passphrase, network/transaction response hashes and event-page hashes. A recorded native recipient digest must agree. The [network contract](../sf86-rpc-transfer-reconcile/NETWORKS.md) describes these fields and legacy testnet compatibility. `LOCAL_RPC_REPLAY_MATCHED` remains excluded. Reused native transaction fingerprints and conflicting proof rows downgrade rather than double count. The transfer stays bound to a seller-reported transaction hash; delivery and financial recognition use the merchant's original records.

`WEBHOOK_ACCEPTED_NOT_FULFILLED` means SF98 received a 2xx webhook acknowledgment, not proof of merchant order fulfillment. Exhausted deliveries are exceptions even if the original transfer matched.

`verifiedQuotedValueUsd` is the independently transfer-matched quantity multiplied by the merchant's *own quoted USD unit price*. It is not realized revenue, an exchange-rate valuation, or a payout. Unknown costs remain unknown. No challenge-only 402 count, successful 2xx response, or unverified event is upgraded into sale or cash evidence.

This module complements existing SF97 merchant forecasting, SF93 support, SF98 delivery notifications, and SF82/SF86 chain reconciliation. The optional local workspace retains operator state on private disk. The original accounting engine and CLI remain usable independently.

## Focused source exercise

The original single-option implementation's local private CLI flow was exercised with native SF98-shaped event journal rows and exact SF86-shaped official/local proof schemas, including distinct official matches, ignored local replay, duplicate transaction guard, exhausted delivery and its original five output files. That developer exercise used an isolated temporary disk-journal adapter, not the authenticated merchant payment host; only the original operator can produce a live signed purchase and genuine official-RPC receipt. Multiple-option reporting retains those original SF86 proof criteria and existing outputs, with the additive option fields and `options.csv` described above.
