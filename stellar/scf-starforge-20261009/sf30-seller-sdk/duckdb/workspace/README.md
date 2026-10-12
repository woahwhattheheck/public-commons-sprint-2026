# DuckDB merchant workspace

Operate the original DuckDB/Parquet merchant from one private local browser. The
workspace opens selected local data or an approved source declaration, authors
named queries from actual metadata, previews its native queries,
edits public merchant routes and payment options, saves revisions, prepares the
original self-contained merchant package, and starts the original seller with its
operations console.

For retained Coin Metrics Cloud, API and Snowflake exports, use the
[Cloud Delivery edition workflow](../cloud-delivery/README.md). It adds source and
catalog history, exact typed comparison, reviewed source selection and complete
archive receiving to this same workspace. Start the original launcher with `--cloud` and its normal state/Python arguments;
the original query/merchant steps below remain the same.

## Open the workspace

Use Node 22.13 or later with `node:sqlite`, and the Python environment already used
by the [original DuckDB reader](../README.md). The maintained requirements file is
`../requirements.txt`. From `sf30-seller-sdk`:

For an existing DuckDB database and explicitly selected Parquet files:

```sh
node duckdb/workspace/cli.mjs \
  --data-dir /private/merchant-data \
  --database merchant.duckdb --parquet events.parquet \
  --state /private/merchant-workspace \
  --python /private/duckdb-venv/bin/python
```

Repeat `--parquet` for additional selected files. Omit `--database` for a
Parquet-only merchant. The original `prepareWorkbenchSource` bootstrap writes one
private source declaration beside these files and retains the exact file choices.
The data directory must be writable for this metadata file and for transient
authored declarations. The database and Parquet files retain their original bytes.

To open an existing approved source declaration:

```sh
node duckdb/workspace/cli.mjs \
  --source /private/merchant-data/source.json \
  --state /private/merchant-workspace \
  --python /private/duckdb-venv/bin/python \
  --port 8437
```

Open the printed private workspace URL. It contains a session key in its fragment;
the browser removes the fragment from the address bar after loading. API requests
carry that key in a header. Listener and origin checks keep the workspace on its
actual `127.0.0.1` endpoint.

An existing plan can seed the first saved revision:

```sh
node duckdb/workspace/cli.mjs \
  --source /private/merchant-data/source.json \
  --state /private/merchant-workspace \
  --plan /private/merchant-plan.json \
  --python /private/duckdb-venv/bin/python
```

`--plan` is used only when this workspace has no saved revision. Reopen with
`--state PRIVATE_DIRECTORY --python PYTHON` to load the retained source selection;
`--workspace` is a compatible spelling of `--state`. The installed toolkit exposes
this same launcher as `starforge duckdb-workspace` and `starforge duckdb-workbench`.
A workspace directory has one active process;
a second launcher reports `WORKSPACE_ALREADY_OPEN`. SQLite holds the process lock,
so the operating system releases it when the process exits or crashes.

## Complete the merchant workflow

**Build a query** inspects actual database tables/views and individually declared
Parquet files through the original workbench catalog. Select buyer-visible columns,
one to four ordering columns and optional typed scalar filters. The original
`compileDuckdbQueryPlan` chooses SQL from this metadata and preserves native scalar
types, exact decimal strings and large integers. **Keep query & configure route**
adds the definition to this same merchant draft. The preview and remaining workflow
use the original DuckDB reader and preparation APIs.

The catalog pages all relevant relations. Reopening a retained query after source
rotation locates its relation in the current catalog instead of reusing an obsolete
cursor. Unchanged schemas keep their selected columns and filters; changed schemas
display the retained choices for explicit review against current columns.

1. **Review approved queries.** Choose an existing named query and enter scalar
   inputs. **Run local preview** calls the original native source reader against
   the operator's data. Results preserve exact decimal/integer strings, declared
   column order and native result limits. The preview can be downloaded as typed
   JSON. Private query results are kept separate from public request examples.
2. **Configure the merchant.** Add a query as a route; choose its method, public
   path, service name and description. Supply explicit public input examples and
   parameter descriptions. Set the public HTTPS origin and original payment-option
   JSON. An empty route override inherits the default choices. All supported
   original methods and all selected payment alternatives pass to the maintained
   compiler.
3. **Save the draft.** Each explicit save creates an immutable revision containing
   merchant terms and retained query-authoring choices. The
   expected current revision prevents a stale browser from replacing another
   operator's save. Unfinished plans with valid JSON can be saved before all their
   fields compile. Unsaved form text is retained in the browser tab for refresh
   recovery, including when source identity changes; saved revisions live in the
   private workspace. **Merchant plan** downloads the original public plan format.
   **Complete draft** also retains query choices and unfinished query-builder state
   for import into a workspace over the appropriate source.
4. **Review and prepare.** **Review package** saves current edits and calls
   `compileDuckdbMerchantPlan`. Review the exact public routes, input examples,
   assets, recipients, atomic amounts and timeouts. **Prepare this package** calls
   the original `prepareDuckdbSeller`, which copies only declared data, performs
   actual DuckDB preflight and writes its original service, bindings, API/client
   files and manifest. The package is checked through
   `verifyPreparedDuckdbSeller` before being marked ready.
5. **Run the retained package.** The package panel displays the copied data size,
   original native engine, exact payment choices and package identity. **Start this
   merchant** reopens the selected package through the original verification and
   `startDuckdbSeller` APIs. Its existing developer API and operations console are
   linked beside native source status. **Stop merchant** drains the owned seller,
   closes its reader and closes the original operations listener.

The data scope is fixed by the launch command. Query names select original approved
definitions or explicit selections compiled by the maintained native workbench.
The browser sends column/filter plans; the server keeps native catalog profiles
and generates a private transient declaration beside the original data. Drafts bind
the original source identity; reviewed packages bind the resulting exact query
identity. The original preparer retains the resulting source and data together.
Browser requests cannot supply an executable, SQL file, arbitrary data path,
database connection or facilitator.

## Native payment and listener options

The merchant retains the original source's challenge mode until a facilitator is
configured. To use the operator's existing native facilitator, add its HTTPS URL
when launching this workspace:

```sh
node duckdb/workspace/cli.mjs \
  --source /private/merchant-data/source.json \
  --state /private/merchant-workspace \
  --python /private/duckdb-venv/bin/python \
  --seller-port 8423 --operations-port 8424 \
  --facilitator https://facilitator.example
```

This uses the existing `HTTPFacilitatorClient` and `createNativeSellerServer`.
Install the same original native dependencies and configure actual merchant
payment terms described in [PREPARE.md](../PREPARE.md). `--allow-local-facilitator`
permits an explicitly selected `http://127.0.0.1` development facilitator. It is
accepted only together with `--facilitator`.

The default seller and operations ports are `0`, letting the operating system
choose free local ports. Their actual URLs appear after start. The workspace port
defaults to `8437`; it also accepts `0`. Public merchant metadata keeps the reviewed
HTTPS origin, independently of these private listener addresses.

### Durable product availability

Add `--availability-dir /private/merchant-availability` to use the original
seller availability controls. This explicitly selected directory retains route
pause/resume decisions through seller and workspace restarts. Its native policy
uses Linux `flock`, so the option requires the original availability runtime.

After starting the merchant, **Product availability** opens the original
authenticated operations panel. The original seller applies each pause before
payment admission and exposes current route state, changes and in-flight work.
Keep the same availability directory when reopening this merchant. Source-file
launches through `duckdb/start.mjs` and generated package launchers accept the same
`--availability-dir` option.

`SIGINT` and `SIGTERM` finish admitted workspace work, drain the merchant, close the
reader and release storage ownership. Reopening shows an interrupted prior runtime
and lets the operator explicitly start a retained package. Stop requests identify
the current merchant instance, so a stale browser cannot stop its replacement.

## Retained files and recovery

| Private path | Purpose |
| --- | --- |
| `workspace.sqlite` | Saved merchant/query revisions, workspace identity, stable preparation IDs, package outcomes and last runtime state. |
| `runtime-lock.sqlite` | Operating-system-backed ownership for one workspace process. |
| `inputs/` | Exact saved plan files supplied to the original preparer. |
| `packages/<operation-id>/` | Original relocatable merchant package, including copied data and manifest. |

Directories are private and metadata files use mode `0600`. The saved source
description omits private parameter defaults. The operator's original source and
prepared data stay within their private filesystem.

Save and preparation requests carry stable operation IDs. The browser retains an
uncertain request's ID so an explicit retry can recover the same operation. Reusing
an ID with changed content returns a conflict. A preparation that completed before
a crash can be recovered with **Inspect & recover** using the original manifest and
file checks. An incomplete copy remains visible as an incomplete package; a new
explicit preparation writes a separate directory. Existing packages are never
overwritten.

After a package is ready, it can be inspected and started even if the original
source files have moved or become unavailable. The package uses its copied source
and data. Preparing a new package or previewing original queries requires the
current approved source. A changed source identity calls for saving the merchant
plan against the current description before preparation.

Public API/client downloads are restricted to the original generated plan,
service, review, OpenAPI and customer-client files. Each requested artifact is
checked against its retained digest. The native data, private source SQL, launch
environment and workspace databases are accessed through the operator's local
filesystem.

## Embed the same workspace

```js
import { startDuckdbWorkspace } from './duckdb/workspace/server.mjs';

const workspace = await startDuckdbWorkspace({
  sourceFile: '/private/merchant-data/source.json',
  directory: '/private/merchant-workspace',
  python: '/private/duckdb-venv/bin/python',
  port: 0,
});

// Present workspace.url in the operator's private interface.
// Finish through the original merchant drain and storage close.
await workspace.close();
```

`createDuckdbWorkspace` in `model.mjs` provides the same `state`, `draft`, `save`,
`catalog`, `authorReview`, `reopenAuthor`, `review`, `preview`, `prepare`, `inspect`, `artifact`, `start`, `runtime`, `stop` and
`close` methods to a trusted local embedding. Its source, Python environment,
facilitator factory and listener options are selected by that embedding. The
browser facade fixes those options for its lifetime.

## Maintained composition

The workspace consumes the original workbench's `catalog.mjs`, `catalog.py`,
`author.mjs` and `bootstrap.mjs`. Its query compiler and metadata worker are used
directly. Public merchant compilation, package verification and native seller
startup come from the original `merchant-plan.mjs`, `prepare.mjs` and
`merchant.mjs`. This operator surface joins those capabilities with retained
revisions and merchant lifecycle control.

The focused native operator journey covered an actual DuckDB database and Parquet
file, exact decimal/Unicode previews, metadata-driven query authoring, retained
drafts and operation retries, three prepared routes, original HTTP 402 offers,
browser navigation to the operations console, exact exported artifacts, source
rotation edit recovery and restart after the original files moved. Desktop and
mobile layouts completed the same workflow without browser errors.
The targeted continuation opened raw database/Parquet files, inspected 38 native
relations, recovered a later-page authored query after the database changed and
retained exact query output. It also opened the original availability panel from
the browser, paused a route to HTTP 503, retained that pause through restart and
resumed the route to its original HTTP 402 offer.
