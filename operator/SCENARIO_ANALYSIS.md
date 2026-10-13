# Fixed-scale scenario and planning sensitivity

The scenario analysis consumes the completed native runs already selected in the Upper Savannah workspace. It keeps annual nitrogen, phosphorus and sediment quantities in their physical units and quantifies how the separate planning index responds to its declared weights.

## Use the existing workspace

From the product root:

    python -B -m model.scenario_cli --workspace /absolute/study /absolute/analysis-selection.json

The same operation is callable as:

    from model.scenario_analysis import analyze
    result = analyze(workspace, selection)

The operator action is scenario.analyze; its Workspace adapter is analyze_scenarios(selection). Reopening the same saved selection reuses the completed result and its retained artifacts.

A selection contains baseline_run_id and scenario_run_ids, referring to the complete original run IDs. It may also contain title, weights, caps or percentile, weight_sets and zones. Select the actual baseline and alternatives from the workspace. The operation reads their physical artifacts and uses their retained grid, reporting mask, scenario and profile identities.

Every weights object names nitrogen_export, phosphorus_export and sediment_export with finite nonnegative weights and a positive sum. The main set has ID selected. Additional explicit sets are objects with id, title and weights. Their IDs must be unique, portable names. The index normalizes the weights by their sum; increasing every weight by the same factor leaves the decision unchanged.

Explicit caps name the shared native pollutants, or all three original keys, in kg/pixel/year for nitrogen and phosphorus, and metric_tonnes/pixel/year for sediment. Pass the caps from an existing selected delivery to reuse its exact normalization. When caps are omitted, percentile defaults to 95 and is evaluated once over the baseline's valid positive reporting pixels. The exact percentile uses linear interpolation between sorted observations. A disk-backed partition keeps the operation usable for a basin-sized grid.

## Selected native outputs and immediate baseline analysis

The analysis consumes the current native model-selection contract in model/model_selection.py. A completed NDR run contributes nitrogen and phosphorus, a completed SDR run contributes sediment, and a completed combined run contributes all three. The selected runs must share at least one completed native model, the same retained grid and reporting mask, and the same InVEST version.

The resolved comparison_pollutants is the ordered intersection of the original native output names across every selected run. Physical tables, paired changes, difference rasters and Pareto comparisons all use that same cohort-wide intersection. A native output outside the intersection remains available in its original run. The analysis record includes each run's original model_scope and the full-model status of the compared cohort.

Omit scenario_run_ids or pass an empty list to retain baseline totals, geographic priorities and weight sensitivity immediately. Add actual completed alternatives in a subsequent selected analysis. The original baseline run and its retained files are reused.

Every weights object still names all three established artifact keys. With omitted weights, the default is 1 for each shared output and 0 for the other outputs. Explicit positive weight on an output outside the cohort is rejected before raster processing. For example, an NDR comparison uses nitrogen_export and phosphorus_export with sediment_export set to 0. Additional named weight sets follow the same rule. Physical tables omit unselected pollutants; they do not convert an unavailable quantity into a zero.

Explicit caps may name exactly the shared pollutants or all three keys from an existing full-model consumer. Every supplied cap must be finite and nonnegative; only the shared pollutants enter normalization. Cap units retain kg/pixel/year for nitrogen/phosphorus and metric_tonnes/pixel/year for sediment. In the operator, inactive weights are disabled at zero and the cap editor shows the shared outputs.

The full-three-pollutant algorithm identifier, input binding, selection hashing and numerical operations are preserved. Previously completed full analyses reopen through their existing IDs and original summary bytes. Partial-model comparisons use fixed-reference-selected-model-common-support-v1. Newly produced summaries carry comparison_pollutants and model_scope, while earlier retained summaries remain readable.

The current model-selection source is [70CB's complete native-model source](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JJQ2JBX). It belongs in the cumulative application before a partial-model analysis. Full legacy workspaces remain supported. Current actual-resolution raster handling comes from [7F24's composed native-grid source](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C88M8KM55).

## Source-bound geography

The full reporting area is always included as region reporting_area. Each optional zone names id, source_collection_id and source_id. It may select a native layer and exact where filters, provide a title, and define buffer_m in the selected projected metre CRS.

A polygon zone is the union of the selected original features, clipped to the reporting area. A line or point zone needs an explicit positive buffer_m; that buffer is retained in the result. Source URI, vintage, hash, selection and original scope accompany every region. Reporting area, source-water catchment, legal water classification and proximity context remain distinct meanings.

Set map_family to critical_drinking_water or high_quality_waters when a source-defined zone belongs to that family. Assign the same rank_group only to zones intended to be compared directly, such as utility catchments at the same reporting level. A missing rank_group retains all quantitative results without inserting unlike geographies into one ranking. Zones may overlap. Independent zone totals are not summed as a basin mass balance.

The retained regions.gpkg exports the selected, clipped study geographies with their original source bindings and declared buffers.

## Live calculation progress and continuation

The existing operator overview reads lightweight summary.json updates while the analysis works. The source phase reports the actual annual-mass files read. Normalization counts the baseline raster blocks and then the positive-cell capture passes needed for the exact caps. Before those positive counts establish the full number of passes, the denominator is null. Explicit physical caps report their actual checked cap count instead.

The comparison phase reports completed raster blocks against the original raster's exact block count. Every block completes the selected runs, physical comparisons and planning weights before the count advances. Export reports the actual retained raster, geography and CSV file count. The percentage describes the current phase and its stated unit; it is not an estimated percentage of total job time.

Updates write summary.json approximately every two seconds and at phase boundaries. The full quantitative analysis.json is written at the retained operation checkpoints. The complete record is published before the overview exposes complete, so a completed detail view can open the actual result immediately.

summary.progress contains phase, label, completed, total, unit, percent, elapsed_seconds, phase_elapsed_seconds, updated_at and detail. Unknown counts or denominators are null. The completion record retains the actual comparison block count and the number of exported files. On an error, state becomes failed and progress retains the last real phase and completed count; the existing Operations panel supplies the original continuation. Retrying the same selection reuses its analysis ID and restarts the unfinished computation against the same selected sources. A completed analysis reopens its retained artifacts.

If execution ends between publishing the complete record and its lightweight summary, reopening reproduces that exact declared summary from the completed record. The calculation, selected inputs, fixed normalization and physical output identities remain unchanged.

## Physical comparisons

For each pollutant, all selected runs are evaluated on the same intersection of valid cells in the reporting mask. Each region uses pixel-centre selection. The result separately retains each run's own valid-cell total and its common-support total, plus the corresponding coverage.

The existing native adapter has already converted the selected InVEST outputs into per-pixel annual mass. This operation sums those retained pixel masses directly. It never applies the 0.09-hectare conversion again.

For every region, run and pollutant, physical retains:

- own_sum and valid_cells for that run's own usable reporting cells;
- common_sum, common_valid_cells and common_coverage_fraction for the support shared by every selected run;
- baseline_common_sum, signed change and percent_change;
- positive increase_sum and positive decrease_sum, with the number of increasing, decreasing and unchanged cells;
- common_area_ha and mean_mass_per_ha.

Signed change is alternative minus baseline. The percent_change field is 100 times relative change, not a fraction. A zero reference produces a null percentage with status both_zero or zero_reference. No common cells produces null mass comparisons with no_common_cells. Physical nitrogen and phosphorus totals use kg/year; sediment totals use metric_tonnes/year.

The pairwise table includes each unordered selected pair once, in selection order, with to_run minus from_run as its direction. It uses the same common support as the baseline comparison. Physical differences are also retained as GeoTIFFs on that common support.

Comparison attribution follows the selected scenario and profile identities. Land-cover alternatives with the same profile can supply future map families. Profile experiments are labeled parameter_sensitivity, and changes to both profile and scenario are labeled mixed. Parameter changes are retained by native NDR/SDR field; a changed biophysical table retains its exact original table hashes. The analysis does not assign a mixed result to one cause.

## Fixed normalization and sensitivity

Each pollutant's cap is fixed before evaluating alternatives. An alternative is never renormalized against its own export distribution. For a pixel, the planning score is the sum of normalized weight times clip(annual mass / fixed baseline cap, 0, 1).

Every selected weight set uses the same usable pixel support: the intersection of all pollutants with any positive weight across all selected runs. This prevents changing a weight from changing the denominator or geographic coverage. A pollutant that is zero throughout contributes zero. If the reference cap is zero but an alternative introduces positive export, select a positive physical cap for that pollutant so the planning scale is explicit.

The selected-weight priority raster is retained for every run. A separate weight_spread raster gives the per-pixel maximum minus minimum score over the declared weight sets. This spread measures decision-weight sensitivity; the physical model outputs stay unchanged.

The priority table supplies the region mean, minimum and maximum score for each run and weight set, coverage, and descending rank within its explicit rank_group. Exact ties use competition ranks. It also supplies baseline_mean, score_change, baseline_rank and rank_change. A negative rank_change means that the region moved toward higher relative export priority.

The sensitivity table gives the minimum, maximum and range of a region's mean score across the selected weight sets, and its best/worst rank and rank span. The range of region means is distinct from the range measured separately at every raster cell.

Physical Pareto selection considers completed runs on the baseline's same profile with usable quantities for every pollutant in the cohort's native-output intersection. A selection dominates another when it has lower or equal export for every pollutant and strictly lower export for at least one. The retained non_dominated_run_ids preserve tradeoffs between pollutants without adding kg of nutrients to tonnes of sediment or silently choosing a price for either.

## Retained result and integration

The output directory is analyses/<analysis-id>. Its full record is analysis.json, schema upstate.scenario-analysis/v1. The complete record has state complete and includes:

- title, selection, baseline_run_id, run_ids, grid_id, runs and input_binding;
- normalization, coverage, regions, physical, pairs, priority, sensitivity and pareto;
- source_artifacts for the original selected run rasters;
- map_families with the original seven role names and explicit availability for outputs outside a partial native cohort;
- files with relative path, bytes and sha256 for every generated deliverable.

The files collection includes physical_csv, pairwise_csv, priority_csv, sensitivity_csv, regions_gpkg, summary_json, priority_<run-id>, weight_spread_<run-id> and delta_<run-id>_<pollutant>. Current physical map families reference the existing workspace artifacts; future map families reference same-profile land-cover difference files. All other profile and mixed differences remain directly downloadable for their explicit experiment.

The function response adds analysis_artifact with the relative path, bytes and hash of analysis.json. A record cannot contain its own hash; this descriptor is returned after saving. The lightweight summary.json supports the operator's overview without repeatedly loading the quantitative tables.

The original operation queue can call workspace.analyze_scenarios(selection), the overview can list analyses/*/summary.json, and the detail route can read analyses/<id>/analysis.json. Existing descriptor-based downloads resolve files relative to that analysis directory. The result can feed the maintained paired-raster watershed decision report directly; this module adds no competing narrative report.

## Original source interfaces

This implementation follows the maintained product APIs in model/workspace.py, model/common.py, model/native.py and model/rasters.py. Source intake and vector reads use the existing Workspace and Rasterio/Fiona/Shapely interfaces. The CLI and operator read those retained outputs and save the analysis in the selected scientific workspace.

Source semantics are the exact selected InVEST 3.20.0 registry outputs and the existing native adapter's retained mass artifacts. The original model guides are available at:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

The original RFP roles and geography are maintained in RFP_RESPONSE_MAP.md and the retained issuer RFP and appendix.
