# Continue an original attempt after a reviewed authorization-expiry bound

A process can end after the original spending reservation and native request have
started, leaving the application without its final output. A retained expiry
review lets the operator prepare one explicit successor while keeping the
original operation and its reserved amount in the same ledger.

This workflow uses the original Node Buyer, native approval console, signer and
SF36 accounting worker. The successor is a new operation with its own normal
approval. Its URL, method, headers, body, ticket, terms, operator, ledger and
timeouts come from the original request.

## Receive the existing operation and its source

Open the same durable Node state directory and original runtime. Read the exact
approved-request preimage from the retained operation records. The direct
lost-output inspector binds that preimage to the original request and exposes
the attempt/configuration hashes used for selection.

~~~js
import {readFile} from 'node:fs/promises';
import {Buyer} from '@tokenjunkielabs/starforge-merchant/node';

const buyer = new Buyer({
  runtimeDirectory: '/absolute/original/sf88-operator-buyer-cli',
  stateDirectory: '/absolute/original/buyer-state',
});
const parent = buyer.operation('original-operation-id');
const workspace = '/absolute/original/operator-workspace';
const approvedRequest = JSON.parse(
  await readFile('/absolute/retained/approved-request.json', 'utf8'));

const source = await parent.inspectLostOutput({
  workspace,
  approvedRequest,
});
~~~

The source inspector checks the original operation, body, ticket, native runtime,
private workspace and exact retained output. A live transport checkpoint writer
keeps its original request in progress. A completed native result follows the
existing result recovery flow.

The accepted parent states for this separate continuation are an unresolved
native attempt: STARTING, STARTED, INTERRUPTED_OR_START_FAILED or
NATIVE_RESULT_UNAVAILABLE, with no saved response file and no complete Node
result. The original definitive unpaid continuation remains available through
prepareUnpaidContinuation for its own original result predicate.

## Retain and review the expiry evidence

The supported evidence kind is SOURCE_BOUND_LEDGER_UPPER_BOUND. It binds the
original intent and approved-request digest to an upper-bound inference, exact
retained provider timing, the original SDK source and a later synchronized
Horizon observation.

| Source | What the receiving reader checks |
| --- | --- |
| Approved request | Original intent, canonical digest and accepted maximum timeout |
| Bound artifact | Exact provider completion time and adjacent closed ledgers |
| Provider source | Retained account response timing and its explicit serial-cohort association |
| Original SDK source | Maintained version and the ledger-expiration formula used by that operation |
| Ledger page | Consecutive original ledger records around the retained completion time |
| Post-bound status | Matching TESTNET passphrase and synchronized ledger heads beyond the upper bound |
| Original fee account | Same account identity, sequence and last-modified ledger |
| Transaction history | Exact returned page and original-attempt time comparison |

The evidence describes a conservative maximum authorization ledger. Its
exactSignedAuthorizationRetained field is false for the legacy interrupted case.
Its historyScope is original_fee_account, and clockBasis records the clock
comparison used by the inference. These fields travel with the successor choice
and its source hashes.

Keep these artifacts and their referenced original files beside the retained
operation. Every later receiving step checks their bytes again. The working
provider budget continues to change as new queries execute; its selected
completion observation is preserved as an immutable copy for this review.

## Prepare one selected successor

~~~js
const child = await parent.prepareExpiredContinuation({
  intentId: 'original-operation-id-expired-continuation-1',
  expectedRequestSha256: source.expectedRequestSha256,
  expectedAttemptId: source.attemptId,
  expectedConfigSha256: source.configSha256,
  workspace,
  approvedRequest,
  reason: 'The original worker ended; the retained authorization-expiry review is complete.',
  expiryEvidence: {
    boundFile: '/absolute/retained/ledger-expiry-bound.json',
    observationFile: '/absolute/retained/post-upper-bound/observation.json',
    expectedFeeAccount: 'G...the original fee account...',
  },
});

const selected = await parent.inspectExpiredContinuation();
console.log(selected.continuation.intentId);
console.log(selected.continuation.expiry.bound.authorizationExpiryLedgerUpperBound);
console.log(selected.continuation.reservation.amount);
~~~

The existing original continuation flock serializes both unpaid and expired
selection. Inside that lock, preparation reopens the original source, validates
the retained expiry inputs, and asks the original SF36 worker to authenticate the
original reservation. The returned row must still be reserved, with zero actual
amount and empty receipt/proof fields. The original approved request, amount,
actor, service, asset and network must agree.

The source then fixes one child ID and remediation reason. It records the exact
source hashes, expiry snapshot and original audited row before calling the
original SDK's offline creation and review. A second selection cannot fork this
parent. Repeating the same call reopens the selected child.

The native read uses --node-reservation-source with --verify-only. It uses the
existing private key loader and Governor.reservation read transaction. The
original accounting engine continues to own any later reconciliation of the
parent reservation.

## Review and execute through the original approval flow

~~~js
const active = await parent.followContinuation();
let result = await active.recover();

if (result === null) {
  const status = await active.inspect();
  if (status.state !== 'PREPARED') {
    throw new Error('Receive the active original attempt before continuing');
  }
  const review = await active.review();
  result = await active.execute({review});
}

const bytes = await result.bytes();
~~~

followContinuation follows only a recorded, fully prepared choice. It creates
no child itself. It supports mixed explicit unpaid and expired lineages,
validating every original edge and its immutable child binding.

The original execute method retains its atomic one-attempt marker. The native
console presents the successor's original spending terms for approval. The
parent amount remains counted by the original ledger alongside the new
successor's approval and settlement.

The research workspace uses this read-only following method before receiving a
page. Its logical page intent, generated request and cursor remain unchanged;
the selected native result supplies the saved response bytes for that same page.
Existing applications with only followUnpaidContinuation retain their earlier
following behavior.

## Resume after an interrupted preparation or application process

The parent stores three compact records:

| Record | Purpose |
| --- | --- |
| expired-reservation-source.json | Frozen original source passed to the native read-only accounting worker |
| expired-continuation.json | Immutable child choice, original reservation and expiry evidence |
| expired-continuation-ready.json | Completed child's original operation/configuration/body/ticket hashes |

A stopped preparer releases the original kernel lock. A complete child reopens
against the same ready record. A partial, unattempted preparation is retained
under a private .expired-preparation directory, and preparation recreates the
same selected ID. An existing child attempt always goes through its original
recovery path.

The prepared child metadata binds its parent and the exact choice digest. Both
the child and every original parent are checked before review, execution,
result receiving and read-only following. Changing a request, body, ticket,
source record or expiry artifact produces a source conflict at the original
operation boundary.

AbortSignal is supported during preparation, the original accounting read and
offline review. Retain the same parent and selected child after cancellation, and
resume them through these methods. The resulting response continues into the
original application and its existing export and receiving workflow.
