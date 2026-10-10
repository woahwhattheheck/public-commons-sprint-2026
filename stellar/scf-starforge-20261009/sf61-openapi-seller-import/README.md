# OpenAPI seller import

Turn selected routes from an existing OpenAPI 3.1 JSON description into x402 v2
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
schema validator, adapter and output. These hashes identify bytes; they are not signatures.

The included weather document is an illustrative example. Its asset and recipient
are deliberately nonpayable. For an actual API, supply your existing OpenAPI JSON
and an explicit selection list with operator-approved `accepts` terms for each
operation. Terms use exact atomic-unit strings. The importer does not derive
prices, enroll unselected routes, fetch remote references, contact an API, sign,
settle, register resources or submit a grant. Wire the emitted metadata into the
existing canonical x402 payment middleware; SF25 ingestion still requires the
authentic settled-payment callback.

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

This first version supports only OpenAPI 3.1 and the actual SF25 schema vocabulary.
Unknown assertion keywords cause an explicit SF25 rejection rather than silently
losing constraints. It does not translate OpenAPI 3.0 schema semantics. Additional
authentication, header/cookie parameters, server variables, custom serialization,
optional request bodies, bodies on GET/HEAD/DELETE, multipart/text bodies and
semantic `$ref` siblings require manual integration. Operation `security: []` and
an empty security alternative preserve OpenAPI's optional-authentication semantics.
Responses and callbacks are not imported. Every selected operation must succeed;
the tool never writes a partial list of accepted routes.

The output passes original SF25 schema/example acceptance, including required
fields and supported value constraints. This does not validate a real wallet,
seller identity or payment, and is not a complete OpenAPI document validator.
SF31's shipped 32,768-character payment header limit is checked on each result.
Only new files in this directory are added; existing SF30/SF25 source is unchanged.

## Focused verification

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/acceptance.mjs
```

One offline integration check covers GET/path/query overriding, POST JSON body,
original schema acceptance, header decoding, authentication semantics, invalid
examples and CLI output. It does not run any repository suite or hosted Actions.

Contract references: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html),
[canonical Bazaar dynamic routes](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/specs/extensions/bazaar.md),
[SF30 seller compiler](../sf30-seller-discovery/README.md), and
[SF25 auto-catalog](../../../stellar-forge/payment-auto-catalog/README.md).
MIT, matching the imported public components.
