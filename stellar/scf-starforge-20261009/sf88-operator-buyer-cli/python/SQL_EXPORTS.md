# Complete customer SQL exports

Use the existing Python buyer's `DatasetDatabase` to select acquired data, inspect
an original query preview, and export every result row to ordinary files. The
streaming reader and the preview/report reader use the same SQL authorizer and
native SQLite transaction. JSONL, CSV and SQLite outputs are written in one pass.

The existing Python package and Python 3.11+ are sufficient. After installing the
original buyer package, the command is:

```sh
python -m stellar_forge_buyer.query_export --help
```

## Review, export, and open the result

Start with an existing analytical database containing imported customer data and
its selected named views. Use the same directory supplied to `DatasetDatabase`.
Create a private working directory for the request and export:

```sh
mkdir -m 700 /private/customer-exports
```

Put the actual query in `/private/customer-exports/query.sql`. Select the named
view already present in your application; this example uses `inventory`:

```sql
SELECT sku, description, quantity, price
FROM inventory
WHERE quantity >= :minimum
ORDER BY sku
```

Save `{"minimum": 1}` in `/private/customer-exports/parameters.json`, then prepare
a retained review using the original query reader:

```sh
python -m stellar_forge_buyer.query_export prepare \
  --database /private/customer-analysis \
  --sql-file /private/customer-exports/query.sql \
  --parameters-file /private/customer-exports/parameters.json \
  --out /private/customer-exports/review.json
```

The private request contains the exact SQL, typed parameters, selected view
versions/revisions and a native preview. Its sample contains at most 20 rows and
1 MiB. `preview.truncated` describes the sample. Review the saved request before
running it. Both positional parameter arrays and named parameter objects work.

```sh
python -m stellar_forge_buyer.query_export run \
  --request /private/customer-exports/review.json \
  --out /private/customer-exports/current-stock
```

A completed export contains:

| File | Customer use |
| --- | --- |
| `rows.jsonl` | Incremental typed Python/JSON consumption. |
| `rows.csv` | Spreadsheet and ordinary text-table import. |
| `rows.sqlite3` | A portable database with the complete result in `result`. |
| `manifest.json` | Result count, columns, exact query and source-version context, and output hashes. |

The exporter scans the complete query result. `--formats jsonl,sqlite` selects a
subset. `--timeout` is the SQL execution/consumption deadline in seconds (default
300, configurable through 86400). Optional `--max-rows` and
`--max-output-bytes` raise an error when the whole requested export exceeds the
chosen limit. An over-limit result never receives a completed manifest.

Every row belongs to the same SQLite read transaction as the reviewed view
bindings. A changed selection produces `DATASET_SQL_VIEWS_CHANGED` before any
completed output. Prepare another review from the desired current selection to
export that edition. The original database's journal mode governs concurrent
writer behavior: a WAL writer can commit while the reader keeps its prior
snapshot; rollback-journal writers wait for that reader to close.

`queryComplete` describes completion of this SQL statement. The statement,
including any explicit SQL `LIMIT`, stays in the manifest. `binding.sourceVersions`
retains the original imported records, their source scope and original payment
classification. Imported partial responses retain their original scope. Other
read tables remain listed in `binding.readTables`.

## Consume and transfer a completed result

```python
from stellar_forge_buyer.query_export import QueryExport

result = QueryExport("/private/customer-exports/current-stock")
metadata = result.inspect()  # Verify every selected output.
for row in result.rows():    # Verify JSONL, then stream original typed values.
    process_inventory_row(row)

copy = result.copy_to("/private/customer-exports/recipient-copy")
```

The recipient needs only the exported directory and the Python package to use
`QueryExport`; ordinary SQLite and CSV readers can use their respective files
directly. Reopening and copying use retained bytes and work after the source
database moves or is removed.

```sh
python -m stellar_forge_buyer.query_export inspect \
  --directory /private/customer-exports/current-stock
python -m stellar_forge_buyer.query_export copy \
  --directory /private/customer-exports/current-stock \
  --out /private/customer-exports/recipient-copy
```

SQLite retains integers, text, nulls, floats and BLOBs without column-affinity
conversion. Use `ORDER BY _sf_export_row` to reproduce the original query's row
order. `export_metadata` binds that result to its manifest's query/source identity.
Use explicit SQL aliases for duplicate column names, names differing only in
case, or a column named `_sf_export_row`.

JSONL uses ordinary scalar values. BLOBs use `{"$sqliteBlob":"BASE64"}` and
non-finite floats use `{"$sqliteFloat":"Infinity"}` (or `-Infinity`/`NaN`).
`QueryExport.rows()` decodes these values. Large integers remain exact Python
integers. Consumers whose JSON parser rounds large integers should use the
SQLite output or an exact-integer JSON parser.

CSV uses an empty field for SQL null and `base64:` for binary values; JSONL and
SQLite preserve the distinction between null and empty text. By default,
formula-like text and headers receive an apostrophe prefix for spreadsheet
import. `--literal-csv` retains their literal text instead. The manifest records
which setting was used. Exact decimal text remains text in JSONL and SQLite;
spreadsheet software's import settings control its conversion of CSV cells.

## Application streaming, progress and cancellation

```python
from threading import Event
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase

source = DatasetDatabase("/private/customer-analysis", create=False)
reviewed_views = source.view_bindings()
cancelled = Event()

with source.stream_query(
    "SELECT sku, quantity FROM inventory ORDER BY sku",
    expected_views=reviewed_views,
    cancel=cancelled.is_set,
) as rows:
    for record in rows.dictionaries():
        process_inventory_row(record)
    print(rows.rows_read, rows.complete)

result = source.export_query(
    "SELECT sku, quantity FROM inventory ORDER BY sku",
    destination="/private/customer-exports/application-export",
    expected_views=reviewed_views,
    cancel=cancelled.is_set,
    progress=lambda state: update_job_progress(state),
)
```

Use the streaming context manager so early exit releases the cursor and read
transaction. `complete` becomes true only after exhausting the cursor. Progress
reports arrive every 4096 rows and after publication; a host can call
`cancelled.set()` from its cancellation handler. The original SQLite VM progress
handler also interrupts expensive SQL before it returns a row.

Exports create their destination exclusively, write private temporary outputs,
flush complete data, then publish the manifest last. All files use mode `0600`
and directories `0700`. Cancellation and ordinary errors remove this operation's
incomplete output files. An abrupt process kill can leave an incomplete directory;
opening it reports `QUERY_EXPORT_MANIFEST_UNAVAILABLE_OR_INCOMPLETE`. A completed
manifest survives a lost final reply or a failed final progress callback and can
be reopened. A new export never overwrites an existing destination.

## Local integrated workload

The focused test uses the original `DatasetDelivery`, verified retained-file
reader, import/activation, query engine, CLI subprocess, result readers and copy
path. It exercises complete export, exact values, concurrent view activation,
cancellation/limits, tamper detection and reopening after moving the source.

```sh
PYTHONPATH=stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
  python stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/query-export.test.py

SF_QUERY_EXPORT_ROWS=1000000 \
PYTHONPATH=stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
  python stellar/scf-starforge-20261009/sf88-operator-buyer-cli/test/query-export.test.py
```

The scale input is a deterministic local workload in the native delivery format.
The operation prints its measured row count, export duration and output size.
