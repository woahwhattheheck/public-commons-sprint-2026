# SQL Server operations in the BI migration operator

This addition connects the existing migration workspace to reviewed SQL Server reads. The same workspace retains the original report/model, SQL connection and query revisions, native schema observations, complete page results, field mappings, comparisons, support records, and receiving history.

Open **SQL Server** in the navigation. The workflow is **Connections & catalog → Queries & review → Capture jobs → Model bindings → Receiving**. The existing Data & corrections, Output comparison, Migration plans, Report Server, and encrypted recovery screens use the resulting complete datasets.

## Existing runtime and private connection

The operator uses its existing Python environment. Native SQL reads additionally require Node **22.16 or later** and **mssql 12.7.4**. The unchanged eight-file driver closure is retained under `core/`; `DRIVER_SOURCE.json` identifies every original Git blob.

Install the one declared native dependency on an equipped host:

```sh
npm install --prefix tools/sql-server/core/mssql
```

The application reuses that installation for each immutable job. It does not copy dependency trees into every operation. For an already installed external runtime, set `BI_SQL_NODE_MODULES` to the absolute directory containing `mssql/package.json`. The package must report version12.7.4. Set `BI_SQL_NODE` if the existing Node executable is not on PATH.

Create a private connection with host, TCP port, database, SQL user, and the **name** of an existing password environment variable. Set the password value in that host’s environment before launching the operator or portable worker. The application does not accept or store that password in its browser, source declarations, operation receipts, or portable packages. Existing database permissions still govern the read.

Verified TLS is the default. An optional original CA certificate is retained as an immutable input. Server certificate validation stays enabled. The explicitly selected development plaintext mode accepts only localhost,127.0.0.1, or::1. A remote SQL Server always uses verified TLS.

A connection revision does not rewrite a query’s previously selected connection. Save a new query revision when changing the target. Each prepared job keeps the complete original connection/source declaration and CA bytes.

## Inspect the actual catalog

Prepare a catalog job. Leave the table blank to list accessible tables/views, or enter the schema-qualified identifier, such as `[dbo].[OffenseCells]`, to capture its complete column metadata. Each returned catalog retains native type, nullability, precision/scale, collation, and observed primary-key membership.

The source driver limits a native catalog to1,000 returned entries and reports truncation. A truncated table-column result cannot be used as a complete generated-table declaration. Choose a specific accessible table instead of treating the first catalog page as the entire database.

Prepare a job for this host, or download its original ZIP for the existing equipped SQL host. A result imported from that host is validated against the exact original job bytes.

## Review a complete query

**Create from catalog** selects actual source columns and explicit output aliases, then generates a parameterized keyset query from the chosen complete unique, nonnull key. An observed full primary key supplies a source reference; another unique key requires an explicit review/source reference. A composite cursor contains every ordering field, up to four.

Generated aliases use letters, numbers, and underscores. Native SQL identifiers remain bracket-escaped. Filters use declared typed parameters; values are not interpolated into SQL. Decimal and64-bit integer inputs are exact strings. Boolean parameters use JSON `true`/`false`. Binary, floating-point, or Boolean fields are not offered as generated complete-capture cursor keys.

The advanced editor retains one SELECT, its parameter declarations/order, projected aliases, native ordering, and page limits. The original driver validates the SELECT and bindings. It does not accept arbitrary procedures, batches, mutation statements, or unreviewed output columns.

Run **native preflight**, receive that original result, and explicitly accept its observed projection. Review pins the complete native metadata and query content hash. A later query or connection change requires a new preflight and review. A schema change during continuation produces a retained failure; it does not silently change the receiving CSV.

## Capture, cancel and continue the original operation

The native driver returns at most1,000 rows and917,504 bytes per page. A full capture loops automatically through the reviewed cursor until the driver reports an untruncated final page. Default total limits are100 pages,100,000 rows and48MiB of native result JSON; larger declared row/page scopes are supported within the documented receiving limits. Reaching a limit retains the original pages and reports a partial capture.

Each page has its own immutable JSON file, exact byte hash, dispatch identity, query parameters/cursor and capture time. The controller writes intent before each read, commits the original page before advancing the cursor, and holds an OS/native-process lock. A cancellation aborts the current supported query and retains completed pages. Catalog inspection has its original configured timeout; its source API does not expose an AbortSignal.

**Continue original job** explicitly resumes the saved cursor. A read whose response was lost is recorded as unresolved and may be reissued as a new observed statement on that same cursor. Committed pages are not replayed. The complete original job never executes again. If the controller ends after the native worker commits a terminal state but before packaging it, the application packages that retained state without another database query.

A native collection records the driver’s exact `single-statement-database-isolation` value. This does **not** establish a point-in-time snapshot. SQL Server’s lock-based READ COMMITTED can release row/page locks during the statement; READ_COMMITTED_SNAPSHOT provides a statement-start row-versioned snapshot. Independent pages do not establish one shared database snapshot. The operator retains each page boundary and source window, rejects repeated exact cursor keys, and reports observed metadata changes. A stable whole-window extraction must use a separately established database/source process.

Primary isolation guidance: [SET TRANSACTION ISOLATION LEVEL](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql?view=sql-server-ver17). Stable paging requires unique ordering and a suitable unchanged/snapshot source: [ORDER BY and OFFSET/FETCH guidance](https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql?view=sql-server-ver17).

## Use a separate equipped host

Extract the exact prepared job ZIP into a private directory. Its source declaration is `source.json`, exact job is `job.json`, and original native tools are under `worker/`. Supply the named password environment variable on that host, and use its already installed driver:

```sh
python worker/SQL_SERVER_WORKER.py \
  --job /private/job/job.json \
  --operation /private/job/operation \
  --node /existing/node \
  --driver-node-modules /existing/runtime/node_modules \
  --mode execute
```

On Windows, use the equivalent existing Python/Node paths. Without a shared existing dependency directory, install the same declared package with `npm install --prefix worker/core/mssql`. No account setup or provider installation is performed by the worker.

Return `operation/result.bundle.zip` to the original Capture jobs screen. To inspect an ended controller or resume remaining reads:

```sh
python worker/SQL_SERVER_WORKER.py --job job.json --operation operation --mode inspect
python worker/SQL_SERVER_WORKER.py --job job.json --operation operation --mode continue
```

Only the existing original operation folder is used for continuation. Do not run a copied in-progress folder concurrently on another host. A portable receiving checkpoint excludes process locks and requires an explicit receiving-host continuation.

## Preserve values and map the model

Every nonnull scalar is retained as exact server text. Binary is retained in original JSON as `{"base64":"..."}` and as that exact base64 value in the derived CSV. SQL NULL has a job-specific explicit marker, distinct from an empty string and from the text “NULL”. A colliding source text is rejected.

The receiving importer verifies every manifest item, the original job/input bytes, all committed page metadata/counts, and byte-for-byte regeneration of the complete CSV before adopting business records. Partial results stay visible as SQL captures. Only a complete collection creates an ordinary full dataset.

A model mapping binds every target field to one actual captured alias. Its new plan revision preserves the old source and accepted baseline. The generated CSV uses the actual model field names, and the new plan’s source-column mapping is changed with it. Boolean target fields are losslessly rendered as true/false from original0/1 or true/false; the native input remains retained. Precision/scale,64-bit integer, binary and temporal conversion findings remain attached for review.

Power BI model types can have narrower precision than SQL Server types. Review the actual receiving type rather than inferring acceptance from source CSV preparation. The existing comparison engine handles separate explicit NULL markers, exact decimal arithmetic/totals and retained fractional ISO timestamp digits. Use text comparison when exact original formatting or offset representation is the intended contract.

Use Data & corrections for an explicit cell correction: it creates a linked dataset and keeps the original. A corrected comparison retains its original baseline and previous comparison ID. No full input is replaced by a page preview.

## Deliver, receive and restore

**Build full workstream handoff** includes the domain histories and immutable source objects needed for the workstream. It excludes workspace access credentials, password values and prior encrypted backups. It is a private business handoff: server/database/user metadata and original business data remain present.

Receiving validates the complete ZIP, source objects, revision sequences, original job bundles, native results and relationships before any domain adoption. Exact existing revisions are reused. Matching later source history advances its local head. Conflicting shared edits require **keep both** with a reason: the original local work remains, and the complete incoming branch receives stable distinct local IDs. Original native job IDs, input bytes and provider results remain unchanged. A repeated identical bundle reopens the same receiving receipt. Received jobs never start automatically.

The existing encrypted backup includes all profile/query/history/result objects and checkpoints the committed pages of unfinished local captures. It excludes in-flight uncommitted page files. Restore to a new directory through the ordinary operator CLI; original business/provider IDs stay unchanged and the local browser key is renewed. A restored incomplete job can materialize its original source, worker and retained checkpoint before an explicit continuation.

Portable job/result/handoff inputs are limited to64MiB per compressed ZIP or member,512MiB expanded and2,000 members. The source release builder excludes installed dependencies and private operation/workspace folders.

## Source and executable exercise

The native source is unchanged from [the released SF30 MSSQL implementation](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/f18c68077478e1cf7063e5c38be86f0edab39d7a/stellar/scf-starforge-20261009/sf30-seller-sdk/mssql). Its eight original blobs are in DRIVER_SOURCE.json. Runtime reuse uses Node’s documented [synchronous module hook](https://github.com/nodejs/node/blob/v22.16.0/doc/api/module.md#moduleregisterhooksoptions), available from22.15, to resolve only the selected existing mssql package; original driver source bytes remain unchanged.

The complete published-data exercise is `examples/SQL_SERVER_JOURNEY.py`. Its explicitly named protocol carrier validates the original driver declarations and processes the actual bundled SANDAG aggregate rows through the full local application/capture/receiving lifecycle. That carrier is not a SQL Server instance and does not claim customer database execution. Native SQL Server execution uses the original equipped-host job above and retains the returned original provider results.

## Complete retained operating example

The source includes a full application/worker operation using all 5,037 original published SANDAG aggregate rows and four explicitly identified native-type Practice fields. Its local protocol carrier uses the unchanged released declaration and parameter validation; it does not connect to a SQL Server instance.

Run it with the same Python dependencies as the ordinary BI builder and an existing Node 22.16+ executable:

```sh
python -B examples/SQL_SERVER_JOURNEY.py --operation /private/sql-operating-example --node /existing/node
```

The private operation directory retains `JOURNEY.json`, exact source input, original job packages and committed pages, complete source/receiver workspaces, the encrypted backup and `RESULT.json`. Run that same command after an interruption to continue its saved phase. The original completed capture is reused. The recovery passphrase is retained privately within this example's operation folder; move its backup/passphrase separately under the receiving operator's normal storage arrangement.

After the native operation completes, continue that same state through an existing browser runtime:

```sh
node examples/SQL_SERVER_UI.mjs --operation=/private/sql-operating-example --python=/existing/python --playwright=/existing/playwright/index.js --chromium=/existing/chromium
```

This UI continuation opens the original source, receiving and cold-restored workspaces. It retains browser actions, exact downloads and screenshots in the private `ui/` operation folder. `UI-STATE.json` makes a resumed invocation continue its original progress. No native SQL job is launched by the browser exercise. Keep the Python dependency environment used for the native run when invoking the UI carrier. Both entrypoints and all source data are portable; no fixed cloud-container path is required.
