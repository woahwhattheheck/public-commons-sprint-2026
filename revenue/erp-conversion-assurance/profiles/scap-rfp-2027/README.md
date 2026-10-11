# SCAP conversion profile

This profile connects nonprofit conversion work to the existing ERP comparator
and retained operator workspace. The [issuer's RFP 2027](https://scapnc.org/wp-content/uploads/2026/10/REQUEST-FOR-PROPOSALS-Accounting-Software.pdf)
defines conversion and acceptance work in §18, nonprofit demonstrations in §25,
and usable data return in §31. The October 11, 2026 source review found questions
and answers dated October 12 and proposals dated October 19 in §32.

## Select the actual comparison

`profile.mjs` exports `SCAP_PROFILE`. Its nine cohorts cover account structure,
ledger history, suppliers, customers/funders, staff, payroll history, labor
distributions, fixed assets and award/program structure. Four grouped scenarios
help the operator keep related conversion trials together.

Each cohort supplies logical field suggestions. The operator selects actual
source and target headers, the nonempty unique row key, text attributes, amount
precision/tolerances and grouping fields. Adjust the template to the agreed
export grain and available fields before running it. For example, keep a
payroll register at its actual employee/run/line grain and labor distributions
at their separate allocation grain; repeating register totals on allocation
rows changes the meaning of the comparison.

| Comparison | Configure |
|---|---|
| Master identity | Stable key fields and `amounts: []` |
| Master field continuity | Optional `attributes` selected from both actual exports |
| Renamed fund, grant or account codes | Explicit composite `source_key_crosswalk` |
| Financial history | Declared decimal amounts and exact tolerances |
| Group continuity | Selected key dimensions for both row counts and totals |

An optional dimension with empty or unavailable identifiers cannot serve as a
unique key field. Select a stable available key and compare that dimension as a
text attribute when its original values, including blanks, should be preserved.

## Operate a conversion trial

1. Name the cohort, historical period or other exact scope, conversion
   responsibility and receiving reviewer. Preserve the chosen profile in the
   retained spec.
2. Supply the original source and target exports. Map their actual headers,
   declared key grain and selected comparison fields in the operator.
3. For renamed codes, enter the approved source-to-target tuple rows. Include
   unchanged tuples explicitly. The original engine requires complete mapping
   coverage and reports any collision in the full translated record key.
4. Run the original retained job and inspect missing rows, duplicates, selected
   text changes, exact amounts and grouped differences.
5. Correct an input or mapping through a new immutable bundle linked to the
   previous job. Keep the correction reason with the new spec.
6. Record the accepting review against the exact completed report, then export
   the original inputs, configuration, engine, report and review for the
   receiving operator's replay and handoff.

The principal ERP application performs its native nonprofit operations. Use its
agreed exported results in these conversion trials so an invoice, payroll,
allocation or asset scenario remains traceable to the same source activity.

## Profile integration

The operator imports `SCAP_PROFILE` as its default. Other implementations supply
JSON with the same plain-object shape through the original host's profile
option: `id`, `title`, `source`, `cohorts` and optional `scenarios`. Each
cohort has `id`, `title`, `purpose`, `keys`, `amounts`, `attributes` and
`groupBy`. Scenario cohort IDs refer to that same catalog.

The service retains the selected profile snapshot in `spec.workspace.profile`.
Comparison behavior remains in the original version 1 spec and
[reconcile.mjs](../../reconcile.mjs). The existing service owns bundle IDs, job
execution, correction lineage, report hashes, reviewer decisions and replay.
