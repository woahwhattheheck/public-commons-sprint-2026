# Eighteenmile microcystin Table 8 reconciliation

This source supplement derives a reproducible candidate 73-record report cohort from the original 85-record microcystin campaign. It retains 43 observations at the three special lake stations and uses their 15-date calendar to choose 30 observations at the routine upstream sites. Two duplicate station-dates are separated by the existing selected chlorophyll sample's exact displayed clock and time-zone label.

The candidate reproduces all five published station counts, sample standard deviations and decimal-rounded maxima, plus four of five rounded means. At SV-839 the source mean is 0.050433333333 ug/L; the published mean is 0.051. Rounding individual source values before aggregation is included as a labelled precision sensitivity, because it changes the displayed standard deviation as well. The complete comparison retains source-aware mean intervals and actual reporting limits separately from the caption's fixed 0.008 substitution.

The four original August 24 microcystin timestamps match the respective September 5 chlorophyll clocks at SV-268, SV-374, SV-839 and SV-840. Both dates remain unchanged. This cohort does not change the separate strict 67 cross-analyte links.

## Reproduce

Run from the application root after PR3006 or a compatible successor:

```sh
node observations/eighteenmile_2023/microcystin_reconciliation/build_report_reconciliation.mjs --output /owned/microcystin-report-reconciliation
```

The native CLI uses Node built-ins and the exact retained original normalizer. Six input files are identified by byte count and SHA256 in input-manifest.json. It rebuilds the study selection from the original five CSVs, executes the selection and calculation, and writes seven deterministic files. Existing byte-identical outputs can be reused; different output content requires a new directory.

Open report-reconciliation.html for the source comparison, cohort explanation and CSV downloads. report-reconciliation.json contains the complete result and every selected/excluded source field. selected-original-records.csv and excluded-original-records.csv retain all original normalized columns with a separate selection-reason column.

## Native source import

Import application-root eighteenmile_lake_microcystin_reconciliation.sources.json through Workspace source import. The manifest closes all report/table dependencies, including the six original inputs reused unchanged from paired_analysis. All 85 microcystin record identities and every source SHA remain traceable.

## Source and interpretation

Original agency report: https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf , Table 8, printed page 16 / PDF page 23. The published report describes surface 0.3 m sampling; individual WQP microcystin depth fields are blank.

The report does not identify its individual source activity IDs. Candidate membership is therefore described as inferred. The original source limit is 0.1 ug/L for four selected April 5 results and 0.016 ug/L for the other thirteen censored results. The published caption's fixed 0.008 ug/L replacement is used only for calculation comparison. The primary paired analysis retains original limit intervals.

## Verification

The actual retained normalizer and both JavaScript modules executed in V8 on the original five response bodies. Another agent independently checked all 85 original records and reproduced the 73 selections, 12 exclusions, station statistics, five rounded maxima and four date/clock comparisons. Native Node filesystem execution uses the supplied CLI. No additional runtime dependency is introduced.
