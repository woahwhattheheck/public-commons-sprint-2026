# Operate a merchant fleet through MCP

The existing merchant MCP provider can operate the complete retained fleet: inspect its configured tenants and packages, start the original merchant sessions and gateway, stage and review a replacement, prepare and activate it, let original requests drain, retire the old process, and restore a retained revision. The same configuration and MCP connection can also retain the existing individual merchant, catalog, cache and Python operations.

The fleet uses the original [release operator](../../stellar/scf-starforge-20261009/merchant-fleet-gateway/RELEASE_OPERATOR.md), SF82 stores and child sessions, and durable gateway. This adapter provides their MCP entry points and process ownership. The original runtime owns release selection, immutable snapshots, traffic routing, review generations, drain state, rollback history and restart reconciliation.

## Configure the host

Prepare the fleet's original release stores and plan using the release-operator guide. The existing plan declares two or more tenants, their public hosts, independently owned release slots, listener ports, prepared package aliases and operating limits. Each startup slot needs an active original release. Other slots can be empty until an agent stages one of the declared packages.

Use the installed `merchant-mcp` command to initialize a provider for that fleet:

```sh
merchant-mcp init-fleet \
  --dir /private/fleet-mcp \
  --plan /private/merchant-fleet/fleet-plan.json \
  --fleet-directory /private/merchant-fleet \
  --name "Merchant fleet"
```

From a complete source checkout, the equivalent is:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-fleet \
  --dir /private/fleet-mcp \
  --plan /private/merchant-fleet/fleet-plan.json \
  --fleet-directory /private/merchant-fleet
```

This checks the original plan and stores, creates a new private MCP configuration, and leaves the fleet stopped. It initializes an empty individual release store and export directory so the same provider remains compatible with existing merchant operations. No individual source alias is required for a fleet-only host.

For a fleet prepared with the original [retained setup command](../../stellar/scf-starforge-20261009/merchant-fleet-gateway/BOOTSTRAP.md), pass its setup directory through `--fleet-directory`. This reuses its published plan, selected releases, routing history and state leases. The explicit directory resolves from the invoking host's working directory. Omitting the option preserves the existing initialization behavior: the new MCP configuration uses its own `./fleet` subdirectory.

To initialize both a normal merchant source and a fleet, add `--fleet-plan ORIGINAL_PLAN.json` to the existing `init` command. Existing configurations can declare the same optional connection directly:

```json
{
  "fleet": {
    "planFile": "/private/merchant-fleet/fleet-plan.json",
    "directory": "/private/merchant-fleet/release-operator",
    "gatewayStateDirectory": "/private/merchant-fleet/gateway"
  }
}
```

This is a member of the existing `stellar-forge.merchant-mcp.v1` configuration, alongside its name, releaseStore, exportsDirectory and sources. Paths are host configuration and resolve relative to that configuration file. `gatewayStateDirectory` is optional; its default is the `gateway` subdirectory of the original operator directory. The individual merchant release store must be separate from all fleet slots.

For a previously operated CLI/browser fleet, use its original plan, release-operator directory and gateway-state directory together. Stop its current owner before starting the MCP-owned fleet. The original state lease prevents two managers from opening those same stores concurrently.

## Connect the existing MCP transport

The provider uses its existing authenticated HTTP and subprocess transports. Follow [STDIO.md](STDIO.md) to register the installed subprocess command with the MCP host, or run from source:

```sh
node stellar-forge/mcp-merchant-operator/stdio.mjs \
  --config /private/fleet-mcp/merchant-mcp.json
```

The subprocess transport creates its private loopback authentication internally. The existing `serve --config ...` command remains available for a host that supplies its configured bearer environment variable. Backend/facilitator settings and any needed credential environment remain those of the original retained packages and host.

Connecting MCP does not start a merchant fleet. `merchant_fleet_status` initially returns `configured: true`, `running: false` and no manager ID. Read `merchant_fleet_plan` to see the plan digest, public hosts, slot names, listener ports, package aliases and limits. The response omits private plan, store and package paths.

## Complete release workflow

| Operation | Input and result |
|---|---|
| `merchant_fleet_plan` | No arguments. Returns the original resolved plan's digest and public operating aliases. |
| `merchant_fleet_status` | No arguments. Returns this process's `managerId`, current native revision, exact releases, candidates, retained history, request counts and `canRetire` for each slot. |
| `merchant_fleet_start` | Supply `expectedPlanDigest` from the plan. Opens the original retained mapping and starts its selected sessions and gateway. |
| `merchant_fleet_catalog` | Supply `tenant` and `slot`. Returns that original store's retained releases and selection generation. |
| `merchant_fleet_stage` | Supply `tenant`, `slot`, `package` and a new `releaseId`. Uses the configured package alias to create an immutable original release. |
| `merchant_fleet_review` | Supply `tenant`, replacement `slot` and `releaseId`. Returns the original exact comparison, base revision and a short-lived `reviewId`. |
| `merchant_fleet_prepare` | Supply that `reviewId`. Starts the reviewed target and returns its native `candidateId` and `expectedRevision`. |
| `merchant_fleet_activate` | Supply that candidate ID and expected revision. Atomically activates the prepared native mapping. |
| `merchant_fleet_rollback_review` | Supply a `targetRevision` from retained native history. Returns comparisons and a new rollback `reviewId`. |
| `merchant_fleet_rollback` | Supply that rollback review ID. Reopens required retained sessions and restores their mapping as a new native revision. |
| `merchant_fleet_retire` | Supply `tenant`, `slot`, its current child `instanceId`, and the fleet's `expectedRevision`. Closes it only after native routing and drain checks pass. |
| `merchant_fleet_stop` | Supply this MCP process's current `managerId`. Drains the gateway, closes owned merchant sessions and retains original state. |
| `merchant_fleet_restart` | Supply the current `managerId` and inspected `expectedPlanDigest`. Drains the owned fleet and reopens its retained mapping. |

For example, when the actual plan lists tenant `alpha`, a `green` slot and an `updated` package, stage the replacement:

```json
{
  "tenant": "alpha",
  "slot": "green",
  "package": "updated",
  "releaseId": "october-update"
}
```

Review that exact tenant/slot/release with `merchant_fleet_review`. Inspect its native route, amount, application and source changes. Use the returned review ID for prepare, and the returned candidate ID and revision for activation. These identifiers come from the running original runtime; they are not reconstructed from filenames or port numbers.

After activation, new requests use the new release. Already accepted requests continue on their original generation. Use `merchant_fleet_status` to observe the old slot. Once `canRetire` is true, retire its exact child instance at the current revision. The native routing mutex covers the entire child close, so another native control operation cannot start routing to that port between the check and retirement.

Rollback has its own review. Select an actual retained revision, review every affected tenant, and execute the returned rollback review ID. The original operator verifies source identities and restarts any needed retained session. It then records a new current revision; it does not erase the later releases or their history.

## Ownership, interrupted requests and reopening

`managerId` identifies this MCP process's fleet lifecycle. A slot's `instanceId` identifies its original SF82 child. Stop/restart requires the former; slot retirement requires the latter. Both change when their respective original process is reopened. An earlier connection's identifier cannot stop the current one.

The plan digest is checked inside the original fleet factory before a session is started. Restart also checks it before draining the existing fleet. A changed plan, store generation, candidate, fleet revision or source identity produces the original error and leaves its observable state available. Review identifiers are short-lived and consumed on use; obtain a new review against current state after an unsuccessful or stale operation.

The existing merchant provider serializes admitted changes across both individual-merchant and fleet operations. Read-only status remains available while a change is in progress. Original store and gateway locks still protect operations performed by other native control clients.

If a transport response is lost or an MCP wait is cancelled, the admitted native operation may finish. Refresh `merchant_fleet_status`, its selected release catalog and retained revision history before making another change. A native `FLEET_RELEASE_OUTCOME_UNKNOWN` reports that uncertainty explicitly. The adapter never resends a mutation automatically.

Disconnecting or stopping the MCP process drains its owned original gateway before closing merchant children. On a new connection the fleet starts stopped. Read the current plan and call start with its digest to reopen the retained mapping. This uses the original `links.json` and gateway snapshot state, including their existing interruption reconciliation.

If shutdown reports cleanup errors after the native listeners have closed, status retains `STOPPED_WITH_ERRORS`; it does not claim a clean stop. A restart that drains successfully but cannot reopen reports `STOPPED_START_FAILED`. The next operation uses the actual original state and locks rather than an invented successful outcome.

## Source and exercised behavior

`fleet.mjs` defines the 13 fleet tools and delegates them to the existing release operator. `config.mjs`, `operator.mjs` and `serve.mjs` compose host configuration, original provider serialization and startup. The same provider exposes the existing 17 individual merchant/catalog/cache operations. No new transport or runtime dependency is required.

The complete native subprocess journey used the actual SF61 package builder, four SF82 release stores, two merchant hosts and the original gateway. It exercised MCP initialization and all fleet tools; stale plan/review/candidate rejection; an in-flight request that retained its old 20,000-atomic-unit challenge while new traffic received 30,000; refused retirement during drain; exact retirement and rollback; owned restart; a new MCP process reopening revision 3; and MCP shutdown waiting for the original request to finish. Tool responses contained no private host paths. The journey made no chain submission or hosted Actions run. Actual payment behavior remains the original seller/facilitator's responsibility.
