# Retain and operate a SQLite merchant

The existing SQLite workbench, read-only query workers, SF30 seller and SF82
release manager form one operating workflow. A workbench export describes the
queries and public terms; staging takes one committed native database snapshot.
That release can be compared, selected, run and rolled back after the original
database or workbench directory has moved.

Use Node 22.16 or later. Native SQLite backup is built into Node; no SQLite
server, Python environment, package installation or hosted workflow is added.
The original seller's x402 dependencies are needed only for its native payment
mode, as in other SF82 releases.

## Author and stage

Open the original SQLite workbench against the intended database. Save the
query SQL, explicit projected columns, typed parameters, deliberately public
examples, routes and payment terms. Preview through the original native query
worker and export a named merchant package. Keep its six files together:
`manifest.json`, `source.json`, `service.json`, `handlers.mjs`, `launch.mjs` and
`RUN.md`. The original workbench guide is
[sqlite/workbench/README.md](../sf30-seller-sdk/sqlite/workbench/README.md).

Initialize one private release store, then stage the selected export:

```bash
starforge releases init --store /private/sqlite-releases
starforge releases stage --store /private/sqlite-releases --id inventory-v1 \
  --sqlite-package /private/workbench/exports/inventory-v1 --port 8423
starforge releases inspect --store /private/sqlite-releases --id inventory-v1
starforge releases diff --store /private/sqlite-releases --to inventory-v1
```

For a native payment service, stage with the existing `--facilitator HTTPS_URL`
option. The original `--allow-local-facilitator` option applies to a deliberately
selected local development facilitator. All original payment, recipient,
network, request/admission and query-execution behavior is retained.

Staging verifies each original package file against its workbench manifest.
The generated scripts and original run guide are preserved as source; execution
uses the maintained SQLite and seller modules. A dedicated owned process opens
the original database read-only, pins a read transaction, and uses SQLite's
native online backup. Committed WAL data is included. No copied snapshot is
made visible as a release until the backup, file hashes and durable source
publication complete. Failure leaves the current active release intact.

The snapshot contains the whole selected database, including tables that are
not exposed by the declared public queries. Keep the release store private;
customer exports contain the original public merchant contract, not this
database. The SQL declarations continue to define the only query routes.

The default snapshot limit is 1 GiB and its deadline is 120 seconds. Operators
can select `--sqlite-snapshot-max-bytes` (4096 through 1099511627776) and
`--sqlite-snapshot-timeout-ms` (100 through 3600000). The API also accepts an
AbortSignal; timeout/cancellation waits for the owned backup process to exit
before incomplete output is removed. Live query workers have their existing
separate admission, worker-count, row/byte and query-deadline limits.

## Review, run, change and roll back

Use the generation returned by the actual comparison/status operation. For a
newly initialized store that has not been selected yet, it is zero:

```bash
starforge releases activate --store /private/sqlite-releases \
  --id inventory-v1 --expect 0 --reason 'Reviewed original query and payment terms'
starforge releases console --store /private/sqlite-releases --port 8425
```

The original console identifies the SQLite snapshot and displays its staging
command. Its existing comparison, activation, Start, Stop, rollback and
discovery controls operate on the same retained release. The merchant MCP
exports the original customer client from the running seller. An active
selection and a running merchant are separate: selecting a new release does not
replace a running process. Stop the owned merchant, then start the selected
generation to apply the change. Closing it drains the original seller before
closing that seller's original SQLite worker pool.

For a change, save and export a new workbench package and stage a new release
ID. The comparison binds the original query/configuration and database content
hashes alongside public request and payment terms. Database, query, projection,
limits and price changes remain visible through the existing release diff.
Choose the previous retained release to roll back; its exact data and terms do
not depend on the live source's current contents.

Reopen with the same store. Inspection hashes the retained database and source
without starting SQLite workers or accessing the original database. Changed
retained database bytes, changed WAL data, modified declared files or modified
compiled terms require staging a new release. An unchanged completed release
can run after the original source has been removed from the machine.

## Operate through the existing merchant MCP

Initialize the same merchant provider with a host-selected source:

```bash
starforge merchant-mcp init --dir /private/sqlite-operator \
  --sqlite-package /private/workbench/exports/inventory-v1 --seller-port 8423
```

The original merchant configuration contains a `sqlitePackage` source alias
with optional `sqliteSnapshotMaxBytes` and `sqliteSnapshotTimeoutMs`. Package,
database and release-store paths remain host configuration. Use the original
tools in order: `merchant_sources`, `merchant_stage`, `merchant_compare`,
`merchant_activate`, `merchant_start`, original customer export, then
`merchant_stop`/`merchant_restart`. Carry the actual release digest, generation
and owned instance ID returned by the original operations.

Source inspection reads the declared workbench files and reports
`CAPTURE_ON_STAGE`; it does not claim a database hash before capture. Staged
release inspection and comparison expose the actual retained snapshot hashes.
Reopening the same MCP configuration retains the original selection/history
and uses the same original process ownership rules. See the existing
[merchant MCP guide](../../../stellar-forge/mcp-merchant-operator/README.md).

## Retained source and embedding APIs

Each release contains the original six-file workbench directory under
`sqlite/original/`, a source configuration using the local snapshot, the native
`sqlite/snapshot.sqlite`, compiled public offers/service and a capture manifest.
The manifest records the native capture interval, source file identity,
read-only transaction settings, SQLite version and exact file digests. Customer
delivery uses the original SF30/SF88 public handoff and payment path.

`release-sqlite.mjs` exports `prepareSqliteRelease`, `sqliteSnapshotOptions`,
`captureSqliteReleaseSnapshot`, `stageSqliteRelease`, `inspectSqliteRelease`,
`startSqliteRelease` and the original SF82-compatible `launch` entrypoint. Normal
operators use `stageRelease(root, {sqlitePackage, ...})` and the existing SF82 store,
CLI, console or merchant MCP. No second release journal or query engine exists.

Native backup semantics: [Node 22.16 SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html)
and [SQLite Online Backup API](https://sqlite.org/backup.html).
