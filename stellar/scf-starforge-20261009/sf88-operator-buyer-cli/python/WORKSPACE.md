# Customer data-analysis workspace

For complete query files beyond an analysis preview, use the **Exports** tab
and the [complete query export workflow](WORKSPACE_EXPORTS.md). It joins the
original reviewed query, native streaming writer, cancellation, retained file
downloads and portable reopen in this same workspace.

Use an acquired dataset in a local browser, keep saved analyses and their actual results, and reopen the complete analytical database after restart. The workspace uses the original Python `DatasetAcquisition`, `DatasetDelivery` and `DatasetDatabase`. It imports completed native deliveries; it does not execute an acquisition or financial operation.

The Data tab selects original deliveries, reviews retained versions and scalar types, downloads the original manifest, and selects the version served by a named SQL view. The Changes tab compares acquired versions, retains complete row/schema differences and applies an explicitly reviewed candidate. The Analysis tab saves parameterized SQL and its revisions, executes it against a reviewed selection, pages retained results and exports JSON or CSV. Activity reopens imports, analyses and consistent database backups.

## Start with a completed original acquisition

Use Python 3.11+ and install this source's Python package beside its matching full native Node runtime. The workspace modules and their browser assets are included by the existing Python package definition; there are no new dependencies.

```sh
python -m pip install --no-deps ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /path/to/public-commons-sprint-2026 \
  source --name inventory \
  --session /private/customer/inventory-acquisition \
  --room /private/customer/inventory-data-room

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /path/to/public-commons-sprint-2026 \
  serve --open
```

Use the existing session produced by [the original dataset application](DATASETS.md). `source` registers its native identity and the hash of its immutable `session.json`. It inspects the original session without running a page. `--room` selects its existing SF100 room; omitting that option chooses a private destination inside this analysis directory. The source alias, exact native paths, source revision and observed acquisition status are saved in the database. The browser uses those declared aliases and does not accept arbitrary source paths.

`serve` binds to `127.0.0.1` and chooses an available port. `--open` opens the private capability link in the local browser. For a remote terminal, read the URL from the private `analysis-launch.json` inside the selected database directory using your existing secure local browser/port-forward setup. The ordinary startup line contains the address and control-file path. Capabilities change at every server launch; open the new private link after restart.

The listener enforces its exact Host and Origin, same-origin browser requests and a capability header for every data operation. It is a local operator application, not an Internet-facing hosted service. Its assets contain no database contents or capability. Python's [HTTP server](https://docs.python.org/3/library/http.server.html) is the local transport.

An already built earlier Python wheel keeps its original source identity. Use a cumulative companion wheel that contains this source, or the source installation above. The workspace's matching Node runtime is needed only when registering or importing original acquisitions.

## Import and select data

1. Select the registered source on **Data**. Choose **Import original delivery**. An incomplete acquisition is rejected; complete sessions are opened through the original native exporter. A previously finalized SF100 room is reused.
2. Inspect the resulting imported version. Its row count, snapshot, table, exact original manifest digest and per-column JSON types remain visible. **Download original manifest** returns the stored original bytes, without JSON re-encoding.
3. Enter a SQL view name such as `inventory` and choose **Select for this view**. The action uses the displayed current revision. A stale selection is rejected without changing the view.
4. Use **Query** beside a current view, or **Query this immutable table** on a selected version, to begin an analysis.

Import does not change an existing SQL view. The exact same native delivery and mapping reuse its existing immutable table. An optional column-mapping JSON object maps original field names to SQL names:

```json
{"units":"available_units"}
```

That creates a separate mapped edition of the same delivery, retaining the original edition. It is not a new merchant snapshot or another purchase. Select its version explicitly before using it through a current view. Each row keeps its original ordering column `_sf_row_number`; scalar handling and identifier rules are described in [SQLITE.md](SQLITE.md).

To select a different native acquisition for an existing source alias, stop this workspace and register it with `source --expected-revision N`. The existing source revision is in Data and in `status`. Re-registering the same paths and immutable session is unchanged. Earlier imported data remains available. Use a different room for a different acquisition; original SF100 identity checks apply when a destination already exists.

## Save and use an analysis

For the original inventory example, whose `available` field is a native Boolean and whose `units` field is an integer:

```sql
SELECT SUM(units) AS available_units, COUNT(*) AS available_skus
FROM inventory
WHERE available = :available;
```

Parameters:

```json
{"available":true}
```

Name the analysis `available_inventory` and choose **Save analysis**. SQL and parameter text are retained as an immutable revision. The editor can load a previous saved revision; its next save uses the current head revision displayed in the editor. Changes made by another client are detected before replacement. Unsaved editor contents are retained in this browser's local draft, and data refresh does not replace them.

**Run analysis** records the exact SQL, parameters and reviewed current-view identities before dispatch. The original `DatasetDatabase.query` reads those view identities and the returned rows in the same SQLite transaction. If a current view changed since review, the operation fails with `DATASET_SQL_VIEWS_CHANGED`. Refresh, review the new selection and run explicitly. SQLite's [transaction isolation](https://www.sqlite.org/isolation.html) keeps the accepted query's selection consistent while another client later activates a view.

The retained result includes the actual transaction's view revisions and physical read tables. It remains associated with that execution when views, saved queries or the editor subsequently change. Opening or exporting a result never reruns SQL. Parameter text is parsed by Python, so the browser does not round a signed 64-bit integer parameter before SQLite receives it. Boolean parameters bind as the ordinary SQLite `0`/`1` values.

Default maximum rows is 1,000, adjustable to 100,000. The workspace also limits each query to 4 MiB of returned scalar values and 20 seconds. Results record truncation explicitly. Browser pages contain at most 100 saved rows. Invalid SQL retains its SQLite diagnostic in the failed activity record and leaves previous successful results intact. The original read-only authorizer prohibits database writes, attached databases and file/extension functions.

### Result exports

**JSON** exports ordered columns and native scalar rows, plus the exact executed request, view bindings, read tables and retained result identity. Signed 64-bit integers are emitted as their exact JSON number text. Binary values use an explicit base64 envelope; a non-finite real produced by an SQL expression uses an explicit `sqlite-real` envelope because JSON cannot encode it as a number.

**CSV** exports every retained row, including rows beyond the currently visible browser page, with ordinary CSV quoting and the saved column order. Nulls become empty fields; binary values are base64. The JSON result retains their type information. CSV does not rerun the query and does not infer payment or settlement from data values.

The browser displays typed textual cells so JavaScript does not round large SQLite integers. `result_sha256` identifies the canonical retained typed result, including its original data selection; it is checked when that result is reopened. It is not the hash of the separately formatted JSON or CSV download.

## Review a candidate before changing a current view

The **Changes** tab compares two original imported editions. Use it for a newly acquired snapshot, a different acquired query, or a separately mapped edition. Both source identities remain visible. A narrower category filter can remove rows from an acquired result, and a changed projection can remove a column without changing the source records.

1. Keep the baseline selected for a current SQL view such as `inventory`.
2. Import and select the candidate in Data. Choose **Review changes against a current view** and select the baseline view. The displayed view name, version and revision remain the baseline for this comparison; refresh does not silently replace them.
3. Choose 1–16 SQL columns that uniquely identify each row and are present in both editions, such as `sku` or a composite key. The interface preselects a conventional `id`, `sku` or `record_id` column when present. The complete comparison verifies it: a null or duplicate key rejects the operation with its side and original row number.
4. Choose **Compare every row**. Inspect added rows, removed rows, changed fields and rows whose only difference is position. Open a row to see all baseline and candidate fields with retained scalar types. Missing fields and null values are different. Original filters, ranges, ordering, projected fields, snapshots and manifest identities are shown together.
5. Enter a review note and choose **Select reviewed candidate**. Original view activation and the comparison's selection record commit in the same SQLite transaction using the exact reviewed revision. A changed current view cannot be overwritten by an older comparison; load its current selection and compare again.
6. Choose **Query current view** to continue with the original saved-analysis editor. Existing SQL drafts keep their ordinary discard confirmation, and earlier query results keep their own actual data selection.

Comparison traverses every row in both original immutable SQL tables. It retains all added, removed, changed and order-only records in the original database. Unchanged rows stay in their original tables and contribute to the complete counts and observation hashes. Position changes on rows with changed fields contribute to the separate reordered-row count. Column additions/removals and changes in original JSON type declarations remain visible even when there are no row differences. Browser pages hold at most 50 differences and normally at most 4 MiB of records; one larger complete record is never split.

Matching and field comparison use the original database's typed SQL scalars. Integers and reals remain distinguishable, signed 64-bit integers reach the browser as exact text, and a missing projected column differs from SQL null. The original importer represents JSON Booleans as SQLite `0`/`1`; original JSON type declarations remain in the schema comparison. The comparison does not reconstruct a per-row Boolean distinction that the original SQL representation did not retain.

A comparison has a 120-second execution budget and a 128 MiB budget for retained typed difference records. It either completes every source row or fails and rolls back the report; it never presents a sample or truncated comparison as complete. Difference rows and the COMPLETE activity status share one commit. Restart marks interrupted work explicitly; earlier imported versions and completed comparisons remain usable.

### Retained review exports

**Prepare JSON report** writes the complete report, original edition metadata, exact retained selection (if any) and every typed difference. **Prepare CSV differences** writes one `comparison` metadata row followed by `difference` rows for individual fields. Every CSV row carries comparison/report, baseline/candidate version/manifest and review identities. The metadata row includes the acquired query scopes, counts, schema changes, matching keys and review, so a comparison with zero row differences still carries its source identity. Type columns distinguish missing fields, null, integer, real and string values.

Exports are file-backed and streamed from retained SQLite records. Each request binds the exact completed report and selection. If a report is selected while an older export request is waiting, that request fails instead of silently substituting the new review. A new export action uses the newly displayed review. Activity retains the complete file's path, byte count and SHA-256. Download verifies and streams the same private descriptor. Browsers with the file-save API write the response stream directly; other browsers download files up to 64 MiB, with larger complete files available at their displayed local paths.

The comparison and selected-review records are in the original database backup. Standalone exports are not copied into that database. After recovery, reopen the comparison and prepare its export again: it reproduces the report without a Node runtime, acquisition directory, wallet or network. An older export job retains its original location and cannot download a file from the previous workspace path.

For embedding, `workspace.changes.page(comparison_id)` returns the report, selection, current view and `selection_sha256`. Dispatch a comparison using the original background interface:

```python
import uuid

request = {
    "id": uuid.uuid4().hex,
    "view": "inventory",
    "expected_revision": reviewed_view["revision"],
    "base_version_id": reviewed_view["version_id"],
    "candidate_version_id": candidate["version_id"],
    "keys": ["sku"],
}
job = workspace.start("compare", request)
# Reopen workspace.job(job["id"]) until COMPLETE, FAILED or INTERRUPTED.
# Repeating the same request ID/content returns that original job.
```

After completion, call `workspace.changes.select(job_id, {"id": uuid.uuid4().hex, "result_sha256": report["result_sha256"], "note": "Reviewed category selection"})`. An identical selection request returns its retained result; a different request cannot overwrite it. For an export, pass `comparison_id`, `result_sha256`, the page's `selection_sha256`, `format` (`json` or `csv`) and a new `id` to `start("change-export", request)`. `workspace.changes.history(before=..., limit=25)` and `page(..., kind="removed", after=0)` reopen reports beyond the latest activity page. Start a changed comparison/filter at `after=0`; its returned cursor belongs to that selection.

## Compose and publish a customer report

**Reports** turns saved analyses into an ordered customer document. It uses the
same acquired editions, saved SQL recipes, typed rows and database backup.

1. Save the analyses you need in **Analysis**. A query can be used more than once
   with different effective parameters.
2. Open **Reports**, name the report, and add its title and introduction. Add up
   to twelve sections; select each saved query and its exact revision, write its
   title/context, review the SQL, and set its parameters. Move sections into the
   intended reading order.
3. Save the definition. Query revisions are pinned: later edits in **Analysis**
   do not silently alter this report. **Load current query revision** explicitly
   adopts a changed recipe before the next definition save. Unsaved report
   authoring survives a browser refresh in this workspace's local draft.
4. Review **Current data selection** and run the saved report. All sections use
   one original SQLite read transaction, including their physical tables and
   selected views. A data selection changed before execution requires a fresh
   review. A subsequent selection cannot change the retained result.
5. Inspect each complete table, its original acquisition scope and any original
   comparison decision that selected the working edition. That decision's note,
   original query/projection and comparison/selection IDs follow the report.
6. Add a review/handover note and **Publish this report edition**. This retains a
   named edition inside the private workspace. It does not send it to anyone.
   Competing publication edits compare the current revision; **Refresh report
   state** loads the actual current publication before a new attempt.
7. Prepare **printable HTML**, **complete JSON**, or the **CSV bundle**, then
   download the resulting file. Publication history reopens earlier editions
   independently of later report definitions, data selections and reviews.

A report does not publish a silently shortened query result. If any section
reaches its saved row ceiling, the 4 MiB raw-value ceiling or the original
20-second query deadline, the whole run fails and leaves earlier reports intact.
Choose a more specific query or increase its saved row limit (up to 100,000)
before explicitly adopting that query revision. A complete report allows at most
60 seconds of query work and 32 MiB of encoded table rows. No partial report
becomes a publication.

The HTML is a complete offline document with print styles, typed table values,
narrative, original data scope and query details; it loads no scripts, fonts or
remote assets. JSON contains every table with the same exact integer/string,
NULL and binary encodings used in the analysis workspace. The CSV ZIP contains
one ordinary CSV per section, complete `report.json`, printable `report.html`
and a short index. The original positional columns are preserved even when SQL
uses duplicate column labels. CSV represents both NULL and an empty string as
an empty field; the typed JSON retains their distinction.

Publication/result IDs, original data selection and reviewed source scope remain
inside every complete export. Files are generated and downloaded incrementally;
the browser uses its file-save stream where available and otherwise permits
downloads up to 64 MiB. An export can be up to 128 MiB. The customer decides how
to share the private report. Absolute acquisition and database paths are not
included in its dataset source metadata.

### Use the same report workflow from Python

Use the original `AnalysisWorkspace` while its browser server is closed. Its
existing process lease prevents two workspace job owners from running together.
The following example assumes `available_inventory` revision 1 was already
saved against the customer's imported data:

```python
from uuid import uuid4
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

workspace = AnalysisWorkspace("/private/customer/analysis")
try:
    definition = workspace.reports.save("inventory_review", {
        "id": uuid4().hex,
        "expected_revision": 0,
        "title": "Acquired inventory review",
        "introduction": "Review the exact acquired query and selected edition.",
        "sections": [{
            "title": "Available inventory",
            "note": "Availability uses the retained source's declared values.",
            "query_name": "available_inventory",
            "query_revision": 1,
            "parameters_text": '{"available": true}',
        }],
    })
    pinned = workspace.reports.definition(
        definition["name"], revision=definition["revision"])
    job = workspace.start("report", {
        "id": uuid4().hex,
        "name": definition["name"],
        "revision": definition["revision"],
        "definition_sha256": pinned["sha256"],
        "expected_views": workspace.database.view_bindings(),
    })
    # Poll workspace.job(job["id"]) for COMPLETE, then inspect:
    # workspace.reports.result(job["id"], section=0, offset=0)
finally:
    workspace.close()  # waits for its existing background worker
```

`reports.publish(job_id, {id, result_sha256, expected_revision, note})` retains
a reviewed edition. `reports.publications(name=...)` returns its exact
`publication` and `sha256`; pass those to
`workspace.start("report-export", {id, publication_id, publication_sha256,
format})`, where format is `html`, `json`, or `csv`. The original
`report_export_file(export_job_id)` returns the retained file and byte/digest
metadata. `reports.history`, `reports.result`, `reports.definition` and
`reports.publications` reopen the same source, tables and history used by the
browser.

Definition saves, publication requests and background jobs retain their request
IDs. Retry an uncertain request with the same ID and unchanged content; its
original record returns even if today's definition or publication has advanced.
Use a new ID for a deliberate new action. Publication changes never change a SQL
view or start a purchase.

Reports and publications live in the original database backup, including all
typed rows and the source decisions. After restoring that database in a new
private directory, reopen the existing publication and prepare its export again.
This regenerates the same report from retained rows; it does not re-run SQL or
acquire data. Old export jobs retain their original directory identity and
cannot be used to read another workspace's files. The single workspace owner
cleans only its own incomplete `.reports-*` staging files at startup.

## Back up and reopen

Choose **Create database backup**. The original SQLite backup operation creates a consistent copy containing the imported rows, exact original manifests, current views, activation history, registered source descriptions, saved query revisions, complete comparisons and selections, and retained analysis results. The completed action gives its local path, byte count and SHA-256. Files of at most 256 MiB can also be downloaded from the browser; larger backups remain complete at the displayed local path. Download rechecks the recorded digest.

The native backup directory is create-only and unique for that action. To reopen a copied backup, keep its file named `datasets.sqlite3` in a private directory and start the same workspace there:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/restored-analysis \
  serve --open
```

Omit `--checkout` to use retained data and analyses without any Node runtime, source acquisition directory, wallet keys or network access. Old source aliases remain recorded, but imports are disabled in that invocation. Backup copies do not copy external acquisition/room files, native financial state, or previous standalone backup files. Those original products retain their existing recovery mechanisms. A backup captures its own in-progress job record; opening the copied database marks that record interrupted, without replaying it. All committed analytical data and earlier completed results remain usable.

One process owns background work for each analysis database. A second workspace process cannot recover a live process's jobs. An abrupt stop rolls back an incomplete SQLite transaction; on the next open, unfinished work is marked **INTERRUPTED**, and no job is automatically dispatched. If an import committed before its activity record was finalized, explicitly importing the same original delivery reuses the retained version. Completed results are committed atomically with their completion state.

The read-only status command is available while the browser process is running:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis status
```

For embedding, import `AnalysisWorkspace` and `serve` from `stellar_forge_buyer.analysis_workspace`. The controller exposes `register_source`, `save_query`, `saved_query`, `start`, `job`, `export_result`, `state` and `close`. `serve` returns the standard server, private control-file path and local capability URL. Call `server.server_close()` and `workspace.close()` after stopping the server; ordinary shutdown waits for its already dispatched analytical work.

The original standalone database API remains available. `DatasetDatabase.view_bindings()` returns the current view identities; pass that list as `expected_views` to `query` when a caller has reviewed them. `QueryResult.views` and `QueryResult.read_tables` identify the actual read transaction. `manifest_bytes(version_id)` returns the verified original manifest bytes, while the existing `manifest()` returns its parsed object.


## Use retained API responses in the same customer database

The **API responses** tab connects original JSON, CSV and typed stream results
to the existing Data, Changes, Analysis, Reports and Backup workflow. It reads
retained files; it does not send a provider request, create a quote, authorize
payment, finalize accounting, or acquire another page.

The local operator registers the original source before starting the server.
The browser uses that source's name and registration revision and never submits
a filesystem path. Use a distinct name for each response you want to retain.

### Register an original response

An existing SF88 buyer response uses the same original configuration and result
record that the original **read_retained_response()** accepts:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis --checkout /private/stellar-forge \
  response --name regional_sales --input-kind buyer --format json \
  --config /private/buyer/config.json --result /private/buyer/result.json
~~~

For CSV, use **--format csv**. A standalone original SF31 response-file writer
can instead use **--input-kind sf31**: **--config** is its exact response-file
writer options object, including destination and maxBytes, and **--result**
is its returned SAVED receipt, including path, bytes and SHA-256. Both remain
private local files. An incomplete stream uses the original typed export
described below; a partial file is never relabeled SAVED by this command.

An original native MCP result keeps its original quote and invocation binding:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis --checkout /private/stellar-forge \
  response --name paid_sales --input-kind mcp \
  --manifest /private/mcp-buyer/results/ORIGINAL_QUOTE_ID.meta.json
~~~

This calls the original McpResultStore in read-only mode and consumes its
original file(quote) / VerifiedFile interface. It opens no quote database
and makes no recovery or purchase call. The source manifest keeps the original
quote ID, invocation hash, native result classification and recorded payment
response. A server-confirmed payment remains that original classification; an
analytical import does not add a settlement or independently verify one.

An existing Python StreamDelivery needs no checkout or Node process:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis \
  response --name game_records --input-kind stream \
  --stream-export /private/buyer/stream-exports/ORIGINAL_REQUEST_SHA
~~~

Register the complete original export directory containing manifest.json,
source.json and records.jsonl. This binds the original export request,
original response identity and completion state, then uses the original
StreamDelivery.records() reader. NDJSON values and SSE event framing stay
native. An export of valid events from an aborted response remains incomplete.

An unchanged registration is idempotent. Replacing a source alias requires its
current **--expected-revision**; previous response registrations remain retained
for the jobs that used them. Start the same server afterward:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis --checkout /private/stellar-forge \
  serve --open
~~~

The existing source command with **--session** and **--room** remains unchanged.

### Choose the useful table

1. In **API responses**, select the registered source and choose **Inspect
   retained records**. The UI shows its native classification, format,
   response byte count, original SHA-256 and transport completion.
2. Select the record collection. JSON Pointer **/structuredContent/rows** selects
   rows from a native MCP structured result; **/rows** selects a root result's
   rows. An empty pointer selects the root array or one root object. CSV and
   typed stream exports already define their sequence of records.
3. Choose **Read fields from this collection** and edit the column mapping.
   A pointer such as **/players/white/rating** selects a nested scalar. For SSE,
   choose **Parse each data value as JSON** explicitly to use pointers such as
   **/data/meta/domain**; event ID, event type and original record index remain
   available alongside data.
4. Choose **Preview all mapped records**. The background action walks every
   retained row, verifies the selected fields and conversions, and retains the
   complete count and projected-byte digest. The displayed sample contains at
   most 25 rows and 256 KiB; it is labeled as a sample.
5. Review the source scope and choose **Import reviewed projection**. A native
   partial stream or a selected provider result marked **truncated: true**
   requires the visible incomplete-scope checkbox. The choice and original
   incomplete state remain in the imported manifest and report sources.
6. In **Data**, select the resulting immutable version for a SQL view, or use
   **Review changes** against an existing view first. Save SQL and assemble
   customer reports through the original tabs.

The importer does not assume that every JSON property is a row. It does not
silently flatten arrays, drop invalid rows, deduplicate records, normalize
currency strings, convert blank CSV fields to NULL, or infer that a missing
provider truncation flag proves an exhaustive provider result.

| Mapping type | Stored value |
| --- | --- |
| Native scalar | Original JSON scalar type; every CSV cell remains text. Numeric and exact decimal strings remain text. |
| Text | Strings stay exact; other scalar values become their JSON text representation. |
| Integer | An existing integer or canonical signed decimal text within SQLite's signed 64-bit range. No fractional truncation. |
| Number | Explicit conversion to a finite floating-point number; use Native or Text for exact decimal strings. |
| Boolean | JSON booleans or exact text true / false; stored as SQLite 1 / 0 with boolean provenance. |
| JSON text | Explicit canonical JSON representation for a selected object, array or scalar. |

JSON null remains SQL NULL for every mapping type. A missing pointer fails the
whole projection by default, identifying the original row and selected column.
Choosing **Use NULL** explicitly retains per-column missing-to-NULL counts.
Columns have no SQLite affinity, so later insertion does not silently coerce
numeric-looking text. Case-insensitive SQL column collisions are rejected.
CSV headers must be unique and every row must have the exact header width.

### Identity, review and recovery

The source is a hash-bound native response. The table is a derived analytical
projection with schema **stellar-forge.response-table-manifest.v1**. It is never
an SF100 delivery or merchant snapshot. Its manifest retains the original
response and input-file hashes, native source classification, precise mapping,
completion and provider declarations, missing-value policy, record count and
projected-row digest.

Preview and import are original durable workspace jobs. Import rereads the
original source, reconstructs the entire projection and requires the exact
reviewed preview hash. Changed bytes, metadata or mappings require another
preview. New jobs use the current registered source revision; repeating a
completed request ID returns that original job and never imports today's
replacement under an old review.

Both dataset-room imports and response projections use the same original
SQLite row transaction, scalar handling, immutable version identities and
view revision checks. A failed projection/import leaves previous tables and
selected views intact. Saved SQL results retain their actual source versions
from the same SQLite read snapshot. Reports retain these source identities and
completion scopes with their published rows; exports do not requery providers.

A database backup retains imported rows, exact analytical manifests,
registrations and their histories, previews/import jobs, saved SQL, comparisons,
report rows and publications. After restoring to a new private directory,
ordinary analysis and regenerated report exports work without wallet keys,
the original checkout or external response files. A new projection still needs
the corresponding original native files: configuration/result plus response
file, native MCP metadata/result, or all three original typed-export files.
Those external files are not copied into the database backup. Re-register a
moved source explicitly rather than editing historical paths or manifests.

Limits are explicit failures, never silent truncation: structured JSON is at
most 32 MiB; a retained input at most 256 MiB; a projection at most 1,000,000
rows, 128 MiB, 256 selected columns, 2 MiB per mapped row and 120 seconds.
Existing original readers can impose a stricter native file limit. Large
integers outside signed 64-bit range can be retained as Text; exact decimal
strings can remain Native text. The customer's selected provider-query scope
is distinct from transport completion and from analytical query row limits.
