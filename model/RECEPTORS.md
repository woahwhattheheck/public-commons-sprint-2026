# Contributing land and source-water scenario comparisons

This workflow follows retained original HUC12 downstream links to locate land contributing to selected water-protection areas. It produces editable contributing-area polygons, the full membership table, physical nutrient and sediment quantities for every selected scenario, and a printable HTML report. The delivery integration also narrows the critical-drinking-water and high-quality-water priority maps to the selected upstream-connected land.

## Selected native models

The standalone inventory also consumes completed NDR-only or SDR-only runs.
It compares the pollutants retained by every selected baseline/alternative run:
NDR provides nitrogen and phosphorus, SDR provides sediment, and a combined
cohort provides all three. The report names the shared outputs; inventory.json
retains `pollutants` plus each run's `run_pollutants` availability. Select a
cohort sharing at least one retained pollutant. Every comparison keeps its
existing physical mass units and common valid pixels.

A complete seven-family GIS delivery continues to use both model stages. The
standalone inventory and experiment report can receive earlier completed
nutrient or sediment cohorts while the other regional inputs are prepared.
Older complete inventory records can be consumed by deriving their pollutant
names from `scenario_exports`.

## Producing-model bindings and saved editions

Install `model/receptor_execution.py` alongside the original receptor modules
and the maintained `model/native_versions.py` and `model/model_selection.py`.
The cumulative application and its normal portable archive retain these files.

Every new inventory resolves the common outputs from the selected completed
model scopes. An output left over from an unselected model is excluded. The
shared execution contract then compares each producing model's version across
the full cohort. A completed model stage takes precedence over the run's last
observed runtime; observed-run and requested-legacy fallbacks retain their
explicit source labels. NDR and SDR may have different versions when the NDR
version is consistent across the selected runs and the SDR version is also
consistent. An incompatible producing model stops that comparison before
geographic aggregation.

The source binding retains each original run selection, model scope, completed
stage timestamp and reuse provenance, together with each compared raster's
path, byte length, SHA-256 and physical mass units. `native-execution.json`,
the readable report table and sixteen additional scenario CSV columns carry
this information with the quantities.

New result identities include the execution binding and product revision.
Repeating an unchanged selection reopens its current edition. If the producing
metadata or retained output descriptors change, the same selection creates a
separate edition. Original saved inventories remain readable at their original
IDs. Collecting a current edition re-aggregates the retained rasters and leaves
native model execution with the existing run service. The optional seven-map
delivery uses this same binding before its completed-result cache lookup.

`comparison_pollutants` is an optional array in the direct CLI selection,
restricted to outputs common to all selected completed runs. The experiment
adapter supplies its complete cross-profile cohort through this field, so a
group with extra model outputs uses the same pollutants as the other selected
profiles. A direct selection without this field includes every common output.

## Use an existing native study

Run from `opportunities/upstate_forever_2026` with the study's existing native runtime. Select a completed baseline and one or more completed alternative runs on the same grid. The CLI reads the retained original run artifacts; it does not repeat InVEST execution.

Create a selection JSON with these fields:

| Field | Value |
| --- | --- |
| `baseline_run_id` | The completed baseline run ID from the workspace |
| `scenario_run_ids` | An array of completed alternative run IDs on the same grid |
| `receptor_spec` | The complete receptor profile object described below |
| `delivery_id` | Optional existing delivery on the selected baseline, to include its combined priority raster |

Load `source/receptor-profiles/utility-focus-20261012.json` as the `receptor_spec` object. It preserves the issuer's ARJWS Six and Twenty Creek and PRWD Tugaloo/Choestoea focus watersheds and the original appendix reference. It defaults to the grid's imported model-domain source collection and source ID.

```sh
python -B -m model.receptor_cli /absolute/path/to/study /absolute/path/to/receptor-selection.json
```

The result is retained at `<study>/receptor-inventories/<selection-id>/`. A repeated invocation reopens the same completed result. The command prints the result ID and file paths.

| File | Purpose |
| --- | --- |
| `index.html` | Printable area and scenario report, with original source and editable-file links |
| `contributing-areas.gpkg` | `contributing_areas` and `contributing_huc12` layers in the study CRS |
| `memberships.csv` | One row per area and contributing HUC12, including its selected anchor and original downstream path length |
| `scenario-exports.csv` | Per-area N/P/sediment quantities, common-pixel changes, and geographic coverage counts |
| `network.json` | Original retained source attributes, downstream relationships, selected memberships, special hydrologic-unit types, and source binding |
| `inventory.json` | Complete area definitions, physical quantities, source selection, and reusable file descriptors |
| `native-execution.json` | Producing-model versions, fallback labels, stage reuse, original selections and exact native output descriptors |
| `drinking_water-priority.tif` | Optional baseline combined-priority raster limited to the selected source-water contribution area |
| `high_quality_waters-priority.tif` | Optional equivalent raster for selected high-quality-water contribution areas |

The two priority rasters are created when the selection contains an existing delivery ID and a receptor of that role overlaps the reporting area.

## Include the products in the seven-map delivery

Add the same `receptor_spec` object to the normal delivery-selection JSON and run the existing delivery command. The delivery builder then:

1. Computes or reuses the contributing-area inventory from the selected baseline and alternatives.
2. Keeps the original source-water and designated-water outlines and adds the upstream contributing-area outlines.
3. Limits each configured water-protection map's priority raster to its contributing footprint, retaining the original whole-basin normalization and pollutant weights.
4. Uses the contributing footprint for the corresponding parcel-priority source-water or high-quality-water association.
5. Includes the GIS layers, network, memberships, report, scenario quantities and focused rasters under `receptors/` in the delivery assets.
6. Adds the geographic and quantitative method to the scientific PDF.

The normal original overlay selections remain part of the delivery. Use a separate delivery selection when changing receptor definitions; the existing immutable selection IDs preserve prior deliverables.

## Define additional water-protection areas

A receptor profile contains a title and a nonempty `receptors` array. Each receptor supplies:

| Field | Meaning |
| --- | --- |
| `id` | A unique area identifier |
| `title` | A readable receiving-water or focus-area name |
| `role` | `drinking_water` or `high_quality_waters` |
| `anchor_huc12s` | Complete original 12-character HUC12 strings; leading zeros are significant |
| `reference.uri` | Original document or source URL establishing the selection |
| `reference.basis` | The relationship between the source-designated area and the selected HUC12 anchors |

Other reference fields, such as source hash and appendix pages, remain in the saved profile. The supplied utility-focus profile demonstrates the actual project selection.

By default, the original HUC12 polygons and ToHUC links come from the grid's model-domain source. To select another retained source, set `source_collection_id` and `network_source_id` in the profile. A multi-layer file may also require `layer`. Original field names are resolved case-insensitively for HUC12, ToHUC, name and HUType; set `huc12_field`, `tohuc_field`, `name_field` or `type_field` when the original schema uses different names.

Use the full retained upstream-closure edition. The regional source workflow distinguishes the South Carolina reporting basin from upstream hydrologic context in Georgia and North Carolina. A four-focus-HUC file can describe those four original units but carries only the links retained in that smaller source; it cannot supply absent upstream polygons.

High-quality-water receptors use the designation source's documented relationship to HUC12s. The original designated-water geometry remains available as a separate overlay alongside its contributing land.

## What the quantities mean

Membership follows the source's original ToHUC edges upstream from every selected anchor and includes the full anchor HUC12 polygons. HUC12s selected by multiple anchors within one area are counted once. The GeoPackage retains the full contributing footprint; numerical export summaries use its intersection with the study's reporting area.

The physical run artifacts already contain annual mass per pixel. Nitrogen and phosphorus totals are reported in kg/year, and sediment in metric tonnes/year. Each valid pixel contributes once to a receiving area's quantity. The inventory retains each run's full valid-footprint total, and calculates scenario change on the intersection of valid baseline and alternative pixels:

```text
change = sum(alternative on common valid pixels)
       - sum(baseline on common valid pixels)

change_percent = 100 * change / sum(baseline on common valid pixels)
```

A zero baseline has no percentage denominator, so the percentage cell is empty. A footprint without valid modeled pixels also remains empty. Coverage columns show selected cells, baseline-valid cells, alternative-valid cells, common cells, and cells available in just one run.

The standalone inventory accepts parameter-sensitivity runs on the same grid and labels a changed profile in its CSV and report. The normal delivery's existing selection rules require a common profile for land-cover scenario comparisons.

These are modeled land-origin exports delivered to the stream network from the contributing portion of the reporting basin. The source anchors establish whole-HUC planning areas. Intake-specific transport, reservoir retention, channel sources, concentration, bacteria and cyanotoxin interpretation follow their own selected scientific method and source measurements.

Areas may overlap or nest. Memberships retain that relationship explicitly. Do not add overlapping receptor totals to form a basin total; use their geographic union.

## Primary method and source references

- [Original Upper Savannah EC-SDC RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf), retained SHA-256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`.
- [USGS Watershed Boundary Dataset](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset): hydrologic-unit boundaries and their drainage interpretation.
- [Original WBD HUC12 service schema](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6?f=pjson): HUC12, ToHUC and hydrologic-unit type.
- [InVEST 3.20 NDR model source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [SDR model source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py): the version-specific physical model output definitions used by this study's native conversion.
