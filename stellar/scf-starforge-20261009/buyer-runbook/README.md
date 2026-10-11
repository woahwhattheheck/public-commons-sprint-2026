# Buyer runbook

Acquire several explicitly selected resources through the **existing SF88 buyer**,
keep their original results together, and resume untouched operations after an
interruption. The runbook supplies a local job plan, exact request snapshots,
serial execution, durable attempt records and an offline operator report. It
imports SF88's original configuration validator and launches its original CLI.
SF81 terminal approval, SF36 reservations, the original signer, SF82 evidence and
SF31 response saving continue to own their existing jobs.

The module uses Node.js 22+ built-ins. Actual execution requires the same POSIX
operator environment, installed SDKs where applicable, funded authorized signer,
private evidence directory and existing SF36 keys as SF88. Initialize and inspect
a runbook without loading a signer, reading key values or contacting a provider.
Use a full checkout so the original sibling modules remain available.

## Assemble one acquisition job

1. Use the existing SF88 `--prepare` / `--review`, or the original SF96 merchant
   challenge handoff, to select the actual seller operation. Fill the existing
   SF88 operator, signer and evidence settings on the trusted operator host.
   Each operation needs its own stable `intentId`.
2. Put those complete original SF88 JSON configs in a private directory. A
   runbook does not infer request values from catalog examples or generate
   operator authority. Existing request-body paths must be absolute, as SF88
   requires. Config paths in the manifest may be relative to the manifest.
3. Create an explicit manifest:

```json
{
  "schema": "stellar-forge.buyer-runbook.v1",
  "id": "weekly-research-20261011",
  "title": "Research resource acquisition",
  "operations": [
    {
      "id": "market-dataset",
      "label": "Selected market data",
      "config": "./market-operator.json",
      "saveAs": "market.json"
    },
    {
      "id": "reference-report",
      "label": "Selected reference report",
      "config": "./report-operator.json",
      "saveAs": "reference.pdf"
    }
  ]
}
```

These names illustrate the input shape; no merchant, purchase or price is
provided. Every referenced config must contain the actual selected operation
and exact network, asset, recipient and atomic spending ceiling.

From the repository root:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs init \
  --manifest /private/research/jobs.json --out /private/research/run-001
```

The destination must not exist and its existing parent must be a canonical local
path. The command imports 1–64 operations, rejects duplicate job IDs, native intent
IDs and response destinations, then creates the directory with mode `0700` and
files with mode `0600`. It copies exact configs and request bodies into private
snapshots and records their SHA-256. It does **not** copy the signer module, keys,
policy or governor ledger. Existing native evidence directories stay in place.

`saveAs` is an explicit convenience for SF31's existing response writer: it sets
the frozen config's `responseFile.destination` to `run-001/downloads/NAME` and
`captureBody:false`. It requires no existing `responseFile` and no enabled
`captureBody` in that config. Omit it to retain a fully configured original
response destination and its limits. Download names are single plain filenames;
two jobs cannot select the same destination. Only `saveAs` may put an output
inside the runbook, keeping returned bytes separate from plans and journals.

Body files are copied byte for byte, including explicit empty bodies, up to the
original 1 MiB per-request limit. The frozen config points to that private copy.
Editing the source body later cannot change an initialized request. Editing a
frozen config or body is reported before invocation; initialize a new reviewed
plan when intentionally changing request terms. Runbooks execute at their
original absolute location; moving them does not rewrite operator paths.

## Review the whole job

Open the generated `report.html`, or refresh its current state:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs status \
  --run /private/research/run-001
```

The clean, monochrome report shows every concrete URL and method, intent,
operator/service identity, asset, recipient, ceiling, timeout, payment-flow cap,
request-body digest and output destination. Its budget table sums atomic strings
with `BigInt` **separately for each network and asset**. For example, two ceilings
of `9007199254740993` and `7` become exactly `9007199254741000` in their own asset.
A different asset or testnet/pubnet pair remains a different row. There is no
fiat conversion, cross-asset sum, spend approval or claim that these totals are
currently available. Original SF36 lifetime/daily/service/actor caps still apply
to each actual reservation.

`status.json` carries the same plan and original result objects. Both report
files are derived views and can be refreshed atomically. Config/body snapshots,
started records and original result files are preserved. The report has no
scripts or external resources. Its local paths and commercial metadata are
private operator context.

## Execute through the original buyer

Run from the operator's controlling terminal with the same existing environment
used for original SF88:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs execute \
  --run /private/research/run-001
```

The command visits every **untouched** operation in manifest order. An explicit
`--only reference-report` selects one existing job. It never accepts an arbitrary
shell command, alternative executable or replacement approval callback. For each
operation it checks its recorded input snapshot and local prerequisites, writes
and syncs its started record, prepares private stdout/stderr files, then invokes:

```text
node ORIGINAL_SF88/cli.mjs --execute --config FROZEN_ORIGINAL_CONFIG
```

SF88 obtains fresh seller terms and runs the existing SF81 `/dev/tty` approval.
The controlling terminal is inherited; approval is not piped or supplied by the
runbook. SF88 executes its original buyer, original evidence adapter and original
response writer. The runbook records the exact original summary and process exit.
It does not retry the unsigned/signed request or substitute its plan for live
terms, wallet authorization, governor reservation or independent reconciliation.

Independent untouched jobs continue after a failed operation. An unknown result
does not get automatically purchased again. If setup fails before an attempted
record is created, the report identifies the local problem and that job remains
untouched. Resolve it and run `execute` again. A recorded attempt remains visible
even when the original native process returned an error.

`SIGINT`/`SIGTERM` requests native cancellation and waits for the original buyer's
cleanup and result capture, then stops launching further jobs. It exits `130` or
`143`. Other command errors exit `1`; an execution pass with a failed/preflight/
incomplete native result exits `2`. A pass that only skips previously attempted
jobs returns success for that pass; inspect the report for those earlier results.

## Use saved resources and original evidence

Each report row retains the original buyer status, HTTP status,
`sellerReportedSettlement`, `originalOutcomeReport`, operator reservation,
evidence path and response-file status. Generated `saveAs` downloads have a local
download link after the original SF31 writer reports `SAVED`. Configured external
destinations and any partial path are shown exactly. The report does not promote
a saved file to a settlement or turn a seller receipt into independently proven
funds.

Use the original SF82 evidence and SF86 reconciliation tools for the same intent
and reservation when needed. The runbook's attempt record is not another budget
ledger, custody service or transaction verifier. If a dataset spans paid pages,
the existing buyer dataset-delivery tool can consume the individually saved
original page responses; this runbook does not invent or automatically buy the
next cursor.

## Resume and recover an interrupted run

Run `status` first. It reconstructs state from retained records, including
partial/unreadable started or result files. The presence of a recorded attempt
prevents an automatic repeat even if its JSON is incomplete. Ordinary completed
runs release their execution lock. For a crashed local owner, use the PID shown
by status:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs unlock \
  --run /private/research/run-001 --owner-pid 12345
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs recover \
  --run /private/research/run-001
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs execute \
  --run /private/research/run-001
```

Replace the example PID with that exact dead owner. `unlock` verifies the local
host and process; it also checks recorded unfinished child processes. Linux
process-start and boot tokens distinguish reused PIDs. It never removes attempts.
`recover` imports a complete matching original SF88 stdout summary into a separate
create-only recovery record. It records that the original exit status was not
observed, preserves any partial original result and makes no buyer call. Where
there is no complete output, the row keeps `INTERRUPTED_NO_RESULT` and directs the
operator to the retained output, original evidence and original governor ledger.
The next `execute` continues only untouched operations.

The ledger remains the source of payment/reservation truth. This local runbook
cannot determine whether a killed signer or lost reply moved funds. It makes
that specific operation inspectable and preserves its original stable identity.
It also cannot prevent a trusted local user from intentionally editing all plan
and journal files, starting the native buyer independently, or copying a stale
directory over current records. Keep its directory on reliable persistent local
storage and keep the original operator custody and governor arrangements.

## Focused native composition check

```sh
node stellar/scf-starforge-20261009/buyer-runbook/acceptance.mjs
```

This single local flow imports three explicit configs through the **original
SF88 parser**, snapshots one POST body, reviews it using the original CLI,
executes the original SF88/SF81/SF31/SF82 no-network rejection path, records actual
original buyer summaries, recovers one retained summary after an interrupted
result write and verifies that resumed execution launches none of those jobs
again. Native SF31 rejects the deliberately literal resource host before a
network or approval call; the signer throws if invoked. No SDK mock, alternate
buyer, signed request, chain payment or hosted Actions is used in that check.

Source lineage: original SF88 `config.mjs` / `cli.mjs` / `execute.mjs`, SF81
`bridge.mjs`, SF82 checkout evidence and original SF31 response-file writer.
Existing seller, dataset, deployment, accounting and grant modules are unchanged.
