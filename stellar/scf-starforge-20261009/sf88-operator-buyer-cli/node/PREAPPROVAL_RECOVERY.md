# Recover a buyer interrupted before approval

The Node buyer can continue the same prepared workspace-backed purchase after its native process ended before any original payment reservation. The recovery keeps the original intent, configuration, operator workspace and failed attempt, then starts one explicitly selected continuation through the original approval, reservation and signing path.

This is useful when a process or terminal disappears while the native buyer is waiting for the operator. First call the ordinary `recover()` method: a complete result may already be saved. When there is no native result, the recovery inspector checks the original process and the authenticated operator ledger before offering a continuation.

## Open the original operation

Use the same state directory, runtime directory and operator environment that prepared the purchase. Keep the complete published SDK and its original Python/native modules together.

```js
import { Buyer } from './node/index.mjs';

const buyer = await new Buyer({
  stateDirectory: '/private/customer-state',
  runtimeDirectory: '/installed/sf88-operator-buyer-cli',
  environment: process.env,
}).ready();

const operation = buyer.operation('original-request-id');
const saved = await operation.recover();
if (saved) {
  await saved.verify();
  // Read the already delivered result through saved.bytes(), json() or csvRows().
}
```

The operation's original `config.json`, request body and any operation ticket must still match their prepared hashes. A workspace-backed operation opens and audits its original workspace, keys, policy and ledger. It does not initialize another operator.

## Inspect the interrupted attempt

For attempts created by this release, the native runtime records the child PID, procfs PID, process birth ticks, PID namespace, host boot ID and procfs mount device. The inspector compares that exact identity with current process observations. A still-running process keeps ownership of its attempt.

```js
const available = await operation.inspectPreapprovalRecovery();
console.log(available.status, available.attemptSha256);
```

Earlier attempts may contain only a PID. A PID can be reused or refer to a different namespace, so those attempts need their **original native worker record**. Select the retained record and its exact request, process, output and driver hashes:

```js
const nativeRecord = {
  directory: '/private/original-native-record',
  hostRoot: '/installed/original-native-host',
  operationId: 'original-native-operation',
  requestSha256: '...64 lowercase hex characters...',
  processSha256: '...64 lowercase hex characters...',
  outputSha256: '...64 lowercase hex characters...',
  command: ['/installed/node', '/private/original-driver.mjs', '--original-option'],
  driverPath: '/private/original-driver.mjs',
  driverSha256: '...64 lowercase hex characters...',
};
const available = await operation.inspectPreapprovalRecovery({ nativeRecord });
```

The legacy adapter binds the actual original worker request, source driver, prepared review, workspace and final preapproval checkpoint. It invokes that installed worker's read-only inspector and verifies the original process namespace; caller-supplied hashes alone do not establish that the process ended. Preserve the native record and use its supported inspector instead of editing its state.

The returned `AVAILABLE` observation includes the original attempt/configuration hashes, private source pins, process proof and original ledger check. The ledger check is the existing SF36 authenticated audit under the original SF81 writer lock. It must find **zero reservations for this exact intent**, including terminal reservations. A reserved or paid intent follows its existing result/finality recovery path.

## Prepare one selected continuation

Choose the inspected attempt hash and record the reason. Preparation saves a fresh original offline review and a linked plan; it does not ask the signer to pay.

```js
const prepared = await operation.preparePreapprovalRecovery({
  expectedAttemptSha256: available.attemptSha256,
  nativeRecord, // Omit when the attempt's recorded process identity is sufficient.
  reason: 'Original terminal ended while waiting for approval.',
});
console.log(prepared.planSha256, prepared.review);
```

A changed attempt fails the expected-hash comparison. When a prior preparation completed but its return was lost, call the same preparation again or `readPreapprovalRecovery()`; the retained plan and review are returned. Review the saved plan before executing.

The original attempt remains at its original path. The new directory is:

```text
original-operation/
  operation.json
  config.json
  attempt.json
  review.json
  preapproval-continuation.json
  preapproval-history/
    <original-attempt-sha256>/
      original/
      process-request.json
      review.json
      plan.json
```

The archive preserves the exact original attempt, review, configuration, output descriptors and any empty response reservation. The plan pins those bytes and their original file identities. A completed process's old response lock is moved into that history only after fresh process and ledger checks, immediately before the new native output reservation. The original partial response must be empty.

## Execute through fresh approval

Pass the exact saved review and plan hash:

```js
const result = await operation.executePreapprovalRecovery({
  expectedPlanSha256: prepared.planSha256,
  review: prepared.review,
});
await result.verify();
```

Execution repeats the source, process and original ledger checks, exclusively records one linked child attempt, and launches the original SF88 native command. SF81 presents the actual current request for approval through the configured original broker or terminal. The operator's fresh request-specific approval still precedes the original durable reservation, signing and payment.

The SDK records the new native PID identity, private stdout/stderr and result in the child directory. It retains the same intent ID, response destination and original operator ledger. Ordinary `execute()` continues to reject an existing attempt, and calling `executePreapprovalRecovery()` twice cannot launch a second child.

The caller's abort signal and native runtime timeout apply to the new native process. Cancellation preserves the recorded attempt and output for inspection; it does not automatically launch again.

### Retain a failure before child creation

Metadata checks and the closed response-lock move complete before the exclusive child attempt. If this preparation is interrupted, executing the same selected plan recognizes the exact moved reservation inode and resumes the preparation. A new response writer at the original path causes a conflict.

After the child attempt is claimed, the runtime finishes descriptor and entry preparation before spawning. If it definitively fails before creating a child, the attempt becomes `NOT_DISPATCHED` with an embedded `stellar-forge.node-native-start-receipt.v1` receipt. That single saved record includes the original start time, observation time, phase, safe error code, exact native argv and its canonical SHA-256. An aborted call before spawn has the same explicit outcome when the receipt can be saved.

Inspect and prepare a new linked recovery for that selected failed attempt. The original ledger audit and fresh approval still apply. A missing or unwritable receipt leaves the existing claim intact; it never implies that no process ran.

Once a continuation is linked, ordinary `review()` returns that selected saved review and its original review time. It preserves the source review pinned by the recovery history.

## Reopen the same history and result

```js
const history = await operation.readPreapprovalRecovery();
const status = await operation.inspect();
const result = await operation.recover();
```

`inspect()` includes the original attempt state and selected preapproval history. `recover()` reads the selected child's saved result or complete native stdout using the original response verifier. It never launches a buyer. If the return was lost after payment, recover that original result and ledger outcome before considering any further action.

If a later child also ends before any reservation, its recorded process identity and the same authenticated zero-reservation audit can establish a new explicit recovery plan. Each child links to the exact hash of its parent attempt. Existing plan, archive and review bytes are checked on reopen.

## Useful diagnostics

| Code or outcome | Operator action |
| --- | --- |
| `PREAPPROVAL_RESULT_ALREADY_RECORDED` or `PREAPPROVAL_ORIGINAL_OUTPUT_EXISTS` | Reopen the original result/output. |
| `PREAPPROVAL_PROCESS_NOT_PROVEN_ABSENT` | Inspect the recorded process through its original runtime; preserve any active process. |
| `PREAPPROVAL_ORIGINAL_WORKSPACE_REQUIRED` | Reopen the original workspace-backed operation. |
| `PREAPPROVAL_ORIGINAL_LEDGER_INSPECTOR_REQUIRED` | Install the complete matching SDK closure, including the original ledger module. |
| `PREAPPROVAL_ATTEMPT_CHANGED` | Inspect the selected attempt again before preparing. |
| `PREAPPROVAL_SOURCE_CHANGED` or `PREAPPROVAL_ARCHIVE_CHANGED` | Reconcile the original retained source/operation bytes. |
| `MATCHING_REVIEW_REQUIRED` | Use the exact review returned with the selected plan. |
| `ATTEMPT_ALREADY_RECORDED_USE_RECOVER` | Read the already recorded child instead of executing again. |

The helper's structured process diagnostics distinguish an active identity, different procfs scope, unavailable native authority and changed source. These checks use local process and retained native records; they do not contact a payment provider or alter the original worker.
