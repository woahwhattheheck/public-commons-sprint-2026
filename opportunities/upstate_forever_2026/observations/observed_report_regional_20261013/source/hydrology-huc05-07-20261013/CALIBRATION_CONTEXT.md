# Additional regional discharge calibration context

This is the six-year extension of the maintained Upper Savannah observed hydrology workflow. It uses A74F's eight original USGS responses for thirteen native daily-mean discharge series in HUC8 groups 03060105, 03060106 and 03060107. The original 16-gauge edition remains available with its original source identities. The two inventories select 29 distinct gauges; their periods, native time-series IDs and source geometry remain separate.

## What the retained measurements add

The six original annual responses contain 26,242 source records, of which 26,241 are numeric. The source includes 654 estimated numeric values and 13 provisional numeric values. Horse Creek station02196690 retains the nonnumeric text `Rat` with provisional qualifier `P` on2024-09-24. There are 61 complete calendar-years and all61 contain approved numeric values on every date. The additional context has 78 annual rows, 936 monthly rows and 13 rows for the original lake-study window2023-04-05 through2023-10-17.

The following annual comparison uses each station's complete approved 2023 mean against the median of its other complete approved calendar-year means from 2020–2025. Estimated values already approved by USGS remain included and are counted explicitly. The reference-year count matters: a two-year median and a five-year median describe different retained support.

| Station | 2023 observed mean, cfs | Complete 2023 runoff, mm | Other complete approved years | 2023 / reference median |
|---|---:|---:|---:|---:|
| 02193340 — KETTLE CREEK NEAR WASHINGTON, GA | 22.7272 | 231.153 | 5 | 0.96211 |
| 02193500 — LITTLE RIVER NEAR WASHINGTON, GA | 200.383 | 236.61 | 5 | 0.88291 |
| 02195320 — KIOKEE CREEK AT GA 104, NEAR EVANS, GA | 96.9796 | 315.448 | 5 | 1.5918 |
| 02195470 — UCHEE CREEK AT GA 104, NEAR EVANS, GA | 74.353 | 438.975 | 2 | 1.1776 |
| 02196000 — STEVENS CREEK NEAR MODOC, SC | 496.932 | 314.379 | 5 | 1.1143 |
| 02196485 — AUGUSTA CANAL UPPER NR AUGUSTA, GA | 1601.29 | Unavailable | 2 | Unavailable |
| 02196690 — HORSE CREEK AT CLEARWATER, SC | 224.808 | 500.074 | 3 | 1.0791 |
| 02196835 — BUTLER CREEK BELOW 7TH AVENUE, AT FT. GORDON, GA | 20.4267 | 670.752 | 3 | 1.432 |
| 021968385 — BUTLER CR BELOW BUTLER CR RSVR AT FORT GORDON, GA | 17.8606 | 459.563 | 4 | 1.0158 |
| 02197000 — SAVANNAH RIVER AT AUGUSTA, GA | 8436.05 | 396.816 | 5 | 0.99635 |
| 02197020 — SPIRIT CREEK AT US 1, NEAR AUGUSTA, GA | 24.0913 | 471.956 | 5 | 1.171 |
| 021973269 — SAVANNAH RIVER NEAR WAYNESBORO, GA | 8357.59 | Unavailable | 1 | Unavailable |
| 02197500 — SAVANNAH R AT BURTONS FERRY BR NR MILLHAVEN, GA | 9847.73 | 392.531 | 5 | 0.99481 |

Kiokee Creek's2023 mean is about59.2% above the median of its five other complete years, while Little River is about11.7% below its corresponding median. Stevens Creek is about11.4% above. Savannah River at Augusta and Burtons Ferry are within roughly0.6% of their respective reference medians. These station-specific differences support explicit period and catchment selection in the original NDR/SDR workflow.

Augusta Canal has327 numeric dates in2023 and no reported drainage area in the original station inventory. Its available-day mean is retained, while annual volume, annual runoff and the complete-year comparison ratio remain unavailable. Savannah River near Waynesboro has344 numeric dates in2023; its observed-day volume remains separate from a full-year total. The one available complete reference year at that station does not supply a long-term climatology.

## Numerical and source conventions

The existing hydrology conventions are preserved: discharge parameter00060, daily-mean statistic00003, native TS_ID, calendar dates, cubic feet per second,0.028316846592 m³/s per cfs and86,400 seconds per nominal reporting day. Original decimal spellings are summed using exact integers before floating-point conversion. Percentiles interpolate at(n−1)p on sorted valid daily values. The low-flow fifth percentile is the fifth percentile of discharge, not a95% exceedance label.

Observed-period volumes sum only numeric original days. Full-period volume and runoff are populated only when every expected calendar date has a numeric daily mean. Missing dates and source nonnumeric values have separate counts and ranges. Approved, estimated, provisional and revised flags are counted independently; estimated approved values remain approved. Approved-only observed volume is retained alongside all-numeric observed volume.

Runoff divides the observed volume by the original reported drainage area in square miles, converted using2,589,988.110336 m² per square mile. That quantity describes the gauge's source drainage area. It is not the runoff of a model domain merely because the monitoring point lies inside it. Canal discharge and nested river gauges remain separate series; adding their volumes would double count routed water.

## Geographic use in the retained model

The source site inventory supplies NAD83 coordinates and HUC8 codes. The regional domain contains49 selected HUC12 polygons under these three parents:18 in03060105,8 in03060106 and23 in03060107. `source-manifest.json` retains the exact49 identifiers and original217-HUC domain identity. `derived/calibration_stations_nad83.geojson` retains all13 native monitoring points, source coordinate metadata and the original inventory hash.

The original domain pipeline must transform these NAD83 points into the retained domain CRS and distinguish interior, boundary and outside results. A monitoring-point join and the full contributing-basin overlap answer different questions. The original NLDI basin capture is being joined through its source owner; use its exact point/COMID/reach/measure and full upstream polygon alongside the selected model catchment. Station HUC8 alone does not supply that relation.

For native NDR comparisons, carry the correct catchment area, period and runoff-proxy normalization from the existing calibration guide. Annual discharge helps interpret hydrologic context; nutrient and sediment calibration still uses matching constituent measurements and model export quantities. The retained exact same-outlet WQP nutrient query for USGS02186702 over2020–2025 returned a63-column header with zero result rows. That query result remains in the adjacent source/calibration-coverage/20261013 capture with its exact site/date/category selection.

## Source intake and reproduction

Import `model-sources.json` through the existing Sources intake. It provides the original13 monitoring points, full daily source join, comparable annual/monthly/study-window summaries and2023 reference context. The documentation entry carries every original response, native source manifest, original derivation, current computation and complete output inventory as companions.

Reproduce the added six outputs with Node's standard library:

```sh
node rebuild_calibration.mjs --output-dir /absolute/path/to/rebuilt-context
```

The command verifies the source manifest, all eight original bodies and both calculation modules. It executes the retained original `derive()` reader, preserves original paths and line numbers, and verifies every generated output against `calibration-inputs.json` before writing. The original daily CSV and source coverage products remain unchanged.

Original query URLs, source retrieval stamps, native period-of-record selection and body hashes are in `source-manifest.json`. The daily CSV retains source path and line for every original record. The numerical conventions match `observations/observed_hydrology_20261013/hydrology_core.mjs`; the current model application guidance remains in its `CALIBRATION_CONTEXT.md`.

Annual and monthly tables also retain the volume fraction carried by source-estimated daily values and the fraction carried by days strictly above that period's own daily-flow95th percentile. These are observed-date volume partitions. They help assess the relative weight of qualified or high-flow observations without turning either fraction into a confidence interval.
