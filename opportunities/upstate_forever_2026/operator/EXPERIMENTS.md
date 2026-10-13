# Scenario experiments

Use Scenario experiments to compare retained land-cover alternatives and parameter choices with the original InVEST NDR and SDR models. Every land-cover effect is paired with the unchanged baseline under that same parameter profile. The selected source data, complete retained analysis grid and actual biophysical table remain part of the saved design.

This guide accompanies the Upper Savannah operator and InVEST 3.20.0. It describes the controls in this delivery and the meaning of the native results. The regional reference preset is [experiment-methods-20261012.json](../source/experiment-methods-20261012.json).

## Open the study

Run the operator from the delivered product directory using the environment that contains InVEST 3.20.0 and its GIS dependencies:

```sh
python -B operator/server.py --workspace /absolute/scientific-workspace
```

Open the complete operator URL printed by the server. Select the retained study. The existing [operator guide](README.md) covers source intake, profile creation, grid preparation and receiving an archive. Keep the original scientific workspace path when reopening a study; use Restore an archive when receiving a copy.

## The operator journey

### 1. Prepare the question in Scenarios

Open Scenarios and identify the unchanged baseline and the existing land-cover alternatives you want to compare. An alternative records the actual geographic mask, original class codes, replacement code and purpose. Prepare the analysis grid from the retained source layers before creating the experiment. Its hydrologic model domain includes the upstream landscape needed for routing; its reporting extent determines where results are presented.

The selected baseline native run supplies the experiment's grid, unchanged baseline scenario and reference parameter profile. That grid must already be complete. The baseline run itself may be prepared, interrupted, failed or complete: execution continues its retained native work, and a completed baseline is reused.

> For Tim: We start with the real study area and a clear description of which land-cover changes we want to compare.

### 2. Open Scenario experiments and choose New experiment

Select Scenario experiments in the sidebar, then New experiment. Enter a title, select the baseline native run and state the purpose. Use a title that identifies the planning question, such as the receiving watershed and the management change. The purpose should explain what a difference in export would help decide.

Read the selected baseline's source, grid and parameter-profile information. The run must use the unchanged baseline scenario. Its grid and native model selection bind the experiment to the existing study.

> For Tim: This baseline anchors the experiment to the study's actual data and model settings.

### 3. Select Land-cover alternatives and Additional retained parameter profiles

Choose the existing alternatives under Land-cover alternatives. Each selected profile will run the unchanged baseline and every selected alternative on the same grid.

Additional retained parameter profiles lets you compare existing source-backed tables and parameter selections. Each added profile keeps its own actual biophysical table and receives its own baseline. Numerical axes in the next step generate variants of the selected baseline profile; they do not rewrite the additional retained profiles.

Use retained profiles to investigate coefficient choices with a source-specific meaning. In NDR 3.20.0, application-rate and measured-runoff load types have different model meanings, so their source definitions belong with the table [3].

> For Tim: We can compare several management choices and existing scientific parameter sets while keeping each comparison properly paired.

### 4. Set Parameter exploration

Under Parameter exploration, select a design:

| Design | What runs |
| --- | --- |
| One parameter at a time | Each entered value changes one parameter from the selected baseline profile. |
| Every selected parameter combination | All combinations of the entered axis values are used together. |

Use Add parameter, choose a supported parameter and enter its values and reference. The reference should identify the paper, source dataset, established profile or specific scientific reason for those values. The original baseline profile is included in either design, and repeated equivalent parameter selections are deduplicated.

If the companion methods file is present, choose the Vickery and Quinn entry under Published starting profile and click Use regional reference values. This fills eight numeric axes from the published Upstate study and selects Every selected parameter combination [1]. Each axis contains one published value. This creates one joint candidate configuration alongside the original baseline unless the configurations are already identical. It preserves the selected baseline, study inputs and actual biophysical table. Additional retained profiles remain available.

The preset is a reproducible comparison with published reference settings. Values selected for a broader sensitivity study need their own stated rationale.

> For Tim: This step lets us see how the result changes when we use another clearly identified set of model settings.

### 5. Click Preview selected cases

Preview selected cases before saving. Read the planned profiles, scenarios and native cases, and resolve any invalid selection shown by the preview. Confirm that every land-cover case has a baseline under its own profile and that the geographic grid is the intended one.

Count work in native cases: a case is one profile and one scenario, using the baseline's selected NDR, SDR, or combined model scope. With two alternatives and two distinct profiles, the plan contains six native cases: two baselines plus four alternatives. A regional reference combination equal to the original profile does not add a duplicate profile. Completed cases are reused when the design is executed.

The preview explains the work selection; actual elapsed time is recorded by execution on the host.

> For Tim: The preview shows exactly which comparisons the computer will make before we start the models.

### 6. Save and run

Leave Save and run native models selected and click Save and run to retain the design and start the models. To retain a design for later execution, select Save design for later execution and click Save design. The saved design appears in the experiment table.

Open retrieves the retained experiment. Open experiment in the operation details returns directly to its saved design and results. Revise design starts an editable revision from that selection. Preserve a meaningful purpose and references when changing the design so the revised experiment remains understandable.

The operator submits model work through its existing operation queue. The experiment keeps its own selection, case identities and progress alongside the individual native runs.

> For Tim: Saving gives us a reusable experiment, and running produces the original model outputs for every selected case.

### 7. Follow progress and resume

Open the saved experiment. Use Run experiment for a saved design or Resume experiment for unfinished work. When an operation is active, View running operation opens its live task information. Follow completed, failed and pending cases, the active case and the native run status. Open run provides the individual run's retained details and logs.

The experiment processes the selected reference baseline first. A complete original baseline is reused directly. Each new profile receives its own baseline, then its alternatives. Independent cases continue after a case failure; the summary retains the available results.

| Experiment state | How to read it |
| --- | --- |
| prepared | The design and cases are retained and ready for execution. |
| running | Execution is processing the retained cases. |
| partial | Some results are available and work remains. |
| complete | All experiment cases are complete. |
| failed | Execution has recorded a failure requiring attention before completion. |

If a browser tab closes, reopen the same workspace and experiment to read the retained state. If the server stops, restart it on the same workspace and use Resume experiment. Resumption skips completed experiment cases, reuses completed native stages and continues cases that need only comparison or summary work. Open the affected run to address its concrete input or runtime error before retrying.

> For Tim: We can reopen the study and continue the unfinished work while keeping every completed result.

### 8. Read paired results and inspect native maps

The result table keeps three comparison kinds distinct:

| Kind | Reference for interpretation |
| --- | --- |
| reference | The original baseline configuration. |
| parameter | A changed profile's baseline compared with the original baseline. |
| landcover | An alternative compared with the unchanged baseline under that same profile. |

The paired result fields mean:

| Field | Meaning |
| --- | --- |
| Paired baseline | Baseline annual mass on cells valid in both runs. |
| Alternative | Alternative annual mass on those same cells. |
| Signed change | Alternative minus paired baseline. |
| Reduction | Paired baseline minus alternative, the opposite of signed change. |
| Change % | 100 times signed change divided by paired baseline; undefined when the baseline is zero. |
| Paired support | The common valid cells and area used for the comparison. |

Nitrogen and phosphorus are reported separately in kg/year. Sediment is reported in metric tonnes/year. The delivered cell-mass rasters already include the cell-area conversion from native per-hectare rates. Cell area follows the actual retained metric affine transform: a full 30 m square cell covers 0.09 ha, while a full 300 m square cell covers 9 ha [3,4]. Read the selected grid's resolution and reporting mask with its quantities.

Use Open run to inspect the model selection and original artifacts. Use Map to open the case's native outputs in Spatial review. Choose the relevant baseline and alternative, check the layer's quantity and units, then inspect linked views, swipe or a difference. A difference is alternative minus baseline. Click a location for the original pixel value and mask, and use the appropriate reporting or utility overlays. Save a useful spatial review with a title and notes so the receiving operator can reopen the same selections.

A modeled zero, a masked pixel and a location outside a source are distinct. The map's visible colour scale describes that view; the paired numerical summary uses the recorded common support. Rank comparisons across parameter choices retain matching support groups.

> For Tim: We can see the amount of change, where it occurs and whether that conclusion stays consistent across the selected model settings.

### 9. Build and download the report

Use Refresh report to regenerate the retained report from current results. Build report from available cases creates a report while some cases remain unfinished. Read the coverage and case status beside the findings so the report is interpreted at its recorded stage.

Open or download report.html for the readable experiment report, results.csv for the result table and summary.json for the complete structured summary. Their retained native file links download the actual files. Keep the run, scenario and profile identifiers when using rows in another report.

The CSV and JSON retain the component quantities and signed changes. The report can support a selected management comparison, a parameter-response explanation and a native map review. Export-rate maps, seven-family delivery products and observed-load comparisons remain available through their existing operator views.

> For Tim: The report gives us an explanation we can read together and the underlying results we can reuse in other work.

### 10. Back up and reopen

Choose Back up workspace and download the completed archive. It carries the scientific workspace, retained source selections, profiles, scenarios, native runs, experiment artifacts, saved views and application needed for receiving the study.

In the receiving operator, choose Restore an archive and select the backup. The restored study appears in the workspace selector with its original identity. Open Scenario experiments, choose Open for the retained experiment and inspect the same cases and report files. Resume unfinished scientific work from its retained selections.

The original server's operation journal belongs to that server's operator-state directory. The portable scientific workspace carries the model and experiment state used to continue the study.

> For Tim: You receive the working study itself, so you can reopen the evidence and continue using it.

## Adopt completed original runs and read their report sources

Use **Adopt completed original runs** when an already completed retained run supplies one of the selected profile/scenario combinations. The selected baseline is considered automatically. The original engine checks the retained grid, parameter profile, scenario, selected models and producing versions. A compatible completed run may keep a historical requested-version declaration; its original run ID, complete selection and output descriptors remain intact. An unfinished selection continues through the current-version native execution path.

Save and preview the same design after choosing its original runs. **Adopted original runs** in the saved design opens the actual original run records. The native case table identifies an adopted original result and an adopted original paired baseline separately. Each land-cover comparison continues to use its baseline under the same parameter profile.

The selection field `source_run_ids` identifies explicitly selected originals. The engine freezes noncanonical source mappings in the original experiment's `plan.source_runs`. Each applicable case retains `native_source` and/or `native_baseline_source`; these contain the original selection, producing-model versions and exact selected output descriptors. Ordinary canonical selections keep their existing identity. The older partial-model recovery fields `source_run_id`, `source_baseline_run_id` and `source_selection` describe their existing recovery mechanism and remain separate.

### The original-source register in report.html

Use the existing **Refresh report** or **Build report from available cases** action. The same HTML report now includes **Original native sources and execution** when the retained summary contains adopted source bindings or per-model version records.

The original output register shows each saved source run, its requested version, selected producing versions, and original output units, byte sizes, SHA-256 digests and run-relative paths. **Original selection and source binding** exposes the complete immutable binding; **Cases using these outputs** lists every case and whether that source supplies the result or paired baseline. A current selection address is the corresponding run digest under the current requested version. The original run ID remains the identity of the outputs actually used.

The producing-model register preserves NDR and SDR separately. It displays the version used by the paired comparison, recorded basis, requested version, observed run version and stage completion. **Execution source and reuse** exposes the complete retained model record, including an independently adopted stage's original reuse source. Identical repeated records are grouped with all case uses retained; different records remain separate.

A completed stage's recorded version takes precedence over the latest run runtime. If a completed-stage version is absent, the shared resolver uses the observed run runtime, then an explicitly labelled requested-only legacy record. The report reads this metadata from the saved experiment cases. It leaves the paired mass values, support, case IDs and original run records unchanged. Older summaries without these additive records remain readable, with their existing scientific tables.

Keep `summary.json` with the report: it retains all original source bindings and the paired comparison's full `native_versions` cohort. Reopening and refreshing a complete experiment preserves its existing scientific case rows while refreshing the report files. An interrupted export or summary action can continue through the original operator queue and the maintained receiving command.

## Inputs and outputs

| Input | Scientific meaning |
| --- | --- |
| Complete grid | The aligned inputs required by the selected native models, actual grid transform, reporting geometry and upstream model domain. |
| Baseline native run | The unchanged scenario, reference profile and grid that anchor the experiment. |
| Alternative scenario | A retained geographic land-cover transformation with original classes, replacement class and purpose. |
| Retained profile | An immutable source table, parameter selection and supporting references. |
| Axis | Explicit values for one supported native model parameter. |
| Axis reference | The source or scientific rationale for those values. |

| Output | Use |
| --- | --- |
| Native case run | The selected original NDR, SDR, or combined execution, logs and files for one profile/scenario pair. |
| Paired result | A same-support annual-mass comparison with its exact baseline and alternative identifiers. |
| Parameter response | The effect of a profile change on the unchanged landscape. |
| Land-cover response | The effect of a landscape change under one specified profile. |
| Sensitivity grouping | The spread among selected matched-support comparisons. |
| report.html | Readable retained experiment report. |
| results.csv | Tabular retained comparison values. |
| summary.json | Structured retained results, case coverage, pairs and source identities. |

## Supported parameter choices

The numeric controls use the native profile parser. Use finite numbers; the flow choices are mfd and d8. The only nullable axis is ndr.runoff_proxy_av: null selects the native calculated mean.

| Parameter path | Unit and valid experiment input |
| --- | --- |
| ndr.threshold_flow_accumulation | Positive upstream-cell threshold. |
| ndr.k_param | Positive dimensionless connectivity-shape value. |
| ndr.flow_dir_algorithm | mfd or d8. |
| ndr.subsurface_critical_length_n | Positive metres. |
| ndr.subsurface_eff_n | Fraction from 0 through 1. |
| ndr.runoff_proxy_av | Positive runoff-proxy units, or null for the native mean. |
| sdr.threshold_flow_accumulation | Positive upstream-cell threshold. |
| sdr.k_param | Positive dimensionless connectivity-shape value. |
| sdr.flow_dir_algorithm | mfd or d8. |
| sdr.sdr_max | Fraction from 0 through 1. |
| sdr.ic_0_param | Any finite dimensionless value. |
| sdr.l_max | Positive dimensionless RUSLE L-factor cap. |

Each axis needs at least one value and a reference. Equivalent normalized values are deduplicated; add a parameter path once. Where all table rows allocate zero nitrogen to subsurface transport, subsurface length and efficiency changes leave that pathway inactive.

## Reading the science accurately

### Annual export and drinking-water interpretation

NDR follows diffuse nutrient loading from source pixels to the stream network. A source pixel's loading minus export describes downstream retention of its load; it does not locate retention on that pixel [2]. SDR represents overland erosion and delivery and provides separate export and avoided-export quantities [5].

Use upstream catchments to connect these modeled source contributions with receiving waters. Reservoir processes, in-stream transformations and contaminant-specific processes require their own interpretation. Annual nitrogen, phosphorus and sediment mass retains its own meaning when discussing drinking-water protection and the project's E. coli and cyanotoxin context.

### Landscape effects and parcel decisions

A whole-landscape scenario's cell differences describe that complete intervention. To estimate a particular parcel intervention's receiving-catchment effect, compare the whole affected catchment before and after changing that parcel, including unchanged source cells whose downstream retention changes.

Keep N, P and sediment components separate in physical units. If a planning score combines them, retain the normalization, reference domain and weights alongside the components. A selected-parameter spread describes those selected configurations; statistical confidence requires an independently justified statistical design.

### Climate and resolution

NDR divides its runoff proxy by a supplied or calculated mean. Uniform precipitation scaling cancels when that mean is independently recalculated; fixing a baseline denominator preserves an intended absolute runoff-proxy change [2,3]. SDR uses rainfall erosivity R, which has its own physical units and source [4,5].

Use the actual retained analysis grid and its resolution. The regional 30 m default and other explicitly prepared resolutions keep their own original affine transform and cell area. Preserve the original spatial resolution and period of precipitation, soils and other inputs in interpretation. Use identical paired grid support; inspect coverage when comparing scenarios.

### What the regional preset establishes

The eight scalar entries are the reference defaults in Appendix 1 of Vickery and Quinn's 2023 regional study [1]. They provide a traceable native comparison. They are not uncertainty intervals or locally calibrated Upper Savannah coefficients. Land-cover changes remain the operator's actual retained alternatives; the preset supplies numeric parameters.

The paper's landscape examples can inform separately authored alternatives: forest conversion to development, forest expansion and restoration of steep agricultural land. Its restoration threshold is 10 percent slope, equivalent to about 5.71 degrees; preserve the actual slope unit when defining an alternative [1].

### Demonstration records

Use the executing host's retained logs for timings and its actual Spatial review for screenshots. Record the workspace, experiment, run or saved-review identifier with a demonstration image. The native report, source vintages, case statuses and paired coverage show which result was present at capture.

## Command-line equivalents

Run these from the product directory in the same native environment. Replace the absolute paths and experiment ID with the retained study's actual values.

```sh
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace axes
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace preview /absolute/selection.json
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace prepare /absolute/selection.json
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace execute /absolute/selection.json
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace list
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace inspect EXPERIMENT_ID --offset 0 --limit 100
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace run EXPERIMENT_ID
python -B -m model.experiment_cli --workspace /absolute/scientific-workspace summary EXPERIMENT_ID
```

An experiment selection uses schema upstate.experiment-selection/v1 and fields title, reason, baseline_run_id, scenario_ids, profile_ids, design and axes, with optional source_run_ids for completed original-run adoption. Designs are one_at_a_time or factorial; each axis contains path, values and a nonempty reference. The methods document uses schema upstate.experiment-methods/v1 and a methods list. The form copies the selected method's axes and design into the actual study selection and retains its citation in the purpose/reference context.

execute and run continue unfinished cases and preserve available summaries if a case fails. The command exits unsuccessfully while unresolved cases remain. Completed native work is reused. summary writes fresh results.csv and summary.json under experiments/<experiment_id>/; the operator builds the companion HTML report.

## Glossary

| Term | Plain meaning |
| --- | --- |
| Baseline | The unchanged landscape used as the reference for a comparison. |
| Scenario | A recorded version of the landscape, including an unchanged baseline or a specific alternative. |
| Profile | One retained biophysical table and set of model parameters with their references. |
| Axis | A model parameter whose explicitly chosen values are explored. |
| Factorial design | A design containing every combination of the chosen axis values. |
| Case | One profile applied to one scenario through the native models. |
| Paired support | Cells with valid values in both runs of a comparison. |
| Export | Modeled material delivered from the landscape to the stream network. |
| Signed change | Alternative minus baseline; positive means more export. |
| Reduction | Baseline minus alternative; positive means less export. |
| NDR | InVEST Nutrient Delivery Ratio model. |
| SDR | InVEST Sediment Delivery Ratio model. |
| Runoff proxy | The spatial input used to represent relative nutrient-mobilizing runoff. |
| R-factor | Rainfall erosivity used in the sediment erosion calculation. |
| L-factor cap | The dimensionless upper limit for the RUSLE slope-length factor. |
| Source edition | The retained original dataset or table release used by the study. |

## Scientific and implementation references

1. Vickery, C. E., and Quinn, J. E. (2023). Climate-altered Precipitation is more Important than Land Use when Modeling Ecosystem Services Associated with Surficial Processes. Environmental Management 72, 1216-1227. Appendix 1 supplies the reference scalars; Appendix 2 describes the land-cover scenarios. https://doi.org/10.1007/s00267-023-01861-6
2. Natural Capital Project. InVEST NDR user guide. Scientific interpretation, runoff normalization and nutrient pathways. https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html
3. Natural Capital Project. InVEST 3.20.0 NDR implementation and parameter specification, fixed tag. https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py
4. Natural Capital Project. InVEST 3.20.0 SDR implementation and parameter specification, fixed tag. https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py
5. Natural Capital Project. InVEST SDR user guide. Sediment processes, input units and export/service interpretation. https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html
6. Multi-Resolution Land Characteristics Consortium. National Land Cover Database class legend and descriptions. https://www.mrlc.gov/data/legends/national-land-cover-database-class-legend-and-description
7. Upstate Forever. Emerging Contaminants / Small or Disadvantaged Communities Mapping RFP, October 2, 2026. https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

The current user guides explain the science; the fixed 3.20.0 source governs this delivery's native parameter and output contract.


## Native execution and large experiment navigation

The native case table reads the selected run's actual stage records. Each completed NDR or SDR stage shows its recorded execution, reuse or recovery mode and elapsed stage time. A reused stage links to its source run; its original execution time appears separately from the current transfer. Existing stages without a reuse record remain labelled complete. Opening a result page reads retained state through the existing operator API.

Use **Go to case** to open any position in the saved design. Case counts and offsets remain exact decimal integers throughout the browser and server request, including designs larger than JavaScript's safe integer range. Completed-study filters operate over the retained result table; navigation follows the filtered order. The browser keeps the completed table until its saved summary changes and obtains native execution details only for the requested page. Searches share a short debounce so typing remains responsive.

The live native case table accompanies the scientific report. The report's nitrogen, phosphorus and sediment quantities continue to come from the saved paired comparisons. Whole-workspace transfer carries the selected native outputs and their stage records, so the receiving operator can inspect the same execution history.


## Select native models and share an experiment with compute programmes

The baseline run selects the native model families for the entire experiment. Its name shows NDR, SDR, or both. Parameter rows and pollutant controls follow that choice; every alternative and its paired baseline keep the same model selection. A full native profile can support a single-model experiment. Choose additional profiles and grids containing the selected models.

The maintained selected-model source integration supplies `common.selected_models`, `required_roles`, and `output_models`. Install the current shared native-model integration with this operator revision. Existing full-model experiment and run identities remain unchanged.

Open **Run programmes → Use saved experiment** to save the complete native run programme for a retained experiment. The programme keeps every selected profile, scenario and matched baseline, with the original NDR/SDR model selection. **Continue unfinished runs** executes the remaining native work. After the coordinator releases its native locks, the current operator collects completed paired results and refreshes the experiment summary. Open the experiment to read effects or build its paired ensemble maps.

Programmes use `expanded_cases(workspace, experiment_id, offset=0, limit=100)` to read an indexed page or consume `materialize_cases(workspace, experiment_id, offset=0, limit=None)` to prepare profiles and native run records in order. The iterator releases the experiment lock before yielding. The command-line programme path performs the same completion synchronization. To collect native runs completed in another session, use `model.experiment_cli sync EXPERIMENT_ID` with the retained workspace. The complete operator and command-line journey is in `model/EXPERIMENT_PROGRAMME_CONTINUATION.md`; model-selection semantics are in `model/EXPERIMENT_MODEL_SELECTION.md`.

## Build spatial ensemble products from a completed experiment

Open a completed experiment and choose **Build ensemble maps**. Select the land-cover alternatives, actual available pollutants and member percentiles. Each selected alternative creates a separate paired ensemble product. Its members retain the original profile, baseline-run, alternative-run and scenario IDs from the completed experiment. Profiles with different land-cover alternatives remain in their own products.

**Preview ensemble inputs** opens the retained native artifacts and reporting mask through the paired ensemble service. It reports the selected members and pollutants for each alternative. **Build selected ensembles** submits each validated selection to the existing operation queue. Open the completed task's product to see spatial summaries, coverage and downloads.

The request uses the maintained `paired_ensemble.build` action with the direct selection payload, `support: "all_pairs"`, and the exact selected member count. Per-cell percentiles describe responses across these selected parameter members. Positive reduction is baseline minus alternative. Actual reporting-cell counts and shared coverage appear in the completed product.

The optional control appears when the cumulative application exposes `paired_ensemble_products`. Its native source is the maintained `model/paired_ensemble/` implementation. The current source distribution installs through `python operator/install_paired_ensemble.py --operator operator` at the full application root. Its independent name permits the existing single-artifact ensemble implementation to remain available in the same application.
