# Merchant operations in the managed fleet

The managed fleet opens each running merchant's original operations desk from
the same SF82 session that owns its seller process. All running native sellers
provide the original developer explorer. RPC releases also provide retained
operations history and availability controls. The fleet status identifies the
tools exposed by each running instance.

Start from the existing [fleet bootstrap](BOOTSTRAP.md), or reopen a retained
[release plan](RELEASE_OPERATOR.md). The terminal, managed browser and merchant
MCP all use the same original release manager.

## Browser workspace

```sh
starforge merchant-fleet-workspace \
  --releases /private/fleet/fleet-plan.json \
  --release-state /private/fleet --port 8402
```

In **Managed processes**, find the merchant and slot. Choose **Show merchant
tools**, then open **Developer explorer**, **Operations** or **Manage availability**. The
links belong to the displayed running instance. They open the original merchant
desk in another tab; its queries, history and availability changes continue to
use the original merchant implementation.

The workspace establishes its real loopback listener before starting native
merchant sessions. It supplies that exact origin to the original operations
server, including when `--port 0` selects an available port. Link navigation sends
only this origin as the referrer. Failed startup closes the workspace listener
and the original manager's owned sessions.

When a merchant is retired, replaced or the workspace disconnects, its retained
links disappear from the process table. A newly started instance supplies new
links. Availability changes remain in that immutable release's original native
runtime directory and are reopened by the original merchant.

## Terminal

```sh
starforge fleet-release start \
  --plan /private/fleet/fleet-plan.json --directory /private/fleet
```

Read `status`, then request tools using the exact tenant, slot and `instanceId`
from the running process entry:

```text
operations merchant blue INSTANCE_ID_FROM_STATUS
```

The result includes the current release ID and digest, the original `explorer`
URL and, where the native session provides them, the original
`operations.url`, `operations.availability` and `operations.availabilityControl`.
The final link grants the original availability controls. Use it in the current
operator session. The regular status response and exported fleet report contain
capability flags, while this explicit command returns the private links.

Use the original availability CLI with this returned control URL when terminal
operation is preferred. Its revision checks and original route IDs apply. The
RPC seller guide documents its pause, resume and retained availability workflow.

## Merchant MCP

Initialize the original merchant MCP configuration with the retained fleet plan
and directory, as described in the [MCP fleet guide](../../../stellar-forge/mcp-merchant-operator/FLEET.md).

1. Inspect `merchant_fleet_plan` and start or reopen the plan with
   `merchant_fleet_start` and its exact digest.
2. Read `merchant_fleet_status`. Locate the running tenant/slot, its `instanceId`
   and `operations.available` flag.
3. Call `merchant_fleet_operations` with `{tenant, slot, instanceId}`. It returns
   the original links for the exact instance owned by this MCP process.
4. Use the existing `merchant_fleet_stop`, `merchant_fleet_restart`, release
   replacement and retirement tools for lifecycle changes. Read the current
   instance after each reopen before requesting its links.

The new tool is a read operation. It makes no paid request and does not change
the latest recorded fleet mutation. Availability changes are performed by the
original merchant desk or original availability CLI using the returned control.

## Native API and lifetime

`openFleetReleaseOperator()` accepts an optional `operationsNavigationOrigin`
containing the owning browser's exact `http://127.0.0.1:PORT` origin. It forwards
that value to original SF82 startup. Terminal and MCP callers retain the native
default direct-navigation behavior.

The operator exposes:

```js
const tools = operator.operations({ tenant, slot, instanceId });
```

Its read uses the original manager's in-memory owned session and checks the
exact instance ID. An ended, different or unowned instance returns
`FLEET_RELEASE_SESSION_NOT_OWNED`. A native session without a separate operations
server returns its developer explorer and `operations: null`. The explorer's
original `/_seller/docs` route uses that owned session's listener, checked
against its retained slot port. Historical observations and fleet journals
cannot restore a private control link.

The managed workspace exposes the same operation through its existing private
session API at `GET /api/releases/operations?tenant=...&slot=...&instanceId=...`.
The original workspace session header is required. Ordinary status, retained
plans, fleet mapping journals and exported reports retain only capability flags.

Closing the fleet drains its gateway before closing the owned original seller
sessions. Their operations servers close with those sessions. Reopening uses the
same original retained release mapping and starts new owned instances; the
previous instance IDs remain invalid for tool retrieval.
