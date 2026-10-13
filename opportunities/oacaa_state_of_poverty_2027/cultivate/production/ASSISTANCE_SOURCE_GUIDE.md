# Ohio assistance, health coverage and labour source production

## Complete delivered source

Five editable datasets contain 442 observations: 89 labour-force rows with two release vintages, 90 health-insurance rows, 88 HEAP rows, 87 SNAP reporting rows and 88 Medicaid rows. Six report sections contain 23 source-bound tables. Five member content sets bind to saved cells. Overlapping populations remain separate.

The original Table 10 is retained with its printed periods and ambiguous OCR cells. Statewide figures are SNAP 12.3%, Medicaid 24.5%, uninsured 6.4%, unemployment 4.3% and HEAP 5.0%. Its 2025 programme labels do not identify a month. Our selected sources are explicit editorial replacements; no missing month is guessed.

## Periods and denominators

| Dataset | Selected source | Interpretation |
|---|---|---|
| Labour | Ohio LMI/BLS 2024 annual averages; current footer 2026-05-05 / 2025 benchmark, prior footer 2025-04-22 / 2024 benchmark | Civilian labour force; by residence; not seasonally adjusted. |
| Health | B27001 2020–2024 five-year for Ohio and 88 counties, plus Ohio 2024 one-year | Civilian noninstitutionalized population; original estimate and MOE cells retained. |
| HEAP | Government HHHEAP CSV, labeled 2024 | Counts labeled applications; context calls participating households. |
| SNAP | Ohio JFS PAMS June 2025 | Actual monthly benefit recipients and households by issuance office. |
| Medicaid | HPIO February 2025 table, ODM retrieval 2025-02-19 | Enrollment month unspecified; ACS 2019–2023 population denominator. |

### Health release correction

Ohio five-year: 746,399 uninsured / 11,642,860 = 6.4% rounded. Ohio one-year: 782,626 / 11,714,170 = 6.7%. The original printed 6.4% matches the five-year numerical release despite its one-year footnote. Both originals are delivered; the primary one-year S2701 public table corroborates its population total.

The transformation sums eighteen disjoint B27001 no-coverage age/sex cells, then divides by B27001001. No aggregate uninsured MOE is invented by adding component margins. Every original source cell/MOE remains available. The poverty universe is different from this insurance universe. Point-estimate differences do not establish statistically significant county rankings.

### Labour benchmark correction

Original statewide 4.3% is reproduced by the April 2025 release; revised May 2026 reports 4.4% for the same year. Seventy-two of 89 state/county rates change. Both complete count sets remain available. Difference is current minus prior, in percentage points.

Counts are rounded to 100; rates use unrounded estimates. Do not force rounded counts to reproduce the published rate. The earlier source was received through the primary government PDF reader with page/line locators. A later text fetch returned 404. The earlier extracted table is labeled as that representation, not original PDF bytes.

### SNAP reporting units

All 86 non-state reporting rows reconcile to 711,651 households, 1,388,233 active members, 806,501 adults and 581,732 children. Every row's adults and children also sum to active members. The source spelling Def/Paudling is retained; South Central remains combined; No Caseworker Assigned remains separate. Combined counts are not allocated to counties.

Original SNAP definitions say adults are over age 22 and children are under age 22 and live with a parent. Retain that original boundary convention; do not relabel these as under-18 counts. June 2025 is the selected month. No population share is calculated from an unrelated annual denominator.

### HEAP and Medicaid qualifications

HEAP's downloaded header says applications; accompanying narrative says participating households. Both labels are explicit. No application is described as an approved or paid benefit, and no unique-household interpretation is invented. The source cites ACS five-year DP04 but does not specify its exact release span. Rounded published shares are preserved without reverse-engineering a denominator.

Medicaid observations retain HPIO attribution and source-note locators. HPIO identifies ODM's dashboard and ACS 2023 five-year population. Its retrieval date is not an enrollment-month claim; retroactive eligibility can revise later dashboard snapshots. Expansion enrollment is included in all enrollment. The original printed Tuscawaras spelling remains beside canonical Tuscarawas County. The complete copyrighted reader stays in the original private source page; this public product contains attributed numeric facts and received-source hashes.

## Rebuild and original application integration

From the production directory:

    node assistance_reporting.cjs sources/ASSISTANCE_ORIGINALS.json datasets
    node assistance_plan.cjs .

These reproduce dataset JSON/CSV, the original plan schema and its exact file lock without a network request.

The cumulative commissioner uses acs_working.extend with plan_name="assistance-working-plan.json", lock_name="assistance-source-lock.json", output_name="assistance-working-edition.json". Keep this independent plan identity and the same Store, report-data journal and report repository. Preserve previous completed operations and staff edits.

The original member_programme call uses module_name="assistance_member_graphics", programme_key="assistance", output_name="assistance-member-programme.json". Five posts reference exact saved cells/hashes. Subsequent data changes use the existing preview/keep/replace flow; staff copy and original approval history remain intact. A changed source fingerprint requires a current proof.

The existing supplemental-source export retains dataset revisions, raw source records, transformation code, lock and frozen mappings with the edition. The raw provider JSON/CSV/text files remain separate from the semantic original-source bundle; reserialization of that bundle is not claimed as byte-identical provider response.

## Actual outgoing review

Open every actual PDF page and member graphic; inspect the populated product at desktop and narrow widths. Operate source editing, preview, review, export and reopen controls. Check table breaks, clipping, captions, units and source dates. Rasterization alone is not visual inspection. Record concrete results and repair the same original edition before presentation.

ASSISTANCE_SOURCE_MANIFEST.json records URLs, representations and exact UTF-8 identities. ASSISTANCE_SOURCE_CONCORDANCE.json retains source-vintage comparisons and original Table 10 OCR uncertainty. The dataset source fields retain release, period, geography and universe even when the report selects only some columns.
