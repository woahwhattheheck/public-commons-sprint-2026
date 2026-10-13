# Original request to native source and customer Analysis

The workflow adapter receives the original business request from an installed profile, captures or acquires its full Datasette source, produces the selected customer SQL and report in the existing Analysis application, and returns complete native delivery files. The original source CLI, query and report engines, workbook producers and workspace archive receiver remain the implementation.

Import **workflow_analysis.NativeWorkflowAdapter** from this directory. The request orchestrator owns the business request, external callback or messaging conversation, its installed configuration and the outer editable handover. This adapter owns the native source and analytical operation inside that same request.

## Interface

~~~python
from pathlib import Path
from workflow_analysis import NativeWorkflowAdapter

adapter = NativeWorkflowAdapter(
    configuration,
    workspace=Path("/absolute/private/original-request/native"),
    progress=record_original_progress,
)
result = adapter.run(original_request, run_id)
~~~

The caller supplies one stable 32-character lowercase hexadecimal run_id. All subsequent invocations of that original request use the same ID, exact configuration, request body and adapter workspace.

The result contains:

| Key | Complete returned work |
| --- | --- |
| edition | The original prepared Datasette edition, source, reviewed fields, collections, native version and baseline products |
| analysis | Customer query definitions and revisions, native query/export results, report publication, optional comparison and actual completion status |
| files | Complete local deliverables, each with name, absolute path, bytes, sha256 and contentType |
| archive | The original complete Analysis workspace archive with name, absolute path, bytes and sha256 |
| nativeIds | Original capture, edition, Datasette request, Analysis job, report publication and archive identifiers |
| supplier | Optional complete native supplier review identity, source bindings, coverage result metadata and original attachment filename map |

Every returned file lives inside the caller's adapter workspace. The original native archive also appears in files. Root orchestration can assemble the complete installed source, native files, flow definitions, request history and operating guide into its independent customer handover.

The sourceArchive configuration used by that outer handover describes the complete installed software distribution. It is independent of the source feed configuration below.

## Installed environment

Use Python 3.11 or later with the original Stellar Forge buyer SDK and its existing workbook extra. Open the selected **Datasette customer Analysis** application before dispatch. The adapter reads the original private launch record and verifies the actual workspace and operation on the running numeric-loopback listener.

Fresh source capture additionally uses the original running Datasette source workspace and its private connection file. Its CLI is the maintained sibling datasette/cli.mjs under the selected source installation. Node 24 is the product's installed source runtime. The native-edition source package uses that same edition SDK.

The source and Analysis listeners run on the selected worker host, where their declared source paths and the adapter's private output directory are accessible. Their existing application controllers retain ownership of start, stop and source installation.

The companion report/export HTTP client uses the original Datasette connection, workspace checks, capability, no-proxy opener and redirect refusal. Its additional routes are the maintained Analysis report, query-export and comparison-export endpoints. Customer request fields never select a URL, capability or HTTP route.

## Installed profile and original request

A configuration has the following structure:

~~~json
{
  "schema": "stellar-forge.source-workflow-configuration.v1",
  "profile": "supplier-review",
  "source": {},
  "analysis": {
    "workspace": "/absolute/private/customer-analysis",
    "operationId": "ORIGINAL_32_CHARACTER_LOWERCASE_HEXADECIMAL_ID",
    "prefix": "supplier",
    "query": {
      "name": "supplier_exceptions",
      "title": "Supplier exceptions",
      "sql": "SELECT * FROM {{plants}} WHERE {{column:status}} = ?",
      "parameterNames": ["status"],
      "maxRows": 100000,
      "note": "Use the original source status and retained record identifiers."
    },
    "report": {
      "title": "Supplier exceptions",
      "introduction": "Original supplier records selected by the installed business rule.",
      "note": "Source edition, full query outputs and editable SQL retained together."
    },
    "waitSeconds": 3600
  },
  "delivery": {
    "queryFormats": ["csv", "jsonl", "sqlite"]
  }
}
~~~

The capitalized ID and absolute paths stand for the actual installed values. SQL columns and the report's rules must match the selected source. The profile is trusted installation configuration; credentials remain ordinary private connection references.

The business request uses the orchestrator's original schema:

~~~json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "original-client-request-1042",
  "correlationId": "original-api-or-broker-correlation",
  "profile": "supplier-review",
  "parameters": {
    "status": "needs-review"
  }
}
~~~

The request supplies business values and selects the installed profile. The outer orchestrator retains the original request and correlation, derives run_id, and supplies the adapter workspace. A changed source selection, SQL rule or business parameter becomes a deliberate successor request under that original customer project.

### Use several report sections

Instead of analysis.query, analysis.queries accepts one to twelve configured query objects with distinct names. The native report pins each saved query revision and runs every section against the same observed Analysis view bindings. Each query receives its own complete native CSV, JSONL and SQLite export plus manifest.

The original prepared source's complete row collection is named plants in the existing Datasette component. The adapter resolves {{plants}} or {{collection:plants}} to that edition's real quoted Analysis table name. Other {{collection:NAME}} tokens resolve only when that native prepared collection exists.

{{column:NAME}} resolves the original source's reviewed column mapping and requires that column in the prepared full-source collection. An explicit installed SQL identifier remains unchanged. parameterNames supplies the ordered values for native SQL question-mark placeholders. Values go through Analysis parameters_text; they are never substituted into SQL text.

The native query preview accepts maxRows from 1 through 100,000. Full native query exports independently stream the complete selected query with the original SQL, parameter values and pinned views. A native preview limit remains visible as previewTruncated, previewRows and the actual exported row count.

## Source modes

### Receive an existing handover

~~~json
{
  "kind": "handover",
  "path": "/absolute/private/retained-source/handover.json",
  "sha256": "EXACT_SHA256_OF_THAT_ORIGINAL_HANDOVER"
}
~~~

The adapter checks the original complete handover bytes and retains them as Original_Handover.json. It resolves the original member paths through the maintained source reader and preserves that normalized selection as Source_Handover.json.

The native handover schema is stellar-forge.datasette-analysis-handover.v1. The original source reader supports native-edition, retained-source and finalized deliveries. Preparing the edition invokes its full original source reader, member hashes, page continuation and native importer. The completed native workspace archive carries the actual source closure.

### Receive a named native edition

~~~json
{
  "kind": "native-edition",
  "edition": "/absolute/private/datasette/editions/original-edition/edition.json",
  "sha256": "EXACT_EDITION_SHA256_RETURNED_BY_THE_PUBLISHER",
  "node": "/absolute/installed/node"
}
~~~

The adapter constructs the original native-edition handover. It also calls readDatasetteEdition and exportDatasetteEdition from the installed SDK to retain the complete original source package as Source_Edition.datasette.json.gz.

The native package carries the original edition, review, capture, response bodies and declared member closure. Each actual member is reopened by the maintained reader before the source enters customer Analysis.

### Capture a complete fresh source

~~~json
{
  "kind": "datasette",
  "connectionFile": "/absolute/private/datasette/connection.json",
  "workspaceId": "ORIGINAL_SOURCE_WORKSPACE_UUID",
  "node": "/absolute/installed/node",
  "editionName": "Supplier source observation",
  "selection": {
    "url": "https://original-source.example/database/suppliers.json?_shape=arrays",
    "kind": "table",
    "database": "database",
    "table": "suppliers",
    "continuation": "auto",
    "approvedOrigins": ["https://original-source.example"],
    "metadata": {
      "title": "Original supplier source",
      "source": "Original publisher"
    }
  },
  "key": ["supplier_id"],
  "urlParameters": {
    "status": "status"
  }
}
~~~

This example describes field positions. Use the actual endpoint, original source schema, attribution, connection and reviewed key from the installed client workflow. selection is passed to the maintained capture API. When response pages omit columns, include their original ordered column names in selection.columns.

urlParameters is optional. Each key names one configured URL query parameter; its value names the business request parameter supplying that filter. The adapter percent-encodes that scalar value while keeping the selected source origin, path and remaining query parameters. The original capture API still enforces its source and continuation rules.

The complete native pipeline is:

1. source.capture with a stable UUID derived from run_id and the exact installed source selection.
2. source.review across the complete original rows and configured key.
3. A second source.review with the explicit selected projection.
4. editions.create with the same capture, key, projection and stable edition ID.
5. editions.inspect to retain the actual editionFile and editionSha256.
6. The native source package export and original customer handover.

A configured projection uses the publisher's original schema. Without one, the installed workflow explicitly adopts suggestedProjection from the complete native review and rereviews that same projection. The suggestion comes from every original source row, including numeric precision, nulls, empty strings and structured values. A named edition retains its actual immutable review and source observations.

No page limit is supplied by this adapter. A source capture follows the original source's complete continuation. On an interrupted transport, the same native input and capture UUID continue the saved acquisition.

## Named sources and complete reconciliation

A profile can acquire several original feeds into the same existing Analysis workspace. Set sourceAlias to the name of the primary feed and relatedSources to a map of additional source configurations. Each related configuration supports the same handover, native-edition and datasette acquisition modes. Its optional analysisPrefix selects its native Analysis collection prefix; the default is its alias truncated to sixteen characters.

~~~json
{
  "sourceAlias": "prices",
  "source": {
    "kind": "native-edition",
    "edition": "/absolute/private/prices/edition.json",
    "sha256": "ORIGINAL_REVIEWED_PRICES_EDITION_SHA256"
  },
  "relatedSources": {
    "catalog": {
      "kind": "native-edition",
      "edition": "/absolute/private/catalog/edition.json",
      "sha256": "ORIGINAL_REVIEWED_CATALOG_EDITION_SHA256",
      "analysisPrefix": "catalog"
    }
  }
}
~~~

Aliases start with a letter and use up to forty-eight letters, digits or underscores. The primary alias and related aliases must be distinct, including case. Each alias retains its own source acquisition identity, reviewed source edition, full handover and original source package. Related feeds are prepared first, followed by the primary source; the native archive retains that primary edition and all the prepared source collections in the same Analysis database.

Installed SQL identifies original feeds and columns explicitly:

| SQL token | Native value |
| --- | --- |
| {{source:prices}} | The primary price edition's complete original row collection |
| {{source:catalog}} | The related catalog edition's complete original row collection |
| {{column:prices:name}} | The reviewed price column mapped from its original name field |
| {{column:catalog:url}} | The reviewed catalog column mapped from its original url field |
| {{collection:catalog:quality}} | The named catalog collection, when produced by the original Analysis component |

For example, a configured join can use FROM {{source:prices}} AS p LEFT JOIN {{source:catalog}} AS c and refer to p.{{column:prices:name}} or c.{{column:catalog:url}}. The installed report supplies the actual key, canonicalization, missing-value and currency rules for those original source schemas. Native Analysis performs the configured SQL against the saved actual views.

The adapter records analysis.sources with every source alias, prepared edition ID, original source metadata and review, row count and complete native collection bindings. Each query and report pins the same actual view state after all selected sources have been prepared. The complete original source files and baseline products for catalog use filenames beginning catalog_; primary filenames remain those of the original single-source delivery.

To compare both feeds with their retained earlier editions, add analysis.comparisons:

~~~json
{
  "comparisons": {
    "prices": {
      "before": "EARLIER_PREPARED_PRICES_EDITION_SHA256",
      "keys": ["name"]
    },
    "catalog": {
      "before": "EARLIER_PREPARED_CATALOG_EDITION_SHA256",
      "keys": ["url"]
    }
  }
}
~~~

These names and keys describe the configuration positions. Use the actual reviewed source key for each feed. Each native comparison retains its own original results and complete JSON/CSV export, named by source alias. analysis.comparison continues to select the primary comparison in an existing single-source profile; select each alias once across comparison and comparisons.

## Native preparation for the receiving profile

Build a new complete installed release from the selected source commit when needed using the existing product builder:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout \
  --ref ORIGINAL_SOURCE_COMMIT \
  --selection datasette \
  --out /absolute/private/datasette-release
~~~

The original [product receiving guide](../../../../products/datasette/RECEIVING.md) receives that release. In the existing runtime's Python & workbooks installation, select Python 3.11 or newer and the workbooks extra. Its exact installation ID is returned by the original inventory command:

~~~sh
starforge runtime-workspace python-status \
  --workspace /absolute/private/runtime-operator \
  --runtime-id ORIGINAL_RUNTIME_ID
~~~

Use that installation's executable for the Python commands below. For an existing running Analysis application, obtain the actual original operation ID through its maintained client. Run from this datasette-analysis component directory:

~~~sh
analysis_workspace="/absolute/private/customer-analysis"
task_python="/absolute/installed/workbooks/bin/python"
analysis_operation="$("$task_python" - "$analysis_workspace" <<'PY'
import sys
from operator_client import DatasetteOperatorClient
original = DatasetteOperatorClient.from_workspace(sys.argv[1]).status()
print(original["operation_id"])
PY
)"
~~~

For a new customer Analysis operation, retain its ID once in the private project directory before starting the original application:

~~~sh
analysis_operation="$("$task_python" - /absolute/private/project/analysis-operation.json <<'PY'
import json
from pathlib import Path
import re
import sys
import uuid
path = Path(sys.argv[1])
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
try:
    with path.open("x", encoding="utf-8") as output:
        json.dump({"operation_id": uuid.uuid4().hex}, output)
        output.write("\n")
except FileExistsError:
    pass
value = json.loads(path.read_text(encoding="utf-8"))
operation_id = value["operation_id"]
if not isinstance(operation_id, str) or re.fullmatch(r"[a-f0-9]{32}", operation_id) is None:
    raise ValueError("Select the original saved Analysis operation.")
print(operation_id)
PY
)"
~~~

Start the maintained Analysis server on its original owner, using the retained ID. The existing Applications pane can manage the same process; the direct source command is:

~~~sh
"$task_python" cli.py serve \
  --workspace "$analysis_workspace" \
  --operation-id "$analysis_operation" \
  --checkout /absolute/installed-source \
  --node /absolute/installed/node \
  --port 0
~~~

Keep that original listener open while the request worker runs. After a restart or native archive receiving, reuse the original Analysis operation ID from the retained project. The running client command above reads it back with the source workspace identity.

Open the source workspace through its original command:

~~~sh
starforge datasette serve \
  --directory /absolute/private/datasette-source --create \
  --connection-file /absolute/private/datasette-source/connection.json \
  --port 0
~~~

The WRI package belongs to that installed source. Save the actual absolute path in a private receive-wri.json:

~~~json
{
  "archiveFile": "/absolute/installed-source/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/sources/wri-geothermal-20261012/wri-geothermal.sfds.gz",
  "sha256": "53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0",
  "id": "wri-geothermal"
}
~~~

Then use the existing source receiver and retain its complete original result:

~~~sh
starforge datasette \
  --url-file /absolute/private/datasette-source/connection.json \
  --operation source.receive \
  --input-file /absolute/private/project/receive-wri.json \
  --out /absolute/private/project/receive-wri-result.json
~~~

A continued native receive returns that same source edition. Keep the completed receipt for the next step. Form the customer handover from its actual returned path and hash:

~~~sh
"$task_python" - /absolute/private/project/receive-wri-result.json /absolute/private/project/wri-handover.json <<'PY'
import json
from pathlib import Path
import sys
original = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if original["editionSha256"] != "ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616":
    raise ValueError("Select the retained original WRI edition.")
handover = {
    "schema": "stellar-forge.datasette-analysis-handover.v1",
    "delivery": {"kind": "native-edition",
                 "edition": original["editionFile"],
                 "sha256": original["editionSha256"]},
}
target = Path(sys.argv[2])
try:
    with target.open("x", encoding="utf-8") as output:
        json.dump(handover, output, ensure_ascii=False, indent=2)
        output.write("\n")
except FileExistsError:
    if json.loads(target.read_text(encoding="utf-8")) != handover:
        raise ValueError("The saved handover selects a different original edition.")
print(str(target))
PY
~~~

The resulting handover, original running Analysis directory/ID and complete software archive are the concrete configure inputs in the WRI profile below. The source.receive operation verifies the entire native package before returning its edition; the adapter and original Analysis importer reopen that complete source closure.


## Original WRI receiving profile

The retained WRI geothermal edition provides a complete source for running this workflow on the existing native receiving installation. Its original source package contains all four response pages, 189 records and 26 ordered columns. The native review records 189 distinct, nonblank gppd_idnr values, 22 countries and 65 USA records.

The package is wri-geothermal.sfds.gz, 59,792 bytes, SHA-256 53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0. Its reviewed edition SHA-256 is ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616. The complete original source, metadata and native result are retained under [datasette/sources/wri-geothermal-20261012](../datasette/sources/wri-geothermal-20261012/).

Receive the package through the original source.receive operation and select the returned absolute editionFile as source.edition with kind native-edition and the reviewed edition hash above. The original source and Analysis launch records supply the installed workspace and operation fields. [WORKFLOW_EXAMPLE.json](WORKFLOW_EXAMPLE.json) contains the complete installed-profile template for this receiving. Use the original local handover, complete installed source archive and running Analysis workspace/operation with configure:

~~~sh
python3 workflow_cli.py configure \
  --template WORKFLOW_EXAMPLE.json \
  --source-handover /absolute/private/wri/handover.json \
  --source-archive /absolute/private/releases/complete-source.zip \
  --analysis-workspace /absolute/private/customer-analysis \
  --operation-id ORIGINAL_32_CHARACTER_LOWERCASE_HEXADECIMAL_ID \
  --output /absolute/private/wri/workflow-configuration.json
~~~

These flags replace SOURCE_HANDOVER, SOURCE_ARCHIVE, ANALYSIS_WORKSPACE and ANALYSIS_OPERATION_ID before configure retains the complete original paths and hashes. Add --flow-delivery with the actual selected native flow delivery file when connecting the result to its installed broker or callback. A paired-source profile also accepts --related-handover catalog=/absolute/private/catalog/handover.json, repeated for each selected original feed.

The profile uses these complete Analysis query and report settings:

~~~json
{
  "queries": [
    {
      "name": "original_records",
      "title": "Complete original geothermal records",
      "sql": "SELECT * FROM {{plants}} ORDER BY {{column:gppd_idnr}}",
      "parameterNames": [],
      "maxRows": 100000,
      "note": "Every original source row and column, including explicit nulls, source URLs and original attribution."
    },
    {
      "name": "selected_country",
      "title": "Selected country and capacity threshold",
      "sql": "SELECT * FROM {{plants}} WHERE {{column:country}} = ? AND {{column:capacity_mw}} >= ? ORDER BY {{column:capacity_mw}} DESC, {{column:gppd_idnr}}",
      "parameterNames": ["country", "minimumCapacityMw"],
      "maxRows": 100000,
      "note": "Country is the original three-letter code. The capacity threshold uses the published capacity_mw field in MW."
    },
    {
      "name": "country_inventory",
      "title": "Country capacity and 2017 generation coverage",
      "sql": "SELECT {{column:country}} AS country, {{column:country_long}} AS country_name, COUNT(*) AS plants, SUM({{column:capacity_mw}}) AS published_capacity_mw, COUNT({{column:year_of_capacity_data}}) AS plants_with_capacity_year, COUNT({{column:generation_gwh_2017}}) AS plants_with_observed_generation_2017, SUM({{column:generation_gwh_2017}}) AS observed_generation_2017_gwh FROM {{plants}} GROUP BY {{column:country}}, {{column:country_long}} ORDER BY {{column:country}}",
      "parameterNames": [],
      "maxRows": 100000,
      "note": "Capacity MW and observed generation GWh retain separate units. SUM ignores missing observations and remains NULL when every observation is missing; the coverage count accompanies the total."
    },
    {
      "name": "source_quality",
      "title": "Reviewed source coverage",
      "sql": "SELECT COUNT(*) AS source_rows, COUNT(DISTINCT {{column:gppd_idnr}}) AS distinct_plant_keys, SUM(CASE WHEN {{column:gppd_idnr}} IS NULL OR TRIM({{column:gppd_idnr}}) = '' THEN 1 ELSE 0 END) AS missing_or_blank_keys, SUM(CASE WHEN {{column:owner}} IS NULL THEN 1 ELSE 0 END) AS missing_owner, SUM(CASE WHEN {{column:year_of_capacity_data}} IS NULL THEN 1 ELSE 0 END) AS missing_capacity_year, SUM(CASE WHEN {{column:generation_gwh_2017}} IS NULL THEN 1 ELSE 0 END) AS missing_observed_generation_2017, SUM(CASE WHEN {{column:latitude}} IS NULL OR {{column:longitude}} IS NULL OR {{column:latitude}} < -90 OR {{column:latitude}} > 90 OR {{column:longitude}} < -180 OR {{column:longitude}} > 180 THEN 1 ELSE 0 END) AS missing_or_out_of_range_coordinates FROM {{plants}}",
      "parameterNames": [],
      "maxRows": 100000,
      "note": "Source-quality counts retain each underlying record in the complete original-records output."
    }
  ],
  "report": {
    "title": "WRI geothermal source inventory and selected-country review",
    "introduction": "World Resources Institute, Global Power Plant Database, CC BY 4.0. Source pages were observed on 12 October 2026; capacity, commissioning and generation values retain their original historical source years. This report separates published capacity in MW, observed 2017 generation in GWh, estimated generation and missing observations.",
    "note": "Complete original edition, customer SQL, parameters, report and editable workspace delivered together."
  }
}
~~~

Use profile wri-geothermal-review with the original request parameters {"country":"USA","minimumCapacityMw":0}. The full-record section selects 189 rows; the original country section selects the 65 retained USA records. These counts describe the retained source, and the native query result records its actual output.

For the receiving successor, keep the original business request in the received project and send a new requestId with parentRequestId set to that original request. Changing minimumCapacityMw to 10 makes a concrete report change using the same edition and country. The successor retains its exact parameter values, native jobs, report publication, complete exports and its relation to the original delivery.

For a fresh-source successor, use the received edition's own capture.selection, review.key.columns and review.projection in the installed source configuration. That keeps the exact ordered schema, original source URL, continuation and representation policy. Set analysis.comparison.before to the earlier prepared Analysis edition and keys to ["gppd_idnr"]. The native comparison returns actual added, removed and changed source records, while the original rowid stays a locator within its source edition.

## Complete customer output

Each configured customer query is saved under its configured name plus the retained run identifier. Its original revision, SQL, parameters and native view bindings remain with the customer project. Native query jobs and streaming query-export jobs retain separate identities.

For every query, the default delivery includes:

| File | Native content |
| --- | --- |
| QUERY_rows.csv | Full original query export with the native spreadsheet-safe CSV behavior |
| QUERY_rows.jsonl | Full typed source values through the native JSONL exporter |
| QUERY_rows.sqlite3 | Complete native query SQLite output |
| QUERY_manifest.json | Native complete export declaration, view bindings, source identities and output hashes |

The customer report uses AnalysisReports.save, the original report job, report publication and report-export operations through the same listener. It pins the exact saved query revisions, source edition and view bindings. The complete native exports are Customer_Report.html, Customer_Report.json and Customer_Report_Tables.zip.

The original Datasette baseline report, source-wide workbook, workbook handover and complete workspace archive travel alongside these customer outputs. The archive snapshots the actual editable Analysis database, source documents, queries, query results, report definitions and publications, workbooks, exports and operator history.

### Compare a retained earlier edition

Add an actual existing earlier edition and its reviewed source keys:

~~~json
{
  "comparison": {
    "before": "ORIGINAL_EARLIER_ANALYSIS_EDITION_SHA256",
    "keys": ["supplier_id"]
  }
}
~~~

Place comparison inside analysis. The native Datasette comparison uses the earlier and newly prepared editions. It preserves the original key review, view and result identities. The adapter exports all actual comparison rows through the native change-export engine into Source_Comparison.json and Source_Comparison.csv. The comparison's native selection hash comes from its returned original page.

## Continuation and actual status

The private native-workflow.json binds the exact configuration, business request and run ID. It retains the original native inputs, stage identifiers, query view bindings and result. The adapter's per-request filesystem lock keeps concurrent callers on that same journal.

Source inputs and complete native CLI receipts are retained under native-inputs and native-records. Each native CLI attempt preserves its own stdout and stderr. A completed receipt is reused after a lost transport or late close error.

Datasette prepare, compare and export use their original retained request IDs. Interrupted requests continue through the existing controller's resume operation. Analysis query/report/export jobs retain their original IDs; where the native engine preserves a failed job as immutable, a new recorded attempt derives from the same run and stage. Existing complete jobs and files are reused.

Progress contains stage names, run and native IDs, status and useful counts. It carries no loopback capability, credential or raw source payload. Native command and connection configuration remain in the private installed operation.

analysis.status is COMPLETE when the requested preview and native customer report completed fully. It is PARTIAL when the actual native query preview is truncated or the native report returns its concrete section, result or time limit. The result retains each query's actual preview/export counts and the report's native error. Full available query exports, baseline products and native archive still reach the original caller.

Other native failures retain their original operation and raise WorkflowAnalysisError or the original client error. The orchestrator can continue the same business request after the concrete source or native condition is resolved. Waiting time ends the caller's wait without creating another business request.

## Independent receiving

~~~python
received = adapter.receive(
    archive_path="/absolute/private/delivery/Datasette_Analysis_Workspace.zip",
    sha256=original_archive_sha256,
    destination="/absolute/private/received-customer-analysis",
    operation_id=original_receiving_operation_id,
)
~~~

receive calls the maintained restore_archive function with the complete original archive, exact SHA-256, separate destination and stable receiving operation. The original native receiver preserves subsequent customer edits when a completed receiving operation is repeated.

Open the received **Datasette customer Analysis** application with its original Analysis operation ID. Its saved source, customer queries, report definitions, native results and workbook remain editable. A deliberate later request or source observation can continue that same project and produce its retained successor export.

## Maintained source references

- [Datasette product](../../../../products/datasette/README.md) and [operating guide](../../../../products/datasette/OPERATING.md)
- [Customer Analysis operator and client](README.md)
- [Original source CLI](../datasette/cli.mjs), [workspace operations](../datasette/workspace.mjs) and [edition SDK](../datasette/editions.mjs)
- [Original Analysis workspace](../../sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_workspace.py), [query exports](../../sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_exports.py) and [report engine](../../sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_reports.py)

Copyright TokenJunkieLabs. MIT.


## Shared Analysis operation and interrupted business requests

A profile can reuse one running Analysis operation for multiple original business
requests. Each request retains its own source editions and the exact native view
name, immutable version ID and revision returned during source preparation.
Customer queries and reports use the original SQL reader with this explicit form:

```json
{
  "scope": "selected",
  "bindings": [
    {"name": "the_original_native_view", "version_id": "the_original_64_hex_version", "revision": 1}
  ]
}
```

The value belongs in the existing `expected_views` field. The native reader checks
every selected binding in the same SQLite read transaction that reads the rows.
Selected mode authorizes only those named views and their original immutable
physical tables. Adding an unrelated source does not change that selection; an
altered selected view or a query that reaches outside it produces the native
source-selection error. The ordinary list form still checks the entire workspace
view catalogue.

Native query results, complete export manifests and published reports retain the
selection. Complete query export reopens the original SQL with the same selection,
including after another request has prepared another edition. The complete
archive still carries the whole editable Analysis workspace and all retained
original sources.

The adapter submits native export with the exact requested `edition_id`.
The original Datasette operator uses its request ID as the actual export ID;
the bridge now derives and verifies that same identity. The native composer
selects the requested complete edition before snapshotting its operation record,
under the existing source/export owner. Replaying that export returns its retained
archive and edition even when the live workspace has moved to another request.
Submitting an existing export ID with another edition is rejected.

When two workflow workers reach the native source operator together, the adapter
waits on the existing owner and retries the same original request ID. SQL jobs keep
their own retained identities and source selection. A worker can stop between
preparation, SQL, publication and delivery, then resume after other requests have
completed.

An interrupted request created by the earlier full-catalogue bridge retains its
original job and export IDs. Its selected-source continuation uses separate
native job/publication identities and `Selected_` output names, with the
relationship recorded in `selectionContinuation`. Previously completed requests
continue to return their already retained complete result.

The independent receiving operation should exercise the actual business path:
complete request A, prepare a changed source edition for request B, reopen A's
original output, then interrupt a request between source preparation and export
and continue it after B. The source edition, selected views, query outputs,
published report and archive must remain attached to their respective original
requests.


## Original supplier CSV files in native Analysis

The bridge supports `source.kind: "csv"` for the actual published pricing and
catalogue files. It runs the installed supplier product's maintained
`parseCSV` function, retains its ordered columns and original row/line records,
and passes the complete original strings through the existing
`source_document`, ResponseDocument importer and Analysis composer. Source
handover explicitly declares `delivery.kind: "csv-source"`.

The input descriptor contains `path`, exact `bytes` and lowercase `sha256`,
the reviewed original `key` columns, an optional `columnMapping`, and
`source: {url, title, publisher, publisherEdition, license}`. The complete
publisher metadata uses `metadata: {path, bytes, sha256}`. A `parser` path can
select the installed `supplier-report.mjs`; otherwise it comes from
`delivery.supplier.component`. The configured parser SHA and actual parser
source remain bound to the original request.

Every CSV field enters the native importer as the original string. Blank charity
rates remain blank strings; an original `0` remains the published string `0`.
Any numeric conversion belongs in the explicit customer SQL or maintained supplier
rules. The native column profiles show the original representation. The original
CSV bytes, publisher metadata, complete parser result and source handover are
retained with the native edition and complete workspace archive.

Import time records when the native operation receives the local original file.
The publisher's edition date and retrieval metadata remain separate source fields.
The source record describes a retained original CSV; its lineage identifies its
real source URL, complete-file hash, metadata hash and maintained parser hash.

For the current Elite Digital Agency source family, the exact retained input is:

| Source | Business key | Original rows | Original bytes | Original SHA-256 |
| --- | --- | ---: | ---: | --- |
| Published pricing CSV | `name` | 23 | 3,558 | `6891cc62b1341ee0cdf601a78e9e04b6232f1c26cc1cdeb8f021a5edc1fa5dcb` |
| Services catalogue CSV | `url` | 29 | 4,964 | `c225a1e081f783ce20eaf5de222449c03a3d01130ebb9d123b29fcb3673034c9` |
| Publisher metadata JSON | Original data-package metadata | — | 3,780 | `6c758cf191a670985e7195752565c8d16169d6be8941f707a50ebd6638adefe2` |

The original public files are [published-pricing.csv](https://elitedigitalagency.io/data/published-pricing.csv),
[services-catalogue.csv](https://elitedigitalagency.io/data/services-catalogue.csv)
and [datapackage.json](https://elitedigitalagency.io/data/datapackage.json).
The retained edition is the publisher's August 12, 2026 data package, acquired on
October 12. The package records Elite Digital AI Solutions Ltd and CC BY 4.0.

Distinct price names can share a path. The named native source pair uses aliases
`prices` and `catalog`, then exact URL joins retain every price tier and every
catalogue entry. GBP amounts, one-off/month/free billing periods and original
from-price wording remain separate. Customer SQL can use
`{{source:prices}}`, `{{source:catalog}}`,
`{{column:prices:name}}` and `{{column:catalog:url}}` against those actual
native editions.


## Complete original supplier review and coverage delivery

[WORKFLOW_SUPPLIER_EXAMPLE.json](WORKFLOW_SUPPLIER_EXAMPLE.json) supplies the complete
paired CSV profile. Analysis receives the original prices as prices and the
original catalogue as catalog. Six native SQL sections retain both complete
tables, the exact publisher-URL join, all catalogue coverage, the original unmatched
price records and a parameter-selected billing period. Native query/export
manifests and report publications use the selected source editions described above.

The same operation runs the maintained supplier CLI and catalogue-coverage
component from [products/conapi/supplier-report](../../../../products/conapi/supplier-report/).
Their original comparison, review, coverage and export implementations produce the
supplier part of the complete delivery.

### Select the original review and its source roles

The additional trusted configuration is:

~~~json
{
  "delivery": {
    "supplier": {
      "component": "/absolute/installed-source/products/conapi/supplier-report",
      "workspace": {
        "path": "/absolute/private/supplier/original-reviewed-workspace.json",
        "bytes": 12345,
        "sha256": "ACTUAL_COMPLETE_ORIGINAL_WORKSPACE_SHA256"
      },
      "tableName": "supplier_feed_accepted",
      "sourceBindings": {"prices": "candidate"},
      "coverage": {
        "pricingAlias": "prices",
        "catalogueAlias": "catalog",
        "pricing": {"path": "/absolute/private/source/published-pricing.csv", "bytes": 3558, "sha256": "6891cc62b1341ee0cdf601a78e9e04b6232f1c26cc1cdeb8f021a5edc1fa5dcb"},
        "catalogue": {"path": "/absolute/private/source/services-catalogue.csv", "bytes": 4964, "sha256": "c225a1e081f783ce20eaf5de222449c03a3d01130ebb9d123b29fcb3673034c9"},
        "metadata": {"path": "/absolute/private/source/datapackage.json", "bytes": 3780, "sha256": "6c758cf191a670985e7195752565c8d16169d6be8941f707a50ebd6638adefe2"},
        "origin": "https://elitedigitalagency.io",
        "sourceMetadata": {
          "publisher": "Elite Digital AI Solutions Ltd",
          "publisherEdition": "2026-08-12",
          "acquiredAt": "2026-10-12",
          "pricingURL": "https://elitedigitalagency.io/data/published-pricing.csv",
          "catalogueURL": "https://elitedigitalagency.io/data/services-catalogue.csv",
          "metadataURL": "https://elitedigitalagency.io/data/datapackage.json",
          "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)"
        }
      }
    }
  }
}
~~~

The workspace byte count and hash above are descriptor positions; configure
fills them from the complete original file. sourceBindings is an explicit map
from an existing native source alias to the supplier workspace's baseline or
candidate role. At least one role is required. The bridge reads the original
CLI manifest and requires that role's complete CSV hash to equal the source
edition's original CSV hash. It retains the corresponding edition, native
collections and original manifest member. A second CSV alias can bind the other
role when both dated editions belong in the Analysis report.

coverage.pricingAlias and coverage.catalogueAlias select the corresponding
Analysis editions. Their default values are the primary source alias and
catalog. Each coverage CSV must exactly match that edition's original CSV hash.
When an edition declares publisher metadata, its metadata hash must match the
complete coverage metadata file.

The original supplier requestId remains the identity selected by its own review
workspace. It can differ from the external API/JMS requestId. The delivery
preserves both, the original comparisonId, revision, actual status, and the
external correlationId. supplier-workflow-link.json records their relationship,
the original workspace and manifest hashes, exact source-role bindings, selected
Analysis views, original business parameters and coverage identities.

For a later source edition, select its actual CSV and corresponding original
supplier comparison/review workspace. The adapter rejects an old reviewed
candidate when its source differs from the newly prepared native source. A
parameter-only report successor can use the same unchanged original review and
source files; it receives its own business request, report and workflow link.
Changing a review decision similarly requires the actual exported successor
workspace, with its native revision preserved.

### Configure and run the complete paired source

Use the native Analysis listener and actual operation ID from **Native preparation
for the receiving profile** above. The selected installed distribution includes
the complete supplier component and its original CSV parser. Bind the actual
files and existing native operation:

~~~sh
python3 workflow_cli.py configure \
  --template WORKFLOW_SUPPLIER_EXAMPLE.json \
  --source-csv /absolute/private/source/published-pricing.csv \
  --related-csv catalog=/absolute/private/source/services-catalogue.csv \
  --source-metadata /absolute/private/source/datapackage.json \
  --related-metadata catalog=/absolute/private/source/datapackage.json \
  --supplier-component /absolute/installed-source/products/conapi/supplier-report \
  --supplier-workspace /absolute/private/supplier/original-reviewed-workspace.json \
  --supplier-table-name supplier_feed_accepted \
  --supplier-pricing /absolute/private/source/published-pricing.csv \
  --supplier-catalogue /absolute/private/source/services-catalogue.csv \
  --supplier-metadata /absolute/private/source/datapackage.json \
  --analysis-workspace /absolute/private/customer-analysis \
  --operation-id ORIGINAL_32_CHARACTER_LOWERCASE_HEXADECIMAL_ID \
  --source-archive /absolute/private/releases/complete-source.zip \
  --output /absolute/private/supplier/workflow-configuration.json
~~~

The template's exact original public-file hashes select the retained August 12
edition. For another dated source, update the template's original descriptors,
source metadata and actual review selection together. configure verifies
predeclared hashes and retains every complete selected file; it preserves
sourceBindings and the coverage aliases.

Use the existing supplier application's FIELD_GUIDE.md and CLI to create or
continue the original comparison and review workspace before selecting it. The
adapter consumes the whole retained native workspace and invokes the source-owned
export command exactly:

~~~sh
node /absolute/installed-source/products/conapi/supplier-report/supplier-report-cli.mjs export \
  --workspace /absolute/private/supplier/original-reviewed-workspace.json \
  --out-dir /absolute/private/supplier/new-complete-export \
  --table-name supplier_feed_accepted
~~~

The native CLI creates a new directory and writes its manifest after the complete
export. The workflow performs that export inside its own original request
directory and retains all native stdout, stderr and attempt IDs. A complete
manifest is reused after interrupted transport. An incomplete attempt remains
retained while a later attempt uses a new private export directory.

An original workflow request for this profile can be saved as:

~~~json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "elite-supplier-review-original",
  "correlationId": "elite-supplier-review-conversation",
  "profile": "elite-supplier-review",
  "parameters": {"period": "month"}
}
~~~

Then retain and execute that same original request:

~~~sh
python3 workflow_cli.py accept \
  --workspace /absolute/private/supplier/workflow \
  --request /absolute/private/supplier/original-request.json
python3 workflow_cli.py run \
  --workspace /absolute/private/supplier/workflow \
  --request-id elite-supplier-review-original \
  --configuration /absolute/private/supplier/workflow-configuration.json
python3 workflow_cli.py export \
  --workspace /absolute/private/supplier/workflow \
  --request-id elite-supplier-review-original \
  --destination /absolute/private/supplier/Complete_Supplier_Project.zip
~~~

The existing installed wrapper also supports these commands after its actual
--runtime-workspace, --runtime-directory, --runtime-id and --installation-id
selection, followed by -- workflow and the command arguments. The full installed
invocation and independent successor sequence are in
[WORKFLOW_RECEIVING.md](WORKFLOW_RECEIVING.md). The native supplier component is
available through its installed starforge supplier-report command.

### Read and receive every original file

The maintained supplier_attachment_files helper validates the complete original
CLI manifest and every declared sibling file. Its original required outputs are:

| Original filename | Retained native work |
| --- | --- |
| workspace.json | Complete editable supplier comparison and review |
| report.json, report.html | Full original reconciliation outcome and readable report |
| rules.json | Actual selected business rules |
| baseline-source.csv or .json | Complete original baseline input |
| candidate-source.csv or .json | Complete original candidate input |
| changes.csv | Every original comparison/change record |
| accepted.csv, accepted.sql, lineage.json | Accepted records, native SQL and lineage when the actual status is reviewed |
| manifest.json | Complete original member declarations and native request/revision identity |

Every additional member declared by the native CLI is carried unchanged. The
bridge also attaches original-supplier-workspace.json, the full original
coverage pricing/catalogue CSV files and publisher metadata, all three native
catalogue-coverage.json, .csv and .html outputs, and the workflow link.

Coverage runs the maintained catalogueCoverage, coverageCSV and coverageHTML
functions. The report retains all original source strings, columns and row
records, exact publisher provenance, strict origin/path join policy, matches,
unmatched records, unresolved candidates and exceptions. The complete publisher
metadata is preserved as both original JSON and original text. Amounts retain GBP,
billing periods and published from-price wording. Blank charity prices and
published zero prices remain distinct.

The outer result prefixes these attachment labels with Supplier_Report_ to
avoid native delivery-name collisions. result.supplier.files maps each outer
label to its original filename. The outer receiver places those exact files
together under delivery/supplier/, preserving the original manifest's filenames
and bytes. The complete selected software archive carries the supplier parser,
comparison/review engine, original browser/CLI, coverage source and operating
guides.

Use the outer workflow_cli.py receive command from [WORKFLOW.md](WORKFLOW.md) to
reopen the original complete customer project and its Analysis archive in a
separate installation. The supplier files then form their original native
package. Open its retained workspace through the installed supplier application,
make the actual intended rule or review change, and export the original native
successor. Bind that successor workspace and its exact source CSV into a new
workflow request with parentRequestId pointing to the original business request.
The new project carries the original delivery, new native supplier revision,
selected Analysis report and complete original source-to-successor relationship.

The actual supplier status is returned independently of analysis.status.
A saved comparison still awaiting review remains visible with its complete
sources, rules and outcome. A reviewed result carries the source-owned accepted
CSV/SQL/lineage set. The adapter preserves those native decisions and identities
through delivery, receiving and re-export.


### Original CSV baseline products

New original CSV editions select the native original-csv-strings-v1 product
profile. Their source-wide report and workbook describe the actual original
columns, publisher, edition, local import time, original strings, blanks and
published zero values. The pricing source keeps its declared GBP amount fields,
billing periods and display wording with each original row. The catalogue
baseline describes its own original catalogue fields.

New baseline report jobs pin the native edition's complete selected collection
bindings. They can resume after an unrelated source adds other views to the
same Analysis operation. Existing saved report/workbook definitions and already
pinned job inputs retain their original identity. Completed native source
products remain available in the complete received workspace.

The original baseline report/workbook and all six customer SQL sections belong
in the independent operator/browser review described in
[WORKFLOW_RECEIVING.md](WORKFLOW_RECEIVING.md).
