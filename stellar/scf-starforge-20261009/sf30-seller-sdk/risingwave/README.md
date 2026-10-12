# RisingWave: retained streaming datasets

This source connects a reviewed RisingWave table or materialized view to the original Starforge dataset publisher. It preserves the native subscription events, a durable keyed mirror, a complete materialized edition, the native cursor barrier, and the existing publisher's review, immutable versions, recurring schedule, seller and buyer handoff.

The cursor protocol is pinned to **RisingWave 3.1.0**, source [45baf646](https://github.com/risingwavelabs/risingwave/tree/45baf6460ea942e4ff57a5aa057d5b8db7f3b563). Use Node 22.16 or later and the maintained runtime's public `pg` dependency. The complete merchant workbench also uses the maintained native x402 peers. Start from the installed Starforge source and runtime; the commands below are relative to `sf30-seller-sdk/risingwave/`.

## Save a private source

Use a private directory and mode 0600 for source files. Keep the connection URL in the named environment variable:

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
| batchSize | 1000 | Native FETCH count, 1–10000 |
| timeoutSeconds | 1 | Native FETCH wait, 0–30 seconds |
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

The implementation follows the exact 3.1.0 [cursor state machine](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/session/cursor_manager.rs). FULL pins the committed epoch at DECLARE and emits Insert rows with NULL timestamps. `SHOW SUBSCRIPTION CURSORS` exposes the native state. The capture matches its own random cursor, session, authenticated user, database, subscription and worker, retaining the original status row.

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

The accompanying native operator uses an existing approved RisingWave 3.1.0 server and a separately reviewed source-input file. It retains the actual source bytes, imports them into its own named relation, exercises explicit native changes, FULL/inclusive recovery, filtered membership, a complete original publisher/seller/buyer path and fresh-process reopen. Its output records the actual SQL commands and native responses. Runtime creation belongs to the existing host's admitted operation.

Primary references: [subscription guide](https://docs.risingwave.com/serve/subscription), [pinned DECLARE handler](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/declare_cursor.rs), [pinned FETCH handler](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/fetch_cursor.rs), [cursor status](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/frontend/src/handler/show.rs), and [native change-log semantics](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/storage/src/hummock/iterator/change_log.rs).
