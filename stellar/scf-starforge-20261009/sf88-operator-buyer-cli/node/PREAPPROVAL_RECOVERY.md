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

## Retain metadata when storage is contended

A runtime configured with `nativeFileReservation` reserves backing on the actual metadata and output descriptors before starting the native child. The selected preapproval attempt uses four 65,536-byte metadata slots for its initial state, actual command, child identity and terminal state, plus the same saved-result bound used by ordinary execution and recovery. Closing an interrupted run can therefore publish its terminal checkpoint using already-held space. The configured provider and complete selected runtime source are described in [PROTECTED_STORAGE.md](PROTECTED_STORAGE.md).

The retained native command records the actual child invocation. When the protected bootstrap is selected, its private request binds the original entry file, original arguments, allocator descriptor and selected runtime source. The direct entry path keeps its original command shape.

## Retained wire history for the same intent

An interrupted native process can leave an unsigned request journal before the approval callback has returned. The normal preapproval workflow now carries that journal with the selected plan:

1. Inspection reads the complete private journal under its original writer lock. It accepts absent, pre-source and unsigned-only histories. A live writer or any signing/signed phase makes this preapproval path ineligible.
2. Preparation binds its complete file inventory and source digest into the immutable plan alongside the original attempt, review, configuration and native workspace.
3. Execution acquires the selected plan's own flock and repeats the original absent-process and authenticated zero-reservation ledger checks. It records that audit before changing the journal location.
4. The original journal directory moves intact to the plan's `original-wire/` directory. The actual source/phase bytes, temporary publication inodes and original writer lock are retained. `wire-selection.json` binds the plan, source attempt, exact inventory and audit; `wire-retirement.json` records the completed move. Both publication files use the existing held-file allocation provider when configured.
5. The caller reserves its four attempt-record replacements and result record, then enters the original runtime and its normal approval flow. The new journal occupies the original evidence pathname.


The same original journal lock protects cleanup of unused backing on its inventoried `.write-*` files. After the fresh process and original zero-reservation ledger audit, execution truncates each of those held descriptors to its existing logical length, syncs it, and rechecks its exact bytes, digest and inode. This releases abandoned `KEEP_SIZE` extents left by a killed writer while preserving the complete recorded inventory. It happens before transition metadata allocation; ordinary history reads remain read-only.

`readPreapprovalRecovery()` exposes the safe `wireHistory` projection for each retained plan. The original journal remains readable through its selected history even after a newer journal exists. Private request and authorization bytes remain in the original private evidence/history files.

An interruption before the directory move reopens the same selection and verifies the original journal. An interruption after the move verifies the exact archive and completes its existing retirement record. A competing or repeated execution cannot move the replacement journal: the per-plan lock, original attempt gate and immutable archive selection identify the old attempt independently of the canonical evidence pathname.

Preparation and execution continue to use the existing public methods and exact reviewed hashes. Existing plans without the additive wire inventory acquire their one immutable selection only after the same original process and ledger audit. The source configuration, operation ticket, original ledger and intent identifier retain their normal meanings.


| Wire outcome | Original operation action |
| --- | --- |
| `PREAPPROVAL_WIRE_WRITER_ACTIVE` | Read the original runtime and its active attempt before selecting another execution. |
| `PREAPPROVAL_RECOVERY_ACTIVE` | Reopen the same selected plan after its current caller finishes. |
| `PREAPPROVAL_NEW_WIRE_EXISTS` | Inspect the newer canonical attempt. The selected plan’s earlier journal remains in `original-wire/`. |
| `PREAPPROVAL_WIRE_SIGNING_OR_DISPATCH_RECORDED` | Use the existing authorization or lost-output recovery path appropriate to the recorded phase. |
| `PREAPPROVAL_WIRE_SOURCE_CHANGED` | Reopen the original plan and compare its retained inventory with the current source before selecting a continuation. |
