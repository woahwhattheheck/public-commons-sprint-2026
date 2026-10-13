# Annual-load calibration and spatial holdout

The calibration workflow selects a working parameter profile from original completed baseline runs of the selected native models: NDR, SDR or both. It retains the source annual-load observations, compares every candidate on the same declared catchments, separates calibration groups from a spatial holdout, and records the actual profile choice, native model scope, physical errors and alternative candidate range.

The native model and experiment runners continue to own simulation. Calibration consumes their original run IDs and reuses matching `model.observations` comparison records. The operator exposes the same saved plan and result through its calibration workspace.

## Scientific basis

The InVEST 3.20.0 [freshwater calibration guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html) describes comparison with annual catchment loads and parameter experiments. Its [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) describes long-term nutrient transport, the need to account for point sources, and period compatibility. The [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) identifies overland sediment delivery and the absence of in-stream storage, bank erosion and other sediment-budget processes.

This implementation makes the statistical choices below explicit. The grouped objective, spatial partition and leave-group-out analysis are this application's analysis design. Their values remain in the saved plan and report.

### Original reference quantities

Observation intake continues through `Workspace.import_observations`. Each selected record must already be an admitted annual mass rate with its original period, qualifier, annualization method and catchment identity. Nitrogen and phosphorus use kg/year; sediment uses metric_tonnes/year.

The existing [USGS annual-load preparation workflow](../source_tools/USGS_CONTRACT.md) produces `annual-loads.csv`, `observation-metadata.json` and an original catchment source manifest from the retained [USGS seasonal nutrient release](https://doi.org/10.5066/P13YSTHM). Its original estimator methods and uncertainty remain attached to every annual record. A reference derived with Fluxmaster or WRTDS retains that estimation method in the calibration result. Nitrogen and phosphorus reference data select those corresponding objectives; sediment enters only when an actual sediment annual-load source has been imported.

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

A lower objective is better. This dimensionless score can combine nitrogen, phosphorus and sediment while their physical measurements remain separate. Larger absolute catchment errors have greater influence within each pollutant. The weights are explicit. When the selection omits `objective`, equal positive weights apply to admitted source pollutants for which every chosen native run has an actual completed output. A supplied zero weight excludes that pollutant. A supplied positive weight requires its original output in every candidate before a plan can be saved.

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

The catalogue groups completed baseline runs by original grid and scenario. Each run exposes its actual selected native models, available pollutants and original completion scope. A candidate set uses distinct original run IDs within one group. An NDR-only and a combined run may share the same parameter profile; their run identities and the count of distinct profiles remain separate. Future land-cover runs stay with their scenario comparisons.

The following integration example binds the actual native workspace and prepared USGS source. `UPSTATE_BASELINE_RUN_ID` identifies the original completed nutrient baseline from the native receiver or the catalogue above. The example reads every additional candidate ID from the same original grid/scenario group and includes runs that have completed both nutrient outputs. It works as soon as the original NDR baseline is complete.

~~~python
import os
from pathlib import Path
from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import calibration

prepared = Path(os.environ["UPSTATE_USGS_PREPARED"])
workspace = Workspace(os.environ["UPSTATE_MODEL_WORKSPACE"])

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

baseline_id = os.environ["UPSTATE_BASELINE_RUN_ID"]
catalogue = calibration.catalog(workspace)
group = next(
    group for group in catalogue["candidate_groups"]
    if any(run["id"] == baseline_id for run in group["runs"])
)
candidate_ids = [
    run["id"] for run in group["runs"]
    if {"nitrogen", "phosphorus"} <= set(run["available_parameters"])
]
if baseline_id not in candidate_ids:
    raise ValueError("Select the original completed nutrient baseline from the catalogue")
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
| `selected_models`, `selected_model_scope` | Actual selected native models and their original completed stage/output scope |
| `candidate_count`, `distinct_profile_count` | Original candidate runs and unique saved parameter profiles |
| `predicted_parameters`, `common_parameters` | Positive-weight pollutants and the pollutants available in every candidate |
| `ranked_candidates` | Eligible original candidates, objective values and per-pollutant physical metrics |
| `candidate_failures` | Original source/comparison failures or incomplete declared calibration support |
| `selected_validation` | Held-out evaluation of the selected working candidate; its values do not alter ranking |
| `pareto_run_ids` | Candidate runs for which no other eligible run is no worse on every selected pollutant and better on at least one |
| `candidate_envelope` | Minimum, median and maximum annual prediction among those Pareto candidate runs for each reference unit, with separate run/profile counts |
| `group_stability` | Leave-one-calibration-group-out selection, with normalization recomputed for each training fold |
| `prediction_rows` | Native mass, explicit external contribution, prediction, residual and support for each original candidate/unit |
| `reference_units` | Original catchment means, source periods, source methods and uncertainty |
| `normalization` | Per-pollutant score scale and the actual calibration groups used |
| `source_vintages`, `observations` | Original model input editions and annual-reference source identity |

The candidate envelope summarizes the actual completed Pareto candidate runs. `candidate_count` and `expected_candidates` count runs; `distinct_profile_count` and `expected_profiles` identify how many saved parameter profiles they represent. The median gives each included candidate run one entry, including different native execution scopes of one profile. `summary_unit` names that unit explicitly. Interpret this descriptive range alongside the actual profile membership.

Leave-group-out analysis reuses the same completed candidate totals. Each fold removes one calibration group, derives scales from the remaining calibration groups, selects a working profile, and evaluates it on the removed group. Separately declared validation groups stay outside all these folds. `winner_frequencies` counts selected original run IDs, while `profile_winner_frequencies` combines those selections by the original profile ID. These frequencies show sensitivity to the spatial calibration sample and retain the distinction between parameter profiles and their native execution scopes.

The selected working profile remains the actual saved profile identified in the report. Applying it to future land-cover alternatives uses the existing experiment/native runner. Those scenario runs retain their new original run IDs and quantitative scenario differences. Calibration does not rewrite existing runs or silently substitute the selected profile into an accepted delivery.

## Source continuity and execution

Plans are immutable Workspace items under `calibration-plans`. Results are immutable items under `calibrations`. Original comparison IDs and per-candidate progress live under `calibration-analysis/<plan-id>/progress.json`.

A matching original observation comparison is reused when its run, observation edition, catchment selection, source hash, current version-7 measurement/stream/declared-coverage semantics, selected model scope and exact original export/stream/argument/module descriptors match. A completed current checkpoint also binds its candidate execution fingerprint, including an all-excluded comparison that contains no native raster row. Older comparison records remain retained; an unfinished analysis replaces its obsolete checkpoint link through the maintained current comparison engine. An interruption then resumes the same plan and its compatible completed comparisons. A complete saved analysis is returned directly on reopening.

Earlier version-1 calibration plans remain immutable and keep their IDs. When analysis resumes an earlier plan, it checks the retained original native selection and enriches an in-memory copy of each candidate with the current model/output scope. The saved selection, original reference units, normalization and holdout partition stay attached to that same plan.

A result with no eligible candidate retains the actual failures and exits the CLI with status 2. Reinvoking the same plan can recover a source-access failure. A scientific change to observations, grouping, period interpretation, candidate membership, objective or source selection creates a different immutable plan.

The operator's calibration workspace provides the same catalogue, preview, saved plan, analysis and original downloads. Its export carries the full plan and report, CSV tables and reading guide. Source code and the original Workspace archive remain the complete receiving path.

## Selected native model compatibility

This module uses the maintained selected-model core's `model.model_selection.validate_completed_run` and `model.common.output_models`. Its companion [selected-model operations guide](SELECTED_MODEL_OPERATIONS.md) describes the original native run selection and stage reuse. Partial model selections stay explicit; the historical combined-model run identity continues to omit the optional `models` field.

The unchanged `Workspace.compare_observations(run_id, observation_id, catchments)` API reads only the models selected for that run. Its current version-7 comparison retains the entire original observation edition, including rows whose pollutant model is omitted, and gives those rows their original exclusions. An NDR-only analysis therefore uses the admitted nitrogen/phosphorus rows of a mixed edition through the same native comparison. Calibration narrows the declared objective and retains source exclusions in its own plan.

Original annual-rate rows with explicit `coverage_days` and `expected_days` must declare equal, nonzero counts to enter a native catchment comparison. A `coverage_complete: true` flag cannot override unequal counts; a false flag remains an exclusion even when counts match. Zero declared counts remain source context with readable issues. New imports reject malformed counts; previously retained malformed counts produce comparison exclusions without rewriting the source. The check uses the declared source-period denominator, without guessing a year length or changing inclusive/exclusive dates. Original CSV bytes, numeric strings, flags and source identities are preserved. An explicit legacy annual rate without coverage counts retains its existing admission contract; missing counts do not establish measured completeness.

### Current source admission and retained import counts

The Calibration selector now reads a current source-admission projection of each original observation edition. Its eligible count, parameter list and catchment list use the same original support/constituent/annual-rate/declared-coverage rules as preparation. The original imported admitted/context counts remain alongside them; source CSVs and saved observation records are never rewritten.

Open **Current source admission and original import** to see each edition's original admitted count, current eligible rows and exclusion reasons. **Original source** opens that exact retained edition, including quantities outside the calibration objective. Reason counts may overlap because one row can have several issues. A saved selection whose source no longer has eligible rows remains visibly bound to that original edition; revision requires a deliberate source choice. A workspace with no eligible edition can still open the form and inspect its retained sources instead of losing the candidate choices.

New observation-comparison report data captures this admission projection with original eligible record IDs and the record IDs for each exclusion reason. PDF, HTML and Markdown distinguish original import admission, source-rule eligibility and the rows that actually enter fit metrics after native model/catchment/raster checks. Previously completed comparisons and reports keep their original capture; this display does not change source values, recompute historical metrics or dispatch a model run.

At the existing receiving boundary, operate the exact current Calibration selector with a retained older edition, inspect its original source, revise to an eligible edition, and save/reopen the selection. Open and LOOK at the populated form and exported comparison report at desktop and narrow widths; check original-source controls and download/reopen before describing the outgoing product as ready.


| Native candidate selection | Available calibration parameters |
| --- | --- |
| NDR | Nitrogen and phosphorus |
| SDR | Sediment |
| NDR and SDR | Nitrogen, phosphorus and sediment |

For a chosen set containing NDR-only and combined runs, the common output parameters are nitrogen and phosphorus. For a set containing SDR-only and combined runs, the common parameter is sediment. Choosing an NDR-only run together with an SDR-only run produces no common pollutant objective; the caller selects a group subset with the required shared native output.

The catalogue's group-level intersection describes all runs currently in that group. An operator selecting a smaller subset recomputes the intersection from the chosen runs' `available_parameters`. The intersection then meets the admitted original source parameters when determining default positive weights. An explicitly supplied objective remains the declared scientific choice.

The following fields are additive to the existing version-1 interfaces:

| Interface | Added fields |
| --- | --- |
| Catalogue candidate run | `selected_models`, `available_parameters`, `model_scope`, `profile_variant_count` |
| Catalogue group | `common_parameters`, `available_parameters`, `candidate_count`, `distinct_profile_count` |
| Preview or saved plan | `common_parameters`, `predicted_parameters`, `candidate_count`, `distinct_profile_count`; scope on every candidate |
| Ranked candidate | The original candidate's selected models, available parameters and completion scope |
| Report | Selected model scope, common/objective parameters and separate run/profile counts |
| Envelope row | `distinct_profile_count`, `expected_profiles`, `summary_unit` |
| Completed leave-group-out analysis | `profile_winner_frequencies` in addition to original run frequencies |

When all candidate runs use one saved profile, `candidate_comparison` reports `execution_scope_reference_evaluation` for multiple native run variants or `single_candidate_reference_evaluation` for one run. A set of different saved profiles reports `parameter_selection`. Existing completed reports retain their original content and identities.

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


## Producing native executions and physical load units

Every new candidate snapshot records the maintained `model.native_versions` result for each selected model. A completed stage's runtime version takes precedence over the observed run-level version; the original requested version is the labeled legacy fallback. Requested and producing declarations remain separate. The catalogue exposes the original version labels, output mass convention and exact file descriptors even when a completed candidate has an execution issue.

Before reading catchment rasters, the positive-weight objective resolves one compatible per-model version cohort. All compared NDR executions must have the same resolved NDR version, and all compared SDR executions must have the same resolved SDR version. NDR and SDR may retain different versions from one another when the same model's version is consistent across candidates. An objective using only N/P does not require equality of the candidates' unused SDR versions. All native models selected in a run still require a supported physical output convention because the shared observation engine opens those selected stages.

The maintained observation reducer multiplies each original export cell value by its affine cell area in hectares. NatCap's original [NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) guides both identify the conversion of their output rasters to values per hectare in InVEST 3.15.0. This integration reviews that physical convention for the 3.15–3.20 families. Earlier per-pixel exports cannot enter this per-hectare reduction, even if their run requested a newer version. A requested legacy fallback remains visibly unobserved execution provenance.

| Native export | Retained raster convention | Aggregated native quantity |
| --- | --- | --- |
| NDR n_total_export | kg/ha/year | kg/year |
| NDR p_surface_export | kg/ha/year | kg/year |
| SDR sed_export | metric_tonnes/ha/year | metric_tonnes/year |

The execution extension does not change any original raster, annual-load observation, scoring formula or pixel support. It selects the same-stage stream raster from the exact retained native arguments, including SDR stream_and_drainage when its drainage input was used. Files are verified against their original byte hashes before analysis; the plan/report preserves their descriptors and the per-model runtime/reuse origin.

### Additive retained fields

Candidate and catalogue entries include:

- `native_versions` and `native_version_labels`: exact maintained per-model declarations and readable provenance.
- `output_mass_basis`: parameter, native output, raster units, annual units, reduction and original guide.
- `native_outputs`: original export, same-stage stream, arguments and native module descriptors.
- `execution_fingerprint`: identity of those retained producing stages, original selection and physical contract.
- Catalogue `execution_issues` and `calibration_eligible`: concrete incompatible or incomplete original-output reasons, with completed source candidates still visible.

New plans and results include `native_execution`, schema `upstate.calibration-native-execution/v1`. Its `models`, `versions`, `runs` and policy come from the maintained cohort resolver. `rows` contains one original run/parameter row with producing-stage, requested and observed version fields, reuse origin, physical units and original output hashes. The complete snapshot is retained with its fingerprint and comparison schema version.

Earlier immutable plans and completed reports keep their original identities. An unfinished earlier plan is enriched in memory from its exact original runs; its new progress checkpoint is bound to that execution fingerprint. Changed producing stages or original file identities require a new explicit plan. A saved completed report remains its original scientific edition. New consumer presentation editions add the richer execution tables without rewriting earlier dossiers.

### Current observation support and restart behavior

Preview uses the same `observation_support.comparison_issues` as the current comparison engine. Source quantities that represent a facility discharge, a concentration, an incompatible species or incomplete annual support retain their original context and readable exclusion before spatial preparation. The admitted annual observation source itself is unchanged.

An interrupted calibration created by the older implementation may retain a version-3 comparison or an unstamped version-6 comparison. The current continuation checks original source and output bindings; compatible current comparisons are adopted, and older/incompatible links are recalculated through the current engine. Saved original comparison items are preserved. No native model is dispatched by this recovery.
