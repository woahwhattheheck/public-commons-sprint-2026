# Publish a SQLite query as a retained dataset

Turn an approved query from the original SQLite merchant into a reviewed data
product with stable buyer pages. The original SQLite worker reads the complete
result in one read transaction. The existing merchant publisher retains the
candidate, records the operator's review, publishes through the original dataset
version store, and prepares the original buyer configuration. Later changes to
the database or current publication do not alter a still-retained buyer version.

This workflow shares the PostgreSQL publisher's working model, browser, revision
checks, recovery, version writer and SF88 buyer handoff. SQLite contributes its
native extraction and scalar mapping. The original capped SQLite query endpoint
continues to serve its current-query contract.

## Start with the original source

Use Linux, Node 22.16 or newer, util-linux `flock`, and the maintained Starforge
source or distribution. No SQLite daemon or extra npm dependency is needed. Use
the private `source.json` exported by the [SQLite workbench](../workbench/README.md)
or the [original SQLite adapter](../README.md). From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --create \
  --source /private/sqlite-merchant/source.json \
  --state /private/inventory-dataset --port 8446
```

Open the printed loopback address. The publisher workspace must be new with
`--create`. Its dataset target can be a new, absent directory or the state
directory of a running original dataset seller. Workspace directories use mode
0700 and retained files use 0600. The existing local origin checks and kernel
workspace lock belong to the shared publisher. Keep it on the operator account's
loopback address; it is not a public multiuser administration service.

Reopen with the same retained source and target bindings:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --port 8446
```

Saving a plan copies the reviewed source bytes and a resolved runtime source.
It records the canonical SQLite database path, device and inode. An extraction
opens that original file through the original read-only worker pool. Replacing
the file requires a newly reviewed plan; ordinary committed changes in the same
database are available to a new extraction. A saved plan retains the query and
inputs, while each successful candidate retains its particular result.

## Complete operator workflow

1. **Save the plan.** Select the original named query and its typed input values.
   Choose which approved columns to expose, their dataset types and permitted
   filters, ranges and sorts. Choose extraction ordering, including a unique
   final key for repeatable order between separate extractions. The reviewed
   source hash, query, fixed inputs, output contract and limits are retained.
2. **Extract the whole result.** An original pool worker starts one read-only
   SQLite transaction and reads the approved projection. The parent acknowledges
   each consumed row before the worker sends another. Ordinary query page limits
   do not truncate this export. An explicit `LIMIT` inside the approved SQL still
   defines that query's result. Exceeding the separate extraction limit fails
   the entire candidate.
3. **Inspect the retained data.** The original CSV loader validates every scalar.
   Its original query parser powers preview, filtering, sorting and pagination.
   The candidate records exact native column metadata, transaction settings,
   database identity, counts and source/configuration/CSV hashes.
4. **Review and publish.** Record a reviewer and useful change note. A first
   publication initializes a new original version store. A refresh binds the
   current target snapshot and revision. The original writer refuses an
   intervening target change and keeps the original dataset contract.
5. **Prepare the buyer and keep working.** Load the running seller's actual
   public terms and download its original buyer configuration for the selected
   retained version. New plans and publications use the same history; old buyer
   snapshots and cursors follow the original dataset retention policy.

The shared browser keeps separate saved-plan, extraction and activity pages,
protects unsaved edits, and reopens retained work after a restart. Cancellation
uses the original pool's worker retirement and waits for an already-accepted
consumer write before reporting completion. Failed and interrupted partial
files never become a published dataset. A complete retained candidate can be
reconciled through the existing recovery action without repeating its query.

## Exact SQLite values

SQLite has per-value storage types, so the mapper checks actual native values
for every selected row. Integer reads use `BigInt` inside the worker and across
its existing advanced-serialization IPC. Mapping is explicit:

| Public dataset type | Accepted SQLite values |
| --- | --- |
| Text (`string`) | Native TEXT unchanged, or native INTEGER as its exact decimal string. Use this for 64-bit identifiers and decimal amounts already stored as text. |
| Integer (`integer`) | Native INTEGER within JavaScript's safe integer range. Larger values require Text; they are never rounded. |
| Float (`number`) | Finite native REAL, or a safe native INTEGER. This does not recover precision previously lost by storing a decimal as REAL. |
| Boolean (`boolean`) | Native INTEGER exactly `0` or `1`, converted to the existing CSV `false` or `true`. Other integers and textual booleans are refused. |

BLOB values require an explicit SQL projection such as `hex(payload)` when the
operator intends to expose text. REAL-to-text conversion also belongs in the
approved SQL; selecting Text does not silently stringify every storage type.
SQL NULL requires a nullable column. The existing CSV format uses an empty
nullable cell for NULL, so a real empty string in the same nullable column is
refused. A non-nullable Text column preserves empty strings. String filters and
ordering keep the native dataset's string semantics, including for decimal text.

Default extraction limits are 250,000 rows, 64 MiB of output, 1 MiB of native
value bytes per row, 65,536 characters per cell and 30 seconds. Maximums are
1,000,000 rows, 256 MiB of output, 8 MiB per row, 1,048,576 characters per cell and
300 seconds. The native export counts source value bytes, and the retained CSV
writer independently enforces the same whole-output byte ceiling including CSV
encoding. Header and escaping overhead can therefore reach the limit first.

The original parent enforces the deadline, retires the occupied worker on abort
or timeout, and never replays that extraction automatically. On Node versions
with `database.limits`, the native SQLite length limit is temporarily tightened
before executing the export. On versions with `setAuthorizer`, reads are also
limited to the main database and permitted query operations. Read-only opening,
`query_only=ON`, disabled extensions and the approved SELECT projection apply on
every supported version. Output limits are not a query planner or an absolute
bound on native SQLite computation or memory.

The read transaction verifies `query_only=1` and `read_uncommitted=0`, establishes
its snapshot before yielding a row, and commits only after every row is consumed.
The record identifies that completed transaction; it is not a durable SQLite
snapshot handle. SQLite's journal mode is observed, never changed by extraction.
WAL permits the original read snapshot alongside a concurrent writer. Other
journal modes keep their native locking behavior. See [SQLite isolation](https://www.sqlite.org/isolation.html)
and the [versioned Node SQLite API](https://github.com/nodejs/node/blob/v24.19.0/doc/api/sqlite.md).

## Start the original seller and prepare the buyer

After the first publication, generate the original seller configuration with
the merchant's actual public payment terms and enable retained snapshot selection:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /private/inventory-dataset --payment /private/inventory-payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/inventory-seller.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /private/inventory-dataset --seller /private/inventory-seller.json --port 8423 \
  --control-transport loopback
```

The existing launcher serves payment challenges until its original facilitator
options are configured. Native payment verification, settlement, deployment and
version retention remain in the [original seller guide](../../dataset-refresh/README.md).
The publisher prepares a buyer configuration; it does not authorize or execute
a payment.

Reopen the publisher with the running seller's local address and exact advertised
HTTPS resource:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sqlite/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --port 8446 \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data
```

In **Buyer handoff**, enter a first-page dataset query, load current seller terms,
select the payment alternative and enter the buyer intent ID. The downloaded
configuration is also retained beside that extraction. Open it with the existing
SF88 buyer workspace. The selected snapshot is pinned in its URL; the original
buyer controls consent, execution and retained outcomes.

All original publisher CLI commands are available through this SQLite wrapper.
Run `sqlite/publisher/cli.mjs --help` for plan, extract, inspect, review, publish,
recover and buyer commands. The shared scheduled-publication controller retains
its [existing policy and recovery workflow](../../postgres/publisher/SCHEDULES.md);
opening this workspace does not create an enabled policy.

## Embedding the existing engine

`model.mjs` exports `openSqlitePublisher(options)`, returning the same publisher
operations as the original PostgreSQL model. `source.mjs` adds an operator-only
`exportDataset(name, input, {order, maxRows, maxBytes, maxRowBytes, timeoutMs,
signal, onRow})` operation to the original pool. Its consumer receives native
`row`, actual `columnTypes` and `{rowCount, sourceBytes}` and must finish each row
before the next is delivered. The promise resolves only after transaction commit.
This export is not exposed as a caller-selected HTTP operation.

The common `openSourceDatasetPublisher(options, driver)` seam accepts a trusted
application adapter with `sourceName`, three source-specific schema names and
`capturePlan`, `inspectSource`, `openSource`, `checkColumnTypes`, `encodeRow`, and
`validateExtraction`. The SQLite `driver.mjs` supplies these hooks. Source JSON
and browser requests cannot select an arbitrary driver. Shared plan/review
authority, candidate files, target mutation, history and buyer preparation have
one implementation in `postgres/publisher/model.mjs`.
