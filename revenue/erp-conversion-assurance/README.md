# ERP conversion reconciliation

This product compares complete financial and master-record exports with exact
fixed-point arithmetic and selected text comparisons, then carries the result through a retained operating
workflow. Use the [local service and operator guide](service/README.md) to stage
inputs, submit and recover jobs, export reports and replay packages, and record
reviewer decisions. The [native AGX adapter](agx/README.md) makes the same retained
jobs available to an explicitly authorized agent peer.

## Comparison engine

`reconcile.mjs` streams complete CSV files, including quoted multiline fields,
and reconciles every composite key. Declared monetary scales and per-field
tolerances use BigInt fixed-point arithmetic. Missing or unexpected keys,
duplicate keys, amount and selected text differences, and optional group-count
and group-total differences appear
in a complete machine-readable report. Invalid column mappings and malformed
precision fail the execution. Each input and mapping file has a SHA-256 digest.

Record and group identifiers in reports use HMAC-SHA-256 with the customer's
local key. Reports contain exact financial totals and exception amounts, so keep
them in the private customer workflow. The original engine keeps an index per
distinct key in memory; choose the service's resource settings for the complete
input size and available machine capacity.

The retained service copies the source, target, mapping and original engine into
an immutable bundle. Stable job IDs survive repeated agent requests and operator
reconnections. A completed report carries the original engine's result, while
reviewer decisions bind separately to its exact digest. A private replay export
includes the pinned engine, original inputs and HMAC key for an authorized
operator to reproduce the calculation.

## Run the engine directly

Use Node.js 22 or newer. The comparison engine and local operator have no npm
dependencies. The native AGX adapter pins the published AGX packages separately.
The included source and target files describe the same three example rows under
different column names.

```sh
export ERP_RECON_HMAC_KEY='use-a-private-random-key-of-at-least-20-characters'
node revenue/erp-conversion-assurance/reconcile.mjs \
  --spec revenue/erp-conversion-assurance/spec.sample.json \
  --source revenue/erp-conversion-assurance/source.sample.csv \
  --target revenue/erp-conversion-assurance/target.sample.csv \
  --out /absolute/private/example-report.json
```

| Engine exit | Result |
|---:|---|
| 0 | Complete `PASS`: unique keys, selected text, grouped row counts and amounts agree within declared tolerances |
| 2 | Complete `FAIL`: retained discrepancies are available for review |
| 1 | Execution error such as malformed input, invalid precision, missing key or file error |

`spec.sample.json` supplies source and target column aliases, composite keys,
amount scales and tolerances, and optional `group_by`. For an actual conversion,
use the agreed export schemas, tolerances and business reviewer. Record approved
exceptions in the reviewer decision while retaining the original report.

## Version 1 configuration

| Field | Purpose |
|---|---|
| `dataset` | Name of this scoped comparison |
| `keys` | Logical fields that uniquely identify a row |
| `amounts` | Logical names, integer scales from 0–8 and decimal-string tolerances; `[]` supports master records |
| `attributes` | Optional logical text fields compared under the same key |
| `source_columns`, `target_columns` | Exact CSV-header selections for every key, amount and attribute |
| `group_by` | Optional subset of keys for grouped row counts and amounts |
| `source_key_crosswalk` | Optional explicit legacy-to-target key translation |
| `workspace` | Operator metadata retained with the spec by the original service |

Choose the complete unique key for the actual export grain. A payroll allocation
may need employee, pay run and allocation line; a ledger transaction may need
journal and line as well as accounting dimensions. Mutable fields normally
belong in `attributes`, with stable identifiers in `keys`. Logical names are
distinct across keys, amounts and attributes.

Keys use trimmed Unicode NFC text. Attributes use NFC normalization while
retaining case, whitespace and empty strings. Business transformations belong
in the approved export preparation and remain visible in retained input files.

### Master records

```json
{
  "version": 1,
  "dataset": "vendor-master",
  "keys": ["vendor"],
  "amounts": [],
  "attributes": ["name", "status"],
  "source_columns": {"vendor": "OldVendorID", "name": "VendorName", "status": "ActiveStatus"},
  "target_columns": {"vendor": "VendorCode", "name": "DisplayName", "status": "Status"}
}
```

This compares identity coverage and selected text for each vendor. An attribute
difference produces `ATTRIBUTE_DELTA`, its logical field and the record HMAC.
The selected values remain in the private exports.

### Source-key crosswalk

A composite mapping can handle the same legacy account differently in different
funds or grants. Source tuples are mapped once before matching, duplicate
detection and grouping. Target rows use their declared canonical codes.

```json
{
  "source_key_crosswalk": {
    "keys": ["fund", "grant", "account"],
    "rows": [
      {"source": ["OLD-A", "GRANT-A", "6000"], "target": ["FUND-01", "AWARD-01", "EXP-600"]},
      {"source": ["OLD-B", "GRANT-B", "6000"], "target": ["FUND-02", "AWARD-02", "EXP-610"]},
      {"source": ["FUND-03", "AWARD-03", "EXP-620"], "target": ["FUND-03", "AWARD-03", "EXP-620"]}
    ]
  }
}
```

Crosswalk keys select a unique subset of the row key. Tuple values are nonempty
strings with the same trim/NFC normalization. Every source tuple must appear;
use explicit identity rows for unchanged codes. A missing tuple or duplicate
source mapping stops the comparison with a row number for correction.

Several legacy tuples may map to one canonical subset when the remaining key
fields still uniquely identify each record. A collision in the full mapped key
produces the original duplicate finding. Any many-to-one financial consolidation
uses an explicitly prepared export at the agreed target grain.

The report's `key_mapping` records logical key names, configured mapping rows,
source rows mapped and rows whose codes changed. Crosswalk values remain in the
private spec.

## Results and custody

`ERP-CONVERSION-RECON-V1` keeps its original report schema:

- `source` and `target`: rows, unique keys and original file hashes.
- `counts`: missing/unexpected keys, duplicates, amount and group differences;
  selected text fields add `attribute_delta`.
- `totals`: exact source, target and delta amounts at declared scales.
- `discrepancies`: complete key, duplicate, amount and selected text findings.
- `group_discrepancies`: grouped row counts and exact amount deltas.
- `spec_sha256`: the exact mapping and operator-metadata file used.

Missing, unexpected, amount and text findings include `source_record` and/or
`target_record` for correction. Existing duplicate findings retain `record` and
`side`. These are logical data-record numbers after the header, excluding skipped
blank records; a quoted multiline value still belongs to one record.

Amounts use fixed-point BigInt arithmetic. Excess precision is rejected.
Tolerances are nonnegative decimal strings. A row, group or complete-file total
can fail independently. Identifier-only master comparisons have empty totals.

Record and group identities use HMAC-SHA-256 with the local secret. Keep it
stable in the original retained service when following findings across
corrections. Reports contain financial amounts and remain confidential working
material. Corrected exports or mappings become new retained bundles; original
input, engine and report identities support review and replay.

## Profiles and capacity

The [SCAP nonprofit profile](profiles/scap-rfp-2027/README.md) supplies selectable
master, financial-history and payroll cohorts. The
[Columbus profile](profiles/columbus-rfp27-0008/) carries its municipal scope.
The operator maps actual export headers, approves the unique grain and selects
fields from these starting definitions.

The [Asheville utility conversion operator](profiles/asheville-cis-2026/README.md)
adds the complete CIS workspace: native meter and provider files, exact published
billing rules, original comparison and review, payments and collections, offline
field returns, and full encrypted restoration. Its
[installation guide](profiles/asheville-cis-2026/INSTALL.md) and
[operator guide](profiles/asheville-cis-2026/OPERATOR.md) cover the usable workflow.

The CSV reader handles quoted multiline fields, escaped quotes, CRLF and UTF-8
BOMs. It streams complete files and holds one entry per distinct key, so memory
grows with key count and selected fields. Configure the original retained
service's input, report, time and heap limits from actual intended exports.

## Delivery and application context

A customer implementation starts with the agreed source/target format pair,
authorized exports, mapping, report custody and acceptance criteria. The local
operator and AGX adapter share one service so transport retries, customer review
and operating handoff refer to the same job and report.

The original engine was developed for a specialist ERP conversion workshare
alongside the Columbus Consolidated Government RFP 27-0008 opportunity. Its
buyer documents and procurement-specific scope remain in the
[original delivery brief](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C861HB6Q6)
and [buyer opportunity page](https://columbusga.gov/finance/bid-opportunities).
The reusable service also supports the Ellavox paid-agent delivery coordinated
in the [original sales thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791736653764579).

MIT licensed. See each operating guide for complete commands and retained file
relationships.

