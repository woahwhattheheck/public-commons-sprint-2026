# Continue the original saved plan through Scenario design

This companion continues the completed Conservation browser operation. It opens the same original plan, carries that selection into the original editable geometry project, uses its existing land-cover handover controls, receives the complete edited ZIP through the operator's binary upload and queue, and reopens the returned native scenario. A requested prepared run is opened in the original Runs view.

## Current application

Use the complete maintained application with:

- The candidate catalog/browser and original saved-plan receiving from PR2921.
- The complete Scenario Design family and binary-upload handover from PR2952.
- The additive embedded original-editor successor, including its same-Workspace Store and registered file/API transport. The editor frame must be exposed as `iframe[data-design-editor]` and the retained preparation's Edit control as `data-design-action="edit"`.
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

The receiver checks the complete downloaded ZIPs, original saved-plan binding, exact original geometry with the explicit exclusion, actual feature count, explicit native selection, streamed upload identity, unchanged saved-plan IDs/summary, and stable receiving/scenario/run references. It retains screenshots at each useful visible stage and an optional browser recording.

## Retention and continuation

The output directory contains:

- `receiving.json`: exact original selection, operation/task IDs, source/result identities, actual browser outcome and any concrete exception.
- `editable-project.zip`: complete original prepared project.
- `native-handover.zip`: complete edited geometry, source binding, project and native selection.
- Stage screenshots and optional recording.

Before each queue submission, the companion checkpoints the original operation ID and request. If the response is lost, it resubmits that same request identity through the existing operator; the original queue resolves its existing task. Already retained task IDs are read directly, and interrupted design tasks resume through the same queue. An existing handover is reused after identity checks.

The private operator capability is removed from recorded error text. Keep the accepting host's startup JSON outside the shared result package.

The existing native run owner continues any prepared model execution and its original scientific report. This browser continuation keeps the plan, design project, native scenario and optional run linked throughout.
