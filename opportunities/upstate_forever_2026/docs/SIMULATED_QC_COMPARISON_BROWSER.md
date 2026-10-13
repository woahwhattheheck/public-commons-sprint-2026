# Recorded original sample-QC comparison

This chapter operates the existing saved-QC comparison in the original Implementation desk. It uses the comparison created from a completed, explicitly simulated field course, the exact original before/after review IDs and the author's declared group pairs. The parent keeps the same recorded browser page, native Operator, scientific Workspace and teaching operation.

The chapter makes the comparison useful on screen: it opens the retained result, exercises its source chooser and empty filter, reconstructs the explicit pairing as an unsaved native preview, downloads the original exports and reopens the unchanged report in an independent browser. The complete native preparation and receiving contract is in [SIMULATED_QC_COMPARISON.md](SIMULATED_QC_COMPARISON.md); the product's detailed scientific and operator instructions are in [SAMPLE_QC_COMPARISON.md](SAMPLE_QC_COMPARISON.md).

**Needs expert review.** Programme-specific QA criteria, group relationships, method comparability and interpretation belong to the responsible scientist. The recorded course follows the authored simulation's retained criteria. Before and after are the selected source order. A change in duplicate precision does not establish an environmental or conservation effect.

## Retain the actual native choice first

Use the original completed field operation with the maintained native comparison consumer. Its saved result includes schema `upstate.simulated-qc-comparison/v1`, the original field operation, comparison operation, project, field plan, saved comparison report and comparison IDs.

The model returns:

```javascript
{
  project_id,
  plan_id,
  comparison_report_id,
  comparison_id,
  operation_id,
  field_operation_id
}
```

The current Operator caller adds its actual `workspace_key`. This is the Operator's registration key, distinct from the scientific project UUID. Get it from the original registered workspace; the model cannot infer it.

Retain the complete native consumer result, its original field source identities, report selection and archive selection with the parent recording request. Use the consumer's `attach_to_delivery` and `attach_to_archive` helpers when joining the existing mapped delivery and whole-project archive. Preserve the preceding five field/QC/action sources in their original order and keep the existing primary source. A project archive captured before the comparison is a different edition.

The browser chapter reads the saved comparison through the original `comparison-inspect` endpoint and independently checks the registered project and current original field plan. Its source checkpoint includes the complete comparison, retained file inventory and current plan digest. A changed plan or comparison requires a new recording edition. Existing work and earlier recordings remain retained.

## Callable interface in the current recorder

The additive module is `source_tools/simulated_qc_comparison_browser.mjs`. It exports one callable chapter:

```javascript
import {runQCComparisonChapter} from "./simulated_qc_comparison_browser.mjs";

const result = await runQCComparisonChapter({
  page,
  choice: {
    ...nativeResult.browser_choice,
    workspace_key: registeredWorkspaceKey
  },
  operatorURL: originalPrivateOperatorURL,
  output: originalRecordingDirectory,
  checkRunning,
  capture,
  checkpoint,
  progress,
  pause
});
```

The parent owns the recorded page, browser context, persistent profile, video, native service and cooperative stop behavior. The module does not launch Playwright or resolve its package. The installed parent's Playwright module remains authoritative.

| Argument | Required contract |
| --- | --- |
| page | The parent's existing recorded Playwright page. |
| choice | The six exact native choice fields plus the current original Operator workspace_key. |
| operatorURL | The original HTTP(S) Operator capability URL with its token fragment. Keep it private. |
| output | The parent's existing private recording directory. |
| checkRunning | Existing parent cutoff/stop callback; its errors retain the original publicCode. |
| capture | Existing parent screenshot callback, accepting a stable label and meaning metadata and returning the retained file descriptor. |
| checkpoint | Persist the complete original progress while holding the parent's existing operation lock. |
| progress | Existing mutable parent progress object. This chapter uses only progress.qc_comparison. |
| pause | Optional existing parent pause callback for the final recorded frame. |

One chapter can operate a page at a time. The parent must serialize the recording operation and retain its request and progress before invoking it. This module contributes no additional command-line interface or independent demo server.

Keep the native consumer and browser source in the same installed application. The additive component fragment includes the native model, this module and both operating guides. Shared driver and recorder changes remain with their current source owner.

## Original receipt, receiving and recorder composition

The original scientific driver retains the complete consumer result under `receipt.qc_comparison`, alongside its existing `fieldwork_operation_id` and `fieldwork_plan_id`. Create that result and call `attach_to_delivery` and `attach_to_archive` before the existing mapped-delivery and whole-project export. The model consumer remains the source of the actual operation/report IDs.

The additive `source_tools/simulated_qc_comparison_recording.py` supplies:

```python
bind_comparison(workspace, original_receipt, recording_output)
validate_choice(choice)
verify_choice(workspace, recording_output, choice)
```

`bind_comparison` returns `None` when the original receipt has no comparison. When present, it inspects that exact completed native operation and checks its six browser identities, report source, archive selection, original field operation, plan and project against the driver receipt. It freezes the complete actual native inspection as `uploads/simulated-headwaters/qc-comparison-inspection.json`.

The returned descriptor contains its relative path, byte count, SHA-256 and all six exact choice fields. `verify_choice` rejects aliases, checks the frozen bytes, reopens the same native operation and requires its complete canonical result to agree. It returns the verified absolute local path for the browser caller. This step creates no scientific run, field revision or report.

The maintained receipt builder adds that descriptor as `qc_comparison_receiving`. Its ordinary receiving validator requires the same original field chapter and verifies matching field operation, plan and project. The receiving programme checks the frozen source again before starting the original Operator and passes its exact descriptor into the current browser input.

The parent recorder binds those file bytes and six identities into its saved progress. After its original field/QC chapter and before customer handback, it verifies the frozen inspection, supplies the current sender workspace key and invokes the borrowed chapter. All returned public members enter the original final file closure; independent-browser screenshots enter the same actual capture inventory. Private task snapshots and recovered local drafts remain on the private recovery surface.

Existing field, programme, customer, native transfer, narration and cutoff logic retain their source. The parent records comparison operation/report IDs in its interruption checkpoint. A previously started recording input without this comparison remains its original edition; build a new recording edition from the updated retained driver receipt to add the chapter. Reuse the existing scientific Workspace and completed original results.

The complete source packet provides guarded literal joins and full candidate parent postimages. The current parent owner composes those joins on fresh maintained source, preserving any later native/course fixes, and publishes the shared receipt builder, receiving programme and recorder together with the additive binder, chapter and component closure.

## What the recorded course does

### Open the original retained comparison

The chapter navigates through the original workspace selector, Implementation, original field plan, Field, Sample QC and **Compare saved QC reviews**. It opens the exact saved comparison report, verifies that both original QC report IDs are visible, and captures the populated result at the desktop recording width.

It enters an unmatched search term and observes the real zero-result filter. Clearing the filter restores all original pair rows. This empty state concerns the filter, not the existence of the original QC data.

### Reconstruct the explicit comparison

It chooses the saved before and after QC report IDs, loads those exact sources and fills the original title, reviewer, date, purpose and notes. For every saved pair, it selects the actual original group on each side and enters the retained relationship basis and notes.

The original comparison engine calculates the unsaved preview. The chapter downloads that preview from the actual UI and compares its complete pair bodies with the retained native comparison. Newly created local pair identifiers are presentation-draft identities; all scientific fields, original group identities, criteria, outcomes, metric values, difference-admission reasons and authored notes must match.

The course captures the original source chooser, declared relationships and results at 1440 by 1000 and 390 by 844 pixels. It then reopens the exact retained comparison for the export and source actions.

No browser call saves another comparison or changes original laboratory observations, QA, task states, group definitions or criteria. The unsaved comparison editor is used to demonstrate the real controls and evaluator.

### Use the original native queue

**Export complete original source package** and **Retain scientific report source** use the original `implementation.qc.comparison.export` and `implementation.qc.comparison.source` actions.

The exact action, payload and operation identifier are checkpointed before a browser request is dispatched. If the first response is lost, the same retained request is replayed. The server may return an equivalent already-active task with a different operation ID; the chapter checks the exact workspace/action/payload, native request digest and task identity, then retains that accepted identity separately. Subsequent reads stay bound to it.

Completion is read through the original decorated `GET /api/task`, including its current native download tickets. Interrupted original tasks use the original task-resume endpoint. Failed tasks remain tied to their original request and actual failure.

The editor receives the exact accepted task back through its existing pending-task and poll behavior, including after a lost browser response. It displays the original completed result before the next action. A saved field plan is compared before and after the whole course to verify that the original plan remained unchanged.

### Download and independently reopen the full result

The scientific-source result supplies the complete native report download list. The chapter compares every filename, byte count and SHA-256 with the original retained file inventory. It operates every corresponding download control and saves the exact bytes in a flat report directory.

That directory contains the unchanged comparison HTML and its companions. It also contains **before-review.zip** and **after-review.zip**, each holding the complete unchanged original QC report under its original filenames. Extract either original ZIP into a separate directory and open its `report.html` to follow the original relative links. The prefixed original companion files in the comparison package remain available for direct source inspection.

The chapter closes the field modal editors, opens the original native export task and uses its complete-package download link. It verifies the downloaded ZIP against the original native archive descriptor.

A newly created independent browser context opens the same exact saved comparison through the original Operator. It then opens the downloaded flat report's `report.html`. Actual screenshots of both independent views are retained. The parent's recorded page also visits that unchanged downloaded HTML at desktop and narrow widths.

The independent context is always owned by this chapter and closed during cleanup. The borrowed recorded context remains the parent's.

## Files and retained state

The parent progress member uses schema `upstate.simulated-qc-comparison-browser/v1`. It retains the exact native choice, an Operator-origin digest, attempt history, actual source snapshot, accepted native tasks, file inventory and screenshot descriptors.

| Member under the original recording directory | Contents |
| --- | --- |
| qc-comparison/native-comparison.json | Complete original saved comparison, source file inventory and current original plan digest. |
| qc-comparison/attempt-N/ui-preview.json | Complete actual UI preview for that attempt. |
| private/qc-comparison/attempt-N/native-task-export.json | Decorated original completed export task as observed in that attempt. |
| private/qc-comparison/attempt-N/native-task-source.json | Decorated original completed scientific-source task as observed in that attempt. |
| private/qc-comparison/attempt-N/original-draft.json | Exact original local draft, retained only on the private recovery surface. |
| private/qc-comparison/attempt-N/draft-before-recovery.json | Intervening local draft preserved when an earlier stopped attempt left restoration pending. |
| qc-comparison/attempt-N/fresh-native-comparison.png | Actual independent-browser view of the same retained comparison. |
| qc-comparison/attempt-N/fresh-offline-report.png | Actual independent-browser view of the downloaded unchanged report. |
| qc-comparison/report/ | Every original report member with its original filename, including both complete original review ZIPs. |
| qc-comparison/complete-source-package.zip | The original native complete comparison archive. |
| Parent screenshot inventory | Recorded desktop, narrow, original-source, explicit-pair, empty-filter, native-task and offline-report frames. |

Attempt numbers are decimal `1`, `2`, and so on. Each attempt keeps its own preview, decorated task snapshots and independent-browser screenshots. Native report files and the complete package retain their immutable original paths and hashes across retries.

The result contains `status`, the exact choice fields, `files`, `screenshots`, `task_ids`, `report_source` and `visual_review`. The parent should carry all returned files into its ordinary recording delivery and preserve their source meaning. Native task snapshots and recovered pre-existing local drafts are retained separately under private/qc-comparison and are excluded from returned public files; their descriptors remain in progress.qc_comparison.private_files. A same-operation retry also separates those private records retained by an earlier interrupted source edition. Public progress contains only the private file descriptors; original draft text is never embedded in the browser-progress JSON. Precisely hash-verified legacy recovery/task members from an earlier interrupted edition are physically moved into private storage before completion, and legacy inline draft text is likewise replaced by its retained private descriptor. The parent must use the explicit returned file inventory, not recursively publish private directories.

Private progress may contain native file tickets and an original local draft. Keep the complete receiving directory on the existing authorized internal surface. The module excludes the Operator token and origin from public error text and stores an origin digest in its choice binding. Do not publish private capability URLs.

## Interrupted recordings and local draft recovery

Before the chapter changes the comparison editor's local storage, it writes the original value into its immutable private file under the exact workspace/plan key, checkpoints only that file's descriptor and marks restoration required. It temporarily uses its own local selection while preserving any existing user's draft and pending-task reference.

Ordinary completion closes the comparison and QC editors before restoring that exact original value. This order prevents a closing editor from overwriting the restoration with the temporary teaching selection.

If the parent stops and closes its persistent page, the original draft remains retained in progress with restoration pending. Resume the same recording operation and choice. On the matching original origin, the chapter first saves any intervening local value to the attempt's recovery file, restores the original, and only then starts another temporary comparison selection. A changed source choice or different Operator registration requires a separate receiving edition.

The module registers every newly created context immediately and closes only those contexts. It removes its exact action-request route handler, restores the parent's viewport and retains explicit cleanup errors. The parent's operation lock and checkpoint ordering remain authoritative.

Published source members are immutable. An existing member with different bytes is an error, not an invitation to overwrite it. Keep the earlier output and use the appropriate new recording edition when the original sources or plan have changed.

## Producing-author rendered inspection

The course finishing sets `status: "course_complete"`. Its `visual_review.status` remains `producer_inspection_required` until the producing author has actually looked at and operated the outgoing product.

Open the actual rendered screens or real screenshots, including the desktop and narrow selection/results, empty filter, source definitions, withheld-difference reasons, native completion and independently reopened report. Check readable hierarchy, full labels, units, spacing, tables, long source identities, scrolling and downloads. Plain industrial software is the intended design.

Operate the important controls in the exact outgoing edition. Open both original QC ZIPs separately, follow their unchanged relative links, inspect complete CSV/JSON beyond the visible page and reopen the full comparison. Look at each actual screenshot; merely collecting it, counting DOM nodes, receiving HTTP success or reading this source is insufficient.

Repair visible clipped, overflowing, cramped, unreadable, unstyled or broken output in the current authorized source and inspect the affected journey again. Preserve the original calculation, records and single active writer for each real Workspace.

**All attachments count.** Literally open, view, play and use the final delivered HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as its recipient would. For archives, extract and open the actual contained deliverables and working project. Tests, checklists and screenshots merely captured are not substitutes. Use available high-quality generative media models and natural voice generation/TTS for videos; avoid robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing; inspection must lead to useful repairs rather than replace implementation with repeated review.

Carry this complete standing rule into active owner-controlled instructions and receiving guides actually consumed by each delegated worker, including global/project AGENTS, CLAUDE, GEMINI, rules, provider boot instructions, Commons source mirrors and cloud repository instruction copies. Preserve existing owner controls and historical evidence; do not rewrite vendor or third-party policies. An acknowledgement alone does not propagate the rule. Return exact changed paths, versions and readback through the existing source operation. Do not force restarts, create watchers or revive owner-stopped work. The October 13 sprint cutoff is 14:00 UTC; it does not expire the standing product-inspection rule or change other owner-directed schedules.

The existing native owner continues the same completed field operation. The shared recording owner incorporates this chapter into its current course. Different equipped hosts may consume independent replicas under their own actual Workspace and operation identities when the current owner authorizes that course; do not invent execution ownership from an idle historical role label.

## Source contracts

- Saved comparison product: [PR3917](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3917), including the native comparator, provider, original QC editor and comparison UI.
- Borrowed field/QC recording lifecycle: [PR3851](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3851), subsequently composed by the current shared recorder owner.
- Native simulation and comparison integration: the complete installed `model.simulated_fieldwork` and `model.simulated_qc_comparison` editions selected by the parent operation.
- Scientific source opener: the maintained `operator/web/implementation_source_reports.mjs`, which retains native source collection/source IDs and the original report publisher.
- Current original Operator task and file-ticket interfaces remain authoritative.

The repository's existing licence terms apply.

## Complete current owner direction

The following complete project brief is retained from `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, Git blob `8cd1c1f3d371a2fb75471813844e31f489aa8272` (4999 bytes; SHA-256 `57945ea0e6eca762011e9f7e6febd39255359143d454fd3aa58a3a849ec14fc9`). Carry it with this original receiving and recording course. The completed simulated square and its retained field/QC comparisons remain their existing source edition; the actual Upper Savannah geographic calculation uses its separate current source and native owners. Preserve completed calculations and their original outputs when continuing this chapter.

> # Current owner direction: Ecosystem Sciences demonstration
> 
> Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.
> 
> ## Direct owner instructions
> 
> > do the simulated model
> 
> > just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it
> 
> > just checking dont pause anythi g
> 
> > and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast
> 
> ## Build for an experienced scientific practice
> 
> Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).
> 
> Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.
> 
> ## Execute the prepared simulated case now
> 
> Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.
> 
> Demonstrate the scientific operation in the actual application:
> 
> 1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
> 2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
> 3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
> 4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
> 5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.
> 
> Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.
> 
> ## Present the real work and real speed
> 
> Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.
> 
> If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.
> 
> ## Carry this direction with the work
> 
> Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.
> 
> Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
