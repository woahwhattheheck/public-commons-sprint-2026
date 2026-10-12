# gRPC server streams in the original merchant

A saved gRPC server-streaming method accepts one exact JSON request and produces
ordered UTF-8 NDJSON records through the original SF30 merchant. Each line has the
same descriptor-based value normalization as a unary response: 64-bit integers
stay decimal strings, bytes stay canonical base64, maps retain their exact keys,
and omitted fields remain omitted. The public response schema describes **one
record**, not an array collected in memory.

The existing gRPC workspace, managed Applications card, preparation, customer
package and SF82 release store are the operator entry points. Client-streaming
and bidirectional **application** methods remain inspection-only. Native server
reflection, where available in the selected runtime, is a separate source-intake
operation and keeps its original captured-descriptor contract.

## Select the contract and limits

1. Open **Applications → gRPC merchant authoring**, or start the existing private
   [gRPC workspace](README.md). Capture the merchant's selected protobuf source
   and host-owned connection/credential references.
2. On **Source**, enable **Server-streaming methods with saved limits**. Choose
   the total response byte limit, record count and idle read deadline. Advanced
   call limits still govern the full native deadline and each decoded message.
3. Open a method marked **server stream / NDJSON**, edit its exact single request,
   and apply the public POST route and complete ordered payment options. Save
   the revision; the source, method, input example and limits become its identity.
4. Review channel and terms. Readiness makes no application RPC. Then deliberately
   run the selected upstream request or prepare the saved merchant.

Streaming is an explicit optional connection setting:

~~~json
{
  "timeoutMs": 120000,
  "maxResponseBytes": 1048576,
  "maxJsonResponseBytes": 2097152,
  "stream": {
    "maxBytes": 67108864,
    "maxRecords": 100000,
    "idleTimeoutMs": 10000
  }
}
~~~

Merge these fields into the original source's "limits" object. In the browser,
the dedicated stream controls own "stream"; the advanced JSON editor owns the
remaining call/message settings.

| Setting | Meaning and supported boundary |
| --- | --- |
| timeoutMs | Deadline for the whole native call, including every record; 1–300000 ms |
| maxResponseBytes | Native protobuf receive limit per message; up to 8 MiB |
| maxJsonResponseBytes | Maximum normalized JSON response per record; up to 16 MiB |
| stream.maxBytes | Complete encoded NDJSON byte limit; 1–1 GiB |
| stream.maxRecords | Maximum records; 1–1000000 |
| stream.idleTimeoutMs | Deadline for an outstanding native record read; 1–300000 ms |
| maxInFlight | Existing shared native-call capacity; streams retain a slot through their actual close |

The newline counts toward the original 16 MiB framed-record ceiling. A record,
byte or deadline limit cancels the upstream and yields an incomplete result; it
does not silently cut a longer stream into an allegedly complete response.
The native grpc-js readable uses its own bounded object-mode buffering. The
adapter consumes it with async-iterator backpressure and retains no whole stream
in memory.

Source configurations without "limits.stream" stay normalized exactly as before.
Existing unary prepared manifests, client files and retained release hashes keep
their original meaning. A server-stream route requires explicit saved stream
limits.

## Direct operator call, cancellation and exact output

**Run upstream request** calls the approved native method with the merchant's
credentials. This is a direct operator action, outside a customer payment.
The original attempt/input are durable before dispatch. A stream writes a
create-only private "attempts/<operation-id>.ndjson" file incrementally.

The header's **Cancel active call** targets only that displayed operation. It
cancels the actual native RPC, waits for the native terminal/read/close, and
keeps received bytes. Applications Stop also cancels the owned active call
before releasing its original writer lease.

The outcome shows the original operation ID, retained byte count and SHA-256,
complete record count, native terminal when observed, and a bounded preview
(up to 20 records / 64 KiB). **Download retained NDJSON** hashes the complete
retained file with bounded reads and transfers the same open descriptor directly
to the browser's download manager. It does not build a whole-file browser Blob.

A complete operator capture requires every record, native terminal **OK**, and
successful local file completion. A non-OK terminal, cancellation, overflow,
deadline or file-write error leaves OUTCOME_UNCONFIRMED with its exact prefix.
This status does not say whether the upstream applied business side effects.

Reading the same operation never calls the upstream again. If a process ended
before writing its terminal result, recovery can inspect the exact retained
prefix and frame boundaries; even a prefix made entirely of valid JSON lines
cannot establish the missing native terminal. Inspect the upstream outcome
before choosing a new intentional operation ID.

### CLI over the same private workspace

Close the browser workspace before using its private state from the CLI: the
same original writer lease owns both. An embedded operator uses the existing
model's call, readAttempt and streamDownload methods instead.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs call \
  --state /private/grpc-workspace --revision SAVED_REVISION_SHA256 \
  --method /forge.streams.AccountEvents/Watch \
  --input /private/request.json --id NEW_OPERATION_UUID

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs attempt \
  --state /private/grpc-workspace --id ORIGINAL_OPERATION_UUID

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs export-stream \
  --state /private/grpc-workspace --id ORIGINAL_OPERATION_UUID \
  --out /private/downloads/account-events.ndjson
~~~

Export uses a new destination, verifies the same retained descriptor throughout
a bounded copy, then atomically publishes the finished file. It can export an
explicitly partial capture and reports "complete:false". Exit 2 identifies an
incomplete call/capture; it is not a command to purchase or call again.
SIGINT/SIGTERM cancels an active CLI call through the original native source.
An inspect or export operation makes no application RPC.

## Merchant payment and customer delivery

**Prepare merchant** publishes the same complete retained source and seven-file
customer package. "methods.json" includes each streaming route's
"responseFormat:ndjson", native method/types, full request/record schema and
selected limits. The actual live OpenAPI advertises application/x-ndjson and
the original response-schema reference. Generated clients retain the original
call/buyer interface.

One advertised route payment covers **one whole single-request stream**.

- The existing default **authorization** flow generates and validates the
  complete stream in SF30's private spool, then performs its original settlement
  and transfers the complete bytes.
- An explicitly offered and selected **upfront** flow settles before live
  generation. A subsequent non-OK terminal, cancellation or partial transfer can
  leave the original payment recorded with incomplete delivery.

The stream adapter does not select a flow from media type, implement payments,
reconnect, invent checkpoints in the provider protocol, or change the original
spending reservation. Use the complete observed payment requirement. Atomic
amounts remain strings; buyer ceilings are independent of merchant stream limits.

Configure the original SF88 buyer's response writer for NDJSON:

~~~json
{
  "requestTimeoutMs": 180000,
  "captureBody": false,
  "responseFile": {
    "destination": "/private/customer/account-events.ndjson",
    "maxBytes": 67108864,
    "timeoutMs": 120000,
    "stream": {
      "format": "ndjson",
      "maxRecordBytes": 2097153,
      "maxRecords": 100000
    }
  }
}
~~~

These are fields to merge into the customer's existing complete operator
configuration, with its original intent, selected merchant request/terms,
signer and approval/ledger paths. Review and execute that same configuration:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/customer/account-events.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --execute --config /private/customer/account-events.json
~~~

The request deadline includes provider generation and transfer; the writer
deadline starts when the response arrives. Select sufficient independent
limits for the reviewed merchant. A saved file is separate from payment and
independent network verification, and a failed file does not reverse payment.

In Node, use the matching installed native Buyer and pass those responseFile
stream options through fromRequest/fromConfig or the existing generated-client
buyer callback. After the original execute/recover returns, consume
"result.ndjson()"; partial inspection is the explicit
"result.ndjson({allowPartial:true})". The retained file/hash is verified before
records are yielded. [Complete Node stream workflow](../../sf88-operator-buyer-cli/node/STREAMS.md).

Python's matching installed Buyer uses the original Node bridge and retained
operation, with "BuyerResult.ndjson()" and "export_stream()" for typed records
and new output files. Keep the same language/state/intent for recovery.
[Python customer workflow](../../sf88-operator-buyer-cli/python/CUSTOMER_WORKFLOWS.md).

A recover result can be absent until the original attempt has recoverable output.
Inspect that same attempt. Use the original
[stream writer/recovery contract](../../sf31-buyer-client/STREAMING.md) for
lastCompleteByte, partialSha256 and incomplete record handling; there is no
automatic paid stream reconnect.

## Retain, activate, drain and roll back

Use **Stage in release control** and the existing SF82 review → activate → run
workflow. The retained gRPC package carries the captured descriptor/source,
full stream limits, bindings and NDJSON public schema. It reopens independently
of the former prepared directory. Source SQL or a provider secret is not added
to customer output; provider metadata and TLS values stay in the merchant's
starting environment.

Drain closes owned native streams and waits for the actual native status/read
cleanup. Rollback selects the prior original retained release and its prior
limits; it does not replay an earlier operator RPC. Managed Applications
reopens the same private authoring workspace and source binding.

## Run the included native stream example

The included server is a deliberate local grpc-js fixture. It emits exact
uint64 identifiers above JavaScript's safe integer range, binary payloads and
explicit/omitted optional strings. "fail_after" and "keep_open" let an operator
exercise the real non-OK and cancellation paths on the same product.

Install the existing pinned gRPC dependencies as described in README. From the
repository root, start the example:

~~~sh
export GRPC_STREAM_DEMO_AUTHORIZATION='local-stream-example'
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/stream-server.mjs
~~~

In another terminal with the same example variable, start the original workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs \
  --state /private/grpc-stream-workspace \
  --source stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/stream-source.json \
  --proto-directory stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/proto \
  --entry streams.proto \
  --plan stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/stream-plan.json
~~~

The example plan has placeholder asset/recipient fields. Enter the actual
merchant payment terms before a native customer purchase. With no facilitator
selected, the original seller serves its challenge-only 402 and does not call
the upstream for a paid route. The explicit operator call remains available.

For a real provider, use its current private target, credentials, descriptor
closure and method contract. Native gRPC ordered server-stream semantics and
terminal status are documented in the
[official gRPC core concepts](https://grpc.io/docs/what-is-grpc/core-concepts/).

## Bidirectional inputs

The same response engine also receives native bidirectional methods. Enable
both stream policies and review the finite ordered input sequence described in
[Request streams](REQUEST_STREAMS.md). Its original input half-close and native
OK terminal join this same retained NDJSON and customer receiving lifecycle.
