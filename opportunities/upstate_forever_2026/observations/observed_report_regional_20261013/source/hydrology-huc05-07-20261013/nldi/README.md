# Original daily-flow gauges and upstream catchment support

This source edition binds thirteen original USGS daily-discharge series to their original NLDI station features and upstream NHDPlusV2 catchment geometries. It contains 26 unchanged publisher responses (831,742 bytes), complete request URLs and SHA256 identities, exact source station/series bindings, portable GeoJSON views, and an offline derivation module.

The source accompanies the complete 2020–2025 discharge edition merged in [PR3038](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3038). The adjacent daily source supplies 26,242 records and 78 station-year coverage summaries. Use the original qualifiers and periods when selecting observations.

## Spatial meaning

Every basin query explicitly sets `simplified=false` and `splitCatchment=false`. The original response aggregates complete upstream catchments, including the entire local catchment associated with the station's source COMID. All original polygon components, holes, vertices and coordinate values remain intact in the derived collection. Native area calculations should transform this source geometry into the selected projected CRS.

The registered gauge location, its measure along a source reach, the whole upstream catchment support and an exact gauge-split support are distinct source selections. The regional context can use the supplied whole-catchment support directly. The maintained annual-load calibration workflow binds the catchment support declared by its original estimator and observation selection. A precise gauge-split response, when received, travels as a separate edition with `splitCatchment=true`.

NLDI geometry uses the publisher's GeoJSON longitude/latitude coordinates. The original NWIS station inventory separately declares each decimal-coordinate datum; those fields are retained verbatim. Original NLDI and NWIS point values remain separate. The module performs no local coordinate transformation or simplification.

## Original station and network identities

| USGS station | Daily series ID | NLDI COMID | Reach measure | Geometry |
|---|---|---:|---:|---|
| 02193340 | 34493 | 6289497 | 31.4872 | Polygon |
| 02193500 | 324274 | 6289757 | 88.313 | Polygon |
| 02195320 | 324277 | 22720339 | 5.8999 | Polygon |
| 02195470 | 344257 | 22720481 | 33.4424 | Polygon |
| 02196000 | 126801 | 11730030 | 88.347 | MultiPolygon |
| 02196485 | 126828 | 22720801 | 61.5346 | MultiPolygon |
| 02196690 | 126845 | 22721689 | 0 | Polygon |
| 02196835 | 34520 | 22725225 | 20.1018 | Polygon |
| 021968385 | 243203 | 22725757 | 0 | Polygon |
| 02197000 | 126852 | 22724061 | 1.4036 | MultiPolygon |
| 02197020 | 34530 | 22725411 | 79.2738 | Polygon |
| 021973269 | 34535 | 22730673 | 17.6444 | MultiPolygon |
| 02197500 | 127079 | 22726585 | 83.8922 | MultiPolygon |

The original source catalog dates and publisher HUC8 codes accompany every binding. These HUC8 inventory selections encompass 49 of the retained model's 217 HUC12 identities. The exact original polygon domain determines the local point and catchment intersections; preserve the reporting, upstream and utility selections from that domain. Original source ID: `upstate-wbd-upstream-domain-20261012`; original compressed body SHA256: `6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9`.

## Files

- `original/<site>.feature.json`: unchanged original NLDI station response, including COMID, reach code, measure and mainstem reference.
- `original/<site>.whole-basin.geojson`: unchanged original full upstream whole-catchment response.
- `capture-manifest.json`: original request parameters, full body identities, exact selected NWIS catalog/inventory rows and original 217-HUC source binding.
- `derived/stations.geojson`: thirteen original point geometries with source and daily-series bindings.
- `derived/upstream-whole-catchments.geojson`: thirteen original basin geometries with a stable `basin_id` and the same station bindings.
- `derived/station-basin-bindings.csv` and `.json`: thirteen full identity records, source periods, datum information, original paths/hashes, geometry structure counts and bounds.
- `model-sources.json`: three complete native source entries, including all original companions and reproducible derivation.
- `derive-basins.mjs`: standard-library Node module that verifies all original hashes and rebuilds the four derived files.

The stable station ID is `USGS-<site_no>`. The whole-catchment ID is `nldi-nwissite-USGS-<site_no>-whole`. Use `basin_id` as the vector identity field for this geometry edition. Original daily series identity remains `ts_id`; a station's ID and its series ID are separate fields.

## Import into the existing Workspace

From the current application root:

```sh
"$PYTHON" -B -m model.cli --workspace "$WORKSPACE" source-import source/hydrology-huc05-07-20261013/nldi/model-sources.json
```

This imports the original files and all companions through the maintained `Workspace.import_sources` API. Native source IDs are:

- `nldi-daily-flow-gauge-locations-20261013`
- `nldi-daily-flow-whole-catchments-20261013`
- `nldi-daily-flow-station-basin-bindings-20261013`

The regional support desk reuses the existing station-geography point/polygon engine and original watershed/network source. A73C / OBS12 / AE11 retain the discharge/concentration and annual-estimator intake; the maintained calibration workflow consumes the resulting original observation and catchment selection.

## Reproduce the derived source views

```sh
node derive-basins.mjs /absolute/path/to/nldi /absolute/path/to/rebuilt
```

The module verifies every original byte count and SHA256, checks exact source station IDs and query choices, retains geometry coordinates, and writes four deterministic outputs. It reuses identical output files and refuses to replace a different edition. The published derivation was executed over all 26 original responses in the available JavaScript runtime.

## Original references and receiving

- [USGS basin and hydrolocation documentation](https://api.water.usgs.gov/docs/nldi/basin/)
- [USGS site-service parameters](https://waterservices.usgs.gov/docs/site-service/site-service-details/)
- [Original NLDI source operation](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791863575555249)
- [Retained original response attachments](https://www.notion.so/3f7dd77231008124b767e1dccf8a706e)
- [Merged daily-flow source](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/7f88511c33ce76d6e30d76cadf8fc21c0d8a28d0/opportunities/upstate_forever_2026/source/hydrology-huc05-07-20261013)
