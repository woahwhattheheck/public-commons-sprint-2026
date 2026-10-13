# South Carolina restoration cost source intake

## Published assistance rates

Use the South Carolina FY2026 EQIP schedule to estimate **program assistance** for a matching conservation practice and installed quantity. The state office currently links this edition; its workbook title identifies a March 2026 cost list and the PDF sits in the April 2026 publication directory. Retain FY2026 as the rate edition.

Primary sources: [South Carolina NRCS office](https://www.nrcs.usda.gov/state-offices/south-carolina) and [SC EQIP Payment Schedule FY26](https://www.nrcs.usda.gov/sites/default/files/2026-04/SC%20EQIP%20Payment%20Schedule%20-%20FY26.pdf), printed page 6 of 12. Retrieved 2026-10-12.

All amounts below are **USD per eligible installed acre**.

| Practice | Component selection | Standard | HU | PR | WP |
|---|---|---:|---:|---:|---:|
| 391, forest buffer | Small Area Planting Mix with Tree Shelters | 5,254.48 | 6,234.31 | 6,234.31 | — |
| 390, herbaceous riparian cover | Grass planting | 704.17 | 773.94 | 773.94 | — |
| 390, herbaceous riparian cover | Native grasses with forbs | 704.17 | 773.94 | 773.94 | — |
| 393, filter strip | Introduced vegetation; income foregone included in component | 515.15 | 552.95 | 552.95 | 552.95 |
| 393, filter strip | Native vegetation; income foregone included in component | 578.89 | 629.45 | 629.45 | 629.45 |

The source's column heading is UNIT COST, within a document explicitly issued as a payment schedule. These values retain that assistance-payment meaning.

HU identifies historically underserved producers; PR identifies high-priority practices; WP identifies source-water protection. A dash means this table has no listed rate for that component/category. Keep the selected category with the estimate. [NRCS payment schedule legend](https://www.nrcs.usda.gov/getting-assistance/payment-schedules)

## Apply the rate to the physical intervention

For an eligible installed area A, scheduled assistance equals the selected payment rate multiplied by A in acres. Convert mapped hectares to acres using 2.4710538147 acres per hectare.

Measure the actual installation footprint from the retained scenario geometry. A reporting watershed's area is a different quantity. Where physical patches overlap, use the installed union or the practice's measured billable quantity.

Practice 391 prices a specified buffer establishment activity. Existing forest protection, a conservation easement, and a modeled conversion alternative represent different actions. Match the cost input to what the scenario actually implements.

Retain these fields beside the estimate: scenario/run identity, intervention geometry, practice code, component, category, installed quantity, unit, rate edition, assistance amount, and source. For the source record use:

- Title: SC EQIP Payment Schedule FY26, March 2026 public cost list.
- URI: the PDF linked above.
- As-of date: 2026-10-12.
- Quantity basis: USD per eligible installed acre.
- Economic meaning: scheduled program assistance.

## Keep assistance separate from implementation expenditure

Maintain a gross implementation estimate and the assistance estimate as separate amounts. The ordinary decision companion's `costs[].capital` represents the implementation cost assigned to the alternative. A payment-rate row belongs in the assistance calculation; it does not by itself supply that capital value.

The selected components can incorporate income foregone, and the category schedules differ. Recover the actual component breakdown when constructing a full estimate rather than dividing every payment by a single assumed reimbursement percentage.

A useful implementation estimate separates establishment expenditure, recurring maintenance, and opportunity cost according to the chosen economic perspective. Retain the service horizon, annual maintenance amount, and real discount rate with the resulting decision cost record.

## Additional public charge components

These separately published charges can contribute to an implementation estimate when the field design and procurement method use them.

| Charge component | Published amount and quantity | Source basis |
|---|---|---|
| Forestry Commission tree-planter rental | USD 5 per acre; USD 25 minimum | Equipment rental, July 1, 2026–June 30, 2027 |
| Water oak, willow oak, or sweetgum seedlings | USD 390.41 per 1,000; minimum quantity 250 for the selected stock | Forestry Commission negotiated preferential pricing for South Carolina landowners |

Sources: [SCFC current fees and rentals](https://www.scfc.gov/management/landowner-services/fee-rental-services/) and [SCFC seedling prices](https://www.scfc.gov/management/seedlings/), retrieved 2026-10-12.

The rental line prices equipment. The seedling line prices planting material. Keep site preparation, planting labor, shelters where specified, delivery, establishment care, and subsequent maintenance in their own sourced lines.

For the first allocation discussion, use the five assistance rows to compare funding support for the actual buffer or filter-strip footprints, and use the charge components to begin the corresponding implementation estimate. Attach the complete alternative's modeled reductions to that same implementation scope.
