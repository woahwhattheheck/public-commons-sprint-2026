# SF-31 · Noncustodial x402 v2 buyer client (Node 22+)

**SCF Starforge 2026-10-09** · MIT · standalone ESM, no dependencies, no wallet/keys embedded. This is original buyer transport code for the live *protocol wire format*, not a production Stellar payment service or a claim of completed testnet settlement.

## Boundary

`X402BuyerClient.discover()` reads the project's already-merged `GET /discovery/resources` or `GET /discovery/search` catalogue. `call()` issues exactly one unsigned HTTP request; upon a canonical x402 v2 HTTP 402 `PAYMENT-REQUIRED` header it verifies resource URL and exact payment network, asset, recipient, scheme, max spend, flow, obtains **explicit policy approval** and invokes the *caller-supplied official x402 scheme signer*. Only then does it issue exactly one signed retry with a base64 JSON `PAYMENT-SIGNATURE` header. It interprets the canonical `PAYMENT-RESPONSE` header, distinctly labeling delivery with seller-reported settlement, pending, failures, or indeterminate outcomes. A missing HTTP payment receipt does **not** establish payment success.

The interface deliberately cannot infer consent from agent text, sign Stellar transactions, validate Stellar ledger finality, process `upto` usage, auto-retry paid requests, or free reserved buyer budget. Plug in the upstream `@x402/core` / `@x402/stellar` scheme signer and the independently maintained SF-36 spend governor. **The `approve` callback must include any durable SF-36 reserve/commit and independent transaction reconciliation**; `true` means the caller approved this one intent. A returned seller-reported settlement header is not independent onchain finality.

## Usage

```js
import { X402BuyerClient } from './buyer.mjs';
const buyer = new X402BuyerClient();
const listing = await buyer.discover({origin:'https://your-authorized-catalog.example',query:'weather'});
const selected = listing.resources[0]; // Inspect original listing and actual method before approving.
const result = await buyer.call({
  url:selected.resource.url,method:'GET',
  expect:{scheme:'exact',network:'stellar:pubnet',asset:'YOUR_ASSET',payTo:'YOUR_VERIFIED_RECIPIENT',maxAtomic:'1000'},
  approve:async intent => policy.reserveAndAskOperator(intent), // caller implements genuine consent and durable accounting
  sign:async ({challenge,accepted}) => officialStellarSigner.createPaymentPayload(challenge,accepted)
});
// Never interpret result.status as ledger proof without external authoritative reconciliation.
```

The address/network/asset strings are illustrative placeholders, **not** a real payable endpoint or assertions that `stellar:pubnet` is the correct upstream CAIP-2 network. Use actual original 402 terms and official signer output, not these placeholders, for live operation. Query results may be untrusted, so present them to the user/operator before choosing an endpoint. Default requires HTTPS and exact signed resource URL. `allowLocal:true` allows only loopback HTTP for offline checks. User-supplied `Cookie`, `Authorization`, `Host` and `PAYMENT-SIGNATURE` headers are blocked. Signatures are never logged; no cross-origin redirects are followed; input bodies must be replayable and at most 1 MiB. Only one selected payment requirement is permitted; `upto` is deliberately not accepted without an independent scheme-specific approval integration and is not advertised as live.

## Focused verification and provenance

Run `node --test test/buyer.test.mjs`. The test exercises canonical x402 v2 request/response headers over a real local Node HTTP server, with the **same documented GET /discovery/resources response shape** as the separately published `BazaarCatalog`/`createDiscoveryServer` module. It does not execute that original module or claim a deployed provider integration. Its scheme payload and settlement receipt are intentionally fixture objects: **not signed Stellar transactions, payment success, seller authentication, mainnet or testnet evidence**. The test's error cases cover quote drift, wrong resource/method, approval denial, signer mismatch, outstanding status and a lost paid response; no double-spend retry.

Pin: x402 Foundation [specification v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) §§5.1–5.3 and [HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md). Project's currently shipped [Bazaar core](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/scf46-stellar-bazaar/src/catalog.mjs), blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7`. See standalone SF-33 failure recovery and SF-36 spend governor ownership; this SDK does not replace either.

**Do not run GitHub Actions for verification.** Public work intentionally has no workflow files or CI dependency.
