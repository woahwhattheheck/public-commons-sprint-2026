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
| `packages.NAME.runtime` | Original facilitator/local-upstream runtime choices for future staging |
| `limits` | Original gateway admission, body, response and timeout limits for this merchant |

Relative paths resolve against the plan file. The service resolves and deduplicates
the actual store directories. Browser actions supply only registered tenant, slot
and package names plus an original release ID. They never supply a path, handler
module, executable, port override, credential or PID.

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
