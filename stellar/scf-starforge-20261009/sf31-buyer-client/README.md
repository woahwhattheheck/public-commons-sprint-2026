# SF-31 · Noncustodial x402 v2 buyer client (Node 22+)

**SCF Starforge 2026-10-09** · MIT · standalone ESM, no dependencies, no wallet/keys embedded. This is original buyer transport code for the live *protocol wire format*, not a production Stellar payment service or a claim of completed testnet settlement.

## Boundary

`X402BuyerClient.discover()` reads the project's already-merged `GET /discovery/resources` or `GET /discovery/search` catalogue. `call()` issues exactly one unsigned HTTP request; upon a canonical x402 v2 HTTP 402 `PAYMENT-REQUIRED` header it verifies resource URL and exact payment network, asset, recipient, scheme, max spend, flow, obtains **explicit policy approval** and invokes the *caller-supplied official x402 scheme signer*. Only then does it issue exactly one signed retry with a base64 JSON `PAYMENT-SIGNATURE` header. It interprets the canonical `PAYMENT-RESPONSE` header, distinctly labeling delivery with seller-reported settlement, pending, failures, or indeterminate outcomes. A missing HTTP payment receipt does **not** establish payment success.

**Signer JSON interop:** `PaymentPayload.accepted`, `resource`, and `extensions` are compared to the actual x402 v2 challenge as JSON *values*, not serialized member ordering. A signer or upstream SDK may reorder object keys without invalidating otherwise-identical terms. Nested amount, recipient, timeout, resource URL, metadata and extension changes still fail closed before any signed HTTP request. Array element order remains significant. This does not skip the policy approval or validate ledger settlement.

The interface deliberately cannot infer consent from agent text, sign Stellar transactions, validate Stellar ledger finality, process `upto` usage, auto-retry paid requests, or free reserved buyer budget. Plug in the upstream `@x402/core` / `@x402/stellar` scheme signer and the independently maintained SF-36 spend governor. **The `approve` callback must include any durable SF-36 reserve/commit and independent transaction reconciliation**; `true` means the caller approved this one intent. The approval intent now exposes the **immutable full accepted payment requirement**, including `maxTimeoutSeconds` and every `extra` key, and `bodySha256`/`bodyBytes`/`bodyPresent` for exact replayable HTTP body identity. Approval policy must inspect any deployment-relevant `extra` fields, not merely amount/recipient. An optional `expect.maxTimeoutSeconds` is a strict upper bound checked **before** approval; absent the cap, the policy itself must decide whether the offered timeout is acceptable. A returned seller-reported settlement header is not independent onchain finality.

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

The address/network/asset strings are illustrative placeholders, **not** a real payable endpoint or assertions that `stellar:pubnet` is the correct upstream CAIP-2 network. Use actual original 402 terms and official signer output, not these placeholders, for live operation. Query results may be untrusted, so present them to the user/operator before choosing an endpoint. Default requires HTTPS and exact signed resource URL. `allowLocal:true` allows only loopback HTTP for offline checks. User-supplied `Cookie`, `Authorization`, `Host` and `PAYMENT-SIGNATURE` headers are blocked. Signatures are never logged; no cross-origin redirects are followed; input bodies must be replayable and at most 1 MiB. Only one selected payment requirement is permitted; `upto` is deliberately not accepted without an independent scheme-specific approval integration and is not advertised as live. The SHA-256 fingerprint contains request body bytes only (not HTTP headers); it is a policy binding aid, **not** a seller attestation or a signature over headers. An absent body and a present empty body share the empty SHA-256, so inspect `bodyPresent` as well. The signer still receives its own cloned requirement, never the policy's frozen reference.

### Untrusted catalog destination preflight

Both `discover(origin)` and `call(url)` refuse literal IPv4/IPv6 addresses (including canonicalized numeric/hex IPv4 aliases) and localhost/private DNS namespace suffixes over HTTPS by default, **before any outbound request, approval or signing**. They return `BuyerError('UNSAFE_RESOURCE_HOST')`. This prevents a seller-controlled discovery record from directly targeting metadata-service or loopback/IP-based private infrastructure. `allowLocal:true` remains explicitly for loopback development fixtures only; it does not exempt arbitrary IPs or .internal/.local hosts. `HTTP` outside that explicit mode remains denied.

**Operator network boundary:** a public hostname can still resolve or rebind to a private IP; this URL preflight alone is NOT DNS pinning or a complete SSRF control. Deploy catalog and buyer egress behind a resolver/connect-time public-IP policy or egress allowlist (TLS hostname verified, redirects disabled) before using untrusted sellers in production. Do not auto-trust a discovered API or pay without verified seller binding, current offer and explicit operator policy.

### Discovery cancellation and advertised-size fence

The existing 256 KiB incremental body cap remains authoritative for chunked and understated responses. `discover()` now also rejects a numeric `Content-Length` exceeding the cap **before reading any bytes**, with `DISCOVERY_RESPONSE_TOO_LARGE`. After an over-limit or invalid response, stream cancellation is best-effort and **not awaited**: a remote stream that never resolves its cancel request cannot indefinitely delay the caller's rejection. Neither condition changes paid-call behavior or authenticates returned catalogues.

Focused offline regression: `node --test test/discovery-cancel.test.mjs` (injected streams only; no hosted Actions).

## Focused verification and provenance

Run `node --test test/buyer.test.mjs`. The test exercises canonical x402 v2 request/response headers over a real local Node HTTP server, with the **same documented GET /discovery/resources response shape** as the separately published `BazaarCatalog`/`createDiscoveryServer` module. It does not execute that original module or claim a deployed provider integration. Its scheme payload and settlement receipt are intentionally fixture objects: **not signed Stellar transactions, payment success, seller authentication, mainnet or testnet evidence**. The test's error cases cover quote drift, wrong resource/method, approval denial, signer mismatch, outstanding status and a lost paid response; no double-spend retry.

Pin: x402 Foundation [specification v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) §§5.1–5.3 and [HTTP transport v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md). Project's currently shipped [Bazaar core](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/scf46-stellar-bazaar/src/catalog.mjs), blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7`. See standalone SF-33 failure recovery and SF-36 spend governor ownership; this SDK does not replace either.

**Do not run GitHub Actions for verification.** Public work intentionally has no workflow files or CI dependency.


### Catalog discovery byte boundary

`discover()` consumes the actual HTTP response body through a bounded stream and rejects more than **256 KiB of decoded response bytes**, regardless of a server's `Content-Length` header. It parses JSON only after a fatal UTF-8 decode; malformed encodings and malformed JSON return `BAD_DISCOVERY_RESPONSE`, and oversized replies return `DISCOVERY_RESPONSE_TOO_LARGE`. A transport failure while reading returns `DISCOVERY_TRANSPORT_FAILED`. A valid large catalog should be paginated by the upstream server; this client deliberately will not allocate an unbounded body from an untrusted origin. Run the one focused regression with `node --test test/discovery-stream.test.mjs` locally (no hosted Actions).
