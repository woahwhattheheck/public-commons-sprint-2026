# Repeated-station E. coli: calendar and measurement support

This is an additional numeric chapter for the original regional scientific report. It uses the complete original utility-focus E. coli source: 730 results from 36 stations over 2021–2025, including 729 routine results and one field replicate. It adds no monitoring station, model run, intervention assignment or revised agency observation.

## Read the result

The retained calculation contains 115 within-measurement-support year comparisons. Four have opposite directions under the all-sampled-day and common-calendar-month weighting:

| Station | Earlier → later year | All sampled-day change | Common-month change |
| --- | --- | ---: | ---: |
| SV-344 | 2021 → 2023 | −1.70833333 | +87.52 |
| SV-344 | 2024 → 2025 | −108.736364 | +63.3571429 |
| SV-833 | 2021 → 2024 | (−∞, −190.571429) | +558.3125 |
| SV-833 | 2024 → 2025 | (+165.471429, +∞) | −159.475 |

All four use original APHA 9223-B and MPN/100mL. Changes are later minus earlier. Display precision above is nine significant digits; exact binary numeric endpoints and their open/unbounded flags remain in seasonal-comparison.json. These are concentration comparisons at observed sampling support, not annual population means, loads, trends or treatment effects.

The original calendar definition has 17 year pairs with identical month sets. This chapter retains those complete original cases and row indices. Exact measurement support also separates original recorded depth, medium/fraction, collection method, value type and QA. This produces 49 support groups, 115 within-group comparisons and 13 identical-month pairs. Blank depth is not inferred to mean the 0.3 m recorded on other samples. No missing month is filled.

The 115 comparisons reuse 476 original routine rows across overlapping years. They are not independent replications. The full original source has 71 rows with an Information Only comment; 17 of those rows enter the repeated-year comparisons. They stay included and flagged under the explicit all-routine selection. No laboratory acceptance decision is inferred. The original field replicate, Not Reported record and single-year support groups remain in the retained index and source CSV.

## Arithmetic and original support

1. Retain the publisher sample date unchanged. Original clock and time-zone strings remain in each record; no UTC/date shift or inferred daylight-saving correction is applied.
2. Partition by exact station, analytical-method context/identifier, original effective unit, fraction/basis, media, value type, result status/qualifier, collection method and recorded depth fields. The effective unit is the original result unit or, for a censored row, its original limit unit. Unit spelling variants are not merged.
3. Within a support group and sample date, average the original routine activity intervals with equal activity weight. Distinct activities remain distinct original records. Then average dates equally for the all-sampled-day mean.
4. For each pair of years, keep only calendar month numbers that occur in both. Average sampled-date means within each month; give each retained month equal weight in each year.
5. Subtract the earlier interval from the later interval. The lower difference is later lower minus earlier upper; the upper difference is later upper minus earlier lower. Open endpoints stay open. Unbounded endpoints stay unbounded.

The physical lower floor is explicitly zero for this nonnegative concentration. A below-reporting or below-quantitation result is [0, original limit), and an above-upper-quantitation result is (original limit, +∞). A reported number with no censoring condition is a point. Unknown combinations are unresolved, and a mean requiring any unresolved row is unavailable. There is no limit/2, zero replacement of nondetects, random draw, confidence interval, p-value or fitted model.

The calendar comparison is a sensitivity description. It cannot match flow, weather, collection day, sample time or unknown depth; it cannot identify an intervention effect. It can show why a future sampling plan should preserve comparable seasonal coverage. The existing Monitoring compiler, cost objective and winter alternatives are unchanged.

## Complete files

- seasonal_comparison.mjs — pure analysis/report functions plus a standard Node command; original-response row verification precedes calculation.
- seasonal-comparison.json — every original row locator, interval, QA comment flag, support identity, daily/monthly mean, all 115 measurement comparisons and all original calendar pairs.
- seasonal-comparison.csv — all 115 comparisons with explicit interval text, support counts and source group IDs.
- seasonal-comparison.recipe.json — current upstate.observed-report/v1 sections, using native typed tables/links.
- seasonal-comparison.sources.json — directly importable upstate.sources/v1 OBSERVED_CONTEXT source.
- The six original response CSVs, source-inputs.json and the complete results-with-provenance.csv are retained as unchanged source companions. They are existing files in this same source directory.

Run from the project root:

~~~sh
node source/ecoli_utility_context/20261013/seasonal_comparison.mjs
~~~

The command verifies the fixed original input byte counts and SHA256 values, compares all 730 composed rows to their original response rows, and rewrites only the four derived JSON/CSV/recipe/manifest outputs. It requires the complete existing source directory and this guide. Importing the retained source manifest requires no Node runtime and performs no arithmetic again.

Original combined CSV: 368,696 bytes; SHA256 b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8. Original responses and request identities are documented in source-inputs.json. The original agency rows are from https://www.waterqualitydata.us/ ; methods remain their original APHA or USGS identifiers.

## Use the existing regional scientific report

Continue the actual regional project b9d5d257-c6bb-4f07-b975-8e8c63705db3 and its existing report operation. Keep the original atlas first, then its completed calendar source, then this additional numeric chapter; retain any explicitly selected completed annual land-cover source in the operator's intended reading order.

~~~sh
python -B source_tools/receive_observed_scientific_review.py \
  --workspace ORIGINAL_REGIONAL_WORKSPACE \
  --source-manifest EXTRACTED_ATLAS/regional-atlas.sources.json \
  --source-manifest ACTUAL_COMPLETED_CALENDAR/study/calendar-report.sources.json \
  --source-manifest source/ecoli_utility_context/20261013/seasonal-comparison.sources.json \
  --review-selection source/water_context/20261013/regional-scientific-review.request.json \
  --title "Upper Savannah — source water, observed seasonal support and Monitoring decisions" \
  --output OWNED_RECEIVING_DIRECTORY_OUTSIDE_APPLICATION_AND_WORKSPACE
~~~

The capitalized paths are the same original owner's actual retained paths, not new host locations. Use the completed calendar source's actual location and all original companions. This extends the same ordered-source → saved scientific edition → existing customer review/export/restore workflow. It does not execute another Monitoring scenario or copy observations into a new scientific case.

The receiver retains a workspace-relative delivery-selection and source-import receipt. Reopen through that retained delivery-selection to preserve source identities after relocation. For the later review-only continuation, use the inner result.review.receipt with receive_scientific_report_review.py --continue-receipt, not the outer workflow receipt.

For the interactive path, import seasonal-comparison.sources.json in the existing Sources workflow and select its saved scientific chapter in SourceReports after the original atlas/calendar. Open the completed edition and use Prepare customer review to enter the existing review/export/response workflow.

## Exact outgoing product acceptance

Source arithmetic here was executed in V8 against every original row. Native rendering remains with the existing regional owner. Apply project owner rule 2026-10-13.1 to the exact outgoing edition: render and LOOK at the populated scientific report on desktop/screenshare and 390 px where relevant; operate source order, original links, save/open, export and reopen/restore. Check the four reversal rows, 17 calendar cases, all 115 comparison rows, interval symbols and source links without losing original digits or units. Use the existing industrial report layout and current measured-width table helper. Correct actual visual/control failures in the producing path; source peer review is not a claim that the final rendered output has been accepted.
