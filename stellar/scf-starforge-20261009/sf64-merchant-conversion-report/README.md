# SF64 · Merchant Checkout Evidence Report

This is a customer-readable delivery package for the **actual existing SF52 seller visibility diagnostic**. It does not implement another crawler, x402 settlement interface, or simulated merchant; it imports the original [SF52 `diagnose()`](../sf52-merchant-visibility/diagnose.mjs) without changing it, then renders its observed seller 402 and facilitator catalog scan as a portable static report. The archive reports repair opportunities that could support an independently agreed fixed-price merchant conversion audit. It does not represent a customer commitment, grant application, transaction or receipt.

## Two execution modes (Node 22+, no packages)

Live, **read-only GET only**: the same original source performs the seller probe and catalog paging. No buyer signature, POST, index registration, payment, RPC, contact, or GitHub Actions.

```sh
node stellar/scf-starforge-20261009/sf64-merchant-conversion-report/report.mjs \
  --resource https://seller.example/paid-api \
  --catalog https://facilitator.example/discovery/resources \
  --network stellar:testnet \
  --pay-to MERCHANT_PUBLIC_RECIPIENT \
  --out /tmp/sf64-live-report
```

If a logged-in/local/Muse operator has **already captured** an original SF52 `stellar-forge.seller-visibility.v1` JSON result, package it unchanged, without re-requesting the seller or facilitator:

```sh
node stellar/scf-starforge-20261009/sf64-merchant-conversion-report/report.mjs \
  --report /path/to/original-sf52.json --out /tmp/sf64-original-report
```

The output directory **must not exist**. It contains `evidence.json` (untouched input bytes), `index.html` (print and browser ready, CSP and no remote resources), and `manifest.json` (SHA-256 checksums, source and scope). Verify locally:

```sh
node stellar/scf-starforge-20261009/sf64-merchant-conversion-report/report.mjs --verify /tmp/sf64-original-report
```

The parser validates the original SF52 report contract and relevant invariants. `--allow-loopback` passes through to the original source only for local `http://127.0.0.1` probes; remote HTTPS remains required. The source already limits HTTP response bytes, pagination and redirects. Output is locally created with restrictive file permissions; the operator decides whether and with whom to share it. Never copy sensitive customer URLs/recipient identities into a public repo.

## What makes this useful to a merchant

- Diagnose HTTP 200 default/free-tier GET hiding a supposed paid route from the indexer, HTTP method mismatch, invalid x402 v2 challenge, missing Bazaar extension and seller-origin errors **without** initiating a payment.
- Compare one requested Stellar CAIP-2 network and recipient as one atomic catalog accepted option, not by mixing different options. Preserve incomplete pagination as inconclusive and one facilitator's indexing as a limited observation.
- Deliver specific repair actions and independently checkable original source JSON with a printable offline report. The document cannot execute JavaScript or contact a server on open.
- Use a real consented merchant capture and actual user acceptance before pricing/selling an audit. The originating [x402#2993 merchant case](https://github.com/x402-foundation/x402/issues/2993) involves **Base USDC**, not Stellar; its corrected 200-versus-402 merchant free-tier finding is an analogous diagnostic pattern, not our Stellar deployment.

## Explicit boundaries

Original SF52 evidence may reflect one observed facilitator catalog and one unauthenticated seller GET. It is not seller authorization, actual onchain settlement, successful resource fulfillment, guaranteed catalog indexing, SCF #46 invitation, paying adoption, or acceptance of any buyer's contract. `manifest.json` hashes detect changes, not signatures. The original SF10 grant and SF49 commercial owners keep the application/relationship decisions. This module never invents a customer report, transmits outreach, performs a checkout, runs hosted CI or writes private code.

One focused offline renderer/package check:

```sh
node --test stellar/scf-starforge-20261009/sf64-merchant-conversion-report/test/report.test.mjs
```

MIT.
