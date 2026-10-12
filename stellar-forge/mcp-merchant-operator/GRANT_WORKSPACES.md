# Grant planning, delivery and forecasts through Merchant MCP

These tools operate the original SF47 grant workspace. The original Python service owns its saved plans, operating cases, source attachments, work records, invoices, cash observations, reviews and forecasts. The Merchant client uses that service's authenticated HTTP API and its existing managed launch reader.

An agent can inspect the same case that the browser displays, preview a dated remaining-work forecast, save the exact reviewed result, export the complete case and receive it in another declared workspace. Paid invoice allocations, native asset amounts, quoted commercial receipts and conditional grant funding keep the original engine's meaning.

## Connect the original workspace

Use the same installed source edition for the Merchant client and the selected **Grant planning and delivery** application. A running Applications instance is borrowed: Merchant MCP does not take its database lock or stop that instance. If the host explicitly allows startup, merchant_grant_open can launch the same original managed grant service when the workspace is closed. The original workspace.lock prevents a second SQLite owner.

The host supplies a private connection file. All paths resolve against that file, and only host-declared aliases are available in tools.

~~~json
{
  "schema": "stellar-forge.sf47-workspace-connection.v1",
  "workspaces": {
    "grant": {
      "label": "Original grant delivery",
      "directory": "./grant",
      "pythonExecutable": "/usr/bin/python3",
      "allowStart": true,
      "inputs": {
        "original-case": {
          "file": "./received/original-operating-case.zip",
          "kind": "case",
          "mediaType": "application/zip"
        },
        "forecast-assumptions": {
          "file": "./received/forecast-inputs.json",
          "kind": "forecast-inputs",
          "mediaType": "application/json"
        }
      }
    },
    "receiving": {
      "label": "Received operating cases",
      "directory": "./receiving",
      "pythonExecutable": "/usr/bin/python3",
      "allowStart": true
    }
  }
}
~~~

Keep the connection file mode 0600, and workspace directories and receiving parents mode 0700, owned by the operator. An optional scenarioFile selects the original source scenario for an empty workspace. Existing plans keep their original scenario and revision history. An input may declare sha256; the client then rejects a changed file. Otherwise inspect its actual current SHA before an import or forecast preview.

From the selected source root, initialize the existing Merchant configuration:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-grant-workspaces \
  --dir /srv/stellar/grant-merchant \
  --connection /srv/stellar/grant-connection.json

node stellar-forge/mcp-merchant-operator/stdio.mjs \
  --config /srv/stellar/grant-merchant/merchant-mcp.json
~~~

An existing Merchant configuration can instead add the grantWorkspaceConnection key with the absolute connection-file path. The original release store, exports directory and all other configured products remain in that same configuration.

merchant_grant_workspaces lists aliases, labels, source-selection hashes and startup permission. merchant_grant_open accepts the selected alias and optional exact expectedSelectionSha256. Opening reads the original private managed-launch.json, verifies the source selection and executed source, and authenticates the actual /api/access listener with its original PID and instance identity.

The service's access token remains in the original private workspace. merchant_grant_browser returns the original access-fragment URL when an operator needs to continue in the browser. Treat that URL like the original private access file.

## Read the saved plan and operating case

| Tools | Original result |
| --- | --- |
| merchant_grant_plans, merchant_grant_plan | Saved plan summaries; current or selected immutable revision with original scenario and reports. |
| merchant_grant_plan_history | Original plan revision history. |
| merchant_grant_cases, merchant_grant_case | Existing case summaries and the full pinned plan, record collections, sources, reviews, forecasts and portfolios. |
| merchant_grant_case_report | Original invoice allocations, native assets, delivery measures and grant-stage reporting. |
| merchant_grant_case_history | One native event-history page, with the original cursor and page result. |
| merchant_grant_forecasts, merchant_grant_forecast | Immutable forecast summaries or the entire saved forecast and current source-change comparison. |
| merchant_grant_portfolios, merchant_grant_portfolio | Saved resource/date allocations, their original forecast, alternatives and current source comparison. |
| merchant_grant_review | Complete original saved business review and its source snapshot. |

Read the original planId and current revision, or the original caseId and program.version, before a mutation. An operating case remains pinned to its selected original planning revision.

### Complete snapshots and array pages

Every successful native read or mutation normally returns a retained snapshot record:

~~~json
{
  "schema": "stellar-forge.sf47-agent-snapshot.v1",
  "id": "snapshot-<original UUID>",
  "workspace": "grant",
  "source": {
    "instanceId": "<actual original launch>",
    "selectionSha256": "<actual source selection>"
  },
  "file": {
    "name": "original-response.json",
    "bytes": 123456,
    "sha256": "<exact original response SHA256>",
    "contentType": "application/json; charset=utf-8"
  },
  "value": {
    "records": {
      "work": {"$originalArray": "/records/work", "count": 42}
    }
  }
}
~~~

The real response includes the actual native file size, hash, launch and result. This example shows the shape only. Scalar values retain their original JSON types; financial amounts that the original engine represents as strings remain strings.

The compact value uses explicit references for arrays and large values. The exact original HTTP body is retained in full. Use merchant_grant_snapshot with pointer "/program" to read selected original metadata; merchant_grant_rows with the snapshot ID, exact expectedSha256, an array pointer, offset and limit to read rows; or merchant_grant_file_read to download the complete exact response.

If the original response succeeds but local file retention fails, the reply keeps that known original result, its source, exact response size and SHA256. It explicitly returns retention.state FAILED, id null and no fileRead handle. Restore local storage and repeat the identical native request ID and payload to retain the original saved result. This differs from GRANT_RESULT_UNCERTAIN, where the original HTTP outcome is unknown.

Rows return the original array count, selected rows and nextOffset. A page is at most 200 rows and approximately 48,000 bytes. A single larger row is identified explicitly with its original index and pointer; inspect its nested fields or download the full file. JSON pointers use ~0 for a tilde and ~1 for a slash. Array indexes are zero-based.

Snapshot paging does not replace native history paging. If the original case_history response indicates another history page, call merchant_grant_case_history with that original next cursor, then page its returned snapshot as needed.

## Save a reviewed forecast

1. Read the original case and record its current version.
2. Supply the original forecast input object inline, or inspect a declared input with merchant_grant_inputs and use its exact SHA.
3. Call merchant_grant_forecast_preview. It runs the original forecast engine without saving a forecast.
4. Read the returned original previewSha256, dated cash scenarios, remaining work, invoice obligations and capacity result.
5. Call merchant_grant_forecast_save with the same original inputs, case version, expectedPreviewSha256, actor and one stable request ID.
6. Reopen the returned original forecast through merchant_grant_forecast; export it or the entire case.

Input selection for a retained host file:

~~~json
{
  "workspace": "grant",
  "caseId": "operation-<original 32 hex characters>",
  "expectedVersion": 29,
  "input": {"hostInput": "forecast-assumptions"},
  "expectedInputSha256": "<the inspected 64-character hash>"
}
~~~

For inline input, replace input and expectedInputSha256 with inputs containing the original forecast object. Never submit both forms.

The input contract remains [the original forecast guide](../../stellar/scf_2026/sf47_budget_model/workspace/FORECAST.md). Its source snapshots, paid-obligation handling, selected dates, opening-cash basis, commercial quotes and conditional grant receipts are interpreted only by that original implementation. The client does not create an accounting ledger or a second capacity solver.

If another operator changes the case between preview and save, the original service returns OPERATIONS_CONFLICT or FORECAST_PREVIEW_CONFLICT. Read the current case, reconcile the input and preview again. An older saved forecast remains immutable and shows its original source comparison.

## Allocate resources and carry selected dates into cash

The six portfolio operations use the completed original [Portfolio allocation workflow](../../stellar/scf_2026/sf47_budget_model/workspace/PORTFOLIO.md). The original saved forecast supplies the full remaining task set, hours, prices and cash rules. The original allocation engine supplies resource availability, dependencies and working dates.

| Tool | Original operation |
| --- | --- |
| merchant_grant_portfolios | All saved allocation summaries for the selected case. |
| merchant_grant_portfolio | The complete immutable allocation, source forecast, alternatives, dated results and current source comparison. |
| merchant_grant_portfolio_seed | An editable input from the selected current saved forecast, retaining every remaining source task. |
| merchant_grant_portfolio_preview | The original entered allocation and alternative calculation against the current case version. |
| merchant_grant_portfolio_save | Native portfolio.save with the reviewed preview identity, exact case version and stable request ID. |
| merchant_grant_portfolio_selection | The selected ready alternative's original forecast input and retained date/source selection; it creates an editable cash forecast input. |

1. Inspect the current case version and the selected saved forecast's ID and SHA. Call portfolio_seed with that case version and forecast ID.
2. Read the seed's complete /inputs object. Enter explicit weekdays, daily availability, dated exceptions, resource effort, dependencies and alternatives. Every source task stays in that native input. An unentered capacity and an entered zero retain their different original meanings.
3. Call portfolio_preview with the complete input. Inspect every alternative's status, available and allocated hours, chosen dates, late or unfinished tasks, collection-timing findings and original cash result. Use snapshot/rows for large arrays and file_read for the complete response.
4. Call portfolio_save with the same input, current expectedVersion, expectedPreviewSha256, actor and original requestId. Reopen the returned portfolio ID with portfolio; the save's source and complete result stay immutable.
5. Read the case's current version. Call portfolio_selection with that version, portfolioId and the exact alternativeId (base selects the base allocation).
6. Feed the returned original /inputs object into forecast_preview, review the cash assumptions, then forecast_save with its original preview SHA, current version and a new deliberate request ID.
7. Export kind portfolio with caseId and portfolioId for the full source/calculation/CSV handoff. Export kind case for native import and reopening of the entire case, including every retained portfolio and original forecast.

Seed, preview and selection are read-only native operations. Save uses the original command journal. A stale case or changed forecast keeps the original validation response; an uncertain save retains the original request ID for exact replay. Saving an incomplete allocation preserves the native findings and entered work for later receiving. Only an original READY alternative is eligible for the date selection step.

### Pass the exact original object between operations

Forecast and portfolio preview/save accept one complete inline inputs object or one verified input reference. For a native response that wraps the input, set inputPointer explicitly. The SHA always identifies the entire retained file; projection happens after full-file verification.

For example, portfolio_selection returns a retained snapshot whose native response contains inputs. Use its real snapshot ID and whole-response SHA:

~~~json
{
  "workspace": "grant",
  "caseId": "operation-<original 32 hex characters>",
  "expectedVersion": 32,
  "input": {
    "snapshotId": "snapshot-<original UUID>"
  },
  "expectedInputSha256": "<complete selection-response SHA256>",
  "inputPointer": "/inputs"
}
~~~

Pass this selection to merchant_grant_forecast_preview. For forecast_save, retain those exact input-selection fields and add actor, requestId and the original forecast preview's expectedPreviewSha256. The same reference pattern can select /inputs from portfolio_seed or /inputs from portfolio_preview for portfolio_save. A declared host JSON file or completed transfer can use the same optional pointer.

Pointers use the shared original JSON-pointer rules: / for object paths, ~0 for a tilde, ~1 for a slash. The selected value must be the native input object. Inline inputs exclude input, expectedInputSha256 and inputPointer. Complete native response files retain their own receiving bounds; the projected input fits the existing 8 MiB input bound and the service's complete request remains within 32 MiB.

The selection changes the original work-date fields. Quoted collections and conditional grant receipts keep the original forecast engine's entered timing and completion-payment rule. Review its collection-timing findings before accepting the dated cash forecast.

## Planning, delivery and reviews

Planning changes use merchant_grant_plan_estimate, plan_save, plan_restore and plan_clone. The original expectedRevision, request ID, note, scenario patch and planning inputs pass to the corresponding native operation. Native request IDs contain up to 100 letters, numbers, dots, underscores or hyphens, beginning with a letter or number. Keep their exact original spelling on replay.

Create a delivery case with the reviewed planId, selectedRevision and expectedContentSha256. Select OPERATIONS for actual operating records or WALKTHROUGH for an explicitly named operating example.

merchant_grant_case_command accepts the original action and data object. Supported actions cover:

- Contributor save; work save, submit, accept, reopen and void.
- Invoice save, review, dispute, reopen and void.
- Cash record and void.
- Award, deployment and outcome save.
- Purchase record, later source observation and void.
- Business review, reviewed close and reopen.

The original service validates each record, source reference, lifecycle transition and native amount. Every command requires the exact current case version, original request ID and recorded actor. Reviews and reversals retain their original reason and before/after event.

Use merchant_grant_source_attach for exact source bytes. It calls the original source.add operation and retains filename, MIME, source URL, observation date and source hash. Individual sources have the native 8 MiB limit; the case retains its original aggregate source bound. merchant_grant_intake consumes the existing original source-intake packet through its maintained importer.

## Receive merchant support into the original delivery case

The two Support operations join the original [Merchant Support receiving workflow](../../stellar/scf_2026/sf47_budget_model/workspace/SUPPORT_DELIVERY.md). Export the intended saved case from Merchant Support with **Export portable handoff**. Use that complete original JSON file; the grant service invokes its installed SF74 reader and preserves the captured source, route and runtime identities.

| Tool | Original result |
| --- | --- |
| merchant_grant_support_preview | Read-only native review of the exact handoff and current case version, including source/reader identities, full report, rendered HTML, existing source matches, deployment choices and previewSha256. |
| merchant_grant_support_receive | Original support.receive transaction: retain the handoff and native rendered review, associate an existing or new deployment, and commit the case event and original request receipt together. |

1. Read merchant_grant_case for the current case version and retained deployments.
2. Inspect the declared original support input with merchant_grant_inputs, or finish its original receive_begin/chunk/commit transfer. Keep the exact whole-file SHA and original filename.
3. Call support_preview with caseId, expectedVersion, input, expectedInputSha256 and filename.
4. Read the complete original source, installed reader, captured comparison and follow-up work. Use snapshot/rows to inspect native objects and arrays; file_read returns the full preview JSON, including its original html string.
5. Select the original deploymentId from that case. To record a new deployment, use null or omit deploymentId and provide the native deployment fields instead.
6. Call support_receive with the same file selection, whole-file SHA, filename and case version, the reviewed expectedPreviewSha256, actor, note and one stable requestId.
7. Read its original recordId, sourceIds, sourceSha256, version and unchanged result. Reopen the case, export each original source through kind source, or export and import the complete case.

A declared host input is selected exactly like other native files:

~~~json
{
  "workspace": "grant",
  "caseId": "operation-<original 32 hex characters>",
  "expectedVersion": 32,
  "input": {"hostInput": "merchant-support"},
  "expectedInputSha256": "<exact original support file SHA256>",
  "filename": "merchant-support.json"
}
~~~

Pass those fields to merchant_grant_support_preview. For support_receive retain every selection field and add the original preview hash, deployment selection and request fields. The host declares merchant-support in its connection inputs with the actual file path. A completed transfer or a retained source export can also supply the exact same original bytes. Support tools consume the whole file; they do not accept inputPointer or reconstructed review JSON.

### Existing and newly recorded deployments

An existing deploymentId preserves its original accountable operator, business fields and source associations, then adds this original handoff/report relationship. Omit deployment, or pass null/an empty object. A nonempty competing replacement object is rejected.

A new deployment uses the original fields below. Read pinned work-package IDs from the original case plan; a HANDED_OVER state needs its named receiver and actual receiving date.

~~~json
{
  "name": "Merchant runtime",
  "operator": "Accountable operator",
  "operatorId": "retained-operator-identity",
  "role": "MERCHANT",
  "participantClass": "TEAM_OPERATED",
  "environment": "TESTNET",
  "state": "OPERATING",
  "costIds": [],
  "tranche": null,
  "endpoint": "https://merchant.example/data",
  "releaseRef": "Original installed source",
  "caseRef": "Original merchant case or work order",
  "acceptedBy": "",
  "acceptedAt": null,
  "sourceNote": ""
}
~~~

For a new record use deploymentId: null and put those fields in deployment. Native generated IDs, version, recordedBy and sourceIds belong to the original service. Role, environment, participant class, lifecycle state and pinned work references retain the original deployment rules.

### Exact source, recovery and complete handoff

The native preview binds the current case version, original filename and bytes, installed reader and factual review. The receive operation recalculates that review in the original case transaction and checks its preview hash. It retains the raw handoff, rendered report, source association, deployment change, event and request receipt atomically.

A repeated identical original request returns its accepted result. A file/report already associated with the selected deployment can return unchanged without incrementing the case version. Reused original bytes keep any existing source name and metadata; the support-to-report association remains part of the original case and history.

If the native version or preview has changed, read the current case and preview the same intended file again before submitting a deliberate updated request. If the receive response is interrupted, recover the identical original requestId and payload. The client issues no automatic write replay. SUPPORT_REVIEW_BUSY means another original review is running; retain the selection and retry when that review completes.

The original handoff and retained rendered report each fit 8 MiB. The case retains its original 24 MiB aggregate and 200-file limit. Preview can contain a complete native reader report up to its 16 MiB output bound; large snapshots remain available through byte paging. For an oversized handoff choose a shorter original capture period in Merchant Support and export that source.

The maintained grant launcher passes its running Node executable to the original Python support reader. Borrowed Applications and MCP-started instances use that same lifecycle. Download sourceIds through merchant_grant_export with kind source; the original handoff reopens in Merchant Support, and the saved HTML opens as the receiving-time report. Complete case export/import preserves both files, their deployment association and original event history.

## Export, transfer and receive the complete work

merchant_grant_export supports original plan ZIP, operating-case ZIP, forecast ZIP, portfolio ZIP, source file, scenario JSON and original daily/cost CSVs. It preserves the complete native response. A case ZIP includes all original source attachments, reviews, forecasts and portfolios.

For exact bytes, call merchant_grant_file_read with the snapshot ID and expectedSha256. Repeat the returned readId, same SHA and nextOffset; keep each base64 chunk's decoded bytes in order. Each chunk is at most 65,536 bytes. The shared original reader keeps a verified snapshot, returns an exact total size and hash, and releases its temporary descriptor at EOF. merchant_grant_file_release closes a reader early; the retained original file stays available.

The shared reader has four simultaneous snapshot slots and a 120-second idle timeout. After timeout or process restart, open a new read against the same retained snapshot and SHA at the needed byte offset. An expired reader ID does not invalidate the retained file.

### Native import on the same host

A receiving workspace can import an exact export directly without encoding it into the conversation:

~~~json
{
  "workspace": "receiving",
  "input": {
    "sourceWorkspace": "grant",
    "snapshotId": "snapshot-<the complete original case export>"
  },
  "expectedInputSha256": "<that export's exact SHA256>",
  "name": "Received original grant delivery",
  "actor": "Receiving operator",
  "requestId": "receive-original-grant-case-01"
}
~~~

Pass this to merchant_grant_case_import. Both source and destination must be declared host aliases. The original case importer receives every ZIP byte and preserves its native source lineage. Use merchant_grant_plan_import with kind "plan" for a complete planning ZIP, or kind "scenario" for original scenario bytes.

### Receive bytes from another client

1. Call merchant_grant_receive_begin with a stable transfer request ID, exact filename, byte count and SHA256.
2. Send merchant_grant_receive_chunk with offsets 0, 65536, 131072, and so on. Each part is exactly 65,536 bytes except the last.
3. Read merchant_grant_receive_status after interruption. It identifies every missing original offset.
4. Call merchant_grant_receive_commit. It assembles the complete source, verifies length and whole-file SHA, and returns COMPLETE.
5. Use the transferId input reference and the same SHA in the explicit native import or source-attachment tool.

Identical repeated parts are accepted. A different part at the same offset, or a different declaration under the transfer request ID, is a conflict. Transfers survive MCP restart. A transfer has no effect on plans, cash records or operating cases until the original import is explicitly called.

The native bundle limit is 32 MiB. Scenario inputs, source attachments and source-intake packets use their original 8 MiB input bound. Larger task inputs must be divided according to the original product's import semantics, rather than silently truncated.

## Recover an interrupted mutation

The original planning database stores the request fingerprint and result in the same transaction as the mutation.

| Outcome | Continue through the original operation |
| --- | --- |
| Same request ID and identical original payload | Repeat the original tool. The native saved result is returned without another case mutation. |
| REQUEST_CONFLICT | The request ID belongs to a different payload. Recover that original operation; a deliberate new action needs a new request ID. |
| OPERATIONS_CONFLICT or plan revision conflict | Read current source and reconcile the concurrent operator's saved work. |
| FORECAST_PREVIEW_CONFLICT | Preview the exact revised inputs against current original records before saving. |
| SUPPORT_PREVIEW_CONFLICT | Re-preview the exact support file and filename against current case and installed reader before a deliberate receiving request. |
| SUPPORT_REVIEW_BUSY | Keep the same source selection and retry after the original active review completes. |
| GRANT_RESULT_UNCERTAIN | The HTTP response was lost or failed after dispatch. Read the original case/plan, then repeat the identical original request ID and payload to recover its retained result. |
| retention.state FAILED | The original response was received successfully, but its complete local snapshot was not retained. Restore storage and repeat the identical native operation or original read. |
| GRANT_SELECTION_CHANGED | Reconcile the selected workspace, scenario, Python and installed source edition in the host connection. |
| Original WORKSPACE_OPEN | Continue the existing original application owner; do not create a second database process. |
| GRANT_TRANSFER_INCOMPLETE | Resume the original missing part offsets, then commit the same transfer. |
| File reader expired | Reopen the same retained snapshot and exact SHA at the required byte offset. |

No failed write is automatically sent again. No response timeout is treated as evidence that a case mutation did not happen.

merchant_grant_close requires the inspected instance ID and drains this client's pending requests. For a borrowed Applications listener, it releases the connection only. For a service started by this MCP, it signals the original Node launcher, which closes the original Python service and SQLite lock. The next explicit open uses the same saved workspace and a fresh native launch.

## Direct agent client

The same typed transport is available to an application without an MCP wrapper:

~~~js
import { inspectGrantAgentBinding, GrantWorkspaceClient }
  from '../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs';

const binding = await inspectGrantAgentBinding({
  directory: '/srv/stellar/grant',
  pythonExecutable: '/usr/bin/python3',
  allowStart: true,
  label: 'Original grant delivery'
});
const client = new GrantWorkspaceClient(binding);
try {
  await client.open({expectedSelectionSha256: binding.selectionSha256});
  const original = await client.read('cases');
  console.log(original.value);
} finally {
  await client.close();
}
~~~

The client exposes original plan operations, case creation/commands, preview/save, complete downloads, bundle/scenario import, source attachment and intake. Its methods return complete native responses: value is the parsed native JSON; bytes, sha256 and source retain the exact response and launch. Local file destinations and application-specific decisions belong to the calling host; Merchant tools expose aliases and verified transfer IDs instead of filesystem paths.
