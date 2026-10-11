# Stellar Forge portable product release

This adds a usable distribution to the original SF46 release surface. An operator
can move one release directory to another machine, launch the existing seller and
operations together, install successive versions, and return to the previous
version. Merchant configuration, response assets, databases and journals stay in
separate operator directories.

The distribution contains the original committed source from
`scf46-stellar-bazaar/`, `stellar-forge/` and
`stellar/scf-starforge-20261009/`, including shared imports, examples, browser
assets and original licenses. Test directories and `*.test.*` files are omitted.
The builder reads Git objects from one commit. Uncommitted files, local merchant
state, credentials and unrelated projects are never read into the release.

## Build once from a committed checkout

Use Node 22 or newer and Git. Run from the repository root:

```sh
node stellar/scf-starforge-20261009/sf46-release/distribution.mjs pack \
  --source . --out /tmp/stellar-forge-0.1.0 --version 0.1.0
```

The output directory must be new and outside the source checkout. `--ref` accepts
an exact 40-character commit ID; its default is `HEAD`. Commit the distribution
source before building. A release prints its source commit, file count, digest,
versioned installation ID and available commands. The same commit and version
produce the same release digest. Source files retain their original bytes.

The resulting directory is relocatable. It needs neither the original checkout
nor Git at runtime. Archive that complete directory with an ordinary ZIP/tar
tool, transfer it, then extract it before installation. Do not run an archive
extractor as part of an unreviewed remote download command.

## Cold start with the original seller

The starter demonstrates native seller HTTP challenges and its real operations
console using only Node. Run these commands after extracting the bundle:

```sh
node /tmp/stellar-forge-0.1.0/forge.mjs install \
  /tmp/stellar-forge-0.1.0 --home /tmp/stellar-forge-home

cp /tmp/stellar-forge-0.1.0/stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json \
  /tmp/stellar-forge-home/config/seller.json

node /tmp/stellar-forge-home/forge.mjs run operations -- \
  --operations-port 0 -- \
  --config /tmp/stellar-forge-home/config/seller.json --port 0
```

Two original startup messages contain the seller and operations URLs. Open the
operations URL in a browser. The seller's `/dataset` returns HTTP 402;
`/_seller/health` and `/_seller/offers` expose the current local configuration.
The supplied example uses nonpayable demo asset and recipient markers. Replace
the configuration with the merchant's actual approved route terms before using
native payments. Ctrl-C reaches the original launcher's normal shutdown path.

There are two `--` separators in the operations example: the first ends the
distribution's options; the second belongs to the original operations launcher.
Every native argument is forwarded as its own process argument. No shell command
is constructed. Relative configuration paths keep the caller's working directory;
use absolute paths in service configurations and shared runbooks.

## Native commands in one installation

Run `node forge.mjs status` to see the paths present in the selected release.

| Command after `run` | Existing original entry point |
| --- | --- |
| `seller` | SF30 declarative seller |
| `operations` | SF30 seller plus operations console |
| `upstream` | SF30 upstream API seller |
| `openapi` | SF61 OpenAPI compiler |
| `pilot` | SF82 compile/resume seller workflow |
| `pilot-ops` | SF96 original pilot, operations and support workflow |
| `buyer` | SF88 prepare/discover/review/execute CLI |
| `capture` | SF85 real merchant HTTP challenge collector |
| `handoff` | SF96 captured challenge to buyer configuration |
| `support` | SF93 support-bundle exporter |
| `seller-check` | SF96 original seller route audit |
| `dataset` | SF30 CSV schema inspection and immutable seller configuration compiler |
| `dataset-refresh` | Original version store, seller, refresh and activation CLI |
| `dataset-workspace` | Original private dataset preview, retained versions and activation screen |
| `dataset-publisher` | Original CSV upload/publication and selected-offer buyer preparation workspace |
| `catalog`, `catalog-operator` | Same original live catalog control client |
| `catalog-serve` | Original live discovery server and private catalog writer |
| `catalog-withdrawal` | Original SF95 seller withdrawal CLI |
| `buyer-dataset` | Original SF88 dataset acquisition, recovery and native delivery |
| `dataset-delivery` | Original saved-inbox dataset delivery CLI |
| `merchant-fleet` | Original gateway with retained merchant rollout state |
| `merchant-fleet-control` | Original fleet prepare, activate, status and rollback CLI |
| `merchant-fleet-workspace` | Original private fleet workspace |
| `postgres` | Original PostgreSQL seller and operations launcher |
| `postgres-init` | Original create-only PostgreSQL source/service starter |
| `postgres-inspect` | Original PostgreSQL declaration/query inspection |
| `postgres-workspace` | Original database metadata-to-merchant-package workspace |

Dataset, catalog, fleet, `buyer-inbox`, `buyer-runbook`, `deploy` and PostgreSQL
commands are included when their original named CLI files exist in the selected
commit. `status.commands` is the installed release's exact command map. `dataset`
retains its CSV inspection/compiler meaning; use `buyer-dataset` for acquisition
and `dataset-delivery` for saved inbox pages. Other shipped modules remain
importable by their original paths.

Use `buyer-inbox` for the original SF88 queue's selected-intent intake, inspection,
execution and SF82 recovery (`sf88-operator-buyer-cli/QUEUE.md`). Use `buyer-runbook`
for an explicitly selected batch, private config/body snapshots, atomic-string
ceilings grouped by network and asset, sequential original SF88 execution and a
combined offline resource report (`buyer-runbook/README.md`). The inbox executes
one selected intent; the runbook visits only its untouched planned operations.
Both preserve the original SF81 approvals and SF36 ledger authority. Their local
records are workflow state, not additional payment or reservation ledgers.

For an original command's help:

```sh
node /tmp/stellar-forge-home/forge.mjs run buyer -- --help
node /tmp/stellar-forge-home/forge.mjs run pilot-ops -- --help
```

SF88 retains its original buyer settings, controlling-terminal approval, signer,
budget accounting and response-file behavior. A release install or activation
does not add approvals, repeat purchases or grant new authority.

## Installed dataset and catalog workflow

All commands below use the same installed `forge.mjs`, which selects the original
entry point from the active release and forwards its arguments unchanged. Put
the operator's original `csv-dataset.v1` configuration, referenced CSV and public
payment terms under `config/inventory/`; that dataset's relative CSV path resolves
from its own configuration file. Use the merchant's actual public HTTPS origin
in place of `https://api.example`. The source release does not contain those
operator files. Native guides and examples are included below the selected
`releaseDirectory` printed by `status`.

### Initialize and launch the original versioned seller

Run initialization and configuration while the state directory has no live
dataset writer. Configuration output is create-only:

```sh
node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- init \
  --state /tmp/stellar-forge-home/state/inventory \
  --dataset /tmp/stellar-forge-home/config/inventory/dataset.json

node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- configure \
  --state /tmp/stellar-forge-home/state/inventory \
  --payment /tmp/stellar-forge-home/config/inventory/payment.json \
  --origin https://api.example --path /data --snapshot-selection \
  --out /tmp/stellar-forge-home/config/inventory/seller.json

node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- serve \
  --state /tmp/stellar-forge-home/state/inventory \
  --seller /tmp/stellar-forge-home/config/inventory/seller.json --port 8423
```

`--snapshot-selection` uses one of the original route's 32 query parameter slots;
omit it for an existing full contract or a current-and-cursor-only route. The
seller keeps the same native dataset page and payment declarations. Without an
original configured facilitator it serves the existing HTTP 402 challenge mode.
Use the native `--facilitator` option and source-pinned SDK for the merchant's
payment operation.

Private control uses a Unix socket by default. In a local container that supports
loopback TCP, append `--control-transport loopback` to `serve` when that transport
is needed. The original service creates and protects its runtime credential;
the CLI and workspace read it from the same private state directory. Run them
under the same OS user. No credential is entered in a browser or command flag.

### Inspect, preview, refresh and activate

With the seller running, use a second terminal:

```sh
node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- status \
  --state /tmp/stellar-forge-home/state/inventory

node /tmp/stellar-forge-home/forge.mjs run dataset-workspace -- \
  --state /tmp/stellar-forge-home/state/inventory --port 0
```

Open the private URL printed by the original workspace. It reads the running
service's native schema, current snapshot and revision, retained versions,
expiration and cache counts. Preview uses the original typed fields, filters,
ordering and cursors. The default selection is current at request admission;
select a retained snapshot to preview that exact generation. A public request
recipe is available for an explicit selection only when the selected compiled
route advertises `snapshot`. A legacy route still permits private preview while
keeping incompatible public recipes unavailable.

Prepare a new original dataset configuration with the same exposed columns,
filters, sorting and page contract, then use the exact `current` and `revision`
from one current status response:

```sh
node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- refresh \
  --state /tmp/stellar-forge-home/state/inventory \
  --dataset /tmp/stellar-forge-home/config/inventory/next-dataset.json \
  --expect CURRENT_SNAPSHOT_FROM_STATUS --expect-revision REVISION_FROM_STATUS
```

Existing native cursors continue selecting their retained generation. New
unpinned requests select the promoted version. Retention expiration follows the
original configured policy; parsed-cache eviction does not remove a stored
snapshot. Keep the original cursor bytes and query intact throughout pagination.

To return to a stored generation, select it in the workspace and use Activate,
or use the original CLI with a freshly observed current/revision pair:

```sh
node /tmp/stellar-forge-home/forge.mjs run dataset-refresh -- activate \
  --state /tmp/stellar-forge-home/state/inventory \
  --snapshot RETAINED_SNAPSHOT_FROM_STATUS \
  --expect CURRENT_SNAPSHOT_FROM_STATUS --expect-revision REVISION_FROM_STATUS
```

An intervening refresh, collection or activation rejects a stale pair. The
workspace refreshes observed state after that failure and leaves the next write
to a deliberate selection. Dataset activation changes the current data in this
running original service. The installation manager's `activate` and `rollback`
select release code for future launches; they do not change dataset generations.

Original file preview also remains available through
`run dataset-workspace -- --dataset /absolute/dataset.json --port 0`.
See [the native dataset guide](../sf30-seller-sdk/DATASET_API.md) and
[version lifecycle](../sf30-seller-sdk/dataset-refresh/README.md).

### Run live catalog discovery beside the dataset

Use the original policy format and independently established seller public keys
from [the catalog operator guide](../sf60-durable-catalog-transaction/OPERATOR.md).
For a new private journal, start the same catalog writer through the installation:

```sh
node /tmp/stellar-forge-home/forge.mjs run catalog-serve -- \
  --directory /tmp/stellar-forge-home/state/catalog \
  --policy /tmp/stellar-forge-home/config/catalog-policy.json \
  --port 8787 --create-empty
```

Omit `--create-empty` when reopening an existing journal. For its explicit
loopback control transport, append `--control loopback`; this catalog flag is
different from the dataset seller's `--control-transport loopback`. The original
service owns its private control credential and serializes all catalog writes.
Inspect it through the same installed command surface:

```sh
node /tmp/stellar-forge-home/forge.mjs run catalog -- status \
  --directory /tmp/stellar-forge-home/state/catalog

node /tmp/stellar-forge-home/forge.mjs run catalog -- list \
  --directory /tmp/stellar-forge-home/state/catalog --query "limit=20&offset=0"

node /tmp/stellar-forge-home/forge.mjs run dataset-workspace -- \
  --state /tmp/stellar-forge-home/state/inventory \
  --catalog /tmp/stellar-forge-home/state/catalog --port 0
```

The optional catalog panel shows the actual catalog-wide committed status. Use
the original `catalog admit`, `preview-batch`, `apply-batch`,
`prepare-withdrawal` and `apply-withdrawal` commands for received declarations
and seller signatures. `catalog-withdrawal` forwards to the original seller
signing CLI. Dataset refresh does not itself publish a signed listing. Both
servers keep their original SIGINT/SIGTERM shutdown behavior.

### Continue into original buyer acquisition and delivery

Use the exact selected public resource, query and payment alternative with the
original buyer review workflow. The workspace's private preview URL is not a
buyer resource. To publish CSV updates and prepare that buyer operation in the
original publishing screen, use the seller's actual printed loopback origin:

```sh
node /tmp/stellar-forge-home/forge.mjs run dataset-publisher -- \
  --state /tmp/stellar-forge-home/state/inventory \
  --seller http://127.0.0.1:8423 --resource https://api.example/data --port 0
```

Inspect the desired generation and query, load the actual seller offer, choose
its payment alternative, and prepare the original buyer config. The publisher
requires the running route to advertise snapshot selection for this handoff.
The downloaded config preserves the actual offer, resource, payment alternative
and selected snapshot. Save it as `config/dataset-review.json`, then use the
original buyer setup with the actual payer, signer environment and Python path:

```sh
node /tmp/stellar-forge-home/forge.mjs run buyer -- --review \
  --config /tmp/stellar-forge-home/config/dataset-review.json

node /tmp/stellar-forge-home/forge.mjs run buyer -- --init-workspace \
  --config /tmp/stellar-forge-home/config/dataset-review.json \
  --dir /tmp/stellar-forge-home/state/dataset-buyer \
  --actor OPERATOR_ID --service MERCHANT_ID --payer ACTUAL_STELLAR_PUBLIC_KEY \
  --python /absolute/python3 --secret-env EXISTING_SIGNER_SECRET_ENV \
  --total-atomic 20000 --daily-atomic 20000
```

Use the original `--signer-provider` alternative for an existing wallet module.
Choose the actual payer and budget values through that same setup. Initialize a
new private acquisition by attaching the resulting original buyer workspace:

```sh
node /tmp/stellar-forge-home/forge.mjs run buyer-dataset -- init \
  --session /tmp/stellar-forge-home/state/acquisition \
  --workspace /tmp/stellar-forge-home/state/dataset-buyer \
  --max-pages 20 --max-total-atomic 20000

node /tmp/stellar-forge-home/forge.mjs run buyer-dataset -- run \
  --session /tmp/stellar-forge-home/state/acquisition

node /tmp/stellar-forge-home/forge.mjs run buyer-dataset -- deliver \
  --session /tmp/stellar-forge-home/state/acquisition \
  --out /tmp/stellar-forge-home/state/dataset-data-room
```

Choose the page and atomic-unit ceilings for the actual reviewed terms. Original
acquisition owns each page's approval, signer, reservation, saved response and
recovery. Its `status` and offline `recover` preserve the saved intent identity;
`run` resumes only its next untouched page. `deliver` consumes a complete saved
acquisition through native SF100. An existing complete buyer configuration can
still be supplied with `init --config FILE` instead of `--workspace DIR`. The
explicit snapshot query selects the retained generation; a standalone
`--snapshot` acquisition flag only checks the returned generation. The original
seller's expiry and admission rules apply to every new page. For saved inbox intents, use
`dataset-delivery --root ABS --intents ABS --out ABS`. See the source release's
[acquisition guide](../sf88-operator-buyer-cli/DATASETS.md) for its supported
snapshot selection and config/workspace options, and
[saved inbox delivery](../sf88-operator-buyer-cli/DATASET_DELIVERY.md). The
[native publisher guide](../sf30-seller-sdk/dataset-refresh/WORKSPACE.md) explains
offer review and CSV publication in the same running service.

### Retain merchant fleet rollout commands

The same installation includes the original gateway and its private rollout
controller when present in the selected source:

```sh
node /tmp/stellar-forge-home/forge.mjs run merchant-fleet -- \
  --manifest /tmp/stellar-forge-home/config/fleet.json \
  --state /tmp/stellar-forge-home/state/fleet

node /tmp/stellar-forge-home/forge.mjs run merchant-fleet-control -- status \
  --state /tmp/stellar-forge-home/state/fleet

node /tmp/stellar-forge-home/forge.mjs run merchant-fleet-workspace -- \
  --state /tmp/stellar-forge-home/state/fleet --port 0
```

Retained fleet rollout uses the original Linux `flock` owner and native merchant
processes. Its prepare/activate/rollback checks the observed fleet revision;
release selection and dataset generation activation keep their separate original
meanings. The [native fleet guide](../merchant-fleet-gateway/README.md) supplies
the actual manifest and control contract.

## PostgreSQL merchant installation

Current releases include the PostgreSQL source and workspace directly. Their root
`package.json` includes the original source manifest's pinned production drivers
as optional dependencies, alongside the existing optional native payment SDK.
Versions come from that release's exact `postgres/package.json`; PGlite and other
development dependencies are not promoted into the root runtime dependency set.

Use `node forge.mjs status` to find `releaseDirectory`. In that exact selected
release directory, run the existing explicit dependency installation:

```sh
npm install --ignore-scripts --omit=dev
node forge.mjs doctor
```

Doctor reports PostgreSQL driver names, requested and installed versions separately
from native payment packages, with `postgresDriversInstalled` indicating whether
the source-pinned set matches. It does not connect to a database or start a payment
operation. Standard library commands remain usable when optional drivers are absent.

Then run the maintained setup against an existing private source configuration:

```sh
node /tmp/stellar-forge-home/forge.mjs run postgres-init -- \
  --directory /tmp/stellar-forge-home/config/database-merchant

# Configure the existing connection environment and TLS in its source.json.
node /tmp/stellar-forge-home/forge.mjs run postgres-workspace -- \
  --source /tmp/stellar-forge-home/config/database-merchant/source.json \
  --output /tmp/stellar-forge-home/config/merchant-packages

node /tmp/stellar-forge-home/forge.mjs run postgres -- \
  --source /absolute/export/source.json --config /absolute/export/service.json
```

The workspace reads real metadata, takes explicit fields/filters/payment terms,
and exports the original query/seller configuration. The original PostgreSQL
launcher owns seller and operations shutdown. Use its existing `--facilitator`
option when configuring native payment operation. The workspace guide is included
at `stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/workspace/README.md`.

## Upgrade and rollback

Build or obtain a later complete release. Install it beside the current version:

```sh
node /tmp/stellar-forge-0.2.0/forge.mjs install \
  /tmp/stellar-forge-0.2.0 --home /tmp/stellar-forge-home
node /tmp/stellar-forge-home/forge.mjs status
```

The first install becomes active automatically. Subsequent installs are staged.
Use the exact `releaseId` printed by install:

```sh
node /tmp/stellar-forge-home/forge.mjs activate RELEASE_ID
node /tmp/stellar-forge-home/forge.mjs rollback
```

`install ... --activate` combines staging and explicit activation. Local update
contenders publish their own unique ownership records and use ticket ordering to
serialize changes. A concurrent update either obtains its turn or exits with the
current owner's PID; retry after that update exits. Dead owners are detected by
PID, with Linux boot/process-start tokens distinguishing PID reuse. Cleanup only
removes that dead owner's unique record. It never replaces a shared stale lock.
When `/proc` describes a different PID namespace, liveness uses process signaling
without trusting unrelated host process-start tokens.
Use one host's local filesystem with atomic rename and hard-link support; this is
not a distributed lock for homes shared across hosts. An inaccessible or foreign
owner is reported conservatively. A chooser gets five seconds to publish its
ticket before a contender exits, keeping recovery explicit and responsive.

If upgrading a local preview that used `.release-update.lock`, stop all of its
installation managers, remove that obsolete lock, then use this manager for
subsequent updates. Do not mix the preview's lock protocol with current managers.
No live-owner record is automatically removed.

A failed copy is never activated. Source
files are checked before copying and again before the new directory becomes
available. The active pointer is replaced atomically, preserving the previous
release ID. A crash after staging leaves the previous version active; select the
completed version with `activate`. Repeating an install is idempotent. An
interrupted first installation can be resumed with its original release bundle.
While `initializing.json` still identifies that same verified source digest,
retrying from the bundle's `forge.mjs` repairs incomplete local `forge.mjs` and
`release-core.mjs`. Complete bytes are synced to temporary files and renamed
atomically; the installation metadata is committed afterward. Reserved bootstrap
temporary files are cleaned on retry, including a crash before the initial marker
was promoted. This repair is limited to the unfinished first-install bootstrap;
operator configuration and state remain untouched. An installed manager is not
silently replaced by an ordinary release upgrade.

Activation affects **new launches**. Running sellers remain on their original
version. Use the original SF30 graceful shutdown and SF99 host-service operator
procedure when switching a live deployment. The installer neither restarts
services nor changes Caddy/systemd. Rollback changes source selection only; it
does not roll back merchant databases, journals, wallet operations or purchases.
Use the original merchant state recovery workflow when a data recovery is needed.

The home layout is deliberately simple:

| Path | Contents |
| --- | --- |
| `forge.mjs`, `release-core.mjs` | Local installation manager |
| `installation.json`, `active.json` | Installation and active/previous release selection |
| `.release-update-claims/` | Private unique local update contenders |
| `releases/RELEASE_ID/` | Complete versioned source release |
| `config/` | Operator configuration; never rewritten by upgrades |
| `state/` | Merchant operational state; never included in source releases |

There is no automatic deletion of old releases or merchant data. The incoming
bundle's manager can always operate an existing home using `--home`; this is also
the path for future manager upgrades without rewriting a live installation.

## Optional native SDK installation

Challenge-only seller, compilation, review and local operations run without npm.
The generated package declares the same exact x402 version that the committed
original SF30 `native-factory.mjs` declares. At the initial delivery this is
`2.28.0` for `@x402/core`, `@x402/stellar`, `@x402/extensions` and `@x402/fetch`.
This follows the [original pinned first-party package manifest](https://github.com/x402-foundation/x402/blob/7f2b2f1f77fa5317615735e3378a6fad41cccb4e/typescript/packages/mechanisms/stellar/package.json)
and [SF04 dependency inventory](../sf04-protocol-baseline/BASELINE.md).

When a native runtime is needed, install packages in the **selected release
directory** printed by `status`:

```sh
npm install --ignore-scripts --omit=dev
node forge.mjs doctor
```

The installer never runs npm itself. `doctor` reports exact installed versions;
missing optional packages remain visible even if npm tolerated their absence.
Retain the generated `package-lock.json` with your deployment and reuse that
lock for reproducible dependency installation. Dependencies and their separate
licenses remain their upstream authors' work; no upstream tarballs are embedded
in the source release. Native SDK availability is separate from configured
facilitator, signer and successful merchant payment.

## Release checks and trust

`verify` checks every declared file, rejects symlinks, missing/changed files,
unlisted source and malformed manifests. Optional dependencies under
`node_modules/` and the deployment's `package-lock.json` are outside the source
digest and are reported separately. The source digest proves byte consistency;
compare it with the trusted publication when accepting an externally supplied
bundle:

```sh
node forge.mjs verify /path/to/bundle --expect PUBLISHED_SHA256
node forge.mjs install /path/to/bundle --home /private/forge --expect PUBLISHED_SHA256
```

`verify`, `doctor`, `status`, install, activate and rollback make no network calls,
import no payment engine and run no tests. `run` launches only the selected
original command with inherited terminal and normal signal handling. Network,
wallet and merchant behavior comes from that command and its explicit settings.

The delivery was exercised as a single local product flow: committed-source
packaging, cold install, original seller plus operations HTTP challenge, staged
upgrade, activation, rollback, unchanged operator files and corrupt-bundle
rejection. This exercises the distribution; it is not a Stellar settlement or
customer-revenue claim. No GitHub Actions run is needed.

One focused recovery check additionally exercises concurrent update contenders,
a killed owner and interrupted first-install bootstrap repair. It is available as
`node stellar/scf-starforge-20261009/sf46-release/test/recovery-concurrency.test.mjs`;
test directories are excluded from product bundles.
