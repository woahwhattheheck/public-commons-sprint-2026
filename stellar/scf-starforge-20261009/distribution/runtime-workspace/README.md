# Customer runtime workspace

Prepare, install and operate a selected Starforge runtime through a private local
browser. The workspace uses the original [runtime installer](../RUNTIME_INSTALL.md)
and [runtime profile](../RUNTIME.md) for every source, dependency and recovery
operation. It keeps the customer workflow together: receive an original release,
choose its adapters, review exact versions, prepare a runtime, follow installation,
inspect the result, compare an upgrade and hand the ready runtime to the existing
merchant deployment controls.

The command runs on the operator's Linux host with Node 22.16 or later, Python
3.11 or later, npm and `flock`. The selected source can require a newer Node
version; its profile reports that requirement before preparation. The browser
itself adds no npm dependency or build step.

## Open the workspace

Choose a new private workspace directory. Its parent must already exist. A
separate private runtime home is useful when the installation directories should
be independent of the workspace's browser records:

```sh
starforge runtime-workspace init \
  --workspace /srv/starforge/runtime-workspace \
  --runtime-home /srv/starforge/runtimes

starforge runtime-workspace serve \
  --workspace /srv/starforge/runtime-workspace
```

The command prints a private loopback URL. Open that complete URL in the browser
on the same host. The default port is 8465; choose another with `--port`. A new
server process prints a new private URL. Reopening the same workspace restores
its registered runtime directories, original archives, saved inspection results
and operation history. The selected runtime, view and log selection also reopen
in the same browser at the same origin.

From a current source checkout, use the same CLI directly:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs \
  serve --workspace /srv/starforge/runtime-workspace
```

The workspace and an existing runtime have different directories and purposes.
Opening a runtime registers its actual path. It does not copy or move that
installation.

## Use an existing installation

In **Open an existing runtime**, enter the original runtime directory and an
optional display name. The directory contains the original `runtime-install.json`,
`runtime-profile.json` and `package/` created by the runtime installer. The
workspace inspects it and makes its retained archive available in **Source &
profile**. A completed installation immediately supplies its original source,
dependency lock and deployment handoff.

The headless equivalent is:

```sh
starforge runtime-workspace attach \
  --workspace /srv/starforge/runtime-workspace \
  --runtime /srv/starforge/runtimes/merchant-01 \
  --label "Merchant production"

starforge runtime-workspace status \
  --workspace /srv/starforge/runtime-workspace
```

This is also the way to reuse an older original archive with the current
workspace. The original installed source and package identity remain selected;
the current workspace supplies the user interface and maintained installer.

## Receive a release and choose its adapters

In **Source & profile**, open **Import another original archive**. Either choose
the supplied `.tgz` file or enter its absolute path on the operator host. Enter
the exact archive SHA-256 supplied with that release. Browser uploads stream to
a private file and are limited to 64 MiB.

The original installer prepares the archive's complete source catalog. The
source version, source commit and archive digest appear in the workspace. This
catalog preparation retains the original source and does not install optional
dependencies.

Select the archive, then select the native payment runtime and the optional
adapters declared by that exact source. New feature declarations in a later
release appear through the original catalog automatically. **Linux operator
tools** includes the selected profile's Python, platform and `flock` checks.

Use **Review exact profile** to see every selected dependency and its exact
version alongside the original declaration. An exact source pin remains exact.
Supported declared ranges use their compatible declared baseline. When an
explicit compatible version is needed, enter a JSON object under **Exact version
overrides** and review it. The original profile verifies compatibility and
computes the complete profile identity.

Enter a new runtime name and choose **Prepare new runtime**. The new directory is
inside the configured runtime home. Its name can contain letters, digits, dots,
underscores and dashes. Preparation retains the supplied archive and exact
original package, writes the selected dependency profile and creates the
original installation plan. The worker checks the prepared profile against the
identity shown during review.

## Install, inspect and follow progress

Open the prepared runtime and choose **Install / resume**. To use an already
populated npm cache, enable **Use existing cache only** and optionally choose its
absolute cache directory. The same options apply to upgrade and recovery. A
selected native adapter can also use an absolute **Local Node headers** directory
for the original installer's offline source preparation. The same installer
validates those headers and owns the selected native hook and readiness check.

The workspace starts a separate local worker. The original installer owns npm,
its exact dependency scope, lockfile, kernel lease, attempts and npm log. The
workspace records the requested operation and the actual original result. It
refreshes saved progress while the browser is visible; ordinary refreshes read
recorded state without repeatedly importing dependencies.

**Open npm log** displays the selected installation's retained current attempt
log. **Open worker log** displays the selected workspace operation's log. Each
view reads the last 64 KiB directly from that file and shows the retained byte
count. **Refresh log** updates the same selection.

**Inspect runtime** runs the original inspector. Import checks are selected by
default. **Check complete original source** additionally verifies the retained
archive, complete source inventory and original file modes. The result displays
the selected versions, actual resolved versions and each original readiness
check. Its full original result is available in the same panel.

Closing the browser or stopping its HTTP server leaves the separate worker and
original installation running. Reopen the workspace to follow the same request.
If the workspace process ended before starting a queued worker, **Start retained
request** starts that original request. If an already-running worker ended, its
operation appears as **INTERRUPTED**. Open its retained runtime and use the
original installation or recovery operation. The installer's existing lease
continues to protect an npm child which is still alive.

A request has a stable UUID and a canonical request hash. Repeating that same
request reopens its existing operation; reusing its UUID for different content
is rejected. After an uncertain browser response, **Recover last request** uses
the retained request. Saved operation results and recorded runtime state remain
available through `status` independently of browser storage.

## Compare, upgrade and recover

**Compare runtimes** compares the selected original source and exact dependency
profile with another registered runtime. It shows source/profile changes and
the exact dependency version differences returned by the original installer.

For an upgrade, open the current runtime, select the next archive and adapters
in **Source & profile**, and review the exact profile. Enter a new runtime name
and choose **Upgrade selected runtime**. The optional installation checkbox
controls whether the operation installs dependencies after preparation. The
upgrade creates a new final directory, retains the previous directory and uses
the original comparison and lock-carrying behavior. It checks that preparation
still matches the reviewed profile before starting dependencies.

For recovery, use **Recover in a new directory** on the selected runtime. It
uses the retained original archive, feature selection and explicit pins. A
complete matching source runtime also carries its dependency lock. Failed
preparation uses the original retained preparation intent and archive. The
operation result identifies the previous directory and whether it recovered a
preparation. A preparation failure keeps its target and recorded error visible
for this continuation.

Once the new runtime is ready, use the deployment workflow below. The original
merchant configuration and data stores stay under their existing deployment
manager's operation and recovery procedures.

## Hand off to the existing deployment workflow

**Deployment → Prepare deployment handoff** inspects the selected completed
runtime and returns its original installation, source, profile and lock
identities. Download or copy the JSON for the host/container operator. The root
pair is explicit:

| Field | Actual location |
| --- | --- |
| `directory` | Original final runtime directory |
| `sourceRoot` | `DIRECTORY/package/source` |
| `dependencyRoot` | `DIRECTORY` |
| Dependency files | `DIRECTORY/node_modules` |
| `sourceManifestSha256` | SHA-256 of the original package's `manifest.json` |

Use both roots when selecting the runtime for the existing native host or
container plan. The deployment owner can bind those retained directories, or
use the original image preparation workflow with its explicit target roots.

The workspace also prints the current **installation adopt-runtime** command
with the actual runtime directory and original manifest hash. Set `--home` to
the existing private managed home outside the runtime directory. The original
[SF46 managed-package workflow](../../sf46-release/MANAGED_PACKAGE.md) then
copies its verified source and attaches the original selected dependency tree.
The first adoption becomes active. Subsequent adoptions are staged for the
same activation and rollback controls.

```sh
starforge installation adopt-runtime /srv/starforge/runtimes/merchant-02 \
  --home /srv/starforge/managed \
  --expect-manifest EXACT_SOURCE_MANIFEST_SHA256

starforge installation runtime-status --home /srv/starforge/managed --load
starforge installation activate RETURNED_RELEASE_ID --home /srv/starforge/managed
starforge installation rollback --home /srv/starforge/managed
```

Use the current maintained command or current source checkout's
`sf46-release/package-cli.mjs` when an older supplied archive predates that
alias. Keep the runtime at its original absolute directory. Choosing another
location requires preparing or recovering a new runtime at that final path.
Activation selects code for new launches; the existing host process manager
provides the merchant's drain, restart and operational recovery.

The deployment handoff includes the exact arguments for the original
`adoptMerchantRuntime` API. Supply the managed `home` alongside those arguments:

```js
import { adoptMerchantRuntime, inspectInstalledRuntime }
  from '@tokenjunkielabs/starforge-merchant/installation/runtime';

const adopted = await adoptMerchantRuntime({
  ...handoff.managedRelease.arguments,
  home: '/srv/starforge/managed',
});
const selected = await inspectInstalledRuntime({
  home: adopted.home, releaseId: adopted.releaseId, load: true,
});
```

## Operate the managed release in this workspace

**Managed releases** opens the original SF46 home directly in this application.
Register an existing home or a new directory, review a READY runtime's source,
profile and dependency lock, and adopt it through the original runtime attachment.
Later adoptions are staged for the original activation and rollback controls.

The same view provides source inspection, the original dependency doctor,
configuration files, the original merchant initializer and native command catalog.
Native command output and process identity stay in the existing operation journal;
reopen the server to continue observing or stop that original command. Configuration
and merchant state stay under the original home during release changes.

See [Managed release operations](MANAGED_OPERATIONS.md) for the complete browser
and headless workflow, retained selection guards, configuration saves and recovery.

## Application API and retained records

The workspace model and server can be embedded in another local operator tool:

```js
import { createRuntimeWorkspace, openRuntimeWorkspace }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace';
import { startRuntimeWorkspace }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace/server';

await createRuntimeWorkspace({
  directory: '/srv/starforge/runtime-workspace',
  runtimeHome: '/srv/starforge/runtimes',
});
const workspace = await openRuntimeWorkspace({
  directory: '/srv/starforge/runtime-workspace',
});
const attached = await workspace.attach({
  directory: '/srv/starforge/runtimes/merchant-01', label: 'Merchant production',
});
const current = await workspace.state({ runtimeId: attached.runtimeId });
const handoff = await workspace.handoff(attached.runtimeId);
const server = await startRuntimeWorkspace({ directory: workspace.directory, port: 8465 });
// Open server.url locally. await server.close() closes the HTTP server.
```

`catalog(archiveId)` reads the original source declarations. `review({ archiveId,
selection })` returns the original exact profile. A selection contains `native`,
`operator`, `features` and `pins`.

`begin({ requestId, operation, ...arguments })` retains a request and starts its
worker. Its result identifies `operationId` and the existing or target
`runtimeId`. `state()` returns their retained results and progress.

| Operation | Arguments beyond the request UUID and operation name |
| --- | --- |
| `import` | Absolute `archive`, original `sha256`, optional `label` |
| `prepare` | `archiveId`, new `name`, reviewed `selection`, `profileId` |
| `install` | `runtimeId`, optional `offline`, absolute `cache` and `nodeHeaders` |
| `inspect` | `runtimeId`, optional `load` and complete `source` verification |
| `upgrade` | `runtimeId`, `archiveId`, new `name`, reviewed `selection`, `profileId`, optional `install`, `offline`, `cache`, `nodeHeaders` |
| `recover` | `runtimeId`, new `name`, optional `install`, `offline`, `cache`, `nodeHeaders` |

`compare({ before, after })` uses registered runtime IDs. `logs({ runtimeId })`
reads the actual npm log; `logs({ operationId })` reads that worker log.
`resumeQueued(operationId)` starts a saved queued request. The original installer
still owns runtime readiness and installation recovery.

The workspace root is private to its operator. `workspace.json` records its
actual location and runtime home. `entries/` and `archives/` retain selections;
`observations/` retains original inspection results. Each UUID under
`operations/` contains its request, state, worker log and local lease. Imported
catalog runtimes live in `sources/`, and browser uploads arrive in `incoming/`.
Original installation state remains inside each actual runtime directory.

The server binds loopback, requires the private URL capability for API access,
and checks the exact origin for writes. It retains the existing operator
workspace pattern: private real directories, fixed local assets, request field
allowlists and explicit original helper calls. Keep the workspace and its
runtime directories with the operator's normal host backup; use the original
runtime installer and deployment recovery procedures for their contents.
