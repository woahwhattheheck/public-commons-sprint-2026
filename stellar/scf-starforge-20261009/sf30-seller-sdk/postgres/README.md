# PostgreSQL → native SF30 paid query service

Sell approved query results from an existing PostgreSQL database through the original SF30 seller. The merchant writes a named query, lists its input parameters and output columns, and binds it to an ordinary seller route. Buyers provide typed values. The original SF30 runtime continues to own the HTTP 402 offer, verification, application delivery, settlement, cancellation, developer portal and request lifecycle.

This integration includes a pooled database source, startup schema preflight, input admission, an operator inspection CLI, a create-only workspace generator and a launcher that starts the **existing seller and existing operations console**. It does not require a merchant to write a handler module. PostgreSQL SQL and connection settings stay in the merchant's private configuration; they never enter the public offer or data response.

## Install and create a merchant workspace

Use Node 22.16 or newer. From the repository root, install the source's pinned production driver:

```sh
npm install --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/postgres \
  --omit=dev --ignore-scripts --no-audit --no-fund

node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/create-example.mjs \
  --directory /private/merchant-postgres
```

The generator requires a new directory and writes `source.json`, `service.json`, a fictional `seed.sql` and a short guide with private file permissions. It performs no database connection or SQL execution. The seed is for an explicitly selected disposable database; it is not a merchant migration.

Edit `source.json` to select the merchant's approved query and data projection. Set the existing PostgreSQL connection URI in `SF30_POSTGRES_URL` through the service manager or current private environment. The source file contains the **environment variable name**, never the URI or password. URI format is `postgresql://USER:PASSWORD@HOST:PORT/DATABASE` with URL-encoded components. URI query parameters are rejected so they cannot silently replace the configured TLS behavior.

The sample service uses a fictional asset and recipient for a local challenge demonstration. A merchant operator supplies the actual HTTPS `publicOrigin`, network, asset, recipient, atomic amount and corresponding request examples in the original seller configuration before selecting a real facilitator.

```sh
# Offline declaration review: no driver load, connection or environment lookup.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/inspect.mjs \
  --source /private/merchant-postgres/source.json --describe

# Connect to the configured database, enter a read-only transaction and parse
# each projected query with LIMIT 0. Returns version and column type metadata.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/inspect.mjs \
  --source /private/merchant-postgres/source.json --preflight

# Explicit local operator query; optional output is created once with mode 0600.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/inspect.mjs \
  --source /private/merchant-postgres/source.json --query catalog \
  --input '{"region":"north","after_id":"0"}' \
  --output /private/merchant-postgres/catalog-inspection.json

# Original SF30 seller plus original private operations console.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/start.mjs \
  --source /private/merchant-postgres/source.json \
  --config /private/merchant-postgres/service.json \
  --port 8423 --operations-port 8424
```

Startup prints the seller URL, developer docs, OpenAPI document, health/readiness URLs and operations URL. Both listeners bind to loopback through their existing implementations. `/_seller/docs` is the original developer interface; the separate operations console retains its request timeline, exports and metrics. `--no-operations` starts the seller alone. Configure the existing operator-managed HTTPS deployment for the seller's public origin; keep the operations listener private.

Without `--facilitator`, SF30 returns its original payment challenge and does not execute the database handler for an unpaid HTTP request. For native payment mode, use the original SF30 SDK dependencies and append `--facilitator HTTPS_URL`; the launcher imports the original `createNativeSellerServer` and official `HTTPFacilitatorClient`. `--allow-local-facilitator` retains the original explicit loopback HTTP development option. This package introduces no signer, wallet, facilitator or automatic paid retry.

## Configuration

`example-source.json` shows the complete `stellar-forge.postgres-source.v1` declaration:

| Field | Purpose |
|---|---|
| `connectionEnv` | Existing environment variable containing the private PostgreSQL URI. |
| `tls` | `verify-full` by default, using Node's trusted roots. `local-plaintext` is accepted only for literal loopback/localhost development. |
| `caFile` | Optional operator CA bundle, resolved beside the source file; TLS certificate verification remains enabled. |
| `maxConnections` | Dedicated source pool size, 1–32; default 4. |
| `maxPending` | Total accepted active and queued source queries, up to 256; default 32, at least the pool size. |
| `connectTimeoutMs` | Connection acquisition deadline, 100–30000 ms; default 5000. |
| `idleTimeoutMs` | Idle pooled connection lifetime, 1000–300000 ms; default 30000. |
| `lockTimeoutMs` | Backend lock wait ceiling, 1–30000 ms; default 500, further limited by remaining request time. |
| `startupTimeoutMs` | Whole startup preflight deadline, 100–60000 ms; default 10000. |
| `queries` | 1–64 named, operator-owned query declarations. |
| `bindings` | Existing seller route ID → named query and input location. |

Each query uses ordinary PostgreSQL positional placeholders (`$1`, `$2`, …). `parameterOrder` maps those positions to public names; it must contain exactly the declared names once. When omitted, source JSON property order is used. Explicit order is recommended for maintained merchant configurations.

```json
{
  "sql": "SELECT id, title, price_cents FROM merchant.approved_products WHERE region = $1::text AND id > $2::bigint ORDER BY id",
  "parameterOrder": ["region", "after_id"],
  "parameters": {
    "region": {"type":"string","minLength":1,"maxLength":64},
    "after_id": {"type":"integer","minimum":"0","default":"0"}
  },
  "columns": ["id","title","price_cents"],
  "maxRows": 100,
  "maxBytes": 524288,
  "timeoutMs": 1500
}
```

The adapter reuses the original SF30 SQLite module's scalar declaration/binding contract; PostgreSQL SQL is parsed by PostgreSQL, not by the SQLite SQL linter. Strings support lengths, enums, defaults and nullability. Integers accept exact signed 64-bit decimal strings or safe integer Numbers. Numbers are finite JavaScript numbers; use a string parameter plus an explicit SQL `::numeric` cast when exact arbitrary-precision decimal input is needed. Booleans map to native PostgreSQL booleans. Unknown parameters, arrays from duplicate query keys, malformed values and missing required values are rejected before binding.

`columns` is an explicit projection of 1–64 unique SQL aliases. `maxRows` is 1–1000, default 100; the query fetches one extra row to identify truncation. `maxBytes` caps the complete JSON result at 1–896 KiB, default 512 KiB. An oversized result fails as a whole. `timeoutMs` is 50–30000 ms, default 1500, and includes local queue wait, connection acquisition, query execution and completion.

All SQL is **trusted merchant configuration**. Callers cannot select SQL, database hosts, table names, output columns or connection credentials. Use schema-qualified relations: the per-request `search_path` is fixed to `pg_catalog`. PostgreSQL's extended-query protocol enforces a single parsed statement even for zero-parameter queries. Startup catches syntax, parameter-count and projection failures before a seller starts.

## Database role and result semantics

Use an existing dedicated database role with `CONNECT`, the required schema's `USAGE`, and only the necessary `SELECT` privileges on an approved view or listed columns. An ordinary DBA setup for the fictional example, after creating the role through the database's normal credential process, is:

```sql
GRANT USAGE ON SCHEMA sf30_demo TO sf30_catalog_reader;
GRANT SELECT (id,title,region,price_cents,updated_at)
  ON sf30_demo.products TO sf30_catalog_reader;
```

Every actual source query owns one pool client from `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` through `COMMIT`. Connection defaults and local statement/lock/idle-transaction timeouts protect acquisition and work. On error, timeout or abort, that client is retired rather than returned with uncertain transaction state. Requests are never automatically replayed. Existing database views, grants and row-level policies remain responsible for which records may be sold; payment alone does not establish permission to read another tenant's data.

Output schema is `stellar-forge.postgres-result.v1`. Each result contains query name, selected columns, PostgreSQL type OIDs, rows, row count and truncation. **Every non-null value is the original PostgreSQL text representation**; null remains JSON null. This preserves exact bigint, numeric and timestamp precision instead of coercing values through JavaScript Number/Date. Booleans therefore appear as `"t"`/`"f"`; bytea, arrays, JSON and custom types retain PostgreSQL text along with their type OID. Consumers choose their type decoding explicitly. SQL, host, database name, username, password and raw backend errors are not returned.

The sample uses keyset paging (`id > after_id ORDER BY id`). When `truncated` is true, use the last returned ID for a new request. Each request has its own repeatable-read transaction; multiple paid pages are not one shared snapshot. Merchants needing an immutable multi-page dataset should query a versioned/immutable source or use the existing SF30 dataset snapshot workflow.

PostgreSQL read-only transaction mode is a database access mode, not a total SQL sandbox. Review trusted functions and query plans, and retain role privileges and database resource controls. Row/JSON caps limit exposed results; a very large individual field can still be allocated by the driver before the JSON size check. Set practical database-side field limits or project bounded values for large text/blob columns. This source neither reads whole database files nor creates backups.

## Bind, run and close

`bindings` maps seller IDs without replacing seller definitions:

```json
{"catalog":{"query":"catalog","input":"query"}}
```

The service route selects an ordinary handler export name, such as `postgresCatalog`; the integration supplies that function and the named admission function. It adds admission automatically if a bound route omits an admission name. Multiple named queries can share one pool. A binding with `input:"body"` accepts JSON POST/PUT/PATCH through the original seller's supported method path; `input:"query"` uses the original parsed query object. Existing static routes remain usable beside bound queries; unbound application handler names fail clearly.

For an embedding application:

```js
import { openPostgresSourceFile } from './postgres/config.mjs';
import { startPostgresMerchant } from './postgres/merchant.mjs';
const { source, config: declaration } = await openPostgresSourceFile('/private/source.json');
const session = await startPostgresMerchant({
  source, config: existingSellerConfig, bindings: declaration.bindings,
  port: 8423, operationsPort: 8424, nativeFactory: existingNativeFactory
});
// On shutdown: existing SF30 drains requests, then operations/source close.
await session.close();
```

`createPostgresQuerySource` also exposes `query`, `validate`, `route`, `describe`, `inspect`, `status` and idempotent `close`. Direct inspection and `query` calls are local operator APIs; they are not exposed as HTTP payment bypasses. Idle pooled sockets do not keep an otherwise finished process alive. No periodic query, telemetry sender or scheduled work is installed.

Admission checks typed input and current source capacity without running SQL. It returns 422 for invalid input or 429 for an already full source. Capacity can change between admission and the paid application handler; the original native failure/cancellation lifecycle handles a later failure. Source timeouts return 504, overload 429, and other source failures 503 with safe codes. The existing seller determines settlement/cancellation semantics; this adapter does not promise refunds or turn failed application delivery into a success.

## One focused original-source exercise

Install optional development dependencies only when running the disposable demonstration:

```sh
npm install --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/postgres \
  --include=dev --ignore-scripts --no-audit --no-fund
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/exercise.mjs
```

The exercise runs PostgreSQL 18.3 compiled to WASM (PGlite 0.5.8) in its own child process, exposes its actual PostgreSQL wire protocol through `pglite-socket` 0.2.11, and connects with the production `pg` 8.23.1 driver. It seeds a disposable fictional schema and uses the actual source and original seller. The accepted Linux Node 24.19 run completed exact large-numeric/Unicode projection, keyset continuation, native read-only transaction state, literal parameter injection, prepayment input rejection, oversized-result failure, queue capacity plus timeout recovery, close, original unsigned HTTP 402 and original developer docs. No payment/facilitator fixture is used. Six source queries completed; payment operations and hosted Actions were zero.

PGlite's socket multiplexer is an embedded development runtime, so this exercise uses one pooled connection. Production PostgreSQL owns independent backend sessions for the configured pool. Reuse the accepted exercise output for this source; deployment operators can run `--preflight` against their approved database and actual TLS configuration without replaying the engineering exercise.

To keep the disposable database running for manual local inspection, execute `demo-database.mjs`. It prints an ephemeral loopback URI containing only fictional sample state; set the source's `tls` to `local-plaintext` and pool size to 1 for that demo. Stop it with Ctrl-C. Its `seed.sql` is the same inspectable sample shipped with the starter.

## Source references and packaging

- [node-postgres parameterized queries and per-query text parsers](https://node-postgres.com/features/queries)
- [node-postgres transaction/client ownership](https://node-postgres.com/features/transactions)
- [node-postgres connection pooling](https://node-postgres.com/features/pooling)
- [node-postgres TLS configuration and URI overrides](https://node-postgres.com/features/ssl)
- [PostgreSQL transaction access and isolation modes](https://www.postgresql.org/docs/current/sql-set-transaction.html)
- [PostgreSQL statement, lock and idle transaction settings](https://www.postgresql.org/docs/current/runtime-config-client.html)
- [Original PGlite socket implementation and embedded-runtime boundaries](https://github.com/electric-sql/pglite/tree/main/packages/pglite-socket)

The source package is private and stays in the original repository layout. Distribution owners must retain `../sqlite/parameters.mjs`, `../serve.mjs`, `../operations/` and their existing transitive dependencies when packaging this adapter. Production needs `pg`; PGlite is a development-only database. All original payment engines, existing author ownership and merchant financial terms remain in their current modules.
