# Eighteenmile 2023 reported discharge quantities

This companion calculates 230 reporting-period quantities and 20 annual summaries from the 20 original EPA effluent series retained beside it. The source comprises 980 distinct original DMR value records. The calculation selects 227 populated average quantity or flow records; the three remaining periods retain their original unquantified detection-threshold status. Every output row identifies its original response and the DMR values used.

## Reported annual phosphorus and flow

| Facility | NPDES permit | EPA reporting feature | Total phosphorus, kg in 2023 | Reported flow, million US gallons in 2023 |
| --- | --- | --- | ---: | ---: |
| Milliken Pendleton Plant | SC0000477 | T1M | 761.00387363 | 482.59 |
| Pendleton-Clemson Regional WWTF | SC0035700 | 001 | 170.1591991 | 456.62 |
| Pickens County Eighteenmile Creek Upper WWTP | SC0042994 | 001 | 85.7506117 | 86.2164 |
| Pickens County Eighteenmile Creek Middle WWTF | SC0047856 | 001 | 102.56132339 | 114.911345 |
| Four-facility sum | | | 1119.47500782 | 1140.337745 |

Each phosphorus total uses 12 selected monthly rates spanning all 365 days. The four phosphorus sums were independently reproduced from the retained original response bodies. Report these quantities at a sensible display precision, for example 761.0 kg or 68.0% of this four-facility phosphorus total; the CSV preserves the reported decimal arithmetic.

## Nitrogen and suspended solids

| Facility | Nitrogen series and represented period | Nitrogen quantity, kg | Total suspended solids, kg in 2023 |
| --- | --- | ---: | ---: |
| Milliken Pendleton | Nitrate as N, January-December | 4887.58235867 | 50530.8805755 |
| Pendleton-Clemson | Total N, January-December | 2472.98337959 | 5494.03555368 |
| Pickens Upper | Total N, February-December | 2138.62146246 | 1405.42054767 |
| Pickens Middle | Total N, February-December | 3010.31053443 | 931.81229245 |

The two Pickens total-N series cover 334 days. The original January all-parameter responses, retained in originals/, contain ammonia but no total N, TKN or nitrate. Their annual_total fields therefore remain empty, with the quantified February-December amount in quantified_period_total and the exact 31-day January interval recorded.

The Milliken nitrate series uses parameter 00620; total N uses 00600. Ammonia 00610 has its own rows and remains separately attributable. Milliken's ammonia reporting feature is T1Q. Its four original three-month reporting periods end in February, May, August and November: three contain NODI B with no numeric threshold, and September-November contains a reported zero quantity. Its quantified_period_total is zero across 91 days, annual_total is empty, and the other intervals retain their own statuses. The other three facilities have complete reported ammonia series.

## Reproduce from the original capture

The complete executable source is summarize_dmr.mjs. It uses Node.js 18 or later and the standard library. Select the application directory that contains observations/eighteenmile_2023/npdes/capture.json and the retained originals directory.

```sh
node "$UPSTATE_APP/observations/eighteenmile_2023/npdes/summarize_dmr.mjs" --root "$UPSTATE_APP" --output "$UPSTATE_DMR_OUTPUT"
```

The calculator pins the exact original capture SHA256, verifies the actual bytes and SHA256 of every selected response, and reproduces three files: period_loads.csv, annual_loads.csv and summary.json. An existing identical output is reusable. A changed existing output asks for a new output directory so the original edition remains available.

The supplied derived/ files were calculated with the same exported JavaScript function on all original records. The annual mass calculation uses decimal integer arithmetic, preserving the original decimal rates through multiplication and summation.

## How records become quantities

1. Group the retained response by permit, physical reporting-feature label, parameter and monitoring location. Retain the original internal feature, permit version, limit set, limit and DMR identifiers. Permit versions change within the observed year, so selecting a single largest version would discard valid periods.
2. Select statistical base MK with type AVG and the original standard unit kg/d, or MGD for flow. The statistical base determines the average. Pendleton-Clemson's average flow is stored in a C2 value field with MGD units. Other concentration, weekly-average and maximum rows remain in the original CSV.
3. Select the populated average quantity within a period. Milliken's source contains parallel null NODI C branches alongside actual populated values. The original candidate IDs and those parallel no-discharge IDs remain in each period row. A period containing only an explicit no-discharge branch can contribute zero; other unreported reasons preserve an unknown amount.
4. Derive monitoring-period length from the original NmbrOfSubmission field and MonitoringPeriodEndDate. The EPA dictionary defines NmbrOfSubmission as the number of months represented by each DMR. Period starts are inclusive and ends exclusive; contributions are clipped to calendar 2023.
5. Multiply the original DMRValueStdUnits average rate by the actual represented days. kg/d produces kg, and MGD produces million US gallons. Preserve the EPA-standard values as supplied: a second conversion from the original lb/d field would alter the recorded standard-unit result.
6. Keep concentration qualifiers beside the reported mass quantity. Each paired qualifier uses the same original DMR event, limit and reporting date. The output records how many selected quantity periods have a qualified associated concentration.
7. Calculate annual_total when quantified, nonoverlapping periods cover all 365 days. Keep quantified_period_total, quantified_days, original_reported_days_in_2023, missing_intervals and unquantified_intervals for the other series.

The rate-to-period calculation assumes discharge over the represented monitoring period. The original inventories contain no duration-of-discharge parameter. This method is the explicit reported-standard-quantity integration documented here. EPA's wider loading methodology also includes additional selection and conversion rules for other reporting situations.

## Read and map the outputs

- derived/period_loads.csv contains 230 rows. Each row retains period bounds, calendar-year contribution, rate and amount units, amount, status, selected/candidate DMR IDs, original permit-version identifiers and paired concentration qualifiers.
- derived/annual_loads.csv contains 20 rows, one per permit/reporting-feature/parameter/monitoring-location series. Decimal amounts are plain numeric strings; empty annual totals correspond to incomplete quantified coverage. Array fields are JSON encoded within ordinary CSV cells.
- derived/summary.json retains the method, source capture and executable identity, calculated source IDs, output hashes and annual records.
- dmr_records.csv is the retained 980-row original-field table. originals/ contains complete EPA responses, inventories and the state outfall geometry/schema.

Join the original state outfall source by permit_id, keeping both state mapped outfall and EPA reporting_feature attributes visible. The current state map identifies 001 for all four facility points; Milliken's EPA reporting series identify T1M and T1Q. The source geometries retain their native EPSG:26917 coordinates and original location attributes.

Use these 2023 quantities in the native source and measurement context views. Label the N/P species and coverage dates, and show annual_total separately from partial quantified totals. The study identifies the four facilities upstream of the Eighteenmile lake arm. A routing calculation can use the retained outfall geometry with the actual hydrologic domain before relating a facility to a particular downstream monitoring point.

The existing native workspace nitrogen_export.tif and phosphorus_export.tif represent annual land-cover export mass per cell. Compare the source-year and watershed selection beside this dated point-source context. Land-cover intervention scenarios change those modeled land-cover terms; the retained observed effluent totals provide a separate source term for the same review. The catchment observation import remains appropriate for measured receiving-water catchment loads.

## Primary method and source references

- [EPA Effluent Charts Help and source-field dictionary](https://echo.epa.gov/help/reports/effluent-charts-help): statistical basis, original identifiers, qualifiers and months represented.
- [EPA Water Pollutant Loading Tool calculations](https://echo.epa.gov/trends/loading-tool/resources/loading-calculations): load-selection and period-quantity context.
- [EPA technical conversion methodology](https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/convert-module): average quantities, units and represented discharge duration.
- The exact response URL, source SHA256 and original field values for each series are retained in capture.json and copied into the calculated rows.
- [SCDES Lake Hartwell-Eighteenmile Creek Lake Arm 2023 Nutrient Study](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf): the five monitoring stations and four upstream permit identities.
