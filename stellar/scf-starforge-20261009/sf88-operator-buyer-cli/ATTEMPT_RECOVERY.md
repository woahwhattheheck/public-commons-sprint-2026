# Recovering an interrupted native buyer transport

The original SF88 execution now records its HTTP and signing boundaries in the existing private evidence directory. The recorder is part of the normal execution path. It uses the original SF31 transport, SF81 approval, native signer, response stream and SF82 reconciliation.

## Read the current operation

Use the original Node buyer and the same operation ID:

~~~js
const operation = buyer.operation(originalIntentId);
const result = await operation.recover();
const status = await operation.inspect();
console.log(JSON.stringify(status, null, 2));
~~~

The existing saved result remains authoritative when present. Operation.inspect() adds transportCheckpoint, a projection containing file locations, hashes, phase and writerActive. It loads the reader from the selected original runtime, so the standalone Node package does not need a second copy of the runtime implementation. Older operations return null for this field.

The checkpoint directory is evidenceDir/wire-SHA256(intentId). It contains a source descriptor and immutable phase records. The source descriptor binds the exact configuration JSON value, original method and URL, body presence, body length and body digest. configValueSha256 explicitly hashes the canonical configuration value; it is separate from the Node SDK's exact configuration-file digest.

## Interpret the saved phase

| Phase | Meaning and useful recovery input |
| --- | --- |
| WRITER_ACTIVE | The original descriptor lock is held. The reader does not classify an incomplete live prefix as a stopped request. |
| SOURCE_RETAINED | Private configuration and request-body binding exist before the buyer begins. |
| UNSIGNED_REQUEST_NOT_DISPATCHED | The original unsigned request descriptor exists, before its dispatch marker. |
| UNSIGNED_DISPATCH_OUTCOME_UNRESOLVED | The unsigned exchange was admitted, with no retained response/error yet. |
| UNSIGNED_RESPONSE_HEADERS_RETAINED | The original unsigned status and headers are saved. |
| SIGNING_STARTED_NOT_DISPATCHED | The actual approved SF31 signing input was saved before entering the original signer. |
| SIGNER_RESULT_RETAINED_NOT_DISPATCHED | The native signer returned its original complete payload; no signed dispatch marker exists. |
| SIGNED_REQUEST_NOT_DISPATCHED | The exact SF31 request descriptor and its selected native payload are saved before dispatch. |
| SIGNED_DISPATCH_OUTCOME_UNRESOLVED | The immutable marker was published before entering the original HTTP transport. This phase requires the existing request's outcome reconciliation. |
| SIGNED_RESPONSE_HEADERS_RETAINED | The original signed response status and headers were saved before the same Response object reached SF31/SF82. |
| UNSIGNED_TRANSPORT_ERROR_RETAINED, SIGNED_TRANSPORT_ERROR_RETAINED, SIGNING_ERROR_RETAINED | The original boundary returned an error. Its stable code is retained and original payment uncertainty remains intact. |

A dispatch marker records admission to the transport, not proof that a socket reached the merchant or that payment settled. Signed response headers preserve the original merchant receipt; the existing independent chain observer and original SF36 finalizer determine financial completion.

These files record the SF31 request descriptor passed to the public HTTPS transport. HTTP framing, DNS, TLS identity and streaming remain in that original transport. The recorder passes through the same abort signal and the same response object without reading or cloning its body. The original response-file writer retains body bytes and its existing deadline.

## Original recovery consumers

The original recovery source can read the validated private records explicitly:

~~~js
import {readAttemptWireCheckpoint} from './attempt-wire.mjs';

const retained = await readAttemptWireCheckpoint({
  cfg: originalConfig,
  body: originalRequestBody,
  includeWire: true,
});
if (retained?.snapshot?.writerActive === false) {
  const originalInput = retained.events['signing-input']?.input;
  const originalPayload = retained.events['signing-result']?.payload;
  const originalReply = retained.events['signed-response'];
  // Pass the selected original records to the maintained lost-output/chain
  // recovery path, with its original reservation and request bindings.
}
~~~

includeWire exposes the original signed authorization, request headers, configuration and request body to that private consumer. source and events are non-enumerable properties: routine JSON and console projections show only snapshot. Keep the raw records in their original private operation directory. The normal status view exposes only hashes and locations.

The existing SF82 returned-outcome checkpoint remains a later boundary: it preserves the actual result of buyer.call before chain observation. This transport record covers interruption before that call returns. Both belong to the same original request and original ledger. A pre-feature interrupted operation has no transport record; its observed history stays unchanged.

## Publication and process loss

Every phase uses the existing Node store's private temporary file, file fsync, exclusive hard-link publication and directory fsync. A process loss while writing leaves an unpublished temporary file, not a partial named checkpoint. The signed dispatch marker is durable before the original fetch can begin.

The writer holds the original private descriptor/flock pattern for its lifetime. A reader takes that same kernel lock while validating the complete source prefix. Process termination releases the kernel lock; an old filename or PID does not grant another attempt.

Every record binds its source digest. Dispatch and response records bind their exact request record, and signed requests bind the exact retained native signer result. The normal execute path rejects an existing checkpoint before starting another buyer. The original Node attempt gate, approval, reservation, settlement and explicit continuation rules remain in control of execution.
