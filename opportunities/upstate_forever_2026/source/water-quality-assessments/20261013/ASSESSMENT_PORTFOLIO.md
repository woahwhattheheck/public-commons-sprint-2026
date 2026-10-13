# South Carolina assessment portfolios in the existing scientific report

This chapter explains how the published 2024 impairment list and the approved-TMDL support table dated July 28, 2026 differ in the original 217-HUC domain. It joins the existing regional scientific report as one ordered OBSERVED_CONTEXT source. It does not replace the original assessment banks, station maps, source normalization, annual-load chapters or agency methods.

## What the original records establish

The complete retained sources contain 1,516 listed cause records from 1,258 2024 assessment rows and 813 approved-TMDL status records. The original publisher-HUC selection produces:

| Source | Cause records | Distinct stations | E. coli records |
|---|---:|---:|---:|
| Published 2024 impairment list | 108 | 94 | 21 |
| July 28, 2026 approved-TMDL table | 84 | 84 | 84 |
| Combined original selection | 192 | 159 | 105 |

There are **zero** same-station E. coli matches between the selected sources, including a comparison that ignores the original use field. Nineteen stations occur in both publications through different causes, producing 21 cause pairs because SV-268 has three listed causes. The chapter shows all of those stations and source references.

The approved-TMDL portfolio contains 79 E. coli/recreation records marked Not Supported and five marked Fully Supported. Its 45 InTMDL and 39 WnTMDL records are a separate partition. The publisher distinguishes original TMDL sites from later-impaired sites covered by the approved TMDL; that relationship does not identify when a restoration action occurred.

Sixteen exact original report strings occur in the regional TMDL table. Seventy records carry the publisher's dagger, which refers to TMDLs originally written for fecal coliform. The publisher notes the freshwater indicator change to E. coli in 2013. The current cause remains ECOLI; this chapter does not convert indicators, targets or concentrations.

The five Fully Supported records concern the stated pollutant and use. They are not whole-site or whole-catchment certificates, and the table alone does not attribute their condition to a particular intervention.

## Geography and exact matching

The primary selection uses each assessment record's **original publisher HUC12** in the retained 217-code array. No coordinates, nearest-station join, utility service boundary or new polygon intersection is used.

The retained station-identity alternative selects all records for those same 159 station identifiers. It contains 193 records: an additional July 2026 SV-192 E. coli record retains publisher HUC 030601030613, while its 2024 turbidity record retains 030601030513. The former is outside the chosen HUC array. The producer validates this against the original source-selection-boundary.json; neither HUC is corrected or replaced. The alternate count is 85 TMDL E. coli records, and exact E. coli overlap remains zero.

Keys retain the exact source strings:

- Record identity: source_id + id.
- Strict comparison: site + complete original use field + cause_raw.
- Additional E. coli comparison: site alone, after both causes equal ECOLI.
- Shared-station inventory: exact site only, with all differing causes and uses visible.

Original combined-use strings such as AL, REC are not divided into an inferred cause/use allocation. Non-E. coli statewide cause aliases are not harmonized. The separate statewide E. coli comparison has two exact matches, C-075 and C-077; both retain Not Supported and original approval date 10/28/2024. Those examples are outside the regional selection and are never included in its counts.

## Why this is a portfolio comparison

SCDES explains that an approved TMDL can remove a cause from the impairment list even while impairment continues. Thus 21 listed E. coli records versus 84 TMDL-support records is not a change through time in the same cohort. Absence from either portfolio is not assigned Fully Supported.

The original date fields remain separate:

- 2024 publication vintage and the stated 2018–2022 assessment window.
- July 28, 2026 support-status date; no replacement assessment window is inferred.
- Original historical TMDL approval dates.
- Any future action implementation date, which these records do not provide.

The draft 2026 impairment list is not an input. The July 2026 TMDL table is a published status source, not that draft list.

Primary definitions: [SCDES impairment list and TMDLs](https://www.des.sc.gov/programs/bureau-water/south-carolina-303d-list-impaired-waters-tmdls), [published 2024 list](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf), and [July 2026 support table, page 39 definitions](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf).

## Complete retained inputs and outputs

The producer pins the exact bytes/SHA256 of all six original inputs in INPUTS:

- inputs/303d-2024-pdf-table-normalized.json — 1,516 complete original cause records.
- inputs/303d-2024-publisher-pdf-table-text.json — original table representation, 1,258 source rows, pages and line references.
- inputs/tmdl-attainment-native-20260728.json — 813 complete native normalized status records.
- inputs/domain-huc12s.json — original 217 identifiers.
- source-selection-boundary.json — original publisher-domain and exact-station selections.
- sources.json — original assessment-source manifest, retained without replacement.

Each 2024 cause record is also checked against its original table row, cause codes, page, line range and complete row text. The 2024 source SHA identifies that retained table-text representation, not a PDF binary. The TMDL bank's original document SHA is retained separately from the bank file SHA.

New outputs:

| File | Content |
|---|---|
| assessment-portfolio.json | Complete result, exact methods, input hashes, source editions, regional comparisons, original 193-record index and statewide E. coli matches |
| assessment-portfolio-records.csv | All 193 original selected-station records; explicit publisher-domain membership and raw original row fields |
| assessment-portfolio-matches.csv | All 21 regional different-cause pairs and two separately typed statewide matched E. coli pairs |
| assessment-portfolio.recipe.json | Complete readable chapter for the existing scientific renderer |
| assessment-portfolio.sources.json | Importable original-recipe source and every required companion |
| assessment_portfolio.mjs | Repeatable standard Node producer |
| ASSESSMENT_PORTFOLIO.md | Method and maintained report continuation |

No original input is edited. The manifest retains the six complete inputs, generated JSON/CSVs, producer and guide as verified companions. The original source manifest retains its original filename; the chapter uses its own manifest.

## Reproduce with standard Node

From the existing project root:

~~~sh
node source/water-quality-assessments/20261013/assessment_portfolio.mjs
~~~

To reproduce into another directory, preserving all original input companions:

~~~sh
node source/water-quality-assessments/20261013/assessment_portfolio.mjs \
  --root source/water-quality-assessments/20261013 \
  --output /absolute/owned/assessment-portfolio
~~~

The optional --check flag compares all generated outputs with the specified output directory without writing. The producer executes only local original data; it does not query an agency, acquire replacement records or run a model.

## Append to the same regional saved-report course

Source manifest, relative to the project:

~~~text
source/water-quality-assessments/20261013/assessment-portfolio.sources.json
~~~

Source entry: **sc-assessment-portfolio-20261013**, role **OBSERVED_CONTEXT**, recipe **upstate.observed-report/v1**.

Append this manifest to the existing maintained source_tools/receive_observed_scientific_review.py invocation through another --source-manifest argument, preserving the already selected atlas, calendar, seasonal-comparison and actual annual-reference sources in their original order. Use the existing original regional Workspace and authored review selection. Do not substitute a WQP field-only Workspace or invent a completed model cohort.

The maintained runner retains manifest identities and the exact ordered selection, renders through the existing scientific-report-edition engine, creates the existing customer review, exports the review package and backs up/restores that same Workspace. Reopen using its retained delivery-selection path or review receipt; no new report engine or acquisition is required. The source role makes this an additional context chapter, not a new annual or modeled product.

Useful internal review questions are: Are every status and cause interpreted within their original use and source? Does the report keep 192 publisher-domain records distinct from 193 station-identity records? Are the historical indicator, approval date and present status distinct? Can the reader open original records and see why the 21-versus-84 count difference does not establish a trend?

## Inspect the exact outgoing product

The producing native worker must render and open the final combined report and actually LOOK at all relevant PDF pages, HTML, CSV/JSON and original-source links, then exercise saved-edition/customer-review export and reopen. Inspect the populated operator at screenshare width and 390 px where relevant. View actual screenshots; source review, hash checks, DOM counts or HTTP 200 do not substitute for using the outgoing product.

Use plain industrial presentation. Fix clipped tables, overflowing original IDs, broken relative source links or unreadable pages in the existing renderer and owner workflow. The chapter's numerical generation and source peer do not claim that native rendered acceptance has happened. Preserve the current project AGENTS.md owner instruction, including all attachments; keep the existing regional receiving operation.
