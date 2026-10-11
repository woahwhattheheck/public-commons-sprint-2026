# Serve an existing REST API with Stellar x402

The existing SF30 seller now runs every HTTP method already emitted by the
original seller compiler and SF61 OpenAPI importer. A merchant can publish
read, create, replace, update and delete operations through the same service,
application handlers, native payment middleware and upstream bindings.

| Method | Request body | Imported routes | Upstream delivery |
| --- | --- | --- | --- |
| GET | None | Fixed or string path parameters; scalar queries | Same GET and configured query mapping |
| HEAD | None | Fixed or string path parameters; scalar queries | Same HEAD; no response body |
| POST | JSON | Fixed or string path parameters; scalar queries | Same POST and parsed JSON value |
| PUT | JSON | Fixed or string path parameters; scalar queries | Same PUT and parsed JSON value |
| PATCH | JSON | Fixed or string path parameters; scalar queries | Same PATCH and parsed JSON value |
| DELETE | None | Fixed or string path parameters; scalar queries | Same DELETE and configured query mapping |

All operations retain one explicit native `exact` Stellar payment option. The
runtime accepts JSON for POST, PUT and PATCH; arbitrary request streams, form
data and DELETE bodies are outside this adapter's contract. JSON Merge Patch
and JSON Patch media types are not silently treated as `application/json`.

## Import, bind and serve

Select the desired methods and paths from the merchant's existing OpenAPI
3.0/3.1 document using the original SF61 selection format. Each selected PUT
or PATCH must declare a required `application/json` object request body. A
DELETE operation may declare path and query inputs but no request body.

The existing service-binding format carries the implementation and live schema
validation. These bindings refer to operations that must already exist in
the supplied source document:

```json
[
  {"id":"replace-item","method":"PUT","path":"/items/{sku}","handler":"replaceItem","validateInput":true},
  {"id":"update-item","method":"PATCH","path":"/items/{sku}","handler":"updateItem","validateInput":true},
  {"id":"remove-item","method":"DELETE","path":"/items/{sku}","handler":"removeItem","validateInput":true}
]
```

Run the same importer and seller commands:

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs \
  --spec /private/merchant/openapi.json \
  --config /private/merchant/selected-payments.json \
  --service-bindings /private/merchant/bindings.json \
  --out /private/merchant/compiled-service

node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /private/merchant/compiled-service/seller-service.json \
  --handlers /private/merchant/application.mjs
```

This starts the original challenge-only seller. Add the existing configured
`--facilitator` option for the merchant's native runtime. The original SF82
pilot and SF96 pilot/operations launcher consume the same compiled directory.

With `validateInput:true`, the existing SF89 admission checks actual query,
path and JSON body values against the imported schema before native payment
processing. An explicit application `admit` callback runs after that schema
check. Invalid JSON, unsupported media types, invalid schema values and bodies
on GET/HEAD/DELETE cannot reach the application through the native request
path. Challenge-only mode retains its metadata-only behavior.

## Wrap the merchant's current backend

The existing `upstream-serve.mjs` accepts matching PUT, PATCH and DELETE
bindings. Set `method` to the same method selected for the seller route; the
startup check rejects a mismatched mapping. `createUpstreamHandler` forwards
one request using that method. It serializes the parsed POST/PUT/PATCH JSON
value once, retaining JSON meaning rather than source whitespace. Configured
path/query mapping, private backend headers and response limits remain active.

```json
{
  "schema":"stellar-forge.seller-upstreams.v1",
  "bindings":{
    "updateItem":{
      "origin":"https://merchant-backend.example",
      "path":"/items/:sku",
      "method":"PATCH",
      "query":[],
      "responseMode":"json"
    }
  }
}
```

Supply the merchant's actual backend and all selected handler bindings. No
backend URL or credential comes from buyer input. The backend can complete a
mutation before settlement or response delivery fails. Retain its business
idempotency and reconciliation behavior: the adapter does not automatically
repeat or reverse that request.

## Operate and hand off the same service

The original developer portal/OpenAPI, operations counters and SF93 private
support bundle retain the exact method for every route. A PATCH challenge is
attributed to PATCH rather than an unsupported-method bucket.

SF96 route acceptance can examine the same challenge-only seller. GET and HEAD
retain their original behavior. Keep the existing `allowPost:true` case for
POST. For each PUT, PATCH or DELETE, provide an explicit case whose
`allowMethod` equals that route's method; PUT/PATCH also require JSON `body`.
Cases without the selected method are reported as needing operator input and
are not sent. DELETE cases cannot contain a body. See the
[acceptance case format](../sf96-seller-acceptance/README.md).

The focused integration exercise is
`node stellar/scf-starforge-20261009/sf30-seller-sdk/rest-methods-acceptance.mjs`.
It follows the real importer, config, service, developer projection, admission,
upstream, traffic and private handoff modules over loopback HTTP. A controlled
native collaborator isolates method/body behavior; it is not a ledger payment.
