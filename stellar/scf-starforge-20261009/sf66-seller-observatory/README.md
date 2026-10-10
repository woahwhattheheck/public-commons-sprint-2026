# SF66 · Seller Observatory, original x402 merchant continuity

**Use case:** the one-off [SF52 read-only seller discovery diagnostic](../sf52-merchant-visibility/README.md) and [SF64 merchant checkout report](../sf64-merchant-conversion-report/README.md) already produce high-quality evidence. This is a **distinct operator product** for a merchant or service provider: maintain a local series of **actual** seller/facilitator observations, surface changes in discoverability, preserve original diagnostic JSON, and triage seller 402/crawl regressions between observations. It calls the **existing, unchanged** SF52 `diagnose()` and SF64 `validateOriginalReport()` / `interpret()`; there is no second crawler, ranker, wallet, provider SDK, payment processor, hosted monitor or reinvention of the report renderer. MIT.

## Run in the real operator's checkout (Node 22+)

Create a private `merchants.json` (not inside your public Git clone), selecting seller URLs, the **specific facilitator's original** discovery listing route, Stellar network and optional public recipient:

```json
{
  "targets": [
    {"id":"merchant-a", "resource":"https://actual-opt-in-seller.example/paid", "catalog":"https://actual-facilitator.example/discovery/resources", "network":"stellar:testnet", "payTo":"PUBLIC_SELLER_RECIPIENT"}
  ]
}
```

The URLs above are **placeholders for operator configuration, not a provider fixture or evidence.** Use actual merchant endpoints you are authorized to inspect and a real compatible network/facilitator. Targets are 1–32, IDs are local aliases, remote endpoints must be HTTPS, and no API credentials can be in URL. It does not collect any card/secret or use authentication.

```sh
# Real seller and catalog **GET only**, sequentially, full native pagination within SF52 limits
node stellar/scf-starforge-20261009/sf66-seller-observatory/observatory.mjs once \
  --config /private/merchants.json --data /private/merchant-observatory

# Rehash and verify every retained original SF52 report + appended observation chain
node stellar/scf-starforge-20261009/sf66-seller-observatory/observatory.mjs verify \
  --data /private/merchant-observatory

# Rebuild offline customer-facing summary without any external request
node stellar/scf-starforge-20261009/sf66-seller-observatory/observatory.mjs render \
  --data /private/merchant-observatory
```

Open `/private/merchant-observatory/merchant-observatory.html` in a local browser; the CSP permits no remote resource, JS, telemetry or forms. The page includes latest individual seller source states, exhaustive/inconclusive facilitator coverage, first-party SF64 prioritized repair steps and a recent original-report history. Local links expose the unmodified source diagnostic JSON only to an operator with filesystem permission. No buyer-facing network service is started.

### Consume ORIGINAL Muse or operator captures without re-probing

If the existing SF41/Muse run already created an authentic `stellar-forge.seller-visibility.v1` JSON for this **same** merchant, facilitator, network and recipient, import its **unchanged bytes** instead of hitting a live endpoint again:

```sh
node stellar/scf-starforge-20261009/sf66-seller-observatory/observatory.mjs import \
  --config /private/merchants.json --data /private/merchant-observatory \
  --id merchant-a --report /private/source/sf52-native-result.json \
  --observed-at 2026-10-10T20:18:06Z
```

**The UTC time shown above is ONLY an example CLI argument.** Supply the original observation time from your actual capture receipt. If that time is not available, **omit** `--observed-at`; the dashboard explicitly displays “Source time unprovided,” while `ingestedAt` separately records the local import instant. The tool rejects mismatched original report seller, network, recipient or facilitator rather than quietly splicing one merchant's 402 with another facilitator's rows.

## Evidence and failure behavior

- Every run reuses original SF52 status/402 decoding and **the original facilitator's entire bounded pagination semantics**. It neither equates 200 with payment nor equates an incomplete catalog with an absent seller. Invalid/incomplete scan results remain the original classifications; this product never changes provider findings or attempts a payment.
- Each report is stored byte-for-byte (import) or as the original `diagnose()` JSON output (live) under `evidence/<id>/`, with SHA-256 in a verified append-only `history.jsonl`. The SHA chain detects accidental/unauthorized modification, **not** independent signature/authenticity. History and all evidence are checked before appending; unexpected partial history or missing/edited files stops the run. A `.writer.lock` file prevents overlapping writer processes; after process crash, resolve the actual old process and inspect ledger state **before manually clearing an orphan lock**.
- `LISTING_REGRESSION` requires prior `LISTED` and new exhaustively `NOT_LISTED_IN_EXHAUSTED_CATALOG` under identical source scope. `CHALLENGE_REGRESSION` means formerly valid 402 now isn't valid. If the original catalog is incomplete, surface `CATALOG_INCONCLUSIVE`, **never** call absence. A changed seller/facilitator/network/recipient scope is `SOURCE_SCOPE_CHANGED`, not a false trend. The dashboard's first repair action is composed from unchanged original SF64 `interpret()`.
- Remote origins are never selected by a visitor. No signed requests, retrying payments, wallets, payouts, invoices, external prospect messages, SCF application sends, GitHub Actions or background timers are involved. All targets are configured by the merchant operator. For seller rate/policy limits, only inspect endpoints where read-only GETs are approved; `once` deliberately runs serially and never auto-schedules itself.
- This is an operable **commercial service capability**, not evidence that any buyer is paying, any listing is endorsed, actual Stellar payment has settled, or a grant track/application is approved. A real contract and customer authorization are separate. Existing SF10, SF41/Muse, SF52, SF56, SF64 and SF65 owners retain their work.

## Local focused acceptance

```sh
node --test stellar/scf-starforge-20261009/sf66-seller-observatory/test/observatory.test.mjs
```

That single offline regression checks byte-preserving importer/history, actual filesystem tamper detection and trend logic with clearly **fictional mechanics-only** test objects. It is **not** an x402 provider simulation or genuine seller performance result. For 1:1 provider runs, feed original consented SF52 reports produced by the **existing SF41/Muse original-source operator**; retain exact native provider timestamps, source byte hashes and full report coverage. This avoids replaying an artificial catalog as customer evidence.
