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

Select an endpoint or filter by method/path/description. Inspect its atomic-unit
price, network, asset and recipient. Edit path values, the query object and, for
POST, the JSON body. The public curl command updates immediately. Its target is
the configured public origin; the browser target is separately shown and stays
on the current seller service's origin, including during local development.

Click **Inspect unpaid response** to make one actual GET, HEAD or JSON POST.
There is no request on endpoint selection or input editing. The explorer sends
no cookies, authorization/payment headers or wallet data and follows no
redirects. It displays the status, decoded `PAYMENT-REQUIRED`, original response
headers and body. Editing inputs or changing routes clears stale results and
cancels pending display work. Cancelling cannot undo a request already received
by the service; there is never an automatic retry. The application remains
behind the original payment adapter.

The interface is responsive, supports keyboard-operated tabs, and loads only
local assets. It stores no entered values. Schema/offer text is rendered as
text, never as HTML. The documentation endpoints accept GET/HEAD only, have a
self-only Content Security Policy and cannot proxy to another host.

## OpenAPI export contract

`compileSellerOpenApi(compiled, {mode})` in `developer-portal.mjs` consumes the
same immutable `compileSellerRoutes` snapshot used by checkout. The exporter:

- Emits OpenAPI **3.1.1**, the trusted advertised origin, unique operation IDs,
  GET/HEAD/POST methods and `:name` → `{name}` required path parameters.
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
