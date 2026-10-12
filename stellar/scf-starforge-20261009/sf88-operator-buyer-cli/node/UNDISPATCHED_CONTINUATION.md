# Continue a reserved authorization that never reached dispatch

A native attempt can lose its filesystem after receiving the original payment-required response, or after creating an authorization in memory, before the signed request is sent. The original transport recorder distinguishes that state from a request whose delivery is uncertain. `Operation.prepareUndispatchedContinuation()` prepares one explicitly selected successor from the retained original request. The successor uses the original Node Buyer review, operator approval, reservation and execution path.

This continuation applies to an interrupted direct Node operation whose final native result or evidence was not fully recorded. The source reader must establish all of the following from the existing files:

- The original operation, configuration, request body, ticket and attempt still have their recorded identities.
- The full native wire reader acquires the original writer lock and validates every retained record. The writer is inactive and there is no signed-dispatch record.
- The actual generated workspace signer uses the reviewed original environment signer and authorization flow. Its complete source chain is recognized and hash-bound.
- The original approved request and accepted payment terms match the retained signing input. If the signer was never entered, the original SF31 client reconstructs that input from the retained unsigned 402 response using the same request and term-selection logic; the original SF54 mapper must produce the exact approved request.
- The original SF36 HMAC audit returns this same request in the `reserved` state, with actual amount zero and empty receipt and proof references.

When signing was entered, the signer may have created an authorization in memory. The source snapshot preserves that distinction from the earlier response-only boundary. The original authorization path builds, simulates and signs; the paid merchant request is performed by the later guarded transport. The durable dispatch marker precedes that transport. The validated absence of this marker supplies the relevant execution boundary.

## Two original transport boundaries

| Retained wire state | Original input used by the reader | Returned authorization scope |
| --- | --- | --- |
| `SIGNING_STARTED_NOT_DISPATCHED`, or another validated state after signing began with no signed dispatch | The exact retained `signing-input` and the reviewed native authorization source | `signedAuthorizationMayExist: true` |
| `UNSIGNED_RESPONSE_HEADERS_RETAINED`, with no signing records | The original unsigned 402 response, request URL, method, headers and exact body, passed through the original SF31 client | `signedAuthorizationMayExist: false` |

The earlier 402 reader supplies a single retained response to the original SF31 transport and captures its immutable approval intent with a callback that always declines. It provides no real network transport and never invokes the signer. The original SF54/SF36 mapping then verifies the caller's supplied approved request and SHA256. Both paths re-read the complete inactive wire and original source identities before returning.

The returned `signerSources` is a map from each source role to its exact path, byte count and SHA256. Existing signing-input snapshots keep their original values and canonical digest when the earlier-gate support is installed.

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

The first receiving case is a retained research page operation. Its previous expiry successor entered the original signer, then encountered `ENOSPC`. The native stdout survived while the final SDK result file did not. The full recorder read returned `SIGNING_STARTED_NOT_DISPATCHED`, an inactive writer, and four records ending at `signing-input`. This path turns those recorded facts into the next source-bound original operation while preserving the earlier reservations and accepted source pages.

A second actual receiving case retained the unsigned 402 headers and the original operator-approved request before `ENOSPC` prevented entry to the signer. The reader reconstructed the exact original request, returned `UNSIGNED_RESPONSE_HEADERS_RETAINED` with `signingEntered: false`, and retained the preceding case's snapshot byte-for-byte. Preparing another successor still requires the original reserved-row audit and usable destination storage.

## Explicit source adoption for a protected successor

When the original failure requires a reviewed source change, preserve the parent's canonical runtime and select a complete distinct runtime with `successorRuntime: {directory, sourceManifestFile, sourceManifestSha256}`. The immutable choice binds that full source manifest. The selected runtime supplies its own Buyer, Store and original native execution; all request, body, ticket and operator checks still apply. An existing native-workspace import retains its separate original command adoption contract.

`await buyer.openOperation(savedIntentId)` reopens one exact recorded child in that explicitly selected runtime. It neither prepares a successor nor follows later children. Existing `operation(id)` remains synchronous and `followContinuation()` retains its lineage behavior.

[Protected native storage and runtime adoption](./PROTECTED_STORAGE.md) documents the actual-FD provider, manifest, parent preservation, source checks and same-edition research receiving path.
