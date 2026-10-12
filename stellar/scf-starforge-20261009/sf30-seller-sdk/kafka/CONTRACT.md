# Kafka source console contract

Operation: SCF-KAFKA-MERCHANT-8F43-20261012. This adapter extends the original SF30 NDJSON workspace and dataset/merchant/release engine.

## Source and ownership

Native files: kafka/shared.py, contract.py, transport.py, model.py, httpd.py, managed.py, cli.py, cli.mjs. Customer UI: kafka/public/index.html, app.js, style.css. Packaging map: kafka/browser-assets.json. The existing NDJSON app adds named exports api, work, refresh, notify, consoleReady, renderMapping and is served unchanged at /ndjson-app.js; its stylesheet is /ndjson-style.css.

The Kafka workspace retains the original NDJSON workspace.json and workspace.sqlite, with additional Kafka tables in a separate private kafka.sqlite database and a private kafka-workspace.json marker containing {"schema":"stellar-forge.kafka-workspace.v1","id":"<UUID>"}. One original workspace writer lease owns capture, projection and native dataset operations. Open/list/binding do not contact a broker.

All existing /api/state, /api/source, /api/plan, /api/build, /api/query, /api/compare, /api/changes, /api/changes/download, /api/export, /api/dataset-export, /api/import and /api/merchant retain their original NDJSON contracts. Kafka adds the routes below. Local host/origin/private bearer rules are those of the original server. Every JSON body has an exact documented key set; optional fields are named below. Errors are {"error":"actionable message"} with HTTP 400; missing records return 404 and origin/auth failure 403.

## Common types

IDs and content hashes are lowercase 64-character SHA-256 strings unless a field is explicitly named operation or connection. An operation is caller-chosen, 1–128 characters [A-Za-z0-9._:-]. It is unique within its operation kind; reusing it returns the retained operation only when its original arguments match. Decimal offsets are canonical nonnegative strings in signed 64-bit range. Partitions are nonnegative JSON integers. Revision, record and byte counts are nonnegative JSON integers. All timestamps are UTC ISO-8601 strings. Full key, value and header bytes use canonical base64; null remains distinct from empty bytes.

### Client status

client = {"available":true,"pythonPackage":"confluent-kafka","version":"2.16.0","libraryVersion":"...","requirement":"confluent-kafka==2.16.0"}
When unavailable, available is false and version/libraryVersion are null; message explains how the original selected Python installs the declared requirement. This is an offline import check. Opening the console never initiates a network call.

### Connection configuration

config = {
  "schema":"stellar-forge.kafka-connection.v1",
  "label":"Goldsky downstream topic",
  "brokers":["broker.example:9092"],
  "topic":"events",
  "security":{
    "protocol":"SASL_SSL",
    "mechanism":"SCRAM-SHA-512",
    "usernameEnv":"KAFKA_USERNAME",
    "passwordEnv":"KAFKA_PASSWORD"
  },
  "requestTimeoutSeconds":30,
  "maxMessageBytes":10485760,
  "maxCaptureBytes":268435456,
  "maxCaptureRecords":1000000
}

Supported protocols: PLAINTEXT, SSL, SASL_PLAINTEXT, SASL_SSL. SASL mechanisms: PLAIN, SCRAM-SHA-256, SCRAM-SHA-512. Optional TLS references: caFileEnv, certificateFileEnv, keyFileEnv, keyPasswordEnv. TLS file references name environment variables containing private local file paths. Username/password/private key material never appears in saved configuration, API results, browser requests or exports. Unknown security keys and literal credential fields are rejected. Request timeout is 1–120 seconds; message bytes 1–16 MiB; capture bytes 1–256 MiB; records 1–1,000,000.

POST /api/kafka/connection
{"connection":"goldsky-main","expectedRevision":0,"operation":"save-main-1","config":config}
Creates revision 1. Later saves require exact current expectedRevision. Result:
{"id":"goldsky-main","revision":1,"sha256":"...","operation":"save-main-1","config":config,"createdAt":"..."}
GET /api/kafka/connection?id=goldsky-main returns the latest revision, with revisions as a list of the same retained revision records.

### Explicit metadata inspection

POST /api/kafka/inspect
{"connection":"goldsky-main","revision":1,"operation":"inspect-main-1"}
Uses only that immutable configuration revision. A retry with the same operation returns the same retained inspection. A deliberate metadata refresh uses a new operation. Result:
{
 "id":"...","operation":"inspect-main-1","connection":"goldsky-main","connectionRevision":1,
 "configSha256":"...","observedAt":"...","client":client,
 "clusterId":"...","topicId":"...","topic":"events",
 "partitions":[{"partition":0,"low":"0","high":"120","end":"118","observedAt":"..."}]
}
GET /api/kafka/inspection?id= returns this exact record.
The provider is the official Confluent Python consumer/admin client. Metadata retains the broker cluster identity and native topic UUID, so a deleted/recreated topic cannot reuse an old capture identity. low/high are fresh native watermarks. end is the native READ_COMMITTED latest offset (last stable offset), not an invented dense row count or uncommitted high watermark.

### Capture preparation, run and cancel

POST /api/kafka/capture
{"inspection":"<inspection-id>","operation":"capture-main-1","ranges":[{"partition":0,"start":"0","end":"118"}]}
Requires explicit unique selected partitions and start/end within the retained inspected range. Result is capture below. Preparation does not contact a broker.

capture = {
 "id":"...","operation":"capture-main-1","inspection":"...","connection":"goldsky-main",
 "connectionRevision":1,"configSha256":"...","clusterId":"...","topicId":"...","topic":"events",
 "status":"PREPARED","revision":1,"records":0,"bytes":0,"retainedBytes":0,"boundaryRecords":0,"boundaryBytes":0,
 "ranges":[{"partition":0,"start":"0","end":"118","next":"0","status":"PREPARED","records":0,"bytes":0,"terminalEvidence":null}],
 "createdAt":"...","updatedAt":"...","error":null,"attempts":[]
}

GET /api/kafka/capture?id= returns capture plus the saved attempt records.
POST /api/kafka/run {"capture":"...","expectedRevision":1}
Returns HTTP 202 with the current capture after admitting its sole background native worker. Same capture is resumed from its retained checkpoints; an already running/completed operation is reconciled before another run.
POST /api/kafka/cancel {"capture":"..."}
Returns the current capture with CANCELLING while its existing consumer is closing. Checkpoints already committed remain durable.
Statuses: PREPARED, RUNNING, CANCELLING, CANCELLED, INTERRUPTED, COMPLETE, LIMIT_REACHED, SOURCE_GAP, SOURCE_CHANGED, SOURCE_CONFLICT, ERROR.
Reopening a workspace after its original process stopped converts unfinished RUNNING/CANCELLING to INTERRUPTED and retains the previous attempt.

Each run checks both Admin and actual Consumer cluster/topic identity and each unfinished range's retained-start retention bound, assigns explicit TopicPartitions, uses enable.auto.commit=false, enable.auto.offset.store=false, auto.offset.reset=error and isolation.level=read_committed. It never subscribes to or commits an existing customer's consumer group. Offsets may have compaction/transaction gaps. Completion requires a native observed record/EOF position reaching the selected end; an offset gap alone is not a missing-message finding. A record observed beyond the selected end may be retained as boundary evidence and is excluded from selected projection records. The same identity is cluster ID + topic UUID + partition + offset. Same-offset exact replay is idempotent; equal business content at distinct offsets remains distinct. Same identity with conflicting wire bytes is a retained source conflict. Final native metadata rechecks the original topic UUID; COMPLETE is emitted only after the native consumer closes. Previously completed partition ranges preserve their retained terminal evidence if another range later resumes after broker retention advances.

capture.bytes counts the full serialized original wire bytes for selected records. capture.boundaryBytes and boundaryRecords count retained boundary evidence. retainedBytes = bytes + boundaryBytes is the capture storage limit. Per-message maxMessageBytes applies to original payloadBytes (key/value/header bytes) for selected and boundary records alike.

Attempts are {"id":"...","startedAt":"...","endedAt":null,"status":"RUNNING","client":client,"error":null}. A running worker is polled at 250 ms. Persistence records each accepted batch and its next offsets together. Stop and process restart never silently skip to a newer retention low.

### Native message history

GET /api/kafka/messages?capture=<id>&offset=0&limit=50
returns {"capture":"...","offset":0,"limit":50,"total":120,"messages":[summary...]}.
Each summary contains id, sha256, clusterId, topicId, topic, partition, offset, timestampType, timestampMs, leaderEpoch, keyState, keyUtf8Preview, keyPreviewTruncated, keyBytes, valueBytes, headerCount, wireBytes, valueState, goldskyOperation and deleted. keyState is null, empty, utf8 or binary; keyUtf8Preview is at most 256 characters. Byte counts distinguish null from zero. Summary valueState is present or tombstone: list pages do not decode or parse all message values. Select the full /message endpoint for exact value bytes and JSON classification.
Page ordering is partition ascending then numeric offset; it does not claim global event ordering. Limits 1–200.
GET /api/kafka/message?id=<event-id> returns message including every original byte:
{
 "id":"...","sha256":"...","clusterId":"...","topicId":"...","topic":"events","partition":0,"offset":"14",
 "timestampType":"CREATE_TIME","timestampMs":"1791770000000","leaderEpoch":null,
 "keyBase64":"...","valueBase64":"...",
 "headers":[{"name":"dbz.op","valueBase64":"dQ=="}],
 "keyUtf8":"customer-42","valueState":"json","value":{},"valueJson":"{}","parseError":null,
 "goldskyOperation":"u","deleted":false
}
timestampType is NOT_AVAILABLE, CREATE_TIME or LOG_APPEND_TIME; timestampMs is null when unavailable. leaderEpoch is an integer or null. Duplicate header keys retain their order and bytes. valueState is json, tombstone, binary or invalid-json. A null value is a tombstone; b'' is not. Goldsky c/u/d comes from an unambiguous original dbz.op header. JSON numbers retain the original lexical value through the existing NDJSON JsonNumber implementation. valueJson contains the exact decoded JSON text for JSON values and null otherwise, so the browser can display numbers without JSON.parse/stringify coercion. Original Base64 remains the whitespace-preserving wire source.

### Retained projection into the original engine

POST /api/kafka/project
{
 "operation":"project-main-1",
 "captures":[{"id":"...","revision":7}],
 "view":"events",
 "decode":"json",
 "deletePolicy":"retain",
 "acceptIncomplete":false,
 "label":"Goldsky events"
}
view is events or latest-per-partition-key.
decode is json or bytes.
deletePolicy is retain, tombstone or tombstone-or-goldsky.
One projection selects 1–64 captures and at most 256 MiB of combined unique retained wire bytes. An active, source-changed or conflicting-source capture cannot be projected. Other incomplete capture selection requires acceptIncomplete=true and preserves exact coverage/state. The selected capture revisions and original message identities are frozen with the projection, so later capture continuation cannot alter an existing edition. Latest view chooses the largest offset for each exact topic UUID + partition + binary key; it does not invent cross-partition key ordering. A missing key must be resolved by choosing events.

Result:
{
 "id":"...","operation":"project-main-1","source":"<original-ndjson-source-id>",
 "sourceView":{},"selection":{...exact request...},"coverage":[...frozen capture records...],
 "records":120,"bytes":12345,"retainedBytes":23456,"excluded":0,"createdAt":"...",
 "defaultPlan":{...valid original stellar-forge.ndjson-mapping.v1 plan...}
}
GET /api/kafka/projection?id= returns the same record.
The derived NDJSON envelope contains eventId, partitionKeyId, clusterId, topicId, topic, partition, offset, offsetOrder, timestampType, timestampMs, leaderEpoch, keyBase64, valueBase64, headers, keyUtf8, valueState, value, parseError, goldskyOperation and deleted. Numeric metadata is encoded as exact decimal strings; offsetOrder is a 19-digit zero-padded offset usable by the original string sort. Original wire bytes remain the primary source.

Use the existing original mapping editor and /api/plan → /api/build → query/compare/merchant workflow on the returned source ID. State relates native builds to their Kafka projection by original build.source. The full original NDJSON UI is reused for those operations.

### Whole customer handoff

GET /api/kafka/export?build=<native-build-id>&projection=<projection-id> downloads kafka-project.zip containing the complete original native NDJSON project plus the selected Kafka connection references, native inspections, immutable source bytes, selected capture revisions and projection history. Manifest hashes bind all archive files and the original NDJSON source/plan/build identity.
POST /api/kafka/import accepts that raw ZIP and reconstructs the same retained source/projection and native original edition in a fresh private workspace. Reopening verifies original bytes and identities. Import does not contact a broker. Credential values are excluded; the receiver supplies the named private environment references to continue a capture.
The optional projection selector becomes required when several retained histories reconstruct identical source bytes. The seven root files are manifest.json, kafka.json, messages.jsonl, capture-revisions.jsonl, capture-members.jsonl, projection-events.jsonl and ndjson-project.zip. The transport limit is 6×256 MiB +32 MiB, with each JSONL≤256 MiB, metadata≤16 MiB, manifest≤16 KiB and the nested original project≤512 MiB. Before native reconstruction, receiving validates existing membership and checks the nested native manifest source-name SHA/build against the outer edition. The original receiver then owns all six-file validation and reconstruction.

The original /api/export and /api/dataset-export remain available for the standard native dataset outputs; /api/merchant remains the original seller/customer SDK operation. Kafka's whole-source archive is the adjacent source handoff.

## State

GET /api/state returns the original NDJSON state object plus:
kafka = {
 "schema":"stellar-forge.kafka-state.v1",
 "workspaceId":"<private-marker-UUID>",
 "client":client,
 "connections":[...latest connection revision records...],
 "inspections":[...retained inspections...],
 "captures":[...capture summaries including ranges and attempts...],
 "projections":[...projection records without sourceView/defaultPlan...],
 "activeCapture":null
}
History lists are newest first. Full source/inventory and defaultPlan are fetched with the projection/source routes; retained complete records are never replaced by list truncation.

## CLI and installed Applications

Original Node entry: kafka/cli.mjs selects --python first, then SF30_KAFKA_PYTHON, then SF30_XML_PYTHON, then python3 and launches this original cli.py; Node >=22.16 and Python >=3.11. Native consumer requirement: confluent-kafka==2.16.0, installed only when the operator enables native broker capture. File/project receiving and console open work without that optional dependency.

All commands begin:
python3 kafka/cli.py --workspace ABS_PRIVATE_WORKSPACE <command>
init, list, binding
connection --file JSON_REQUEST
inspect --file JSON_REQUEST
capture --file JSON_REQUEST
run --capture ID --expected-revision N (foreground same native capture)
cancel --capture ID --connection-file ORIGINAL_RUNNING_PRIVATE_FILE
messages --capture ID --offset 0 --limit 50
message --id ID
project --file JSON_REQUEST
source --file PATH --label LABEL
plan --file PATH
build --source ID --plan ID
query --build ID --params JSON
compare --before ID --after ID
changes --comparison ID --offset 0 --limit 50
export --build ID --projection ID --out NEW_ZIP
native-export --build ID --out NEW_ZIP
native-import --file ORIGINAL_NDJSON_ZIP
import --file ZIP
dataset --build ID --out NEW_DIRECTORY
merchant --build ID --payment PATH --origin HTTPS_ORIGIN --path ROUTE --out NEW_DIRECTORY
serve --port 0 --connection-file NEW_PRIVATE_FILE --expected-binding SHA --startup-format json

binding returns:
{
 "schema":"stellar-forge.kafka-managed-binding.v1",
 "workspace":"ABS","sourceRoot":"ABS_SF30","workspaceId":"UUID",
 "workspaceIdentity":{"device":"...","inode":"...","markerDevice":"...","markerInode":"...","markerSha256":"...","databaseDevice":"...","databaseInode":"...","kafkaMarkerDevice":"...","kafkaMarkerInode":"...","kafkaMarkerSha256":"...","kafkaDatabaseDevice":"...","kafkaDatabaseInode":"..."},
 "python":{"executable":"ABS","prefix":"...","basePrefix":"...","implementation":"cpython","version":[3,12,14]},
 "source":{"kafka/shared.py":"sha256", "...":"..."},
 "sha256":"..."
}
cancel verifies the original private connection file and current exact binding against /api/launch before posting to the running original /api/kafka/cancel. It takes no second workspace writer, never follows redirects, and uses direct loopback HTTP independent of proxy environment settings. Foreground run uses Event-only SIGINT/SIGTERM cleanup.

Source lists all eight Kafka native files, Kafka public assets, original NDJSON application/cli/managed/source/merchant/public assets, original XML source/workspace/server/native and dataset-handler. No mutable source data or broker status is included in the binding digest. sourceRoot is excluded from the digest so an exact managed source copy keeps the same binding. Python identity remains exact.

serve validates the binding before and after acquiring the original writer, then emits exactly one JSON startup record:
{
 "schema":"stellar-forge.kafka-workspace-launch.v1","status":"KAFKA_WORKSPACE_READY",
 "workspace":"ABS","workspaceId":"UUID","bindingSha256":"...",
 "sourceRoot":"ABS_SF30","python":{...},
 "pid":123,"console":"http://127.0.0.1:PORT/#PRIVATE_TOKEN",
 "connectionFile":"ABS_PRIVATE_FILE"
}
connectionFile is optional. GET /api/launch returns this same launch record. The private connection is published atomically and removed only when it still belongs to this original process. Stop closes the actual consumer worker before the original writer/database and server are released.

## First-party references

Goldsky Kafka sink: https://docs.goldsky.com/turbo-pipelines/sinks/kafka
Official native client: https://docs.confluent.io/platform/current/clients/confluent-kafka-python/html/index.html
Pinned release: https://github.com/confluentinc/confluent-kafka-python/releases/tag/v2.16.0
Apache consumer ordering/LSO semantics: https://kafka.apache.org/43/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html
Apache compaction semantics: https://kafka.apache.org/43/design/design/

The JSON decoder supports Goldsky JSON sinks; Avro bytes and schema-registry transport remain fully retained in bytes mode. Typed Avro schema-registry decoding is a separate explicit capability when implemented, not silently inferred from wire bytes.
