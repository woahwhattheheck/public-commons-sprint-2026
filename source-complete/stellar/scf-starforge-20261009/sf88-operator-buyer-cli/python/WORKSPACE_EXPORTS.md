# Export a complete customer SQL query

The analysis workspace's **Exports** tab runs a retained query review through
the original streaming `DatasetDatabase.export_query` engine and keeps its
complete files beside the analytical database. Use it to deliver a complete
query result after reviewing a smaller table in **Analysis**.

Start the existing workspace against the customer's database:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis serve --open
```

Imported rows and retained analyses work without an acquisition checkout.
The launch URL comes from the existing private `analysis-launch.json`. The
server retains its loopback origin and capability access controls.

## Review, export, and download

1. Open **Analysis** and load a saved analysis or enter its SQL and parameter
   text. Choose the current data versions, then select **Review for full
   export**. An already completed analysis can instead use **Export every query
   row** from its result, or be selected in **Exports**.
2. Read the retained SQL, exact parameter text, preview count, reviewed views,
   and source context. The review is identified by its original job ID and
   result SHA-256. Changing a saved recipe does not change this review.
3. Select JSONL, CSV, SQLite, or a combination. All selected formats consume
   the same native query run and preserve its returned row order. Give the
   export a useful name.
4. Choose the execution timeout, which defaults to 300 seconds. Optional
   maximum row and combined output-byte limits are explicit failure limits.
   Leave them empty when the full SQL result should be exported. Exceeding
   either limit ends the job and retains its error in history.
5. Select **Export every query row**. The current rows and output bytes appear
   as the native writer reports progress. The query has no known percentage
   until it reaches completion. **Cancel export** records cancellation and
   signals the same running native query.
6. Open the completed result. Download each original file and `manifest.json`.
   The page includes the exact executed SQL and parameter text, original
   source scope, row count, file sizes, file hashes, and retained directory.
   **Newer exports** and **Older exports** page through the durable history.

The preview's row ceiling is separate from the export. For example, a review
that displays one of three rows exports all three when the SQL returns three
rows and no extra export ceiling is set. An explicit `LIMIT` in the SQL remains
part of the query and therefore also remains in the export.

The writer checks the original reviewed view bindings inside its own SQLite
read transaction. If a data view changed since the review, run a new review
against the intended versions. A completed export retains its original result
independently of subsequent view changes.

### Choose the file for its consumer

| File | Contents and use |
| --- | --- |
| `rows.jsonl` | One complete native JSON object per row. Integers and decimal strings retain their original values. Binary values and non-finite SQLite reals use the original typed encodings. Use `QueryExport.rows()` for Python values. |
| `rows.csv` | Ordinary CSV with a header. Spreadsheet-safe text is enabled by default and recorded in the manifest. Formula-like text gets an apostrophe prefix. NULL and empty text both appear as an empty CSV field; binary values use the documented `base64:` prefix. |
| `rows.sqlite3` | A portable SQLite database containing the `result` table. `_sf_export_row` preserves query order. Native values retain their SQLite storage types. |
| `manifest.json` | The original complete manifest: SQL and bindings, reviewed views, read tables, source versions, row count, and the bytes/SHA-256 of every selected output. |

Clear **Prepare CSV text for spreadsheet import** when the consumer needs
literal CSV text. JSONL and SQLite preserve typed values independently of this
CSV choice. Use a JSON reader that preserves signed 64-bit integers; JavaScript
number parsing can round them. The browser displays original parameter and
manifest text directly, and native downloads preserve the original bytes.

SQLite output requires unique column names, including case-insensitive
uniqueness, and reserves `_sf_export_row`. If the original engine returns
`QUERY_EXPORT_SQLITE_COLUMNS_REQUIRE_ALIASES`, add explicit aliases in the SQL,
run a new review, and export that review. The workspace preserves the original
column selection and names.

`queryComplete: true` means the selected SQL finished. The source versions can
still identify a partial acquired dataset, an acknowledged incomplete stream,
or a provider's limited query scope. Those original completion declarations
stay in `manifest.binding.sourceVersions` and in the browser's source details.

## Download large results and make a portable copy

The server enters the original `QueryExport.open()` context, verifies the full
chosen file, and sends success headers only after verification. It then streams
that same open descriptor in chunks, including its original SHA-256 header.
GET and HEAD use the same selected-file validation.

Native clients can continue an interrupted file with a single HTTP byte range.
Use the strong `ETag` from the original response as `If-Range` with, for example,
`Range: bytes=1048576-`. A matching validator returns the remaining bytes with
status 206 and an exact `Content-Range`; a changed validator returns the complete
file with status 200 so the client can replace its old partial copy. The ETag
and `X-Content-SHA256` always identify the entire immutable output. Validate the
whole received file against its manifest before publishing it for consumption.

The package includes a complete receiving client that performs this transfer,
resumes verified files and partial byte ranges, and reopens the original result
offline. Follow [Receive a complete customer query export](QUERY_EXPORT_DELIVERY.md)
for its CLI, Python API, progress, cancellation and portable recipient handover.

Browsers supporting streaming file save write directly to the chosen file.
The ordinary download fallback supports files up to 64 MiB. Larger files stay
complete at the displayed private directory and can use the existing native
copy command:

```sh
python -m stellar_forge_buyer.query_export inspect \
  --directory /private/customer-analysis/analysis-query-exports/EXPORT_JOB_ID

python -m stellar_forge_buyer.query_export copy \
  --directory /private/customer-analysis/analysis-query-exports/EXPORT_JOB_ID \
  --out /private/customer-handoff/export-edition-1
```

The parent of `--out` must already be private; the destination itself must be
new. Copy verifies and streams every selected output, then publishes the exact
original manifest bytes. The copied directory opens without the source
database, workspace process, provider session, checkout, or signing keys:

```python
from stellar_forge_buyer.query_export import QueryExport

result = QueryExport("/private/customer-handoff/export-edition-1")
manifest = result.inspect()
for row in result.rows():  # Requires JSONL among the selected outputs.
    consume(row)
```

Use `result.open("rows.sqlite3")` or `result.open("rows.csv")` as a context
manager when consuming those files. The descriptor belongs to that context.
`result.manifest` reads metadata; `result.inspect()` verifies every selected
output before returning the manifest.

## Cancellation, interruption, and reopen

The existing single workspace executor owns export dispatch. Progress and
cancellation use tiny private files under `analysis-query-exports/control`
outside the analytical SQLite database. The native query receives the same
process's `threading.Event.is_set` callback, avoiding a filesystem read for
every row or SQLite VM progress check.

Cancel ends an incomplete native export with status **CANCELLED**. An ordinary
failure retains **FAILED** and the original error code. Closing the workspace
signals pending and active exports before waiting for the original executor.
Progress retains observed row/byte counts and cancellation intent.

An abrupt process stop can leave an incomplete destination. Reopening marks
unfinished original jobs **INTERRUPTED**. An explicit retry uses a new request
ID and a fresh destination; the previous job and its incomplete directory remain
available for diagnosis. The native engine starts the complete query again for
that new attempt.

A process can stop after the native manifest is complete but before the job's
final database update. At reopen, the workspace inspects the original outputs,
checks their binding to the retained review, and adopts a valid complete export
as **COMPLETE**. It also reconciles that publication window after a late
callback or cancellation error. A valid published manifest wins over a late
cancellation request. This recovery reads the retained result and does not
dispatch the SQL again.

Keep the database directory and its `analysis-query-exports` directory together
to reopen the original export history and downloads. **Create database backup**
copies the analytical SQLite database, including export job records, but the
standalone export files live outside that backup. Use native `copy` for each
portable result you want to hand over. A restored database can review and export
its retained rows into a new local export directory.

## Use the same controller from Python

Close the browser server before opening another workspace job owner. The
original process lease prevents two executors from dispatching against one
database. This example takes an existing complete query review and starts an
export through the same path as the browser:

```python
import time
from uuid import uuid4
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

workspace = AnalysisWorkspace("/private/customer-analysis")
try:
    review = workspace.job("ORIGINAL_COMPLETE_QUERY_JOB_ID")
    request = {
        "id": uuid4().hex,
        "query_id": review["id"],
        "result_sha256": review["result"]["result_sha256"],
        "label": "Operations export",
        "formats": ["jsonl", "csv", "sqlite"],
        "timeout": 300,
        "max_rows": None,
        "max_output_bytes": None,
        "spreadsheet_safe": True,
    }
    job = workspace.start("query-export", request)
    while job["status"] == "RUNNING":
        time.sleep(0.2)
        job = workspace.job(job["id"])
    if job["status"] != "COMPLETE":
        raise RuntimeError(job["error"] or job["status"])
    print(job["result"]["directory"])
finally:
    workspace.close()
```

Retry a response-lost start with the same original request ID and unchanged
content. That returns the existing job. Use a new ID for a deliberate new
attempt. `workspace.exports.cancel(job_id)` signals that original job;
`workspace.exports.history(before=sequence, limit=25)` reopens the paged history;
`workspace.exports.download(job_id, filename)` yields the verified descriptor
and recorded metadata in a context manager.

### Existing local HTTP surface

Requests use the launch capability in `X-Analysis-Capability` and the original
same-origin JSON request rules.

| Request | Behavior |
| --- | --- |
| `POST /api/start/query-export` | Submit the same request object as the Python example through the original durable job owner. |
| `GET /api/jobs/<id>` | Read the original job, retained result, and observed export progress. |
| `GET /api/query-exports?limit=25&before=<sequence>` | Newest-first history with `items` and `next_before`. Omit `before` for the first page. |
| `POST /api/query-exports/<id>/cancel` with `{}` | Persist cancellation intent and signal the owned native query. Returns its current job. |
| `GET` or `HEAD /api/query-exports/<id>/file?name=<filename>` | Verify and stream one of that completed export's selected files or its manifest. |

See [SQL_EXPORTS.md](SQL_EXPORTS.md) for the original engine, standalone saved
query request, typed encoding, and native result format.
