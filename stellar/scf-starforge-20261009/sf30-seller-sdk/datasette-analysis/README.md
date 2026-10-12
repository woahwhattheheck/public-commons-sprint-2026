# Datasette customer Analysis

Receive a reviewed Datasette edition into the original Stellar Forge Analysis
workspace, inspect its complete rows, compare later editions, work with the
saved SQL and reports, and deliver the complete customer workspace.

The same private server serves the Datasette operator at /datasette and the
existing Analysis application at /. They share one AnalysisWorkspace, its
database, imports, query jobs, reports, workbooks, archives and local capability.

## Installed application

Open **Datasette customer Analysis** in the existing merchant runtime's Applications pane. Select the original Python installation with its workbooks extra, the same Analysis database and operation ID, then use the original review, start, open and stop controls. The source-owned `datasette-analysis` command uses that installed environment and source release. [INSTALLATION.md](INSTALLATION.md) gives the complete installation, source-selection, command-line and receiving workflow.


## Native NLD operations

The **NLD operations** view adds a complete retained-source commissioning path
inside this same customer workspace. Select the original complete edition,
review the ordered business keys, field mapping, units and source years, and
retain the complete native project. Its existing NLD SQLFlowTask writes only
the adapter's owned SQLite reference target. The original Analysis query,
report, workbook and archive engines receive the result.

The workflow retains exact numeric source spellings, original row references,
native by-key execution state, failed or uncertain run evidence and complete
target snapshots. Same-content DELTA and explicit backfill keep their original
execution meanings. A later source selection does not authorize deletion of
target rows outside that selection.

The full operator/CLI/runtime/source/receiving instructions are in
[NLD.md](NLD.md), with machine-readable source pins in
[NLD_SOURCE_CONTRACT.json](NLD_SOURCE_CONTRACT.json). The original WRI source
capture is reused. Native NLD execution and received-project completion are
established only by their actual returned operation receipts.

## Open the customer workspace

Use the original repository or selected runtime with Python 3.11 or later and
its existing Analysis dependencies. Node is required for native DatasetDelivery
registration; pass the same installed source checkout and Node runtime used by
the original buyer. Workbook generation uses the existing workbook extra.

Run the following from the source root. Keep the workspace outside the source
checkout. Select and retain one 32-character lowercase hexadecimal operation ID
for this Datasette customer project.

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py serve \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --checkout /absolute/stellar-forge-source \
  --node node \
  --open
~~~

The command returns the private operator URL, the original workspace ID and
the launch-record path. The browser offers four connected views:

- **Editions:** original source identity, observation window, attribution,
  reviewed keys, imported Analysis version and the saved edition analysis.
- **Data:** every retained column, exact source cells, explicit nulls and
  page-by-page inspection of the imported edition.
- **Comparison:** two selected original editions and reviewed key columns,
  with their saved original Analysis comparison.
- **Delivery:** complete customer files, direct downloads and the original
  workspace archive for independent receiving.

**Open Analysis workspace** opens the existing full application for saved SQL,
source profiles, native semantics, query exports, reports, workbooks and archive
history. The Datasette source selection remains attached to that same database.

### Successive delivery folders

When `export --destination` selects a host folder, each export writes its complete
files beneath a child named with that export ID. The returned `directory` is the
actual delivery folder. A new export keeps previous deliveries intact; replaying
an existing export ID reuses its original archive and that edition's product files.

## Select the complete source

The composer consumes a handover with schema
stellar-forge.datasette-analysis-handover.v1. It supports the original finalized
DatasetDelivery selection and a retained public Datasette source manifest.
The selected handover identifies its actual source files and hashes.

Choose one of the operator's source inputs:

1. Enter the existing absolute handover path on this host. This keeps relative
   members beside their original descriptor.
2. Paste the original handover JSON with absolute paths to the retained local
   source selection.
3. Upload a handover JSON whose referenced members use absolute paths on
   the selected host. The upload retains the original bytes and returns its
   exact source path and SHA-256.

Prepare the customer edition with an Analysis name of at most 16 characters,
starting with a letter and using letters, numbers and underscores. All source values and
columns are carried by the maintained source reader and original importer.
Use a separate prepared edition for a deliberate later source observation.

The browser captures the selected file, descriptor, Analysis name and continuation
choice together before uploading. It checks the complete upload length and SHA-256.
Edits made while that original submission is in flight remain in the form for the
next source selection. Only the submitted, unchanged file selection is replaced
with its confirmed retained host path. Data pages and comparison filters keep
the latest selected edition, cursor and filter when earlier responses arrive later.

For the WRI Global Power Plant Database, capacity and generation fields are
historical published observations. Their original source years, nulls, source
links, country identifiers and attribution remain part of the selected data.
Review gppd_idnr over the complete edition before using it as a comparison key.
The Datasette rowid remains a locator within its own source edition.

Reviewed column names remain unchanged in the complete source rows, saved SQL,
profiles and key review. Domain reports follow the edition's explicit mapping
from original field meanings to those reviewed names. Renaming a capacity,
country, fuel, year, coordinate or attribution column therefore preserves its
original analysis. The saved review records that semantic mapping. An edition
with no reviewed semantic fields keeps its complete generic row and quality
analysis.

Source references:
[Datasette example](https://datasette.io/global-power-plants),
[JSON API and continuation](https://docs.datasette.io/en/stable/json_api.html),
[WRI publisher metadata](https://github.com/simonw/global-power-plants-datasette/blob/main/metadata.json),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Use the CLI with the browser open

The --connect option reads the existing private launch record and operates the
same server. It checks the original workspace and Datasette operation before a
write. Keep each HTTP request ID for response recovery.

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py prepare \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --connect \
  --request-id 4e832d5eaa674a5b9c8e3c9ed221c9ad \
  --handover /absolute/private/datasette-source/handover.json \
  --prefix geothermal
~~~

Connected prepare, compare and export return their original request ID before
waiting. --no-wait returns the current action state immediately. --wait-seconds
controls how long the CLI waits; the server continues its original operation
when that client stops waiting.

Read or explicitly continue the same request:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py request \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --id 4e832d5eaa674a5b9c8e3c9ed221c9ad

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py request \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --id 4e832d5eaa674a5b9c8e3c9ed221c9ad \
  --resume
~~~

A repeated ID with its identical original action returns the existing request.
Changing the action or source selection requires a new request ID. Restarted
incomplete requests appear as INTERRUPTED and retain their previous inputs,
progress and attempt history. Accepted request receipts remain available when a
subsequent status refresh fails; use Refresh or the same request ID to retrieve
the latest state. A completed receipt takes precedence over an older in-flight
status response. Continue interrupted requests from Operator activity or request
--resume; the composer resumes its original native jobs.

For an offline CLI operation, stop the browser server and omit --connect.
The CLI opens the same original AnalysisWorkspace for that command and closes
it afterward. status, rows, compare, export and call also support this mode.
The call command reads an exact JSON action body from --request.

## Read data, compare and export

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py rows \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --connect --edition-id ORIGINAL_EDITION_ID --offset 0 --limit 100

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py compare \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --connect --before EARLIER_EDITION_ID --after LATER_EDITION_ID \
  --key gppd_idnr

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py export \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --connect
~~~

Each new export action snapshots the current saved Analysis work, including
customer query, report and workbook edits. Its stable request ID selects that
archive generation; repeating or resuming the same ID reuses the same archive.
Archive file descriptors carry export_id, and download --export-id selects that
exact generation. Offline export --request-id also keeps a deliberate generation
stable across receiving or interruption.

Export uses the original source, query, report, workbook and workspace archive
producers. The operator lists each selected file by its native identity.
Browser and client downloads compare the full received length and SHA-256.
The Python client creates the destination once and accepts an existing file
only when the complete bytes match the selected original.

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py download \
  --workspace /absolute/private/datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --name ORIGINAL_FILE_NAME \
  --destination /absolute/private/delivery/ORIGINAL_FILE_NAME \
  --sha256 ORIGINAL_FILE_SHA256
~~~

## Receive and reopen the original workspace

Use the original complete-workspace archive and its SHA-256 from the delivery.
The receive command delegates to the maintained WorkspaceArchiveReceive
implementation. It restores the original database, sources, query results,
reports, workbooks and their selected file closure.

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py receive \
  --archive /absolute/private/Analysis_Workspace.zip \
  --sha256 ORIGINAL_WORKSPACE_ARCHIVE_SHA256 \
  --workspace /absolute/private/received-datasette-customer \
  --operation-id 3ce022631c314b55a3e17c43c0b109a9

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/cli.py serve \
  --workspace /absolute/private/received-datasette-customer \
  --operation-id 7fb57b82ce624d98a7cbdba1e6a5b9d4 \
  --open
~~~

The receiving operation has its own stable ID; the reopened customer retains
the original Datasette project ID. Repeating completed receiving preserves
subsequent customer edits through the native archive receiver.

## Importable local client

operator_client.py and operator_client.pyi provide the same API for a host
integration. The launch record binds the numeric loopback origin, capability,
workspace and operation. The client refuses redirects.

~~~python
from operator_client import DatasetteOperatorClient

client = DatasetteOperatorClient.from_workspace("/absolute/private/datasette-customer")
request = client.submit("prepare", {
    "handover": "/absolute/private/datasette-source/handover.json",
    "prefix": "geothermal",
    "resume": False,
}, request_id="4e832d5eaa674a5b9c8e3c9ed221c9ad")
completed = client.wait(request["request"]["id"])
state = client.status()
page = client.rows(edition_id=state["state"]["current_edition"], limit=100)
~~~

Import the client from this component directory, or add that exact directory
to the host integration's Python module path. The original native merchant
Analysis tools can continue using the existing /api/* Analysis actions on this
same server.

### Saved customer SQL on the same listener

The typed client also exposes `analysis_state()`, `saved_query(name)`,
`save_query(name, fields, expected_revision=...)`,
`start_query(fields, job_id=...)` and `analysis_job(job_id)`. These call the
original Analysis state, saved-query and job endpoints through the same
capability and loopback connection. Saved names and retained job IDs are
validated before the request. Creating a saved query uses expected revision 0;
editing one uses its returned revision. Query execution keeps the original job
ID and the actual view bindings returned by `analysis_state()`.

The complete `receiving.py --customer-country USA` journey uses these methods
to save and run its original country selection, export the edited workspace,
receive it independently and reopen both the saved query and exact result.
The same retained receiving operation and request IDs continue that journey
following interruption. Its original source programme supplies the full reviewed
edition and matching installed Analysis runtime.

## HTTP and model integration

All domain APIs use the original X-Analysis-Capability header. The full
original Analysis routes keep their existing handler and contracts.

| Route | Operation |
| --- | --- |
| GET /api/datasette/status | Original Datasette state and operator requests |
| GET /api/datasette/rows | Selected edition, offset and page size |
| POST /api/datasette/intake | Retain one complete handover JSON |
| POST /api/datasette/requests | Submit {request_id, action, body} |
| GET /api/datasette/requests/ID | Read one original request |
| POST /api/datasette/requests/ID/resume | Continue with the saved inputs |
| GET /api/datasette/download | Stream a selected original file |
| GET /api/state | Original Analysis view bindings and current workspace state |
| GET /api/queries/NAME | Read the saved customer SQL and its revision |
| POST /api/queries/NAME | Save customer SQL with the selected expected revision |
| POST /api/start/query | Start or reopen the original stable Analysis job |
| GET /api/jobs/ID | Read the original customer query job and result |

The model contract is
DatasetteAnalysis(analysis, operation_id=..., progress=...). dispatch handles
status, prepare, rows, compare and export. open_download yields the retained
stream and its filename, byte count, SHA-256 and content type.

operator_server.create_operator returns the existing server with its handler
extension, private launch record, operator URL and request controller. Close
the controller before closing the externally owned AnalysisWorkspace.

The additive sf_datasette_operator_requests table sits in the original
Analysis database. It records only the submitted action, source binding,
request state, progress and result. The domain model and original Analysis
jobs retain the underlying operation and data. Complete native workspace
archives therefore carry both the customer work and its operator history.

Copyright TokenJunkieLabs. MIT.
