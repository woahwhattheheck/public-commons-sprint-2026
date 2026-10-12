# Kafka source workspace

Turn retained Kafka messages into a queryable Stellar Forge dataset, then deliver the original source history and merchant package together.

The adapter uses the official Confluent Python client for broker access and the existing SF30 NDJSON engine for field inventory, mappings, dataset construction, queries, edition comparisons, merchant configuration and generated customer SDKs. The console keeps a neutral industrial layout and all customer state in its private workspace.

## Open a workspace

Use the toolkit's installed command with Node 22.16+ and Python 3.11+:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace init

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace serve --port 0
```

Open the private console link printed by the original process. The process owns its local connection and sole workspace writer until it stops.

The command also selects Python from `SF30_KAFKA_PYTHON`, then `SF30_XML_PYTHON`, then `python3` when `--python` is omitted.

Install the native consumer in that same selected Python environment to inspect and capture brokers:

```sh
/absolute/python3 -m pip install confluent-kafka==2.16.0
```

Project receiving, existing dataset queries and source review remain available without contacting a broker. The console reports the installed Python client and librdkafka versions.

## Complete customer workflow

1. **Save the connection.** Enter the actual bootstrap addresses and topic. Choose its security protocol and the names of the environment variables holding credentials or private TLS file paths. Saving creates an immutable configuration revision. Select a retained connection and choose **Edit selected revision** to create its successor.

2. **Inspect the broker and topic.** This deliberate read retains the native cluster identity, topic UUID, earliest and high offsets, and each partition's last stable committed end. Every new inspection has its own original observation.

3. **Prepare exact ranges.** Select partitions and review inclusive start/exclusive end offsets. Decimal offsets retain every digit. A prepared capture fixes its configuration revision, original inspection, topic identity and ranges.

4. **Run the capture.** The native consumer assigns the selected partitions directly and persists original events together with their next offsets. It uses committed isolation and disables automatic offset storage and commits. **Stop capture** closes this consumer and retains completed batches. **Resume this capture** continues the original selection from its saved checkpoints.

5. **Review retained messages.** Inspect partition/offset identity, original key and value bytes, timestamps and ordered headers. UTF-8 view displays the original text, including exact numeric tokens. The decoded JSON view uses the native `valueJson` string so a browser cannot round a large integer or decimal while displaying it. Base64 view covers binary values, and a null value remains a Kafka tombstone. Downloading an event saves the original native JSON response bytes. History pages carry compact offset/state/byte metadata and a key preview capped at 256 characters; selecting one event retrieves its full original value. A history value marked **present** is decoded only when that event is opened.

6. **Create a fixed source edition.** Select complete captures, or explicitly include their retained incomplete coverage. Choose every distinct event or the latest event for each exact binary key within a topic partition. Select JSON decoding or original bytes and the applicable deletion policy.

7. **Review the suggested mapping.** The complete existing NDJSON workspace opens with the source and suggested fields. Choose customer-visible columns and native filtering, sorting and key capabilities. Save the mapping, build the complete edition, query it and compare editions with the same keyed mapping.

8. **Deliver the complete project and merchant.** The original merchant section generates the seller package and customer SDK from the reviewed edition and actual payment terms. The Kafka handoff section exports the selected projection history and native dataset together. Import reconstructs the same source and original edition in a fresh private workspace.

## Connection configuration

A connection request saves references to server environment variables. Literal passwords and private key material are outside this configuration.

```json
{
  "connection": "goldsky-main",
  "expectedRevision": 0,
  "operation": "goldsky-main-save-1",
  "config": {
    "schema": "stellar-forge.kafka-connection.v1",
    "label": "Goldsky downstream topic",
    "brokers": ["broker.example.com:9092"],
    "topic": "events",
    "security": {
      "protocol": "SASL_SSL",
      "mechanism": "SCRAM-SHA-512",
      "usernameEnv": "KAFKA_USERNAME",
      "passwordEnv": "KAFKA_PASSWORD"
    },
    "requestTimeoutSeconds": 30,
    "maxMessageBytes": 10485760,
    "maxCaptureBytes": 268435456,
    "maxCaptureRecords": 1000000
  }
}
```

Supported protocols are `PLAINTEXT`, `SSL`, `SASL_PLAINTEXT` and `SASL_SSL`. Supported SASL mechanisms are `PLAIN`, `SCRAM-SHA-256` and `SCRAM-SHA-512`. Optional TLS fields are `caFileEnv`, `certificateFileEnv`, `keyFileEnv` and `keyPasswordEnv`. Each contains an environment variable name.

The original request accepts 1–120 seconds, message payloads up to 16 MiB, retained capture wire data up to 256 MiB and up to 1,000,000 selected records. A message payload includes the original key, value and ordered header bytes. The retained capture budget includes the full serialized wire records for both selected messages and boundary evidence; Base64 and metadata therefore count toward that storage limit. A changed limit belongs in a new connection revision and a deliberately selected new capture.

## Retain the same operation from the command line

The installed command and browser operate the same workspace. Stop the console before running a command that opens the workspace; the separate `cancel` command below talks to its existing live console.

Keep each request and result in your private operation directory. The `operation` value is your stable name for that exact request. Retrying unchanged input reopens its retained result; an intentional new observation or source edition uses a new operation name.

### Save and inspect the actual source

Save the connection JSON above as `connection-request.json`, using the actual broker, topic and private environment references. Then run:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace connection \
  --file /absolute/private/operation/connection-request.json

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace inspect \
  --file /absolute/private/operation/inspection-request.json
```

The inspection request selects the saved revision explicitly:

```json
{
  "connection": "goldsky-main",
  "revision": 1,
  "operation": "goldsky-inspect-1"
}
```

Retain the returned inspection ID and its actual partition `low`, `high` and committed `end` values. An inspection is a saved observation. Repeating its name retrieves it; a later observation uses a following operation name.

### Prepare and run the selected range

Create `capture-request.json` with that original inspection ID. The following shape illustrates a selected partition; fill its offsets from your retained inspection:

```json
{
  "inspection": "THE_RETAINED_64_CHARACTER_INSPECTION_ID",
  "operation": "goldsky-capture-1",
  "ranges": [
    {"partition": 0, "start": "0", "end": "118"}
  ]
}
```

`start` is inclusive; `end` is exclusive. A capture can select several partitions and does not require them to have the same offsets.

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace capture \
  --file /absolute/private/operation/capture-request.json

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace run \
  --capture RETAINED_CAPTURE_ID --expected-revision 1
```

A foreground run returns its actual capture state. Exit 0 means `COMPLETE`; exit 2 returns a retained state requiring the indicated source or recovery action. Ctrl-C and SIGTERM close the native consumer and retain its accepted batches, with exits 130 and 143 respectively. Use `list` to read the current capture revision before resuming the same ID.

For browser operation, publish the original console connection to a new private file:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace serve --port 0 \
  --connection-file /absolute/private/kafka-console.connection \
  --startup-format json
```

The browser's **Stop capture** uses this running worker. Another terminal can request the same cancellation without trying to acquire a second workspace writer:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace cancel \
  --capture RETAINED_CAPTURE_ID \
  --connection-file /absolute/private/kafka-console.connection
```

This command checks the original private connection, workspace, Python and complete source binding against the live launch response. It connects directly to that loopback process. Cancellation returns its current state; the console displays the final checkpoint after the consumer has closed.

### Project, map and build the original dataset

Retain the completed capture's exact ID and revision in `projection-request.json`:

```json
{
  "operation": "goldsky-edition-1",
  "captures": [
    {"id": "THE_RETAINED_64_CHARACTER_CAPTURE_ID", "revision": 7}
  ],
  "view": "events",
  "decode": "json",
  "deletePolicy": "retain",
  "acceptIncomplete": false,
  "label": "Goldsky customer events"
}
```

The illustrated revision is replaced by your actual retained revision. Up to 64 captures may contribute to one fixed edition, with their combined unique retained wire data capped at 256 MiB.

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace project \
  --file /absolute/private/operation/projection-request.json
```

The result contains the original NDJSON `source` ID and complete `defaultPlan`. Save that mapping as a JSON file, adjust customer fields in the original mapping editor or native plan, then retain its returned plan ID:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace plan \
  --file /absolute/private/operation/mapping.json

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace build \
  --source RETAINED_SOURCE_ID --plan RETAINED_PLAN_ID

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace query \
  --build RETAINED_BUILD_ID --params '{"limit":"50"}'
```

The suggested mapping retains the event ID, topic, partition, exact offset text, timestamp text, key state, JSON value text and deletion state. Field mapping can expose nested producer JSON under `value`. Original NDJSON record, source, cell, row and query limits apply; a projected record must fit its 16 MiB physical-record contract and the complete source must fit 256 MiB.

The original `compare --before ID --after ID` and `changes --comparison ID` commands operate retained builds using the selected mapping and keys. Saving a following projection never rewrites the previous edition.

### Export, receive and reopen the same edition

Export to a new file with both the native build and original Kafka history selected:

```sh
starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/kafka-workspace export \
  --build RETAINED_BUILD_ID --projection RETAINED_PROJECTION_ID \
  --out /absolute/private/delivery/kafka-project.zip

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/customer-kafka init

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/customer-kafka import \
  --file /absolute/private/delivery/kafka-project.zip

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/customer-kafka list

starforge dataset-kafka --python /absolute/python3 \
  --workspace /absolute/private/customer-kafka query \
  --build RETAINED_BUILD_ID --params '{"limit":"50"}'
```

The receiver reconstructs the same source, mapping and native build. Re-importing that exact archive returns the existing receiving identity. Its selected capture history, ordered original bytes and projection remain available in the received console.

For the downstream API, use the original merchant panel or `merchant --build ID --payment PAYMENT_JSON --origin HTTPS_ORIGIN --path /data --out NEW_DIRECTORY`. Review the customer's complete payment terms and public response mapping before generating its original seller configuration and JS/TypeScript client. The generated package retains the reviewed edition; deployments and later releases use the maintained seller and retained-release workflow.


## Source identity and ordering

An original event is identified by cluster ID, topic UUID, partition and offset. Equal event content at distinct offsets remains distinct. Exact replay of the same identity is idempotent; conflicting original bytes at the same identity become a retained source conflict.

The Goldsky sink documents at-least-once delivery and possible duplicates on retries. It publishes the original operation as the `dbz.op` header (`c`, `u` or `d`). This adapter retains those bytes and recognizes the operation only when its header value is unambiguous.

Kafka offsets can contain gaps after compaction or aborted transactions. A range's completion uses observed native record/EOF position reaching the selected end. Offsets are not interpreted as dense row counts. Records beyond the selected end can provide boundary evidence and stay outside the selected dataset records.

Latest-per-partition-key uses exact topic UUID, partition and binary key, choosing its greatest offset. It requires a key for every selected event. A partition-count change can redistribute keys; cross-partition business ordering remains an explicit downstream modeling decision.

JSON projections preserve original numeric lexical values through the existing NDJSON decoder. Avro and other binary values can be retained, inspected and delivered in bytes mode. JSON field mapping uses the JSON representation supplied by the producer.

## Recovery and complete exports

Each capture retains its immutable selection, status, revision, attempts, accepted message bytes and per-partition next offsets. An unfinished process becomes `INTERRUPTED` when the workspace reopens.

A source retention gap, a different cluster/topic identity or conflicting original event bytes is recorded in that capture. Inspect the current source and explicitly choose the appropriate following capture. Existing retained editions keep their original coverage and bytes.

A projection freezes selected capture revisions. Later continuation of those captures cannot rewrite that projection's source. The full Kafka export contains the original NDJSON project plus the selected source connection references, inspections, captured bytes, coverage and projection history with a file manifest. When several histories yield identical NDJSON source bytes, choose the required projection history in the export controls.

The complete handoff contains seven root files:

| File | Retained content |
| --- | --- |
| `manifest.json` | Exact projection/source/build identities and hashes of the other six members |
| `kafka.json` | Selected connection references, native inspections, operation journal, attempt metadata and fixed projection |
| `messages.jsonl` | Every original wire record required by that selected capture history, including boundary evidence |
| `capture-revisions.jsonl` | Complete checkpoint history through each selected capture revision |
| `capture-members.jsonl` | Original capture/message role and the revision that accepted it |
| `projection-events.jsonl` | Explicit inclusion/exclusion of each retained source event |
| `ndjson-project.zip` | Original six-file NDJSON source, mapping, native dataset and review |

The manifest is limited to 16 KiB, Kafka metadata to 16 MiB, each JSONL history file to 256 MiB and the nested original project to 512 MiB. The complete transport limit is 1,568 MiB. Actual valid source and mapping limits still govern reconstruction.

Import validates the complete wire history and projection, checks existing source/membership conflicts and joins the nested native source/build to the chosen outer edition before the original dataset receiver writes. The original engine then performs its full source/plan/build reconstruction, followed by the same retained Kafka history commit. If a process stops between those steps, the original operation names and source hashes reopen the same work.

The receiver supplies its own values for the saved environment variable references to continue broker access. Import and local dataset reconstruction use the retained project bytes.

## Managed Applications

Choose **Kafka datasets** in the installed Applications home, then select:

- The original private Kafka workspace.
- The exact Python executable and its existing environment.
- An optional new console connection file.
- A private environment file for the broker's referenced values, if needed.
- The local port, with 0 selecting an available port.

Review and Save retain the selected source, Python and workspace binding. Start launches the original `dataset-kafka` command and verifies its private `/api/launch` identity before making **Open** available. Stop closes the original capture worker and console; reopen keeps the same workspace.

Kafka and NDJSON Applications share a resource family for the same private source directory. The original writer exclusion therefore covers both views of that database.

Kafka wire history is retained in its private kafka.sqlite database alongside the original NDJSON workspace.sqlite, under the same original workspace writer. This keeps large captures separate from the dataset engine's original database size contract.

The managed binding covers all 26 executable/browser source paths, the original workspace and Kafka markers, both database inode identities and selected Python. Mutable database contents and broker availability stay outside the reviewed source digest.

## Original source interfaces

Kafka adds connection revision, inspection, capture, run/cancel, message history, projection and complete import/export endpoints below `/api/kafka/`. The original NDJSON source/plan/build/query/compare/changes/merchant endpoints remain the dataset interfaces.

The browser composes the original NDJSON module's exported request, work, refresh, mapping and download functions. Completed native dataset refreshes update the Kafka handoff's edition choices through the same page's `sf30:ndjson-state` event.

`browser-assets.json` is the complete served URL map. The Kafka Python server and distribution closure use the same five routes, including the original NDJSON JavaScript and stylesheet.

## First-party references

- [Goldsky Kafka sink](https://docs.goldsky.com/turbo-pipelines/sinks/kafka): connection fields, JSON/Avro serialization, operation headers, delivery and partition behavior.
- [Confluent Python API](https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html): original consumer/admin methods and native offset observations.
- [Apache Kafka consumer](https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html): committed consumption, offsets and direct partition assignment.
- [Apache Kafka design](https://kafka.apache.org/43/design/design/): log compaction and retained offset semantics.
