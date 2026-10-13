# Longitudinal poverty sources and working edition

This cohort extends the existing OACAA report-data workspace with actual sources for the annual poverty trend and the county below-twice-poverty directory. It contains three editable datasets, five report sections, eight native table/chart mappings, every retained original source representation and an executable rebuild. Earlier datasets, report plans, original operation identities and saved member proofs remain unchanged.

## Complete received cohort

| Dataset | Measurement period | Contents |
| --- | --- | --- |
| Ohio and United States annual poverty ratios | 2018–2019 and 2021–2024 | Twelve original geography/year observations, plus two explicitly empty 2020 standard-series rows |
| Ohio county poverty and near-poverty ratios | 2020–2024 ACS five-year | Ohio and all 88 counties; all seven disjoint income-ratio bands, total population and original component margins of error |
| Ohio poverty-ratio history | 1999 income; 2006–2010 and 2020–2024 | Three separately labelled statewide source periods |

The datasets contain 106 working rows, including the two deliberate missing-year rows. Populations and sources overlap across datasets; the row count is not a count of independent surveys or populations. The county source contains 1,424 original estimate/MOE cells. The twelve annual observations retain 192 estimate/MOE cells. The original 2000 SF3 table contributes ten counts; the 2006–2010 ACS source contributes eight count/MOE pairs.

Every selected C17002 source reconciles: its seven disjoint bands add exactly to its poverty-determined population. Below-poverty counts sum the under-0.50 and 0.50–0.99 bands. Below-twice-poverty counts sum all bands below 2.00. The latter includes the former.

## Source periods that change the interpretation

The retained OCR transcription of the 2026 report labels Table 11's baseline “2010” and cites Census 2010 in its footer. Its Ohio values are 11,046,987 people in the poverty universe and 2,919,858 below twice poverty, or 26.4%.

The received primary Census table DECENNIALSF32000.P088 identifies the reference as **income in 1999**, collected by the 2000 Census. Its exact original ten counts reproduce those same Ohio values. The working edition retains this benchmark under its actual period. The original report transcription remains unchanged in the source archive; this source arm does not claim a visual inspection of its original page images.

The separately received 2006–2010 ACS five-year C17002 source has 11,199,642 people in the poverty universe, of whom 3,561,514 were below twice poverty: 31.8%. The current 2020–2024 five-year source has 11,512,055 people, with 3,372,969 below twice poverty: 29.3%.

For the two nonoverlapping ACS five-year periods, the below-twice-poverty count changes by **−188,545**, the rate changes by **−2.5 percentage points**, and its relative change is **−7.9%**. These calculations use unrounded counts; they are not obtained by subtracting rounded chart labels. The 1999 benchmark is displayed separately and is not silently substituted into a 2010-to-2024 comparison.

Census comparison guidance allows appropriately qualified comparisons with Census 2000 and identifies differences in reference periods, residence rules, universes and tabulation. This working chapter deliberately gives the like-product ACS comparison its own chart. No causal or statistical-significance conclusion is attached to the descriptive changes.

## Annual trend and the 2020 gap

The twelve received annual sources reproduce these below-poverty percentages:

| Year | Ohio | United States |
| --- | ---: | ---: |
| 2018 | 13.9% | 13.1% |
| 2019 | 13.1% | 12.3% |
| 2020 | Standard estimate unavailable | Standard estimate unavailable |
| 2021 | 13.4% | 12.8% |
| 2022 | 13.4% | 12.6% |
| 2023 | 13.3% | 12.5% |
| 2024 | 12.7% | 12.1% |

The Census Bureau replaced the standard 2020 one-year release with experimental estimates and instructs users not to compare that experimental release with other data. Accordingly, the annual dataset has two empty 2020 rows. Empty numeric values mean unavailable, never zero. The native plan uses bars over available years and a table that visibly retains the gap.

The report's retained Table 8 transcription includes a 2020 column and a noisy footnote. Both remain in the original excerpt; the working standard series makes the missing release explicit.

The actual Ohio annual counts also resolve Table 9: the poverty-determined population changes from 11,362,386 in 2019 to 11,583,778 in 2024, an increase of 221,392. The below-poverty estimate changes from 1,484,862 to 1,467,983, a decrease of 16,879 or 1.1% of the earlier count.

## National redistribution correction

The retained Census Reporter 2024 one-year response differs from the primary Census table in three national cells:

| Variable | Redistributed value | Selected primary value |
| --- | ---: | ---: |
| C17002001, total | 332,143,260 | 332,143,258 |
| C17002003, ratio 0.50–0.99 | 20,321,964 | 20,321,965 |
| C17002008, ratio 2.00 and over | 241,271,520 | 241,271,512 |

The primary table's bins reconcile exactly to 332,143,258. The national 2024 working row therefore uses that complete primary table, including its original MOEs. The unchanged redistribution is retained for the exact comparison. Its Ohio values are selected independently and reconcile exactly; they are not altered by a national correction. The normalizer neither rounds source counts to new integers nor fills a discrepancy by changing one band.

## County concordance

All 89 current geography records retain full Census identifiers. The state row overlaps its 88 counties. Each percentage uses its own geography's poverty-determined population.

Seventy-eight aligned geography rows in the retained Table 11 transcription match the received source in all three checked current fields: population, count below twice poverty, and rate. Ten other aligned rows contain merged, missing or differing transcription cells, and Guernsey's row includes merged footer text. LONGITUDINAL_CONCORDANCE.json retains every inspected original cell, its received counterpart and the exact disposition. These are transcription comparisons, not invented corrections to the original PDF.

The working directory uses the full current source throughout. No missing OCR number is silently guessed from another column, and none of the incomplete historical county captures is presented as a received past-county dataset.

## Definitions and uncertainty

The measure is the Census income-to-poverty ratio, based on Census poverty thresholds. It is not an administrative benefit eligibility decision. The population is people for whom poverty status was determined, not the entire resident population.

The annual series uses one-year estimates; the county directory uses five-year estimates. The 2024 Ohio annual population is 11,583,778, while the 2020–2024 five-year population is 11,512,055. Those different denominators are intentional, source-specific measurements.

All seven ratio categories are disjoint. Below-poverty and below-twice-poverty totals are cumulative and overlap. Ohio is included within the national series. State and county observations overlap. Do not add these overlapping totals.

Original ACS MOEs are 90% values. Derived sums and percentages keep blank MOE fields; component MOEs are retained in the editable data and originals. No interval or significance test is represented as an original published result.

## Rebuild from retained originals

From this production directory:

```sh
node longitudinal_reporting.cjs .
```

The command reads LONGITUDINAL_SOURCE_MANIFEST.json, checks every original input's exact UTF-8 byte length and SHA-256, validates release/year/geography/universe/category identity and population partitions, and rebuilds:

- datasets/ohio-acs5-poverty-ratios-2024.json
- datasets/ohio-poverty-ratio-history.json
- datasets/ohio-us-annual-poverty-ratios-2018-2024.json
- LONGITUDINAL_CONCORDANCE.json

It uses retained files only. No credential, network request or source download is needed. The pure module also exports transform, annualSeries and concordance for the existing source assembly.

longitudinal-working-plan.json registers the three exact dataset hashes and native mappings. Its five sections and eight mappings append to the same original report through the existing extender and a distinct retained plan/lock operation. Earlier completed plans must remain byte-for-byte unchanged. The plan lists its complete source and normalizer files for the editable report archive; the installed extender should deduplicate repeated original-file identities when a file is referenced by both a cohort and the shared source list.

## Staff correction, publication and handover

Use the existing Report data desk to inspect the selected dataset's year, geography, source, column definition and value. Save a correction as a new dataset revision with its note. Preview the affected mapping, explicitly preserve or replace managed staff fields, and apply through the same original report journal. A source correction must not silently rewrite a completed source plan or a saved report edition.

Member copy must name the source period and population. A current below-twice-poverty card can use Ohio's 29.3% from the five-year dataset. An annual-poverty card can use Ohio's 12.7% from the one-year dataset. Those are different thresholds and periods and must not be compared as equivalent rates. Historical copy should name both ACS periods and describe percentage points separately from relative percent.

The same original native receiving operation imports this complete cohort, opens the actual saved report, renders the actual digital/print editions and source-bound member graphics, exports the complete installed workspace and reopens it independently. Before presenting the edition or any attachment, open and visually inspect its exact actual pages and graphics, operate the important desktop and narrow-width controls, download the actual files and reopen them. Capturing screenshots alone is insufficient. Fix visible clipping, layout and control defects in the actual product.

The delivered source archive retains all selected original representations, the national alternate source, the original report excerpts, datasets, exact transformation source, concordance, plan and this guide. Customer materials use the original clean delivery surfaces.
