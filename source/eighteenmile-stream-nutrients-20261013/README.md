# Eighteenmile Creek original stream nutrients

This complete source package joins four South Carolina stream monitoring stations to their original WQP nutrient results and the retained NLDI whole-reach basin for USGS-02186702. It supplies the existing observed-context and Published studies workflow with original concentrations, detection limits, dates, sampling activities, source locations and executable coverage tables.

## Original source and coverage

The two complementary publisher date queries contain **589 result rows across 153 activities**, spanning 6 January 2020 through 4 December 2025. Their inclusive query windows are 2020–2022 and 2023–2025. All 63 original CSV fields remain unchanged. The source manifest pins every original URL, byte count and SHA256.

| Original stream station | Results | Activities | Source coverage |
| --- | ---: | ---: | --- |
| SV-233 | 263 | 68 | 2020-01-06 through 2025-11-04 |
| SV-245 | 4 | 1 | 2023-12-14 |
| SV-375 | 185 | 48 | 2022-01-11 through 2025-12-04 |
| SV-376 | 137 | 36 | 2023-01-23 through 2025-12-04 |

The original nutrient characteristics are ammonia (124 rows), nitrate + nitrite (153), Kjeldahl nitrogen (153), phosphorus (153), and nitrogen (6). There are 408 numeric results in mg/L and 181 entries marked `Present Below Quantification Limit`. Each censored entry retains its exact original limit value, limit type and limit unit. A blank measured value remains blank.

Six original `Nitrogen` rows are labeled `Calculated` and have method name `Total Nitrogen`. Each is lower than its same-activity nitrate + nitrite value; two equal the paired numeric Kjeldahl result, and four equal its reporting limit. The normalized `result_type`, method and activity IDs preserve this source inconsistency for the maintained component-consistency analysis. Source values remain unchanged.

The original Seneca station query contains 47 locations: 20 streams and 27 lakes. This package selects the four actual Eighteenmile stream identifiers explicitly; the lake locations retain their separate study/source relationship.

## Geography

All four original WGS84 station points lie within the full-resolution NLDI **whole-reach** basin retained by the existing hydrology source. This is an actual point-in-original-polygon calculation using its 480-vertex exterior ring. The executable supports Polygon and MultiPolygon components, holes and an explicit boundary result.

The original query uses `splitCatchment=false`. USGS documents that a split catchment instead places the local basin boundary at the feature's linear-reference position: [original basin semantics](https://api.water.usgs.gov/docs/nldi/basin/). The `full_reach_basin_relation` column refers to that exact whole-reach source. Preserve this distinction when matching observations to the flow gauge, particularly SV-233 south of the gauge's reported location.

### Original river-network position

Six additional original NLDI responses bind the four published station coordinates to the river network: the gauge feature, the gauge's 100 km upstream-with-tributaries WQP index, and one hydrolocation response per station. Every hydrolocation retains both its provided point and the agency's indexed point. The normalizer checks that the provided coordinates exactly match the original station catalogue before using the indexed location.

NHD ReachCode measures run from 0 at the downstream end to 100 at the upstream end ([USGS linear-reference definition](https://pubs.usgs.gov/fs/2012/3068/FS12-3068.pdf)). The gauge has ReachCode `03060101000042`, COMID `11749433`, measure `53.4049`. SV-233 has that same reach and COMID, but its original indexed measure is `17.172927977358476`: it is downstream of the gauge on the indexed network. Its inclusion in the upstream WQP query follows whole-catchment indexing and does not reverse that precise within-reach relationship.

For different reaches, `indexed_upstream_reach` means the original upstream query includes the exact station ID and its COMID agrees with the station's independently received hydrolocation. The programme never compares numerical measures across different ReachCodes. The new `gauge_network_relation` remains separate from both `full_reach_basin_relation` and `gauge_split_basin_relation`; an indexed network relationship does not supply a point-specific drainage polygon.

`derived/station-network-context.csv` retains every original linear reference, indexed point, comparison, source member and upstream-index match. The station and nutrient tables carry the corresponding network relation into the existing flow-coverage and published-study workflows. Gauge daily means retain their role as regional flow context for these sampling stations.

The normalizer also accepts a retained `original/eighteenmile-gauge-basin.geojson` member declared in `source-manifest.json`. When that precise publisher response is supplied, it adds a separate `gauge_split_basin_relation` column. The maintained native acquisition request is in the original project thread at message 1791864567.609429.

## Reproduce and use the source

Run in any existing Node environment:

```sh
node derive-nutrients.mjs SOURCE_DIRECTORY OUTPUT_DIRECTORY
```

The command verifies every manifest original before deriving:

- `derived/nutrient-results.csv`: all 589 records with exact source-file/CSV-record references, original measured and limit values, fractions, statuses, method IDs, dates, clocks and time zones.
- `derived/station-basin-join.csv`: four original station identities, locations, periods, whole-reach spatial relations and independently sourced network positions.
- `derived/station-network-context.csv`: exact original gauge/station linear references and reproducible upstream/downstream classifications.
- `derived/station-year-characteristic-coverage.csv`: counts by actual station, year, characteristic and sample fraction, retaining quantitation limits and analytical methods.
- `derived/source-summary.json`: complete source counts and the spatial/normalization method.

The published outputs were produced by this complete deterministic derivation from the pinned originals. Its CSV parser preserves quoted commas, embedded newlines and escaped quotes. Output order uses ordinal string comparison.

For the existing observed-context source inventory, retain this full directory beside the original daily-flow source. Join by exact station ID and sampling date and keep source fractions, analytical methods, actual coverage and censoring visible. Nitrogen, Kjeldahl nitrogen and nitrate + nitrite retain their original characteristic identities; any later combined quantity belongs to a separately recorded calculation. Existing native load estimation consumes the actual source observations, selected gauge relationship, source periods and retained flow series.

The complete all-years original query response is also retained on the [engineering source page](https://app.notion.com/p/3f7dd77231008147bfb0d97e296fda3b); the two unchanged date-query files here make the full record set directly readable and reproducible.
