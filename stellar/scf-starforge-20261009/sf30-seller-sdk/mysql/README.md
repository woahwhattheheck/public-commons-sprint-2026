# MySQL and MariaDB merchant source

Turn an existing database into an SF30 paid API: inspect its actual schema, approve named read queries, define public routes and payment terms, prepare a portable private merchant folder, and give customers the original generated SF30 JavaScript/TypeScript client.

The source executes native MySQL prepared statements. The maintained SF30 scalar and exact-decimal validators, public offer compiler, seller HTTP/payment service, operator console and customer exporter provide the surrounding product. MySQL 8 and MariaDB 10.11 use their respective server statement-timeout settings. The native acceptance journey was run with MariaDB 10.11.14 and pinned `mysql2` 3.24.5.

For the full database-to-merchant browser workflow, open the [MySQL merchant workspace](workspace/README.md). It builds multiple endpoints from actual table/column metadata, reviews exact filters and native payment terms, prepares private releases, runs the original merchant and availability controls, and exports the complete original customer client:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs workspace \
  --source /private/merchant-draft/source.json --state /private/mysql-workspace
```

For a complete immutable data product, use the [MySQL dataset publisher](publisher/README.md).
It streams a reviewed query through one native read-only transaction, retains
the exact typed projection, publishes through the original dataset version
store, and prepares the original buyer for a selected retained snapshot. The
same browser and CLI provide review, refresh, recovery and scheduled publication:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs publisher serve \
  --workspace /private/catalog-publications --create \
  --source /private/mysql-release/source.json --state /private/catalog-dataset
```

## Install and create a workspace

Use Node 22.16 or later. From the repository root:

```bash
npm ci --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/mysql --ignore-scripts --no-audit --no-fund
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs init --directory /private/merchant-draft
```

The parent directory must already exist. `init` creates `source.json`, `merchant-plan.json`, `input.json` and a fictional `seed.sql` at a new destination. The folder is private (`0700`), its files are `0600`, and existing destinations are preserved. Commands below run from `sf30-seller-sdk/mysql`; use the full CLI path when working elsewhere.

Edit `source.json` for an operator-owned database. Use a database account with SELECT permission on the approved source tables or views. Store its password in the environment variable named by `passwordEnv`, using the host's existing secret injection mechanism.

```json
{
  "host": "database.example",
  "port": 3306,
  "database": "merchant",
  "user": "merchant_reader",
  "passwordEnv": "SF30_MYSQL_PASSWORD",
  "tls": "verify-full",
  "caFile": "database-ca.pem"
}
```

This object is the `connection` property of `source.json`. `verify-full` is the default and validates both the certificate chain and server hostname. `caFile` is optional for a publicly trusted certificate and otherwise resolves relative to the source file. The example workspace uses `local-plaintext` for a local database; this mode accepts only `127.0.0.1`, `::1` or `localhost`.

## Inspect the actual database and approve queries

```bash
node cli.mjs catalog --source /private/merchant-draft/source.json
node cli.mjs catalog --source /private/merchant-draft/source.json --table products
node cli.mjs describe --source /private/merchant-draft/source.json
node cli.mjs preflight --source /private/merchant-draft/source.json
node cli.mjs query --source /private/merchant-draft/source.json --query catalog --input /private/merchant-draft/input.json
```

`catalog` reads the configured database's `information_schema`, including actual tables, views, column types, keys, collation and decimal precision. Results include the native server version and a truncation indicator above 1,000 entries. `describe` validates the file offline and prints the public parameter/column contract. `preflight` connects, starts a read-only transaction and prepares each declared projection against the native server. `query` executes a declared query as a private operator preview; `--output NEW_FILE` writes its JSON result to a new private file.

A query declaration contains fixed operator-selected SQL, an explicit column projection, typed parameters and resource limits:

```json
{
  "sql": "SELECT id, price FROM products WHERE price > CAST(? AS DECIMAL(38,6)) ORDER BY id",
  "parameterOrder": ["minimum"],
  "parameters": {
    "minimum": { "type": "decimal", "minimum": "0" }
  },
  "columns": ["id", "price"],
  "maxRows": 100,
  "maxBytes": 524288,
  "timeoutMs": 5000
}
```

Put this under a named entry such as `queries.priceBand`. The input for it is `{"minimum":"900719925474099312345.123455"}`. Parameter values travel through native `?` bindings. The `parameterOrder` must contain every declared parameter exactly once and match the SQL placeholders. Use a single SELECT or WITH expression that can appear in a derived table. A final semicolon is accepted by the shared declaration normalizer; embedded statements and executable MySQL/MariaDB comments are rejected. Ordinary comments and quoted question marks are handled by the declaration lexer.

The scalar contract is shared with the maintained SF30 database adapters:

| Input type | Value and use |
| --- | --- |
| `string` | Text with configured length and optional enum; NUL is rejected. |
| `integer` | Canonical signed 64-bit decimal text. Safe integer JSON numbers are also accepted for JSON bodies. |
| `decimal` | Exact decimal text with exact minimum, maximum and enum comparisons. Use this for prices and other decimal quantities. |
| `number` | Finite JavaScript number or numeric text, with ordinary binary floating-point semantics. |
| `boolean` | JSON booleans or `"true"`/`"false"` text. |

Defaults, nullable values and enums follow the original validator. HTTP query strings carry text; JSON-body routes can carry explicit null. A full-range MySQL unsigned BIGINT exceeds the shared signed-64-bit input contract: declare an exact decimal parameter with an appropriate bound and use an explicit SQL cast when that range is required. Output BIGINT values remain exact strings.

Approve SQL with suitable indexes and a stable `ORDER BY`. The example uses an exclusive ID cursor for repeated live pages. Each request has one read-only repeatable-read transaction; a sequence of separately paid requests observes separate database snapshots. Configure views when the public field or row policy belongs in the database.

## Review public routes and payment terms

`merchant-plan.json` contains the public API contract. Its schema is `stellar-forge.mysql-merchant-plan.v1`. Set the actual HTTPS `publicOrigin`, recipient, asset, network, atomic amount and route descriptions. The generated example contains conspicuous demonstration payment values for replacement.

Each route names one private query and supplies its fixed path, HTTP method, service name, description, an example and a description for every public parameter. A GET route uses query-string input. The original seller's JSON-body methods use body input. Define either one complete `payment` object or a `paymentOptions` array at plan level; a route may override those terms with its own complete declaration. Multiple options retain their original order and identity through the original offer compiler.

```json
{
  "id": "price-band",
  "path": "/price-band",
  "method": "POST",
  "query": "priceBand",
  "serviceName": "Exact price band",
  "description": "Approved product IDs and exact prices above a selected minimum.",
  "example": { "minimum": "0.000001" },
  "parameterDescriptions": { "minimum": "Exclusive minimum product price as exact decimal text." }
}
```

The original compiler checks the same parameter defaults, bounds, decimal semantics, public URL, route collisions, supported methods, payment options and buyer-header limits used by the running merchant. Invalid parameter input is rejected before payment by the original admission hook.

## Prepare, move, verify and run

```bash
node cli.mjs prepare --source /private/merchant-draft/source.json --plan /private/merchant-draft/merchant-plan.json --directory /private/merchant-ready
node cli.mjs verify --directory /private/merchant-ready
node cli.mjs run --directory /private/merchant-ready --port 8423 --operations-port 8424
```

Preparation is offline. It creates the following complete folder and publishes its file manifest last:

| Artifact | Purpose |
| --- | --- |
| `source.json` | Private connection profile, approved SQL, typed query declarations and generated route bindings. |
| `database-ca.pem` | Optional copied database CA, referenced by a relative path so the folder can move. |
| `service.json` | Original SF30 seller configuration with public offers and source bindings. |
| `merchant-plan.json` | Operator-reviewed public source of the configuration. |
| `openapi.json` | Generated public API specification. |
| `client/` | Original generated customer module, TypeScript declarations, OpenAPI, package metadata and usage guide. |
| `manifest.json` | Byte sizes, SHA-256 digests, route methods, public URLs and payment-option counts. |

Keep the full prepared folder with the merchant operator. Give customers `client/` and the public API specification. `verify` and `run` detect altered or missing prepared files; changing configuration means preparing a new folder. A copied CA continues to work after relocation. The password remains supplied through the destination host's environment.

`run` uses the original seller service and operator console, printing the bound URL, mode, API docs, OpenAPI and operations URL. The seller binds on loopback for the host's existing HTTPS ingress. The default mode serves the real configured 402 challenges. For the maintained native payment path, install the original runtime dependencies described in the [seller guide](../README.md) and pass the configured facilitator:

```bash
node cli.mjs run --directory /private/merchant-ready --facilitator https://facilitator.example
```

`--allow-local-facilitator` permits an explicitly selected HTTP facilitator on `127.0.0.1`. `--no-operations` omits the operations server. `--availability-dir ABSOLUTE_PRIVATE_DIRECTORY` attaches the original persisted product pause/resume controls and prints their operations URLs. Operators with an existing original seller configuration can use `serve --source SOURCE --config SERVICE` with the same launch options. SIGINT and SIGTERM drain the original seller and close its database connections. `createMysqlNativeFactory` provides this same facilitator construction to embedded launchers and the browser workspace.

## Use the generated customer client

The prepared `client/seller-client.mjs` is the maintained SF30 exporter output. Operation IDs match the reviewed route IDs: the included GET example is `catalog`; the POST example above is `price-band`.

The original SF88 Node Buyer can consume this client directly. With an installed Starforge package and its configured original buyer runtime:

```js
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSellerClient } from './client/seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/opt/starforge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  stateDirectory: '/private/buyer-state',
  operatorProfile: '/private/buyer-profile.json',
});
const api = createSellerClient({ buyer });
const result = await api.call('catalog', {
  path: {}, query: { region: 'north', after_id: '0' },
}, { intentId: 'catalog-north-001', maxAtomic: '10000', acceptIndex: 0 });
const page = await result.json();
console.log(page.rows);
```

Use the actual reviewed atomic limit and selected option for your offer. The original Buyer owns review, intent persistence, native execution and verified response access. For review before execution, use `buyer.fromRequest(api.request(...))`, then the returned operation's `review()` and `execute({ review })`. See the [original Node Buyer guide](../../sf88-operator-buyer-cli/node/README.md) for profile and recovery details.

Each response has schema `stellar-forge.mysql-result.v1`, declared `columns`, native column metadata, `rows`, `rowCount`, `truncated` and explicit encoding fields. SQL scalar numbers, exact DECIMAL/BIGINT values and date/time values are returned as strings; binary data is `{"base64":"..."}` and SQL null is JSON null. For example, the native journey preserved the decimal `900719925474099312345.123456`, the ID `9007199254740993`, a microsecond timestamp and Japanese text. Consumers retain decimal strings until passing them to an exact decimal implementation.

## Retain and operate merchant releases

Use the existing SF82 release console and merchant MCP to retain an original prepared
MySQL package, compare query and payment changes, select a version, run the native
seller, export its original customer client and roll back. Start with
`starforge releases stage --store /srv/merchant/releases --id first --mysql-package /srv/merchant/package`.
The full [MySQL release workflow](../../sf82-seller-pilot/MYSQL_RELEASES.md) covers
initialization, source and credential handling, native runtime, generation checks,
client export and same-state reopening. Retained merchant versions keep their
configuration and commercial terms; queries continue to read current database rows.

## Resource and lifecycle behavior

The source validates and limits admitted work before queueing it. Query deadlines include waiting for a connection, transaction setup, execution and result processing. A timeout, aborted request or source close retires the affected native socket. Connections are tracked from creation so startup and catalog deadlines also cover a peer that stalls before login. Failed requests are returned to the caller for a deliberate recovery decision. Successful connections are reused until their configured idle timeout.

| Source setting | Default | Allowed range |
| --- | ---: | ---: |
| `maxConnections` | 4 | 1–32 |
| `maxPending` | 32 | At least `maxConnections`, at most 256 |
| `connectTimeoutMs` | 5,000 | 100–30,000 |
| `startupTimeoutMs` | 10,000 | 100–60,000 |
| `idleTimeoutMs` | 30,000 | 1,000–300,000 |

Per-query row, byte and time limits are compiled by the original source validator. The SQL wrapper requests at most `maxRows + 1` rows to determine truncation. Oversized selected values become NULL plus a private overflow flag inside the database before crossing the driver boundary; the source returns a size error for that page. Prepared rows are handled incrementally, and the complete JSON envelope is checked against `maxBytes`.

Public source errors distinguish invalid input (422), source capacity (429), deadline expiry (504) and unavailable source (503). Operator descriptions contain parameter/column contracts. Private SQL, passwords and raw database errors stay in the operator context. The public API exposes only approved projected columns.

The programmatic entry points are `createMysqlQuerySource` (`source.mjs`), `openMysqlSourceFile` (`config.mjs`), `inspectMysqlCatalog` (`catalog.mjs`), `prepareMysqlSeller` / `verifyPreparedMysqlSeller` (`prepare.mjs`), and `startMysqlSeller` (`merchant.mjs`). A source supports `query`, `validate`, `route`, `describe`, `inspect`, `status` and idempotent `close`.

## Native acceptance and implementation references

The joined MariaDB journey exercised actual schema discovery and prepared reads, exact decimal and integer values, Unicode, hidden-column projection, literal parameter binding, keyset selection, prepayment input rejection, oversized value suppression, a server sleep deadline, request abort and connection recovery. It then prepared and relocated a two-route merchant, imported its generated customer module, served original GET and POST payment challenges (including two payment options), exposed original OpenAPI and operations, and rejected a changed prepared file.

After the independent lifecycle review, a focused native TCP exercise stalled connections before login and after login. The configured 200 ms startup/catalog deadline returned in 202–227 ms, hard-retired the sockets, and passed native idle reconnection, post-timeout reuse, shutdown during a query and exact-decimal checks. These exercises run in the local database/container and add no hosted CI workflow.

Primary implementation references: [mysql2 documentation](https://sidorares.github.io/node-mysql2/docs/documentation), [mysql2 prepared SELECTs](https://sidorares.github.io/node-mysql2/docs/examples/queries/prepared-statements/select), [MariaDB transactions](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction), [MariaDB executable comments](https://mariadb.com/docs/server/reference/sql-statements/comment-syntax) and [MySQL transaction modes](https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html). The adjacent source remains the authoritative interface for this adapter.
