# Current USGS watershed intersections for original observation locations

This source collection retains 184 source records: 87 draft-2026 assessment stations, 67 original regional USGS inventory points, 12 coordinate representations of four NPDES outfalls, five 2023 lake-study stations, and 13 additional HUC05–07 regional calibration gauges. There are 183 distinct original EPSG/x/y tuples. The original 171-record cohort was completed before appending the separately identified regional_huc05_07_13 cohort. Assessment and study SV-268 use exactly the same WGS84 coordinates; only that exact geometry is queried once for both identities.

## Sources and coordinate semantics

The input files are copied unchanged from https://chatgpt.com/space/page_7400eac248888191b81f99a91ec01c40 and retained under inputs/ with their original relative path, byte count, and SHA256. The additional 13 original NAD83 features are retained unchanged from source/hydrology-huc05-07-20261013/derived/calibration_stations_nad83.geojson at commit 427e8448730056761e5d5d3f99fef6f8705c853d (30,153 bytes; SHA256 7b3c37a20656ddfcfe630d47b0ebff831f26fa2df70125c31727fadcd4bd62d9). Every source feature is preserved in query-plan.json. EPSG:4326, EPSG:4269 and EPSG:26917 coordinates are sent to the official WBD query with matching geometry.spatialReference.wkid and inSR. No local reprojection or inferred coordinates are used. The two outfall routing GeoJSON files are WGS84 source geometries without a legacy crs member; their declared source semantics and RFC7946 convention are retained in crs_basis.

Current official source: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6 . Each query uses esriGeometryPoint and esriSpatialRelIntersects, requests all original fields, and retains all returned polygons. returnGeometry=false avoids transferring polygons when the actual operation is the publisher's point intersection. The full service metadata and exact response bodies are retained. A source upload ID identifies the public-source loader copy; it is not an HTTP status/header record.

The public service query is dated 2026-10-13. The original 217-HUC12 identifier set is used only for identifier membership. Current publisher polygon intersections do not establish geometrical identity with the separately retained older model-domain polygons. A boundary point can legitimately return multiple polygons; no match and multiple matches remain explicit.

## Tables

derived/point_watersheds.csv has one row per completed source record. It preserves point ID, entity ID, source cohort, coordinate variant, source feature/hash, exact query and response hash, published HUC12/HUC8/HUC10 values, current matches, and comparison fields. Missing published HUC values are labelled no_published_huc12 (or 8/10), rather than counted as a disagreement. Original listed, draft TMDL, July TMDL and agency GIS values are separate columns.

derived/polygon_matches.csv has one row per returned point/polygon pair and preserves the complete original attribute object as quoted JSON. A zero-match point still exists in the point table. summary.json records pending IDs, complete counts, differences, outside-domain matches and the three-representation comparisons for each outfall facility.

Gauge coverage roles remain observed_flow (29 sites: 16 from the original inventory and 13 from the separately retained HUC05–07 calibration source), observed_stage_only (one), and inventory_only (50). Inventory inclusion does not imply a measured discharge series. Outfall geometry roles remain original_state, agency_projected and nldi_indexed; a routing/snapped point is not substituted for the original permitted outfall.


Each table source ID includes its body SHA256 prefix. Successive acquisition checkpoints therefore remain distinct immutable native source editions. The metadata logical_source_id and operation_id identify the continuing dataset; choose the current edition through this manifest rather than replacing an earlier source body under its ID.

## Rebuild

Run from any directory with Node:
```sh
node observations/wbd_station_join_20261013/rebuild.mjs --check
```

The processor verifies every original input and response body before recomputing the tables. Omit --check to write the three derived products from the retained source bodies. The calculation performs no network requests. The native upstate.sources/v1 manifest registers the point crosswalk and all polygon-match rows as ordinary table sources, retaining all original files, core code and capture metadata as companions.

The source capture may be checkpointed during acquisition. Read summary.json and capture-index.json for the exact current counts; pending observations are not given invented watershed assignments.

## Study scope and observed location

The five original lake-study sites remain members of their scientifically selected study. Their original study_huc10 is retained as source_study_huc10, distinct from any publisher's site HUC and from the current official point-intersection HUC12/HUC10. The study-scope comparison does not filter the observed cohort. In particular, SV-840 is described by its original source as Lake Hartwell off the Eighteenmile Creek arm; its current point lies in HUC12 030601010803, while the other four points lie in 030601010602. The study's contextual HUC10 0306010106 is preserved unchanged.

## Complete acquisition findings

All 184 source identities have exactly one current official WBD match from 183 distinct-coordinate requests; no query is pending and no point has zero or multiple returned polygons. All 87 draft-2026 listed assessment HUC12 values agree with these current point intersections. The separate TMDL tables retain their published differences: RS-06190 current/listed 030601030602 versus draft/July 030601030502, and SV-192 current/listed 030601030513 versus draft/July 030601030613.

The original USGS inventory for station 02195000 retains HUC8 03060103; its original NAD83 point intersects current HUC12 030601060105 (HUC8 03060106). The crosswalk keeps the inventory and current point values separately.

Seven of the 13 additional regional calibration gauges have current HUC12 matches outside the separately retained 217-HUC identifier set:

| Gauge | Current HUC12 |
| --- | --- |
| USGS-02196690 | 030601060205 |
| USGS-02196835 | 030601060602 |
| USGS-021968385 | 030601060602 |
| USGS-02197000 | 030601060607 |
| USGS-02197020 | 030601060301 |
| USGS-021973269 | 030601060805 |
| USGS-02197500 | 030601060905 |

These original observed gauges remain in the regional cohort with an explicit membership field. Domain membership is a separate selection from availability of observed flow records.

For each of the four outfalls, all three original-state/agency-projected/NLDI-indexed coordinate variants agree on HUC12. SC0042994 lies in 030601010601; SC0000477, SC0035700 and SC0047856 lie in 030601010602. HUC membership is separate from the retained NLDI upstream/downstream relation to gauge 02186702; sharing a HUC does not replace that network relation.
