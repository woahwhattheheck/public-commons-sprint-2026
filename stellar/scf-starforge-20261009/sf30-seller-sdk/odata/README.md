# OData source and merchant workspace

Connect an OData v4 service, inspect its original CSDL, choose a typed query, and
retain source editions or operate a live paid query. The same workspace supports
import/resume, receiving decisions, keyed comparisons, SF30 dataset exports,
original SF82 merchant releases, live services and original SF88 customer
handoffs. The operator browser and CLI call the same application.

## Open the operator workspace

Use Node.js 24 or later and the existing Stellar Forge source tree. The provider
reader and operator server use Node's standard library. Native dataset and seller
commands use the dependencies already required by the original SF30/SF82 modules.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-cli.mjs odata \
  --workspace /absolute/path/odata-work serve --port 8797
```

Open the displayed local URL. The browser has six operating areas:

1. **Sources & queries:** discover the service document and CSDL, inspect entity
   sets, select properties and typed conditions, save the query and record its
   intended scope.
2. **Import & review:** capture the original response chain, pause or resume an
   edition, inspect its original page downloads and records, and retain a
   receiving decision.
3. **Compare editions:** match complete editions by the service's declared keys
   and inspect additions, removals and individual property changes.
4. **Dataset exports:** select an accepted edition, build its native dataset and
   source package, preview the original dataset response, and download its files.
5. **Merchant releases:** stage a configured dataset through the original SF82
   store, select or roll back a release, and reopen its foreground seller.
6. **Live services:** prepare a reviewed source query as a merchant service,
   start or stop its original seller and operations console, prepare customer
   purchases, and receive the original paginated responses.

The workspace is local to the displayed loopback listener. Give the directory a
durable private location: it contains source records, original response bytes,
reviews and configured public merchant terms. Connect authenticated services by
naming an existing environment variable that holds the complete Authorization
header. Only the variable name enters saved connection settings; the browser
does not collect credentials. A receiving operator supplies their own authorized
environment variable when continuing the connection.

## Import an original source collection

The direct entry point is `odata/cli.mjs`; the dataset CLI dispatches the same
commands. Commands below assume the current directory is this module and use a
new workspace at `/absolute/path/odata-work`.

```sh
node cli.mjs --workspace /absolute/path/odata-work connect \
  --id northwind --name 'Northwind reference service' \
  --url https://services.odata.org/V4/Northwind/Northwind.svc/
node cli.mjs --workspace /absolute/path/odata-work schema --connection northwind
```

Save the required selection as `orders-query.json`:

```json
{
  "entitySet": "Orders",
  "select": ["OrderID", "CustomerID", "EmployeeID", "OrderDate", "Freight", "ShipCountry", "ShipName"],
  "filters": [],
  "filterMode": "and",
  "orderBy": [{"field": "OrderID", "direction": "asc"}],
  "pageSize": 200,
  "count": true
}
```

```sh
node cli.mjs --workspace /absolute/path/odata-work plan \
  --connection northwind --id orders --name 'All reference orders' --input orders-query.json
node cli.mjs --workspace /absolute/path/odata-work review-plan \
  --id orders --note 'Complete Orders collection with declared keys and receiving fields.'
node cli.mjs --workspace /absolute/path/odata-work capture \
  --plan orders --label 'Reference Orders edition' --pages 1
node cli.mjs --workspace /absolute/path/odata-work resume --id EDITION_ID
node cli.mjs --workspace /absolute/path/odata-work review \
  --id EDITION_ID --decision accept --note 'Reviewed the complete source collection for delivery.'
```

The capture command returns the edition ID. `--pages` controls work per command,
and an unfinished edition retains its original continuation. Without that option
one command follows up to 10,000 pages. A short page does not end the import; the
provider's missing next link does. Every accepted page is durably stored before
the next request. SIGINT leaves the committed prefix available for resume.
Separate processes use the existing SF82 Linux process lease for both state
updates and ownership of a running edition.

Create another edition from the same reviewed plan to compare a later collection.
An unchanged metadata refresh preserves existing query scope; changed metadata
requires a new saved plan. Editions retain the original catalog they used.
Comparison notes whether the selected query changed, so a different filter or
row limit remains visible when interpreting additions and removals.

## Native dataset and merchant delivery

```sh
node cli.mjs --workspace /absolute/path/odata-work export \
  --id EDITION_ID --name 'Orders receiving dataset'
node cli.mjs --workspace /absolute/path/odata-work query --export EXPORT_ID \
  --query 'where_ShipCountry=USA&fields=OrderID,CustomerID,Freight,Freight_state&sort=OrderID&limit=5'
```

Each export contains `dataset.csv`, the original loader's `dataset.json`,
normalized `rows.json` and `source.json` with source/query/edition joins. Every
property has a companion `_state` column (`value`, `null` or `missing`). Decimal
and Int64 values stay exact text, including a Decimal's returned scale. Complex
values use JSON text. Complete entity keys accompany a selection. The native
dataset supports up to 32 selected properties plus their 32 state columns;
choose a smaller projection when the entity exposes more properties. Original
page bytes remain in the complete workspace transfer.

Supply an existing merchant's public x402 payment object in `payment.json` and
its configured HTTPS origin to include `seller.json`:

```sh
node cli.mjs --workspace /absolute/path/odata-work export --id EDITION_ID \
  --name 'Orders merchant dataset' --payment payment.json \
  --origin https://YOUR_MERCHANT_ORIGIN --path /orders
node cli.mjs --workspace /absolute/path/odata-work merchant prepare \
  --export MERCHANT_EXPORT_ID --release orders-1 --runtime runtime.json
node cli.mjs --workspace /absolute/path/odata-work merchant status
node cli.mjs --workspace /absolute/path/odata-work merchant activate \
  --id orders-1 --expect CURRENT_GENERATION --reason 'Selected receiving edition.'
node cli.mjs --workspace /absolute/path/odata-work merchant run --expect NEW_GENERATION
```

`runtime.json` uses the original SF82 runtime settings, including `port` and an
existing configured `facilitator` URL. SF82 determines the seller's operating
mode, payment challenge, settlement and process lifetime. OData imports use only
source GET requests; selling a retained dataset uses the established native
seller. Each staged package opens its original dataset version store, includes
the native snapshot query parameter, and binds the source and dataset contract.
Release selection uses the displayed generation to preserve concurrent operator
changes. `merchant rollback --expect GENERATION --reason TEXT` selects the
original previous release; `--to RELEASE_ID` chooses a retained release.

## Operate a live source service

The **Live services** area starts from a reviewed saved query in this workspace.
Its source filters, filter mode, projection, declared keys and ordering come from
that query. Filter and ordering properties can remain separate from the output
projection. A saved source row limit also caps the live service. The page ceiling
controls the largest accepted provider response; the original requested page
size remains a provider preference.

Create `live-profile.json` with the reviewed plan ID and the merchant's actual
public origin and payment terms. The strings beginning `YOUR_` below are
configuration fields to replace with that merchant's values:

```json
{
  "id": "orders-live",
  "name": "Orders receiving service",
  "planId": "orders",
  "origin": "https://YOUR_MERCHANT_ORIGIN",
  "payment": {
    "network": "stellar:testnet",
    "asset": "YOUR_STELLAR_ASSET_CONTRACT",
    "payTo": "YOUR_MERCHANT_RECIPIENT",
    "maxTimeoutSeconds": 60
  },
  "amount": "10000",
  "path": "/odata/orders",
  "maxPageRows": 1000,
  "maxTotalRows": 100000,
  "port": 0,
  "operationsPort": 0,
  "facilitator": "https://YOUR_CONFIGURED_FACILITATOR"
}
```

`amount` is the atomic asset amount for each successful provider page. Choose
the row ceilings for the reviewed source and customer scope; a plan with
`top` requires `maxTotalRows` at or below that value. Port zero selects an
available local port. Supplier authorization uses the saved connection's
environment-variable reference and the existing live transport. The prepared
profile retains public merchant terms and variable names in its private directory.

```sh
node cli.mjs --workspace /absolute/path/odata-work live prepare --input live-profile.json
node cli.mjs --workspace /absolute/path/odata-work live detail --id orders-live
node cli.mjs --workspace /absolute/path/odata-work serve --port 8797 --live-service orders-live
```

Preparation commits the original catalog, exact query, native seller
configuration, offer, OpenAPI description and package manifest together with the
profile. Repeating the same service ID and settings reopens that product; a
changed source binding or runtime setting takes a new ID. The browser can also
prepare and start the service after opening the workspace without
`--live-service`.

The original seller returns its local URL, operations URL and operating mode.
The configured facilitator joins the existing native payment implementation.
The original deployment exposes the configured public origin. Supplier requests,
payment admission, settlement and the delivery journal remain in their existing
SF30/SF98 implementations. The operations console links back to this operator
workspace. Stop the service from its retained profile; closing the workspace also
closes its owned merchant and operations listeners. Standalone foreground
operation is available with `live run --id orders-live`; SIGINT or SIGTERM closes
that original runtime.

### Customer purchase and receiving

Give each paid page its original stable purchase intent:

```sh
node cli.mjs --workspace /absolute/path/odata-work live buyer \
  --id orders-live --intent orders-purchase-page-1
```

The command returns the committed buyer directory and its original
`request.json`, `offers.json`, `buyer.json` and `handoff.json`. The SF88 draft
pins the final request path, exact bytes and hash, selected offer, payment
ceiling, intent and response destination. Files are staged before publication,
and the pinned paths point to their committed directory.

Review the returned draft through the original SF88 buyer:

```sh
node ../../sf88-operator-buyer-cli/cli.mjs --review --config /RETURNED_BUYER_DIRECTORY/buyer.json
```

Use the existing SF88 operator workspace with its configured signer, budget and
transport to execute or resume the purchase under that intent. Receive the
resulting original response through the browser file control or the same CLI:

```sh
node cli.mjs --workspace /absolute/path/odata-work live receive \
  --id orders-live --response /RETURNED_BUYER_DIRECTORY/response.json
node cli.mjs --workspace /absolute/path/odata-work live buyer \
  --id orders-live --received RETURNED_RECEIVING_ID --intent orders-purchase-page-2
```

Receiving verifies the original live response against its selected query, keys,
columns, numeric representation and cumulative limits. It retains the exact JSON
response, rows, receiving manifest and original next-page request. When that
response contains a continuation, the next buyer handoff uses that cursor and a
new intent. Reopening an existing intent preserves its original request; changed
requests require their own intent. Re-receiving the same original response
returns the existing receiving record.

### Managed application lifecycle

The installed Applications workflow uses this same `serve` command and
workspace. Startup checks `--expected-workspace-identity` and, when a service is
selected, `--expected-live-identity` before opening listeners. It emits one
compact `ODATA_WORKSPACE_READY` record with the actual workspace, process,
operator URL and selected live runtime. The original managed worker consumes
that record and checks `/api/application`. See
[live/APPLICATIONS.md](live/APPLICATIONS.md) for the existing installed-runtime
registration and complete launch, receive, stop and reopen operation.

## Transfer and reopen

```sh
node cli.mjs --workspace /absolute/path/odata-work backup --out odata-workspace.json
node cli.mjs --workspace /absolute/path/receiving-work restore --input odata-workspace.json
node cli.mjs --workspace /absolute/path/receiving-work serve
```

The complete transfer (`stellar-forge.odata-transfer.v1`) contains saved
connections and catalogs, reviewed plans, all editions, original source and
normalized page bytes, decisions, dataset exports and prepared live profiles.
Live products include their complete original package, committed customer
handoffs and received responses, rows, manifests and next requests. Staging
files and running process observations are excluded. The receiving application
checks file hashes and required joins before restoring an empty workspace.
An importing edition reopens paused with its exact saved continuation. Export
paths are rebuilt for the receiving directory. Merchant process/release stores
are machine-local; prepare and select the received configured export through
the original SF82 lifecycle on the receiving host. A restored live profile
reopens through the same Live services area and its original package compiler.
The receiving operator supplies the configured source environment and merchant
runtime for that host.

A retained buyer handoff keeps its original absolute SF88 request and response
paths. Continue an existing purchase through its original SF88 execution state;
create a new intent when preparing a new purchase in the receiving workspace.
The original merchant runtime retains its private cursor key and active
continuations on its host. A saved next-page request continues against that same
service and key. The complete transfer carries customer data and product
configuration; process leases, private merchant keys and the buyer's signing and
execution state retain their original host lifecycles.

## Application interfaces

`openODataWorkspace({directory, fetchImpl})` returns `state`, `connect`,
`refreshConnection`, `plan`, `reviewPlan`, `startCapture`, `capture`, `pause`,
`edition`, `rows`, `reviewEdition`, `compare`, `exportEdition`, `queryExport`,
`backup`, `restore`, `raw`, `recordLiveProduct` and `close`. `state()` lists compact edition summaries;
`edition(id)` returns its full catalog, compiled query and original page joins.
`plan.query` is the compiled source result and `plan.query.plan` is its normalized
declarative input. `raw(sha256)` returns a retained source's original bytes.
`state().liveProducts` lists prepared products. `restore()` returns connection,
edition, export and live-product counts after checking the complete transfer.

`startODataServer({workspace,port,liveServiceId})` exposes the same commands at
`/api/` and returns `{url,server,liveRuntime,close}`. Its optional live service
starts before the server is returned; `close()` is idempotent.
Capture and resume return202 while the original workspace imports. `GET
/api/state` exposes currently running editions; `GET /api/edition?id=ID` and
`/api/source?hash=SHA256` expose their page detail and original downloads.
`openODataPublisher({workspace})` joins `prepare`, `status`, `activate`,
`rollback` and `run` to the original SF82 release implementation.

`openODataLiveOperations({workspace,nativeFactoryFor,env,navigationOrigin})`
returns `status`, `prepare`, `start`, `stop`, `buyer`, `receive`, `file`, `detail`
and `close`. The embedding operator supplies its actual navigation origin;
an application with an existing native factory can supply `nativeFactoryFor`.
`GET /api/live` lists retained services and current owned runtimes;
`GET /api/live/detail?id=ID` includes original buyer and receiving history.
`GET /api/live/file` takes `id`, `kind` (`package`, `buyer` or `receiving`),
`recordId` for a customer record, and an original filename. JSON POST operations
are `/api/live/prepare`, `/start`, `/stop`, `/buyer` and `/receive` under that
prefix. The receive body carries the service `id` and complete original
`bodyBase64`; the saved response limit is 16 MiB.

The service protocol, supported CSDL types, typed literal handling, source
boundary and response behavior are described in [PROVIDER.md](PROVIDER.md).
Source navigation and provider-specific query extensions can be added through
that shared contract. Entity-set reads retain structural properties; collection
navigation, `$expand`, delta synchronization and provider writes are separate
operations from the collection-edition workflow.

## Original reference operation

The October12,2026 operating run retrieved the official Northwind service and
its26 entity sets. Orders completed as830 original records across five pages,
after deliberately pausing each of two editions after its first200 records.
The complete comparison returned zero added, removed or changed entities. The
native dataset query matched122 USA orders and returned the first five. Freight
values included exact returned strings `48.2900`, `4.5600` and `147.2600`. The
complete workspace restored in a separate directory and its native query
reopened successfully. This is the official reference service's dataset; an
enterprise connection selects its own actual source and scope.
