# Coin Metrics Cloud Delivery in the original DuckDB workspace

Working interface for the original provider/core and operator UI owners. The maintained
workspace remains the sole process owner, authenticated HTTP service, merchant draft
store, query author and package/runtime controller.

## Source and ownership

- Repository: `woahwhattheheck/public-commons-sprint-2026`.
- Branch: `scf/coinmetrics-cloud-workspace-26b1`, initially main
  `b9d40f9f99a99ec0aec1e9211536f7fc7adab597`.
- Shared authoring root: `/dev/shm/26b1-coinmetrics/source/stellar/scf-starforge-20261009`.
- New core: `sf30-seller-sdk/duckdb/cloud-delivery/`.
- Original host: `sf30-seller-sdk/duckdb/workspace/{model,store,server,cli}.mjs`.
- Root owns `cloud-delivery/public/{app.mjs,style.css}` and original
  `workspace/public/{app.mjs,index.html,style.css}` UI joins. Core owner owns host joins.
- The seven shared files are independent writable copies. Other runtime dependency
  files are hardlinks and must be atomically replaced if an actual change is needed.

## Host and client convention

The original private workspace key, `x-duckdb-workspace`, origin validation, mutation
serialization and close/drain behavior apply to every route below. No extra listener
or account is created. GET state is `/api/cloud/state`; the same value is also under
`cloud` in the ordinary `/api/state` response. Errors retain original
`{status,error,message}` and HTTP status conventions. Mutations return their actual
result and current `revision` where applicable. The UI should refresh the cloud state
after a completed action. Operation IDs use the existing original lower-case
`[a-z][a-z0-9-]{7,79}` contract. A retry retains the exact operation ID and payload.

### State

```json
{
  "schema": "stellar-forge.coinmetrics-cloud-workspace.v1",
  "revision": 0,
  "editions": [],
  "comparisons": [],
  "deliveries": [],
  "selection": null,
  "contracts": {
    "families": [],
    "catalogFamilies": ["reference_data_markets", "reference_data_assets", "reference_data_exchanges", "reference_data_pairs"],
    "cloudOmissions": {},
    "notes": []
  }
}
```

Edition summaries include `id`, `label`, `transport`, `capturedAt`, `createdAt`,
`state`, `manifestSha256`, `files`, `bytes` (decimal string), `families`, `coverage`,
`inspection`, `error`. States are UPLOADING, INSPECTING, READY, INTERRUPTED, FAILED.
READY means the selected original files were retained and inspected; completeness
is the separate `coverage` result. No received date is promoted to a dataset date.

`inspection` has `engineVersion` and `relations`, each with `id`, `family`,
`name`, `format`, `rows` (decimal string), `files` (source file IDs), `columns`
(`name`, original native `type`, `nullable`), and up to five `sample` rows.
Sample cells retain `{type,value}`; integers, decimals and timestamp values remain
strings, null stays null, and native floating values retain their hexadecimal value.

### Edition intake

`POST /api/cloud/import` accepts
`{operationId,expectedRevision,manifestPath}` for an existing local source packet.
The packet's file paths are relative to its own directory. No network is called.

For browser-selected files, `POST /api/cloud/intake` accepts
`{operationId,expectedRevision,manifest}`. It returns an edition with
`uploads:[{id,name,bytes,sha256,present,url}]`. The original selected bytes go to each
URL using PUT, `application/octet-stream`, the original workspace key and exact
Content-Length. Uploads are create-only and are accepted only after their declared
length and SHA-256 match. `POST /api/cloud/commit` with `{editionId}` finishes the
same intake, inspects the native data, and returns the retained edition. An
interrupted local commit can continue against the same immutable file set.

`GET /api/cloud/edition?id=ID` returns the full retained edition, including the
manifest, source file identities, listing/query/page completeness and native columns.
`GET /api/cloud/file?edition=ID&file=ID` downloads an original selected file.

### Input packet

```json
{
  "schema": "stellar-forge.coinmetrics-cloud-input.v1",
  "label": "Operator's actual source selection",
  "transport": "retained-s3",
  "capturedAt": "2026-10-12T00:00:00Z",
  "provenance": {"description": "Actual permitted source and acquisition", "entitlement": "Operator supplied rights/retention note"},
  "scope": {"market": "ACTUAL_NATIVE_MARKET", "frequency": "1h", "start": "2026-10-04T00:00:00Z", "end": "2026-10-11T00:00:00Z"},
  "files": [
    {"id": "source-file-01", "path": "original/data.parquet", "bytes": "123", "sha256": "64 lowercase hex characters", "format": "parquet", "role": "data", "family": "market_candles", "origin": {"key": "Actual complete S3 key", "etag": "Actual ETag", "versionId": null}},
    {"id": "listing-page-01", "path": "original/listing.json", "bytes": "123", "sha256": "64 lowercase hex characters", "format": "json", "role": "receipt", "family": "market_candles", "origin": {"prefix": "Actual full listed prefix", "continuationToken": null}}
  ],
  "coverage": {"kind": "s3-listing", "groups": [{"family": "market_candles", "prefix": "Actual complete prefix", "pages": ["listing-page-01"]}]}
}
```

Transports: `retained-s3`, `retained-snowflake`, `api-export`, `local-export`.
File formats: `parquet`, `json`, `ndjson`, `csv`, `snowflake-json`.
Roles: `data`, `catalog`, `receipt`. The four reference families use role catalog.
JSON data uses explicit `rowsPath` (JSON Pointer, empty means the top-level array).
CSV preserves text unless explicit `columns:[{name,type}]` native metadata is supplied.
Snowflake SQL result files preserve `resultSetMetaData`, partition index/statement
handle and native `rowType`; no paid query is executed by importing an export.

Coverage kinds: `s3-listing`, `snowflake-query`, `api-pages`, `selected-files`.
The first three bind original receipt/page file IDs; the core derives completeness
from those original pages, their continuation/partition identities and the retained
files/row counts. `selected-files` deliberately describes only those exact files.
Missing listing objects or pages remain visible and cannot imply withdrawal.
The S3 reader never sets RequestPayer; this workflow does not acquire requester-pays
data. Existing permitted exports can still be retained and compared.

### Comparison and review

`POST /api/cloud/compare` accepts:

```json
{
  "operationId": "comparison-actual-id",
  "expectedRevision": 1,
  "leftEditionId": "edition-left",
  "rightEditionId": "edition-right",
  "leftRelationId": "actual relation ID",
  "rightRelationId": "actual relation ID",
  "family": "market_candles",
  "keys": [{"left": "market", "right": "market", "kind": "text"}, {"left": "time", "right": "time", "kind": "timestamp-ns"}],
  "fields": [{"left": "price_close", "right": "price_close", "kind": "decimal", "absoluteTolerance": "0", "relativeTolerance": "0"}],
  "omissions": [],
  "note": "Deliberate cohort and field choices"
}
```

The UI can offer source-name defaults from inspected columns. The submitted choices
are exact saved choices. Types: text, integer, decimal, timestamp-ns, boolean, json.
Keys must be non-null and unique for ordinary matching; all duplicates remain
findings. Decimal tolerances are exact nonnegative strings, default zero. Original
native floating representation is retained; no invented decimal precision or rates.
`omissions` entries are `{side:'left'|'right',field,reason}` and are shown alongside
the provider's documented omissions. No omission removes a raw source field.

The result summary includes `id`, `state`, `revision`, `request`, `requestSha256`,
`counts:{leftRows,rightRows,matched,leftOnly,rightOnly,different,duplicateLeft,duplicateRight}`,
`schemaChanges`, `coverage`, `findingsCount`, `reportSha256`, `review`.
`GET /api/cloud/comparison?id=ID&offset=0&limit=50` returns summary plus a page of
source-linked findings; full result is downloadable separately.
`POST /api/cloud/review` takes
`{operationId,expectedRevision,comparisonId,expectedReviewRevision,decision,note}`.
Decisions are accepted, changes-requested, reopened. Notes and every review revision
persist; reopening never rewrites the earlier comparison or original source.

### Original merchant source selection

`POST /api/cloud/select` takes
`{operationId,expectedRevision,editionId,relationIds,comparisonId?,note}`.
The selected immutable edition is materialized into one local native DuckDB database,
preserving original types, and a declaration accepted by the original reader. This
avoids truncating a complete multi-file partition to the reader's 32-file limit.
The original workspace's retained source pointer changes atomically under its one
owner; earlier saved source declarations and prepared packages stay intact.
The result includes `selection:{editionId,relationIds,sourceSha256,sourceFile,materializationSha256,selectedAt}`
and the Cloud revision. Refresh the original `/api/state` after this result to receive its current source and merchant state.

The root UI then uses the existing Build a query / Query review / Merchant plan /
Prepare / Inspect / runtime journey. The cloud core adds no alternative seller or
payment flow. Unsaved merchant edits must be handled visibly before changing source.

### Delivery and receiving

`POST /api/cloud/export` takes
`{operationId,expectedRevision,editionIds,comparisonIds,packageId?,note}` and returns
`{id,sha256,bytes,filename,url,manifest}`. The private archive carries original source
files, full comparison/review history, selected native source and, if supplied, the
unchanged original verified prepared merchant package. Data rights/retention notes
and actual coverage travel with it; export does not grant additional rights.
`POST /api/cloud/receive` takes `{operationId,expectedRevision,archivePath}` and
validates and imports the same source/comparison identities into the original local
workspace, preserving origin lineage and refusing conflicting existing identities.
Browser receiving uses the same declared-file intake/upload route for the archive.
`GET /api/cloud/delivery?id=ID` downloads the complete private archive.

The existing source pointer/merchant draft remains a deliberate selection on receive.
No provider, payment, acquisition or former unknown-outcome operation is replayed.


### Streaming browser handovers and native recovery

Archive intake accepts `{operationId,expectedRevision,archive:{name,bytes,sha256?}}`.
Only the archive SHA is optional. Original source-file SHAs remain mandatory.
Upload the native browser File to the returned PUT URL; the original server hashes
the stream, pins the actual bytes and digest in its private intake record, and
returns that digest. A repeated upload must contain exactly the same complete
bytes. `GET /api/cloud/intake?id=ID` returns the retained archive description and
resumable `uploads[]`; `state.archiveIntakes` supports reopening it.
Receive using `{operationId,expectedRevision,intakeId}`. Every archive member,
original source hash, typed inspection and original record identity is verified.
No browser-wide ArrayBuffer or second source acquisition is required.

`GET /api/cloud/delivery?id=ID` streams archive bytes.
`GET /api/cloud/delivery?id=ID&kind=summary` returns `{delivery}` metadata.
Intake/import/commit return `{edition,uploads?,revision}`; compare/review return
`{comparison,revision}`; export/receive return `{delivery,received?,revision}`.

CSV may declare an explicit `nullToken` in each file descriptor. Only that exact
cell value becomes null; an empty string remains a string. Nested JSON numeric
lexemes retain their number kind and complete value, including inside arrays and
objects. Samples may mark a large cell `truncated` with its original byte count
and SHA; raw source and comparison values remain complete.

Timestamp mappings support per-side `leftTimeUnit` and `rightTimeUnit` of
`iso`, `ns`, `us`, `ms`, or `s`. A file-specific UTC declaration applies only
to that file. Comparison `scope` records actual mapped time bounds, rows outside
the declared interval, and observed gaps against an explicitly declared frequency.
Intervals default to an exclusive scope end; set `scope.endInclusive:true` when
that is the actual source request. These observations do not fill or synthesize rows.

Text-source materialization retains present-column and original row identity in
`__cloud_row_lineage`, keyed by table name and the immutable table's native rowid.
This keeps absent fields distinguishable from SQL null values. Parquet columns
keep their original native types and their complete original file inventory.

Native work has one OS-released SQLite ownership lock per retained operation and
immutable attempt inputs/results. A failed or interrupted local attempt can resume;
a completed result is reused. Prepared database publication and export snapshots
are recoverable without changing the original source, review or delivery identity.
