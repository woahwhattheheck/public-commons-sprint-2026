# Eighteenmile 2023 paired observations

The complete descriptive analysis links the existing five-site chlorophyll cohort to original microcystin activities and compares each pair of stations on shared dates. Open [the report](paired-observations-report.html) for the concentration matrix, all ten contrasts, recorded-time match outcomes, interval bounds and complete downloadable tables.

## Original-data result

- 75 selected chlorophyll observations, five stations and 15 dates produce 150 same-date site contrasts.
- The original microcystin campaign contains 85 results over 24 dates: 64 quantified and 21 below their original reporting limits.
- Exact station/date/displayed-clock/timezone matching yields 67 links: 51 quantified and 16 lower-censored. Two same-date records have different clocks; six chlorophyll observations have no same-date microcystin record.
- Those links supply 128 same-date spatial microcystin contrasts across all ten site pairs.
- SV-840 has lower chlorophyll than SV-838 on all 15 dates; mean paired SV-840 minus SV-838 is -18.032 ug/L. For linked microcystin, SV-840 is higher on seven dates, lower on five and unresolved by reporting limits on one.

The agency report describes surface (0.3 m) microcystin sampling alongside chlorophyll in its Cyanotoxins methods and Table 8. Individual selected CHLA records encode 0.3 m; WQP microcystin activity depth fields are blank. Both source facts remain explicit. Original EST labels remain unchanged.

The original normalizer's five station CSVs reproduce the exact analysis obtained from the full 44-file delivery's 920-row normalized table. All 533 original rows in those five responses are retained. The frozen normalizer preserves the source owner's original calendar/clock reconciliation; its original source path and SHA256 are in input-manifest.json. Its derived quantitation-class field is not used by this analysis: original detection conditions, reported numbers, units and reporting limits govern every interval.

## Reproduce

From this directory, with a current Node runtime:

```sh
node build_paired_analysis.mjs --output /owned/eighteenmile-paired-analysis
```

The CLI reads the six retained original files, validates their full bytes and SHA256 values, runs the original cohort selection, executes the paired analysis and emits eleven complete products. Matching outputs are reused; a differing existing output requires a new directory. It uses Node built-ins only and preserves the source files.

The same pure analysis and report functions were executed on the actual original sources in V8. The second-agent original-data calculation independently reproduced all ten chlorophyll-pair means and the 67/2/6 recorded-clock match outcomes. Further receiving review uses these complete original files. The filesystem CLI is the native receiving adapter.

## Native application

The application-root `eighteenmile_lake_paired_analysis.sources.json` declares the generated report and tables with this complete source closure. Published studies extension 1.1.1 (PR2945) discovers that optional manifest. Receive it through the existing study import, source registration, report/export and project/archive reopening flow. All manifest paths are relative to the application root.

Complete-campaign microcystin mean bounds remain in the maintained observation-support module owned by ASTRA13. This contribution supplies date-paired contrasts and co-timestamp support. The original flow-context companion, published report statements, measurement cohort and map providers retain their existing source identities.

## Interpretation

A below-reporting-limit value is represented by [0, limit), under physical nonnegative concentration. Quantified values are point intervals. Paired interval differences propagate both endpoints; an interval wholly above or below zero establishes the corresponding direction for that observed pair. Mean bounds average those intervals over the explicitly shown paired dates. They are not confidence intervals or substituted estimates.

Chlorophyll ratios are calculated per paired date before their summaries. A mean ratio is different from a ratio of means. The report supplies all observations and actual recorded-clock separations. Concentration patterns describe these sampled dates; the native geospatial model supplies routed loads and scenario outcomes.

## Original sources

- [Agency lake report](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf).
- [Complete original 44-file study carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8JNNS1BP).
- [Original agency response collection](https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e).
- Each row in `source-records.csv` retains its exact WQP query URL, original response SHA256 and one-based original data-row index.

All generated comparison tables use `record_id` references into that source table; full JSON preserves every same-date candidate, matched activity, analytical method and interval endpoint.
