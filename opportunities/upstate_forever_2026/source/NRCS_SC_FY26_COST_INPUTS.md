# SC FY26 watershed conservation payment-source inputs

TokenJunkieLabs • ES26 Ecosystem Sciences source input for the existing BC0B cost worksheet.

## What the source contains

The CSV contains all 63 published components for ten selected practices in USDA NRCS South Carolina's FY26 EQIP payment schedule: 390 Riparian Herbaceous Cover, 391 Riparian Forest Buffer, 393 Filter Strip, 412 Grassed Waterway, 490 Tree/Shrub Site Preparation, 578 Stream Crossing, 580 Streambank and Shoreline Protection, 590 Nutrient Management, 612 Tree/Shrub Establishment and 655 Forest Trails and Landings. Each row retains the exact component wording, category prefix, source unit, dollar amount, integer cents, printed page and original URL.

Official source: https://www.nrcs.usda.gov/sites/default/files/2026-04/SC%20EQIP%20Payment%20Schedule%20-%20FY26.pdf

Document heading: **NRCS - SOUTH CAROLINA FY26 PAYMENT SCHEDULE**. PDF metadata title: **SC Public Cost List for Website FY26 - 03-2026.xlsm**. The document has 12 pages; the selected rows occur on printed pages 6–11. Retrieved 2026-10-13. The published dollar column is labelled **UNIT COST**; the document itself is a financial-assistance payment schedule.

NRCS explains state payment schedules and their annual reassessment here:
https://www.nrcs.usda.gov/state-offices/south%20carolina/payment-schedule

The national category legend is here:
https://www.nrcs.usda.gov/getting-assistance/payment-schedules

## Join into the cost worksheet

Treat this as a named **FY26 NRCS assistance basis**. Retain the fiscal year when a user works on an FY27 or later project. The operator chooses the actual practice, component, quantity, category and funding perspective. Separate the full implementation estimate from potential assistance. A contractor quote, engineering estimate, actual expenditure, or separately sourced practice-cost scenario can populate implementation cost. The schedule amount can populate an assistance scenario after the user selects the appropriate source row.

Preserve a component identity as `practice_code + component + unit`. Keep the unmodified `component` alongside `component_without_category`, which is only a grouping convenience. Map `amount_usd` as a decimal dollar value, or calculate with integer `amount_usd_cents`. The CSV deliberately retains the source unit. The worksheet should require a compatible quantity before multiplication.

An area-based model cell or conservation polygon does not supply a seedling count, bank length, culvert quantity or protected structure count. Code 612 uses `No`; code 580 uses `Ft`; code 578 includes both `DiaInFt` and `SqFt`. Preserve `DiaInFt` literally unless the installation design supplies its precise measurement basis. Acre conversion should be explicit and recorded when a quantity originates in hectares or square metres. The schedule does not specify recurrence for these imported records; the worksheet must retain the user's actual planning horizon and maintenance assumptions separately.

Payment categories remain separate:

| Code | Published meaning |
| --- | --- |
| STANDARD | Component has no category prefix |
| HU | Historically Underserved |
| PR | High Priority Practices |
| WP | Source Water Protection |
| SU | Supplemental Payment; legend only, no SU rows in this subset |

The table does not pick eligibility for a landowner or parcel. It retains the published category as a selectable source attribute. Where multiple rows represent the same installation under different categories, select the applicable row; do not add category variants together.

## Practical source examples

The standard 391 small-area planting mix with tree shelters is **$5,254.48 per Ac**; its HU and PR rows are **$6,234.31 per Ac** (page 6). Standard 393 native-species filter strip with foregone income is **$578.89 per Ac**; HU, PR and WP variants are **$629.45 per Ac** (page 6). Standard 612 small seedlings with protection is **$5.94 per No**, and without protection **$0.89 per No** (page 10). These examples show why a generic cost-per-acre field cannot represent every practice or payment category.

## Decision-study connection

The existing Decision workbench consumes explicit candidate-package costs. Keep the complete package's chosen cost perspective, source rows and quantities in that package's source metadata. Select a consistent cost perspective across all compared packages: for example total implementation outlay, or explicitly estimated net landowner outlay after a chosen assistance scenario. Do not mix payment amounts for one candidate with full installation costs for another.

Retained NDR/SDR annual export changes remain the physical outcomes. A payment-schedule row supplies an economic input; it does not establish a pollutant-removal coefficient or replace a native scenario simulation. If a package includes site preparation and planting, record its actual component bill and compatible quantities. Check scope overlap before summing a package component with an all-inclusive establishment item.

## Source package and receiving

- `source_data/nrcs_sc_eqip_fy26_watershed_rates.csv`: 63 exact extracted rows.
- `source_data/nrcs_sc_eqip_fy26_watershed_rates.json`: source metadata, category legend, row counts and exact CSV SHA-256.
- This guide: field interpretation and the original BC0B worksheet join.

The extraction checks unique practice/component/unit identities, decimal-to-cent agreement, category-prefix preservation and presence of every selected practice. The original publisher URL and printed page allow the receiving worksheet to expose its source beside each imported rate. The JSON records the digest of the generated CSV for transfer verification.
