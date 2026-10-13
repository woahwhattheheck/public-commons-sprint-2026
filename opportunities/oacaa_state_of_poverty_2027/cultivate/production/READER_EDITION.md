# Reader edition: editorial and operating guide

## What this edition adds

The reader edition turns the existing complete Ohio working sourcebook into a report with a clear reading sequence. It adds nine original narrative sections and eight labeled appendix openings, including a complete dataset directory. All 65 existing statistical sections remain, each exactly once. The resulting report has 82 sections, 102 existing figure mappings and 27 source datasets. The 102 mappings remain attached to their original sections and blocks.

The main text is approximately 2,400 words before the appendix introductions. It covers the statewide income picture; age, race and Hispanic origin; families, work and education; food, housing and essential costs; household assets and poverty duration; county interpretation; change over time; and practical questions for Community Action. It uses the existing source estimates and definitions. Proposed planning questions are identifiable as editorial interpretation.

This is a working report for editorial production. Its title is **Poverty and economic security in Ohio**, with the subtitle **Working report · Statewide findings and complete county evidence**. Its period label is **Principal estimates: 2024 and 2020–2024; other source years stated**. The source document and native report retain their established identity.

## Reading structure

The nine reading groups contain the new narrative and the most useful existing statewide figures. Eight appendices retain the rest of the statistical record:

| Appendix | Contents |
| --- | --- |
| A | Income measures, official thresholds, HHS guidelines, definitions and uncertainty |
| B | All county SAIPE profiles, five-year ACS age profiles and below-twice-poverty directory |
| C | Detailed age, race, Hispanic-origin and published S1701 observations |
| D | Family structure, householder race, work experience and civilian employment |
| E | Household-cost methodology and complete rental income-threshold comparison |
| F | All county child food estimates, local food costs, historical values and release corrections |
| G | Historical income, national SIPP dynamics, asset history and source reconciliation |
| H | Complete statistical dataset directory |

The full order is machine-readable in reader-edition-plan.json. Existing section IDs and block IDs remain unchanged. The sourcebook's original technical notes stay with their tables. The manuscript does not replace the full directories with a selection of counties.

## Source-specific editorial decisions

### Income series and measurement periods

The opening uses the 2024 ACS one-year estimate of 1,467,983 Ohio residents below poverty, or 12.7%. It also presents the corresponding below-twice-poverty count and rate of 3,308,461 and 28.6%. The statewide SAIPE chapter remains separately identified with its 2024 estimates of 1,463,705 and 12.6%, and its own child and median-income estimates.

The county ACS age and income-ratio tables represent the full 2020–2024 five-year period. Their statewide comparator comes from the same five-year release. Neither the main text nor the directory relabels those values as a 2024 snapshot.

The historical comparison identifies income in 1999, measured by Census 2000 SF3, separately from the 2006–2010 and 2020–2024 ACS periods. Annual 2020 gaps remain explicit. The two stated historical differences are exact count subtraction or subtraction of displayed one-decimal rates; the text does not claim significance or causation.

### Populations and overlapping categories

The age narrative uses under 18, ages 18–64 and age 65 or over as the disjoint partition. Under six remains a nested subgroup. The senior denominator contains people below poverty and people at or above it.

Race and Hispanic-origin categories overlap. Family tables classify the householder and count families; the person-based tables count people. “Householder, no spouse present” remains the actual Census category. It does not establish an unmarried status.

Work experience means work during the past 12 months. The separate civilian-employment source addresses a different question and universe. Education rates refer to people aged 25 or older for whom poverty status was determined. None of the descriptive group comparisons is framed as an estimate of a causal effect.

### Housing, food and household costs

Rental availability thresholds are cumulative. Cost-burden rows use separate income bands, and severe burden is a subset of cost burden. Extremely low income retains the federal-poverty-guideline-or-30%-AMI definition, whichever is higher. The Ohio rental deficit is the retained difference of 156,593 available homes minus 422,098 renter households: −265,505.

Food-insecurity income shares use food-insecure people or children as the denominator. Meal cost and annual food-budget shortfall remain overall geographic measures. The main text uses the actual 2024 Ohio figures; the older printed 517,450/20.1% child observation stays identified with 2023 in its source concordance. A corrected source release for 2023 is not presented as a year-on-year change.

The household-cost chapter describes the 2025 technical model, including its child-care assumptions, communications expenses and separate emergency-savings calculation. It supplies no county-specific household budget while those amounts are awaiting selection from the original workbook.

### Assets and poverty dynamics

Asset and liquid-asset rates count households and keep the provider's 2021 label. Ohio 20%/29% and US 19%/27% remain historical descriptive estimates. The final asset normalizer supplies the corrected exact measure names, and preserves raw precision fields without inventing an interval.

The reader narrative uses the original Census definition of episodic poverty for 2017–2019: at least two consecutive months in the 36-month period. Chronic poverty covers all 36 months. The percentages are national and are identified as published historical estimates. Later annual/monthly SIPP corrections remain separately described.

## Applying the plan to the existing report

The original commissioner supplies the actual native report identity. sourceDocumentId in the plan identifies the seed source document; it is not a native workspace UUID.

After the nine existing source plans have been applied, the reader helper resolves the actual report and datasets through the existing Store and ReportRepository. It compares the retained existing-section roster and each exact datasetCells reference, then applies the new sections, presentation fields and complete order through the same original journal transaction.

The plan has 56 claim references and 101 exact source cells for the numerical prose. Each cell records datasetId, rowId, column and the exact string value. Definition-only paragraphs retain source IDs. Four explicit derived claims preserve the operands and results for the displayed historical and housing differences. The helper can identify the specific paragraph affected by a changed source value.

Replaying an already completed reader operation uses its original journal result and preserves subsequent operator edits. When a new source chapter has arrived before first application, compose its section into a successor plan that retains every section; do not drop it to fit the earlier 65-section roster. A later source correction also needs a deliberate narrative update for affected claims, rather than silently replacing prose from a previous edition.

## Editing and source correction

Open the existing report in the Reports and publications editor. Use the main reading sequence for editorial revisions and the labeled appendices for source detail. Tables and charts remain connected to their original dataset mappings.

For a source change, open the original dataset in the data desk, retain the replacement source and review the exact changed cells. Apply the selected table or chart correction through the existing mapping workflow. Then find the corresponding datasetCells entries in reader-edition-plan.json and update each affected narrative claim from the same source edition. Keep its population and measurement period explicit. Ordinary copy edits that change no source claim can be made in the existing report editor.

The draft manuscript file is a human-readable companion for editorial collaboration. It includes all new copy, the full sequence of retained statistical sections and the source links. The authoritative full rendered report continues to come from the existing native report, which holds all original figure blocks.

## Editable source and handover

The reader plan, guide, manuscript and helper are retained as source assets associated with the original reader journal operation. The native supplemental-source export includes their descriptors even when figure mappings still refer to an earlier dataset revision. This is necessary because attaching files only to a newer dataset revision would omit them from an export pinned to the older mapped revision.

The existing editable edition and full workspace export therefore carry the reader source together with the original datasets, statistical responses, plan locks and figure mappings. Reopening the same workspace must preserve the report identity, all 82 sections, source assets and original correction history.

## Actual edition review

Use the existing cumulative receiving operation for the full render, editor and reopen workflow. Review the outgoing digital PDF, print PDF and editable-source archive from the same saved edition. Open actual pages: cover and contents; the first statewide chapter; a page with age or family figures; food and rental figures; every appendix transition; a county-directory page; and the complete source directory. Check that long table rows wrap cleanly, headings stay with their content and sources remain legible.

Operate the original report editor at desktop and narrow widths, save a copy edit, reopen it and verify it remains. Inspect a bound source figure and its data link. Reopen the exported workspace and confirm the same report and reader source are present. Record those actual outputs in the same existing receiving operation.

This source package has been checked for complete section placement, source references, exact cell identities and stated arithmetic. Native rendering and visual review belong to the original receiving workflow; its actual edition determines pagination and layout.

## Files

- reader-edition-plan.json — complete additive manuscript, exact order, source cells and directory.
- READER_MANUSCRIPT.md — the complete new copy in reading order, with every retained statistical section identified and linked source references.
- READER_EDITION.md — this guide.
- sources/Census-SIPP2022-definition-reader.txt — the selected original federal-report definition lines used in the reader narrative.

The final source lock is composed by the original publisher with these exact files and its reader helper.
