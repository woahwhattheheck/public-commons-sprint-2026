# Eighteenmile Creek: original EPA discharge records and source-ready tables

This source package gives the existing Upstate Forever scientific application the original EPA ECHO / ICIS-NPDES data for SC0042994, SC0047856, SC0000477 and SC0035700. These are the four permits requested in the project’s 2023 Eighteenmile study work order. The complete history edition contains all 2,282 individual 2023 effluent-chart records, 6,492 EPA monitoring-period loading rows spanning every published year from 2007 through 2026, and 663 original annual rows for each of the estimation-off and estimation-on query selectors. All 70 original source responses are included. The 374-row 2023 period subset and its 34-row annual comparator remain ready for the existing study-year consumer.

Every original response is included. The CSV files retain original field names, strings, parameter/outfall identifiers, qualifiers and source JSON pointers. Added numeric and date columns support the existing scientific consumers without overwriting original values. The native source manifest imports the prepared CSV tables and their original JSON companions into the existing Workspace.

## Use the prepared tables immediately

From the existing project root, import the local manifest with the application’s current API:

~~~python
from model.workspace import Workspace
ws = Workspace("/actual/existing/workspace")
collection = ws.import_sources("source/echo_dmr/20261013/sources.json")
print(collection["id"])
~~~

The source bank already contains the complete prepared tables. To reproduce them from the retained original responses using Node:

~~~sh
node source_tools/echo_dmr_source_cli.mjs \
  --capture-manifest source/echo_dmr/20261013/capture-manifest.json
~~~

The CLI verifies the original source bytes and regenerates the thirteen tables. It runs the same pure preparation core that processed the complete original responses for this package. It writes only the prepared tables in the selected output directory. The saved source manifest identifies the supplied table edition; if inputs are intentionally changed, generate a successor source manifest with its new bytes and hashes.

## Where each value belongs

| Table | Records | Purpose |
| --- | ---: | --- |
| dmr_measurements_2023.csv | 2,282 | Original reported values, limits, standard values, units, statistical bases, qualifier/NODI codes and permit versions |
| dmr_loads_monitoring_period_2023.csv | 374 | EPA-selected DMR measurements and calculated load by original monitoring period |
| dmr_annual_history_2007_2026.csv | 663 | EPA published annual output for every available year, with explicit query settings |
| dmr_annual_estimation_2023.csv | 34 | Original 2023 estimation-on output and published factor |
| dmr_2023_mass_context.csv | 34 | Available numeric period subtotal beside both published annual outputs |
| dmr_parameter_inventory_2023.csv | 65 | Actual parameter/feature/monitoring-location combinations and reporting coverage |
| dmr_requested_parameter_coverage_2023.csv | 32 | Presence/absence of the eight requested nutrient, sediment and flow parameter codes for each permit |
| dmr_facility_coordinates.csv | 4 | Current EPA facility coordinates, actual collection method, reference point and accuracy |
| dmr_permit_feature_coordinates.csv | 6 | Original unique discharge-feature coordinate pairs, including historical features |
| dmr_facility_profiles.csv | 4 | Original 2023 facility-profile attributes |
| dmr_loads_monitoring_period_history_2007_2026.csv | 6,492 | Complete original period history with units, qualifiers, coverage and future-period status |
| dmr_annual_estimation_history_2007_2026.csv | 663 | Original estimation-on annual context for every published year |
| dmr_annual_period_history_context.csv | 663 | Exact yearly source groups, available period totals, annual original-row arrays and reporting coverage |

The original reporting-year lookup returned 2007–2026. The 2026 annual output is a partial year at the October 13 capture. Historical values represent the source’s current published records for those years and may include source-system revisions.

## Scientific interpretation that affects this project

EPA’s monitoring-period loads use kilograms per monitoring period. Annual loading outputs use kilograms per year. Average daily load is kg/day; concentration is mg/L; wastewater volume is million US gallons per period or year; average discharge flow is million US gallons per day. These definitions are retained from EPA’s Custom Search Results Help.

The effluent-chart source separately retains DMRValueNmbr, DMRValueStdUnits and StdUnitDesc. A standard mg/L or kg/d value is interpreted with its original StdUnitDesc. DMRUnitDesc is often null and remains null. Both the original and added numeric columns preserve the measured-value qualifier, statistical basis and value type. Average and maximum concentrations, average and maximum mass rates, permit limits and enforcement limits are distinct records.

Use the monitoring-period table for the EPA-selected period mass. Summing every row of the raw effluent table would combine overlapping statistical bases and limits. Use the raw table to inspect the original measurement, qualifier, timing and standard-unit basis behind a calculation.

The annual p_est=N and p_est=Y requests returned the same displayed 2023 pollutant loads, while their EstFactor fields differ. This matters for total nitrogen at Upper and Middle Eighteenmile. Both have eleven reported monthly periods. The package therefore keeps the reported-period sum and published annual outputs in separate columns:

| Permit / facility | Parameter | Numeric periods | Available period sum, kg | EPA annual output, kg | EPA estimation-on factor |
| --- | --- | ---: | ---: | ---: | --- |
| SC0042994 / Upper Eighteenmile | TN as N | 11 | 2,138.04 | 2,333 | 1.09 |
| SC0047856 / Middle Eighteenmile | TN as N | 11 | 3,009.99 | 3,284 | 1.09 |
| SC0035700 / Pendleton-Clemson | TN as N | 12 | 2,473.47 | 2,473 | 1 |
| SC0000477 / Milliken, T1M | Nitrate as N | 12 | 4,888.00 | 4,888 | 1 |
| SC0042994 / Upper Eighteenmile | TP as P | 12 | 85.75 | 85.75 | 1 |
| SC0047856 / Middle Eighteenmile | TP as P | 12 | 102.56 | 103 | 1 |
| SC0035700 / Pendleton-Clemson | TP as P | 12 | 170.16 | 170 | 1 |
| SC0000477 / Milliken, T1M | TP as P | 12 | 761.40 | 761 | 1 |

Annual display rounding explains small differences for complete reporting periods. The larger Upper/Middle TN differences remain explicit. Do not multiply a published annual result by its factor again.

Milliken reports nitrate as N at feature T1M. Its complete 2023 effluent response has no total-N, TKN or combined nitrate/nitrite parameter. Keep that nitrate result as its own species. The municipal plants report TN and ammonia separately; adding those values would count ammonia twice within total nitrogen.

Milliken’s T1Q ammonia loading response has four period rows. Three carry the original “B - Below Detection Limit/No Detection” NODI description and nonnumeric load fields; the remaining numeric load is zero. The period subtotal of available numbers is therefore zero with three nonnumeric periods. The coverage columns retain that distinction. Other qualifiers, detection values and missingness remain in their original source fields.

The selected loading requests explicitly use DMR-only data, p_nd=ZERO and p_param_group=N. The source package preserves every original measurement qualifier so alternate scientific censoring choices can be made by the existing observation consumer without reacquiring the raw data.

## Full historical comparison

The history context groups by original reporting year, permit, permitted feature, monitoring location and parameter code. It contains 636 mass-parameter groups and 27 context groups for fecal coliform or ADMI color. The source retains 298 non-mass period rows. Their original load-like numeric fields remain available, while added kilogram and mg/L annotations are null and the history summary produces no kilogram subtotal for them.

The annual source contains 27 keys with more than one original row. These are preserved as arrays with source pointers in the history context, alongside all original annual table rows. No later row overwrites an earlier one. A scalar annual comparison is populated only when exactly one numeric annual value is available for that key. The source-specific annual rows remain directly inspectable when more than one numeric value exists.

For each reporting year, the prepared subtotal sums the available numeric EPA period loads whose original monitoring-period end falls in that year and has passed by capture. This follows the source’s reporting-year cohort; it does not prorate a quarterly period across a calendar-year boundary. Exact period ends, derived starts where the original months-per-report permit them, months with numeric loads, nonnumeric periods and cross-year periods accompany the subtotal.

The 2026 original data includes seven Pendleton-Clemson rows dated December 31, with zero reported months and nonnumeric loads. Those future-period placeholders stay in the original and prepared period tables. They are excluded from the at-capture subtotal. Actual reported-period coverage is shown per species and source, including the current July/August ends in these records.

The existing science companion at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8J1E75FV carries the 2023 target-series subset, original DES native outfall features and the science owner’s calendar-weighted interpretation. Join the current companion’s permit/reach and native geometry with this broader history using the exact permit, feature, species and period identity. Both are inputs to the same Upstate observation application.

## Geographic identity

Facility and discharge coordinates are separate source tables. The current CWA facility service describes its FRS coordinates as NAD83, EPSG:4269. Its CollectionMethod, ReferencePoint and CalculatedAccuracyMeters are retained for each actual facility coordinate pair. Those fields describe a facility reference point.

The loading service separately supplies LatitudeMeasure and LongitudeMeasure for the permitted feature. The four requested permits include Milliken’s T1M/T1Q and the municipal 001 features; the annual history also retains Milliken’s historical 001 discharge location. The loading response supplies decimal-degree coordinates but no field for their determination method or horizontal datum. That absence remains explicit. A facility’s address-matching or GPS method must not be attached to its outfall pair.

The 2023 facility report and the current CWA facility service give different Milliken facility coordinates. Both original source editions are retained. The source crosswalk owner can bind the proper discharge feature and study reach using the original permit, feature, HUC and reach fields.

## Retained source and replay contract

capture-manifest.json lists all 70 original responses with exact URLs, byte sizes, SHA-256 values and query/pagination metadata. Every annual and period response returned one complete page and its row count matched its declared QueryRows. raw/ contains the exact original response bodies. documentation/ includes the original public DMR, EFF and CWA schemas, the CWA column metadata and complete captured EPA help text/documents. field-guide.json maps the original fields and their units. sources.json uses the existing upstate.sources/v1 importer contract.

source_tools/echo_dmr_source.mjs is the reusable source preparation core. The added dates identify ISO conversion and derived period starts separately. A derived start uses the original number of months in a reporting period only when that number is positive and the original end date is a month-end. Raw date strings remain present.

For the Upstate model comparison, retain point-source discharge separately from landscape export, use the exact monitored species and reporting period, and join the science owner’s permit/reach crosswalk before combining spatial totals. The original lake-study source and OBS12 consumer remain in their existing project lanes.

## Primary public sources

- EPA Loading Tool API: https://echodata.epa.gov/echo/swaggerx.swagger_json?p_prefix=DMR
- EPA Effluent API: https://echodata.epa.gov/echo/swaggerx.swagger_json?p_prefix=EFF
- EPA CWA API: https://echodata.epa.gov/echo/swaggerx.swagger_json?p_prefix=CWA
- EPA Custom Search Results Help: https://echo.epa.gov/help/loading-tool/custom-search/custom-search-results-help
- EPA Custom Search Help: https://echo.epa.gov/help/loading-tool/custom-search/custom-search-help
- EPA Effluent Charts Help: https://echo.epa.gov/help/reports/effluent-charts-help
- EPA Technical Background and Methodology: https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology
