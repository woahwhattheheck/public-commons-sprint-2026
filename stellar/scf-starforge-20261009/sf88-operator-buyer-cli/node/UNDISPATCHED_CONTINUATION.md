# Continue a reserved authorization that never reached dispatch

A native attempt can finish signing an authorization in memory and then lose its filesystem before the signed request is sent. The original transport recorder distinguishes that state from a request whose delivery is uncertain. `Operation.prepareUndispatchedContinuation()` prepares one explicitly selected successor from the retained original request. The successor uses the original Node Buyer review, operator approval, reservation and execution path.

This continuation applies to an interrupted direct Node operation whose final native result or evidence was not fully recorded. The source reader must establish all of the following from the existing files:

- The original operation, configuration, request body, ticket and attempt still have their recorded identities.
- The full native wire reader acquires the original writer lock and validates every retained record. The writer is inactive and there is no signed-dispatch record.
- The actual generated workspace signer uses the reviewed original environment signer and authorization flow. Its complete source chain is recognized and hash-bound.
- The original approved request and accepted payment terms match the retained signing input.
- The original SF36 HMAC audit returns this same request in the `reserved` state, with actual amount zero and empty receipt and proof references.

The signer may have created an authorization in memory. That fact is retained in the source snapshot. The original authorization path builds, simulates and signs; the paid merchant request is performed by the later guarded transport. The durable dispatch marker precedes that transport. The validated absence of this marker supplies the relevant execution boundary.

## Select the existing operation

Open the same original runtime, state directory and private operator workspace. An existing mixed lineage can be followed without preparing anything:

```js
import {Buyer} from './node/client.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/absolute/original/sf88-operator-buyer-cli',
  stateDirectory: '/absolute/customer/buyer-state',
});

const root = buyer.operation('original-intent');
const interrupted = await root.followContinuation();
const status = await interrupted.inspect();
console.log({
  intentId: interrupted.intentId,
  state: status.state,
  resultRecoverable: status.resultRecoverable,
  checkpoint: status.transportCheckpoint?.state,
});
```

The full inspection reopens the recorder on disk. A stdout summary alone is insufficient: an atomic write can publish its final filename before directory synchronization fails. Reading the actual record set handles that case.

## Prepare the chosen successor

Use the exact original approved request preimage, the original attempt-file SHA256 and its configuration SHA256. Select the successor ID once and reuse it if preparation is interrupted.

```js
const next = await interrupted.prepareUndispatchedContinuation({
  intentId: 'original-intent-undispatched-continuation-1',
  expectedRequestSha256: originalApprovedRequestSha256,
  expectedAttemptId: originalAttemptFileSha256,
  expectedConfigSha256: originalConfigurationSha256,
  approvedRequestFile: '/absolute/private/original-approved-request.json',
  workspace: '/absolute/original/operator-workspace',
  reason: 'The filesystem is writable again; the recorded authorization never reached dispatch.',
});

const review = await next.review();
const result = await next.execute({review});
```

The execution opens the original operator approval prompt. Its request, amount, payer, merchant, request body and timeout retain the original settings. Only the chosen intent ID and SDK-owned destination paths move. A configured buyer profile cannot silently replace the parent's policy, ledger, signer or transport during successor creation.

The method accepts either `approvedRequest` or `approvedRequestFile`. Object inputs are copied before asynchronous work. Optional `node`, `environment` and `signal` retain the same native worker and cancellation contracts used by the original expired continuation. An expiry artifact is not an input to this method.

## Reopen after interruption

The parent owns `undispatched-continuation.json`, its immutable source-bound choice, and `undispatched-continuation-ready.json`, the completed child binding. The same parent descriptor lock serializes unpaid, expired and undispatched choices.

Calling preparation again with the same selected ID, original source and reason reopens the same child. If the child was interrupted while being prepared, its unfinished files are preserved under an original state-directory preparation name and that same selected child is prepared again. A child with an attempt cannot be replaced through this path.

After a ready binding exists, `followContinuation()` follows it without preparing, approving or executing. The original research page adapter already uses this method, so resuming the same edition reaches the chosen operation and keeps the original cursor and provider request.

```js
const reopened = new Buyer({runtimeDirectory, stateDirectory});
const active = await reopened.operation(originalIntentId).followContinuation();
const retained = await active.recover();
const selection = await interrupted.inspectUndispatchedContinuation();
```

The existing unpaid and expiry source predicates remain separate. Old metadata and choices reopen with their original schemas.

## Accounting and retained files

The original SF36 reservation remains in the original ledger. Preparation performs a read-only HMAC-verified reservation lookup. It neither settles the original reservation at zero nor alters historical accounting. The successor must pass ordinary fresh approval and budget admission when executed.

The choice binds the original native source/output hashes, approved request, full recorder snapshot, reviewed signer source identities and audited reservation. Its ready file binds the child's operation, configuration, body and ticket. Every later original `_bound()` validates this lineage before review, recovery or execution.

The authorization source reader returns a safe metadata snapshot. Signed payloads, keys and private wire bodies stay in the original private operation directory. The ordinary inspector and continuation status expose source hashes and phase metadata.

## Actual receiving case

The first receiving case is the retained OpenAlex greenhouse ground-source page-three operation. Its previous expiry successor entered the original signer, then encountered `ENOSPC`. The native stdout survived while the final SDK result file did not. The full recorder read returned `SIGNING_STARTED_NOT_DISPATCHED`, an inactive writer, and four records ending at `signing-input`. This path turns those recorded facts into the next source-bound original operation while preserving the earlier reservations and accepted source pages.
