# Eighteenmile Creek lake arm — original 2023 observations

Edition: 20261013-original-wqp-lake-1. Original SCDES records retrieved from the Water Quality Portal on 2026-10-13. This additive source companion joins the existing published study at `observations/eighteenmile_2023/`.

## Recovered observations

The three original lake stations SV-838, SV-839 and SV-840 have 88 results, each joined to one of 88 original activity records by ActivityIdentifier. The source contains 45 chlorophyll measurements and 43 microcystin records. Five original CSV responses are preserved byte-for-byte, with source queries, hashes and record counts in source-acquisition.json.

| Station | Chlorophyll observations | Mean ± sample SD, ug/L | Microcystin records | Numeric / below reporting limit |
| --- | ---: | ---: | ---: | ---: |
| SV-838 | 15 | 24.097333 ± 8.583679 | 14 | 12 / 2 |
| SV-839 | 15 | 15.415333 ± 7.429485 | 15 | 13 / 2 |
| SV-840 | 15 | 6.065333 ± 1.751321 | 14 | 12 / 2 |

All 45 chlorophyll records use original total sample fraction, 0.3 m depth and ug/L. They share 15 dates from April 5 through October 17, 2023. The exact original activity identifier, local clock time, source timezone and numeric value appear in three-lake-chlorophyll-schedule.csv.

SV-840's 15 original observations give 6.1 ± 1.8 ug/L when rounded to the precision of Table7. This supplies a direct observation count and reproduces the published statistics. Keep the report-extracted count token in its source record and display the recovered observation count separately.

## Original source and temporal support

- [Water Quality Portal service documentation](https://www.waterqualitydata.us/webservices_documentation/)
- [SCDES surface-water data guidance](https://des.sc.gov/programs/bureau-water/aquatic-science/how-scdes-measures-surface-water-quality)
- [Original 2023 lake study, Technical Report 010-2023](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf)

Queries use the current original organization `21SC60WQ_WQX`, exact station identifiers, January1–December31,2023 and CSV format. The three-lake result query contains no characteristic filter, retaining every returned parameter. These returned rows contain chlorophyll and microcystins/nodularin. Read the existing study's published nutrient summaries alongside them, with each parameter and temporal support explicit.

Microcystins retain their independent original dates. SV-838 has no September5 record. SV-839 has an August24 record and no September5 record. SV-840 has an August24 record and lacks September5 and October17. The result counts alone cannot establish matching campaign dates; use activity identifiers and the series-coverage table for joins. Original missing dates stay missing.

Every original clock timezone is `EST`. Preserve that recorded value when showing source times. The normalized tables do not reinterpret those strings as another zone. Station latitude/longitude use NAD83; project from EPSG:4269 through the existing GIS reader for geometry joins. Microcystin activity depth fields are blank in the original response and remain blank.

## Detection conditions, methods and units

Six microcystin rows report Below Reporting Limit, with blank numeric result and blank result-unit fields. Their detection-limit units are ug/L. April5 SV-838/SV-839 use original limit0.1 and method520011; the other four censored rows use limit0.016 and method520019. The original raw tables retain complete method names and authorities.

The normalized table preserves source blanks and detection limits. No numeric substitution is applied. Consumers may display a censored observation as “< recorded limit” with the detection-limit unit while keeping its original value null. Summary statistics requiring a chosen censoring method must retain that method separately from these original observations.

Chlorophyll summaries use the arithmetic mean and sample standard deviation, sqrt(sum((x - mean)^2)/(n - 1)), on all15 original numeric observations per station. Calculations retain full precision in JSON/CSV; displayed rounding is separate.

## Additional SV-268 / SV-374 source responses

The two additional result CSVs retain all 2023 chlorophyll and microcystin records for SV-268/SV-374, 42 rows per parameter. This supports the existing two-station nutrient/flow lane and preserves seasonal and ambient activities together.

Filtering chlorophyll by the fifteen lake dates alone returns sixteen candidates at each station. SV-268 July11 has two original activities (09:50 value15.76 and13:08 value22.77); SV-374 August8 has two (10:54 value10.91 and10:59 value8.64), all ug/L. Their associated microcystin activities also occur at those times. Keep each original activity; the source campaign assignment must identify a specific activity before calculating a15-sample study summary for these two stations. The three lake stations have one chlorophyll activity per campaign date.

## Use in the existing workbench

Import source-manifest.json through the existing source importer:

```sh
python -m model.cli --workspace ACTUAL_WORKSPACE source-import observations/eighteenmile_2023/wqp_20261013/source-manifest.json
```

The manifest retains all original and derived companions together. Use the existing Measurements/source context consumer to show the observations beside the published nutrient summaries and completed watershed scenarios. Join on the original monitoring-location and activity identifiers, with date as temporal context. Each quantity remains a lake concentration with its original units; model export tables retain their own mass/time units and source coverage.

Files:

- `three-lake-stations-original.csv`: three exact station records and original NAD83 coordinates.
- `three-lake-activities-2023-original.csv`: 88 original activities with dates, times, projects and depths.
- `three-lake-results-2023-original.csv`: 88 original measurement records with complete WQP fields.
- `sv268-sv374-chlorophyll-2023-original.csv`, `sv268-sv374-microcystins-2023-original.csv`: all-year additional station responses.
- `three-lake-observations.csv`: sorted88-record working table, preserving values, blanks, units, methods and limits.
- `three-lake-chlorophyll-schedule.csv`: exact45-observation campaign chronology.
- `three-lake-series-coverage.csv`: six parameter/station cohorts, date coverage and full-precision chlorophyll statistics.
- `source-acquisition.json`: original URLs, byte hashes, counts and derivation rules.
- `report-reconciliation.json`: original observations and published-source differences.
- `source-manifest.json`: existing native source-import entry point.
