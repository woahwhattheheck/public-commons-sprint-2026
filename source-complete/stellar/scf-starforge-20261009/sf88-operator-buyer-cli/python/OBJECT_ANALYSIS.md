# Analyze a delivered object

Use an already-completed Stellar Forge object in the customer analysis workspace. JSON and CSV files use the existing retained-response mapper and DatasetDatabase, so imported versions, SQL, saved queries, full exports, and reopening all remain in the same application.

## Open the completed file in Analysis

In the Object Buyer workspace, select a completed object and its recorded downloaded file. Choose **JSON** or **CSV**, give the source a stable name, and open it in Analysis. The handoff selects the exact recorded assembly. It does not download the object again.

In Analysis, open **Responses**, select that name and revision, and inspect its records. For JSON, select the record collection using its JSON Pointer; for CSV, use the retained header columns. Select the fields and column types, then preview all mapped records. Keep exact decimal strings as text when their spelling and precision matter. Choose integer only for values that fit the supported signed 64-bit range.

The preview covers every retained record, while its on-screen sample remains small. Review the mapping and source identity, then import the reviewed projection. The imported table is an immutable version. In **Data**, choose its SQL view, run and save a query, and use **Exports** for the complete query result. The complete-file exporter retains the original query, exact parameters, selected view bindings, format, and completion limits.

Reopen the same Analysis database to recover the registered source, mapping jobs, imported versions, saved queries, and completed exports. A source alias keeps its revision and selected original assembly. A later download to another assembly destination does not move an existing registered alias.

## Register from the local CLI

The registration command is for a workspace that is not currently served by another process:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/analysis \
  --checkout /absolute/stellar-forge-runtime \
  response --name inventory --input-kind object \
  --object-session /absolute/object-session \
  --object-destination /absolute/downloads/inventory.csv \
  --format csv
~~~

Start the existing application after registration:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/analysis \
  --checkout /absolute/stellar-forge-runtime serve --open
~~~

The optional destination must be an existing assembly recorded by that session. Without it, registration selects the latest recorded assembly and immediately pins that destination in the source record. To replace an alias with a different source, supply its current `--expected-revision`. Repeating the same registration returns the existing record rather than creating another revision.

## Python application integration

~~~python
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

workspace = AnalysisWorkspace(
    "/absolute/analysis",
    checkout="/absolute/stellar-forge-runtime",
)
try:
    source = workspace.responses.register(
        "inventory",
        "object",
        session="/absolute/object-session",
        destination="/absolute/downloads/inventory.csv",
        format="csv",
        expected_revision=0,
    )
finally:
    workspace.close()
~~~

Use the matching original native runtime. The adapter calls the original `ObjectBuyer.open(..., inspect=False).delivery(destination)` operation, which performs its native inspection. It does not create an object session, execute an acquisition, recover a payment, or assemble a new file.

## Attach to a running Analysis workspace

A local application that already has the private Analysis launch record can use the existing listener:

~~~http
POST /api/object-source
Content-Type: application/json
X-Analysis-Capability: <capability from the original private launch>

{
  "name": "inventory",
  "session": "/absolute/object-session",
  "destination": "/absolute/downloads/inventory.csv",
  "format": "csv",
  "expected_revision": 0
}
~~~

The request uses the listener's exact loopback host and existing Origin checks. The capability stays in the private launch file or request header. The response is the same registered-source record as the CLI, including its name, revision, source identity and pinned paths. Refresh the existing Analysis view after attachment. Do not start another Analysis owner on the same database.

## What remains attached to the imported data

The source records the original session and configuration identity, object snapshot, selection, delivery mode, complete chunk count, selected assembly receipt, chunk manifest, byte count and SHA-256. It retains hashes of the immutable original session definition and selected original assembly receipt.

Every registration and projection reuses the original file reader, which verifies the complete delivered bytes before yielding the same open file descriptor. Reopening checks the original source identity. The mapping and imported manifest identify the analytical projection separately from the original delivered file.

The completed file's transport scope is retained. A provider's JSON declaration that a result is truncated remains visible in the existing mapper and requires its existing acknowledgement before import. The object delivery itself does not supply a new payment classification.

PDFs, archives and binary files remain usable in the Object Buyer workspace. Choose a JSON or CSV object for this mapping path. Original typed NDJSON and SSE exports continue through the existing StreamDelivery source path.

## Recover without repeating work

If the source name changed, refresh Analysis and use its current revision. If the selected file or original receipt changed, return to the original Object Buyer session and select a recorded, intact assembly. An unfinished object must complete in that original workspace before it can be registered.

If Analysis is already running, use the live handoff. If an application was closed during an import or export, reopen the same database and inspect its retained jobs and completed deliveries before restarting work.
