# Published household illustration and dated benchmarks

This complete source cohort preserves OACAA's published 2025 Table 5 and supplies the original government benchmarks needed to describe its comparisons accurately. It contains two editable datasets, all 42 published numerical cells, two report sections and seven original data-desk mappings.

## What the figures describe

The illustration is for two adults and two school-age children. It reports required self-sufficiency income rather than residents' observed earnings. The selected columns are Vinton, Sandusky and Delaware counties. Their published annual amounts are USD 62,713, USD 69,991 and USD 92,596. The publication calls these low, middle and high examples; the complete original county workbook is the source for independently reproducing that selection.

Every monthly component, required hourly/monthly/annual amount and printed comparison remains in the dataset. The dataset's data period explicitly identifies the published 2025 illustration. It is not relabeled as a 2026 household estimate.

## Reconcile the displayed arithmetic

The seven displayed component rows total USD 5,690, USD 6,268 and USD 8,150 per month. The printed required monthly amounts are USD 5,226, USD 5,833 and USD 7,716. Their differences are USD 464, USD 435 and USD 434.

The publication describes the taxes row as net of credits. The displayed numbers nevertheless do not reconcile. Retain the component amounts, printed total and calculated difference. Do not replace a printed total, invent credit components or assign the difference to a particular tax credit. The full workbook and its exact household cells remain the route for resolving the source calculation.

## Match the benchmark years

| Printed comparison | Printed value | Actual primary-source year | Corresponding 2024 value |
| --- | ---: | --- | ---: |
| “2024 Ohio Minimum Wage (hourly)” | USD 10.70 | 2025 non-tipped state rate | USD 10.45 per hour |
| “2024 federal poverty level threshold (annual)” | USD 30,900 | 2023 Census four-person/two-child threshold | USD 31,812 per year |

The Ohio rate applies to employees covered by the state non-tipped rate. The source posters separately identify smaller-employer, under-16 and other exceptions. This cohort retains a statistical comparison; it does not decide an individual employer's legal coverage.

The Census observation is the official statistical threshold for a four-person family with two related children under 18. It does not vary by county and is distinct from the HHS programme guidelines. The original 2023 and 2024 Appendix A cells and Table B-1 cross-year comparison support the source-year correction.

The extra editable columns compare the actual 2024 benchmarks with the published 2025 illustration. Their labels preserve that cross-period scope. They do not recalculate the Self-Sufficiency Standard or imply a 2025 official poverty threshold.

## Source files and reproducible rebuilding

- `sources/HOUSEHOLD_TABLE5_2025.json` preserves the complete factual table transcription, original comparison labels and capture description.
- `sources/HOUSEHOLD_BENCHMARKS.json` retains the four actual government observations, source URLs, exact publication/page/row locators, years, units and population definitions.
- The two JSON datasets are directly loadable by the existing report data desk; their CSV companions use the same string values and source locators.
- `HOUSEHOLD_ILLUSTRATION_CONCORDANCE.json` records each source-year or arithmetic comparison.
- `household_illustration.cjs` reproduces both dataset pairs and the concordance from the two source JSONs using exact integer/decimal arithmetic.
- `household-illustration-plan.json` selects the complete original rows and maps them into two source-specific report chapters.
- The source manifest and lock retain every generated file identity.

Run from this production directory:

```sh
node household_illustration.cjs .
```

The normalizer rejects incomplete county/value rows and preserves all 42 numerical originals. It checks the displayed hourly and annual subtraction, then calculates the component differences independently. It was executed against the retained inputs to produce this cohort; no external provider or model simulation is involved.

## Join the existing report

Apply this separate plan through the current `acs_working.extend` interface after the existing assistance reader operation:

```python
report, illustration_views, illustration_summary = extend(
    store, reports, data, report, production_root, actor, output,
    retained, write_json,
    plan_name="household-illustration-plan.json",
    lock_name="household-illustration-source-lock.json",
    output_name="household-illustration-edition.json",
)
```

Bind the actual existing report object and original Store. Keep the original ACS, family, county, rental, household-method, history, food, measurement, asset, reader and assistance operations unchanged. This plan adds two uniquely named sections and seven mappings in its own source-plan journal identity. A retry uses that same operation and preserves edits to completed records.

The current 90-section edition becomes 92 sections, and 32 datasets become 34. The source-to-table/chart mappings rise from 125 to 132. This cohort adds no new member programme. Include both new dataset views in the original validation, editable-source export and independent workspace reopen so their exact source files travel with the delivered edition.

The six supporting-file entries and cohort-specific originals remain under the existing source attachment limits. The original extender's deterministic asset deduplication retains each original once. Do not change an already-applied plan merely to reorder a reader's saved report.

## Work with a later workbook or corrected edition

Use the actual current data-desk source import and correction workflow when the original Ohio workbook's selected cells are available. Keep this published-table dataset as a historical source edition. A workbook cohort must state its own household selector, worksheet/cell locators, original bytes and actual data year. The calculator's filename alone cannot establish that year.

The 2025 table provides a published antecedent for the three county columns. A later report footer or OCR transcription must be reconciled against its own original page and the selected workbook cells. This source cohort does not silently change that later report.

## Outgoing product use

Carry Bryce's standing rendered-product instruction into the receiving workflow. Open, render, visually inspect and use the exact outgoing report and application at normal presentation and narrow widths. Inspect the actual populated tables, chart labels, page breaks, exports and reopened editable project; view every outgoing attachment as its recipient would. Fix clipping, unreadable labels or broken controls in the actual product. Source checks and captured-but-unviewed screenshots do not replace seeing and operating the result. Use the original receiving operation and focused corrections; do not start a parallel verification product.

## Original publications

- OACAA 2025 report, Table 5: https://oacaa.org/wp-content/uploads/2025/07/2025-OACA-Report-small.pdf
- Ohio 2024 original state poster, hosted by University of Dayton: https://udayton.edu/campus/_resources/files/hr/2024-ohio-mw.pdf
- Ohio 2025 state poster: https://dam.assets.ohio.gov/image/upload/com.ohio.gov/DICO/WageAndHour/DICO_2025_MW_Poster.pdf
- Census 2023, Appendix A printed p.17 / physical p.23; Table B-1 printed p.34 / physical p.40: https://www2.census.gov/library/publications/2024/demo/p60-283.pdf
- Census 2024, Appendix A printed p.17 / physical p.23; Table B-1 printed p.35 / physical p.41: https://www2.census.gov/library/publications/2025/demo/p60-287.pdf

Only factual numerical transcriptions and original analysis are included from the OACAA report. Its complete design, illustrations and prose remain with the publisher. The statistical government observations retain their agency attribution.
