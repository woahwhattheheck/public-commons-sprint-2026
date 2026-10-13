# Receive a saved Profile in its original workbook

TokenJunkie Labs. This is the existing Profile workbench's complete workbook-return workflow, operation family ECO-PROFILE-WORKBOOK-RETURN-R103D-20261013. It retains the actual scientific Profile and original workbook edition. It does not alter the saved Profile, create a model run, or replace the current native/browser owner.

Read CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 and the application's AGENTS.md. Preserve the actual A555/NativeExpansion scientific operation and every existing workbook/source identity. Native model execution remains with its existing owner; this course uses an already saved Profile and its real retained original workbook.

## Operator workflow

Open the actual saved Profile in **Profile workbench**. Its **Return profile values to an original workbook** panel is part of the same authenticated application and selected Workspace.

Choose one retained XLSX/XLSM source member. Each source choice identifies its original collection, source entry, member index and SHA-256. Source-backed suggestions are optional and explicitly applied. They come from verified original coefficient ancestry; they are not inferred from similar sheet headings.

For every applicable saved coefficient and native model parameter, choose one original worksheet and physical cell, or enter an explicit exclusion reason. The panel shows the exact saved value, original units and full original cell details. Use the paged original cell chooser or direct A1 lookup. The native reader determines writable cells using actual formula, merge, signature and effective protection rules. Explicitly unlocked cells on a protected sheet are allowed when the native reader permits them. The panel cannot edit the scientific value.

Enter the return title, preparer and purpose, then **Review complete workbook changes**. Review every source-to-cell association, original value, returned value, type and exclusion. Only an eligible complete current preview enables **Create named workbook return**. The browser saves the complete original request before posting it to the original operator queue.

After completion, use the panel's retained downloads. The output contains the unchanged original workbook, the separately named derived workbook, exact saved Profile and coefficient CSV, complete mapping and cell preview, member-level source preservation inventory, change CSV, readable HTML and original implementation/receipt. Formulas, macros and external links are not evaluated by this product. The recipient spreadsheet application must be used for actual recalculation and visual inspection.

**Open complete project handover** opens the existing selected Study desk with root kind profile-workbook-returns. The original source, Profile ancestry, reviews, operation context and all returned files travel with that selected Study. Full Workspace backup remains available separately.

## Working copies and interrupted operations

Working files retain the complete selected source, mappings, exclusions, named saved result and original request history. They are scoped to the original scientific project and saved Profile. The native source is carried by the complete Workspace/Study, not silently reacquired from a filename.

Each browser save uses an IndexedDB revision comparison. Another tab's save cannot silently replace visible work. Preserve a conflicting visible copy under a new identity or explicitly reopen the other saved version. A return request freezes its mapping. **Separate editable copy** retains the old request/record in its origin and starts a visibly different editable draft.

**Read original result** resolves the actual original operator UUID/alias and domain journal. **Retry exact retained request** resends only an unaccepted exact original body. A failed/interrupted native task retains its task ID and uses the original **Resume original operation** control. Never create a replacement UUID merely because a reply was lost. A received project without an aliased operator journal can inspect its saved return; continuing an aliased unfinished request requires the original operator history.

## Browser course in the original receiving lifetime

The complete maintained helper is source_tools/receive_profile_workbook_return_browser.mjs. It takes the existing caller's Playwright page, authenticated API adapter, Workspace key/path, exact complete reviewed selection and owned receiving directory. The caller keeps its original browser/profile, task controller, listener and receiving lock.

The ABI matches the application's existing source_tools/receive_scientific_configuration_browser.mjs convention. No new browser or listener is launched by this helper.

~~~js
import {
  receiveProfileWorkbookReturn,
  inspectReceivedProfileWorkbookReturn,
} from './source_tools/receive_profile_workbook_return_browser.mjs';

const browserReceipt = await receiveProfileWorkbookReturn({
  page, api, workspace: workspaceKey,
  workspaceDirectory: originalWorkspaceDirectory,
  selection: actualCompleteSelection,
  directory: originalReceivingOutput,
  operationId: originalReceivingOperationId,
  signal: originalAbortSignal,
  cutoff: originalCutoff,
  openProfile,
});
~~~

api(path,{method,body}) is the caller's existing authenticated operator adapter. It must return the actual parsed response and throw actual failed responses; preserve Authorization and original Workspace checks. openProfile(profileId), when supplied, operates the same page's existing Profile desk. Without it, the helper uses actual maintained navigation buttons. These callbacks are not a substitute server or source importer.

The course types the complete reviewed mapping through the real controls. It retains one named browser working copy and its original source/operation binding, captures the current preview, deliberately drops one actual first action response after retaining it, recovers the same original IDB request, receives and explicitly replays that UUID, downloads every native member, renders the exact HTML and captures desktop and 390 px views. Original completed downloads are reused by their full bytes/hash. Later capture attempts have separate directories; original return/receipts stay fixed.

This simulated response loss affects only the workbook-return action. It starts no numerical model, payment, provider transfer or second scientific operation. An actual native error/cutoff stops with the original task retained for its owner.

The input selection must be the actual native selection reviewed for the saved Profile:

~~~json
{
  "profile_id": "ACTUAL_SAVED_PROFILE_SHA256",
  "workbook": {
    "source_collection_id": "ACTUAL_SOURCE_COLLECTION_SHA256",
    "source_id": "ACTUAL_ORIGINAL_ENTRY_ID",
    "part": 0,
    "sha256": "ACTUAL_ORIGINAL_WORKBOOK_SHA256"
  },
  "title": "Named original workbook return",
  "author": "Actual preparer",
  "reason": "Actual scientific return purpose",
  "mappings": [
    {
      "sheet": "ACTUAL_ORIGINAL_SHEET",
      "cell": "B12",
      "source": {"kind": "table", "lucode": "ACTUAL_CODE", "column": "ACTUAL_COLUMN"}
    }
  ],
  "exclusions": []
}
~~~

The names in this schema illustration are placeholders, not executable scientific data. Include every applicable field via mappings or reasoned exclusions. The native preview supplies preview_sha256; the browser course does not fabricate it. The module receives no spreadsheet path outside the original retained Workspace.

## Native complete Workspace and selected Study receiving

After the actual browser action completes, use its exact return_id and original receiving operation:

~~~bash
python source_tools/receive_profile_workbook_return.py \
  --workspace /absolute/original/workspace \
  --return-id ACTUAL_RETURN_ID \
  --operation-id ORIGINAL_RECEIVING_OPERATION \
  --output /absolute/owned/receiving/output
~~~

For a source-native receiving continuation that already holds the exact reviewed selection plus preview_sha256, use --selection /absolute/original-selection.json instead of --return-id. This creates only the explicitly requested workbook return and reuses the same original operation ID. Do not run both alternatives to create duplicate returns.

Output must be outside both source Workspace and application. The helper retains its first original request, opens every result file, reads every member of the original and derived OOXML packages, parses actual XML, replays the accepted original operation and verifies the model's original-cell/member preservation closure. It creates a complete Workspace archive and an editable selected Study, verifies every archived returned member, restores both, and invokes the actual helper copied inside each received application.

The owned cold reader defers interruption during process acquisition until its exact child handle is retained, then drains that child before returning the original error.

A retry verifies/reuses the same archives and completed receipts. Legitimate later work in either receiving Workspace remains untouched. The selected Study uses:

~~~json
{
  "schema": "upstate.study-selection/v1",
  "title": "Original saved return title",
  "roots": [{"kind": "profile-workbook-returns", "id": "ACTUAL_RETURN_ID"}],
  "include_related_results": true
}
~~~

Then use the original caller's already maintained cold Workspace/browser opening path and run:

~~~js
await inspectReceivedProfileWorkbookReturn({
  page: receivedPage,
  api: receivedAuthenticatedApi,
  workspace: receivedWorkspaceKey,
  receipt: nativeReceipt,
  browserReceipt,
  directory: originalReceivingOutput,
  openProfile: openReceivedProfile,
});
~~~

The original report is served through its complete retained relative-path inventory, including nested implementation members. The course follows every actual report link through that browser route and records the full response byte count and SHA-256 before completing; all member downloads remain bound to the original native descriptors.

The cold phase checks the exact original selection/preview and opens the saved return through the current Profile desk at desktop and 390 px. It does not create a new workbook, rewrite a scientific Profile, or request another model execution.

## Actual inspection and delivery

The source and receiving code are executable, but source review does not establish that the outgoing workbook or application was operated. The first receipt remains OPERATED_AWAITING_LITERAL_INSPECTION until the responsible existing receiver actually opens and uses the product.

Personally view the original and derived workbooks in the recipient spreadsheet application, all worksheets and changed cells, retained formulas, formatting, protection and source attribution. Macros and external links remain original and are not activated by this helper. Recalculation, if performed by the recipient application, produces a separate observed output; keep the published original derived bytes unchanged. Inspect the readable HTML at desktop and 390 px and open all CSV/JSON/source inventories, complete archives and extracted scientific project. View the captured screenshots themselves. A screenshot filename, successful XML parser or another agent's source approval is not visual acceptance.

Record the exact outgoing source/member hashes, actual open/render observations and any unresolved native/Office defect in the same original receiving handoff. Fix concrete defects there. Do not start a second host/controller or copy a customer's commercial material into Git.
