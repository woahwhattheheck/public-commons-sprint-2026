# Loads from a saved daily-flow study

`runFlowStudyLoads(study, contract)` in `measurement_workspace/engine/flow_loads.mjs` calculates an optional load product from the same saved Measurements study. It does not save a study, open a database, acquire data, change a source selection or match stations. The existing flow-workspace service owns persistence and export.

## Calling the bridge

```javascript
import {runFlowStudyLoads} from './flow_loads.mjs';
const loads = runFlowStudyLoads(savedFlowStudy, explicitLoadContract);
```

The return has `schema: "upstate.flow-study-loads/v1"`, unchanged `flow_study_id` and `flow_edition_id`, a `contract_sha256`, the kernel `integration`, existing-ingester `observationExports`, original `joined_rows`, complete `selected_flow_rows`, and `source_binding`. `observationExports` contains the context and admissible annual CSVs and metadata. The caller can retain them with the same saved study and export snapshot.

The complete kernel contract and unit, censoring, interpolation and coverage rules are documented in [OBSERVED_LOADS.md](OBSERVED_LOADS.md). The load contract uses an **exclusive** end date. The saved flow edition retains its original **inclusive** selected end date; the bridge admits a contract only within that selected calendar.

## Binding to the selected originals

The bridge checks the original study input SHA and every retained original response/sampling-source SHA. It uses the maintained flow normalizer to verify that the complete edition, including every ambiguous candidate, still follows that source selection. It verifies sample-date context with the original relations and samples, then calls the kernel's `retainJoinedRows` against the exact selected objects.

A different normalizer generation may have changed source-row identity. If a historical saved edition does not match the selected source generation, the bridge raises a clear error. Reopen it using its original producing source or explicitly create a successor through the normal flow-study route; do not relabel its old ID.

Every original candidate goes to the kernel. Ambiguous source-edition days therefore remain unquantified, even when the candidate values happen to agree. A missing flow day is retained in `selected_flow_rows`. No candidate is chosen by position.

The selected parent context owns each `sample_id`, including source-SHA:physical-CSV-row IDs. The full original sample object remains both in the original join and under `flow_study_original_sample` beside the mapped sample. Original sample IDs, times, methods, fractions, qualifiers and detection metadata are preserved.

## Spatial support cannot be promoted by a load contract

A contract must agree with the original station, gauge and relationship. Any claim of accepted support, matching location or matching catchment requires the saved relation to be exactly:

- `gauge_relation: "co_located"`;
- `flow_location_role: "matched_catchment_discharge"`.

Admitted support must retain the saved relation's source evidence. An explicitly recorded catchment ID must also match. Downstream-same-reach and upstream-reach relations with `regional_daily_context` stay context only. The bridge does not reinterpret proximity or network membership as coincident catchment support.

A contract can omit a station's support; its original concentration then remains context only under the kernel's normal rules. An unassigned relation cannot be replaced with a new gauge inside this bridge.

## Concentration mapping and source status

The initial adapter accepts the original derived nutrient fields: station/date, characteristic, sample fraction, value/unit, detection condition, limit value/unit, result status, qualifier, method ID and context. A canonical Measurements row without those explicit fields is rejected with the missing field names. Its generic numeric value cannot reliably supply a fraction, chemical basis, analytical method or censor direction. Such sources need a separately reviewed explicit mapping that preserves the original metadata.

The original USGS normalizer stores approval status separately from qualifier. Ordinary approved rows can have `approval_status: "Approved"`, `qualifier: ""` and `validity: []`. The joined contract explicitly uses:

```json
{
  "accepted_flow_approval_statuses": ["Approved"],
  "accepted_flow_qualifiers": [""],
  "accepted_flow_validity": [""]
}
```

The kernel's declared string conversion maps an empty validity array to the empty string. No `A` qualifier or `valid` label is fabricated. Other qualifiers, validity conditions and provisional values remain original and excluded unless an explicit contract accepts them.

## Actual source execution

The complete 20 original sources published with PR4661 reconstruct study `eb24fdf3a59f2c6d11714f06afa90d8067946e73eeaf61df9a0e85d8c88ca942` exactly. The bridge was executed on all 589 concentration rows and 2,477 selected daily-flow rows. It retained all 589 original sample-date joins, produced 19 context-only series and **zero admissible annual load rows**, and left the entire input study unchanged.

The extended flow edition includes 285 new 2026 provisional rows. The retained chemistry ends in 2025; neither the new flow rows nor the bridge invent a 2026 concentration series.

Focused execution also covered a declared matched-support example (1,036.8 kg over three days), source ambiguity, invalid regional promotion, changed catchment/evidence, changed original input or join, incomplete canonical sample mapping, and provisional-flow exclusion. These are JavaScript calculation and source-binding checks. Physical workspace saving and browser execution remain with the existing Measurements receiving course.

The exact selected contract and execution receipt accompany this source under `source/observed-load-integration-20261013/`.
