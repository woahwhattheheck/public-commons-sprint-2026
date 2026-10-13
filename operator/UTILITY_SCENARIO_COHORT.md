# Utility scenario cohort

TokenJunkieLabs. This source follows the public repository's MIT license; original source datasets retain their publisher terms.

Needs expert review: interpret native model parameters, land-cover alternatives, planning weights and source-water priorities with the project's domain specialists. The saved cohort retains the original inputs, model scope, units and geographic coverage for that review.

This command launches the fixed-scale planning analysis and the existing native watershed decision report from the same retained source collection and selected original runs. A single completed regional native reference produces ARJWS/Pioneer annual export totals, yields, source-area priorities and planning-weight sensitivity. Adding actual alternative runs produces the complete common-support scenario comparison. Each producer retains its original outputs.

The entry point is `model/utility_scenario_cohort.py`. The source belongs alongside the current `model/scenario_analysis.py` and S1's `model/scenario_decisions.py`. S1's viewer remains at `operator/web/scenario_decisions.html`.

## Original protection-area selections

The source is SCDES [Public Water Supply, layer 2](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2). ECO-SOURCE12 retained the original four-polygon response, its layer metadata, 71 intake records and the 136-row protection-area attribute inventory.

| Utility | PWS ID | Intake | Native polygon OBJECTID | Native SYSTEM | Native BUFFER_FT | Rank group |
| --- | --- | --- | ---: | --- | ---: | --- |
| ARJWS | SC0420011 | S04101 | 11 | 0420011 | 1500 | published-swpa-1500ft |
| ARJWS | SC0420011 | S04101 | 12 | 0420011 | 200 | published-swpa-200ft |
| Pioneer | SC3720001 | S37109 | 131 | 3720001 | 1500 | published-swpa-1500ft |
| Pioneer | SC3720001 | S37109 | 132 | 3720001 | 200 | published-swpa-200ft |

The layer describes upstream source-water protection areas. The runner retains the original polygon geometry and the publisher's buffer attributes. It applies zero additional buffer. Both producers intersect each polygon with the same original reporting area before evaluating the selected runs.

The native SYSTEM field omits the SC prefix retained in the PWS identifier. Selection uses the real OBJECTID field and its original value type. The runner checks each selected feature's SYSTEM, INTAKE and BUFFER_FT against the captured native identity before calculating.

The two published buffer levels form separate rank groups. Within each group, the existing analysis ranks mean fixed-cap planning priority; the original source polygons determine area. The full reporting area receives its own physical summary and has no utility rank.

## Select the original regional study

These four fixed receptor polygons belong to ARJWS and Pioneer in South Carolina. Use their actual Upper Savannah or South Carolina scientific workspace, its imported original protection source, and native runs on that study's retained grid. Before either producer starts, the runner intersects every original polygon with the selected run's retained reporting geometry and requires positive overlap with at least one of them. A reporting area outside all four source-water polygons receives a concrete selection correction. A regional subarea may cover only some polygons; the remaining original polygons stay visible with zero intersection and null outcomes.

The original Gura programme is a separate Kenyan watershed. The current retained publisher 3.20 input edition uses a 15 m EPSG:32737 grid; a separately retained 300 m edition keeps its own input, grid and run identities. Completed Gura runs feed the general scenario analysis and S1 report with the matching original reporting geometry. The regional utility workflow uses the South Carolina source collection and its actual regional grid; Upper Savannah's existing selections use 30 m cells. Original study, grid and run IDs remain bound throughout receiving, calculation and reopening.

## Native execution editions and resumed runs

The shared `model/native_versions.py` helper resolves one execution descriptor per compared model. A completed stage's retained `runtime.version` takes precedence. Its enclosing run's observed runtime supplies the fallback only when that stage has no retained execution version. The requested selection version remains a separate provenance field.

The utility runner first resolves the annual-mass outputs common to the **entire selected cohort**, then checks the corresponding NDR and SDR execution descriptors. A resumed NDR3.20 stage can therefore remain valid for a nutrient comparison even when an unselected stage changed the last run runtime. Different requested versions do not reject otherwise identical observed executions. A differing version of an omitted model has no effect on the comparison.

The raw native-rate producer's current 3.20 unit contract remains explicit: every compared model needs observed stage or observed run provenance for that edition. A requested-only historical version is displayed as historical provenance and requires its original execution metadata before a new utility calculation. Existing saved cohorts and their downloads reopen from their retained records.

The desk shows availability for each original output separately. A run with valid SDR output remains a selectable candidate when its NDR version is unsuitable. Choosing multiple runs resolves their actual full output intersection before checking versions; the desk never silently removes an available pollutant to make a cohort pass. The source-area preview performs the same authoritative check as the command.

New plans retain `native_execution` with the policy, compared models, effective versions and per-run original descriptors. Each joined CSV row includes `native_model`, `native_execution_version`, `native_version_basis`, `native_stage_version`, `native_run_version` and `native_requested_version`. These fields explain the pollutant's actual model execution alongside its original mass and source area. The implementation identity also includes the shared helper's SHA-256.

## Run the complete calculation

Import the current retained source with `source_tools/prepare_public_source_water.py`. The complete application already contains the original 2,389,556-byte four-polygon response and its source manifest, so the ordinary command uses those retained bytes directly:

```sh
python -B source_tools/prepare_public_source_water.py \
  --model-root "$UPSTATE_APPLICATION" \
  --workspace "$UPSTATE_STUDY_WORKSPACE" \
  --out "$UPSTATE_RECEIVING_OUTPUT/public-water"
```

Use the actual South Carolina Workspace and current application directory. The command writes `public-water-preparation.json`, including the actual `source_collection_id`, and `scenario-source-areas.json` with the four original typed selections and retained preparation origin. The exact protection source ID is `scdes-arjws-prwd-swpa-20261012`; its role is `SOURCE_WATER_PROTECTION_AREAS`. The cohort runner finds the actual imported entry by role. An explicit `--source-id` selects one edition if the collection contains several. Existing collections produced by the earlier `prepare_public_water.py` retain their original IDs and remain selectable.

Select the actual completed regional reference run from that South Carolina scientific workspace. Alternatives are optional; when selected, the first run remains their baseline. Each selected run must complete its declared native models. Every model actually compared by this utility calculation must retain an observed InVEST 3.20.0 execution. The current model-selection contract resolves the intersection of completed annual-mass outputs across every selected run. The runner verifies the corresponding native export and stream descriptors, annual-mass units, common grid and model edition. NDR-only cohorts compare nitrogen and phosphorus; SDR-only cohorts compare sediment; combined cohorts compare every pollutant shared by all runs. Repeat `--scenario-run` for every selected alternative. Omit that option to calculate the first completed native reference immediately. This path requires the current S1 producer with completed-stage version handling; it accepts one run and writes its native `annual-totals.csv`.

For the first completed reference, the actual workspace, imported source collection and completed run are sufficient:

```sh
python -B -m model.utility_scenario_cohort \
  --workspace "$UPSTATE_STUDY_WORKSPACE" \
  --source-collection "$UPSTATE_PUBLIC_WATER_COLLECTION_ID" \
  --baseline-run "$UPSTATE_BASELINE_RUN_ID"
```

The resulting `report_kind` is `reference_totals`. It preserves the native per-source-area mass, yield, valid coverage, structural stream counts and selected planning priorities. The existing analysis and native report provide the physical and planning products on the same original source geography.

To add the complete alternative cohort, use actual values from that same workspace:

```sh
python -B -m model.utility_scenario_cohort \
  --workspace "$UPSTATE_STUDY_WORKSPACE" \
  --source-collection "$UPSTATE_PUBLIC_WATER_COLLECTION_ID" \
  --baseline-run "$UPSTATE_BASELINE_RUN_ID" \
  --scenario-run "$UPSTATE_ALTERNATIVE_RUN_ID" \
  --weight-grid 4
```

The command executes both producers, exports the joined table and prints retained product references. The engine's live progress stays in its existing analysis summary; the command also writes operation progress to stderr. Standard output is one JSON result that another program can consume.

Supply `--planning /absolute/planning.json` to use selected weights, normalization caps or percentile, and additional named weight sets. Planning JSON accepts the same `weights`, `caps`, `percentile` and `weight_sets` fields documented in [SCENARIO_ANALYSIS.md](SCENARIO_ANALYSIS.md). When omitted, the analysis gives equal weights to the shared outputs, zero weights to other pollutants, and exact 95th-percentile positive baseline caps. Explicit weight objects still name all three artifact keys; weights outside the resolved native intersection must be zero.

`--weight-grid 4` enumerates every nonnegative integer tuple over the shared pollutants summing to four, then uses the normalized ratios. The lattice has 15 points for three pollutants, five for two pollutants, and one for a single pollutant. The selected weights and any explicitly supplied profiles remain present; duplicate normalized ratios are skipped. With all three pollutants, the grid adds at most 15 weight sets, and default equal selected weights make 16 total sets. With two pollutants, equal weights already occupy one of the five grid points, leaving five distinct total sets. A single pollutant has one normalized ratio. For example, (4,0,0), (2,1,1) and (0,0,4) are explicit planning alternatives.

Weight-grid profiles vary planning preferences while using the same native physical outputs, common pixel support and frozen baseline caps. They do not rerun or approximate NDR/SDR. The range describes the declared weights; it carries no probability interpretation. Omit `--weight-grid` to retain only the supplied weight sets.

## Retained results

The command creates `utility-scenario-cohorts/<id>/` with:

| File | Use |
| --- | --- |
| analysis-selection.json | Exact baseline, alternatives, source-bound regions and planning weights passed to the fixed-cap analysis |
| decisions-selection.json | Same ordered run cohort and matched original feature selections passed to the native watershed producer |
| utility-comparisons.csv | Complete reference totals or scenario changes, native coverage, selected planning priority and weight sensitivity for each region/run/pollutant |
| cohort.json | Complete source bindings, selections, operation state, joined rows and both products' artifact references |

The original products remain in `analyses/<analysis-id>/` and `scenario-decisions/<decision-id>/`. The cohort JSON links all original output descriptors, including the fixed-cap maps, native decision viewer, source geography and both producers' original tables. The CLI result adds a separate descriptor for cohort.json.

The CSV includes the full reporting area and all four utility regions for the resolved shared pollutants. `comparison_pollutants` retains the exact artifact-key intersection, and partial S1 selections name the matching native pollutants explicitly. Physical columns use the existing native decision producer's annual masses, yields, baseline changes and common valid support. The record identifies `reference_totals` for one run and `scenario_comparison` for a cohort with alternatives. Native coverage columns retain each run's all-valid mass, valid area/cell count, structural stream cells, unexpected missing cells, unknown stream cells and original complete-support flag. Common-support counts remain separate from each run's own support. Planning columns use the existing fixed-cap analysis's selected mean priority, mean-score change, rank change and sensitivity across declared weights. Each physical pollutant and the planning score retain their own common-support counts and coverage fractions.

Both producer selections use identical region IDs. The runner compares their per-pollutant common valid cell counts before joining. An actual disagreement names the region, run, pollutant and both counts; completed producer outputs remain retained for direct correction and resumption. Native float64 rate aggregation and original float32 annual-mass rasters preserve their own rounding.

After positive overlap is established for the regional cohort, any individual utility polygon with zero intersection with its reporting area remains represented with zero area and null physical/priority results. Its original source binding is retained. A study with zero overlap across all four original polygons must select the correct regional run before calculation.

## Reading the comparison

Annual nitrogen and phosphorus changes are kg/year; annual sediment changes are metric tonnes/year. Change is alternative minus baseline. Avoided export is baseline minus alternative. Percent fields are percentages, so 12 means twelve percent. Zero-reference and absent-common-support states retain null percentages and their reason.

Source-water polygons can overlap, and the two published buffer levels describe related areas. Read each region independently. Adding their physical sums would count shared pixels repeatedly. The native outputs describe modeled source contributions to streams; source-water protection membership adds geographic context to those modeled contributions.

Rank 1 is the highest mean planning priority within the same buffer group. A negative rank change moves toward the higher-priority rank. A zero rank span means the rank remains the same across the declared weight selections. Different parameter profiles and land-cover selections remain explicitly attributed by the analysis.

The cohort can resume by rerunning the same command. Its source and implementation identity select the same retained cohort. The two native producers reuse their completed products or their original progress paths. Complete cohort reuse checks retained file descriptors.

The existing scientific-workspace archive includes the new module, this guide, cohort directory and both original product directories through its recursive application and workspace inventory.

## Python integration

```python
from model.utility_scenario_cohort import build, prepare

requested = {
    "title": "Utility scenario priorities",
    "source_collection_id": actual_imported_collection_id,
    "baseline_run_id": actual_baseline_run_id,
    "scenario_run_ids": actual_alternative_run_ids,  # [] for the first native reference
    "weight_grid": 4,
    "planning": existing_planning_selection,
}
# prepare returns both exact producer selections and original source bindings.
selection = prepare(workspace, requested)
# build executes both native products and retains the complete joined result.
result = build(workspace, requested)
```

The retained source bindings and producer selections reproduce the utility comparison in the receiving workspace through the same native engines.

## Utility cohorts operator desk

The four application files below register one complete desk with the existing ECSA extension host:

- operator/utility_cohort_operator.py
- operator/web/utility_cohort.mjs
- operator/web/utility_cohort.css
- operator/extensions/utility-cohorts.json

Install these files into the current application alongside this runner and guide. The current application must include the selected-model scenario analysis, model/model_selection.py, S1's selected-pollutant scenario_decisions.py and the ECSA extension registry. The registry loads the installed manifest when the original operator starts. An operator already running must restart to discover a newly installed Python provider.

The desk uses the existing workspace selector, original authenticated HTTP transport, serial action queue and verified download tickets. Its registered action is utility.cohort.build. Its navigation view and retained item kind are utility-cohorts; its state contribution is data.utility_cohorts. No shared server, application module or extension host file is replaced by this package.

### Select, calculate and reopen

1. Open Utility cohorts in the original South Carolina scientific workspace and select the imported protection-area source edition.
2. Select a completed reference run. It can be calculated immediately; optional completed alternatives on the same native grid turn the result into a scenario comparison. The run list shows the pollutants available from each actual run. Same-profile alternatives appear by default; the parameter-profile option reveals other compatible runs.
3. Enter the planning weights for the resolved shared outputs. Choose the baseline percentile or retained physical caps. The optional quarter-step grid declares every available planning ratio.
4. Use Inspect source areas to read the exact four retained polygons, their original areas, reporting intersections and count of overlapping source areas. At least one original polygon must overlap the selected study. The source geometry keeps its native intake, SYSTEM and BUFFER_FT identity.
5. Choose Build reference totals or Build scenario comparison, as shown for the current run selection. The original operation queue retains the request and its resume path. The desk preserves the same operation ID when a transport failure causes the browser to retry an unchanged submission.
6. Open the retained cohort. Filter by source area, actual run or available pollutant. A reference displays annual export, yield per valid hectare, valid area and coverage. Scenario comparisons display baseline/current masses, signed changes, avoided export, percentage state and common support. Planning priorities display selected scores, ranks and sensitivity ranges, with change columns when alternatives are present. Each source-area/run pair appears once in the priority view.
7. Select Native coverage to inspect selected cells, native valid cells, structural streams, unexpected missing and unknown stream cells, own valid hectares/mass and common native support. Those counts come from the original S1 report; the view retains pollutant-specific support and the original complete-support flag.
8. Download the complete joined CSV, exact selections, full cohort JSON and the original analysis/native-report products from the retained product groups.

The result table pages 100 retained rows at a time. Paging affects only the browser transport; the CSV and full cohort JSON contain the complete calculation. Priority display deduplicates the pollutant-repeated planning rows before paging, since each planning score belongs to its source area and run.

The browser preserves the draft, selected cohort and table filters per original workspace. Repeated state updates retain form input and update phase/task state in place. Source and run catalogues refresh when the original run state changes or Refresh choices is selected. Asynchronous reads are tied to the workspace and mounted view, so a previous workspace response cannot replace the current desk.

### Real progress and retained identity

The provider writes a lightweight operator-summary.json beside the original cohort JSON at phase boundaries and at most once every two seconds during S1 source-area callbacks. Counts identify actual completed work: native source areas per pollutant, or final joined rows. While the planning engine is active, the existing overview joins its current summary by the exact selection digest and shows its actual source, normalization and raster-block progress.

A failure retains its last actual phase/count and original error. The same original operation can resume; the source modules retain their original analysis/report reuse paths. CLI-created cohorts are also visible, using their retained cohort state when an operator summary is absent.

The provider returns a compact task result and lightweight overview summaries. Full joined rows are read only through the explicit cohort/rows views. Download links use the existing verified file ticket; the original download handler checks the requested file against its retained descriptor.

### Registered routes and source dependencies

| Route | Method | Purpose |
| --- | --- | --- |
| /api/utility-cohorts/catalog | GET | Actual sources, completed native run availability and retained cohorts |
| /api/utility-cohorts/preview | POST | Exact source-bound selection preparation and original polygon areas |
| /api/utility-cohorts/status | GET | Lightweight retained phase for one cohort |
| /api/utility-cohorts/cohort | GET | Reopen source bindings, normalization, product references and verified download links |
| /api/utility-cohorts/rows | GET | Filtered physical, native coverage or deduplicated priority rows |

The rows endpoint accepts `view=physical`, `view=priority` or `view=coverage`. Reference totals and full comparisons use the same retained source/run/pollutant filters and downloads. Historical cohorts retain their saved values; when a historical joined row predates the additional native-coverage fields, its original native report remains available in the product downloads.

GET calls use the original workspace query parameter. The preview POST body contains workspace and selection. Queued actions use the original /api/actions endpoint with workspace, action, payload.selection and operation_id.

The utility cohort uses the existing model_selection.common_comparison_outputs contract. Its returned tuple is authoritative. Both producers receive the same comparison scope; original runs retain their additional native outputs. Existing complete three-pollutant analyses keep their original calculation identity in the selected-model engine. A new utility runner edition records its current source hashes in the cohort implementation identity, while earlier saved cohorts remain available for reopen and download.

The current S1 producer computes annual physical masses from native per-hectare outputs using the actual affine pixel area once. The planning engine consumes retained annual-mass artifacts. The joined table checks their common support and preserves their source-specific rounding.

Original scientific source references are retained in the first sections of this guide and in both producers' own records. Current integration source contracts were read from the ECSA registry, S1's selected-model producer and the model-selection implementation; the installed manifest binds their original function interfaces directly.
