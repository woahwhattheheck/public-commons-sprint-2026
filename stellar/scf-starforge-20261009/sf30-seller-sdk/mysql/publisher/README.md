# Publish a MySQL query as a retained dataset

Turn an approved MySQL or MariaDB query into a reviewed data product with stable
buyer pages. The original MySQL source extracts the complete result in one
read-only transaction. The existing merchant publisher retains and validates
the candidate, records the operator's review, publishes through the original
dataset version store, and prepares the original SF88 buyer configuration.
Later database changes and publications leave retained buyer versions intact.

This workflow uses the same publisher model, browser, scheduler, revision checks,
recovery and buyer handoff as PostgreSQL and SQLite. MySQL supplies the native
source transaction and exact scalar mapping. Its live paid-query endpoints
continue to use their original capped query contract.

## Start with an approved MySQL source

Use Linux, Node 22.16 or newer, util-linux `flock`, and the original pinned
`mysql2` runtime. The [merchant workspace](../workspace/README.md) creates a
private `source.json` from actual database tables and approved endpoint fields.
The [original MySQL CLI](../README.md) also prepares that source from named SQL.
Use the source of a prepared release, or another operator-reviewed source file.
Give the database account SELECT access to the intended tables or views, and
supply the password through the source's existing `passwordEnv` reference.

From the repository root:

```sh
npm ci --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/mysql --ignore-scripts --no-audit --no-fund
node stellar/scf-starforge-20261009/sf30-seller-sdk/mysql/cli.mjs publisher serve \
  --workspace /private/catalog-publications --create \
  --source /private/mysql-release/source.json \
  --state /private/catalog-dataset --port 8447
```

The maintained distribution exposes the same command as `starforge
mysql-publisher`. Open the printed loopback address. The publisher workspace
must be new with `--create`. Its dataset target can be an absent directory for
the first publication, or the state directory of a running original dataset
seller. Directories use mode 0700, retained files use 0600, and the original
kernel lock gives one process ownership of the workspace. Run the local browser
under the merchant operator account.

Saving a plan retains exact source bytes, the fixed query and inputs, the chosen
dataset projection and limits, and their hashes. A configured CA is copied into
the plan; the retained runtime source points to that copy. Passwords continue
to come from the original environment reference. Source changes require a new
plan, while a later extraction from the same plan observes a new transaction.

Reopen the existing history with:

```sh
starforge mysql-publisher serve --workspace /private/catalog-publications --port 8447
```

## Complete operator workflow

1. **Save the plan.** Choose an original named query and its typed fixed inputs.
   Select the approved columns to expose, their dataset types and allowed
   filters, ranges and sorts. Choose extraction ordering, with a unique final
   key when repeatable order between separate extractions matters. The form
   retains the displayed source hash and exact choices.
2. **Extract the complete result.** The original connection pool opens a native
   repeatable-read transaction with `WITH CONSISTENT SNAPSHOT, READ ONLY` and
   streams the approved prepared statement. It waits for each row consumer and
   commits after all rows are accepted. The ordinary endpoint's `maxRows` is
   independent of this extraction. An explicit `LIMIT` in the approved SQL
   still defines that query's result. Exceeding the extraction limit fails the
   whole candidate.
3. **Inspect the retained data.** The original CSV loader validates every public
   scalar. Its existing parser powers preview, filters, sorting and pagination.
   The candidate retains source/configuration/CSV hashes, native field types,
   transaction settings, row count and complete output identity.
4. **Review and publish.** Record a reviewer and change note. First publication
   initializes the original version store. A refresh binds the target's exact
   current snapshot and revision; the original writer refuses an intervening
   target change and preserves the dataset contract.
5. **Prepare the buyer.** Read the running seller's actual advertised terms,
   select a payment alternative and retain the original buyer configuration
   for the selected snapshot. The original buyer performs its own review,
   authorization, execution and response handling.

Saved plans, extraction attempts, reviews, publications and activity share the
same browser history. Cancellation and deadlines retire the affected native
socket through the original source lifetime. Failed and interrupted partial
files stay outside the version store. The existing recovery action reconciles
a complete candidate against the actual target before deciding its publication
state; it does not repeat the source query.

## Exact values and transaction semantics

MySQL's original reader returns scalars as text, binary values as base64 objects
and SQL NULL as JSON null. Public dataset types are chosen explicitly:

| Public dataset type | Accepted native values |
| --- | --- |
| Text (`string`) | Exact DECIMAL and integer text, native strings, date/time text, and binary values represented as canonical base64. Use this for large identifiers and decimal amounts. |
| Integer (`integer`) | A native integer type whose actual value is within JavaScript's safe integer range. Larger values require Text and are never rounded. |
| Float (`number`) | Finite native FLOAT or DOUBLE values. A DECIMAL column requires Text; selecting Float does not silently discard its decimal precision. |
| Boolean (`boolean`) | A native integer exactly `0` or `1`, or a one-byte BIT value exactly 0 or 1, converted to the existing CSV `false` or `true`. |

The projection checks native field metadata before extraction and again while
consuming rows. NULL requires a nullable column. The existing CSV representation
uses an empty nullable cell for NULL, so a real empty string in that same
nullable column is refused. Non-nullable Text preserves empty strings. Binary
Text is base64, including the empty binary value. Decimal and large-integer Text
uses the dataset's string comparison semantics for public filters and sorts.
Use explicit reviewed SQL casts when the intended public representation differs
from the native column type.

Default limits are 250,000 rows, 64 MiB of output, 1 MiB of native value bytes
per row, 65,536 characters per cell and 30 seconds. Maximums are 1,000,000 rows,
256 MiB of output, 8 MiB per row, 1,048,576 characters per cell and 300 seconds.
The native export counts source value bytes. The original CSV writer separately
counts its complete encoded output, including the header and escaping, against
the same output ceiling. Query timeout includes queueing, transaction setup,
database execution and awaited consumer work.

The prepared query wrapper reads at most the reviewed row ceiling plus one
sentinel row and refuses the whole result when that sentinel exists. Its
explicit order places NULL after non-null values. Oversized native row values
are suppressed inside the database before transfer, and the original mysql2
stream applies row backpressure to the connection. Database sorting and derived
table materialization remain native database work; output limits do not bound
every query planner operation or temporary table.

Use transactional tables such as InnoDB for the consistent database view. The
native transaction sets repeatable-read isolation and requests a consistent
snapshot; nontransactional tables keep their database engine's own semantics.
The retained record contains the actual connection ID, database UTC time,
server version, isolation and successful commit. The immutable CSV and its
hashes identify the retained result. A connection ID or timestamp is not a
reusable database snapshot handle. See the official
[MySQL transaction documentation](https://dev.mysql.com/doc/refman/8.0/en/commit.html)
and [MariaDB START TRANSACTION](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction).

## Start the original dataset seller

After first publication, configure the original seller with the merchant's
actual public payment terms and enable retained snapshot selection:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /private/catalog-dataset --payment /private/catalog-payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/catalog-seller.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /private/catalog-dataset --seller /private/catalog-seller.json --port 8423 \
  --control-transport loopback
```

The original launcher serves its configured payment challenge until its native
facilitator is configured. Deployment, verification, settlement and retention
follow the [versioned seller guide](../../dataset-refresh/README.md). Dataset
publication and buyer preparation do not change the merchant's payment terms.

Reopen the publisher against that running seller and its exact public resource:

```sh
starforge mysql-publisher serve --workspace /private/catalog-publications \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data --port 8447
```

In **Buyer handoff**, enter a first-page query, load the current terms, select
the payment alternative and supply an intent ID. Download the generated
configuration and open it in the original SF88 buyer workspace. The publisher
retains the same configuration beside the extraction. Its URL pins the selected
snapshot; later publication leaves original retained pages and cursors usable
under the version store's retention policy.

## Commands, schedules and embedding

`starforge mysql-publisher --help` exposes every original publisher command:
source, template, save, extract, inspect, review, publish, recover, buyer and
retained status. The source launcher is `mysql/publisher/cli.mjs`, also available
as `mysql/cli.mjs publisher`. Close the browser before opening the same workspace
with a separate command process.

The same workspace supports the original
[scheduled publication policy](../../postgres/publisher/SCHEDULES.md), including
explicit source plan selection, exact target binding, row-change bounds,
pause/enable, retained failures and restart recovery. Creating the workspace
leaves its schedule disabled. This adapter does not create another timer or
publication writer.

The public `@tokenjunkielabs/starforge-merchant/seller/mysql/publisher` export
provides `openMysqlPublisher(options)`. It returns the original publisher API.
The trusted `driver.mjs` supplies source inspection, plan capture, extraction
validation and scalar mapping to `openSourceDatasetPublisher`; browser requests
and source JSON cannot choose arbitrary driver code.

The original MySQL source also exposes an operator-only API:

```js
const result = await source.exportDataset('catalog', { region: 'north' }, {
  order: [{ column: 'id', direction: 'asc' }],
  maxRows: 250000, maxBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 30000,
  signal,
  async onRow(row, columnTypes, progress) {
    await consumeApprovedRow(row, columnTypes, progress);
  },
});
```

This method uses the existing pool, typed parameter binder, native credentials,
timeouts and close behavior. It resolves only after commit and reports
`stellar-forge.mysql-dataset-extraction.v1`. Await each consumer write and
publish output only when the whole call succeeds. The original HTTP routes
expose only their reviewed paid-query operations.
