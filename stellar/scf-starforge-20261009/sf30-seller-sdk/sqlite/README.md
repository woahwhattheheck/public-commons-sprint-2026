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

One persistent child process owns the read-only SQLite connection. It receives only the source declaration and typed values, inherits **no environment variables**, does not load extensions, and sends only selected results or safe error codes. SQLite opens read-only with `query_only`, untrusted-schema functions disabled and a short lock wait. A SELECT wrapper enforces projection/row limits; SQLite parses it. Declaration lint catches missing/extra placeholders and unsupported parameter forms. SQL is **trusted operator configuration, not a tenant SQL sandbox**: review query plans, joins, functions, indexes and parameter bounds before exposure.

Synchronous SQLite work cannot block the seller's event loop. The parent enforces a wall-time deadline and kills an active worker on timeout/abort; queued requests or later requests start a fresh worker. The cancelled request is never replayed. A full queue is rejected; default capacity is 32 active+queued requests (configurable 1–256). Timeouts include queue wait, so queued work cannot hang indefinitely. SQLite's native allocations are not an OS memory quota; result limits and a 128-MiB V8 heap limit are not a claim of total process-memory isolation. Use ordinary deployment resource limits for large/untrusted datasets.

The public API is `createSqliteQuerySource({database, queries, maxPending, startupTimeoutMs})`, returning `query`, `validate`, `route`, `describe` and `close`. `query(name,input,{signal})` supports AbortSignal. A direct query/CLI inspection is a privileged local operator operation, not an HTTP payment bypass. Idle worker IPC does not keep the parent alive; parent exit closes the worker. No timers periodically query the database, no writes/telemetry and no new scheduled task are installed.

`inspect.mjs --describe` prints parameter/output contracts without SQL or paths. Add `--output NEW_FILE` to write a create-only 0600 local result. The source JSON, database and local result files stay operator-private; don't publish them with the sample code or put private values in public offer examples.

## Focused native exercise

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/acceptance.mjs
```

One actual temporary SQLite lifecycle checks a 100,001-row indexed database, source projection, Unicode/64-bit values, typed handler/admission, parameter injection as literal text, overload, oversize, timeout/abort, responsive parent, worker restart, close and unchanged database bytes. No test framework or hosted CI. It does not simulate payment or establish a live settlement. Original seller/native integration uses the existing runtime and operator demonstration, not a replacement protocol.

Runtime references: [Node 22 SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html), [Node child process API](https://nodejs.org/download/release/v22.16.0/docs/api/child_process.html). Existing source contract: `../resource-server.mjs`, `../admission.mjs`, `../serve.mjs`, `../DEVELOPER.md`, `../operations/README.md`.
