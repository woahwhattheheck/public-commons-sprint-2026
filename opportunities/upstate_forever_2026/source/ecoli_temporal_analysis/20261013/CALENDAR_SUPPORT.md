# Comparing the same station and calendar support

This supplement uses the exact original 2021–2025 routine E. coli inputs and the published interval analysis in this directory. It compares the observed 2021 and 2025 sample medians at each of the eleven stations represented in all five years. Four views are retained per station: all original records or exclusion of explicit Information Only comments, each using all sampled dates or only calendar months sampled in both comparison years.

## A direction reversal in the actual observations

At **SV-833**, using all observed dates gives an interval median of **419.6** MPN per 100 mL in 2021 (9 records) and **387.3** in 2025 (11 records), a difference of **-32.3**.

The eight calendar months sampled in both years are January, February, April, May, July, August, November and December. Restricting both years to those months leaves eight records per year and gives medians of **298.9** and **666.8**, a difference of **+367.9**. The change of direction occurs with the same station, source analytical method and physical unit. Its above-limit records remain intervals in both calculations.

This shows how the observed calendar coverage changes the comparison. Matching calendar months still leaves different sampling days and hydrologic conditions. The calculated differences describe the observed samples; they do not estimate a causal land-management effect or a sampling confidence interval.

## Six stations retained across all years after the explicit comment sensitivity

All eleven stations remain in the original repeated panel. All 2025 observations at its five Georgia lake stations carry an explicit Information Only comment. The comparison records therefore retain the actual absence of 2025 support when that particular sensitivity is selected. Six South Carolina stations remain represented in all five years after the filter.

The calendar-matched 2021–2025 comparisons for those six stations are:

| Station | Records per year after matching | 2021 median interval | 2025 median interval | Difference interval |
|---|---:|---:|---:|---:|
| SV-111 | 9 and 9 | 449.4 | 365.4 | -84.0 |
| SV-833 | 8 and 8 | 298.9 | 666.8 | +367.9 |
| SV-199 | 11 and 11 | 14.6 | 23.1 | +8.5 |
| SV-200 | 11 and 11 | 11.0 | 4.1 | -6.9 |
| SV-344 | 11 and 11 | 121.1 | 54.6 | -66.5 |
| SV-363 | 11 and 11 | 1.0 | 0 to 1.0 | -1.0 to 0 |

All concentrations and differences use MPN per 100 mL. A difference interval containing zero does not resolve the direction from the original reporting limits.

## Files and reproduction

- `compare-calendar-support.mjs` exports `compareCalendarSupport(csv, stationCsv, options)`, importing the existing dependency-free analysis functions. Options choose `firstYear`, `lastYear` and `requiredYears`; defaults use the first/last original years and the full observed-year panel.
- `calendar-support-comparisons.csv` contains all 44 station/filter/calendar comparisons.
- `calendar-support-source-rows.csv` contains all 185 original 2021/2025 observations entering these comparisons, with original file/row/activity identity, reporting status, comments and explicit comparison memberships.
- `calendar-support-summary.json` retains both repeated-panel lists, the methods and the observed direction reversal.

A consumer with the existing original source strings can call:

```js
import {compareCalendarSupport} from "./compare-calendar-support.mjs";
const result = compareCalendarSupport(originalResultsCSV, originalStationMembershipCSV);
for (const [filename, content] of Object.entries(result.files)) {
  // Save or expose these complete derived CSV/JSON bodies in the existing source workflow.
}
```

For each station/method/unit, the function computes the earlier and later median intervals using the original censoring-aware routine. The difference bounds are later-lower minus earlier-upper and later-upper minus earlier-lower. Infinity is represented by explicit unbounded flags. Missing interpretable support stays missing. Calendar month matching is performed after the selected comment filter, and both available and included sample counts are retained.

The full 730-row source was processed in JavaScript to produce this supplement. The original 16-file analysis edition and its hashes remain unchanged. The source input identities and original publisher URLs are retained in `source-manifest.json`.
