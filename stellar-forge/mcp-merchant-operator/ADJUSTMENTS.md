# Operate merchant cancellations and refunds through MCP

The merchant MCP service exposes the original accounting adjustment controller
inside the same owned workspace used for reconciliation, periods, accountant
handoff and operating recovery. Its native request and verification files remain
the source for browser, agent and customer views.

Use this guide for the MCP operations and host contract. The
[customer SDK and command guide](./ACCOUNTING-ADJUSTMENTS-CLIENT.md) carries the
durable receiving workflow. The original
[merchant adjustment guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/ADJUSTMENTS.md)
documents the browser and native accounting command.

## Connect the existing merchant operation

Keep the existing merchant MCP configuration and its accounting workspace alias.
The host continues to select the workspace, outbox, proof directory, accounting
terms and any recovered sources. The optional adjustment transport setting names
the environment variable used by the original SF86 public RPC transport:

```json
{
  "accounting": {
    "workspaces": {
      "sales": {
        "label": "Merchant sales",
        "directory": "./accounting-workspace",
        "outboxDir": "../merchant/outbox",
        "proofDir": "../merchant/proofs",
        "termsFile": "../merchant/accounting-terms.json",
        "adjustmentHttpsProxyEnv": "HTTPS_PROXY"
      }
    }
  }
}
```

This fragment belongs inside the original merchant configuration; retain its
other fields and source aliases. `adjustmentHttpsProxyEnv` is optional. Its value
is an environment-variable name, with the actual proxy configuration supplied
privately by the host. Verification chooses the original payment's network and
its native official endpoint. MCP arguments do not select an RPC URL, signer,
network replacement, source file or credential.

Connect through the existing merchant MCP transport, open `sales` with
`merchant_accounting_open`, and use that same connection for the operations below.
The original workspace lease owns the adjustment controller and native jobs.
Do not open another accounting process on that directory while this session owns it.
An existing MCP consumer can use the exported
`@tokenjunkielabs/starforge-merchant/merchant/accounting-adjustments` client with
its current `call(name, arguments)` function; the customer guide documents the
direct connection and durable command forms.

## Select and review the original payment

1. Call `merchant_accounting_status` with `view:"runs"` to select a retained
   reconciliation. Keep its original `runId`.
2. Call `merchant_accounting_adjustment_events` with `runId`, `offset` and `limit`
   to read original ledger rows with their native adjustment totals. The
   optional `search` filters those original rows. Pages accept at most 200 items.
3. Call `merchant_accounting_adjustment_event` with the selected `runId` and
   64-character original `eventId`. Review its payment, source hashes, original
   proof identity, available amount, reverse-transfer terms and retained requests.

The event response preserves the original values rather than recalculating them
in the adapter. Atomic amounts are decimal strings. The native fields are:

| Field | Meaning |
| --- | --- |
| `grossAmountAtomic` | Original payment amount |
| `refundedAmountAtomic` | Sum of independently verified returned transfers |
| `pendingRefundAmountAtomic` | Retained refund requests in REQUESTED or VERIFYING |
| `remainingAmountAtomic` | Original gross less verified returned amount |
| `availableRefundAmountAtomic` | Remaining amount less pending requests, floored at zero |
| `cancelledAmountAtomic` | Merchant cancellations retained against this payment |
| `overRefundedAmountAtomic` | Verified returned amount above original gross, if present in retained input |
| `refundStatus` | Native NONE, PARTIAL, FULL or OVER_RETURNED classification |

Merchant cancellation records an operational decision. It preserves the original
payment and does not establish that funds returned. A refund request requires the
original independently matched payment and its retained payer, recipient, network
and asset. Its reverse direction comes from those terms. A new partial request
uses the native available amount after prior verified and pending requests.

## Retain one reviewed request

Call `merchant_accounting_adjustment_preview` with the selected payment, the
merchant's actual decision and the responsible operator:

```json
{
  "workspace": "sales",
  "runId": "<selected original run UUID>",
  "eventId": "<selected original event SHA256>",
  "kind": "REFUND",
  "amountAtomic": "<positive original-asset atomic amount>",
  "effectiveAt": "<actual decision date in UTC ISO format>",
  "reason": "<merchant reason>",
  "reference": "<merchant case or order reference>",
  "actor": "<responsible operator>"
}
```

Use `kind:"CANCELLATION"` for a merchant cancellation. The original controller
returns a normalized `request`, its stable UUID and creation time,
`previewSha256`, `workspaceRevision`, and the source review. Retain this entire
preview privately and present its payment, amount, reason and dates for review.

To record that exact decision, call `merchant_accounting_adjustment_record` with
every field of `preview.request`, the same `previewSha256`, and
`revision:preview.workspaceRevision`, plus the workspace alias. Include the
normalized `id`, `createdAt` and `reference` even when the draft omitted them.
The native controller binds the preview to the original payment, source hashes,
return terms and current adjustment capacity.

An identical UUID, normalized request and preview hash reconcile to the same
record even when its first reply was lost. Do not generate a new UUID to handle
a timeout. Inspect `merchant_accounting_adjustment` using the retained UUID;
the original request file is also available for exact comparison. If the native
controller rejects a changed revision or preview, read the current payment and
explicitly review a refreshed preview before accepting a new decision.

Recording a cancellation produces RECORDED. Recording a refund produces
REQUESTED and reserves the amount in the native pending total. This operation
does not sign, submit or execute a transfer.

## Observe an already executed reverse transfer

The original payment executor remains responsible for any authorized transfer.
Given the transaction hash from that existing execution, inspect the selected
request again to obtain its current `revision`, then call
`merchant_accounting_adjustment_verify`:

```json
{
  "workspace": "sales",
  "adjustmentId": "<retained refund UUID>",
  "revision": 1,
  "actor": "<responsible operator>",
  "transaction": "<already executed reverse-transfer SHA256>"
}
```

Replace the illustrated revision with the current returned revision. The original
SF86 reader checks the exact payment network, asset, reverse direction and atomic
amount. It retains its native verification job before its RPC read. The initial
response includes `{adjustment, job, duplicate, state}`; retain `job.id`.

Call `merchant_accounting_adjustment_job` with that ID to observe its saved
status and recover a result already written by an interrupted caller. This read
does not start another RPC verification. The customer wait helper polls this
same job and returns its current native state if its local wait expires.

| Native job state | Customer handling |
| --- | --- |
| QUEUED or RUNNING | Follow the same saved job ID |
| COMPLETED | Inspect `job.result.official`, retained verification and adjustment state |
| FAILED or INTERRUPTED | Read the saved job first; recover an existing proof or explicitly review another read attempt |

If the initial verification reply is lost, page
`merchant_accounting_adjustment` with `view:"jobs"`, select the existing job for
the submitted transaction, and read it by ID. A timeout is not a request to repeat
verification. The native controller also recognizes an existing active or
completed job for the same adjustment, transaction and endpoint.

Only an official original-network match advances the request to VERIFIED and
the canonical returned total. A retained local replay result is surfaced with
`official:false`; it leaves the refund REQUESTED. Preserve that native
distinction when displaying results. A failed or interrupted reader can retain
useful original files; job reconciliation checks them before a new attempt.

The native workspace limits concurrent refund reads, tracks their original
abort controllers, and retains their terminal jobs. Closing or pausing the
owned accounting workspace drains accepted calls and closes those native tasks.

## Withdraw an unverified request and inspect history

Use `merchant_accounting_adjustment_withdraw` with the selected `adjustmentId`,
current revision, operator and withdrawal reason only after its native read has
stopped. The original engine accepts an unverified REQUESTED refund, releases
its pending capacity and retains its full history. It cannot withdraw an
independently verified returned transfer. An identical repeated withdrawal
reconciles to the same original decision.

`merchant_accounting_adjustment` returns a compact selected record, its original
payment review and current revision. `view:"history"` pages its dated native
history; `view:"jobs"` pages its retained verification attempts.
`merchant_accounting_adjustment_status` gives exact total counts and the newest
ten requests/jobs, or full paged inventories with `view:"adjustments"` and
`view:"jobs"`. Summary responses keep source hashes and file identities while
full request and proof content remain available through original file retrieval.

## Download the exact original files

Use the existing `merchant_accounting_file` and `merchant_accounting_file_release`
operations. The same customer `fileChunks` helper supplies whole-file SHA256
continuity, bounded chunks and release on completion, early return or close.
Keep all selectors unchanged when resuming a read with its returned `readId`
and `expectedSha256`. Download to a private new file selected by the operator.

| File kind | Exact selectors | File names |
| --- | --- | --- |
| `adjustment` | `adjustmentId` | `request.json` |
| `adjustment` | `adjustmentId` and its original `jobId` | `proof.json` |
| `period` | `closeId` | `adjustments.json`, `adjustments.csv`, `adjustments.html` |
| `accountant` | `handoffId` and optional original `revisionId` | `adjustments.json`, `adjustments.csv`, `adjustments.html` |
| `export` | Original retained `exportId` | Original review TAR, including its frozen adjustment companions |

The adjustment adapter verifies the retained descriptor and regular-file bytes
before the original shared read owner creates its snapshot. `request.json` is
bound to the reviewed original payment and request. `proof.json` belongs to
the selected adjustment and completed verification job. Cross-request job
selection is rejected. A request's original proof and job files remain retained
after download; releasing a read removes only its temporary read snapshot.

Period and accountant files continue to use their original controllers and
frozen descriptors. Use the selected packet's actual file list; a legacy packet
may predate adjustment companions. The existing maintenance customer's
`download --selection PRIVATE_JSON` form accepts the same new adjustment
selectors without opening a separate accountant.

## Carry the same work into close and accountant handoff

After reading the current workspace revision, the original
`merchant_accounting_export` operation freezes the selected run and its current
native adjustment snapshot into the retained review TAR. The original exporter
includes JSON, CSV and HTML companions with their hashes and revision. Retrieve
that saved export by its `exportId`; a later live adjustment does not rewrite it.

The existing recorded-activity period close and accountant handoff operations
use that same controller snapshot. A selected close can retain a partial return
while a later live refund reaches full return. Follow the original source
identities and dates shown by each selected close or handoff. Initial packets
and reviewed accountant returns retain their three companions and protected
adjustment columns. The existing Bitwave operations use the chosen native
accountant schema and packet; this adapter does not create another export or
accounting engine.

Use the existing [accounting operation sequence](./ACCOUNTING.md) and
[Bitwave guide](./BITWAVE.md) for these operations, on this same connection.

## Continue through operating recovery

The original maintenance controller remains the owner of pause, source review,
encrypted backup, verify, restore, cancellation and resume. The customer recovery
client and new adjustment client share one MCP connection and workspace alias.
Pause drains ordinary accepted operations and owned file readers before closing
the existing accounting owner. That owner aborts and awaits its native refund
read tasks, keeping their saved requests, jobs and any written proof results.

On a cold paused open, inspect the original maintenance state and retained job
identities, complete or continue the selected native recovery, then resume the
same workspace. The original adjustment controller initializes with that
workspace and reconciles its retained native results. Inspect original request,
job, live totals and frozen close/accountant identities after reopening.

See [same-connection maintenance](./ACCOUNTING-MAINTENANCE-CLIENT.md) for the
reviewed recovery and customer command workflow. Keep the host's declared
source, backup and passphrase-environment configuration; the model does not
receive filesystem destinations or recovery credentials.

## Advertised adjustment tools

| Tool | Purpose |
| --- | --- |
| `merchant_accounting_adjustment_status` | Exact counts and paged retained inventory |
| `merchant_accounting_adjustment_events` | Original reconciliation rows and native adjustment totals |
| `merchant_accounting_adjustment_event` | One original payment and its requests |
| `merchant_accounting_adjustment_preview` | Retained review input, stable request ID and source-bound preview |
| `merchant_accounting_adjustment_record` | Save that exact reviewed request |
| `merchant_accounting_adjustment` | Selected request, original payment, history and jobs |
| `merchant_accounting_adjustment_verify` | Original RPC observation of an already executed reverse transfer |
| `merchant_accounting_adjustment_job` | Reconcile an existing saved native job |
| `merchant_accounting_adjustment_withdraw` | Retain withdrawal of an unverified request |

All tools use the original declared workspace alias. Input schemas reject
unknown fields, and mutations use the native request identity or revision.
Request and event pages accept at most 200 items; retained file reads use the
existing owner and bounded chunk contract.
