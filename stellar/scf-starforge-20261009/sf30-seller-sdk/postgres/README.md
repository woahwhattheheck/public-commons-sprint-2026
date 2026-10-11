# PostgreSQL → original SF30 paid query service

Publish selected results from an existing merchant PostgreSQL database through
the original SF30 Stellar x402 seller. The database stays in place. Each route
binds one operator-written SELECT query, typed public values and explicit output
columns. The original seller owns HTTP 402, admission, native verification,
application handling, cancellation and settlement.

This integration supplies the missing database-to-seller connection: a reusable
`pg` pool, PostgreSQL cursor reads, exact numeric output, source inspection and
a runnable launcher. There is no additional payment protocol or wallet.

## Install and launch

Use a complete repository checkout with Node 22 or newer. Install only this
adapter's two pinned runtime dependencies:

```sh
npm install --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/postgres \
  --ignore-scripts --no-audit --no-fund

# Create a NEW private operator workspace; no database connection is made.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/create-example.mjs \
  --directory /tmp/sf30-postgres-merchant

# Inspect the declared input/output contract without reading any credential
# or connecting to PostgreSQL.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/inspect.mjs \
  --source /tmp/sf30-postgres-merchant/source.json --describe
```

For a local demonstration, run the generated `example-schema.sql` explicitly
against a disposable local PostgreSQL database, then grant an existing
application role USAGE on `sf30_example` and SELECT on `sf30_example.catalog`.
The example includes values beyond JavaScript's safe integer and float precision
so an operator can inspect the exact original database output. It creates its
own example schema and refuses an existing one.

For a real merchant, edit `source.json` to reference approved existing views and
queries, and replace the example `service.json` payment asset, recipient,
atomic-unit amount and public HTTPS origin. Set `tls` to `verify-full` for a
remote database; optional `caFile` resolves beside the private source file.
`SF30_DATABASE_URL` must already be supplied by the operator's environment or
secret manager. Its format is `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`.
Percent-encode reserved characters in credentials. URI query options are
rejected; TLS and source settings belong in `source.json`.

```sh
# SF30_DATABASE_URL is already present in this process environment.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/inspect.mjs \
  --source /tmp/sf30-postgres-merchant/source.json --query catalog \
  --input '{"region":"north","after_id":"0"}'

node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/serve.mjs \
  --source /tmp/sf30-postgres-merchant/source.json \
  --config /tmp/sf30-postgres-merchant/service.json \
  --bindings /tmp/sf30-postgres-merchant/bindings.json --port 0
```

The original seller's loopback URL is printed. Open `/_seller/docs` for its
existing developer portal, or GET `/catalog?region=north` for its original
402 challenge. The source opens no database connection for challenge-only HTTP
requests. CLI inspection is a privileged local database read and is not an HTTP
payment bypass. Use `--input-file PRIVATE_JSON` to keep real customer query
values out of shell history; `--output NEW_FILE` writes a create-only 0600 file.

The generated local example permits TLS-disabled PostgreSQL only on loopback.
The source JSON and all generated files are created under a 0700 directory with
0600 file permissions. Real database credentials are read only from the named
environment variable, never copied into generated service metadata or reports.
On Windows, apply the operator account's normal filesystem ACLs.

### Native Stellar x402

Install the original optional native packages in the checkout, as documented by
the [original seller](../README.md#enable-the-native-x402-runtime):

```sh
npm install --no-save --ignore-scripts \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0
```

Add `--facilitator https://YOUR-FACILITATOR/facilitator` to the same PostgreSQL
launcher. It constructs the original `HTTPFacilitatorClient` and calls the
existing `createNativeSellerServer`, preserving the configured route/offer.
`--allow-local-facilitator` permits an explicitly selected
`http://127.0.0.1:PORT` facilitator. It is unrelated to the database TLS option.

The example asset and recipient are unverified local placeholders. Replace
them with the merchant's actual terms before enabling live native payments.
This change performs no payment, on-chain settlement, merchant enrollment or
grant submission.

## Three operator files

`source.json` is `stellar-forge.postgres-source.v1`. It contains:

| Field | Purpose |
|---|---|
| `connectionStringEnv` | Existing environment variable containing the PostgreSQL URI. |
| `tls` | `verify-full` by default; `disable` needs `allowLocalDatabase: true` and a loopback host. |
| `caFile` | Optional trusted CA bundle path for verified TLS. |
| `maxConnections` | 1–16 database connections; default 4. |
| `maxPending` | Active plus queued source reads; default 32, maximum 256, at least `maxConnections`. |
| `connectTimeoutMs` | Connection establishment deadline; 100–30000 ms, default 5000. |
| `idleTimeoutMs` | Idle pool retention; 1000–300000 ms, default 10000. |
| `queries` | 1–64 named, trusted, explicitly projected queries. |

`service.json` is the existing `stellar-forge.seller-service.v1` schema with
normal `definition` or original compiled `offer` routes. Each PostgreSQL route
declares distinct `handler` and `admit` export names. `bindings.json` maps every
route ID to `{ "query": "catalog", "input": "query" }` or `input: "body"`.
The launcher requires exact route coverage and checks method/input consistency
before listening. Query input supports original GET/HEAD routes; body input
supports JSON body methods implemented by the current original seller.

Each query has the following contract:

| Field | Purpose |
|---|---|
| `sql` | One operator SELECT/SELECT-compatible WITH statement, with native `$1`, `$2`, … value parameters. |
| `parameters` | Ordered array of parameter definitions; first element binds `$1`, second `$2`, and so on. |
| `columns` | Unique explicit output aliases to expose, maximum 64. Extra selected source columns stay private. |
| `maxRows` | 1–1000 rows; default 100. One additional row determines truncation. |
| `maxBytes` | Entire JSON response size, 1024–917504 bytes; default 524288. |
| `timeoutMs` | Total read deadline including source queue, connection, transaction, fetch and commit; 50–30000 ms, default 3000. |

The example uses indexed keyset pagination: the next page supplies the last
returned `id` as `after_id`. Each page remains a separate original paid request.
There is no cross-request database snapshot pinning. Use a merchant-managed
immutable view/export when a product requires stable history across pages.

### Input types and exact output

All parameters have `name` and `type`. Missing values require an explicit
`default`; null needs `nullable: true`. Unknown input keys, repeated HTTP query
values, arrays and objects are rejected. Optional `enum` constraints are applied
after typed parsing.

- `string`: UTF-8 text with configured `minLength`/`maxLength` (measured in
  JavaScript UTF-16 code units); default maximum 4096. Embedded NUL is rejected.
- `integer`: canonical signed 64-bit decimal string, or a safe integer JSON
  number. Optional exact `minimum`/`maximum` bounds. Larger IDs remain strings.
- `decimal`: canonical decimal **string**, maximum 128 characters, with optional
  exact decimal-string bounds. Monetary values never pass through a float.
- `boolean`: JSON true/false or the query strings `true`/`false`.

Output is `stellar-forge.postgres-result.v1`. It contains the query name,
projected columns, PostgreSQL type OIDs, rows, row count, truncation marker and
`encoding: "postgres-text"`. Every non-null database value remains its exact
PostgreSQL text representation. This includes integers, decimals, booleans
(`t`/`f`), JSON text, timestamps and bytea (`\\x…`). SQL NULL is JSON null. The
transaction uses UTC, ISO dates and hex bytea output. Consumers choose their
own explicit conversions instead of silently rounding monetary values or
changing timestamp semantics.

## Embed in an existing merchant app

```js
import { openPostgresQueryFile } from './postgres/config.mjs';
const source = await openPostgresQueryFile('/private/postgres-source.json');
const catalog = source.route('catalog', { input: 'query' });
export const catalogQuery = catalog.handler;
export const admitCatalog = catalog.admit;
// Stop the original seller before await source.close().
```

Use those exports with the original seller or operations launcher's normal
`--handlers` module option. The embedding app owns shutdown. Alternatively,
`startPostgresSeller()` supplies a single `close()` that first drains the
original seller and then closes the database pool.

The source API is `createPostgresQuerySource({connection, queries, …limits})`,
returning `query`, `validate`, `route`, `describe`, `status` and `close`.
`connection` explicitly provides host, database, user, port, password and SSL
settings; connection strings are accepted only by the private file loader so
URI options cannot override transaction settings. `query(name,input,{signal})`
supports AbortSignal. `describe()` includes no SQL, database path or credential.
`status()` reports only active/queued reads and pool counts.

## Capacity, errors and shutdown

The source maintains its own finite queue in front of the pool. It admits at
most `maxConnections` live reads and `maxPending` total pending reads. An
invalid HTTP input returns 422, and a full source returns 429 in the original
prepayment admission stage. Admission validates values without opening a
database connection. It is not a capacity reservation; a race after admission
can still make the subsequent handler return 503.

Every database read uses one checked-out client for `BEGIN READ ONLY`, local
timeouts, the projected SELECT cursor and COMMIT. Cursor batches contain at
most 32 rows, and only the configured maximum plus one is fetched. Response
size is checked during accumulation and again against the complete JSON
envelope. One unusually large field still has to enter the PostgreSQL protocol
parser before it can be refused; these response limits are not an OS memory
quota. Deploy with normal process/database resource limits and reviewed queries.

An elapsed total deadline or abort rejects the original read and destroys its
connection. SQL/provider failure also destroys the connection, rolling back
that transaction. It is not returned to another buyer with uncertain state.
Reads are never automatically replayed. Queued reads keep their original
deadlines; a timed-out connection acquisition keeps its source slot until the
bounded acquisition finishes. `close()` rejects queued/active reads and shuts
down the pool. No background query scheduler is installed.

Source failures return constant codes such as `QUERY_TIMEOUT`,
`QUERY_RESULT_TOO_LARGE`, `SOURCE_BUSY`, `QUERY_UNAVAILABLE` and `SOURCE_CLOSED`.
They do not echo raw database errors, SQL, submitted values or credentials. A
non-success application response follows the original seller's cancellation
path before successful after-handler settlement. The adapter does not promise
a refund for a payment rail that already collected.

SQL is trusted operator configuration. The PostgreSQL parser, read-only
transactions, explicit projection and bound values work together, but this is
not a sandbox for tenant-written SQL or arbitrary database functions. Give the
merchant source a dedicated least-privilege role limited to approved views,
and review query plans and function effects. Startup does not query a database;
use privileged CLI inspection to confirm a merchant binding before selling it.

## Focused source exercise

`acceptance.mjs` exercises the actual adapter against an explicitly supplied
disposable loopback PostgreSQL instance. It creates a randomly named schema and
reader role, then removes only those objects. The owner connection needs the
permissions to create/drop that fixture. It uses original x402 2.28 packages
for real native challenge/admission, and never calls verify or settle:

```sh
# SF30_PG_ACCEPTANCE_URL names a disposable local cluster already configured.
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/acceptance.mjs
```

The exercise covers exact int64/decimal/bytea values and projection, real
parameter binding, keyset pages, read-only transaction state, queue overload,
timeout/abort/recovery, source close, offline description, original seller 402
and original native admission before payment. No repository suite, hosted
Actions or paid service is invoked. Runtime receipt is supplied with the
publication; a wire-compatible embedded PostgreSQL engine is identified
separately from a native multiprocess deployment.

Source references: [node-postgres queries](https://node-postgres.com/features/queries),
[transactions](https://node-postgres.com/features/transactions),
[pool](https://node-postgres.com/apis/pool),
[cursor](https://node-postgres.com/apis/cursor),
[PostgreSQL transaction modes](https://www.postgresql.org/docs/18/sql-set-transaction.html),
[connection and timeout settings](https://www.postgresql.org/docs/18/runtime-config-client.html).
