# DuckDB merchant workbench

Build a paid data API from an existing DuckDB database or selected Parquet files
in a local browser. Inspect the real tables, views and file schemas; choose
public columns, typed filters and result order; preview the actual query; then
save a merchant package with copied data, exact payment terms and a customer
client. The workbench starts and reopens that package through the original SF30
seller and operations console.

## Open your data

Use Node 22.16 or newer, Linux with the `flock` command, and Python 3.10 or newer
with the pinned dependency in [requirements.txt](../requirements.txt). Reuse an
existing DuckDB virtual environment by passing its Python executable. To create
one, run these commands from `stellar/scf-starforge-20261009/sf30-seller-sdk`:

```sh
python3 -m venv /private/duckdb-env
/private/duckdb-env/bin/python -m pip install -r duckdb/requirements.txt
```

Start directly from your existing files:

```sh
node duckdb/workbench/server.mjs \
  --workspace /private/merchant-workbench \
  --data-dir /private/merchant-data \
  --database warehouse.duckdb \
  --parquet exports/events.parquet \
  --python /private/duckdb-env/bin/python
```

For Parquet alone, omit `--database` and repeat `--parquet` for each selected
file. A database alone needs no `--parquet`. File names are relative to
`--data-dir`; use individual files, with up to 32 Parquet files. The original
reader requires regular files within that directory and rejects symlinks,
traversal and absolute dataset paths. Stop the database writer and checkpoint
the DuckDB file before starting.

The workspace's parent directory must already exist. The workbench creates its
private directory with mode `0700`; an existing workspace must already have
private permissions. Choose canonical paths without symlinked directories.
Raw-file setup writes a stable private source declaration beside the selected
data. The operator needs write access to that source directory: preview and
preparation also place temporary authored declarations there. Dataset files
remain the input to the original read-only source.

An existing original declaration can be used directly:

```sh
node duckdb/workbench/server.mjs \
  --workspace /private/existing-source-workbench \
  --source /private/merchant-data/source.json \
  --python /private/duckdb-env/bin/python
```

Open the printed private launch URL on the operator host. The workbench binds
to `127.0.0.1`, chooses an available port by default, and uses a fresh access
token in that URL. Keep the full URL private. `--port PORT` selects a fixed
listener. Its browser assets are served locally and API requests require that
session's token and origin.

## Build and operate the merchant

1. Select **Inspect metadata**. Choose a table, view or approved Parquet file.
   Search the loaded relations or use **Load more relations**. Inspection reads
   schema metadata through the original native DuckDB connection.
2. Name the query, public route and service, and describe the data for buyers.
   The native merchant plan requires a nonempty public description. Select the fields buyers may receive, add
   optional typed filters, and choose one to four ordering columns. Include a
   unique key when page boundaries matter. Set the row, response-size and query
   time limits, then select **Keep query in draft**. Repeat for more queries.
3. Use **Run query preview** to execute the selected query against the real
   data. Supply filter values in the generated form. Preview rows stay in the
   current browser view; exported API examples use the native empty result
   structure. Review the output field names, values and truncation status.
4. Enter the merchant's public HTTPS origin and exact Stellar payment terms:
   network, token asset, receiving address, atomic amount and timeout. Add
   accepted payment alternatives as needed. Amounts remain decimal strings.
5. Select **Save draft**, then **Review merchant package**. Inspect the generated
   routes, request contracts, SQL, selected columns, complete payment options
   and API document. The private source download retains the approved local
   file selections and query declarations.
6. Give the package a new name and select **Prepare saved draft**. Preparation
   uses the saved revision, copies every declared dataset into that package,
   performs original native preflight on the copies, and exports the original
   service, OpenAPI, JavaScript client and TypeScript declarations.
7. Inspect the retained package and select **Start**. Open its original seller
   documentation, readiness page and operations console from the workbench.
   Download the reviewed client/API files for application integration. Use
   **Stop seller** before starting another package.

Every prepared version has its own name and private directory. Preparation may
take time for large data: it copies the selected files and computes their
complete hashes. Package inspection and start verify those retained bytes.
Individual API/client downloads check the requested generated file against its
manifest entry. The [native preparation guide](../PREPARE.md) documents package
contents, verification, relocation and standalone launch.

### Enable the original payment runtime

Install the original [native seller dependencies](../../../distribution/README.md#native-payment-dependencies)
and start the workbench with the merchant's facilitator:

```sh
node duckdb/workbench/server.mjs \
  --workspace /private/merchant-workbench \
  --python /private/duckdb-env/bin/python \
  --facilitator https://your-facilitator.example/facilitator
```

Packages started in this session use the original exact Stellar native factory,
admission and payment lifecycle. The default session starts the original
challenge-only seller, which exposes its HTTP 402 offer and developer metadata.
Trusted local preview remains available in either mode. A facilitator at
`http://127.0.0.1` also requires `--allow-local-facilitator`.

## Resume and revise

Stop the workbench with Ctrl-C. It cancels active previews, drains accepted
operations and the seller, closes native sources, and releases the workspace
lease. Reopen the saved workspace using the same Python environment:

```sh
node duckdb/workbench/server.mjs \
  --workspace /private/merchant-workbench \
  --python /private/duckdb-env/bin/python
```

The saved source selection, draft and packages return. Open the newly printed
URL and explicitly start the desired package. Pass the facilitator option again
for a session that needs native payments.

| Retained path | Purpose |
| --- | --- |
| `draft.json` | Original source selection, saved merchant draft and revision identity. |
| `packages/NAME/` | Original immutable prepared merchant, data copies, manifest and client. |
| `authoring/NAME.json` | Exact authoring choices, source identity and saved revision used for that package. |
| `lease.lock` | The shared original Linux lease, retained for the owning process. |

Workspace files are private. One process owns a workspace; multiple browser
tabs can review it, and stale saves are rejected so another tab's revision is
preserved. Reload the saved draft before applying further edits.

When the original dataset changes, complete its write/checkpoint and select
**Inspect metadata** again. Reselect changed relations or columns and review the
query before preparing a new package. Existing prepared packages keep their
copied data. Use a new workspace to select a different set of source files.

## Query contract and limits

The metadata catalog returns 32 relations per page and up to 256 columns per
relation. It includes source identity and relation fingerprints; the native
reader checks file identity around inspection and execution. Metadata inspection
does not sample rows. A preview is an explicit actual query with the source's
normal queue, deadline, projection and response limits.

Each query selects 1–64 public columns, 1–4 scalar ordering columns and up to 32
filters. A draft contains up to 32 queries. Unusual source column names receive
unique public aliases, displayed in the generated review. Buyer values bind to
named scalar parameters in fixed generated SQL.

Filters support equality, lower/upper bounds, strict comparisons and text
prefixes where the native type permits them. Every filter is optional; omitting
it leaves that predicate unrestricted. Exact decimal and wider-than-signed-64-bit
integer filters use strings plus native DuckDB casts. Integer and decimal result
values retain the original decimal-string encoding. Choose a strict lower-bound
filter on an ordered unique key to request the next page after a truncated
result; this workbench preserves the original source's explicit cursor model.

| Limit | Default | Range |
| --- | --- | --- |
| Maximum returned rows | 100 | 1–1,000 |
| Maximum encoded response bytes | 524,288 | 1,024–917,504 |
| Query deadline, including queue/startup | 5,000 ms | 50–30,000 ms |

The [source guide](../README.md) describes supported result encodings, queue and
worker limits, dataset freshness and the original isolated native execution.
Catalog inspection uses DuckDB's
[information schema](https://duckdb.org/docs/stable/sql/meta/information_schema)
and native [Parquet schema inspection](https://duckdb.org/docs/stable/data/parquet/overview).

## Application integration

The installed distribution exposes the same workflow:

```sh
npx --no-install starforge duckdb-workbench \
  --workspace /private/merchant-workbench \
  --python /private/duckdb-env/bin/python
```

Its `duckdb`, `duckdb-inspect` and `duckdb-prepare` commands pass arguments to the
original source launcher, query inspector and package preparation CLI.

```js
import { startDuckdbWorkbench } from
  '@tokenjunkielabs/starforge-merchant/seller/duckdb/workbench';

const session = await startDuckdbWorkbench({
  workspace: '/private/merchant-workbench',
  sourceFile: '/private/merchant-data/source.json',
  python: '/private/duckdb-env/bin/python',
  port: 0,
});
console.log(session.url);
// Close during the application's own shutdown.
await session.close();
```

`openDuckdbWorkbench` in `./model.mjs` provides the same draft, catalog, review,
preview, prepare, inspect, start, stop, export and close lifecycle without HTTP.
The catalog and author modules are also exported under
`seller/duckdb/workbench/catalog` and `seller/duckdb/workbench/author`.
`inspectDuckdbCatalog({sourceFile, python, cursor, signal})` returns public
`catalog` metadata and a private native `profile`. Pass that exact profile to
`compileDuckdbQueryPlan({profile, plan})`; retain it in the local process because
its source authority cannot be reconstructed from serialized browser data.
The existing preparation API remains available at `seller/duckdb/prepare`.
