# Upper Savannah watershed context

The retained model domain contains **217 watersheds** across **7 HUC8 regions**, covering **4,659,072.10 acres** (18,854.60 km2) of published watershed area. NRCS records identify **15 priority watersheds** through 18 designated state portions.

Selected South Carolina water classes contain **1,886 retained source features** assigned by the publisher to **19 HUC12s**. The source query covers 217 of 217 model HUC12s. 101 model HUC12s lie outside South Carolina according to the retained state records.

## Regional context

| HUC8 | HUC12s | Area (ac) | Priority HUC12s | Priority state area (ac) | Selected SC class records | Publisher HUC12s |
| --- | --- | --- | --- | --- | --- | --- |
| 03060101 | 36 | 657,936.25 | 1 | 29,763.38 | 782 | 8 |
| 03060102 | 32 | 633,323.13 | 2 | 74,495.85 | 1,002 | 7 |
| 03060103 | 57 | 1,177,100.96 | 4 | 161,237.56 | 102 | 4 |
| 03060104 | 43 | 962,235.32 | 7 | 179,969.98 | 0 | 0 |
| 03060105 | 18 | 491,554.99 | 1 | 22,095.30 | 0 | 0 |
| 03060106 | 8 | 263,248.89 | 0 | 0.00 | 0 | 0 |
| 03060107 | 23 | 473,672.56 | 0 | 0.00 | 0 | 0 |

## State portions

The 240 state rows sum to 4,659,074.07 acres. There are 22 cross-state watersheds. The difference between summed state portions and distinct watershed areas is 1.97 acres; both published measures are preserved.

| State | HUC12 state rows | State area (ac) | Priority state rows | Priority state area (ac) |
| --- | --- | --- | --- | --- |
| GA | 115 | 2,435,508.93 | 13 | 350,585.70 |
| NC | 9 | 109,734.82 | 0 | 0.00 |
| SC | 116 | 2,113,830.32 | 5 | 116,976.38 |

## NRCS priority watersheds

Priority watersheds cover 467,561.88 acres when each whole watershed is counted once. Their designated state portions cover 467,562.07 acres.

| HUC12 | Watershed | Priority states | System types | Area (ac) | Selected class records |
| --- | --- | --- | --- | --- | --- |
| 030601010701 | Upper Three And Twenty Creek | SC | Ground | 29,763.36 | 0 |
| 030601020503 | Gum Log Creek | GA | Both | 14,806.13 | 0 |
| 030601020507 | Lower Tugaloo River | GA, SC | Ground | 59,689.69 | 0 |
| 030601030100 | Lightwood Log Creek-Savannah River | GA, SC | Both | 50,005.17 | 0 |
| 030601030206 | Wilson Creek | SC | Both | 24,712.13 | 0 |
| 030601030303 | Lower Beaverdam Creek | GA | Both | 32,779.07 | 0 |
| 030601030712 | Murry Creek-J. Strom Thurmond Reservoir-Savannah River | GA, SC | Ground | 53,741.13 | 0 |
| 030601040106 | Middle North Fork Broad River | GA | Surface | 24,134.21 | 0 |
| 030601040107 | Unawatti Creek | GA | Surface | 21,243.14 | 0 |
| 030601040108 | Lower North Fork Broad River | GA | Surface | 19,873.02 | 0 |
| 030601040205 | Upper Grove Creek | GA | Surface | 25,022.35 | 0 |
| 030601040402 | Brush Creek | GA | Ground | 23,299.24 | 0 |
| 030601040404 | Clouds Creek | GA | Ground | 30,442.30 | 0 |
| 030601040406 | Lower South Fork Broad River | GA | Ground | 35,955.65 | 0 |
| 030601050201 | Beaverdam Creek Lake | GA | Surface | 22,095.29 | 0 |

## Source coverage

Coverage status: **complete_domain_query**. Selected classes: ORW, ONRW, TN, TPGT, TPT. 198 watersheds have a complete query and zero records for these selected classes. 0 zero-record watersheds lack a complete query bound to this source context.

Class counts retain each source feature's publisher HUC12 attribute. The native receiving-water engine supplies spatial intersections and routed sediment and nutrient results. Watersheds outside the classification layer's state jurisdiction remain in the original model domain.

## Hydrologic connectivity

Native ToHUC status: **not_supplied**.

Connect native HUC12/ToHUC records to populate upstream watershed areas, upstream priorities, downstream paths and domain exits.

## Selected watersheds

The selection contains 1 watershed covering 59,689.69 acres. The complete model domain remains in the context report.

Selected HUC12s: 030601020507

## Methods

**Watershed area.** NRCS huc12_ac is counted once per HUC12. Repeated values across state records must agree. Acres convert to km2 using 0.0040468564224.

**State area.** NRCS st_ac is summed once per state/HUC12. State portions and watershed totals retain their published rounding or vintage differences.

**Priority.** A HUC12 is priority when at least one NRCS state row has FY26 status High Priority Area. Priority watershed area includes that whole HUC once; priority state area includes only designated state portions.

**Classified water.** Counts use retained publisher HUC12 attributes for ORW, ONRW, TN, TPGT and TPT. A complete exact-domain membership query supports zero matches for these selected classes. South Carolina jurisdiction is shown separately.

**Geometry.** Native receiving-water geometry intersections and routed load associations are computed by the receiving-water engine. Source attribute counts remain available for regional context and source inspection.

**Roles.** All original model-domain HUC12s are retained. Reporting and upstream roles are used only when explicitly supplied with native network records.

**Hashes.** canonical_sha256 hashes sorted compact UTF-8 JSON values. Source-byte membership hashes are preserved separately from the publisher companion.

## Sources

- **Model domain:** the [retained original 217-HUC selection](../../source/water_context/20261013/domain-huc12s.json) accompanies the complete imported [source edition](../../source/water_context/sources-20261013.json).
- **NRCS programme context:** [FY26 Source Water Protection Resource Concern, layer 7](https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7). The [original response](../../source/water_context/20261012/raw/nrcs-fy26.json) preserves all state/HUC records.
- **Selected South Carolina water classifications:** [SCDES SCHydroClass, layer 2](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2). The [complete-domain source coverage](../../source/water_context/20261013/scdes-domain217-source-coverage.json) retains the original request URLs and response identities.
- **Retained implementation and source identities:** the complete [context JSON](watershed-context.json) keeps the original source metadata and canonical hashes. The [programme example guide](README.md) explains the source selections and current application workflow.

This readable edition preserves the completed run's quantities and selected geography, with source links and presentation formatting updated for review.

Context identifier: watershed-4592eb077b7164d59ba4
