# Kafka merchant workspaces

The Kafka merchant provider lets an agent complete the source-to-customer workflow
in the Kafka Application: inspect an exact topic, retain explicit partition
ranges, build an NDJSON dataset, compare editions and receive a complete merchant
package. The existing Kafka HTTP server owns the databases, native writer and
consumer. The browser, Node client and merchant tools all use that owner.

The source-owned provider ID is `kafka-workspaces`. Its26 tools use
`merchant_kafka_`. [CLIENT.md](CLIENT.md) describes the complete Node client,
CLI and native route contract. [CONTRACT.md](CONTRACT.md) explains the retained
source, offsets, projection and archive semantics.

## Configure an existing Application

Open the Kafka Application and retain its private connection file. The client
accepts the original console URL file or Applications URL record. Keep that file
on its original operator host with mode0600. The reader checks regular-file
identity, ownership and permissions; each operation authenticates the original
`/api/launch` and workspace/source binding.

Create a private host configuration, for example /private/kafka-connections.json:

~~~json
{
  "schema": "stellar-forge.kafka-merchant-connection.v1",
  "workspaces": {
    "events": {
      "label": "Merchant event stream",
      "connectionFile": "/private/applications/kafka/console-url.json",
      "inputs": {}
    }
  }
}
~~~

File paths appear only in host configuration. Tools choose declared workspace
and input aliases. Optional expectedWorkspaceId and expectedBindingSha256 pin
the actual original launch. A refreshed Applications URL may select the same
workspace on a new listener; an existing client retains its original workspace
path, UUID and source binding.

Declare complete receiving inputs under the selected workspace:

~~~json
{
  "received_project": {
    "path": "/private/receiving/kafka-project.zip",
    "kind": "kafka-project",
    "sha256": "REPLACE_WITH_THE_ACTUAL_COMPLETE_FILE_SHA256"
  }
}
~~~

Supported kinds are kafka-project, ndjson-project and ndjson. Add an input only
when its complete file exists and replace the SHA placeholder with the real hash.
The host configuration supports32 workspaces and64 inputs per workspace.

Create setup options with the intended directory and host configuration:

~~~json
{
  "directory": "/private/kafka-merchant",
  "connection": "/private/kafka-connections.json",
  "name": "Kafka merchant workspace"
}
~~~

Run the maintained registry commands:

~~~sh
starforge merchant-providers inspect kafka-workspaces
starforge merchant-providers init kafka-workspaces --options /private/kafka-setup.json
~~~

The initializer creates the original release store, private customer-export
directory and merchant configuration. Repeating the exact setup reopens its
existing configuration. One original setup lease serializes publication of the
complete prepared directory.

The returned configuration works with the maintained merchant-mcp HTTP or stdio
host and its existing authentication. An existing merchant may add
`kafkaWorkspaceConnection` pointing to the new host configuration while
preserving its five common configuration fields and other providers.

## Complete workflow

### Inspect and select the actual source

Call `merchant_kafka_workspaces`, then `merchant_kafka_inspect` with a selected
workspace alias. Inspection reports the actual workspace UUID and source binding
without exposing the private console token or local file paths.

`merchant_kafka_state` returns complete native state.
`merchant_kafka_configured_topics` lists saved exact-topic connection revisions.

Save a connection with `merchant_kafka_save_connection`, using its current
expectedRevision and a stable operation:

~~~json
{
  "workspace": "events",
  "connection": "orders",
  "expectedRevision": 0,
  "operation": "orders-settings-v1",
  "config": {
    "schema": "stellar-forge.kafka-connection.v1",
    "label": "Order events",
    "brokers": ["127.0.0.1:19092"],
    "topic": "order-events",
    "security": {"protocol": "PLAINTEXT"},
    "requestTimeoutSeconds": 30,
    "maxMessageBytes": 16777216,
    "maxCaptureBytes": 268435456,
    "maxCaptureRecords": 1000000
  }
}
~~~

Select the actual broker, topic and security settings for the host. TLS and SASL
settings refer to existing server environment variables. Credential values stay
in that original environment.

Call `merchant_kafka_inspect_connection` with the saved connection revision and
a stable inspection operation. Keep the returned inspection ID, actual cluster
ID, topic UUID, partition identities and committed low/end offsets.

### Retain explicit ranges

`merchant_kafka_prepare_capture` takes that inspection ID and ranges shaped as
`{"partition":0,"start":"0","end":"12"}`. Select actual observed offsets.
End offsets are exclusive. Every offset remains decimal text, including values
above JavaScript's safe integer range; each partition occurs once in the selection.

Use `merchant_kafka_run_capture` with the returned capture ID and expectedRevision.
The original consumer uses read_committed and direct partition assignment.
`merchant_kafka_wait_capture` returns the actual state after RUNNING/CANCELLING.
Cancelled, interrupted and limited captures retain their exact received coverage.

`merchant_kafka_cancel_capture` controls that original capture.
`merchant_kafka_resume_capture` uses its same ID and current revision.
Recover interrupted calls with the original operation and retained record IDs.

### Create a dataset edition

`merchant_kafka_messages` pages compact metadata and exact offsets.
`merchant_kafka_message` retains the complete original message JSON for file
receiving, preserving raw key/value bytes, ordered headers and tombstones.

`merchant_kafka_project` selects original capture IDs/revisions and these fields:

| Field | Choices |
| --- | --- |
| view | events; latest-per-partition-key |
| decode | json; bytes |
| deletePolicy | retain; tombstone; tombstone-or-goldsky |
| acceptIncomplete | Explicit boolean |
| operation | Stable original projection operation |
| label | Retained source edition label |

The original projector enforces topic identity, coverage and deletion rules and
creates the corresponding native NDJSON source. Save a complete native mapping
plan through `merchant_kafka_save_plan` using planJson text; build it with
`merchant_kafka_build` and the returned source/plan IDs.

`merchant_kafka_query` takes original scalar-string query parameters.
`merchant_kafka_compare` retains a full before/after comparison;
`merchant_kafka_changes` pages that saved change set.
`merchant_kafka_read` reopens connections, inspections, captures, projections,
sources and plans by their original identities.

### Receive complete files

`merchant_kafka_export` takes a stable operation, kind and exact selection:

| Kind | Selection | Complete file |
| --- | --- | --- |
| kafka-project | {build, projection?} | Kafka archive containing its native NDJSON project |
| ndjson-project | {build} | Native NDJSON project ZIP |
| dataset | {build} | Original dataset ZIP |
| changes | {id} | Complete comparison change NDJSON |
| merchant | {build, payment, origin, path} | Original merchant package ZIP |
| message | {id} | Full raw message JSON |
| state | {} | Full current state JSON |
| projection | {id} | Full retained projection JSON |
| record | {kind, id} | Connection, inspection, capture, source or plan JSON |
| query | {build, query} | Full original query JSON |

The merchant payment object, public origin and route use the native NDJSON
merchant contract. The original publisher prepares the package; customer checkout
and settlement use that package's existing workflow.

The export result contains the actual artifact, original source binding, complete
byte count and SHA-256. Read through `merchant_kafka_file_read`:

~~~json
{
  "workspace": "events",
  "artifact": "ACTUAL_RETURNED_ARTIFACT_ID",
  "expectedSha256": "ACTUAL_RETURNED_FILE_SHA256",
  "offset": 0,
  "limit": 65536
}
~~~

Keep each returned readId, expectedSha256 and nextOffset. Decode base64 chunks
to bytes in order. nextOffset:null completes the file. Verify its full received
size and SHA-256. Following a timeout, release or host restart, omit the expired
readId and reopen the same artifact at its original expectedSha256 and byte
offset. The read-only descriptor retains that exact file.

`merchant_kafka_file_release` releases a descriptor early.
`merchant_kafka_manifest` and `merchant_kafka_exports` inspect retained files
without contacting Kafka. Set includeFile:true on the manifest tool to receive its
exact retained manifest.json bytes, length and SHA-256; the customer downloader
pins its original manifest before receiving the payload. An incomplete export listing returns its original
operation and selection for recovery.

### Import and reopen

Declare the complete received file and actual SHA-256 under a host input alias.
`merchant_kafka_import` selects that alias in the intended receiver workspace.
Kafka imports perform the original full outer/inner archive validation. Native
project/source inputs use their original inherited routes. The client hashes and
transfers the same opened file and checks identity through the upload.

Reopen the original retained source, plan, build, capture and projection identities
in the receiver. Query its dataset against the source edition selected for that
customer.

## Exact numbers, large responses and recovery

Kafka offsets and timestamps stay decimal strings. The Node client represents
unsafe or noncanonical numeric JSON tokens as KafkaJsonNumber. Ordinary MCP JSON
uses `{"$kafkaNumber":"the original numeric token"}`; the native serializer
writes the original token as a number. Preserve this value instead of coercing it
to a Number. planJson accepts complete exact JSON text.

Native files stream byte for byte. A native result above128KiB is retained as
complete exact-number JSON, and its tool response returns the original file
manifest. A result above the configured in-memory JSON limit can be received
through the corresponding explicit state, record, projection or query export.

Before downloading, the merchant saves one immutable selection containing the
workspace binding, operation, kind and complete input. Its artifact ID is stable
for that workspace alias and operation. Changed selections under the same
operation are rejected; a new observation uses another operation.

The client writes an owned temporary file, validates the entire response length,
syncs it and links only a completed file to the final destination. A lost result
after publication reopens and hashes that same file before completing its
manifest. A transfer interrupted before publication resumes the same export
selection. The original Linux flock primitive serializes each export across
merchant processes. Retained metadata also tolerates its original temporary hard
link after a process interruption.

The shared RetainedFileReads owner receives the original read-only descriptor,
checks its complete SHA before its first range and serves large immutable files
without another full copy. Its four-read capacity and idle expiry apply.

Closing the provider cancels its own HTTP/checksum work and drains accepted
operations and descriptors. Applications continues to own the Kafka server.
A source capture is cancelled through its explicit tool. A native POST interrupted
after dispatch carries outcomeUnknown; reopen its same operation/record.

## Integration and native receiving

The source-owned descriptor, catalog, reader and setup stay in this Kafka package.
The existing contribution preserves dataset-kafka, its browser assets and the
Kafka Application provider, and adds kafka-client, the client/merchant exports
and merchantProviders declaration. Runtime imports remain lazy.

The complete client/MCP receiving phase belongs inside the original managed Kafka
customer lifetime, after its browser receiver and before its console closes.
It uses that same source, original archives and workspace, then receives and
reopens complete files through the actual maintained merchant transport.
