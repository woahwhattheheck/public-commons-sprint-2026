# Durable buyer inbox

Keep several prepared SF88 operations in a private local inbox, execute one
selected intent through the original buyer, and inspect its history after a
restart. The inbox preserves the request and the original outcome together, so
an interrupted terminal does not erase the record of an attempted purchase.

The implementation extends this existing SF88 directory. `queue.mjs` stores
requests and attempt history; `queue-cli.mjs` exposes the operator commands;
`queue-report.mjs` renders a private offline report. Execution still calls the
original `execute.mjs`, which composes SF81 approval, SF36 reservations, SF31
HTTP and response-file delivery, and SF82 evidence. There is no second payment
client or spending ledger.

## Prepare and add requests

Use Node 22+ from the complete repository checkout. Start with an existing,
fully configured SF88 operation as described in [the buyer guide](README.md).
The configuration needs its stable intent ID, actual resource and accepted
terms, trusted operator and signer paths, and an existing private evidence
directory. Request bodies and output destinations retain their original SF88
limits and semantics.

Create the inbox at a new absolute path:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  init --root /private/buyer-inbox
```

Add one existing configuration:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /private/buyer-inbox --config /private/merchant-request.json
```

The operator workspace initializer already creates a complete `operator.json`.
Pass that existing file directly to `enqueue`; no separate inbox configuration
or extra operator copy is needed:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  enqueue --root /private/buyer-inbox --config /private/merchant-operator/operator.json
```

Enqueue validates the original execution configuration, snapshots its request
body when present, and records file hashes. It pins the trusted signer entry
file and the original policy file without copying their contents into the
report. It loads no signer, obtains no approval, makes no merchant request,
and reserves no budget. Environment variables and operator keys are never
copied into a job.

The original stable intent ID identifies the job. Reusing that ID cannot
replace its stored request. Keep the original identity when recovering an
attempt; a new ID is a different requested operation, not a retry mechanism.
The queue's request-body snapshot preserves exact bytes, including a present
empty body. Hashes identify local bytes; the original buyer still obtains and
checks the actual merchant's fresh challenge when the operator executes.

Add additional reviewed configurations with separate enqueue commands. There
is no execute-all command, background dispatcher, due-time scheduler or
automatic paid retry.

## Review the inbox

List the saved history, or inspect one exact intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  list --root /private/buyer-inbox

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  show --root /private/buyer-inbox --intent merchant-forecast-001
```

Export a private HTML report to a new absolute output path:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  report --root /private/buyer-inbox --out /private/buyer-history.html
```

The report provides a searchable cross-intent table, filters for local queue
states, saved request identities and atomic caps, original outcome and
response-file details, and exact terminal inspection/recovery commands. It
contains a static snapshot of the inbox at export time. Export another file
after more work to review the newer state.

The page works without an account or hosted service. It makes no network
requests and contains no execute buttons. Its counts describe local jobs and
attempts; it does not sum different assets or convert amounts into revenue.
Each amount stays in its original asset's atomic units. Original SF52 outcome
classifications remain separate from SF88 file-delivery status.

The report is for the private operator: it includes actual resource URLs,
amounts, operation IDs and local file paths. The renderer selects metadata
fields explicitly rather than embedding whole configurations, request bodies,
signer content, keys or raw evidence objects.

## Execute one intent

In the trusted operator terminal:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /private/buyer-inbox --intent merchant-forecast-001
```

For a request prepared by the native operator workspace, explicitly select
that existing workspace for this one intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  execute --root /private/buyer-inbox --intent merchant-forecast-001 \
  --workspace /private/merchant-operator
```

Before creating an attempt marker, the inbox opens the original workspace and
matches the saved request's operator identity, Python executable, policy and
ledger paths, signer path, evidence directory and trusted payer. Its network,
asset and recipient must match the workspace and generated signer; its atomic
cap must fit both the current workspace cap and the original signer cap. A
mismatched workspace, absent wallet environment variable, unavailable local SDK
or invalid private operator key file leaves the job `QUEUED`, with its request
and budget untouched. Correct the selected workspace and inspect
the same intent; no attempt marker has been consumed by that refusal.

After a successful match, the original workspace supplies its local SF36
operator keys directly to the existing execution environment. Keys are never
written to queue records or reports. The saved queued operation, body snapshot,
signer, policy, ledger, evidence path and output destination stay authoritative;
the workspace does not replace them with its current template operation. The
generated native signer still reads the operator's configured testnet key only
when SF81 has approved and reserved the actual fresh challenge.

Omitting `--workspace` preserves execution using the operator's existing
environment. The option is accepted only by `execute`; it does not enqueue,
approve, replay or run other intents. It also does not make a previously
attempted job executable again.

The queue checks the saved request and pinned operator files before invoking
the buyer. A permanent local attempt marker is created before control passes
to the original SF88 execution function. Concurrent processes cannot claim
that same queue job for another attempt. The original SF36 ledger separately
enforces reservation identity and budgets across the operator's clients.
The inbox never copies or directly mutates that live ledger; SF36 retains
ownership of its authorized reservation changes.

Execution retains the original terminal review and fresh merchant challenge.
The original signer and SF81/SF36 operator configuration decide whether the
single request proceeds. The queue does not issue its own consent, turn a
saved listing into approval, release reservations, or weaken an original
rejection. Entry-file pins detect changes to the selected signer file; they
do not freeze the signer's imported packages or replace trusted deployment
management. The live original policy still controls spending.

When SF88 returns, the job retains its original summary: buyer status, HTTP
status, seller-reported settlement, original outcome report, reservation
metadata, evidence path, file-save outcome and any errors. These are different
facts. An attempt can have a saved response and an unresolved payment result,
or a reported settlement and a failed local save.

SIGINT/SIGTERM use the original cancellation path and await local cleanup when
the process can do so. A stopped process or lost terminal does not make the
intent executable again. The permanent marker remains even when the client
cannot establish whether a request was signed or sent.

Cancel a request that has not started its queue execution with:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  cancel --root /private/buyer-inbox --intent merchant-forecast-001
```

Cancellation retains the saved request and uses the same exclusive permanent
marker as execution. A concurrent cancel and execute cannot both claim the
job. Cancellation cannot undo an existing attempt or release reserved funds.

## Recover an interrupted attempt

Inspect the exact intent, then ask the inbox to read its configured original
evidence file:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs \
  recover --root /private/buyer-inbox --intent merchant-forecast-001
```

Recovery uses the job's original SF82 evidence directory and the existing
`SHA256(intentId).json` filename. It does not accept an arbitrary caller-named
evidence file. The queue checks the original evidence identity and retains
its source hash, observation time, outcome and reservation metadata. It
recomputes the outcome through the original SF52 reducer instead of trusting
totals saved in the evidence file. A later report shows recovered evidence alongside
the original attempt; it does not rewrite an old HTTP result as a new call.

The existing SF82 format records the stable intent and payment terms, but not
the resource URL, HTTP method or response-file hash. Recovery reports this
binding limit explicitly. It checks the terms available in that original
format; it does not invent a stronger request or delivery binding.

When a download destination was configured, recovery reports
`REQUIRES_ORIGINAL_DOWNLOAD_SUMMARY`. It does not inspect that file or claim
it is complete. Use the original SF88 download summary for its actual save
status, bytes, hash and any retained partial path. SF82 body-capture evidence,
when present, retains its own separate meaning.

Recovery does not load the signer, contact the merchant or RPC, or mutate
SF36. Where no complete original evidence is available, the attempt remains
unresolved and its existing marker is preserved. Inspect the original
evidence and ledger with their existing tools. Do not delete the attempt
marker or replace the intent ID to make the same purchase run again.

### Read the lifecycle correctly

| Queue state | Meaning |
| --- | --- |
| `QUEUED` | A request is saved; the queue has not started its buyer attempt. |
| `RUNNING_OR_INTERRUPTED` | An attempt marker exists without a complete local queue outcome. The process may still be running or may have stopped. |
| `ATTEMPT_RECORDED` | The original execution result or failure has been retained. This does not establish settled payment or successful file delivery. |
| `RECOVERED` | The queue retained matching original terminal evidence without repeating execution. |
| `CANCELLED` | An unattempted request was cancelled locally; its saved identity remains in history. |
| `REVIEW_REQUIRED` | Listing could not read a local record consistently. Its recorded error requires operator inspection; no buyer or payment outcome is inferred. |

A queue state is not an original payment verdict. For example,
`SELLER_REPORTED_ONLY`, `PENDING_RECONCILIATION`, and
`TRANSFER_VERIFIED_DELIVERY_UNCONFIRMED` keep the meanings supplied by the
existing SF52 reducer. The report never promotes them to a completed purchase
or released budget. Response-file statuses similarly remain local delivery
facts; a partial file does not undo an attempted payment.

## Storage and composition

Keep the inbox on persistent operator-controlled storage. Its private files,
create-only request identity and durable attempt markers are designed for
restart recovery. Moving or restoring it separately from the original SF36
ledger and SF82 evidence can lose important history; preserve those original
stores when performing an operator backup. The inbox does not implement a
distributed lock across copied directories or replace SF36's durable
reservation checks.

Only source code and documentation belong in the public repository. Actual
configurations, request bodies, evidence, output files, reports and inbox state
remain in the operator's private directory.

For embedded use, `openQueue(root)` exposes the same enqueue, list, show,
single-intent run, cancellation and recovery operations as the command. Pass
`queue.run(intentId, {signal, workspace:'/absolute/operator-workspace'})` to
select an existing workspace explicitly, or omit `workspace` to retain the
original environment-based execution. The report is a pure function:

```js
import { renderQueueReport } from './queue-report.mjs';
const html = renderQueueReport({
  jobs: await queue.list(),
  queueRoot: '/private/buyer-inbox',
  generatedAt: new Date().toISOString(),
});
```

Use full job records to show the saved outcomes and recovery details. The
renderer accepts up to 10,000 records and performs no file or network I/O.
The CLI owns private, create-only report saving.

No GitHub Actions workflow or hosted validation is part of this feature.
