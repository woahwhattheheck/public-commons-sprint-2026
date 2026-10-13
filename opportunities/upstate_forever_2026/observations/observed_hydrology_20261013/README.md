# Upper Savannah observed hydrology and dated nutrient context

Edition: 2026-10-13. Operation: ECOSYSTEM-OBSERVED-HYDROLOGY-20261013.

This edition supplies the existing Upper Savannah native application with observed river flow, original monitoring locations, a USGS upstream catchment, and dated laboratory nutrient measurements. The complete original agency responses and the program that calculates every derived table travel with the source manifest.

## Ready results

The retained 51 daily-flow responses contain 33,459 daily means from 16 USGS gauges for 2020–2025. The processor creates 96 calendar-year summaries, 1,152 calendar-month summaries, and 16 summaries for the published 2023 lake-study window, April 5 through October 17. Eighty-eight gauge-years contain all expected dates. The original inventories contain 67 stream-site locations across HUC8 03060101, 03060102, 03060103 and 03060104; this broader reference inventory supports hydrologic context alongside the separately retained 217-HUC model domain.

At USGS 02186702, Eighteenmile Creek below Pendleton, all 365 daily means in 2023 are agency approved. Their mean is 68.420547945 cubic feet per second (cfs). The corresponding sum of nominal daily volumes is 61,099,554.3868 cubic metres. Dividing by the USGS-reported 48.6-square-mile drainage area gives 485.404729 millimetres of runoff.

The published study window contains 196 approved daily means at this gauge. Its mean is 63.523979592 cfs, median 46.4 cfs, fifth percentile 22.6 cfs and 95th percentile 119 cfs. The maximum daily mean is 687 cfs on April 28; the minimum is 19.2 cfs on October 10. The observed window volume is 30,461,578.14496 cubic metres, corresponding to 242.001668 millimetres over the reported gauge drainage area.

| Year | Eighteenmile mean flow, cfs | Runoff over reported gauge area, mm | Maximum daily mean, cfs | Date of maximum |
| --- | ---: | ---: | ---: | --- |
| 2020 | 112.653005 | 801.398378 | 1370 | 2020-02-06 |
| 2021 | 67.227945 | 476.943893 | 566 | 2021-03-26 |
| 2022 | 67.397808 | 478.148975 | 953 | 2022-01-03 |
| 2023 | 68.420548 | 485.404729 | 1140 | 2023-01-04 |
| 2024 | 73.530082 | 523.083145 | 2170 | 2024-09-27 |
| 2025 | 49.690137 | 352.523156 | 756 | 2025-02-13 |

The 2025 Eighteenmile series contains 336 approved and 29 provisional daily values. Every period table separately counts agency approval, provisional status, estimates and revisions. Coneross supplies 238 observed days in 2023 and has explicit incomplete-period outputs. The Tallulah powerhouse locations retain their original identities so their operating context remains visible when selecting regional comparison gauges.

Chauga above Westminster, USGS 344108083090600, contributes 808 original daily stage values: 80 in 2023, 365 in leap-year 2024 and 363 in 2025. These are water levels in feet relative to the original gauge reference. Their period table keeps coverage and provisional status with each summary.

## Dated laboratory results

Original Water Quality Portal queries return 96 nutrient results from 24 sampling activities at SV-268 and SV-374. All carry the original project identifier SWS-2023 and routine-sample activity type. Each site has twelve 2023 activities. Four original analytes per activity are retained: nitrate plus nitrite, Kjeldahl nitrogen, phosphorus and ammonia. Three other study-site nutrient queries return the complete CSV header with zero nutrient records; their source responses and query coverage remain available.

The SWS-2023 routine nutrient cohort has its own dates. The published special lake investigation contains fifteen study visits per site. The original project and activity identifiers in this edition make those cohorts distinguishable when the full study laboratory records are incorporated.

The mean of twelve quantified unfiltered phosphorus measurements at SV-268 is 0.101 mg/L. At SV-374, three phosphorus results are quantified and nine have a below-quantification condition. The mean of the three quantified values is 0.029666667 mg/L; the explicitly labelled half-limit context mean across all twelve is 0.014916667 mg/L. Those two statistics answer different questions and are separate columns.

For every censored result the original condition, limit type, limit value, limit unit and laboratory method remain in the source and derived table. The processor carries zero-to-limit bounds and a separate half-limit context value. It combines Kjeldahl nitrogen with nitrate plus nitrite from the same original unfiltered sampling activity to create 24 total-nitrogen rows, with bounds and censor counts. Ammonia is already part of Kjeldahl nitrogen.

Each nutrient row includes the Eighteenmile upstream gauge's original daily mean on the same reporting calendar date, plus the original gauge source identifier and record index. This join supplies hydrologic context for interpreting sample dates. The sample station, collection time and reported time zone remain distinct fields. Flow-weighted loads require the appropriate spatial and temporal concentration/discharge relationship; the present outputs supply observed concentrations and upstream daily-flow context.

## Geometry and catchment identity

The 67 station inventory points keep the original NAD83 longitude and latitude values and are declared EPSG:4269. Each feature retains all original station-inventory attributes plus source identity and, where present, scalar 2023 flow coverage. The source inventory spans the four HUC8 queries above.

The Eighteenmile polygon is the original USGS NLDI upstream basin requested with simplified=false and splitCatchment=false. It is the full-resolution union of upstream whole catchments in EPSG:4326. The source NHDPlus COMID is 11749433, reach code 03060101000042 and flowline measure 53.4049. The original gauge-drainage area of 48.6 square miles is a separate attribute. That published area is the denominator used in runoff calculations. Use the polygon's declared whole-catchment extent when making native spatial comparisons.

## Numerical method

USGS flow parameter 00060, statistic 00003 is the original daily mean, in ft3/s. The processor binds each site's actual selected time-series/method identifier from the retained original series catalog and rejects duplicate site/parameter/method/date records. It preserves the original values and agency qualifier arrays, handles original no-data values, and leaves unobserved dates absent.

Daily decimal flow values are accumulated as exact safe integers before division. One cfs equals 0.028316846592 cubic metres per second. A nominal reporting day is 86,400 seconds. One square mile equals 2,589,988.110336 square metres. Observed volume sums the available daily means using those factors. Complete-period volume and runoff fields are populated only when every expected reporting day has a valid observation. Means, extrema, percentile estimates and observed totals retain the actual number of contributing dates. Fifth, median and 95th percentiles use linear interpolation at (n-1)*p in ascending order.

The native model's NDR and SDR outputs retain their existing documented units and area conversions. This edition gives the receiving operator observed hydrology and laboratory context for choosing comparable years, discussing wet/dry conditions, and evaluating source-versus-receptor geography.

## Files and reproduction

* original/: every original response, including all daily values, agency query schemas, series catalogs, inventory tables, gauge metadata, basin geometry, NLDI method page and the five nutrient query CSVs.
* derived/daily_flow.csv: all 33,459 daily means with source-record links.
* derived/calendar_year_flow.csv and calendar_month_flow.csv: 96 and 1,152 period summaries with complete-period fields and qualifier counts.
* derived/study_period_flow.csv: all sixteen gauges during the same 196-day published lake-study interval.
* derived/daily_stage.csv and calendar_year_stage.csv: actual Chauga stage observations and coverage.
* derived/monitoring_stations_nad83.geojson: 67 original site points.
* derived/eighteenmile_gage_whole_catchments.geojson: original full-resolution USGS whole-catchment basin and declared source identity.
* derived/nutrient_results_with_flow.csv: all 96 original nutrient results with same-date upstream flow context.
* derived/nutrient_activity_total_nitrogen.csv: the 24 within-activity TN calculations.
* derived/nutrient_concentration_summary.csv and nutrient_source_coverage.csv: interpretable concentration and source-coverage summaries.
* derived/original_series_metadata.json: retained original daily-series metadata.
* inputs.json: original source URLs, byte counts, hashes, selected series and exact derived-file expectations.
* hydrology_core.mjs: complete standard-JavaScript calculation used on these original sources.
* rebuild_hydrology.mjs: ordinary Node entry point that reads the originals, reproduces the complete fourteen-file derived set, then writes the results into a chosen output directory.
* model-sources.json: the existing application's ordinary upstate.sources/v1 manifest.

From this edition directory run:

```sh
node rebuild_hydrology.mjs --output-dir /absolute/path/to/recomputed-observed-hydrology
```

The calculation core has already run against all original sources in this edition. The receiver CLI checks all source bodies and the resulting derived set before publishing its files.

## Native application integration

Materialize this complete edition under observations/observed_hydrology_20261013 in the current application. Import observations/observed_hydrology_20261013/model-sources.json using Workspace.import_sources. The manifest registers two vector layers and ten tabular sources, with the complete original responses, programs and metadata retained as companions.

The existing all-87-station operation Canvas F0C8Q35VBMY accepts repeated --context-manifest arguments. Add this model-sources.json alongside the published 2023 lake-study and permit-discharge manifests. Its native operator imports the context vectors into the existing regional, four-focus-watershed, Eighteenmile, nutrient-priority and HUC-difference review families, then uses the maintained SpatialReview and SpatialExports implementations to produce actual maps.

Stable vector IDs are usgs-savannah-observed-gauges-2020-2025 and usgs-eighteenmile-whole-catchments-20261013. Native source collection IDs and saved review/map IDs are generated by the receiving Workspace.

## Primary sources

USGS daily observations: https://waterservices.usgs.gov/nwis/dv/

USGS Eighteenmile station: https://waterdata.usgs.gov/monitoring-location/USGS-02186702/

USGS daily statistics service: https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily

USGS station inventory and series catalogs: https://waterservices.usgs.gov/nwis/site/

USGS NLDI upstream-basin method: https://api.water.usgs.gov/docs/nldi/basin/

Original full-resolution whole-catchment request: https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/basin?f=json&simplified=false&splitCatchment=false

Water Quality Portal, original provider: https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/

Published 2023 lake investigation: https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf

Every exact retrieval URL is retained in inputs.json alongside the corresponding original body.
