# Original daily-flow support for annual reference periods

This continuation uses the maintained `calibration_context.mjs` and the original 13 USGS daily-flow series for 2020–2025. It preserves the existing 78 calendar-year rows, 936 calendar-month rows, 2023 comparison and lake-study window. The added operation answers a separate source question: which original daily-flow dates support each selected reference record, using that record's actual period and declared flow gauge?

## Receive the complete source

The source folder is `source/hydrology-huc05-07-20261013/` in the current Upper Savannah application. Keep the original daily14 and NLDI34 families together. The replay reads `reference-support-inputs.json`, verifies every retained member, reuses the original RDB parser and checks all six existing calendar outputs against `calibration-inputs.json`.

The source-only selection `flow-support/source-period-selection.json` covers the original 2020-01-01 through 2025-12-31 capture for each of the 13 source gauges. Its exclusive end is 2026-01-01. It records source support and does not introduce annual-load observations.

Run from the application root:

```sh
node source/hydrology-huc05-07-20261013/rebuild_reference_support.mjs \
  --source-root source/hydrology-huc05-07-20261013 \
  --output "$OPERATION/flow-source-support"
```

This prepares the complete unchanged source family, the existing calendars, the selected binding, reference-period JSON/CSV, station date availability and an ordinary `upstate.sources/v1` manifest. An existing identical output is reused. Choose another output directory for another binding or source edition.

## Use the original annual-reference binding

The existing annual-reference resolver exposes `reference_records`. Each row retains its original `id` / `record_id`, `observation_id`, station and catchment IDs, `flow_station_id`, parameter, method, source records and `period_start` / `period_end`. The binding also retains the original preparation, Workspace and source selections.

Save that existing resolver result as JSON and pass it directly. The existing CLI `annual-references` catalogue is also supported; supply `--import-id` with its original `imports[].import_id` to select the same record:

```sh
node source/hydrology-huc05-07-20261013/rebuild_reference_support.mjs \
  --source-root source/hydrology-huc05-07-20261013 \
  --binding "$OPERATION/original-annual-reference-binding.json" \
  --output "$OPERATION/annual-reference-flow-support"
```

The pure source API is:

```js
import {calibrationPeriodSupport, calibrationSupportFiles}
  from "./calibration_context.mjs";

const support = calibrationPeriodSupport(originalRecords, originalManifest,
  originalStationInventory, originalAnnualReferenceBinding);
const files = calibrationSupportFiles(support);
```

The source owner's existing `calibrationBuild(records, manifest, inventory)` interface and default outputs remain unchanged. SCI13/BC0B can compose the optional support into its current Observed-water intake. The annual-reference producer, original load estimator, selected catchments and calibrated model outputs keep their existing identities.

## Date and gauge semantics

Reference periods use **[start, end)**. Dates are the original YYYY-MM-DD tokens. The existing calendar kernel has an inclusive final date; the adapter translates the reference end once by subtracting one day. It retains the original reference period and explicitly marks the nested source summary's inclusive end.

A source period can cover only part of a reference period. Each record includes requested days, the intersection with the captured period, days outside that capture, original record days, numeric days, absent dates, nonnumeric dates, independent A/e/P/R counts and exact numeric date ranges. Numeric availability ranges also use exclusive ends.

The gauge binding comes from the original `flow_station_id`, including the source producer's `source_records.flow_station_id`. If that field is absent, the same original USGS station ID can match itself. A concentration station's proximity, name or catchment never selects a different flow gauge. An explicitly retained time-series ID must match the original selected `ts_id`.

Records whose gauge is outside the 13-series edition remain in the result with an explicit source-support status. A missing flow binding remains distinct from a selected gauge with missing daily values. These outcomes preserve the selected reference record so its established source owner can join the correct original hydrology.

## Quantities and qualifiers

Daily discharge remains parameter 00060 / statistic 00003 in ft³/s. The existing source kernel adds original decimal values using an exact BigInt numerator before finite-number conversion. It retains the owner's interpolated daily percentiles, available-day means and original station drainage-area metadata.

`covered_days_volume_m3` integrates only original numeric daily means, using the source author's exact 0.028316846592 m³/ft³ conversion and a nominal 86,400-second reporting day. It is a covered-days quantity. `complete_reference_period_volume_m3` exists only when every requested date has a numeric value and the captured period contains the entire reference interval. Missing days are never filled or scaled into an annual volume.

Approved, estimated, provisional and revised flags are counted independently. A source value can be both approved and estimated. Complete numeric support can therefore still contain estimated or provisional values; the original tokens and distinct approved-complete field remain available.

The actual six-year source selection yields seven fully covered gauges and six with partial numeric support. The original 2024-09-24 Horse Creek `Rat/P` row remains a reported nonnumeric observation. The complete default period table includes all 13 source gauges and their original time-series IDs.

## Bring the prepared support into the same Workspace

Use the existing source import action, or its CLI:

```sh
"$PYTHON" -B -m model.cli --workspace "$WORKSPACE" source-import \
  "$OPERATION/annual-reference-flow-support/reference-support.sources.json"

"$PYTHON" -B -m model.cli --workspace "$WORKSPACE" source-import \
  "$OPERATION/annual-reference-flow-support/nldi/model-sources.json"
```

The first manifest imports the period-support table and station date index with the complete retained source companions and original selected binding. The second imports the unchanged original gauge points, whole upstream catchments and station/basin bindings under their existing IDs. The current regional support and Observed-water desks consume these source collections through their maintained selectors.

NLDI whole-catchment support retains `simplified=false` and `splitCatchment=false`. Exact gauge-split drainage support remains a separate original source operation. Reporting, upstream and utility domains retain their existing selectors. The period-support calculation does not substitute one geometry for another.

## Retained outputs

| File | Purpose |
| --- | --- |
| `reference-support.sources.json` | Native Workspace source entries and complete companions |
| `flow-support/selected-reference-binding.json` | Original selected binding, unchanged |
| `flow-support/reference-period-support.json` | Complete original record bindings, periods, numerical support and methods |
| `flow-support/reference-period-support.csv` | Comparable per-record source-support table |
| `flow-support/station-date-support.json` | Exact numeric and source-qualified date availability for all 13 gauges |
| `nldi/model-sources.json` | Existing whole-catchment and gauge source entries |
| `derived/calendar_year_flow.csv`, `derived/calendar_month_flow.csv` | Unchanged source-author annual and monthly results |

The original source-request lineage is retained in `source-manifest.json`; all 26 NLDI responses retain their capture manifest and original URLs. Public source editions are daily flows PR3038 and original NLDI geometry PR3089. This continuation is coordinated in the existing source thread at https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791866330384569 .
