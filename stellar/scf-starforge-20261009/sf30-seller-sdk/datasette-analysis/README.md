# Datasette customer Analysis

Receive a reviewed Datasette edition into the original Stellar Forge Analysis
workspace, inspect its complete rows, compare later editions, work with the
saved SQL and reports, and deliver the complete customer workspace.

The same private server serves the Datasette operator at /datasette and the
existing Analysis application at /. They share one AnalysisWorkspace, its
database, imports, query jobs, reports, workbooks, archives and local capability.

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

For the WRI Global Power Plant Database, capacity and generation fields are
historical published observations. Their original source years, nulls, source
links, country identifiers and attribution remain part of the selected data.
Review gppd_idnr over the complete edition before using it as a comparison key.
The Datasette rowid remains a locator within its own source edition.

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
progress and attempt history. Continue them from Operator activity or request
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
