# SF-30 — Declarative HTTP seller metadata for Stellar x402 Bazaar

**Status:** Actual Node.js 22+ seller-side metadata compiler and loopback HTTP `402 Payment Required` example. MIT. No npm dependencies, hosted Actions or payment execution. It does not create a live facilitator, fake settlement receipts, or assume sellers have been authenticated.

## First-party source contract

* Canonical x402 Foundation commit `7f2b2f1f77fa5317615735e3378a6fad41cccb4e`, Bazaar spec `specs/extensions/bazaar.md` blob `442708e76d5a129e0c1393471d8ed71e3604c94e`: `PaymentRequired` v2 must place `resource`, `accepts[]`, `extensions.bazaar.info`, and matching Draft 2020-12 `extensions.bazaar.schema`. Query and body-method discriminators, `routeTemplate`, and service metadata follow the spec.
* Actual local source `scf46-stellar-bazaar/src/catalog.mjs` blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7`: `BazaarCatalog` reads HTTP/method URL and exact `accepts` fields; GET `/discovery/resources` is read-only.
* Existing merged `stellar-forge/payment-auto-catalog/auto-catalog.mjs` blob `5e52169d426cef74cb4f4971e6e3dbaa0cca83d9`: only authenticated v2 `PaymentPayload`, **already confirmed** settlement information and validation can ingest metadata. This SDK is for the seller *before* that step; it does not write to the catalog.

## Developer cold start

```sh
node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/seller.test.mjs
node stellar/scf-starforge-20261009/sf30-seller-sdk/examples/weather.mjs
# In another terminal, curl the printed http://127.0.0.1:<port>/weather endpoint.
# Expect HTTP 402 + PAYMENT-REQUIRED header (base64 of canonical body).
```

This local example uses **unverified, deliberately nonpayable** asset/recipient markers. It is an actual HTTP endpoint returning a real 402-shaped response, **not** a verified-payments demo. Do not use the placeholders in production. No API secrets needed.

```js
import { compileHttpSellerOffer, paymentRequiredResponse } from './seller.mjs';
const offer = compileHttpSellerOffer({
  url: 'https://seller.example/weather', method: 'GET',
  serviceName: 'Weather Service', tags: ['weather'],
  description: 'Weather query',
  queryParameters: [{ name: 'city', type: 'string', description: 'City name', required: true, example: 'Louisville' }],
  payment: { network: 'stellar:testnet', scheme: 'exact', amount: '10000',
    asset: 'REPLACE_WITH_REAL_SEP41_CONTRACT', payTo: 'REPLACE_WITH_REAL_RECEIVING_ACCOUNT', maxTimeoutSeconds: 60 }
});
const { statusCode, headers, body } = paymentRequiredResponse(offer);
```

The output `schema` constrains the **shape of Bazaar `info`**, not API request-body validation; individual query parameter examples and descriptions are preserved. `amount` is a positive **string of atomic units**, not a decimal floating-point price. Only canonical `exact` is supported: claiming `upto` would be wrong without a real bounded authorization scheme. The decimal atomic amount is bounded by the signed Soroban `i128` transfer range (`1` through `170141183460469231731687303715884105727`), not merely by digit count; a 39-digit value can otherwise exceed that maximum and produce an unsatisfiable offer. This is a seller-side preflight, not payment execution. Seller SDK checks input shape and metadata; signature, SEP-41 contract, StrKey checksum, seller/payTo ownership, settled receipt, and real facilitation must be handled by canonical `@x402/stellar` and the existing trusted integration.

## Actual catalog readback after authentic settlement

* `probeLocalVisibility('http://127.0.0.1:PORT/', offer)` makes genuine HTTP GET(s) only to an explicitly allowed loopback catalog; pagination follows the actual PR451 response shape, compares the original resource URL, method and network/scheme/asset/amount/payTo, and returns one of `NOT_INDEXED`, `TERMS_DRIFT`, or `VISIBLE_TERMS_MATCH_UNVERIFIED`.
* Real deployment must call the existing SF-25 trusted ingestion **only following validated on-chain settlement**, then use `GET /discovery/resources` / search and the standard `EXTENSION-RESPONSES` sidechannel for acceptance. A plain listing is *not* proof of a seller's authority or payment. See SF-25/SF-46 integration owners.
* No public untrusted POST-ingestion endpoint is introduced. MIME/form parameters, richer JSON Schema, automatic OpenAPI adapters, source-pinned MCP tool descriptors, and full Stellar end-to-end settlement are separate acceptance tasks. Preserve SF-26 MCP and SF-31 buyer SDK ownership.

## Operational / integration notes

Generated offer metadata is serializable and standalone; call the canonical x402 server middleware to advertise/verify/settle on live networks. This library deliberately returns the `PaymentRequired` envelope instead of duplicating canonical cryptographic/payment code. Before a real testnet acceptance, replace placeholders, validate real wallet/asset and exact official version, and wire real 402→signature→verify→settle→PaymentPayload extension echo→SF25 ingest→Bazaar readback.

No SCF interest/application submitted; published Q3/#45 RFP does not itself establish eligibility for SCF #46. Source code and test fixtures only; no customer, paid testnet receipt, grant award or revenue claimed.

## Seller resource host preflight

Advertised seller resources must be HTTPS URLs with a public-looking hostname. The compiler rejects literal IP hosts (IPv4, IPv6, canonicalized numeric aliases), loopback names and reserved internal names such as `.localhost`, `.local`, `.internal`, and `.home.arpa` before constructing a payment offer. This matches the current SF31 buyer preflight: a new seller offering a private resource address would otherwise create an unusable or unsafe Bazaar listing. `allowLocalhost:true` permits only explicit `http://127.0.0.1:PORT/` developer fixtures; it does **not** permit other IPs or private names, even under HTTPS.

This is URL-level validation, **not DNS resolution protection**. A public-looking hostname may still resolve/rebind to private IP space. Production sellers and consumers need verified host ownership and resolver/connect-time network egress policy; listing visibility still is not proof of seller identity or of settlement. No payment or network connection happens during offer compilation.


## HTTP 402 header interoperability

The canonical x402 v2 \`PAYMENT-REQUIRED\` header is Base64-encoded JSON. This SDK's emitted header is bounded to **32,768 Base64 characters** because the shipped SF31 buyer transport rejects any longer header. \`paymentRequiredResponse()\` throws \`RangeError\` *before responding* when large Bazaar examples or other seller metadata would exceed that actual buyer limit. The focused test preserves the exact 32,768-character boundary and rejects 32,772. Keep seller examples compact; never truncate payment terms, an encoded header, or signed content to fit. This is a local SDK interoperability ceiling, not a universal x402 protocol limit. Reverse proxies or HTTP clients may impose smaller ceilings and must be checked separately.

## Query parameter dictionary safety

The compiler treats query parameter names as untrusted metadata: `__proto__`, `prototype` and `constructor` are rejected, preventing ambiguous or prototype-affecting JSON Schema keys. Other valid names inherited by ordinary JavaScript objects, such as `toString` and `hasOwnProperty`, remain usable and must serialize as **own** query example/schema properties. This is seller-side metadata hygiene only, not request authentication or an x402 settlement guarantee.

Focused regression: `node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/query-keys.test.mjs`.
