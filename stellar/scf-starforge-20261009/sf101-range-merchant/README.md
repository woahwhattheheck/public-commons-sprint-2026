# Stellar x402 adapter for a Range-powered merchant

A complete native SF30 merchant adoption package for one narrowly defined read-only query: **Stellar account transaction history**, backed by the operator's existing Range API account. This is independent, proposal-stage integration work; it is **not affiliated with Range**, permission to resell third-party data, a pilot agreement, or evidence of a paid Stellar transaction.

## Original upstream and commercial rationale

The [Stellar Development Foundation analytics-provider directory](https://developers.stellar.org/docs/data/analytics/analytics-providers) lists Range among Stellar providers with paid API access. [Range's first-party API introduction](https://docs.range.org/data-api/api-reference-introduction) documents `https://api.range.org`, Bearer authentication, `GET /v1/address/transactions`, query fields `address`, `network`, `page`, and `limit`, a 100-row page maximum and `network=stellar`. A documented API is not a currently confirmed active subscription: the owner must recheck host/version, contractual data-access and redistribution rights and any usage pricing directly with Range before customer deployment. The provider may update these paths without notice.

**Merchant value proposition:** Add a consented pay-per-call, Stellar-denominated x402 route for trusted agents alongside the owner's existing subscription plans without exposing Range account credentials to buyers or rebuilding their data platform. This creates a specific technical/contractual discussion for a possible paid integration pilot. There is no purchased Range subscription, sample data authorization, production merchant, customer quote, revenue, or Range response claimed here. It would be inappropriate to put Range data behind a resale paywall without the rights to do so. Provider-approved deployment is a condition, not a presumption.

## System architecture (native originals, no cloned payment stack)

```text
buyer GET /range/stellar/address-transactions?address=G...&page=2&limit=10
   -> original SF30 resource/path/offer + application admission
   -> validate actual SEP-23 account CRC + strict query/page/limit
   -> original native x402 v2 payment verification, approval and policy
   -> our fixed Stellar-only Range application handler
   -> original SF30 createUpstreamHandler (HTTPS, deadline, max bytes, capacity)
   -> merchant-owned Range account GET /v1/address/transactions?network=stellar
   -> original SF30 native settlement and resource release/cancel
```

`range.mjs` imports the original `sf30-seller-sdk/upstream-handler.mjs`. It does **not** have a signer, facilitator, ledger client, payment verifier, payment implementation, alternate server, redirect-follow or retry. It guarantees that buyer input cannot change the upstream host, backend operation or `network=stellar`. Only these buyer query keys are accepted: `address` (one 56-character G account with valid SEP-23 checksum), `page` (1–1000), `limit` (1–100). Unknown keys, duplicates, invalid account checksums, non-G StrKeys and out-of-range values are rejected **before** a native payment process in facilitator-enabled mode. It does not accept contract `C...` or muxed `M...` addresses on this route. `Authorization` is sourced solely from `RANGE_STELLAR_AUTHORIZATION` at backend invocation time; it is not included in seller JSON, original buyer requests or diagnostic counters. The original upstream transport enforces JSON, response byte limit, TLS, timeouts, error sanitization and concurrent capacity.

## 1. Generate a verified, private seller configuration

From a full clone of `public-commons-sprint-2026`, Node 22+:

```sh
S=stellar/scf-starforge-20261009/sf101-range-merchant
node "$S/operator.mjs" init \
  --out /private/path/range-stellar \
  --public-origin https://YOUR_OWN_MERCHANT_DOMAIN \
  --network stellar:testnet \
  --asset YOUR_VERIFIED_SEP41_ASSET \
  --pay-to YOUR_VERIFIED_MERCHANT_RECIPIENT \
  --amount YOUR_POSITIVE_ATOMIC_UNIT_PRICE
node "$S/operator.mjs" check --config /private/path/range-stellar/seller.json
```

`init` requires all payment fields, writes a single new `seller.json` with mode 0600 inside a private directory, refuses overwrite, validates the *original* SF30 seller offer with canonical URL and input metadata, and stores no secrets. `check` reads and compiles the original config without network calls. Verify the contract/asset/network, merchant ability to receive funds, charge amount in atomic units and legal rights; JSON schema validation does not verify these facts. Because this is a fixed query, its Bazaar input descriptor includes an address field and paginated request examples, not a promise of future pricing or revenue.

## 2. Execute original challenge-only acceptance with no Range key

```sh
node "$S/operator.mjs" launch --config /private/path/range-stellar/seller.json --port 8423
curl -i "http://127.0.0.1:8423/range/stellar/address-transactions?address=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF&page=2&limit=3"
curl http://127.0.0.1:8423/_seller/health
node "$S/acceptance.mjs" /private/path/range-stellar/seller.json
```

The no-facilitator original runtime serves a genuine x402 v2 HTTP **402**; it never calls the Range backend or attempts payment. The focused `acceptance.mjs` uses the actual current-source `startSellerService` and HTTP route for the 402, independently invokes the original application admission, and exercises the **original upstream handler** against an isolated loopback HTTP backend with a disposable local credential to check fixed network, origin and input behavior. The latter is an application-transport integration run, not a settlement simulation. In original challenge-only mode the runtime emits the 402 *before* application admission, so malformed queries may also see 402; admission applies once the native facilitator mode is enabled. Do not claim a challenge-only 402 proves provider availability or a sale.

## 3. Merchant-authorized live integration only

Inject an actual Range-owned account credential through your secret manager, **not** a file in this repo. Supply the whole header value `Bearer ...` as environment variable `RANGE_STELLAR_AUTHORIZATION`. The native SF30 seller handles local HTTP on `127.0.0.1`; an operator-controlled HTTPS reverse proxy and separately configured original facilitator are required for actual customer use.

```sh
# Environment injected by deployment secret manager, value never committed.
node "$S/operator.mjs" launch --config /private/path/range-stellar/seller.json \
  --facilitator https://YOUR_APPROVED_FACILITATOR_ENDPOINT
```

Original `serve.mjs` only constructs `@x402/core/server` and the actual facilitator client when explicitly configured. With a valid native facilitator, original application admission happens before verification, the read-only backend is called after payment verification, and response release depends on **successful native settlement**. Provider terms must permit the new use. A payment processing failure never authorizes a free backend request. The Range request is a GET; do not extend this product to mutable APIs without separate idempotency/settlement design.

Merchant acceptance should use a real operator-owned key to verify the selected Range endpoint and response shape, exact amount/asset/payee on an actual Stellar testnet payment, actual ledger settlement and successful delivery. Request first-party signed client consent and redact buyer addresses where appropriate; never copy customer access tokens, headers, raw personal data or wallet secrets into source or Slack.

## Commercial pilot workshare (conditional)

Pitch a small **paid integration evaluation** to Range's partnerships/product team or another authorized data API seller: (a) ask whether an agent-oriented Stellar micropayment distribution channel is interesting and permissible under its data agreement, (b) confirm authentic endpoint/usage price and expected volume, (c) agree on an approved read-only test route and a fixed-price scope, (d) prove a single canonical settlement + owner-matched ledger receipt + resource delivery with original SDK, (e) hand off HTTPS hosting, cost reconciliation, support/retries and commercial limits. No invented fixed dollar quote or buyer commitment. This is distinct from the already-contacted SonarX and the separately claimed Obsrvr Lake seller pilot; coordinate sales through the existing DealScout/first-contact CAS to avoid duplicate contact.

**Source anchors:** [SDF provider directory](https://developers.stellar.org/docs/data/analytics/analytics-providers), [Range first-party API documentation](https://docs.range.org/data-api/api-reference-introduction), [original SF30 seller](../sf30-seller-sdk/README.md), [native upstream handler contract](../sf30-seller-sdk/UPSTREAM_HANDLER.md), [merchant operations launcher](../sf30-seller-sdk/UPSTREAM.md).
