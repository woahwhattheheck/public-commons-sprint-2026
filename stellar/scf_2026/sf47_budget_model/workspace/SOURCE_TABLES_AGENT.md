# Source tables and editable workbooks through agents

The typed Grant client and Merchant MCP operate the same saved plans, original workbook reader, retained source tables and native calculator used by the Grant Operations page and CLI. An operator can receive an original CSV or XLSX, choose its worksheet and columns, review all planning collections, calculate a complete native preview, save that exact review and deliver an editable workbook with its selected native plan revision.

## Open the existing workspace

Use the existing private Grant workspace connection and `merchant_grant_open`. A host-declared input alias, a completed original byte transfer or an existing snapshot supplies input files. Keep the workspace alias, snapshot identifier and whole-file SHA256 together. The original host owns paths, executables and managed service permissions.

The complete connection, startup, array paging, file transfer and native request recovery instructions are in [GRANT_WORKSPACES.md](../../../../stellar-forge/mcp-merchant-operator/GRANT_WORKSPACES.md). Browser and CLI operation remain described in [SOURCE_TABLES.md](SOURCE_TABLES.md) and [WORKBOOK_HANDOVER.md](WORKBOOK_HANDOVER.md).

## Complete operator sequence

1. Open the selected saved plan with `merchant_grant_source_snapshot`. Supply `planId`; use `revision` and `expectedContentSha256` when continuing an exact saved edition. An existing source project keeps all original XLSX files, worksheet selections, source editions, bindings and reviews. Its baseline becomes the selected native revision.
2. Inspect an original XLSX with `merchant_grant_workbook_inspect`. Review actual sheet names, ranges, headers, hidden rows, source cells and cached formula results. Use the original file for subsequent projection. A delimited table can instead enter through `merchant_grant_source_receive`.
3. Supply the complete original mapping to `merchant_grant_workbook_project`. It names the sheet, range, each selected column and the original formula/date/blank/numeric choices. Pass the whole returned `{source,projection}` response into `merchant_grant_source_workbook_receive` for the selected role. For a returned five-sheet native-plan workbook, `merchant_grant_source_workbook_return` receives all four planning sheets under one explicit return profile.
4. Use `merchant_grant_source_read` with a role to inspect its complete normalized rows, source record/cell mapping and edition comparison. Configure the actual column bindings, merge/replacement choice, source-row decisions, planning settings and dependent-row policy with `merchant_grant_source_configure`. Select another retained worksheet or source edition with `merchant_grant_source_select` when that is the intended source.
5. Freeze each reviewed collection with `merchant_grant_source_review`. Name every role being reviewed. A returned workbook requires the actual review of packages, milestones, contributors and assignments before the native preview.
6. Run `merchant_grant_source_preview`. Its retained complete response includes the original prepared source input, native budget/cash/capacity result, source-row provenance and immutable preview identity. Review that response before saving.
7. Save with `merchant_grant_source_save`, passing the entire preview, a named review note and the original stable request ID. The native plan writer owns the transaction. Retain those exact three inputs for recovery.
8. Deliver an exact saved revision with `merchant_grant_workbook_handover`. Supply the saved plan ID, revision, content SHA256, explicit workbook profile and a stable handover request ID. Download the complete archive and native planning ZIP through the existing retained-file tools.
9. Receive the native planning ZIP through `merchant_grant_plan_import` in the declared receiving workspace. Open its saved source project with `source_snapshot`, or explicitly `source_rebase` the delivered source project onto the imported plan. The original editions and workbook cells remain available for the next review.

### Pass complete source references

Source operations return an immutable full JSON file. Their small display is a navigation aid; the original file supplies the next operation. A project response wraps the complete book at `/book`:

~~~json
{
  "project": {
    "input": {"snapshotId": "SNAPSHOT_ID"},
    "expectedInputSha256": "WHOLE_RESPONSE_SHA256",
    "inputPointer": "/book"
  }
}
~~~

Replace the example identifiers with the actual returned values. The expected digest always covers the entire retained response, including when a pointer selects one nested object. The provider verifies the complete bytes before following the pointer. A standalone planning-source-project.json has no wrapper; omit inputPointer for that file.

A workbook projection uses the whole retained native `{source,projection}` object. A preview also uses its whole response, without `/book`:

~~~json
{
  "workspace": "grant",
  "preview": {
    "input": {"snapshotId": "PREVIEW_SNAPSHOT_ID"},
    "expectedInputSha256": "WHOLE_PREVIEW_SHA256"
  },
  "note": "Reviewed the complete returned workbook and native delivery plan",
  "requestId": "original-workbook-review-save"
}
~~~

For a snapshot retained under another declared workspace, add `sourceWorkspace` inside `input`. Original file references accept a hostInput, snapshotId or transferId. Worksheet mappings can be passed inline as `mapping`, or as the complete verified JSON reference in `mappingInput`.

### Explicit choices

`merchant_grant_source_profiles` exposes the original four role definitions and complete export/return profiles. These are starting choices that an operator reviews.

| Choice | Effect |
| --- | --- |
| Workbook worksheet and columns | Select actual source cells, formulas/caches, dates and text conversions through the native reader. |
| Field binding | Select a source column, an explicit constant or an existing native value for each planning field. |
| Merge or replace per role | Decide how received packages, milestones, contributors and assignments join the selected native plan. |
| Hidden and excluded source rows | Retain the original rows and record the explicit include/exclude decision. |
| Dependent-row policy | Preserve or remove unreferenced native rows through the original planner rule. |
| Export number and precision profile | Choose exact text or spreadsheet numbers, and the explicit fallback when exact decimal values exceed spreadsheet precision. |
| Export amount profile | Choose original native amounts or the existing hours-times-rate spreadsheet formula. |

Source operations preserve the original parsers and calculators. Receiving a returned workbook prepares source material; collection reviews and the native save remain explicit operations.

## Saved revisions and interruption recovery

The save uses the exact prepared preview and its retained review timestamp, so an identical request reconstructs the original native payload. If the response is lost, reuse that same preview, note and request ID. The native writer can return the original successful revision even after a later operator has saved another revision. A newly generated preview belongs to a new reviewed save.

If a source project is based on an older plan, inspect the later saved plan and use `source_rebase` to select it explicitly. Rebase preserves every original source edition and clears the applied preview selection. Recalculate and review the resulting native change before saving.

The existing `merchant_grant_export` with `kind:"plan"` accepts an optional exact `revision`. Omitting revision exports the current saved plan. The typed client's `download('plan',{planId,revision})` uses the same native route.

A completed workbook handover request retains its exact source selection, archive and four direct member files under the original exports directory. Repeating the same request after Merchant MCP restarts returns those retained files. Reusing its request ID for another plan, revision, content hash or workbook profile is rejected. If file retention stopped partway, keep the actual returned files and repeat the same request after restoring storage.

## Complete handover and downloads

The archive contains all fifteen original members: the five-sheet XLSX, original native planning ZIP and full history, export and return profiles, full source project, operating guide, four worksheet mappings, four CSV projections and WORKBOOK_EXPORT.json. Every direct companion is byte-identical to its corresponding complete handover member.

The response also exposes four standalone snapshots:

| File | Receiving use |
| --- | --- |
| planning.zip | Native import into another declared workspace. |
| planning.xlsx | Spreadsheet editing and complete returned-workbook receiving. |
| planning-source-project.json | Full source project with the original XLSX files, retained editions, worksheet choices and reviews. |
| WORKBOOK_EXPORT.json | Whole saved-plan selection, workbook/table identities and numeric decisions. |

Use `merchant_grant_file_read` with the original snapshot and expected SHA256. Continue its returned readId and nextOffset until nextOffset is null; keep the whole file's exact byte count and SHA256. A process restart or expired reader can reopen the same snapshot at the retained byte offset. The original immutable file remains available after reader release.

Original raw workbook and input-transfer files retain their 32 MiB bound; delimited source text retains its 16 MiB bound. The complete retained source book retains the original 32 MiB pretty-JSON bound. Generated source-operation/preview envelopes can use up to 64 MiB, including a valid near-limit book and response metadata. Reference loading accepts the complete envelope before validating the selected book. Native HTTP request limits still apply to actual reader and save payloads. The full handover permits the original 128 MiB member allowance plus up to 1 MiB ZIP framing. Archive reads stream the original private retained file through the existing chunk reader.

## Typed client

The installed `./grant/agent` export includes concrete workbook, mapping, source-project, preview, profile and response types. It uses the same opened GrantWorkspaceClient lifecycle:

~~~js
import {readFile} from 'node:fs/promises';
import {GrantWorkspaceClient, inspectGrantAgentBinding}
  from './agent-client.mjs';

const binding = await inspectGrantAgentBinding({
  directory: '/srv/stellar/grant',
  pythonExecutable: '/usr/bin/python3',
  allowStart: true,
  label: 'Original grant plan'
});
const client = new GrantWorkspaceClient(binding);
try {
  await client.open({expectedSelectionSha256: binding.selectionSha256});
  const initial = await client.planningSources('snapshot', {planId: selectedPlanId});
  const received = await client.planningSources('receive-returned-workbook', {
    book: initial.value.book,
    file: {filename: 'returned-workbook.xlsx', bytes: new Uint8Array(await readFile(returnedFile))},
    profile: reviewedReturnProfile
  });
  const reviewed = await client.planningSources('review', {
    book: received.value.book,
    roles: ['packages', 'milestones', 'contributors', 'assignments']
  });
  const preview = await client.planningSources('preview', {book: reviewed.value.book});
  // Retain and review preview.bytes, its SHA256 and the complete native result.
  const saved = await client.planningSources('save', {
    preview: preview.value, note: reviewedNote, requestId: originalSaveRequestId
  });
  const delivery = await client.planningSources('handover', {
    planId: saved.value.id,
    revision: saved.value.revision,
    expectedContentSha256: saved.value.contentSha256,
    profile: reviewedExportProfile
  });
  // Retain delivery.bytes and all delivery.companions with their original hashes.
} finally {
  await client.close();
}
~~~

The identifiers, files, notes and profiles in this example are caller-selected inputs. A host must retain the full preview before a recoverable save and the resulting complete files before delivery. Direct client responses contain the original full bytes, digest and source selection; Merchant MCP supplies retained snapshots and stable completed-handover recovery.

## Continue the original workbook customer case

~~~sh
node examples/source-tables/receive-current-budget-workbook-mcp.mjs COMPLETE_NATIVE_CASE_DIRECTORY
~~~

This programme continues the completed original workbook case identified by WORKBOOK_HANDOVER_RECEIVING.json. It receives that case's actual final native ZIP into its own private continuation workspace, retains the original edited XLSX and profiles, operates the complete Merchant source workflow and saves through the native writer. It exports an exact saved revision, receives the full archive and four companions, reopens completed handover files after a Merchant restart, imports the complete native ZIP in another declared workspace and reopens the result through the native CLI.

The original six-package example case keeps its entered one-hour workbook change and staffing choices. Its reviewed result remains 401 hours and $38,095. The continuation records the actual source histories and cell provenance it receives, with all full source projects, previews, native plans and portable outputs. It uses the same case directory and preserves the original native and browser receiving summaries.

The programme retains phase inputs and outputs before the next native operation. Repeating its command resumes the same source references, reviewed preview, save request and completed handover. Its complete result is mcp-receiving/WORKBOOK_MCP_RECEIVING.json; keep the entire mcp-receiving directory with the original case. Use the existing --resume-browser programme in WORKBOOK_HANDOVER.md for the same case's browser continuation.


### Preserve the complete case before file receiving

After the complete handover is retained, the programme closes both native workspace clients. Merchant then receives the retained archive and companion files without keeping those native processes open. It reopens the original clients for the completed-handover comparison and the receiving workspace's native import, preview and cold CLI reopen.

For a host-side portable checkpoint at this boundary, select the supplied complete-case helper and a private directory outside the operating case:

~~~sh
SF47_WORKBOOK_MCP_CHECKPOINT_HELPER=/absolute/source/examples/source-tables/checkpoint-workbook-mcp.py \
SF47_WORKBOOK_MCP_CHECKPOINT_DIRECTORY=/absolute/private/workbook-checkpoints \
node examples/source-tables/receive-current-budget-workbook-mcp.mjs COMPLETE_NATIVE_CASE_DIRECTORY
~~~

The helper takes the two original workspace locks, preserves the entire operated case and saves an immutable ZIP plus its complete checkpoint record. Original inputs, source selections, reviewed previews, save requests, native databases, retained handover files and partial outputs stay together. A repeated request receives the existing matching checkpoint. The programme continues into full file receiving immediately after the checkpoint returns.

A host can select its own Python helper through the same environment variable or the exported function's `checkpointHelper` option. The helper receives one JSON request on stdin containing schema `stellar-forge.planning-workbook-mcp.receiving.v1.checkpoint-request`, the original operation ID, phase `14-complete-workbook-handover`, the complete case directory, `originalContentSha256` and `handoverArchiveSha256`. It returns one JSON object with the corresponding `.checkpoint` schema, `state: COMPLETE`, the same four identity fields, and the actual whole archive's positive byte count and SHA256 in `archive`. An optional `location` identifies the saved output. The supplied helper provides the complete local-archive implementation; a host's storage adapter can persist that archive before returning its saved result. The original checkpoint record in `mcp-receiving/checkpoints` is reused on continuation.
