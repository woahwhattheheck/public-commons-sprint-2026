# ERP conversion reconciliation

This product compares complete source and target finance exports with exact
fixed-point arithmetic, then carries the result through a retained operating
workflow. Use the [local service and operator guide](service/README.md) to stage
inputs, submit and recover jobs, export reports and replay packages, and record
reviewer decisions. The [native AGX adapter](agx/README.md) makes the same retained
jobs available to an explicitly authorized agent peer.

## Comparison engine

`reconcile.mjs` streams complete CSV files, including quoted multiline fields,
and reconciles every composite key. Declared monetary scales and per-field
tolerances use BigInt fixed-point arithmetic. Missing or unexpected keys,
duplicate keys, amount differences and optional group-total differences appear
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
| 0 | Complete `PASS`: key sets and amounts agree within the declared tolerances |
| 2 | Complete `FAIL`: retained discrepancies are available for review |
| 1 | Execution error such as malformed input, invalid precision, missing key or file error |

`spec.sample.json` supplies source and target column aliases, composite keys,
amount scales and tolerances, and optional `group_by`. For an actual conversion,
use the agreed export schemas, tolerances and business reviewer. Record approved
exceptions in the reviewer decision while retaining the original report.

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
