# Refresh a paid CSV dataset while buyers finish their current pages

This extends the **existing SF30 CSV Dataset API** with versioned publication.
Operators can publish new rows without restarting the seller. A buyer who already
has an original `page.nextCursor` continues reading the same retained snapshot;
a new query reads the new snapshot. Both use the original CSV parser, typed
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
  --state /srv/dataset-state --seller /srv/inventory/seller.json --port 8423
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
  --expect CURRENT_SNAPSHOT_FROM_STATUS
```

Use the exact current 64-character snapshot from `status` for `--expect`. The
serialized writer checks it before staging, so a second operator cannot silently
replace an intervening update. A repeated identical update returns `changed:
false`. Reusing identical CSV with conflicting runtime settings is rejected.

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
objects and indexes also consume memory. The original loader's row, cell, page
and file bounds still apply. At most 16 versions may be retained; the default is
four. Staging temporarily holds one candidate in addition to retained datasets.

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
generation snapshot IDs, row counts, expiry and active reader counts. It returns
no dataset rows or original source paths. `configure` and `init` are offline
operations; running `status`, `refresh` and `collect` use the active private socket.
If an operator request loses its connection, inspect `status` before retrying a
refresh; the exact `--expect` value prevents replay from replacing another update.

The control socket follows the filesystem owner's authorization. Keep the entire
state directory off the public reverse proxy and out of source control. The
stored CSV includes its source columns, while the original loader exposes only
the operator-declared columns in paid responses.

## Embed in another original seller launcher

```js
import { openDatasetVersions } from './versions.mjs';
import { startVersionedDatasetSeller } from './service.mjs';

const versions = await openDatasetVersions({ directory: '/srv/dataset-state' });
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
