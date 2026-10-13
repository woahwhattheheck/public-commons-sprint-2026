# Routine nutrient concentrations and observed flow

This is an additive source edition under observations/observed_hydrology_20261013/nutrient_flow_contrasts. It uses the retained 96 original SWS-2023 routine nutrient results at SV-268 and SV-374, their 24 same-activity total-nitrogen sums, and all 365 approved USGS 02186702 daily means in 2023. It keeps this routine cohort separate from the 75 selected special-study chlorophyll results.

## Findings for the existing observation review

Across 12 visits per station, SV-268 phosphorus averaged 0.101 mg/L. SV-374's three quantified results and nine below 0.02 mg/L give a conservative mean enclosure of 0.0074167–0.0224167 mg/L. Same-activity TKN plus nitrate/nitrite gives TN mean enclosures of 0.975833–0.992500 mg/L at SV-268 and 0.327833–0.352833 mg/L at SV-374. Lower and upper endpoints use all 12 visits with the same denominator.

The complete annual gauge-flow quartiles are 30.6, 53.9 and 75.3 cfs. The two stations' phosphorus and TN mean enclosures remain separated in each quartile, with 2–5 visits per station/group. These are descriptive unmatched visit groups. The sole shared calendar date is May 17: at a daily gauge mean of 64.7 cfs, phosphorus was 0.076 mg/L at SV-268 and below 0.02 at SV-374, while same-activity TN was 0.780 and 0.261 mg/L. Original sample clocks were 13:39 and 11:32 EDT.

The June 12 SV-268 activity AF03778 occurred at a daily mean of 604 cfs, the 99.315th midrank percentile of the year's daily record. Its phosphorus was 0.180 mg/L, 1.919 times the other 11 visits' mean of 0.093818. Its TN was 0.660 mg/L, 34.3–35.5% below the other visits' conservative mean enclosure of 1.004545–1.022727. Nitrate/nitrite was 0.270 versus 0.600 mg/L across the other visits; TKN was 0.390 versus 0.404545–0.422727. The event therefore has different constituent responses. The original dates and constituents support reviewing nutrient-specific flow context in the existing desk.

## Calculation and scientific meaning

compute.mjs is the exact pure-JavaScript processor executed for this edition. replay.mjs reruns it from the existing three hash-bound input files:

node replay.mjs /actual/observations/observed_hydrology_20261013 /actual/replay-output

The original unfiltered concentration result must be either a finite original mg/L number without a detection condition, or an explicit below-quantification result with a matching-unit lower limit. For the latter, the closed conservative enclosure is [0, original limit], with the strict source "<" relation retained separately. The programme rejects unsupported conditions/units and checks the existing original interval endpoints. No half-limit substitution enters these contrasts.

TN adds only matched TKN and nitrate/nitrite from the same activity, date, project, fraction and source clock. It checks both original component IDs and their concentration endpoints. Ammonia is already part of TKN. Sample depth and further source details remain recoverable through those exact original activity/result identities and the retained original WQP bodies.

Quantiles use linear interpolation at (n-1)*p. Quartiles include their upper boundary, and p95 is 134.8 cfs. Daily-flow percentiles use empirical midranks. The source gauge is upstream of these lake samples; its same-calendar-date daily mean supplies common observed hydrologic context. The tables preserve differing site dates and sample times. Mean concentration bounds are not flow-weighted concentrations, transported loads, inferential confidence intervals or lake residence-time estimates.

## Files

- dated_values.csv: 120 value rows, complete original records and component IDs, both interval endpoints, actual daily flow and quartile.
- sampling_calendar.csv: 24 original activities, clocks, four original-result IDs and daily-flow lineage.
- station_flow_summary.csv: 65 station/constituent/flow-group summaries with all selected dates and source IDs.
- station_contrasts.csv: 30 cross-station descriptive interval comparisons.
- same_date.csv: five constituent comparisons on the one shared calendar date.
- june12_contrast.csv: five event-to-other-visit comparisons and exact selected source identities.
- methods.json and inputs.json: definitions and exact original-source hashes.

## Existing native application intake

The ordinary model-sources.json imports all six tables through Workspace.import_sources. The supplied importer adds two clearly labeled context editions for the dated lower and upper endpoints in the current Observed water quality desk:

python /actual/source-root/observations/observed_hydrology_20261013/nutrient_flow_contrasts/import_into_workspace.py --application /actual/current-application --workspace /mnt/data/gis12/original-workspace --output /actual/receipts/nutrient-flow-import.json

Use the published current v3 observed-context installation first: https://chatgpt.com/space/page_7708ce8eb1a08191a3b46177383e4746 . The original 96 measurement rows are already retained in the complete scientific source and its ordinary observation intake. These two additional endpoint views share the same 120 calculated rows; they retain original intervals and source details for inspection and CSV download. All six tables also appear in the existing source collection. The importer returns actual source collection and observation IDs from the populated Workspace.

The calculation is complete from the original retained sources. Native installation/import receipts belong to the actual existing GIS12 application operation.
