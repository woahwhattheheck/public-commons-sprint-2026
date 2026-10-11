# Merchant adjustments through the existing MCP service

Use the original merchant accounting workspace to review payments, record a merchant cancellation or refund request, observe an already executed reverse transfer, and deliver its retained files. The customer SDK and command use the same adjustment controller as the [original workspace](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/ADJUSTMENTS.md). The [MCP adapter guide](ADJUSTMENTS.md) describes the host configuration and native tool contracts.

## Installed entry points

| Interface | Entry point |
| --- | --- |
| Customer command | `starforge merchant-accounting-adjustments` |
| Existing merchant command | `starforge merchant-mcp adjustments` |
| JavaScript SDK | `@tokenjunkielabs/starforge-merchant/merchant/accounting-adjustments` |
| Prepared operations and file delivery | `@tokenjunkielabs/starforge-merchant/merchant/accounting-adjustments/operations` |

The command connects to a host-declared workspace alias through its existing HTTPS or loopback HTTP MCP listener. The host already has the original accounting directory, source aliases and native reader configuration. Use the original host's token environment variable; credentials are never stored in the operation file. The SDK also accepts the application's initialized stdio or in-process MCP call function.

There is no payment-signing interface in this customer. Refund verification accepts a transaction hash that already exists and asks the original reader to inspect its transfer. Host transport configuration remains with the operator.

## Choose the original payment

Open the configured alias once for the host session. Subsequent customer commands leave that workspace open:

```sh
starforge merchant-accounting-adjustments open --url "$MCP_URL" --workspace merchant
starforge merchant-accounting-adjustments status --url "$MCP_URL" --workspace merchant
starforge merchant-accounting-adjustments events --url "$MCP_URL" --workspace merchant \
  --run-id "$RUN_ID" --limit 50
starforge merchant-accounting-adjustments event --url "$MCP_URL" --workspace merchant \
  --run-id "$RUN_ID" --event-id "$EVENT_ID"
```

Use the returned original run UUID and event SHA256. Event results retain the original source and payment identity, original proof descriptor, refund direction and native totals. Follow returned offsets when selecting older records. Status offers `summary`, `adjustments` and `jobs`; an individual adjustment offers `summary`, `history` and `jobs`.

| Native total | Meaning |
| --- | --- |
| `grossAmountAtomic` | Original gross payment in that asset's atomic units |
| `refundedAmountAtomic` | Amount supported by the original controller's verified reverse transfers |
| `pendingRefundAmountAtomic` | Retained requests still in REQUESTED or VERIFYING |
| `remainingAmountAtomic` | Gross less verified returned amount |
| `availableRefundAmountAtomic` | Remaining amount less pending requests, floored at zero |
| `cancelledAmountAtomic` | Separately recorded merchant cancellations |

Keep all atomic amounts as decimal strings. Preserve the original network and asset when comparing totals. A cancellation records the merchant's dated decision; it does not create a reverse transfer. The original gross row remains available alongside later adjustments.

## Retain a preview, then record that request

Create an owner-controlled operation parent with mode0700, and keep input JSON files private (mode0600). For example:

```sh
umask 077
mkdir -m 700 ./merchant-operations
```

A draft contains `runId`, `eventId`, `kind` (CANCELLATION or REFUND), `amountAtomic`, `effectiveAt`, `reason`, `actor`, and an optional `reference`. Use a real selected amount within the event's returned capacity and an exact UTC effective date. The original preview supplies normalized fields, a stable `id`, `createdAt`, `previewSha256`, and `workspaceRevision`.

```sh
starforge merchant-accounting-adjustments preview --url "$MCP_URL" --workspace merchant \
  --request ./merchant-operations/draft.json --out ./merchant-operations/reviewed-preview.json
starforge merchant-accounting-adjustments prepare --url "$MCP_URL" --workspace merchant \
  --action record --preview ./merchant-operations/reviewed-preview.json \
  --dir ./merchant-operations/record-request
starforge merchant-accounting-adjustments execute --dir ./merchant-operations/record-request
```

Review the complete preview before `execute`. Preparation itself makes no merchant call. The client verifies the native preview binding over its request, original payment, source, refund terms and totals, then retains the complete original result. Recording submits its exact normalized request, UUID, preview digest and observed revision.

If the reply is interrupted, run:

```sh
starforge merchant-accounting-adjustments reconcile --dir ./merchant-operations/record-request
```

Reconciliation reads that UUID and compares its original request and preview digests. It never creates a replacement request. A stale revision or changed preview needs a fresh original-event review. Keep the previous preview and reconcile an uncertain record before preparing a replacement.

## Observe a refund and recover its original job

After the refund request is recorded, inspect its current detail. Prepare private native arguments containing exactly:

```json
{
  "adjustmentId": "THE_ORIGINAL_ADJUSTMENT_UUID",
  "revision": 33,
  "actor": "Merchant operator",
  "transaction": "THE_ALREADY_EXECUTED_REVERSE_TRANSFER_SHA256"
}
```

The revision above is illustrative; use the original workspace's currently returned revision. The amount, asset, payer, recipient and original network come from the saved request and original proof. The native reader checks the reverse direction and exact transfer.

```sh
starforge merchant-accounting-adjustments prepare --url "$MCP_URL" --workspace merchant \
  --action verify --request ./merchant-operations/verify-arguments.json \
  --dir ./merchant-operations/refund-read
starforge merchant-accounting-adjustments execute --dir ./merchant-operations/refund-read --wait-ms 30000
starforge merchant-accounting-adjustments reconcile --dir ./merchant-operations/refund-read --wait-ms 30000
```

The original controller stores its verification job before the read. The client checkpoints the send boundary before calling it, retains the returned job UUID, and reads that same job on reopening. If a response is lost before the UUID arrives, it searches the selected adjustment's retained jobs by the exact transaction. It verifies a stable revision while paging, preserving the original jobs' identities and order. A changed inventory asks for another current read instead of silently treating a missing page as absence.

`reconcile` never calls verification. A repeated `execute` first reconciles the original operation. After an uncertain verification send, it continues to inspect that original attempt rather than issuing another native read. This matters because the native engine deduplicates active/completed attempts, while a genuinely failed read may be explicitly retried.

To adopt a known original job, prepare with `--job-id "$JOB_ID"`. That operation only reads the selected job, even if invoked with `execute`. To explicitly retry a retained FAILED or INTERRUPTED job, inspect its original error, any recovered proof and current workspace revision, then prepare a new operation with `--after-job-id "$FAILED_JOB_ID"`. The predecessor must belong to this same refund and transaction. A caller timeout alone does not establish a failed native job.

| Original state | Customer interpretation |
| --- | --- |
| QUEUED / RUNNING job | Keep the original job UUID and poll it |
| COMPLETED job | The native read finished; inspect its actual result and adjustment state |
| FAILED / INTERRUPTED job | Retain its error and proof recovery result; an explicit new attempt can select it as predecessor |
| REQUESTED / VERIFYING refund | The request remains pending |
| VERIFIED refund | The original controller accepted its reverse-transfer evidence |
| WITHDRAWN refund | The unverified request was withdrawn with retained actor/reason history |
| RECORDED cancellation | The merchant cancellation was recorded |

A completed read is distinct from a verified refund. Preserve `job.result.official`, the original adjustment status, and the original proof's source/verdict. Controlled-response or loopback operating runs retain their actual transport attribution; they do not establish a live-chain refund. Merchant effective time, native transfer time and verification observation time remain separate fields.

## Withdrawal and history

Withdrawal applies to an unverified REQUESTED refund after its current read has finished. Prepare private arguments `{adjustmentId, revision, actor, reason}` with `--action withdraw --request FILE`, then execute the retained operation. A verified return cannot be withdrawn.

After an interrupted withdrawal, reconciliation reads the original history and requires the retained final WITHDRAWN entry to match the prepared actor and reason. Another operator's different withdrawal is returned as an input conflict.

```sh
starforge merchant-accounting-adjustments detail --url "$MCP_URL" --workspace merchant \
  --adjustment-id "$ADJUSTMENT_ID" --view history --limit 50
starforge merchant-accounting-adjustments detail --url "$MCP_URL" --workspace merchant \
  --adjustment-id "$ADJUSTMENT_ID" --view jobs --limit 50
```

These are original records, with original job IDs, dates, errors and recovered-result status. There is no separate customer ledger.

## Deliver original request, proof and accounting companions

Use file descriptors from the selected adjustment, completed job, original period close or accountant handoff. Select a request with:

```json
{"kind":"adjustment","adjustmentId":"THE_ORIGINAL_ADJUSTMENT_UUID","file":"request.json"}
```

Select its proof with the original completed job UUID:

```json
{"kind":"adjustment","adjustmentId":"THE_ORIGINAL_ADJUSTMENT_UUID","jobId":"THE_ORIGINAL_JOB_UUID","file":"proof.json"}
```

```sh
starforge merchant-accounting-adjustments download --url "$MCP_URL" --workspace merchant \
  --selection ./merchant-operations/proof-selection.json --sha256 "$ORIGINAL_FILE_SHA256" \
  --out ./merchant-operations/refund-proof.json
```

The customer reuses the maintained SHA-pinned file reader and private delivery function. Every chunk retains its original selectors, digest, size and offset; the complete file is published only after the complete SHA matches. The destination must be new. Partial reads are released through the existing host's reader ownership.

Original period/accountant `adjustments.json`, `adjustments.csv`, `adjustments.html`, and retained TAR companions use their existing `period` or `accountant` file selectors and original close/handoff identities. Read those frozen descriptors directly. A later live refund does not revise an earlier frozen close. Native CSV/HTML rendering remains in the original accounting engine.

## SDK and caller lifetime

```js
import { createAccountingAdjustmentClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-adjustments';
import { prepareAccountingAdjustmentOperation, runAccountingAdjustmentOperation,
  downloadAccountingAdjustmentFile } from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-adjustments/operations';

const client = createAccountingAdjustmentClient({
  workspace: 'merchant',
  call: initializedMerchantConnection.call
});
const original = await client.detail({ adjustmentId, view: 'jobs', limit: 50 });
const prepared = await prepareAccountingAdjustmentOperation({
  directory: privateOperationDirectory,
  url: originalHostUrl,
  workspace: client.workspace,
  kind: 'verify',
  arguments: { adjustmentId, revision: original.revision, actor, transaction },
  jobId: originalCompletedJobId
});
const result = await runAccountingAdjustmentOperation({
  directory: prepared.directory,
  client,
  execute: false
});
await downloadAccountingAdjustmentFile({
  client,
  selection: { kind: 'adjustment', adjustmentId, jobId: result.job.id, file: 'proof.json' },
  expectedSha256: result.job.result.verification.sha256,
  output: newPrivateProofFile
});
await client.disconnect();
```

`connectAccountingAdjustmentClient({url, workspace, tokenEnv, environment})` creates an initialized customer connection to an existing HTTP listener. The injected factory supports the same original stdio/in-process connection without another host.

The SDK provides `status`, `events`, `event`, `preview`, `record`, `detail`, `history`, `jobs`, `verify`, `job`, `withdraw`, `reconcileRecord`, `reconcileVerification`, `reconcileWithdrawal`, and `waitForVerification`. Paging uses the native `offset`, `limit`, `total` and `nextOffset` fields.

Use `fileChunks` for streamed delivery. A partially consumed iterator retains a caller-owned reader; finish/return it or call `disconnect()`. An application that opened a file through its own same-connection call can register the returned original `readId` with `registerFileRead`. `drainFileReads` and maintenance pause release those original handles after admitted reads finish.

`disconnect()` drains this caller's admitted calls and readers, returns its retained verification job IDs, and leaves the original workspace and native jobs available. It does not own the injected transport; the application closes that transport when appropriate. `close()` is an explicit workspace handoff through the original `merchant_accounting_close` tool, including the native owner's shutdown behavior. Do not use workspace close as routine cleanup after each customer request.

`maintenanceStatus`, `maintenanceJob`, and `maintenanceCommand` reuse the original [accounting maintenance workflow](ACCOUNTING-MAINTENANCE-CLIENT.md). Pause/close stop new local admission, drain admitted calls and original readers, then call the maintained controller. No second recovery process is created.

## Retained state and exit results

Each prepared directory contains the original request (including its native preview when recording) and an atomic local observation journal. It retains the host URL, alias, token environment **name**, original arguments, request digest, send boundary and selected native job. Preserve that directory across an interrupted caller. It contains no token or passphrase.

The original state-lease helper prevents two processes from submitting the same local operation concurrently. Files are private, owned regular files; prepared directories are new and not silently overwritten. Source-state mismatch is reported before submission.

| Exit | Meaning |
| --- | --- |
| 0 | Prepared, read, or original outcome observed; inspect original refund/read status |
| 3 | Native job pending, or the original requested outcome is not observed |
| 2 | Native failed/interrupted job or a concrete request/transport/file error |

A not-observed result retains the preparation and submission history. Resolve it with the same original job/request and operation directory. The client does not invent a success receipt, job identity, transfer result, or replacement verification.
