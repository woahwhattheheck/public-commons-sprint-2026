# Source-water paired native programmes

A prepared source-water study can now prepare an entire retained calculation
cohort: every selected original land-cover alternative under every selected
parameter profile, with each profile's own original baseline.

Open **Source-water areas**, open the saved **Prepared scenario areas**, and
choose **Prepare paired programme**. Select the completed original model grid,
the original baseline, NDR, SDR or both, the retained profiles and the explicit
land-cover scenarios created on those exact prepared areas. The original
watershed body must match the grid's retained model-domain source.

## Review and prepare

**Review paired calculations** shows all native selections, their current state,
each matching baseline and the number of already completed runs. **Select all
compatible profiles** selects the retained profiles that support the chosen
models. The complete selected cohort is shown; there is no arbitrary case limit.

The first selected profile is the experiment's overall reference. Every other
profile has its own land-cover baseline for within-profile attribution. The
original experiment planner owns this pairing. Preparing a programme retains
existing compatible native runs and materializes the remaining selections;
the maintained programme service owns native execution and recovery.

**Save paired programme** creates a source-water plan, the ordinary saved
experiment and its native programme. The source-water plan retains the exact
scientific selections, original watershed identity, prepared polygon identity,
native run IDs and the ready source-water comparison selection.

## Execute, return and compare

Open the saved plan and choose **Open programme and continue runs**. The existing
Run programmes screen supplies **Continue unfinished runs**, selected-case
execution, pause after the current calculation, original logs and paired maps.
These controls operate on the actual retained programme.

Return to the source-water plan and choose **Refresh calculation status**.
Once the native programme is complete, **Build source-water comparisons**
collects the experiment's original paired quantities and builds the existing
receiving-area reports. Each parameter profile retains its own baseline.
Comparisons use common valid raster support and the original physical units.

Saved programmes appear both beside their prepared source areas and in the
Source-water saved-products list. Completed task buttons reopen the actual
saved plan or comparison. Reports, original selections and run tables are
available through the normal authenticated file links.

## Original inputs and source continuity

The selection accepts saved land-cover scenarios made on the same exact
prepared source collection. Each patch retains its receiving area, original
polygon source, network ID, preparation ID and declared order. The reference
scenario must be the original baseline. Every selected profile must support
the native models, current grid classes and all destination land-cover codes.

The generated source-water comparison filters the saved receptor specification
to the prepared areas and binds it to the selected grid's original source
collection. Its original source-body hash is checked before preparation.
Upstream study areas retain their whole-HUC meaning.

The product is retained under `receptor-programmes/<id>/`. It includes:

- `result.json`: saved study, experiment, programme and original-source lineage.
- `selection.json`: complete explicit source-water programme selection.
- `planned-runs.csv`: every run and its matching baseline.
- `source-water-comparison.json`: the existing batch reporting selection.
- `index.html`: printable scientific selection report.

The ordinary complete Workspace backup also retains the associated experiment,
native programme, original sources, prepared areas, completed outputs and
comparison products. A standalone plan ZIP contains its plan documents; the
full working Workspace archive carries native inputs and results.

## Command line

From the maintained application, use the same original Workspace:

```sh
python -B -m model.receptor_programme_cli ACTUAL_WORKSPACE preview selection.json
python -B -m model.receptor_programme_cli ACTUAL_WORKSPACE create selection.json
python -B -m model.receptor_programme_cli ACTUAL_WORKSPACE inspect ACTUAL_SOURCE_WATER_PLAN_ID
python -B -m model.compute_programme_cli --workspace ACTUAL_WORKSPACE resume ACTUAL_NATIVE_PROGRAMME_ID
python -B -m model.receptor_programme_cli ACTUAL_WORKSPACE compare ACTUAL_SOURCE_WATER_PLAN_ID
```

The IDs are returned by the actual prepare/create operations. The source-water
plan ID and native programme ID are separate values. An optional
`--expected-preview-id` on `create` binds the request to a reviewed source-water
preview. Repeating the same saved selection reopens its existing plan and
programme.

The JSON selection uses `upstate.receptor-programme-selection/v1` with
`title`, `reason`, `preparation_id`, `grid_id`,
`baseline_scenario_id`, ordered `profile_ids`, ordered `scenario_ids`
and explicit `models` (`["ndr"]`, `["sdr"]` or `["ndr","sdr"]`).

## Original service integration

The implementation composes the existing services:

1. `ComputeProgrammes.preview` validates the actual grid, profiles and scenarios
   and returns their canonical native selections without preparing a run.
2. `Workspace.prepare_run` retains the selected original reference.
3. `experiments.prepare` saves explicit retained profiles and scenarios.
4. `programme_experiments.create` materializes every case and its own baseline
   through the maintained experiment iterator.
5. The normal programme executes and resumes those exact native runs.
6. `programme_experiments.sync_completed` records their original experiment
   metrics; `receptor_experiments.build` produces the receiving-area reports.

Operator integration uses the existing task queue:
`receptor.programme.create` and `receptor.programme.compare`.
Read-only preview is `POST /api/receptors/programme-plan`; saved plan and live
native state are available at `GET /api/receptors/programme?id=...`.
The existing `getProgramme` capability opens the maintained programme controller.

Scientific engine, workspace, experiment, programme and shared host files keep
their existing ownership. This component adds the source-water workflow around
those maintained interfaces.
