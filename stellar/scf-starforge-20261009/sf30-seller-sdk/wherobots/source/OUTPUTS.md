# Complete Wherobots output editions and receiving

This module joins the original Wherobots operator workspace. Native submission, reconciliation, status, logs, source listings and file downloads remain in `native.py` and `workflow.py`. `editions.py` inspects the complete captured output collection; `portable.py` preserves it for independent customer receiving.

## Original output contract

`create_edition(workspace, operation_id, datasets)` consumes the exact output definitions retained by the reviewed operation. Each dataset contains `dataset_id`, `definition`, `listing_object`, `complete: true`, and every original `files` entry. A file retains its relative path, SHA256/byte descriptor and provider receipt. All configured outputs must be present, including zero-row outputs. Auxiliary files such as `_SUCCESS`, `_metadata`, `_common_metadata` and commit markers remain in the edition with their original bytes.

The resulting edition has an immutable source binding derived from the original workflow, operation, native run, review and captured dataset descriptors. Repeating that exact input returns its original edition. A corrected source/run produces another edition; the first stays available. The root workflow retains the native status and original account/run association.

### Formats and exact interpretation

| Format | Reader behavior | Retained interpretation |
| --- | --- | --- |
| CSV | Complete multiline CSV records in each part; UTF-8, one reviewed delimiter and quote character. | Every scalar remains source text. Set `csv.header` explicitly. Headerless parts require `csv.columns`. A declared WKT/EWKT geometry column is inspected without changing source text. |
| NDJSON / JSON | Complete JSON object records, with duplicate property and invalid-number detection. | Every numeric token remains exact text, including integer size, exponent and decimal scale; null and absence stay distinct. |
| GeoJSON sequence | Native complete Feature records using observed newline or RFC 8142 record-separator framing. | Original Feature, properties, geometry and exact coordinate tokens remain intact. |
| Parquet | Real PyArrow footer and batch reader; every row group and row is read. | Original Arrow types/nullability, field metadata, file metadata, decimal scale, binary data and temporal ticks. |
| GeoParquet | The same complete Parquet decode, plus original `geo` metadata and WKB/native GeoArrow inspection. | Original geometry types, dimensions, coordinate envelope, embedded SRID and CRS metadata; no reprojection or axis change. |

An absent GeoParquet CRS denotes the format default OGC:CRS84; an explicit null denotes unknown CRS. An explicit PROJJSON object is retained as exact source JSON text. Geometry envelopes report observed coordinate minima/maxima in the original coordinate order. Mixed dimensions are reported and do not produce a misleading single envelope.

Example CSV output definition:

```json
{"id":"results","store":"my_files","path":"results/edition-1","format":"csv","csv":{"header":false,"columns":["id","total"],"delimiter":",","encoding":"utf-8"},"primary_key":["id"]}
```

WKT/EWKT inspection supports Point, LineString, Polygon, multipart geometries and GeometryCollection, with exact decimal coordinates, Z/M dimensions, EMPTY values and retained EWKT SRID. Raw text and source CRS remain distinct.

Optional `partitioning: "hive"` adds decoded path partition values only where the actual row has no field of that name. Configure a `geometry_column`, `geometry_encoding`, `crs` and `axis_order` when a non-GeoParquet format carries a separate geometry field. The retained source bytes remain available when a geometry encoding is undeclared.

## Rows, schema and comparisons

`edition_rows(workspace, edition_id, dataset_id, offset=0, limit=100)` returns the edition/run/source binding, total row count, requested page, next offset, complete column summary and preview encoding. The response already protects values that JavaScript would round:

| Original value | Preview representation |
| --- | --- |
| JSON number `1.200` | `{"$number":"1.200"}` |
| Parquet decimal | `{"$decimal":"1.200"}` |
| Integer beyond the JavaScript safe range | `{"$integer":"9007199254740993"}` |
| Binary | `{"$binary":"…","encoding":"base64"}` |
| Timestamp | `{"$timestamp":"exact integer ticks","unit":"ns","timezone":"UTC"}` |

Small integers, strings, booleans and null remain ordinary values. Nested objects and arrays are retained recursively. Original raw objects remain the source of every preview: an immutable SQLite index stores row locations, exact row hashes and optional complete key hashes. Reads verify the original object and row identities. The index and original objects are included in receiving.

`compare_editions(workspace, left_id, right_id)` compares every retained row of two editions in the same workflow. Matching reviewed keys produce complete added, removed, changed and unchanged counts, with original row locations. Without a shared key definition, a complete row multiset preserves duplicates and reports exact additions/removals. The report and complete change NDJSON are retained as objects and attached to the right edition using the original record revision control. The source binding stays unchanged.

Inspection uses bounded batches and a disk index. CSV/JSON records have a 32 MiB record budget. File size, object count and download limits remain the original workflow's receiving controls. PyArrow is imported only for Parquet/GeoParquet. The module uses the application’s declared dependency rather than another engine.

## Complete portable handover

`export_handover(workspace, workflow_id, destination: Path)` creates one ZIP64 handover containing:

- The original workflow, operation, capture and edition records, with their original revision identities.
- Every referenced source/script/run/log/listing/output/index/comparison object, following named internal object references and typed output-listing/reference manifests. Ordinary JSON data fields do not become object dependencies.
- Complete editable application source and requirements from the original source directory.
- An independent industrial-style HTML overview, exact per-file manifest, source links and receiving guide.

The archive inventory binds every member's length and SHA256; original object files use their content identity. ZIP members use deterministic timestamps. Repeating the same complete input can reuse the same destination only when its complete archive bytes agree.

`import_handover(workspace, source: Path)` verifies the complete archive and object closure before installing record changes. It retains the destination workspace identity and original workflow/operation/native run/capture/edition IDs. Objects are restored through the original immutable object store. Editable source is kept under the receiving operation. Repeating the same archive reuses records; a corrected handover from the same source can advance a record only when it still has the revision written by the prior receiving operation. Local customer edits are reported as conflicts before source records are installed.

Receiving saves its operation journal and original archive identity. An interruption can continue with the same archive and records. Source/configuration choices for future provider runs remain in the original operator; reading received data, source files, comparisons and previews requires no new provider run.

## Existing SF30 dataset handover

`export_dataset_handover(workspace, edition_id, dataset_id, destination: Path)` creates a complete CSV/configuration package for the existing SF30 loader where the complete output fits that engine. It retains exact text or lossless JSON, pairs every exposed value with `value`, `null` or `missing` state, and includes original source/run/part objects and mapping in `source.json`. The complete directory is installed atomically and subsequent reads verify its manifest.

The same original-object descriptors are exposed as `sourceFiles` for the maintained SF82 source reader. Its publisher copies and verifies every original source, listing, output part and run companion when staging the dataset release. `original_objects` keeps the receiving-oriented mapping in the same source manifest; both fields refer to the identical retained files.

The original SF30 limits apply: 64 physical columns (up to 32 value/state pairs), 1,000,000 rows, 256 MiB CSV, 1 MiB maximum cell text and its existing response byte budget. The full workflow handover remains available for larger outputs. The package's `dataset.json` is consumed by the maintained SF30 dataset loader, publisher and merchant composition; this module does not introduce another payment or dataset query implementation.

## Source standards

- [OGC Simple Feature Access](https://www.ogc.org/standards/sfa/): original simple-feature WKT and WKB geometry families.

- [GeoParquet 1.1.0](https://geoparquet.org/releases/v1.1.0/): root geometry columns, required metadata, WKB/GeoArrow representations and CRS defaults.
- [Apache Arrow ParquetFile](https://arrow.apache.org/docs/python/generated/pyarrow.parquet.ParquetFile.html): native metadata and complete row-group batch iteration.
- [RFC 8142](https://www.rfc-editor.org/rfc/rfc8142): GeoJSON text sequence framing.
