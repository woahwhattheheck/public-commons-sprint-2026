# DuckDB dataset workspace

The DuckDB workspace opens a completed native dataset delivery as a retained local
analytical edition. Use its browser operator to review the source and field
mapping, select an active edition, run SQL, save a query, export Parquet and CSV,
and prepare a complete workspace for another computer.

Acquisition and payment continue through the existing
[dataset application](DATASETS.md). The DuckDB workspace consumes its completed,
finalized delivery report or the unchanged scan of an original finalized SF100
data room. Each imported edition keeps the native source files, mapping, review
and source identifiers inside `warehouse.duckdb`.

## Install and open

### From the installed merchant runtime

Open the maintained runtime workspace, select the received merchant runtime, and
choose **Python & workbooks**. Review the local Python 3.11+ interpreter and select
the **duckdb** extra. Use **Resolve and retain exact wheels**, **Install offline**,
then **Select this environment**. DuckDB uses the declared
`duckdb==1.5.6` dependency in that source release.

Open **Applications**, choose **DuckDB dataset workspace**, and select that
installed Python environment. Enter a private absolute workspace directory and
use port `0` to select an available local port. The optional query export and
workspace handoff directories are private sibling parents for new deliveries.
Review and save the application, start it, then use **Open**.

Applications retains the selected runtime, Python installation and workspace
directory. Its opening observer reads the original private
`duckdb-launch.json` after matching the current child process and selected
workspace. Stop and reopen use the same retained application.

See the maintained [Python runtime workspace](../../distribution/python-runtime/WORKSPACE.md)
for source receiving, exact wheel transfer and environment installation.

### From the Python package

Use the complete source release that contains this guide:

```bash
umask 077
python3 -m venv /absolute/private/duckdb-venv
/absolute/private/duckdb-venv/bin/python -m pip install \
  "/absolute/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[duckdb]"

/absolute/private/duckdb-venv/bin/stellar-forge-duckdb \
  --workspace /absolute/private/customer-warehouse \
  serve --open
```

The equivalent module command is:

```bash
/absolute/private/duckdb-venv/bin/python -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-warehouse \
  serve --open
```

Keep the lexical `venv/bin/python` path when invoking an installed environment.
A complete source checkout and its original Node runtime are used when acquiring
a new dataset; the imported analytical workspace reopens through the installed
Python package.

The server binds to `127.0.0.1`. Its stdout reports `status: LISTENING`,
`address`, and `private_launch`. The private launch file contains the browser
URL; `--open` opens that URL locally. Restarting the server creates a fresh
browser session while retaining editions, views, reviews, saved queries and
export history.

## Review and import the source

The **Source delivery** screen accepts the absolute path of either retained
native input:

| Input | Source report | Retained delivery |
| --- | --- | --- |
| SF88 dataset delivery | `delivery.native`, or the unchanged `ORIGINAL_PYTHON_DATASET` bridge result | The native manifest, JSONL, CSV and HTML review |
| Finalized SF100 data room | Unchanged output from `scan(directory, {retainPayload: false})` in the original `sf100-buyer-dataset-delivery/deliver.mjs` | The native session, source pages, manifest, JSONL, CSV and HTML review |

Keep the source directory at its recorded private path through review and import.
The saved input and the complete source-file inventory travel inside the
imported edition.

A delivery created with `DatasetAcquisition.deliver(...)` exposes that report
as `delivery.native`. Retain it alongside the delivered files when preparing
the analytical handoff:

```python
import json
from pathlib import Path

report_path = Path("/absolute/private/source-delivery-report.json")
with report_path.open("x", encoding="utf-8") as output:
    json.dump(delivery.native, output, ensure_ascii=False, indent=2)
report_path.chmod(0o600)
```

For an existing finalized SF100 data room, retain its scan through the original
readonly source function:

```bash
node --input-type=module - \
  /absolute/source/stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs \
  /absolute/private/finalized-data-room \
  /absolute/private/sf100-scan.json <<'NODE'
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

const [modulePath, directory, reportPath] = process.argv.slice(2);
const { scan } = await import(pathToFileURL(modulePath).href);
const report = await scan(directory, { retainPayload: false });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {
  mode: 0o600, flag: 'wx',
});
NODE
```

Choose that unchanged `sf100-scan.json` as the original report. Analysis uses
the completed scan and source files; the scanning process can finish before
opening the warehouse.

In the browser:

1. Choose **Review delivery**. Read the source scope, row count, source fields and
   sample.
2. Review every source field's SQL name, type and nullability. The default mapping
   retains every field. If stable record keys exist, enter their mapped SQL
   column names.
3. Choose **Prepare import review**, then **Import reviewed edition**.
4. Open **Dataset editions** and select the imported edition.

The import review is retained before data enters the warehouse. Importing that
same review again returns the original edition. A changed source or mapping
creates a distinct review and edition. Selected keys must be non-null and unique
across the complete imported edition.

### Types and exact values

| Source value | Default retained type | Review choice |
| --- | --- | --- |
| String | `VARCHAR` | Keep text or choose an appropriate ISO date/time type |
| Boolean | `BOOLEAN` | Keep a boolean column |
| Integer within the native range | `HUGEINT` | Choose `BIGINT` when its range fits |
| Fractional JSON number | `JSON` | Choose an exact `DECIMAL(precision,scale)` for arithmetic |
| Array, object, mixed values or very large integer | `JSON` | Retain the complete JSON value |

Fractional source numbers retain their exact decimal representation in the
default JSON mapping. An explicit `DECIMAL` mapping checks every value against
its declared precision and scale before import. `DOUBLE` is available when an
approximate floating-point representation is appropriate.

A custom mapping is a JSON array containing one
`{source, name, type, nullable}` object for each source field. SQL names must be
unique; `sf_row` is reserved for the original row order. The review accepts
`VARCHAR`, `BOOLEAN`, `BIGINT`, `HUGEINT`, `DOUBLE`, `JSON`,
`DATE`, `TIMESTAMP`, `TIMESTAMPTZ`, and `DECIMAL(p,s)` with
`1 <= p <= 38` and `0 <= s <= p`.

## Select an edition and run SQL

Under **Dataset editions**, enter a view name such as `current_records` and
choose **Activate this edition**. That view points to the selected immutable
edition. Its revision changes when another edition becomes active.

Open **SQL workspace**, select the table or view, and run a preview:

```sql
SELECT *
FROM current_records
ORDER BY sf_row
```

Use the preview row count to inspect a manageable sample. A saved SQL `LIMIT`
also applies to the complete export, so put it in the query only when that limit
belongs in the delivered result. The preview's row limit controls the displayed
sample independently.

Supply parameter values as a JSON array and use SQL placeholders, for example
`SELECT * FROM current_records WHERE sf_row >= ? ORDER BY sf_row` with
`[100]`.

Enter a query name and choose **Save query**. Saved queries retain their SQL,
parameters and revision. Open a saved query to continue it. Changes to a selected
view or saved query require a current revision before they are used for a new
export.

## Export Parquet and CSV

With a saved query selected, choose **Export Parquet + CSV**. The operation
retains the exact saved query revision and active view bindings, writes the
complete SQL result, and appears under **Saved exports**.

Each completed result includes:

- `result.parquet`, with the native result types.
- `result.csv`, with a header and `\N` as the declared null marker.
- `request.json` and `execution.json`, recording the original selected query
  and completed result.
- `manifest.json`, with source edition identifiers, view bindings, rows, columns,
  and member byte counts and SHA-256 hashes.

Use the returned `files` list for the complete delivery. In the browser, open
the export to download its files or reopen its query. **Continue a saved
operation** resumes an interrupted export or handoff from its retained request.

To deliver an existing export to another computer, copy that export's complete
directory. The portable analytical workspace described below retains its export
history and original directory locators; the result files travel in their own
export directories.

## Compare a later delivery

Review and import a new source delivery using compatible record keys. In
**Dataset editions**, select the baseline and candidate editions and choose
**Compare**.

The comparison lists added, removed and changed column mappings, then compares
rows by keys across common columns with the same SQL types. Summary counts cover
the full compared editions; the row display is a preview. The source scope for
both editions is retained with the comparison. Use those scopes to establish
whether a changed row set represents a comparable source selection.

After reviewing the changes, activate the candidate under the existing view
name. A saved query using that view can then produce a new result while older
editions and exports remain available.

## Portable workspace and receiving

Choose **Prepare workspace handoff** from the SQL workspace. The completed
handoff contains `warehouse.duckdb`, `handoff-request.json`, and
`handoff.json`. Transfer the complete returned `files` list to a private
directory on the receiving computer.

The database includes imported editions, source files, column mappings, reviews,
view history, saved query recipes and export history. Each edition embeds the
complete native source-file inventory and its retained input report.
**Export source files** materializes that edition's files; use the returned
`files` list, including any nested original SF100 page paths.

On the receiving computer, install the same package and DuckDB extra, then open
the transferred directory:

```bash
/absolute/private/duckdb-venv/bin/stellar-forge-duckdb \
  --workspace /absolute/private/received-warehouse \
  serve --open
```

Select an existing edition or saved query. Its native tables and source files
are already in the warehouse. Choose a new receiver-private export destination
to generate Parquet and CSV there. To reopen a previously generated result,
transfer that result's own complete export directory as well.

A handoff is a retained point in time. Run another handoff to a new directory
after changing the analytical workspace. Keep the delivered handoff files
together while transferring; reopening them creates the receiver's own active
workspace and local browser state.

## Command-line operating sequence

All commands return JSON on stdout. Errors return JSON on stderr and a nonzero
exit status. Set these paths to the installed interpreter, private workspace,
original report, and a private directory for the command outputs:

```bash
umask 077
sf_python=/absolute/private/duckdb-venv/bin/python
sf_workspace=/absolute/private/customer-warehouse
sf_report=/absolute/private/source-delivery-report.json
sf_control=/absolute/private/customer-commands
mkdir -p "$sf_control"

sf_duckdb() {
  "$sf_python" -m stellar_forge_buyer.duckdb_cli --workspace "$sf_workspace" "$@"
}

sf_duckdb inspect-delivery "$sf_report" > "$sf_control/source.json"
sf_duckdb review "$sf_report" > "$sf_control/review.json"
sf_review=$("$sf_python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["review_id"])' "$sf_control/review.json")
sf_duckdb import "$sf_review" > "$sf_control/edition.json"
sf_edition=$("$sf_python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["edition_id"])' "$sf_control/edition.json")

sf_duckdb activate current_records "$sf_edition" --expected-revision 0
sf_duckdb query --sql 'SELECT * FROM current_records ORDER BY sf_row' \
  --max-rows 200 > "$sf_control/preview.json"
sf_duckdb save-query retained_rows \
  --sql 'SELECT * FROM current_records ORDER BY sf_row' \
  --expected-revision 0 > "$sf_control/query.json"

sf_query=$("$sf_python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["query_id"])' "$sf_control/query.json")
sf_revision=$("$sf_python" -c 'import json,sys; print(json.load(open(sys.argv[1]))["revision"])' "$sf_control/query.json")
sf_views=$("$sf_python" -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["views"]))' "$sf_control/preview.json")
sf_duckdb export "$sf_query" --expected-revision "$sf_revision" \
  --expected-views "$sf_views" \
  --destination /absolute/private/customer-exports/first-result

sf_duckdb handoff --destination /absolute/private/customer-handoffs/first-workspace
```

Use revision `0` only to create a new view or query name. Use the current
revision from `views` or `queries` when updating an existing name. A query
export destination belongs to its retained request: repeat the same command to
resume it, or choose a new destination for a different result.

For an explicit mapping and keys, replace the review command with:

```bash
sf_duckdb review "$sf_report" \
  --columns-file /absolute/private/all-column-mapping.json \
  --keys MAPPED_KEY_COLUMN
```

The mapping file must contain every field from `default_columns` returned by
`inspect-delivery`, with the desired names, types and nullability. To compare
two imported editions or materialize an edition's original source files:

```bash
sf_duckdb compare BASELINE_EDITION_ID CANDIDATE_EDITION_ID \
  --keys MAPPED_KEY_COLUMN --max-rows 200
sf_duckdb source-files "$sf_edition" \
  --destination /absolute/private/source-copies/first-edition
```

### Command reference

| Command | Purpose |
| --- | --- |
| `status` | Read editions, views, reviews, saved queries and exports |
| `inspect-delivery REPORT` | Inspect the native source and derive a complete mapping |
| `review REPORT` | Save a checked mapping, source selection and optional record keys |
| `import REVIEW_ID` | Import or reopen the reviewed immutable edition |
| `editions --limit N --before SEQUENCE` | Page through retained editions using `next_before` |
| `edition EDITION_ID` | Read an edition's mapping, source and native table |
| `activate NAME EDITION_ID --expected-revision N` | Select an edition through a versioned SQL view |
| `query --sql SQL` | Preview a SELECT, optionally with parameters and expected views |
| `save-query NAME --sql SQL --expected-revision N` | Retain a named SQL recipe |
| `queries`, `reviews`, `views`, `exports` | Reopen the retained local records |
| `export QUERY_ID --expected-revision N --destination DIR` | Write or resume complete Parquet and CSV results |
| `compare BEFORE AFTER --keys COLUMNS` | Compare editions by compatible unique record keys |
| `source-files EDITION_ID --destination DIR` | Materialize the retained source files |
| `handoff --destination DIR` | Prepare or resume a portable warehouse |
| `serve --open` | Open the local browser operator |

Both `query` and `save-query` also accept `--sql-file`. Their
`--parameters` value is a JSON array. `query`, `export` and the Python API
can require the `views` list returned by a prior preview through
`--expected-views`. Run a new preview if a selected view changed.

## Python interface

The optional database engine is loaded when a workspace is opened:

```python
from stellar_forge_buyer import DuckDBWorkspace

with DuckDBWorkspace("/absolute/private/customer-warehouse") as warehouse:
    review = warehouse.review_import("/absolute/private/source-delivery-report.json")
    edition = warehouse.import_review(review["review_id"])
    warehouse.activate("current_records", edition["edition_id"], expected_revision=0)
    preview = warehouse.query("SELECT * FROM current_records ORDER BY sf_row", max_rows=100)
    recipe = warehouse.save_query(
        "retained_rows", "SELECT * FROM current_records ORDER BY sf_row",
        expected_revision=0,
    )
    delivery = warehouse.export_query(
        recipe["query_id"], "/absolute/private/customer-exports/python-result",
        expected_revision=recipe["revision"], expected_views=preview["views"],
    )
    print(delivery["directory"], delivery["rows"], delivery["files"])
```

The warehouse uses one native thread and a 128 MB memory limit by default. Python
callers can select `memory_limit` and `threads` when opening a workspace.
Use the same retained workspace between calls. Revisions and immutable editions
allow a later session to continue the analysis from its actual saved state.
