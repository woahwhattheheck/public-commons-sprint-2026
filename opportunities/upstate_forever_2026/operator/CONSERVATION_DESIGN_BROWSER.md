# Continue the original saved plan through Scenario design

This companion continues the completed Conservation browser operation. It opens the same original plan, carries that selection into the original editable geometry project, uses its existing land-cover handover controls, receives the complete edited ZIP through the operator's binary upload and queue, and reopens the returned native scenario. It then captures the complete scientific Workspace, receives that archive into an independent Workspace through the same operator, and reopens the original saved editor project, revision, alternative, plan and native records. A requested prepared run remains the original retained run.

## Current application

Use the complete maintained application with:

- The candidate catalog/browser and original saved-plan receiving from PR2921.
- The complete Scenario Design family and binary-upload handover from PR2952.
- The additive embedded original-editor successor, including its same-Workspace Store and registered file/API transport. The editor frame must be exposed as `iframe[data-design-editor]` and the retained preparation's Edit control as `data-design-action="edit"`.
- Complete receiving and editor database capture from merged PR3123 (`ff839fd1183986d77616a3f254c32469008bfad3`), including the original SQLite online snapshot member and native design restore hook.
- Original `operator/conservation_browser_receiving.py`, whose small file/JSON helpers this companion imports.

Run with the accepting host's existing GIS Python and installed Playwright/Chromium. Reuse its local operator startup JSON; that file contains the private capability and stays on the host.

## Selection and invocation

The first browser operation must have completed and retained its original `receiving.json`, including `plan_id`, `study_id` and `workspace_key`. No new Conservation study or plan is created by this continuation.

Supply land-cover codes and a reason for the intended alternative explicitly. Select codes from the actual retained land-cover source/profile. The native receiver validates an optional run preparation against the retained grid, profile, selected models and complete edited footprint. Omitting run preparation still creates and retains the original native land-cover scenario.

Example command structure:

```sh
"$ECO_GIS_PYTHON" -B "$ECO_APPLICATION/operator/conservation_design_browser_receiving.py" \
  --operator-receipt "$ECO_OPERATOR_RECEIPT" \
  --conservation-receiving "$ECO_CONSERVATION_BROWSER_RESULT" \
  --from-codes $ECO_ORIGINAL_FROM_CODES \
  --to-code "$ECO_DESTINATION_CODE" \
  --reason "$ECO_DESIGN_REASON" \
  --output "$ECO_DESIGN_RECEIVING_OUTPUT" \
  --chromium /usr/bin/chromium \
  --record-video
```

`ECO_ORIGINAL_FROM_CODES` is the explicit whitespace-separated integer list chosen for this operation. The other variables are existing host paths and the selected code/reason. Use the same output directory to resume the same request. A different plan, footprint role, alternative title, codes, reason or run selection requires a different output directory.

Optional arguments:

| Argument | Original operation |
|---|---|
| `--alternative-title` | Base name (up to 180 characters) of the retained editor alternative. A short digest of this exact receiving selection is appended, so different receiving choices have distinct names. The same exact title reopens after an interruption. |
| `--geometry-role reporting_units` | Default original reporting-area portions by selected unit. Other supported original views are whole_units, reporting_union and whole_unit_union. |
| `--exclude-feature-key KEY` | Exclude one explicitly selected original editor feature from that alternative. The key must exist in the original project, and at least one feature must remain. All other original coordinates and the complete saved-plan reference are retained. |
| `--grid-id ID --profile-id ID` | Prepare this same received scenario on an existing original native grid/profile. |
| `--models ndr` | Optional explicit retained native model selection; requires the grid/profile. Both supported names can be supplied when the original grid/profile support them. |
| `--task-timeout SECONDS` | Finite per-task wait; default 300. A timeout preserves the original task identity for continuation. |

The named alternative applies the explicit land-cover change to every included original polygon. With no feature exclusion, the treatment footprint remains the complete chosen geometry view. A source-context plan remains a geographic source selection; physical effects are supplied by the existing native model operation after a compatible run is prepared and executed.

## Actual browser course

1. Reopen the completed original plan and record its exact selected IDs and saved summary.
2. Use the Scenario design controls to prepare that plan, retaining the original task, preparation, project and binding IDs.
3. Download the original editable-project ZIP through its normal verified file ticket.
4. Open the preparation's same original Store project in the embedded editor. Create or reopen one named alternative, record its reason, optionally exclude the explicitly selected original feature, and save through the original optimistic-revision writer.
5. Use Land-cover scenario to enter the explicit codes/reason and optional grid/profile/model selection. Download the complete native handover.
6. Receive that real ZIP through the visible file input. The existing raw upload retains the original bytes; the queued action carries its original upload ID.
7. Reopen the saved receiving record after a page reload, then open the original native scenario and optional prepared run using their existing item controls.
8. Use the original **Back up the original scientific workspace** form, retaining intermediates and the current operating journey. Reuse its queued `workspace.backup` identity and download its complete archive through the original file ticket.
9. Read the editor database snapshot actually stored in that archive. Verify its original member bytes/hash and self-contained snapshot metadata, and read the exact original project, current revision, matching historical body and history through the owner’s SQLite schema.
10. Use the original **Verify and restore original archive** form to stream the complete ZIP and queue `workspace.restore`. The existing operator verifies the archive, restores into its separate destination and registers that Workspace after its native extension checks.
11. Select the newly registered Workspace with the existing workspace selector. Compare its original plan, preparation, receiving, editor project/revision/history and native scenario/run to the archive’s original records.
12. Open the same preparation in the embedded original editor, select its existing saved alternative and capture the visible restored result. Reload the restored Workspace and reopen its native design receiving.

The receiver checks the complete downloaded ZIPs, original saved-plan binding, exact original geometry with the explicit exclusion, actual feature count, explicit native selection, streamed upload identity, unchanged saved-plan IDs/summary, and stable receiving/scenario/run references. It retains screenshots at each useful visible stage and an optional browser recording. The restored editor comparison uses the database revision actually captured in the archive. Later commits in the original live Workspace may differ; they belong to a subsequent capture.

## Retention and continuation

The output directory contains:

- `receiving.json`: exact original selection, operation/task IDs, source/result identities, actual browser outcome and any concrete exception.
- `editable-project.zip`: complete original prepared project.
- `native-handover.zip`: complete edited geometry, source binding, project and native selection.
- `scientific-workspace.zip`: the complete original Workspace archive produced by the existing backup action.
- `captured-editor.sqlite`: the verified original editor database member read from that archive.
- `captured-editor-project.json`: the exact captured original project/revision, selected alternative and history metadata used for restored equality.
- Stage screenshots, including restored editor and native design views, and optional recording.

Before each queue submission, including Workspace capture and restore, the companion checkpoints the original operation ID and request. If the response is lost, it resubmits that same request identity through the existing operator; the original queue resolves its existing task. Already retained task IDs are read directly, and interrupted design tasks resume through the same queue. An existing handover and Workspace archive are reused after identity checks. Completed capture and restore task IDs reopen their original results, preserving the same separate restored Workspace. When a completed old capture task is outside the current visible task window, its original authenticated download ticket supplies the same archive directly.

The private operator capability is removed from recorded error text. Keep the accepting host's startup JSON outside the shared result package.

## Original archive and restored identity

The archive must include `workspace/conservation-design/editor/projects.sqlite` and its original `database_snapshots` entry. The retained self-contained database uses the existing `sqlite-online-backup` path or its already verified frozen-snapshot representation. Live `-wal`, `-shm` and `-journal` sidecars are excluded. The reader uses SQLite in read-only immutable mode on the verified extracted snapshot; it leaves the live Store untouched.

The original Store’s current project row must match its corresponding revision row. After restoration, the operator’s original project and history read routes must equal that captured record. Opening the retained preparation and selecting its existing alternative must keep that saved revision. The original baseline geometry and Conservation source reference remain unchanged throughout.

`receiving.json.workspace_transfer` records the capture/restore task IDs, archive identity, original database snapshot, captured project/revision/alternative, newly registered Workspace key and paths, and the exact reopened plan, preparation, scenario and optional run IDs. The restored Workspace retains the original scientific project identity while using its own directory-derived operator key.

The operator’s configured upload limit must accommodate its complete archive. The existing backup and restore handlers, source manifests, SQLite capture, archive extraction and registered Workspace verification perform the transfer. An actual failure remains tied to its original task and archive so the same receiving operation can continue after the concrete issue is fixed.

A completed v1.1 result can continue into this full receiving course using the same output directory. Its original plan/design tasks and handover are retained; the new capture/restore work runs once and becomes part of the complete result. A result with `workspace_transfer.state` equal to `complete` verifies its retained local deliverables and reports those same identities on repeat invocation.

The existing native run owner continues any prepared model execution and its original scientific report. This browser continuation carries the same plan, design project, native scenario and optional run through its independent restored Workspace.
