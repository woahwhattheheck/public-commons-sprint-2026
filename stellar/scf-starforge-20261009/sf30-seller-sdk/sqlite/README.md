# SQLite → paid SF30 query service

Expose selected results from an operator-owned SQLite database through the **existing SF30 seller**, rather than dumping the database into CSV or adding another payment server. Each named query has fixed operator-written SQL, explicit output columns and typed bound parameters. HTTP callers supply values, never SQL, database paths, table names or projection names.

This is an application data adapter. `../serve.mjs`, the original native x402 verifier/settlement/cancellation paths, developer explorer and operations dashboard remain authoritative. A source handler runs only when that seller reaches its existing application-handler stage.

## Run a complete local example

Use **Node 22.16 or newer** with built-in `node:sqlite` (the native checks here ran on Linux Node 22.16.0). No npm installation, database daemon or hosted build is required. SQLite is experimental in that tested Node release.

From the repository root:

```sh
# Choose a NEW directory; this command refuses an existing directory.
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/create-example.mjs \
  --directory /tmp/sf30-sqlite-merchant

# Inspect the actual source locally as its operator.
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/inspect.mjs \
  --source /tmp/sf30-sqlite-merchant/source.json --query catalog \
  --input '{"region":"north","after_id":"0"}'

# Launch the ORIGINAL SF30 service. The generator also prints an absolute command.
SF30_SQLITE_SOURCE=/tmp/sf30-sqlite-merchant/source.json \
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /tmp/sf30-sqlite-merchant/service.json \
  --handlers "$PWD/stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/example-handlers.mjs" \
  --port 0
```

The original startup JSON supplies the selected loopback URL. Open `/_seller/docs`; its query examples are `region=north` and `after_id=0`. An unpaid `GET /catalog?region=north` receives the original 402 challenge, **not database rows**. The example's asset and recipient are deliberately unverified demo values. Do not use those values with a real facilitator.

To connect a real merchant, edit the **private source JSON** to reference that merchant's authorized database and approved SQL/projection. Edit the **original service JSON** to use the actual public origin, payment terms and corresponding request examples. Use the original seller's documented `--facilitator` option and operator-managed HTTPS deployment. No separate verifier, wallet or facilitator is supplied here. The same original operations launcher can wrap this service with its normal `-- --config … --handlers …` arguments and inherited `SF30_SQLITE_SOURCE`.

## Source contract

`example-source.json` documents the format. `database` resolves beside the source JSON, not the current working directory. Opening never creates a database. A source contains 1–64 queries; each specifies:

| Field | Meaning |
|---|---|
| `sql` | Trusted single SELECT/subquery, including supported WITH queries. Use `$name` placeholders only. |
| `parameters` | Exactly the named SQL placeholders, with type, optional default/nullability/enum/bounds. |
| `columns` | Explicit unique result aliases to expose. Extra source columns are not returned. |
| `maxRows` | Maximum rows per response, 1–1000; default 100. |
| `maxBytes` | Maximum complete JSON result, 1–896 KiB; default 512 KiB. Oversize fails, not partial delivery. |
| `timeoutMs` | Total time including queue wait and worker restart, 50–30000 ms; default 1500. |

The example uses indexed keyset paging: `WHERE region=$region AND id>$after_id ORDER BY id`. When `truncated` is true, supply the last returned `id` as `after_id` for the next request. Every page is its own paid request under the original advertised terms. Each statement reads the database's current SQLite snapshot; **pages are not pinned to one multi-request snapshot**. Use a merchant-managed immutable export when stable cross-page history is required. Schema or file replacement should be followed by a source/service restart; do not silently replace an open database file.

Output is `stellar-forge.sqlite-result.v1`: query name, explicit columns, rows, row count, truncation marker and encodings. **All SQLite INTEGER values are decimal strings**, including small IDs; no 64-bit value is rounded into a JavaScript Number. REAL values remain finite numbers. BLOBs use `{ "$base64": "…" }`; NULL remains null. Text and Unicode are preserved. SQL and database paths do not enter the response.

## Bind an existing merchant handler

```js
import { openSqliteQueryFile } from './sqlite/config.mjs';
const source = await openSqliteQueryFile('/private/catalog-source.json');
const catalog = source.route('catalog', { input: 'query' });
export const catalogQuery = catalog.handler;
export const admitCatalog = catalog.admit;
```

Use `handler: "catalogQuery"` and `admit: "admitCatalog"` in that original SF30 route. For a JSON POST endpoint choose `{input: 'body'}` and declare the matching original POST offer/body example. Different queries can be exported as different handler/admission pairs from the same source. An embedding application calls `await source.close()` after stopping its seller session.

Strings have configured lengths (default maximum 4096 UTF-16 code units). Integers accept canonical decimal strings or safe integer Numbers within signed SQLite 64-bit range; declare monetary integers as strings. Numbers accept finite JSON numbers or strict decimal/exponent strings. Booleans accept true/false or the strings `"true"`/`"false"`. Missing values need a configured default; null requires `nullable:true`. Duplicate HTTP query values become arrays in SF30 and are rejected. Unknown parameters are rejected without echoing their names or values. Enums and numeric bounds are checked before binding.

In native-payment mode, the original `admit` stage rejects invalid input with 422 or existing source overload with 429 **before native verification**. It executes no SQL. Admission is not a capacity reservation: a later race can still produce a handler 503. Failed/oversized/timed-out source queries return a non-success application result, allowing SF30 to invoke its existing cancellation dispatcher rather than settling a successful response. Cancellation does not itself promise a refund from a rail that has already collected. In challenge-only mode the original seller deliberately returns 402 without running admission or application data queries.

## Runtime and ownership

A configurable pool of persistent child processes each owns an independent read-only SQLite connection. Each receives only the source declaration and typed values, inherits **no environment variables**, does not load extensions, and sends only selected results or safe error codes. SQLite opens read-only with `query_only`, untrusted-schema functions disabled and a short lock wait. A SELECT wrapper enforces projection/row limits; SQLite parses it. Declaration lint catches missing/extra placeholders and unsupported parameter forms. SQL is **trusted operator configuration, not a tenant SQL sandbox**: review query plans, joins, functions, indexes and parameter bounds before exposure.

Synchronous SQLite work cannot block the seller's event loop. Jobs enter one FIFO queue; already-warm idle workers receive the oldest jobs first. With multiple workers, completion order may differ from dispatch order. The parent enforces a total wall-time deadline and kills **only the active job's worker** on timeout/abort. A queued cancellation removes only that job; healthy workers keep running. A cancelled or failed active query is never replayed. Replacement waits for the previous process's `close` event, so cancellation bursts cannot exceed the configured process count.

The default remains **one worker**. Set `workerCount` explicitly in the existing private source JSON to enable concurrent reads; no new launcher or server is needed. Both `openSqliteQueryFile` and the existing handler module pass it through:

```json
{
  "schema": "stellar-forge.sqlite-source.v1",
  "database": "catalog.sqlite",
  "workerCount": 2,
  "maxPending": 32,
  "startupTimeoutMs": 5000,
  "queries": {
    "lookup": {
      "sql": "SELECT id, title FROM products WHERE id = $id",
      "parameters": {"id": {"type": "integer", "minimum": "1"}},
      "columns": ["id", "title"]
    }
  }
}
```

`workerCount` accepts integers 1–8 and warms every requested worker before returning the source. `maxPending` stays a **global active-plus-queued limit**, default 32, configurable 1–256; it is not multiplied by worker count. `startupTimeoutMs` is per worker, default 5000, configurable 100–30000. Query deadlines include queue wait and restart. More workers consume more CPU, independent SQLite caches and connections: choose a count against the host's actual CPU/memory budget and merchant query mix, not a presumed universal throughput gain. The per-process 128-MiB V8 heap limit does not bound SQLite native allocations or total memory. Use deployment resource limits for large datasets.

All initial workers must open the database and prepare the approved queries successfully. Later, a failing replacement disables just its slot for the current queued work; healthy slots continue. When all slots fail to start, waiting jobs fail promptly. A later explicit query can retry a failed slot after the underlying problem is repaired. No periodic restart loop or idle database polling is installed. Each read uses its own statement snapshot; the pool adds neither cross-query transactions nor multi-page snapshot pinning. Restart the source after schema or database-file replacement.

The public API is `createSqliteQuerySource({database, queries, maxPending, startupTimeoutMs, workerCount})`, returning `query`, `validate`, `route`, `describe`, `stats` and `close`. Existing query/result/admission contracts are unchanged. `query(name,input,{signal})` supports AbortSignal. `await source.close()` is idempotent, rejects active and queued jobs with `SOURCE_CLOSED`, and waits for all starting, running and retiring processes to close. Idle worker IPC does not keep the parent alive; parent exit closes the workers. A direct query/CLI inspection is a privileged local operator operation, not an HTTP payment bypass.

`source.stats()` returns a frozen, local aggregate snapshot with schema `stellar-forge.sqlite-pool.v1`: configured workers/capacity, live/ready/starting/retiring/unavailable workers, running/queued/pending requests, accepted/succeeded/failed/timedOut/aborted/overloaded counts, worker starts/restarts, process and queue high-water marks, and cumulative queue/execution milliseconds. Counters are lifetime-local and reset when the source is reopened. Queue/execution totals count completed jobs, not in-flight time. A retiring process remains in `processes` until it actually closes. Failed startup may reduce ready capacity temporarily. No SQL, database path, PID, caller values or remote telemetry is included.

`inspect.mjs --describe` prints parameter/output contracts without SQL or paths. `--stats` alone prints pool state; adding it to `--query … --input …` or `--describe` wraps output as `{result, pool}`. Without `--stats`, existing output is unchanged. The CLI opens a **fresh local source**, not the running merchant process; use its `source.stats()` API in an embedding application for that process's live counters. Add `--output NEW_FILE` to write a create-only 0600 local result. The source JSON, database and local result files stay operator-private; don't publish them with the sample code or put private values in public offer examples.

## Focused native exercise

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/acceptance.mjs
```

One actual temporary SQLite lifecycle checks a 100,001-row indexed database, source projection, Unicode/64-bit values, typed handler/admission, parameter injection as literal text, overload, oversize, timeout/abort, responsive parent, worker restart, close and unchanged database bytes. No test framework or hosted CI. It does not simulate payment or establish a live settlement. Original seller/native integration uses the existing runtime and operator demonstration, not a replacement protocol.

Run the single parallel lifecycle exercise for the pool:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/pool-acceptance.mjs
```

It runs native SQLite over a 100,001-row temporary database: simultaneous long and indexed queries, default-serial comparison, per-slot timeout/abort, FIFO queue cancellation, global overload, startup failure/repair, cancellation storms with strict process-count ceiling, and complete shutdown without modifying the source database. Its timing output measures this local workload, not production traffic or payments. The original `acceptance.mjs` continues to cover the default one-worker contract.

Runtime references: [Node 22 SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html), [Node child process API](https://nodejs.org/download/release/v22.16.0/docs/api/child_process.html). Existing source contract: `../resource-server.mjs`, `../admission.mjs`, `../serve.mjs`, `../DEVELOPER.md`, `../operations/README.md`.
