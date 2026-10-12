# Complete live OData collections

A saved live purchase is one response page. A customer analysis usually needs the
whole selected collection. This receiver joins the original ordered request and
response files, confirms their continuations and declared keys, and retains one
complete source that the existing Analysis workspace can register, project, query,
report, export and reopen.

The collection is a customer document. Its merchant, buyer, Analysis database,
native purchase records and workspace transfer continue to use their original
implementations. The installed `odata-live` command and
`@tokenjunkielabs/starforge-merchant/seller/odata/live` export expose this receiver.

## Receive the selected original collection

Keep the exact original merchant package and all saved request/response files.
An exchange can also include its original SF88 buyer configuration and result.
Select both of those files together when using the native purchase binding.

Create `exchanges.json` beside the retained files. Each file path is relative to
that input document; absolute paths also work. A five-page selection is:

```json
{
  "schema": "stellar-forge.odata-live-collection-input.v1",
  "operation": "Orders",
  "title": "Selected original Orders collection",
  "exchanges": [
    {"requestPath": "page-1/request.json", "responsePath": "page-1/response.json"},
    {"requestPath": "page-2/request.json", "responsePath": "page-2/response.json"},
    {"requestPath": "page-3/request.json", "responsePath": "page-3/response.json"},
    {"requestPath": "page-4/request.json", "responsePath": "page-4/response.json"},
    {"requestPath": "page-5/request.json", "responsePath": "page-5/response.json"}
  ]
}
```

The example names select files already acquired by the original operator.
Use the actual operation ID from the retained merchant package and the actual
number of exchanges. Each later request must contain only the exact cursor
returned by the preceding page. The last page must report `provider` or
`limit` completion with no further cursor. The first page contains the full
selected query.

For an exchange received through the original native buyer, add:

```json
{
  "requestPath": "page-1/request.json",
  "responsePath": "page-1/response.json",
  "buyerConfigPath": "page-1/buyer.json",
  "buyerResultPath": "page-1/result.json"
}
```

The response path may be relocated with its other retained files. The original
configuration and result stay byte-for-byte intact. The receiver checks their
original destination, intent, merchant URL, method, exact request-body length and
digest, configured network, asset, recipient, maximum amount, HTTP status and
saved response digest through the existing SF88 readers. It retains the original
native and payment statuses in the collection manifest.

Run the installed command:

```sh
starforge odata-live collection \
  --package /private/orders/merchant-package \
  --input /private/orders/exchanges.json \
  --out /private/orders/complete
```

The same source command is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/cli.mjs \
  collection --package /private/orders/merchant-package \
  --input /private/orders/exchanges.json --out /private/orders/complete
```

Use `--allow-loopback true` when the selected original supplier package uses a
local HTTP service. Output directories are owned, canonical private directories.
The receiver creates them with mode 0700.

The result includes the complete row and page counts, declared keys, normalized
query and fingerprint, actual source acquisition window, all reported counts,
terminal completion, collection-manifest digest and the Analysis source path.
`limit` completion means the reviewed query limit was reached. The exact
`query.top` remains part of that result.

### Choose a smaller analytical projection

The optional input `fields` selects up to 32 delivered scalar field paths.
All declared entity keys are included. A chosen path must be present in the
original query's selection. When `fields` is omitted, the receiver selects all
delivered query fields, subject to that limit. Choose explicit fields for a
wider original entity.

Column names are deterministic and unique even under case-insensitive SQL
identifiers. `projection.json` records each original property path, generated
column name, declared and underlying EDM type, key and nullability, precision
and scale. It includes each complete original property definition and the catalog's
entity, complex, enum and type declarations with the original metadata identity.
Its source kind is explicitly `odata-live`.
Each value column has a separate `_state` column with `value` or
`null`. Original missing properties are rejected by the page contract.

Small integer, finite floating-point and Boolean values retain their native
types in the typed JSON projection. Decimal and Int64 values retain their exact
original text, including exponent or trailing-zero spelling. JSON null stays
null. An empty text value stays an empty string with state `value`.

The independent `dataset.csv` output follows the same projection. A null cell
is empty with state `null`; an empty text value is empty with state `value`.
This distinction remains available to a CSV consumer. The accompanying
`dataset.json` uses the original `stellar-forge.csv-dataset.v1` configuration
for the CSV seller workflow.

## What the collection retains

| File | Purpose |
| --- | --- |
| `collection.json` | Full selection, page order, source bindings, source times, row and byte counts, terminal state and original/output file digests. |
| `selection.json` | Exact input identities and selected operation, query, projection and limits. |
| `merchant.json` | Original catalog and plan used to compile and validate the selected live query. |
| `projection.json` | Original OData field paths, EDM types, generated analytical columns and null states. |
| `pages/00001/request.json`, `response.json` | Exact original request and returned live-page bytes, repeated for every page. |
| Optional `buyer.json`, `result.json` in each page directory | Exact original native purchase selection and retained result. |
| `rows.jsonl` | Complete original projected page items in original page and row order. |
| `rows-index.jsonl` | One-based collection row, page, page row and original declared key values. |
| `dataset.csv`, `dataset.json` | Complete CSV projection and native CSV seller configuration. |
| `analysis-rows.json` | Complete typed analytical array when it fits the original 32 MiB JSON source limit. |
| `analysis/source.json`, `analysis/files/` | Complete portable original Analysis source document, its selected data, receiver source and compressed original page packets. |

Every page must identify the same compiled query and source metadata. Its
cumulative row count must equal the actual preceding rows plus that page's rows.
A repeated cursor, duplicate declared entity key, mismatched source, incomplete
chain or changed saved file stops receiving at the relevant source discrepancy.

Declared decimal and integer keys compare by their exact numeric meaning, while
the original row spelling is retained. Thus two spellings of the same declared
numeric key cannot quietly create two entities. Guid keys use validated UUID
identity independent of hexadecimal case. Date, TimeOfDay and DateTimeOffset keys
use exact calendar/clock identity, including all original fractional-second
digits; offsets normalize only the timestamp identity. Leap seconds remain
distinct from the following ordinary second. The projected cell keeps its original
spelling. The lexical rules follow the [OData4.01 ABNF](https://docs.oasis-open.org/odata/odata/v4.01/os/abnf/odata-abnf-construction-rules.txt),
and UUID spelling follows [RFC9562 section4](https://www.rfc-editor.org/rfc/rfc9562.html#section-4).

This is a live continuation acquisition. The manifest retains each page's
original time, ETag, supplier response digest and reported count. It also exposes
the distinct reported counts and whether they agree across pages. Those original
observations remain available in the customer document and transferred workspace.

The default bounds are 10,000 pages, 1,000,000 rows, 128 MiB of original inputs
and 128 MiB per collection output. Input `limits` may reduce those values.
The complete mapped JSONL also stays within the original Analysis ceiling of
2 MiB per projected row and 128 MiB total. CSV text/state rows are counted exactly.
For typed JSON, the count reserves up to 32 bytes for each finite Python float
serialization and counts every other mapped field exactly. The manifest records
this conservative upper bound and the selected format before publication.
An analytical document holds at most 32 originals and 256 MiB total through the
existing source-document reader. The receiver makes packets of at most 24 MiB
of uncompressed framed originals; each compressed original remains under the
existing 32 MiB file limit.

The typed JSON document is selected when its complete array fits 32 MiB and the
chosen output bound. Larger selections use the complete CSV plus explicit state
columns. A collection beyond the original whole-document bounds needs a smaller
complete query selection.

## Open and browse the same collection

```sh
starforge odata-live collection-inspect --directory /private/orders/complete

starforge odata-live collection-rows \
  --directory /private/orders/complete --offset 0 --limit 100
```

Inspection recomputes the original query chain and generated outputs and checks
the complete analytical handover. Row browsing returns the selected rows and
actual total while exhausting the saved-file hash reader. The page size is
1–500 rows.

Repeating the same receive or restore command continues the same output.
The collection uses the original release lease for its single writer. Each
file is written to an owned temporary file, synced and published exclusively.
A completed identical file is reused. A changed selection or changed completed
file requires the operator to choose the intended original edition or a new
receiving directory. Native purchase execution is outside this receiving command.

## Register in the original Analysis workspace

Use the customer workspace selected by its original operator. Registration
through the command-line operator takes that workspace's original lease; close
its managed browser operation before running the command and reopen the same
workspace afterwards.

Read `analysis.format` from `collection-inspect`. Pass that actual value,
`json` or `csv`, to the existing source registration:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis \
  --checkout /installed/starforge/source --node /installed/node \
  response --name orders_collection --input-kind document \
  --manifest /private/orders/complete/analysis/source.json \
  --format json --expected-revision 0
```

The installed `analysis` command resolves this same original module when that
runtime exposes the command. The source Python package lives in
`sf88-operator-buyer-cli/python` in a checkout.

Use the registration's actual returned source name and revision for projection.
A new registration uses expected revision zero. The original registration API
also accepts an unchanged source as a retry; inspect its returned revision.
To replace an existing named source with a changed selection, select its actual
current revision.

Generate the native response-preview input:

```sh
starforge odata-live collection-analysis-mapping \
  --directory /private/orders/complete \
  --source orders_collection --revision 1 \
  --out /private/orders/analysis-mapping.json
```

Replace revision 1 with the original registration's returned revision. The
mapping is a complete request body for the original `response-preview` job,
apart from that controller's required stable 32-character lowercase hexadecimal
`id`. It contains the selected source revision, collection pointer and all
value/state columns. Typed JSON maps native cells, with declared Single/Double fields using the original explicit number conversion. CSV maps original text and
state columns without introducing an implicit numeric or null conversion.

The existing Analysis operator performs these steps:

1. Open the registered source and review its original identity and full row count.
2. Start `response-preview` with the generated mapping and one stable job ID.
3. Read its complete `preview_sha256` and review the projected columns/rows.
4. Start `response-import` with a second stable job ID,
   `preview_id` equal to the original preview job ID,
   the original `preview_sha256`, and `allow_incomplete: false`.
5. Use the returned native dataset version in the original query, report and
   workbook workflows. Retain the generated state columns when exporting CSV
   or interpreting fields that may be null.

These are the original Analysis job requests. The source revision and preview
digest provide its normal changed-source checks, and repeated job IDs retain
their original operation semantics. The collection receiver shares the existing
customer source, query, report, workbook and archive machinery.

An installed application can construct the same request directly:

```js
import {
  openCollection,
  collectionAnalysisMapping
} from '@tokenjunkielabs/starforge-merchant/seller/odata/live';

const collection = await openCollection('/private/orders/complete');
const request = collectionAnalysisMapping(collection, {
  source: 'orders_collection',
  sourceRevision: actualRegistration.revision
});
// The existing Analysis controller adds its original stable job id.
```

## Transfer and restore through the same customer workspace

The analytical source document contains the full original collection manifest,
the exact receiver module used for this edition and framed gzip packets with
every original selected merchant, projection, request, response and optional
native buyer/result file. The data document and all originals use content-addressed
paths and explicit digests.

Original Analysis registration copies the whole source-document closure into its
own response custody. Its workspace export includes those original source files
alongside the saved source versions, previews, projected dataset, queries,
reports and workbooks. Use the existing customer Workspace Transfer workflow
to export and restore that closed workspace on the receiving operator's host.

On the restored host, select the registered source's actual retained
`source.json`. Restore the original live collection from it:

```sh
starforge odata-live collection-restore \
  --manifest /private/restored-analysis/analysis-response-documents/ACTUAL_ID/source.json \
  --sha256 ACTUAL_SOURCE_MANIFEST_SHA256 \
  --out /private/received-orders
```

Read the actual source path and manifest digest from the restored registration;
`ACTUAL_ID` is a placeholder for that native content-addressed directory.
The source document includes its `files` sibling. Preserve that directory
when selecting or moving the manifest.

Restoring checks every compressed original, reconstructs the same query chain
and projection, restores the original analytical source bytes and requires the
same collection-manifest digest. Original buyer configuration/result contents
are preserved through the move. The receiving operator can inspect and browse
the complete collection and continue working in the same restored Analysis
workspace.

A complete commissioning operation records the original collection digest,
actual registered source name/revision, complete imported dataset version,
native query/report/workbook IDs, workspace transfer digest, and the restored
collection digest. This gives the existing supplier, merchant and independent
customer operators one shared complete input for the established adoption work.

## Programmatic interface

`receiveCollection(prepared, input)` accepts the original prepared live product
and `{operation?, title?, fields?, limits?, exchanges, directory, allowLoopback?}`.
An exchange has `requestPath` and `responsePath`, with optional
`buyerConfigPath` and `buyerResultPath` together. It returns the complete
manifest, receiving directory, manifest digest and analytical source identity.

`openCollection(directory)` returns the same fully checked retained collection.

`restoreCollection({sourceManifest, directory, expectedSha256?})` receives a
complete retained Analysis source and returns the rebuilt collection together
with the original source manifest identity.

`readCollectionRows(directory, {offset?, limit?})` returns original row values,
the actual total and the next offset.

`collectionAnalysisMapping(collection, {source, sourceRevision})` returns the
original Analysis preview request for that source registration.

The installed SDK includes these named exports and their TypeScript declarations.
The command helpers share exactly these functions.

## Source ownership and integration

This module composes the existing `live/client.mjs` and `live/contract.mjs`,
the original SF88 request/result readers and the original Analysis
`response_documents.py` and `response_tables.py`. The existing OData
operator remains the source/workspace/semantic product owner. Its
`liveProducts` page and transfer history can retain the returned collection
identity and pass the source manifest to the existing customer Analysis
workflow. The original Analysis owner continues the typed query/report/workbook
and independent receiving arm.

For the retained Northwind workflow, use its original five saved response
exchanges and original prepared merchant package, then continue the already
selected Analysis/Workspaces operation with this one complete source. Its actual
830-row result, original selected keys and amounts come from those retained
inputs. A native operating result should record the source and receiving
identities returned by that actual operation.

## Collections in the original live service

The source-owned `collection-store.mjs` joins the complete receiver to the original live service. It keeps collections under the selected service:

```text
live/products/<service-id>/collections/<collection-id>/
```

A collection uses one immutable reviewed profile, its original compiled package, operation and source binding. The operator selects the saved response identifiers in their actual continuation order. An optional buyer identifier selects that response's original reviewed request file. When a buyer identifier is omitted, the first request is the package's saved request and every later request is the previous receiving's saved next request. The core receiver verifies every request and response again, including the complete cursor chain and final page.

The original live-operations state sequence owns collection creation and receiving. Pass that existing function when opening a collection controller:

```javascript
import { openServiceCollections } from './live/collection-store.mjs';
const collections = await openServiceCollections({
  directory: join(products, profile.id),
  profile,
  sequence, // The existing live-operations sequence and state.lock.
});
const result = await collections.collect({
  id: 'orders-complete',
  title: 'Selected complete Orders collection',
  pages: originalReceivingIds.map(receivedId => ({receivedId})),
});
```

The profile is read back from the selected service directory, and its retained package is recompiled through the original reader. Every response identifier must equal the SHA-256 of its exact saved response. Its original receiving record must name the same operation and metadata. Selected buyer handoffs bind their exact request digest and source metadata. The resulting collection must have the original service's source binding, metadata, operation, service root and merchant origin.

### Original operator hooks

The existing owner can keep the current `profile`, `preparedProfile`, `sequence`, `detail`, `file` and workspace transfer flows:

| Original surface | Source-owned call | Customer result |
|---|---|---|
| Live service detail | `collections.list()` | Completed collections with row/page counts, query, keys, completion, supplier counts and acquisition window; unfinished collections remain visible. |
| Receive complete selection | `collections.collect({id,pages,title,fields,limits})` | Same selected request chain, immutable rows and full Analysis source. Repeating the same input resumes its selected collection. |
| Inspect selection | `collections.inspect(id)` | Complete collection metadata and the exact retained file inventory. |
| Read rows | `collections.rows(id,{offset,limit})` | Original row order, native scalars and explicit collection identity. |
| Download | `collections.file(id,name)` | Only a declared file, re-read under the original collection lease and verified against its bytes and digest. |
| Receive Analysis source | `collections.restore({id,sourceManifest,expectedSha256})` | The same complete collection returns from the customer-held Analysis source document. |
| Whole workspace backup | `serviceCollectionFiles({directory,profile})` | The complete core and Analysis subtree as original transfer file records. |
| Restore review | `validateServiceCollectionTransfer({profile,files})` | Complete paths and original digest closure, before the native workspace writes files. |
| Restore completion | `verifyServiceCollections({directory,profile})` | Every collection reopens through the full original engine before the workspace publishes its received state. |

A service collection controller takes the service's immutable profile. Its `collect` and `restore` methods enter the provided original sequence themselves. Do not wrap them in a second call to the same sequence.

For source-document receiving, `expectedSha256` is the actual reviewed digest of the selected `analysis/source.json`. The controller first reads the document's original collection manifest and checks its service identity. The complete core restore then verifies the source packets, original transformation, typed projection and every retained request/response before returning the identical collection.

A collection with unfinished manifest or Analysis publication is shown as `INCOMPLETE`. Repeating its original receive input completes that same directory. The whole-service backup requires the selected collections to be complete so an interrupted operation cannot quietly disappear from a customer workspace transfer.

### Transfer composition

The following hooks extend the existing `stellar-forge.odata-transfer.v1` source format. Existing captures, source editions, semantic exports, original buyer requests and received responses continue to use their original transfer records.

Inside `workspace.backup`, while its existing `live/state.lock` is held, append each service's complete collection files:

```javascript
const retained = await serviceCollectionFiles({
  directory: join(root, 'live', 'products', record.id),
  profile: record,
});
files.push(...retained.files);
```

The returned paths already begin with `live/products/<service>/collections/<collection>/`. They include `collection.json`, `selection.json`, all core-manifest files, `analysis/source.json`, the exact selected analytical data, the original collection manifest and transformation, and every compressed original-page packet. Runtime locks and temporary aliases are outside the transfer selection.

Before writing a receiving bundle, the existing restore can recognize only the declared collection subtree:

```javascript
const selected = parseCollectionTransferPath(file.path);
const collectionPath = selected && (bundle.state.liveProducts || []).some(
  service => service.id === selected.serviceId,
);
if (!originalPermitted.test(file.path) && !collectionPath) {
  throw fault('ODATA_TRANSFER_PATH', 'Unsupported transfer file.');
}
for (const profile of bundle.state.liveProducts || []) {
  validateServiceCollectionTransfer({profile, files: bundle.files});
}
```

`validateServiceCollectionTransfer` checks canonical base64, original bytes and hashes, unique members, the selected service/operation, the complete original collection manifest, the selected request digest and the complete Analysis document. It rejects orphan files, missing originals and conflicting content-addressed identities. This helper returns the exact admitted paths; the original workspace restore owns publication.

After the original `writeNew` loop has retained all validated files, and before its existing `store.mutate` publishes the received workspace state, call:

```javascript
for (const profile of bundle.state.liveProducts || []) {
  await verifyServiceCollections({
    directory: join(root, 'live', 'products', profile.id),
    profile,
  });
}
```

The final call invokes `openCollection` under each original collection lease. It recompiles the original source/query, checks the complete request chain, cumulative rows, declared-key uniqueness, exact source values and selected analytical output, and verifies the original document closure again at the receiving location. The original OData restore journal still owns same-input replay and final state publication.

The native workspace HTTP request reader currently accepts 64 MiB. A larger complete transfer can use the original filesystem `workspace.restore` caller or the independently retained Analysis Workspace Transfer. Keep the full source selection together when choosing the receiving route.
