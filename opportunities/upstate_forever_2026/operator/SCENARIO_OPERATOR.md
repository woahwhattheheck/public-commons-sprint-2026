# Scenario analysis operator — selected native models

TokenJunkieLabs · source edition 20261013-scenario-analysis-operator-v3

The Scenario analysis desk now opens completed NDR-only, SDR-only and combined native runs through the same original queue. A completed baseline can be analyzed immediately; alternatives remain optional. The editor names the original native model scope beside each run, shows the shared comparison outputs and disables weights for unavailable outputs. The retained result carries physical annual quantities, planning scores, weight sensitivity, pairwise comparisons, coverage and verified original downloads.

For the current cumulative application, install the shared extension host first and then use this complete source carrier with apply_scenario_analysis.py --integration extensions. The predecessor-aware installer accepts the exact V1 or V2 owned source files and migrates only this desk's recorded legacy joins. The current common host source is [F0C8TNEPZB6](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8TNEPZB6); the native selected-model dependency is [F0C8JJQ2JBX](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JJQ2JBX).

## Use the selected-model controls

1. Open Scenario analysis and choose New analysis. Select a completed baseline. The picker names NDR, SDR or NDR + SDR beside each retained run.
2. For immediate baseline results, leave alternatives empty. For changes, select completed alternatives from the same grid. The comparison output notice shows the shared native pollutants for the entire selected cohort.
3. Set relative weights for those outputs. The remaining controls stay disabled at zero. Choose the baseline percentile or enter physical caps for the displayed pollutants.
4. Add explicit named weight choices and original planning-area sources as required. Keep each geographic rank group at a comparable reporting level.
5. Choose Build analysis. The existing Operations queue retains the selection and reports actual file, raster-block and export progress.
6. Open the completed result. Physical changes and pairwise rows use only shared native outputs. Coverage and choices names each run's original models and the exact compared pollutants. The saved result can be downloaded or reopened after restarting the operator.
7. Save the current workspace through the original workspace controls after the analysis completes. Its native runs, source editions, selected analysis and exports travel together in the updated archive.

# Scenario analysis in the Upper Savannah workbench

TokenJunkieLabs · UPSTATE-SCENARIO-OPERATOR-20261012

## Start with the retained study

Use the project's equipped Python environment described in model/README.md. From the current Upper Savannah application directory, reopen the prepared study:

    python -B operator/server.py --workspace /absolute/upper-savannah-study

Open the complete loopback operator URL printed by that command on the same machine. Select the study in the Workspace control. The source edition, parameter profile, model grid, baseline and alternatives come from that retained study.

For a new study, use the original setup command with the prepared source manifest:

    python -B operator/server.py \
      --workspace /absolute/upper-savannah-study \
      --create --title "Upper Savannah source study" \
      --source-manifest /absolute/retained-source/sources.json

Prepare the referenced grid and run the baseline and alternatives through Native model runs. The picker offers runs whose selected native stages and annual-mass outputs are complete. Existing prepared results can be opened immediately while a separately selected fresh calculation runs through Operations.

## Open and use the analysis

Open the existing scientific operator and select the retained study in the Workspace control. Choose **Scenario analysis → New analysis**.

1. Give the analysis a useful name and choose a completed native baseline.
2. Select the alternatives to compare. The form lists completed runs on that baseline's retained model grid with at least one shared native output. Leave alternatives empty for baseline analysis; the output notice names the shared pollutants for any selected cohort.
3. Set the relative nitrogen, phosphorus and sediment weights. The default entries are equal weights; change them to the planning choice being studied.
4. Select a baseline percentile or enter explicit physical normalization caps. Every alternative uses these same caps, which keeps its map scale comparable with the baseline.
5. Add named weight selections to examine sensitivity. For example, a planner can compare equal weights with a nitrogen-emphasis choice. These are selected planning assumptions.
6. Optionally add retained planning areas: select the original source edition, vector, layer and an exact attribute filter. Supply a positive metre buffer when a line or point source needs a polygon area. Give comparable areas the same rank-group name.
7. Choose **Build analysis**. The original Operations panel carries this task while the rest of the operator remains available. The analysis view shows the saved source, normalization, comparison and export phases. Counts and percentages refer to actual work in the current phase. **Inspect operations** opens the original task and its resume controls if the process was interrupted.
8. Return to **Scenario analysis**, open the completed analysis, and select an area or run.

The original reporting area is always present. Planning areas keep their source selection and actual selected geometry. A rank group establishes which areas should be compared with one another; use it only for an appropriate set of areas.

## Read the result

**Physical changes** shows the shared annual baseline and scenario pollutant exports on the same valid cells for each pollutant. Change is alternative minus baseline. A negative mass change means lower modeled annual export. Percentage change is a percentage of the baseline mass; a zero baseline is identified explicitly.

**Planning priorities** shows the dimensionless planning scores under each selected weight set. The saved baseline caps remain fixed across the selected alternatives. The table includes the score and rank changes from the baseline. Ranking is within the same saved geographic rank group, run and weight selection.

**Weight sensitivity** shows the lowest and highest scores and the best and worst ranks across the selected weight sets. Areas with wider rank spans warrant closer examination of the planning assumptions.

**Compare alternatives** contains pairwise quantitative differences between the chosen runs. The comparison identifies changes to land cover, parameter profiles, or both. The physical trade-off view identifies non-dominated choices among the comparable runs.

**Coverage and choices** separates each run's individually covered total from the common covered total used for comparisons. It shows selected and valid cells, common area and fraction, physical cap units, original grid/profile/scenario selections and planning-area sources.

**Download results** provides the saved complete analysis, physical and pairwise CSV tables, priority and sensitivity tables, fixed-scale scenario priority rasters and weight-spread rasters. **Download visible rows** exports the currently filtered table.

## Retain, reopen and transfer

The selection and generated files live in the original study under analyses/<analysis-id>/. Reopening the study restores the saved analysis. Repeating an identical selection reuses its retained completed result after checking the bound inputs. A changed selection receives its own result.

Use **Back up workspace** to carry the analysis with the complete source/model project. Restore the resulting archive using the original receiving workflow, then open **Scenario analysis** in the restored study. The original portable backup already includes analyses and the complete application folders recursively. Build a new delivery to include the new analysis in its scientific workspace archive.

## Integration into the original application

The complete source edition contains ten files: the calculation engine and CLI, the browser module and stylesheet, the two operating guides, the installer, and three bindings for the shared extension host. All source is credited to TokenJunkieLabs.

### Current shared extension host

The public sprint source contains operator/extensions/scenario-analysis.json, operator/scenario_analysis_operator.py and operator/web/scenario_analysis_bridge.mjs. The manifest registers the original scenario.analyze queued action, scenario_analyses item/state contribution, original verified downloads, navigation and stylesheet. The bridge updates retained progress through the existing host lifecycle while preserving the analysis controls.

After receiving the complete current application and shared host source, install the common host once:

    python -B install_extensions.py \
      --application /absolute/current-upstate-application \
      --source-root /absolute/complete-upstate-source

If the scenario files are already present in that application, restart the original server and open Scenario analysis. The installed registry reads its manifest directly. The existing task queue, workspace gate, authentication and download tickets remain the execution and transport paths.

### Receive this complete source carrier

Save the complete source Canvas as scenario-operator-source.md. Use the original receive_application_source.py to materialize it into a fresh component directory:

    python -B /absolute/receive_application_source.py \
      /absolute/scenario-operator-source.md \
      --output /absolute/scenario-operator-component

Then apply the source to the current shared application:

    python -B /absolute/scenario-operator-component/operator/apply_scenario_analysis.py \
      --root /absolute/current-upstate-application \
      --carrier /absolute/scenario-operator-source.md \
      --receiver /absolute/receive_application_source.py

The installer detects a joined shared extension host and installs the ten files. On the original application without that host, it installs the seven direct-integration files and composes seventeen precise source edits. The three registry bindings remain in the complete carrier for migration. An explicit --integration extensions or --integration legacy selects the corresponding route.

The root can be the repository checkout or the Upper Savannah application directory. A decoded complete packet can be supplied with --bundle. The installer updates the exact preceding scenario edition, prepares every source edit before replacement, parses changed Python, and checks concurrent source bytes. Its original-application stylesheet hook uses style.css, which exists in the original source cohort.

When moving an existing direct integration to the shared extension host, install the common host first and rerun this installer with --integration extensions. It removes only the scenario desk's exact preceding shared-file joins and registers the same action, item and browser view through the common host. Other authors' source outside those exact spans is preserved.

The original application route adds Workspace.analyze_scenarios(selection) and compact Workspace.overview summaries. The extension route binds the same calculation directly and contributes the same summaries through the registry. Both read analyses/<id>/summary.json for progress and retrieve full analysis.json only after publication is complete. A completed task exposes the same retained result files.

## Native operating demonstration

Use the original equipped Python environment and existing regional study. Open the operator, select the actual completed baseline and alternatives, build an analysis, inspect the physical and sensitivity views, download the full result, and reopen the transferred study. Retain the real run IDs and timings with the same source operation. The computation consumes the selected original native model exports.

Suggested sentence for the partner demonstration: “This view shows how the watershed alternatives change modeled pollutant exports, and which planning priorities stay consistent as we vary the pollutant weights.”

The scientific methodology, weighting definitions, source selection and original InVEST configuration remain in the retained study and companion calculation guide.

## Scientific use

Needs expert review: interpret parameter choices, land-cover alternatives, planning weights and conservation priorities with the project’s domain specialists. The source selections, native model configuration, coverage and quantitative basis are retained with each result.
