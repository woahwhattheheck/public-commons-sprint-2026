# Receive a complete customer query export

Use the existing customer analysis workspace to review a saved query, export its
complete result, and retain its job. The receiving client downloads that same
job's files into a private transfer directory. It resumes after interruption and
returns the original `QueryExport` reader for ordinary Python, JSONL, CSV and
SQLite use.

This module ships in the existing `stellar-forge-buyer` Python package. Python
3.11+ and the base package are sufficient. The analysis server and its browser
remain the existing `stellar_forge_buyer.analysis_workspace` application.

## 1. Finish the reviewed export

Start the existing analytical database:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis serve
```

Open its private launch URL. In **Analysis**, load the desired saved revision,
inspect its SQL and parameters, then select **Review for full export**. In
**Exports**, choose the complete query review and output formats. An explicit
SQL `LIMIT` remains part of the query. The ordinary preview row limit controls
the review sample; full export consumes every row returned by the SQL statement.

The export panel retains progress, cancellation and history. Choose the completed
job and copy its 32-character job ID. Its original `manifest.json` records the
SQL, parameters, selected view revisions, imported source versions, result row
count and every output hash. A source acquired only partially keeps that scope
in `binding.sourceVersions`; `queryComplete` describes this SQL result.

## 2. Receive all selected files

Use the private `analysis-launch.json` written by that running workspace. The
receiving process uses its existing local capability and verifies the workspace
identity. Keep the file on the analysis host; the command reads its capability
directly from the file.

```sh
python -m stellar_forge_buyer.analysis_export_delivery \
  --launch /private/customer-analysis/analysis-launch.json \
  --job 0123456789abcdef0123456789abcdef \
  --out /private/customer-deliveries/operations-export
```

Replace the example ID with the actual completed job. The printed result names
the original export directory, manifest digest, row count, downloaded and reused
files, and the number of HTTP requests made by this invocation.

The transfer directory contains:

| Path | Use |
| --- | --- |
| `export/rows.jsonl` | Every result row, with the native typed SQLite scalar encoding. |
| `export/rows.csv` | The original CSV with its selected spreadsheet setting. |
| `export/rows.sqlite3` | The original result database, including explicit row order. |
| `export/manifest.json` | The unchanged original completion manifest. |
| `review/manifest.json` | The retained manifest used to bind an unfinished transfer. |
| `transfer.json` | Local job, workspace and manifest identity for resumption. |

Only the formats selected in the original export appear. The receiving client
uses the server's complete-job metadata and exact file endpoints. It streams
files in 1 MiB chunks by default, checks their lengths and digests, and publishes the received
completion manifest after every selected output is complete. The original
`QueryExport` validates the completed directory.

Use `--max-output-bytes` when the receiver has a chosen combined output limit.
`--timeout` accepts positive seconds through 300 for each local HTTP request;
the default is 30. Streaming uses bounded memory.

## 3. Resume an interrupted delivery

Run the same command with the same job ID and transfer directory. Completed
files are verified and reused. For an unfinished file, the receiver hashes its
retained prefix and requests the remaining byte range with the original file's
strong ETag. It checks the returned range, full-file identity and final digest.
Its temporary file stays inside this same transfer directory until the download
completes. The result reports `resumed_files` and `resumed_bytes` for that call.

An older server that returns the ordinary full `200` response is also supported;
the receiver starts that one file from byte zero and checks its complete digest.

After an analysis server restart, supply the new `analysis-launch.json` from
the same workspace. Its port and capability may change while its workspace,
job and export identities remain the same.

A complete received export opens without the launch file or the server:

```sh
python -m stellar_forge_buyer.analysis_export_delivery \
  --job 0123456789abcdef0123456789abcdef \
  --out /private/customer-deliveries/operations-export
```

That invocation verifies the retained files and reports `network_requests: 0`.
An already complete result also survives a progress callback failing after the
final manifest was published: repeat the same invocation to reopen it.

## 4. Consume and hand over the original result

```python
from stellar_forge_buyer.analysis_export_delivery import receive_export

received = receive_export(
    job_id="0123456789abcdef0123456789abcdef",
    launch_file="/private/customer-analysis/analysis-launch.json",
    destination="/private/customer-deliveries/operations-export",
)

result = received.export                 # The original QueryExport instance.
metadata = result.manifest
for row in result.rows():                # JSONL was selected for this export.
    consume_row(row)

recipient = result.copy_to("/private/recipient/operations-export")
```

The portable recipient directory contains the selected native files and the
unchanged completion manifest. The local transfer record and launch capability
are separate. The recipient can use `QueryExport` after moving the directory to
another machine, or open its CSV and SQLite outputs with ordinary tools.

```sh
python -m stellar_forge_buyer.query_export inspect \
  --directory /private/recipient/operations-export
```

For SQLite, select from `result` and order by `_sf_export_row` to reproduce the
original query order. JSONL decoding through `QueryExport.rows()` preserves exact
Python integers, BLOBs and the native special float encoding. Decimal text stays
text in the native SQLite and JSONL outputs.

## Application progress and cancellation

```python
from threading import Event
from stellar_forge_buyer.analysis_export_delivery import receive_export

cancelled = Event()

def show_transfer(state):
    print(state["file"], state["totalBytes"], state["completedFiles"])

received = receive_export(
    job_id=completed_job_id,
    launch_file=private_launch_file,
    destination=private_transfer_directory,
    cancel=cancelled.is_set,
    progress=show_transfer,
)
```

Call `cancelled.set()` from the host application's cancellation action. A cancelled
transfer raises `ANALYSIS_EXPORT_RECEIVE_CANCELLED` and keeps the completed files
for the same call to resume. Transfer cancellation concerns delivery to this
recipient; the server's completed export remains available to its existing
history and download controls.

The Python API's `chunk_bytes` option accepts 1 KiB through 1 MiB. Applications
can choose smaller transfer chunks for more frequent progress and cancellation
checks; the default remains 1 MiB.

The runnable `examples/receive_query_export.py` demonstrates receiving, reporting
file progress, opening typed JSONL, and creating a portable recipient copy.
