# Refresh a paid CSV dataset while buyers finish their current pages

This extends the **existing SF30 CSV Dataset API** with versioned publication.
Operators can publish new rows without restarting the seller. A buyer who already
has an original `page.nextCursor` continues reading the same retained snapshot;
a new query reads the new snapshot. Operators can also select a retained version
without locating its source CSV again, with a revision check against intervening
changes. Both use the original CSV parser, typed
projection, equality/range indexes, stable sorting, filter checks and
`stellar-forge.dataset-page.v1` response.

The runtime composes `loadDatasetConfig()`, `buildDatasetSellerConfig()` and
`startSellerService()`. It leaves the native x402 verification and settlement
implementation, payment amounts, public route and response format unchanged.
This directory adds a private version store and its operator control path.

## Start a versioned seller

Run from the repository root on Linux or macOS with Node 22 or later. Use a full
checkout so the original seller and metadata modules are available. The examples
below assume your operator-owned dataset config and payment terms already exist.
The original [CSV guide](../DATASET_API.md) explains their formats.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs init \
  --state /srv/dataset-state --dataset /srv/inventory/dataset.json \
  --retention-seconds 3600 --max-versions 4 --max-retained-bytes 268435456

node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /srv/dataset-state --payment /srv/inventory/payment.json \
  --origin https://your-api.example --path /data --out /srv/inventory/seller.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /srv/dataset-state --seller /srv/inventory/seller.json --port 8423 \
  --max-cached-versions 2 --max-resident-rows 1000000
```

`init` copies and validates the CSV into a private generation. `configure` writes
a create-only config through the original dataset seller compiler. `serve`
starts the original seller in challenge-only mode, including its health, offers
and developer portal. As with ordinary SF30, handlers run only after native
payment verification. To enable payments, use the existing official x402
dependencies and add `--facilitator https://your-facilitator.example/facilitator`.
The original native factory remains responsible for verification and settlement.
An explicitly local facilitator additionally needs `--allow-local-facilitator`.
The launcher also forwards `--max-in-flight` and `--drain-grace-ms` to the original
seller lifecycle, retaining the current capacity and graceful shutdown behavior.

The public HTTP listener stays on `127.0.0.1`, behind the operator's existing
HTTPS proxy. Dataset mutation is available only through a Unix domain socket
inside the private state directory. There is no public refresh endpoint.
The state directory must have mode `0700`; files and the socket use `0600`.
Use a short state path because operating systems limit Unix socket path length.

For Windows or containers that do not support Unix listeners, add
`--control-transport loopback`. This starts a **separate** control listener on an
OS-assigned `127.0.0.1` port. Both transports require a random 256-bit bearer
capability stored only in private `control.json`; the CLI reads it automatically.
The loopback listener also checks its exact Host and rejects browser Origin and
Fetch Metadata headers. Its descriptor and capability are never printed by
`status`, returned by the public API or added to the seller config. The client
always connects to `127.0.0.1` regardless of descriptor content. Keep this control
listener out of the public proxy.

## Publish a new generation

Prepare a new original dataset config and CSV. Keep exposed columns, types,
filter definitions, default/max page limits and ordering identical. Source rows
may change. The staging process reads a stable file descriptor, copies its bytes,
detects a source file modified during the copy and then invokes the **original**
loader on that immutable copy. Invalid CSV leaves the current generation active.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs status \
  --state /srv/dataset-state

node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs refresh \
  --state /srv/dataset-state --dataset /srv/inventory/next-dataset.json \
  --expect CURRENT_SNAPSHOT_FROM_STATUS --expect-revision REVISION_FROM_STATUS
```

Use the exact current 64-character snapshot and integer revision from the same
`status` result. The serialized writer checks both before staging. The revision
also detects a change from A to B and back to A, or an intervening collection,
which a snapshot-only comparison cannot detect. Older callers that supply only
`expectedSnapshot` retain that original comparison; supply `expectedRevision`
for the stronger check. A repeated identical update returns `changed: false` and
keeps the revision. Reusing identical CSV with conflicting runtime settings is
rejected.

Promotion writes and fsyncs the generation, then atomically replaces and fsyncs
`state.json`. The preceding generation receives a retention expiry measured from
its retirement. New queries use the promoted snapshot; an existing cursor selects
its own retained snapshot. The original loader then checks the complete cursor,
including fields, filters and offset. Changing a cursor's filter or field
selection is still an error.

Changing a dataset's advertised query contract requires a separate appropriately
configured route. `DATASET_CONTRACT_CHANGED` leaves this route's data and payment
terms intact. This runtime does not silently rewrite the Bazaar offer or seller
price during a data refresh.

## Activate a retained version or roll back a publication

Inspect `status` and choose one of its still-stored snapshot IDs. Activation uses
that immutable generation's captured config and CSV; it does not need the
operator's original input files or repeat a publication copy.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs activate \
  --state /srv/dataset-state --snapshot RETAINED_SNAPSHOT_FROM_STATUS \
  --expect CURRENT_SNAPSHOT_FROM_STATUS --expect-revision REVISION_FROM_STATUS
```

Both comparisons are required for this new command. The original loader checks
the selected stored generation before promotion. The selected version becomes
current, the preceding current version receives the existing retention period,
and the state revision advances atomically. Selecting the already-current version
is a no-op after both comparisons pass. Price, route and exposed query contract
stay the same.

Activation is an explicit operator action: it can select an expired generation
that is still present in `status`, before collection removes it. A normal buyer
request never extends retention. A collected generation cannot be activated; use
the ordinary `refresh` command with a new original dataset source if it must be
published again.

## Optional first-page snapshot selection

The existing configuration continues to select the current version at admission
when there is no cursor. To let a buyer explicitly select a retained version for
the first page, generate its config with `--snapshot-selection`:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /srv/dataset-state --payment /srv/inventory/payment.json \
  --origin https://your-api.example --path /data \
  --snapshot-selection --out /srv/inventory/version-selectable-seller.json
```

This advertises one optional string query parameter, `snapshot`, without a
default or required value. It uses one of the original seller's 32 metadata
parameter slots. A dataset already using all 32 can keep its original config and
cursor continuity; it cannot advertise this additional parameter at that same
contract size. Config generation remains create-only and runs while the store is
offline.

A request such as `/data?snapshot=RETAINED_SHA256&limit=20` starts at that version's
first page. Subsequent pages use the original cursor unchanged. Supplying both a
cursor and `snapshot` requires them to name the same version. The selector is
removed before the original CSV query parser, so it does not change any cursor,
query hash, filter, range, sort or returned dataset-page bytes. Omitting it does
not pin an old metadata example: that request selects the current generation at
admission. Expired or unknown versions follow the existing preverification 410
response.

The launcher enables this selector only on dataset routes whose definition or
imported-offer schema advertises it as optional string metadata without a default.
It returns a preverification 400 for `snapshot` on an ordinary dataset route.
Existing saved seller configurations therefore keep their declared behavior.

## Request continuity and retention

SF30 intentionally runs application admission on a **copy** of the HTTP request.
A WeakMap keyed only by the admission object would lose the selection before the
handler runs. This integration wraps the original request dispatcher in
`AsyncLocalStorage`, pins the selected original dataset during admission and uses
the same dataset after asynchronous native verification. Updating the store
between those stages cannot switch the admitted request to a new generation.

The old snapshot remains available for its configured retention period. A request
admitted before expiry can complete on its pinned dataset. After expiry, new
native requests using that cursor return HTTP `410 DATASET_SNAPSHOT_EXPIRED`
**before native verification**, so the buyer can start a new query. The response
for an unknown snapshot uses the same code. Challenge-only SF30 continues to
advertise its normal payment metadata; actual admission happens when the native
runtime is enabled.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs collect \
  --state /srv/dataset-state
```

Collection deletes only expired noncurrent generations with no active HTTP
readers. Refresh collects such generations before checking capacity. Current
data is never collected. A refresh that would exceed `maxVersions` or
`maxRetainedBytes` returns `DATASET_RETENTION_CAPACITY` instead of dropping a
still-protected buyer snapshot. Choose retention and capacity for the expected
update interval; a four-version, one-hour policy cannot continuously accept a
fifth protected generation within that hour. Once old retention periods end,
collection or the next refresh recovers the capacity.

`maxRetainedBytes` counts original CSV bytes, **not JavaScript heap bytes**. Parsed
objects and indexes also consume memory. At most 16 versions may be retained; the
default is four. The original loader's row, cell, page and file bounds still apply.

### Bound parsed data separately from stored versions

The launcher keeps a least-recently-used cache of parsed original datasets.
`--max-cached-versions` defaults to 2 (range 1–16), and `--max-resident-rows`
defaults to 1,000,000 (range 1–16,000,000). These are runtime settings, so they can
be changed when restarting without rewriting the store's retention settings.
The active dataset must fit the row budget. A refresh or activation that would
make a larger dataset current is refused before promotion.

An idle parsed version may be evicted and reloaded through the original loader
when its cursor is requested. Eviction never deletes an immutable CSV or changes
its expiry. `status.cache` reports the limits and current parsed totals, while
each version reports `resident`, `readers` and `loading` separately from its
stored row count. Startup still validates every retained generation through the
original loader, one at a time, and leaves the current version warm.

Active request pins cannot be evicted. A pin lasts until both the original HTTP
dispatcher and the response finish, including accepted work completing after a
disconnect. A cold load also keeps its generation out of collection until loading
finishes. If active requests occupy all cache capacity, a request for a cold
generation returns **429 `DATASET_CACHE_CAPACITY` before native verification**,
with `Retry-After: 1`. No buyer's pinned generation is dropped to make room.
Publication can make the new current version cold until that capacity returns.

The row budget bounds cached original datasets, including their active reader
pins. It is not a byte-accurate process heap limit: field widths, native indexes,
request pages and garbage collection also affect memory. Staging or validating an
operator-selected generation temporarily holds one original-loader candidate in
addition to the cache; file and per-dataset parser limits still bound that work.
Choose both row and source-byte limits for the actual merchant dataset.

## Restart and operational use

Stop the process with SIGTERM or SIGINT, then run the same `serve` command.
The original seller closes before the version writer releases its state. On
restart, retained immutable generations are reopened through the original loader;
their snapshot, config digest, stored manifest and contract must match. A cursor
therefore retains its identity across restart until its stored expiry.

A process writer lock prevents two sellers from mutating the same store.
The next process automatically reclaims a lock whose recorded process has died.
An existing live process is reported as `DATASET_WRITER_RUNNING`. A terminated
write can leave a complete generation before pointer promotion; it can be reused
only after its original dataset identity is validated. Incomplete staging
directories are removed on reopening. Never hand-edit the generation files.

`status` returns current/revision, configured retention, source byte totals,
generation snapshot IDs, row counts, expiry, active reader/loading counts and
parsed-cache totals. It returns
no dataset rows or original source paths. `configure` and `init` are offline
operations; running `status`, `refresh`, `activate` and `collect` use the active private socket.
If an operator request loses its connection, inspect `status` before retrying a
change; use the exact `--expect` and `--expect-revision` pair when deciding whether
the operation already completed or needs a new request.

The control socket follows the filesystem owner's authorization. Keep the entire
state directory off the public reverse proxy and out of source control. The
stored CSV includes its source columns, while the original loader exposes only
the operator-declared columns in paid responses.

## Embed in another original seller launcher

```js
import { openDatasetVersions } from './versions.mjs';
import { startVersionedDatasetSeller } from './service.mjs';

const versions = await openDatasetVersions({
  directory: '/srv/dataset-state', maxCachedVersions: 2, maxResidentRows: 1000000,
});
const service = await startVersionedDatasetSeller({
  versions,
  config, // The original SF30 config generated above.
  port: 8423,
  nativeFactory, // The original native factory or an operator-configured wrapper.
});
// service.close() closes control, original seller and version store in that order.
```

The wrapper retains other static routes and supplied handler exports. Dataset
routes must use GET with `queryDataset` and `admitDataset`. It wraps the original
server's existing request listener immediately after startup, preserving its
health, developer portal, native payment logic and lifecycle behavior. For a
custom HTTP composition, call `versions.wrapRequest(originalHandler)` around
the original SF30 handler and bind `versions.admit` / `versions.handle` directly.
Calling the handlers outside that request scope is rejected rather than guessing
which version admission selected.

`versions.admit()` and `versions.handle()` are asynchronous so a cold retained
generation can load before verification. `describe()` and `status()` remain
synchronous and return detached metadata. `refresh({ configPath,
expectedSnapshot, expectedRevision })` and `activate({ snapshot,
expectedSnapshot, expectedRevision })` use the same serialized writer and atomic
state publication. Activation requires the revision; refresh keeps the older
snapshot-only API for compatibility. Direct custom HTTP compositions that expose
the optional selector can append the exported `DATASET_SNAPSHOT_PARAMETER` to
their original definition; pass `{ allowSnapshot: false }` as the second handler
argument for routes that do not advertise it.

## Focused integration exercise

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/acceptance.mjs
# In containers without Unix socket support:
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/acceptance.mjs --loopback-control
```

The exercise uses actual original SF30 HTTP dispatch, admission copying, CSV
loader, indexed range/sort cursor, private control transport and disk restart. Native interface outcomes
are locally controlled to pause verification across a refresh and inspect the
unchanged payment tuple. It covers prior-page continuity, contract and stale
operator rejection, retention capacity, expiry before verification, active reader
collection and restart continuation. It needs no package installation or hosted
Actions and does not make a wallet or network settlement.
