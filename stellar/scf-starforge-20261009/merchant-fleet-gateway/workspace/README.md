# Private merchant fleet workspace

Run the original multi-merchant gateway from one private operator screen. Inspect
serving merchants, prepare a registered configuration, review its retained source
and merchant changes, explicitly activate it, watch earlier requests drain, and
restore a retained revision. Reopen the workspace to recover the gateway's actual
state. The workspace calls `fleetControl` from the original `control.mjs`; the
gateway remains responsible for original seller verification, routing, snapshots,
revision checks, draining and rollback.

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
   inspect its original methods, URLs and public payment choices.
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
   their in-flight counts reach zero; the workspace does not terminate them.
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
It excludes the gateway capability, source paths and workspace session key. Use
the existing SF93/SF74 support flow for a broader merchant support package; this
export is a fleet observation, not a settlement or revenue report.

The workspace is an additive consumer of the existing gateway release. It adds
no dependencies, persistence engine, automatic seller restart, payment retry,
chain simulation or hosted Actions. Its local operation uses only the original
gateway's private status/prepare/activate/rollback API and original snapshots.
