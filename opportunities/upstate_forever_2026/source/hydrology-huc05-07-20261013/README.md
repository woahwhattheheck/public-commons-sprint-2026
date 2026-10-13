# Original HUC05–07 daily discharge source

Operation: A74F-USGS-DISCHARGE-20261013. This package follows A73C's original regional calibration acquisition request and preserves eight complete USGS response bodies (926,648 bytes), their query URLs, retrieval stamps and SHA256 identities.

## Usable measurements

The period-of-record selection contains thirteen USGS daily-mean discharge series under source HUC8 codes 03060105, 03060106 and 03060107. It selects original `data_type_cd=dv`, `parm_cd=00060`, `stat_cd=00003`, with catalogue dates overlapping 2020-01-01 through 2025-12-31. The response includes other parameters for qualifying sites; the selected thirteen original `ts_id` values bind the actual discharge records.

The six complete annual responses contain 26,242 original records and 26,241 numeric values. The original `Rat` value at station 02196690 on 2024-09-24 remains nonnumeric with its provisional `P` qualifier. There are 654 estimated numeric values and 13 provisional numeric values; the provisional nonnumeric record makes 14 provisional source records. All source flags remain present in the daily CSV. Seven gauges contain all 2,192 numeric calendar days. Other gauges retain their original shorter records or gaps.

| Site | Source HUC8 | 2020 numeric days | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---:|---:|---:|---:|---:|---:|
| 02193340 | 03060105 | 366 | 365 | 365 | 365 | 366 | 365 |
| 02193500 | 03060105 | 366 | 365 | 365 | 365 | 366 | 365 |
| 02195320 | 03060106 | 366 | 365 | 365 | 365 | 366 | 365 |
| 02195470 | 03060106 | 0 | 0 | 94 | 365 | 366 | 365 |
| 02196000 | 03060107 | 366 | 365 | 365 | 365 | 366 | 365 |
| 02196485 | 03060106 | 366 | 359 | 363 | 327 | 352 | 365 |
| 02196690 | 03060106 | 366 | 365 | 365 | 365 | 267 | 0 |
| 02196835 | 03060106 | 0 | 162 | 365 | 365 | 366 | 365 |
| 021968385 | 03060106 | 366 | 365 | 365 | 365 | 366 | 363 |
| 02197000 | 03060106 | 366 | 365 | 365 | 365 | 366 | 365 |
| 02197020 | 03060106 | 366 | 365 | 365 | 365 | 366 | 365 |
| 021973269 | 03060106 | 277 | 353 | 347 | 344 | 348 | 365 |
| 02197500 | 03060106 | 366 | 365 | 365 | 365 | 366 | 365 |

## Files and direct use

`source-manifest.json` retains every request and source identity, the complete thirteen selected catalogue rows, original datum information and the retained 217-HUC context. `original/` contains the unchanged expanded site inventory, full period-of-record catalogue and six annual daily source responses. `derived/daily-discharge.csv` contains all 26,242 records with original site, time-series identity, reported text, parsed numeric cfs value when present, qualifiers, original source path and source line. `derived/station-year-coverage.csv` gives 78 station/year summaries; the companion JSON also retains exact missing-date and nonnumeric-date ranges.

Values are daily means in cubic feet per second. Means and ranges in the coverage summaries describe available numeric days only. The calendar denominator includes every day in the named year, including leap days. The summary leaves absent days explicit and counts estimated, approved and provisional observations separately. Use the original qualifiers when selecting data for a particular scientific analysis.

## Original spatial join

The expanded site records expose publisher HUC8 and NAD83 coordinates. The local retained original 217-polygon domain determines exact station inclusion in the model, reporting or utility geography. Its source ID is `upstate-wbd-upstream-domain-20261012`; original compressed body SHA256 `6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9`. The maintained source/water_context/20261013/full-domain-water-context.json carries 217 selected HUC12 identities, including 49 under the three queried HUC8 parents. The source manifest includes those 49 identities and exact original context Git blob `80e9447b1e49c2de479fd24a6a38f766932a903b`. Transform original station coordinates from their declared NAD83 datum into the original domain CRS using the native geometry pipeline, then perform the exact point/polygon join. Preserve boundary cases explicitly.

A gauge's monitoring point and complete contributing catchment are separate spatial selections. The maintained calibration workflow binds the original upstream catchment and its source period to any modeled comparison. The dataset supplies discharge observations for that workflow and supports original-date concentration/flow matching.

## Reproduce the derivation offline

Use Node's standard library:

```sh
node derive-discharge.mjs /absolute/path/to/source-packet /absolute/path/to/output
```

The included module hashes all eight originals before parsing. It understands repeated RDB blocks, checks daily source identity and date, selects exact 00060/00003 columns, retains original `ts_id` and qualifiers, rejects duplicate series/date rows, and reproduces the full CSV plus 78 station/year coverage records. The complete published derivation was run against all eight actual original responses in the available JavaScript runtime; its daily CSV and coverage CSV reproduce the retained outputs byte for byte. All 26,242 source rows retain original paths/line numbers.

## Maintained integration

A73C / OBS12 / AE11 own the existing hydrology/calibration consumer. Shared source operation: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791862394220049 ; completed original delivery: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791863087282239 . The original eight attachments are retained on https://www.notion.so/3f7dd77231008124b767e1dccf8a706e . The adjacent existing source section retains the original 02186702 metadata and legacy/current WQX3 outlet query responses.

Official source format and parameter documentation: https://waterservices.usgs.gov/docs/site-service/site-service-details/ and https://waterservices.usgs.gov/docs/dv-service/ .
