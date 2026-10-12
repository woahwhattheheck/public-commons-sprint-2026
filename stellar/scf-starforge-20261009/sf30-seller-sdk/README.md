# SF-30 — Declarative HTTP seller metadata for Stellar x402 Bazaar

**Status:** Node.js 22+ seller metadata compiler and runnable resource service. MIT. The compiler and challenge-only service need no npm dependencies. The optional payment runtime delegates verification and settlement to the official x402 SDK and an explicitly configured facilitator.

## Grants.gov source and grant research workspace

The [Grants.gov workspace](./grantsgov/README.md) retains complete opportunity searches and notice details, editable qualifications and workshares, immutable source editions and substantive notice comparisons. Its local operator UI and CLI prepare the original SF30 merchant dataset and native publisher/customer workflow, and export the complete research for receiving and reopen. Start it with `node dataset-cli.mjs grants serve --workspace /private/grant-research`.

## OData source and merchant workspace

The [OData workspace](./odata/README.md) connects an OData v4 service, reads its original CSDL, compiles typed queries, and retains resumable source editions. Its industrial operator UI and CLI support keyed comparison, receiving reviews, precise Decimal/Int64 data, native dataset exports and the original SF82 merchant release lifecycle. Open it with `node dataset-cli.mjs odata --workspace DIRECTORY serve` using Node.js 24+.

## Run a seller service

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
```

The startup line reports the loopback URL and mode. Open
`http://127.0.0.1:8423/_seller/health` to inspect the running routes, or
`http://127.0.0.1:8423/_seller/offers` for the original compiled Bazaar offers.
`GET /dataset` returns the actual SF30 `402` response and `PAYMENT-REQUIRED`
header. Without a facilitator, application handlers are never invoked.
Use `--port 0` to select an available port, or `--port 9000` for a fixed one.

The example payment asset and recipient are placeholders for local onboarding.
For a real service, replace them with your verified Stellar asset and recipient,
choose explicit atomic-unit prices, and set `publicOrigin` to the HTTPS origin
served by your reverse proxy. The listener remains on `127.0.0.1`; incoming Host
or forwarding headers cannot rewrite the configured payment identity.

### Deliver paid event streams and record streams

The [streaming merchant guide](STREAMING.md) connects an existing SSE or NDJSON
producer to this seller, its exported customer client and the original buyer's
saved-output recovery. Authorization flow generates the complete response before
settlement; explicitly selected upfront flow delivers live after native settlement.
The guide includes a real HTTP producer, merchant configuration and application API.

### Offer several payment choices on one route

Use `definition.paymentOptions` for 1–16 complete `exact` options, including
different Stellar networks or assets. Existing `definition.payment` remains
supported for a single choice. The original native SDK registers every offered
network, SF31 selects the explicitly authorized option, and SF98 records the
selected option's amount and network. See [payment options](PAYMENT_OPTIONS.md)
for the runnable example, per-option metadata, buyer selection and catalog
visibility behavior.

### Deliver the original customer SDK

The original `developer/client-export.mjs` still writes its five generated customer
files from saved OpenAPI and now publishes a completion receipt after those bytes
are durable. Its `status` and explicit `adopt` commands recover earlier five-file
exports without regenerating them. The existing merchant MCP operator exposes
those retained files after seller shutdown and downloads them with durable resume.
Follow the [complete customer SDK delivery guide](../../../stellar-forge/mcp-merchant-operator/CLIENT_EXPORTS.md)
for the original export, legacy adoption, exact receipt review, interrupted
delivery and unchanged generated-client/buyer use.

### Merchant capacity and graceful drain

The same original seller runtime now provides bounded request capacity and a
bounded drain for merchant deployments. Static and existing-API launchers use
identical controls; this does not install a second payment runtime:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \\
  --config /path/to/seller.json --max-in-flight 64 --drain-grace-ms 60000
```

`--max-in-flight` (1–1024, default 64) limits simultaneous original **resource
HTTP attempts**, covering admission, native verification, app handler and
settlement. Saturation gets `503 SELLER_AT_CAPACITY` with `Retry-After: 1`
**before** the original native payment path runs. The cap is a concurrency
budget, not billing, per-buyer throttling or a promise that a retried request
will be free. Metadata/docs endpoints are not metered. Applications must
continue to make their own operations idempotent for retry-safe business work.

`GET /_seller/health` includes `lifecycle` counters, active capacity and state;
`GET /_seller/ready` is 200 while accepting, 503 when draining. A SIGTERM
stops admissions immediately and allows current HTTP responses to finish within
`--drain-grace-ms` (1000–300000, default 60000). Successful requests can
complete the original payment settlement; the shutdown wrapper neither settles
nor retries. Beyond the explicit deadline Node terminates remaining HTTP
connections, the shutdown exits nonzero, and any uncertain payment must be
reconciled through the original source-native payment/receipt tooling rather
than retried blindly. Operators should allow time for their slowest legitimate
merchant endpoint, and set their HTTPS proxy drain deadline accordingly.

For embedded apps, `startSellerService({config, maxInFlight, drainGraceMs})`
returns `lifecycle.snapshot()` and an idempotent `close()`. Snapshot counts are
server response observations, **not** on-chain receipts or merchant revenue.

### Supply an application

The JSON config has schema `stellar-forge.seller-service.v1` and a `routes` array.
Each route has a unique `id`, a fixed `path`, and an original SF30 `definition`
containing method, description, payment terms and optional Bazaar examples.
The service derives `definition.url` from the configured origin and path.

Choose one response source per route:

- `response`: a static JSON value, useful for a protected dataset or onboarding.
- `responseFile`: a local JSON dataset loaded once before the listener starts.
- `handler`: an export from a trusted local ESM module supplied through
  `--handlers`. Paths passed to `--handlers` are relative to the config file's
  directory, or may be absolute.

### Use a ClickHouse analytical source

For an existing analytical database, the [ClickHouse merchant](clickhouse/README.md)
provides named typed queries, native schema preflight, exact integer/decimal/null
results, a retained merchant folder and the original exported customer client.
Its launcher uses this same seller, operations console and configured facilitator.

### Sell an existing JSON dataset

Use `"responseFile":"./data/catalog.json"` in place of `response` or `handler`.
The path resolves beside the seller config, including when the command runs
from another directory. Absolute paths also work. The file must be regular,
valid UTF-8 JSON and at most 1 MiB. Missing, invalid or oversized files fail with
the route ID before the server listens. Every JSON value is supported, including
arrays, strings and `null`; the loaded JSON text is kept as a startup snapshot.
Restart to load a changed file. No file path is exposed in health or offers.

Exactly one of `handler`, `response` and `responseFile` is required; supplying
two is an error. Existing inline responses keep their behavior. An optional
`admit` export works with file responses through the same application module.
The existing native payment flow protects the snapshot just like an application
response; challenge-only mode never returns the dataset.

For embedded use, `readSellerConfig(configPath)` resolves file paths before
passing the result to `startSellerService()`. A directly constructed config
uses paths relative to the embedding process's working directory.

Routes can alternatively supply an original compiled `offer` instead of
`definition`. This preserves richer OpenAPI-derived Bazaar schemas and examples
without reducing them to a second declaration. An offer route requires an
explicit `publicOrigin`, and its original resource URL must equal that origin
plus `route.path`; the server never rewrites it. The exact offer is retained in
native SDK route configuration, `/_seller/offers` and the 402 header. Original
SF25 metadata acceptance and SF30 payment/resource validation both apply.
Use the [OpenAPI service-config command](../sf61-openapi-seller-import/README.md#run-the-imported-routes)
to generate a config with explicit handler/static-response bindings. A full
repository checkout supplies the original shared SF25 validation modules.

For example, replace `response` with `"handler": "dataset"` in a copy of
`examples/service.json`, then launch with `--handlers application.mjs` when
that config is kept beside `examples/application.mjs`.

Handlers receive `{method, url, query, body, headers}` and return
`{status, headers, body}`. `url` is a URL object, repeated query parameters are
arrays, and JSON POST/PUT/PATCH bodies are parsed once. Responses may contain JSON,
strings or Buffers. Application payment headers are reserved for the native
SDK. The adapter buffers the result and validates its encoding and headers
before settlement; it releases successful content only after native success.
Application errors use the native cancellation path. There is no automatic
settlement retry.

### Enable the native x402 runtime

Install the optional packages in this checkout using the versions used for the
integration acceptance:

```sh
npm install --no-save --ignore-scripts \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0

node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /path/to/your-seller.json \
  --facilitator https://your-facilitator.example/facilitator
```

The factory constructs the official `x402ResourceServer` and
`x402HTTPResourceServer`, registers the original `ExactStellarScheme` for each
configured network and the native Bazaar extension, and initializes against
the supplied facilitator. Atomic prices pass through as `{asset, amount}`;
the adapter does not implement payment cryptography or float conversion.
For an explicitly local facilitator, use `http://127.0.0.1:PORT` and
`--allow-local-facilitator`.

Embedding applications can import `compileSellerRoutes()` and
`createSellerResourceHandler()` from `resource-server.mjs`, or
`startSellerService()` from `serve.mjs`. `createNativeSellerServer()` accepts
an explicit native-compatible facilitator client, so operators can use their
existing SDK client configuration without putting secrets in seller JSON.

Supported runtime routes are exact-scheme GET, HEAD, DELETE and JSON POST/PUT/PATCH
on fixed paths or imported whole-segment string path parameters. See
[the complete REST method flow](REST_METHODS.md). Other HTTP methods, response streaming and `upto`
execution are rejected by this adapter. The broader metadata compiler remains
available unchanged for integrations supporting those shapes.

### Recorded integration acceptance

The source was exercised on Node 24.19.0 with original x402 packages 2.28.0:
challenge-only startup, health/offers, native challenge, refused verification,
successful native verify → handler → settle → `PAYMENT-RESPONSE`, refused
settlement withholding the result, handler cancellation, response-header
validation, explicit JSON null and POST JSON handling all passed in one run.
The facilitator used controlled in-process outcomes; this records native SDK
interoperability, not a network transaction. No hosted CI is required.

Upstream source anchors: x402 Foundation HTTP resource server blob
`776995dca892660dad6644bd0c05d0ed8c769552`, Express lifecycle reference blob
`77d64f382682c2b6994a0c79906e02248c7253f5`, and exact Stellar server blob
`b7bf2adcfb48cbf355e401c50ff1eafdee9792a6`.

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

