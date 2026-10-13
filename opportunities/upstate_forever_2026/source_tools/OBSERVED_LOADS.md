# Measured concentration and discharge integration

This component extends the existing Upstate workbench's observation intake. It reads a selected complete daily-discharge edition and original concentration rows, retains their identity and qualifiers, and estimates mass only for explicitly matched spatial support. It does not acquire flow, choose between conflicting editions, infer a catchment, fit a trend, run InVEST, or turn unmatched concentrations into annual loads.

## Run the existing source preparation

Use Node 22.16 or later from the existing application:

```sh
node source_tools/prepare_observed_loads.mjs \
  --contract observed-load-contract.json \
  --samples nutrient-results.csv \
  --flows selected-daily-flow.json \
  --output NEW_OBSERVED_LOAD_PRODUCT
```

An optional `--joins sample-flow-joins.json` retains the parent's original sample-day join rows after checking their selected sample/date/station/flow identities. A matching sample day does not establish a matching catchment or fill unsampled discharge days. The original source files are copied exactly under `original/`. Every output is create-only, identical reentry is allowed, and manifest.json is written last. Keep sources and outputs separate. Open index.html; its links expose all original source rows, daily estimates, missing-day reasons and period coverage.

The pure engine `source_tools/observed_loads.cjs` is also callable as `integrate({contract,samples,flows})`. It has no filesystem or network dependency. The source CSV reader preserves quoted values, empty fields and original row content.

## Source contracts

Concentration rows use the existing nutrient-results.csv names: station_id, date, characteristic, sample_fraction, method_id, method_context, value, unit, detection_condition, limit_value, limit_unit, result_status, qualifier, source_file and source_row. A source sample_id can be supplied; otherwise source_file:source_row is the immutable row key. Dates are strict calendar dates. Original time/time_zone and other fields remain unchanged. The method groups never combine total/dissolved fractions, distinct constituents or analytical methods.

Discharge rows retain the existing usgs_flow.py ROW_FIELDS: observation_id, monitoring_location_id, time_series_id, date, water_year, source_value, source_unit, unit_source, discharge_m3_s, conversion_factor, approval_status, qualifier, last_modified and source_request_id. Additional edition_id/source_id/source_pointer/source_format/validity and original fields remain intact. The selected full daily series must already be reconciled. Two rows for the same gauge/date are unresolved even if their numbers agree: the component will not silently select an edition.

The contract is `upstate.observed-loads-contract/v1`. It declares period.start and period.end (exclusive), a positive maximum_interpolation_gap_days, and `daily_concentration_basis:"date_assigned_grab_with_daily_mean_flow"`. Explicit arrays name accepted concentration statuses/qualifiers, censoring conditions, flow approval statuses/qualifiers/validity. The event_sampling_policy is either retain_only or include_with_declared_bias. Samples marked event_sample remain outside interpolation under retain_only; unmarked source rows are not retrospectively classified as event samples.

Each station has exactly one support selection with original gauge_id, catchment_id, gauge_relation and original evidence references. accepted, location_match and catchment_match must each be true before mass integration. A downstream_same_reach label or upstream-network membership alone does not satisfy those conditions. source_references retain publisher/repository URLs. Seasonal intervals are explicit named subsets of the selected period. No season calendar is inferred.

## Calculation and coverage

Daily mass is concentration in mg/L × daily mean discharge in m³/s × 86.4, yielding kg/day. Concentration is linearly interpolated only between valid bracketing sample dates no further apart than the selected maximum. There is no endpoint extrapolation. The selected temporal approximation treats a date-assigned grab concentration as a daily concentration proxy; the product says so explicitly, preserves the original sample time and does not claim subdaily integration.

Quantified samples use their reported numeric values. Only the implemented original conditions Not Detected and Present Below Quantification Limit can be admitted as left censoring. A contract cannot reinterpret an above-limit, right-censored or unknown condition as a finite upper bound. Accepted left-censoring conditions use [0, reported limit] bounds in the original limit unit, with no fabricated midpoint or zero point estimate. These bounds propagate linearly into daily and period mass bounds. They are conditional censoring envelopes, not statistical confidence intervals. Other detection conditions stay unquantified. An invalid sample, unaccepted qualifier or conflicting same-day result blocks interpolation through that bracket. Identical same-day quantified values retain all their source row IDs. Event-sampling bias, unobserved peaks, flow error, laboratory uncertainty and temporal aliasing remain unquantified and are stated in every summary.

Missing discharge is not zero. Zero discharge remains a quantified zero mass. Every period reports expected, quantified, censored, sampled and interpolated days and explicit missing reasons. Annual and seasonal rows report only sums over quantified days; they never scale partial coverage to a year. Calendar-year completeness includes leap days. A period partially overlapping a year is labeled as such.

## Existing workbench observation import

`concentration-context.csv` and its metadata preserve every original concentration row as receiving-water measurement context; no concentration becomes a model residual. `annual-loads.csv` is separately produced. It contains rows only when the calendar year is complete, every day has an uncensored point estimate, spatial support is accepted, and an explicit native_comparison_mappings entry binds the exact constituent/fraction/method series to an original total-species definition and evidence. TSS and turbidity are never mapped to total sediment. Kjeldahl nitrogen and nitrate-plus-nitrite are not individually total nitrogen.

Use the existing API after reviewing the original catchment binding:

```python
import json
from model.observations import ingest
context = ingest(ws, CONTEXT_CSV, json.load(open(CONTEXT_METADATA)))
# Use the same existing observation importer for annual-loads.csv only when it contains rows.
```

The unchanged public source function is `model.observations.ingest(ws, path, metadata)`. The importer preserves its original annual_mass_rate/species/coverage/physical-catchment checks. Annual rows are estimates derived from measurements and a declared interpolation method, not direct annual measurements or native model outputs.

## Actual retained Eighteenmile product

The executed V8 source course uses all 589 original nutrient rows and all 2,192 retained daily gauge values from 2020–2025. All 31 members in the original gauge source bank were independently byte/hash verified. The source records form 19 constituent/fraction/method series at four stations. All 181 below-quantification rows retain their original limits. Original network support identifies SV-233 downstream of the gauge on the same reach and the other three stations on distinct upstream reaches. None is declared coincident catchment/flow support, so the actual product emits 19 context-only series and zero annual mass comparison rows. That is an actual data result; no loads were fabricated to make the workflow appear complete. New explicitly matched station series can be processed through the same unchanged engine.

Thirteen focused dimensional/support executions cover a known mass sum, zero/missing flow, duplicate flow editions, conflicting chemistry, censor bounds, extrapolation, maximum gap, fractions, spatial support, event policy, complete/incomplete leap-year annual admission, and explicit refusal of right-censor inversion. These are method examples, not environmental observations. The exact engine also ran the retained 589/2,192 source inputs. Physical Node filesystem and browser operation remain the existing equipped recipient's continuation.

## Scientific sources

- USGS explanation of concentration × co-located discharge and linear interpolation: https://water.usgs.gov/nawqa/pnsp/pubs/wrir984222/methods.html
- USGS NWQN methods, including different estimation methods and their application limits: https://doi.org/10.3133/ofr20171120
- USGS LOADEST documentation on model specification, censoring and bias: https://water.usgs.gov/software/loadest/
- Actual retained concentration source: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/opportunities/upstate_forever_2026/source/eighteenmile-stream-nutrients-20261013/derived/nutrient-results.csv
- Actual station/network mapping: https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/opportunities/upstate_forever_2026/source/eighteenmile-stream-nutrients-20261013/derived/station-network-context.csv

LOADEST and WRTDS are not implemented or claimed here. The bounded interpolation method is a transparent first integration option; its uncertainty paragraph explains what it does and does not quantify.
