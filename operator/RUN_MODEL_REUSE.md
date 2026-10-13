# Reuse completed native models from the run desk

The native run desk can prepare a full NDR + SDR target, select original completed stages from retained runs, and queue the normal run.start operation with both source run identities. The original native assembly checks the inputs and output files, saves the adopted stages in the target run, and finishes the derived outputs through the original execution and retention path.

## Operator workflow

1. In Native run desk, choose the completed working grid, parameter profile, baseline and alternative scenarios. Choose NDR + SDR for the full targets and prepare the selected cases.
2. Open **Reuse completed models** on a prepared or failed full target. Select an original NDR calculation and an original SDR calculation. Search by complete run identity, grid, parameter profile or scenario. Pagination changes the displayed choices and preserves the selected sources.
3. Submit **Combine and finish native run**. The retained payload is `run.start` with `{run_id, source_runs: {ndr, sdr}}`. The original operation continues after the form or browser closes. Open the task or native run from the same desk to inspect progress, retained outputs and any original input difference.
4. Compare completed pairs on the same grid, profile and model scope. Full baseline and land-cover alternative runs with both completed native models can enter the existing delivery builder.

A completed native stage can be reused when another stage in its source run later failed. The picker requires the requested model, a completed stage timestamp and retained stage file records, and excludes running or queued source runs. The original core checks the physical files, model version, actual arguments, tables, source inputs and scenario identity. Different retained grid or profile identifiers remain eligible for selection because the original core compares their actual native inputs.

## Compose complementary prepared inputs

When the original NDR and SDR calculations have separate prepared grids or source editions, open **Compose prepared inputs** in the Native run desk. A full target grid or run is not required for this path.

1. Select the completed NDR calculation and completed SDR calculation in the existing source picker. A completed stage remains selectable when another stage in its original run failed. The same original full run may supply both models.
2. Choose an existing full NDR + SDR parameter profile and the equivalent original scenario. Selecting the NDR source fills empty profile and scenario choices where possible; later changes preserve choices already made.
3. Inspect the original prepared-grid identities, actual resolutions and source editions. The operation preserves those physical inputs and compares their cells, model domain, reporting mask and reporting area through the maintained adapter. Source-specific 15 m reference, 300 m diagnostic and 30 m regional grids keep their selected metadata; this control does not choose a replacement resolution.
4. Optionally select **Check the prepared inputs only** and submit **Queue input check**. The original task retains the adapter's preview: planned full-grid identity, normalized native selection, source origins, source grids and compatibility details. This check uses the task queue because inspecting physical input files can take time.
5. Clear the check-only option and submit **Compose inputs and queue native run** to retain the full prepared grid and adopt the completed original stages. The composition task then submits the ordinary `run.start` task and returns immediately. Open **Open saved result** on the composition task or find the returned run in the native desk. Its ordinary task exposes native progress, original output retention, errors and resume controls.
6. Use the completed full run in the existing programme, comparison and delivery controls. Compose a compatible unchanged baseline and scenario pair from the same original grid inputs to retain their common comparison grid.

The composition task completing means that the prepared target was retained and its ordinary native task was submitted. The native task's own state reports calculation and derived-output completion. Its actual current status is included as `native_task` in the composition task detail, with the original native task and run identities. An error during child submission retains the already prepared run in the original composition task result. Resume that original selection to continue.

The target profile is an existing full profile; this form does not manufacture or combine biophysical tables. The maintained native assembly checks each model's actual table bytes, parameters, scenario and runtime compatibility. Candidate selection does not discard original stages merely because a source run's overall runtime changed after a partial resume: the original per-stage native checks remain authoritative.

## Programme model choices

Each programme form row now displays **Native models**: selected grid models, NDR, SDR, or NDR + SDR. Expanded partial selections remain explicit when opening, reviewing and saving a programme. Changing the profile or land-cover case keeps the chosen models; the native preview checks compatibility with the new inputs.

The run desk inspects actual preview bindings for partial programmes before opening their form, then passes the preview's normalized selection into the programme controls. The form submits the selection returned by its final native preview. Existing parameter-design metadata is retained only while its original profile and scenario remain selected.

## Integration

Install the current selected-model core and original queued completed-stage implementation. The maintained queue helper is `ecsa_runs/upstate.py`; its `invoke_original_run` consumes `source_runs` before freezing the selected inputs and invoking the original Workspace run.

This continuation adds the declared capability:

```python
ORIGINAL_RUN_CAPABILITIES = {"run.start": {"source_runs": True}}
```

The `operator/run_assembly_operations.py` catalogue requires that declaration and uses the helper's existing `integrate_operator(..., write=False)` function to confirm the installed original `Operator._invoke` run.start branch is already joined. The catalogue discovers prepared-grid composition with `importlib.util.find_spec`; it does not import the native composition implementation or inspect physical grid inputs on the request thread.

Version 2 of `operator/extensions/native-run-assembly.json` registers `run.assembly.compose` with the existing extension action dispatcher. The retained payload is:

```json
{
  "source_runs": {"ndr": "<original NDR run ID>", "sdr": "<original SDR run ID>"},
  "profile_id": "<existing full profile ID>",
  "scenario_id": "<equivalent original scenario ID>",
  "preview_only": false
}
```

Both original run IDs are required. Native IDs are complete 64-character hashes. API callers may omit the profile and scenario to use the adapter's original donor selection rules; the browser selects them explicitly.

The provider imports `model.completed_run_join` inside its queued invocation. A preview returns `preview(...)` through the original task. A composition calls `join_runs(..., execute=False)` and submits `run.start` with the returned run ID and both original source IDs. The child operation ID is `stage-grid-` plus the original composition task ID, so retrying the retained parent uses the same ordinary child request. The provider does not wait for the child while holding the workspace execution gate. The original task queue owns child scheduling, cancellation, recovery, input freezing and native execution.

The ECSA descriptor `operator/extensions/native-run-assembly.json` registers the catalogue and the picker module as an allowed browser asset. The run desk imports `attachRunAssembly` and opens its form with the existing host's `openForm`, `submitAction` and `openItem` capabilities. The normal target-run reuse form, `run.prepare`, `run.start` and original task recovery remain in use. The additional button opens composition mode within that same form and host; it adds no separate desk.

The complete source bank retains the current A73C / ECO-DELIVERY13-UI programme editor, including its native-model controls, and composes the capability declaration into 70CB's current queue helper with native-directory preservation. Apply the exact helper edit to current source; keep a compatible newer programme editor. The Git release preserves the already-merged editor unchanged. Full replacement of an existing owned run desk must match one of the recorded exact predecessors. The operations receiver composes all requested postimages, recognizes already-applied edits and keeps its original backup/journal behavior.

Install the merged `model/completed_run_join.py`, its CLI and guide from the same application first. The interface continuation changes only these five paths: `operator/run_assembly_operations.py`, `operator/extensions/native-run-assembly.json`, `operator/web/run_assembly_workbench.mjs`, `operator/web/run_workbench.mjs`, and this guide. Preserve the current Workspace, operator server, ordinary queue helper, programme controls and portfolio controllers when composing this update.

After installing, restart the cumulative operator. The native desk requests `GET /api/run-assembly/catalog?workspace=<key>`; an available response names `action: "run.start"` and `source_runs: true`. Prepared-input composition additionally advertises `prepared_grid_composition: true`, `composition_action: "run.assembly.compose"` and `composition_preview_queued: true`. Its button requires retained completed NDR and SDR stages, a full profile and a scenario; it does not require a pre-existing full target grid. The first retained reuse operation should return the original target run identity, its assembly source references, and the completed native result through the existing task.

## Source continuation

This module preserves ASTRA-7F24's separate NDR/SDR/combined row, task, programme and comparison identities; the operations desk's programme ownership and alias recovery; and its indexes and transition-based programme detail refresh. Stage progress still comes from the regular workspace state. The assembly catalogue is read once per mounted workspace, with transient read failures retried during later refreshes.

## Monitoring long programmes

The optional `programme-activity` backend supplies `GET /api/programme-activity/detail` with the workspace and programme_id. It uses the original manager's immutable record, progress, control and execution-lock checks. Native run stages and totals continue to come from the regular workspace state.

The response identifies immutable bindings with bindings_id and the current requested subset with request_id. The desk supplies those identities on later reads; the provider returns bindings and requested_runs again only when the corresponding identity changes. This avoids opening every native run and retransmitting all native artifacts for each programme activity check. The original full programme detail remains available in the programme view.

The desk reads fresh activity immediately before queueing work. Older applications use their existing programme detail route when the compact endpoint is absent. The provider registers no execution action and loads the native manager only when its activity route is requested.

The main operator state response also builds programme summary counts from the original run records already loaded for that same response. It verifies each run selection and selected-model completion once, reads each original native execution lock once, and preserves interrupted-process and inactive failed-attempt handling. Full programme detail continues to inspect artifacts, storage and execution history on request.
