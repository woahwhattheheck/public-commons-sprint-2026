# Review CKAN meaning and deliver it to the customer

The CKAN workbench retains the source data dictionary and an explicitly selected
CSVW document with each captured edition. A reviewed field projection carries
that meaning into the original dataset publisher, portable merchant package,
SF82 seller and SF88 buyer request.

The source reader, CSV dataset engine, publisher journal and release store remain
the maintained implementations. This extension adds the binding between the
source's meaning and the particular columns delivered to a customer. It is
available through the [workbench](README.md), the existing
[merchant MCP workflow](MCP_WORKFLOW.md), and the
[publisher API](publisher/README.md).

## Capture the source dictionary with the data

Select the actual package and DataStore resource in the catalogue. Supply the
resource's explicit same-catalogue HTTPS `schemaUrl` when it has a CSVW schema.
The capture retains the first schema response in `schema.json` and the later
observation in `schema-after.json`, together with their source receipts and
SHA-256 identities. The manifest's `semanticSchema` selects the original schema
used for the edition. Its consistency record also reports a change observed
during capture.

The normal resource metadata and DataStore `fields[].info` remain part of the
retained source. Labels, notes and other meaningful dictionary entries can
supply a semantic document when the resource has no separate CSVW schema.
An edition containing neither a retained CSVW document nor meaningful field
metadata follows the ordinary dataset workflow.

Use the original source filter and pagination controls to capture the intended
population. Keep the original package, resource responses, page files and capture
manifest together when receiving an edition on another host. The schema
sidecars are part of the same capture and are copied into each publication plan.

### Live Svenska kraftnät reference

The active aFRR Capacity Market resource provides a concrete source with explicit
units, observation identity and linked code lists:

| Item | Original source |
| --- | --- |
| Catalogue | [data.svk.se](https://data.svk.se/) |
| Package | `cb9a1264-8ad3-46bb-983a-5ed554ca8ba3` / `afrr_capacity_market` |
| DataStore resource | `6351d2cc-1657-43eb-b112-b8408c700529` |
| Resource and dictionary | [aFRR Capacity Market](https://data.svk.se/dataset/afrr_capacity_market/resource/6351d2cc-1657-43eb-b112-b8408c700529) |
| CSVW schema | [Original JSON schema](https://data.svk.se/dataset/cb9a1264-8ad3-46bb-983a-5ed554ca8ba3/resource/6351d2cc-1657-43eb-b112-b8408c700529/schema) |
| Package metadata and attribution | [Original package_show](https://data.svk.se/api/3/action/package_show?id=cb9a1264-8ad3-46bb-983a-5ed554ca8ba3) |
| API selection and limits | [Official API guide](https://data.svk.se/blog/api_guide) |

The retained October 10, 2026 UTC-day receiving example contains 31 original
records. A separately captured October 8 UTC-day reference contains 32 records.
These are the complete returned records for their respective day filters; use
the actual returned total when refreshing. The package describes coverage as
hours with local procurement in Sweden. Missing rows therefore require the
source's coverage interpretation.

The original package records Creative Commons Attribution 4.0 and its licence
URL. That attribution travels in the capture, semantic source metadata and
merchant manifest.

## Review a useful public projection

The source has 12 physical fields and one virtual CSVW column. The following
mapping preserves the fields needed to identify and interpret a capacity
observation:

| Published alias | Source field | Physical value | Source meaning |
| --- | --- | --- | --- |
| `observation_id` | `soda_hashbyte` | string | Declared source primary key and observation URI variable |
| `start_utc` | `start_time_utc` | string | `base#validFromDateTime`; source declares datetime |
| `zone` | `bidding_zone` | string | `emdo#hasBiddingZone`; bidding-zone code-list URI |
| `product` | `reserve_product` | string | `emdo#hasReserveProduct`; reserve-product code-list URI |
| `direction` | `reserve_direction` | string | `emdo#hasReserveDirection`; reserve-direction code-list URI |
| `price` | `price` | number | `base#priceValue`; unit comes from the separate price-unit field |
| `price_unit` | `price_unit` | string | `base#hasPricePerUnit`; units code-list URI |
| `capacity` | `volume` | number | `emdo#procuredCapacityValue` |
| `capacity_unit` | `volume_unit` | string | `base#hasPowerUnit`; units code-list URI |

The `base` and `emdo` prefixes above refer to
`https://data.svk.se/ontology/base` and
`https://data.svk.se/ontology/emdo`. The exact original URIs are retained in
`sourceDefinition`; each alias has its own `projectedDefinition`.

The original CSVW document declares `soda_hashbyte` as its primary key and uses
it in the table's observation `aboutUrl`. The projection therefore rewrites
that template to `{observation_id}`. The unit code-list template for
`volume_unit` becomes
`https://data.svk.se/ontology/codelist/units#{capacity_unit}`.
The virtual `_resource_type` column retains
`rdf:type → https://data.svk.se/ontology/emdo#CapacityMarketObservation`
in the CSVW document.

The source timestamps are retained with their original lexical form. The
published JSON scalar is a string, and the source's datetime declaration remains
available in its annotation. Select a separate explicit transformation when a
customer requires a different timestamp representation.

Keep price and capacity with their unit columns. In the retained reference the
unit values are `EUR-MW` and `MW`; their original code-list URIs provide the
machine-readable meanings. Native numeric encoding uses the source engine's
existing precision checks. Select `encoding: "text", type: "string"` when the
customer needs an exact numeric token that the native numeric contract cannot
represent. The resulting semantic document then records both the original
datatype and the published text representation.

The remaining physical fields are still retained in the source capture:
`start_time_sweden` is a separate local-time field, `soda_identity` is a
technical identifier, and `_id` is the DataStore internal ID. The original
CSVW schema marks `_id` with `suppressOutput: true`. Choosing a suppressed
field produces an explicit review issue.

An example reviewed projection is:

```json
{
  "observation_id": { "field": "soda_hashbyte", "type": "string", "nullable": false, "encoding": "native" },
  "start_utc": { "field": "start_time_utc", "type": "string", "nullable": false, "encoding": "native" },
  "zone": { "field": "bidding_zone", "type": "string", "nullable": false, "encoding": "native" },
  "product": { "field": "reserve_product", "type": "string", "nullable": false, "encoding": "native" },
  "direction": { "field": "reserve_direction", "type": "string", "nullable": false, "encoding": "native" },
  "price": { "field": "price", "type": "number", "nullable": false, "encoding": "native" },
  "price_unit": { "field": "price_unit", "type": "string", "nullable": false, "encoding": "native" },
  "capacity": { "field": "volume", "type": "number", "nullable": false, "encoding": "native" },
  "capacity_unit": { "field": "volume_unit", "type": "string", "nullable": false, "encoding": "native" }
}
```

Review the current edition's actual values and null counts before using those
nullability choices on a new source edition.

## Preview, save and compare the reviewed meaning

The browser shows source definitions with the field suggestions. After choosing
aliases, types and encodings, preview the projected semantic document before
saving the source. Read the complete key, URI templates, virtual columns and
issues together with the individual column definitions.

The existing model exposes these methods:

| Method | Result and purpose |
| --- | --- |
| `edition(editionId)` | Original rows, fields and suggestions, plus the retained source meaning |
| `previewSemantics(editionId, projection)` | Meaning of the proposed alias/type/encoding selection |
| `saveSource(editionId, input)` | Original source operation; saves the projection and its semantic review digests |
| `sourceSemantics(sourceId)` | Reloads the saved source and its retained semantic document |
| `compare(beforeId, afterId, key)` | Original edition comparison, including changes in source meaning |

The HTTP interface uses
`POST /api/editions/:id/semantics` with `{projection}` for the preview and
`GET /api/sources/:id/semantics` for the saved data-dictionary download.

For an already open original workbench, the source save remains a normal durable
operation:

```js
const edition = await workbench.edition(editionId);
const meaning = await workbench.previewSemantics(editionId, projection);
// Present meaning with the selected columns to the operator.
const started = workbench.saveSource(editionId, {
  title: 'Svenska kraftnat aFRR capacity observations',
  query: 'capacity_observations',
  projection,
  expectedCaptureSha256: edition.manifestSha256
});
const operation = await started.completion;
if (operation.state !== 'COMPLETE') {
  throw new Error(operation.error?.message ?? operation.state);
}
const source = operation.result;
const savedMeaning = await workbench.sourceSemantics(source.id);
```

A new saved query with meaningful metadata contains
`semanticReview: {sha256, definitionSha256}` next to its projection.
The source loader checks that review against the same retained capture and
normalized projection when the source is used. A changed capture, selected
field, encoding or source meaning requires a new review.

### Preview and reopen meaning through merchant MCP

The CKAN family exposes 28 tools through the existing merchant operator.
Add `schemaUrl` to `merchant_ckan_capture`, then inspect the retained
edition through `merchant_ckan_edition`. Use the host-declared workspace
alias for this original project and the nine-field `projection` above:

```js
const preview = await call('merchant_ckan_semantics_preview', {
  workspace, editionId: edition.id, projection
});
const proposedMeaning = preview.native;

// After the ordinary source-save operation completes, retain its source.id.
const saved = await call('merchant_ckan_source_semantics', {
  workspace, sourceId: source.id
});
const reviewedMeaning = saved.native;
```

Both reads return `{workspace, native}` and leave the original operation
identity unchanged. Their native value is the projected or saved semantic
document; an edition with no source definitions returns null. The saved-source
read rechecks the capture and reviewed semantic digest, so the same source ID
can be inspected after another operation or a project reopen.

Save the chosen mapping through `merchant_ckan_source_save`, using the fresh
`expectedOperationId` described in the [MCP guide](MCP_WORKFLOW.md). Follow
that original operation to completion and retain its source ID. Public source
definitions, projected CSVW and package-local semantic file locators remain
visible in MCP results.

URI templates are projected only when their selected dependencies preserve
their original interpretation. Missing key fields, omitted template variables,
JSON-encoded URI values, source-position variables, and renamed named URI
parameters remain explicit source-only issues. The original definitions remain
in the semantic document. A complete projected primary key is emitted only
when all of its source fields are selected. The CSVW sidecar points to the
package's `data.csv`; source-relative templates are resolved against their
original source context.

### Understand the identities

| Identity | What it binds | When it changes |
| --- | --- | --- |
| `dataset.snapshot` | Original CSV values and physical dataset query policy | Values or relevant original dataset policy change |
| `semantics.definitionSha256` | Published column meaning, aliases, encodings, attribution and projected CSVW | The meaning or selected projection changes |
| `semantics.sha256` | That published meaning together with this retained capture | A different capture or reviewed meaning is selected |
| `sourceSemanticReview` | The full reviewed source query, before an optional candidate-column subset | The reviewed source query or its capture changes |
| `manifestSha256` | The complete portable merchant manifest and its exact file descriptors | A different merchant package is exported |

Source comparison distinguishes a changed raw schema document from a changed
definition. The separate definition identity supports refreshes where the row
values change while their interpretation stays stable.

## Publish through the existing dataset and merchant workflow

Prepare the original dataset candidate from the saved source. A useful
capacity policy can expose equality filters `zone`, `product` and
`direction`; ranges on `start_utc`, `price` and `capacity`; and sorts on
`start_utc` and `observation_id`. Select `observation_id` as the stable
extraction order, then inspect the actual candidate page, its total and the
saved candidate digest.

Dataset query parameters, `snapshot` and `semantics` together share the
original 32-parameter offer budget. Each range-enabled field advertises four
range parameters. The exporter runs the real SF61 compiler and original
service-binding validation before writing the package.

Review and publish with the original candidate digest and review ID. Export with
the existing `exportMerchant(publicationId, input)` method or
`merchant_ckan_merchant_export` tool. The low-level
`exportCkanMerchantPackage` still accepts the publisher, run ID, destination,
reviewed candidate digest, public origin/path and payment terms.

A semantic export adds these files and bindings:

| Package member | Contents |
| --- | --- |
| `semantics.json` | Full reviewed meaning of the columns in the accepted candidate |
| `table-schema.json` | Alias-aware CSVW document for the retained `data.csv` |
| `capture/schema.json`, `capture/schema-after.json` | Original observed schema responses when CSVW was selected |
| `source.json`, `original-source.json` | Saved selected query and its original review |
| `openapi.json` | Physical response-column schemas, projected CSVW column annotations and the semantic selector |
| `merchant-manifest.json` | Semantic descriptors, full source review and hashes for every retained file |
| `handlers.mjs`, `runtime/*` | Original portable merchant entry and its pinned dataset/runtime modules |

All existing capture, candidate, review, CSV and dataset configuration files
remain included. Preserve the complete file list, package-relative paths,
private permissions and each returned byte count/hash during receiving.
`merchant_ckan_files` and the existing chunked file reader include the new
sidecars automatically. The original SF82 stage copies the complete package
into its own `ckan-packages/<manifestSha256>` directory.

The generic publisher may expose a subset of the source query's columns.
Export first validates the full source query's review, then derives the semantic
document for the actual accepted candidate columns and nullability.
`sourceSemanticReview` and `manifest.semantics` preserve those two identities
separately. A missing observation key or URI dependency is therefore visible in
the resulting product dictionary.

Select and start the staged release through the original SF82 controls. With
merchant MCP, the selected CKAN project and merchant operator use the same
`PROJECT/seller-releases` store. Use the original release digest and generation
for activation and the returned instance ID for owned shutdown.

## Carry meaning through the paid page and buyer request

The actual offer advertises optional scalar `snapshot` and `semantics`
parameters. Their examples identify the published edition and its reviewed
meaning. A request carrying a different semantic SHA receives
`409 CKAN_SEMANTICS_CHANGED` during the original admission step. Omitting
the selector requests the current meaning.

The CKAN wrapper removes those two edition selectors before calling the strict
generic dataset engine. For a semantic product it consumes the exact page the
original engine prepared during admission, adds the complete semantic document
and checks the original `maxPageBytes` against the combined JSON body. A page
that exceeds the limit returns `413 DATASET_PAGE_TOO_LARGE` before payment.
The paid handler then returns that same prepared response.

A successful page keeps the original `stellar-forge.dataset-page.v1` body and
adds `body.semantics` plus `x-ckan-semantics-sha256`. The semantic document
describes the complete published dataset; `body.fields` is the actual column
selection on that page. The CSVW document describes the package-local CSV, so a
consumer receiving the package can resolve its `data.csv` reference directly.

The retained OpenAPI document includes response-column types and
`x-csvw-column` annotations. The current SF61 importer propagates ordinary
input query schemas into Bazaar; its response importer handles the supported
stream representations. The semantic query selector therefore supplies the
actual ordinary JSON offer binding, while the full dictionary remains in the
package and delivered page.

Load the buyer offer through the same original CKAN API:

```js
const offer = await workbench.buyerOffer(exported.id, {
  seller: 'http://127.0.0.1:8423',
  query: 'where_direction=down&sort=start_utc&limit=20'
});
const started = workbench.prepareBuyer(exported.id, {
  seller: 'http://127.0.0.1:8423',
  query: 'where_direction=down&sort=start_utc&limit=20',
  intentId: 'svk-capacity-consumer-20261012',
  acceptIndex: 0,
  offerSha256: offer.offerSha256
});
const operation = await started.completion;
if (operation.state !== 'COMPLETE') {
  throw new Error(operation.error?.message ?? operation.state);
}
const buyer = operation.result;
```

Use the actual listener selected in the host connection. The offer reader first
uses the original dataset route, snapshot, query and payment checks, then checks
the seller's advertised semantic digest against the retained merchant package.
It adds the exact `semantics` selector to the concrete buyer URL. Original SF88
preparation records that URL, the chosen advertised terms and the saved original
offer in the existing buyer configuration.

Receive the saved `buyer.json` using its returned configuration hash. The
customer's operation URL now selects both the dataset snapshot and the semantic
digest. Keep those selectors when following the dataset's ordinary page cursor.

## Preserve meaning across every received page

The original SF88 dataset session keeps both `snapshot` and `semantics` in
the operation URL when adding each native cursor. The strict source query,
cursor encoding and original query hash retain their existing format.
The buyer verifies the full semantic document against its canonical SHA,
checks the value-independent definition SHA and matches each semantic column
to the original physical dataset declaration. Page continuity includes the
semantic identity, so a missing or changed dictionary stops that page from
being accepted into the existing session.

For native acquisition, the buyer reads the response metadata already retained
by the original SF88 attempt-wire recorder. A semantic page requires the actual
`x-ckan-semantics-sha256` and `x-dataset-snapshot` headers to match its body.
The saved page report contains those two headers and the original response
record's phase, byte count and SHA. Other request and payment headers remain
in the existing private checkpoint. Reopening a session or exporting its
delivery rereads that original checkpoint. The original authenticated
lost-output recovery follows the same semantic binding when restoring a
previously acquired page.

A host receiving real handler responses can use the same body validator:

```js
const page = inspectDatasetPage(responseBytes, {
  url: concreteRequestUrl,
  previous: previousPage,
  expectedSnapshot: reviewedSnapshot,
  maxRows: retainedRowCount,
  responseHeaders: response.headers
});
```

Import it from `sf88-operator-buyer-cli/dataset-page.mjs`. Supply the actual
response headers from that request. The native SF88 session and delivery APIs
perform their own checkpoint lookup. Body-only offline inspection remains
available to the original SF100 archive reader.

The original SF100 exporter includes the semantic identity in its page
signature and archive continuity. Its final customer package contains:

| Customer output | Receiving use |
| --- | --- |
| `dataset.jsonl` | Typed rows in the acquired field and response order |
| `dataset.csv` | Spreadsheet export with the original formula-prefix handling |
| `semantics.json` | Complete published source meanings, units, keys, URI templates and virtual columns |
| `manifest.json` | Original page chain, every output's byte digest, semantic identity and actual `selectedFields` |
| `review.html` | Existing operator review with the semantic and definition identities |

The dictionary's `sha256` identifies the canonical reviewed meaning. The
manifest's `outputs['semantics.json'].sha256` identifies the exact delivered
JSON file bytes; these are distinct digests. The manifest records
`scope: 'PUBLISHED_DATASET'`, `selectedFields` and
`typedRowsFile: 'dataset.jsonl'`. Use those fields when consuming a query
that selects fewer columns than the published dataset.

The retained CSVW describes the merchant's original `data.csv` and remains
inside the complete dictionary. For typed downstream ingestion, pair the
selected fields in `dataset.jsonl` with their definitions. The customer CSV
uses the original spreadsheet conversion and can neutralize formula-like
strings, so its cells have that existing export representation.

## Read the dictionary through customer interfaces

The existing customer browser lists `semantics.json` with the finalized
delivery files. Its normal verified file reader downloads the dictionary using
the returned byte count and exact file SHA.

The Node API exposes the same file through
`delivery.file('semantics.json')`. It is an ordinary `DatasetFile`, so
applications can use the existing verified `bytes`, `chunks` and `saveAs`
methods. For the parsed dictionary, use:

```js
const dictionary = await delivery.readSemantics({
  limit: 2 * 1024 * 1024,
  signal
});
if (dictionary !== null) {
  const selectedFields = delivery.manifest.semantics.selectedFields;
  // Match those delivered fields to dictionary.columns.
}
```

`readSemantics({limit = 2097152, signal} = {})` reads the hash-checked file
and checks its schema, meaning identity, definition identity and capture identity
against the saved delivery binding. It returns `null` for a legacy delivery
whose manifest has no semantic document.

The original `exportQueueDataset` result includes optional
`semanticDictionary` metadata for the completed customer package:

| Property | Receiving meaning |
| --- | --- |
| `path` | Absolute path to the receiving host's retained dictionary |
| `file` | Portable package member `dataset/semantics.json` |
| `bytes`, `sha256` | Exact delivered JSON byte count and file SHA |
| `semanticSha256` | Canonical reviewed meaning identity |
| `definitionSha256` | Meaning identity independent of the captured row edition |
| `captureManifestSha256` | Original capture selected by the dictionary |

The queue delivery manifest's per-operation records also retain the checked
`semantics`, `semanticResponseHeaders` and `semanticResponseRecord`
bindings from each original acquired page. The response record identifies the
original wire response by phase, bytes and SHA. Receive the complete existing
`dataset/` customer directory with its manifest and page chain when moving
the queue result to another host.

## Complete the native receiving journey

Use the retained native execution job and one equipped runtime for the integrated
journey. Within the project, follow each original workbench operation through
completion. Reuse the commercial receiving example's retained provider responses
and source profile, then complete the following actual product sequence:

1. Import or capture the selected UTC-day edition with its original CSVW
   response and exact capture manifest. Inspect the actual row count, source
   units, source key and semantic consistency.
2. Preview the nine-column mapping above, save it, reload the source dictionary
   and inspect the projected observation and unit URI templates.
3. Prepare the original candidate, query a real direction or zone present in
   the retained rows, review its candidate digest, and publish its dataset
   version through the original journal.
4. Export the complete merchant package. Read the two semantic sidecars from
   the exported package and confirm that the manifest identifies the reviewed
   source and actual published columns.
5. Stage and activate that package in the original SF82 store, start its owned
   seller, and read its actual offer and payment-required response. Use the
   published semantic selector, then observe the stale-selector response at
   the same admission route.
6. Prepare the original SF88 buyer configuration from that offer and retain the
   complete source, merchant and buyer files. Receive the original paged
   responses at a small page size, retaining the actual headers, both edition
   selectors and every native cursor. A 32-row edition at limit 5 produces
   seven original pages; use the actual selected edition's total.
7. Finalize those pages through the original SF100 exporter. Read the customer
   manifest, typed rows and retained dictionary; confirm the selected fields,
   row total, semantic identity and original page chain after reopening.
8. Close the owned seller and workbench through their original controls and
   add the resulting native operation record to the same implementation handoff.

The [existing native MCP receiver](examples/merchant-mcp-receiver.mjs) supplies
the maintained HTTP operation, file receiving and release ownership sequence.
Use the current resource profile and semantic fields for this receiving case.

For an older saved query without `semanticReview`, the existing merchant
behavior and original dataset snapshot remain compatible. Saving a newly
reviewed source is the entry point for adding retained source meaning to its
next publication.
