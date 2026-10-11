# Private merchant fleet workspace

Run the original multi-merchant gateway from one private operator screen. Inspect
serving merchants, prepare a registered configuration, review its retained source
and merchant changes, explicitly activate it, watch earlier requests drain, and
restore a retained revision. Reopen the workspace to recover the gateway's actual
state. The workspace calls `fleetControl` from the original `control.mjs`; the
gateway remains responsible for original seller verification, routing, snapshots,
revision checks, draining and rollback. Optional managed mode also composes the
original SF82 release stores: stage a saved workspace, compare immutable releases,
start a replacement, move traffic, retire its drained predecessor, and restart
exact retained releases for rollback.

## Start with managed merchant releases

Use the [original release operator guide](../RELEASE_OPERATOR.md) to prepare a
fleet release plan with independent SF82 stores and fixed
loopback ports for each merchant's slots. Register saved-workspace package names
in that plan. Each merchant starts from its selected release in `startupSlot`;
replacement slots can initially be empty. The original operator validates that
stores and ports are distinct and that release origins match their merchant.

```bash
node stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs \
  --releases /srv/stellar-fleet/plan.json \
  --release-state /srv/stellar-fleet/operator \
  --port 8402
```

This command owns the original SF82 sessions and gateway in the same process.
The gateway's private control directory defaults to `operator/gateway`; an
optional `--state` selects a separate private gateway directory. The release
operator's own private journal must use a different directory from gateway state.
Stop a separate gateway daemon before starting this managed mode. The existing
state lease prevents two owners of the same original store or gateway state.
Manifest aliases are for the independent gateway mode below; managed mode uses
only its registered original release plan.

1. Select a merchant and a replacement slot in **Prepare a seller release**.
   Inspect its original release catalog. If needed, expand **Stage a new release
   from a saved workspace**, choose a registered package and give it a new
   immutable release ID. This calls the original SF82 staging operation with
   that slot's fixed port; it leaves serving traffic unchanged.
2. Choose **Compare releases**. Inspect the actual original serving and proposed
   routes, exact atomic amount strings, asset, network, recipient, request and
   application configuration, and runtime changes. Source digests bind the
   comparison. The original comparison retains route and payment-option order.
3. Confirm **Start and prepare reviewed release**. The original release manager
   selects and starts that reviewed source on its own port. The original gateway
   checks the running replacement and prepares its retained candidate. Review
   that candidate and separately confirm **Activate reviewed candidate**.
4. Watch admitted requests finish in **Draining generations**. In **Seller
   processes**, use **Retire** when the old exact session is eligible. The native
   gateway operation lock spans the original session close: a concurrent control
   client cannot route traffic to the port between its final drain check and
   shutdown. Current, prepared and still-draining ports cannot be retired.
5. Choose **Review rollback** on a linked retained revision. Inspect original
   before/after releases for every merchant and confirm **Restore reviewed
   releases**. The original operator starts any stopped retained sessions before
   the gateway rechecks and restores its snapshot as a new revision.
6. Reopen the workspace after a normal shutdown. The original operator links its
   retained release mapping to the original gateway snapshot and starts the
   current exact release sessions. Shutdown drains the gateway before stopping
   the original sessions it owns. The workspace does not stop unrelated processes.

Every release review has an expiring ID and a fixed serving revision. The
original operator also checks store generations and immutable source digests.
Changing a selection, replacing a candidate or activating from another session
requires a new review. Browser confirmation sends the reviewed IDs unchanged.
An external native control change outside the retained plan is shown as
**Fleet changed outside plan**; use original control history to restore a linked
revision before managing releases. No browser-selected path, PID, command or
credential reference becomes an operation argument.

## Start with the existing gateway

Use a full checkout, Node 22 or later, and the original Linux gateway with durable
control. Keep the original SF30 seller processes running on their independently
assigned loopback ports. For native payment operation, retain each seller's own
facilitator, handlers and authorized configuration from its original operator
launch. This workspace neither starts a wallet nor changes a payment operation.

```bash
node stellar/scf-starforge-20261009/merchant-fleet-gateway/cli.mjs \
  --manifest /srv/stellar-fleet/current.json \
  --state /srv/stellar-fleet/private-state --port 8400 --admin-port 8401
```

In the same host and network namespace, start the workspace:

```bash
node stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs \
  --state /srv/stellar-fleet/private-state \
  --manifest current=/srv/stellar-fleet/current.json \
  --manifest alpha-update=/srv/stellar-fleet/alpha-update.json \
  --port 8402
```

Open **http://127.0.0.1:8402**. The workspace prints its URL and registered names;
the gateway's private `control.json` capability never enters browser storage,
page URLs or output. Both processes must see the same private state directory.
The existing gateway requires directory mode `0700` and private files `0600`.
Use the exact `127.0.0.1` URL because the workspace checks its local authority.
This listener belongs on the operator host, outside the public Caddy ingress.
It has no remote multiuser login or public reverse-proxy mode.

Manifest registrations are an operator-selected list of at most 32 names. A name
starts with a lowercase letter and contains lowercase letters, digits or hyphens.
The browser sends the name; the process resolves its fixed path. It cannot submit
another path, arbitrary control arguments, shell commands or credential headers.
The original gateway reads each manifest and source configuration at preparation
and retains its snapshot. A changed configuration of an existing seller requires
a replacement seller on a new port, as the original rollout engine enforces.

## Complete operator journey

1. Inspect the active revision and merchants. The table shows current-generation
   requests and all-generation requests separately. The summary also includes
   requests draining for removed merchant authorities. Filter by ID or hostname.
   When original control summaries provide route details, expand the merchant to
   inspect its original methods, URLs and public payment choices. If a complete
   original route list exceeds the control status limit, the page displays a
   notice pointing to that seller's private `/_seller/offers` endpoint. Partial
   payment-choice lists are not presented as complete.
2. Select the named manifest and choose **Prepare for review**. The active fleet
   keeps serving while the original engine checks proposed sellers. A failed
   preparation leaves the active revision unchanged. The resulting candidate
   has an ID, base revision, expiration and retained-source digest.
3. Compare serving and proposed merchants, local ports, route counts and capacity.
   Review added, changed and removed authorities. Preparation opens this review;
   after reopening a page, use **Review candidate** to explicitly select the
   candidate which is currently retained by the gateway.
4. Choose **Activate reviewed candidate** and confirm the exact candidate and
   base revision. That original candidate ID and revision are sent unchanged.
   Another tab's preparation replaces the candidate; another activation changes
   the revision. Refresh invalidates a stale review instead of changing what its
   activation button means. The original backend enforces the same revision and
   candidate checks even if a concurrent change occurs while confirmation is open.
5. Watch **Draining generations**. Existing requests finish against their admitted
   original seller configuration. Keep those original processes available until
   their in-flight counts reach zero. This independent gateway mode leaves their
   process ownership with their existing launcher.
6. Use **Review rollback** on a retained revision to inspect its source digest and
   the expected current revision. Restore the required original seller process
   first if it has stopped. The gateway rechecks that seller before selecting its
   snapshot and creates a new monotonically increasing revision. A snapshot row
   alone cannot make an unavailable original seller run.
7. Stop and restart the workspace freely. It reopens the existing control state,
   history and any currently prepared candidate. Restarting the gateway restores
   its durable active selection and history; its in-memory candidate and draining
   records follow the original gateway's lifetime. No browser-local state claims
   to reconstruct them. Reprepare a candidate after a gateway restart.

## Errors, recovery and operator handoff

The page refreshes status every four seconds while visible. It never polls a
payment endpoint. Successful mutations are followed by a fresh control read,
since the original operation response can capture `busy: true` before its final
cleanup. An unavailable read disables mutation buttons and leaves the last known
state labelled disconnected. On an uncertain operation response, inspect the
actual revision/candidate after refreshing; the workspace never replays a POST.

Revision changes, expired/replaced candidates, changed-seller port reuse and
seller identity drift are surfaced as actionable messages. A generic original
control failure can be inspected with the existing private CLI:

```bash
node stellar/scf-starforge-20261009/merchant-fleet-gateway/control.mjs status \
  --state /srv/stellar-fleet/private-state
```

**Export status** downloads the last observed original status, observation time,
export time, connection state and registered manifest names as JSON. It includes
original source digests, selected revision, retained history and observed counters.
Managed exports also include the observed original release mapping, slot status
and exact owned-session identifiers. The export excludes the gateway capability,
source paths and workspace session key. Use
the existing SF93/SF74 support flow for a broader merchant support package; this
export is a fleet observation, not a settlement or revenue report.

The workspace adds no dependencies, payment retries, chain simulation or hosted
Actions. Independent mode calls the original gateway's private control adapter.
Managed mode delegates release storage, journal recovery and process lifecycle
to the original fleet release operator and SF82 sessions. The browser keeps
only its current review in memory; it never reconstructs an authoritative state
from browser storage or replays a failed mutation automatically.
