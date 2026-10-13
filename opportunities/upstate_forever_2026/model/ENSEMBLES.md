# Paired parameter ensembles

The ensemble capability operates the existing Upper Savannah Workspace and original InVEST 3.20.0 engines. It gives each retained parameter member its own observed-land-cover baseline and every selected land-cover alternative. A land-cover difference therefore uses identical parameters and the same retained grid on both sides. Separate baseline comparisons show the effect of changing the parameters.

## Prepare the actual selections

Use the maintained complete application. Its model/model_selection.py supplies the shared native selection, output and run-scope helpers. Follow [SELECTED_MODEL_OPERATIONS.md](SELECTED_MODEL_OPERATIONS.md) when preparing or extending the selected-model workspace. The public application carries this dependency with the ensemble source.


Select an existing complete grid, its saved observed-land-cover baseline, one or more explicit land-cover alternatives, and the retained scientific profiles to explore. Profiles may point to different actual biophysical tables. The unchanged table source collection, source ID, SHA256 and loading semantics travel with every member.

A design JSON contains:

| Field | Meaning |
| --- | --- |
| title | Study name shown in the operator and report |
| reason | Scientific question and source-supported reason for exploring these cases |
| grid_id | Actual complete retained grid ID |
| models | Optional ndr/sdr list; omission inherits the retained grid, and both models canonicalize to omission |
| baseline_scenario_id | Actual saved baseline scenario ID |
| alternative_scenario_ids | Ordered list of saved land-cover alternatives |
| base_profile_ids | Ordered list of retained profiles, including the central reference profile first |
| design | factorial or one_at_a_time |
| axes | Optional explicit parameter axes; an empty list compares the supplied profiles |

An axis contains id, targets, values, reason and references. Targets use native names such as ndr.k_param or sdr.k_param. The values are the actual values selected from the cited source or scientific working decision. References identify an original URL, retained source or citation. A single axis can have several targets when the same selected value is deliberately applied to both engines, for example paired NDR and SDR stream thresholds. Each target belongs to only one axis.

The full native parameter catalogue is available from:

~~~sh
python -B -m model.ensemble_cli catalog
~~~

The catalogue supplies parameter meanings and units. Base profiles provide the original values. In a factorial design every declared combination is considered. A one_at_a_time design changes each declared axis separately. The original profiles are also retained as members, and duplicate scientific parameter selections are reused. There is no fixed scenario or member limit in the engine. Selected original profiles are considered before derived variations, so an equivalent saved profile keeps its existing native run identity.

Model selection is explicit in every partial plan and native run request. An NDR-selected study uses nitrogen_export and phosphorus_export; an SDR-selected study uses sediment_export. A combined study uses all three. The selected grid must contain the physical inputs for those models and every selected base profile must contain their parameter groups and table fields. Preview resolves these actual source requirements before creating any run. A parameter axis belongs to a selected native model.

Comparisons use the original native common_comparison_outputs helper. A wider original run and an NDR run can supply the NDR outputs for an NDR-selected study on the same retained grid. Missing outputs requested by the study produce a concrete pair error. The retained native run model scopes travel with the pair summary.


The optional NDR runoff_proxy_av is the denominator used to normalize runoff potential. If it is omitted, the native model computes the raster average. Scaling every precipitation pixel equally while recomputing its average leaves that normalized index unchanged; rainfall scenarios should therefore represent the intended spatial or normalization change explicitly.

## Ready study: routing and maximum L

The catalogue includes studies[] with three stable choices. Each choice supplies its native models, complete axes and source references to the operator form and the native receiving script.

| Study ID | Native models | Declared varied cases per base profile |
| --- | --- | --- |
| routing-ndr-v1 | NDR | mfd and d8 |
| routing-lmax-sdr-v1 | SDR | mfd/d8 crossed with maximum L 122/333 |
| routing-lmax-v1 | NDR and SDR | Linked mfd/d8 crossed with SDR maximum L 122/333 |

The combined routing-lmax-v1 study combines both supported flow-routing choices (mfd and d8, linked across NDR and SDR) with the SDR maximum-L endpoints 122 and 333. The SDR guide identifies 122 as the default and documents 122–333 as its literature range. These L values are dimensionless.

The study retains the exact source sections and access date with each axis. InVEST 3.20.0's shared spec.py source, Git blob 4bd69cc024a671e6b8701b2ddc1aba829c08a9cc, declares both algorithms and lowercases option values in validation and preprocessing. The saved profiles therefore use the native mfd/d8 strings.

The combined study has four declared factorial combinations for each base profile. The engine also includes any original reference values outside those combinations and reuses duplicate scientific selections. Its preview returns the actual member and run counts after applying the selected saved inputs.

For the equipped native host, obtain actual_selection from the existing complete grid, observed baseline, retained profile IDs and selected land-cover alternatives. The following uses that selection and the existing Workspace object:

~~~python
from copy import deepcopy
from model.common import atomic_json
from model.ensembles import Ensembles, parameter_catalog
from model.ensemble_report import build

study = next(item for item in parameter_catalog()["studies"]
             if item["id"] == "routing-lmax-v1")
spec = {
    **actual_selection,
    "title": study["title"],
    "reason": study["question"],
    "design": study["design"],
    "models": list(study["models"]),
    "axes": deepcopy(study["axes"]),
}
manager = Ensembles(workspace)
preview = manager.preview(spec)
plan = manager.prepare(spec)
atomic_json(
    workspace.root / "ensemble_results" / plan["id"] / "study-preview.json",
    {"study_id": study["id"], "invest_version": study["invest_version"],
     "preview": preview},
    immutable=True,
)
result = manager.run(plan["id"])
release = build(workspace, plan["id"])
~~~

actual_selection contains grid_id, baseline_scenario_id, base_profile_ids and alternative_scenario_ids from the actual saved records. Choose routing-ndr-v1 for an NDR-first grid, routing-lmax-sdr-v1 for an SDR-selected grid, or routing-lmax-v1 when the grid and profiles contain both native models. Each selected land-cover alternative receives every parameter case. The retained study-preview.json supplies the concrete planned workload alongside the resulting native runs and physical report.

## Operate from the command line

The complete headless path is documented in [ENSEMBLE_OPERATIONS.md](ENSEMBLE_OPERATIONS.md). context lists actual saved selections; study-design binds a sourced catalogue study to those selections; run-study prepares, executes and exports the study. continue reopens the same saved ensemble and completes its reports. export builds the printable HTML, CSV/JSON and ZIP release from completed native results. Add --with-raster-products to include the original paired raster products and their portable archives for each saved land-cover alternative.

Run from the original opportunities/upstate_forever_2026 application directory with its equipped Python interpreter. Use the same existing workspace throughout.

~~~sh
python -B -m model.ensemble_cli --workspace /absolute/study preview /absolute/ensemble-design.json
python -B -m model.ensemble_cli --workspace /absolute/study prepare /absolute/ensemble-design.json
python -B -m model.ensemble_cli --workspace /absolute/study list
python -B -m model.ensemble_cli --workspace /absolute/study run ACTUAL_ENSEMBLE_ID
python -B -m model.ensemble_cli --workspace /absolute/study report ACTUAL_ENSEMBLE_ID
~~~

Preview reads the selected records and reports member, run, land-cover-pair and parameter-pair counts, selected_models and expected_artifacts. Prepare saves immutable derived profiles and native run selections and returns the actual ensemble ID. Run executes every selected member through Workspace.run, preserving the original NDR/SDR progress, logs and completed stages. Repeating run on that same ID continues the retained operation. Independent members continue after a member failure; the returned progress and errors identify their actual outcomes. A partial run exits with code 2.

Use report with --refresh as an explicit background operation after runs complete outside the ensemble worker, or when a prior paired summary needs recovery:

~~~sh
python -B -m model.ensemble_cli --workspace /absolute/study report ACTUAL_ENSEMBLE_ID --refresh
~~~

Inspect and ordinary report reads use JSON metadata and the retained summary. They do not re-read large raster files on each operator poll. Report state current, pending, stale or partial describes the retained summary relative to the current native run records.

## Read the quantities

Each land-cover row reports the baseline and alternative annual totals, their separately covered cells, the totals on their exact shared valid cells, the change on those cells, the percent change and the original comparison artifact. Nitrogen and phosphorus use kg/year. Sediment uses t/year, where t means metric tonnes.

Change means alternative minus baseline. A negative value is lower modeled export under the alternative. Percent change divides the shared-cell change by the shared-cell baseline. When that baseline is zero the percentage is empty, while both physical totals and the physical change remain available.

The module reads the actual native mass rasters and computes the mask used by each comparison. common_support_sha256 includes the retained grid identity, dimensions and every common-valid mask bit in a fixed window order. Two comparisons with the same cell count but different covered places therefore remain separate.

Robustness rows group by scenario, pollutant and the exact common-cell mask. Each group reports the completed members, explored minimum/median/maximum, direction counts and direction agreement. These ranges describe the completed selected parameter values. The report preserves the planned member count beside them.

Parameter-sensitivity rows compare each member's baseline with the first member's baseline. They have the same physical and geographic fields, with kind parameter. Land-cover rows have kind landcover. Their separate roles keep a parameter change from being attributed to a land-cover change.

## Native source and method choices

The catalogue pins the actual NDR and SDR 3.20.0 source modules:
- NDR: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py — Git blob f518b2867d4a327675fcb1c9b4ba56f29b12188d.
- SDR: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py — Git blob 0cac27add172011df367ff8026427dbbdbcda5b2.

The InVEST NDR guide recommends exploring source-supported parameter ranges and notes sensitivity to loading and retention inputs. Its loading semantics distinguish measured-runoff from application-rate; the latter receives the model's on-cell retention adjustment. The ensemble preserves the selected source table and load types.

The SDR guide describes differences in scenario exports as one way to evaluate altered retention. It identifies k and IC0 as empirical connectivity parameters and distinguishes overland sediment export from other sediment sources. It states that raster outputs from version 3.15 onward are rates per hectare. The original Workspace converts the selected native outputs to per-cell mass before this module aggregates them. At a 30 m square cell that area is 0.09 hectares.

Guides, accessed October 12, 2026:
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html

The catalogue records the current guide URLs separately from the fixed source-module version. Derived parameter profiles are scientific working profiles and identify their original parent profile. An original profile remains unchanged.

## Integration contract

Use Ensembles(workspace) from model.ensembles.

| Method | Result |
| --- | --- |
| preview(spec) | Read-only actual selections and workload counts |
| prepare(spec) | Immutable saved ensemble, prepared native runs and current merged manifest |
| inspect(id) | Merged manifest, member/run states, progress, active operation and actual errors |
| list() | Existing ensembles and their current states |
| run(id, continue_on_error=True) | Complete or partial merged manifest after native execution and paired summaries |
| report_data(id, refresh=False) | Cached canonical physical report data |
| report_data(id, refresh=True) | Explicit computation of missing or changed paired summaries |

The immutable plan is ensembles/ID.json. Native runs remain runs/RUN_ID/ with the existing run.json, argument files, logs, stages and physical outputs. Ensemble progress is ensemble_results/ID/state.json; summary.json contains the canonical report. Reusable paired summaries are in ensemble_results/ID/pairs/. Original difference rasters stay in comparisons/COMPARISON_ID/. The existing whole-workspace archive includes these directories.

The report schema is upstate.ensemble-report/v1. Its main arrays are rows (land-cover pairs), sensitivity (cross-profile baselines), robustness (same-support ranges) and members. Sources, run_signature, progress, generated_at, model_scope and report_state travel with those arrays. model_scope includes selected_models, omitted_models, expected_artifacts, available_artifacts, selected_models_complete, full_model_selection and full_model_outputs. Completion of an NDR study describes its two nutrient outputs. The complete seven-family delivery uses the combined NDR and SDR model outputs. Member parameter dictionaries include their executed model groups and source-table identity; partial members also carry models. Each row identifies its actual baseline_run_id, alternative_run_id, comparison_id, profile_id, member_id, scenario_id, pollutant and artifact hashes. Root's ensemble report and operator modules consume this interface for the running browser, complete HTML/CSV/JSON export and project handover.


## Join the shared paired raster desk

The scientific design keeps model/ensembles.py, model/ensemble_cli.py, the
operator's ensembles view, and actions ensemble.create, ensemble.run and
ensemble.report. It saves selected parameter cases, runs the original models
and exports scalar physical comparisons.

The complete multi-pollutant raster implementation is model/paired_ensemble/.
Its shared operator view is paired-ensemble, with the original
paired_ensemble.build, paired_ensemble.resume, paired_ensemble.export and
paired_ensemble.receive actions. Its product records remain
paired_ensemble_products, and native files remain in
ensemble-products/ANALYSIS_ID/.

Use the same design-cohort selector as the shared desk and headless workflow:

~~~python
from model.paired_ensemble import EnsembleWorkspace
from model.paired_ensemble.designs import design_cohort

cohort = design_cohort(workspace, actual_ensemble_id, actual_alternative_scenario_id)
if cohort["ready"]:
    product = EnsembleWorkspace(workspace).build(cohort["selection"])
~~~

The selector reads the saved design and actual completed native runs, binds
each baseline to the same profile's selected land-cover alternative, and
preserves the planned member count and pending members. Its physically present
pollutant outputs are restricted to the study's selected model scope.
The original binder verifies the native raster identities, units, source
profiles, model version and common reporting grid before analysis.

The original CLI is model.paired_ensemble.ensemble_cli. preview, build, pause
and resume accept --workspace and --selection. export and receive use the
original portable result project. [PAIRED_ENSEMBLES.md](../PAIRED_ENSEMBLES.md)
documents those complete commands and the support modes.

This engine reports scalar change as alternative minus baseline. The paired
raster product reports reduction as baseline minus alternative. Negating a
reduction quantile requires reversing its probability order:
q10(reduction) = -q90(change), and q90(reduction) = -q10(change).
The same reversal applies to minima and maxima. Parameter-only baseline
sensitivity remains a separate scalar comparison.

For the walkthrough, open an actual retained design, show its inputs and member
count, run or reopen it, select the saved alternative, read the paired change
and covered area, and export the report. The paired desk accepts that completed
design cohort directly and opens its spatial result in the same operator.
