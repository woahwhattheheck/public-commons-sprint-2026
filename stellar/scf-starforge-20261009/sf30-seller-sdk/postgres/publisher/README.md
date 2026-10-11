# Publish PostgreSQL results as retained merchant datasets

An approved PostgreSQL query can now feed the original versioned SF30 dataset
seller without an operator hand-exporting CSV. One extraction captures its result
inside the original `REPEATABLE READ READ ONLY` transaction. The operator reviews
the typed rows, then publishes that exact candidate through the existing dataset
writer. Buyers retain the original snapshot and cursor while the database and
current published version change.

This local workflow composes the maintained PostgreSQL source, CSV loader,
dataset version store and SF88 buyer preparation. It introduces no SQL service,
payment engine, version engine or automatic publication schedule.

## Start and reopen

Use Linux, Node 22.16+, util-linux `flock`, and the original PostgreSQL package's
pinned `pg` and `pg-cursor` dependencies. The full maintained source/distribution
must include the existing dataset and buyer modules. The browser needs no package
installation, external script or external font.

Use the private `source.json` already produced by the original
[merchant workspace](../workspace/README.md), [preparation command](../PREPARE.md)
or [source starter](../README.md). From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --create \
  --source /private/merchant-postgres/source.json \
  --state /private/inventory-dataset --port 8442
```

Open the printed loopback URL. The target may be an already-running original
dataset seller's state directory, or a new directory that does not exist yet.
The publisher workspace itself must be new when `--create` is used. Source JSON
and referenced CA files are private regular files; directories use mode 0700.

Reopen the same workspace without `--create`:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --port 8442
```

Source and target path bindings are retained. New plans can capture a revised
source file; older plans keep their original bytes and resolved CA. Database
credential environment references stay references. Actual environment values are
resolved only for an explicit extraction and are not persisted or sent to the UI.

The browser is for the local operator account. Keep its listener and private
state off the public proxy. It has no account/login flow; it checks exact local
origin and JSON writes. A kernel file lock gives one process ownership of the
workspace. Stop the server before opening this same workspace with another CLI.

## The complete operator flow

1. **Save a plan.** Select an approved query, enter its existing scalar parameters,
   and choose the public column types, filters, ranges and sorts. Use the target's
   maintained dataset name and page limits. Choose extraction ordering from
   approved columns; include a unique final key for repeatable order across
   separate extractions. Saving retains the reviewed source revision.
2. **Extract.** The original pool preflights the query and reads cursor batches
   inside one read-only repeatable-read transaction. Cancellation, connection
   retirement and shutdown use the original source lifecycle. A type, row, byte
   or deadline failure never becomes a successful partial candidate.
3. **Inspect.** The original CSV loader validates every captured scalar and
   capability. Preview uses its original native query parser and page response.
   Row count, size, hashes, native column types and transaction snapshot remain
   with the candidate. Subsequent database changes do not alter it.
4. **Review.** Record the operator name and a useful change note. A running target
   review binds the displayed current snapshot and revision and requires its
   original dataset contract. A new target requires an initialization review.
5. **Publish.** The original control invokes refresh with the exact reviewed
   current/revision pair. Existing buyer snapshots remain subject to the native
   retention policy. Intervening publication, rollback or collection requires a
   fresh review; no newer generation is silently overwritten.

The approved SQL defines the result, including any explicit SQL filter,
aggregation or `LIMIT`. The separate extraction limit applies to that whole
result: one extra row rejects the candidate instead of silently truncating data.

Saved plans, extractions and activity have independent Older/Newer navigation;
the list page size changes how much is displayed, not what is retained. Switching
to another plan asks before discarding unsaved edits. Cancelling that switch or
refreshing status leaves the form intact. The browser also warns before leaving
an unsaved form.

State-changing workspace operations share one mutation guard through their
asynchronous work. A second review or publication cannot replace a review while
its candidate is being checked or promoted. Source, target and candidate
inspection remain available during an operation.

## Exact scalar mapping

The PostgreSQL source provides its original text values and actual type OIDs.
The publisher uses the existing dataset's four scalar types:

| Dataset type | Retained PostgreSQL meaning |
| --- | --- |
| `string` | Exact native text. Use for arbitrary-precision decimal amounts, large integers, timestamps, UUID, JSON and other textual representations. |
| `integer` | Native int2/int4/int8, only if every value fits JavaScript's safe integer range. Larger values require text and are never rounded. |
| `number` | Finite native float4/float8. PostgreSQL numeric is refused for this mapping; keep it as text. |
| `boolean` | Native PostgreSQL boolean, translating t/f to the existing CSV true/false representation. |

A SQL NULL requires a nullable column. The original CSV loader uses an empty
nullable cell for NULL; a real empty string in the same nullable column is
therefore rejected instead of silently changed. A non-nullable text column keeps
its empty strings. Express the intended semantics in the approved SQL and mapping.

Native string range/sort behavior remains string ordering. Declaring a decimal
as text does not imply numeric ordering. Original field projection, filters,
query budget, cursor bytes and payment terms remain unchanged.

Default extraction limits are 250,000 rows, 64 MiB of CSV, 1 MiB of text per
database row, 65,536 characters per cell and 30 seconds. Limits can reach
1,000,000 rows, 256 MiB of CSV, 8 MiB per row and 300 seconds. Oversized row values
are suppressed inside PostgreSQL before driver transfer, then the export fails
in full. Query plans, role privileges and database resource controls still govern
database work; output limits alone do not bound its memory or CPU.

PostgreSQL repeatable read takes its stable view at the first non-transaction-control
statement. The retained metadata identifies that extraction transaction, not a
permanent database snapshot. See the [official isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)
and the [original cursor API](https://node-postgres.com/apis/cursor).

## Initialize the original seller and prepare the buyer

A first publication initializes a new original version store. Use the existing
dataset commands and the merchant's actual public payment terms to start it:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /private/inventory-dataset --payment /private/inventory-payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/inventory-seller.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /private/inventory-dataset --seller /private/inventory-seller.json --port 8423
```

The original launcher is challenge-only unless its existing facilitator options
are supplied. Configure the real trusted native facilitator and existing HTTPS
deployment when enabling payments. The [original version-store guide](../../dataset-refresh/README.md)
owns retention, activation, capacity, collection and deployment instructions.

Once that seller runs, enable the publisher's buyer handoff with its actual local
address and exact advertised resource:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs serve \
  --workspace /private/inventory-publications \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data
```

The interface checks the original target's compiled resource/snapshot selector,
previews the selected retained version through native control, and loads the
actual seller health and offers. Choose a first-page query and payment
alternative, then download original SF88 configuration. Preparation reloads the
offer and refuses changed terms; its exact config is retained with the extraction.
This handoff is not spending authorization.

Use the existing [SF88 workspace and dataset acquisition flow](../../../sf88-operator-buyer-cli/DATASETS.md)
for initial config review, signer setup, approval, execution and recovery. After
the existing buyer workspace is initialized from the downloaded config:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs init \
  --session /private/inventory-acquisition --workspace /private/buyer \
  --max-pages 20 --max-total-atomic 20000
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs run \
  --session /private/inventory-acquisition
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs deliver \
  --session /private/inventory-acquisition --out /private/inventory-delivery
```

Substitute actual approved paths and limits. Native SF100 owns the CSV/JSONL
delivery. This source does not install a second buyer runner; previously accepted
buyer execution and exporter journeys remain reusable.

## Recovery

SQLite retains plans, extraction states, named reviews, publication outcomes and
activity. Complete CSV/config/manifest artifacts are immutable per run. Startup
does not repeat a query or publication.

| State | Useful operator action |
| --- | --- |
| EXTRACTING | Inspect progress, wait or cancel. The current merchant version remains available. |
| READY | Inspect, record the current target-bound review, then publish. |
| FAILED / CANCELLED | Inspect the error and correct the plan/workload before a new extraction. Partial files cannot be published. |
| INTERRUPTED | Reconcile retained output. A complete committed candidate can be recovered from its original manifest without another database query. Otherwise start a new extraction. |
| REVIEWED | Publish using the exact review ID. The original writer refuses a changed target. |
| PUBLICATION_UNKNOWN | Reconcile with the original target. If this candidate is active, record the observed state; otherwise review the displayed target before another explicit publication. |
| PUBLISHED | Hand off the retained version or extract the next source revision. |

An observed-active recovery records the version currently in the original store
without attributing an unobserved earlier transition. A named operator review is
not a customer signature or commercial acceptance. The original version writer
remains publication authority.

SIGTERM/SIGINT stops new requests, cancels active extraction, drains the original
database source and closes state. The kernel lock releases on close or process
death. Back up publisher and target state through the operator's established
process. Keep both outside source control. Historical candidates are retained;
this product installs no automatic deletion task.

## CLI and embedding

`node postgres/publisher/cli.mjs --help` lists source, template, save, extract,
inspect, review, publish, recover and buyer actions. Template creates a private
draft from an approved query; enter real parameter values and review mappings
before save. Extract waits for its one explicit run. Buyer without an intent
only reads current terms; with an intent, option and displayed offer hash it
writes the native config.

Status accepts `--limit` (1–100), `--plans-offset`, `--runs-offset` and
`--history-offset`. The returned `pages` object includes each total, current
offset and next/previous offsets. The loopback `/api/status` uses `limit`,
`plansOffset`, `runsOffset` and `historyOffset` query parameters; the embedding
API accepts the same keys in `publisher.status(options)`.

```js
import { openPostgresPublisher } from './publisher/model.mjs';
const publisher = await openPostgresPublisher({ directory: '/private/inventory-publications' });
const run = await publisher.startExtraction(savedPlanId).completion;
const candidate = await publisher.inspect(run.id);
// Operator reviews publisher.target(), then explicitly publishes using the
// recorded review ID. No automatic promotion occurs here.
await publisher.close();
```

Original `createPostgresQuerySource()` adds local `exportDataset(name, input,
{order, maxRows, maxBytes, maxRowBytes, timeoutMs, signal, onRow})`. Each callback
gets a projected text/null row, actual field OIDs and progress. The returned
promise resolves only after commit. It shares the original pool/queue/transaction
and close lifecycle; ordinary paid query/route results and limits are unchanged.
No HTTP request parameter can select this operator API.

Distribution owners retain the whole original postgres component, including
publisher/public assets, with its maintained SF30, dataset-refresh and SF88/SF100
closure. Optional command: `postgres-publisher` → `postgres/publisher/cli.mjs`.
No additional npm dependency, container image, hosted Actions or periodic task
is required.

## Exercised operator workflow

The complete local workflow was exercised on 2026-10-11 with Node 24.19,
PostgreSQL 18.3 through PGlite 0.5.8 TCP, the pinned native `pg`/`pg-cursor`
drivers and Chromium. The browser saved a plan, extracted 12 rows, reviewed and
published the candidate, and downloaded the existing SF88 buyer configuration.
After the database changed, a second extraction and publication became current
while the original SF31 buyer finished three pages of the earlier 12-row version.
The original SF100 exporter produced the retained CSV/JSONL delivery with exact
large integer and decimal text, typed booleans, integers and nulls.

The same retained workspace exercised cancelled dirty-form navigation, history
pagination and reopening without replaying extraction. The ordinary PostgreSQL
query retained its two-row limit. Native payment-interface outcomes were
controlled locally; the buyer consumed actual original HTTP dataset responses,
and no wallet or blockchain transaction was performed. A focused check of the
changed cursor shutdown path then returned `CLOSED`, zero active/pending jobs
and no remaining timeout resources, without repeating browser publication.
