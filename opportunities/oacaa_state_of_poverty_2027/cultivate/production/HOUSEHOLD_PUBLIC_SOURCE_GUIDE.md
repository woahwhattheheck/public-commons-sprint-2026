# Reuse the 2025 household-method dataset

This source package supplies thirteen editable definitions for interpreting Ohio household costs. The seven budget items are housing, child care, food, transport, health care, miscellaneous costs and taxes/credits. Six further rows identify scope, work units, adult workers, child age groups, basic-needs limits and the separate emergency-savings calculation. All five columns are text. These rows describe a method, not observed household amounts.

Open `datasets/ohio-self-sufficiency-method-2025.json` directly, or import it into a consumer of `tjl.publication.report-dataset.v1`. It contains complete column definitions, original printed-page locators, publication and input-period notes, and source/license metadata. Keep its dataset identity and measurement period with any derived table.

The complete licensed technical text is in `sources/SSS2025_TechnicalBrief-public-text.txt`. Its original PDF is https://selfsufficiencystandard.org/wp-content/uploads/2025/03/SSS2025_TechnicalBrief.pdf . See HOUSEHOLD_METHOD_ATTRIBUTION.md for authors, license and representation. HOUSEHOLD_METHOD_CONCORDANCE.json contains the specific methodological comparison with the publicly issued 2026 Ohio report, whose original URL remains attached. The complete report’s prose is available from its publisher.

## Add actual county costs

The publisher’s Ohio page, https://selfsufficiencystandard.org/ohio/ , links the original quantitative source at https://selfsufficiencystandard.org/wp-content/uploads/2025/03/OH2025_SSS_Full.xlsx . Retain that workbook before selecting costs. Inspect the actual sheets, headings, stored values and cached formulas. Select the intended household composition using the real column names and values.

For a two-adult/two-school-age-child comparison, select two adults, zero infants, zero preschool children, two school-age children and zero teenagers where those actual fields exist. If composition is encoded as one original category, use that category. Exact conditions combine with AND. Record the worksheet, cell range, original row addresses, filters and chosen column definitions.

Keep hourly pay per working adult distinct from monthly and annual household income. The source uses 176 work hours per month. Preserve the original tax-credit treatment before summing costs, and keep emergency savings as its separate supplement. The method’s food-price index and a later food-insecurity release have different source periods and meanings.

## Correct and deliver a report

Keep the received original unchanged. Save edits as a new dataset revision with the researcher’s note. Review the affected report mapping before applying it, preserving staff wording and prior source revisions. A previously rendered edition remains attached to its original source.

The original report’s retained Table 5 transcription has conflicting county headings and footer names. Resolve the intended comparison from the actual workbook and the original printed page before approving its county-cost caption. HOUSEHOLD_METHOD_CONCORDANCE.json preserves the competing labels and exact issue.

Render and view the actual outgoing tables in HTML and both digital/print PDFs. Inspect long definitions, source notes, units and page breaks. In the receiving application, operate multi-condition selection and draft recovery at desktop and narrow widths, download the original and reopen the saved workspace. Correct the actual result before presenting it.

## Source identities

HOUSEHOLD_PUBLIC_SOURCE_MANIFEST.json lists every file in this household source cohort with its exact byte length and SHA-256. It is independently reusable with the statistical longitudinal source cohort in the same directory; `node longitudinal_reporting.cjs .` rebuilds that separate set of Census datasets from retained originals.
