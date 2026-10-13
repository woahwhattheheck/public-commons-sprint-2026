# Current USGS watershed intersections for original observation locations

This complete source collection retains 197 original point identities and 196 distinct EPSG/x/y queries. All 197 identities have exactly one current official WBD match. The source includes 87 draft-2026 assessment stations, 67 original regional USGS inventory points, 12 coordinate variants of four NPDES outfalls, five 2023 lake-study stations, 13 additional regional NWIS gauge points and the 13 corresponding NLDI indexed gauge points.

The complete 184-record edition at commit 2e74226eaa12193c2ee44e98ff9f2263e7e48cfe is preserved in this successor. Its interpreted point and polygon rows are unchanged. The added NLDI coordinate variants now supply their own current WBD context for all nine original station-study selections.

## Original sources and coordinate semantics

All 12 input files are retained unchanged under inputs/, with their original relative paths, byte counts and SHA-256 values in query-plan.json. The initial observation sources are from https://chatgpt.com/space/page_7400eac248888191b81f99a91ec01c40 . The additional regional NWIS geometry is the original 30,153-byte calibration_stations_nad83.geojson, SHA 7b3c37a20656ddfcfe630d47b0ebff831f26fa2df70125c31727fadcd4bd62d9.

The NLDI continuation retains the original 21,927-byte source/hydrology-huc05-07-20261013/nldi/derived/stations.geojson, SHA b7df40fc5bfd60cfc526dec7b86c6c71a50f7f98315f0169f3d3e1f70bd81f63. Its original properties retain each NLDI feature URI/hash, reach and catchment linkage, NWIS inventory metadata and daily-discharge series identifier. The full point input and 13 complete source responses are preserved at https://chatgpt.com/space/page_9fed900fa5108191b4d091fe16c4d824 .

Each query sends the original EPSG:4326, EPSG:4269 or EPSG:26917 coordinates to the official WBD service with matching geometry.spatialReference.wkid and inSR. Each point keeps its original cohort, entity, coordinate variant and source properties. Numeric equality between coordinates in different datums does not combine queries. Only identical native EPSG/x/y tuples reuse a response: the assessment and study identities for SV-268 share one original WGS84 point.

Current official source: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6 . The query uses esriGeometryPoint and esriSpatialRelIntersects, requests every original attribute, and keeps all returned polygon matches. returnGeometry=false retains the actual publisher point-intersection result without transferring a second polygon copy. The original layer metadata, complete response bodies, request parameters, retrieval date and source-loader upload identities remain in the collection.

The query edition is dated 2026-10-13. The separately retained 217-HUC12 identifier set supplies the domain-membership column; native study calculations use their separately retained original domain geometry.

## Tables and replay

derived/point_watersheds.csv contains one row per original point identity. It preserves the exact coordinates and source identity, request URL and response hash, original published HUC values, current WBD matches and all comparison fields.

derived/polygon_matches.csv contains one row per returned point/polygon pair and retains the complete original publisher attribute object. The actual 197-row edition has no unmatched or multiple-match point. The source helper also supports both conditions for future source editions.

derived/summary.json contains the complete acquisition counts, original published-value differences, domain-membership records and outfall coordinate comparisons.

Run the complete offline source replay from the application root:

```sh
node observations/wbd_station_join_20261013/rebuild.mjs --check
```

The command verifies every original input and response body, rebuilds both complete CSV tables and the summary, and compares the actual outputs with the retained files. The ordinary model-sources.json binds each table to all original inputs, query metadata and source programs.

## Observed cohorts and exact geometry choices

There are 80 unique regional gauge identities: 29 observed-discharge gauges, one stage-only gauge and 50 inventory-only gauges. The new 13 NLDI coordinate variants describe 13 existing observed-discharge gauges; they retain their source daily-series linkage and do not add new gauging stations or observations.

Every additional NLDI point agrees with its agency-coordinate counterpart on current HUC12. Both coordinate choices remain independently traceable. The station-context integration selects a match only when the saved station's native EPSG and both native coordinate values agree exactly with the queried source point.

The five original lake-study stations remain one observed cohort. SV-840 lies in current HUC12 030601010803; the other four lie in 030601010602. The original study-scope HUC10 0306010106 is retained as source_study_huc10. That study scope is separate from the point's current polygon membership.

## Current spatial findings

All 87 draft-2026 listed assessment HUC12 values agree with the current point intersections. The retained TMDL tables preserve two original differences: RS-06190 has current/listed 030601030602 and draft/July 030601030502; SV-192 has current/listed 030601030513 and draft/July 030601030613.

The original USGS inventory for station 02195000 retains HUC8 03060103, while its original NAD83 point intersects current HUC12 030601060105. Both original meanings remain in the crosswalk.

Seven additional regional gauges have current HUC12 values outside the separately retained 217-HUC identifier set. Both their agency and NLDI coordinate records retain that result, producing 14 outside-domain point identities for seven observed gauges:

| Gauge | Current HUC12 for both coordinate variants |
| --- | --- |
| USGS-02196690 | 030601060205 |
| USGS-02196835 | 030601060602 |
| USGS-021968385 | 030601060602 |
| USGS-02197000 | 030601060607 |
| USGS-02197020 | 030601060301 |
| USGS-021973269 | 030601060805 |
| USGS-02197500 | 030601060905 |

These gauges remain available in the regional observation studies. Domain membership is a separate selection from availability of the original discharge records.

For each of the four outfalls, all three original-state, agency-projected and NLDI-indexed coordinate variants agree on HUC12. SC0042994 lies in 030601010601; SC0000477, SC0035700 and SC0047856 lie in 030601010602. The separately retained NLDI upstream/downstream relation to gauge 02186702 remains a network relationship alongside watershed membership.
