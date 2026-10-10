# SF-30 · Seller Discovery SDK for Stellar x402 Bazaar

Original MIT-licensed, dependency-free Node 22 ESM kit for a **seller** who wants a payment-protected HTTP endpoint (or already-exposed MCP tool) to be discoverable through the actual x402 v2 Bazaar `PaymentRequired.extensions.bazaar` format. A seller describes their existing endpoint/schema once; the kit derives a portable Draft 2020-12 `info` validation schema, caller examples, per-parameter descriptions, and a canonical `PAYMENT-REQUIRED` 402 header. The real facilitator can then discover the service from an **independently settled** x402 transaction through existing SF-25 → SF-46 → PR451. There is **no** manual resource registration endpoint or additional index to synchronize.

## Authoritative sources and actual integration

- [Canonical x402 v2 protocol](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md), blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198`
- [Canonical `bazaar` extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md), blob `442708e76d5a129e0c1393471d8ed71e3604c94e`
- [Canonical HTTP headers](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md), blob `a21213c02706208b2268a5fdab7dc6d5b468edbd`
- Existing owned `stellar-forge/payment-auto-catalog/auto-catalog.mjs` (SF-25, blob `5e52169d426cef74cb4f4971e6e3dbaa0cca83d9`), `stellar-forge/product-integration/atomic-catalog.mjs` (SF-46, blob `8878165d54215749a903a626bd497f607c25e717`), and `scf46-stellar-bazaar/src/catalog.mjs` (PR451/SF22, blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7`). Separate SF-26 retains authority over **live MCP `tools/list` capability attestations**; an SF-30 MCP description alone is not proof of live capability.

## Two-minute local developer walkthrough (no credentials/funds)

In this directory:

```sh
node example-http.mjs
# In another terminal:
curl -i 'http://127.0.0.1:8422/weather?city=Louisville'
```

The process actually serves HTTP 402 and `PAYMENT-REQUIRED: <base64 JSON>` containing an explicit testnet requirement and a human-readable `city` argument. The sample `payTo` and `asset` fields are deliberately unusable `DEMO_*_UNSET` placeholders; **do not send payment to them**. The example does **not** serve paid data or verify a signature. It is a transport/metadata example, not a facilitator, payment proof, or network transaction.

To use in a real x402 seller, provide **real verified Stellar issuer/recipient details**, expose your own HTTP/MCP service and pass the `PaymentRequired` record to approved canonical x402 middleware. Example for an existing seller route:

```js
import { createSellerDiscovery, makePaymentRequiredResponse } from './index.mjs';
const seller = createSellerDiscovery({
  resource: {url:'https://your-domain.example/forecast',description:'City forecast',serviceName:'Forecast API',tags:['weather']},
  accepts:[{scheme:'exact',network:'stellar:testnet',asset:STELLAR_ASSET,amount:'20000',payTo:SELLER_ACCOUNT,maxTimeoutSeconds:60}],
  input:{type:'http',method:'GET',querySchema:{type:'object',properties:{city:{type:'string',description:'Requested city',examples:['Louisville']}},required:['city'],additionalProperties:false}},
  output:{type:'json',example:{city:'Louisville',temperatureC:20}},
});
const paymentRequired = makePaymentRequiredResponse(seller);
// Your payment middleware verifies signatures, settles and protects execution.
// Before auth, respond with paymentRequired.statusCode and .headers.
```

Required `querySchema`/`bodySchema` properties must specify an actual `examples[0]`, `example`, `default`, or `const` value (no made-up example). Per-parameter JSON Schema `description` is embedded in `bazaar.schema` rather than discarded. GET/HEAD/DELETE describe query params; POST/PUT/PATCH describe body and optional query params. `amount` is an **atomic-unit string**, never dollars or decimal token units. Public resources use HTTPS; HTTP is explicitly permitted **only** for loopback examples. Example headers cannot include authorization, secrets, cookies, tokens, or `PAYMENT-SIGNATURE`.

## After actual verified settlement: zero-registration acceptance check

Only from your **trusted canonical facilitator** settlement callback, not from a browser/client HTTP route:

```js
import { PaymentAutoCatalog } from '../../../stellar-forge/payment-auto-catalog/auto-catalog.mjs';
import { verifyCatalogAcceptance } from './index.mjs';
const catalog = new PaymentAutoCatalog(); // singleton/persistent integration managed by operator
// paymentPayload is echoed by the paying client; trustedSettlement must be
// independently supplied by the signed/verified/settled facilitator callback.
const result = verifyCatalogAcceptance({
  seller, paymentPayload, settlement:trustedSettlement, sequence:nextSequence, catalog,
});
// result.decision === 'accepted' means local catalog ingestion only.
// It does NOT prove network finality beyond the external trusted callback.
```

The helper rejects mutated Bazaar echoes, payment terms, resource URLs, network, recipients and unconfirmed settlement *before* calling the real SF-25 hook. The real SF-25/SF-46 caller still authenticates seller ID, source origin, receipt hash, sequencing, authorization and provenance, and exposes records via PR451's **read-only** `/discovery/resources` and `/discovery/search`. Do not construct a settled hook from an arbitrary client payment payload. For production, implement durable restart recovery, signer and finality checks, multi-process consistency and network monitoring using the canonical stack; this kit does none of those.

MCP providers can serialize an existing `tools/list` `inputSchema` with `input:{type:'mcp',toolName:'existing_tool_name',inputSchema:actualTool.inputSchema}`. A real MCP capability snapshot must be validated and bound by SF-26, not by this serializer.

## Focused verification

```sh
node --test test/seller.test.mjs
# From within the original checked-out public repo, source-coupled end-to-end:
node --test test/repo-integration.test.mjs
```

`test/seller.test.mjs` locally exercises actual 402 loopback wire, GET/POST parameter examples and schemas, MCP declaration, invalid inputs and catalog trust boundary. `test/repo-integration.test.mjs` imports **the actual existing** SF-25→SF-46→PR451 code and probes the live loopback HTTP discovery path using an explicitly offline `settlement` fixture. Neither test creates a payment, reaches a network, represents a real funded grant, or should be dispatched through GitHub Actions. No external apps, registration, wallet or build tool are required.

## Scope and honest completion threshold

The helper intentionally avoids a second registry, payment verification, live MCP capability authentication, production wallet/deployment, real-world settlement claims, and SCF form submission. End-to-end monetization depends on a real payment facilitator + seller account and proof of settled sale. SCF #46 eligibility and submission are separate owner-gated decisions; this package is reusable product IP, not an award.