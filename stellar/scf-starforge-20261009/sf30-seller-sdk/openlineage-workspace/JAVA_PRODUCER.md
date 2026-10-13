# Native Java OpenLineage producer

The Java producer sends original event files through the released
`io.openlineage:openlineage-java:1.53.0` SDK. It uses the SDK's
`RunEvent`, `JobEvent` and `DatasetEvent` models, JSON mapping,
`HttpConfig` and `HttpTransport`. The workspace receives the resulting
native request at its existing `POST /api/v1/lineage` endpoint.

Original input files, native SDK serialization, actual HTTP wire bodies and
workspace replies remain separate files in one private operation. A gzip body
is captured while the native entity writes to the connection, preserving its
original streaming and chunked behavior. The saved acknowledgement is matched
to the original workspace, operation ID, wire SHA-256 and decoded event SHA-256.

## Prepare an existing Java runtime

Use Java 17 or later, an existing Maven installation and the host's util-linux
flock command. The accepted Linux runtime supplies all three. Dependency
preparation uses the pinned Maven dependency plugin to resolve the native SDK
and its runtime dependencies through Maven's existing settings and cache.

```sh
node JAVA_PRODUCER.mjs prepare --runtime /absolute/java-producer-runtime
```

For an existing complete Maven cache, add `--offline`. Select a particular
executable with `--maven /absolute/mvn` and the existing lock executable with
`--flock /absolute/flock`. Preparation creates the runtime
source, POM, complete classpath and hashes for every resolved dependency.
A completed matching runtime with its successful original Maven command is reused.
The native Java class runs with the JDK's source launcher.

From the installed merchant product, the same entry is available through
`starforge openlineage native-java prepare --runtime DIR`.

## Resume preparation and original file publication

Preparation uses the application's existing writer lock in the selected runtime
directory. It keeps the exact SDK version, Java source and POM in
runtime-intent.json. Maven resolves its existing dependency graph into an
attempt-specific classpath file. The final classpath.txt and java-runtime.json
are published only after the actual Maven command exits successfully and every
selected dependency is read and hashed.

If that command is interrupted, continue prepare in the same directory.
Its original logs, preparation identity and candidate remain retained. A saved
successful preparation resumes its remaining file publication without rerunning
Maven. An old classpath whose successful command was never retained is treated as
unverified: the same POM is resolved again through Maven's existing cache. An old
runtime receipt without a saved successful command is preserved alongside the
observed preparation instead of being silently treated as complete.

Manifests, source copies, inputs and private configuration files are first written
to an owned staging path derived from their expected SHA-256, checked as a complete
file, synced and then published. An interrupted staging prefix resumes only when
every retained byte matches the same selected content. A legacy partial final file
is retained under an .interrupted-<SHA256> name before the complete selected file
replaces its name. A complete different source is preserved and rejected. An
unverified old Maven classpath is likewise retained before its verified replacement.

When the owning Node process ends while holding writer.lock, reconcile the
original supervising operation and its child before recovering an older command
that did not use the process lock. The existing recover-lock command checks only
the Node PID; it does not itself establish that an orphan Maven child ended.
Preserve an active or unresolved older native command in its original operation.

Current preparations wrap Maven in the host's nonblocking kernel file lock.
The permanent .maven-process.lock inode is held through the actual command.
Even after Node writer recovery, another Maven command cannot enter while that
original lock remains held. A lock conflict returns exit 75 without dispatching
a second Maven command; its original preparation and logs remain retained.
Keep this lock file with the runtime; do not remove it to force a retry.

After the original source boundary is resolved, inspect the actual saved
writer lock ID and use the existing application's recovery command:

    node /absolute/application/cli.mjs recover-lock \
      --workspace /absolute/java-producer-runtime \
      --id ORIGINAL_LOCK_ID

This original command requires that exact lock and an ended writer process.
For an interrupted event operation, select its operation directory in the same
command. Do not remove the lock of a live process. The Java event sender also
retains its original native file lock; its acknowledged events and wire bodies
stay in that same operation.

The Node wrapper waits for the original child to close before releasing its
writer or command output files, including after cancellation. No replacement
workspace or producer operation is created to resume preparation.

## Receive a complete runtime on another host

The native runtime can be transferred independently of the original host's Maven cache. After a successful original preparation, export the complete runtime:

```sh
node /absolute/application/JAVA_PRODUCER.mjs runtime-export \
  --runtime /absolute/prepared-java-runtime \
  --out /absolute/delivery/openlineage-java-runtime.json
```

The package retains the unchanged Java source, POM, runtime intent, complete resolved JAR files, original successful Maven command and its complete output. Every file has its original byte count and SHA-256. The emitted package is independent of the lineage workspace export; carry both complete files through the customer's existing delivery route.

On the receiving host, use the delivered application's original launcher:

```sh
node /absolute/received/application/JAVA_PRODUCER.mjs runtime-verify \
  --input /absolute/delivery/openlineage-java-runtime.json

node /absolute/received/application/JAVA_PRODUCER.mjs runtime-receive \
  --input /absolute/delivery/openlineage-java-runtime.json \
  --runtime /absolute/customer/java-runtime
```

Receiving verifies the complete package before writing its selected runtime. It preserves the original source and preparation under `origin/`, writes every dependency under the receiving directory, and rebuilds the classpath from those local paths. The source and POM must match the received application's selected edition. The dependency order, names, hashes and complete bytes remain the original prepared selection.

The original receiving descriptor and original-file publication helpers support continuation in the same directory after an interrupted copy. Repeating the same completed package verifies and reuses that runtime. A different package needs a different receiving directory. A received runtime may itself be exported and received on another host, carrying its original receiving descriptor.

Use that received runtime with the existing `emit` operation. It requires the selected JDK with its source launcher; Maven and the original Maven cache are no longer needed. `prepare --offline` also verifies and reuses the received runtime without starting a resolver. The emitted receipt records receiving provenance separately from the original successful preparation.

Version 7 workspace packages include the runtime receiving programme while continuing to accept complete version 6 applications and all earlier supported editions. The product's maintained Java and Python senders remain the original integration points. A producer's operation directory is separate from its runtime: carry its retained input files, serialized events, wire bodies, replies and receipts when continuing the same delivery. Select the receiving workspace's current connection and receiving producer credentials. Private `java-config-*.yaml` files contain the original host's token and remain with that host's secret configuration.

Run the complete native customer programme using an existing prepared runtime and the selected Python environment:

```sh
node /absolute/application/JAVA_RUNTIME_RECEIVING.mjs \
  /absolute/private/customer-runtime-receiving \
  --runtime /absolute/prepared-java-runtime \
  --python /absolute/prepared-python/bin/python
```

It receives original events through the released Python and Java SDKs, retains both clients' actual requests while the original writer is occupied, exports the complete workspace, receives an independent application and runtime, moves the original producer operations, resumes their exact native requests, and verifies repeat-safe completion. The received Java classpath is entirely local and preparation uses a deliberately absent resolver. Every original request is compared with its committed receiver object and decoded SDK serialization.

The programme's private directory contains the complete runtime package, editable workspace package, receiving descriptors, original native operations and their customer continuations. Its checkpoint records each completed stage and retains an interrupted stage for continuation in that same directory.

## Emit complete original inputs

Start the original lineage workspace and use its current connection file.
The existing producer guide describes the separate operator and producer token
files. Pass the producer's token file to this operation.

```sh
node JAVA_PRODUCER.mjs emit \
  --runtime /absolute/java-producer-runtime \
  --directory /absolute/original-java-operation \
  --connection /absolute/lineage-project/connection.json \
  --token-file /absolute/private/producer-token \
  --input /absolute/original/events.json \
  --input /absolute/original/later-events.ndjson \
  --operation-id original-java-pipeline-import \
  --compression gzip
```

An input may contain an event, an event array or JSON lines. The original
source order, event type, run IDs, jobs, datasets, facets and schema references
are supplied to the native SDK. Its own serialization is retained for direct
comparison with the receiver's decoded source. The complete original input
copies remain available for examining any SDK normalization.

The operation selects a distinct stable `Idempotency-Key` for every native
event. HTTP acknowledgements return only after the workspace's original atomic
source commit. Java uses the explicitly configured native HTTP transport;
credentials come from the generated private Java configuration.

Use `--compression identity` for uncompressed HTTP and `--java /absolute/java`
to select an existing JDK. Retain the selected compression with the original
operation. The installed equivalent is
`starforge openlineage native-java emit` with the same arguments.

## Continue the same operation

Run the same command with the same runtime, operation directory, operation ID
and unchanged original input files. Completed events reuse their retained
acknowledgements. An interrupted event uses the same SDK serialization and
operation identity when it is sent again. Follow a returned `Retry-After`
before retrying a busy receiver.

The current connection and producer token may be selected again after an
ordinary server restart. The original workspace pin remains unchanged.
The operation's file lock keeps two native senders from writing the same
continuation simultaneously.

The Java sender also publishes each SDK-serialized event through its own
SHA-256-named staging file under the same native operation lock. A stopped
write resumes only its exact byte prefix. Once complete, the file is synced,
read back and published without replacing a different final file. A partial
final file from the older direct-write sender is retained as the same inode
under .event-NNNNNN.json.interrupted-<SHA256> before its name is atomically
replaced by the complete selected serialization. Keep those retained prefixes
and hidden staging files with the original operation when moving or archiving it.
A nonmatching prefix, changed inode, symbolic link or shared incomplete staging
file remains preserved and stops publication; it is never truncated.

This source repair changes the Java source hash used by runtime-intent.json.
Select a distinct runtime directory for this source edition and resolve through
the existing Maven cache. Preserve any already-prepared older runtime and its
actual producer records.

For an operation whose immutable java-input.json was already created by an older
source, add --previous-java-source-sha256 with that manifest's exact original
Java source SHA-256 to the otherwise unchanged emit command. The wrapper requires
the complete original manifest to match the selected SDK, POM, input files,
source order, workspace, operation ID and compression. It preserves those original
manifest bytes, then retains the selected runtime receipt, Java source, POM and a
deterministic java-source-continuation-<SHA256>.json descriptor beside them.
The actual invocation records both source identities and the original manifest
hash. Its completed return includes sourceContinuation after the native sender
succeeds and the original manifest is read back unchanged.

    node JAVA_PRODUCER.mjs emit \
      --runtime /absolute/corrected-java-runtime \
      --directory /absolute/original-java-operation \
      --connection /absolute/original-workspace/connection.json \
      --token-file /absolute/private/producer-token \
      --input /absolute/original/events.json \
      --operation-id ORIGINAL_OPERATION_ID \
      --compression gzip \
      --previous-java-source-sha256 ORIGINAL_MANIFEST_JAVA_SOURCE_SHA256

Use that same predecessor selection on retries. A missing, partial or different
original manifest cannot authorize source adoption. The original Java file lock
still prevents two native senders from entering the same event operation.
Acknowledged events retain their original IDs, wire bodies and replies; only an
unacknowledged event with the same serialized content is resumed.

Each event retains these files under `native/`:

- The native SDK serialized JSON and its complete input attribution.
- The actual plain or gzip request body, with its byte count and SHA-256.
- The original response body, selected nonsecret headers and HTTP status.
- A completed event receipt or the interrupted attempt's source and response.

The complete `java-producer-result.json` records the native SDK location, Java
version, event classes and acknowledged workspace source identities. Private
configuration and token files belong with the receiving operator's existing
credentials. The original source files and editable workspace can be exported
and received through the product's normal workflow.

## Integration interface

`JAVA_PRODUCER.mjs` exports:

```js
await prepareJavaProducer({
  directory: "/absolute/java-producer-runtime",
  maven: "mvn",
  flock: "flock",
  offline: false
});

await emitJavaProducer({
  runtime: "/absolute/java-producer-runtime",
  directory: "/absolute/original-java-operation",
  connection: "/absolute/lineage-project/connection.json",
  tokenFile: "/absolute/private/producer-token",
  inputs: ["/absolute/original/events.json"],
  operationId: "original-java-pipeline-import",
  compression: "gzip",
  java: "java",
  previousJavaSourceSha256: null // Exact old manifest source SHA only for explicit source adoption.
});
```

Both functions accept an optional `AbortSignal` as `signal`. They retain
native command stdout, stderr and the operation identity after interruption.
The retained preparation records the actual flock command, its child exit status,
the selected Maven executable/arguments and the permanent process lock path.
`javaProducerCommand(args)` provides the same command entry for the existing
product CLI.

## Native source contract

The released SDK is documented in the official
[Java client guide](https://openlineage.io/docs/client/java/) and
[HTTP configuration guide](https://openlineage.io/docs/client/java/configuration/).
The upstream `1.53.0` tag resolves to
`8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe`.

The native lock command uses the existing
[util-linux flock interface](https://github.com/util-linux/util-linux/blob/master/sys-utils/flock.1.adoc):
the command inherits the lock and returns its actual child exit status. It does
not create another queue or producer operation.

The SDK implementation follows these original release files:

- [HttpTransport.java](https://github.com/OpenLineage/OpenLineage/blob/8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe/client/java/src/main/java/io/openlineage/client/transports/HttpTransport.java),
  Git blob `e8fd4f766dcd256d015d5f7ce9e1d6e7039a0a3b`.
- [HttpConfig.java](https://github.com/OpenLineage/OpenLineage/blob/8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe/client/java/src/main/java/io/openlineage/client/transports/HttpConfig.java),
  Git blob `2486d799a019541b1c93584ddf3d04a8d916dc05`.
- [OpenLineageClientUtils.java](https://github.com/OpenLineage/OpenLineage/blob/8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe/client/java/src/main/java/io/openlineage/client/OpenLineageClientUtils.java),
  Git blob `985724e00221318beffc7f8c9215bea3a9075942`.

The original 41-file receiving journey and its accepted outputs continue to
cover the existing application. Native SDK operation extends that application
with actual upstream Java emission and complete receiver acknowledgements.

