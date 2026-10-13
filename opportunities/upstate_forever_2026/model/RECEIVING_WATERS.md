# Receiving-water plans and physical priorities

This component turns retained source-water and designated-water features into explicit contributing-land selections and produces water-specific priorities from the existing InVEST study. It is additive to the original scientific workspace and composes with the shared utility-focus receptor profile and source designation compiler.

## Workflow and interfaces

Run from opportunities/upstate_forever_2026 in the existing native GIS environment.

1. Import the original vector sources through Workspace.import_sources as usual.
2. Compile the receiving-water selection with source_tools.receiving_water_catalog.compile_catalog, or select original source records directly.
3. Call model.receiving_waters.prepare(workspace, selection). Planning is independent of numerical model completion.
4. Call model.receiving_waters.analyze(workspace, analysis_selection) after the selected baseline and alternatives have completed.
5. Call delivery_layers(workspace, analysis_id) for distinct family rasters, original physical quantities and summary files.

The existing ASTRA-RECEPTOR12 utility-focus selection can be used directly with prepare_receptor_spec(workspace, receptor_spec, grid_id=prepared_grid_id). The adapter resolves every original HUC anchor to its retained native polygon identity, preserves the complete original utility selection and source reference, and then creates an ordinary receiving-water plan.

## Source plan selection

Required top-level fields are title and receptors. analysis_crs defaults to EPSG:5070. It must be a projected CRS measured in metres.

The catchments record is required only if a receptor uses upstream_huc. It contains source_collection_id, source_id, optional layer/where/feature_ids, and optional id_field/downstream_field defaulting to huc12/tohuc. Field resolution preserves the actual original field spelling and rejects ambiguity. The original network remains in plan.network with source attributes, native feature IDs, retained downstream values, external exits and terminal markers.

Each receptors item contains:

| Field | Meaning |
| --- | --- |
| id | Unique 1-128 character identifier using letters, digits, periods, underscores and hyphens |
| title | Source-water, designated reach or published area name |
| family | critical_drinking_water or high_quality_waters |
| source | source_collection_id and source_id, with optional layer, exact equality where, and original native feature_ids |
| relation | Explicit method and nonempty source relationship rationale |
| classification | Original designation, status, vintage and rule interpretation retained as JSON |
| metadata | Additional source context retained as JSON |

The source feature_ids refer to native vector feature identities, while source where compares exact original attribute values. They are separate selectors and can be used together.

A plan reads each retained source body and layer once. It indexes native feature IDs and reuses each selected geometry transformation across receptors. Exact source filters run before geometry validation, so an unselected source feature cannot change a selected receptor's behavior. The cache belongs to one preparation call; subsequent calls verify their original source bodies again.

| Relationship | Contribution geometry and interpretation |
| --- | --- |
| upstream_huc | Receiving HUC units and their original upstream ToHUC ancestors |
| source_area | The selected published polygon and its recorded source meaning |
| geometric_context | The selected polygon or an explicit buffer_m around source geometry |

For upstream_huc, seed_huc_ids may contain explicit original 12-digit HUC strings and requires evidence linking that selection to its source. Otherwise original receptor geometry selects intersecting HUCs. Polygon and line boundary touches are recorded separately. Points on a HUC boundary can select both adjacent units, retaining the original ambiguity. No nearest-water snapping occurs.

HUC association describes potential contributing land at the retained HUC12 scale. Whole seed units are included. Receptor position within a unit, stream junctions and reservoir retention require finer hydrologic information to resolve. Retained ToHUC cycles are reported with the actual cycle rather than silently changing the network.

source_area requires positive polygon geometry and preserves the published boundary. geometric_context permits an explicitly selected nonnegative buffer_m; its output retains the geographic method.

## Analysis selection and physical quantities

analysis_selection contains plan_id, baseline_run_id, optional alternative_run_ids, optional quantity_scope, optional weights and optional normalization.

The analysis records its actual selected pollutants. By default it selects the recognized quantities present in the completed baseline. An explicit pollutants array can select nitrogen_export, phosphorus_export and/or sediment_export; every selected alternative must contain those exact quantities. This supports a completed NDR-only or SDR-only source-native run while the other model's inputs are being prepared. Missing quantities are absent from the numerical results.

All selected runs must be complete on the same grid. Future alternatives must retain the baseline scientific profile and select an explicit different land-cover scenario. Parameter sensitivity belongs in the shared experiment workflow.

quantity_scope is reporting by default. It reads the existing reporting-masked kg/pixel/year nutrient and metric_tonnes/pixel/year sediment artifacts with multiplier 1. Select model_domain to read retained original InVEST 3.20 native density outputs over the full modeled domain. Those densities are multiplied by the original 30 m cell area, 0.09 ha, exactly once. Original file descriptors, source units and applied factors remain in the analysis.

All calculations stream 256-cell raster windows. Inputs retain their original valid-data masks. A valid zero remains zero; absent pixels remain absent. Differences use the intersection of valid baseline and alternative pixels. Physical totals remain kg/year for nitrogen and phosphorus and metric_tonnes/year for sediment.

Every receptor receives its own quantities and rasters. The two family_union subjects geometrically unite their member contribution masks, so each land pixel enters its family total once. Nested or overlapping receptor totals remain available individually.

## Priority normalization and alternatives

Default weights are equal across the selected physical quantities. A supplied weights record must name those exact selected pollutant keys with finite nonnegative values and at least one positive weight.

The baseline_max normalization streams the selected quantity domain once and uses each pollutant's maximum valid baseline value as a fixed cap. All receptors, family unions and alternatives use the same caps and weights. Explicit normalization accepts method=explicit, caps for the selected pollutants in physical mass-per-pixel units, and a reference explaining the selected caps. A positively weighted quantity needs a positive cap.

For each selected valid pixel, current priority is:

    sum(weight[p] * clip(current[p] / cap[p], 0, 1)) / sum(weight)

For every alternative the component also produces:

- Its current export priority.
- Increased-export priority from positive alternative-minus-baseline components.
- Avoided-export priority from positive baseline-minus-alternative components.
- Separate signed physical nitrogen, phosphorus and sediment difference rasters.
- Paired physical sums, valid-data coverage, increased quantities and avoided quantities.

A change in one pollutant does not cancel an opposite change in another pollutant before the increased and avoided quantities are recorded. Physical quantities and dimensionless priorities remain distinct outputs.

## Saved outputs and integration

Plans are retained beneath receiving-water-plans/<plan_id>/ with original receptor and contribution GeoPackages. Analyses are retained beneath receiving-water-analyses/<analysis_id>/ with:

- analysis.json containing source identities, original run selections, conversion factors, normalization, per-water and family summaries.
- geographies/<geometry_id>/ containing reusable masks, current priorities, each alternative's priorities and physical changes.
- water-quantities.csv containing every receptor and family-union physical quantity with units and coverage.
- receiving-waters.gpkg containing editable contribution polygons and attributed physical summaries.

Identical contribution geometries share one computation within an analysis. Completed geometry summaries checkpoint independently; rerunning the same analysis resumes from those completed results.

delivery_layers returns artifact_root plus families keyed critical_drinking_water and high_quality_waters. Each family contains current_priority, contribution_mask, baseline_physical and alternatives. Each alternative contains current_priority, increased_export_priority, avoided_export_priority, physical_changes and metrics. File descriptors are relative to artifact_root; they can be copied with the existing delivery file utilities and used by current map/viewer integration.

list_plans and list_analyses enumerate saved records. inspect_plan and inspect verify original record identities and file contents.

The long analysis owns its per-analysis .analysis.lock. Add these locks to the portable backup's existing lock collection. prepare acquires the workspace lock internally for its brief final write; callers should invoke it directly rather than acquiring the same lock again.

## Native acceptance operation

Use an existing retained network to prepare the shared utility-focus profile. Confirm original anchor IDs and upstream memberships for ARJWS and PRWD against the retained source table. On an existing complete baseline and land-cover alternative, run the analysis and compare one reported pollutant sum with the selected original raster pixels, checking the quantity_scope multiplier and paired valid-data count. The existing family delivery join then has a physical raster and attributed polygon source to render.

Original implementation interfaces were read from the retained complete scientific application at source 7c4223a111581935b494d5ac4b9357ef86992d67 and the current 18-file operator source carrier. Utility-focus profile compatibility follows the complete ASTRA-RECEPTOR12 source at 041395c80399b26b3f22e7a46ec83ab1904a0c6b, Slack Canvas F0C8TDU5RRA.


## Command-line operation

The additive model.receiving_water_cli module uses the existing Workspace:

    python -B -m model.receiving_water_cli --workspace STUDY prepare SOURCE_PLAN.json
    python -B -m model.receiving_water_cli --workspace STUDY profile UTILITY_PROFILE.json --grid-id GRID_ID
    python -B -m model.receiving_water_cli --workspace STUDY analyze ANALYSIS_SELECTION.json
    python -B -m model.receiving_water_cli --workspace STUDY export ANALYSIS_ID OUTPUT_DIRECTORY

The build command accepts the normal baseline_run_id and scenario_run_ids plus receiving_waters containing exactly one of analysis_id, plan_id, plan, or receptor_spec. It resolves that original selection and completes the analysis; --output-dir additionally exports the full source plan and quantitative files.

    python -B -m model.receiving_water_cli --workspace STUDY build DELIVERY_SELECTION.json --output-dir OUTPUT_DIRECTORY

## Normal delivery and operator

model.receiving_water_delivery.collect resolves the same nested receiving_waters request. Existing delivery integration uses its recorded current pollutant caps and weights for the water-specific maps. Explicit receiving-water normalization can override those settings through the selected request. attach_state retains all copied files; apply_map_specs installs the two configured protection-family rasters; report_section adds actual per-water quantities to the scientific report; extend_assets includes the complete source plan and analysis in the regular project package.

operator.receiving_water_actions.ReceivingWaterActions uses the existing task queue, workspace identity, interruption/resume and authenticated downloads. Actions are receiving.water.plan, receiving.water.profile, receiving.water.analyze and receiving.water.catalog. The catalog action accepts the source compiler request under selection plus prepare_vintage=effective or proposed. It preserves the compiled source catalog and prepares the chosen nonempty source plan.

Read operations are catalog, plan, analysis and designation-catalog. snapshot adds receiving_water_plans, receiving_water_analyses and receiving_water_catalogs to the existing operator state. Browser reads verify record identities and use the operator's existing file tickets, whose original byte checks occur when downloading; they do not rehash all rasters on every progress refresh.

The complete browser and additive current-source installer are supplied by the companion receiving-water workbench. The installer composes the actual operator/server, browser navigation and delivery methods while preserving other installed scientific components.
