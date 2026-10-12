# Recover the original direct Node buyer operation

The Node SDK can now connect a direct Buyer operation with the original SF36 lost-output recovery. The application keeps its operation ID, configuration, attempted request and response files. The operator selects the actual Stellar transaction and the complete approved-request digest. The existing chain verifier then authenticates the transfer and the original accounting journal finalizes that reservation.

This supports operations created through the normal Buyer methods. Inbox and Dataset operations retain their existing recovery entrypoints. The direct Node context uses the operation's original private state directory and recorded native runtime.

## Inspect the retained request

Open the same Buyer and select the original operation:

~~~js
import {Buyer} from './client.mjs';

const buyer = new Buyer({
  runtimeDirectory: originalRuntimeDirectory,
  stateDirectory: originalBuyerStateDirectory,
  operatorProfile: originalOperatorProfile,
});
const operation = buyer.operation(originalIntentId);

const inspected = await operation.inspectLostOutput({
  workspace: originalOperatorWorkspace,
  approvedRequestFile: originalApprovedRequestFile,
  expectedRequestSha256: originalApprovedRequestSha256,
});
console.log(JSON.stringify(inspected, null, 2));
~~~

The operation must already contain its original configuration, operation metadata and permanent attempt marker. The reader calls the normal Operation._bound(), including the original body, operation-ticket and continuation checks. It then verifies the operator workspace, signer path, payer, ledger, policy path, approved network, asset, recipient and transport configuration.

The supplied approved request has the original fifteen SF36 fields. Its canonical digest must match the selected digest. The request binds the resource URL, HTTP method, body presence and bytes, accepted-terms digest, timeout, exact amount, actor, service and request ID. An application can instead provide the same value in approvedRequest. The implementation snapshots that object before asynchronous publication.

The returned attemptId is the SHA-256 of the exact original attempt file. It is distinct from the operation ID and a process ID. configSha256 hashes the original configuration file. sourceHashes includes the original operation metadata, request body, ticket, local outcome files, evidence state and operator workspace files.

This inspection reads source files and validates their association. The authenticated reservation and original accounting journal are checked by the privileged recovery worker. An existing complete SF82 evidence document follows the existing normal recovery path.

## Complete the selected transfer

Use an actual transaction from the original chain investigation. Pass the exact request digest and, when available, the attempt and configuration digests returned by inspection:

~~~js
const recovered = await operation.recoverLostOutput({
  workspace: originalOperatorWorkspace,
  approvedRequestFile: originalApprovedRequestFile,
  expectedRequestSha256: originalApprovedRequestSha256,
  expectedAttemptId: inspected.attemptId,
  expectedConfigSha256: inspected.configSha256,
  transaction: originalTransactionHash,
});
console.log(recovered.result);
~~~

The implementation publishes one immutable selection under the original operation's lost-output directory. The selection binds the transaction, approved request, original file hashes and observed local outcome. Its exact serialized bytes are fixed before the first filesystem wait. An interrupted caller reopens the same selection; a different transaction or changed request cannot replace it.

The selected original runtime invokes its existing finalization worker. The worker chooses the fixed node-operation source reader, which calls the original Node source projection and independently checks its files in Python. It verifies the complete approved request against the HMAC-audited original reservation.

The shared lost-output finalizer performs the original SF43 chain observation, validates the network, asset, payer, recipient, exact transfer amount and transaction inclusion time, seals the observation, and invokes the existing SF36 reconciliation. It checks all original source bindings again after the network observation. A saved observation or completion is reopened through the same original journal.

The returned value is a NodeLostOutputFinalization. Its result contains FINALIZED or IDEMPOTENT_FINALIZED, the original receipt reference, exact amount and verified transfer facts. Its source and attempt digests connect those facts to the original request.

## Reopen an interrupted recovery

Read the completed recovery through the same operation:

~~~js
const recovered = await operation.readLostOutputRecovery({
  workspace: originalOperatorWorkspace,
});
~~~

The read returns null before a completed recovery exists. When a completion exists, the original worker authenticates its HMAC, source bindings and current ledger row using verify-only mode. This read uses the stored approved request and chosen transaction. It performs no provider observation or new settlement.

If recovery stopped after the verified observation or ledger transition, call recoverLostOutput again with the same original selection. The existing original finalizer continues that operation and preserves its authenticated record.

The signal option is supported by inspection, recovery and reading. A completed worker result is returned even if cancellation arrives after completion. An interrupted worker can be reconciled by reading or continuing the same stored selection.

## Export a verified transfer

A merchant or accounting application can receive a compact proof derived from the authenticated recovery:

~~~js
const exported = await operation.exportLostOutputProof({
  workspace: originalOperatorWorkspace,
  output: operation.directory + '/lost-output/verified-transfer.json',
});
console.log({path: exported.path, bytes: exported.bytes, sha256: exported.sha256});
~~~

The output directory must already be private. Export uses create-only publication, with exact readback on a repeated identical export. The proof includes the original operation and attempt IDs, configuration and approved-request digests, transaction, network, asset, payer, recipient, amount, ledger, matching transfer event, inclusion time, observation time, completion time and sealed-recovery digest.

This financial proof has its own schema and method. The existing BuyerResult remains the authority for an original saved provider response. The response file, partial download and local output files remain associated with their original operation; their observed identities are included in the recovery source.

## Retained files

| Original location | Role |
| --- | --- |
| operation.json | Original preparation, runtime, configuration, body, ticket and continuation identity |
| config.json | Original complete request and operator configuration |
| attempt.json | Permanent original attempt, state and start time |
| stdout.json, stderr.log, result.json | Exact retained local outcome identities |
| response.bin | Original complete response identity when present |
| evidence/SHA256(intentId).json | Original SF82 evidence location and loss state |
| evidence/wire-SHA256(intentId)/ | Original transport checkpoint when that runtime recorded one |
| lost-output/selection.json | Immutable chosen transaction and original source binding |
| lost-output/TRANSACTION.source.json | Exact input to the existing privileged finalizer |
| lost-output/TRANSACTION.proof.json | Original HMAC-sealed chain observation |
| lost-output/recovery.json | Original authenticated completion |
| lost-output/reports/ | Existing finalization-worker reports |

Large response and log identities are streamed in fixed-size chunks. Response limits and the default come from the original responseFile configuration. Reading a recovery does not materialize a second response body.

## Original trust and lifecycle

The operation's recorded runtime directory must match the selected native runtime. The operator workspace retains its original canonical directory, ledger, policy, signer and public payment identities. Private keys are read through the existing accounting workspace; they are not added to selection files or exported proofs.

When an original transport checkpoint exists, its reader must acquire the original writer lock and validate the stopped prefix. A live writer remains visible and prevents recovery from freezing an incomplete live view. Earlier operations use their original retained files.

The fixed Python dispatcher accepts sourceKind node-operation and selects node_source_context from lost_node_finality.py. A source document cannot choose another module. The shared lost-output engine continues to own chain verification, sealed observations, journal authentication and exact reconciliation.

A reserved attempt with no known transaction remains associated with its original reservation. This API provides its source inspection and the selected-transfer recovery path. Any separately approved continuation retains that original attempt and its accounting history while binding its chosen successor through the original continuation mechanism.
