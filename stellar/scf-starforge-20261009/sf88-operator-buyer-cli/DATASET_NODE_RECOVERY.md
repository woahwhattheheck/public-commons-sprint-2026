# Dataset recovery for Node applications

The original Node `Dataset` now carries a paid page from interrupted local output through authenticated finality, retained command reopening, proof download, the original accounting view, and the original Dataset delivery. Financial decisions remain in the existing Dataset receiver and SF36 finality worker. The application layer preserves the exact command and its returned result across process or storage interruptions.

Install the cumulative SF88 source that includes both the maintained Dataset receiving modules and `node/dataset-recovery.mjs`. Import `Buyer` from the installed `node/index.mjs`; the configured runtime is the corresponding original `sf88-operator-buyer-cli` directory.

## Attach the original session

Use the saved native session directory. A paid page whose SF82 output was lost may not pass ordinary page inspection until its recovery has completed. The explicit recovery attachment binds and validates the original session definition without attempting to acquire or admit that page.

```js
import {Buyer} from './stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/index.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/private/stellar-forge/sf88-operator-buyer-cli',
  stateDirectory: '/private/customer-application',
  environment: process.env,
});

const dataset = await buyer.attachDataset({
  id: 'retained-research-dataset',
  directory: '/private/original-dataset/session',
  recoveryOnly: true,
});
```

The stable application ID identifies the customer entry. The original session retains its own session ID, configuration digest, page allocations, snapshot, cursor history and workspace identity. `recoveryOnly` and `accountingOnly` are distinct attachment choices and cannot both be enabled.

After a lost attachment response, reopen the same application entry:

```js
const dataset = buyer.dataset('retained-research-dataset');
await dataset.initializeRecovery();
```

The attachment creates no new payment operation. It validates the original Dataset definition and saves the ordinary application binding. Existing normally initialized Dataset entries can call the recovery methods directly.

## Inspect the exact retained page and approved request

The original finalizer uses the exact approved SF36 request preimage and the HMAC-audited reservation. Supply the original saved JSON preimage or its exact object. `approvedRequestFile` is read once into the private application command before native dispatch; resuming that command uses those retained values.

```js
const selection = await dataset.inspectLostOutput({
  operationId: 'page-one-original-selection',
  pageIndex: 1,
  workspaceDirectory: '/private/original-buyer-workspace',
  approvedRequestFile: '/private/original-approved-request.json',
});

const selected = selection.native;
console.log({
  intentId: selected.intentId,
  requestSha256: selected.expectedRequestSha256,
  attemptId: selected.attemptId,
  configSha256: selected.configSha256,
  evidenceState: selected.evidenceState,
  responseState: selected.responseState,
});
```

The original page attempt ID is the SHA-256 of its actual `attempt.json` bytes. Its configuration ID is the SHA-256 of the actual page configuration bytes. The application facade preserves those identities, the original full predecessor-page lineage and the separately retained HTTP response identity.

The native inspection validates the original source and approved request. It does not acquire a new page or select a transaction. `evidenceState` retains whether the original SF82 output is absent, empty or invalid JSON, including the original byte count and digest when a file exists. `responseState` separately describes the retained Dataset response.

## Finalize the selected original transfer

Select the actual transaction associated with that existing attempt, then retain one stable application operation ID:

```js
const finalized = await dataset.recoverLostOutput({
  operationId: 'page-one-selected-transfer',
  pageIndex: 1,
  workspaceDirectory: '/private/original-buyer-workspace',
  approvedRequestFile: '/private/original-approved-request.json',
  expectedRequestSha256: selected.expectedRequestSha256,
  expectedAttemptSha256: selected.attemptId,
  expectedConfigSha256: selected.configSha256,
  transaction: actualTransactionHash,
});
```

`expectedRequestSha256` and `transaction` are required for finalization. The optional attempt and configuration digests pin the exact inspected source. `workspaceDirectory` must match the original saved workspace whenever the session names one.

The native receiving API checks the entire original page history and passes its original source descriptor to SF36. The common worker authenticates the existing reservation and approved request, observes the exact transfer using SF43, binds its network, asset, payer, recipient, amount and inclusion time to the original attempt, then seals the observation before reconciling the original ledger. A later invocation reopens that sealed completion.

For an explicitly configured original RPC route, finalization also accepts `rpcEndpoint` and `rpcProxyEnv`. The original native allowlist and proxy validation apply. Environment variable names are retained; credentials remain in the configured host environment. These options apply only to finalization. Merchant outbox dispatch continues through the original merchant workflow.

Every method returns the original native result plus the application process result:

```js
console.log({
  operationId: finalized.operationId,
  commandId: finalized.commandId,
  attemptId: finalized.attemptId,
  process: finalized.process,
  outcome: finalized.native.result.outcome,
  transaction: finalized.native.transaction,
  transferFile: finalized.native.transfer,
});
```

`native` retains the original receiving result. `process` records this particular application worker's exit code, signal and error code. A complete native output can survive even when its parent process result was not saved; the command view retains that distinction.

## Continue after a lost application reply

Each recovery command has a stable private directory derived from `operationId`. Its immutable context contains the exact original session binding, normalized arguments, original approved-request values, request-source digest and result budget. Each actual process invocation has its own private attempt directory.

Use the known operation ID or the `commandId` returned on the error:

```js
const saved = await dataset.recoverLostOutputCommand({
  operationId: 'page-one-selected-transfer',
});

if (saved.lastComplete) {
  console.log(saved.lastComplete.native.transaction);
} else {
  const resumed = await dataset.resumeLostOutputCommand({
    operationId: 'page-one-selected-transfer',
  });
  console.log(resumed.native.transaction);
}
```

`recoverLostOutputCommand` reads the retained application context and native result files. `resumeLostOutputCommand` uses the same frozen command, original transaction and approved request. It starts no page acquisition. The original finalizer remains idempotent against the existing native reservation and sealed recovery.

A running native command holds the original Linux lifetime lock through publication of its result. Another invocation of that same application command receives `DATASET_RECOVERY_COMMAND_ACTIVE` while the first worker owns the lock. After that worker completes, its exact saved result is available for reopening even if the calling application disappeared.

The command's immutable request prevents operation-ID reuse with a changed transaction, page, workspace, request preimage, expected digest or export destination. Reordering the fields of a supplied approved-request object does not change its normalized identity. Switching between a supplied object and an original file is an explicitly different intake: the latter also retains the original file-byte digest.

If a completed proof export's file has been removed, explicit resume invokes the same original export to restore the same destination. A conflicting existing file produces a byte-binding error and is preserved.

List command history in bounded pages:

```js
let after;
do {
  const page = await dataset.listLostOutputCommands({after, limit:50});
  for (const item of page.commands) {
    console.log(item.operationId, item.pageIndex, item.command);
  }
  after = page.nextAfter ?? undefined;
} while (after);
```

The index exposes operation metadata. Original approved request values stay in the private command files.

## Authenticate a completed recovery again

`readLostOutputRecovery` calls the original authenticated native read. It checks the saved source, sealed completion and existing ledger without a new provider observation:

```js
const reopened = await dataset.readLostOutputRecovery({
  pageIndex: 1,
  workspaceDirectory: '/private/original-buyer-workspace',
});

if (reopened.native) {
  console.log(reopened.native.result.verifiedFacts);
}
```

The native value is `null` when no completed recovery is saved. The default creates a fresh application read command, so a subsequent ordinary call authenticates the current saved recovery again. Giving any command an explicit previously used operation ID asks for its already retained exact command result; use a new read operation ID for a fresh authenticated read.

## Download the original verified transfer proof

The proof is the separate public export of the original authenticated completion. The original SF82 file and Dataset response remain their original source objects.

```js
const exported = await dataset.exportLostOutputProof(
  '/private/customer-delivery/page-one-transfer.json',
  {pageIndex:1, workspaceDirectory:'/private/original-buyer-workspace'},
);

await exported.file.verify();
const proof = await exported.file.json();
console.log(proof.transaction, proof.atomicAmount, proof.matchingEventId);
await exported.file.saveAs('/private/another-delivery/page-one-transfer.json');
```

Omit the destination to use the native page's original `lost-output/transfer.json` export:

```js
const exported = await dataset.exportLostOutputProof(undefined, {pageIndex:1});
```

`file` implements the original `VerifiedFile` API: `verify`, `bytes`, `json`, `chunks` and `saveAs`. Its exact path, byte count, SHA-256 and proof source binding come from the native receiver. Reads check the saved file's size and digest, and `saveAs` publishes a new file only after complete verification.

A successful finalization also returns its native transfer metadata. Open the same verified file directly:

```js
const file = dataset.lostOutputProofFile(finalized);
await file.verify();
```

Create export destination parents as private directories. Existing conflicting files are preserved by the original create-only export and verified download behavior.

## Export a complete command report

The command report freezes the existing named attempt list, then includes those original native attempt results, their process states, the original Dataset identity and the last complete native response. The JSON native values are carried unchanged. It omits the private approved request input.

```js
const report = await dataset.exportLostOutputReport(
  '/private/customer-delivery/page-one-recovery.json',
  {operationId:'page-one-selected-transfer'},
);
await report.verify();
const detail = await report.json();
console.log(detail.status, detail.attempts.length);
```

Report publication is create-only and exact. Repeating the export to the same path reopens equal bytes; after additional command attempts, use a new report destination for the new complete history.

The report is a retained application history. `readLostOutputRecovery` is the operation that reauthenticates the original sealed financial state.

## Continue original Dataset accounting and delivery

After the native lost-output recovery has completed, the existing Dataset admission recognizes the separate original recovery evidence and parses the already saved response using the original page parser.

```js
const recovered = await dataset.recover();
console.log(recovered.native.status);

const account = await dataset.accounting({
  workspaceDirectory: '/private/original-buyer-workspace',
  offset: 0,
  limit: 100,
});
console.log(account.native.entries);

await dataset.exportAccounting(
  '/private/customer-delivery/dataset-accounting.jsonl',
  {workspaceDirectory:'/private/original-buyer-workspace'},
);
```

The existing controller can continue remaining pages through `dataset.run()` under the original session limits, approval and signer. Recovery operations themselves operate on the selected existing page. Once that original session is complete, its normal delivery is available:

```js
const delivery = await dataset.deliver('/private/customer-delivery/data-room');
await delivery.file('dataset.csv').verify();
for await (const row of delivery.rows()) {
  consumeOriginalTypedRow(row);
}
```

The native Dataset receiving, accounting and SF100 delivery code retain the original source, cursor, snapshot, payment and response identities. The application facade uses their existing outputs throughout.

## Method reference

| Method | Purpose |
|---|---|
| `initializeRecovery()` | Bind an attached original session definition while its paid page is being recovered. |
| `inspectLostOutput(options)` | Read the exact original page and approved-request selection. |
| `recoverLostOutput(options)` | Finalize the explicitly selected original transfer and retain its separate proof. |
| `readLostOutputRecovery(options)` | Authenticate a completed native recovery against its source and original ledger. |
| `exportLostOutputProof(destination, options)` | Export the original authenticated public proof and return its verified file. |
| `lostOutputProofFile(result)` | Open the proof file named by a completed native recovery/export result. |
| `recoverLostOutputCommand({commandId \| operationId})` | Reopen retained application/native outputs. |
| `resumeLostOutputCommand({commandId \| operationId, signal})` | Continue the exact frozen native command. |
| `listLostOutputCommands({after, limit})` | Page the private command index; limit is 1–250. |
| `exportLostOutputReport(destination, {commandId \| operationId})` | Save the complete retained command history as verified JSON. |

All page indexes are one-based and must identify an original existing page. Original request, attempt and configuration digests are lowercase SHA-256. Stable operation IDs use the existing Node buyer identifier contract. Recovery request JSON is capped at 60,000 bytes; the native report budget remains the original configured 1–256 MiB range.
