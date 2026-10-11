# DuckDB and Parquet merchant source

Run approved analytics over a local DuckDB database and individually selected
Parquet files through the original SF30 seller. This directory supplies the data
source, typed route bindings, local inspection and merchant launch. Payment
challenges, native facilitator integration, draining, developer documentation and
the operations console continue to come from the existing SF30 modules.

## Start the complete local example

Use Node 22 or newer and Python 3.10 or newer. Commands below start in
`stellar/scf-starforge-20261009/sf30-seller-sdk`. The Python dependency is pinned
in `duckdb/requirements.txt`; install it into a virtual environment so the fixed
isolated worker can import it without `PYTHONPATH` or shell activation.

```sh
python3 -m venv /tmp/sf30-duckdb-env
/tmp/sf30-duckdb-env/bin/python -m pip install -r duckdb/requirements.txt
/tmp/sf30-duckdb-env/bin/python -I duckdb/create-example.py /tmp/sf30-duckdb-example

node duckdb/inspect.mjs --source /tmp/sf30-duckdb-example/source.json --describe
node duckdb/inspect.mjs --source /tmp/sf30-duckdb-example/source.json --preflight --python /tmp/sf30-duckdb-env/bin/python
node duckdb/start.mjs --source /tmp/sf30-duckdb-example/source.json --config /tmp/sf30-duckdb-example/service.json --python /tmp/sf30-duckdb-env/bin/python
```

Both example directories must be new. The generator creates a private directory,
a checkpointed DuckDB database, an actual Parquet file, source and service
declarations, and a query input file. Its rows are fictional examples. Existing
directories and exported result files are never overwritten.

The launch prints the seller, readiness, developer documentation and operations
URLs. The default seller is `http://127.0.0.1:8423`; the default operations console
is `http://127.0.0.1:8424`. The original listeners bind to loopback. For example:

```sh
curl -i 'http://127.0.0.1:8423/catalog?region=north&after_id=0'
```

Without `--facilitator`, this produces the original HTTP 402 challenge. The paid
data handler is not executed. Input admission still runs first, so unknown or
malformed parameters produce 422 before a data query or payment attempt.

Inspect the same approved query directly as the local operator:

```sh
node duckdb/inspect.mjs --source /tmp/sf30-duckdb-example/source.json --query catalog --input /tmp/sf30-duckdb-example/input.json --python /tmp/sf30-duckdb-env/bin/python
node duckdb/inspect.mjs --source /tmp/sf30-duckdb-example/source.json --query catalog --input /tmp/sf30-duckdb-example/input.json --output /tmp/sf30-catalog-export.json --python /tmp/sf30-duckdb-env/bin/python
```

The output file is create-only with mode `0600`. It contains the actual query
result, so keep it in the operator's private storage.

## Declare a merchant's source

Copy the example declarations into a private directory with the merchant's
checkpointed database and selected Parquet files. Stop the database writer before
opening this source. A running source is a snapshot of one operator declaration
and its file metadata; it is not a concurrent ETL ingestion service.

`source.json` uses schema `stellar-forge.duckdb-source.v1`:

| Field | Meaning |
| --- | --- |
| `database` | A regular local file relative to the declaration, or `:memory:` for Parquet-only queries. Defaults to `:memory:`. |
| `parquetFiles` | Up to 32 individual relative `.parquet` files. Each file must exist at startup. No directory-wide or glob approval. |
| `queries` | 1–32 operator-authored named queries with SQL, scalar parameters and explicit public columns. |
| `bindings` | Original service route ID to `{ "query": "queryName", "input": "query" }`; `input` may be `body` for POST, PUT or PATCH routes. |
| `maxWorkers` | Concurrent native processes, 1–4; default 2. |
| `maxPending` | Total admitted active and queued queries, 1–128; default 32. |
| `startupTimeoutMs` | Whole native preflight deadline, 1,000–60,000 ms; default 20,000. |
| `memoryLimitMb` | DuckDB memory limit per process, 32–1,024 MB; default 256. |
| `threads` | DuckDB execution threads per process, 1–4; default 2. |

Dataset paths must stay under the declaration directory. Absolute paths,
traversal, symlinks and non-regular files are rejected. Parquet paths used in SQL
resolve from that directory and must match the selected files. For Parquet-only
analytics, omit `database` and retain `parquetFiles` plus approved
`read_parquet('events.parquet')` queries.

Each query declares:

```json
{
  "sql": "SELECT id, title, price FROM products WHERE region = $region AND id > $after_id ORDER BY id",
  "parameters": {
    "region": { "type": "string", "minLength": 1, "maxLength": 32 },
    "after_id": { "type": "integer", "minimum": "0", "default": "0" }
  },
  "columns": ["id", "title", "price"],
  "maxRows": 100,
  "maxBytes": 524288,
  "timeoutMs": 5000
}
```

Query, parameter and public column names start with an ASCII letter, contain only
ASCII letters, digits or underscores, and are at most 48 characters. There are at
most 32 parameters and 64 public columns per query. The original scalar binder
supports `string`, signed 64-bit `integer`, finite `number`, and `boolean`, with
defaults, nullable values, enums and applicable length or numeric limits. Every
parameter without a default must be supplied. Unknown keys are rejected.

Use decimal strings for large integer inputs. Boolean inputs accept JSON booleans
or the strings `true` and `false`; number inputs use normal finite JavaScript
number precision. For exact decimal filtering, bind a validated string and use
an explicit `CAST($amount AS DECIMAL(...))` in the approved SQL.

Only `$name` placeholders are supported. Every placeholder must have exactly one
declaration. The common parameter scanner rejects multiple statements and other
placeholder syntaxes; use `CAST(value AS TYPE)` instead of PostgreSQL `::` casts.
The native engine parses the query inside a projected `SELECT` wrapper. SQL and
file names come exclusively from the operator's declaration, while buyers supply
scalar values for the already named route.

Use a deterministic `ORDER BY` and an explicit cursor parameter, such as
`after_id`, when the result may exceed `maxRows`. The result says `truncated:
true` if a further row exists. The caller then supplies the last returned ID for
the next page; this adapter does not issue opaque cursor tokens.

## Connect the original seller

Keep route definitions, prices, network and accepted payment requirements in the
original service configuration. Each bound route uses its original `handler`
name; an omitted `admit` name is supplied in a cloned service declaration. The
source cannot replace a route's static `response`, `responseFile` or
`responseAsset`. All handler routes must have bindings.

The sample service's merchant origin, `UNVERIFIED_DEMO_ASSET` and
`UNVERIFIED_DEMO_RECIPIENT` are placeholders. Replace them with the actual
merchant's configuration before enabling paid requests. Use the existing native
seller dependencies and a merchant-selected facilitator:

```sh
node duckdb/start.mjs --source /private/merchant/source.json --config /private/merchant/service.json --python /private/merchant/venv/bin/python --facilitator https://facilitator.example
```

`--facilitator` imports the original `native-factory.mjs` and the installed
`@x402/core/server` client. HTTPS is required; an explicitly selected local
facilitator may use `http://127.0.0.1` with `--allow-local-facilitator`. Use the
original seller's deployment and payment configuration guidance. This adapter
adds no signer, wallet, settlement or request-replay mechanism.

`--port`, `--operations-port`, `--no-operations`, `--max-in-flight` and
`--drain-grace-ms` compose the original service options. SIGINT or SIGTERM drains
the seller, closes operations, terminates remaining native queries and removes
the temporary declaration snapshot.

For an existing programmatic merchant:

```js
import { startDuckdbSeller } from './duckdb/merchant.mjs';

const session = await startDuckdbSeller({
  sourceFile: '/private/merchant/source.json',
  configFile: '/private/merchant/service.json',
  python: '/private/merchant/venv/bin/python',
  nativeFactory, // the original merchant's configured native factory
  port: 8423,
  operationsPort: 8424,
});

console.log(session.source.status());
// Later, during the application's shutdown:
await session.close();
```

`openDuckdbSourceFile()` also exposes `source.validate`, `source.query`,
`source.route`, `source.describe`, `source.inspect`, `source.status` and
`source.close`. `source.route(name)` provides the existing SF30 `admit` and
`handler` functions. `source.query(name, input, { signal })` is the trusted local
execution API and accepts an `AbortSignal`.

## Native execution and result contract

Startup creates a private immutable normalized declaration and runs native
preflight for every query, checking projected column names and engine types.
Subsequent edits to the input JSON do not change a running service. File identity,
size and nanosecond modification time are checked around preflight and every
query. If a selected dataset changes, requests return `DATASET_CHANGED`; close
the service, complete/checkpoint the new dataset, and reopen explicitly.
`sourceSha256` identifies this normalized declaration and file metadata, not a
whole-dataset content digest.

The launcher starts only the packaged `worker.py`, with fixed arguments and
Python `-I` isolation. It passes a small environment allowlist and no
`PYTHONPATH`. Each query gets a fresh read-only database connection, or a new
in-memory connection for Parquet. DuckDB external access and extension loading
are disabled; only the individually approved Parquet paths are allowed.
Configuration is locked after setup. See the official
[DuckDB security settings](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview)
and [configuration reference](https://duckdb.org/docs/stable/configuration/overview).

`timeoutMs` includes queue time, Python startup and native query execution. It
ranges from 50 to 30,000 ms; the common default is 1,500 ms, so choose a practical
deadline for dataset size and cold process startup. A deadline or cancellation
kills the query's process. Its concurrency slot is released after actual process
exit, and the query is never replayed automatically. Full queues receive
`SOURCE_BUSY`. Status exposes active/pending capacity, completions, failures,
timeouts and the pending high-water mark. The memory setting is DuckDB's
engine-managed limit, not a hard operating-system RSS cap; use ordinary deployment
resource limits for a total process budget.

The native query projects only declared columns, requests at most `maxRows + 1`
rows, and suppresses oversized rows in SQL before values reach Python. The full
encoded response is separately checked against `maxBytes` (1,024–917,504 bytes;
default 524,288). Oversized results fail rather than returning partial JSON.
`maxRows` ranges from 1 to 1,000 and defaults to 100.

Results use `stellar-forge.duckdb-result.v1` with `query`, `columns`, `rows`,
`rowCount`, `truncated` and `encodings`. Integers and decimal values are decimal
strings, preserving values beyond JavaScript's safe integer range. Nulls remain
null, booleans remain booleans, finite floating-point values remain JSON numbers,
binary values use `{ "$base64": "..." }`, and Python date/time values use ISO
strings. Lists and structs are encoded recursively. Cast less common engine types
explicitly in the approved projection when an exact application-specific string
representation is required.

## Accepted integrated exercise and source provenance

Run the one native journey explicitly when changing this integration:

```sh
node duckdb/exercise.mjs /private/merchant/venv/bin/python
```

The accepted cloud run used Node 24.19.0, Python 3.12 and DuckDB 1.5.6 with the
original SF30 source at `5d7ea54`. It created a real DuckDB file and Parquet file,
opened the original seller and operations console, observed 402 before data SQL,
checked admission, and executed approved reads through the original handler. It
preserved `900719925474099312345.123456`, Unicode and explicit projection, resumed
the keyset page, and returned the actual Parquet aggregate `599.010000`. It also
exercised immutable declaration behavior, oversized-row suppression, native query
deadline/queue recovery and clean shutdown. Four data queries completed. Payment
operations: 0. Hosted Actions: 0. The example makes no settlement claim.

The Python reader carries the provenance of the released Commons worker
[`25642b663cdb47f9afd3e2acca3be8d6ae70ad3d`](https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/25642b663cdb47f9afd3e2acca3be8d6ae70ad3d).
This integration supplies the fixed packaged invocation, immutable declaration,
original parameter admission, merchant lifecycle, operations, inspection,
examples and documentation around that native reader. MIT.
