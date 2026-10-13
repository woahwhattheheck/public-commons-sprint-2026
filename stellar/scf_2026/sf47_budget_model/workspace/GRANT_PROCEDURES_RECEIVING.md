# Complete Grant Operations procedure receiving

This programme joins an existing Grant Operations case to its original Operating Plan, selected full source-table projects and optional native Installation/customer task editions. It saves a procedure as one ordinary native case source, exports the whole case, receives it in a separate original workspace, saves a reviewed second Operating Plan revision, and exports/receives the complete second case again.

The programme is `grant_procedures_receiving.mjs`, exposed by the maintained distribution as:

~~~sh
starforge grant-procedures-receiving --input /absolute/private/receiving-input.json
~~~

Use the actual original case, full JSON inputs and selected application workspaces. This programme does not create a demonstration source case, generate source rows, execute recorded commands, or submit an application. Its four native writes use the existing source attachment and complete case import APIs.

## Original operation and ownership

Keep the selected source case with its existing owner. Its current case identifier and version, actual workspace location and approved source selections come from the original owner in the existing handoff. Keep those private runtime inputs with that original case; source publication does not mean the programme has already run.

The source workspace and two receiving workspaces are distinct. Existing workspaces remain intact. New receiving directories can be created only through the original managed application startup beneath an existing private parent. The receiving programme does not move or replace an existing SQLite workspace.

Use the complete same-source application. Both `launch.mjs` and `managed_launch.py` hash their full original file list, including this integration and the original discovery/source-table modules. A missing leaf is a source installation error; do not remove it from the selected source list.

## Input contract

The input JSON has schema `stellar-forge.sf47-grant-procedure.v1.receiving-input`. It accepts exactly these fields:

| Field | Complete input |
| --- | --- |
| `schema` | The schema above. |
| `operationId` | One explicit 1–71-character original operation ID: first alphanumeric, then letters, numbers, dots, underscores or hyphens. |
| `actor` | The actual recording operator, up to 300 characters. |
| `caseId` | The existing native `operation-` identifier. |
| `expectedVersion` | The positive native version the operator reviewed before the first preparation. |
| `sourceBinding` | The original Grant client binding for the existing source case. |
| `receivingBinding` | An original binding for the first independent receiving workspace. |
| `secondReceivingBinding` | An original binding for a different second receiving workspace. |
| `operatingPlanFile` | Absolute path to the complete original Operating Plan JSON, including all revisions. |
| `selectionFile` | Absolute path to the complete reviewed procedure selection JSON. |
| `revisionTwoDraftFile` | Absolute path to a complete original OperatingPlanDraft with a real operator-authored change. |
| `revisionTwoSelectionFile` | Optional absolute path to a full second source/edition/link selection. |
| `receivingName` | Name for the new first native case. |
| `secondReceivingName` | Name for the new second native case. |
| `directory` | Absolute path to this one private programme directory, beneath an existing ordinary private parent. |

A binding contains the original declared fields:

~~~json
{
  "directory": "/absolute/private/actual-grant-workspace",
  "scenarioFile": "/absolute/complete-source/stellar/scf_2026/sf47_budget_model/sf10_current_candidate.json",
  "pythonExecutable": "/usr/bin/python3",
  "allowStart": false,
  "label": "Original reviewed Grant workspace"
}
~~~

Paths in this example are placeholders to replace with the actual selected native paths. `scenarioFile`, `pythonExecutable`, `allowStart` and `label` are optional in the original client; explicit values are useful for a portable receiving handoff. Without a scenario override the client selects the original released scenario beside its source. `allowStart:false` borrows an already running original service. Explicit `allowStart:true` permits the same maintained launcher to start that workspace.

No credential, listener URL or alternate transport is accepted in this configuration. The original launcher/client performs its existing private startup and source checks.

## Prepare the complete selected inputs

### Operating Plan and second draft

Export the first complete Operating Plan from the current Command finder or the procedure editor. Keep its real ID, complete saved revisions, step IDs and original selected command registrations. The complete file is the input, rather than a report reconstructed from displayed steps.

Create revision two with the original `operatingPlanDraft(plan)` API or the editor’s original draft export. Make a real change to a field such as one step’s instruction, expected result, responsible person or operator-recorded result. Preserve the original draft schema, plan ID and current `baseRevision`; do not invent a second plan or a revision number.

The programme uses `saveOperatingPlanRevision` once for this draft. It requires exactly one added revision and checks that every preceding revision remains byte-equivalent as JSON data. On a continuation it checks the retained second plan against the same reviewed draft and its original saved timestamp; it does not create another timestamp or revision.

For an installed consumer:

~~~js
import {readFile, writeFile} from 'node:fs/promises';
import {operatingPlanDraft}
  from '@tokenjunkielabs/starforge-merchant/operator/operating-plans';

const completePlan = JSON.parse(await readFile(actualPlanPath, 'utf8'));
const draft = operatingPlanDraft(completePlan);
// Apply the operator's reviewed change to draft.content.steps or the other declared draft.content fields.
await writeFile(actualNewDraftPath, JSON.stringify(draft, null, 2) + '\n',
  {flag: 'wx', mode: 0o600});
~~~

This example does not automatically mark a step complete. Use actual observed output and the named operator’s decision when changing status or recorded results.

### Selection JSON

The first selection accepts:

~~~json
{
  "actor": "Actual operator",
  "note": "Reason for this reviewed procedure edition",
  "sourceIds": [],
  "tables": [],
  "editions": [],
  "stepLinks": []
}
~~~

Populate the arrays with actual original selections. Optional `selectedRevision` chooses a retained Operating Plan revision; without it the latest revision is selected. Optional `parentSourceId` continues an already saved procedure in the original case.

Tables use one of the following complete origins:

| Table input | Meaning |
| --- | --- |
| `{key, origin:"case-plan"}` | The full retained source-table project in the current pinned native plan, with that complete native plan. |
| `{key, origin:"case-source", sourceId}` | The full original JSON attached to this case, joined to its exact source metadata. |
| `{key, origin:"local-original", file}` | A complete local source-table JSON file at an absolute ordinary path. All bytes are retained in the programme before a write. |
| `{key, origin:"preceding-procedure"}` | The complete table with that key in `parentSourceId`, preserving its original native-plan/source binding. |

A full source-table project includes its original documents, source editions, rows, mappings, explicit exclusions, review choices, workbook identity where present, and baseline. The original importer validates those fields. The programme never rebuilds a project from selected summary rows.

An edition selection is `{kind:"installation"|"task-outcome", id, revision}`. The programme reads the actual complete native edition. For customer tasks the returned object is the original `{source,edition,history,case}` view. It retains every field and the full source bytes, verifies the selected immutable source/edition and captured history, and allows later native history to extend that original history without replacing it. Installation reads retain their actual `current` context beside the immutable selected edition.

A step link is:

~~~json
{
  "stepId": "The original retained step ID",
  "sourceIds": [],
  "tableKeys": [],
  "editionKeys": [],
  "note": "How these originals support this step"
}
~~~

Use the actual source IDs and table keys. Edition keys are `kind:id:revision`. A link may refer to a step retained in earlier plan history. Missing or duplicate selections are rejected; the integration does not silently choose another source.

### Second selection

When `revisionTwoSelectionFile` is omitted, revision two retains the first procedure’s complete source selections, native edition references and links. Its tables use the explicit preceding-procedure origin to preserve the original pinned-plan identity through native case import.

Provide a second selection file to change those choices. The programme requires its `parentSourceId`, when present, to equal the actual first saved procedure source; otherwise it fills in that exact returned ID. No original source ID is fabricated before the first native return.

The second selection does not change the operator-authored second draft. Both documents are independently retained and validated.

## Execution and native transitions

The programme resolves the three original bindings and retains their actual source selection hashes. It reads all complete input files, then writes a create-only `INTENT.json` and complete private input copies before any native case action. A retry with different input bytes, programme bytes, selected source hashes or workspace directories fails before dispatch.

The full journey is:

1. Read the original case and require the reviewed version before the first preparation.
2. Prepare the full first procedure through the original source/table/edition readers, bracketed by native case reads.
3. Save one native case source with request ID `operationId-source`; retain its exact returned source ID and new case version.
4. Export the original complete case ZIP and a verified readable procedure directory as `delivery-1`.
5. Import that exact ZIP through the original importer in the first receiving workspace, request ID `operationId-receive1`.
6. Close and independently reopen that original client. Verify the exact first procedure, all selected sources, native editions and prior procedure history.
7. Apply the already reviewed original second draft, retaining the complete first plan history. Prepare/save the second procedure with request ID `operationId-revision2`.
8. Reopen the first saved procedure in that same receiving case and require its original bytes to remain unchanged.
9. Export the whole revised case as `delivery-2`.
10. Import that exact second ZIP in the second receiving workspace, request ID `operationId-receive2`.
11. Close and independently reopen the second client. Require the complete revised Operating Plan and the original first procedure in its retained predecessor chain.
12. Validate both complete delivery directories, forward the full actual result, then publish `COMPLETE.json`.

Only four original case mutations occur. The receiving case and plan IDs are the actual importer results. Each import retains the original archive hash and source case in native provenance, together with full source IDs, bytes and history.

Closing an owned original service permits a cold service reopen. Closing a borrowed service releases this client’s connection and drains its active requests; it does not stop another owner’s service. The result records actual close responses for every phase, so report the observed lifecycle accurately.

## Interrupted operation and returned results

Run the exact original input again with:

~~~sh
starforge grant-procedures-receiving \
  --input /absolute/private/receiving-input.json --resume
~~~

Keep the same input bytes, programme directory, source version, request IDs and original binding. The reviewed starting version remains the first version even if this programme has already attached a source. The retained prepared document and original request are reused.

Each native write has a complete intent and durable dispatch record. A received full native response is emitted before a fallible receipt write and is retained as exact bytes/base64, parsed value, status, media type and original source identity. A complete returned receipt is reused directly. If the connection was lost, explicit `--resume` invokes only the original transaction with the same request ID and exact body. This is the documented native transaction reconciliation route, not a new request.

A definite native rejection remains recorded and is not retried with a new ID inside this operation. A changed current case version before an undispatched save needs a newly reviewed preparation. Preserve the rejected or interrupted programme and create a separate explicit input only after the original owner resolves that state.

Exports are read-only. The native ZIP is retained complete, along with the before/after case reads. The exporter publishes one complete validated directory by atomic rename. A complete pending publication can be adopted after an interrupted rename; incomplete stages remain private and preserved. An export interrupted by a concurrent case change does not become a complete delivery.

A complete programme can be run again to verify its two frozen deliveries and independently reopen the second receiver. It emits `GRANT_PROCEDURE_JOURNEY_REUSED` and performs no new case write. The immutable original `COMPLETE.json` remains unchanged.

## Complete output

The private programme directory contains the original input, complete input files, both prepared procedure sources, all four original request/return directories, the full second Operating Plan, `delivery-1`, `delivery-2`, and the complete actual journey result.

Each delivery contains:

- The original full `case.zip`.
- `grant-procedure.json`, the exact complete procedure attached to the case.
- `operating-plan.json` and `native-plan.json`.
- All selected complete table and native edition JSON files.
- `procedure.html`, `procedure.md`, `source-links.json` and `README.md`.
- The actual receiving inspection, original native export metadata and both case reads.
- `MANIFEST.json` for the procedure file set and `DELIVERY.json` for the complete case delivery, with every byte count and SHA-256.

Moving a completed delivery directory is supported; each declared file is read and checked from the selected ordinary private directory. Do not remove a member, insert an unrelated file, or replace a full original with a path/pointer. Use the normal case ZIP importer to continue in another original workspace.

Keep private source/workspace content off public repositories. The software and guide belong in the maintained repository; real input files, original case ZIPs, sources and native results stay with the original case/operator.

## Browser receiving

The native programme does not assert a browser run. For the actual browser continuation, open the normal Grant Operations application on the first receiving workspace and select the returned case:

1. Open **Operating procedures → Saved case sources** and select the original first source. Confirm the selected sources/editions and complete history.
2. Open the second source and inspect the edited step and retained preceding revisions.
3. Review the **Sources** and **History** views. Follow the exact native source and edition selections; no live replacement is substituted for an earlier source.
4. Refresh the application with an unsaved draft and reopen its checkpoint. Verify that draft fields and original selection remain available.
5. If demonstrating an interrupted save, retain its exact pending request and use the displayed original recovery path. Do not dispatch a different request while the first remains unresolved.
6. Download the original case ZIP and selected procedure JSON, then open the second independent receiver and verify the same full history.

Use the actual browser and original application writer. Record the selected native case/source IDs and observed result. A screenshot by itself does not establish export integrity; the complete original directory/ZIP and its verification travel with the result.

## Result scope

A successful programme establishes actual original API source writes, complete native exports/imports, source/edition verification, and independently reopened revision history. It does not establish that an authored command ran, a customer accepted delivery, money was paid, an award was made, or a proposed operating target was achieved.

The programme stops on missing original sources, incompatible source installation, differing retained bytes, original native rejection, unreturned dispatch without explicit resume, or a failed complete receiving check. It preserves the same operation for recovery and reports the actual returned state.
