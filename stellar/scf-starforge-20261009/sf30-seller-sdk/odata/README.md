# OData source and merchant workspace

Connect an OData v4 service, inspect its original CSDL, choose a typed query, and
retain a complete source edition. The same workspace supports import/resume,
receiving decisions, keyed comparisons, SF30 dataset exports and original SF82
merchant releases. The operator browser and CLI call the same application.

## Open the operator workspace

Use Node.js 24 or later and the existing Stellar Forge source tree. The provider
reader and operator server use Node's standard library. Native dataset and seller
commands use the dependencies already required by the original SF30/SF82 modules.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-cli.mjs odata \
  --workspace /absolute/path/odata-work serve --port 8797
```

Open the displayed local URL. The browser has five operating areas:

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

## Transfer and reopen

```sh
node cli.mjs --workspace /absolute/path/odata-work backup --out odata-workspace.json
node cli.mjs --workspace /absolute/path/receiving-work restore --input odata-workspace.json
node cli.mjs --workspace /absolute/path/receiving-work serve
```

The complete transfer (`stellar-forge.odata-transfer.v1`) contains saved
connections and catalogs, reviewed plans, all editions, original source and
normalized page bytes, decisions and dataset exports. The receiving application
checks file hashes and required joins before restoring an empty workspace.
An importing edition reopens paused with its exact saved continuation. Export
paths are rebuilt for the receiving directory. Merchant process/release stores
are machine-local; prepare and select the received configured export through
the original SF82 lifecycle on the receiving host.

## Application interfaces

`openODataWorkspace({directory, fetchImpl})` returns `state`, `connect`,
`refreshConnection`, `plan`, `reviewPlan`, `startCapture`, `capture`, `pause`,
`edition`, `rows`, `reviewEdition`, `compare`, `exportEdition`, `queryExport`,
`backup`, `restore`, `raw` and `close`. `state()` lists compact edition summaries;
`edition(id)` returns its full catalog, compiled query and original page joins.
`plan.query` is the compiled source result and `plan.query.plan` is its normalized
declarative input. `raw(sha256)` returns a retained source's original bytes.

`startODataServer({workspace,port})` exposes the same commands at `/api/`.
Capture and resume return202 while the original workspace imports. `GET
/api/state` exposes currently running editions; `GET /api/edition?id=ID` and
`/api/source?hash=SHA256` expose their page detail and original downloads.
`openODataPublisher({workspace})` joins `prepare`, `status`, `activate`,
`rollback` and `run` to the original SF82 release implementation.

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
