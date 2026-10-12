# Resolve an original paid application job

The merchant and customer workspaces now carry a paid job from a support issue to a recorded decision, an original accounting adjustment, a verified returned transfer, and a portable customer receipt.

Open **Resolutions** from the original merchant Jobs workspace. The customer opens **Support and resolution** beside their retained jobs. Both interfaces use the existing private hosts. A customer’s original paid acceptance and capability select their job; the original merchant state, SF98 event and accounting workspace remain the authorities for execution and money.

## Operate a case

1. Select the original paid job. The case shows its execution state, original amount and asset, customer issues, conversation and merchant decisions.
2. Reply to the customer. Choose retry, cancel, close or reopen when appropriate. Retry and cancel call the existing job methods with the current original job revision. Their original history includes the resolution request ID, so the same operation can be recovered after interruption.
3. Connect the already running merchant accounting workspace, for example its original loopback address `http://127.0.0.1:8446`. Read the existing reconciliation runs and select the run containing this job’s native event.
4. Preview a refund request or recorded cancellation. Review the original payment, original payer and return terms, asset, atomic amount, effective date, reason and source hashes. **Record this reviewed adjustment** retains that exact original accounting preview and UUID.
5. For a return already submitted through the original payment operation, select its retained refund and supply its transaction hash. The original accounting verifier records its own verification job. Refresh to read that saved job and the original proof.
6. The customer’s **Read merchant resolution** reconciles the selected retained accounting event and saves the complete returned receipt bytes. Messages, decisions, returned amount, pending refund and remaining amount stay attached to the original buyer.

The amount fields have distinct meanings:

| Field | Meaning |
|---|---|
| Original amount | The native payment in its original asset’s atomic units |
| Pending refund | Original retained refund requests awaiting a verified return |
| Returned | The sum of original native returns with status VERIFIED |
| Remaining | Original amount less verified returns |
| Recorded cancellation | The merchant’s separate accounting decision |

The original adjustment engine enforces remaining capacity and verifies the return’s network, asset, sender, recipient, amount, transaction, ledger and retained native response hashes. Its canonical network attribution is retained. Store currency and exchange rates are not derived from atomic amounts.

### Recovery

Every mutating resolution request uses a stable UUID and an expected case revision. The merchant saves an operation before calling the existing job or accounting owner. The customer saves the exact issue or message before its capability-authenticated POST.

**Recover** reads the original job history, accounting adjustment or saved verification job. **Resume** explicitly continues the same saved request with its original identifiers. A changed job revision or changed accounting preview requires review of the original current state. Repeated issue IDs and adjustment IDs reconcile the already retained operation.

Closing a workspace aborts its outstanding resolution HTTP reads, retains uncertain send outcomes and waits for its writers before the original lease closes. The borrowed accounting workspace owns its verification jobs throughout this lifecycle.

## Merchant CLI

The source command runs against the existing private merchant operator listener:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/resolution/cli.mjs list \
  --url http://127.0.0.1:PORT --token-file /private/operator-token
```

The URL can also be the original printed workspace URL with its fragment capability. CLI JSON input files and output files are private. Output destinations are created once; the command reports the exact returned byte count and SHA-256.

Commands are `list`, `runs`, `connect`, `inspect`, `bind`, `reply`, `case`, `job`, `refresh`, `preview`, `record`, `verify`, `withdraw`, `recover`, `resume`, `export`, `accountingexport` and `receive`.

Inspect a job, then use its current case revision and original job revision in a saved request:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/resolution/cli.mjs inspect \
  --url http://127.0.0.1:PORT --token-file /private/operator-token \
  --job report:2026.10
```

A bind input contains `{"runId":"ORIGINAL_RUN_UUID","expectedRevision":0}`. A reply input contains `requestId`, `expectedRevision` and `message`. A job decision adds `kind:"RETRY_JOB"` or `"CANCEL_JOB"`, `expectedJobRevision` and `actor`. A case decision uses `state:"OPEN"` or `"CLOSED"`, plus `actor` and the customer-visible `message`.

A preview input has this shape; use the actual selected amount, time and UUID:

```json
{
  "requestId": "c0b8d012-1000-4000-8000-000000000001",
  "expectedRevision": 3,
  "kind": "REFUND",
  "amountAtomic": "1000000",
  "effectiveAt": "2026-10-12T12:00:00.000Z",
  "reason": "Selected job resolution",
  "actor": "Merchant operator",
  "reference": "report:2026.10"
}
```

Call `preview --job JOB --input /private/preview-request.json`, review its returned `case.previews`, then call `record` with the **same requestId** and the now-current case revision. The original adjustment UUID is that same request ID. Verify input adds a new request UUID, the current case revision, `adjustmentId`, the original return `transaction` and `actor`. The optional `rpcEndpoint` is validated by the original accounting verifier.

`recover` needs `{"requestId":"SAVED_OPERATION_UUID"}`. `resume` also takes the current case `expectedRevision`. `refresh` reads the selected retained accounting record and saved verification jobs.

## Customer CLI and SDK

Use the exact original paid-job buyer directory:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/resolution/cli.mjs refresh \
  --buyer /private/original-job-buyer
```

The customer commands are `inspect`, `refresh`, `issue`, `message`, `recover`, `resume`, `export` and `receive`. `--transport-file` accepts the same existing SF31 public transport configuration as the original buyer. `--deadline-ms` controls the current operation. SIGINT and SIGTERM stop the actual in-flight request and drain retained state.

Issue input contains `requestId`, the returned receipt’s `expectedRevision`, `message` and `requestedRemedy` (`CONTACT`, `RETRY` or `REFUND`). Message input has the same identity/revision fields and may include the original `issueId`.

```js
import {openJobResolutionBuyer} from
  './stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/resolution/client.mjs';

const resolution = await openJobResolutionBuyer({
  directory: '/private/original-job-buyer',
  transport: originalBuyerTransport
});
try {
  const current = await resolution.refresh({signal});
  const outcome = await resolution.issue({
    requestId: crypto.randomUUID(),
    expectedRevision: current.receipt.revision,
    requestedRemedy: 'RETRY',
    message: 'Please rerun the retained report with the original input.'
  }, {signal});
  console.log(outcome.operations.at(-1));
} finally {
  await resolution.close();
}
```

The original `acceptance.json`, `purchase.json` and private `buyer.json` are reopened by `openJobBuyer`. Resolution state is saved under that same buyer’s `resolution/` directory. Each complete merchant receipt is retained by SHA-256 before its local pointer is updated. The original acceptance and purchase hashes accompany every customer state and export.

## Receipts, handover and buyer expenses

Three outputs serve different receiving workflows:

| Output | Contents and receiving |
|---|---|
| Merchant `export` | Complete selected job case, original selected accounting detail, exact operations/previews/history, source hashes and customer projection. Receive beside the same original merchant job with matching payment and input identity. |
| Customer `export` | Original accepted bytes, original purchase identity, complete merchant receipt bytes, SHA-256 and saved customer requests. Receive beside the same original buyer; the original capability remains in that buyer’s retained state. |
| Merchant `accountingexport` | Byte-for-byte output of original `AdjustmentWorkspace.export({runId,format:"json"})` for the selected reconciliation. This is the private accountant/expense-intake source, including its original events, adjustments and saved verification jobs. |

The customer capability endpoint returns only that customer’s job. The original full accounting export is available through the authenticated merchant host, so accountant receiving can consume the unchanged source packet.

Customer handover:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/resolution/cli.mjs export \
  --buyer /private/original-job-buyer --out /private/job-resolution-receiving.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/resolution/cli.mjs receive \
  --buyer /private/received-original-job-buyer --input /private/job-resolution-receiving.json
```

The received original buyer must retain the same accepted bytes and purchase identity. Existing receipts and request IDs are reconciled; differing original identities are rejected. A receiving operation validates the combined set of at most 1,000 saved request IDs and the complete proposed retained-document bytes before writing any receipt or changing its pointer. The receipt and merged operation history commit together through the original private document writer. Receipt bytes and original state documents each have a 16 MiB limit. Complete receiving files use a 48 MiB ceiling to include original receipt encoding and saved operations. Merchant receiving likewise requires the original paid job and its native SF98 event before accepting the case.

For the maintained SF36 buyer expense consumer, select the original adjustment export and original event ID through its declared host source. The producer schema is `stellar-forge.merchant-adjustment-export.v1`; its `events[].original.eventId` is the job’s original SF98 settlement ID. Each record retains the original `stellar-forge.merchant-adjustment.v1` and, when verified, the original `stellar-forge.sf86.refund-reconciliation.v1`. The expense owner’s generic adjustment intake composes this existing producer. The Woo-specific SF104 handoff remains its own original consumer.

## Continue the retained native application

The included `native-continuation.mjs` follows the actual completed input-file checkout into merchant/customer resolution. Supply that original checkout driver's completed `native-result.json` after its customer, receiving desk, merchant and transport have drained:

```sh
node --max-old-space-size=192 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/resolution/native-continuation.mjs \
  --checkout-result /private/original-input-fixture/native-result.json
```

The file selects its actual `fixtureDirectory`, `customerWorkspace` and accepted `checkout.jobEntryId`. The continuation resolves the original completed job, buyer files, offered terms and SF98 event from those retained owners. The maintained input-file fixture provides checksum-valid Stellar asset, merchant and payer identities. Its original protocol authority remains recorded in the checkout summary.

The operation retains `resolution-continuation/operation.json` beside that same fixture. It captures the original event through `openAccountingWorkspace.begin`, opens both original private workspaces, reads the served resolution pages, raises a customer issue, records merchant replies, previews and records an original accounting cancellation, and retains the customer's acknowledgement. It then closes the merchant with an already-admitted reply pending and reopens the original accounting, merchant and customer owners. The final phase exports the complete case, customer receiving file and unchanged accounting export, receives the merchant case beside its original job, and receives the customer history beside exact copies of the original buyer's three base files.

Each mutation and accounting capture keeps its first UUID and original source hashes in the operation record. Reopening the same continuation reconciles those retained requests. An interrupted or failed accounting capture preserves its full original request/run and reported cause in the capture-attempt history. On a later invocation, the merchant owner checks that the case has no selected accounting run, then the original accounting engine can start one fresh capture of the same fixed event and terms under a new retained capture UUID and the current workspace revision. A new capture failure remains recorded for correction in that same operation. The resulting `native-result.json` records the selected original identities, adjustment hashes, case revision, export paths/bytes/SHA-256, independent receiving directory and completed lifecycle. The final comparison also checks the original accepted bytes, purchase, job record and outbox bytes against their initial hashes.

The cancellation remains an original accounting decision attached to the delivered job. The returned total is read from the original accounting engine. Refund operations in the product use that engine's independently matched original payment and reverse-transfer records.

The maintained input-file driver retains its first successful checkout result as `resolution-checkout-source.json`, then runs this continuation after the checkout, receiving desk, merchant and customer owners close. It appends the returned resolution to the final `native-result.json`. Resuming uses the same immutable checkout input even when the current checkout summary records a later recovery.

Another caller can import the function and select its retained checkout source:

```js
import {runJobResolutionContinuation} from
  '../../../sf30-seller-sdk/jobs/resolution/native-continuation.mjs';

const resolution = await runJobResolutionContinuation({
  checkoutResult: '/private/original-fixture/resolution-checkout-source.json',
  signal
});
```

The returned object contains the complete result and its `output` path. Optional `directory` selects an owned private receiving directory; optional `proofDirectory` selects existing original accounting proof files. The corresponding command flags are `--directory` and `--proof-dir`. Both the command and function preserve the original operation directory through interruption and wait for their owners to close.

## Source and integration

The merchant module is `jobs/resolution/index.mjs`. The customer module is `job-workspace/resolution/index.mjs`. `INTEGRATION.md` contains the exact original host/model joins and reviewed preimage identities.

The implementation reuses:

- Original SF30/SF98 paid job, native event, worker and job revision.
- Original merchant accounting `AdjustmentWorkspace`, adjustment domain and SF86 verifier.
- Original SF31 public HTTPS transport and retained SF88 buyer.
- Original private merchant listener, customer listener, customer resource-library host and kernel-held state lease.

A case binds the native event ID, route, method, network, amount, asset digest, recipient digest, receipt fingerprint, transaction fingerprint and SHA-256 of the job reference to the original accounting row. The selected report and input-manifest hashes remain fixed. This keeps the job, its accounting decision and its customer handover tied to the same original operation.
