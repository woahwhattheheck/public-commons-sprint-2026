# Deploy a managed merchant fleet

Run the existing managed fleet and its private operator workspace as one durable
Linux service. A reviewed deployment declaration generates Caddy ingress,
systemd, an optional Docker Compose service, a private source/configuration
manifest, and the original encrypted recovery plan. The original release operator
continues to own every SF82 seller session, slot, lease, upgrade and rollback.

This is the deployed form of the fleet initialized in [BOOTSTRAP.md](BOOTSTRAP.md).
It supports the same 2–32 merchants with 2–4 declared slots per merchant. Use the
existing [release workspace](workspace/README.md) to operate the running service.
The separate [SF99 host](../sf99-merchant-deploy/README.md) deploys one merchant.

## Declare the existing fleet

Complete the original bootstrap first. Keep the fleet manager, gateway state and
all slot stores under one service-owned private state root. Source, environment
values and deployment bundles have separate locations. The following declaration
uses an already initialized `/srv/starforge/fleet/fleet-plan.json`:

```json
{
  "schema": "stellar-forge.fleet-host.v1",
  "fleet": "merchant-services",
  "planFile": "/srv/starforge/fleet/fleet-plan.json",
  "stateRoot": "/srv/starforge/fleet",
  "releaseDirectory": "/srv/starforge/fleet",
  "gatewayStateDirectory": "/srv/starforge/fleet/gateway",
  "workspacePort": 8402,
  "serviceUser": "stellar-fleet",
  "serviceGroup": "stellar-fleet",
  "serviceUid": 1001,
  "serviceGid": 1001,
  "node": "/usr/bin/node",
  "environmentFile": "/srv/starforge/config/fleet.env",
  "stopSeconds": 180,
  "readOnlyRoots": ["/srv/starforge/packages"],
  "recoveryRoots": [
    {"name": "merchantAssets", "path": "/srv/starforge/assets"}
  ]
}
```

Replace the account IDs and paths with the actual installed account and fleet.
The generator checks the original plan using `readFleetReleasePlan`; all gateway,
admin, workspace and slot ports must be distinct and unprivileged. Original store
directories must belong to the selected service UID. `serviceUid` and
`serviceGid` default to the state root's existing owner; the service names are
always explicit. Runtime startup requires that actual UID and GID.

`readOnlyRoots` supplies additional real file or directory bindings for Compose,
such as prepared package inputs and existing provider runtimes. They retain their
original absolute locations. Include the original Python environment and its
runtime closure when an image does not already provide those declared paths.
Existing package aliases still belong to the original plan; new staging reads
those same registered paths. The source tree is bound separately and remains
immutable throughout a running deployment.

The optional `environmentFile` uses Node's native `.env` syntax and
`process.loadEnvFile`. Both systemd and Compose use this same parser. Keep the
file at 0600 under the service UID, outside source and state. Existing process
environment values take precedence. Inspection and bundle generation check its
metadata while leaving its values in the original file. Environment changes
take effect through an explicit service restart.

`recoveryRoots` adds up to 16 selected external data or asset roots to the original
SF101 recovery plan. The fleet state, original plan and deployment declaration
are included automatically, without overlapping roots. Select files needed by
your particular native merchants; external databases retain their own native
backup procedure. `stopSeconds` is the service manager's graceful shutdown
allowance, from 90 to 3600 seconds. Choose it for the original providers' shutdown
behavior; the default is 180 seconds.

## Generate and inspect

From the complete selected original source, run:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/deploy-cli.mjs inspect \
  --declaration /srv/starforge/config/fleet-host.json
node stellar/scf-starforge-20261009/merchant-fleet-gateway/deploy-cli.mjs generate \
  --declaration /srv/starforge/config/fleet-host.json \
  --out /srv/starforge/deployments/fleet-001
node stellar/scf-starforge-20261009/merchant-fleet-gateway/deploy-cli.mjs check \
  --bundle /srv/starforge/deployments/fleet-001
```

The installed source package exposes the same command as
`starforge merchant-fleet-host`; its public imports are
`@tokenjunkielabs/starforge-merchant/merchant/fleet/host` and
`@tokenjunkielabs/starforge-merchant/merchant/fleet/host-runtime`.
The existing portable launcher consumes the same maintained command catalog.

The bundle is created exclusively in a new private directory. It contains:

| File | Purpose |
| --- | --- |
| `fleet-deployment.json` | Original plan digest, source entries, service identity and generated file hashes |
| `stellar-forge-fleet-NAME.service` | One native managed workspace/fleet service |
| `Caddyfile` | Exact declared merchant authorities forwarded to the original loopback gateway |
| `compose.json` | The optional selected runtime image and exact mounts |
| `recovery-plan.json` | Original SF101 logical roots for quiesced encrypted capture |
| `RUNBOOK.md` | Concrete installation, health, operator access, drain, upgrade and recovery commands |

The source and declaration hashes cover the listed entry modules and original
plan. Use an immutable selected full source release for their transitive imports
and installed native dependencies. A changed declaration, source entry or plan
requires a new generated bundle. Live release activation uses the same plan and
continues through the existing operator normally.

## Install the native service

Follow the generated `RUNBOOK.md` for the exact service name, identity and paths.
Its installation makes the bundle root-owned and readable by the service group,
then runs the original preflight as the actual unprivileged account. The service
receives a read-only system view with writes limited to the declared state root.
Linux `flock`, Node 22.16 or newer, and the original merchant provider dependencies
must be installed on the host.

The runtime imports `startFleetWorkspace` in managed mode. Its original
`openFleetReleaseOperator` starts each selected SF82 session and the gateway.
All original handles remain in that foreground process. The service has no
interactive stdin dependency, so closing a launch terminal leaves the managed
service available.

The health command reads the running workspace's original session and status
endpoints. It checks the retained plan digest, linked revision, merchant IDs and
hosts, and each serving slot's actual owned instance and configured port. Output
contains a concise merchant and release summary. The private workspace session
value is used only in memory for the original status request.

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/deploy-runtime.mjs health \
  --bundle /srv/starforge/deployments/fleet-001
```

## Operate the existing private workspace

Open its printed `http://127.0.0.1:PORT` URL on the host. For an existing remote
SSH host, forward the **same port** to local loopback:

```sh
ssh -N -L 127.0.0.1:8402:127.0.0.1:8402 YOUR_EXISTING_HOST_ALIAS
```

Use `http://127.0.0.1:8402` locally. The unchanged port preserves the workspace's
original Host/Origin checks and the merchant explorer's navigation origin. The
generated public ingress contains only the exact merchant hostnames and original
gateway port. The operator workspace and gateway control stay on loopback.

Stage and review releases, compare complete original payment choices, prepare and
activate candidates, inspect each current seller's operations, wait for drain,
retire the original instance, and roll back through this same workspace. The
original [RELEASE_OPERATOR.md](RELEASE_OPERATOR.md) describes those operations.
The service owns the fleet lease; stop it before handing that state to the
terminal or MCP's existing foreground owner.

## Choose Docker Compose on a Linux host

Add this optional object to the deployment declaration, using your already
prepared image's actual immutable identity:

```json
{
  "container": {
    "image": "YOUR_EXISTING_IMAGE@sha256:YOUR_ACTUAL_64_CHARACTER_DIGEST",
    "node": "/usr/local/bin/node"
  }
}
```

An immutable local `sha256:...` image ID is also accepted. The example marker
must be replaced with the actual ID before generation. The image contains Node,
Linux `flock`, and the original Python/provider runtimes at their declared
locations. The generated Compose installation uses that cached image with
`pull_policy: never`, one unprivileged service, exact read-only code/configuration
bindings, and the original writable state root. The existing image preparation
workflow can supply this runtime without a separate fleet package builder.

Linux host networking keeps the gateway, workspace and all seller slots in the
same loopback namespace. The service retains the original in-process release
ownership; it is not replicated per slot. Compose provides init, signal forwarding,
a derived stop grace period, and a health command against the running original
workspace. Its private temporary filesystem is limited to 64 MiB, and local logs
rotate at 10 MiB with three files. Dollar signs in declaration paths are escaped
once for Compose interpolation; values are not passed through a shell.

Use the generated `up --wait`, status, log and stop commands in the runbook.
Choose systemd or Compose for one state root and use the original lease to keep
one active owner. Both selections use the same native runtime and environment
parser. Existing merchant DNS and the host's Caddy installation supply HTTPS.

## Shutdown, recovery and upgrades

Withdraw this fleet's ingress through the existing proxy operation and stop its
selected service manager. The original workspace cancels an owned pending stage
and waits for active operations; its original gateway finishes admitted requests
before closing the original seller handles. SIGINT and SIGTERM join the same
close operation, including when received during startup.

Once the service and selected external writers have stopped, use the generated
SF101 snapshot, verification and restoration commands. Restoration creates a new
authenticated private directory. The runbook maps each restored logical root back
to its exact original absolute location. On a replacement host, install the same
source/runtime, place the restored state at those absent original paths, restore
service ownership, reapply the existing private environment, generate the bundle,
and reopen. Original slot paths and the fleet plan digest retain their identities.
The original release mapping and revision history govern continued operation.

For a code upgrade, stage the selected source through the existing distributor,
generate a new host bundle, drain the current service, install the new service or
image selection, check the original health, then restore ingress. To return to a
previous source release, use its compatible generated bundle against the same
current original state. Merchant release rollback stays an explicit operation in
the existing managed workspace.

## Integration API

`deploy.mjs` exports `prepareFleetDeployment(declarationFile, { sourceRoot })`,
`generateFleetDeployment(declarationFile, output, options)`, and
`checkFleetBundle(bundle)`. Inspection returns normalized deployment information;
the checker additionally returns the original parsed `plan`. Rendering helpers
provide the Caddy fragment, systemd unit and optional Compose object.

`deploy-runtime.mjs` exports `runFleetDeployment({ bundle, handleSignals })` and
`fleetDeploymentHealth(bundle)`. The returned running handle exposes the original
workspace/merchant ingress, its initial health, one idempotent `close()`, and a
`completion` promise. Embedded hosts can set `handleSignals: false` and own signal
delivery themselves. The private workspace passes `expectedPlanDigest` to the
existing release operator and includes that original digest in its status reply.

Underlying runtime contracts: [Docker Compose services](https://docs.docker.com/reference/compose-file/services/),
[Compose interpolation](https://docs.docker.com/reference/compose-file/interpolation/),
[Linux host networking](https://docs.docker.com/engine/network/drivers/host/),
[Node environment loading](https://nodejs.org/docs/latest-v24.x/api/process.html#processloadenvfilepath),
and [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
