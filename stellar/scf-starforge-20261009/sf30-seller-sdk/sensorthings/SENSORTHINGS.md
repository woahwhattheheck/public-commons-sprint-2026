# SensorThings observation operations

The SensorThings workspace carries an actual OGC SensorThings source from discovery through retained observation editions, analyst interpretation, comparison, native dataset publication and customer receiving. It uses the existing SF30/SF82 seller, SF88/SF100 customer engines and their existing payment and recovery records.

The Operations Desk and managed Applications launch are the browser interface to this same writer. The CLI, merchant MCP provider and authenticated local listener expose the same actions and persistent workspace UUID. A running browser application and a second direct CLI writer cannot own the same workspace simultaneously; use the connection tools when the application is running.

## What the source means

The implementation reads [OGC SensorThings API Part 1: Sensing 1.1, OGC 18-088](https://docs.ogc.org/is/18-088/18-088.html). It retains the response representation it actually received. These are operationally significant distinctions:

| Source feature | Retained meaning |
|---|---|
| Service and collection links | Select advertised collections and original entity/navigation URLs inside the configured service root. |
| `@iot.nextLink` | Follow the actual continuation URL, including its opaque query, rather than constructing an inferred page. The standard defines paging in section 9.3.3.6. |
| `@iot.count` and `$top` | The original count and query remain separate from received row counts. A selected top-N query is not the full history. |
| Entity identifiers | String and numeric identifiers retain their type. Exact numeric tokens are preserved; no floating-point identifier rounding is used. |
| `result` | Distinguish missing, null and supplied values, including an empty string. Numbers, categories, booleans, arrays and objects retain their original type. |
| `phenomenonTime` | The source’s observation time or interval, separate from result availability and validity. |
| `resultTime`, `validTime` | Retain the source’s distinct time concepts and original text. |
| UTC columns | Normalize only supported, explicitly offset calendar instants. Preserve unresolved durations, interval forms, leap seconds and excess precision as source values. |
| `resultQuality`, `parameters` | Retain original values without assigning a quality, approval, calibration or completeness interpretation that the source does not establish. |
| Units and observed properties | Preserve the stream declaration and complete associated property entities; do not infer unit conversion or equivalence from names. |
| MultiDatastream results | Retain component array order. Bind each component to a unit, property and observation type only when the actual metadata arrays align. |
| FeatureOfInterest and Thing | Preserve both distinct concepts and their original source references. A Thing location is not silently substituted for a FeatureOfInterest. |
| Historical locations | The plan explicitly includes or excludes that graph; the resulting source scope records the choice. |
| Before/after stream metadata | Retain both observations of stream meaning. Changed metadata creates an issue; it does not establish an atomic snapshot. |

The complete response body is the application body returned after HTTP content decoding. Original request/response receipts retain request URL, request time, response status, selected response headers, source body byte count and SHA256. Credentials are supplied by host environment references, not by action payload values. Provider GETs do not automatically follow redirects or retry failed requests.

All normalized CSV columns are strings so the original numeric token can survive an exact exchange. Separate type and presence columns describe what that token means. JSON bodies and source pointers travel with the dataset.

A completed capture means the selected query and declared relationship traversal reached their retained terminal links within the selected limits. It is not an atomic provider snapshot, a claim that all history is present, a provider quality approval, or a measure of station uptime.

## Source and application modules

| File | Responsibility |
|---|---|
| `schema.mjs` | Pure workspace/action and source semantics metadata. |
| `contract.mjs` | Exact source JSON, identifiers, query/link validation, value and time representation. |
| `provider.mjs` | Original request attempts and complete HTTP response custody. |
| `domain.mjs` | Observation/component/entity projection, summaries and source-edition comparison. |
| `dataset.mjs` | Complete source-linked CSV package and original SF30/SF82/SF88 delegation. |
| `core.mjs` | Existing kernel store, persistent operations, capture/resume, review and all native operating actions. |
| `portable.mjs` | Complete immutable source-edition handover and same-store receiving. |
| `files.mjs` | Original manifest selections and bounded held-file reads. |
| `server.mjs` | Same-workspace authenticated loopback API and complete/ranged HTTP file delivery. |
| `mcp-protocol.mjs`, `mcp.mjs` | Pure merchant tool catalogue and original running-workspace connection. |
| `merchant-provider.mjs`, `setup.mjs` | Source-owned lazy provider and normal merchant installation/configuration. |
| `download.mjs` | Native file-set adapter for the existing resumable retained downloader. |
| `cli.mjs` | Direct operations, original listener connection and full file receiving. |
| `capture-hamburg.mjs` | Fixed first real Hamburg source-discovery/capture operation. |
| `desk/` and the managed application leaves | Maintained browser/Applications interface from the existing desk owner. |

Use the normal complete SDK distribution and its installed dependencies. Source capture uses the original Node runtime with `JSON.rawJSON` support (Node 22.16 or later) and the existing Linux/Python lease support. The complete receiver also uses the original retained downloader’s Linux flock lease. Dataset and seller/customer operations use the existing installed native SDK components; this source adds no second query, seller, payment or scheduler engine.

See [DISTRIBUTION.md](DISTRIBUTION.md) for the source-owned setup and normal distribution contribution, and [RECEIVING.md](RECEIVING.md) for the complete source archive, exact selectors, held-file verification and recovery contract.

## Start or connect to the original workspace

For a new local operator workspace, or the same closed workspace after restart:

```sh
node sensorthings/cli.mjs serve \
  --workspace /absolute/private/sensorthings-workspace \
  --port 0 \
  --session-file /absolute/private/operator/sensorthings.url \
  --source-inbox /absolute/private/source-inbox \
  --buyer-workspace /absolute/private/original-sf88-workspace
```

Run the command from the SDK directory, or use its normal installed command alias. The session-file parent is an existing private directory. The source inbox holds host-selected source-transfer archives; the buyer workspace is the existing SF88 customer journal. They are separate responsibilities and neither is accepted as an arbitrary browser/MCP path.

The native startup record contains the actual workspace UUID, selected origin, private URL, process ID and startup schema `stellar-forge.sensorthings-workspace-startup.v1`. The URL fragment contains the session token. Keep that record in the original local operator or managed Applications custody. The persistent session token remains bound to the same workspace. Reopening on another ephemeral port updates only the same private session reference.

The low-level listener serves an API shell; the maintained Operations Desk supplies the actual browser assets through `staticHandler(req,res,{url,workspaceId})`. The handler does not receive the token as an argument. The managed application owns its launch/stop and URL record, and passes the original workspace into this listener.

A private connection file has this shape:

```json
{
  "schema": "stellar-forge.sensorthings-workspace-connection.v1",
  "workspaces": {
    "observations": {
      "label": "Original observation workspace",
      "workspaceId": "COPY_THE_ACTUAL_PERSISTENT_WORKSPACE_UUID",
      "consoleUrlFile": "./sensorthings.url"
    }
  }
}
```

The UUID placeholder must be replaced with the actual native startup identity. Each alias chooses exactly one `consoleUrlFile`, `consoleUrlEnv` or `applicationUrlFile`. File references are resolved relative to the connection file. An Applications URL record retains `url` plus `original.schema` and `original.workspaceId` from its original startup record.

Inspect through the running original writer:

```sh
node sensorthings/cli.mjs connect \
  --config /absolute/private/operator/connection.json \
  --alias observations \
  --tool merchant_sensorthings_schema

node sensorthings/cli.mjs connect \
  --config /absolute/private/operator/connection.json \
  --alias observations \
  --tool merchant_sensorthings_view
```

A direct `schema`, `view`, `catalog`, `edition`, `summary`, `rows`, `capture`, `operation`, `release` or `publisher` command opens the original store lease only while that process runs. Use those commands on a closed workspace. Never launch a second listener to work around an occupied lease.

## Complete source-to-customer operation

### 1. Register the actual source and licence

Use `source.add` with the original HTTPS service root, an operator label, explicit source/attribution/licence references, optional host authorization environment name, request timeout and per-page capacity. Registration itself does not invent a stream or fetch a tenant catalogue.

For the retained public Hamburg source, the publisher’s [charging station metadata edition](https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36) identifies the [Hamburg SensorThings service](https://iot.hamburg.de/v1.1/) and [Datenlizenz Deutschland Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). That dated metadata is source evidence; a later provider or licence revision must be retained as new evidence.

The fixed Hamburg driver uses the published serviceName `HH_STA_E-Ladestationen` and layerName `Status_E-Ladepunkt`. It selects the first member of the actual returned catalogue. It does not assume the tutorial’s sample station or datastream identifiers are current.

### 2. Discover and select actual catalogue members

`catalog.capture` receives the service root and one original Datastreams or MultiDatastreams page. A query may contain `filter`, `orderBy`, `top` and `count`.

Read catalogue rows with their exact catalogue ID and `/value/N` source pointer. If the returned catalogue has `next`, continue with a new explicit catalogue action whose `previousCatalogId` is that exact prior page. Keep the same source and kind, omit a replacement query, and use the returned original continuation. Catalogue pages remain separate original received editions.

`plan.create` selects 1–64 actual members as `{catalogId,pointer}`. Its observation query accepts `filter`, `orderBy`, `top`, `count` and `expandFeatureOfInterest`. The plan also records `includeHistoricalLocations`, a total request ceiling and a complete capture-byte ceiling. These fields are immutable once that plan is saved.

### 3. Capture the selected query and graph

`capture.start` uses the plan ID and a bounded request batch. `capture.resume` advances that same retained queue. Each original HTTP attempt is persisted before dispatch, and its successful response body and receipt are bound before a page is adopted.

The capture follows original observation continuation links and declared relationship links. It retains beginning and ending stream metadata. Source response bodies, query selection, entity definitions and graph scope remain complete even where a row cannot be normalized.

A paused or interrupted capture retains its existing identity. A failed request requires the operator’s explicit `retryFailed:true` choice before another GET attempt. A permanently reached plan capacity cannot be widened under that immutable plan; preserve/review its partial source or select a new declared scope.

`capture.pause` aborts this existing capture and retains the attempted request state. `capture.seal` requires an explicit reason and `allowPartial:true` when accepting a partial traversal as an immutable edition.

For a direct CLI `capture.start` or `capture.resume` action, the command waits for its own bounded batch before closing the writer. The returned capture can be COMPLETE, paused, interrupted or failed; the command does not automatically launch further batches to hide a source error or exceeded limit.

### 4. Extend an initial actual sample into a useful delivery

The fixed Hamburg source operation first requests the latest twelve actual observations so the selected stream, response representation and entity graph are established. That initial sample is not the whole operating acceptance.

Use the returned original observation times and provider semantics to choose a useful, explicit time window for the same stream. Save the new exact query and finite request/byte limits as a plan. Traverse every returned continuation in that declared window. Retain a second actually observed edition of the same fixed selection, with its later request dates and metadata. The comparison then distinguishes unchanged rows, changed rows, one-sided observed sets and ambiguous duplicates.

Do not move the window silently between editions, infer missing periods from a top-N result, or label categorical status observations as measured availability. If no complete window can be received within the selected source service limits, the partial source and its actual limitation remain the delivered evidence.

### 5. Review source meaning before dataset/publication

The edition summary reports received rows, result types, missing/null/value states, supported/unresolved time forms, source issues, duplicate identifiers and changed duplicates. Review those with their source pointers and exact original bodies.

`edition.review` requires:

```json
{
  "editionId": "ACTUAL_EDITION_SHA256",
  "decision": "accept",
  "actor": "Actual responsible reviewer",
  "note": "Actual interpretation and intended use of this exact received source.",
  "acknowledgeIssues": ["ACTUAL_REQUIRED_ISSUE_CODES"]
}
```

Use the actual required issue codes from that edition’s summary; the placeholders are not an executable approval. Decisions are `accept`, `reject` or `follow_up`. The latest accepted review is bound to dataset and release preparation and rechecked before the operation completes. A receiving operator’s acceptance is an operational decision about this edition, not provider quality certification.

`edition.compare` retains complete `comparison.json` and `changes.jsonl`. An observation seen only on one side is labeled as such; it is not asserted to have been inserted or deleted by the provider. Duplicate occurrences remain ambiguous, rather than being silently deduplicated.

### 6. Prepare/query the original native dataset

`dataset.prepare` binds the accepted edition and selected table: `observations`, `components` or `entities`. It writes the complete original CSV, dataset configuration, source manifest, source/edition/review/semantics provenance and native dataset receipt.

The native limit is 250,000 rows, 256 MiB per table and 65,536 characters per cell. A source that exceeds those limits remains retained; no truncation is presented as a complete export. Select a declared source scope that can be delivered through the existing dataset engine.

`dataset.query` calls the original native query implementation. Dataset filters and range/sort columns are declared in its retained configuration. Exact numeric source tokens remain strings and are never silently converted to approximate numeric SQL values.

### 7. Prepare and operate the original seller/customer flow

`release.prepare` delegates to the native release builder with the selected dataset, origin/path and explicit original payment configuration. `release.activate`, `release.rollback`, `release.start` and `release.stop` use the existing generation and publisher lifecycle.

Keep `release.start` in the running original listener. A one-shot direct CLI command would close that owned process on exit, so the CLI directs it through the existing connection instead.

The source-owned publisher actions are the original `publisher.buyer.review`, `prepare`, `session`, `run`, `recover`, `account` and `export`. Their original fields are advertised by the schema. The host binds the existing SF88 buyer workspace when creating the listener; the browser/MCP does not choose a new journal path.

`buyer.inspect` and `buyer.receive` adopt the exact existing intent IDs through the original customer engine. The complete receiving files are its native CSV, JSONL, review HTML, delivery receipt and dataset manifest. No new payment signature, reservation or paid outcome is inferred by this adapter.

### 8. Transfer source and deliver complete original files

`edition.export` freezes the original edition, complete source objects and selected original review history into the bounded source archive. `edition.import` selects one host-inbox filename plus exact complete SHA256 and byte count. The importer validates the full declared closure before linking source objects into the existing content-addressed store.

An import does not copy an original review into the receiving operator’s review list. For an already-known edition, the current local review and publication history remain intact; the new receiving event is retained separately. Source receiving does not duplicate unfinished source operations, seller state or payment journals.

The `files` selection lists actual complete byte/hash identities for source, edition, dataset, comparison, transfer, buyer and publisher members. See [RECEIVING.md](RECEIVING.md) for every exact selector.

For a complete native customer file set, create a selection JSON using the actual received buyer ID:

```json
{"kind":"buyer","id":"ACTUAL_NATIVE_BUYER_RECEIPT_ID"}
```

Then inspect and receive that same selection:

```sh
node sensorthings/cli.mjs inspect-download \
  --config /absolute/private/operator/connection.json \
  --alias observations \
  --selection /absolute/private/operator/buyer-selection.json

node sensorthings/cli.mjs download \
  --config /absolute/private/operator/connection.json \
  --alias observations \
  --selection /absolute/private/operator/buyer-selection.json \
  --directory /absolute/private/customer-receiving \
  --progress
```

Optionally supply the actual `--expected-manifest-sha256` and `--export-id` from inspection. The receiving manifest is explicitly labeled `CLIENT_BOUND_NATIVE_FILE_SET`: it records the client’s exact selections and local names. It does not pretend to be a provider-generated manifest. Every original file remains byte-identical, with its original name, native selection, SHA256 and size in that receiving manifest.

The existing retained downloader owns its flock, verified partial prefixes, checkpoint, held-read recovery, create-only final files and complete SHA256 checks. Rerun the same command, directory and selection after interruption. An expired read can reopen only the same selected file, SHA and byte offset. A changed source list or manifest fails explicitly rather than replacing an earlier delivery.

A generated publisher `draft-review` is different: the original publisher creates its process-local metadata snapshot on the first read. Its list item initially has null bytes/SHA. Use `file_read` for that snapshot. The complete fixed-file downloader requires immutable file identities and will identify an unmaterialized draft review instead of inventing a hash.

## Action and HTTP contracts

Every action uses:

```json
{
  "operationId": "ONE_STABLE_ORIGINAL_OPERATION_ID",
  "expectedRevision": 0,
  "action": "source.add",
  "payload": {}
}
```

This is the envelope shape; use the actual current revision and complete action-specific payload. Operation IDs use 8–100 letters, digits, underscores or hyphens. The same ID with different payload is a conflict. A completed same request reopens its original result. A failed operation stays failed; inspect its original outcome before choosing a new explicit action. Source capture continuation uses its existing capture ID and the documented resume action.

Read the schema for exact action fields; the CLI, browser and MCP all consume that same declaration.

| Endpoint | Result |
|---|---|
| `GET /api/schema` | Workspace UUID, source semantics, tables and action fields. |
| `GET /api/view` | Current revision and operating summary. |
| `GET /api/catalogs/:id/rows` | Exact retained catalogue rows with offset/limit. |
| `GET /api/editions/:id/metadata` | Complete immutable edition. |
| `GET /api/editions/:id/summary` | Source/result/time/quality interpretation counts. |
| `GET /api/editions/:id/rows` | One normalized table page. |
| `GET /api/captures/:id` | Original capture/attempt state. |
| `GET /api/operations/:id` | Original journal outcome, including a completed result after a lost reply. |
| `GET /api/releases/:id` | Original native release. |
| `GET /api/publishers/:datasetId` | Original publisher/customer state. |
| `POST /api/action` | The original retained action envelope. |
| `GET /api/files?selection=...` | Original native file metadata. |
| `POST /api/files/read` | One bounded same-file descriptor read. |
| `POST /api/files/release` | Close one owned read. |
| `GET /api/files/download?selection=...&expectedSha256=...` | Complete HTTP file or one original byte range. |

All API routes use the private Bearer token. Requests after schema also bind `X-SensorThings-Workspace` to the original persistent UUID. The listener validates the exact Host and any supplied Origin. It binds only explicit loopback addresses.

The HTTP download verifies the original full hash through one held descriptor before sending successful response headers, then reads that same descriptor in bounded chunks. It supports full 200 delivery, a single 206 range, suffix ranges, ETag/If-Range, and 416 for an invalid range. Closing the connection releases its read. File selectors expose no host paths.

The JSON API caps request bodies at 2 MiB and responses at 24 MiB. Use row pages or complete file transfer for large retained source/results. An oversized completed action reply does not mean the original action was absent; reconcile its operation ID.

## MCP and lost replies

The merchant tools attach to the running original listener. Each connection checks its actual schema and UUID before operating. The pure tool catalogue adds fourteen tools for aliases, schema, view, catalogue, edition, rows, capture, release, publisher, operation, action, files, file_read and file_release.

MCP action requests are sent once. If transport loses the reply, `MCP_OUTCOME_UNCERTAIN` carries the original operation ID. Read that operation through the same workspace and keep its exact payload. Do not generate a new ID merely because the caller timed out.

A held-file read ID belongs to the native client instance and selected file/SHA. A one-shot CLI connection closes its owned read on exit; the returned receipt preserves what was read, and the next invocation resumes the same selector/SHA/offset without that expired ID. The complete downloader keeps one client for the whole transfer and uses the original receiver’s persistent checkpoint across process restarts.

## Native acceptance and evidence

The complete operating acceptance is one joined actual-source journey:

1. Receive real provider catalogue/observation/entity responses with original body/header/request identities.
2. Finish a useful declared source window and retain a second actually observed edition.
3. Inspect rows, source meaning and differences in the maintained desk; save the actual reviewer’s decision.
4. Prepare/query the original dataset and run the selected native seller/customer flow with its original budget and accounting.
5. Receive complete original files, interrupt/resume one delivery where needed, and reopen the same workspace and original identities.
6. Export/import the complete source closure into a separate receiving workspace, preserving the source edition and original review evidence while making any local review explicit.

Source publication, a metadata response, a syntax check and an actual end-to-end receiving operation are separate evidence. This guide does not assert that a tenant capture, real Hamburg request, browser journey, seller process or customer delivery has run merely because these files exist. Keep the actual native receipts and returned source package with the corresponding operation.

## Primary references

- [OGC SensorThings API Part 1 Sensing 1.1](https://docs.ogc.org/is/18-088/18-088.html): observation/entity model, collection queries and continuation semantics.
- [Hamburg original service](https://iot.hamburg.de/v1.1/): actual discovery/capture endpoint.
- [Hamburg charging-station dataset metadata edition](https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36): published service/layer and attribution context.
- [Hamburg Urban Data Platform API tutorial](https://www.urbandataplatform.hamburg/resource/blob/1049030/4753b7e3cec4a6ea9497f0bd734ecc7a/d-tutorial-udp-ueber-apis-anzapfen-data.pdf): published source-use examples; example IDs are not current capture identities.
- [Datenlizenz Deutschland Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0): original linked licence.
- [FROST publisher getting-data guide](https://fraunhoferiosb.github.io/FROST-Server/sensorthingsapi/3_GettingData.html): source implementation query examples.

The retained OGC source bytes, native SDK implementation and actual provider receipts take precedence over convenience examples or an inferred provider convention.
