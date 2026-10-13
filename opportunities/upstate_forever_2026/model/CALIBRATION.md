# Annual-load calibration and spatial holdout

The calibration workflow selects a working parameter profile from original completed NDR/SDR baseline runs. It retains the source annual-load observations, compares every candidate on the same declared catchments, separates calibration groups from a spatial holdout, and records the actual profile choice, physical errors and alternative candidate range.

The native model and experiment runners continue to own simulation. Calibration consumes their original run IDs and reuses matching `model.observations` comparison records. The operator exposes the same saved plan and result through its calibration workspace.

## Scientific basis

The InVEST 3.20.0 [freshwater calibration guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html) describes comparison with annual catchment loads and parameter experiments. Its [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) describes long-term nutrient transport, the need to account for point sources, and period compatibility. The [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) identifies overland sediment delivery and the absence of in-stream storage, bank erosion and other sediment-budget processes.

This implementation makes the statistical choices below explicit. The grouped objective, spatial partition and leave-group-out analysis are this application's analysis design. Their values remain in the saved plan and report.

### Original reference quantities

Observation intake continues through `Workspace.import_observations`. Each selected record must already be an admitted annual mass rate with its original period, qualifier, annualization method and catchment identity. Nitrogen and phosphorus use kg/year; sediment uses metric_tonnes/year.

The existing [USGS annual-load preparer](../source_tools/USGS_LOADS.md) produces `annual-loads.csv`, `observation-metadata.json` and an original catchment source manifest from the retained [USGS seasonal nutrient release](https://doi.org/10.5066/P13YSTHM). Its original estimator methods and uncertainty remain attached to every annual record. A reference derived with Fluxmaster or WRTDS retains that estimation method in the calibration result. Nitrogen and phosphorus reference data select those corresponding objectives; sediment enters only when an actual sediment annual-load source has been imported.

A native prediction remains the original full-catchment annual export. The existing observation comparison distinguishes source-supported stream omissions from unexpected missing nonstream data. A candidate needs complete support for every declared calibration unit. Missing or partial candidate results are listed with their exact catchment and source issues.

### Period aggregation

Repeated years at the same station do not become additional spatial replicates.

The default `temporal_weighting: "whole_years"` combines disjoint annual-rate periods by the number of complete years each represents. Every full year receives equal weight, including leap years. This produces the arithmetic mean of a sequence of original annual loads; a published annual average over several complete years receives its stated duration in years.

Period starts and ends follow the original Workspace start-inclusive/end-exclusive convention. Whole-year periods end on the same month and day in a later year. An explicitly selected `temporal_weighting: "elapsed_days"` supports source-annualized rates over other documented periods. The chosen weights, original dates, covered days and covered years remain with each catchment/pollutant unit.

Overlapping records for the same catchment and pollutant must be resolved by selecting the appropriate original estimator or period series in `observation_record_ids`. Each original row remains in its source edition. The resulting reference has one mean annual value per original catchment and pollutant.

### Spatial groups and holdout

`preview` reads the actual catchment polygons on the model's projected grid. It joins catchments when their original upstream polygons overlap over a positive area. It also joins records sharing an original station ID. Connected components receive stable group IDs derived from their catchment membership.

This keeps an upstream station and a downstream station with shared contributing land in one partition. It also keeps repeated years and station aliases together. The retained group connections identify the shared polygon area or station ID responsible for every merge.

Optional `catchment_groups` can merge these components into larger scientific regions. It cannot divide a connected component. The saved groups describe the spatial partition; correlation caused by regional climate or other shared processes remains part of interpretation.

The caller selects `validation_group_ids` from the preview. Remaining groups default to calibration, or the caller can provide both explicit lists. Every group belongs to one partition, with at least one calibration group. An empty validation list produces a clearly identified `calibration_only` result. The preview permits the partition to be chosen before the application computes candidate scores.

### Objective and physical metrics

For pollutant p, the program computes a normalization scale from the calibration data: the mean of the spatial-group means of the observed annual load. Each group mean gives its original catchments equal weight. Validation values never determine this scale.

For every candidate, it then computes:

1. Squared physical error for each original catchment/pollutant mean annual load.
2. Mean squared error within each calibration spatial group.
3. Mean of those group errors, so each spatial group receives equal objective weight.
4. Division by the pollutant's squared calibration normalization scale.
5. The weighted mean across the selected pollutants.

A lower objective is better. This dimensionless score can combine nitrogen, phosphorus and sediment while their physical measurements remain separate. Larger absolute catchment errors have greater influence within each pollutant. The weights are explicit and default to equal values for the admitted source pollutants.

An optional positive `normalization_scale` replaces the derived scale for a pollutant. Its `scale_reference` must record the source or rationale. This is also the supported way to evaluate a source whose calibration reference values are all zero.

The report retains physical RMSE, mean bias, percent bias, NSE where defined, and group-weighted RMSE and mean bias. The ungrouped physical metrics summarize catchment rows descriptively; the parameter ranking uses the grouped objective. Catchment counts, spatial-group counts and original period-record counts are separate fields.

A declared `reference_run_id` wins an exact objective tie. Other exact ties use stable profile and run IDs.

### External delivered loads

An independently supported external load can be added to a native prediction with `delivered_external_loads`. It is keyed by the original observation record ID, with `annual_mass`, matching `units` and `source_reference`.

This is useful when an actual point-source load delivered to the observation location is part of the comparison. The native model mass and the external contribution remain separate. The supplied annual load undergoes the same temporal weighting as its observation record. Reservoir attenuation or other unrepresented transport processes require a source-supported scientific treatment; the application does not fit an unspecified correction to improve the score.

## Use the original source and native run identities

Run from the product root in the original equipped Python/GIS environment described in [README.md](README.md).

Inspect the actual available baseline candidates and observation editions:

~~~sh
python -B -m model.calibration \
  --workspace "$UPSTATE_MODEL_WORKSPACE" catalog
~~~

The catalogue groups completed baseline runs by original grid and scenario. A candidate set uses one group with distinct parameter profiles. Future land-cover runs stay with their scenario comparisons.

The following integration example binds the original native-model receiving document and the actual prepared USGS source. The environment variables identify the existing files; all collection, observation, catchment and run IDs are obtained from those sources.

~~~python
import os
from pathlib import Path
from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import calibration

handoff = read_json(os.environ["UPSTATE_MODEL_HANDOFF"])
prepared = Path(os.environ["UPSTATE_USGS_PREPARED"])
workspace = Workspace(handoff["workspace_path"])

collection = workspace.import_sources(prepared / "source-manifest.json")
observed = workspace.import_observations(
    prepared / "annual-loads.csv",
    read_json(prepared / "observation-metadata.json"),
)
catchment_entries = [
    entry for entry in collection["entries"]
    if entry.get("role") == "OBSERVATION_CATCHMENTS"
]
if len(catchment_entries) != 1:
    raise ValueError("Select the original prepared observation catchment entry")
catchment_entry = catchment_entries[0]

baseline_id = handoff["delivery_selection"]["baseline_run_id"]
baseline = workspace.inspect_run(baseline_id)
candidate_ids = [
    outcome["id"]
    for outcome in handoff["model_outcomes"].values()
    if outcome["selection"]["grid_id"] == baseline["selection"]["grid_id"]
    and outcome["selection"]["scenario_id"] == baseline["selection"]["scenario_id"]
]
selection = {
    "schema": calibration.SELECTION_SCHEMA,
    "title": "Upper Savannah annual nutrient reference evaluation",
    "candidate_run_ids": candidate_ids,
    "reference_run_id": baseline_id,
    "observation_id": observed["id"],
    "catchments": {
        "source_collection_id": collection["id"],
        "source_id": catchment_entry["id"],
        "id_field": catchment_entry["id_field"],
    },
    "objective": {
        "nitrogen": {"weight": 1},
        "phosphorus": {"weight": 1},
    },
    "temporal_weighting": "whole_years",
    "notes": [
        "USGS reference estimator methods and source periods are retained.",
        "Interpret the reference period alongside the actual model source vintages.",
    ],
}
preview = calibration.preview(workspace, selection)
atomic_json(Path(os.environ["UPSTATE_CALIBRATION_PREVIEW"]), preview)
~~~

This source binding works with a single original baseline for reference evaluation. A parameter-selection study supplies the additional completed baseline profiles from the existing experiment runner, using their actual `run_id` values in the same `candidate_run_ids` list.

Use the preview's original group IDs to save the intended holdout partition in the selection. The default assigns every group to calibration. Then run:

~~~sh
python -B -m model.calibration \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --output "$UPSTATE_CALIBRATION_PREPARED" \
  prepare "$UPSTATE_CALIBRATION_SELECTION"

python -B -m model.calibration \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --output "$UPSTATE_CALIBRATION_REPORT" \
  analyze "$UPSTATE_CALIBRATION_PLAN_ID"
~~~

The prepared document's `id` is the plan ID for the second command. `--output` creates an immutable copy of the returned original JSON. Select a new path for a changed document.

## Read the completed analysis

| Report field | Meaning |
| --- | --- |
| `selected_run_id`, `selected_profile_id` | Working native candidate selected by calibration groups |
| `ranked_candidates` | Eligible original candidates, objective values and per-pollutant physical metrics |
| `candidate_failures` | Original source/comparison failures or incomplete declared calibration support |
| `selected_validation` | Held-out evaluation of the selected working candidate; its values do not alter ranking |
| `pareto_run_ids` | Candidates for which no other eligible profile is no worse on every pollutant and better on at least one |
| `candidate_envelope` | Minimum, median and maximum annual prediction among those Pareto candidates for each reference unit |
| `group_stability` | Leave-one-calibration-group-out selection, with normalization recomputed for each training fold |
| `prediction_rows` | Native mass, explicit external contribution, prediction, residual and support for each original candidate/unit |
| `reference_units` | Original catchment means, source periods, source methods and uncertainty |
| `normalization` | Per-pollutant score scale and the actual calibration groups used |
| `source_vintages`, `observations` | Original model input editions and annual-reference source identity |

The candidate envelope describes the selected original profiles. Its range does not estimate a statistical confidence interval.

Leave-group-out analysis reuses the same completed candidate totals. Each fold removes one calibration group, derives scales from the remaining calibration groups, selects a working profile, and evaluates it on the removed group. Separately declared validation groups stay outside all these folds. The frequency with which profiles are selected shows sensitivity to the spatial calibration sample.

The selected working profile remains the actual saved profile identified in the report. Applying it to future land-cover alternatives uses the existing experiment/native runner. Those scenario runs retain their new original run IDs and quantitative scenario differences. Calibration does not rewrite existing runs or silently substitute the selected profile into an accepted delivery.

## Source continuity and execution

Plans are immutable Workspace items under `calibration-plans`. Results are immutable items under `calibrations`. Original comparison IDs and per-candidate progress live under `calibration-analysis/<plan-id>/progress.json`.

A matching original observation comparison is reused when its run, observation edition, catchment selection, source hash and current comparison version match. Otherwise the existing observation comparison aggregates the original native outputs. An interruption resumes the same plan and its completed comparisons. A complete accepted analysis is returned directly on reopening.

A result with no eligible candidate retains the actual failures and exits the CLI with status 2. Reinvoking the same plan can recover a source-access failure. A scientific change to observations, grouping, period interpretation, candidate membership, objective or source selection creates a different immutable plan.

The operator's calibration workspace provides the same catalogue, preview, saved plan, analysis and original downloads. Its export carries the full plan and report, CSV tables and reading guide. Source code and the original Workspace archive remain the complete receiving path.

## Integration API

~~~python
catalog(workspace)
preview(workspace, selection)
prepare(workspace, selection)
inspect(workspace, plan_id)
analyze(workspace, plan_id)
~~~

All five functions take the maintained `model.workspace.Workspace`. `prepare` returns a `upstate.calibration-plans/v1` item. `analyze` returns `upstate.calibrations/v1`, including `plan_id`, the selected original native IDs, and the full quantitative report.

The selection's required fields are `schema`, `title`, `candidate_run_ids`, `observation_id` and `catchments`. Its optional fields are `reference_run_id`, `observation_record_ids`, `catchment_groups`, `calibration_group_ids`, `validation_group_ids`, `objective`, `delivered_external_loads`, `temporal_weighting`, `leave_group_out` and `notes`.

The module's scope is original annual-load parameter evaluation and selection. The spatial review, general experiment diagnostics, native simulation, seven-map delivery and customer review keep their existing source interfaces.
