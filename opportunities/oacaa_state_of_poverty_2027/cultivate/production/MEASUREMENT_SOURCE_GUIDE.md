# Measurement reference: thresholds, guidelines and published poverty dynamics

This source cohort extends the existing Ohio working report through its original dataset desk and separate report-plan operation. It supplies complete, editable source tables for original report Tables 1–3, plus the HHS reference schedule that makes the distinction between a statistical poverty threshold and an administrative poverty guideline explicit.

## Included material

| Dataset | Complete source coverage | Working rows |
| --- | --- | ---: |
| Official poverty thresholds, 2024 | Every one of the 48 applicable Census dollar amounts, arranged in the original eleven family/age rows | 11 |
| HHS poverty guidelines, 2024 | Eight published household sizes for the contiguous states/DC, Alaska and Hawaii, with the original additional-person increments | 24 |
| Official and supplemental measure comparison | Eight source-specific definitions covering units, resources, thresholds, updating, geography, universe, time series and direct comparison | 8 |
| Published SIPP poverty dynamics | Thirteen population groups in each of two 24-month periods and all eighteen groups in the 36-month Figure 5 | 44 |

The 87 rows have different meanings. Threshold and guideline rows describe reference amounts, eight rows contain method definitions, and the 44 SIPP rows overlap across periods and demographic groups. They are never added into a single population total.

The plan contains seven complete report sections and ten native table/chart mappings. It splits the wide threshold grid into two readable tables while retaining every original amount. Both full 24-month group tables and all of Figure 5 remain available in the report; the source data also retain the counts and original 90% confidence half-widths printed in the 2019 working paper.

## Primary sources and periods

1. **Census Bureau, Poverty in the United States: 2024**, published September 2025. The threshold grid is Appendix A, printed page 17 / physical page 23. The OPM/SPM comparison is on printed pages 2–3 / physical pages 8–9. URL: https://www2.census.gov/library/publications/2025/demo/p60-287.pdf
2. **HHS, Annual Update of the HHS Poverty Guidelines**, 89 FR 2961–2963, document 2024-00796. The notice gives a January 11, 2024 applicable date unless the administering programme specifies another date. URL: https://www.govinfo.gov/content/pkg/FR-2024-01-17/html/2024-00796.htm
3. **Census Bureau, SEHSD Working Paper 2019-38**, issued November 12, 2019. Tables 1–2 on printed/physical pages 20–21 contain the complete published 2011–2012 and 2013–2014 episodic/chronic tables. URL: https://www.census.gov/content/dam/Census/library/working-papers/2019/demo/SEHSD-WP2019-38.pdf
4. **Census Bureau, Poverty Dynamics: 2017–2019**, P70BR-179, issued September 29, 2022. Figure 5 on printed/physical page 7 supplies eighteen published pairs of chronic and episodic rates. URL: https://www.census.gov/content/dam/Census/library/publications/2022/demo/p70br-179.pdf
5. **Current SIPP processing-correction notice**: https://www.census.gov/programs-surveys/sipp/tech-documentation/user-notes/2022-usernotes/2022-soc-sec-proces-err-impct-pov-est.html
6. **Corrected annual/monthly table index**: https://www.census.gov/data/tables/time-series/demo/income-poverty/correct-annual-montly-sipp-pov-2014-2022.html

The original reader extracts are complete for the selected tables and carry line/page locators. Their manifest identifies the representation explicitly. They are not substituted PDF byte files. The source register retains the original official URLs for obtaining each complete publication.

## Corrections and interpretation

### Threshold grid

The selected original Census grid has **$16,320** for one person under age 65 and **$15,045** for one person age 65 or older. The retained original-report OCR has an empty first cell and reads $15,050 in the second. The concordance records those exact representations without treating OCR alone as a visual inspection of the report. The remaining 46 applicable dollar amounts match the official grid.

For a four-person family with two related children under 18, the **2024 statistical threshold is $31,812**. The **2024 HHS guideline for a four-person family/household in the contiguous states and DC is $31,200**. These are different published measures. The historical guideline schedule is not an individual benefits-eligibility calculator: programmes specify the applicable date and how income and household size are defined.

The Census threshold grid has 48 applicable values. Blank cells are not applicable, not zero. The nine-or-more family row and eight-or-more children column preserve the original open-ended categories. A weighted-average poverty threshold is not substituted for a family-specific cell.

### Official versus supplemental measures

The comparison retains the correct resource-sharing units and statistical universes. In particular, SPM includes unrelated children under 15; the Census report uses **official+** for direct comparison by adding those children to the official universe and assigning the household reference person’s official poverty status. The supplied definitions are paraphrases tied to exact original locations.

The statistical thresholds do not vary geographically. SPM accounts for housing tenure and geographic housing-cost differences. HHS separately publishes the contiguous-states/DC, Alaska and Hawaii schedules. Each distinction stays with its own dataset.

### SIPP duration and source edition

The original report’s retained Table 3 labels both measures as covering 24 months across all three periods. The primary publications identify:

| Observation period | Months | Published episodic rate | Published chronic rate | Source |
| --- | ---: | ---: | ---: | --- |
| 2011–2012 | 24 | 27.1% | 5.0% | 2019 working paper, Tables 1–2 |
| 2013–2014 | 24 | 27.5% | 6.4% | 2019 working paper, Tables 1–2 |
| 2017–2019 | 36 | 27.1% | 3.3% | 2022 report, Figure 5 |

The 2013–2014 chronic cell is absent from the retained original-report transcription; the source working paper supplies 6.4% and its 0.3-percentage-point 90% confidence half-width. The 2019 working paper cannot support the 2017–2019 column; that column has its own 2022 publication.

An episodic spell requires at least two consecutive months in poverty. Chronic poverty requires poverty in every month of the relevant window. A longer observation window changes the opportunity to enter or remain in poverty, so the plan separates the 24- and 36-month periods and does not draw a single equal-duration trend. All SIPP estimates are national, not Ohio estimates.

The 24-month source holds demographic characteristics at the start of each period and requires participation in all 24 months. The 36-month figure measures age as of December 2019; its education groups cover adults age 25 and older. Hispanic-origin categories overlap race. Chronic poverty is a subset of episodic poverty.

### Later Census processing corrections

The current Census notice explains that gross Social Security amounts in earlier SIPP releases double-counted Medicare deductions. Census corrected the released microdata on **July 24, 2025**. Its separately published **February 2024** post-hoc replacement tables cover annual and monthly rates; the current index expressly says those tables predate the July 2025 fixed microdata.

This package accurately labels the chronic/episodic rates as their **published historical editions**. It does not apply an annual-rate adjustment to a multi-month statistic. A subsequent recalculation must use the corrected source microdata, original longitudinal sample definition, weights and uncertainty method. The two actual replacement workbooks are linked in the retained index:

- https://www2.census.gov/programs-surveys/demo/tables/income-poverty/annual-poverty-sipp-2013-2021.xlsx
- https://www2.census.gov/programs-surveys/demo/tables/income-poverty/monthly-poverty-sipp-2013-2021.xlsx

Their normal source-extraction stage can add them without changing the meaning or operation identity of this historical reference cohort.

## Rebuild the editable datasets

From this production directory, run:

```sh
node measurement_reporting.cjs .
```

The command verifies every selected source file against its UTF-8 byte length and SHA-256 in `MEASUREMENT_SOURCE_MANIFEST.json`. It parses the retained official threshold and SIPP reader lines and the HHS schedules, then writes the four complete dataset files under `datasets/`. Every cell stays a string. Missing counts and confidence intervals in Figure 5 stay blank.

The parser preserves source edition, period, months, population label, units and original locators with the values. No network access, credentials or installed statistical package is needed for this transformation.

## Join the existing report

Use `measurement-working-plan.json` with the current existing report extender and its own new measurement source lock. Keep the original SAIPE, ACS, family, county, rental, household and historical plans unchanged. This plan’s source files appear in the relevant cohort.originals lists; sharedOriginals contains only the shared concordance, source manifest, normalizer, guide, original-table transcription and plan. The existing deduplication retains one copy of shared files.

Open the same installed dataset desk to review the four imported sources, original cells and correction notes. Preview each selected table/chart before applying it to the existing working report. The two threshold tables together reproduce all 48 applicable cells. The HHS report table selects the eight contiguous-states rows; the other two schedules stay in the editable source. The full reference tables preserve the complete dynamics populations, confidence widths and edition notes.

Use the original report’s rendered PDF/page review, member-content review where applicable, source-retaining editable export and complete workspace export/reopen. Inspect the actual produced pages for table fit, all threshold headers, footnotes, number formatting and the visible 24/36-month distinction. Keep Bryce’s rendered-product instruction in the existing receiving sequence; source publication is followed by that same cumulative product run.

## Reuse and attribution

The selected Census and HHS material consists of U.S. government statistical publications. Preserve their titles, periods, URLs and table/figure locations. The original Ohio report excerpt contains only the selected statistical table transcription, retained for concordance with attribution to OACAA. No private relationship, contact, account or internal coordination information is part of this public source cohort.
