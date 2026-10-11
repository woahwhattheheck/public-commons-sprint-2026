# Managed release operations

The **Managed releases** view extends the existing Starforge Runtime Workspace with the original SF46 managed home, runtime attachment, release selection, dependency doctor and command launcher.

## Open the operator application

~~~sh
starforge runtime-workspace init --workspace /srv/starforge/operator
starforge runtime-workspace serve --workspace /srv/starforge/operator --port 8465
~~~

Open the private URL printed by the server. For an existing operator workspace, start serve directly. After a server restart on the same port, open its newly printed private URL; the original runtime, home and operation selections reopen.

Use **Open an existing runtime** for a runtime already prepared and installed by the original installer. Its source archive, selected profile, dependency lock and absolute directory remain authoritative.

## Register a managed home and adopt the first runtime

1. Select **Managed releases** and open an original managed home, or register a new empty absolute directory.
2. Choose a READY runtime and select **Review runtime and home**.
3. Review the source commit, source manifest digest, runtime directory, profile identity, dependency lock and dependency count together.
4. Select **Adopt first active release**.

The original adoptMerchantRuntime prepares a source release with that exact runtime binding and installs it through the original SF46 installer. Dependency attachment happens under the installer's existing home lock. The first adoption becomes active. Source remains in its original source/ layout, and the runtime retains its actual absolute directory.

The home retains its original installation.json, active.json, releases/, config/, state/, forge.mjs and release primitives. Registration adds a reference in the operator workspace.

Every completed source review is retained with its original source/profile binding, home revision and review time. Open it from **Retained source and home review** after a lost response or browser restart. A review of the current home can continue directly to adoption; the original adoption engine verifies the source and runtime again. Earlier home reviews remain visible with their recorded identity and can be updated with **Review runtime and home**.

## Stage, activate and roll back

Review another READY runtime against the same home and select **Stage reviewed runtime**. Later adoptions are staged. Open the resulting release's identity detail to compare its source and runtime binding.

Choose an installed release in **Release for inspection and native commands**. **Activate selected release** chooses it for new launches. **Roll back to previous release** selects the home's recorded previous release.

The source commit and profile can remain equal when a runtime was recovered to another original directory. The runtime directory is part of the attachment; the release detail displays both identities.

Selection requests retain the reviewed active record and target release. The original activation and rollback functions check an optional expected active record while holding the same home lock. Reopening a completed target is idempotent. If another operator selected a different release, the request reports that changed selection so the operator can review the current home.

A running native process keeps the release from which it launched. Existing processes remain visible in the operation history while later releases are staged and selected. Stop or relaunch the specific original host when its operating workflow calls for it.

## Inspect and diagnose

**Inspect selected release** verifies the original source release and digest. Runtime-backed releases also check the original runtime binding and dependency attachment. Select **Import selected dependencies** when an actual dependency import is required.

**Run original doctor** invokes the selected source's original doctor and retains its actual exit code, Node readiness, package observations and optional-feature results. Require the native payment runtime or list feature names when those capabilities are part of the intended operation.

Ordinary browser refresh reads retained metadata. Explicit operations perform source verification and dependency imports, with original results and logs retained.

## Create and edit merchant configuration

Expand **Create an original merchant workspace**. Choose a new workspace name and one of the original templates: dataset, application or upstream.

This runs the selected release's original command:

~~~sh
starforge init --dir /srv/starforge/merchant-home/config/merchant-01 --template dataset
~~~

The original initializer writes its seller configuration, workspace identity, template content and operating README under the managed home's config/ directory.

Use **Refresh configuration files** to find retained files. Enter a relative path and select **Open configuration file**. The editor displays the reviewed SHA-256. Saving writes the exact UTF-8 bytes through the original atomic-file primitive under the existing home lock. A current-file digest comparison preserves concurrent operator edits. Reopening a completed save returns its saved digest.

The editor accepts files up to 20,000 bytes, validates JSON syntax for .json files, and requires real existing parent directories. The listing includes larger files for use with the original host editor or native command. Native commands continue to own their configuration schemas.

Pending file drafts are retained in the browser session under the workspace and home identity. After submission, the original operation request retains the exact content and reviewed digest. Keep operational secret values in the original host environment or configured secret provider; use the original configuration's environment references.

## Launch and control the original host

Select a command from the chosen release's original catalog. Enter its arguments as a JSON array. Each string becomes one unchanged argument. The launcher invokes Node directly from that release, with the managed home as the working directory.

For the original dataset workspace, choose the starforge command and enter:

~~~json
["run", "--workspace", "/srv/starforge/merchant-home/config/merchant-01", "--", "--port", "0"]
~~~

Select **Run original command**. Its seller and dashboard startup addresses appear in **Open retained output**. The original template README describes the operating routes and payment configuration.

The worker records the executable, argument array, working directory, release ID, digest, process ID and Linux process start identity. Its stdout and stderr flow into the existing operation's worker.log. Closing the browser or restarting its server leaves the original worker and host running.

**Stop original command** sends SIGTERM only to that operation's matching launcher process. The original launcher forwards termination to its native command. The result records exit code, signal and stop request. Release selection and merchant configuration persist.

## Reopen and recover operations

The runtime workspace still owns operations/UUID/request.json, state.json, worker.log and worker.lock. Managed operations use its same detached worker and exclusive lease. The existing kernel lease supplies liveness when a container's mounted /proc cannot expose its inner process IDs.

An exact request UUID and client request digest reopen the existing operation before current home normalization. The browser's **Recover last request** resends its original retained body. An uncertain request remains retained until reconciled with the workspace.

From **Retained processes and recovery**, open output, restart a queued request, or recover an interrupted managed operation. Adoption reuses the original runtime and installed source. Activation, rollback and configuration saves retain their comparison guards. Inspection and doctor operations can resume in that same record.

Native-command recovery first checks its recorded process identity. The command runner inherits that same lease, watches the retained stop request, and writes command-process.json and command-result.json beside the original operation. A running process reopens. If the worker ends first, recovery adopts the runner's actual retained result. Older interrupted commands retain an unavailable exit code when no original result was recorded. Recovery does not launch that command again after an uncertain outcome. Start a new operation when the original command's operating or recovery workflow calls for it.

The original installer controls remain in their existing views. Runtime recovery and managed selection compose through the actual READY directory.

## Headless commands

~~~sh
starforge runtime-workspace managed-open --workspace /srv/starforge/operator --home /srv/starforge/merchant-home --label Merchant
starforge runtime-workspace managed-status --workspace /srv/starforge/operator --home-id HOME_ID
starforge runtime-workspace managed-review --workspace /srv/starforge/operator --home-id HOME_ID --runtime-id RUNTIME_ID
starforge runtime-workspace managed-operation --workspace /srv/starforge/operator --request /srv/starforge/adopt-request.json
starforge runtime-workspace managed-config --workspace /srv/starforge/operator --home-id HOME_ID --path merchant-01/seller.json
starforge runtime-workspace managed-recover --workspace /srv/starforge/operator --operation-id UUID
starforge runtime-workspace managed-stop --workspace /srv/starforge/operator --operation-id UUID
~~~

A reviewed adoption request is:

~~~json
{
  "requestId": "9b5c7e09-0ce0-4ed0-8ced-9b7f5ecc6e72",
  "operation": "managed-adopt",
  "homeId": "HOME_ID_FROM_MANAGED_OPEN",
  "reviewId": "REVIEW_ID_FROM_MANAGED_REVIEW"
}
~~~

Generate a new UUID for a new operation and retain the file. Resubmit that same file to reopen its exact operation.

| Operation | Input fields |
| --- | --- |
| managed-adopt | homeId, reviewId |
| managed-activate | homeId, releaseId, current home expectedRevision |
| managed-rollback | homeId, current home expectedRevision |
| managed-inspect | homeId, optional releaseId, optional boolean load |
| managed-doctor | homeId, optional releaseId, optional boolean requireNative, optional array requiredFeatures |
| managed-config-save | homeId, relative path, exact content, reviewed expectedSha256 or null for a new file |
| managed-run | homeId, optional releaseId, original command, string-array args, current home expectedRevision |

The original starforge installation and home forge.mjs commands operate the same home directly. See [Managed package installation](../../sf46-release/MANAGED_PACKAGE.md) and [Runtime workspace](README.md).
