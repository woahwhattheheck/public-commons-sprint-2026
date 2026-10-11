# Paid MCP access to existing data products

The original SQLite, PostgreSQL, DuckDB, ClickHouse, MySQL and MongoDB sources can serve
their prepared products through native MCP. An agent discovers a named tool,
reviews its exact arguments and payment terms, and buys its original query result.
The complete result remains available in the buyer's [result inbox](RESULTS.md).

`data-tools.mjs` binds existing prepared routes into
[`paid-tool-server.mjs`](PAID_TOOLS.md). `data-serve.mjs` opens the selected original
source and runs the server. The SQL or fixed aggregation, database permissions, parameter conversion,
public column projection, row/byte/time limits and source shutdown remain in the
existing SF30 provider. The existing HTTP seller can continue to use its prepared
configuration.

## What must already exist

Use the source, service and bindings files exported by the original provider
workspace or preparation command. For MySQL and MongoDB, select the complete
existing prepared directory: its source file already contains the original
bindings. These files describe the selected data product:

| File | Purpose |
| --- | --- |
| Source configuration | Fixed database or approved files, prepared queries, private parameters, public columns and execution limits. |
| `service.json` | Original prepared HTTP offers, public parameter schemas, descriptions and examples. |
| `bindings.json`, or prepared `source.json` bindings | Original route ID → query name and `query`/`body` input mapping. |
| MySQL/MongoDB prepared `manifest.json` and `merchant-plan.json` | Original complete package identity, approved service plan, public OpenAPI contract and generated customer. The original provider verifier checks them before opening the source. |
| Native facilitator configuration | Existing funded signer, explicit Stellar network, asset and recipient policy, fee ceiling, RPC and signer ownership. |

The original SQLite workbench exports its route mapping in its generated handler
module. For that provider, put the same route ID → query mapping into an
operator-owned `bindings.json`; the native MCP launcher does not execute the
generated handler module. This mapping contains query names and input locations,
with no SQL or database credentials. For example, an existing `catalog` route
bound to the source query `catalog` uses:

```json
{"catalog":{"query":"catalog","input":"query"}}
```

Every selected route must be a prepared query handler with an imported `offer`.
Its public schema must contain exactly the declared source parameters, with the
same required fields. Unknown parameters remain prohibited. A source parameter
with a private default stays optional; the original binder applies that default.
The launcher does not generate a replacement schema or rewrite the prepared files.

## Configure and launch

Create a private operator file with schema `stellar-forge.data-mcp.v1`. File paths
resolve relative to this file. The `tools` array selects 1–32 prepared route IDs;
`name` is an optional MCP name. Here the original prepared query's name, SQL,
schema, example and columns come from its existing package. Replace the payment
placeholders with real values admitted by the native facilitator configuration.

```json
{
  "schema":"stellar-forge.data-mcp.v1",
  "provider":"duckdb",
  "sourceFile":"../prepared/data/source.json",
  "serviceFile":"../prepared/service.json",
  "bindingsFile":"../prepared/bindings.json",
  "facilitatorFile":"facilitator.json",
  "python":"/absolute/path/to/existing/duckdb-environment/bin/python",
  "tools":[{
    "routeId":"catalog",
    "name":"catalog",
    "accepts":[{
      "scheme":"exact",
      "network":"stellar:testnet",
      "asset":"EXISTING_STELLAR_ASSET_CONTRACT",
      "payTo":"EXISTING_MERCHANT_ACCOUNT",
      "amount":"10000",
      "maxTimeoutSeconds":60,
      "extra":{"areFeesSponsored":true,"paymentFlow":"authorization"}
    }]
  }],
  "server":{"host":"127.0.0.1","port":4100,"maxInFlight":1}
}
```

```sh
node stellar-forge/mcp-paid-agent/data-serve.mjs \
  --config /private/operator/data-mcp.json
```

The startup line reports the actual MCP endpoint, discovery URL, registered tool
names and aggregate source status. The facilitator secret and database credentials
are loaded through their existing environment bindings. SQL, private source paths
and connection credentials are absent from the registered tool descriptors.

Each selection may supply complete native `accepts`. If it omits that field, the
original prepared offer's complete payment options are used unchanged. Those
options must already fit the native facilitator's exact Stellar, sponsored
authorization profile. A prepared example's placeholder addresses are not valid
native payment configuration; choose explicit real terms in this operator file.
There is no automatic price, asset, network or payment-flow substitution.

### Use an existing MySQL or MongoDB package

Keep the complete output of the original MySQL or MongoDB preparation workflow.
The package includes `source.json`, `service.json`, `merchant-plan.json`,
`openapi.json`, `manifest.json`, its generated `client/` and a selected CA file
when the original profile requires one. Do not copy its bindings into a second
file or edit its prepared service to introduce MCP.

Set `provider` to `mysql` or `mongodb` and use `preparedDirectory` in place of
`sourceFile`, `serviceFile` and `bindingsFile`. The latter three fields are rejected
for these two providers, so a stale separate mapping cannot override the original
prepared contract. The other four providers retain their existing file configuration.

```json
{
  "schema":"stellar-forge.data-mcp.v1",
  "provider":"mongodb",
  "preparedDirectory":"../prepared-public-records",
  "facilitatorFile":"facilitator.json",
  "tools":[{"routeId":"catalog", "name":"public_records"}],
  "server":{"host":"127.0.0.1","port":4100,"maxInFlight":1}
}
```

Here `catalog` must be an actual route ID in that package's manifest. The example
uses the prepared offer's complete payment options. If those are preparation
placeholders, add the complete real native `accepts` array to this selection as in
the preceding example. The prepared files keep their original bytes in either case.

The launcher calls `verifyPreparedMysqlSeller` or `verifyPreparedMongoSeller`
from the existing provider, then opens that provider's `source.json` and uses its
embedded bindings. A changed or incomplete package fails before database startup
or signing. The startup record includes the selected provider and the verified
manifest SHA-256. Retain that identity with the operator's configuration when
moving the complete package or investigating a later source change.

The host supplies the environment reference already declared by the source:
MySQL uses `connection.passwordEnv` when configured; MongoDB uses
`connection.uriEnv`. The original connection resolver applies the declared
TLS/CA policy. A remote database retains verified TLS; the provider's explicitly
selected plaintext development mode only admits its original loopback connection.
No URI, password or query text is added to MCP discovery or the browser console.

Use the existing installed command for all six providers:

```sh
npx --no-install starforge mcp-data --config /private/operator/data-mcp.json
```

Choose the package's existing `mysql` or `mongodb` runtime dependency group
alongside the MCP/x402 runtime. Keep the original driver's version from that
release's manifest; the MCP adapter does not introduce a second driver. Source
preparation and connection work continue in the original
[MySQL workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/README.md)
or [MongoDB workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/README.md).

Supported provider values and their original runtimes are:

| `provider` | Existing opener and runtime |
| --- | --- |
| `sqlite` | `sqlite/config.mjs` → original bounded Node SQLite worker pool. Requires the original Node SQLite support. |
| `postgres` | `postgres/config.mjs` → original PostgreSQL pool and read-only transactions. Uses the existing `pg` dependency and connection environment/TLS settings. |
| `duckdb` | `duckdb/source.mjs` → original Python DuckDB workers, local database and approved Parquet files. `python` selects an existing interpreter with DuckDB installed. |
| `clickhouse` | `clickhouse/source.mjs` → original native HTTP source, selected environment credentials, typed schema preflight and scan limits. |
| `mysql` | `mysql/prepare.mjs` verifies the complete original package; `mysql/config.mjs` opens its existing MySQL/MariaDB pool, exact scalar bindings and read-only repeatable-read transactions. Uses the original `mysql2` runtime. |
| `mongodb` | `mongodb/prepare.mjs` verifies the complete original package and compiled contract; `mongodb/config.mjs` opens its existing fixed aggregation source. Uses the original MongoDB driver, connection policy, admission and snapshot/read-concern semantics. |

Install the component's existing [MCP/x402 dependencies](PAID_TOOLS.md#install-and-compose)
at the complete checkout or distribution root. The launcher imports only the
selected provider. It does not install or create a database, configure a new
account, or acquire a new data source.

`server` accepts the original native server's host, port, path, public endpoint,
identity, session and request/result limits. For public access, set the real HTTPS
`publicEndpoint` and use the existing TLS ingress. The default handler result
limit is 1 MiB; original provider limits are at most 896 KiB for the data body.
Keep enough room for MCP metadata, payment receipts and the buyer's 2 MiB transport
limit. The same server supplies `/health`, `/discovery/search` and
`/discovery/resources`.

## Discover and buy

Point the original SF32 workspace at this server's discovery origin and allow the
MCP endpoint origin in the operator policy. Use the existing
[remote MCP workflow](REMOTE_MCP.md#discover-review-and-call):

1. `bazaar_search` finds the registered data product.
2. `bazaar_describe` exposes the exact original parameter schema and complete
   native payment alternatives.
3. `bazaar_preview` saves explicit `input.arguments`, endpoint, named tool and
   original `mcp://tool/<name>` payment resource before approval.
4. `bazaar_execute_approved` obtains the existing independent operator decision
   and sends the original native paid call.
5. `bazaar_results` and `bazaar_read_result` provide the full saved result, with
   byte count and SHA-256. The CLI can export the original JSON.

An HTTP query parameter stays in its original public wire form. For example,
when the prepared GET schema advertises an int64 cursor as a string, send
`{"region":"north","after_id":"9007199254740993"}` as MCP arguments. MCP does
not convert it to a JavaScript number or replace the existing binder. Original
body schemas may already permit safe JSON integers as an alternative. Decimal,
null, enum, required-field and default behavior continues to come from the
published schema and original source admission together.

The response contains a short text summary and one complete original data body in
`structuredContent`. The body retains its schema, query name, ordered columns,
rows, row count, truncation flag and native value encodings. Large integers and
exact decimals remain strings when the original provider returns strings. The
body is not duplicated as a second full text table.

For MySQL/MariaDB, the original column types, exact large integer and decimal
strings, binary encodings and null values remain in that body. For MongoDB, the
original canonical Extended JSON v2 values remain intact: ObjectId, Date, Long,
Decimal128, binary and null are not flattened into JavaScript numbers or text.
The source's `columnTypes`, ordered projection, source/consistency metadata and
truncation flag accompany the rows. Query callers supply only the published typed
arguments. They cannot supply SQL, collection names, an aggregation pipeline,
projection, read concern or a replacement connection.

Buyers can use the existing [browser console](CONSOLE.md) to find the tool, review
its arguments and complete native terms, request the independent operator's
approval, then inspect or download the entire saved result. After closing both
processes, reopen the same buyer state to read that result. This read uses the
original result inbox and does not query the database or purchase it again. A
later live query is a new explicitly approved purchase against the current source;
the earlier paid result remains its original observation.

## Admission, errors and shutdown

The native paid server reserves its active-call slot before any asynchronous
admission work. It validates the advertised JSON Schema, then invokes the
source's original admission method before entering the x402 payment wrapper.
Source input errors, a closed source and exhausted source capacity therefore
produce an ordinary MCP error before verification or query execution.

The source checks its own capacity again at query execution. A database failure,
timeout, cancellation or result-limit failure returns the original public error
body with `isError: true`; the native authorization wrapper handles its original
failure path. It does not settle a successful purchase for an error result.
`_meta["stellar-forge/source-status"]` preserves the original source status code.
The adapter does not expose database exception text or invent payment receipts.

On SIGINT or SIGTERM, the launcher awaits the original native server close:
accepted wrappers finish, SDK sessions close and facilitator ownership drains.
Only then does it close the original query source and its workers or connections.
Use the same private facilitator ownership directory when other cooperating
servers share the signer. Each opened source instance retains its own original
connection/worker limits; multiple listeners must be sized against the actual
database capacity.

## Embed an existing source

An application that already opened a source can hand that source to the adapter:

```js
import {startDataToolServer} from '/absolute/source/stellar-forge/mcp-paid-agent/data-tools.mjs';

const server = await startDataToolServer({
  source,
  serviceConfig,
  bindings,
  selections:[{routeId:'catalog', accepts:nativeTerms}],
  facilitatorConfig,
  environment:process.env,
  port:4100,
});
// This server now owns the source lifecycle.
await server.close();
```

`createDataSourceTools` returns just the trusted tool descriptors when the host
already owns its source lifecycle and composes `startNativePaidToolServer`
directly. Each descriptor has original admission and handler callbacks.
`startDataMcpFile` is the file-driven API used by the launcher.

An original provider's configuration preparer can use
`compileDataToolDeclarations({description, serviceConfig, bindings, selections})`
for the same offline declaration review. Supply its original `describe()` result
or offline description, together with its actual prepared service and bindings.
The returned copied declarations include `routeId`, `query`, public tool schema,
example and selected payment options. Runtime uses this same compiler and then
binds the original source callbacks. For offline native policy review,
`paid-tool-server.mjs` exports the same `validateTerms(terms, policy)` used during
server startup; supply the original facilitator's validated policy. These pure
operations neither create substitute handlers nor open a database or signer.
