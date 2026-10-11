# OpenAPI seller import

Turn selected routes from an existing OpenAPI 3.0 or 3.1 JSON description into x402 v2
seller metadata. The adapter imports the original SF30 `createSellerDiscovery`
compiler and SF25 `validateBazaarExtension` acceptance function. It avoids a
second hand-maintained API description and catches unsupported schemas or bad
examples before producing the 402 response headers.

Requires Node 22+ and a full checkout of this repository. No npm install.

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/selections.example.json \
  --out /tmp/stellar-seller-offers
```

The output directory must be new. `offers.json` includes the selected method,
path, source JSON Pointer, compiled seller envelope, and ready-to-use
402 response metadata. `manifest.json` hashes the input files, imported compiler,
schema validator, schema compatibility adapter, importer and output. These hashes identify bytes; they are not signatures.

The included weather document is an illustrative example. Its asset and recipient
are deliberately nonpayable. For an actual API, supply your existing OpenAPI JSON
and an explicit selection list with operator-approved `accepts` terms for each
operation. Terms use exact atomic-unit strings. The importer does not derive
prices, enroll unselected routes, fetch remote references, contact an API, sign,
settle, register resources or submit a grant. Wire the emitted metadata into the
existing canonical x402 payment middleware; SF25 ingestion still requires the
authentic settled-payment callback.

## Run the imported routes

The existing SF30 seller service can now consume the exact compiled offers.
Supply one explicit binding per selected operation: an `id`, the original
OpenAPI `method` and `path`, and either `handler` (a trusted ESM export name)
or `response` (static JSON application data, including explicit `null`).
The importer never uses documentation examples as application responses.

An existing JSON dataset can instead be bound with `responseFile`:

```json
[
  {"method":"POST","path":"/forecast","id":"forecast","responseFile":"./datasets/forecast.json"}
]
```

Paths resolve beside the **bindings file**, independently of the current working
directory or output location. Exactly one of `handler`, `response` and
`responseFile` must be supplied; the importer never chooses between conflicting
sources. `admit` remains available with any response source.

During the existing CLI export, each selected file is read as valid UTF-8 JSON
up to 1 MiB, then copied byte-for-byte into `responses/ROUTE_ID.json` in the new
output directory. `seller-service.json` points to that relative path, and
`manifest.json` records each asset's SHA-256. Missing, invalid or oversized
datasets fail before creating the output directory. Files use mode `0600` and
the response directory uses `0700`, matching the existing private export.

The resulting directory is self-contained: move it and start the same SF30
command, or use the existing seller pilot. Changes to the original dataset do
not change an exported snapshot; export a new directory to publish changed data.
The runtime reads the bundled files before listening. File responses retain the
original admission and native payment flow, and are never returned in
challenge-only mode.

From the repository root, this complete example starts a real HTTP 402 route:

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json \
  --service-bindings stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-bindings.example.json \
  --out /tmp/openapi-seller-service

node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /tmp/openapi-seller-service/seller-service.json

curl -i -X POST http://127.0.0.1:8423/api/v2/forecast \
  -H 'content-type: application/json' -d '{"latitude":38.25,"longitude":-85.76}'
```

The new output directory contains `offers.json`, `seller-service.json` and
the input/output SHA-256 manifest. The original advertised resource remains
`https://weather.example/api/v2/forecast`; the listener is loopback and the
example payment markers remain nonpayable. Replace them with your real source
document, terms and application before deployment. To bind an actual application,
use `"handler":"forecast"` instead of `response` and pass `--handlers FILE`
to the existing seller CLI. Its native facilitator mode is described in the
[SF30 service guide](../sf30-seller-sdk/README.md).

After import, no further schema translation occurs: the runtime retains the complete compiled offer,
including query/body assertions, examples and payment terms, through native
route configuration, offer inspection and the HTTP 402 header. The original
SF25 validator checks Bazaar metadata; original SF30 preflight checks supported
payment/resource terms. The generated service configuration supports fixed and
whole-segment string-parameter GET, HEAD, DELETE or JSON POST/PUT/PATCH routes, one exact
testnet/pubnet payment option, one public origin and at most 64 explicit bindings.
See [dynamic routes and application binding](DYNAMIC-ROUTES.md) and the
[complete REST serving flow](../sf30-seller-sdk/REST_METHODS.md). Unsupported methods,
multiple payment options, extra payment parameters or non-Bazaar extensions
require a different runtime integration; no partial service config is emitted.
The existing general importer still supports its broader metadata-only mapping.
Dynamic runtime parameters remain strings, matching native Bazaar 2.28.0 enrichment;
numeric/boolean path schemas require a typed native integration rather than
silently changing their original assertions.

Focused integration: `node stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-acceptance.mjs`.
This exercises the original compiler, CLI, service config and actual local HTTP
GET/POST 402 responses. It makes no settlement call. Without `--facilitator`,
the existing runtime does not execute application handlers.

## Supported mapping

| OpenAPI declaration | Seller metadata |
| --- | --- |
| Operation/path/root server hierarchy | Absolute seller URL, retaining server base path |
| Operation parameters overriding path parameters by name and location | One selected query/path definition |
| Scalar query parameters with standard form serialization | Query schema, descriptions and declared examples |
| Required path parameters with declared scalar examples | Concrete URL, `pathParams` schema and Bazaar `:parameter` route template |
| Required `application/json` object request body | Original object schema and inline sample |
| Local component references | Expanded schema, parameter and inline example objects |
| Operation summary/description and tags | Seller description and tags |
| Explicit selection payment terms | Original SF30 `accepts` validation |

Parameter and media-type examples take precedence over schema examples. For named
examples the lexicographically first key is selected deterministically. Duplicate
parameters within one list and duplicate operation selections are rejected.
Reference expansion is finite, and recursive references require manual integration.
`$ref` in example **data** remains data; it is not fetched or resolved.

The importer supports OpenAPI 3.0 and 3.1 within the actual SF25 schema vocabulary.
Unknown assertion keywords cause an explicit SF25 rejection rather than silently
losing constraints. Additional
authentication, header/cookie parameters, server variables, custom serialization,
optional request bodies, bodies on GET/HEAD/DELETE, multipart/text bodies and
semantic OpenAPI 3.1 `$ref` siblings require manual integration. Operation `security: []` and
an empty security alternative preserve OpenAPI's optional-authentication semantics.
Responses and callbacks are not imported. Every selected operation must succeed;
the tool never writes a partial list of accepted routes.

The output passes original SF25 schema/example acceptance, including required
fields and supported value constraints. This does not validate a real wallet,
seller identity or payment, and is not a complete OpenAPI document validator.
SF31's shipped 32,768-character payment header limit is checked on each result.
The service adapter extends the existing SF30 runtime; the original SF30 metadata
compiler is unchanged; SF25 validation is shared through its pure schema module.

## OpenAPI 3.0 compatibility

The same CLI accepts `openapi: "3.0.x"`; no preprocessing command or new service
is required. Output retains the source OpenAPI version and operation pointers.
The context-aware adapter translates only schema nodes, never example, default
or enum payloads. Per OpenAPI 3.0, `nullable: true` expands only a type explicitly
present on that same schema. Other constraints, including enums and composition,
remain effective; null is not added to an enum automatically. Reference Object
siblings are ignored as required by 3.0, rather than applied as 3.1 assertions.

Boolean exclusive numeric bounds become JSON Schema numeric bounds. The shared
SF25 validator enforces strict comparisons and rejects malformed/nonfinite bounds.
Nullable body properties work with declared examples. Nullable query/path values,
nullable whole-body objects, unsupported formats/assertions and other mappings
outside the existing compiler's vocabulary still require an explicit integration;
this is not a complete OpenAPI converter or validator.

`schema-validation.mjs` contains the shared pure SF25 validator. Its original
`auto-catalog.mjs` export remains available; settled-payment ingestion is unchanged.
Metadata-only import avoids loading mutable catalog/server dependencies. The CLI
loads the existing service adapter only with `--service-bindings` and records the
actual pure validator in `validatorSha256`, plus the additive
`schemaCompatibilitySha256` field. Existing source/output hash fields remain.

## Focused verification

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/acceptance.mjs
node --test stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi30-acceptance.mjs
```

One offline integration check covers GET/path/query overriding, POST JSON body,
original schema acceptance, header decoding, authentication semantics, invalid
examples and CLI output. It does not run any repository suite or hosted Actions.

The two additional integrated 3.0 journeys exercise exact original compiler output,
3.1 parity, refs, nullability, strict numeric boundaries, opaque example data,
CLI export/readback and malformed input rejection. No network or payment calls.

Contract references: [OpenAPI 3.0.4](https://spec.openapis.org/oas/v3.0.4.html), [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html),
[canonical Bazaar dynamic routes](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/extensions/bazaar.md),
[SF30 seller compiler](../sf30-seller-discovery/README.md), and
[SF25 auto-catalog](../../../stellar-forge/payment-auto-catalog/README.md).
MIT, matching the imported public components.

## Preserve application admission during export

Each service binding can also name an optional trusted `admit` export, alongside
either `handler` or `response`:

```json
{"method":"GET","path":"/forecast/{city}","id":"forecast","handler":"forecast","admit":"checkCity"}
```

The CLI preserves that name in `seller-service.json`; load it through the existing
SF30 `--handlers FILE` module. Invalid names fail export, and missing or noncallable
exports fail startup. Export preflight never imports or invokes application code.
This prevents a seller's explicit prepayment validator from silently disappearing
between OpenAPI binding and service startup. Bindings without `admit` retain their
existing behavior. Admission can protect static responses as well as handlers.

Use the application's request contract for this callback. OpenAPI/Bazaar metadata
validation checks advertised examples, and does not automatically validate live
request inputs. See [SF30 admission](../sf30-seller-sdk/ADMISSION.md) for decisions,
timeout/cancellation, isolation and the unchanged challenge-only behavior.

`node --test stellar/scf-starforge-20261009/sf61-openapi-seller-import/admission-acceptance.mjs`
checks actual CLI export/readback and loopback HTTP rejection before native payment,
then the accepted dynamic/static paths through a controlled native collaborator.
It performs no wallet/provider call and proves no network settlement.
