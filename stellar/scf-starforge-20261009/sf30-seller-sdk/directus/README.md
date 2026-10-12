# Directus collection datasets

The Directus adapter brings an authenticated Directus 12.5.0 collection into the original Stellar Forge dataset workspace, seller, buyer and customer delivery engines. It also operates native Directus content versions, preserving the request history from draft creation through item readback.

The browser operator uses a plain monochrome layout. It provides collection capture, field selection, immutable editions, review, comparison, native draft editing, merchant preparation, customer offer preparation, complete delivery receiving, and project transfer. The same operations are available from JavaScript and the CLI.

## Start the operator

Use Node 24 or later, with the merchant distribution's existing dependencies installed. From the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs operator \
  --directory /absolute/private/directus-operator
~~~

Open the returned loopback URL. Enter the Directus API base URL and access token in **API connection**, then choose the original collection. The operator retains credentials only in its running connection. A restarted operator can receive its connection through the same form or through the `DIRECTUS_BASE_URL` and `DIRECTUS_TOKEN` process environment variables.

The installed distribution exposes the `directus` and `directus-workspace` commands. The Directus contribution also registers **Directus collection data** in managed Applications. A managed launch uses the same server, private launch record, source selection, project identity and shutdown lifecycle as a direct launch.

### Capture and inspect

A capture retains the actual authenticated principal, installed server version, native collection/field/relation definitions, effective item query, and exact HTTP JSON response bytes. Each completed source has its own immutable SHA256 identity.

The transport verifies the actual `/server/info` version as **12.5.0**. It retains the returned query limits and license information. The source inspector requires matching server, principal and schema observations around two complete item passes.

Pagination advances by the number of rows actually returned. A server that clips a requested page therefore does not make a short page appear complete. The adapter requests `filter_count`, checks the counted total on each page, continues to the terminal response, and compares two complete passes. The retained source describes these observed reads; Directus does not provide a database transaction around the entire HTTP capture.

The selected query can include native fields, sort, filter, search and deep options. The original primary key is retained explicitly and provides stable item identity. Captured item rows expose each selected value's original JSON plus its `value`, `null` or `missing` state.

A source JSON file can also be imported through the browser or CLI. Import checks the recorded request URLs, response hashes, metadata, page counts and repeated item observations before it becomes a workspace source.

## Native content versions

The operator presents four steps:

1. **Create a draft version.** Choose the collection, item, version key and name. An itemless native draft uses the reserved `draft` key.
2. **Save draft fields.** The editor submits its exact `patchJson` text. Large integers, decimal tokens and nested JSON values retain their original representation.
3. **Compare with the main item.** The adapter retains the native comparison, `mainHash` and reviewed version digest. For an itemless version, it retains the native draft directly because Directus 12.5 does not expose that version through the compare endpoint.
4. **Promote the reviewed draft.** The transport checks the reviewed version again and submits the original `mainHash` to Directus. The native endpoint returns the item key; the adapter reads that exact item and retains the returned version and item identities.

Every request has a persistent operation ID. Keep the ID when continuing an interrupted operation. Use **New request ID** when starting a different operation.

Before an HTTP mutation, the native helper awaits the workspace's durable event callback. Original response bytes and the complete result are then retained under the same operation. A continuation compares its credential-free intent and authenticated principal with the original history. It reconciles an uncertain draft creation, save or promotion against native state. A returned client error remains the native error for that request.

Native events are append-only records in the same SQLite workspace. The original request, sequence, phase, intent, response identity, version and item readback remain available in **History** and in complete project exports.

### JavaScript API

~~~js
import {openDirectusWorkspace} from './directus/workspace.mjs';
import {performDirectusOperation} from './directus/operations.mjs';

const workspace = await openDirectusWorkspace({
  directory: '/absolute/private/directus-workspace'
});

try {
  const captured = await performDirectusOperation({
    workspace,
    connection: {
      baseUrl: process.env.DIRECTUS_BASE_URL,
      token: process.env.DIRECTUS_TOKEN
    },
    action: 'capture',
    input: {
      operationId: 'catalog-capture-20261012',
      actor: 'Catalog operator',
      collection: 'products',
      query: {fields: ['id', 'name', 'price', 'metadata']},
      pageSize: 100
    }
  });
  console.log(captured.source);
} finally {
  await workspace.close();
}
~~~

The direct native functions are `captureDirectusSource`, `createDirectusDraft`, `saveDirectusDraft`, `compareDirectusDraft`, `promoteDirectusDraft` and `readDirectusItem`. The workspace wrapper connects those functions to `nativeHistory(operationId)` and `recordNativeEvent(event, {actor})`, and imports a completed capture under a stable original import ID.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs native capture \
  --workspace /absolute/private/directus-workspace \
  --input /absolute/private/capture-request.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs native-history \
  --workspace /absolute/private/directus-workspace \
  --id catalog-capture-20261012
~~~

## Editions and field meaning

An edition selects one exact collection source and 1–32 original top-level fields. Each selected field produces adjacent value and state columns, staying within the original SF30 limit of 64 columns.

The value column contains exact JSON text. For example:

| Original value | Value column | State column |
|---|---|---|
| Numeric token `9007199254740993` | `9007199254740993` | `value` |
| String `"001"` | `"001"` | `value` |
| Empty string | `""` | `value` |
| JSON null | Empty CSV cell | `null` |
| Field absent from the returned item | Empty CSV cell | `missing` |
| Object or array | Exact JSON representation | `value` |

Native field definitions, relation definitions, primary-key mapping, principal identity, server version and the effective query accompany these columns in `stellar-forge.directus-semantics.v1`. The original SF30 validator checks this declaration and includes its identity in the dataset snapshot. Value-column filtering and sorting operate on their JSON text representation; a downstream consumer can use the declared original field types when interpreting those values.

An edition also records attribution and distribution basis. The operator saves the named review of that exact edition digest. Selecting an edition or preparing a merchant package uses its current approved review.

Example edition request:

~~~json
{
  "actor": "Catalog operator",
  "operationId": "catalog-edition-20261012",
  "expectedRevision": 12,
  "name": "Reviewed catalog",
  "mode": "collection",
  "selection": [
    {
      "sourceId": "source-EXACT_SOURCE_SHA256",
      "sourceSha256": "EXACT_SOURCE_SHA256",
      "collection": "products"
    }
  ],
  "metadataFields": ["id", "name", "price", "metadata"],
  "rights": {
    "attribution": "Catalog team",
    "basis": "The approved customer agreement covers these catalog fields."
  },
  "nativeOperationIds": []
}
~~~

Use the IDs and current revision returned by the actual workspace. A save can reference a previous edition and additional native operation IDs. The edition freezes the referenced event identities, so later native work does not alter its original history.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs save-edition \
  --workspace /absolute/private/directus-workspace \
  --input /absolute/private/edition-request.json
~~~

The same CLI supports state, record reads, original operation reads, reviews, edition selection, comparisons, snapshot queries, dataset exports and complete project export.

## Merchant publishing and customer receiving

Merchant preparation uses the original SF30 CSV/configuration engine and SF82 source package. The retained package includes the selected edition, review, field semantics, original source captures, lineage, and the native history referenced by that edition.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs merchant prepare \
  --workspace /absolute/private/directus-workspace \
  --edition ORIGINAL_EDITION_ID \
  --edition-sha ORIGINAL_EDITION_SHA256 \
  --review ORIGINAL_REVIEW_ID \
  --package /absolute/private/directus-package \
  --versions /absolute/private/directus-versions \
  --payment /absolute/private/public-payment-terms.json \
  --origin https://data.example.com \
  --path /directus-data

node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs merchant serve \
  --package /absolute/private/directus-package \
  --stage /absolute/private/directus-stage
~~~

The public payment terms use the existing seller configuration. Operator keys and signer configuration remain with the original buyer. The browser can inspect an offer, prepare its exact buyer configuration, and receive a completed buyer session.

The CLI exposes the same original SF88 acquisition commands:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs buyer init \
  --session /absolute/private/customer-session \
  --config /absolute/private/configured-buyer.json \
  --max-pages 20 \
  --max-total-atomic 20000

node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs buyer run \
  --session /absolute/private/customer-session
~~~

A reviewed successor uses the same original version store, expected current snapshot and revision. Existing customer page chains continue against their originally selected snapshot. Supervised release staging, activation, rollback and restart are also delegated to the existing SF82 commands.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs buyer receive \
  --package /absolute/private/directus-package \
  --session /absolute/private/customer-session \
  --workspace /absolute/private/directus-workspace \
  --out /absolute/private/customer-delivery \
  --include-source-captures
~~~

The receiving step requires the original session to be complete and every page to belong to the selected resource and snapshot. It delegates the actual data room to SF100 and checks the completed native page chain.

Source captures are included when explicitly selected. The complete source option includes the reviewed provenance files and referenced native history. A normal dataset delivery contains the acquired data, source identities, review and lineage.

## Transfer a complete editable project

**Download project** produces one SQLite file containing the collection workspace and its saved publishing and customer files. The project carries original source captures, editions, named reviews, comparisons, publication records, operations and native events. It also carries every prepared merchant package and its source files, saved buyer configurations, complete customer data rooms, and the native publisher's retained dataset generations and selected edition.

Merchant preparation saves the package into its open workspace automatically. Browser buyer preparation and delivery receiving save their results into that same project. For JavaScript, pass the open `workspace` to `prepareDirectusBuyer` and `receiveDirectusBuyer`; for the CLI, add `--workspace` to those buyer commands.

**Receive project** validates the original records, source projections, approved package bindings, complete data-room files and dataset generations. It rebuilds local merchant execution paths inside the received project's private directory, preserving the original package bytes alongside the new local package. Packages that shared a version store continue to share one received store. The original dataset engine opens that store and verifies its selected generation.

Use **Save an acquired buyer session** to retain a session created from a saved buyer configuration. Choose that exact configuration and the existing session directory. Each complete project download captures the current acquired pages, response files, evidence and original session history through the native SF88 archive API. Receiving restores these files at the new project location and preserves the original configuration, request identity and source paths through the original receiver. Reopening the same incoming project preserves later progress in that received session.

In **Saved publishing and customer files**, choose **Use session** to select an acquired session for customer receiving, **Inspect session** to read its current progress, or **Use publisher** to start a saved merchant with its retained history, **Download configuration** to retrieve a saved buyer configuration, or **Inspect delivery** to reopen a complete customer data room. These files and controls remain available after restarting the operator.

The same transfer works through the CLI. Save a session using the buyer configuration ID returned by `buyer prepare --workspace` or shown in `state`:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs buyer retain-session \
  --workspace /absolute/private/directus-workspace \
  --buyer SAVED_BUYER_ID \
  --session /absolute/private/buyer-session


node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs export \
  --workspace /absolute/private/directus-workspace \
  --kind project \
  --out /absolute/private/Directus_Complete_Project.sqlite3

node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/cli.mjs receive \
  --file /absolute/private/Directus_Complete_Project.sqlite3 \
  --workspace /absolute/private/received-directus-workspace
~~~

A repeated receiving operation opens the same received project, including later edits and later publisher selections. Re-exporting the received project captures its current dataset history; reopening its original incoming file keeps those later local changes. The received database becomes available after its original records validate, and the operator opens it after its publishing and customer files are restored.

### Continue interrupted work in its original project

History keeps each browser request with the operator, selected project and workspace that created it. A received copy can retain the original workspace UUID while having a different project key; its pending work opens separately.

**Retained native work** reopens capture and content-version operations with their original action, actor, operation ID and complete inputs. Select a request to read or continue it. Completed native history remains in the project after the browser request clears.

**Retained workspace work** reopens edits, edition reviews, selections, comparisons and source imports. Continue first reads the workspace's original operation journal. When the request already committed, its stored result opens directly. An interrupted request continues with its original inputs and expected revision. If the workspace rejected an outdated decision, review the current edition or form and submit a new request; the earlier request remains available to read and download.

Source imports retain the complete file's byte length and SHA-256 in browser recovery storage. The source itself is received by the original workspace. For an import that has not committed, use **Choose original file** to select the matching capture and continue its original request. This supports complete source files up to the workspace's 256 MiB limit without putting their base64 bodies into browser session storage.

**Retained project receiving** keeps each editable project's original receiving request and file digest. Choose its original project file to continue. The browser compares the returned operation, file digest, byte length and selected project with that request before opening the received workspace. Downloads bind the current operator, instance, project and workspace.

Changing projects saves each project's native and publishing form draft under that project's identity. It clears old action controls, results, source and edition selections immediately, then restores only the selected project's draft against its current source and edition choices. Connection credentials are entered again in the connection form. Delayed source pages, field lists and native responses are applied only to the selection that requested them. Earlier browser records from before project-scoped recovery remain available through the History download controls.

Receiving and selection registry changes, launch records and their newly created directories are synced before success is returned. Stopping the operator drains its native work and owned publishers before closing the workspace. A publisher that needs another close attempt remains owned by the same operator so it can finish that drain.

## Whole native customer run

[Native setup](NATIVE_SETUP.md) installs the original Directus 12.5.0 application, prepares an isolated version-enabled collection with varied field values, and runs the complete customer and browser exercises in one owned operation. It supports a retained SDK source, Node, Playwright and Chromium installation so an existing equipped machine can run the same application.

`native-customer.mjs` is the reusable customer exercise for an actual Directus 12.5.0 service. Its input names the original operation, an isolated collection with at least three rows, one existing item to change, exact patch JSON, selected fields, attribution/distribution basis, and the original public payment terms.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/directus/native-customer.mjs \
  --input /absolute/private/directus-customer.json \
  --out /absolute/private/directus-customer-run
~~~

The run captures the original native collection, creates and saves a native content version, compares and promotes it, reads the returned item, and captures the edited collection. It builds and reviews both dataset editions, prepares the merchant, and starts an original SF88 page chain. It publishes the successor while that customer is still acquiring the earlier snapshot, completes the original snapshot, receives its complete data room, and transfers the full editable project. The transferred project includes the acquired session. The run reopens that session through the original buyer, receives another complete data room from its relocated pages, and compares the original delivery bytes. It starts the received publisher at its new host paths, selects the retained earlier edition, re-exports that changed project, and reopens the original incoming file to check that the later selection survives. It also opens the changed export as another complete project, reopens the same acquisition at that second location, then restarts the original seller and selects its retained earlier edition.

For the dataset acquisition portion, this exercise exposes the running version store through its original free HTTP response path. SF31/SF88 preserve the native `NO_PAYMENT_REQUIRED` pages, response files and acquisition history. The resulting record identifies this mode and its observed HTTP requests.

A completed run produces `CUSTOMER_RESULT.json`, the customer data room, `Directus_Complete_Project.sqlite3`, and `Directus_Received_Advanced_Project.sqlite3`. Repeating its original input reopens the completed delivery; an interrupted run continues the same native and workspace operation IDs.

## Source contract

The protocol implementation was derived from Directus 12.5.0 at commit `4f77933bf9551cac6b289576078783e189b8f4e3`:

- [Native version controller](https://github.com/directus/directus/blob/4f77933bf9551cac6b289576078783e189b8f4e3/api/src/controllers/versions.ts)
- [Native version service](https://github.com/directus/directus/blob/4f77933bf9551cac6b289576078783e189b8f4e3/api/src/services/versions.ts)
- [Native item controller](https://github.com/directus/directus/blob/4f77933bf9551cac6b289576078783e189b8f4e3/api/src/controllers/items.ts)
- [Native field controller](https://github.com/directus/directus/blob/4f77933bf9551cac6b289576078783e189b8f4e3/api/src/controllers/fields.ts)

The native helper checks the service's actual installed version during authenticated operations and retains it with each complete source capture.

### Continue through the actual browser

After the native customer completes, `native-browser.mjs` receives its SQLite project into a separate editable operator project and uses the running original Directus service. Its input JSON contains `operationId`, `customerDirectory`, the optional `customerResult` path, and the retained absolute `playwright` and `chromium` paths. It reads the original customer scope, fields, patch and public offer terms from `customer-intent.json`; the native access token stays in `DIRECTUS_TOKEN`.

~~~sh
node native-browser.mjs --input /private/directus-browser-input.json --out /private/directus-browser
~~~

The walk uses the actual UI for native draft creation, exact patch text, comparison and promotion; collection capture; field selection and edition review; dataset query; merchant offer and buyer preparation; completed original customer receiving; project download, receiving and restart. It also saves and inspects the acquired session through the actual controls, receives customer data from its relocated pages, starts a saved publisher from the received project, downloads its saved buyer configuration, and inspects its original customer delivery. The session remains available after the second project transfer and operator restart. It saves eight desktop/mobile viewport images, including 390-pixel keyboard navigation and the saved publishing tables, plus the received editable project and `BROWSER_RESULT.json`. All browser and operator resources close before the native job releases its original Directus service.
