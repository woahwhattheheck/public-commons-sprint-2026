# Reuse completed native models from the run desk

The native run desk can prepare a full NDR + SDR target, select original completed stages from retained runs, and queue the normal run.start operation with both source run identities. The original native assembly checks the inputs and output files, saves the adopted stages in the target run, and finishes the derived outputs through the original execution and retention path.

## Operator workflow

1. In Native run desk, choose the completed working grid, parameter profile, baseline and alternative scenarios. Choose NDR + SDR for the full targets and prepare the selected cases.
2. Open **Reuse completed models** on a prepared or failed full target. Select an original NDR calculation and an original SDR calculation. Search by complete run identity, grid, parameter profile or scenario. Pagination changes the displayed choices and preserves the selected sources.
3. Submit **Combine and finish native run**. The retained payload is `run.start` with `{run_id, source_runs: {ndr, sdr}}`. The original operation continues after the form or browser closes. Open the task or native run from the same desk to inspect progress, retained outputs and any original input difference.
4. Compare completed pairs on the same grid, profile and model scope. Full baseline and land-cover alternative runs with both completed native models can enter the existing delivery builder.

A completed native stage can be reused when another stage in its source run later failed. The picker requires the requested model, a completed stage timestamp and retained stage file records, and excludes running or queued source runs. The original core checks the physical files, model version, actual arguments, tables, source inputs and scenario identity. Different retained grid or profile identifiers remain eligible for selection because the original core compares their actual native inputs.

## Programme model choices

Each programme form row now displays **Native models**: selected grid models, NDR, SDR, or NDR + SDR. Expanded partial selections remain explicit when opening, reviewing and saving a programme. Changing the profile or land-cover case keeps the chosen models; the native preview checks compatibility with the new inputs.

The run desk inspects actual preview bindings for partial programmes before opening their form, then passes the preview's normalized selection into the programme controls. The form submits the selection returned by its final native preview. Existing parameter-design metadata is retained only while its original profile and scenario remain selected.

## Integration

Install the current selected-model core and original queued completed-stage implementation. The maintained queue helper is `ecsa_runs/upstate.py`; its `invoke_original_run` consumes `source_runs` before freezing the selected inputs and invoking the original Workspace run.

This continuation adds the declared capability:

```python
ORIGINAL_RUN_CAPABILITIES = {"run.start": {"source_runs": True}}
```

The read-only `operator/run_assembly_operations.py` catalogue requires that declaration and uses the helper's existing `integrate_operator(..., write=False)` function to confirm the installed original `Operator._invoke` run.start branch is already joined. It exposes no new queued action.

The ECSA descriptor `operator/extensions/native-run-assembly.json` registers the catalogue and a form-only `attachRunAssembly` controller. The run desk opens it using the existing extension host's `openExtension` capability. The normal `run.prepare`, `run.start` and original task recovery remain in use.

The complete source bank retains the current A73C / ECO-DELIVERY13-UI programme editor, including its native-model controls, and composes the capability declaration into 70CB's current queue helper with native-directory preservation. Apply the exact helper edit to current source; keep a compatible newer programme editor. The Git release preserves the already-merged editor unchanged. Full replacement of an existing owned run desk must match one of the recorded exact predecessors. The operations receiver composes all requested postimages, recognizes already-applied edits and keeps its original backup/journal behavior.

After installing, restart the cumulative operator. The native desk requests `GET /api/run-assembly/catalog?workspace=<key>`; an available response names `action: "run.start"` and `source_runs: true`. The first retained reuse operation should return the original target run identity, its assembly source references, and the completed native result through the existing task.

## Source continuation

This module preserves ASTRA-7F24's separate NDR/SDR/combined row, task, programme and comparison identities; the operations desk's programme ownership and alias recovery; and its indexes and transition-based programme detail refresh. Stage progress still comes from the regular workspace state. The assembly catalogue is read once per mounted workspace, with transient read failures retried during later refreshes.

## Monitoring long programmes

The optional `programme-activity` backend supplies `GET /api/programme-activity/detail` with the workspace and programme_id. It uses the original manager's immutable record, progress, control and execution-lock checks. Native run stages and totals continue to come from the regular workspace state.

The response identifies immutable bindings with bindings_id and the current requested subset with request_id. The desk supplies those identities on later reads; the provider returns bindings and requested_runs again only when the corresponding identity changes. This avoids opening every native run and retransmitting all native artifacts for each programme activity check. The original full programme detail remains available in the programme view.

The desk reads fresh activity immediately before queueing work. Older applications use their existing programme detail route when the compact endpoint is absent. The provider registers no execution action and loads the native manager only when its activity route is requested.
