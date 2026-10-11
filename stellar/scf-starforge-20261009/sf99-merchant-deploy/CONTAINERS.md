# Merchant container deployment

Deploy the original API, paid-file, or retained-release merchant in one Linux
container. SF99 keeps the original seller, delivery, receiver, release store,
discovery identity, operation journals, and Caddy route selection. The container
supervisor starts and drains that selected process group.

Start with the merchant's existing
[host plan](README.md). The container specification selects its immutable image,
numeric runtime identity, and source bindings. Generation writes a new private
bundle with `container.json`, `compose.json`, and the original host bundle in
`host/`. The original host manifest and recovery plan remain the authority for
service arguments, selected input bytes, merchant state, and recovery roots.

An existing maintained `starforge` installation reaches this same CLI through
`starforge merchant-host container ...`. The original distribution includes the
complete SF99 directory; select a package release containing these container
modules when preparing an image with baked source.

The [container operations guide](OPERATE_CONTAINERS.md) covers the integrated
`pull`, `up`, `status`, `stop`, `logs`, and `smoke` commands. They pin the saved
merchant project explicitly; status, logs, and drain remain available after live
input drift while startup checks the complete current selection.

## Prepare the operator host and image

Use a Linux host with an existing Docker Engine and Compose plugin, a working
local daemon, and the merchant's existing Caddy installation. Host networking
keeps the original `127.0.0.1` listeners reachable by Caddy on that same host.
Each merchant needs its own original listener ports.

The selected immutable image must contain the exact absolute Node and Python
executables selected by the host plan, Linux `flock`, and the dependencies used
by that merchant's original source profile. Node and Python paths remain the
original host selections. Install and review that same source release on the
operator host before generating its deployment.

Use the image preparation and delivery receipt to select either an immutable
registry reference, `registry/name@sha256:...`, or a locally loaded image ID,
`sha256:...`. The latter allows an operator to load and run a verified image
archive without publishing it to a registry. Match the image's Linux platform
to the daemon. Keep its original source/archive identity and dependency
selection with the deployment records.

The container specification has two source modes:

| Selection | Source visible to the merchant | Operator responsibility |
| --- | --- | --- |
| `sourceMode: "bind"` | The original absolute source root is mounted read-only from the host. | Keep the selected source and dependencies at their retained paths. Add any separate dependency root through `readOnlyRoots`. |
| `sourceMode: "image"` | The selected source is already in the immutable image at the original absolute source root. | Build or load the image from that exact source release and dependency selection. Retain the matching host source for generation, inspection, and recovery. |

Node resolves many package imports through the source directory's parents.
For the original installed distribution, `sourceRoot` is
`INSTALL/package/source` and `dependencyRoot` is `INSTALL`; its packages are in
`INSTALL/node_modules`. Preserve that complete original hierarchy. Mount the
selected source root itself;
mounting its entire parent can hide dependencies already installed in the image.
Include trusted handler modules' relative imports and external response assets
in the readable source selection.

### Match the numeric identity and private paths

Choose `uid` and `gid` for the existing merchant account. The original
`serviceUser` and `serviceGroup` remain in its host plan; the container runs
with the selected numeric identity. The merchant state directory must be owned
by that runtime UID. The supervisor checks that owner before starting services.

The same absolute paths are used on the host and inside the container:

| Path | Container access | What it contains |
| --- | --- | --- |
| Original `privateRoot` / prepared `stateRoot` | Read-write | Original checkout, outbox, history, retained release/discovery stores, and the supervisor's `.container-runtime` directory. |
| Selected source root, when bound | Read-only | Original product modules and selected handler entries. |
| `readOnlyRoots` | Read-only | Explicit dependency, module, or asset directories needed outside the selected source root. |
| Host plan, container bundle, and selected configuration inputs | Read-only | Exact plans, generated artifacts, and original source/input selections. |
| Original `environmentFile` | Read-only | Existing private service environment, read only by the runtime when it starts. |
| `/run` and `/tmp` | Temporary memory-backed storage | Runtime temporary files; durable merchant state belongs in its selected state root. |

Make every required private directory traversable and every selected input
readable by the chosen numeric identity. In particular, a root-owned mode-0600
environment file that systemd previously read for the service must be provisioned
as a mode-0600 file owned by the container's merchant UID. Original host checks
require no group or world access on that file. Keep the generated bundle
administrator-owned and readable by the selected group, with private traversal
to its files; the bundle is mounted read-only. Generation does not copy environment
values into Compose or the deployment manifest.

The runtime reads that file using its original systemd EnvironmentFile grammar.
It performs no shell expansion and does not route it through Compose's
`env_file` parser. Keep the existing variable names, quoting, and literal values.
Provision recovery passphrases separately in the private operator environment.

## Generate the deployment

Write a private specification using the actual installed host plan and image
receipt. Replace the marked image value with the complete recorded image ID;
the placeholder is deliberately not an accepted image reference.

```json
{
  "schema": "stellar-forge.merchant-container.v1",
  "hostPlan": "/srv/stellar/report/config/host-plan.json",
  "image": "sha256:REPLACE_WITH_RECORDED_64_HEX_IMAGE_ID",
  "uid": 1001,
  "gid": 1001,
  "sourceMode": "bind",
  "readOnlyRoots": [
    "/opt/starforge/report/node_modules",
    "/srv/stellar/report/assets"
  ],
  "startupTimeoutSeconds": 90,
  "temporaryMiB": 128
}
```

`temporaryMiB` sets the container's `/tmp` memory limit; its default is 128 MiB
and accepted range is 16–8192 MiB. `/run` has a separate 4 MiB temporary mount.
`startupTimeoutSeconds` defaults to 90 and accepts 1–600 seconds.

Use only roots required by this merchant. A read-only binding is not a writable
state selection or an encrypted-backup selection. Put writable merchant records
in the original state root, and include required external asset roots explicitly
in the original recovery plan.

The following shell variables are examples. Set them to the source release,
Node path, and deployment directories selected for this merchant. Keep the
host plan, environment file, and source release outside the output directory.

```sh
sf_source=/opt/starforge/report/package/source
sf_node=/usr/bin/node
sf_cli="$sf_source/stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs"
sf_spec=/srv/stellar/report/config/container.json
sf_out=/srv/stellar/report/deployments/container-001
sf_project=stellar-forge-report-merchant

"$sf_node" "$sf_cli" container inspect --plan "$sf_spec"
"$sf_node" "$sf_cli" container generate --plan "$sf_spec" --out "$sf_out"
"$sf_node" "$sf_cli" container check --bundle "$sf_out"
```

Set `sf_project` to the exact project returned by generation and retained in
`container.json`. The explicit project argument below overrides any ambient
`COMPOSE_PROJECT_NAME` from another operator session.

Generate into a new directory. The outer manifest retains the validated
container specification, original host plan, nested host bundle, selected
image/identity/source mode, mounts, and generated artifact hashes. Keep the
manifest with the immutable source and image receipt.

The nested `host/deployment.json` is an original SF99 host manifest. Its normal
checks continue to verify generated files and the selected source and input
bytes. For a retained merchant, the original selected release generation,
immutable release, and discovery setup remain part of those checks.

## Start the selected merchant

Confirm that the original systemd or manually launched merchant has stopped
before starting this container. The same state and listener ports have one
active owner. Follow that owner's existing drain procedure when moving an
already-running installation.

Validate the concrete Compose file without printing expanded configuration,
then start its one `merchant` service using the existing image:

```sh
docker compose --project-name "$sf_project" --file "$sf_out/compose.json" config --quiet
docker compose --project-name "$sf_project" --file "$sf_out/compose.json" up --detach --no-build --pull never
```

The generated service uses the `stellar-forge-` merchant project and hostname,
host networking, an init process, a read-only image filesystem, and explicit
bindings. The process command is the original selected Node executable running
`container-runtime.mjs run --bundle OUT/host`. The startup timeout applies to
the selected process group's startup.

The supervisor starts the roles that the original host plan actually declares:

1. Initialize and start the original receiver, when present.
2. Start the original discovery writer, when present.
3. Start the original delivery worker, when present.
4. Start the original seller or retained release.

It observes each original readiness endpoint or delivery lease, then runs the
original SF99 smoke checks. A merchant with no selected receiver, discovery
writer, or delivery worker does not gain one.

### Observe from the running container

Run health, status, and retained-release smoke inside the same container as the
supervisor. Original SF82 retained releases record their hostname and process
IDs; a host process or a separate diagnostic container has a different process
namespace.

```sh
sf_runtime="$sf_source/stellar/scf-starforge-20261009/sf99-merchant-deploy/container-runtime.mjs"

docker compose --project-name "$sf_project" --file "$sf_out/compose.json" exec -T merchant \
  "$sf_node" "$sf_runtime" health --bundle "$sf_out/host"

docker compose --project-name "$sf_project" --file "$sf_out/compose.json" exec -T merchant \
  "$sf_node" "$sf_runtime" status --bundle "$sf_out/host"

docker compose --project-name "$sf_project" --file "$sf_out/compose.json" exec -T merchant \
  "$sf_node" "$sf_cli" smoke --bundle "$sf_out/host"
```

`health` returns a nonzero status until the original group is ready. Status
includes the runtime identity, merchant, active bundle, mode, phase, original
child roles and PIDs, and current readiness. A healthy retained release must
also match the original release ID, digest, selected generation, and live
listener.

For a stopped container, use `docker compose ... ps --all` and its retained
runtime output to identify the failure. `exec` needs the original container to
be running. Resolve the named input, permission, image, dependency, listener, or
original lease conflict before reopening it.

## Install the original public boundary

Install `OUT/host/Caddyfile` as this merchant's existing imported Caddy fragment.
Validate the complete Caddy configuration and reload through the existing
operator procedure. Keep a separate imported fragment for each merchant so
maintenance can pause the selected origin independently.

The fragment exposes the original configured paid routes and documented public
discovery/checkout paths. Operations, capability listeners, private health
interfaces, and undeclared paths remain outside that public route selection.
Use the exact generated file and the existing HTTPS origin.

Once the origin reaches this host, run the original public smoke from inside
the merchant container:

```sh
docker compose --project-name "$sf_project" --file "$sf_out/compose.json" exec -T merchant \
  "$sf_node" "$sf_cli" smoke --bundle "$sf_out/host" --public
```

That check exercises the configured public documentation/discovery paths and
the original private-path exclusions. Continue using the merchant's existing
native payment validation procedure for payment behavior.

## Drain, stop, and reopen

Compose uses `restart: "no"`. An original SF98 delivery conflict exits with
status 75; the owner resolves that conflict before an explicit restart. This
also makes a failed original process group visible to the operator.

The supervisor receives TERM/INT and drains in the original role order:
seller, delivery, receiver, then discovery. Each selected original service has
its own `stopSeconds` allowance. The generated Compose grace is the sum of
those allowances plus 15 seconds, giving the supervisor time to complete that
ordered drain. Do not shorten it with an ad hoc stop timeout.

```sh
docker compose --project-name "$sf_project" --file "$sf_out/compose.json" stop
docker compose --project-name "$sf_project" --file "$sf_out/compose.json" up --detach --no-build --pull never
```

For a planned public maintenance window, use the maintenance flow below. It
coordinates the origin's maintenance response with the original durable writers.
After reopening, run health and the original smoke again. Keep original outbox,
checkout, release, and operation journals with the merchant's active state.

## Encrypted backup and migration

Container maintenance joins the original
[maintenance operation journal](MAINTENANCE.md) and
[SF101 encrypted recovery](../sf101-merchant-recovery/README.md).
It invokes the original snapshot, restore, approved-file path rebasing, and
retained-release checks.

Use the existing Linux administrator account, local Docker daemon, and Caddy
binary. Create a private administrator-owned `operationsRoot` outside the
merchant's source, state, deployment bundle, and all selected recovery roots.
Select the outer container bundle as well as its original nested host bundle:

```json
{
  "schema": "stellar-forge.merchant-maintenance.v1",
  "bundle": "/srv/stellar/report/deployments/container-001/host",
  "containerBundle": "/srv/stellar/report/deployments/container-001",
  "operationsRoot": "/var/lib/stellar-maintenance/report-merchant",
  "caddy": {
    "fragment": "/etc/caddy/merchants/report-merchant.caddy",
    "config": "/etc/caddy/Caddyfile",
    "binary": "/usr/bin/caddy"
  },
  "runtime": { "docker": "/usr/bin/docker" },
  "recoveryPlan": "/srv/stellar/report/config/recovery-plan.json",
  "passphraseEnv": "SF101_RECOVERY_PASSPHRASE"
}
```

Set the private operator environment's named passphrase through the established
secret procedure. Use the actual installed fragment and Caddy configuration.
If `recoveryPlan` is omitted, the original nested bundle's generated recovery
plan is selected.

Before backup, reconcile the selected roots with the merchant's actual records.
Approved-file databases retain paths and digests; include the corresponding
file bytes in a selected recovery root. Include external response assets,
configuration/module closures, and upstream idempotency data needed by the
original merchant. Roots follow SF101's real-path, nonoverlap, and entry rules.
The environment file remains separately provisioned and outside these roots.
The adapter operates the services in this merchant container. Stop any separately
operated writer through its original control before snapshotting shared roots,
and keep it stopped throughout the operation. After migration, reopen it using
the returned restored paths. The container plan does not accept the systemd
adapter's external-unit template fields.

Inspect the deployment and perform a backup using one stable operation ID:

```sh
sf_maintenance=/srv/stellar/report/config/maintenance.json

"$sf_node" "$sf_cli" container maintenance inspect --plan "$sf_maintenance"

"$sf_node" "$sf_cli" container maintenance backup \
  --plan "$sf_maintenance" --id before-report-upgrade
```

The adapter pauses this merchant's existing Caddy ingress, explicitly stops the
merchant container, obtains the original outbox lease when that profile has an
outbox, and runs the original encrypted snapshot and verification. It resumes
the existing merchant and its public fragment through the same journal.

Migrate to a new private destination when relocating the original state or
preparing the next selected immutable source:

```sh
"$sf_node" "$sf_cli" container maintenance migrate \
  --plan "$sf_maintenance" --id report-state-move-001 \
  --destination /srv/stellar/report/restored/state-move-001
```

Keep this maintenance plan's exact bytes and operation ID unchanged until the
operation completes; interruption recovery reuses that retained selection.

The operation retains the public pause from its fresh snapshot through
activation. The original restored-host engine authenticates the archive,
restores into a new directory, and rebases the original selected records and
configuration. Container composition retains the chosen image, numeric
identity, source mode, read-only roots, startup timeout, and temporary storage limit while generating
a new outer container bundle for the restored host plan. An explicit
`restoreContainer` selection may choose the next image and source bindings.

Precommit startup uses `--readers-only`, which excludes the original delivery
worker. The original smoke and retained runtime checks execute with
`docker compose exec -T` inside the live merchant container. After the journal
commits, the adapter stops and reopens the full original group and restores
public ingress. Use the returned next maintenance plan for later operations.

### Resume the same operation

If an operator connection or maintenance command is interrupted, reuse its
original plan and stable ID:

```sh
"$sf_node" "$sf_cli" container maintenance status \
  --plan "$sf_maintenance" --id report-state-move-001

"$sf_node" "$sf_cli" container maintenance resume \
  --plan "$sf_maintenance" --id report-state-move-001
```

Before commit, `rollback` returns the operation to its original selected host.
After commit, resume the selected restored state or migrate forward from that
active state. The existing journal enforces this distinction so later merchant
activity remains attached to the chosen state.

```sh
"$sf_node" "$sf_cli" container maintenance rollback \
  --plan "$sf_maintenance" --id report-state-move-001
```

Keep the operation directory, verified encrypted snapshot, generated container
bundle, immutable source and image identities, and the returned next maintenance
plan together with the merchant's operator records.

## Upgrade source or image

Prepare a new immutable source/image selection and a new container
specification. Preserve the merchant's existing public origin, original account,
active journals, and selected configuration. Inspect the candidate before
switching the live group. Its exact Node/Python paths and dependency closure
must still match the chosen image.

For a journaled source/image upgrade, prepare a new maintenance plan before
starting the operation. Its optional `restoreContainer` object selects the
candidate image and source bindings. It accepts `image`, `sourceMode`,
`readOnlyRoots`, `startupTimeoutSeconds`, and `temporaryMiB`; the existing
numeric merchant identity remains fixed.

```json
{
  "restoreContainer": {
    "image": "sha256:REPLACE_WITH_NEXT_RECORDED_64_HEX_IMAGE_ID",
    "sourceMode": "image",
    "readOnlyRoots": ["/srv/stellar/report/assets"],
    "startupTimeoutSeconds": 90,
    "temporaryMiB": 128
  }
}
```

Add that object to the maintenance plan selecting the currently active bundle.
Use `container maintenance inspect` to validate the selected plan and current
deployment, and compare the candidate image selection with its retained receipt.
Run `migrate --source-root IMMUTABLE_SOURCE` with a new stable ID and destination,
using the next source's actual canonical path. The restored container's image
must contain the selected original runtime executables and dependencies. Image
source mode also requires that exact selected source at its original absolute
path; bound source mode must retain its dependency hierarchy.

The original journal commits the candidate only after its original readiness
checks. Carry forward the returned next maintenance plan and review any
`restoreContainer` selection before a later upgrade. Each operation keeps its
original plan bytes through completion.

A code rollback reopens the last compatible immutable source/image against the
merchant's current state. A state restoration uses the original authenticated
recovery and journaled cutover into a new destination. Carry the selected
generation and operation identity through the documented flow.

## Reference commands and boundaries

| Command | Scope |
| --- | --- |
| `cli.mjs container inspect --plan SPEC` | Prepare the selected original host and container specification. |
| `cli.mjs container generate --plan SPEC --out OUT` | Write a new outer bundle and original nested host bundle. |
| `cli.mjs container check --bundle OUT` | Check selected manifests, inputs, sources, bindings, and generated artifacts. |
| `container-runtime.mjs run --bundle OUT/host` | Own the original merchant process group in the foreground. |
| `container-runtime.mjs health\|status --bundle OUT/host` | Observe the live original group inside its namespace. |
| `cli.mjs container maintenance inspect\|backup\|migrate\|status\|resume\|rollback ...` | Operate the selected container through the original maintenance/recovery journal. |

The generated outer `RUNBOOK.md` records the exact container paths, image,
commands, and shutdown allowance. Its nested `host/RUNBOOK.md` records the
original host selection and recovery bindings. Use this guide's Compose commands for its container lifecycle.
The original [merchant host guide](README.md), [maintenance guide](MAINTENANCE.md),
and [encrypted recovery guide](../sf101-merchant-recovery/README.md) describe the
underlying merchant and recovery formats.

Docker's primary references cover
[service configuration](https://docs.docker.com/reference/compose-file/services/),
[Compose validation](https://docs.docker.com/reference/cli/docker/compose/config/),
and [executing inside a running container](https://docs.docker.com/reference/cli/docker/container/exec/).

