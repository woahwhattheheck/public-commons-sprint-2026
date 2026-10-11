# Tatum Stellar read-only API: a paid SF30 merchant pilot

A first-party **Tatum Stellar Soroban testnet read-only API** packaged for the **existing** Starforge SF30 x402 merchant service. This is a practical, commercially scoped integration asset for a prospective customer or technical partnership. It is *not* an agreement with Tatum, a deployed merchant, a mainnet checkout, an API-key distributor, or a new x402 payment implementation.

**Original upstream:** [Tatum official Stellar RPC reference](https://docs.tatum.io/reference/rpc-stellar), testnet Soroban JSON-RPC endpoint `https://stellar-testnet-soroban.gateway.tatum.io` with `x-api-key` supplied by the operator. Three documented **read-only** methods are exposed: `getLatestLedger`, `getFeeStats` and `getNetwork`. Never proxy arbitrary RPC methods. `sendTransaction` and `simulateTransaction` are not exposed, and payment verification/settlement remains in original SF30 + official x402 SDK.

## Existing-merchant integration

Requirements: full original Commons public sprint checkout; Node 22+; an **operator-approved Tatum account** and privately stored API key for successful paid responses; merchant-approved **Stellar testnet** payment asset contract (`C...`), recipient classic address (`G...`) and positive **atomic unit amount**. Do not use fake identities or unverified keys for a customer pilot.

First generate a PRIVATE original `stellar-forge.seller-service.v1` config. Existing parent directory is required; the file is create-only (`0600`). The generated routes bind the **real SF30 runtime** to this module's exported application handlers. Neither wallet keys nor the upstream API key appear in config or logs.

```sh
F=stellar/scf-starforge-20261009
P="$F/partners/tatum-stellar-pilot"
node "$P/config.mjs" --out /private/tatum-pilot/seller.json \
  --asset VERIFIED_STELLAR_TESTNET_CONTRACT \
  --pay-to VERIFIED_STELLAR_TESTNET_MERCHANT_ACCOUNT --amount ATOMIC_UNITS \
  --public-origin https://merchant.example

# Real SF30 challenge-only configuration and native route/offer checks:
node "$F/sf30-seller-sdk/serve.mjs" --config /private/tatum-pilot/seller.json \
  --handlers "$PWD/$P/handlers.mjs" --port 8423
node "$P/accept.mjs" --config /private/tatum-pilot/seller.json \
  --seller http://127.0.0.1:8423
```

A genuine **unpaid** GET returns the original SF30 `HTTP 402` challenge on all three routes. The acceptance command fetches original native `/_seller/health`, `/_seller/offers` and the original three payment challenges, verifying published method, source-config route IDs, network, asset, recipient and atomic price. It performs **zero Tatum calls**, because payment was never authorized. This is a useful operator readiness gate, not a fabricated settlement.

A real paid testnet pilot follows the **existing** `sf30-seller-sdk/README.md` flow: supply trusted native x402 verification/settlement with the officially configured facilitator, real testnet asset/recipient and an operator's explicit paid test. Set the upstream key in the merchant's server-side environment as `TATUM_API_KEY` only. The existing SF30 runtime invokes application handlers after canonical payment authorization; only then does an approved handler send one fixed JSON-RPC POST upstream. The source never signs, broadcasts, requests buyer payment itself or adjusts any x402 receipt.

## Delivery and acceptance behavior

The three GET routes are `/stellar/ledger/latest`, `/stellar/fee-stats` and `/stellar/network`. All use the *same* merchant-selected asset, recipient and atomic-unit price. An actual successful data response returns a bounded JSON body with `provider:tatum`, `network:stellar:testnet`, original RPC method and selected source fields. The native existing seller SDK determines when that data may be released. A Tatum timeout, non-200, JSON-RPC error, wrong request ID, oversized body or wrong testnet passphrase fails closed with a generic message; the private `x-api-key`, raw error and upstream response bytes are not shown to buyers. There are no automatic retries of paid requests.

The handler is limited to its fixed official HTTPS Tatum testnet domain, a five-second timeout and a 128-KiB read cap. An operator cannot choose an arbitrary outgoing host via a request, configure a general RPC proxy or cause transaction submission through these read-only handlers. The data API is **fresh**, not a settlement proof, regulated financial advice, or historical archive. For larger catalog/dataset sales or production hosting, compose the existing SF30 SQLite/API, SF93 support, SF98 merchant delivery, SF99 HTTPS deploy, and SF102 recovery tools rather than fork them.

## Paid delivery proposition

For a potential technical partner such as Tatum, offer a **fixed-scope paid five-business-day interoperability workshare**: partner-approved API dataset and legitimate testnet keys; operator deployable original SF30 paid routes; matching testnet payment challenge and actual signed settlement on the approved testnet; three source-bound data responses; recovery handoff and evidence; explicit quote/acceptance before work. This repository is technical readiness, **not** evidence of partner acceptance, paid invoice or merchant production traffic.

No GitHub Actions, scheduled tasks, paid cloud builds, external contact, wallet submission or network transactions are started by this code alone. Run the local acceptance CLI; use original-source Muse native testnet integration when credentials and operator authority are available.
