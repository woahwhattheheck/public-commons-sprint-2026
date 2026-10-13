# Build published parcel criteria from the original project sources

The parcel criteria builder turns the current study's original parcel geometry and imported GIS sources into a reusable criterion table. The existing Lake Keowee point engine reads that table, assigns the selected practice's published points, and returns its ranked parcels to the existing portfolio and native scenario workflow.

The complete public entry point is:

~~~python
from source_tools import parcel_criteria
result = parcel_criteria.prepare(workspace, {"study_id": actual_study_id})
~~~

The same operation is available through the operator action `conservation.criteria.prepare`. It returns a real imported source collection ID, table source ID, source coverage, original geometry binding, and paths to the JSON, CSV and two-layer GeoPackage. An existing operation ID resumes its saved original source selections and completed parcel batches.

## Operator journey

1. Open the conservation study form and select the actual original parcel source and reporting area, or its completed native baseline/grid. The regional parcel acquisition can supply county-qualified original IDs; the builder preserves whichever original ID field the study selected.
2. Choose the published practice and use **Build criteria from imported layers**. The operator sends the study geography to the native queue. The builder can create its source geometry study before a criterion table exists.
3. Read the running parcel count and the completed table's criterion coverage. Every count comes from the actual selected parcel rows and source support.
4. Use **Use prepared parcel criteria**. The operator restores the originating study's geographic selections and fills the exact new source collection, JSON table and `id` join column.
5. Build the published-practice study. Its saved point details show the original criterion values and the published point contribution. The native model export criteria can use the selected run's existing NDR/SDR outputs through the established point-engine binding.
6. Save a manual or ranked portfolio. The existing conservation engine retains the actual selected parcel IDs, geometry union, source context and modeled quantities; its scenario handoff applies that exact footprint to the selected native land-cover scenario.

Plain descriptions for a demonstration: “Choose the actual parcels and study boundary.” “Build their criteria from the imported source layers.” “See which original facts support each criterion.” “Use that saved table in the selected published practice.” “Inspect the point breakdown and geographic priorities.” “Turn the selected parcels into a saved portfolio and native scenario.”

## Public input and output

The selection schema is `upstate.parcel-criteria-selection/v1`. Supply exactly one of `study_id` or `study`.

~~~json
{
  "schema": "upstate.parcel-criteria-selection/v1",
  "study_id": "actual retained conservation study ID",
  "sources": {},
  "settings": {
    "spatial_criteria_basis": "whole_original_parcel",
    "adjacency_m": 0,
    "waterway_buffer_m": 30.48,
    "land_cover_basis": "whole_parcel",
    "floodplain_development_basis": "whole_parcel",
    "protected_fraction_threshold": 1,
    "headwater_orders": [1, 2],
    "checkpoint_parcels": 100
  }
}
~~~

An empty `sources` object selects current matching original Workspace sources. A role explicitly set to null is omitted. A role containing a source selection takes precedence over automatic selection. The original selection is retained in full; a resumed operation keeps those editions even after newer source imports arrive.

For a new form, `study` contains the existing conservation geographic specification: mode, parcel source and native ID column, reporting source or selected native baseline, analysis CRS and optional context sources. The builder prepares a zero-weight source geometry study, retaining the actual native grid when one is selected. Scoring alternatives and cost tables do not affect this geometry operation.

The result includes:

| Field | Meaning |
|---|---|
| schema | `upstate.parcel-criteria-result/v1` |
| id / state | Saved criterion operation identity and current state |
| study_id | Originating retained conservation geometry study |
| source_collection_id / source_id | Actual imported canonical JSON table |
| table | Format json, ID column id, saved path, byte count and SHA256 |
| fields | Canonical criterion and original derived-data field names |
| coverage | Actual parcel count and known, unknown, true, false or level counts for each criterion |
| selected_sources | Original source identity, URI, vintage, body hashes, source selection and capture context |
| geometry_context / geometry_context_sha256 | Exact original parcel and reporting geography binding |
| spatial_criteria_basis / metric_geometry | Actual source-criterion geometry and the independent basis of each metric |
| population_statistics | The actual complete stream-length population, geometry basis and retained threshold |
| files | JSON table, CSV, GeoPackage, source selection, method definitions and import manifest |
| score_selection | Reusable table binding and published method ID; the practice is selected in the study |
| available_bindings.headwater_stream | Explicit raw stream-order binding for the first-order protection variant |

The generated table entry's `scope` also contains study_id, geometry_context, geometry_context_sha256, criterion coverage and builder ID. Portable source inspection can recover its originating study after the task has left the current operator view.

## Exact source selection

`source/parcel-criteria-sources-20261013.json` is the executable source profile. Automatic selection matches retained original source IDs, exact service URIs or explicit semantic roles. It records its choice, matching source editions and original capture extent. Source-context studies select the latest matching retained NLCD edition. A native study selects its grid's exact original `grid.spec.source_collection_id` and `grid.spec.input_sources.NLCD` source.

A source selection has the same collection/source/layer/typed attribute filter fields as conservation. Additional criterion fields describe the actual native mapping and original capture:

~~~json
{
  "source_collection_id": "actual immutable source collection",
  "source_id": "actual original source ID",
  "layer": "actual optional original layer",
  "where": {"actual original field": "exact typed original value"},
  "fields": {"stream_order": "streamorde"},
  "coverage": {
    "source": {
      "source_collection_id": "actual mask source collection",
      "source_id": "overlay-native-selection-context"
    },
    "group": "reporting",
    "reference": "Original object-ID capture against this retained mask"
  }
}
~~~

The native overlay capture already retains `overlay-native-selection-context` with the actual Esri reporting/focus mask geometries and original spatial reference. The builder finds that document within the original collection and associates it with each source's declared reporting or focus capture. It preserves original metre/foot/degree/Esri CRS metadata and transforms geometries to the study's projected metric CRS for the calculation.

A different retained polygon mask can provide coverage through `coverage.source`, optional `huc12_ids` and its exact `huc12_field`. The builder requires every selected original HUC ID to exist. A source producer can publish this exact binding under `entry.metadata.criteria_coverage` or `entry.scope.criteria_coverage` for automatic reuse.

### Current concrete source families

| Builder role | Existing original source / contract |
|---|---|
| protected_lands | padus-manager; original PAD-US Manager Type FeatureServer/0 |
| streams | nhd-flowline; NHD MapServer/6; ftype, original feature IDs |
| stream_orders | NHDPlus_HR/MapServer/3; original streamorde, NHDPlusID/permanent_identifier |
| waterbodies | nhd-waterbody; NHD MapServer/12 |
| wetlands | nwi-wetlands; original ATTRIBUTE and WETLAND_TYPE |
| classifications | Original all-class Water_Classifications/0 edition, or explicitly tagged current all-class/FW edition |
| high_quality_classes | Active SCHydroClass/MapServer/2 original ORW/TN/TPGT capture |
| source_water_protection | Published Public_Water_Supply/MapServer/2 protection polygons |
| intakes | Public_Water_Supply/MapServer/0 original intake locations |
| land_cover | Exact native grid NLCD source, or imported original NLCD raster |
| sensitive_riparian / variable_riparian | Original complete sensitive-riparian union, or original USFS variable-buffer polygons |
| hydric_soils | Selected original hydric-soil polygons |
| floodplains | Selected original one-percent floodplain polygons |
| impairments | Selected original contribution-area or explicit geographic-context vector with reference and relation |

The full source profile additionally accepts original historic wetlands, dams, private ramps, private docks, public access, pet-related businesses, logging operations, and permitted/unpermitted agricultural or stormwater inventories. The roles identify already selected original source meaning. Generic point-source inventories need their explicit original attribute selection before they can represent a particular permitted/unpermitted practice criterion.

The active target-class source is complete for the retained 217-HUC query: its 1,886 native IDs match the original geometry, and the original HUC8 04–07 target-class query returns zero. The all-class/FW edition remains separately selected because the high-quality query concerns different class values. The canonical original source carrier also holds dated 2024 listing and 2026 assessment material. Its actual selected pollutant scope and contribution relationship belong in the impairment source reference.

## How the criteria are calculated

### Parcel geometry and protected lands

`parcel_acres` uses the full original parcel polygon area divided by 4046.8564224 square metres per acre. The table separately records reporting_parcel_acres and reporting_share. The study's original ID field remains the exact row key, including county qualification when that is the original source's chosen identity.

Protected-land overlap is computed against the original full parcel. The default already_protected criterion requires complete coverage by the selected protected inventory; an explicit protected_fraction_threshold can select a different recorded threshold. The raw observed protected fraction is always retained when the source is present. Protected adjacency uses exact original contact at zero metres, or the explicitly selected metric distance.

The parcel-size threshold is evaluated against the full original parcel. New spatial source criteria also default to that full parcel through spatial_criteria_basis=whole_original_parcel. Select reporting_parcel explicitly for a reporting-boundary adaptation. Land-cover and floodplain-development bases remain independent choices. The generated table, source scope, CSV, GeoPackage and point report retain the actual criterion basis alongside the original full and reporting areas.

### Stream length, headwaters and classified water

The default stream-length selection is original NHD ftype 460. Surface-water adjacency/buffers also include ftype 336 and the selected original waterbody polygons. Other flowline feature types remain outside those explicit selections. In-parcel line geometries are unioned before length measurement so repeated spatial overlap does not inflate the criterion.

The complete study stream-length mean is computed from positive original line lengths among the selected parcels under the same saved spatial_criteria_basis. The saved population records its units, positive count, complete count and arithmetic mean. A complete zero length receives false for “above mean.” The published Appendix's study-specific mean is not imported as a threshold for this different study.

NHD Flowline MapServer/6 does not carry the stream-order field. The builder reads the separate original NHDPlus HR network source's streamorde field. Zero, absent and invalid values remain separately observable; positive integer orders are retained. The canonical headwater_stream criterion uses [1,2]. The raw complete stream_orders field supports the source's first-order protection variant through the existing point-engine stream_order binding.

If an observed original first- or second-order reach intersects the parcel, that positive criterion is usable even if other original orders are unavailable. The table separately records stream_orders_observed and missing-order feature IDs.

The builder treats original ORW/TN, TPGT and FW classifications as exact source values. Explicit class_value_map handles a documented original code mapping. Classification scope records all or the actual captured class list. The active high-quality edition supplies its class criteria; the all-class/FW edition supplies FW. The source's TPGT spelling is retained alongside the published plan's printed TGPT interpretation.

For the FW impairment distinction, the selected FW criterion is combined with the separately selected impairment association. An impairment vector must declare its actual edition/pollutants in reference and its explicit source-area, upstream or geographic meaning in relation. A polygon contribution area can come from the existing receiving-water workflow. The table retains the selected original source and relation with the actual positive intersections.

### Riparian areas, wetlands, soils and floodplains

The published sensitive-riparian footprint can be supplied as one retained complete union. Alternatively, the builder unions the original USFS variable-buffer footprint with the default 30.48-metre surface-water buffer. The overlapping areas are counted once. A constant buffer by itself produces the separately named waterway_buffer_acres_observed quantity.

NWI criteria use the actual original type values:

| Original WETLAND_TYPE | Published wetland group |
|---|---|
| Freshwater Forested/Shrub Wetland | Three-point group |
| Freshwater Emergent Wetland | Three-point group |
| Riverine | Three-point group |
| Freshwater Pond | Two-point group |
| Lake | Two-point group |

The source can expose qualified names such as Wetlands.ATTRIBUTE. The field resolver accepts an unambiguous original suffix while preserving actual field/value evidence. The terminal original lowercase special modifiers b, d, f, h, m, r, s and x identify modified wetlands under the selected source method.

Hydric-soil acreage is the unioned original selected hydric polygon area inside the declared spatial_criteria_basis; the current default is the full original parcel. The input should already represent the selected original hydric classification; the builder does not substitute an unrelated soil attribute.

The selected one-percent floodplain geometry determines floodplain presence. With the default whole_parcel development basis, a parcel with any selected developed cover receives the developed condition. The undeveloped condition means that no developed cover occurs under the complete selected land-cover support. An explicit floodplain_intersection adaptation restricts development analysis to that footprint and is retained in the table.

### Original land-cover cells and water adjacency

The default NLCD agricultural classes are 81/82, forest classes 41/42/43, and developed classes 21/22/23/24. Those original codes and the selected source edition are saved. Other class maps can be supplied explicitly in settings.

The builder reads the original projected metric north-up raster with its existing nodata mask. It computes actual cell/polygon overlap areas, including partial boundary pixels, and performs no raster resampling. It saves valid and missing area, original raster transform and CRS, and class areas.

Agricultural cover of at least half uses the full original parcel by default. If known agricultural area already exceeds half, that positive result is determined. If even the agricultural area plus all missing area falls below half, the negative result is determined. Other incomplete cases remain unresolved. This retains useful information from partial original support without changing the mathematical threshold.

Agricultural-water adjacency uses the actual polygon footprint of selected agricultural raster cells, clipped to the selected parcel basis, and the selected original surface-water geometries. Forested riparian presence uses the actual original land-cover cells within the sensitive-riparian footprint.

A drinking-waterbody can be supplied as an original, source-bound waterbody layer. Otherwise the builder links actual intake points to intersecting original waterbody polygons, caches that original relationship, and records the matched intake/waterbody IDs. The remaining selected surface-water geometry supplies the other-water criterion. The original protection polygons supply the separate source-water-protection-area criterion.

### Current modeled quantities

The source builder produces the geographic criterion table. Existing native NDR/SDR export bindings supply current model export classes in the published-practice study. Those bindings retain selected model families, actual per-pixel mass units, parcel support, current thresholds and their interpretation. A selected CWA raster can supply parcel-mean critical-watershed priority only with its explicit retained class thresholds and reference.

Annual nutrient/sediment quantities stay in the conservation study's existing native quantity fields. Published points have their own score and component fields.

## Coverage and geography binding

A positive original feature intersection establishes presence. A negative result or exact complete area requires the original source acquisition footprint to cover the analysis geometry and the relevant native fields to be known. The JSON null value records a criterion not fully determined by the chosen sources. The table retains observed quantities and original IDs alongside it.

This distinction also makes later source acquisition useful: import the new edition and prepare a successor table. Its operation identity changes with the source bytes, original geometry, settings, installed source profile or published definitions. The previous table remains attached to its original study.

The geometry context binds:

- Original parcel source collection, source ID, body hash/bytes, layer, ID field and exact attribute selection.
- Original reporting source selection, or the selected native grid and retained reporting-boundary hash/bytes.
- The actual projected analysis CRS as WKT.

The point engine checks a builder-produced JSON table's descriptor and digest against the target study before using its parcel values. Equal parcel IDs from another geometry edition therefore cannot silently reuse the table. Compatible runs on the same grid and original parcel selection can reuse it because model profile or run IDs are not part of the geometric descriptor.

## Native command line and retained files

From the application root:

~~~sh
python -B -m source_tools.parcel_criteria --workspace /owned/project auto --study ACTUAL_STUDY_ID
python -B -m source_tools.parcel_criteria --workspace /owned/project prepare selection.json
python -B -m source_tools.parcel_criteria --workspace /owned/project inspect ACTUAL_OPERATION_ID
python -B -m source_tools.parcel_criteria --workspace /owned/project prepare ACTUAL_OPERATION_ID
python -B -m source_tools.parcel_criteria --workspace /owned/project overview
python -B -m source_tools.parcel_criteria --workspace /owned/project source-profile
~~~

The operator uses the same functions, so queue and CLI execution produce the same saved source table.

The operation directory is `parcel-criteria/<operation-id>/` within the actual workspace. It contains state.json, selection.json, definitions.json, chunked parcel checkpoints, criteria.json, criteria.csv, criteria.gpkg, sources.json and result.json.

Each default checkpoint contains 100 complete original parcel rows. Resume checks the exact operation and original parcel IDs, reuses saved batches, then recomputes the actual study-wide stream-length threshold and exports. It preserves an actual failure type/message and the current completed count if execution fails. Separate operation locks keep the long spatial calculation outside the brief Workspace source-import lock.

The GeoPackage contains original_parcels and reporting_parcels. Both layers retain original IDs, canonical fields, full/reporting acres and raw stream length/orders. The JSON retains all field-level source relationships and geometry corrections. The CSV displays the same field values; formula-like original text is escaped for spreadsheet display. The canonical imported JSON preserves exact original IDs.

## Integration

The complete source set adds:

- source_tools/parcel_criteria.py
- source/parcel-criteria-sources-20261013.json
- source_tools/PARCEL_CRITERIA.md
- Updated model/keowee_priority.py with geometry_context and generated-table binding.
- source/parcel-criteria-integration-20261013.json with exact integration anchors and source hashes.

The existing conservation model, current selected-output consumer, browser and operator remain owned by their current maintainers. The only priority-engine follow-on joins are the common digest import, geometry context helper and original-table bind check. The full source preserves the parent-approved original parcel-area correction.

The exact original source and model definitions are available to the operator's existing background execution host. The delivered Python source uses the application's established Workspace, Fiona, Rasterio, Shapely and PyProj environment. Its native compile and actual imported-source execution are performed there.

## Primary references

1. [Lake Keowee Watershed-based Plan, official project PDF](https://www.lakekeoweewatershed.org/files/files/Lake%20Keowee%20Watershed%20Plan.pdf), section 9 and Appendix D, printed pp.138–147. [SC DES official mirror](https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf).
2. [USGS NHD Flowline original layer metadata](https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6?f=pjson).
3. [USGS NHDPlus HR network flowline original layer](https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3) and [official NHDPlus HR user guide](https://pubs.usgs.gov/publication/sir20255031/full).
4. [USFWS NWI original layer metadata](https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0?f=pjson) and [official wetlands map-code diagram](https://www.fws.gov/sites/default/files/documents/wetlands-and-deepwater-map-code-diagram.pdf).
5. [MRLC NLCD class definitions](https://www.mrlc.gov/data/legends/national-land-cover-database-class-legend-and-description) and [Annual NLCD legend](https://www.mrlc.gov/data/legends/annual-nlcd-land-cover-legend).
6. [SC DES active classified-reach source](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2) and the retained original source editions selected by this workspace.

## Freshwater physical-domain source editions

The maintained water-context intake publishes the freshwater class scope
explicitly under `metadata.parcel_criteria`. Its generic
`WATER_CLASSIFICATION` role is accepted for the `classifications` criterion only
when the original entry also declares `metadata.classification: "FW"`.
The complete physical-domain edition with its retained coverage binding has
priority over the publisher-HUC-only freshwater variant. The source profile
excludes freshwater-only roles/metadata from the high-quality class matcher,
even though those source families share the same official layer URI.

A coverage source stored in the same source edition may omit
`source_collection_id` from `metadata.criteria_coverage.source`. The resolver
fills the actual containing collection ID after import. An explicit original
cross-collection binding is preserved. The original domain source, HUC12 field
and exact selected HUC IDs remain in the coverage selection.

The ordinary water-context importer also returns a complete explicit override:

~~~python
bindings = bind_workspace(workspace, source_edition)
criterion_source = bindings["parcel_criteria_sources"]["classifications"]
selection["sources"]["classifications"] = criterion_source
~~~

Continue the existing `parcel_criteria.prepare` workflow with that selection.
It retains the existing positive/negative/unknown calculation for the selected
regulatory classification inventory: positive native FW intersections remain
positive; no matching retained FW feature inside complete captured geometry can
be negative; absence beyond that geometry remains unknown. The source is the
SCDES classification inventory. Its negative result does not establish absence
of ecological freshwater in another state's missing inventory.

The actual criteria are `stream_fw_with_listed_impairment` and
`stream_fw_without_listed_impairment`. Per-row JSON evidence records requested
classes, selected class scope, source filter, reference, meaning and the
classification result. The exported table also preserves the complete original
source/coverage bindings and native body hashes. A broader freshwater criterion
requires its own geographic inventory coverage and keeps cross-state missing
inventory unknown. Original criterion definitions and scoring are unchanged.
