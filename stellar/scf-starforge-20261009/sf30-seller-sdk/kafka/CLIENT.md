# Kafka workspace Node client

Use the same running Kafka Application from Node, a command line, or the merchant MCP host. This client covers the complete retained workflow: connection revisions, real topic inspections, exact offset capture and recovery, source projections, native dataset plans/builds/queries/comparisons, portable receiving, and merchant-package export.

The entry point is [client.mjs](client.mjs), with the complete TypeScript contract in [client.d.mts](client.d.mts). [client-cli.mjs](client-cli.mjs) exposes the same operations as commands. [client-protocol.mjs](client-protocol.mjs) contains the original connection, numeric, identity, and HTTP limits.

The client uses Node built-ins and the maintained Node 22.16-or-newer runtime. Its exact JSON path checks for the runtime's standard JSON source-text access and raw numeric serialization before parsing a response. The native Kafka Application retains its original Python/confluent-kafka dependencies and its original 26-file workspace binding. These additional consumer modules do not alter that binding.

## Connect to the original Application

Open the existing `dataset-kafka` Application and select its private connection file. The reader accepts either the original printed URL, with an optional terminal newline, or the original `stellar-forge.application-url.v1` record for `dataset-kafka`. A directly operated original server can publish the same file:

~~~sh
node kafka/cli.mjs --workspace /private/customer/kafka serve \
  --connection-file /private/customer/kafka.connection \
  --startup-format json
~~~

The directory and initialized workspace in that command are the operator's existing selections. Applications owns its managed launch, stop, and reopen lifecycle. A client command borrows the running server.

~~~js
import { KafkaWorkspaceClient } from './kafka/client.mjs';

const client = new KafkaWorkspaceClient({
  connectionFile: '/private/customer/kafka.connection',
  // Optional host-selected expectedWorkspaceId and expectedBindingSha256
});
try {
  const current = await client.inspect();
  console.log(current.workspaceId, current.bindingSha256);
  const state = await client.state();
  console.log(state.kafka.connections);
} finally {
  await client.close();
}
~~~

`readKafkaWorkspaceConnection(filename)` is the shared connection reader for host integrations. It opens a regular private operator-owned file without following a final symlink, checks its complete bytes and file identity across the read, and accepts only the exact original loopback URL with its 43-character capability. The returned object is frozen. Its private `token` and `consoleUrl` properties are non-enumerable; the Applications metadata view contains only the original launch identity fields.

Every client operation rereads that original file, authenticates `GET /api/launch`, and binds the live workspace UUID, absolute workspace, and original source-binding SHA. A managed restart may publish a new port and token for the same binding. A different workspace or source binding requires an explicit new client selection. `inspect()` reports the live origin and identity with the private capability removed.

HTTP goes directly to `127.0.0.1` through `node:http`. It uses the original Host, Origin, and Bearer fields, exact Content-Length, identity encoding, and the original fixed route table. Redirects and environment proxy routing do not participate. The client keeps at most four native requests active, leaving capacity in the original eight-slot server for its browser.

## Complete source-to-dataset operation

The following illustrates a caller using an already saved exact-topic connection. Operation names are retained identities: reuse the same names and request bytes when recovering an interrupted operation.

~~~js
const connection = await client.connection('customer-events');
const inspected = await client.inspectConnection({
  connection: connection.id,
  revision: connection.revision,
  operation: 'customer-events-inspection-01'
});

// Select the customer's intended intervals from the actual committed bounds.
// Kafka offsets remain decimal strings from the original inspection.
const capture = await client.prepareCapture({
  inspection: inspected.id,
  operation: 'customer-events-capture-01',
  ranges: inspected.partitions.map(part => ({
    partition: part.partition,
    start: part.low,
    end: part.end
  }))
});
await client.runCapture({capture: capture.id, expectedRevision: capture.revision});
const completed = await client.waitForCapture(capture.id);
if (completed.status !== 'COMPLETE') {
  throw new Error('Review the retained capture state: ' + completed.status);
}

const projection = await client.project({
  operation: 'customer-events-edition-01',
  captures: [{id: completed.id, revision: completed.revision}],
  view: 'events',
  decode: 'json',
  deletePolicy: 'retain',
  acceptIncomplete: false,
  label: 'Customer event edition'
});
const plan = await client.savePlan(projection.defaultPlan);
const build = await client.build({source: projection.source, plan: plan.id});
const queried = await client.query({
  build: build.id,
  query: {limit: '25', offset: '0'}
});
const delivery = await client.exportKafka(
  {build: build.id, projection: projection.id},
  '/private/customer/deliveries/customer-events.zip'
);
console.log(queried, delivery.sha256);
~~~

The original inspection records the actual cluster identity, topic UUID, each retained low offset, read-uncommitted high watermark, and read-committed end. The client preserves all of those fields. `configuredTopics()` lists the exact topics already saved in workspace connections; `inspectConnection()` performs the explicitly selected original broker/topic operation.

The original capture engine owns committed-record visibility, partition completion evidence, retention/source-change detection, byte limits, cancellation, and resumable revisions. `runCapture()` and `resumeCapture()` invoke the same native route. They retain the original capture, connection revision, cluster/topic binding, and operation identity.

Projection parameters keep the native choices explicit. `events` preserves the selected event history. `latest-per-partition-key` uses the original partition/key semantics. Decoding is `json` or `bytes`; deletion is `retain`, `tombstone`, or `tombstone-or-goldsky`. `acceptIncomplete` is an explicit source-coverage decision enforced by the native workspace.

## Exact message and JSON values

`messages(capture, {offset, limit})` returns the original compact message summaries: original IDs, partition/offset/timestamp identity, payload sizes, key preview, ordered-header count, native value state, and deletion metadata. It pages 1–200 summaries at a time.

`message(id)` returns the complete original retained detail, including base64 key/value bytes, ordered headers, decoded value, parse status, and `valueJson`. The native timestamp and Kafka offsets are decimal strings. `valueJson` preserves the native numeric tokens; code that needs a decoded object should use `parseKafkaJson`.

~~~js
import {
  KafkaJsonNumber, parseKafkaJson, stringifyKafkaJson
} from './kafka/client.mjs';

const value = parseKafkaJson(
  '{"offset":"9007199254740993","amount":1.2300,"eventId":9007199254740993}'
);

console.log(value.offset);           // original string
console.log(value.amount.source);    // "1.2300"
console.log(value.eventId.source);   // "9007199254740993"

// Native JSON output preserves the original numeric tokens.
console.log(stringifyKafkaJson(value));

// Ordinary JSON transport uses an explicit exact-number tag.
console.log(JSON.stringify(value));
// {"offset":"9007199254740993","amount":{"$kafkaNumber":"1.2300"},
//  "eventId":{"$kafkaNumber":"9007199254740993"}}

const selected = new KafkaJsonNumber('9.007199254740993e15');
~~~

Safe, canonical integer metadata remains a JavaScript number. Other original numeric lexemes become immutable `KafkaJsonNumber` values. Their `source` property is exact; implicit numeric conversion throws. Ordinary `JSON.stringify` emits `{"$kafkaNumber":"original token"}` for MCP or other JSON transports. `stringifyKafkaJson` is the explicit serializer for native raw-number JSON. A naturally occurring JSON object with a `$kafkaNumber` field remains an ordinary object; the parser creates number wrappers from numeric source tokens only.

Large complete messages, state, projections, records, and query responses have streamed file forms. This lets the existing retained-download/chunk reader deliver the original bytes without inlining a large response through an MCP JSON budget.

## API map

All methods return the unchanged original native result unless the table identifies a client inspection or completed file result. The full request/result shapes are in `client.d.mts`.

| Task | Client method | Original HTTP operation |
| --- | --- | --- |
| Authenticate original launch | `inspect(options?)` | `GET /api/launch` |
| Whole retained state | `state(options?)` | `GET /api/state` |
| Saved exact-topic summaries | `configuredTopics(options?)` | Derives from original state |
| Latest saved connection | `connection(name, options?)` | `GET /api/kafka/connection?id=...` |
| Save connection revision | `saveConnection({connection, expectedRevision, operation, config}, options?)` | `POST /api/kafka/connection` |
| Real topic metadata/bounds | `inspectConnection({connection, revision, operation}, options?)` | `POST /api/kafka/inspect` |
| Retained inspection | `inspection(id, options?)` | `GET /api/kafka/inspection` |
| Prepare exact ranges | `prepareCapture({inspection, operation, ranges}, options?)` | `POST /api/kafka/capture` |
| Capture state | `capture(id, options?)` | `GET /api/kafka/capture` |
| Start/resume original capture | `runCapture({capture, expectedRevision}, options?)` / `resumeCapture(...)` | `POST /api/kafka/run` |
| Cancel original capture | `cancelCapture(id, options?)` | `POST /api/kafka/cancel` |
| Wait for capture transition | `waitForCapture(id, {signal?, timeoutMs?, pollMs?})` | Reads the original capture |
| Compact message page | `messages(capture, {offset?, limit?}, options?)` | `GET /api/kafka/messages` |
| Complete message detail | `message(id, options?)` | `GET /api/kafka/message` |
| Native projection | `project(request, options?)` | `POST /api/kafka/project` |
| Retained projection + source + default plan | `projection(id, options?)` | `GET /api/kafka/projection` |
| Original source inventory | `source(id, options?)` | `GET /api/source` |
| Original mapping | `plan(id, options?)` | `GET /api/plan` |
| Save native NDJSON mapping | `savePlan(plan, options?)` | `POST /api/plan` |
| Original dataset build | `build({source, plan}, options?)` | `POST /api/build` |
| Original query | `query({build, query}, options?)` | `POST /api/query` |
| Compare editions | `compare({before, after}, options?)` | `POST /api/compare` |
| Comparison page | `changes(id, {offset?, limit?}, options?)` | `GET /api/changes` |
| Receive original NDJSON bytes | `addSource(file, {name?, label?}, options?)` | `POST /api/source` |
| Receive full Kafka archive | `importKafka(file, options?)` | `POST /api/kafka/import` |
| Receive original NDJSON archive | `importNative(file, options?)` | `POST /api/import` |

Native query parameters remain scalar strings. For example, `{limit:'25', offset:'0'}` is a complete native query parameter map. The original mapping defines permitted filters, ranges, sorts, exposed columns, and limits.

### Complete file APIs

Each method takes an existing private destination directory and a new output filename. It returns `KafkaCompletedDownload` with the full file path/byte count/SHA-256/media type, original workspace UUID/source-binding SHA, and exact HTTP route/body digest.

| Complete result | Method |
| --- | --- |
| Kafka history + native edition archive | `exportKafka({build, projection?}, destination, options?)` |
| Original six-file NDJSON project archive | `exportNative(build, destination, options?)` |
| Native dataset archive | `exportDataset(build, destination, options?)` |
| Full edition change JSON Lines | `exportChanges(comparison, destination, options?)` |
| Original merchant/customer SDK package | `exportMerchant({build, payment, origin, path}, destination, options?)` |
| Full retained message JSON | `downloadMessage(id, destination, options?)` |
| Whole retained state JSON | `downloadState(destination, options?)` |
| Complete projection JSON | `downloadProjection(id, destination, options?)` |
| Complete connection/inspection/capture/source/plan JSON | `downloadRecord(kind, id, destination, options?)` |
| Complete original query response JSON | `downloadQuery({build, query}, destination, options?)` |

`downloadRecord` accepts `connection`, `inspection`, `capture`, `source`, or `plan`. A connection uses its original operation name; the other records use their 64-character SHA identities. `downloadQuery` sends the original native query request and streams the actual response bytes. The client does not reconstruct a large native JSON document.

`exportMerchant` passes the reviewed build, complete original payment terms, selected public origin, and route to the maintained NDJSON merchant preparer. Its output includes the original merchant and customer SDK. Package preparation is the source operation exposed by that original route.

## Complete-file publication and recovery

Downloads stream into a newly created private temporary file. The client checks the original content type and one exact Content-Length, writes and hashes every byte, checks the final size/inode, fsyncs the complete bytes, and publishes the selected output using a create-only hard link. It then fsyncs the receiving directory. Interrupted partial bytes stay separate from the final filename.

If the final filename already exists, the client returns `KAFKA_DESTINATION_EXISTS` before issuing the export request. This preserves the original completed bytes even when ZIP timestamps make a regenerated package differ.

A host such as the merchant MCP owner should retain its immutable selection before requesting a file: workspace UUID, source-binding SHA, command, original IDs/revisions, exact request body, and selected destination. Its existing completion manifest and retained chunk reader then own delivery.

If the call's result is lost after publication, reopen that same saved selection and inspect its fixed final file:

~~~js
import { inspectKafkaDownload } from './kafka/client.mjs';

const complete = await inspectKafkaDownload(
  '/private/customer/deliveries/customer-events.zip',
  {signal: controller.signal}
);
// Join complete.bytes and complete.sha256 to the already retained original selection.
// Finish the same host completion manifest and retained read-only file handle.
~~~

`inspectKafkaDownload` makes no HTTP request. It reads a regular private operator-owned file through its retained descriptor, verifies the path/file identity before and after hashing, and returns exact SHA-256 and byte count. An optional `sha256` asserts an already retained file identity.

A failure after final publication carries `error.retainedFile`, including the original request and binding. The complete final file remains available for that same recovery. Cleanup removes only this call's owned temporary inode.

Imports similarly read a stable original file descriptor. An optional `sha256` is checked in a complete pass before sending the first upload byte. Both this pass and the upload honor cancellation. A file change during transfer reports an interrupted outcome while preserving the original native operation for inspection/reentry.

## Lifetime, cancellation, and recovery

Every request accepts `signal`, `timeoutMs`, and `maximumJsonBytes`. File methods also accept their documented digest/byte options. The default deadline is 240 seconds and includes time waiting for a client request slot. The default JSON response limit is 16 MiB; choose a complete file API when the result exceeds the consumer's inline budget.

`close()` is idempotent. It aborts and drains queued requests, active HTTP transfers, checksum passes, pending capture waits, and owned temporary file handles. The existing Application continues to own its server and writer. An in-progress native capture remains available by its original ID.

When the intended action is to stop that capture, call its original cancellation operation and inspect the resulting state:

~~~js
await client.cancelCapture(captureId);
const stopped = await client.waitForCapture(captureId);
await client.close();
~~~

`waitForCapture` returns when the original status is outside `RUNNING` and `CANCELLING`; this includes a still-prepared capture. It never starts a capture itself. Capture statuses retain the native distinctions between complete, interrupted, cancelled, limit reached, source gap/change/conflict, and error.

An interrupted POST has `outcomeUnknown: true` when it may already have reached the original server. Read the retained connection/capture/projection or original source/build state, then reenter with the same operation and exact request. The native workspace performs its own operation-identity and revision checks. A client transport failure does not create a replacement capture.

## Command line

Run `node kafka/client-cli.mjs help` for all commands. Representative complete operations:

~~~sh
node kafka/client-cli.mjs inspect --connection /private/customer/kafka.connection

node kafka/client-cli.mjs connection-save \
  --connection /private/customer/kafka.connection \
  --request /private/customer/connection-operation.json

node kafka/client-cli.mjs capture-run \
  --connection /private/customer/kafka.connection \
  --request /private/customer/capture-run.json --wait

node kafka/client-cli.mjs messages \
  --connection /private/customer/kafka.connection \
  --id CAPTURE_SHA --offset 0 --limit 50

node kafka/client-cli.mjs export-kafka \
  --connection /private/customer/kafka.connection \
  --build BUILD_SHA --projection PROJECTION_SHA \
  --out /private/customer/deliveries/customer-events.zip

node kafka/client-cli.mjs download-query \
  --connection /private/customer/kafka.connection \
  --request /private/customer/query.json \
  --out /private/customer/deliveries/query.json

node kafka/client-cli.mjs download-record \
  --connection /private/customer/kafka.connection \
  --kind capture --id CAPTURE_SHA \
  --out /private/customer/deliveries/capture.json

node kafka/client-cli.mjs inspect-file \
  --input /private/customer/deliveries/customer-events.zip
~~~

Replace the capitalized SHA placeholders with the original IDs returned by the preceding native operations. Requests come from complete UTF-8 JSON files. This keeps original operation names, exact request bodies, and numeric strings available for recovery.

Commands emit complete native JSON. `--tagged-numbers` selects explicit numeric transport tags; the default emits original numeric lexemes through `stringifyKafkaJson`. File commands emit the complete file descriptor result, ready for the existing retained-download layer.

The CLI retains SIGINT/SIGTERM handlers through client drain. Exit code 0 means the command completed; 1 is a command error; 2 means a waited capture stopped short of `COMPLETE`; 130/143 preserve the received signal.

## Native protocol limits and source references

| Boundary | Native/client limit |
| --- | --- |
| Original connection record | 16 KiB, private regular file |
| Kafka JSON request | 1 MiB |
| Original dataset/merchant JSON request | 128 KiB |
| Native source upload | 256 MiB |
| Original NDJSON archive upload | 512 MiB |
| Full Kafka archive upload | 1,644,167,168 bytes |
| Inline JSON response | 16 MiB default, host-selectable up to 128 MiB |
| Streamed complete download | 2 GiB default, host-selectable up to 4 GiB |
| Message summary page | 1–200 records |
| Comparison page | 1–250 rows |
| Exact partition interval | Original nonnegative signed-64 decimal strings |
| Concurrent client requests | 1–4; original server has eight slots |

The server remains the authority for all native request validation and dataset semantics. The client follows these exact maintained source contracts:

- [Kafka HTTP routes](httpd.py), [capture/projection/receiving model](model.py), and [wire/configuration contract](contract.py).
- [Managed original workspace/launch binding](managed.py) and [original Kafka CLI](cli.py).
- [Original NDJSON merchant route](../ndjson/application.py), [native NDJSON mapping](../ndjson/ndjson_source.py), and [shared dataset HTTP service](../xml/server.py).
- [ECMAScript JSON source-text access](https://tc39.es/proposal-json-parse-with-source/) for exact parsed numeric tokens and explicit native serialization.
