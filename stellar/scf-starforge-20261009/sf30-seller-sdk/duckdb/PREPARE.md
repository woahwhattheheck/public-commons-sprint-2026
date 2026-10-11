# Prepare a DuckDB merchant

Turn an existing approved DuckDB/Parquet source into a complete seller package:
review a merchant plan, copy the declared data, run native preflight, export the
original SF30 service and customer SDK, then start or reopen the original seller.
The source reader, SQL admission, native payment integration, operations console
and shutdown behavior remain the existing implementations.

For browser authoring directly from existing database or Parquet files, start
with the [DuckDB merchant workbench](workbench/README.md). It generates the
original source and plan declarations and uses this same package preparation.

## Complete local workflow

Use the Node and Python setup in [README.md](README.md). The following commands
start in `stellar/scf-starforge-20261009/sf30-seller-sdk`. To use the real local
example, first run the original `duckdb/create-example.py` with the configured
DuckDB virtual environment. That writes `source.json`, a checkpointed database
and a Parquet file to a new private directory.

Create the merchant plan from [example-plan.json](example-plan.json). Its data
matches the original example; all payment identities are explicit, unverified
demo placeholders. Replace the public origin and payment terms for the actual
merchant. Plan files contain public metadata and deliberate request examples,
while the original source file retains SQL and local data paths.

```sh
node duckdb/prepare-cli.mjs inspect \
  --source /private/data/source.json \
  --plan /private/merchant-plan.json

node duckdb/prepare-cli.mjs prepare \
  --source /private/data/source.json \
  --plan /private/merchant-plan.json \
  --directory /private/releases/merchant-001 \
  --python /private/duckdb-venv/bin/python

node /private/releases/merchant-001/launch.mjs \
  --python /private/duckdb-venv/bin/python \
  --port 8423 --operations-port 8424
```

`inspect` compiles the plan using the original seller, source binder, route
validator and API/client generators. It reports every route and complete payment
choice plus the number and total bytes of data files that preparation will copy.
It does not open DuckDB or run SQL.

`prepare` requires an existing parent directory and a new destination. It copies
every individually declared dataset file, preserving relative SQL paths, then
uses the original native reader to preflight all configured queries on those
actual copies. It never samples customer rows during preparation. Editing the
original datasets afterward does not alter the prepared seller.

The launcher verifies the package and prints the original seller, readiness,
developer and operations URLs. Without a facilitator it returns HTTP 402 without
running paid data queries. It accepts the existing `duckdb/start.mjs` runtime
flags, including `--facilitator`, `--allow-local-facilitator`, `--no-operations`,
`--max-in-flight` and `--drain-grace-ms`. The original native SDK remains
responsible for actual payment and settlement. SIGINT/SIGTERM drain and close the
same original seller and source.

## Merchant plan contract

The editor schema is [merchant-plan.schema.json](merchant-plan.schema.json).
Its native compiler is `compileDuckdbMerchantPlan(queries, plan)` in
[merchant-plan.mjs](merchant-plan.mjs). The schema helps an editor assemble a
plan; the native compiler checks the actual approved queries and payment terms,
and preparation performs real DuckDB preflight.

| Field | Meaning |
| --- | --- |
| `schema` | Exactly `stellar-forge.duckdb-merchant-plan.v1`. |
| `publicOrigin` | Canonical merchant HTTPS origin with no path, credentials, query or fragment. The original seller's public host rules apply. |
| `payment` or `paymentOptions` | Optional defaults for every route. Choose one representation. Each route must inherit or supply complete terms. |
| `routes` | 1–64 route declarations. A plan may expose selected queries or expose the same approved query on multiple distinct routes. |

Each route declares:

| Field | Meaning |
| --- | --- |
| `id` | Unique identifier, 1–64 letters, digits, underscore or hyphen. |
| `path` | Canonical fixed route outside `/_seller`; the native route compiler rejects collisions and invalid paths. |
| `method` | An original supported method: GET, HEAD, DELETE, POST, PUT or PATCH. The source always runs its declared read-only query, irrespective of the HTTP method. |
| `query` | Exact existing approved query name from the source. The plan contains no SQL. |
| `serviceName` | 1–32 printable ASCII characters, per the original seller. |
| `description` | Public route description, at most 2,048 printable characters. |
| `tags` | Optional original seller tags: up to five ASCII strings, each at most 32 characters, unique ignoring case. |
| `example` | Deliberately public input object. The original binder checks required fields, scalar types, defaults, enums and limits. |
| `parameterDescriptions` | A public description for every declared parameter, including defaulted fields omitted from the example. |
| `payment` or `paymentOptions` | Optional complete route override. Options are replaced together, never partially merged with inherited terms. |

GET, HEAD and DELETE bind `example` as HTTP query strings. POST, PUT and PATCH
bind the exact JSON object as the request body. Query examples cannot carry SQL
null; omit a field with a configured default or select a body method. The native
binder checks both the submitted example and the actual serialized wire values.

Integer values keep canonical signed 64-bit decimal strings; JSON body examples
may also use safe integer numbers. Finite floating-point inputs follow the
original binder. The public schema describes numeric string semantics, and the
actual source admission enforces exact string spellings and bounds before
payment. The DuckDB source's supported input types remain `string`, `integer`,
`number` and `boolean`; its exact DECIMAL **results** remain decimal strings.

The merchant approves which examples, parameter names, enums, bounds and column
names will become public API metadata. Actual default values stay in the private
source file. Preparation never substitutes real query results into an example;
the output example is an empty structural result with the native encodings.

Every payment choice retains its original scheme, network, asset, recipient,
atomic amount, timeout and optional `extra`. The original seller validates the
positive signed-i128 amount and ordered alternatives and rejects ambiguous
duplicate network/asset/recipient choices. Amounts are strings throughout the
plan, service, review, API and generated client. Schema validation does not
verify address ownership, asset existence or facilitator availability.

## Package contents and reopening

| Path | Use |
| --- | --- |
| `data/` | Copies of only the originally declared local files, with their relative paths preserved. |
| `data/source.json` | Original private source configuration with the plan's route bindings. |
| `plan.json`, `service.json`, `bindings.json` | Saved merchant input and native generated configuration. |
| `review.json` | Every compiled route, exact payment choice, input contract, limits and native preflight column types. |
| `openapi.json` | Original `compileSellerOpenApi` output from the exact compiled offers. |
| `client/` | Original generated JavaScript client, TypeScript declarations, package metadata, guide and exact API source. |
| `launch.mjs` | Original seller launch with package and source checks. |
| `manifest.json` | Complete file sizes/SHA-256 values and original source/preflight identity. Written last. |

The package is private, with directories created as `0700` and files as `0600`.
It includes actual merchant data, SQL and the original local source path. Public
API files contain the merchant's selected metadata; review them before sharing.

```sh
node duckdb/prepare-cli.mjs verify --directory /private/releases/merchant-001
node duckdb/prepare-cli.mjs run --directory /private/releases/merchant-001 -- \
  --python /private/duckdb-venv/bin/python --port 8423 --no-operations
```

Verification reads every selected dataset once and checks all generated file
bytes. Plan/source recompilation must still match the saved service and bindings.
Launch passes the observed source and service snapshots into the original
launcher; a change between verification and native opening is rejected before a
listener starts. The reader continues its original metadata checks around each
query. For large files, account for the one complete data read at each launch.

A package can move as one directory. Set `SF30_DUCKDB_SDK` to the original
`sf30-seller-sdk` directory if its location also changes; install the original
Python dependency on the destination. Verification derives the native source
identity at the new path after checking the retained bytes. These local hashes
detect changes; they are not a merchant identity signature.

To change prices, routes or datasets, edit the appropriate original input and
prepare a **new** output directory. Existing packages and histories remain
available. The original data files must stay stable/checkpointed during copying.
An interrupted or failed preparation leaves its new private directory for
inspection; without the final complete manifest it cannot launch. Preparation
does not overwrite, silently resume or delete that directory.

An input dataset named `source.json` at its source root conflicts with the
generated declaration in `data/`. Put that dataset under a named subdirectory or
give it a distinct filename in the original source before preparation. Existing
DuckDB path, regular-file and selected-Parquet restrictions remain in force.

## Programmatic integration

```js
import {
  compileDuckdbMerchantPlan,
  inspectDuckdbMerchantPlan,
  prepareDuckdbSeller,
  verifyPreparedDuckdbSeller,
  runPreparedDuckdbSeller,
} from './duckdb/prepare.mjs';

const compiled = compileDuckdbMerchantPlan(approvedQueries, publicPlan);
// compiled.service / bindings / review / openapi / client

const result = await prepareDuckdbSeller({
  sourceFile: '/private/data/source.json',
  planFile: '/private/merchant-plan.json',
  directory: '/private/releases/merchant-002',
  python: '/private/duckdb-venv/bin/python',
});
const session = await runPreparedDuckdbSeller({
  directory: result.directory,
  args: ['--python', '/private/duckdb-venv/bin/python', '--port', '0', '--no-operations'],
});
await session.close();
```

`compileDuckdbMerchantPlan` does not perform SQL, network or payment operations.
The preparation API performs the explicitly requested local data copies and
original native preflight. The generated client delegates actual calls to the
existing buyer with explicit intent, budget and payment-option selection. Saved
API files say `CHALLENGE_ONLY`; obtain `/_seller/openapi.json` and its original
client export from a running native deployment when a runtime-mode snapshot is
needed. The configured offers and requests remain unchanged.

## Accepted native preparation journey

The integrated preparation workflow was exercised in cloud Linux with Node
24.19.0, Python 3.12 and the original DuckDB 1.5.6 environment. The actual
database and Parquet example were copied and preflighted, relocated as one
package and reopened after the original source was edited. Original GET/POST
HTTP challenges kept every configured payment choice; original operations
returned 200 and the saved OpenAPI matched the actual seller export exactly.
The generated customer request retained the chosen recipient and timeout.
Two local native reads preserved the large exact decimal and Unicode values and
returned the Parquet aggregate `599.010000`. A changed service file was rejected
before launch and the source closed cleanly.

The original challenge-only runtime returns 402 without running admission. The
changed workflow's malformed body was checked through the same original
configured-admission function used before native payment, returning 422. No
settlement was performed; payment operations and hosted Actions were both zero.
Existing original-source acceptance remains reusable; no new test suite was added.
