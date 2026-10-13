# Conservation combinations

The operator compares native model runs for combinations of retained land-cover actions. It retains every case under the existing scientific workspace and reports how each action contributes to the combined change in annual pollutant export.

## Install and open

Receive the complete component into a source directory, then install it into an application that already contains the ECSA extension host and selected-model scientific core:

```bash
python -B operator/install_native_interactions.py --application /path/to/application --source /path/to/component
```

Restart the existing operator server after installing. Open **Conservation combinations** from the workspace navigation. The component uses the application's existing task queue, operation details and workspace selection. Receive all ten component files and the shared `model/native_versions.py` dependency together. An existing compatible shared resolver is preserved and recorded by its actual hash.

The installer validates Python and descriptor syntax, preserves the exact installed preimages, records its replacement intent before writing, and resumes interrupted writes from that intent. Repeating an unchanged installation returns the retained installation record.

## Define the experiment

Choose the retained baseline run and add one row for each conservation action. Each row names a saved scenario with native land-cover patches. Choose optional zero-based patch indexes to isolate specific interventions from a scenario. Leaving the field empty asks the scientific core to resolve the action relative to the baseline. With original land cover as baseline, that uses the scenario's patches. When the baseline itself has edits and an alternative retains an identical leading baseline sequence, the default uses only the remaining intervention patches. Other edited-baseline cases require explicit patch indexes. Use **Inspect saved scenario patches** to read each index's mask, source/destination classes, native filter and purpose. Preview lists the exact indexes that will be applied before saving.

Give each action a unique stable identifier. The row order is the global order in which patches are applied in every coalition. Use the move controls to make that order explicit before previewing. If actions overlap, changing their order can change the combined land cover.

Every coalition retains the baseline's project, watershed, native parameter profile and selected models. Action masks may be retained polygons or exact aligned binary rasters. Binary masks use valid one-valued cells and exclude zero and NoData; their native grid and values are checked by the application's existing scenario kernel. Vector layer and attribute filters apply only to polygon masks. The source collection records the original descriptors needed by those actions. Original scenarios remain available alongside the generated coalition scenarios.

Choose:

- **Exact attribution** to evaluate all action subsets and calculate exact Shapley contributions.
- **Permutation sampling** to evaluate the subsets visited by sampled attribution paths, using the saved seed and requested sample count. The application also includes the baseline, full combination, and standalone cases; optional pairwise diagnostics add the two-action cases.

Permutation paths govern the allocation calculation. They do not change the global order of patches within a native coalition run.

The case limit is an explicit operator control on the design size. Preview displays the actual number of distinct native cases before saving. Set it to the intended study size and provision the corresponding execution capacity.

Optional reporting zones use a retained vector source, its stable ID field and optional layer/filter. The analysis reports the watershed and requested zones separately.

## Prepare, run and resume

1. Preview the current design. Review the selected models, action order, source collections and case count.
2. Save the previewed design. The plan retains its scientific selection and case identities.
3. Select the saved plan. **Prepare cases** materializes the selected native inputs without executing them. **Run and analyze / resume** prepares and executes the remaining cases, then produces the attribution result automatically.
4. Open the operation to follow native execution. Completed retained cases are reused on resume. Prepared cases retain their saved run IDs and requested version declarations across application upgrades. New cases use the current native preparation.
5. Read the completed result in the desk. **Reanalyze completed cases** rebuilds the analysis from existing native output rasters without launching another model execution.

The plan's case table exposes the actual run ID and state for each coalition. A native error remains associated with its case so the operator can correct the cause and resume the study.

Workspace changes detach the desk's requests and preserve drafts separately for each workspace. A preview must still match the current form before it can be saved.

## Read the result

All benefits use **baseline annual export minus coalition annual export**. Positive values mean lower modeled annual export. Nitrogen and phosphorus remain in kg/year; sediment remains in metric tonnes/year. The tables keep those quantities separate.

The result uses the common valid raster support across every retained case and every selected metric, within each reporting scope. It records the actual cell count and area. A scope with no common valid cells has unavailable physical values and an explicit support status.

The result opens with the baseline export, combined export, signed annual reduction and shared reporting area for the selected pollutant and zone. A positive reduction means lower export; a negative reduction means higher export. Percent reduction is shown only when the baseline is positive. Action contribution and pair interaction tables use the original native units. The printable report includes the same decision summary for every pollutant and reporting area.

The four complete result tables provide:

- Combined benefit, sum of standalone benefits, their nonadditivity and the allocation residual.
- Each action's standalone benefit and Shapley allocation. Sampled estimates retain their permutation sampling standard error.
- Pair interactions, when requested.
- Annual export for each native coalition, with excluded annual mass and common support.

The sum of Shapley allocations is reconciled to the combined benefit. Pair effects explain two-action interactions; higher-order effects can remain in a larger combination. The native cases are the basis of these calculations.

Download the retained JSON, complete CSV tables or printable HTML report. Native GIS downloads include the common-support raster, zone-index raster and zonal action attribution GeoPackage when zones were selected. The on-screen coalition table shows the first 200 rows; CSV and JSON contain all rows.

## Scientific method

See `docs/native-interactions.md` for the native preparation, common-support calculations, exact and permutation estimators, overlap semantics and retained result schema.

## Execution progress and receiving upgrades

The scientific core commits full case snapshots at phase and failure boundaries and writes a small generation-bound progress record at most once every two seconds during a phase. The desk shows current completion counts and active case while retaining the timestamp of the detailed case snapshot. Resume reconstructs case states from the original native runs. Native case failures are retained in the scientific workspace and surface as a failed operator operation, with the first cause in its error details.

Version 1.3.0 preserves the revision 5 native process dispatcher and adds binary mask, saved-case resume and executed-model provenance support. Its installer accepts the exact published 1.0.0, 1.1.0, maintained PR3116 and 1.2.0 component members and retains their preimages when upgrading. The public openDesign handoff and registered actions/routes are unchanged.

## Parallel native runs

The saved-study controls include **Parallel native runs**, defaulting to one. This controls execution capacity while preserving the same retained scientific plan, run identities, native inputs, selected models and attribution calculation. Native workers use separate spawned processes and reopen the existing workspace; the current native stage cache coordinates identical signatures across processes. Resume inspects the original retained run states and continues unfinished cases. Keep process capacity appropriate to the actual native GIS workspace and its model worker configuration.

The running study lists each active native run and model stage, finished and reused cases, and retained native/reused stage records. Detailed case bindings can be filtered by state and paged in groups of 200 while the complete plan download preserves all bindings. Open case details remain open as progress refreshes.

## Read the executed model versions

New results retain a per-model execution table for every case. The effective version comes from a completed stage's runtime, then the observed run runtime, then a labeled historical requested-version fallback. Reused stages keep their completion time and original reuse ancestry. NDR and SDR are compared separately across all cases; a single run-level label can hide a resumed stage's original implementation.

A differing requested declaration can still describe a compatible completed case. The scientific analysis uses the recorded effective versions and preserves every declaration. The result records an explicit execution cohort when those versions differ from the original requested binding. Existing results whose requested binding is accurate retain their original IDs and outputs.

Older results without a frozen execution table continue to display their original selection. Reanalysis checks the current completed native records and selects the matching result edition. An unchanged, accurately declared historical result reopens with its original saved metadata; a different effective binding produces a separate edition. Original saved reports remain available throughout.

The result desk shows the first 200 run/model provenance rows. The printable report and combined source-table CSV contain every row, including comparison version, version source, requested version, completion time and reused origin. The original JSON retains observed stage and run versions, requested-version differences and nested reuse records.
