# Native agent customer analysis

The original native MCP buyer can use completed data in the same customer analysis workspace as the browser and Python application. The agent selects an operator-registered workspace alias and retained source IDs.

| Customer action | Original implementation |
| --- | --- |
| Dataset source, acquisition, recovery and final delivery | Native MCP datasets → SF88 dataset session → SF100 room |
| Source registration, preview, import and SQL data | AnalysisWorkspace and DatasetDatabase |
| Complete query export, cancellation and retained files | AnalysisExports → QueryExport |
| Edition comparison and selected-view history | DatasetChanges and the original view CAS |
| Multi-section report, publication and reproducible export | AnalysisReports |
| Durable operations and restart | Existing analytical job table, process lease and worker |
| Agent discovery and calls | Existing SF43 MCP tool and native workspace dispatcher |

The analytical adapter connects to the host's already-running original analysis service. The browser and agent see the same jobs, selected views, query recipes, comparisons and reports. It does not acquire data, authorize payments, launch another database owner or replace the original engines.

## Host setup

Use the current complete source/runtime containing native datasets, the Python analysis package, full query exports and this adapter. Retain the matching original Node runtime needed to reopen SF88/SF100. See the [Python workspace guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/WORKSPACE.md) and [native dataset guide](DATASETS.md).

Register any retained API responses using the existing Python command before starting its one workspace process. For an original native MCP result:

~~~bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/customer-analysis \
  --checkout /absolute/stellar-forge-checkout \
  response --name regional_sales --input-kind mcp \
  --manifest /absolute/original-result.meta.json
~~~

The original buyer/SF31, StreamDelivery and other supported sources keep their own native readers and registration options. Already imported editions, queries and reports can be used without the source runtime. A new source preview/import needs its retained source files and any required original runtime.

Start the original service in the host/network namespace where the native adapter runs:

~~~bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/customer-analysis \
  --checkout /absolute/stellar-forge-checkout serve
~~~

The service keeps its exclusive workspace lease and writes a private launch record. Keep its capability private; do not paste it into prompts or source registrations. Register the running service with the native buyer:

~~~bash
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs analysis-register \
  --dir /absolute/private/native-mcp-buyer \
  --name customer \
  --database /absolute/private/customer-analysis
~~~

The host checks the private directory, analytical workspace ID, current local capability and database path returned by that service. Registration retains the exact native workspace, analytical ID and database directory. Repeating the same registration reuses it. An alias cannot silently change databases; use another alias for a recovered copy in another directory.

No capability or launch URL is retained in the registration. Every call reads the current private launch record and verifies the original service identity. Restart the Python service normally; the same alias follows its new address and capability.

The original native MCP server launch is unchanged. Its tool is still named **sf43_discover_review_and_pay**; **action: analysis** selects this analytical path. The pure native-analysis-schema.mjs supplies all operation-specific fields and requirements to that original tool descriptor.

## Calls and discovery

~~~json
{
  "action": "analysis",
  "analysisOperation": "workspaces"
}
~~~

After selecting a host-registered alias:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "state",
  "analysisRequest": {}
}
~~~

The response contains schema, analysisWorkspace, operation and the original operation's result. Local paths, arbitrary HTTP routes, capabilities and process commands are not model inputs.

For a host application, the same native dispatcher is callable directly:

~~~js
import {openNativeWorkspace} from './stellar-forge/mcp-paid-agent/native-workspace.mjs';

const native = await openNativeWorkspace(hostConfiguredNativeDirectory);
try {
  const response = await native.call({
    action: 'analysis',
    analysisWorkspace: 'customer',
    analysisOperation: 'state',
    analysisRequest: {}
  });
  console.log(response.result);
} finally {
  await native.close();
}
~~~

Closing the adapter closes its own requests/readers. The original analytical server and jobs remain owned by their host.

## Complete dataset-to-report workflow

### Attach the actual completed delivery

Use the original native dataset history/status/delivery actions to select the exact acquisition. Finish its original delivery before attaching it. This analytical operation never creates missing pages.

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "attach-dataset",
  "analysisRequest": {
    "acquisition_id": "the-retained-native-acquisition-id",
    "name": "received_inventory",
    "expected_revision": 0
  }
}
~~~

Revision zero creates an unused source alias. Read sources and pass the actual current revision when intentionally replacing one.

The host resolves the acquisition ID through the original completedDataset method, which verifies its COMPLETE session, configuration, source binding and finalized SF100 files. Immediately before the original source-registration transaction, the Python adapter reopens that same existing room through SF88/SF100, requires zero appended pages, and checks unchanged original session/manifest identities. The source record retains native_delivery provenance.

### Import and select the reviewed edition

Start import with a stable 32-character lowercase hexadecimal ID and the exact returned source revision:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "import",
  "analysisRequest": {
    "id": "10000000000000000000000000000001",
    "source": "received_inventory",
    "source_revision": 1
  }
}
~~~

Example IDs here are placeholders: generate a new ID for a new operation and retain it for recovery. Use job with that same ID until the original status is terminal. COMPLETE returns its immutable version_id, original source identity, table and columns. Optional columns_text is a JSON object mapping original fields to SQL column names through the existing importer.

Read version and manifest to review the original query filters, projection, ordering, snapshot and receipts. Activate the exact edition:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "activate",
  "analysisRequest": {
    "name": "inventory",
    "version_id": "EXACT_64_CHARACTER_VERSION_ID_FROM_IMPORT",
    "expected_revision": 0
  }
}
~~~

Use the actual current revision for an existing view. The original compare-and-swap preserves history and rejects stale selections.

For a changed edition, compare accepts the reviewed view/revision, base_version_id, candidate_version_id and explicit unique non-null typed keys. Comparison pages retain source scope, schema/value changes and row positions. Select records the exact comparison review and atomically selects its candidate through the original view CAS.

Changing a five-row inventory query to a three-row widget filter does not establish that two upstream stock records were deleted. Keep the different query/projection scope in the review note; original source facts and decisions flow into the report.

### Save SQL and export its complete output

For the merchant inventory example:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "save-query",
  "analysisRequest": {
    "name": "inventory_by_availability",
    "expected_revision": 0,
    "sql": "SELECT available, COUNT(*) AS records, SUM(units) AS units FROM inventory GROUP BY available ORDER BY available",
    "parameters_text": "[]",
    "max_rows": 1000
  }
}
~~~

Read state after reviewing the selected data. Copy its entire original views array into a query request's expected_views, along with the actual SQL, parameters_text, max_rows and stable job ID. The original read-only SQL transaction rejects a changed selection. Job pages retain typed values and the explicit truncated flag.

Use parameters_text JSON to preserve signed 64-bit integers and fixed-decimal strings. SQL cells retain original typed-text encoding. Raw unsafe integers in source metadata use {"encoding":"json-integer","text":"..."} in the MCP response; original stored bytes and hashes remain unchanged.

For a complete extract, call query-export with the COMPLETE query ID and its original result_sha256:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "query-export",
  "analysisRequest": {
    "id": "10000000000000000000000000000002",
    "query_id": "EXACT_32_CHARACTER_COMPLETED_QUERY_ID",
    "result_sha256": "EXACT_64_CHARACTER_QUERY_RESULT_SHA256",
    "label": "Reviewed inventory extract",
    "formats": ["jsonl", "csv", "sqlite"],
    "timeout": 300,
    "spreadsheet_safe": true
  }
}
~~~

The original controller binds the saved SQL, exact parameters and reviewed views, then streams complete outputs. Optional positive max_rows and max_output_bytes are explicit ceilings; reaching a ceiling is not a complete export.

Use job or query-exports for progress and cancel-query-export for original worker cancellation. A published complete native manifest remains complete after a late cancellation or interruption.

After COMPLETE, query-export-file reads the job's selected manifest.json, rows.jsonl, rows.csv or rows.sqlite3. It checks the original job/request/source identity and native manifest, selects `analysis-query-exports/JOB_ID` under the host-registered customer database, and reuses the shared verified saved-file descriptor/hash cache. A copied workspace keeps the earlier producer directory in its original result; that provenance never selects a file path. Unchanged file ranges do not rerun SQL, copy the output or hash/download its entire payload again. Preserve the returned SHA256 across ranges.

### Retain and publish a complete report

A saved report pins 1–12 original query revisions:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "customer",
  "analysisOperation": "save-report",
  "analysisRequest": {
    "name": "inventory_review",
    "id": "10000000000000000000000000000003",
    "expected_revision": 0,
    "title": "Received inventory review",
    "introduction": "The selected source is the original delivered inventory query described in its retained manifest.",
    "sections": [
      {
        "title": "Availability and units",
        "note": "Counts use the explicitly selected received query.",
        "query_name": "inventory_by_availability",
        "query_revision": 1
      }
    ]
  }
}
~~~

Sections can override exact parameters_text. Start report using a stable ID and the returned name, revision, definition_sha256 and full reviewed expected_views. The original engine reads all sections in one SQLite snapshot, retains source editions/data-review decisions, and commits completed rows and result identity together. Section truncation remains explicit.

Use report-read to review each section and its original result hash/publication_revision. Publish accepts report_id, a new stable id, exact result_sha256, expected_revision and note. It freezes the retained completed report without rerunning queries. Publications returns the immutable records and their SHA256 values.

Start report-export with the chosen publication_id, publication_sha256, new job id and html/json/csv format. CSV uses the original multi-section ZIP with metadata and section files. Read the COMPLETE result through file. Reports, comparison exports and backups use the same original saved-file reader.

Every file response identifies the full file and returns at most 64 KiB of base64 bytes. Continue with nextByteOffset, preserving sha256 from the first reply.

## Existing API responses and streams

Sources lists host-registered response aliases/revisions. Response-source discovers clearly labelled samples, collections and field hints. Response-preview accepts the explicit original mapping; for an actual response with a rows collection:

~~~json
{
  "id": "10000000000000000000000000000004",
  "source": "regional_sales",
  "source_revision": 1,
  "mapping": {
    "collection": "/rows",
    "columns": [
      {"name": "region", "pointer": "/region", "type": "text"},
      {"name": "events", "pointer": "/events", "type": "integer"},
      {"name": "total", "pointer": "/total", "type": "text"}
    ]
  }
}
~~~

Put this request under analysisOperation response-preview. The collection/fields must match the actual retained response. The original projection exhausts all rows and retains its precise manifest/preview SHA.

Response-import uses the COMPLETE preview_id and exact preview_sha256. An incomplete original stream also needs explicit allow_incomplete:true; its original status remains attached to the imported edition. A fixed-decimal value such as 599.010000 can stay TEXT through SQL, full exports, reports and backup.

The following selection/query/report workflow is the same as for datasets.

## Operation and recovery behavior

| Situation | Continue through the original state |
| --- | --- |
| Connection lost while starting a job | Read job using the same ID. A lost reply does not require a replacement acquisition or analytical operation. |
| Job already COMPLETE | Read its original retained result/files. |
| Same report, selection or publication request repeated | Original ID/request hash returns the historical result; changed input under that ID is rejected. |
| Source/view revision changed | Read the current original selection, review it, then intentionally submit the new revision. |
| Save-query reply uncertain | Read saved-query and its revision first. This original API uses revision CAS, not a request ID. |
| Python service restarted | Start the same original database; the adapter reads its new launch record and checks workspace identity. |
| Native adapter closes | Its requests close; the host-owned analysis process keeps its original lifecycle. |
| Full export interrupted | The original controller adopts a complete native manifest without query replay; unfinished work stays explicitly failed/cancelled/interrupted. |

Dataset source aliases are current pointers. If an alias changed after an older import, reopen that original job ID for its historical outcome rather than reconstructing it from today's alias.

## Backup and reopen

Start backup with a stable ID and read its COMPLETE native SQLite file through file. It contains imported rows, exact source manifests, mappings, selected-view history, recipes, comparisons/decisions, reports and publications.

The original native session/page/evidence/SF100 files, raw response files, full-query export directories, generated report files and native MCP alias registrations remain outside the SQLite backup. Retain them separately for new source work or existing external file downloads.

Save the verified backup bytes as datasets.sqlite3 in a new private directory, then start the original AnalysisWorkspace there. Register a new native analytical alias for that running service. The restored database preserves its original analytical identity and histories.

Copied full-query exports and customer workbooks can reopen their existing bytes when their complete original `analysis-query-exports/JOB_ID` or `analysis-workbooks/BUILD_ID` directories are retained under the registered receiving database. The adapter derives local paths from that selected database and validated job ID, preserves the producer location in the original result, and checks the original manifest and file digests. Copied complete report/change exports and SQLite backups likewise resolve from the selected receiving database and their original job, filename and file-hash bindings. A database backup alone does not restore external export or workbook files.

The original database service remains the single process/worker owner. This integration needs no additional scheduler, proxy, lock service or recovery daemon.


## Customer workbooks

Native agents can also use the original customer Workbooks application through this same registered analysis service. The [complete native workbook workflow](WORKBOOKS.md) covers retained complete query/report sources, typed sheet mappings, saved definition review, original full builds and cancellation, verified file receiving, recurring-edition review/save and historical reopening. It uses the existing workbook engine and its original source/definition/build identities. The host must select the complete maintained workbook and recurring-edition source with the original Python workbooks extra; no additional analysis service or package producer is introduced.

## Complete portable workspace delivery

Use the [native portable workspace workflow](ARCHIVES.md) to export and receive the original SQLite snapshot together with its retained query-export, report and workbook files. The same analysis host exposes complete selection review, export history, progress, cancellation, exact same-ID recovery and verified file ranges. The installed MCP download client retains durable partial transport; the original Python receiver validates and atomically publishes the complete customer workspace for offline and live reopening.


## Saved Research documents and managed outputs

The native agent can receive an existing Research document purchase, retained
managed Pipelines output, or saved dossier edition into this same Analysis
workspace. The original Research client verifies and captures the complete
selected edition; the original response-source registration, Analysis job,
preview/import, SQL, full export, workbook and portable archive continue from
that source.

### Configure the original host connection

Start the original Analysis service with its private Research registry, using
the complete maintained Python and Node source:

~~~bash
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer/analysis \
  --checkout /work/installed-merchant-source \
  --research-connections /private/research-connections.json \
  serve --port 0
~~~

The registry uses schema
`stellar-forge.analysis-research-connections.v1` and the
existing private Research connection files. Each entry has a name, label,
absolute connection-file path and actual expected Research workspace ID.
The [original Research intake guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/RESEARCH_INTAKE.md)
contains its complete configuration and browser/CLI workflow.

Register this running Analysis service under the normal native alias described
above. `research-connections` exposes only the configured names,
labels and exact Research workspace IDs. All eight new operations use the
same native `action: analysis` interface and the same
`analysisWorkspace` alias. The selected Analysis service owns
its original capability and local jobs.

| Native operation | Original result and next use |
| --- | --- |
| `research-connections` | Configured aliases, exact workspace IDs, and original capture availability |
| `research-dossiers` | Original dossier inventory with its complete snapshot/next cursor |
| `research-sources` | Saved Documents purchases/editions or existing Pipelines outputs/editions |
| `research-review` | The exact selected edition and its original digest, provider and source metadata |
| `research-elements` | Bounded pages from that reviewed edition, with explicit page/type/text filters |
| `research-capture` | Original Analysis job admission or same-request recovery of the complete source |
| `research-captures` | Retained original capture requests, progress and compact completion identities |
| `research-cancel` | Cancellation request for that original local capture worker |

Use the existing `job` operation to read the complete capture
result. Its native ID is the same 32-character lowercase hexadecimal ID
retained in the capture request.

### Review the saved original selection

These examples use the original host SDK dispatcher. The caller selects the
actual returned connection and dossier; the variable names below are not
new identifiers or provider credentials.

~~~js
const call = async (analysisOperation, analysisRequest = {}) =>
  (await native.call({
    action: 'analysis',
    analysisWorkspace: 'customer',
    analysisOperation,
    analysisRequest
  })).result;

const configured = await call('research-connections');
// Select the intended returned connection using its actual name.
const connection = configured.connections.find(
  item => item.name === selectedConnectionName
);
if (!connection) throw new Error('Select a configured Research connection.');
const base = {
  connection: connection.name,
  expected_workspace_id: connection.workspace_id
};

const first = await call('research-dossiers', {...base, limit: 20});
const nextCursor = first.result.next;
if (nextCursor) {
  const next = await call('research-dossiers', {...base, ...nextCursor});
  // next.result belongs to the same original inventory snapshot.
}
~~~

The native outer envelope has its own `result` field. The four
Research read operations then preserve the original intake wrapper:
`{connection, workspace_id, dossier_id?, family?, result}`.
The inventory is therefore `first.result` after the helper
above unwraps the native outer envelope. Preserve the entire original
inventory `next` object. A nonzero offset requires its exact
snapshot; a changed inventory is returned by the original service as a
reviewable error.

Read sources using the actual dossier ID and family:

~~~js
const picked = {
  ...base,
  dossier_id: selectedDossierId,
  family: selectedFamily
};
const listed = await call('research-sources', {...picked, limit: 20});
~~~

The original dossier ID is `d_<UUID>`, including its hyphens.
Use the original returned Documents or Pipelines cursor as
`after` for another saved-source page. Managed provider job,
file and node IDs remain the native values returned with that source.

Select exactly one of these source forms:

| Family | Original `selection` |
| --- | --- |
| Documents | `{purchaseId: 'u_<64 hex>'}` or `{editionId: 'e_<64 hex>'}` |
| Pipelines | `{operationId: 'up_<64 hex>', outputId: 'out_<64 hex>'}` or `{editionId: 'e_<64 hex>'}` |

Use actual returned IDs in place of the notation. A selection keeps its
native shape and family; it is never regenerated from row order.

~~~js
const selected = {...picked, selection: selectedOriginalSource};
const reviewed = await call('research-review', selected);
const editionSha256 = reviewed.result.editionSha256;

const page = await call('research-elements', {
  ...selected,
  expected_edition_sha256: editionSha256,
  offset: 0,
  limit: 25,
  page: '',
  type: '',
  query: ''
});
~~~

The exact review digest is
`reviewed.result.editionSha256`. Element filtering changes the
displayed page. Capture retains the complete selected original edition and
its full source closure. The native adapter preserves the original pagination
and enforces its ordinary 256 KiB tool-result boundary; use smaller element
or history pages when the returned metadata is large.

### Capture, preview and import the complete source

Read the original Analysis `sources` or `state`
before choosing the source alias revision. Revision zero creates a new alias.
Retain the complete request below, including its ID, title and full ISO capture
time with timezone, before dispatch. Use the actual current source revision
when intentionally replacing an existing alias.

~~~js
const exactCapture = {
  id: retainedIds.capture,
  ...selected,
  expected_edition_sha256: editionSha256,
  name: reviewedAnalysisSourceName,
  expected_revision: reviewedSourceRevision,
  title: reviewedSourceTitle,
  captured_at: retainedCaptureTimestamp
};

const started = await call('research-capture', exactCapture);
const captured = await call('job', {id: exactCapture.id});
~~~

Read that same job until it reports its actual terminal state. On COMPLETE,
the original result contains:

| Result field | Meaning |
| --- | --- |
| `connection`, `workspace_id`, `dossier_id`, `family`, `selection` | The original reviewed Research selection |
| `edition_sha256` | The exact captured edition digest |
| `document_id` | Original registered source-document identity |
| `source` | Original Analysis source name, revision and retained provenance |
| `registration_current` | Whether that historical capture is still the selected source revision |
| `mapping` | Producer's complete original 18-column typed response mapping |
| `receipt` | Original source-producer receipt and exact provider/capture identity |
| `verification` | Original document ID, files, bytes, row count and completeness |

The existing native source projection removes local host paths while retaining
the document ID and source provenance. A previous capture can remain complete
after its source alias advances; use its exact retained source revision for
the following preview.

Once that original capture is COMPLETE, continue through the existing native
response operations:

~~~js
const source = captured.result.source;
const previewRequest = {
  id: retainedIds.preview,
  source: source.name,
  source_revision: source.revision,
  mapping: captured.result.mapping
};
await call('response-preview', previewRequest);
const preview = await call('job', {id: previewRequest.id});

// After preview is COMPLETE, use its actual retained preview digest.
const importRequest = {
  id: retainedIds.import,
  preview_id: preview.id,
  preview_sha256: preview.result.preview_sha256
};
await call('response-import', importRequest);
const imported = await call('job', {id: importRequest.id});
~~~

The complete preview exhausts the mapped original records before import.
Use its actual completeness status and the original explicit incomplete-source
option when applicable. Select the returned immutable imported version
through the ordinary `activate` operation, then use the
existing reviewed SQL, full query export, workbook and archive operations.
The [workbook guide](WORKBOOKS.md) and [complete portable archive guide](ARCHIVES.md)
carry those original selected-version, query-result and complete-file bindings.

### Recover the same original capture

A lost native tool reply leaves the exact original capture request as the
recovery unit. Read `job` using its retained ID first. If
accepted, that job contains the original request and actual status/result.
Explicitly repeating `research-capture` with every unchanged
request field resumes the existing original capture. A different selection,
digest, source revision or timestamp requires a new reviewed request.

The source-registration transaction is authoritative. If it completed before
the job result reply was retained, the original intake searches its registered
source closure first and completes that same capture. A matching restored
source can finish this recovery with the Research connection unavailable.

`research-captures` pages original history by its returned
`next_before` sequence. It keeps compact document/digest/
verification results; `job` opens the complete selected
receipt and mapping.

~~~js
await call('research-cancel', {id: exactCapture.id});
const observed = await call('job', {id: exactCapture.id});
~~~

Cancellation belongs to the existing local capture worker and its original
Research-client calls. A completed source registration remains available and
complete. Closing the native MCP adapter drains its own requests through the
existing Analysis lifetime; the host's service and saved jobs retain their
normal ownership.

For a portable delivery, use the original whole-workspace archive. It includes
the registered original source documents, exact mapping and imported data,
capture history, selected original query/workbook outputs and their
manifests. The restored Analysis service can reopen those local documents
under a newly registered native workspace alias.
