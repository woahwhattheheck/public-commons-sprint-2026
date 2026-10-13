# Eighteenmile stream nutrients and flow, 2020–2025

Open `nutrient-flow-study.html` for the complete original-source study, station map, annual/seasonal/flow-cohort selector, same-date contrasts, agency nitrogen reconciliation and downloadable data.

## Scientific result

The study uses **589 original nutrient records, 153 sampling activities on 106 dates, four WGS84 stations and 2,192 daily USGS discharge values**. It reconstructs total nitrogen from the same activity's unfiltered Kjeldahl nitrogen and nitrate/nitrite. All 153 activities have exactly one compatible component pair. Forty-one reconstructed nitrogen values carry a censored component; 35 phosphorus observations are below quantitation.

The 58 shared-date station pairs support 116 nitrogen/phosphorus contrasts. On 23 shared dates, SV-376 has higher phosphorus than SV-375 on 22 dates and lower reconstructed nitrogen on 20. Nineteen dates combine those two directions. Nitrate/nitrite is lower at SV-376 on all 23 dates, while its mean Kjeldahl-N difference stays positive across censor bounds. Component differences reproduce the total-N bounds for every pair. Original sampling clocks differ by 25–49 minutes. The report and exports retain every clock and source selector.

All six original agency `Nitrogen` rows have `ResultValueTypeName=Calculated`. Each equals the original Kjeldahl result or its limit and lies below the compatible TKN+nitrate/nitrite sum. They remain unchanged in the retained original CSV and separate reconciliation export. Their sampling activities report 0.3 m depth; the other 147 activity depths are blank.

## Reproduce

From the application root, with Node 18 or newer:

```sh
node observations/eighteenmile_stream_nutrients_2020_2025/analysis/build_study.mjs --output /owned/new-stream-study
```

The destination must be new and its parent must exist. Node built-ins verify all 12 original byte counts and SHA-256 hashes, reproduce all eleven outputs, and copy the unchanged originals and executable source modules into the new self-contained application layout. No package installation is required. Open `observations/eighteenmile_stream_nutrients_2020_2025/analysis/nutrient-flow-study.html` below the new destination. The report opens offline, its complete source and tables accompany it, and the same relative rebuild command works from the destination root.

The pure `analyzeStreamNutrients(inputs, parseCsv)` API in `analysis_core.mjs` accepts the unchanged source bodies and needs no filesystem or network. `studyOutputs(result, basin)` returns the exact eleven output strings.

## Methods

- Original source records retain activity ID, station ID, date, original clock/timezone, project, depth, fraction, method, value type, reported value, reported unit, limit type/value/unit, original file SHA-256 and one-based data-row number (header excluded).
- Below-quantitation concentrations carry a conservative nonnegative lower bound of zero and an exclusive upper bound equal to the original row's quantitation limit. The limit unit supplies mg/L when the result's own unit is blank. Numeric values retain their reported value. Interval summaries use no point substitution.
- Reconstructed total N is TKN + nitrate/nitrite. Ammonia is already included in TKN. Original WQP weight-basis fields are blank; the nitrogen basis is supported by recorded analytical methods and the primary references linked in the report. The derived value is explicitly separate from the agency's six calculated entries.
- Mean and median bounds propagate source censoring, including endpoint openness. Calculations round to 12 decimals after arithmetic; all original concentration values/limits have at most three decimals. These intervals describe source censoring, not laboratory measurement error.
- Same-date station pairs require the original date and retain both activity IDs and clocks. Station A/B is identifier order. The paired difference is B minus A. Only interval-separated values establish a definite direction.
- Every activity joins gauge 02186702 on its original calendar date. The series is daily mean discharge, parameter 00060/statistic 00003, in ft3/s. Original approved, estimated and provisional qualifiers remain attached. Midrank percentile=(days below +0.5*days equal)/calendar-year days. Quartile Q1 is percentile<25; Q2<50; Q3<75; Q4>=75. Upper-decile dates have percentile>=90.
- Seven-day antecedent mean/max use the preceding seven calendar days and exclude the sample day. Incomplete windows have their observed count and blank statistics.
- Meteorological seasons are DJF/MAM/JJA/SON. Full-period station calendars differ, and SV-245 has only one activity. Cohort summaries are equally weighted observations.
- All four original station points are inside the unsplit NLDI catchment. `splitCatchment=false` is retained in the exact source URL. SV-233 is south of the reference gauge; whole-catchment membership does not establish an upstream network relationship. Gauge flow supplies basin context. Site-specific mass-load estimation requires the corresponding discharge/concentration relationship.

## Output contents

| File | Contents |
|---|---|
| source-result-index.csv | All 589 original result identities, methods, units, limits and source selectors |
| activity-nutrients-flow.csv | All 153 reconstructed/component/P values, original metadata, daily/antecedent flow and original source selectors |
| station-cohort-summaries.csv | 176 station, annual, seasonal and flow-quartile summaries |
| paired-station-contrasts.csv | 116 interval contrasts with clocks, original activity IDs and flow context |
| paired-nitrogen-components.csv | 58 exact paired nitrogen decompositions; component difference bounds sum to each reconstructed total |
| agency-calculated-nitrogen.csv | All six original calculated-N discrepancies, component values and source rows |
| daily-gauge-flow.csv | All 2,192 original discharge observations, qualifiers and exact JSON selectors |
| annual-flow-coverage.csv | Six complete calendar-year flow/sampling summaries |
| study-summary.json | Machine-readable coverage, original station coordinates and computed summaries |
| station-context.svg | Original catchment outline and source station/gauge locations |
| nutrient-flow-study.html | Complete offline study and cohort controls |

The original CSVs retain all 63 agency fields, and the 47-station catalogue is unchanged. Nine unchanged USGS source bodies retain the six daily series, original network reference, station metadata and whole-catchment polygon.

Source collection and original references are in `input-manifest.json`. The package is additive to the maintained Published Studies and observed-context consumers. Its native `upstate.sources/v1` manifest is `eighteenmile_stream_nutrient_analysis.sources.json` at the application root.

## Validation performed

The pure analysis, report and output functions were executed on all twelve retained originals. A separate reviewer independently reconstructed all153 nitrogen intervals, all58 nitrogen contrasts and all58 phosphorus contrasts using exact thousandths arithmetic, checked the six agency-calculated rows, matched all sampling dates to original daily JSON and checked the full original station metadata. Browser script syntax, report links, output/source closure and exact byte hashes were checked. The filesystem CLI is included for native receivers.

The maintained source originals are adopted unchanged from [PR3064](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3064), under `source/eighteenmile-stream-nutrients-20261013/original/`. The analysis reads those exact originals to preserve depth and every activity field. Eight further original gauge companions are retained under this study’s `original/` folder.
