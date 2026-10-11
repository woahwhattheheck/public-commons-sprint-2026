# PostgreSQL → paid SF30 query service

Expose approved queries from a merchant's existing PostgreSQL database through
the **original SF30 Stellar x402 seller**. The merchant selects the SQL, input
contract, output columns and payment terms. Buyers supply typed values. They
cannot supply SQL, database names, table names or new projections.

This source complements the existing SQLite adapter for merchants whose data
already lives in a PostgreSQL service. It includes a source library, private
configuration, operator inspection CLI and one launcher composing the maintained
seller and operations interface. Payment verification, settlement, cancellation,
resource release and capacity/drain remain in the original SF30 runtime.

## Connect an existing merchant database

Use Node 22+ and a full repository checkout. Install the two optional database
driver packages in that checkout; this does not install a database server:

```sh
npm install --no-save --ignore-scripts pg@8.23.1 pg-cursor@2.22.1
```

Copy `example-source.json`, `example-service.json` and `example-input.json` to a
private merchant directory. Set the source's database host, port, database name
and existing read-only role. Its `passwordEnv` names the existing private
environment variable containing the password. The config never contains the
password itself. For a private certificate authority, set `caFile` relative to
the source config. TLS verifies the certificate and server identity by default.

Set the seller config's `publicOrigin`, real verified asset/recipient and atomic
unit price. The supplied service uses deliberately nonpayable example values.
Its SQL assumes `merchant.catalog`; replace that SQL and its projections with
your own reviewed schema or views. The source is for data the merchant is
authorized to sell; an arbitrary shared database is not an approved source.

The following commands run from the checkout root. `describe` and `validate`
are offline and do not load the password or database driver:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk/postgres

node "$S/inspect.mjs" describe --source /private/merchant/source.json
node "$S/inspect.mjs" validate --source /private/merchant/source.json \
  --query catalog --input-file /private/merchant/input.json

# Privileged local operator read of the actual database, without any payment.
node "$S/inspect.mjs" query --source /private/merchant/source.json \
  --query catalog --input-file /private/merchant/input.json \
  --output /private/merchant/catalog-preview.json

# Run the original seller with the same original operations interface.
node "$S/launch.mjs" --source /private/merchant/source.json \
  --config /private/merchant/service.json --port 8423 --operations-port 8424
```

The startup JSON gives the actual loopback seller URL, original mode and
operations URL. Without a facilitator, requesting `/catalog?region=north`
returns the original `402` and `PAYMENT-REQUIRED` header. It executes no SQL and
returns no merchant rows. `/_seller/docs` and `/_seller/openapi.json` remain
the original developer surfaces. The PostgreSQL pool opens connections lazily;
a challenge-only launch alone does not establish database reachability.

Enable payment with the original SF30 native SDK packages and your existing
trusted facilitator, following the [native runtime guide](../README.md):

```sh
node "$S/launch.mjs" --source /private/merchant/source.json \
  --config /private/merchant/service.json --operations-port 8424 \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
```

Only an explicitly supplied `http://127.0.0.1:PORT` facilitator may use
`--allow-local-facilitator`. The service listener stays on loopback behind the
merchant's existing HTTPS reverse proxy. SIGINT/SIGTERM drain the original
seller, close its operations interface and end the PostgreSQL pool. The
maintained `--max-in-flight` and `--drain-grace-ms` options pass to the same
original seller lifecycle.

## SQL and typed inputs

A source contains 1–64 named queries. Each uses a single trusted `SELECT` or
`WITH … SELECT`, explicit schema-qualified relations and PostgreSQL positional
parameters. For example:

```json
{
  "sql": "SELECT id, title, price_cents FROM merchant.catalog WHERE region=$1::text AND id>$2::bigint ORDER BY id",
  "parameterOrder": ["region", "after_id"],
  "parameters": {
    "region": {"type":"string", "minLength":1, "maxLength":32},
    "after_id": {"type":"integer", "minimum":"0", "default":"0"}
  },
  "columns": ["id", "title", "price_cents"],
  "maxRows": 100,
  "maxBytes": 524288,
  "timeoutMs": 3000
}
```

`parameterOrder` maps names to `$1`, `$2`, and so on, and must name every
declared parameter exactly once. Each position must occur in the SQL. Repeated
use of a position is fine. PostgreSQL casts, quoted/dollar-quoted literals and
nested comments are supported; a second statement is rejected. The SQL is
never interpolated with HTTP values. PostgreSQL receives separate parameters
through the maintained `pg` driver.

Parameter validation reuses the original
[`sqlite/parameters.mjs`](../sqlite/parameters.mjs), preserving its defaults,
enums, nullability and numeric/string bounds. Supported input types are string,
signed 64-bit integer, finite number and boolean. Integers use canonical decimal
strings, with safe JavaScript integer inputs accepted too. Boolean values become
actual PostgreSQL boolean parameters. Exact decimals outside the integer model
should use a constrained string parameter and an explicit PostgreSQL `numeric`
cast; do not pass money through JavaScript floating point.

Duplicate HTTP query parameters become arrays and are rejected. Unknown inputs
and missing required values are rejected without echoing buyer-selected values.
The `admit` function executes no SQL. Original native mode calls it before
payment verification; invalid inputs get 422, and a full local database queue
gets 429. Admission is not a connection reservation. If the queue fills later,
the application handler reports 503 through the original cancellation path.

## Results and paging

`stellar-forge.postgres-result.v1` contains the query name, selected columns,
rows, `rowCount`, `truncated`, and explicit encoding markers. **Every non-null
database field is a PostgreSQL text string.** SQL NULL becomes JSON null.
This preserves full `bigint` and arbitrary-precision `numeric` values; it also
preserves JSON/JSONB as text instead of losing nested large numbers to
`JSON.parse`. Booleans are `"true"`/`"false"`; date/time text uses UTC and ISO
settings; bytea uses PostgreSQL hex text. Arrays and user types retain their
database text representation. Consumers choose any further type conversion.

Only explicitly selected output aliases can leave the database connection.
The original SQL may use private columns for filtering/joining without exposing
them in the response. Internal SQL, server, role, password, input values and raw
database errors do not appear in the response contract.

The driver uses its native cursor with eight-row batches and a SQL `LIMIT` of
`maxRows + 1`. The extra row determines `truncated`; no paid partial response is
silently emitted when the byte budget is exceeded. A SQL projection prevents
one oversized row from crossing the wire as a huge field. The complete encoded
JSON response is checked against `maxBytes` before success. Limits are 1–1000
rows and 1–896 KiB; defaults are 100 rows and 512 KiB.

Use indexed keyset pagination as in the example: pass the last returned `id`
as `after_id` when `truncated` is true. Each page is a separate paid operation
under its original offer. Every query gets its own database snapshot; pages do
not share a retained snapshot. For stable exports, expose a versioned immutable
view or an explicit merchant-owned snapshot identifier in the query contract.
No connection is held between buyer requests.

## Database boundaries and operation

Every query checks out one pool client, opens an explicit **read-only
transaction**, sets per-transaction statement/lock/idle deadlines and a
`pg_catalog` search path, executes the projected query, and commits before
returning application data. Use schema-qualified tables/views because `public`
is not implicitly searched. Original SF30 decides whether that application
result can be settled and released to the buyer.

The wall-time budget includes application queue, connection acquisition and
database work. A timed-out or aborted active request destroys its exact
connection; it is never recycled with a live transaction or automatically
retried. Database connection loss, overflow and read-only violations produce
fixed safe errors. The remaining queue can proceed on a new connection.

| Setting | Default | Allowed |
| --- | ---: | --- |
| `poolSize` | 4 | 1–16 connections |
| `maxPending` | 32 | poolSize–256 active and queued queries |
| `connectTimeoutMs` | 5000 | 100–30000 ms |
| `idleTimeoutMs` | 10000 | 1000–60000 ms |
| Per-query `timeoutMs` | 1500 | 50–30000 ms including queue wait |

Read-only transactions do not make arbitrary SQL safe. SQL and functions are
trusted operator configuration. Use a dedicated existing role with only
`CONNECT`, schema `USAGE` and `SELECT` on approved views/tables, without owner,
superuser or `BYPASSRLS` authority. Apply appropriate row-level security and
resource limits to the database itself. Review joins, functions, query plans and
indexes; result limits are not an operating-system memory quota or a universal
limit on database scan cost. This is not a buyer SQL console.

Connection configuration is explicit: `host`, `port`, `database`, `user`,
optional `passwordEnv`, `tls` and optional `caFile`. Passwords and connection
URLs embedded in JSON are rejected. A URL cannot override certificate checking
through `sslmode`. `tls: "disable-loopback"` is available only for literal
`127.0.0.1`, `::1` or an absolute local Unix socket directory. Operator-selected
private database hosts can use verified TLS normally.

## Embedding and integration

```js
import { openPostgresQueryFile } from './postgres/config.mjs';
const { source } = await openPostgresQueryFile('/private/merchant/source.json');
const catalog = source.route('catalog', { input: 'query' });
// Supply catalog.handler and catalog.admit as exports to the original SF30 app.
// Stop the seller before closing the source:
await source.close();
```

The library exposes `query(name, input, {signal})`, `validate`, `route`,
`describe`, `status` and `close`. Describe/status contain no connection secrets
or SQL. `route(..., {input:'body'})` supports original JSON POST/PUT/PATCH
methods when the installed original seller supports them.

The shipped launcher reads source `bindings` keyed by an existing seller route
ID. Each binding selects a query and `query`/`body` input. The original service
route must name unique handler and admission exports; the launcher fills those
functions from the source and rejects mismatched methods or unknown routes.
Static routes may coexist. If an application also has unrelated dynamic
handlers, embed with `bindPostgresSeller` and merge its own trusted handlers
before calling the original `startSellerService`.

For a merchant pilot, use one approved read-only view and its indexed query,
review the explicit original offer price, inspect actual sample rows privately,
then run the same seller behind the merchant's HTTPS ingress and existing
facilitator. Database integration, response sizing, deployment and ongoing
query/schema maintenance are concrete paid services enabled by this source.
No customer adoption, deployment, transaction or earned revenue is implied by
the bundled example.

## Focused local exercise

The development fixture runs Electric's maintained **PostgreSQL WASM engine**
in a separate process and connects the real `pg`/`pg-cursor` drivers to its
loopback PostgreSQL socket. It is an actual SQL engine, not an emulated query
result. The socket layer multiplexes an embedded single-connection engine; this
exercise uses a one-client pool and does not establish production multi-backend
concurrency, remote TLS or merchant authentication. Production uses ordinary
operator-owned PostgreSQL; PGlite is not imported by any seller source path.

```sh
# Development-only dependencies, not required to serve a merchant.
npm install --no-save --ignore-scripts \
  pg@8.23.1 pg-cursor@2.22.1 @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/acceptance.mjs
```

One temporary-database journey covers exact values and private projection,
keyset paging, input admission/injection-as-data, actual database write refusal,
oversize refusal, capacity/deadlines/recovery, original seller HTTP 402 and the
existing operations app. It invokes no wallet or settlement, installs no
watcher and uses no GitHub Actions.

Primary references: [node-postgres parameterized queries and type parsers](https://node-postgres.com/features/queries),
[transactions](https://node-postgres.com/features/transactions),
[cursor](https://node-postgres.com/apis/cursor),
[TLS configuration](https://node-postgres.com/features/ssl),
[PostgreSQL transaction modes](https://www.postgresql.org/docs/16/sql-set-transaction.html),
[PostgreSQL statement settings](https://www.postgresql.org/docs/16/runtime-config-client.html),
[PGlite socket behavior](https://pglite.dev/docs/pglite-socket).

MIT, matching the original public seller. This engineering is separate from
the existing SF10 SCF founder application workflow.
