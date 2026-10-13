# Compare original source versions in Measurements

Open **Measured data → Source versions** in the existing operator. This is the existing Measurements workspace and original source review history. It does not import a second copy, normalize new fields, infer a preferred publisher or recalculate a model.

## Choose the original source scope

Select one retained edition or a pair of editions. The list identifies each by its original label, import ID and occurrence count. Leave both blank to inspect all retained editions.

Choose **Different retained versions**, **Unresolved versions**, **Explicitly selected versions**, **Repeated original occurrences**, or **Every original-result group**. Search uses the station, parameter and retained original result content. Select **Compare retained sources**. The displayed count covers all matching groups; Previous/Next only pages the screen.

Each group uses the original normalizer's exact logical key. WQP result IDs and complete source-specific fallback keys remain unchanged. USGS series/date identities remain unchanged. Similar dates, coordinates or numerical values from different original keys do not establish a duplicate. Different agencies' station identities are never silently combined.

A source pair identifies the groups to inspect, not a new scientific population. Each opened group includes **every** retained version and source occurrence, including versions in other retained editions. A group present in only one selected source is labelled present/not present. This does not establish a deleted record, a missing observation period, or a preferred source.

## Compare full records

Select **Compare full records**. The table initially shows differing measurement fields. **Show all measurement fields** includes unchanged fields as well. **Compare all original source columns** shows complete original publisher values side by side.

Absent properties, explicit null and empty text have separate labels. Original reported values and units remain original strings. Normalized values are shown alongside their existing source context, without added conversions. Complete rows retain method, fraction, qualifiers, censoring and detection limits. Each version shows every source import, SHA-256 and original physical line number. Repeated identical occurrences are retained even when they share one canonical record.

Each version also shows the existing calculation eligibility and its reasons. A selected record may still be unusable because of its original censoring, unit, quality flag, missing value or unassigned native reach. Selecting a source version does not waive those rules.

Open the complete original row and review history when needed. **Download [source name]** retrieves the original retained file. **Open version … in Measurements** returns to the original single-record inspector and quality review.

## Record a reversible explicit decision

Choose **Select one original version**, select its exact version, enter the reviewer and rationale, then **Save explicit source decision**. The service requires the inspected global Measurements revision and the complete group binding. A changed workspace is rejected before the original review transaction.

This calls the existing record review writer with state `include` and `selectVersion:true`. Other originals and their reviews remain retained. The original eligibility, calibration and paired-load calculations therefore consume the same explicit selected version.

To withdraw the selected source preference, choose **Return current selection to unresolved** with a reviewer and reason. This sets the previously selected version's review to `pending` using the same existing writer and removes its selected-version binding. It does not overwrite the other versions' review states. There is no bulk preference or automatic newest-source rule.

If a request fails or its acknowledgement is uncertain, the draft remains visible. Refresh the group and inspect its actual retained review/history before resubmitting. The client does not blindly repeat a potentially accepted write. If another person changed Measurements, inspect the new complete group before recording a new decision.

## Save, export and reopen

Enter a reviewer and report purpose, then **Save complete comparison report**. This records every group in the applied scope, not just the visible page, plus complete original records, occurrence links, source text, source hashes, rejected rows, source mapping/provenance and review histories. The report is retained in the original Measurements exports table with its original workspace revision.

Open a retained comparison in the report list. Reopening verifies its immutable source bodies, normalized original rows and every source occurrence against the retained originals, plus group membership, comparison cells and snapshot counts. An edited report is rejected rather than silently repaired. Historical review, native-reach assignment, eligibility and selection remain the saved snapshot and do not have to equal later live decisions. A historical report remains unchanged after later review decisions. Its header identifies that its revision differs from current Measurements. Readable HTML, complete JSON and occurrence CSV are available from the same saved report.

The occurrence CSV contains a row for **every original source occurrence**. Spreadsheet-sensitive text is escaped for safe opening by the original CSV rules; the complete original bytes and literal values remain in JSON and the original source files. The readable HTML carries every compared field, full version history and complete original source content; its complete JSON button works offline.

**Export complete editable workspace** is the original portable Measurements export. It includes original imports and original occurrence links, reviews, selected versions, station assignments, event history and saved comparison reports. Receive that file through **Exports & handover → Receive** in an empty receiving Measurements workspace. The existing receiver rebuilds and verifies canonical records from their original source bodies. It does not overwrite a nonempty workspace.

After receiving, reopen **Source versions**, compare the same original key and reopen the retained historical report. Continue through **Open calculations and exports** to the existing calculation choices. No new scientific engine is introduced.

## Saved drafts and navigation

The child view returns its exact filter, selected group/report and unrecorded review draft to the parent before remounting. Leaving an unrecorded reviewer choice through the child navigation asks whether to leave it; browser exit warns while a draft is unrecorded. A late response from a destroyed view cannot replace the current view or publish an old error. An in-memory draft is not a saved scientific decision; record the decision or preserve the complete workspace after saving.

## Original command-line route

The same application CLI exposes the original store through additive `reconciliation-*` commands. Use its installed help for the application root and database directory. The operations are `reconciliation-catalogue`, `reconciliation-groups`, `reconciliation-group`, `reconciliation-decide`, `reconciliation-reports`, `reconciliation-save-report` and `reconciliation-report`; `--file` supplies a complete JSON input, `--id` identifies an exact group or report, and report output selects `--format json`, `--format csv` or `--format html`. The CLI uses the same complete report and original review transaction as the browser. A decision must bind the current `expected_revision`, `group_id`, `group_binding`, reviewer and reason.

## Integration and original receiving course

Owned additive files are engine/source_reconciliation.mjs, web/source_reconciliation.mjs and web/source_reconciliation.css. The parent Measurements view supplies its existing Response-returning `request(path,method,value)`, exact snapshot state, original record inspector and exports navigation. HTTP routes are under `/api/measurement-workspace/reconciliation`. The root producer composes those hooks with the advancing readable Results, Flow and source-return modules, original static routes, operator mirrors and installed component inventory. Do not replace another producer's full advancing shared file with an earlier copy.

Carry the complete project AGENTS.md v2026-10-13.1, CURRENT_OWNER_DIRECTION.md v2026-10-13.4 and the current 52 work orders. Preserve Tim's original files, scientific choices, source names/units/periods and existing native calculations. Keep TJLabs attribution and existing supplier terms.

The producing worker must open the affected real application in its existing equipped receiving course, operate source pair/filter/group/decision/reset, saved historical report, original downloads, complete editable export and independent reopening; LOOK at desktop and 390px layouts and open every generated attachment with its normal viewer. Source review, a DOM adapter, HTTP status or hash agreement does not establish rendered acceptance. Continue the same original Measurements 8357 receiving operation and actual installed Workspace, preserving admitted model jobs; no new controller or model campaign is required. Respect any reserved local browser and use only the actually authorized equipped browser.


## Runnable receiving chapter on the existing equipped host

The maintained chapter is `measurement_workspace/engine/reconciliation-receiving.mjs`. It accepts an **actual retained portable Measurements workspace** and uses the original native `MeasurementWorkspace.receive()` to create an explicitly separate receiving copy. There is no built-in measurement fixture, provider fetch, simulated publisher correction, new model run or rewrite of the populated source workspace.

Use the original DD6B/CB54/675D Measurements receiving course and its already equipped Node and isolated Chromium runtime. Finish the current admitted task before starting this chapter. Preserve the complete installed application and advancing shared installer. Never point the receiving output at the source database or running application's files.

First export the actual populated workspace through **Export complete editable workspace**, or use the original CLI:

~~~sh
node APPLICATION/measurement_workspace/engine/cli.mjs portable --workspace ACTUAL_MEASUREMENTS_DIRECTORY --output OWNED_INPUT_DIRECTORY/original-measurements.json
~~~

Keep that input outside the receiving output. If the original Measurements directory includes `reaches.json`, retain that complete original file and supply it with `--reaches ORIGINAL_REACHES_JSON`. The portable format carries station assignments but the native reach file is a separate original companion. The chapter copies its unchanged bytes into both receiving directories; it never invents reach IDs or geometry. Without that companion, the original eligibility rules may show missing native reach support, and that absence remains visible.

Run with the actual original paths:

~~~sh
node APPLICATION/measurement_workspace/engine/reconciliation-receiving.mjs --portable OWNED_INPUT_DIRECTORY/original-measurements.json --output NEW_OWNED_RECEIVING_DIRECTORY --reviewer "Actual receiving operator" --reason "Review the retained source-version workflow on this receiving copy" --playwright EXISTING_PLAYWRIGHT_MODULE --chromium EXISTING_ISOLATED_CHROMIUM_EXECUTABLE
~~~

Every flag uses a space before its value. The output must be new, or an exact continuation with its retained `selection.json`. The same input bytes, reviewer, reason and selection options are required on continuation. The original complete input, every unchanged source file and original intake history remain retained.

With no selection option, the chapter records no source preference. It still operates actual edition filters, full original groups, complete historical report, HTML/CSV/JSON and original attachments, editable export and independent cold receiving. A source with no multi-version group is reported as such. Repeated identical occurrences remain visible; a lack of conflicting publisher editions is not a failed scientific result.

To exercise selection/reset using an **actual existing multi-version group**, review the retained catalogue and add both exact IDs:

~~~sh
--group-id EXACT_ORIGINAL_LOGICAL_KEY --record-id EXACT_RETAINED_VERSION_ID
~~~

Alternatively, explicitly add `--exercise-selection first-retained` to select the first retained version of an actual conflicting group **only in the receiving copy**, with an attributed temporary receiving rationale. The report retains that selection and the chapter then returns it to unresolved. This is a workflow demonstration, not a preferred-publisher rule or a recommendation to change the source project. When the actual data contains no conflicting group, it skips selection/reset and states why. It never authors another publisher edition to manufacture an overlap.

### Native and browser work performed

The chapter verifies the complete portable source through the existing receiver, checks all unchanged original import/record/occurrence/station/assignment tables and retains every input source body. It identifies one real group and its actual source pair, including all original-key versions outside that pair. Original saved source-review reports must already pass the maintained immutable-source checks.

The CLI starts only the maintained Measurements server on the owned receiving copy and an isolated Chromium process using the supplied existing runtime. It never terminates an unrelated operator, browser or model process. The original receiver may instead import `prepareSourceVersionReceiving(options)` and `operateSourceVersionReceiving({page, endpoint, prepared})` into its existing course. The latter compares the complete server portable state to the prepared owned copy before any UI write; it rejects a page serving a different workspace. The host retains page/process ownership in that form.

Actual browser controls perform the selected edition comparison, full group opening, optional attributed selection, complete report save, optional reset, historical reopening and downloads. The same original report is checked after current decisions change. A lost report acknowledgement is reconciled against its retained reviewer and purpose; a completed review is not silently repeated. A conflicting independent selection stops the course for inspection. Unique, flushed progress files permit continuing after an interrupted write without a fixed temporary filename blocking every later attempt.

Every report source is downloaded through its visible original-file control or the same existing original attachment route, even when it belongs to another group in the full saved scope. The original input supplies every additional source outside that scope. All bytes and source hashes are checked.

The chapter opens the offline HTML report and operates its complete JSON download. It retains desktop and 390px images with the relevant original-source details expanded. These are viewport images, not a claim that every long report section has been visually inspected. It then receives the complete editable export through the original native receiver into an empty second directory, checks reviews, selections, saved exports and original event history, and opens the historical report again in a fresh isolated browser on that cold receiving copy.

### Complete outputs and actual viewing

Open `ATTACHMENTS.html`. It links every finished report, original input, unchanged source file, JSON/CSV, plan and screenshot, with full byte length and SHA-256. Text attachments can also be read in full inside the index. `ATTACHMENTS.json` is the complete machine-readable inventory; `COMPLETE.json` binds that inventory and records actual source identity, selected report, counts and decision-course outcome.

The recipient outputs include:

- `source-version-review.html`: complete readable historical comparison with an offline JSON button.
- `source-version-review.json` and `source-version-occurrences.csv`: complete saved original fields and every occurrence.
- `source-version-group.json`: the complete current selected group after the receiving course.
- `editable-workspace.json`: original editable Measurements export after the explicitly requested receiving decisions.
- `original-workspace.json` and `originals/`: exact supplied input and complete unchanged source bodies.
- `cold-reopened-report.json`: the same historical report reopened in the independently received database.
- `owned-workspace/` and `cold-received/`: receiving databases for continued native editing.
- Desktop, 390px, reopened, offline-report and cold-received images.

Actually open and use the HTML, complete text/source attachments and both editable receiving workspaces. LOOK at the affected screenshots and application controls at desktop and 390px, scroll through long comparison sections, inspect originals and verify the intended next edit. Record actual visual findings in the same original receiving operation. Automated assertions, source adapters, hash agreement and the presence of image files do not establish that a person has viewed them. The output deliberately leaves that visual-review statement pending.

Without Playwright/Chromium arguments, the chapter can verify and retain the native receiving copy and returns `AWAITING_EXISTING_EQUIPPED_BROWSER`; that is not completion. Repeating the same command with the equipped paths continues the same output. On error retain the output, original service log and current process handle; inspect the first concrete failure before retrying. The owned service PID, endpoint and acknowledged shutdown state are retained in `service-session.json`. A still-live or ambiguous previous PID blocks a second launch. The chapter never stops an unrelated process. Existing receiving directories reject symlinks and shared writable file inodes before native opening, so a copied path cannot redirect a receiving write into the original project. Only a completed course emits `COMPLETE_NATIVE_AND_BROWSER`, still with actual human/agent visual inspection to finish. No Tim data is replaced, and no native or rendered result is asserted before the equipped producer executes the chapter.
