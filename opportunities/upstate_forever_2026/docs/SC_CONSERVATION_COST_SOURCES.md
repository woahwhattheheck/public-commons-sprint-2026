# South Carolina conservation cost sources and worksheet

Source edition: **2026-10-13**. This catalogue provides 109 source rows for reviewed implementation planning: 63 NRCS assistance rows, nine current forestry service/rental prices, 25 seedling materials prices and 12 historical NRCS practice-cost benchmarks. No project quantity, implementation total, annual expense, discount rate, planning horizon or assistance eligibility is assumed.

Open `source_data/sc_conservation_costs_20261013/worksheet.html` directly in a browser. It is self-contained and makes no network calls except when the operator opens an original source link. Select a source row, enter a real compatible quantity, identify its source and work scope, specify timing, review exclusions, then add the line. Full JSON export retains each original source row; CSV is a tabular working copy. Reopening exported JSON checks its catalogue identity and source rows, then recalculates amounts from those retained prices. No data is automatically sent to Economic or written to a plan.

## What the prices mean

| Source | Edition / status | Cost meaning | Appropriate use |
| --- | --- | --- | --- |
| [NRCS SC EQIP schedule](https://www.nrcs.usda.gov/sites/default/files/2026-04/SC%20EQIP%20Payment%20Schedule%20-%20FY26.pdf) | FY2026; still advertised on the SC office page at retrieval | Financial assistance | Potential funding scenario after actual category/eligibility review |
| [SC Forestry Commission service fees](https://www.scfc.gov/management/landowner-services/fee-rental-services/) | July 1, 2026–June 30, 2027 | Service or equipment-rental component | Applicable work priced with actual acres, unit-days, hours, weeks or transport miles |
| [SCFC seedlings](https://www.scfc.gov/management/seedlings/) | Retrieved October 13, 2026; price-effective year unstated | Materials only | Actual selected species/count, order minimum and current availability/quote |
| [NRCS SC practice scenarios](https://www.nrcs.usda.gov/sites/default/files/2024-11/fy25-sc-scenarios_0.pdf) | FY2025, historical | Published typical total-cost planning benchmark | Scope-matched preliminary estimate, followed by current site-specific design and pricing |
| [SCFC FRP/SPB schedule](https://www.scfc.gov/wp-content/uploads/2026/07/FRP-SPBCost-ShareRates2026-27.pdf) | July 1, 2026–June 30, 2027 | Percentage-of-actual-cost reimbursement subject to caps | Separate assistance assessment; no installed-cost rows inferred from caps |

The live NRCS state page also mentions FY2027 application timing. That does not change the FY2026 edition printed on the downloaded payment schedule. This package does not advertise an application deadline or assert funding availability.

NRCS's [payment explanation](https://www.nrcs.usda.gov/getting-assistance/payment-schedules) distinguishes assistance schedules from complete project prices. The SC schedule labels its amount column “UNIT COST”; its title and programme context identify a payment schedule. HU means Historically Underserved, PR High Priority Practices and WP Source Water Protection. These alternative categories are not amounts to add together. [SC source-water protection](https://www.nrcs.usda.gov/programs-initiatives/eqip-source-water-protection/south-carolina/source-water-protection-in-sc) requires the actual programme/resource-area and practice conditions; location in a broad watershed is not eligibility proof.

## Current implementation components

SCFC publishes drum-chopper rental at $20/acre, $100 minimum, plus Columbia round-trip transportation at $3.50/mile, $50 minimum. Tree-planter rental is $5/acre, $25 minimum. A temporary bridge set is $50/week with a $200 refundable deposit; contractor transport and insurance remain separate.

For firebreak plowing or waterbar construction, the medium tractor rate is $165 for the first hour and $130 per additional hour; large tractor rates are $185 and $145. The first hour includes mileage for each unit per day. Record one line per unit/day. These rates do not specify waterbars per hour.

Prescribed burns are $30/acre for understory or $40/acre for mountainous understory/site preparation, with a $750 minimum and firebreak plowing excluded. Standby is $125 first hour and $50 each additional hour, per unit/day; the landowner remains responsible and an approved plan is required.

Prices for 25 published seedling selections retain “per 1,000” rates and actual minimum orders. They do not include a planting prescription, full establishment labour, site preparation, shelters or maintenance. Confirm shipping, tax, order increments, availability and current quote. Do not automatically choose a species merely because it is listed.

The catalogue's nine service rows are a useful subset, not every SCFC service. Grant-supported free rental equipment is not encoded as a generally available zero-cost implementation item.

## Historical scenario benchmarks

The FY2025 NRCS source provides original scenario numbers, units, typical quantities and total costs. The selected rows cover riparian planting, filter strips, waterways, streambank work, nutrient management and forest trail/waterbar work. They are statewide averages; county costs can differ. The publisher requires site-specific implementation/design requirements.

For example, 391 hand planting assumes an already prepared site, while 412 waterway excavation leaves vegetation and several associated works to other practices. A 580 streambank scenario is per linear foot, with stated bank geometry; a 655 waterbar scenario is per constructed waterbar. The full catalogue retains these inclusions and exclusions. No FY2025-to-2026 escalation is applied. A current contractor/engineer estimate supersedes a historical benchmark when available.

Published unit rates are rounded. The catalogue separately preserves the publisher's original typical total, so a penny difference between unit rate × typical quantity and that original total is transparent. The worksheet calculates with the published unit rate, rounding each selected line to cents, and does not silently substitute the typical total.

## Link real quantities to real work

Use the narrowest actual implementation footprint and retain its identity. A suitable binding includes project/study, grid, baseline and alternative run IDs, report/source digest, zone, treatment/patch or design identifier, quantity value/unit and the method used to measure it.

An original native scenario may provide net changed land-cover cells/hectares, but that does not by itself establish a construction prescription or all bill-of-quantities items. A reporting polygon or common valid raster support area is not automatically the treated area. Zero changed cells is not a positive installation quantity.

| Price unit | Required quantity evidence |
| --- | --- |
| Acre | Actual area treated by this practice; explicit conversion if measured in hectares or square metres |
| Foot | Designed/measured bank or trail length, including whether one or both banks are treated |
| Each / seedling | Actual design count and selected material; no tree density inferred from a raster |
| Square foot | Actual crossing footprint/design |
| DiaInFt | Preserve the original compound unit; obtain the project-specific measurement definition before use |
| Hour | Actual estimated or quoted equipment time, one unit/day per line; confirm fractional-hour billing |
| Mile | Actual charged delivery plus return distance |
| Week | Actual rental duration; the worksheet requires whole weeks until another billing basis is quoted |

Area conversions, if used, must be explicit and retained. One international acre is 4,046.8564224 square metres; one hectare is 10,000 square metres. The worksheet deliberately accepts the published billing unit only. It does not infer geometry, multiply pollutant tonnes by rock tonnes, or convert annual N/P/sediment export to work quantities.

## Build a complete reviewed estimate

1. Retain the actual physical scenario/report and implementation scope. Confirm that the planned work corresponds to the modeled change or explicitly document the limitation.
2. Choose either a scope-matched benchmark or a component bill of quantities. Avoid counting seedlings, labour or shaping twice when a selected scenario already includes them.
3. Supply real quantity evidence and exact units. Record site-specific access, mobilisation, design/permitting, preparation, installation, monitoring, maintenance and replacement costs wherever applicable.
4. Keep an explicit list of missing components. A few priced lines do not become a complete estimate by being added together.
5. Record price year, estimate date, currency, tax/transport treatment and any separately sourced escalation. This catalogue applies no escalation.
6. Classify reviewed expenses as initial capital, annual operating or another explicitly modeled timing pattern. Equipment hours and annual model-output units do not establish an annual expense.
7. Evaluate assistance separately. Do not subtract unapproved payments from a full-cost perspective, stack HU/PR/WP variants, or reverse a reimbursement percentage/cap into an asserted installed price.
8. Import the completed reviewed cost into the existing Economic workflow, retaining this full worksheet and original sources as evidence. Preserve the selected cost footprint, original physical quantities, planning horizon and real discount rate unless the review explicitly changes them.

The worksheet displays separate service, materials, historical-benchmark and assistance subtotals. It does not combine them into a purported all-in cost or annualize them. Refundable deposits are separate cash requirements, excluded from expense subtotals.

For an existing FIELD12 ledger, the reviewed cost-return workflow continues to distinguish budget, commitments and actual expenses; avoid counting the same invoice in a catalogue forecast and the actual ledger. Supply a separately reviewed remaining-capital and annual forecast rather than treating “budget less actual” as lifetime cost.

## Machine contract and source preservation

`catalogue.json` uses schema `upstate.conservation-cost-catalogue/v1`. Each row retains:

- stable catalogue/source IDs, price meaning, original unit and normalized compatible quantity unit;
- USD integer cents, tier/minimum/order/deposit formula details;
- practice/scenario/payment category and 1-based PDF page when available;
- source edition, scope, exclusions and original assistance row;
- original typical benchmark quantity and total separately from rounded unit price.

The digest is SHA-256 of compact UTF-8 `JSON.stringify(catalogue)` before the `digest` member is inserted. File-level SHA-256 is separately supplied in the source bank. Export schema `upstate.conservation-cost-worksheet/v1` embeds original selected rows, source inventory, actual entered quantity, source/scope/timing/review notes and computed cents. A default blank JSON/CSV template contains no project estimates.

The 63-row original ES26 source files are included unchanged, with their source CSV hash **8dbf2049b3bafb4bf25055fdb4fb618862dfaafbd78dc3e8d911c63904b345fc**. Original carrier: Slack **F0C9KK56TNC**, decoded three-file bank **27,421 bytes**, SHA-256 **ba9c609e1a09ca9ab8f6ca32e3230e9c8a06a354bbcdd598dd6ce632b4277eba**.

The [private retained originals page](https://app.notion.com/p/3f8dd7723100814e8816f33a4ec1a47f) holds:

- service HTML: **149,575 bytes**, SHA-256 **df0e7d8b99bd806370a007cb30185d9a0a1b6e69e743064152205a1ee68e0efa**;
- seedling HTML: **145,092 bytes**, SHA-256 **41c8123ce4518c966439ce34096ee00a4e5313cf298d20ac2f87d3ba9f104db9**;
- original FRP/SPB PDF: **2,983,067 bytes**, provider-uploaded; independent binary SHA-256 not yet obtained.

The SCFC fee PDF exceeded the provider's 5 MiB capture limit; its exact official HTML is captured instead. Initial NRCS binary captures returned provider HTTP504; original PDF URLs and reviewed publisher content remain in the catalogue, with capture status explicitly pending. A generated CSV digest is not an original PDF digest. The source manifest gives the remaining original URLs for ordinary download and SHA-256 preservation by the equipped receiver; no missing hash is invented.

## Exact outgoing artifact inspection

Before describing this worksheet as client-ready, the producing worker must open this exact `worksheet.html`, operate its source filters, add/remove real or clearly labeled verification-only quantities, export JSON/CSV/catalogue, reopen its JSON, and inspect print/PDF output. Open and LOOK at the desktop and 390-pixel view, including long source-row names and original notes. Capture alone is not inspection. Keep the actual screenshots and download hashes with the receiving result.

The source author has checked the actual JavaScript parser and arithmetic functions in V8, including charge minima, hourly tiers, seedling minimum, positive quantities and the published rounding difference. Native browser rendering and visual inspection are a separate required receiving step; no native browser result is claimed in this source bank.
