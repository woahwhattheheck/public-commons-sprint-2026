# Coin Metrics editions in the DuckDB workspace

Retain a permitted Coin Metrics export, inspect its original types, compare it with
another retained edition, and select the reviewed data for the existing DuckDB
query and merchant workflow. The same private workspace keeps source files,
catalog history, comparison decisions, prepared packages and receiving records.

This component extends the maintained [DuckDB workspace](../workspace/README.md).
The original query author, native reader, merchant compiler and server remain the
execution path. The [API reference](API.md) describes the complete manifest and
HTTP contracts.

## Start and reopen

Use Node 22.13 or later with native `node:sqlite` support and a Python interpreter
containing the maintained [DuckDB 1.5.6 dependency](../requirements.txt). From
`stellar/scf-starforge-20261009`, start an empty private Cloud workspace:

```sh
node sf30-seller-sdk/duckdb/workspace/cli.mjs \
  --state /absolute/private/coinmetrics-workspace \
  --cloud \
  --python /absolute/duckdb-environment/bin/python \
  --port 0
```

Open the private URL printed by the original server. Its existing workspace key
and local session apply to the Cloud pages, file uploads and downloads. A new
workspace has no source editions or customer records.

To reopen the same workspace, pass its same state directory and interpreter:

```sh
node sf30-seller-sdk/duckdb/workspace/cli.mjs \
  --state /absolute/private/coinmetrics-workspace \
  --python /absolute/duckdb-environment/bin/python \
  --port 0
```

Keep one server owner for a state directory. Stop it normally before another
process opens that same directory. An OS-held ownership lock protects the original
merchant store; process interruption leaves recoverable operation records.

## 1. Retain the selected source

Use **Cloud delivery** in the existing app. Import a local input manifest or create
an intake from a manifest and upload the exact files listed in it. The intake
records the declared file names, byte lengths and SHA-256 hashes before accepting
the source. Its upload list shows which files are already present, so reopening an
interrupted intake does not require another source acquisition.

An input manifest records:

| Field | What to supply |
| --- | --- |
| `transport` | `retained-s3`, `retained-snowflake`, `api-export` or `local-export` |
| `capturedAt` | The actual acquisition or export observation time |
| `provenance` | The selected source, acquisition identity and applicable entitlement/retention notes |
| `scope` | The actual market or asset/metric, frequency, selected interval and native parameter choices |
| `files` | Every selected original data, catalog and receipt file, with relative path, size and hash |
| `coverage` | The retained native listing/page/partition group, or the explicit selected-file population |

For each file choose its original family and role. Supported data families include
trades, candles, quotes, order-book snapshots/updates and reference rates. The four
reference families are assets, exchanges, pairs and markets. Keep catalogs as
catalogs and request/listing/query receipts as receipts.

Supported formats are Parquet, CSV, JSON, NDJSON and original Snowflake SQL API
JSON. A JSON file uses an explicit JSON Pointer such as `/data`; an empty pointer
selects a top-level array. CSV remains text unless its original column metadata
declares otherwise. An optional, explicit CSV `nullToken` identifies null cells;
an empty string remains a string.

A browser intake can contain up to 4,096 files, with at most 2 GiB per file and
8 GiB in total. Structured JSON files are limited to 32 MiB; a native relation has
a 1,000,000-row and 256-column ceiling. Select a coherent partition/window that
fits these declared limits. The original files remain downloadable after native
inspection.

### Keep native source coverage attached

The four Coin Metrics reference catalogs are overwritten daily. Every imported
edition here retains the bytes actually observed at that time. A later catalog is
a new edition; the app does not create earlier provider snapshots.

For S3, keep every actual listing page for each selected full prefix and every
listed object used by the edition. Native keys, bucket, ETag, size, version
metadata and continuation tokens bind the population. Object filenames are
opaque. A `dt` partition describes its source day; published job start times do not
establish that every output is present.

For Snowflake, keep the original statement handle, result-set column metadata,
partition indices and every result partition. The importer verifies the native
partition and total row counts. The separate maintained Snowflake source client
owns any live query execution.

For API input, keep the first original request and the complete returned
`next_page_url`/token chain. Candle and reference-rate coverage binds the native
endpoint and the exact declared market or asset/metric, frequency and interval.
The API's query timezone interprets its request time fields; response time remains
UTC. Set `scope.startInclusive` and `scope.endInclusive` to the actual request.
Manifest comparison defaults are inclusive start and exclusive end; native API
time queries default to inclusive boundaries. Nanosecond bounds are retained.

`selected-files` describes the exact retained files when a complete remote
listing/query/page population was not supplied. The app displays that scope beside
its row counts. A missing page or field does not remove a source record.

## 2. Inspect and compare editions

Open an edition to inspect its source inventory, native relation schema, original
types, retained coverage and source-linked sample rows. Numeric and timestamp
values remain exact strings in the browser. Null and absent fields remain distinct.
Nested JSON preserves numeric kinds, so a JSON number is not changed into a string.

Choose the left and right relations from the same data family, then save explicit
row keys and field mappings.

| Source meaning | Comparison choice |
| --- | --- |
| Exact market, asset or other native identifier | Text |
| Whole-number count or identifier represented numerically | Integer |
| Exact price, volume or other decimal value | Decimal |
| API ISO timestamp versus Cloud epoch timestamp | Timestamp, with an explicit unit for each side |
| Native boolean or explicit boolean text | Boolean |
| Structured native value | JSON |

Timestamp units are ISO, ns, us, ms or s. A file-specific UTC assertion applies
only to that file. Retained Cloud transports use their documented UTC time basis.
Choose decimal tolerances as exact nonnegative strings; zero requires equality.
Do not choose a tolerance merely to hide a scale, currency or timestamp-unit
mismatch.

All duplicate keys remain visible and ambiguous rows are not paired arbitrarily.
Findings distinguish left/right-only rows, different values, invalid keys and
duplicate populations. Their original file and row links remain attached. The
full comparison report is downloadable even when the app shows a paged view.

Keep deliberate omissions in the saved comparison with their side, field and
reason. The app displays the provider's documented Cloud omissions alongside these
choices: Cloud trades omit `mark_price`, `index_price`, `iv_trade` and
`liquidation`; the Cloud market catalog omits the documented pool/fee/address and
multiplier fields. An omission choice does not alter the raw source.

Save an accepted or changes-requested review with a useful note. A later correction
uses new source/mapping choices and a new comparison. Reopening a review retains
every earlier decision and the exact source identity it reviewed.

## 3. Select the reviewed data for the existing merchant

Choose the edition and native relations to use, attach the comparison if relevant,
and confirm the source selection. The app handles any unsaved original merchant
draft visibly before changing its source.

Selection compiles one immutable local DuckDB database through the original native
reader path. It therefore supports a complete selected partition with more than
the reader's 32 explicit Parquet-file inputs. Parquet values are inserted directly
through DuckDB with their original native types. File order and row order are
explicit, and every materialized row retains its original file/row lineage.

The `__cloud_row_lineage` table records original file IDs, one-based source rows,
present-column sets and zero-based materialized insertion ordinals. To join those
ordinals to an immutable data table, calculate
`row_number() OVER () - 1` in a complete-table subquery before filtering or joining.
An original source column named `rowid` remains untouched. The materialization
manifest supplies the same expression and checked lineage counts.

Continue in the original **Build a query**, **Query review** and **Merchant plan**
pages. Review actual relation/field choices, preview the native query, set the
operator's real route and payment configuration, save and prepare the original
merchant package. Earlier source declarations and prepared packages stay retained
when a later edition is selected.

Selecting data does not start a provider request or a buyer purchase. Runtime
launch and payment remain the original merchant's explicit configured operations.
A retained Community-data engineering example keeps its original terms and scope;
a licensed customer delivery uses that customer's selected permitted source.

## 4. Export, receive and reopen

Export the selected editions, comparisons/review history, source selection and
optional verified original merchant package. The complete private archive retains
the original source files and their hash inventory, typed inspection, decisions
and native selected database. It preserves the source-specific entitlement and
retention notes.

The receiving operator opens another original private DuckDB workspace and chooses
**Receive handover**. The archive intake retains its original filename and byte
length. The browser streams the selected File; the server computes and pins its
actual SHA-256 while receiving it. It then checks the archive member inventory,
source hashes, native inspection and original identities before importing them.

Reopen the intake to continue a missing upload or receipt. Use the same original
archive bytes and the same intake; conflicting bytes are rejected. No whole-file
JavaScript ArrayBuffer is required for a large handover.

Received editions keep their original identities. Existing matching records are
reused and conflicting identities are not overwritten. The receiving merchant
source remains a deliberate selection, so the operator can inspect the incoming
data and decisions before adopting it. To return to an older reviewed edition,
select that retained edition through the same workflow.

## Recovery and integration

Every mutation has an original operation ID and an exact saved request. After a
lost response, retry that operation instead of inventing a new import, comparison
or export. The app retains interrupted request identities and shows resumable
uploads. A completed native result is reused; local inspection, materialization
and archive work resume from their retained operation state.

HTTP routes live in the original `duckdb/workspace/server.mjs`. The Cloud model
shares the maintained workspace's SQLite store and owner. There is no separate
Cloud service process or authentication system. Shutdown drains the original
server and its owned native operations.

Use [API.md](API.md) for exact input schemas, routes, response shapes, revision
checks and error contracts. Original native provider requests and paid buyer
recovery remain with their existing source/merchant/customer components.

## Primary contracts

- [Coin Metrics Cloud Delivery](https://docs.coinmetrics.io/access-our-data/cloud-delivery)
- [Coin Metrics Amazon S3](https://docs.coinmetrics.io/access-our-data/cloud-delivery/amazon-s3)
- [Coin Metrics Snowflake](https://docs.coinmetrics.io/access-our-data/cloud-delivery/snowflake)
- [Coin Metrics API v4](https://docs.coinmetrics.io/api/v4/)
- [Coin Metrics market candles](https://gitbook-docs.coinmetrics.io/market-data/market-data-overview/market-candles)
- [Coin Metrics Community data](https://docs.coinmetrics.io/packages/coin-metrics-community-data)
- [DuckDB insertion-order guarantees](https://duckdb.org/docs/current/sql/dialect/order_preservation)
