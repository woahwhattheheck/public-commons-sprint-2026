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

score.basis chooses context, current_export, scenario_reduction, disturbance_increase or published_method. score.scale chooses total or per_hectare for physical quantities. Published practice scores use total points and retain their original method, category, criterion contributions and prerequisite.

Current export is a modeled present-load inventory. Scenario reduction uses the positive part of baseline minus alternative. Disturbance increase uses the positive part of alternative minus baseline and supports the critical-protection question. Each scenario score selects one actual alternative_run_id; signed physical deltas remain separately available for all alternatives.

Physical weights are separate nitrogen_export, phosphorus_export and sediment_export values. They are nonnegative with at least one positive. Each quantity is normalized by an explicit saved cap or the positive-value percentile among eligible units, then clipped to 0–1 and combined by the saved weights. The default percentile is 95. All candidates are exported and zero-weight pollutants remain physically visible.

Context weights name source_water_fraction, unprotected_fraction and high_quality_context. A positive weight requires its selected source. unprotected_fraction means one minus overlap with the selected protected-source footprint; original inventory scope and legal/designation meaning travel with it. With no active context weights the score is unavailable and manual area selection remains usable. The protected-area threshold is configurable for the study purpose; restoration does not automatically exclude protected land.

The InVEST NDR/SDR comparisons describe contributions within the selected footprint in each complete scenario. Create and run a scenario whose actual change mask is the portfolio to evaluate that particular selected intervention; the original operator's plan-to-scenario bridge supports that continuation.

## Original physical quantities and geographic coverage

The pinned InVEST 3.20 NDR registry outputs n_total_export and p_surface_export are kg/hectare/year. SDR sed_export is metric tonnes/hectare/year. This module reads those original native rate files and multiplies each selected cell by its polygon-cell intersection area in hectares. The retained grid supplies its actual resolution_m and pixel_area_ha. Full 30 m cells cover 0.09 ha; full 300 m cells cover 9 ha. Boundary cells always use their actual intersection area.

This areal allocation assumes the original modeled rate is uniform inside each original native cell. It preserves the selected model resolution and avoids dropping a small parcel merely because no cell centre falls inside it. Actual projected geometry is used for areas and distances. Web Mercator and native feet sources are reprojected into the declared analysis CRS.

For every pollutant, the study retains valid native area, original structural stream omissions, unexpected missing area, total selected area and coverage fraction. Stream omissions are recognized only from original NoData plus the same-stage native stream registry. No export mass is added for them. Annual quantities aggregate valid cells; a unit containing no valid export cells keeps an unavailable mass.

Scenario deltas use the shared valid support of baseline and alternative. Shared structural stream omissions contribute only to the reported common-support coverage. Different missing-data footprints cannot silently create a load reduction. Profile differences and the exact native argument/output identities remain in the result.

The source-context and quantitative paths reuse the maintained esri_polygon parser for original Esri polygon sources. Original rings, attributes, Z/M declarations, source-array positions and recorded geometry corrections remain inspectable with the source edition.

The Upper Savannah regional product selects the required 30 m grid. Other retained source-native cases keep their declared original resolution in the saved binding and decision report. Conservation aggregation checks the native raster's actual cell size against that same retained grid and does not resample a coarser case into an apparent finer result.

## Selected NDR and SDR runs

A completed case can select NDR, SDR or both. The maintained run selection is authoritative: an omitted models field means the historical combined NDR/SDR selection; an explicit partial list selects only its named model. NDR supplies nitrogen_export and phosphorus_export. SDR supplies sediment_export. Every selected stage must retain its original argument file, native export registry and stream registry.

All candidate and portfolio records still expose the three separate pollutant rows. A baseline output omitted by its original model selection has availability: not_selected, an availability_reason identifying that run/model, and null baseline and native-coverage fields. Its known selected_area_ha remains the selected geographic area. A source-context row retains availability: unbound. These are distinct from a selected native output with zero valid-area coverage.

Each alternative carries its own availability and reason. An alternative-only native quantity keeps its value and its own coverage even when the baseline omits that pollutant. comparison_availability is modeled when both cases selected that pollutant, otherwise not_shared with comparison_availability_reason. Every delta, common quantity and common-coverage field remains null for a pollutant omitted from either case. When both outputs exist, the original common-valid-cell and shared-structural-support method applies unchanged.

The current-export score uses outputs selected in the baseline. A scenario score uses the intersection of the baseline and its chosen scoring alternative. If weights are omitted, available scoring outputs default to weight 1 and unavailable outputs to 0. An explicit positive weight requires that selected output in each scoring case. The browser keeps unavailable axes visible and inactive. Other alternative cases remain in the full physical inventory even when their model scope differs from the scoring pair.

CSV, GeoPackage, HTML and the implementation/design consumer retain these separate availability and comparison reasons. A completed partial run does not acquire invented values for its omitted model. Opening historical combined or source-context studies retains their original selection identities and exports.

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


## Published parcel practice scores and native experiment continuation

The maintained practice engine adds `score.basis="published_method"` to this
same conservation study. It binds a selected published method/category and the
actual source fields used by each criterion. Its source table can be prepared
from the original imported GIS layers through `source_tools.parcel_criteria`.
The complete rules, geometry-source choices and operator journey are in
`KEOWEE_PRIORITIES.md` and `../source_tools/PARCEL_CRITERIA.md`.

Every candidate retains its original physical quantities and geographic source
properties. Published practice scoring adds `point_score`, `point_priority`,
`score_unit="points"` and criterion components. The point record contains the
known/possible bounds, prerequisite, completed point total, method/category,
definition hash and metric-source bindings. Saved CSV and GeoPackage products
include these fields. The existing plan ID, union geometry and source references
remain authoritative.

The optimizer accepts `objective.kind="published-method"` and
`weights={"published_points":1}`. It preserves the original published score
and requires complete applicable criteria. A native export criterion also
retains its selected baseline pollutant and native coverage. See
`CONSERVATION_OPTIMIZATION.md` for exact input and result shapes.

General conservation aggregation checks the actual retained native grid. Mean
cell-mass criteria use the actual metre-based raster cell area. Current-study
tertiles retain that grid; explicit mean-cell cutoffs check their recorded
pixel-area binding, with the existing 900 m² default for that explicit-cutoff
contract. Transferring original printed source-profile bins requires a recorded
current pixel area and adaptation reference; sediment also requires the explicit
metric-tonne interpretation. The published profile's original pixel area remains
unresolved unless its retained source establishes it. Annual parcel mass and
classification inputs keep their separate units and original support.

The scenario bridge now exposes:

- `create_scenario(workspace, spec)`
- `prepare_experiment(workspace, spec)`
- `inspect_scenario(workspace, conservation_scenario_id)`
- `list_scenarios(workspace)`

A saved plan supplies the same verified `selected_union` footprint. Native run
preparation validates its complete coverage by the original model domain and
reports overlap with the reporting boundary separately. The retained coverage
record includes both original boundary descriptors, actual covered fraction,
selected/outside/reporting hectares and declared analysis CRS.

An explicit model choice must be supported by the selected grid and profile.
Omission resolves the actual common model families; the resulting full model
selection uses the maintained historical ID convention. The paired experiment
uses a matching original-landcover baseline and the exact saved portfolio
scenario. Additional profiles must support the selected models, original
land-cover classes and all scenario replacement codes. The existing experiment
queue executes the actual native cases and reopens their results. The full
contract is in `CONSERVATION_EXPERIMENTS.md`.

## Original parcel criteria, closed acreage bounds and report editions

For parcel studies, `source_tools.parcel_criteria.prepare` derives a retained criterion table from the selected original source layers. New operations default to `settings.spatial_criteria_basis="whole_original_parcel"`: hydric soils, sensitive riparian area, stream lengths and the other spatial parcel criteria use the complete original parcel. An explicit `"reporting_parcel"` selection records the reporting-boundary adaptation. Full parcel size and protected-land interpretation retain their own original geometry; land-cover and floodplain-development choices remain independently recorded. Native export and portfolio mass still use their original reporting support.

The table binds its exact parcel source, native ID/layer/filter, reporting boundary or native grid, original source bodies, `geometry_context` and `metric_geometry`. Reusing it in a point study checks that geometry identity. Equal parcel ID text from another source edition cannot silently reuse a different area's measurements. See [the geometry contract](../source_tools/PARCEL_CRITERIA_GEOMETRY.md) and [source builder](../source_tools/PARCEL_CRITERIA.md).

A hydric or sensitive-riparian acreage interval has closed lower and upper endpoints. The lower endpoint is the positively mapped area; the upper endpoint adds the part of the selected parcel geometry unresolved by actual source certainty coverage. Fully hydric and fully nonhydric map units can establish certainty under the default hydric interpretation; mixed or unknown units keep unresolved area. The canonical acreage remains null while the interval is nondegenerate. A criterion receives exact points when every value in that interval receives the same published contribution. The practice total still requires all contributions to be determined and its prerequisite to be true.

The source rules are Lake Keowee Watershed Plan (2020), Table 31 and Appendix D: sensitive riparian acreage on printed page 139, hydric acreage on page 140 and full parcel size on page 142. The published sensitive-riparian footprint combines the retained variable riparian layer with the surface-water buffer. An observed component contributes a lower limit while a missing component remains part of the upper limit. [Original plan](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/WPLakeKeowee.pdf). See [acreage intervals](../source_tools/PARCEL_CRITERIA_INTERVALS.md) for exact data and scoring fields.

Original soils and one-percent floodplain acquisition is available through `source_tools.soil_floodplain_sources`. A selected study queries its reporting geometry together with full original selected-parcel extensions. The capture reuses compatible original soil geometry, retains each source family independently, imports the original and criterion editions, and returns `parcel_criteria_selection` for the existing builder. Original HTTP bodies, component attributes, native IDs, query geometry and certainty coverage stay with those editions. See [source acquisition](../source_tools/SOIL_FLOODPLAIN_SOURCES.md).

The existing export command now creates a presentation edition over verified saved candidates, geometries and selected plan IDs. It keeps the original study and plan artifacts intact. HTML, CSV and GeoPackage expose full and reporting acreage, prerequisite state, exact or bounded points, criterion geometry and source references. Supplemental criterion/value tables, original criterion bytes and a source register accompany `presentation.json`; its file descriptors are bound by the ordinary portable export manifest. Reopening an export reads the original measurements and saved decision. [Report contract](CONSERVATION_REPORTS.md).

## Literal source-profile alternatives in portable reports

The retained Lake Keowee source profile preserves original numeric bins, including
printed gaps and overlaps. The scorer combines that profile with closed acreage
intervals by evaluating every original boundary and each region between boundaries.
A gap retains the profile's unresolved alternatives; an overlap retains all matching
classes. The exact point alternatives are `score_options`, while `known_points`
and `possible_points` remain their minimum and maximum. An intermediate integer
does not become attainable merely because it lies between those limits.

Each saved candidate keeps its source-profile identity, original criterion evidence,
typed observations, raw native classification inputs and current-grid transfer
interpretation. A closed geometry interval remains a bounded measurement even when
all its possible classifications give one exact contribution. An exact practice
total still requires its prerequisite to be true. Scalar evaluation probes are
internal classification boundaries, never source observations.

Presentation version 3 displays those alternatives and literal class states in the
HTML report. It carries the same options into flat CSV/GeoPackage fields and full
criterion CSV/JSON records. Source-profile identities and native classification
bindings remain in the portable source register. The original completed candidate
and selected parcel geometry stay authoritative.
