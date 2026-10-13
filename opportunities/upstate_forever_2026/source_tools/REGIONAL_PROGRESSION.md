# One retained regional receiving operation

`source_tools/receive_regional_progression.py` carries one actual Upper Savannah Workspace through the original regional opening, working coefficient revision, full native baseline and source update, saved view, complete archive and separately reopened receiving project. It runs the existing desks and native queue in sequence.

## Run on the existing scientific worker

Use current public main containing Profile workbench, native regional saved views, Source updates Integration 8 or its maintained successor, the scoped-auth browser corrections, and the native worker supervision module. Use the original Python environment with its scientific libraries, Node with Playwright, and its installed browser.

The continuation takes ownership of the original operator state for the duration of this one operation. Close that operator normally before starting; the original `.operator.lock` prevents a second server from opening the same state. The continuation starts the maintained server itself and closes it after its final result. Native models still run through the original queue and supervised worker.

When the regional opening is already retained:

```sh
python -B source_tools/receive_regional_progression.py \
  --workspace /actual/retained/workspace \
  --operator-state /actual/retained/operator-state \
  --opening /actual/retained/workspace/regional-workflow-opening.json \
  --run-selection /actual/retained/native-run-selection.json \
  --output /actual/receiving/regional-progression --video
```

The run selection is an existing native selection containing `grid_id`, `scenario_id` and, when explicitly selected, `models`. Read it from the selected original run or its saved view. An explicit selection retains its supplied `profile_id`; when that field is absent, it uses the regional opening's profile. All grid, scenario, profile and model compatibility checks remain in native `run.prepare`. If the opening names a completed baseline, omit `--run-selection` to reopen that exact run, including its original profile and selected models. A retained alternative remains an alternative. After the source update, both selected runs reopen through the original plan's mappings, preserving their scenario pair and model scope. The original pair and source-update lineage remain in the refreshed opening; old/new-source comparisons remain in the plan's own reports.

For a regional source that has not yet been opened, pass the existing regional launcher's arguments after `--`:

```sh
python -B source_tools/receive_regional_progression.py \
  --workspace /actual/retained/workspace \
  --operator-state /actual/retained/operator-state \
  --run-selection /actual/retained/native-run-selection.json \
  --output /actual/receiving/regional-progression --video -- \
  --source-manifest source/water_context/20261013/complete-native-sources.json \
  --source-id upper-savannah-water-context-domain217-20261013 \
  --huc12 030601010703 --huc12 030601010704 \
  --huc12 030601020502 --huc12 030601020507
```

A retained `--report REPORT_ID` can replace the source manifest/source-id pair. Other source, profile and original scientific selection arguments retain the original regional launcher's syntax. Workspace, state, output, server and transfer arguments belong to the continuation.

## What executes

1. The original regional launcher prepares or reopens its report and exact saved HUC selection. Its original project identity and saved notes remain native records.
2. The Profile browser opens the retained 15-class reference table and saves the existing sourced code-82 USLE C=0.25 working alternative to its original C=0.20. It uses the source reference and scientific qualification already present in that driver. The continuation reopens both native profile records and checks their actual table hashes.
3. Native `run.prepare` selects the actual model grid/scenario and original reference profile. Native `run.start` executes that baseline through the existing worker; an already-complete identical run is reused.
4. The continuation resolves the original and saved profiles' real source collection IDs and named biophysical source IDs. It writes their exact explicit mapping and invokes the original source preview. That preview must contain the selected baseline as a physically affected full-domain run.
5. The existing Source updates browser saves the immutable dependency plan, prepares its original native profiles/grids/scenarios/runs, executes the requested source update, and opens the actual plan and reports in a fresh browser. The continuation checks the original plan's completed mapping back to the selected baseline.
6. The refreshed opening binds the actual mapped profile, source table and completed native run. When the original opening selected a baseline and land-cover alternative, both selected runs are carried through the plan's mappings and remain that scenario comparison. A single selected run continues to expose its old/new-source pair. Original selections and mapped run identities are retained explicitly. The original saved-view service records the selection with existing notes. The saved-view browser opens the original desks, exports/reopens its choices, and reopens the view in a fresh browser.
7. The original regional transfer captures the complete Workspace through its existing backup task, streams its archive into the original upload service, restores an independent receiving project, and checks the original saved view and source identities. The source-update selection and execution state must reopen exactly.
8. The existing saved-view browser opens that receiving Workspace through the same server and reopens its retained scientific desks. The receiving copy remains independently editable.

`--prepare-only` is an explicit operating choice for preparing source dependencies without native model execution. The normal command executes the native baseline and physically affected source-update runs. The source-refresh engine retains its full original dependency scope, including any other original runs affected by the selected source collection.

## Include measured chemistry and monitoring work

The same retained continuation accepts `--chemistry-selection ACTUAL_SELECTION.json` after the maintained Chemistry browser contribution is present. The selection uses its exact original CLI fields: one `case-id`, or `source-collection` plus `source-id`; optional `edited-project`, `reason`, `request` and boolean `receive`. Request/project file paths resolve relative to this selection file. Their original bytes and the selection JSON are fingerprinted and frozen under the receiving output before the browser consumes them. The complete original chemistry workflow runs before the final Workspace archive, so its retained cases, sources and analyses travel with the project.

Use `--monitoring-selection ACTUAL_SELECTION.json` to run the original `operator/monitoring_receiving.py` in the same retained Workspace. Its `network` names the actual original domain/station sources, and its `configuration` states the planning costs and calendar. The original Monitoring engine owns design, campaign, field export, native receiving and continuation. Its separate received campaign and original progress file remain in the continuation's `monitoring/` directory. A native nonfeasible or solver design result remains an explicit `design_diagnostic` with its original status and `campaign_created: false`; the complete project archive still proceeds. Only the receiver's completed campaign, independent receiving record and revision produce `campaign_received`. The final progression result carries `monitoring_outcome`. Actual regional data and a named planning configuration should be supplied for this regional operation.

## Continue after a process interruption

Rerun the same command with the same output directory. The output's `.progression.lock` allows one owner. `progression.json` retains the original selection, current stage, native task IDs, browser output identities and completed transfer.

The original regional opening is frozen as `original-opening.json`. The final refreshed opening becomes the Workspace's current opening and `refreshed-opening.json`. When the source `--opening` path is that current Workspace file, the continuation still resumes from its frozen original selection.

Queue requests have deterministic operation IDs derived from this retained operation and exact payload. The same original failed/interrupted task is resumed. Each browser request is frozen before launch. Completed browser stages reuse their retained journals after a byte/hash check. A complete matching browser journal is adopted after a parent-process interruption between browser exit and the parent's checkpoint; its native workspace, request and opening identities are checked first. A browser interrupted after recording a queue task first resumes that task before operating its original controls again. The maintained Profile driver reopens its retained save request automatically; the Chemistry driver receives --resume only when this same output has its original request-state.json. A completed native child scenario is reopened under its original request. The source update's own immutable plans and checkpoint mappings retain native scientific work across re-entry.

The saved view selected for the final archive is frozen before transfer. A concurrent view edit is reported at that concrete transfer boundary so its original tasks can be reconciled. Completed receiving steps reuse their already-registered independent Workspace. When restore completed before the parent checkpoint, the continuation verifies its retained receipt, original backup and restore operation IDs, archive identity, current watershed/profile records, saved view and source plan, then reopens the same receiving project without staging the archive again.

## Read the original outcome

The last JSON line identifies the operation, original/receiving Workspace keys, source-update plan and `progression.json`. The journal records the exact failing stage and original traceback when a native command or browser step fails. Each subprocess keeps its original log and browser journey beside screenshots/video. Send that stage, task ID and traceback back to the same original receiving thread so its existing authors can repair the concrete exception.

The temporary private operator URL is written only beneath the local receiving directory with owner permissions and removed on normal closure. It is excluded from the scientific Workspace archive. The guide and public output use native record identities and local paths.

The continuation adds an operator of existing components. Scientific equations, raster preparation, source comparison, optimization, chemistry and native transfer formats remain in their original maintained implementations.


## Complete application source

The maintained application component catalogue explicitly includes this continuation, its original browser drivers and launcher, and supervised native worker modules in the guided journey closure. Build the current complete application through that catalogue. The original portable Workspace capture includes installed source families and verifies every retained member when restored; a profile-only source packet remains scoped to its published profile check.
