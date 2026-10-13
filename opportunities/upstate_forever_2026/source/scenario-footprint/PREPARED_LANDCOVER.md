# Reuse a prepared native scenario footprint

A completed scenario preview already contains the exact land-cover raster needed by the original NDR/SDR run. Native execution now adopts that retained raster and its original ordered-patch accounting, using an independently owned reflink or a verified streaming copy. This avoids compiling the same regional land-cover grid twice.

Parameter-course runs can also adopt a completed footprint from another saved profile when every categorical input agrees. Native model parameters remain those of the target profile; routing or coefficient changes are still evaluated by the existing native stage matcher and engine.

The current geographic preparation course already calls `model.scenario_footprint.preview_run` for its saved runs. Continue those same runs through the ordinary queue or CLI. The run, profile, scenario, source editions and native model arguments retain their existing identities.

## Ordinary preparation and execution

From the current complete application, using its existing qualified GIS interpreter:

```sh
python -B -m model.scenario_footprint --workspace WORKSPACE --run-id RUN_ID
python -B -m model.cli --workspace WORKSPACE run RUN_ID
python -B -m model.cli --workspace WORKSPACE run-inspect RUN_ID
```

Use the saved alternative run ID selected by the existing project. If its geographic course already completed the preview, the first command simply reopens that same footprint. Keep one native writer for the original Workspace and preserve active model children.

The native land-cover stage records `prepared_footprint` when it adopted an exact completed preview. That record retains:

- the original footprint request ID, donor run ID, target run ID, reuse kind, compiler version and compiler source SHA;
- a run-relative `prepared-landcover-reuse.json` descriptor containing both complete saved profiles, requests and scenarios plus the common categorical-input binding;
- the independently retained report and land-cover descriptors, with paths relative to the current native run;
- the transfer method, file count and bytes;
- the original patch rows in `stages.landcover.edits`;
- the independently retained `stages.landcover.artifact` used by the native models.

The input artifact has the exact retained preview bytes. The native stage continues through the same original InVEST validation, stage-reuse logic, execution and output conversion. A completed existing run remains complete; this change does not start another model calculation.

## What must match

Preview and native execution resolve one shared request from the current retained Workspace. Its identity binds the run selection, grid/baseline descriptor, saved profile and scenario IDs, actual coefficient-source body, all mask bodies and companions, and current footprint compiler source.

The candidate must have its completed manifest at that exact request ID. Every declared output is verified, and the original report must agree with the request, run, selection, compiler version and declared destination classes. The verified raster is adopted through the maintained `model.reuse.copy_verified` path. No old host's absolute path is used.

A missing, incomplete or superseded preview uses the existing scenario compiler. A present exact preview with changed bytes or inconsistent identity raises the original-source error; it is not silently accepted. The exact same-run preview is preferred. When it is absent, the receiver inspects only completed footprint metadata, in deterministic request-ID order, for a parameter-variant donor. The donor's saved run/profile/scenario must verify; a donor whose records were not included in a selected Study is skipped. Existing records with changed identities still raise their source error. Its complete request must equal the target request except for the run and profile IDs; grid, scenario, selected models/version, baseline, coefficient body and every mask body/companion remain equal. The ordered patches, coefficient collection/source selection and allowed class set are checked separately. Changed categorical inputs use the existing compiler. Restored Workspaces resolve the same relative source files locally. Both the small original footprint report and its raster become independently owned run files. Their nested descriptors use the existing native run's relative paths, so ordinary Study export/reimport retains them through its current source visitor. The prior Workspace directory is a plain provenance string, not a descriptor that could be resolved beneath another run.

## Parameter variants and native stage reuse

The original headwaters parameter course places the working profile first, then explores retained MFD/D8 and SDR maximum-L choices on the same scenarios. Each variant has its own run/profile identity. A categorical footprint depends on its grid, baseline, ordered changes, masks, allowed classes and compiler; those native routing/erosion parameter values are evaluated later.

For this course, a completed working-profile footprint can therefore supply the byte-identical land-cover input of an eligible variant. The saved `prepared_footprint.reuse_kind` is `parameter-variant`; `run_id` identifies the original donor and `target_run_id` identifies the receiving native run. The independently retained original report keeps its donor selection unchanged. The accompanying reuse JSON records both complete profiles/scenarios/requests and the shared categorical-input identity, making the distinction portable and inspectable.

Native execution still builds arguments from the target profile and actual receiving raster. Its existing `NativeInputMatcher`, runtime checks, stage signatures and recovery logic independently determine whether any completed **model outputs** qualify for reuse. A shared land-cover input alone does not establish equal native parameters or model outputs.

The normal Study source visitor follows the target's grid/profile/scenario and retains all original physical input sources. Equivalent donors must use that same grid/scenario and coefficient collection/source. The three new run files—land cover, original footprint report and complete reuse identity—are carried by the normal run tree, with no dependency on the donor's old absolute directory.

## Bounded categorical accounting

The shared scenario kernel retains the same ordered pixel-centre selection, mask validation, original NoData, reversions, overlaps, final ownership and class-transition outputs.

Within each existing raster tile, a before/after transition is encoded losslessly as the two signed-int32 bit patterns in one uint64. Counting this single numeric key avoids NumPy's two-column record sort. Each declared patch has one destination, so its local transition counts use the original selected-class histogram without allocating a tile of repeated target values. Negative and maximum signed-int32 class values retain their exact identities.

There is no whole-region categorical array or dense class-by-class matrix. The existing output profile still determines the bounded tile size. These changes affect preparation work, not the hydrological or erosion calculation.

## Receiving the existing geographic case

On the accepting native host, use the current complete application or compose both maintained modules into the owner's receiving copy at an ordinary source boundary. Preserve the current footprint preview fix and current native execution/recovery implementation. Do not overlay an older full application or restart an active native job.

For the actual regional baseline/restoration/matched-control course, retain the original run IDs and complete the original native queue. Inspect each alternative's saved land-cover stage for `prepared_footprint`; its raster SHA and bytes must equal the retained preview descriptor, and its patch accounting must remain the original footprint rows. Continue the same process report, editable project export and cold reopen.

The existing focused kernel references remain available when a receiving source boundary requires them:

```sh
python source/scenario-footprint/reference_ordered_patches.py --application APPLICATION --output NEW_REFERENCE_DIRECTORY
python source/scenario-footprint/reference_binary_masks.py --application APPLICATION --output ANOTHER_NEW_REFERENCE_DIRECTORY
```

They exercise the original overlap/reversion and mixed-mask behavior without running NDR/SDR. They are not a prerequisite for an already-running model operation.

Current owner direction is `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`: actual Upper Savannah geometry at 30 m, distinct upstream/SC/utility masks, explicitly simulated baseline/restoration/matched-control inputs, native annual N/P kg/year and sediment tonnes/year reaching streams, editable inputs through report/export/cold reopen, and actual elapsed execution history. Preserve the existing source writer, matching algorithm and scientific interpretation owners.
