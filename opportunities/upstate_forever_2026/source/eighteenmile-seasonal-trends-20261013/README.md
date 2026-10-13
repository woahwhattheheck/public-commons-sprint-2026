# Eighteenmile Creek: seasonally matched nutrient trends

A complete scientific continuation of the original four-stream nutrient and daily-flow study. Open `report.html` for the offline working study. It retains every original record, exact source downloads, editable scientific selections, leave-one-year-out influence, and source-bound working notes. Source collection is separate from the original native NDR/SDR runs.

## What the analysis asks

Does concentration direction remain the same when comparing the same station, constituent, analytical method and season? How much of an apparent result depends on quantitation limits, uneven seasons, a particular year, or different sampled-flow context?

The source contains the unchanged 2020–2025 WQP nutrient cohort at SV-233, SV-245, SV-375 and SV-376, together with original USGS 02186702 daily flow. The builder verifies exact original source fields and the existing daily-flow joins before producing the study. Every agency CSV record and retained daily source index remains available. The original calculated Nitrogen series is kept separate from other constituents and from the existing paired-component diagnostic.

## Scientific computation

The primary grouping includes station, characteristic, fraction, mg/L unit, analytical method and context, result type, sampling activity type, sample medium/subdivision, depths, chemical/physical bases, and collection method/equipment. Administrative project labels are retained but do not artificially split otherwise comparable results into separate years.

A reported numeric value is a point. A blank `Present Below Quantification Limit` result with a positive original mg/L quantitation limit is `[0, limit)`. Other numeric interpretations remain unresolved. The analysis never assigns zero, half a limit, or a random value to a censored observation.

Within each cohort, the primary calculation uses one interval median per sample date, then one interval median per calendar month and year. Missing months remain absent. Same calendar months in distinct years form comparison pairs. For an earlier interval `[a,b]` and later interval `[c,d]`, separated by `t` calendar years, the possible pair slope lies within `[(c-b)/t, (d-a)/t]`. The median of lower endpoints and the median of upper endpoints form a conservative closed outer envelope for the median pair slope. Shared observations can make this conservative rather than sharp. Open detection-limit endpoints remain exact on the original records; the computed closed hull deliberately does not make strict claims at a zero boundary.

All-positive or all-negative envelopes identify the direction of this sampled-data estimator under the supplied censoring bounds. They are not statistical confidence intervals, significance tests or causal findings. No between-year pairs means no estimated slope. The six-year requested period is not six years of complete sampling at every station.

The original February and March 2024 rows at three stations have an explicit 0.3 m activity depth where surrounding records leave that field blank. The primary study keeps those recorded-depth cohorts separate. An explicit depth-metadata sensitivity combines the recorded and unspecified depths within the same other method dimensions, preserving the original fields and without asserting equal actual depth.

The source follows the same-season comparison motivation in Hirsch, Slack and Smith (1982), but this interval-envelope exploration is not represented as a Seasonal Kendall hypothesis test. Short records, dependent pairs, varying limits and missing seasons are made explicit instead of assigning an independent-pair p-value.

## Flow and selection sensitivity

The optional maximum flow ratio compares the medians of original gauge daily means on sampled dates in each paired season. This restricts calendar comparisons to more similar regional flow context. It is not a fitted flow-adjustment model or colocated instantaneous sample discharge. SV-233's indexed point is downstream of the gauge on the same reach; other station/gauge relationships retain their original fields. No concentration is multiplied by regional flow to manufacture a load.

The working study compares monthly, quarterly and annual grouping; flow ratio at most two; numeric-only source rows; and dates with approved, unestimated daily gauge observations. It also removes each observed year in turn. Primary inputs include final, unqualified, interpretable results. An exclusion list retains every omitted original record and the reason.

## Use and save the working study

Choose a station, comparable constituent/method, year range and seasonal grouping. Controls recompute the complete selected analysis locally using the same `trend-core.mjs` that generates the retained tables. Open source records to see all original WQP fields and the daily-flow link.

`Save working study` downloads a small JSON file containing the exact source fingerprint, scientific selection and notes. `Open saved study` accepts only a matching source edition and asks before replacing unsaved notes. `Save complete working HTML` carries the entire source dataset and original files with the current selection and notes, so the working copy reopens offline. No browser account or external service is required. An invalid imported study leaves the current work unchanged.

Downloads include current analysis JSON, exact pair CSV, complete sensitivity CSV and original input bytes. Numeric negative slopes remain numeric in generated CSV; text formula cells are escaped. Original agency CSV downloads preserve their exact retained bytes.

## Rebuild from the original application

Node.js 18 or newer and the complete retained source application suffice:

```sh
node build_study.mjs /absolute/original-application /absolute/new-study-directory
```

The selected original edition is explicit in `build_study.mjs`. A different source edition needs an intentional updated input contract. Output directories are create-only. The standalone browser and native source table use the same central calculation kernel.

## Import into the existing scientific Workspace

The native adapter registers one typed `OBSERVED_CONTEXT` scientific document and its complete companions through `Workspace.import_sources`, then renders through the existing `model.observed_report_render` formatter:

```sh
python -B import_study.py \
  --application /absolute/complete-application \
  --workspace /absolute/existing-workspace \
  --source /absolute/complete-seasonal-study \
  --output /absolute/new-native-trend-delivery
```

The delivery records the actual source collection, project and observed-report selector. Repeating that same import output reuses its retained collection and completed report. Add its `observed_context_source` to the existing ordered report-source selection to compose it with the stream/hydrology, chemistry, community and native-model scientific reports. The adapter does not replace or re-import the original 589 measured rows as new observations and does not create calibration references from concentration trends.

## Files

`report.html` is the complete working study; `dataset.json` carries the identical source-bound computation inputs. `analysis.json` retains all default cohort analyses and sensitivity. `seasonal-trends.csv`, `seasonal-pairs.csv`, `seasonal-bins.csv`, `sensitivity.csv`, `leave-one-year-out.csv` and `source-records.csv` expose every computed row. `observed-report.json` and `sources.json` are the native scientific document and admission manifest. `retained-inputs/` contains the unchanged source dependencies. All executable sources, the input manifest and file inventory travel with this edition.

## Primary method references

- Hirsch, Slack and Smith (1982), Techniques of trend analysis for monthly water quality data: https://pubs.usgs.gov/publication/70011649
- Hirsch and Slack (1984), A nonparametric trend test for seasonal data with serial dependence: https://pubs.usgs.gov/publication/70012890
- Schertz and others (1991), ESTREND and reporting-limit handling: https://www.usgs.gov/publications/computer-program-estimate-trend-estrend-a-system-detection-trends-water-quality-data
- Original WQP service: https://www.waterqualitydata.us/webservices_documentation/
- Original daily-flow location: https://waterdata.usgs.gov/monitoring-location/USGS-02186702/

## Concentration chart

The original numeric results and detection-limit stems remain visible together. Linear and square-root spacing are display choices only; tick labels always show mg/L, and no scientific values or comparisons change. On narrow screens the chart scrolls at a readable width. Both saved JSON and full working HTML retain the selected chart scale.
