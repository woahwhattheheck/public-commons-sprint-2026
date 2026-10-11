# Run imported path-parameter APIs

The existing importer and seller listener now share a dynamic-route binding.
An OpenAPI `/forecast/{city}` operation becomes `/api/v1/forecast/:city` in
`seller-service.json`, not a listener restricted to its `Louisville` sample.
No additional server, signer, wallet or payment implementation is introduced.

## Start the existing example

From a full repository checkout with Node 22+, create explicit application
bindings for the two operations already in `selections.example.json`:

```sh
cat > /tmp/weather-service-bindings.json <<'JSON'
[
  {"id":"city","method":"GET","path":"/forecast/{city}","response":{"demo":true}},
  {"id":"coordinates","method":"POST","path":"/forecast","response":{"demo":true}}
]
JSON

node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/selections.example.json \
  --service-bindings /tmp/weather-service-bindings.json \
  --out /tmp/weather-dynamic-service

node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /tmp/weather-dynamic-service/seller-service.json
```

Use a new output directory each time. In another terminal:

```sh
curl -i 'http://127.0.0.1:8423/api/v1/forecast/Indianapolis?days=3'
curl -i 'http://127.0.0.1:8423/api/v1/forecast/San%20Francisco?days=3'
```

Both requests receive a real HTTP 402 challenge. The advertised resource uses
`https://weather.example`, the actual requested path and its query; it never
uses the caller's Host header or the original sample city. `pathParams.city`
contains the decoded city. Original payment terms and schema are retained.
The sample terms remain deliberately nonpayable and application responses do
not run without the existing native facilitator integration.

## Bind the actual application

Replace `response` with `"handler":"forecast"`, provide your trusted ESM module
via the existing `--handlers FILE` option, and use actual operator-configured
payment terms and the existing native facilitator mode. A handler receives the
existing method, URL, query, body and headers, plus a read-only `pathParams` map:

```js
export async function forecast({ pathParams, query }) {
  const result = await yourExistingForecastService(pathParams.city, query.days);
  return { status: 200, body: result };
}
```

`yourExistingForecastService` is the application's own integration, not a service
provided by this example. Query/body schema metadata is preserved; the application
still owns query/body parsing, business validation and authorization. Matching a
route never grants access or bypasses the native payment result.

## Routing contract

Whole-segment `:name` parameters may occur at multiple path levels. Names are
unique and use the native Express-style identifier grammar. Parameters require
string schemas and matching declared string examples. This preserves native
Bazaar 2.28.0's string-valued path enrichment without weakening numeric/boolean
schemas. The general metadata importer still accepts its existing scalar types;
only runtime binding requires this narrower native-compatible contract.

Concrete paths take precedence regardless of input order. A concrete path with
the wrong method returns its own 405 rather than falling into a paid template.
Different methods on the same template work; overlapping distinct templates are
rejected at startup rather than choosing a price by declaration order. Wildcards,
partial-segment parameters and dynamic trailing slashes need another integration.
Native patterns are case-insensitive. Case-ambiguous fixed configurations are
rejected; a dynamic value that case-shadows a concrete endpoint returns 400
before either challenge or payment, never the other endpoint's price.
Unicode and spaces may be percent-encoded. Encoded path delimiters, double-decoding
layers, invalid UTF-8 and dot segments are rejected before payment processing.
Dynamic path values are checked against the unchanged original SF25 schema.

Native route configuration omits a fixed resource override only for dynamic
routes. The canonical native HTTP server then uses the trusted adapter URL and
its own Bazaar enrichment. The application and native router share static-first
ordering and the same actual path. Static routes retain their fixed identity.
Offer inspection remains the original sample offer; health output additionally
names each dynamic routeTemplate.

## Focused check

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/dynamic-acceptance.mjs
```

This checks compiled imported-offer/config/real HTTP behavior and uses an explicit
native boundary spy for adapter-context handoff. It does not authenticate a real
payment or exercise a network facilitator. Existing importer and service checks
remain separate and unchanged; no hosted Actions workflow is added.

Contract sources: [OpenAPI 3.1.1 path matching](https://spec.openapis.org/oas/v3.1.1.html#paths-object),
[native HTTP resource selection](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/core/src/http/x402HTTPResourceServer.ts),
and [native Bazaar path enrichment](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/extensions/src/bazaar/server.ts).
