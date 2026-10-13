# Conservation studies and spatial portfolios

This module extends the original Upper Savannah Workspace with reusable land-priority studies, original-source context inventories and explicit spatial portfolios. The operator uses the same functions as the CLI. The selected original files, geographic relation, rule thresholds, score settings and model runs remain with each saved version.

## Start with the actual retained boundaries

A source-context study can run before a numerical model result is selected. Choose an original planning-unit source, the reporting boundary and the relevant source-water, protected-land or classified-water contexts. The default analysis CRS is EPSG:5070; original source coordinates and attributes remain retained. Set unit_type and planning_unit_label to the actual input: watershed, parcel or management unit.

The resulting table shows original unit IDs, full and reporting-area hectares, actual selected-source overlap, eligibility reasons and an optional explicit context score. Numerical pollutant fields remain unavailable until a completed original model run is bound to a new study.

A study specification uses these fields:

- title; mode: source_context or native_model; purpose: screening, protection or restoration.
- unit_type: parcel, watershed or management_unit; planning_unit_label.
- parcels: the original planning-unit selection. The historic field name is shared by all three actual unit types.
- Each source selection supplies source_collection_id and source_id. Optional layer, id_field, label_field and exact typed where select the native source. Context selections also carry reference, meaning, relation and an explicit buffer_m when appropriate.
- In source_context mode, reporting_area selects the original boundary and analysis_crs defaults to EPSG:5070.
- In native_model mode, baseline_run_id selects a completed native run; alternative_run_ids lists any distinct completed alternatives on the same original grid.
- contexts may select protected_lands, drinking_water and high_quality_waters. Source-water area coverage uses a polygon or an explicitly declared geometric buffer. A four-HUC utility focus remains that geographic context. The classification source retains its provisional/authoritative edition and rule reference.
- rules contains minimum_coverage_fraction (default 0.95 for native quantities), maximum_protected_fraction (default 1), minimum_source_water_fraction (default 0), minimum_area_ha (default 0), require_high_quality_context (default false) and excluded_ids.
- costs optionally selects an original table with id_column, value_column, currency and reference. Blank original costs remain unknown. Values cover the entire original unit.

## Scoring and purpose

score.basis chooses context, current_export, scenario_reduction or disturbance_increase. score.scale chooses total or per_hectare for physical quantities.

Current export is a modeled present-load inventory. Scenario reduction uses the positive part of baseline minus alternative. Disturbance increase uses the positive part of alternative minus baseline and supports the critical-protection question. Each scenario score selects one actual alternative_run_id; signed physical deltas remain separately available for all alternatives.

Physical weights are separate nitrogen_export, phosphorus_export and sediment_export values. They are nonnegative with at least one positive. Each quantity is normalized by an explicit saved cap or the positive-value percentile among eligible units, then clipped to 0–1 and combined by the saved weights. The default percentile is 95. All candidates are exported and zero-weight pollutants remain physically visible.

Context weights name source_water_fraction, unprotected_fraction and high_quality_context. A positive weight requires its selected source. unprotected_fraction means one minus overlap with the selected protected-source footprint; original inventory scope and legal/designation meaning travel with it. With no active context weights the score is unavailable and manual area selection remains usable. The protected-area threshold is configurable for the study purpose; restoration does not automatically exclude protected land.

The InVEST NDR/SDR comparisons describe contributions within the selected footprint in each complete scenario. Create and run a scenario whose actual change mask is the portfolio to evaluate that particular selected intervention; the original operator's plan-to-scenario bridge supports that continuation.

## Original physical quantities and geographic coverage

The pinned InVEST 3.20 NDR registry outputs n_total_export and p_surface_export are kg/hectare/year. SDR sed_export is metric tonnes/hectare/year. This module reads those original native rate files and multiplies each selected cell by its polygon-cell intersection area in hectares. Full 30 m cells cover 0.09 ha; boundary cells use their actual intersection area.

This areal allocation assumes the original modeled rate is uniform inside its 30 m cell. It preserves the model grid and avoids dropping a small parcel merely because no cell centre falls inside it. Actual projected geometry is used for areas and distances. Web Mercator and native feet sources are reprojected into the declared analysis CRS.

For every pollutant, the study retains valid native area, original structural stream omissions, unexpected missing area, total selected area and coverage fraction. Stream omissions are recognized only from original NoData plus the same-stage native stream registry. No export mass is added for them. Annual quantities aggregate valid cells; a unit containing no valid export cells keeps an unavailable mass.

Scenario deltas use the shared valid support of baseline and alternative. Shared structural stream omissions contribute only to the reported common-support coverage. Different missing-data footprints cannot silently create a load reduction. Profile differences and the exact native argument/output identities remain in the result.

The source-context and quantitative paths reuse the maintained esri_polygon parser for original Esri polygon sources. Original rings, attributes, Z/M declarations, source-array positions and recorded geometry corrections remain inspectable with the source edition.

## Portfolios

save_plan selects one completed study and a title.

Manual mode takes selected_ids from the original candidate table. Ranked mode applies the selected ordering: score, score_per_hectare, score_per_cost or area. Ranked area explicitly orders by reporting hectares. The ranked algorithm follows that deterministic order, skips fully covered footprints and checks each prospective union against the chosen limits. Original ID breaks ties. It is a transparent greedy selection.

limits may specify maximum_area_ha, maximum_cost and maximum_parcels. area_basis defaults to whole_units: the original full-unit union governs the area budget. Choosing reporting uses the clipped reporting-area union instead. Known costs always refer to full original units. A cost budget or cost-based ordering requires the retained cost table; an unknown cost cannot pass a monetary budget.

For any selected set, physical quantities and context areas are recomputed on the reporting-area union. The output separately exposes full-unit union area, reporting union area, sums of individual areas and overlap area. Overlapping native parcel identities remain distinct while spatial mass is counted once.

The plan's files.footprint descriptor is relative to Workspace.root and identifies the selected_union layer of its geodata.gpkg. This is the exact retained geographic input for a new explicit land-cover scenario.

## CLI

Run from the original application directory:

    python -B -m model.conservation_cli --workspace /absolute/study overview
    python -B -m model.conservation_cli --workspace /absolute/study build context-selection.json
    python -B -m model.conservation_cli --workspace /absolute/study inspect STUDY_ID
    python -B -m model.conservation_cli --workspace /absolute/study selection STUDY_ID --output successor.json
    python -B -m model.conservation_cli --workspace /absolute/study plan-save portfolio-selection.json
    python -B -m model.conservation_cli --workspace /absolute/study plan-inspect PLAN_ID
    python -B -m model.conservation_cli --workspace /absolute/study export STUDY_ID --plan-id PLAN_ID

prepare retains a selection without computing; build accepts either a retained study ID or a selection file and resumes retained candidate checkpoints. Editing a selection creates a new identity when its source, run, rules or purpose change. A failed operation retains its exact error and completed per-unit work. Reopen the same original Workspace and repeat build with the same ID to continue.

## Exports and receiving

A completed study includes the full candidate JSON and CSV, original selections and method settings, both full-unit and reporting-footprint GeoPackage layers, retained geometry, and a readable HTML decision report. A portfolio adds selected rows, selection rationale, union geometry and recomputed quantities. The packet ZIP contains an index.html entrypoint, editable GIS and tabular files, study/portfolio JSON, and a member hash manifest.

The existing whole-Workspace backup includes these folders and the additive application code automatically. Restore that full archive to continue source import, new study versions and actual model runs. The smaller decision packet is the portable inspection and editable-data delivery.

## Primary output contracts

- NDR 3.20: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- SDR 3.20: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Original upstream parser: source/capture_upstream_network.py:esri_polygon.
