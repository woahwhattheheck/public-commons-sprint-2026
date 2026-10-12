# Timescale operations and dataset publication

This workspace joins native TimescaleDB administration to the maintained PostgreSQL source, dataset publisher, version store and buyer handoff. Operators retain complete source editions, compare catalog and job changes, assign decisions, prepare native refresh or job changes, compare complete aggregate results, and publish the selected native projection through the original seller.

The application uses the existing PostgreSQL `pg` dependency and private connection resolver. It does not contain another PostgreSQL installation, credential store, scheduler, payment protocol or dataset server.

## Open the application

Use the Node runtime and locked dependencies already required by `../package.json`. Current Node with `node:sqlite` and Linux util-linux `flock` are required. Install dependencies from the original `postgres` directory using its existing package lock. TimescaleDB 2.30.2 supports PostgreSQL 16, 17 and 18; its native server extension must already be installed in the selected database.

Create private source declarations using the existing PostgreSQL source schema. The read declaration and optional maintenance declaration can use different existing roles. Environment values remain on the configured host.

```json
{
  "schema": "stellar-forge.postgres-source.v1",
  "connectionEnv": "SCF_TIMESCALE_READ",
  "tls": "verify-full",
  "queries": {
    "identity": {
      "sql": "SELECT current_database()::text AS database",
      "columns": ["database"],
      "parameters": {},
      "parameterOrder": [],
      "maxRows": 1,
      "maxBytes": 8192,
      "timeoutMs": 30000
    }
  },
  "bindings": {}
}
```

The maintenance file uses its original maintenance environment name. For a local development cluster, select the original resolver's `disable-loopback` mode explicitly. Source files and custom CA files must be ordinary private files. A read role must be able to read the selected Timescale information views, aggregate columns, native job schedule timezone and selected aggregate/source definition. Maintenance permissions are needed only for native changes.

```sh
node timescale/cli.mjs init --directory /private/timescale-project --source /private/read.json --maintenance-source /private/maintenance.json --target /private/timescale-dataset --title "Usage operations"
node timescale/cli.mjs serve --directory /private/timescale-project --port 8446
```

Open the printed loopback URL. The Timescale section sits above the original dataset publisher. The original extraction review, seller publication, buyer configuration and publication scheduler stay available on that same page. An operator-selected seller origin and resource can be passed with `--seller HTTPS_ORIGIN --resource ROUTE_ID`; the original buyer endpoint validator handles them.

## Complete operator workflow

1. **Capture a native edition.** Enter a title and purpose. One read-only, repeatable-read transaction captures all available rows of the native identity, extension, hypertable, dimension, continuous aggregate, chunk, job, job-statistics, job-history, job-timezone and aggregate-column tables. The complete native text values and type OIDs are retained. Large counters, decimal values and timestamps are not converted to JavaScript numbers or dates. Use the table selector and search to inspect every captured row, and download the complete edition.
2. **Select the aggregate and exact window.** Choose its native time column/type and explicit start, exclusive end and timezone. PostgreSQL normalizes the proposed window before a refresh plan is saved. Select the desired columns for publication; other columns remain private.
3. **Prepare and run the native refresh.** The saved plan binds the edition file, database identity, aggregate definition, operator, purpose, window, force setting and native batch options. Preparation reads the actual server signature. Execution checks the same current target and definition, durably records dispatch, then calls the native procedure. TimescaleDB 2.30.2 commits default batches separately; this CALL runs outside an explicit transaction. Setting buckets per batch to 0 requests a single atomic window.
4. **Compare the completed aggregate.** Open the saved refresh or publication plan and choose Compare complete aggregate results. A read-only repeatable-read transaction acquires the native view lock before catalog reads, checks the captured definition, and evaluates its exact original definition against the actual aggregate for the requested window. Both directions use `EXCEPT ALL`, preserving duplicates and complete mismatch rows. Native text uses C collation so distinct text is not equated by a nondeterministic collation. A successful refresh alone is not presented as proof that all requested buckets match.
5. **Review policy changes.** Capture the second edition and compare complete editions. Each changed catalog/job field includes its before and after values. Record Accept, Remediate or Defer with a responsible owner and reason for every change. Job changes have a separate prepared native plan; blank form fields preserve current values. The original job definition, schedule timezone and database identity are checked before applying `alter_job`.
6. **Publish the aggregate.** Save the selected window and columns for publication, then Extract to publisher. This creates an original publisher plan and uses the same operation UUID for its native extraction. The UI opens that retained extraction in the original publisher. Inspect the candidate, record its publication review and publish it using the original version store. The existing seller configuration and buyer handoff then expose the retained snapshot. The publisher's normal CSV null/empty-string constraints and extraction limits still apply.
7. **Hand over the complete project.** Export to a new private package directory. Every edition, native result, decision, plan, operation and original publisher record is included. Consistent SQLite copies use native `VACUUM INTO`. A published dataset export includes the exact original state and every referenced immutable generation. The original seller can keep serving while those generations are copied. A file that changes or disappears causes an explicit failed export, never an incomplete package marked complete.
8. **Receive and reopen.** Inspect the package's complete file manifest, then receive it into a new directory using the same request UUID and expected manifest digest. The receiver checks every complete file, preserves the originals, and relocates only the two current runtime binding files. It returns the received workspace directory. Supply the original credential environment values on the receiving host, reopen that directory and continue through the same application.

## Commands and durable request identity

`node timescale/cli.mjs help` lists every command. Read commands print complete JSON. The browser and command line use the same model. Each mutation input has a caller-generated `requestId` UUID. Optional `expectedVersion` comes from the current status. Keep the complete original input after an interrupted response.

```sh
node timescale/cli.mjs status --directory /private/timescale-project
node timescale/cli.mjs capture --directory /private/timescale-project --input /private/capture.json
node timescale/cli.mjs operation --directory /private/timescale-project --id 55a812f7-32ce-4d2c-910c-d654d7ef0131
```

Example capture request:

```json
{
  "requestId": "55a812f7-32ce-4d2c-910c-d654d7ef0131",
  "expectedVersion": 0,
  "title": "Before daily refresh",
  "note": "Capture aggregate definitions, policies and complete native job outcomes."
}
```

The capture result gives the actual edition ID and file digest. Read `edition` for the native aggregate key and available columns. Preparation uses:

```json
{
  "requestId": "f27441dc-aeac-4077-b7e0-654843895901",
  "plan": {
    "editionId": "ACTUAL_EDITION_UUID",
    "editionDigest": "ACTUAL_EDITION_SHA256",
    "aggregateKey": "ACTUAL_AGGREGATE_KEY",
    "timeColumn": "bucket",
    "timeType": "timestamp with time zone",
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-02T00:00:00Z",
    "timezone": "UTC",
    "title": "Daily usage refresh",
    "owner": "Assigned operator",
    "note": "Materialize the selected complete day.",
    "force": false,
    "bucketsPerBatch": 10,
    "maxBatches": 0,
    "newestFirst": true
  }
}
```

`refresh-plan` returns the actual saved plan ID and digest. The same plan binding is used by `refresh` and `verify`:

```json
{
  "requestId": "17405ef2-dca3-40c3-9c2b-dcff829a1d68",
  "planId": "ACTUAL_SAVED_PLAN_UUID",
  "planDigest": "ACTUAL_SAVED_PLAN_SHA256"
}
```

For `select`, put the common edition/aggregate/window/title/owner/note fields under `selection` and add `columns`, an array of actual selected native column names. Do not include refresh-only options in a publication selection. It saves the complete original publisher plan, including its explicit extraction order. The optional `extraction` object accepts the original publisher's row, byte, row-byte and timeout settings; the selected projection supplies the order. The `extract` command uses the saved projection ID/digest. The returned original run can be reviewed and published through the existing publisher interface.

For `job-plan`, supply `editionId`, `editionDigest`, native `jobId`, `title`, `owner`, `note` and `changes`. Supported changes are the actual native fields `schedule_interval`, `max_runtime`, `max_retries`, `retry_period`, `scheduled`, `config`, `next_start`, `fixed_schedule`, `initial_start` and `timezone`. Omitted fields are unchanged. Native SQL NULL means unchanged for this API, so an ambiguous JSON null change is rejected. `job-apply` takes the returned saved plan ID/digest.

`compare --before UUID --after UUID` returns every change and its comparison digest. A `review` request supplies `beforeId`, `afterId`, `comparisonDigest`, `reviewer`, `note` and `decisions`. Each decision contains `changeKey`, `decision` (ACCEPT, REMEDIATE or DEFER), `owner` and `note`.

## Full export and receiving

```json
{
  "requestId": "796f008b-14f6-45e6-a183-b9c2fd40a86b",
  "outputDirectory": "/private/handover/timescale-oct12"
}
```

```sh
node timescale/cli.mjs export --directory /private/timescale-project --input /private/export.json
node timescale/cli.mjs inspect-package --package /private/handover/timescale-oct12
node timescale/cli.mjs receive --input /private/receive.json
```

Receiving input:

```json
{
  "requestId": "61df6be9-8a72-48d8-b541-d004b33d4b50",
  "packageDirectory": "/private/handover/timescale-oct12",
  "expectedDigest": "ACTUAL_MANIFEST_SHA256",
  "directory": "/private/received-timescale"
}
```

The receiver returns `/private/received-timescale/workspace` and its relocated dataset target. Repeating that exact receiving request reuses the completed original receipt even if the package source has since moved. Reopening preserves historical paths in original records as provenance; runtime operations use the two explicitly relocated current binding files. Dataset serving still uses the original seller launch procedure. No expired external process, socket, lock or control token is exported.

## Operation outcomes and recovery

The workspace saves the UUID/input binding before starting work. Read operations can continue under the same UUID after interruption. A completed capture file or saved plan is reused before another read. Aggregate selection reconciles a publisher plan committed before a lost response against the complete original selection, then returns that original plan.

Before a native change, the actual before-edition and command binding are retained. The journal moves to DISPATCHING before sending the database call. If the process or connection stops without the acknowledgement, the operation becomes OUTCOME_UNKNOWN. Repeating its UUID returns that original outcome; it does not silently repeat a native mutation. Capture the current native edition, inspect the retained job/aggregate result and compare the complete aggregate under the saved plan. This determines the actual remaining work. A later deliberate change uses its own reviewed plan and UUID.

The parent workspace and publisher retain their original Linux process locks. A shared admission facade prevents a publication extraction from racing a Timescale operation. Installed tools and browser listeners must borrow the same model and scheduler. `startTimescaleWorkspaceServer({workspace, schedule, ownsWorkspace:false})` closes only its own listener; its owner remains responsible for the original model and scheduler.

The portable directory contains private connection policy and actual database metadata/results. It retains environment names, never environment values. It is a customer handover artifact rather than a public source-code bundle.

## Native contract sources

- [TimescaleDB 2.30.2 release](https://github.com/timescale/timescaledb/releases/tag/2.30.2)
- [Exact 2.30.2 native policy APIs](https://github.com/timescale/timescaledb/blob/2.30.2/sql/policy_api.sql)
- [Exact 2.30.2 native information views](https://github.com/timescale/timescaledb/blob/2.30.2/sql/views.sql)
- [Continuous aggregate refresh](https://www.tigerdata.com/docs/api/latest/continuous-aggregates/refresh_continuous_aggregate)
- [Continuous aggregate information](https://www.tigerdata.com/docs/api/latest/informational-views/continuous_aggregates)
- [Native job information](https://www.tigerdata.com/docs/api/latest/informational-views/jobs)
- [PostgreSQL 17 LOCK](https://www.postgresql.org/docs/17/sql-lock.html)
- [PostgreSQL 17 collation](https://www.postgresql.org/docs/17/collation.html)

TimescaleDB contains Apache and Timescale-licensed components. This adapter connects to the selected customer's native database. Native dependency redistribution and hosted-service rights remain governed by the exact upstream licenses.
