# Event programmes through the original Analysis agent

An agent can receive the buyer's complete original event window, review its meaning,
continue the customer's report and workbook, and deliver the entire working result
through the same private Analysis application. The browser, native CLI and registered
agent use the original programme, input files, action requests and SQLite database.

The provider uses the existing `analysis` action on
`sf43_discover_review_and_pay`. The host registers an existing live Analysis
workspace through its original native configuration. Select that registered alias;
capabilities, receiver executables and local database paths are host settings.

## Start with the installed customer application

Use the existing [Event programmes browser guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/EVENT_PROGRAMMES.md)
to start the private Analysis service with the matching installed Node source
receiver. The sibling `analysis-source.mjs` and `analysis-source-cli.mjs`
must be the original pair. Register the live service with the native MCP host's
existing Analysis registration. The [Analysis agent guide](ANALYSIS.md) describes
that original configuration and its registered workspace aliases.

Use `workspaces` to select the original alias and its 32-character workspace ID.
Open `event-overview` to see source receiver availability, existing programmes,
the active action, original file inputs and previous actions. Source acquisition,
Stellar authorization and payment remain in the original subscriber/buyer.

The public entrypoint is the same for every operation:

~~~js
await nativeClient.call('sf43_discover_review_and_pay', {
  action: 'analysis',
  analysisWorkspace: selectedAlias,
  analysisOperation: 'event-overview',
  analysisRequest: {limit: 25, programme_limit: 25}
});
~~~

The typed helper opens this same authenticated client and unwraps the original
Analysis response:

~~~js
import {openNativeAnalysisEventsClient, readNativeAnalysisEventRecord}
  from './native-analysis-events-client.mjs';

const client = await openNativeAnalysisEventsClient({
  url: originalMcpUrl,
  analysisWorkspace: selectedAlias,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const overview = await client.call('event-overview', {limit: 25});
~~~

This example runs beside the installed source modules under
`stellar-forge/mcp-paid-agent/`. The distribution also exports the typed
`./buyer/mcp/analysis-events-client` entrypoint.

## Receive the whole original source pair

Select the subscriber's complete NDJSON file and its original manifest. The
allowances match the underlying product: 32 MiB NDJSON, 4 MiB manifest, and the
original source projector's event/document limits. The manifest and each event's
identity, payload and page history are validated by the original receiver.

The installed command saves both full files and the exact request in a private
receiving directory before its first dispatch:

~~~sh
starforge mcp-analysis-events input \
  --url "$MCP_URL" --workspace "$ANALYSIS_ALIAS" \
  --workspace-id "$ORIGINAL_WORKSPACE_ID" --input "$RETAINED_INPUT_ID" \
  --dir "$PRIVATE_INPUT_DIRECTORY" \
  --ndjson "$ORIGINAL_EVENT_FILE" --manifest "$ORIGINAL_MANIFEST"
~~~

The input ID is one retained 32-character lowercase hexadecimal value, chosen
once for this original pair. The selected alias and actual workspace ID belong
to the existing host registration. Keep the same private directory on restart.
After the full source is saved there, an identical continuation may omit the two
original path arguments. The helper reopens those complete saved bytes, checks
their identities and the selected workspace, and continues from the original
server's accepted offsets.

The underlying operations are `event-input-create`, `event-input` and
`event-input-chunk`. Chunk calls carry the same input ID, selected file kind,
offset, exact base64 and SHA-256, with at most 64 KiB decoded per call. Native
SQLite owns contiguous receiving and exact replay. A lost acknowledgment can be
reconciled by reading the same input. Changing either file requires another
input selection. Empty but complete original files retain their actual zero
length and digest.

The helper's `input-request.json`, complete original files and
`input-received.json` travel together. The original native workspace archive
separately retains accepted input chunks and saved actions.

## Review the complete customer window

Choose the actual programme name and payload fields with the receiving customer.
Programme names begin with a letter and contain at most 24 letters, digits or
underscores. Original metadata columns and the full payload remain; selected
payload columns preserve exact text and adjacent missing/null/type state.

Retain each complete request and its action ID before dispatch. Each native
review also has its own stable operation ID. These values identify original
work; a retry keeps them.

~~~js
const reviewedRequest = {
  programme: programmeName,
  id: retainedActionIds.review,
  operation_id: retainedWindowOperationId,
  input_id: retainedInputId,
  mapping: {fields: reviewedPayloadFields}
};
await client.call('event-review', reviewedRequest);
const action = await client.call('event-action', {id: reviewedRequest.id});
~~~

`event-action` returns the original status and a compact result selection.
Read its `complete_record` to obtain the **entire** saved native action:
original request, mapping, progress, complete review and customer definitions.
The helper returns exact bytes and text without parsing numeric tokens:

~~~js
const whole = await readNativeAnalysisEventRecord({
  client, analysisWorkspace: selectedAlias, record: action.complete_record
});
// Persist whole.bytes with the original request and use the application's
// lossless JSON reader to inspect the complete native action result.
~~~

The complete record has its own workspace, kind, record ID, byte length and
SHA-256. Every range stays bound to that same response snapshot, even if the
live action or programme advances. Files reside in the existing private native
host's `analysis/event-records` area. Native customer records may retain their
original producer-path provenance; subsequent file selection always resolves
against the current host registration.

Review the actual source/store/feed, individual event IDs, accepted page history,
field meanings, prior window and proposed table/report/workbook result. Once
the native review is COMPLETE, select its actual `review_sha256`:

~~~js
await client.call('event-apply', {
  programme: programmeName,
  id: retainedActionIds.apply,
  operation_id: retainedWindowOperationId,
  review_sha256: selectedCompleteReviewSha256,
  note: customerDecision,
  columns: completeReviewedWorksheetColumnChoices
});
~~~

`columns` is optional. When needed, it contains the **complete** replacement
column arrays keyed by the original worksheet index; the native WorkbookRefresh
validates them. Current report definitions, worksheet names, notes and unrelated
source sheets keep their original revision controls.

The original `event-programme` operation lists selected programme state and
paged operation summaries. Its complete record includes every retained review,
applied result, delivery and preceding customer attempt. Use the normal
Analysis report, workbook and full-query operations to inspect and edit the
result in that same customer workspace.

## Continue original actions and useful later windows

An accepted request remains in the original SQLite action table before native
execution begins. An uncertain tool reply therefore has a concrete recovery
unit: read `event-action` with that same ID. RUNNING or COMPLETE retains the
original work. ERROR or INTERRUPTED is continued by sending every unchanged
original field with `resume: true`; the native service decides whether the
retained stage is complete or needs continuation.

If current report or worksheet choices changed after source activation during
an unfinished apply, `event-refresh-review` records why those current customer
choices are selected:

~~~js
await client.call('event-refresh-review', {
  programme: programmeName,
  id: retainedActionIds.refresh,
  operation_id: retainedWindowOperationId,
  review_sha256: precedingCompleteReviewSha256,
  note: reasonForSelectingCurrentCustomerWork
});
~~~

Read its entire completed record. The next apply uses that new actual review
digest and a newly retained apply action ID. The original source operation,
preceding attempt and note remain in the programme history.

For a later useful window, receive the actual next cumulative subscriber pair
under its own input ID and select a new window operation. The existing receiver
checks that earlier accepted events and pages remain an immutable prefix. A
complete later window with zero new events remains that actual source outcome.
The customer's work continues through the same programme and ordinary revision
checks.

Event counts, requested pages and qualifying paid purchases keep their distinct
meanings. Source receiving, report edits, replay and another delivery remain
associated with the already acquired original purchase.

## Deliver and receive the entire working result

After an accepted apply, `event-deliver` retains that selected result and takes
a fresh complete workspace snapshot:

~~~js
await client.call('event-deliver', {
  programme: programmeName,
  id: retainedActionIds.delivery,
  operation_id: retainedWindowOperationId
});
~~~

The delivery action ID must differ from the selected source operation ID. Read
that same action until its actual COMPLETE state. Repeating this original
delivery request keeps its original snapshot; a deliberately new delivery ID
selects a fresh snapshot, including after independent restoration.

Inspect the full original delivery before selecting its immutable index:

~~~sh
starforge mcp-analysis-events inspect \
  --url "$MCP_URL" --workspace "$ANALYSIS_ALIAS" \
  --programme "$PROGRAMME" --delivery "$RETAINED_DELIVERY_ID"
~~~

The index identifies the selected result edition, accepted operation, reviewed
digest, actual workspace-programme edition/revision and all sixteen full files:

| Complete files | Customer use |
| --- | --- |
| Event_Analysis.xlsx; Event_Workbook_Handover.zip | Editable selected workbook and its original handover |
| Event_Report.html; Event_Report.json; Event_Report_Tables.zip | Complete selected report and original tables |
| Complete_Event_Table.jsonl; Complete_Event_Table.csv; Complete_Event_Table_Manifest.json | Every acquired event with native typed-export metadata |
| Original_events.ndjson; Original_events.ndjson.manifest.json | Exact original subscriber input and page/source history |
| Reviewed_customer_window.json; Customer_programme.json | Accepted complete review and programme extracted from the actual archived database |
| Event_Analysis_Workspace.zip; Event_Analysis_Workspace_Manifest.json | Original complete native application archive and member identities |
| Open_and_use.md; Event_Analysis_Delivery.json | Receiving instructions and original full delivery identity |

Download the whole selected package using its actual `indexSha256`:

~~~sh
starforge mcp-analysis-events download \
  --url "$MCP_URL" --workspace "$ANALYSIS_ALIAS" \
  --programme "$PROGRAMME" --delivery "$RETAINED_DELIVERY_ID" \
  --dir "$PRIVATE_RECEIVING_DIRECTORY" --index-sha256 "$REVIEWED_INDEX_SHA256"
~~~

The helper adapts the existing `createRetainedDownload` writer. That original
writer owns its private files, lease, partial checkpoint, exact prefix recovery,
whole-file hashes and atomic publication. A port change keeps the original
workspace/programme/delivery/index identity; each new chunk still uses the
selected authenticated client. An interrupted download repeats the same
command and directory.

The original `SavedFileReader` hashes the native retained file and checks its
descriptor while reading at most 64 KiB per tool call. It resolves files from
the current registered customer's database, preserving original sender paths
as provenance. File sizes retain the native per-file 1 GiB allowance. Complete
API records have a separate 64 MiB allowance.

After every file has arrived, independently verify the whole package offline:

~~~sh
starforge mcp-analysis-events reopen \
  --workspace "$ANALYSIS_ALIAS" --programme "$PROGRAMME" \
  --delivery "$RETAINED_DELIVERY_ID" --dir "$PRIVATE_RECEIVING_DIRECTORY" \
  --index-sha256 "$REVIEWED_INDEX_SHA256"
~~~

This reads the saved exact index and every original file without contacting the
MCP or source host. Open the report and workbook, then restore
`Event_Analysis_Workspace.zip` through the original
`stellar_forge_buyer.workspace_archive_receive` receiver using the actual
workspace archive digest. Launch the restored Analysis service, register its
receiving directory through the original host configuration, and reopen the
same programme and customer work.

The workspace snapshot precedes its sender's final delivery journal. Continue
from the accepted programme with a fresh delivery ID or later actual source
window. The restored workspace, original report/workbook and prior source
history remain the same customer application.

## Carry this complete result into the original Customer Installation

The installed `mcp-analysis-event-installation` programme receives the whole
selected sixteen-file package, exact original SF47 seed and explicit operator
bindings. It retains a complete independent copy, prepares the existing native
Installation document and workorder, and reopens every original source and
output offline. Original commercial phases, funded assignments and acceptance
checks remain with that same case.

Follow the full [Event customer Installation course](../../stellar/scf_2026/sf49_data_commissioning/installation-workorders/WEBHOOK_EVENT_ANALYSIS.md)
for the original commercial source, binding template, installed prepare/reopen
commands, existing preview/save, independent native case receiving and actual
producer-viewed customer handover.

## Operate and inspect the outgoing customer result

Before presenting an application, demonstration, report or export as ready,
the producing maintainer must open, run or render the exact outgoing version,
look at its actual screen or real screenshots, and operate its important
controls. This applies to every local or cloud provider and to future delegated
work. Include the instruction in each delegated receiving assignment.

For this course, open the populated Event programmes workspace and its actual
report and workbook at the intended screenshare width and at a narrow width
where relevant. Operate original-file receiving, complete-review selection,
apply, customer edits, later-window continuation and fresh delivery. Check the
empty, loading and error states used by the workflow. Download every outgoing
attachment, open its intended view, and reopen the exact complete package and
restored workspace. Inspect all attachments, including readable tables and
instructions. Play any final video or audio and inspect its actual presentation
and voice quality before including it.

Use plain industrial presentation: readable tables, clear hierarchy,
consistent typography and spacing, restrained controls and useful labels.
Repair unreadable, unstyled, cramped, clipped or overflowing output directly in
the original product. A captured screenshot must actually be viewed; source
review, DOM counts, HTTP responses, automated checks and another peer's
approval do not replace the producer seeing the result.

Where the existing native owner operates the equipped host, return the exact
outgoing source edition, resulting file locations, actual normal/narrow
screenshots and control/download/reopen outcomes to the producing maintainer
in the original receiving operation. The producer opens those images and
resolves concrete defects there. Continue the same implementation and native
operation; keep the existing focused-validation policy and owner schedule.
The current fleet cutoff is October 13, 2026 at 14:00 UTC.

## Operator and implementation ownership

The private Analysis host owns its process, capability, trusted source receiver,
SQLite lease and native jobs. Closing the agent adapter cancels and drains its
own calls; the host continues its original work. Browser actions and agent
actions use the same durable action table and single coordinator.

The existing source/buyer owners supply the complete acquired file pair. The
receiving customer chooses field meanings and explicitly accepts the complete
review. The maintainer restores the original archive and continues that
customer's operating case. The complete native exercise joins the original
Mercury/paid-subscriber receiving course and the existing general webhook
commissioning source; customer files and actual returned execution stay with
those original operations.

## Inspect original fields and receive complete values

After receiving the complete original pair, call event-input-fields with the
same input ID. It returns paged field summaries and complete_record for the
entire validated catalogue. The record contains every actual path, per-event
present/missing and JSON-kind coverage, original source/file identities and
explicitly labelled short example previews. Request field_offset and
field_limit (at most 50) for another concise page; all full paths remain in
the same immutable record.

event-input-values accepts the same input ID, the exact JSON Pointer,
offset and limit. Offsets count original events, including missing values.
The concise response retains original event identities and labelled text
previews. Its immutable complete_record contains each full original native
text value, kind and exact text digest. Read all record ranges with the existing
event-record-file helper before interpreting complete values.

The typed client now exposes complete receiving helpers:

~~~js
const fields = await inspectNativeAnalysisEventFields({
  client, analysisWorkspace: alias,
  inputId: retainedInputId, expectedWorkspaceId: originalWorkspaceId
});
const values = await inspectNativeAnalysisEventFieldValues({
  client, analysisWorkspace: alias,
  inputId: retainedInputId, expectedWorkspaceId: originalWorkspaceId,
  pointer: '/amount', offset: 0, limit: 25
});
~~~

Both helpers receive and hash every byte of the immutable record. Their text
retains the original full JSON, while value exposes catalogue counts and field
values already represented as exact text by the original native projector.
Each receiving request preserves the operation's cancellation signal. Another
inspection cannot change the selected earlier record while its ranges arrive.

To exchange the chosen mapping with the browser, save this complete native
handover at a new private file using exclusive creation:

~~~js
const selected = fields.value;
const handover = {
  schema: 'stellar-forge.event-field-mapping-handover.v1',
  original: {
    workspace_id: selected.workspace_id,
    input_id: selected.input_id,
    edition_id: selected.edition_id,
    source: selected.source,
    original_files: selected.original_files
  },
  mapping: {
    schema: 'stellar-forge.event-feed-analysis-mapping.v1',
    fields: reviewedPayloadFields
  }
};
await writeFile(newPrivatePath, JSON.stringify(handover, null, 2) + '\n',
  {flag: 'wx', mode: 0o600});
~~~

Here writeFile is the ordinary node:fs/promises function; reviewedPayloadFields
contains the customer's actual selected name/pointer pairs. Open that file in
Event programmes after inspecting the same retained input. The browser checks
the complete original selection before opening its editable field list. For a
later window, reuse the accepted programme mapping and review the actual source
differences. Original review/apply and customer acceptance remain explicit.

The complete browser/CLI course is in
[Event programmes](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/EVENT_PROGRAMMES.md).
It covers whole catalogue and value downloads, empty windows, mixed kinds,
mapping import/export, explicit review and the original complete delivery.


### Operate the actual explorer and complete returned mapping

In the same original receiving course, open the exact outgoing browser, inspect
its complete source, search a real path, read present/missing/null/mixed-kind
coverage, select and rename useful fields, and open complete original values.
Download the full catalogue, value page and mapping. Reopen each JSON file,
import the same mapping, continue native review/apply, and confirm the actual
customer report/workbook still receives every selected event. Open a complete
empty window and the actual invalid-selection/error state without replacing
the original customer source.

The producer must LOOK at the actual desktop/screenshare and relevant narrow
screens, operate the important controls, and open every outgoing attachment
as its recipient. View captured screenshots and repair concrete layout or
behavior defects in the same source. Source-only execution is separate from
this actual native/rendered course. Return the exact source edition, original
workspace/input/programme IDs, complete downloads and real screens to the
existing receiving owner; preserve the same original operation and deadline.
