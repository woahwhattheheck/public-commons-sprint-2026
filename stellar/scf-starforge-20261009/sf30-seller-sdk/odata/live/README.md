# Live OData merchant

This mode turns a saved original OData service and query into a live paid API. The operator selects the entity set, output/filter/order fields, total and page limits, public merchant route, and Stellar price per successful provider page. The same original `odata/source.mjs` and `schema.mjs` compile the query and preserve provider values for both this service and the retained dataset workspace.

## Operator workflow

Use the original OData operator to connect to a source, inspect CSDL, and save its query. In a directory containing the installed `sf30-seller-sdk` source:

```sh
node odata/cli.mjs --workspace /private/odata schema --connection northwind --out /private/catalog.json
node odata/live/cli.mjs template --workspace /private/odata --saved-plan northwind-orders --out /private/live-plan.json
```

Edit the plan with the merchant's HTTPS origin, actual Stellar asset and recipient, and selected operation policies. `amountAtomic` is the price of each successful provider page. The template leaves the asset and recipient as explicit configuration fields.

A plan has this form; `metadataSha256` is copied from the selected original catalog:

```json
{
  "schema": "stellar-forge.odata-live-merchant.v1",
  "title": "Order receiving service",
  "publicOrigin": "https://merchant.example",
  "serviceRoot": "https://services.odata.org/V4/Northwind/Northwind.svc/",
  "metadataSha256": "81a48488cd2911f7254170da5403628db22127ea59124d6597d04c6af18d7702",
  "payment": {
    "network": "stellar:testnet",
    "asset": "YOUR_STELLAR_ASSET_CONTRACT",
    "payTo": "YOUR_MERCHANT_RECIPIENT",
    "maxTimeoutSeconds": 60
  },
  "operations": [{
    "id": "Orders",
    "path": "/odata/orders",
    "entitySet": "Orders",
    "fields": ["OrderID", "Freight", "ShipCountry"],
    "filterFields": ["ShipCountry"],
    "orderFields": ["OrderID"],
    "maxPageRows": 1000,
    "maxTotalRows": 100000,
    "amountAtomic": "10000"
  }]
}
```

The workspace template carries the selected query's entity, output fields, filters, ordering and total. Its `sourceFilters` and `sourceFilterMode` keep the saved query's scope fixed; omitted customer filters inherit that scope, and supplied filters must match. A merchant may enable separate output, filter and ordering fields in an explicitly configured flexible-query plan without `sourceFilters`. Direct catalog templates can select `--entity-set NAME`. Saved connection `authEnv` is carried into the native `headerEnv.authorization` reference when the live plan has no explicit Authorization/OAuth selection. Supplier credentials use the existing SF30 `headerEnv` references or `oauth2` declaration. Keep the selected host environment available to the merchant. The integration owns `Accept`, `OData-MaxVersion`, and the compiled `Prefer` header. Existing SF30 HTTPS/DNS checks, deadlines, bounded byte reading and supplier connection handling remain in the request path.

Export directly from the original retained workspace:

```sh
node odata/live/cli.mjs package --workspace /private/odata --saved-plan northwind-orders --plan /private/live-plan.json --operation Orders --out /private/live-release
node odata/live/cli.mjs inspect --package /private/live-release
node odata/live/cli.mjs serve --package /private/live-release --state /private/live-state --port 8423 --operations-port 8424 --facilitator https://your-facilitator.example
```

The saved query must fit the enabled live fields and ceilings. A refreshed metadata edition uses a matching saved query. Alternatively, `package --catalog FILE --plan FILE --query FILE --out DIRECTORY` takes an original catalog and an explicit selection such as `{"operation":"Orders","request":{"select":["OrderID","Freight"],"pageSize":100,"top":830}}`.

The private release contains catalog, plan, exact initial request, original SF61 OpenAPI/offers/seller configuration, and a manifest. Reopening verifies all file hashes and reproduces the original compiler output. The merchant listens on the original SF30 loopback listener; use the configured public merchant origin through the existing deployment setup. Its separate operations URL exposes the original seller inspection and SF98 delivery journal. Retain one state directory for the service across restarts so active continuation identities survive.

## Query and pagination

Send an initial JSON POST to the selected public merchant path:

```json
{
  "select": ["OrderID", "Freight", "ShipCountry"],
  "filters": [{"field":"ShipCountry","op":"eq","value":"USA"}],
  "filterMode": "and",
  "orderBy": [{"field":"OrderID","direction":"asc"}],
  "pageSize": 100,
  "top": 500,
  "count": true
}
```

The original compiler adds complete entity keys and deterministic key ordering. Filters accept declared typed comparisons and supported text operators. Decimal and Int64 filter values use exact strings. Scalar structural paths such as `Address/City` become columns with that exact name; complex objects and collection properties are outside the live product's column contract.

`pageSize` sets `Prefer: odata.maxpagesize`. A provider may choose a different page size. `maxPageRows` is the merchant's independent hard limit for one response; the byte limit applies separately. `top` limits the complete query across paid pages. The response includes selected `items`, exact source `count` when supplied, cumulative `seenRows`, `queryFingerprint`, original `supplierResponseSha256`, source time/ETag, and `completion` (`continue`, `provider`, or `limit`).

Submit `{"cursor":"THE_RETURNED_VALUE"}` as the sole request for the next page. Each accepted cursor retains the original reviewed query, resource/company scope, cumulative total, merchant binding and expiry. Provider next links retain their actual offset or opaque skip token; a changed product or expired continuation requires a fresh query. The HMAC key lives in the merchant's private state and survives reopening. Response columns preserve exact Decimal/Int64 source strings and keys. Live pages reflect the supplier's state at their recorded acquisition times.

## Customer receiving

Create the original SF88 purchase configuration from the exported merchant offer and one selected request:

```sh
node odata/live/cli.mjs buyer --package /private/live-release --operation Orders --request /private/live-release/request.json --intent YOUR_STABLE_PURCHASE_INTENT --out /private/order-purchase
node ../sf88-operator-buyer-cli/cli.mjs --review --config /private/order-purchase/buyer.json
```

`buyer.json` is the original SF88 draft. It pins the request's SHA256 and byte length, selected offer and payment ceiling, stable intent, and response destination `/private/order-purchase/response.json`. Open it through the existing SF88 operator workspace with the buyer's configured signer, budget and transport, then use the original execute/resume operation. An interrupted purchase retains its same original intent.

Receive its saved successful response:

```sh
node odata/live/cli.mjs receive --package /private/live-release --operation Orders --response /private/order-purchase/response.json --out /private/received-page
```

Receiving validates the selected query, keys, columns, exact numeric representation and cumulative limits; it retains original response bytes, `rows.jsonl`, `receiving.json`, and an exact `next-request.json` when continuation exists. Prepare that next request with a new stable purchase intent for the subsequent paid page.

## Application interface

The existing OData operator UI can call these same exports without another workspace:

| Export | Input and result |
| --- | --- |
| `templateFromWorkspace` (`client.mjs`) | `(workspace, {planId, publicOrigin, payment, amountAtomic})` supplies the operator form from the selected saved query, metadata and original connection reference. |
| `prepareFromWorkspace` (`client.mjs`) | `(workspace, {planId, plan, operation}, options)` reads `state().connections/plans`, the saved `query.plan`, and original `raw(sha256)`; returns the compiled merchant package model. |
| `prepareDraft` (`client.mjs`) | `({catalog, plan, selection}, options)` compiles an explicit catalog/query selection. |
| `writePackage`, `readPackage` (`client.mjs`) | Write a new private release; reopen and verify that exact release. |
| `startODataMerchant` (`merchant.mjs`) | `({plan, catalog, directory, port, operationsPort, nativeFactory, env, allowLoopback, lookup})` returns original seller `url/mode/compiled`, `operations`, `application`, `outbox`, retained `directory`, and idempotent `close()`. |
| `application.snapshot()` | Merchant operation IDs, metadata identity, delivered pages/rows, supplier reads, response rejections, and lifecycle state. |
| `prepareBuyerHandoff`, `receivePage` (`client.mjs`) | Original SF88 pinned request preparation and saved-response receiving. |

The embedding application supplies its original `nativeFactory` for settlement. It is decorated once by the original SF98 journal. The standalone command constructs the existing native factory when `--facilitator` is supplied. Typed request admission runs before payment; supplier response contract failures return through the original seller's failure path.

## Source operation used during integration

The original OData team acquired Northwind's service document, 19,406-byte CSDL and all 830 Orders across five actual pages. Metadata SHA256 is the value in the example above. One focused HTTP continuity operation replayed those exact retained five responses through the original SF30 transport: all 830 rows received, Freight `32.3800` preserved, original unpaid seller response 402 before supplier access, live service restarted after page one, and the retained cursor continued the remaining pages. The operation also reopened the release, produced the original SF88 pinned request/response destination, and received every page. This is a transport and application continuity operation using retained original provider bytes.

Protocol references: [OData URL conventions](https://docs.oasis-open.org/odata/odata/v4.01/os/part2-url-conventions/odata-v4.01-os-part2-url-conventions.html), [JSON format](https://docs.oasis-open.org/odata/odata-json-format/v4.01/os/odata-json-format-v4.01-os.html), and the [original provider contract](../PROVIDER.md).
