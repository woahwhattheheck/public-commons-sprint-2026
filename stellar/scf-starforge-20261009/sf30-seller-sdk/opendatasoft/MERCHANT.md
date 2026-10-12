# Huwise / Opendatasoft merchant engine

This engine turns a complete Explore v2.1 edition into a maintained data product.
The same project owns catalogue discovery, acquisition, field review, notes,
edition comparison, the original dataset publisher and a portable merchant.
SF82 manages the seller release and SF88 carries the customer purchase.

The browser guide is [WORKSPACE.md](workspace/WORKSPACE.md); installed commands and the
customer continuation are in [README.md](README.md).

## Actual source

The original [Open Data Inception dataset](https://public.opendatasoft.com/explore/dataset/open-data-sources/)
is `open-data-sources`, UID `da_t0o52c`. Its complete native acquisition ran on
October 11, 2026, between 23:16:43 and 23:16:56 UTC.

| Response | Bytes | SHA256 |
| --- | ---: | --- |
| Opening metadata | 43,890 | `ba5f1082c94baa7eb69403b08d78ff958c6837c6947aa1fbad539df2b39b5f39` |
| Complete JSON export | 2,526,904 | `7e12a21454318b3df990f9bc1d7fad3457bcef4acd31e3bd38507a90ad961d7e` |
| Closing metadata | 43,890 | `ba5f1082c94baa7eb69403b08d78ff958c6837c6947aa1fbad539df2b39b5f39` |

The actual array has 3,763 records and all 18 fields. Every `url` is a nonempty
unique HTTPS string; the metadata marks it as an identifier. Opening and closing
metadata retain the same UID and `modified` / `data_processed` clock,
`2026-10-11T22:00:45+00:00`. The source declares `Public domain`, publisher
`Opendatasoft` and attribution `Made with Natural Earth`.

| Field | Native representation |
| --- | --- |
| `location` | `{lon,lat}` objects in 3,759 records; null in four. |
| `latitude` / `longitude` | Text; respectively 1,385 / 1,386 nulls. |
| `thematic` | Arrays in 3,761 records; null in two, despite metadata type text. |
| `portal_typology` | Original hierarchy strings; null in 17. |
| `has_issue` | Source text: null 3,660; FALSE 65; TRUE 37; FAUX one. |
| `description` | Null in 2,675 records. |

Geography uses `location`. Hierarchy text, issue labels, arrays and spelling
variants remain unchanged in the retained edition.

## Capture and resume

Use Linux, Node 24 or newer and util-linux `flock`. The existing publisher requires
private parent directories (0700) and regular input/output files (0600).

~~~js
import {
  captureOpendatasoftDataset,
  readOpendatasoftCapture,
} from './capture.mjs';

const retained = await captureOpendatasoftDataset({
  catalogOrigin: 'https://public.opendatasoft.com',
  datasetId: 'open-data-sources',
  lang: 'en',
  timezone: 'UTC',
}, '/absolute/private/source-edition');

const same = await readOpendatasoftCapture(
  retained.manifestFile, retained.manifestSha256,
);
~~~

The portal origin excludes the API path. Requests use the fixed Explore v2.1
dataset hierarchy. Complete acquisition uses `/exports/json` and retains the
original selection, every accepted response and its actual request receipt.
Metadata brackets the export; filtered captures also bracket it with the
provider's matching-record counts.

The directory contains `capture.json`, original `dataset.json`, `records.json`,
`dataset-after.json`, and filtered-count responses when applicable. The manifest
binds original URLs, status, timestamps, headers, sizes, hashes, fields, rights,
actual row count and metadata consistency.

Resuming the same selection and directory reuses retained responses. A complete
capture returns its saved manifest; a fresh observation uses a new edition
directory. Accepted responses and their saved request receipts are reconciled
before another GET, including interruption between retention and state save.
Provider errors retain the actual HTTP receipt; 429 preserves retry guidance.

Capture selection accepts `where`, `order_by`, repeated `refine` / `exclude`,
`lang` and `timezone`. It keeps all original fields for subsequent projection
review. Transport options are `authTokenEnv`, `timeoutMs` and `maxResponseBytes`;
operation limits are `maxRows` and `maxBytes`. An existing API key is read from
the named environment variable and sent as `Authorization: Apikey <value>`.

### Import the existing original response files

This path performs no provider request:

~~~js
import { importOpendatasoftResponses } from './capture.mjs';

const imported = await importOpendatasoftResponses({
  selection: {
    catalogOrigin: 'https://public.opendatasoft.com',
    datasetId: 'open-data-sources',
    lang: 'en', timezone: 'UTC',
  },
  metadataFile: '/absolute/private/open-data-sources-metadata-current.json',
  exportFile: '/absolute/private/open-data-sources-full-export.json',
  metadataAfterFile: '/absolute/private/open-data-sources-metadata-closing.json',
  receipts: originalReceipts,
}, '/absolute/private/retained-source');
~~~

Each original receipt supplies canonical `file` as `dataset.json`,
`records.json` or `dataset-after.json`, plus `url`, `method: "GET"`,
`status: 200`, `bytes`, `sha256` and `receivedAt` or original `retrievedAt`.
Retain the remaining original receipt fields. Filtered imports also provide
`countBeforeFile` / `countAfterFile` and their zero-row query receipts.

The importer checks the exact dataset path, selected export parameters, complete
export mode and every digest. For Open Data Inception, opening count, closing
count and the complete array length all equal 3,763.

## Provider query contract

The primary [Explore v2.1 reference](https://help.opendatasoft.com/apis/ods-explore-v2/)
defines the API. Ordinary record queries return at most 100 rows with
`offset + limit < 10000`; complete acquisition uses exports.
The retained original OpenAPI is 45,933 bytes, SHA256
`5d90a96ed06b9b56a31a0a05c0b096bca2563388c77cb3bf8e1ec253ff2fd406`.

~~~js
searchOpendatasoft(origin, input, options)
previewOpendatasoftRecords(origin, datasetId, input, options)
requestOpendatasoft(origin, action, datasetId, query, options)
describeOpendatasoftDataset(originalMetadata)
~~~

Catalogue input accepts `where`, `order_by`, repeated facet selections, language,
timezone, limit and offset. Record preview additionally accepts `select` and
`group_by`. ODSQL clauses pass unchanged to the read-only provider. The adapter
checks supported parameters and numeric windows. Preview returns original
records, total count, pagination and receipt.

## One project through publication

`openOpendatasoftWorkbench()` is shared by the CLI and browser.

~~~js
import { openOpendatasoftWorkbench } from './engine.mjs';

const project = await openOpendatasoftWorkbench({
  directory: '/absolute/private/portal-product',
  create: true,
  origin: 'https://public.opendatasoft.com',
});

async function complete(started) {
  const operation = await started.completion;
  if (operation.state !== 'COMPLETE') {
    throw Object.assign(new Error(operation.error?.message), operation.error);
  }
  return operation.result;
}

try {
  const edition = await complete(project.importCapture(imported.manifestFile));
  const review = await project.edition(edition.id);
  const projection = Object.fromEntries(review.suggestions.map(field => [
    field.alias, {
      field: field.field, type: field.type,
      nullable: field.nullable, encoding: field.encoding,
    },
  ]));
  const source = await complete(project.saveSource(edition.id, {
    expectedCaptureSha256: review.manifestSha256,
    title: 'Open Data Inception', query: 'portals', projection,
  }));
  const publication = await complete(project.createPublication(source.id, {
    filters: ['country', 'portal_typology'],
    sorts: ['name', 'country'],
    order: [{ column: 'url', direction: 'asc' }],
    defaultLimit: 50, maxLimit: 250,
  }));
  const candidate = await project.publication(publication.id);
} finally {
  await project.close();
}
~~~

Suggestions examine every retained record: provider declaration, observed type,
null/empty counts, structured values and exact numbers. A saved source binds the
edition hash and explicit alias/field/type/nullability/encoding projection.

| Encoding | Behavior |
| --- | --- |
| `native` | Compatible string, safe integer, finite number or boolean. |
| `text` | Reviewed scalar text, preserving otherwise rounded numeric tokens. |
| `json` | JSON text retaining arrays, objects, nulls and exact numeric values. |

Thematic arrays and geographic objects use JSON projection. The original CSV
dataset uses an empty nullable cell for null; JSON projection preserves source
fields containing both actual nulls and empty strings.

Mutations return `{id, completion}`; capture additionally returns `editionId`.
Completion records its state and result. `status()` exposes editions, sources,
publications, exports, buyer requests and current operation. The project retains
the original publisher's plan, run, candidate, review and version IDs.

`reviewPublication(id,{expectedCandidateDigest,reviewer,note})` binds the reviewed
candidate. `publishDataset(id,reviewId)` invokes original version publication.
`recoverPublication(id)` reads the same durable outcome after interruption.

## Full edition review, notes and exports

`edition(id)` returns fields, suggestions, 20 sample rows, the source manifest and
notes. `editionRows(id,{offset,limit})` pages through every retained row.
Indices refer to the original zero-based source order.

`editionFacets(id,{field,limit,mode})` scans the full edition. Default `value` mode
counts exact source values; explicit `members` counts each array member once per
record. Strings remain whole in both modes. It returns total rows, distinct
values, missing/null counts and whether all values are shown.

`saveEditionNotes(id,{expectedCaptureSha256,expectedRevision,text,rowNotes})`
retains the edition note and `{rowIndex,text}` annotations. Notes use revision
comparison; an identical retry after a lost response resolves to the saved note
revision. Source bytes remain the same edition.

`compare(beforeId,afterId,key)` returns every added, removed and changed record,
unchanged count and schema changes. The key must exist and be unique. Use the
original `url` field for Open Data Inception.

`exportEdition(id,format,{geometryField})` returns
`{content,contentType,filename}`:

| Format | Complete contents |
| --- | --- |
| JSON | Every native record, source manifest/metadata/rights and all notes. |
| CSV | Every original field as a JSON value cell, plus annotation columns when present. |
| GeoJSON | Every record as a Feature with original properties, source details and notes. |
| HTML | Standalone full table, source/rights details and edition/row notes. |

CSV JSON-value cells preserve null, empty strings, arrays and exact numeric
tokens. Use JSON, HTML or GeoJSON for accompanying metadata.
For geographic export choose `geometryField: "location"`. Absent geometry stays
null; original latitude/longitude text stays in properties. Features carry the
original URL identifier and source row index.

## Merchant and customer receiving

The implementation composes these existing engines:

| Maintained component | Responsibility |
| --- | --- |
| `postgres/publisher/model.mjs` | Plans, extraction, candidates, review, publication and recovery. |
| `dataset-handler.mjs` | Typed CSV admission, filters, ordering, cursors and snapshots. |
| SF61 importer | Actual routes, payment selections and native input admission. |
| SF82 release store | Staging, activation, seller lifetime and rollback. |
| SF88 buyer handoff | Actual offer review and exact edition/query customer configuration. |

`exportMerchant(publicationId,{expectedCandidateDigest,payment,origin,path})`
packages the reviewed product. Use the actual public native payment configuration
and intended resource address. The result includes directory, manifest/handler
hashes, resource, dataset snapshot and retained source metadata.

The full package includes raw provider responses, source declaration,
plan/candidate/review, typed CSV, dataset configuration, OpenAPI, selections,
route bindings, original runtime and the manifest-bound [receiving guide](publisher/RECEIVING.md).
Relative handler imports support receiving on another host. The browser also
provides a companion guide with the exact package identities for older exports.

`stageMerchant(exportId,{expectedManifestSha256,releaseId,label,runtime})`
verifies and copies the whole package into the existing SF82 store before its
original stage operation. Runtime accepts the selected public facilitator URL,
loopback seller port and the original explicit local-facilitator option. The
browser exposes those same choices; an empty facilitator selects the original
offer-only service. The seller console owns activation and start/stop.
Saved releases remain usable after the original acquisition directory moves.

[RECEIVING.md](publisher/RECEIVING.md) gives the complete customer installation,
package inspection and staging, original release commands, offer and buyer
preparation, full dataset session and retained-source import. Its companion
download binds those instructions to the selected package and snapshot.

Direct exports in `publisher/release.mjs` are:

~~~js
exportOpendatasoftMerchantPackage(options)
inspectOpendatasoftMerchantPackage(directory, expectedManifestSha256)
stageOpendatasoftMerchantRelease(releaseRoot, options)
readOpendatasoftMerchantBuyerOffer(options)
prepareOpendatasoftMerchantBuyer(options)
~~~

`buyerOffer(exportId,{seller,query})` reads the running seller's actual offer.
`prepareBuyer(exportId,{seller,query,intentId,acceptIndex,offerSha256})` writes the
original SF88 configuration. The selected snapshot and query remain attached.
Customer acquisition, settlement, response retention, recovery and receiving use
the existing SF88 workflow described in the product guide.

The source license and attribution travel with each captured edition and
merchant package. Refresh is a new source capture, comparison, review and
publication through the same maintained engines.

