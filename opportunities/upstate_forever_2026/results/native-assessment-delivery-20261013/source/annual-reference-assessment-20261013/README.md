# Annual load references and physical assessment coverage

## Decision implications

The eleven published Upper Savannah annual-load targets represent five upstream catchments. The two downstream Savannah catchments each contain the same 159 selected assessment stations and all 192 assessment records. Their different target values do not create independent assessment coverage. Keep their nesting in the existing calibration/validation grouping.

The three tributary catchments are mutually disjoint. They supply seven constituent-specific targets: Chattooga nitrogen, phosphorus and total suspended solids; Broad phosphorus and total suspended solids; and Stevens Creek nitrogen and phosphorus. Spatial separation is established by the original basin geometry; statistical independence is not inferred from that fact alone.

The physical PRWD upstream selection contains **18 assessment stations and 22 source records**, while its assessment-publisher HUC selection contains **17 stations and 21 records**. ARJWS contains six stations and ten records under all three selection bases. Preserve the basis in every displayed total.

## Annual reference catchments

| Published reach | COMID | Selected area (km²) | Selected SC assessment stations | Assessment records | Annual target series |
| --- | --- | ---: | ---: | ---: | --- |
| Chattooga near Clayton | 6269342 | 526.779 | 1 | 1 | TN, TP, TSS |
| Broad near Bell | 6280111 | 3,678.651 | 0 | 0 | TP, TSS |
| Stevens Creek | 11730084 | 1,470.231 | 18 | 20 | TN, TP |
| Savannah at Jackson | 22724211 | 19,956.327 | 159 | 192 | TN, TP |
| Savannah at Cohens | 22726623 | 22,499.106 | 159 | 192 | TN, TP |

Each tributary catchment is wholly contained in both downstream basins. Jackson is wholly contained in Cohens and occupies 88.6983% of its area. These are areas in EPSG:5070 for the retained, reviewed components. The retained source contains the original components and the existing annual-reference adapter supplies their explicit selection.

Chattooga's selected site is MC-03, with a 2024 biological-assessment record. Stevens Creek contains 18 selected stations and 20 records: five 2024 records (three biological and two bacteria) and fifteen July 2026 E. coli status records (fourteen not supported and one fully supported). Original station SV-354, corresponding to the named Stevens Creek annual reference, has a 2024 E. coli record. An annual nitrogen/phosphorus comparison therefore addresses a different constituent from that recorded concern.

Broad's zero is a result for this **selected South Carolina assessment cohort**. Its Georgia catchment has two published annual targets; the cohort does not inventory Georgia assessments.

The two sediment references are Chattooga and Broad. The Upper Three And Twenty Creek priority area and its selected turbidity records fall within the downstream reference coverage, but neither of those sediment targets is a measurement of Three And Twenty Creek. Continue source-native scenario comparisons and the existing site-specific monitoring work with that distinction visible.

## Physical utility coverage

Utility selections use the exact original network union of upstream HUCs plus the focal HUCs: four for ARJWS and thirty-two for PRWD.

| Utility | Basis | Stations | Records |
| --- | --- | ---: | ---: |
| ARJWS | Original station points within selected WBD polygons | 6 | 10 |
| ARJWS | Station publisher HUC12 | 6 | 10 |
| ARJWS | Assessment-edition publisher HUC12 | 6 | 10 |
| PRWD | Original station points within selected WBD polygons | 18 | 22 |
| PRWD | Station publisher HUC12 | 17 | 19 |
| PRWD | Assessment-edition publisher HUC12 | 17 | 21 |

The physical utility union contains 24 distinct stations and 32 records. The assessment-publisher union remains 23 stations and 31 records. Each is useful for its stated question; a physical map filter must label the geometric selection.

**RS-21014** lies inside Little Beaverdam Creek, HUC12 030601020506, and within the PRWD upstream selection. Its WQP station source provides HUC8 03060102 without a HUC12. Its three 2024 records (dissolved oxygen, pH and E. coli) all publish 030601020506, which agrees with the geometric match. The original point is 351.42 m from the containing HUC and utility outer boundary.

**SV-809** lies inside Lower Tugaloo River, HUC12 030601020507, and within the PRWD upstream selection. This agrees with its original Atlas station HUC12. Its July 2026 E. coli record publishes 030601010305. Its point is 1,302.85 m from the containing HUC boundary and 9,436.21 m from the utility outer boundary. Physical selection adds this existing source record to PRWD coverage; the original assessment attribution remains retained.

## Six source-edition HUC differences

All 159 original points fall in exactly one of the 217 original polygons. All 152 nonempty station-publisher HUC12 assignments agree with geometry. Seven original WQP station sources provide HUC8 without HUC12. Of the 192 selected assessment records, 186 agree with the geometric HUC; the following six July 2026 records differ.

| Station | July 2026 assessment HUC12 | Original station and geometric HUC12 | Geometric HUC name | Distance inside HUC boundary (m) |
| --- | --- | --- | --- | ---: |
| RS-06190 | 030601030502 | 030601030602 | Job Creek | 1,456.20 |
| SV-052 | 030601030609 | 030601030509 | Sawney Creek | 925.62 |
| SV-164 | 030601030602 | 030601030502 | Headwaters Little River | 1,104.42 |
| SV-318 | 030601030510 | 030601030609 | Middle Long Cane Creek | 977.72 |
| SV-353 | 030601070208 | 030601070207 | Chap Branch–Beaverdam Creek | 777.54 |
| SV-809 | 030601010305 | 030601020507 | Lower Tugaloo River | 1,302.85 |

RS-06190's separate 2024 biological record publishes 030601030602 and agrees with geometry. This is an edition-specific comparison. The derived context retains the original fields and source record pointers rather than replacing them.

## Use in the maintained application

Import this folder's `sources.json` through the existing source-import operation. Its derived 159-point GeoJSON is a vector source for the existing Spatial Review; its two tabular joins support original station-ID and assessment-record-ID lookup. Filter `PRWD_geometry`, `ARJWS_geometry`, `geometry_huc12` and `annual_reference_comids` to inspect coverage. `assessment_geometry_differences` identifies the six source-edition differences.

The entry role identifies a derived assessment-geography context. Original station capture source IDs, native feature IDs, coordinates, CRS and body hashes remain properties and JSON companions. The layer adds geographic selection context to the maintained map; the original station and assessment editions remain their source records.

The existing **Annual load observations** desk continues to import the original annual targets and catchments and open the maintained calibration workflow. Use the actual upstream polygons when grouping calibration and validation records. For a seven-target tributary selection, the actual source rows are Chattooga TN/TP/TSS, Broad TP/TSS and Stevens TN/TP. Downstream mainstem targets provide nested regional context. Do not sum their covered assessment sites with the tributary counts.

Files:

- `annual-reference-assessment-summary.json`: original eleven target rows, five basin summaries, ten pairwise overlaps and method provenance.
- `annual-reference-station-memberships.csv`: all 795 basin–station membership decisions, original coordinate identity and boundary distances.
- `assessment-native-huc-context.json`: complete 159-station, 192-record geometric/publisher crosswalk, exact utility selections and method.
- `assessment-native-huc-stations.csv`: one row per original station.
- `assessment-native-huc-records.csv`: one row per original assessment record with edition-specific HUC and source hash.
- `assessment-geography-context.geojson`: original station locations transformed to GeoJSON longitude/latitude, with derived map filter properties.

## Source periods, constituents and method

Annual targets retain the [USGS Southeast regional edition](https://doi.org/10.5066/P9A682GW), its 2012 reference year and source-global 1 October 1999–30 September 2014 target horizon. The 2024 assessment edition covers 2018–2022, and the July 2026 TMDL status is separately labelled. Geographic coverage does not make these periods contemporaneous.

The annual calculations use the original `ACTUAL` target for nitrogen/phosphorus in kg/year and `ACTUAL_MT` target for sediment in metric tonnes/year. Published prediction fields remain separate. The already annual rates are not multiplied by the horizon length and the sediment `TSS_CONV` term is not reapplied. Classification TN means **Trout Natural**; annual-target or assessment TN means **Total Nitrogen** in its stated field.

Station membership used original EPSG:26917 coordinates for 152 Atlas points and EPSG:4326 for seven WQP points. Original WBD polygon geometry uses EPSG:3857; original NLDI basin GeoJSON uses longitude/latitude. All containment and area comparisons were evaluated in EPSG:5070 with explicit always-XY transforms and ballpark transformations disabled. The retained original Esri ring assembler was reused; it reported zero corrections. Exact covers predicates produced one HUC match per station and no boundary matches. No tested membership lies within the summed reported coordinate-operation accuracy (4 or 8 m for WBD comparison). That transform metadata is not a measured error bound for the station position or watershed boundary.

Runtime: Python 3.12.14, Shapely 2.2.0 / GEOS 3.14.1, pyproj 3.8.0 / PROJ 9.8.1. Complete operation definitions, original hashes and record locators are retained in the JSON outputs.

Primary sources and retained originals:

- [USGS regional release P9A682GW](https://doi.org/10.5066/P9A682GW), [nitrogen layer 37](https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/37), [phosphorus layer 36](https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/36), [sediment layer 39](https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/39).
- The existing `../usgs-southeast-sparrow-2012/nldi/` originals, identified by COMID and exact source SHA in the annual summary. [USGS NLDI](https://api.water.usgs.gov/nldi/linked-data/comid).
- [USGS WBD original layer 6](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6); exact retained 217-HUC archive SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.
- [SCDES 2024 assessment list](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf), original normalized records identified by source hash and JSON pointer.
- [Complete retained 159-station and 192-record source edition](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R6K30US), including the original Atlas705 capture and WQP supplements.
- [Original utility network crosswalk](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8NMPGQ78), original CSV 111,728 bytes / SHA256 `3f25af3b660a0949d01218c7cfb1fcb48be7e5092641f35da3be2921c47debfc`.

