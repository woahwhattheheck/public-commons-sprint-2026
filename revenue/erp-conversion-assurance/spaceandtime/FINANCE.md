# Run and deliver the retained finance comparison

`finance.mjs` carries a prepared native acquisition through the existing ERP
service. It retains the original query responses and mapping, stages the exact
source/target/spec files, runs the original comparison engine, reconnects to
that job, records the operator's review and exports a complete private delivery.
The existing service and browser workspace remain the comparison and review
implementation.

Use Linux, Node.js 22 or later and `flock` in `PATH`. Keep the complete source
checkout: the service imports the existing fleet state lease. No npm package,
hosted workflow or additional service account is needed by this operator.

## Prepare once, run by identity

First use the acquisition commands in [README.md](README.md) to produce a
private prepared directory. It contains `source.csv`, `target.csv`, `spec.json`,
`acquisition.json`, all `originals/` and `manifest.json`. Preparation preserves
the original native records, exact decimal values, selected columns, query
window, source lineage and explicit business mapping.

From the repository root:

```sh
umask 077
export ERP_RECON_DIRECTORY=/absolute/private/customer-finance

node revenue/erp-conversion-assurance/spaceandtime/finance.mjs init

node revenue/erp-conversion-assurance/spaceandtime/finance.mjs run \
  --prepared /absolute/private/prepared-period \
  --job-id customer-ledger-period-1
```

`init` creates one private customer root. Every other operating command requires
that root to exist, so a misspelled path does not silently create a new customer
identity. `--directory` can replace the environment variable on each command.
The original service supports explicit `--max-input-bytes`,
`--max-report-bytes`, `--timeout-ms` and `--max-heap-mib` limits during `init`;
its saved configuration controls future executions.

The bridge checks every manifest path, original file size and SHA-256, then
copies the complete acquisition into the customer's retained root. It stages
the source, target and spec from that retained copy through
`openReconciliationService().stageBundle()`. The service also retains the
original engine revision in its immutable bundle.

`run` waits for the original service job. It prints the native job plus the
acquisition relationship. `operate` performs the same work and can also export
the complete delivery after a completed comparison:

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs operate \
  --prepared /absolute/private/prepared-period \
  --job-id customer-ledger-period-1 \
  --destination /absolute/private/deliveries/period-1
```

The destination's parent must already exist and be private. The delivery
directory must be new. A comparison containing discrepancies is still a
completed report and is exported by `operate`; the command retains exit `2`.
The operator's later review is a separate explicit action.

Repeating the same job ID and same prepared acquisition reopens the original
bundle and job. It does not adopt a newly deployed engine for a previously
submitted run. Different source bytes, mapping or acquisition metadata need a
new job ID. Passing `--bundle-id` instead of `--prepared` reconnects to a known
original service bundle.

To stage a prepared acquisition before executing it:

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs stage \
  --prepared /absolute/private/prepared-period
```

Use the returned `bundle.bundleId` with `run --bundle-id`. Staging does not run
the comparison.

## Read progress and handle an interruption

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs list --limit 25
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs status \
  --job-id customer-ledger-period-1 --wait
```

The original states are `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`,
`INTERRUPTED` and `CANCELLED`. A `COMPLETED` comparison has result `PASS` or
`FAIL`. Failures in file parsing, precision or execution remain operation
errors. `--wait-timeout-ms` and `--poll-ms` control only this invocation's wait;
an expired wait leaves the original job available.

Use `cancel --job-id ID` to request that the original worker stop. After
inspecting an interrupted, failed or cancelled job, use
`recover --job-id ID --wait` to invoke the service's original recovery. It
adopts an already completed report when available or recomputes the same
retained bundle. Status and ordinary reconnects do not silently request a new
attempt.

## Export the original report and record the review

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs export \
  --job-id customer-ledger-period-1 \
  --destination /absolute/private/deliveries/period-1-report.json
```

The export receipt identifies the exact report digest and byte count. The
destination must be a new file. `report --job-id ID` instead writes the original
report bytes to stdout for an existing local integration.

After reviewing the actual result, use its digest with the real operator name
and decision:

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs review \
  --job-id customer-ledger-period-1 \
  --report-sha256 REPORT_SHA_FROM_EXPORT \
  --reviewer "Actual operator name" \
  --decision accepted \
  --note "Actual review conclusion and any approved exception reference."

node revenue/erp-conversion-assurance/spaceandtime/finance.mjs reviews \
  --job-id customer-ledger-period-1
```

`changes_requested` records a correction request. The service retains each
review event against the exact original report SHA; it does not replace the
underlying calculation. A corrected acquisition or mapping becomes a new
prepared bundle and job, with the previous relationship retained in
`spec.workspace`. If a review command's result was interrupted, inspect
`reviews` before deciding whether another review event is needed.

## Deliver the whole operation and replay it

```sh
node revenue/erp-conversion-assurance/spaceandtime/finance.mjs deliver \
  --job-id customer-ledger-period-1 \
  --destination /absolute/private/deliveries/period-1-reviewed
```

| Delivered content | Retained relationship |
| --- | --- |
| `acquisition/` | Exact prepared manifest, original request/response bytes, selected native query or retained-input descriptors, both source CSVs, original mapping and acquisition metadata |
| `comparison/` | Original service replay package: inputs, pinned engine, job state, exact report, original reviewer events and the customer's HMAC key |
| `delivery.json` | Complete file inventory, original job/bundle/report identity, acquisition-manifest digest and original replay-manifest digest |
| `replay.mjs` | Standalone inventory validation followed by the original service's standalone comparison replay |

The complete package is private customer material. The original service's HMAC
key reproduces its record identifiers and is included in `comparison/`; use the
agreed private delivery route. Source publication contains only the reusable
implementation and documentation.

The delivery receipt prints the command with its exact manifest SHA:

```sh
node /absolute/private/deliveries/period-1-reviewed/replay.mjs \
  --manifest-sha256 DELIVERY_SHA_FROM_RECEIPT
```

The standalone runner verifies every included file and both native manifest
pins, then invokes the unchanged service replay. It keeps the delivered report
and creates `comparison/replayed-report.json`. A fresh calculation timestamp
is expected; `matchesDeliveredReport` compares the remaining complete report
content. A later replay uses `--out another-report.json` and preserves the
previous file. The same command is available as
`finance.mjs replay --destination DIRECTORY --manifest-sha256 SHA`.

The customer root retains `acquisitions/<manifest-SHA>/` and
`acquisition-links/<bundle-SHA>.json` alongside the original service's bundles,
jobs, reviews and HMAC key. Keep those directories together in private
operational backups. Reconnecting to a job or exporting its delivery does not
require the original temporary preparation directory or the source API account.

| Exit | Meaning |
| --- | --- |
| `0` | Successful management/export, completed `PASS`, or a replay matching a delivered `PASS` |
| `2` | Complete discrepancy report, or a replay matching that delivered discrepancy report |
| `1` | Input, custody or execution error; interrupted job; expired operator wait; replay difference |

Run `node revenue/erp-conversion-assurance/spaceandtime/finance.mjs --help` for
the full command reference. The [original service guide](../service/README.md)
defines its comparison, resource, revision and recovery behavior.
