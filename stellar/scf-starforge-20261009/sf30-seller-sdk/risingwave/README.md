# RisingWave: retained streaming datasets

This source connects a reviewed RisingWave table or materialized view to the original Starforge dataset publisher. It preserves the native subscription events, a durable keyed mirror, a complete materialized edition, the native cursor barrier, and the existing publisher's review, immutable versions, recurring schedule, seller and buyer handoff.

The cursor protocol is pinned to **RisingWave3.1.0**, source [45baf646](https://github.com/risingwavelabs/risingwave/tree/45baf6460ea942e4ff57a5aa057d5b8db7f3b563). Use Node 22.16 or later and the maintained runtime's pinned public `pg` 8.16.3 dependency. The complete merchant workbench also uses the maintained native x402 peers. Start from the installed Starforge source and runtime; the commands below are relative to `sf30-seller-sdk/risingwave/`.

## Save a private source

Use a private directory and mode0600 for source files. Keep the connection URL in the named environment variable:

```sh
mkdir -m 700 /absolute/risingwave-case
export RISINGWAVE_URL='postgresql://reader:YOUR_PASSWORD@your-host:4566/dev'
node cli.mjs inspect --source /absolute/risingwave-case/source.json
```

A declarative source contains environment references and reviewed native identities:

```json
{
  "schema": "stellar-forge.risingwave-source.v1",
  "connectionStringEnv": "RISINGWAVE_URL",
  "tls": "require",
  "maxInFlight": 1,
  "queryTimeoutMs": 30000,
  "queries": {
    "eligible": {
      "relation": {
        "schema": "public",
        "name": "projects"
      },
      "subscription": {
        "schema": "public",
        "name": "projects_feed"
      },
      "key": [
        "id"
      ],
      "columns": {
        "id": {
          "column": "project_id",
          "type": "bigint",
          "nullable": false
        },
        "units": {
          "column": "units",
          "type": "integer",
          "nullable": false
        },
        "note": {
          "column": "note",
          "type": "string",
          "nullable": true
        }
      },
      "parameters": {
        "minimum": {
          "type": "integer",
          "min": 0,
          "required": true
        }
      },
      "filters": [
        {
          "column": "units",
          "op": "gte",
          "parameter": "minimum"
        }
      ],
      "probe": {
        "minimum": 20
      },
      "maxRows": 100,
      "maxBytes": 1048576
    }
  }
}
```

An empty `queries:{}` is accepted for catalogue discovery before report authoring. TLS verifies the server. A private CA can be referenced through `caFileEnv`. Plain PGwire requires `tls:'disable',allowLocal:true` and an actual loopback host. Connection URL query overrides are rejected so the saved TLS policy remains authoritative.

```sh
node cli.mjs discover --source /absolute/risingwave-case/source.json
node cli.mjs query --source /absolute/risingwave-case/source.json --query eligible --input /absolute/risingwave-case/parameters.json
```

The query command is a bounded live preview. Its `truncated` field explicitly reports the row limit. Complete captures use separate budgets and never report a capped set as a complete edition.

## Review the native subscription

Discovery and inspection read the actual catalogues. Creation is a separate reviewed native mutation:

```sh
node cli.mjs subscription-inspect --source /absolute/risingwave-case/source.json --query eligible
node cli.mjs subscription-review --source /absolute/risingwave-case/source.json --query eligible --request reviewed-feed-v1 --retention '1 day' --out /absolute/risingwave-case/subscription-review.json
node cli.mjs subscription-create --source /absolute/risingwave-case/source.json --review /absolute/risingwave-case/subscription-review.json --request reviewed-feed-v1 --directory /absolute/risingwave-case/subscription-operation
```

The review binds the relation's ID, definition and complete column inventory, the exact subscription name, normalized positive retention, source bytes and request ID. Reusing the same request recovers its retained result or inspects the original native subscription after an interrupted response. A subscription that existed during review must retain the same native ID. An existing subscription with another retention or source requires a fresh explicit operator decision.

The source account needs native SELECT access; creation also needs native CREATE authority in the selected schema. Existing subscriptions can be consumed with the approved source account. The product does not invent PostgreSQL-style subscription grants.

## Capture, resume and inspect

```sh
node cli.mjs capture --source /absolute/risingwave-case/source.json --query eligible --input /absolute/risingwave-case/parameters.json --directory /absolute/risingwave-case/edition-1
node cli.mjs capture-read --directory /absolute/risingwave-case/edition-1
node cli.mjs capture --source /absolute/risingwave-case/source.json --query eligible --input /absolute/risingwave-case/parameters.json --base /absolute/risingwave-case/edition-1 --directory /absolute/risingwave-case/edition-2
node cli.mjs resume --source /absolute/risingwave-case/source.json --directory /absolute/risingwave-case/edition-2
```

An optional extraction JSON controls:

| Field | Default | Meaning |
|---|---:|---|
| mode | auto | FULL initially; inclusive changes from a usable complete base |
| onGap | error | Preserve the base and show the gap; explicit rebuild starts a new FULL attempt |
| maxRows | 1000000 | Complete raw mirror before report filters |
| maxBytes | 268435456 | Aggregate complete artifact budget |
| maxRowBytes | 1048576 | Each raw event and projected JSON row |
| batchSize | 1000 | Native FETCH count,1–10000 |
| timeoutSeconds | 1 | Native FETCH wait,0–30seconds |
| maxDurationMs | 300000 | Attempt time budget; reaching it preserves an incomplete attempt |

The original publisher console's `timeoutMs` is accepted as an alias for maxDurationMs. If both are supplied they must agree. A timeout or short batch never certifies completion.

A capture directory retains these seven complete files:

| File | Contents |
|---|---|
| data.json | Typed report envelope and every selected row |
| data.ndjson | Every selected row, one JSON object per line |
| data.csv | Canonical UTF-8 dataset; NULL is unquoted empty and empty text is quoted empty |
| events.ndjson | Native session, FETCH responses, all raw columns, replay evidence and barrier |
| checkpoint.json | Exact native cursor state, last timestamp, replay boundary and counts |
| state.sqlite | Closed complete mirror, original raw values, inclusive replay boundary |
| capture.json | Source/query/input identity, native catalogue, lineage and hashes of the other files |

The returned files map adds the manifest's own size and SHA256. `readRisingWaveCapture` verifies all files and checks the closed mirror against its checkpoint. The directory remains useful offline. Keep earlier base editions to follow the complete event lineage; each later edition also contains its own complete mirror and materialized rows.

An interrupted attempt keeps progress.json, the original intent, raw events, SQLite state and attempt history. `source.resumeCapture(directory,{signal,onProgress})` uses the same source/query/input/base/budgets and original ID. A completed mirror can finish file materialization without reopening the database. An initial FULL without an unambiguous change checkpoint is archived inside the same operation before a fresh FULL attempt. No partial snapshot becomes a published edition.

## Native completion and replay

The implementation follows the exact3.1.0 [cursor state machine](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/session/cursor_manager.rs). FULL pins the committed epoch at DECLARE and emits Insert rows with NULL timestamps. `SHOW SUBSCRIPTION CURSORS` exposes the native state. The capture matches its own random cursor, session, authenticated user, database, subscription and worker, retaining the original status row.

Completion requires an actual zero-row FETCH, the native InitLogStoreQuery state, unchanged returned fields and catalogue identities, all expected replay events and balanced complete change deltas. A state transition after snapshot EOF supplies the authoritative barrier even when no live row has arrived. Cached-row counts, elapsed waits and short batches are insufficient.

SINCE includes its boundary timestamp. The mirror keeps every exact event at that boundary and validates replay by per-key event multiplicity. It never deduplicates by global row position. Raw before/after deltas are applied at a complete timestamp or native EOF, allowing a reviewed visible key to differ from the storage primary key and allowing key changes or swaps. Unmatched before images, duplicate complete keys, missing replay events and native retention errors preserve the previous complete edition for review.

A quiet FULL has no usable incremental timestamp. Its complete snapshot remains valid; a following auto capture takes another FULL. The capture does not manufacture a SINCE timestamp from wall-clock time. A checkpoint resumes incrementally only after a live timestamp later than the pinned snapshot millisecond.

Filters run after the complete raw keyed state is updated. An update can move a row into or out of the selected report without losing its before image. All native columns, including unselected ones, stay in the mirror and event log. The reviewed key must consist of visible, non-null scalar source columns and be unique at every complete edition.

## Exact values and report semantics

PGwire text is retained before any projection. bigint, decimal, timestamp, timestamptz, date, time, interval, UUID, JSON and bytea outputs stay strings. Safe integer outputs become JavaScript integers; native floating outputs become finite JavaScript numbers. Choose string output for nonfinite floats or native values requiring their original textual representation. Native NULL remains JSON null.

Timestamp comparisons preserve microseconds and explicit timezone offsets. Decimal and integer comparisons use exact coefficients. Text comparison uses UTF-8 byte order. Supported filters are eq/ne/lt/lte/gt/gte/in/notIn/isNull/isNotNull. Array filters use declared array parameters. Missing optional parameters disable their filters; explicit NULL retains SQL-null behavior. JSON, interval and bytea support null predicates rather than an invented ordering.

CSV publication carries the original loader's explicit `nullEncoding:'unquoted-empty'` option. Exact numeric or temporal strings default to dataset text. A requested dataset numeric conversion must preserve its value and safe integer range; otherwise the candidate is refused before publication.

## Publish and run recurring refresh

```sh
node publisher/cli.mjs init --workspace /absolute/risingwave-case/publisher --source /absolute/risingwave-case/source.json --state /absolute/risingwave-case/dataset
node publisher/cli.mjs template --workspace /absolute/risingwave-case/publisher --query eligible --out /absolute/risingwave-case/plan.json
node publisher/cli.mjs save --workspace /absolute/risingwave-case/publisher --input /absolute/risingwave-case/plan.json
node publisher/cli.mjs extract --workspace /absolute/risingwave-case/publisher --plan 1
node publisher/cli.mjs inspect --workspace /absolute/risingwave-case/publisher --run RUN_ID
node publisher/cli.mjs review --workspace /absolute/risingwave-case/publisher --run RUN_ID --initialize --reviewer OPERATOR --note 'Reviewed the complete native edition and retained sources.'
node publisher/cli.mjs publish --workspace /absolute/risingwave-case/publisher --run RUN_ID --review REVIEW_ID
```

Use the complete workbench to configure the original native versioned seller, exact payment choices and snapshot-pinned buyer. The original generic publisher's serve, schedule-save, schedule-enable, schedule-run, schedule-pause and schedule-continue commands remain the only policy engine. A publication review binds the exact candidate and current target snapshot/revision. The source adapter retains complete extraction history and automatically selects its latest complete mirror for the next incremental read.

Stop the owning workbench or publisher before opening its private workspace through another process. Back up the complete closed workspace together with all source-capture directories and protected environment references. Reopen uses the retained source revisions, subscription request IDs, plans, versions, schedule and buyer configurations.

## Source-native receiving

The complete operator is [examples/native-demo.mjs](examples/native-demo.mjs). It uses an existing authorized RisingWave 3.1.0 server and one real original JSON source file. The input can be a top-level array or a named top-level array such as `/records`. It preserves the complete file, each original row's exact JSON text and SHA256, and the unchanged source fields. Use 64–10000 records and the SHA256 of the actual original file.

Run it from this RisingWave source directory:

```sh
node examples/native-demo.mjs \
  --directory /absolute/risingwave-native-case \
  --input /absolute/original-documents.json \
  --input-sha ORIGINAL_FILE_SHA256 \
  --source-url https://source.example/original-documents.json \
  --records-pointer /records \
  --connection-env RISINGWAVE_URL \
  --tls require \
  --initialize \
  --source-pin COMMITTED_PRODUCT_SOURCE
```

The supplied source URL is the actual acquisition reference. The operator reads the separately retained input file; it does not substitute a fresh response for those bytes. The source pin is the full 40-character commit of the selected product. Pass an empty records pointer for a top-level JSON array. A local approved server can instead use `--allow-local --tls disable` with an actual loopback connection URL. The runtime's `pg` dependency and the original x402 peers must be installed before execution.

`--initialize` authorizes the operation's own named schema, source tables and the two saved native subscription reviews. It does not install or start a server. The initial main subscription retains one day of changes; a separate eight-row source subset uses a 30-second subscription to demonstrate the actual expired-checkpoint response and explicit full rebuild. Every row in that smaller relation comes from the same original input.

The native operation describes its technical fields in case.json. The native storage key is the original row position. A reviewed visible BIGINT key deliberately exceeds JavaScript's safe integer range and differs from that storage key. Priority and inclusion are operator review metadata; a deterministic DECIMAL field and native timestamp exercise exact serialization. Native key swaps, membership changes and a delete/reinsert modify only those operation-owned tables. Original document text and hashes remain intact.

The operator performs the complete original product flow:

1. Open the queryless workbench, discover its actual native relations, save the typed reports and consume the saved subscription reviews with stable request IDs.
2. Read a bounded live preview and a typed array parameter selection, then retain a complete quiet FULL with its actual native EOF/status barrier. The quiet edition records `resumeAvailable:false`; an explicit changes request from that checkpoint retains the native source refusal.
3. Interrupt the initial FULL after actual snapshot rows, resume the same capture ID, retain the incomplete attempt, and observe a controlled native change after the resumed cursor begins. The resulting complete edition has a usable inclusive change checkpoint.
4. Publish the first complete edition through the workbench's original publisher. Apply the recorded native key, membership and delete/insert operations, then interrupt and resume the same incremental capture while retaining exact replay evidence.
5. Compare every materialized row between the two complete editions and receive all four difference files plus all seven files for both original captures. Publish the second edition through the same publisher and versioned seller.
6. Use the original x402 buyer against the retained first snapshot, preserving both payment choices, the exact amount and extras. The receiving case uses disposable local signer/facilitator adapters and records the actual HTTP, verify and settle counts. The original SDK, seller and buyer handle the request.
7. Enable and execute the existing recurring policy, observe its actual unchanged-source result, retain a real retention-gap response, and rebuild that explicitly selected small source while preserving its complete prior edition.
8. Open the actual MCP stdio process, inspect its dynamic tool catalogue and original capture resources, then close and reopen the same workbench in a separate process. The original publication, both editions, seller intent and enabled schedule remain bound.

The final case contains journey-result.json, the original workbench, source-input.json, source.json, merchant.json, native-commands.ndjson, every retained capture and comparison, complete receiving directories, the buyer preparation/delivery and fresh-process reopen result. Native command records retain statement, parameters or original-source references, response fields and exact response hashes. Each attempt has its own immutable result under attempts/.

Reusing the same case directory verifies its original input and connection-reference declaration, resumes incomplete captures, and keeps completed native mutation outcomes. Final results are saved before the case lease is released. A completed original buyer delivery repairs a lost local response without dispatching again; a previously dispatched request lacking its complete delivery is retained for reconciliation with its original buyer and seller IDs.

For a browser or an installed Applications receiving operation, import:

```js
import { runRisingWaveNativeJourney } from './examples/native-demo.mjs';

await runRisingWaveNativeJourney({
  directory,
  inputFile,
  inputSha256,
  sourceUrl,
  recordsPointer: '/records',
  connectionStringEnv: 'RISINGWAVE_URL',
  sourcePin,
  initialize: true,
  environment: process.env,
  async onOpen({ session, client, context, progress }) {
    // Drive the same original workbench before the operator closes it.
    // context supplies original capture, comparison, publication and run IDs.
  },
});
```

The callback is awaited and shares the live caller's original private server and model. Complete any browser actions before returning. The operator then closes the original service and verifies a fresh-process reopen. When adopting an already completed case, use its returned original context with the maintained Applications host; its lifecycle owns the reopened service.

Interrupted event tails are also preserved. When a process stops between an event append and its durable mirror offset, event-recovery.json binds the exact uncommitted byte range. A private raw copy retains those bytes, and deterministic base64 recovery frames embed them in the existing events.ndjson. The mirror offset and recovery ID commit together before normal appending resumes. The manifest's eventRecoveries list binds every current recovery; the standard seven-file receiving path therefore retains those exact bytes. Restarting an incomplete FULL archives its corresponding event log, raw recovery copies, journal and receipts together.

Primary references: [subscription guide](https://docs.risingwave.com/serve/subscription), [standalone operation](https://docs.risingwave.com/operate/rw-standalone-mode), [pinned DECLARE handler](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/declare_cursor.rs), [pinned FETCH handler](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/fetch_cursor.rs), [cursor status](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/show.rs), [FLUSH visibility](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/flush.rs), and [native change-log semantics](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/storage/src/hummock/iterator/change_log.rs).

## Continue through installed Applications

Use the complete [Applications receiving operator](MANAGED_WORKBENCH.md) after this
native case has completed and released its workbench. It adopts the same source,
publication, captures and original buyer, receives both complete editions and all
differences through the selected MCP runtime, then stops and reopens the same
saved application in a second managed process. The original native database and
retained environment references remain available throughout that lifecycle.
