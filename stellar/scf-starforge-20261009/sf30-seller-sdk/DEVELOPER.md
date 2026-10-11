# Seller developer workspace

Start the existing seller service, then open the `docs` URL printed at startup:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
# http://127.0.0.1:8423/_seller/docs
# http://127.0.0.1:8423/_seller/openapi.json
```

No new package, build, hosted service, wallet or API key is needed. The existing
CLI, handler exports, JSON dataset files, dynamic imported routes, admission
hooks and optional native x402 factory continue to work unchanged.

## A complete first developer session

Select an endpoint or filter by method/path/description. Inspect all its offered
payment choices, including each atomic-unit price, network, asset, recipient,
timeout and additional terms. Edit path values, the query object and, for
POST, PUT or PATCH, the JSON body. The public curl command updates immediately. Its target is
the configured public origin; the browser target is separately shown and stays
on the current seller service's origin, including during local development.

Click **Inspect unpaid response** to make one actual GET, HEAD, DELETE or JSON POST/PUT/PATCH.
There is no request on endpoint selection or input editing. The explorer sends
no cookies, authorization/payment headers or wallet data and follows no
redirects. It displays the status, every actual returned payment choice, decoded
`PAYMENT-REQUIRED`, original response headers and body. Editing inputs or changing routes clears stale results and
cancels pending display work. Cancelling cannot undo a request already received
by the service; there is never an automatic retry. The application remains
behind the original payment adapter.

The interface is responsive, supports keyboard-operated tabs, and loads only
local assets. It stores no entered values. Schema/offer text is rendered as
text, never as HTML. The documentation endpoints accept GET/HEAD only, have a
self-only Content Security Policy and cannot proxy to another host.

## Customer JavaScript client and TypeScript definitions

Under **Use this API in your application**, the current request inputs now produce
copyable client code after choosing the intended payment option. Download `seller-client.mjs` and `seller-client.d.mts` and
keep them together. The client contains every operation from this exact running
seller snapshot; the downloaded package never contains values typed into the
browser. Its exports are `source`, `operations`, `buildRequest` and
`createSellerClient`.

| Download | Purpose |
| --- | --- |
| `/_seller/client/seller-client.mjs` | Standalone ESM operation builder and adapter for the existing buyer. |
| `/_seller/client/seller-client.d.mts` | Operation-ID autocomplete, required path/query input shapes, JSON body types and buyer-result inference. |
| `/_seller/client/README.md` | Integration guide for this seller's exact origin and source snapshot. |
| `/_seller/client/package.json` | Optional private package manifest for a local application dependency. |

The original OpenAPI download is the package source. A SHA-256 of its exact bytes
is exported in `source.sourceSha256`; generated code embeds the original complete
offers and compiles them through the same SF30 route/payment/schema validator
used by the seller. It preserves the configured public origin and concrete
operation identity. Downloads use GET/HEAD and an attachment filename.

### Prepare and call

Use the exact operation ID displayed in the source. For the example `dataset`
operation:

```js
import { buildRequest, createSellerClient } from './seller-client.mjs';

const request = buildRequest('dataset', { query: { region: 'north' } }, {
  intentId: 'inventory-north-20261011-001',
  maxAtomic: '10000',
});

// configuredBuyer is your existing SF31 buyer or operator/budget wrapper.
const api = createSellerClient({ buyer: configuredBuyer });
const outcome = await api.call('dataset', { query: { region: 'north' } }, {
  intentId: 'inventory-north-20261011-001',
  maxAtomic: '10000',
  approve: existingApproval,
  sign: existingOfficialSigner,
  signal: abortController.signal,
});
```

`buildRequest` and `api.request` only construct the original SF31 request shape.
`api.call` delegates once to `configuredBuyer.call`, preserving its receiver,
return value and errors. A raw original `X402BuyerClient` requires both `approve`
and `sign` callbacks per call; a trusted operator wrapper may supply them itself.
Keep the application's existing approval, durable spend reservation and receipt
reconciliation integration. These two example blocks describe the same operation;
preparing it is not a second purchase.

The caller must supply a nonempty stable `intentId` and canonical string
`maxAtomic` within the Stellar signed-i128 range, including zero for a no-spend
ceiling. Saved advertised terms provide the exact network, asset, recipient,
scheme and maximum timeout. There is no implicit price approval or origin/method
override. The original buyer obtains a fresh challenge and enforces its existing
matching, approval, signing and retry rules.

For an operation with more than one advertised payment option, authorization
must also include an explicit zero-based `acceptIndex`, such as `acceptIndex: 1`
for the second original option. The portal initially leaves that choice empty.
Both runtime and declarations require a valid index for that operation. The
selected saved option supplies the buyer's payment constraints; the original
buyer still requires one unambiguous matching requirement from its fresh
challenge. Complete additional terms remain visible in `operations` and in the
original buyer's approval/signing callbacks. An index into saved metadata does
not override fresh challenge validation or choose among ambiguous fresh terms.

Path inputs are explicit single segments; the original request builder performs
escaping and rejects separators, encoded separators and navigation. Query values
remain strings or nonempty arrays of strings and retain repeated-value order.
POST, PUT and PATCH take a JavaScript JSON value under `inputs.body`, including explicit `null`,
and serializes it once. Undefined, nonfinite numbers, bigint, cycles, custom
objects/accessors and bodies over 1 MiB are rejected before calling the buyer.
GET, HEAD and DELETE reject a body. Unknown operation IDs, extra input keys and omitted
required path/query parameters fail before delegation.

TypeScript declarations project the original Bazaar input schemas. Runtime
request building enforces transport shape and the requirements it can derive;
the merchant's original admission and application validate business constraints.
Response types are inferred from the injected buyer, rather than from response
examples. A saved local client retains that exact local port and origin. Export
again from the intended public seller before distributing it to customers.

### Export a complete local package

Save the original OpenAPI document from the running seller, then run:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs \
  --openapi /private/seller-openapi.json --out /private/new-customer-client
```

The parent directory must exist and the output directory must be new. The CLI
validates the complete original offer identities, creates a private directory,
and writes the module, declarations, unchanged source OpenAPI, private package
manifest and guide. Existing output is never overwritten. It needs Node 22+
and the original repository checkout; the generated JavaScript itself has no
repository or package dependencies. It imports without making a request.

## OpenAPI export contract

`compileSellerOpenApi(compiled, {mode})` in `developer-portal.mjs` consumes the
same immutable `compileSellerRoutes` snapshot used by checkout. The exporter:

- Emits OpenAPI **3.1.1**, the trusted advertised origin, unique operation IDs,
    GET/HEAD/DELETE and JSON POST/PUT/PATCH methods, and `:name` → `{name}` required path parameters.
- Preserves the **complete original offer**, including exact string-valued
  atomic prices and Bazaar schemas/examples, in each operation's
  `x-x402-payment-required`. It never mutates the original offer.
- Projects direct path/query/body schemas into standard OpenAPI fields. Local
  JSON-pointer references are rebased into a per-route complete schema under
  `components.schemas`. Literal `$ref` keys inside example/default data remain
  data. The projection omits fragment-only `$id` values because SF25's actual
  validator resolves references against the original document root.
- Keeps composed constraints in the full source schema and states when a
  per-parameter projection is partial. An unused reference that SF25 accepts
  but OpenAPI cannot project produces a note and untyped parameter views; it
  does not prevent the seller from starting. Exact source metadata is retained.
- Uses output **examples**, not the Bazaar output-descriptor schema, as response
  examples. It does not invent response types, asset decimals, an API version,
  reusable API-key authentication or a successful settlement.

Bazaar metadata constrains the advertised examples. It is not automatically the
application's request validator. Consult the application/admission implementation
for its complete acceptance rules. Generated OpenAPI is an integration aid, not
proof that a recipient is controlled by the seller, a resource is available, a
payment settled or a customer accepted a pilot. `CHALLENGE_ONLY` and `NATIVE_X402`
are shown explicitly; the explorer itself never performs checkout.

Embedding applications can call `createSellerDeveloperPortal({compiled, mode})`
and route requests through the returned `(req, res) => handled` function. It
handles only `/_seller/docs`, `/_seller/openapi.json` and its explicit asset
paths. Keep the companion `developer/` directory with the module. No arbitrary
filesystem paths are accepted by its HTTP handler.

## Focused acceptance

The customer-client integration was exercised separately under Node 24.19.0:
the original SF30 handler and developer portal served dynamic GET and JSON POST
over loopback HTTP, the actual export CLI emitted a standalone package, and
the imported module's bytes matched the live portal download. The original
SF31 buyer received both real native 402 challenges; explicit approval declined
them, producing zero signer and application calls. Unicode path escaping,
ordered repeated query values, lossless atomic caps and exact JSON body binding
were checked in that same workflow. Generated usage passed TypeScript 5.9.3
strict `noEmit`, including required-path, operation-ID and JSON-body diagnostics.
No hosted Actions or full repository suite was run for the customer client.

The existing developer workspace acceptance remains:

```sh
node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/developer-portal.test.mjs
```

The single workflow starts the original SF30 HTTP service and checks an exact
OpenAPI/offer round-trip, local schema references, atomic amount preservation,
Unicode dynamic GET, JSON POST, HEAD, current `responseFile` composition,
documentation methods/headers and zero unpaid application-handler calls. It
requires the original repository's shared SF25 modules, not any npm package.

Cloud execution used Node 22.16.0 and byte-matched original seller/router/admission
sources. The loader selected SF25's exact pure `schema-validation.mjs` export
directly, avoiding unrelated catalog storage imports. No validation, routing or
payment functions were replaced. Desktop/mobile DOM checks used actual generated
metadata in offline Chromium; managed Chromium rejected loopback navigation with
`ERR_BLOCKED_BY_ADMINISTRATOR`, so a full browser-to-server navigation is not
claimed. The actual HTTP workflow was executed separately in Node.

Protocol references: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html),
[original x402 protocol](https://github.com/x402-foundation/x402), and the existing
SF30 compiler, route binder and SF25 schema validator in this repository.
