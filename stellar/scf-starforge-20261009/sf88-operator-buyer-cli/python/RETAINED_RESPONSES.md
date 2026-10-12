# Carry original API responses with an Analysis workspace

An Analysis workspace can retain its original stream and MCP inputs beside the
saved datasets, SQL, reports and workbooks. The complete workspace archive then
opens those same sources on the receiving machine.

## Retain an existing source

Close the workspace's browser process first so the original Analysis owner lock
is available. Select the existing private database and the matching complete
native checkout. The command reads the already registered source files.

```sh
python -m stellar_forge_buyer.response_sources \
  --database /absolute/private/analysis \
  --checkout /absolute/native/stellar-forge \
  --node /absolute/node \
  --all
```

To retain one exact original registration, replace `--all` with
`--name events --revision 1`. The existing response source name, revision,
content identity and completion state remain in the database unchanged.

For a stream, the retained source contains the complete original `manifest.json`
and `source.json`, the native typed `records.jsonl`, and the original raw
response file or acknowledged response prefix. Its manifest continues to carry
the recorded stream format, record count, completion state and last complete
byte.

For an MCP result, it contains the original complete `<quoteId>.meta.json` and
`<quoteId>.json`. The existing native result store verifies the quote,
invocation, accepted terms and exact result. A received copy supplies only the
new local file addresses to that same read-only native verifier. The original
manifest bytes, result, payment observation and source identity stay intact.

The returned source receipt lists every copied file and its SHA256. Source
directories use the original response content address:

```text
analysis-response-sources/<source_sha256>/
```

Repeating retention verifies and returns that same directory. It does not
register another revision. An interrupted copy resumes the same private staging
directory, verifies the original complete inputs, and publishes only a complete
native-readable copy.

## Export the complete working project

Use one new stable archive operation ID and retain it for retries:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  --checkout /absolute/native/stellar-forge \
  --node /absolute/node \
  archive-review

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  --checkout /absolute/native/stellar-forge \
  --node /absolute/node \
  workspace-export \
  --id 18c5be43c7ed4e2a9871ba8acf210612 \
  --include-previous-backups
```

Archive review lists the selected complete query exports, reports, workbook
editions, previous database backups and retained sources. Export uses one
consistent SQLite snapshot. Every retained response revision referenced by that
snapshot contributes its complete source files. Later live registrations do not
replace the saved snapshot or its original selection.

The archive job returns the exact ZIP path, byte count and SHA256. If the
original export is interrupted, resume the same ID. The retained SQLite
snapshot, original output IDs and selected source hashes remain the basis for
that export.

## Receive and open

Choose an absent private target beneath a private receiving parent. Keep one
receiving operation ID for this archive and target:

```sh
python -m stellar_forge_buyer.workspace_archive_receive inspect \
  /absolute/analysis-workspace.zip \
  --sha256 ORIGINAL_ARCHIVE_SHA256

python -m stellar_forge_buyer.workspace_archive_receive receive \
  /absolute/analysis-workspace.zip \
  /absolute/private/received-analysis \
  --operation a01cedccfe9c4075a690651b4edf0631 \
  --sha256 ORIGINAL_ARCHIVE_SHA256

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/received-analysis status

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/received-analysis \
  --checkout /absolute/native/stellar-forge \
  --node /absolute/node \
  serve --open
```

Receiving verifies the exact ZIP and all selected members, the original
database identity, row counts and complete database-referenced source closure
before publishing the project directory. A retry after publication retains
later customer edits and verifies the original immutable response files.

The Sources view opens the retained inputs from their new location. Dataset
views, query history, published reports and workbook definitions continue to use
their existing IDs and original source meaning. The native JSON and stream
readers preserve exact integer, decimal, null and typed value behavior.

## Existing workspaces and archives

The retention command adds local source files to an existing workspace. Existing
archives without these files retain their original format and restore normally.
The command explicitly selects registered stream and MCP revisions. Other
source kinds continue through their existing native source or document
receiving workflows and are listed separately in the command result.

A changed original file requires inspection of that original operation. The
retention command never substitutes a new provider response or treats a new
capture as an old source. Keep the original complete files until the received
project has been inspected and its complete archive has been saved.

## Python API

```python
from stellar_forge_buyer.response_sources import retain_response, locate_response

# source is the exact existing sf_analysis_response_sources record.
receipt = retain_response(
    database.directory, source, checkout=original_checkout, node=original_node
)
# This returns a local read view and leaves source unchanged.
local_source = locate_response(database.directory, source)
```

The standard `AnalysisResponses` reader resolves the retained copy
automatically. `WorkspaceArchives` and the standard workspace receiver use
the same source-closure inspection. The original acquisition, query, workbook
and payment engines retain their existing responsibilities.
