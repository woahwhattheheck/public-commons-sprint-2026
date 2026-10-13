# Scenario experiments

Use Scenario experiments to compare retained land-cover alternatives and parameter choices with the original InVEST NDR and SDR models. Every land-cover effect is paired with the unchanged baseline under that same parameter profile. The selected source data, complete 30 m grid and actual biophysical table remain part of the saved design.

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

Count work in native cases: a case is one profile and one scenario, and it uses both NDR and SDR. With two alternatives and two distinct profiles, the plan contains six native cases: two baselines plus four alternatives. A regional reference combination equal to the original profile does not add a duplicate profile. Completed cases are reused when the design is executed.

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

Nitrogen and phosphorus are reported separately in kg/year. Sediment is reported in metric tonnes/year. The delivered cell-mass rasters already include the cell-area conversion from native per-hectare rates. On the fixed 30 m grid, one cell covers 0.09 ha [3,4].

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

## Inputs and outputs

| Input | Scientific meaning |
| --- | --- |
| Complete grid | The aligned terrain, land cover, precipitation, erosivity, erodibility, reporting geometry and upstream model domain used by the native models. |
| Baseline native run | The unchanged scenario, reference profile and grid that anchor the experiment. |
| Alternative scenario | A retained geographic land-cover transformation with original classes, replacement class and purpose. |
| Retained profile | An immutable source table, parameter selection and supporting references. |
| Axis | Explicit values for one supported native model parameter. |
| Axis reference | The source or scientific rationale for those values. |

| Output | Use |
| --- | --- |
| Native case run | The original NDR and SDR execution, logs and files for one profile/scenario pair. |
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

The 30 m grid is the analysis grid. Preserve the original spatial resolution and period of precipitation, soils and other inputs in interpretation. Use identical paired grid support; inspect coverage when comparing scenarios.

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

An experiment selection uses schema upstate.experiment-selection/v1 and fields title, reason, baseline_run_id, scenario_ids, profile_ids, design and axes. Designs are one_at_a_time or factorial; each axis contains path, values and a nonempty reference. The methods document uses schema upstate.experiment-methods/v1 and a methods list. The form copies the selected method's axes and design into the actual study selection and retains its citation in the purpose/reference context.

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
