# Buyer runbook

Customer applications can use this complete original workflow through the
maintained [Node](../sf88-operator-buyer-cli/node/ACQUISITIONS.md) and
[Python](../sf88-operator-buyer-cli/python/ACQUISITIONS.md) acquisition APIs. Both
join the same request intake, immutable revisions, execution leases, accounting,
saved resources and complete operator recovery used by this workspace.

Acquire several explicitly selected resources through the **existing SF88 buyer**,
keep their original results together, and resume untouched operations after an
interruption. The runbook supplies a local job plan, exact request snapshots,
serial execution, durable attempt records, original accounting and receipt totals,
and an offline operator report. It
imports SF88's original configuration validator and launches its original CLI.
SF81 terminal approval, SF36 reservations, the original signer, SF82 evidence and
SF31 response saving continue to own their existing jobs.

The module uses Node.js 22+ built-ins. Actual execution requires the same POSIX
operator environment, installed SDKs where applicable, funded authorized signer,
private evidence directory and existing SF36 keys as SF88. Initialize and inspect
a runbook without loading a signer, reading key values or contacting a provider.
Use a full checkout so the original sibling modules remain available.

## Browser workspace

The maintained `workspace` command now provides a private browser planner and
operator desk for the same runbook. Select original buyer configs, arrange up to
64 operations, save and compare draft revisions, review exact grouped atomic
ceilings and body hashes, initialize the reviewed acquisition, and use the
original execution, cancellation, retained-output recovery and dead-owner unlock.
Saved resources, original reports and acquisition-wide accounting are available
from the same page. Accounting uses the existing SF88/SF36 core and original
operator ledgers, including automatic selection for requests received here.

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/research/workspace --configs /private/research/buyer-configs
```

Open the printed loopback URL and keep this process in the operator terminal for
the original SF81 approval. Existing runs can be registered with `--run` and
reopened alongside newly initialized acquisitions. See [WORKSPACE.md](WORKSPACE.md)
for the complete draft, execution, recovery, resource and accounting workflow.

Customers receiving an SF101 paid-file order can use **Receive paid file order**
in this same workspace. Review the original handoff, prepare the native buyer,
add it to an acquisition and retrieve or resume its entitled file from the saved
operation. [PAID_FILES.md](PAID_FILES.md) covers local operator setup, claim-token
environment names, delivery, reopening and original encrypted recovery.

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
original 16 MiB per-request body limit, within the existing 64 MiB aggregate
snapshot budget. The same length ceiling applies to the original SF36 approved
request and SF88 finalization metadata. The frozen config points to that private copy.
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

Use acquisition accounting below to invoke the original SF88/SF36 finalization
for that same SF82 evidence and reservation. If a dataset spans paid pages,
the existing buyer dataset-delivery tool can consume the individually saved
original page responses; this runbook does not invent or automatically buy the
next cursor.

## Complete original accounting

Bind each purchased operation to its existing original SF88 operator workspace:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs accounting-workspace \
  --run /private/research/run-001 --only market-dataset \
  --workspace /private/research/market-operator

node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs finalize \
  --run /private/research/run-001
```

The browser's receiving flow resolves its original operator automatically. The
native CLI reuses saved selections; for a first explicit check, pass `--workspace`
to `finalize`, optionally with `--only JOB_ID`. A shared workspace supplied to a
multi-operation check must match each selected operation's original owner and
terms. Mismatches are recorded per operation while other selected jobs continue.
Use separate saved selections for acquisitions spanning different native operators.

`finalize` processes already attempted operations in plan order. It verifies the
original started record, exact frozen config and request identity, body metadata
and canonical evidence, then delegates to original
[`finalizeOriginalAttempt`](../sf88-operator-buyer-cli/FINALIZATION.md). The original
SF36 worker remains the ledger and finality authority. No buyer, signer, payment
approval or new reservation is started. The original native workspace supplies
its accounting keys, payer, ledger, network RPC and explicitly selected proxy.

Finalized receipts retain exact actual atomic amounts and the original approved
request digest. Totals keep each network and asset separate. A later unsuccessful
check retains an earlier finalized receipt and its contribution to the total.
Unsigned responses have their original unsigned status and no payment amount or
ledger receipt. Unresolved and untouched operations remain explicitly counted.
`status.json`, `report.html` and `accounting.csv` are derived views of those saved
results. CSV has one row per operation, omits operator keys and ticket inputs, and
escapes spreadsheet formula prefixes in text fields.

The retained body digest can complete accounting after a spent body file becomes
unavailable; executing an untouched operation still requires its exact frozen
body. Original accounting can also resolve a started attempt without a complete
stdout summary when its authentic native evidence was retained. Accounting never
converts that attempt into permission to execute it again or repairs a failed
resource download.

Execution, recovery, workspace selection and finalization share the original run
lease. `SIGINT`/`SIGTERM` waits for the current accounting worker to stop and leaves
completed receipts intact. Repeating the same command resolves prior ledger
completion idempotently. A current failure exits `2`, including a `SAVE_FAILED`
view; its returned receipt is still included in the command output. Correct local
storage and refresh the same original attempt to rebuild that view.

For an existing trusted-host SF98 notification outbox, a single selected operation
can additionally pass `--outbox /absolute/original-outbox --merchant-route ROUTE`.
Both flags and `--only` are required together. The original finalizer owns that
merchant notification; remote outboxes are never inferred from buyer headers.

## Resume and recover an interrupted run

Run `status` first. It reconstructs state from retained records, including
partial/unreadable started or result files. The presence of a recorded attempt
prevents an automatic repeat even if its JSON is incomplete. Ordinary completed
runs release their execution lease. For a crashed local owner, use the PID shown
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
process-start and boot tokens distinguish reused PIDs. It records an immutable
release marker for the captured lease generation and never removes attempts or
ownership records. Repeating the same recovery can report `alreadyReleased:true`.
When `/proc` is unavailable or describes a different PID namespace, liveness uses
process signaling without trusting those unrelated process-start tokens.
An old delayed unlock can only release its old generation, even after a newer
execution starts. Concurrent acquisitions create the same next numbered lease
exclusively, so one succeeds and the others report `RUNBOOK_EXECUTION_LOCK_EXISTS`.
Retry after the active owner finishes or recover its actual dead owner.

The private `.execution-leases/` directory retains small numbered ownership and
release records. Complete records are synced before an atomic create-only hard
link publishes them. Use reliable local storage on one host with hard-link
support. Do not delete these records while using the runbook; they provide the
ordering that keeps old recovery actions separate from new execution. The
permanent `.execution-lock.json` index also makes the earlier CLI refuse a new
execution instead of starting a competing lock protocol.

An existing v1 runbook's complete `.execution-lock.json` is recognized as lease
generation `0`. The same explicit `unlock --owner-pid ...` validates that owner
and its unfinished child processes, then writes its release marker; its original
lock file remains intact. The next execution uses generation `1`. Use the updated
CLI for all subsequent execute/recover/unlock commands, including legacy recovery.
An unreadable old lock is reported without guessing an owner or deleting records.

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

The separate focused local recovery check is
`node stellar/scf-starforge-20261009/buyer-runbook/test/lease-recovery.test.mjs`.
It pauses two real unlock processes after each captures a killed owner's lease,
releases that lease, acquires a new one and resumes both old unlocks. It also
contends for the next generation and recovers a complete legacy v1 owner record.
Original attempt bytes remain intact; the existing recovery function reports its
retained incomplete result. This check performs no native buyer execution.

## Complete acquisition recovery

The existing browser workspace and installed `starforge buyer-runbook` command can review and back up a complete acquisition workspace with all its original buyer operators. Every native ledger receives an authenticated checkpoint; exact run plans, request inputs, retained files, attempts and accounting survive together. Verification checks the archive and all original journals. Restore keeps the original canonical paths and reopens the saved acquisitions without executing purchases.

See [Acquisition backup and restore](RECOVERY.md) for the complete browser and installed command workflow, source closure, passphrase handling and recovery procedure.
