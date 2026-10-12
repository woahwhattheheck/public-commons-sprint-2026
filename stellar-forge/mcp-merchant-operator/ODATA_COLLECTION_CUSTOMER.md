# Complete OData customer receiving

The customer command downloads a saved merchant collection, retains its complete analytical source, and restores the original collection locally. The same source then opens in the existing Analysis application for typed import, SQL, reports, workbook delivery and workspace transfer.

Run the installed command as `starforge odata-collection-customer`. From an original source checkout, the equivalent entry is:

```sh
node "$SOURCE/stellar-forge/mcp-merchant-operator/odata-collection-cli.mjs" --help
```

The complete JavaScript API is exported as `@tokenjunkielabs/starforge-merchant/operator/odata-collection-client`. Its declarations reuse the native collection types. This command consumes the source-owned collection tools in [ODATA_WORKSPACES.md](ODATA_WORKSPACES.md), the original retained file reader and [collection engine](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/COLLECTIONS.md).

## Select the saved customer collection

The host first opens its original OData workspace and complete collection. Use the existing workspace alias, live service ID and collection ID. An operator can create the collection from the ordered original response IDs with `merchant_odata_collect`; the host selection and complete source declaration are described in the OData guide.

Set the merchant MCP bearer through its existing environment binding. The default name is `MCP_ACCESS_TOKEN`; `--token-env` selects another configured variable. Use the original HTTPS endpoint or its loopback HTTP listener.

List one history page:

```sh
starforge odata-collection-customer list \
  --url "$MERCHANT_MCP_URL" --workspace supplier \
  --service orders --offset 0 --limit 50
```

Continue with the returned `page.nextOffset` until it is null. History can include an original incomplete collection; resume that collection's existing source selection before requesting its completed analytical source.

Inspect the chosen collection:

```sh
starforge odata-collection-customer inspect \
  --url "$MERCHANT_MCP_URL" --workspace supplier \
  --service orders --collection northwind-orders
```

The response includes the original collection and source bindings, query fingerprint, rows, pages, source document, and `source.sourceSha256`. Select that exact digest as `SOURCE_SHA256` for the following command. Inspect reads the original source manifest through the retained file reader and verifies its digest. The manifest binds every file in the subsequent download.

The first original reference selection contains five retained live envelopes and 830 Northwind Orders. A saved collection's returned counts and digest describe its own selected source; a different query or edition has its own identity.

## Download and restore the complete customer source

Choose two separate private directories. The command creates the selected download and receiving directories with private permissions. Their parent directories must already exist.

```sh
starforge odata-collection-customer fetch \
  --url "$MERCHANT_MCP_URL" --workspace supplier \
  --service orders --collection northwind-orders \
  --sha256 "$SOURCE_SHA256" \
  --download "$CUSTOMER_ROOT/merchant-source" \
  --out "$CUSTOMER_ROOT/orders" \
  --progress true
```

`fetch` performs the complete operation in order:

1. Select the same original endpoint, workspace, service, collection and source digest.
2. Read the exact source manifest through `merchant_odata_file`.
3. Download every unique declared analytical/source file through the original ranged reader.
4. Verify and sync each complete file, then publish the original `source.json`.
5. Invoke the native `restoreCollection` with that exact document and receiving directory.
6. Return the native collection identity, complete row/page count, original source document and restored collection.

The complete download contains `source.json`, its content-addressed `files/` tree and `download-state/`. The source document includes the analytical data, original collection manifest, original transformation source, and every compressed original page packet. The receiving collection reconstructs the original merchant configuration, CSDL projection, ordered requests/responses and outputs. The native engine recomputes the collection and compares it to its retained original identity.

The `files` and `bytes` download totals count the unique payload files declared by the manifest. The separately returned `sourceManifest` is the exact manifest path. The original source supports up to 32 original records, 32 MiB per compressed original record, a 1 MiB manifest, and 256 MiB of unique declared payload files. The native collection engine retains its existing source, projection and row limits.

For a download-only stage:

```sh
starforge odata-collection-customer download \
  --url "$MERCHANT_MCP_URL" --workspace supplier \
  --service orders --collection northwind-orders \
  --sha256 "$SOURCE_SHA256" \
  --out "$CUSTOMER_ROOT/merchant-source"
```

Receive that same complete download later, with no merchant connection:

```sh
starforge odata-collection-customer receive \
  --download "$CUSTOMER_ROOT/merchant-source" \
  --out "$CUSTOMER_ROOT/orders" --sha256 "$SOURCE_SHA256"
```

## Resume the selected transfer

Repeat the same command with the same endpoint, workspace/service/collection, source digest and output directories. The maintained downloader acquires its existing Linux flock lease, reopens the original manifest and checkpoint, verifies each saved prefix and continues at the next durable byte offset. Completed files are checked and reused. An expired retained read is reopened against the same original file digest.

A process interruption between a local write and its checkpoint can leave a partial suffix. The existing downloader truncates that owned uncheckpointed suffix while retaining the checked prefix. A completed source manifest appears at the download root after all selected payload files are complete. The receiving engine retains its own immutable publication and same-directory continuation.

The default chunk size is 196,608 bytes; `--chunk-size` selects a value from 1 through 196,608. Progress records go to stderr and carry the original source identity, filename and byte position. The final JSON result goes to stdout.

If a saved file, endpoint selection or source digest differs, keep that original output and select the intended source/directory. A retry continues the existing operation; a different selected collection gets its own directory. The command reports the original provider or local filesystem error so the same operation can continue after access or capacity recovers.

Inspect the completed download locally:

```sh
starforge odata-collection-customer verify-download \
  --directory "$CUSTOMER_ROOT/merchant-source" --sha256 "$SOURCE_SHA256"

starforge odata-collection-customer inspect-received \
  --directory "$CUSTOMER_ROOT/orders"

starforge odata-collection-customer rows \
  --directory "$CUSTOMER_ROOT/orders" --offset 0 --limit 100
```

The first command checks the saved source identity, original checkpoint and every complete payload hash. The second reopens the received collection through the full native engine. The row reader returns the original source/collection identity and `nextOffset`; follow that value for the complete selected rows.

## Continue in the original Analysis application

Register the retained source document in the existing Analysis database. Its actual file is either the completed download's `source.json` or the restored collection's `analysis/source.json`; both retain the same source document identity.

Use the actual format returned by inspect/download (`json` or `csv`) and the current revision of this named response source (0 for a new alias):

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database "$CUSTOMER_ANALYSIS" --checkout "$SOURCE" \
  response --name northwind_orders_live --input-kind document \
  --manifest "$CUSTOMER_ROOT/orders/analysis/source.json" \
  --format "$ANALYSIS_FORMAT" --expected-revision "$CURRENT_SOURCE_REVISION"
```

The original registration returns a saved source name and positive source revision. Generate the native preview mapping from those returned values:

```sh
starforge odata-collection-customer analysis-mapping \
  --directory "$CUSTOMER_ROOT/orders" \
  --source northwind_orders_live --revision "$SOURCE_REVISION"
```

Use that complete object as the original response-preview input. It carries the correct native or text conversion and the independent state column for every selected field. Exact Decimal and Int64 source spellings remain intact; typed floating-point fields use the native declared conversion. CSV null values remain distinguishable through their state fields.

The same existing Analysis application supports source preview/import, explicit activation, saved SQL queries, query exports, saved reports and publication, workbook preview/build/download, and complete workspace archives. For agent operation, start its original service and register that same database:

```sh
node "$SOURCE/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs" \
  analysis-register --dir "$ORIGINAL_NATIVE_BUYER" \
  --name customer --database "$CUSTOMER_ANALYSIS"
```

Calls use `sf43_discover_review_and_pay` with `action: "analysis"`, `analysisWorkspace: "customer"`, the selected native operation and its original fields. Retain the actual preview job ID/digest, imported version, activation revision, query result hash, report publication revision and workbook build ID as those original operations return them. The [Analysis guide](../mcp-paid-agent/ANALYSIS.md), [workbooks](../mcp-paid-agent/WORKBOOKS.md) and [archives](../mcp-paid-agent/ARCHIVES.md) describe the complete customer continuation.

## Use the same client from an application

```js
import {
  inspectMerchantODataCollection, fetchODataCollection,
  receivedODataCollectionAnalysisMapping
} from '@tokenjunkielabs/starforge-merchant/operator/odata-collection-client';

const merchant = {
  url: process.env.MERCHANT_MCP_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN',
  workspace: 'supplier',
  liveServiceId: 'orders',
  collectionId: 'northwind-orders'
};

const selected = await inspectMerchantODataCollection(merchant);
// Retain and review this returned source identity with the customer selection.
const expectedSha256 = selected.source.sourceSha256;
const completed = await fetchODataCollection({
  ...merchant, expectedSha256,
  directory: '/private/customer/merchant-source',
  collectionDirectory: '/private/customer/orders'
});

// After the original Analysis source registration has returned its actual identity:
const mapping = await receivedODataCollectionAnalysisMapping({
  directory: completed.receiving.collection.directory,
  source: registeredSource.name,
  sourceRevision: registeredSource.revision
});
```

An existing native host adapter can supply its original `client: { endpoint, call }` in place of `url`. Every request still selects the same workspace/service/collection and passes through the original tool methods; the retained downloader binds the supplied endpoint and complete selection to its checkpoint. This supports the original equipped host without another HTTP server.

## Maintained source and operation

The new command is registered by the additive `odata-collection-customer` distribution contribution. It reuses `retained-download.mjs`, the original `merchant_odata_collection_source` and `merchant_odata_file` operations, and the native collection restore/read/mapping functions. The host retains its shared workspace lifecycle; the downloader releases its unfinished file reads through the original reader API.

The same complete 830-row customer operation is tracked in the [original OData product thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791764617053699). Its customer runner and [complete receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/examples/COLLECTION_CUSTOMER.md) retain the selected source, original Analysis/report/workbook operation, both transfers and final customer archive.
