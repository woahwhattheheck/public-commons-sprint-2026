# Daily discharge editions in Measurements

## Original measured data now included

This source collection retains the exact six annual NWIS responses for USGS-02186702 (2020–2025), the complete 589-row Eighteenmile nutrient derivation, and three newly received original USGS OGC v1 responses for 2026. The 2026 daily body contains all 285 dates from January 1 through October 12, with original values, observation identities, approval states, qualifiers, geometry and provider metadata unchanged. All 285 are Provisional; July 31 and August 1 retain ESTIMATED.

The new daily body contains October 12, while the separately retrieved metadata ends October 11. Both observations are preserved. The original source receiving receipt records actual known acquisition facts and the separate provider body timestamps.

| Selected original period | Daily rows | Mean discharge (m³/s) | Volume over selected days (m³) |
|---|---:|---:|---:|
| 2020–2025 | 2,192 | 2.071984616 | 392,410,680.052 |
| 2026-01-01 through 2026-10-12 | 285 | 1.056960577 | 26,026,597.256 |
| 2020-01-01 through 2026-10-12 | 2,477 | 1.955197434 | 418,437,277.309 |

The extension preserves every older result. Its source comparison adds exactly 285 dates. The 2026 selected window is complete numerically; it is a partial calendar year. All original flags remain available.

The same January 1–October 12 window in each year gives a 2020–2025 mean-of-yearly-means of 2.245623251 m³/s. The 2026 window is 52.93% lower. This is a descriptive comparison against six recent years; the leap-day counts are retained and 2026 values remain provisional. Full seven-year rows and definitions are in comparable-calendar-windows.json and CSV.

## Rebuild from all exact originals

Run from opportunities/upstate_forever_2026 using the existing Node environment:

    node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/historical-input.json --output /chosen/flow-historical
    node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/2026-input.json --output /chosen/flow-2026
    node source_tools/flow_editions.mjs build --input source/daily-flow-editions-20261013/extended-input.json --output /chosen/flow-extended
    node source_tools/flow_editions.mjs compare --before /chosen/flow-historical/flow-study.json --after /chosen/flow-extended/flow-study.json --output /chosen/flow-comparison

Each build exports full flow-study.json (complete original text, explicit selections, normalized daily records, monthly/calendar/water-year summaries and sample links), editable flow-input.json, daily-flow.csv, flow-periods.csv and sample-flow.csv. Every source is verified against its supplied SHA256 before calculation. Existing different output files remain intact.

## Use the existing Measurements workspace

    node measurement_workspace/engine/cli.mjs flow-receive --workspace /existing/measurement-observations --file /chosen/flow-extended/flow-study.json
    node measurement_workspace/engine/cli.mjs flow-catalogue --workspace /existing/measurement-observations
    node measurement_workspace/engine/cli.mjs flow-read --workspace /existing/measurement-observations --id ID --output /chosen/reopened.json

The saved study lives in the original exports table. Existing Measurements portable export/reopen includes its complete original inputs and calculation. Receiving the individual flow-study JSON reparses its complete originals and requires the rebuilt scientific result to match. Original imported daily source selections also build through flow-inspect, flow-preview and flow-save. The operator API is the existing authenticated Measurements transport under /flow.

The production provider now uses the documented OGC v1 daily endpoint and explicitly pins _usgs_daily: usgs-daily-source/v2. Original unpinned imports use their original normalization, so prior saved studies retain exact replay.

## Scientific selection and meaning

- Select exact original station and series identities. More than one distinct source row on a day remains ambiguous; no latest-wins selection is hidden in normalization.
- Source dates remain original agency calendar dates. Daily volume follows the original gauge calculation: daily mean m³/s × 86,400 seconds.
- Missing, ambiguous and unquantified days remain visible. Known volume never fills missing days or scales a partial year to annual mass.
- Source observations have unique identities composed of the exact body SHA256 and JSON pointer. Original agency observation IDs remain in source_observation_id.
- Source-format field aliases are recognized only when consistent. Conflicting fields remain an explicit intake error.
- The 589 concentration rows join 153 station-date pairs to actual daily flow. Their original NLDI station relationships remain regional context: none is declared co-located whole-catchment support. Joining a date does not assign an annual pollutant load.
- Calendar, month and water-year completeness is calculated against the full calendar period, separately from completeness of the selected subperiod.
- A comparison retains both source editions, including changes in daily availability, discharge, approval, qualifiers, methods, series identity and raw representation.

The integration kernel under source_tools/observed_loads.cjs consumes explicitly selected concentration/discharge support and interpolation assumptions. It retains missing days, fractions, methods, censoring bounds and sampling limitations.

## Source and operator references

- [USGS OGC API](https://api.waterdata.usgs.gov/docs/ogcapi/)
- [USGS monitoring station](https://waterdata.usgs.gov/monitoring-location/02186702/)
- [Existing source receiving coordination](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791911379718409?thread_ts=1791724121.853269)
- Original retained nutrient derivation: source/eighteenmile-stream-nutrients-20261013/.
- Owner direction: CURRENT_OWNER_DIRECTION.md v2026-10-13.4 plus post-call build orders F0C8R2SQ0NP (current 52 orders).

Before customer presentation, use the exact original operator with these populated saved studies, view the actual desktop and390px screens, use source selections, comparison, save/reopen and open every exported attachment. The source calculation below records execution of actual data in the ChatGPT functions V8 runtime. Native SQLite/operator/browser operation is recorded by the receiving application owner with the actual invoked command and returned output.

## Completed calculation

The pure production modules executed all six original NWIS bodies and the complete new OGC body; all three full study documents reproduced exactly from their original-source inputs. Outputs include 2,192 historical,285new and2,477extended daily rows. Comparisons retain all2,192 historical rows unchanged and add285dates. The589 chemistry rows remain intact. A focused changed-source comparison exercises a changed discharge value, provisional→approved change, missing date, overlapping ambiguous source and signed flow. All physical outputs above derive from the retained original observations.
