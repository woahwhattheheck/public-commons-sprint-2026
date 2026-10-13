# Operating procedures in Grant Operations

Operating procedures connect the installed Command finder’s complete Operating Plan to the existing delivery case. An operator can describe recurring work, keep command registrations and instructions, select the exact original tables and case editions that support each step, and hand the whole editable case to another operator.

The original Operating Plan stores revisions. Grant Operations stores each prepared procedure as an immutable source and records the write in its existing history. The native case ZIP carries those sources, native plans, source tables, case history, Installation editions and task comparisons through the original importer.

## Open the installed application

Open the existing Grant workspace from Applications, select its actual delivery case, and choose **Operating procedures**. This pane ships through the normal source-owned distribution contribution. It does not require a separate service, workspace database or registration registry.

Use **New procedure** for manual operating steps. Use **Open Operating Plan JSON** for a complete plan received from Command finder. The original plan’s registration snapshots, command arguments, sources and all saved revisions remain intact. The editor displays commands as instructions; a procedure save does not execute those commands.

Fill in the customer or team, operating owner, useful result, recurrence or trigger, receiving instructions and notes. For every step, record the work instructions, exact inputs, expected complete output, owner and due date. Recorded status and result describe the named operator’s observation. Native purchases, task outcomes, customer use and issuer events remain their original separately selected records.

A local working draft remains available when switching case sections. **Download browser checkpoint** includes the complete drafts, original plan histories, source selections and any pending source request. **Restore browser checkpoint** merges matching-case drafts and preserves conflicting local drafts as separate entries. A pending request is restored with its exact original identity and is dispatched only when the operator chooses **Reconcile original save**.

## Select complete original inputs

The **Selected originals** section supports four table choices:

| Choice | Complete material retained |
| --- | --- |
| Pinned plan tables | The original native plan plus its complete Source Tables project. |
| Existing case JSON | The original source bytes and native source metadata, parsed by the maintained table importer. |
| Local original table JSON | The explicitly selected complete table project, kept as an original within this procedure. |
| Table from the preceding saved procedure | The exact older table, original plan, edition, mappings and reviews already retained by the preceding procedure. |

The table summary exposes original document/resource IDs, selected source edition, selected and baseline reviews, row counts, binding, mapping and complete planning baseline. It is derived by the existing `importPlanningBook` / `sourceTableRows` implementation. The complete source project, including workbooks and exclusion decisions where present, stays inside the procedure; summary rows never replace its originals.

Selecting a new native plan does not silently rebase an older table. A procedure can keep an older pinned table only through its verified preceding procedure. This preserves the reason for the older selection while showing whether the current native plan matches the procedure’s original plan.

Additional case-source links retain each full native metadata record and verify the corresponding original source bytes. Installation and Customer task outcomes choices require an explicit original record and revision. The full native response for that selected revision is retained, and reopening checks it through the same case reader. Current display context can change after receiving; the selected original edition must remain identical.

Each step can link to the selected source IDs, table keys and native edition keys. Those links are explicit. A label, a step’s “completed” status or an authored result does not create a native event or establish a measured customer result.

## Review and save

1. Enter the original recording operator in the case.
2. Choose **Review current case** if the case version changed while editing. This preserves the draft and leaves its source/edition choices visible for review.
3. Choose **Review procedure and sources**. The pane reads the current case, verifies the complete selected originals and preceding history, and checks the case version again.
4. Review the resulting title, byte count, source details and prepared SHA-256.
5. Choose **Save reviewed procedure to case**.

The exact prepared JSON and request ID are retained before `source.add`. The existing case writer enforces the selected case version. A successful save adds one source and advances that case’s version; it does not replace prior sources. The editor then downloads the new original source, verifies its complete bytes, and reopens its selected native editions and preceding history.

If the connection is lost, **Reconcile original save** reuses that same request. Grant Operations records request IDs in its original native transaction table, before checking the current version on a duplicate. This makes continuation of the same exact request possible after the case has advanced. A definite rejected request remains visible for review. A new reviewed input requires a new request ID; reusing an existing ID with different bytes is a conflict.

A pane can close while an accepted request is finishing. Its return and prepared text remain in the case session, and the next mounted pane completes the same source readback. If browser storage cannot retain the exact pending request, the pane stops before dispatch and offers the complete checkpoint download.

## Continue an earlier revision

**Revision history** lists every saved Operating Plan revision. **Restore content to draft** copies the selected historical content into an editable draft against the current complete history. Saving a changed draft adds a new original revision; it does not remove later revisions.

Reopening a saved procedure retains its exact prior Operating Plan JSON when the operator makes no plan-content change. A subsequent source-only selection can therefore refer to the same plan revision without rewriting the received text. When content changes, the original `saveOperatingPlanRevision` creates the next revision.

The full source chain is checked on reopening. Every declared predecessor must exist as a complete native case source; each shared Operating Plan revision must match exactly, and every selected source and native edition in that history must remain receivable. Cycles and broken predecessor identities are rejected.

## Native CLI

The installed command is `starforge grant-procedures`. A checkout can invoke `grant_procedures_cli.mjs` directly with Node. All commands use the same pure procedure model and the existing `GrantWorkspaceClient`.

The binding file is the existing client selection:

~~~json
{
  "directory": "/absolute/private/original-grant-workspace",
  "scenarioFile": "/absolute/selected/native-scenario.json",
  "pythonExecutable": "/absolute/existing/python3",
  "allowStart": false,
  "label": "Original grant case"
}
~~~

Use the actual existing directory and source selection. The default borrows the original managed application. Explicit `allowStart: true` uses the maintained launcher for that reviewed binding. Closing a borrowed client releases its connection; it does not stop another operator’s application. An owned original service is closed through the client’s existing lifecycle.

Read the actual case and its saved procedures:

~~~sh
starforge grant-procedures list --binding /private/original.json --case "$PROCEDURE_CASE_ID"
~~~

Prepare a complete Operating Plan and explicit selection:

~~~sh
starforge grant-procedures prepare \
  --binding /private/original.json --case "$PROCEDURE_CASE_ID" \
  --plan-json /private/operating-plan.json \
  --selection /private/procedure-selection.json \
  --out /private/prepared-procedure
~~~

The output directory is an owned ordinary private directory. For a new preparation, use a new directory; completed files are never overwritten with different bytes.

A selection file names only actual retained inputs:

~~~json
{
  "actor": "Named operator",
  "note": "Purpose and limits of this operating procedure",
  "sourceIds": [],
  "tables": [
    {"key": "pinned-tables", "origin": "case-plan"}
  ],
  "editions": [],
  "stepLinks": []
}
~~~

Other supported table descriptions are `{key, origin:"case-source", sourceId}`, `{key, origin:"local-original", file}` and `{key, origin:"preceding-procedure"}`. The latter requires `parentSourceId` and copies that exact table key from the predecessor. Complete local originals are read as fatal UTF-8, never shortened to a preview. Each native edition is `{kind:"installation"|"task-outcome", id, revision}`. A step link is `{stepId, sourceIds:[], tableKeys:[], editionKeys:[], note:""}`; an edition key is `kind:id:revision`.

Save with one explicit request ID and its own operation directory:

~~~sh
starforge grant-procedures save \
  --binding /private/original.json \
  --procedure /private/prepared-procedure/grant-procedure.json \
  --request-id "$PROCEDURE_SAVE_ID" --operation /private/procedure-save
~~~

After interruption, use the same command and `--resume`. Do not change the original file, case, actor, binding or request ID. The command retains complete intent and dispatch records, forwards the actual native return before writing its receipt, and independently reopens the new source. If a returned receipt write fails, the exact native transaction can be reconciled by the same request. Original failures and incomplete files remain preserved.

Show a complete saved procedure and its verification:

~~~sh
starforge grant-procedures show \
  --binding /private/original.json --case "$PROCEDURE_CASE_ID" \
  --source "$PROCEDURE_SOURCE_ID" --out /private/reopened-procedure
~~~

## Complete export and independent receiving

A browser can download the original case ZIP and selected Operating Plan/procedure JSON. For one fully verified directory, use the native export:

~~~sh
starforge grant-procedures export \
  --binding /private/original.json --case "$PROCEDURE_CASE_ID" \
  --source "$PROCEDURE_SOURCE_ID" --expected-version "$PROCEDURE_CASE_VERSION" \
  --out /private/procedure-delivery
starforge grant-procedures inspect --directory /private/procedure-delivery
~~~

The directory contains the original `case.zip`, exact procedure and Operating Plan, native plan, complete selected table/edition files, readable HTML and Markdown, source links, original export metadata and both bracketing case reads. Every member has its complete byte count and SHA-256 in `DELIVERY.json`. Undeclared files, changed bytes, missing members or a changed case version are reported.

Export stages all complete files privately and publishes the directory atomically. A completed staged directory can be verified and adopted after a lost final publication. An incomplete capture remains preserved; it is not reported as a complete export. Source reads do not mutate the case.

Receive through the original importer:

~~~sh
starforge grant-procedures receive \
  --binding /private/receiving.json --directory /private/procedure-delivery \
  --request-id "$PROCEDURE_RECEIVE_ID" --operation /private/procedure-receive \
  --name "Received operating case" --actor "Receiving operator"
~~~

This validates every delivery member, imports the original ZIP through `client.importBundle("case", ...)`, then reopens the procedure in the actual new case. The result must identify the original archive and case in native import provenance. Sources keep their original IDs and bytes; the receiving case and native plan get the importer’s actual new IDs.

Close and reopen the original application, select the received case, and use **Operating procedures → Saved case sources**. Edit a step or its original source choices, prepare against the received case’s actual version, and save a new procedure linked to the preceding source. Export and receive that second complete case in the same way. `GRANT_PROCEDURES_RECEIVING.md` provides a single executable programme for this full two-receiver journey.

## Typed use

The normal distribution exports `./grant/procedures` and `./grant/procedures/native` with paired declarations. The pure module is usable in the browser and Node; the native module requires Node’s ordinary file and original client APIs.

~~~ts
import {GrantWorkspaceClient, inspectGrantAgentBinding} from '@tokenjunkielabs/starforge-merchant/grant/agent';
import {prepareGrantProcedureNative, saveGrantProcedureNative}
  from '@tokenjunkielabs/starforge-merchant/grant/procedures/native';

const binding = await inspectGrantAgentBinding(actualBinding);
const client = new GrantWorkspaceClient(binding);
await client.open({expectedSelectionSha256: binding.selectionSha256});
try {
  const prepared = await prepareGrantProcedureNative(client, reviewedSelection);
  const saved = await saveGrantProcedureNative(client, {
    prepared,
    requestId: retainedRequestId,
    operationDirectory: originalOperationDirectory,
    workspaceDirectory: binding.directory
  }, {emit: retainActualNativeEvent});
  console.log(saved.complete.source, saved.verification);
} finally {
  await client.close();
}
~~~

The API takes complete original JSON, explicit identifiers and actual client bindings; no credential or endpoint is inferred.

## Source and validation

This integration uses the maintained discovery model under `distribution/discovery/operating-plan.mjs`, the original source-table project importer, Grant workspace sources/history and its case exporter/importer. `grant-procedures.json` is a normal source-owned contribution; it adds commands and paired exports without replacing the central registry or application provider.

The managed launch source lists and authenticated static map include the browser editor, pure model and exact original discovery dependencies. A receiving host must use the complete selected Grant workspace source, not a hand-copied Python subset.

Native syntax checks of the first complete four JavaScript modules passed. The original selected-case programme and browser receiving are separate validation operations; their result must be reported from the actual returned native/browser output. Source publication alone does not establish a completed customer deployment, paid revenue, grant award or executed command.
