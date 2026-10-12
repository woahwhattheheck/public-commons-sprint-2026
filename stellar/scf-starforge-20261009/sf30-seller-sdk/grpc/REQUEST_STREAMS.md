# Client-streaming and bidirectional merchants

The original gRPC merchant accepts a finite, reviewed sequence of native
protobuf messages. Client-streaming methods return one JSON result.
Bidirectional methods send the same ordered input while receiving ordered
NDJSON output. Both use the original captured contract, merchant admission,
operator history, customer client and SF82 release lifecycle.

## Choose the operation shape

| Native method | HTTP request body | Response | Saved source limits |
| --- | --- | --- | --- |
| Unary | One native message object | JSON | Call and per-message limits |
| Server streaming | One native message object | NDJSON records | Also limits.stream |
| Client streaming | {"messages":[message,...]} | JSON | Also limits.requestStream |
| Bidirectional | {"messages":[message,...]} | NDJSON records | Both stream policies |

Every message uses the original captured protobuf field names and codec:
64-bit integers are decimal strings, bytes are canonical base64, maps retain
their key/value types, and optional fields and oneofs retain actual presence.
An empty messages array sends no message and half-closes the native input.
The endpoint determines the result for that valid transport operation.

The complete sequence is reviewed before dispatch. The native writer honors
grpc-js Writable backpressure, then half-closes after the final write callback
has completed. Bidirectional input and output advance concurrently; the
reviewed sequence remains the input throughout that operation.

## Save explicit source limits

On **Source**, enable **Client-streaming requests** and save its message and
aggregate protobuf byte limits. For bidirectional methods, also enable the
response-stream controls. Configuration files use this original source shape:

~~~json
{
  "schema": "stellar-forge.grpc-source.v1",
  "target": "api.example.com:443",
  "transport": {"mode":"tls"},
  "metadata": [{"name":"authorization","valueEnv":"GRPC_AUTHORIZATION"}],
  "limits": {
    "timeoutMs": 30000,
    "maxRequestBytes": 1048576,
    "maxJsonRequestBytes": 2097152,
    "requestStream": {"maxMessages":10000,"maxBytes":16777216},
    "stream": {"maxBytes":67108864,"maxRecords":100000,"idleTimeoutMs":10000}
  }
}
~~~

| Setting | Meaning | Default when its policy is enabled | Allowed range |
| --- | --- | --- | --- |
| requestStream.maxMessages | Total input messages | 10,000 | 1–100,000 |
| requestStream.maxBytes | Sum of serialized protobuf payload bytes | 16,777,216 | 1–67,108,864 |
| maxRequestBytes | One serialized input message | 1,048,576 | 1–8,388,608 |
| maxJsonRequestBytes | Complete normalized operation JSON | 2,097,152 | 1–16,777,216 |
| timeoutMs | Entire native call, including both sides | 30,000 | 1–300,000 |

The aggregate protobuf count excludes transport framing. JSON bytes include the
messages wrapper and separators. The validator stops at the first over-limit
message before opening an application call. Errors identify its indexed path,
for example request["messages"][17]["sequence"]. A response idle deadline
measures time without a received record, including while inputs are being sent.

An absent requestStream policy remains absent in normalized settings. Existing
saved unary and server-streaming source identities retain their original
configuration and public request shapes.

## Edit and validate in the original workspace

1. Capture local protobuf files or use the existing reflection intake, then save
   the source with the appropriate stream policies.
2. Open the client-streaming or bidirectional method in **Methods & terms**.
   **Add message**, **Duplicate message**, **Move earlier**, **Move later** and
   **Remove message** operate on its exact send order. The message list pages
   through 20 entries at a time.
3. Use the captured field controls or the selected message's JSON editor.
   Missing optional fields stay absent. An invalid visible field must be
   corrected before navigation or applying the request.
4. **Import sequence JSON** receives the complete messages object.
   **Download sequence JSON** retains that same ordered input for CLI or agent
   use. The full request JSON editor remains available for the whole operation.
5. Choose **Validate request** to normalize and serialize the messages using the
   saved contract, and inspect their protobuf and JSON byte counts. Validation
   performs no application RPC.
6. Apply the public route, description, example and complete payment options,
   save the revision, and use the original channel review and merchant
   preparation. **Run upstream request** is the explicit application call.

Request validation and channel readiness are separate actions: validation uses
the captured contract; channel review also opens the configured private
connection. The call controls require a saved selected method and original
operation ID.

## CLI and merchant agent

Inspect the operation wrapper with the selected source limits:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs inspect \
  --proto /private/merchant/proto-source.json \
  --source /private/merchant/source.json \
  --method /example.RecordBatch/Upload
~~~

Omitting --source preserves the original raw native message-schema inspection.
Validate a complete request file before operating it:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs validate-request \
  --proto /private/merchant/proto-source.json \
  --source /private/merchant/source.json \
  --method /example.RecordBatch/Upload \
  --input /private/merchant/request-sequence.json
~~~

The result carries the normalized input, exact captured source identity,
message count, protobuf bytes and JSON bytes. Use the original call/attempt
commands with that complete request file and the saved revision. If the
original workspace is open, operate through its browser or merchant agent;
the offline CLI acquires the original workspace writer lease.

In a configured merchant MCP workspace:

- merchant_grpc_method returns the executable request wrapper and preserves
  the original native schema under requestMessage. Local references remain
  bound to the original captured definitions.
- merchant_grpc_validate_input accepts exactly one input object or host request
  file and returns the native preview, retaining large JSON through the same
  complete-read transport.
- merchant_grpc_call uses one stable operationId and the complete input.
- merchant_grpc_attempt reads that original outcome after interruption.
- merchant_grpc_prepare and the existing customer export/download actions
  deliver the same seven customer files.

The installed grpc command dispatches these same CLI actions. Applications
opens the same saved workspace, reviewed source and native launch instance.

## Completion, cancellation and receiving

The original attempt retains the normalized input before dispatch. Its
fingerprint binds revision, method and the entire ordered sequence. Reusing an
operation ID with a different message, order or revision is a conflict.
Reusing the original input and ID retrieves the original attempt.

A retained request-stream observation reports messages, queuedMessages,
writtenMessages, backpressureWaits, halfCloseRequested, halfClosed and native
terminal status. Written messages indicate completed local native writes;
the full application result still depends on its native response and status.

A client-streaming call completes after its input half-close and one successful
native response. A bidirectional capture completes after input half-close,
all response records and an OK native terminal. The existing NDJSON receiver
retains exact partial bytes for a non-OK terminal, cancellation or limit.
The call remains outcome-unconfirmed when its upstream result cannot be
recovered from the retained native response.

**Cancel active call**, process shutdown, merchant drain and source close cancel
the original call and retain its capacity slot until native terminal/read/write
cleanup finishes. Resuming reads the same retained input, output and operation
identity. A new intentional call receives a new ID.

The original customer bundle remains:

- methods.json and openapi.json
- client/seller-client.mjs and client/seller-client.d.mts
- client/seller-openapi.json
- client/package.json and client/README.md

The generated request example includes the messages wrapper. methods.json
includes the original requestMessage and its requestSeries policy. The
original buyer validates the whole public input and uses the existing JSON or
NDJSON receiving path. Payment covers the original route invocation, with all
messages admitted before upstream dispatch.

## Contract changes and retained releases

The original **Contract upgrades** screen compares the underlying protobuf
field numbers, types, maps, presence, oneofs and method streaming flags.
Route review checks both the previous saved example and selected upgrade
example against the candidate's complete request sequence and limits.

The retained review records the aggregate protobuf count and an ordered,
length-bound list identity of per-message protobuf hashes. Message boundaries
remain part of that identity. Native adoption, CLI/MCP source receiving and
first-observation repeat receiving use the existing upgrade engine.

Prepare, stage, activate, drain and rollback through the original SF82 controls.
The retained merchant package includes the full descriptor/source closure,
request and response policies, ordered examples and public request schema.
Rollback selects the prior retained package and its prior policies.

## Run the included endpoint

The included native grpc-js RecordBatch service implements Upload and Exchange.
It echoes exact large uint64 values, signed 64-bit map values, binary payloads,
oneof alternatives and explicit/omitted optional notes. delay_ms and reject
exercise its actual streamed transport behavior.

From the repository root, start the endpoint with an example authorization
value:

~~~sh
export GRPC_REQUEST_STREAM_DEMO_AUTHORIZATION='local-request-stream-example'
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/request-stream-server.mjs
~~~

In another terminal with the same variable, create a private original workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs \
  --state /private/grpc-request-stream-workspace \
  --source stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/request-stream-source.json \
  --proto-directory stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/proto \
  --entry request-streams.proto \
  --plan stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/request-stream-plan.json
~~~

Open the printed private workspace URL. The example request file is
examples/request-sequence.json. Both source and endpoint select port 50054;
GRPC_REQUEST_STREAM_DEMO_PORT changes the server's port. The example server
accepts up to 512 messages, each with delay_ms <= 1000. Replace the example
plan's payment markers with the merchant's approved terms for a real purchase.

Native behavior follows the
[official Node streaming tutorial](https://grpc.io/docs/languages/node/basics/)
and [gRPC flow control](https://grpc.io/docs/guides/flow-control/).
The pinned grpc-js implementation is
[client.ts at 1.13.4](https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.13.4/packages/grpc-js/src/client.ts)
and its [native Writable/Duplex calls](https://github.com/grpc/grpc-node/blob/%40grpc%2Fgrpc-js%401.13.4/packages/grpc-js/src/call.ts).
