# Operate original seller releases as one merchant fleet

The fleet release operator joins the original SF82 release manager to the original
durable gateway. Each merchant has independent release stores on distinct local
ports. One foreground process retains their original SF82 session objects, owns
the gateway, and can stage an application, review its original source and payment
changes, start a replacement, activate its routing, retire the drained seller, and
restart an exact retained seller before routing a rollback.

`release-operator.mjs` is the shared lifecycle API. `release-cli.mjs` is its terminal
entrypoint. The existing fleet browser workspace can consume the same object in
its process. The terminal and workspace are alternative owners of a session; a
second owner cannot acquire the same coordination directory or release stores.

## Prepare the original stores

Use a current complete source checkout or SF46 installed source containing the
original fleet rollout, SF82 workspace staging, cross-store release comparison,
and delegated signal handling. Node 22+ and Linux with `flock` are required. Native
x402 dependencies are the ones installed for the original merchant suite.

Start with actual packages saved by the original SF61 API workspace. Their
`sellerServer` must use the merchant's exact public HTTPS origin. A package is
read and hash-checked by the existing package reader, then compiled and copied
into the existing immutable SF82 release store. Changing the original package
later does not change a staged release.

Initialize separate blue and green stores with the original command. Repeat for
each independent merchant:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs init --store /srv/stellar/alpha/blue
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs init --store /srv/stellar/alpha/green

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \
  --store /srv/stellar/alpha/blue --id first \
  --workspace /srv/stellar/packages/alpha-current --port 8501

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs activate \
  --store /srv/stellar/alpha/blue --id first --expect 0 \
  --reason 'Initial merchant fleet release'
```

The original release CLI also supports explicit OpenAPI/configuration/binding
inputs and trusted handler applications. Those already-staged releases can be
selected by this operator. An empty standby store is sufficient; it can receive
its first saved-package release from the fleet session.

Choose 2–32 merchants and 2–4 stores per merchant in
[`examples/release-plan.json`](examples/release-plan.json). Every store and seller
port is unique across the complete plan. The original gateway requires the
merchant's public origin to equal `https://` followed by its declared host. Each
release's staged runtime port must equal its slot's fixed port. Fixed ports let
the original immutable gateway snapshot address the same seller on rollback.

Plan fields:

| Field | Meaning |
| --- | --- |
| `gateway.port`, `gateway.adminPort` | Distinct loopback ingress and private control ports |
| `tenants[].id`, `host` | Existing independent merchant identity and canonical public DNS host |
| `startupSlot` | Slot whose selected original release starts a new fleet |
| `slots.NAME.store`, `port` | Original SF82 store directory and fixed original seller port |
| `packages.NAME.workspace` | Previously saved original API workspace package directory |
| `packages.NAME.python` | Original Python merchant declaration file, including its chosen interpreter |
| `packages.NAME.pythonRoot` | Optional Python application directory to retain with that declaration |
| `packages.NAME.duckdbPackage` | Original prepared DuckDB package directory with its retained data and plan |
| `packages.NAME.duckdbPython` | Optional executable with DuckDB installed; a pathful relative value resolves from this plan |
| `packages.NAME.s3Package` | Original configured S3 merchant directory with its source, service and object selection |
| `packages.NAME.jsonrpcPackage` | Original prepared Stellar RPC package with its declared methods, networks and provider references |
| `packages.NAME.sqlitePackage` | Original six-file SQLite workbench export referencing the database to snapshot at staging |
| `packages.NAME.sqliteSnapshotMaxBytes` | Optional SQLite capture ceiling, 4096–1099511627776 bytes; default 1073741824 |
| `packages.NAME.sqliteSnapshotTimeoutMs` | Optional SQLite capture deadline, 100–3600000 milliseconds; default 120000 |
| `packages.NAME.mysqlPackage` | Original prepared MySQL or MariaDB package with its named queries and environment references |
| `packages.NAME.postgresPackage` | Original configured, prepared or workspace-exported PostgreSQL merchant directory |
| `packages.NAME.postgresInputManifestSha256` | Optional exact 64-character lowercase manifest hash from the original PostgreSQL review |
| `packages.NAME.clickhousePackage` | Original prepared ClickHouse directory with its source, plan, bindings and generated client |
| `packages.NAME.clickhouseColumnTypes` | Optional original native review: query names mapped to ordered `{name,type}` output columns |
| `packages.NAME.runtime` | Original facilitator/local-upstream runtime choices for future staging |
| `limits` | Original gateway admission, body, response and timeout limits for this merchant |

Relative paths resolve against the plan file. The service resolves and deduplicates
the actual store directories. Browser actions supply only registered tenant, slot
and package names plus an original release ID. They never supply a path, handler
module, executable, port override, credential or PID.

Each package chooses exactly one of `workspace`, `python`, `duckdbPackage`,
`s3Package`, `jsonrpcPackage`, `sqlitePackage`, `mysqlPackage`, `postgresPackage`, or `clickhousePackage`.
`pythonRoot` belongs to `python`; `duckdbPython` belongs to `duckdbPackage`.
Both SQLite snapshot limits belong to `sqlitePackage`, at the package level.
`postgresInputManifestSha256` belongs only to `postgresPackage`; its original
stage compares the reviewed manifest before retaining the package.
The reviewed `clickhouseColumnTypes` map belongs only to `clickhousePackage`.
Its original release engine verifies the complete ordered map against the
prepared named queries and checks the actual database types before every start.
The native packages supply their original application bindings.
Use `allowLoopbackUpstream` for an API workspace or Stellar RPC package with explicitly declared local upstreams.
Existing workspace-only plans retain their normalized fields and plan digest.

### Bring a reviewed PostgreSQL merchant into the fleet

The original PostgreSQL workspace and Seller releases console both provide
**Download fleet source** after their native package review. The download carries
`postgresPackage`, `postgresInputManifestSha256` and the selected facilitator
settings. Its canonical host path comes from the native preparation result,
including when the console was given a relative path. The fixed seller port is
omitted because each fleet slot already owns its port.

Import that JSON into the intended source card at `/fleet.html`. The card keeps
its existing alias such as `current` or `next` and shows the original reviewed
manifest. Choose the exact package host, complete the remaining merchants and
export the normal launch packet. Its original setup, managed workspace and MCP
commands all use the same retained fleet directory and plan.

Every new stage compares the package with the selected manifest before capture.
If the package changed, review it in the original authoring workspace or console
and import the new source into a new registered alias. Keep existing aliases for
already selected releases. The original adapter retains the named queries,
bindings, connection policy, selected CA and exact payment alternatives. Provide
the source's configured PostgreSQL environment references on the merchant host.

Use the existing fleet stage, compare, prepare, activate, drain, retire and
rollback actions. Original query and execution changes remain available in the
comparison, alongside exact payment changes. Closing the managed workspace,
fleet CLI or fleet MCP cancels an in-progress native package capture before it
waits for the owning operation. Already committed release IDs remain in their
original stores. Reopening and rollback use those retained files even after the
authoring package moves; they continue reading the live database.

### Bring a reviewed ClickHouse merchant into the fleet

Prepare the source through the original ClickHouse workspace. Import its source
JSON into the intended source card at `/fleet.html`, retaining the existing alias
such as `current` or `next`. The source definition carries `clickhousePackage`,
its optional `clickhouseColumnTypes` review and the selected facilitator runtime.
Review the package path on the target host, the ordered schema shown in the card,
and that merchant's exact public host before exporting the launch packet.

The original `fleet-release setup` or later `stage` operation retains all ten
prepared files using the ClickHouse release adapter. Endpoint, user and password
values come from the environment variables named by that source on the merchant
host. The original engine owns query, memory, scan, concurrency and result limits.
The fleet assigns each original seller its declared slot port and supplies the
same runtime to its managed browser and MCP.

ClickHouse reads the live database. A release rollback restores its retained query
contracts, payment terms and generated client. The native output-schema review
continues to be checked against the current database; a changed type requires a
new native review and source package. Stage that new package under a new alias and
release ID, then use the existing review, prepare, activate, drain and rollback
commands. Already-staged releases survive relocation of the original prepared
directory.

### Operate Python and DuckDB merchants together

[`examples/native-release-plan.json`](examples/native-release-plan.json) declares
two independent merchants, each with blue/green stores and current/next source
aliases. The data merchant uses original prepared DuckDB packages. The analysis
merchant uses Python declarations and their application directories. Set the
original DuckDB plan and Python declaration public origins to the exact declared
merchant hosts before preparing or staging them.

Initialize all four original release stores. Stage and select the initial release
in each blue store with the existing release CLI, for example:

```sh
starforge releases stage --store /srv/stellar/data/blue --id first \
  --duckdb-package /srv/stellar/packages/data-current \
  --duckdb-python /srv/stellar/python/bin/python --port 8521 \
  --facilitator https://facilitator.example
starforge releases activate --store /srv/stellar/data/blue --id first \
  --expect 0 --reason 'Initial data merchant'

starforge releases stage --store /srv/stellar/analysis/blue --id first \
  --python /srv/stellar/packages/analysis-current/merchant.json \
  --python-root /srv/stellar/packages/analysis-current/application --port 8531 \
  --facilitator https://facilitator.example
starforge releases activate --store /srv/stellar/analysis/blue --id first \
  --expect 0 --reason 'Initial analysis merchant'
```

The foreground fleet CLI and browser start with the same plan as above. Inside
that session, `stage data green next second` and
`stage analysis green next second` use the declared original source engines.
The browser labels each alias and retained release with its source type. Compare,
prepare, activate, drain and retire each replacement through the same controls.
Original comparisons retain query/data/application identities and exact payment
changes; private interpreter locations are represented by an opaque selection
digest. Rollback and process restart reopen the retained release copies, so the
original source package may subsequently move. The selected Python executable
and its installed dependencies remain available on the host.

For the existing merchant MCP provider, configure this same fleet plan through
`merchant-mcp init-fleet` as documented in its fleet guide.
`merchant_fleet_plan` and live fleet status include `packageSources` with each
alias and source kind; the existing `packages` alias list stays compatible.
`merchant_fleet_stage` accepts the same tenant, slot, package and release ID for
all registered native source types. The host plan owns their source paths, interpreter choices,
fixed ports and runtime settings throughout the lifecycle.

### SQLite snapshots and live MySQL sources

Register original database packages in each merchant's `packages` map:

```json
{
  "snapshot": {
    "sqlitePackage": "./packages/inventory-export",
    "sqliteSnapshotMaxBytes": 268435456,
    "sqliteSnapshotTimeoutMs": 120000,
    "runtime": { "facilitator": "https://facilitator.example" }
  },
  "live": {
    "mysqlPackage": "./packages/catalog-prepared",
    "runtime": { "facilitator": "https://facilitator.example" }
  }
}
```

A SQLite package is the original workbench's six-file export: `manifest.json`,
`source.json`, `service.json`, `handlers.mjs`, `launch.mjs`, and `RUN.md`. Its
referenced database must remain readable until staging finishes. The original
SF82 engine captures one committed view, including committed WAL changes, and
retains that snapshot with the compiled named queries and payment terms. Later
database writes become visible only after staging and activating a new release.
The two capture limits use the original `sqliteSnapshotOptions` validator; the
normalized plan retains their effective values. They do not change request-time
gateway limits. SQLite uses the original Node `node:sqlite` worker.

MySQL uses the original prepared source, named queries, payment terms, generated
client, and package-local CA if configured. Staging retains those package bytes.
At runtime the original MySQL adapter resolves the declared connection references
from the host environment and reads live MySQL or MariaDB data. Provide its
existing `mysql2` dependency and declared password environment variable to every
foreground owner. Credentials stay outside the declaration and retained release.
Moving the prepared source directory after staging preserves the retained release;
the running MySQL service still requires its configured database to be available.

Browser source cards and `merchant_fleet_plan.packageSources` distinguish
`SQLITE_MERCHANT_PACKAGE` from `MYSQL_MERCHANT_PACKAGE`. Stage either alias through
the ordinary fleet action, review its exact source and offer changes, then use
the same prepare, activate, drain, retire, and rollback controls.

Native payment mode is selected by the original release runtime. To stage native
releases from a registered package, configure that package's runtime:

```json
{
  "workspace": "/srv/stellar/packages/alpha-updated",
  "runtime": { "facilitator": "https://facilitator.example" }
}
```

Provide original upstream and signing environment references in the launcher's
environment using the existing merchant configuration. Without a facilitator,
the original release is `CHALLENGE_ONLY`. The fleet never creates wallets, signs
payments, retries purchases or changes payment requirements.

## Start one complete foreground session

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/release-cli.mjs start \
  --plan /srv/stellar/fleet-plan.json \
  --directory /srv/stellar/private-fleet-operator \
  --state /srv/stellar/private-fleet-gateway
```

Both private directories use mode 0700 and owned metadata files use 0600. They
must be separate because the original gateway and the release operator retain
their own existing Linux state leases. If `--state` is omitted, the gateway state
is under the operator directory's `gateway` subdirectory.

For a new fleet, the operator inspects each startup slot's selected immutable
release, starts it through `runActiveRelease`, constructs the native manifest
from its released `seller-service.json`, and starts the existing gateway. The
gateway reads the actual original health and offers endpoints before serving.

For an existing fleet, its retained routing selection is authoritative. The
operator restores the exact linked store, release digest and fixed port before
starting the original gateway. A stopped original release is reselected with the
existing SF82 generation check. Its original source and current launch-time
environment are used. Another manager's running or orphaned child remains owned
by the original release manager; this operator does not adopt or kill it.

The session prints the public loopback URL and structured status. Use the
existing SF99/Caddy deployment for HTTPS termination. Keep private gateway and
workspace ports off that public proxy. Configuration, original release stores
and fleet state stay outside a replaceable SF46 software release directory.

## Stage, compare, replace and retire

The following are commands inside the foreground terminal. In the browser
workspace, the same lifecycle object accepts the corresponding explicit actions.

```text
catalog alpha green
stage alpha green updated second
review alpha green second
```

The review is the original SF82 comparison between the currently serving release
in blue and the candidate release in green. It includes exact public method,
URL, atomic payment strings, application/request hashes, original upstream
configuration and runtime changes. Private handler and state-directory paths are
hidden while their source identities and original change records remain. The
review also displays the existing gateway limits for that merchant.

Review IDs expire after ten minutes. They bind the exact original release digests,
the selected store generations, and the current gateway revision and digest.
Prepare the reviewed source with the returned ID:

```text
prepare REVIEW_ID
```

Preparation selects and starts only the original replacement release on its
distinct slot port, verifies its returned source and listener identity, and calls
the existing gateway's prepare action. The returned native candidate includes
its own fifteen-minute expiry, exact base revision and source digest. Existing
merchants continue to serve while the candidate is reviewed.

```text
activate CANDIDATE_ID REVISION
status
```

Activation submits the original candidate ID and expected revision. Native
rollout atomically changes request admission and retains existing requests on
their captured old seller. No child is stopped as an implicit consequence of
activation. The status reports, separately for each original slot, whether it is
serving, present in the prepared candidate, draining exact-port requests, or
eligible for retirement.

When the old slot is eligible, use its current returned instance ID and the
current gateway revision:

```text
retire alpha blue INSTANCE_ID REVISION
```

Retirement uses the original gateway's routing mutex across the original SF82
session's `close()` call. It rejects a currently serving or prepared port and any
retired generation still carrying requests for that exact port. Another control
client cannot reactivate it during the stop. The instance ID must belong to the
session this process actually started. Unrelated traffic on the replacement's
port does not prevent retirement of the drained old process.

If preparation fails after starting a replacement, the original selected store
and owned session remain visible. Refresh status. A replacement no longer
referenced by routing or a prepared candidate can be explicitly retired. A newer
review and prepare may reuse the same exact already-running release. No failed
request automatically stops a seller or replays a mutation.

## Restore a retained original release

```text
review-rollback 1
rollback REVIEW_ID
status
```

The first command compares every current merchant against the requested native
retained revision using the same original SF82 comparator. The second starts any
stopped original seller from its exact linked store/release/digest and fixed port,
then invokes the original gateway rollback. Rollback creates a new native
revision. The outgoing replacement can drain and be explicitly retired in the
same way as a forward replacement.

The operator keeps source links for the gateway's retained history and any
longer-running draining generations. It never deletes original release stores,
configuration, response files or source. If a slot has since been reused by a
different running release, retire that unused owned session first. A currently
serving slot cannot be overwritten in place; use its other released slot to move
traffic before restoring an older release on the original fixed port.

Changes made through another original gateway control client remain subject to
native revision checks. A rollback to an already-linked immutable snapshot can
be reconciled from its exact snapshot identity. A newly activated snapshot from
an unrelated manifest has no original release-store association here; status
shows that distinction instead of guessing a store from a shared host or port.

## Restart and shutdown

`quit`, end of input, SIGINT and SIGTERM close gateway admission and await its
existing drain, then call each retained original SF82 session's `close()`.
When a SQLite stage is capturing data, shutdown first cancels that owned stage
through the original `AbortSignal`. The native capture worker exits and removes
its uncommitted output before the operator closes its release stores and lease.
Merchant MCP forwards this cancellation before awaiting its serialized call.
After reopening, retry the same package and release ID; an already committed
release remains in the original catalog and an interrupted stage can run again.
`handleSignals: false` delegates the original per-seller signal handling to this
composed owner. No PID file is used as permission to stop a process.

Restart with the same plan and directories. The original gateway snapshot and the
operator's source links restore the selected fleet. The plan's resolved scope is
bound to that coordination directory; deployment aliases, ports and gateway
limits cannot silently change underneath a retained revision. Create a separately
reviewed deployment when changing that scope. Applications and prices evolve by
staging new releases in the registered stores.

A mutation can succeed before an HTTP response or local link write is observed.
The operator retains its intended candidate or rollback digest before dispatch.
A later status or restart matches that exact native revision and snapshot to the
saved source links. It never automatically resends the mutation. If an original
prepare response is uncertain, refresh the native candidate and make an explicit
new review/prepare; the replacement remains owned and visible.

## Embed the original lifecycle

```js
import { openFleetReleaseOperator } from './release-operator.mjs';

const operator = await openFleetReleaseOperator({
  planFile: '/srv/stellar/fleet-plan.json',
  directory: '/srv/stellar/private-fleet-operator',
  gatewayStateDirectory: '/srv/stellar/private-fleet-gateway',
});
const current = await operator.status();
const catalog = await operator.catalog({ tenant: 'alpha', slot: 'green' });
// The existing workspace renders current/catalog and submits explicit actions.
// On owned workspace shutdown:
await operator.close();
```

`stateDirectory` and `gatewayStateDirectory` both identify the original gateway
control directory. `publicURL` is the original ingress listener. `status()` retains
native gateway status under `native` and adds declared aliases, current store
selections, owned session identities, exact-port retirement eligibility and
retained source links. `catalog()` reads original release metadata on demand.
Mutating methods are serialized; private filesystem paths never come from method
arguments. The browser server supplies its existing origin/session protections.
