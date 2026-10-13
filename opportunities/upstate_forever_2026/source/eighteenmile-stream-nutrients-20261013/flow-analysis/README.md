# Eighteenmile stream observations: flow coverage and source components

This complete analysis joins the four-stream nutrient cohort published in [PR3064](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3064) to the maintained A73C original USGS daily-flow edition. It includes executable analysis, all computed tables, a standalone SVG, a complete offline HTML report, and an import adapter for the application's existing observed-water-quality desk.

## Actual source findings

All **589 original nutrient rows** join an original daily record at USGS 02186702. They represent **153 station activities on 106 distinct dates**, with **2,192 daily means** covering every day of 2020–2025. The retained source contains 408 numeric results and 181 presence-below-quantification results.

| Year | Original daily records | Unique sampling dates | Annual P95, cfs | Days at or above P95 | Sampled dates at or above P95 | Water-volume share on those days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2020 | 366 | 12 | 250 | 19 | 1 | 26.3515% |
| 2021 | 365 | 12 | 129 | 19 | 0 | 17.4218% |
| 2022 | 365 | 22 | 142 | 19 | 2 | 24.7478% |
| 2023 | 365 | 25 | 136 | 19 | 1 | 25.3509% |
| 2024 | 366 | 13 | 176 | 19 | 0 | 40.2571% |
| 2025 | 365 | 22 | 102 | 19 | 3 | 22.6389% |

The 65 consecutive high-flow episodes include 58 with no sampled date anywhere in this four-station cohort. The episode table retains every constituent source daily record, source index, date, approval/provisional/estimated qualifier, and sampled/missing station list. Episodes split at year boundaries because their annual thresholds differ.

The most material coverage gap is 2024: none of the 13 sampled dates meet that year's 176 cfs threshold, while its 19 highest-flow days carry 40.2571% of the recorded gauge water volume. This is a finding about the calendar coverage of stream chemistry relative to regional daily flow. It does not estimate unobserved pollutant loads.

## Original chemistry and explicit censoring

Each numeric original value remains unchanged. A blank result reported as Present Below Quantification Limit is represented by a conservative interval from zero through its original reporting limit, with an open upper endpoint. The original detection text, limit type, value, unit, analytical method, result type and row link remain in the result table. No fraction of a detection limit substitutes for a measurement.

The interval means in flow-stratum-concentrations.csv are bounds on the mean of the retained sample values in that stratum. They are not confidence intervals or time-weighted concentrations. Numeric-only medians exclude censored values and use the average of the two central numeric values for an even sample count. Every row states the numeric, censored and unresolved counts.

All 153 activities have one eligible unfiltered Kjeldahl-nitrogen result and one nitrate/nitrite result. The separate component table adds their source intervals. [EPA's nitrogen aggregation documentation](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation) describes the nitrogen component relationship and distinguishes nitrogen mass from nitrate/nitrite compound mass. These WQP source rows report mg/L and retain their specific Lachat method identifiers; the component interpretation is conditional on their shared nitrogen method basis. It does not rewrite the original agency field Nitrogen.

All six original calculated Nitrogen values fall below the paired component ranges. An exact open upper-endpoint match receives a separate at_open_upper_boundary state (with floating-point tolerance) instead of being labeled inside the interval:

| Station | Date | Original Nitrogen, mg/L | TKN + nitrate/nitrite component range, mg/L |
| --- | --- | ---: | --- |
| SV-233 | 2024-02-15 | 0.10 | [0.61,0.71) |
| SV-233 | 2024-03-19 | 0.10 | [0.62,0.72) |
| SV-375 | 2024-02-15 | 0.10 | [0.95,1.05) |
| SV-375 | 2024-03-19 | 0.14 | 1.12 |
| SV-376 | 2024-02-15 | 0.10 | [0.56,0.66) |
| SV-376 | 2024-03-19 | 0.20 | 0.73 |

The original type Calculated, method Total Nitrogen, reported value and original reporting limit remain in component-consistency.csv. The component diagnostic is a separate series with exact source row references.

## Flow, dates and geographic support

The flow context uses the original USGS reporting date rather than converting the source sample clock to UTC. A daily mean and an instantaneous stream sample have different time support; the join retains both original time and time-zone fields. Daily source identifiers, source-values indices and original record indices are preserved.

The original NLDI whole-reach basin response uses splitCatchment=false. All four original WGS84 sample locations lie inside that full geometry. Original NLDI network responses separately resolve linear-reference relationships. On the same original COMID 11749433/reach 03060101000042, SV-233's measure 17.172927977358476 is lower than the gauge measure 53.4049. [USGS NHD linear referencing](https://pubs.usgs.gov/fs/2012/3068/) defines zero at the downstream end and 100 at the upstream end, so this indexed sample point lies downstream of the gauge. The other stations' original hydrolocations and upstream-index membership are retained separately. The analysis stores full-reach polygon membership, source-network relation and gauge-specific split polygon membership in distinct fields and labels flow_location_role as regional_daily_context. It applies no discharge-to-concentration mass conversion.

USGS qualifiers remain exact: A, A|e and P occur in the source edition. The source includes29 provisional days in 2025 and four estimated days across 2021/2025. Annual/monthly tables expose the qualifier counts. Source updates create a new explicitly pinned input edition.

## Coverage mathematics

For each complete calendar year, sort the daily means in ascending order. A nearest-rank percentile at probability p uses the value at one-based rank ceil(pN). Extreme days have Q >= annual P95, including ties. The other mutually exclusive strata are low Q <= P10, middle P10 < Q < P90, and high P90 <= Q < P95. The extreme test has first priority if a tied/degenerate source makes thresholds coincide.

Each plotted daily-flow percentile is a midrank:100 * (number strictly below Q +0.5 * number equal to Q) / N. The flow-duration axis shows100 minus that percentile. Plot positions use log(1+Q) vertically, while axis labels and the original CSV retain cfs.

Flow-volume shares divide sums of equal-duration daily mean flows. The common day length and cfs conversion cancel. Coverage counts a station/date once, or a date once across the network; multiple nutrients and multiple stations do not inflate network sampled dates. The station/year and monthly tables retain the entire queried calendar, including unsampled years and months. They report first and last actual samples so a user can distinguish an absent campaign from a poorly covered active period.

The program verifies a unique gauge record for every day of each complete year and checks each normalized measurement against its exact original WQP source-file/row identity. Paired components require unique eligible measurements within a station/activity/project and matching original activity time.

## Reproduce the complete analysis

Use the complete public application source, including the original hydrology cohort and merged PR3064. From opportunities/upstate_forever_2026:

```sh
node source/eighteenmile-stream-nutrients-20261013/flow-analysis/analyze-stream-flow.mjs
```

A separate output directory receives all analysis results plus the source manifest, input manifest, guide and executable adapters, so every offline report link resolves. The program defaults to its own analysis directory for outputs and the actual application root for inputs. To write a separate output directory, provide the application root followed by the output directory:

```sh
node source/eighteenmile-stream-nutrients-20261013/flow-analysis/analyze-stream-flow.mjs /absolute/application /absolute/analysis-output
```

The input-manifest.json lists five exact source dependencies and verifies every UTF8 byte length and SHA256 before calculations. Its original hydrology daily table is 2,273,280 bytes, SHA-256 59df488cc9820a6eef7750d6938cf91573f701c8ad4683a6c102ec26c7a04863. The parser and calculation kernel have been executed against all actual retained input rows in the available JavaScript runtime. Parent independently reproduced annual thresholds, sampled-day counts, volume shares and 65/58 episode totals directly from the original daily table.

## Native print figures

The retained standalone SVG and embedded HTML contain the complete actual calculation. For a native publication export, the supplied Matplotlib renderer verifies the original daily dependency and the retained activity/threshold tables, then writes an A4 six-panel PDF, SVG and PNG plus their byte/hash manifest:

```sh
python -B source/eighteenmile-stream-nutrients-20261013/flow-analysis/render_flow_figures.py --application /absolute/application --output /absolute/print-figures
```

The renderer uses the same daily values, unique sample dates, midrank exceedance positions and log(1+cfs) scale. It keeps vector text in PDF/SVG, the source P95 values, and the regional-context interpretation.

## Adopt in the existing application

The ordinary model-sources.json registers the measured table and all companion analysis files. With the current observed-context importer/core (point dates, context constants and censored-series support), run:

```sh
python -B source/eighteenmile-stream-nutrients-20261013/flow-analysis/import_into_workspace.py --workspace /absolute/existing/workspace --output /absolute/import-receipt.json
```

The adapter checks the complete source cohort, imports it with Workspace.import_sources, and returns the actual supplemental source collection for the existing stream study/report. This preserves an already adopted stream observation collection. On a workspace that needs these original point editions, add --import-measurements to bind two explicit recipes through Workspace.import_observations: 589 original measured/censored rows and 153 component-diagnostic rows. It records returned source/observation IDs in the durable receipt. Original observation_unit takes the detection-limit unit only for blank censored results; original result-unit and limit-unit columns remain untouched. The optional measurement recipe maps quantitation_class=censored_below and the original detection-limit column for the maintained series view.

The component edition selects only fully numeric paired values for its numeric column. All original lower/upper endpoints remain in the same retained table. Both recipes declare context value basis and original-sample time support. Annual-reference calibration continues to use the separately qualified annual-load editions.

## Existing stream study composition

The complete original stream study in observations/eighteenmile_stream_nutrients_2020_2025 retains its paired station-date chemistry and observation collections. This package supplies complementary calendar/high-flow coverage. Its ordinary source collection and complete report can be selected in that existing study while reusing the adopted measurements. The chemistry checks here are independently reproducible source diagnostics; the annual coverage, flow-duration figures and 65-episode inventory are the new scientific additions.

## Files

- report.html — complete offline interpretation and tables, with the original SVG embedded.
- flow-duration.svg — six original calendar-year duration curves and 106 unique sample dates.
- nutrient-flow.csv — 589 exact result rows with source identity, censor bounds and daily-flow join.
- activity-flow.csv — 153 activity rows; each retains its complete original nutrient-row references.
- nitrogen-components.csv — 153 same-activity component diagnostics and exact component source links.
- component-consistency.csv — six original reported Nitrogen rows and their paired component comparisons.
- network-year-flow-coverage.csv — six complete annual network summaries.
- station-year-flow-coverage.csv — 24 station/calendar-year summaries.
- monthly-flow-coverage.csv — 360 network/station calendar-month summaries.
- flow-stratum-concentrations.csv —source-bound descriptive concentration ranges and numeric-only medians.
- high-flow-episodes.csv — 65 consecutive high-flow episodes with full original daily-record references.
- flow-thresholds.csv —exact original year-specific nearest-rank thresholds.
- analysis-summary.json —machine-readable counts, annual findings and methods.
- input-manifest.json —the exact original and maintained dependency identities.
- model-sources.json —ordinary source admission manifest.
- render_flow_figures.py — native Matplotlib PDF/SVG/PNG rendering with original-source verification.
- analyze-stream-flow.mjs and import_into_workspace.py —complete reproducible calculation and existing-workspace adoption.

## Primary sources

- [USGS 02186702 original gauge](https://waterdata.usgs.gov/monitoring-location/USGS-02186702/).
- [Water Quality Portal](https://www.waterqualitydata.us/); exact original queries and rows are in the parent source package.
- [EPA nitrogen aggregation and chemical mass basis](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation).
- [Merged original four-stream source edition](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3064).
