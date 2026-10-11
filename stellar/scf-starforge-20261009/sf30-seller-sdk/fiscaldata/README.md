# Treasury Fiscal Data workspace

Capture original public Treasury data, review its reported units, build an immutable queryable dataset, compare selected editions with exact decimal arithmetic, and carry the selected dataset through the existing SF30 publisher, SF82 seller release and SF88/SF100 buyer delivery.

The operator workspace is a local industrial interface. It preserves the actual Treasury responses and field definitions beside every published projection. The original merchant and buyer components own offers, payment handling, release selection, acquisition and recovery.

## Start and keep working

Use Node 22 or later on Linux with util-linux flock and tar available. Capture, review, comparison and exports use Node built-ins. Merchant and paid buyer operation use the existing SCF SDK and original configured dependencies; this component installs no substitute payment or wallet implementation.

From stellar/scf-starforge-20261009/sf30-seller-sdk:

~~~sh
node fiscaldata/cli.mjs workspace --dir /private/treasury-workspace --port 0
~~~

Open the printed private session URL on the same computer. The server binds loopback, sets an HttpOnly session cookie and uses the original process capability with same-origin and CSRF checks. Source paths and original buyer workspace directories are host configuration. The HTTP caller can resolve only retained manifest-listed files. Close the server before opening the same directory in another CLI writer.

A single kernel-held workspace lease protects the metadata writer. Source captures have their own retained desired state and original request checkpoints. On ordinary shutdown the worker preserves queued or running intention; on reopen the same capture resumes from its original pages, after checking their exact bytes and current source anchor. A staff pause stays paused. Cancel keeps the original observations and requires a new dated capture to start again.

Each creation carries a requestId. Keep that ID when retrying identical input after an interrupted response; a different payload with the same ID is rejected. Review edits carry the actual saved revision. READY editions, comparisons and complete exports retain immutable original bytes.

## Find a source and retain it

Choose Refresh Treasury catalogue. The production metadata service supplies the current datasets, original endpoint names, field definitions, row definitions, known limitations and reported freshness:

- Production metadata: https://api.fiscaldata.treasury.gov/services/dtg/metadata/
- Original API documentation: https://fiscaldata.treasury.gov/api-documentation/
- Treasury's original frontend source: https://github.com/fedspendingtransparency/fiscal-data

The catalogue is saved with its actual retrieval time and SHA-256. At the retained October 11, 2026 acquisition it contained 56 datasets; that observation is stored as source data, not a hardcoded endpoint list. Select an endpoint from the catalogue or enter an original /v1/ or /v2/ endpoint. Record an explicit filter, stable source sort and page size. Probe saves a real full-field first page and displays its native metadata before a full capture.

For a compact real source workflow, Debt to the Penny supports this original query:

~~~json
{
  "name": "Debt to the Penny — selected October observations",
  "endpoint": "/v2/accounting/od/debt_to_penny",
  "filter": "record_date:gte:2026-10-01,record_date:lte:2026-10-08",
  "sort": "record_date",
  "pageSize": 2,
  "notes": "An explicit date selection for source review; retain both fiscal and calendar year fields."
}
~~~

Use the source ID, revision and SHA returned by sources.save in captures.start. No fields parameter is sent to Treasury. The original API can aggregate when columns are omitted, so field selection occurs only after complete source responses have been retained. The source adapter controls format and pagination itself.

The capture records each original GET intent, URL, response body, selected non-credential response headers, status, time and digest. It checks field sets, string/null values, reported total rows, page counts and the complete native page chain. A failed or rate-limited response remains attached to the same job. Resume reuses any completed response whose local checkpoint was interrupted.

Page-number APIs do not supply a transaction-wide snapshot token. This workspace requires unchanged totals and field metadata across all pages and compares the first page again before sealing; it retains the exact capture interval and this limit in source.json. If the source anchor changes, the original partial capture remains visible and a new dated capture can be started. Identical source rows are reported and retained. They are not silently deduplicated.

Default limits are 8 MiB per response, 16 MiB catalogue, 64 MiB original capture, 250,000 rows, 2,000 pages and a 30-second request timeout. The CLI --limits JSON option sets explicit supported limits. A wider job stops at its declared capacity with original pages intact; a smaller filter or different explicit capacity creates a new source/capture choice. Source data is never silently truncated into a complete edition.

## Review the field meaning before building

Create a DRAFT from a COMPLETE capture. The field table shows actual labels, formats, definitions, sample values, empty strings and JSON null counts. Draft rows remain available while editing. Select the original columns to publish, choose distinct native field names, assign their analytical roles, and select the full row identity.

Every output column is a string, optionally nullable. Monetary values retain all original digits and their original decimal representation. Large identifiers and leading zeroes remain intact. The workspace never converts them through JavaScript Number.

A measure requires an explicit reported unit, positive decimal scale string and source-context notes. For example, a source table reporting whole millions needs that scale recorded beside its values; a table reporting dollars with cents has a different interpretation. The scale is an annotation. It is never silently multiplied into the source value. Source notes and reviewed field definitions travel with the CSV and merchant export.

Debt to the Penny is a stock measure observed at particular dates. Fiscal and calendar years are separate source fields; a date in October 2026 can carry fiscal year 2027. Review those original values instead of inferring a year from a display label.

Native nullable CSV uses an empty cell for JSON null. If a field contains both a real empty string and JSON null, choose an explicit non-empty null marker. Build verifies that the marker does not collide with any original value. The literal source string "null" remains a string. No missing-value interpretation is guessed.

The original SF30 query engine supports up to eight equality, range and sort fields and a total of 32 advertised query parameters. Date ranges are useful on consistently formatted ISO date strings. Exact measure strings are not enabled for lexical sort/range by this workspace; use the exact comparison operation for numeric changes. Equality retains original string semantics.

Build emits the original native files:

| File | Purpose |
| --- | --- |
| dataset.csv | Reviewed local projection of the captured rows, original order and exact string values |
| dataset.json | Original csv-dataset.v1 schema and explicit query capabilities |
| rows.jsonl | Same values with original source page, index and row ordinal |
| review.json | Field roles, unit/scale/context, null handling and key observations |
| source.json | Original capture/query identity, metadata, source definitions and review |
| README.md | Receiving guide specific to the edition |

The native loadDatasetConfig parses the actual CSV and supplies its snapshot and query description. The edition is sealed only after that original loader succeeds. To change a sealed review, create another edition from the same capture. Original source observations and earlier outputs remain intact.

## Compare complete editions

Choose two READY editions, their complete common unique keys and the measures to compare. Duplicate keys are reported with the original conflicting row positions so the operator can choose the full source identity. Comparison preserves added, removed, changed and unchanged rows, and reports field-level changes.

Measure arithmetic uses signed fixed-point integers with explicit decimal scales. Values such as a multi-trillion-dollar amount with cents remain exact. A delta is computed only for explicitly reviewed matching units and scales. Non-numeric source strings, absent observations and incompatible contexts are counted separately.

Each measure also records exact sums over the participating numeric rows, the respective row counts and the change between those selected sums. These sums are arithmetic over the chosen row sets. For daily debt observations they are not Treasury period totals. Date-keyed series have first/last observations, exact within-edition change and separate non-date key groups; those show the movement of a stock measure without adding successive daily balances together.

The comparison retains both source contexts and immutable edition identities. JSON preserves whether a field was absent versus present with null. changes.csv uses blank cells for absent values, while rows.jsonl retains the full distinction and every unchanged pair.

## Complete delivery and merchant publication

Every complete export contains a manifest, readable DELIVERY.md and delivery.tar.gz. An edition export includes its actual dataset files and original Treasury responses. A comparison export includes both editions and their original captures. A partial capture export explicitly retains its partial state and never claims completion.

Configure merchant terms using the operator's actual public origin, fixed dataset path and original payment object. amount is an atomic-unit integer string. Wallet seeds and secret keys are never configuration fields.

~~~json
{
  "editionId": "RETAINED_EDITION_UUID",
  "origin": "https://your-existing-seller.example",
  "path": "/treasury/debt",
  "payment": {
    "scheme": "exact",
    "network": "YOUR_EXISTING_SUPPORTED_NETWORK",
    "asset": "YOUR_EXISTING_ASSET",
    "amount": "YOUR_REVIEWED_ATOMIC_INTEGER",
    "payTo": "YOUR_AUTHORIZED_PUBLIC_RECIPIENT",
    "maxTimeoutSeconds": 60
  },
  "requestId": "YOUR_RETAINED_MERCHANT_REQUEST_ID"
}
~~~

Those uppercase terms are placeholders for the original deployment, not executable payment details. The native buildDatasetSellerConfig validates actual supplied terms. The resulting merchant export contains adjacent dataset.csv, dataset.json, seller.json and source.json plus the complete source delivery.

Select Prepare publisher from that merchant export. publishing.mjs resolves only its own retained export and calls the existing openSocrataPublisher service. Despite the original component name, this service accepts a field-agnostic original dataset package. It keeps its original candidate, review and publication journal, versioned dataset store, snapshot checks and generation guards.

The Publisher view supports original candidate preview/review/publication, snapshot selection, SF82 stage/inspect/activate/rollback/start/stop, and original buyer offer review. Those operations retain the upstream APIs described in ../socrata/PUBLISHING.md and ../../sf82-seller-pilot/README.md. The live seller is the original seller; this component creates no separate payment API.

For buyer execution, configure existing SF88 workspace bindings at startup:

~~~json
[
  {"id": "operator-buyer", "label": "Existing operator buyer", "directory": "/private/original-sf88-workspace"}
]
~~~

~~~sh
node fiscaldata/cli.mjs workspace --dir /private/treasury-workspace \
  --buyers /private/buyer-bindings.json --port 0
~~~

The buyer flow retains the actual original offer and digest, reviewed acceptance index, maximum pages, rows, bytes and exact total atomic budget. The SF88 engine executes and recovers acquisition and performs its original accounting. After the original export succeeds, this workspace retains a complete downloadable acquisition archive from that actual SF88 manifest and SF100 delivery directory. Browser operators receive the acquired dataset and delivery files through the same trusted file resolver, alongside the original manifest.

## CLI and embedding

~~~sh
node fiscaldata/cli.mjs state --dir /private/treasury-workspace
node fiscaldata/cli.mjs action --dir /private/treasury-workspace \
  --action sources.save --input /private/source.json
node fiscaldata/cli.mjs action --dir /private/treasury-workspace \
  --action captures.start --input /private/capture.json --wait
node fiscaldata/cli.mjs action --dir /private/treasury-workspace \
  --action editions.query --input /private/query.json
node fiscaldata/cli.mjs file --dir /private/treasury-workspace \
  --kind export --id RETAINED_EXPORT_UUID --name delivery.tar.gz \
  --out /private/treasury-delivery.tar.gz
~~~

Files are create-only at the receiving destination. The state/action worker can also run as a foreground process with worker --once to drain saved queued captures and exit. The same directory cannot be opened concurrently by a browser server and a separate CLI writer.

~~~js
import { openFiscalWorkspace } from './fiscaldata/workspace-model.mjs';

const workspace = await openFiscalWorkspace({
  directory: '/private/treasury-workspace',
  buyerWorkspaces: [],
  limits: { maxRows: 250000 }
});
try {
  const current = await workspace.snapshot();
  const response = await workspace.dispatch('captures.get', { id: current.captures[0].id });
  const original = await workspace.file('capture', response.result.id, 'capture.json');
  // original: trusted path, content type, filename, SHA-256 and byte count
} finally {
  await workspace.close();
}
~~~

Call startWorker() to enable background capture; it returns immediately after enabling the single retained worker. close() aborts an active network read, checkpoints its original intention, drains metadata and publisher actions, closes an owned native release, and releases the kernel lock. Embedders share this same model with the provided HTTP server and do not start a second publisher or buyer controller.

See DOMAIN.md for every action, payload, return shape and file kind.

## Interpretation review

Needs expert review: dataset-specific financial definitions and the operator’s selected merchant terms. Source context stays visible in the review and complete delivery; the workspace does not make policy, accounting or investment judgments.

## Original source contracts

The original official Treasury frontend provides the implementation and documentation for the public API:

- Production API base: https://github.com/fedspendingtransparency/fiscal-data/blob/master/env/prod.js
- Native metadata route: https://github.com/fedspendingtransparency/fiscal-data/blob/master/gatsby-node.js
- Metadata normalization: https://github.com/fedspendingtransparency/fiscal-data/blob/master/src/transform/metadata-transform.js
- API documentation and source: https://fiscaldata.treasury.gov/api-documentation/ and https://github.com/fedspendingtransparency/fiscal-data
- Debt to the Penny source description: https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/

Original row/source definitions remain the authority for interpreting a dataset. Native response bodies, retrieval times, metadata, links and hashes are retained in the workspace so a later capture can be compared against its actual original inputs.
