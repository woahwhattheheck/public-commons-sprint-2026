# Published Lake Keowee parcel priorities

This extension applies the eight published Lake Keowee point scorecards to retained parcel studies and passes the scored candidates into the existing conservation portfolio workflow. It preserves the original parcels, current model quantities, every source criterion, the published practice prerequisite, and the resulting point contribution. The same source table can support several practice studies without changing its original records.

The implemented source is the [Lake Keowee Watershed-Based Plan (2020)](https://www.lakekeoweewatershed.org/files/files/Lake%20Keowee%20Watershed%20Plan.pdf), sections 9-18 and Appendix D. Its [official SCDES mirror](https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf) provides the same plan. Page references below are the page numbers printed on the plan. The complete source definitions and page references are in `source/keowee-priority-methods-20261013.json`.

## Components and integration

- `model/keowee_priority.py` loads the published method, binds original criterion sources, computes points, and supplies a command-line entry point.
- `model/conservation.py` retains the existing source preparation, native geometry aggregation, candidate checkpoints, portfolio selection and export engine. Its published-method branch adds the new point ranking.
- `source/keowee-priority-methods-20261013.json` retains all eight practice definitions, their maxima and priorities, original references, historical metric ranges and explicit source interpretations.
- `source/keowee-priority-integration-20261013.json` carries the exact original source identity and ordered integration edits for an assembler joining current peer changes.

The operator reads `from model import keowee_priority` and attaches `keowee_priority.catalog()` to the conservation overview as `published_methods`. The catalogue returns the method ID, title, source URI, definition digest, source interpretations, practice categories and separate septic classification. Each category has `id`, `title`, `purpose`, `maximum`, `priority`, `reference` and `required_metrics`. Each priority range is `{label, min, max}`.

A published point study must use parcel planning units. Its purpose is either `screening` or the purpose of the chosen practice. Protection uses `land_protection`; the other seven categories use restoration. The backend checks these choices.

## Practice selection

| Category ID | Practice | Maximum points | Published priority ranges | Purpose |
|---|---|---:|---|---|
| `land_protection` | Land protection | 31 | low 0-9; medium 10-19; high 20-31 | Protection |
| `agricultural_bmps` | Agricultural practices | 17 | low 0-5; medium 6-11; high 12-17 | Restoration |
| `wetland_restoration` | Wetland restoration or enhancement | 18 | low 0-5; medium 6-11; high 12-18 | Restoration |
| `riparian_restoration` | Riparian buffer restoration or enhancement | 26 | low 0-8; medium 9-17; high 18-26 | Restoration |
| `voluntary_dam_removal` | Voluntary dam removal opportunities | 5 | low 0; medium 2; high 5 | Restoration |
| `shoreline_management` | Drinking-water shoreline management | 20 | low 0-6; medium 7-13; high 14-20 | Restoration |
| `stormwater_bmps` | Stormwater practices | 16 | low 0-5; medium 6-11; high 12-16 | Restoration |
| `pet_waste_stations` | Pet-waste station locations | 2 | low 0; high 1-2 | Restoration |

Each practice has its own ranking. A 15-point result has meaning within its selected practice and method. The exported score unit is `points`; the engine preserves each practice maximum and exact priority interval.

Practice prerequisites are part of the source definition. Land protection excludes already protected parcels. Agricultural practices require at least 50 percent agricultural land or agricultural land adjacent to a stream or impoundment. Wetland restoration requires a modified or historic wetland. Riparian restoration requires the sensitive riparian footprint. Dam removal requires a recorded dam. Shoreline management requires drinking-water adjacency. Stormwater practices require developed land or a known logging operation. Pet-waste locations use the two supplied use/access criteria.

The dam table includes a zero-point low class, while an eligible recorded dam contributes two points before impairment association. The engine preserves the original table and applies its dam prerequisite. It consequently assigns eligible dam candidates medium or high priority.

## Prepare the retained sources

Use the existing workspace import operation to retain the parcel source, reporting area, context layers and any criterion table. A criterion table uses `kind: "table"` in an `upstate.sources/v1` manifest. Its original URI, vintage, title, bytes and companions remain attached to the source collection.

A source choice has the existing `source_collection_id` and `source_id` values. A criterion-table choice additionally identifies `format: "json"` or `"csv"` and the original `id_column`, defaulting to `id`. The parcel key must be the same original nonempty string used in the conservation candidates. Leading zeros remain significant. Duplicate criterion IDs are rejected; rows outside the selected parcel study are retained and counted.

The JSON table shape is:

```json
{
  "schema": "upstate.parcel-criteria/v1",
  "title": "Actual retained parcel criteria",
  "sources": [],
  "methods": {},
  "rows": []
}
```

Populate `rows` from actual source processing. Each row has its original `id` string and a `metrics` object. Canonical metric names are listed below. Source identities, original fields, geometry relations, unit conversions and classification thresholds belong in the retained table metadata. The engine also accepts a bare array of rows. CSV uses the original ID column and metric columns. Gzipped JSON is read after verifying the original retained compressed bytes.

Boolean values accept true/false and 1/0, including those text forms in CSV. Numeric values must be finite and nonnegative. Priority levels are the exact strings `low`, `medium` or `high`. Empty or null values mean that the selected source has not supplied the criterion. An observed zero or false is preserved as a measured source result.

A canonical metric supplied in the table is joined automatically. `parcel_acres` defaults to the original full parcel area converted from hectares using 4,046.8564224 square metres per acre. Other derived values require an explicit source binding or a source-derived table entry.

## Study score contract

The conserved study specification retains its ordinary title, parcel source, reporting selection, contexts, rules, native run selection and costs. Set its score to:

```json
{
  "basis": "published_method",
  "scale": "total",
  "method_id": "lake-keowee-2020-published-scorecards",
  "category_id": "land_protection",
  "interpretation": "Published parcel points with the selected current source editions.",
  "headwater_orders": [1, 2],
  "metrics": {
    "source_collection_id": "ACTUAL_RETAINED_COLLECTION_ID",
    "source_id": "ACTUAL_CRITERION_SOURCE_ID",
    "format": "json",
    "id_column": "id"
  },
  "bindings": {}
}
```

Replace the two capitalized source identity placeholders with actual workspace IDs. Keep the complete surrounding study selection in the file passed to the command. `metrics` is optional when all necessary criteria come from the actual parcel attributes, derived candidate quantities or native export bindings.

`scale` remains `total` because the practice score is an additive point total. Portfolio ordering separately supports score per hectare or score per cost. Each exported native pollutant quantity retains its physical unit.

### Bind original attributes and existing candidate geometry

A binding lives under `score.bindings[canonical_metric_name]`. Supported sources are:

| Kind | Source | Required fields |
|---|---|---|
| `table` | Original criterion row | `field`; retained `metrics` source |
| `attribute` | Original parcel attributes | `field` |
| `candidate` | Existing computed candidate quantity | `field`, `reference` |
| `native_export` | Actual selected baseline export | `pollutant`, statistic and band selection, `reference` |
| `study_mean` | Stream-length source over the selected study | `input`, `field`, `reference` |
| `stream_order` | Original stream orders | `input`, `field`, `reference` |

For `study_mean` and `stream_order`, `input` is `table` or `attribute`. Candidate bindings can select `area_ha`, `reporting_area_ha`, `protected_fraction`, `protected_area_ha`, `source_water_fraction`, `source_water_area_ha`, `high_quality_context`, `high_quality_overlap_area_ha` or `high_quality_contact_length_m`.

Transforms are `identity`, `positive`, `ha_to_acres`, `ge`, `gt`, `equals` and `band`. Numerical comparisons require `threshold`. Exact equality requires `value` and retains its original type. A band needs the selected medium and high lower thresholds unless it uses the current-study adaptation described below. Derived bindings and transforms require a nonempty reference identifying their source or interpretation.

For example, an actual source-water protection polygon used as the study's drinking-water context can supply:

```json
{
  "source_water_protection_area_present": {
    "kind": "candidate",
    "field": "source_water_area_ha",
    "transform": "positive",
    "reference": "Selected original published protection polygons, actual positive parcel intersection; Lake Keowee Appendix D p.141."
  }
}
```

This binding is appropriate when that selected context is the published protection area. If the context is an upstream HUC contribution area, retain that relationship as its own source context and choose the actual protection polygon for this criterion.

The existing high-quality context flag is useful context. The published stream-class points require the actual class-specific ORW/TN/TPGT/FW selection, so bind those individual source results.

### Headwater interpretation

The default `headwater_orders: [1, 2]` follows Table 31 and the restoration definition. The protection Appendix D text on p.138 specifies first-order streams. To explore that source variant, select `[1]` and bind `headwater_stream` using the original stream orders:

```json
{
  "headwater_stream": {
    "kind": "stream_order",
    "input": "table",
    "field": "stream_orders",
    "reference": "Original stream-order field; Appendix D protection definition, p.138."
  }
}
```

The source field contains a positive integer order or a JSON array of such orders. An observed empty array means that the source recorded no stream orders on the parcel. Null means the source value is unavailable. The first-order variant requires this original order binding so the result is recomputed from source data.

### Stream-length criterion

Use `kind: "study_mean"`, `input: "table"`, and the original stream-length field such as `stream_length_m`. The engine calculates the mean among selected parcels with a positive recorded stream length and compares every supplied parcel length with that mean. It saves the actual mean and population definition.

Appendix D p.141 prints a 0.013-mile value and attributes it to Three and Twenty Creek inside the Keowee plan. The current study mean avoids carrying that location-specific value into a different reporting selection.

## Current native export classes

The three export-priority criteria use parcel means, matching the statistic described on Appendix D p.143. The current InVEST 3.20 quantity contract is retained from the original native model outputs:

| Quantity | Parcel mean rate | Mean amount per 30-metre cell |
|---|---|---|
| Nitrogen | kg/ha/year | kg/cell/year |
| Phosphorus | kg/ha/year | kg/cell/year |
| Sediment | metric tonnes/ha/year | metric tonnes/cell/year |

The rate is the actual baseline annual mass divided by valid native support area. The mean cell amount multiplies that rate by the actual raster cell area. The engine reads the original retained raster affine transform and requires the 30-metre, 0.09-hectare cell contract before using this statistic. Structural stream omissions and source coverage remain separately visible. Missing valid support stays unavailable.

A binding may select explicit current source cutoffs:

```text
kind = native_export
pollutant = nitrogen_export | phosphorus_export | sediment_export
statistic = parcel_mean_cell_mass | parcel_mean_rate
band_method = explicit
medium_min = actual retained medium lower cutoff
high_min = actual retained high lower cutoff
reference = actual cutoff source, units and classification method
```

Medium must be less than high. The values are compared in the selected statistic's units. Historical printed intervals remain reference metadata: the nitrogen table contains an overlapping rounded interval, other intervals contain rounding gaps, and the historical sediment unit is printed as tons. The engine therefore uses the chosen current cutoff contract for current native classifications.

An optional `band_method: "current_tertiles"` computes a current-study adaptation. It uses positive parcel means among native-eligible selected study parcels and linear interpolation at positions `(n - 1) / 3` and `2 * (n - 1) / 3`. The exact two thresholds, number of observations, statistic, unit and population are saved in `normalization.resolved_native_bands`. Observed zero export is low. When both cutoffs tie, equal values are medium, lower positive values are low and higher values are high.

The published point weights remain unchanged in that adaptation, while the classification thresholds come from the selected current model study. The operator labels this choice accordingly. For comparisons that need a stable classification across different study populations, reuse the retained resolved thresholds as explicit bands.

The native point bindings record their actual required pollutant families. The maintained conservation loader supports NDR-only, SDR-only and combined runs, and preserves alternative-only outputs and common-support comparisons. The published-method preparation checks each explicitly selected native export criterion against the actual baseline outputs before geometry processing. The browser's option to derive all three published export classes therefore requires a combined run. A mixed table/native specification can use the baseline's available native families and retain the other criteria from the selected table. Source-context table studies operate independently of native run selection.

## Build, inspect and retain a portfolio

From the application root:

```sh
python -B -m model.keowee_priority methods
python -B -m model.keowee_priority --workspace /owned/upstate-workspace prepare actual-study.json
python -B -m model.keowee_priority --workspace /owned/upstate-workspace build actual-study.json
python -B -m model.keowee_priority --workspace /owned/upstate-workspace inspect STUDY_ID
```

The first command prints the installed catalogue. `prepare` binds the original sources and method into the immutable study identity. `build` prepares if necessary and executes the existing native geometry/candidate workflow. `inspect` returns the retained state and candidates. Replace `STUDY_ID` with the returned actual study ID.

To continue an interrupted study:

```sh
python -B -m model.keowee_priority --workspace /owned/upstate-workspace resume STUDY_ID
```

The existing candidate checkpoints preserve completed geometry and native aggregation. The installed method definition and implementation hashes must match the prepared method; a changed method produces a successor study instead of changing the meaning of an existing one.

Use the existing conservation portfolio contract with the returned study ID. A ranked portfolio selects an objective of `score`, `score_per_hectare`, `score_per_cost` or `area`, plus any actual area/cost/parcel limits. A manual portfolio selects original candidate IDs. The existing portfolio engine enforces the source-bound rules, checks actual union area as it selects parcels, retains supplied whole-parcel costs and recomputes unique-footprint native quantities.

```sh
python -B -m model.keowee_priority --workspace /owned/upstate-workspace portfolio actual-portfolio.json
```

Study and portfolio exports retain the editable GeoPackage, candidate CSV, original selections, complete candidate JSON and HTML report. The new candidate fields are:

| Field | Meaning |
|---|---|
| `score` | Exact practice point total when the score and prerequisite are conclusive |
| `score_unit` | `points` |
| `point_priority` | `low`, `medium`, `high` or null |
| `point_score.points` | Same exact point total |
| `point_score.known_points` | Sum established by supplied source criteria |
| `point_score.possible_points` | Upper total still allowed by unavailable criteria |
| `point_score.maximum` | Published practice maximum |
| `point_score.prerequisite` | True, false or unavailable under the source prerequisite |
| `point_score.metric_values` | Typed joined/derived values used for the calculation |
| `point_score.metric_sources` | Original fields, transformations, statistics and references |
| `score_components` | Each criterion's points, limits, children and source reference |
| `rank` | Deterministic eligible ranking, tied by original parcel ID |

A maximum criterion can become conclusive when a known branch already reaches its published maximum. An unavailable lower-valued branch then cannot change the result. Otherwise the source interval remains visible until actual data resolves it. The score table exposes the concrete remaining criteria for the source operator to populate.

Annual physical quantities and alternative deltas remain in their original candidate fields. A point total is a decision ranking; modeled annual pollutant quantities describe the selected native outputs and their retained spatial support.

## Canonical parcel criterion contract

The following table is the complete union of criteria used by the eight practices. Each study joins only the metrics required by its chosen category. The method catalogue provides that category-specific list.

| Canonical metric | Type | Source-derived meaning | Published location |
|---|---|---|---|
| `adjacent_to_drinking_water` | boolean | The parcel meets the selected explicit adjacency relation to a drinking-water reservoir or intake water. | Appendix D, p.146. |
| `adjacent_to_other_water` | boolean | The parcel meets the selected explicit adjacency relation to another stream or impoundment. | Appendix D, p.146. |
| `adjacent_to_protected_land` | boolean | The parcel meets the selected explicit adjacency relation to the original protected-land footprint. | Appendix D, p.142. |
| `agricultural_cover_at_least_half` | boolean | At least half the reporting parcel is agriculture under the selected original land-cover classification. | Appendix D, p.142. |
| `agricultural_permitted_source` | boolean | A selected original record identifies a permitted agricultural source on the parcel. | Appendix D, p.144; Table 34 cap. |
| `agricultural_unpermitted_source` | boolean | A selected original record identifies an unpermitted agricultural source on the parcel. | Appendix D, p.144; Table 34 cap. |
| `agriculture_adjacent_to_water` | boolean | Actual agricultural land on the parcel meets the selected stream or impoundment adjacency relation. | Appendix D, pp.142-143. |
| `already_protected` | boolean | Parcel is already protected under the selected original protected-land inventory. | Protection eligibility; section 9 and Appendix D. |
| `associated_with_selected_impairment` | boolean | Parcel association with the selected impairment inventory, pollutant scope and spatial/upstream relation. | Appendix D, p.142 and the individual practice table. |
| `cwa_priority` | level | Low, medium or high parcel-mean critical-watershed-area priority from the selected CWA raster and retained classification. | Appendix D, p.138. |
| `dam_present` | boolean | A dam in the selected original inventory is spatially associated with the parcel. | Appendix D, p.145. |
| `developed_land_present` | boolean | Selected original land cover identifies developed land on the parcel. | Appendix D, pp.143,146. |
| `floodplain_present` | boolean | A selected published floodplain has a positive parcel intersection. | Appendix D, p.146. |
| `floodplain_with_development` | boolean | Developed land is present in the selected parcel/floodplain intersection. | Appendix D, p.141. |
| `floodplain_without_development` | boolean | The selected floodplain parcel has no developed land under the retained land-cover inventory. | Appendix D, p.141. |
| `forested_sensitive_riparian_present` | boolean | Selected forest cover is present within the sensitive riparian intersection. | Appendix D, p.140. |
| `headwater_stream` | boolean | A stream of the selected order is present; retain actual stream orders for the [1] variant. | Table 31, p.47; Appendix D, pp.138,145. |
| `historic_wetland_present` | boolean | Original source identifies a historic wetland on the parcel. | Appendix D, p.144. |
| `hydric_soil_acres` | number | Acres of the selected hydric-soil geometry intersecting the reporting parcel. | Appendix D, p.140. |
| `known_logging_operation` | boolean | Original activity data identify a logging operation on the parcel. | Appendix D, p.143. |
| `modified_wetland_present` | boolean | Original source identifies a modified wetland on the parcel. | Appendix D, p.144. |
| `nitrogen_export_priority` | level | Current parcel-mean nitrogen export class with explicit units and retained thresholds. | Appendix D, p.143. |
| `parcel_acres` | number | Original full parcel area in acres; automatically derived from area_ha unless explicitly supplied. | Appendix D, p.142. |
| `pet_traffic_business_present` | boolean | Original business/use records identify a pet-related commercial use on the parcel. | Appendix D, p.147. |
| `phosphorus_export_priority` | level | Current parcel-mean phosphorus export class with explicit units and retained thresholds. | Appendix D, p.143. |
| `private_boat_ramp_present` | boolean | Original source identifies a private boat ramp on the parcel. | Appendix D, p.146. |
| `private_dock_present` | boolean | Original source identifies a private dock on the parcel. | Appendix D, p.146. |
| `public_access_land` | boolean | Original public-access records identify public park or access land on the parcel. | Appendix D, p.147. |
| `sediment_export_priority` | level | Current parcel-mean sediment export class with explicit units and retained thresholds. | Appendix D, p.143. |
| `sensitive_riparian_acres` | number | Acres of the actual sensitive riparian union intersecting the reporting parcel. | Appendix D, p.139. |
| `sensitive_riparian_present` | boolean | Positive intersection with that same sensitive riparian union. | Appendix D, p.145. |
| `source_water_protection_area_present` | boolean | An actual published source-water protection polygon intersects the parcel. | Appendix D, p.141. |
| `stormwater_permitted_source` | boolean | Original selected records identify a permitted stormwater source on the parcel. | Appendix D, p.144. |
| `stormwater_unpermitted_source` | boolean | Original selected records identify an unpermitted stormwater source on the parcel. | Appendix D, p.144. |
| `stream_fw_with_listed_impairment` | boolean | Freshwater classification associated with an impairment in the selected inventory and relation. | Appendix D, p.139. |
| `stream_fw_without_listed_impairment` | boolean | Freshwater classification with no impairment in the selected complete impairment inventory and relation. | Appendix D, p.139. |
| `stream_length_above_study_mean` | boolean | In-parcel stream length exceeds the actual selected study mean among parcels with positive stream length. | Appendix D, p.141. |
| `stream_orw_or_tn` | boolean | The parcel's selected classified water is ORW or TN. | Appendix D, p.139. |
| `stream_tpgt` | boolean | The parcel's selected water is the trout-grow/put/take designation; preserve the original TPGT field and the printed TGPT spelling. | Appendix D, p.139. |
| `wetland_forested_shrub_emergent_or_riverine` | boolean | The selected original wetland inventory contains a forested, shrub, emergent or riverine wetland in the parcel. | Appendix D, p.140. |
| `wetland_pond_or_lake` | boolean | The selected original wetland inventory contains a pond or lake wetland in the parcel. | Appendix D, p.140. |

### Geometry and original source choices that affect results

Sensitive riparian geometry is the union of the original variable-width USFS Riparian Buffer Delineation Model v5.2 footprint and a 100-foot (30.48-metre) buffer around waterways. A constant buffer by itself supplies only one part of the published definition. Forested sensitive riparian land additionally requires the selected forest cover within that union.

The acreage bins in the point profiles retain the plan's original cutoffs. Operational intervals use inclusive lower bounds and the next cutoff as the exclusive upper bound; this avoids gaps caused by rounded printed upper limits. Area calculations use the projected metre-based analysis CRS and the reporting parcel intersection.

SCDES edition and native field identity matter. The current retained classified source is SCHydroClass/MapServer/2 with native OBJECTID and H2OCLASS. The plan prints TGPT while the active source uses TPGT. Preserve the original raw field and keep the class interpretation in the source-derived criterion record. The published point table has no separate ONRW or TPT point allocation; a current extension requires its own stated mapping.

An impairment association must retain its actual geometry/upstream relation, pollutant scope and source vintage. The summary practice tables say impairments, while Appendix D p.142 describes bacterial impairments. The source-derived criterion table records the chosen scope and applies it consistently.

A current inventory can have incomplete geographic query coverage. Preserve that original query scope alongside the layer; an absent feature outside a captured scope cannot establish an observed false. The full Upper Savannah model domain contains the actual 217 HUC12s spanning HUC8 prefixes 03060101-03060107. The regional source packet `source/water_context/20261013/` retains those IDs and the full-domain NRCS join. Use the current expanded original classified geometry when deriving regional parcel class criteria.

The agriculture table caps its permitted/unpermitted source contribution jointly at one point. The stormwater land-activity category takes the maximum of developed land and logging, capped at two points. These combinations preserve the published 17- and 16-point practice maxima.

Practice refinements are retained in the method data: urban floodplain parcels can be routed to stormwater while retaining the riparian score; dam opportunities retain agricultural use, impoundment size and community-use context; public parks lead the pet-waste implementation sequence. These refinements are source context for actual portfolio selection.

## Required metrics by practice

### Land protection

Canonical required metrics: `adjacent_to_protected_land`, `already_protected`, `cwa_priority`, `floodplain_with_development`, `floodplain_without_development`, `forested_sensitive_riparian_present`, `headwater_stream`, `hydric_soil_acres`, `parcel_acres`, `sensitive_riparian_acres`, `source_water_protection_area_present`, `stream_fw_with_listed_impairment`, `stream_fw_without_listed_impairment`, `stream_length_above_study_mean`, `stream_orw_or_tn`, `stream_tpgt`, `wetland_forested_shrub_emergent_or_riverine`, `wetland_pond_or_lake`.

Published source: Table 31, printed p.47. 

### Agricultural practices

Canonical required metrics: `agricultural_cover_at_least_half`, `agricultural_permitted_source`, `agricultural_unpermitted_source`, `agriculture_adjacent_to_water`, `associated_with_selected_impairment`, `nitrogen_export_priority`, `phosphorus_export_priority`, `sediment_export_priority`.

Published source: Table 34, printed p.59. The summary table caps permitted and unpermitted agricultural source points jointly at 1. This profile follows that cap and its published 17-point maximum.

### Wetland restoration or enhancement

Canonical required metrics: `associated_with_selected_impairment`, `dam_present`, `historic_wetland_present`, `modified_wetland_present`, `nitrogen_export_priority`, `phosphorus_export_priority`, `sediment_export_priority`.

Published source: Table 36, printed p.68. 

### Riparian buffer restoration or enhancement

Canonical required metrics: `adjacent_to_drinking_water`, `adjacent_to_other_water`, `associated_with_selected_impairment`, `floodplain_present`, `headwater_stream`, `nitrogen_export_priority`, `phosphorus_export_priority`, `sediment_export_priority`, `sensitive_riparian_present`.

Published source: Table 37, printed p.73. 

### Voluntary dam removal opportunities

Canonical required metrics: `associated_with_selected_impairment`, `dam_present`.

Published source: Table 39, printed p.80. 

### Drinking-water shoreline management

Canonical required metrics: `adjacent_to_drinking_water`, `nitrogen_export_priority`, `phosphorus_export_priority`, `private_boat_ramp_present`, `private_dock_present`, `sediment_export_priority`, `sensitive_riparian_present`.

Published source: Table 40, printed p.82. 

### Stormwater practices

Canonical required metrics: `associated_with_selected_impairment`, `developed_land_present`, `known_logging_operation`, `nitrogen_export_priority`, `phosphorus_export_priority`, `sediment_export_priority`, `stormwater_permitted_source`, `stormwater_unpermitted_source`.

Published source: Table 41, printed p.87. The land-activity category has a published maximum of 2. When both development and logging are present this profile retains the maximum, preserving the 16-point category total.

### Pet-waste station locations

Canonical required metrics: `pet_traffic_business_present`, `public_access_land`.

Published source: Table 42, printed p.93. 

## Septic classification

Table 32, printed p.53, supplies a categorical septic workflow rather than an additive point score. It selects residences more than 500 feet from sewer and within 300 feet of open water, uses the oldest residence for a multi-home parcel, and keeps residence age alongside SSURGO suitability. The published age groups are unknown, before 1970, 1971-2000 and 2001-2019. Soil categories are Not Limited, Somewhat limited and Very limited.

The method catalogue retains this separate source definition for the receiving GIS workflow. A current inventory preserves original residence years and adds any post-2019 class as an explicit extension. The printed boundaries leave an exact 1970 record unresolved by those listed groups; keep its original year for the Appendix E interpretation rather than forcing it into another printed group.

## Receiving the exact source package

Decode each file's `content_base64` to its original UTF-8 bytes, compare the declared byte count and SHA-256, and write under the package's `base_path`. The supplied full conservation module is based on E7A1's selected-native-models v2 successor, Canvas F0C88L17JQ7, whose exact source identity is retained in the integration ledger. When another current peer has changed that module, apply the ledger's ordered single-occurrence edits to the actual current source and retain those peer changes.

The native receiving operator can then import the actual criterion table and run the commands above against its real workspace. Capture the returned study ID, actual candidate/criterion coverage, point priorities, source-derived maps and portfolio outputs. Those outputs are the direct product of the selected original sources and native application.
