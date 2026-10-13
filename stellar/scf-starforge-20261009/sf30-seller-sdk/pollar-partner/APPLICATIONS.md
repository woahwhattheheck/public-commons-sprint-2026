# Pollar partner in Applications

The **Pollar partner** Applications entry launches the same complete operator and customer portal as the terminal command. It preserves the selected workspace identity, private connection files, complete original browser runtime and operating history across start, stop and reopen.

[README.md](README.md) gives the full customer, native operation, report and receiving workflow. This page covers the source-selected package, managed process and original runtime.

## Build the selected distribution

Use the maintained builder from the complete selected repository:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref HEAD \
  --selection pollar-partner \
  --out /absolute/private/pollar-partner-package
~~~

Install the resulting archive through the existing runtime installation workflow. Keep the selected source commit, package manifest and archive together. The package exposes:

| Executable | Purpose |
| --- | --- |
| stellar-pollar-partner | Full partner, customer-host, native operation, runtime and receiving CLI. |
| starforge | Existing dispatcher with the selected product and installation commands. |
| starforge-merchant | The same dispatcher under its merchant alias. |

The direct executable and dispatcher command select identical source:

~~~sh
stellar-pollar-partner serve --workspace /absolute/private/pollar-workspace
starforge stellar-pollar-partner serve --workspace /absolute/private/pollar-workspace
starforge-merchant stellar-pollar-partner serve --workspace /absolute/private/pollar-workspace
~~~

The contribution supplies the source-owned Applications provider, browser asset map, full module exports and direct command. The selection explicitly names the complete product source cohort and its maintained dependencies, including the original browser SHA256 helper and dynamically read distribution metadata. The source manifest binds every selected file by complete bytes, SHA256 and executable mode.

## Prepare the native browser runtime

The application uses the original source-built packages @pollar/core, @pollar/react and @pollar/accesly-adapter at 0.12.0-rc.1. Their complete selected source, Apache-2.0 license, notices, package manifests, lock and build scripts are retained under source/pollar-sdk-source.json.

~~~sh
stellar-pollar-partner runtime-build \
  --installation-directory /absolute/private/pollar-sdk \
  --runtime-directory /absolute/private/pollar-runtime \
  --node-heap-mb 512
~~~

The build operation retains source installation, the three unchanged publisher build commands and the resulting compiled outputs. Its npm executable is a host selection; --npm-executable accepts the actual installed entrypoint. The default 512 MB Node heap ceiling is child-scoped. It leaves the original package scripts intact.

Keep the installation and its adjacent .pollar-build operation directory. The same command resumes the original completed or interrupted stages. Every compiled output has a size, mode and SHA256 in the retained source-build receipt. Runtime capture and file-only reconstruction verify those same compiled selections.

The runtime contains complete regular package files, source and build receipts, declarations, licenses, browser assets, original package links and dependency edges. It preserves the native package graph used for the browser build. The small browser entry exports the actual core, React passkey helpers and Accesly namespace; the customer bridge invokes those original exports.

Inspect or verify the full retained generation:

~~~sh
stellar-pollar-partner runtime-verify \
  --runtime-directory /absolute/private/pollar-runtime \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256
~~~

A complete already-built installation can be retained without compiling it again:

~~~sh
stellar-pollar-partner runtime-retain \
  --installation-directory /absolute/private/pollar-sdk \
  --runtime-directory /absolute/private/another-retained-runtime
~~~

Independently reconstruct the original graph from declared regular-file transport, then bind it to a received application:

~~~sh
stellar-pollar-partner runtime-restore \
  --source-directory /absolute/private/transported-runtime \
  --destination /absolute/private/restored-runtime \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256

stellar-pollar-partner runtime-bind \
  --runtime-directory /absolute/private/restored-runtime \
  --application-directory /absolute/private/received-application \
  --expected-manifest-sha256 ACTUAL_RUNTIME_MANIFEST_SHA256
~~~

Runtime restoration checks the original source-build receipt against the actual compiled file selection. Binding creates only missing links to the same retained packages and rejects a different existing selection.

## Configure the managed application

Select these fields in the existing Applications workspace:

| Field | Meaning |
| --- | --- |
| Private partner workspace | New or existing complete Pollar workspace directory. |
| Private Pollar connections | Owner-readable configuration outside the exported workspace; existing server and MCP credential references, application/network and retained runtime bindings. |
| Workspace profile | Optional initial private profile file. Saved profile changes remain in the workspace. |
| Retained Pollar browser runtime | Complete runtime directory selected by its manifest. |
| Runtime manifest SHA256 | Optional exact hash pin for that runtime selection. |
| Original built SDK installation | Optional completed source-build installation used by native runtime resolution. |
| Local listen address | 127.0.0.1 or ::1. |
| Local port | 8778 by default, preserving customer origin and browser journals. |

Preparation loads the exact installed application modules, checks the required source members and reads any existing workspace UUID. It validates the private configuration outside the source workspace. A selected runtime is read through the original runtime manifest API and carried into the native command with its exact manifest hash.

The launcher invokes the original CLI with serve, --workspace, --startup-format json, --host and --port. Existing work also supplies --expected-workspace-id. Selected private files and runtime paths remain native CLI arguments.

The startup observer accepts **stellar-forge.pollar-partner-workspace-startup.v1** with **POLLAR_PARTNER_READY**. It checks the process PID, original source path, selected workspace UUID/revision, private file paths, listen address/port, operator token URL, portal origin and selected runtime pins. It then records the actual URL in the maintained Applications lifecycle.

The private operator URL and customer portal link serve different users. The operator token stays with the operator. A customer follows the exact saved application/version portal link and authenticates through the original SDK. The host verifies that SDK session with the original Pollar server endpoint.

The local OAuth redirect is http://127.0.0.1:8778/portal. Keep the same host and port when reopening that browser journal. A different installation can choose another explicit loopback origin and register its full original allowlist with the existing Pollar application.

## Full application receiving

Workspace export includes the exact selected application source, original operating journal, native source responses, reports and every runtime referenced by saved applications or retained operations. The source manifest includes this provider and all its maintained dynamic imports.

Receiving returns an independently usable workspace and application, plus the exact runtime directories and hashes:

- workspace.directory is the original journal reopened at its receiving location.
- application.directory is the complete received source root.
- application.cli and application.server are the original executable module paths.
- application.runtimeConnections selects the restored package graphs for that host.

Attach the receiving host's original Pollar connection and open the returned CLI or the same Applications provider. Unfinished native operations remain paused with their provider request IDs, complete arguments and continuation. The customer verifies its current original SDK session when returning to that host.

The full export and report export have distinct selections. A report package carries its actual report manifest and complete HTML/JSON/CSV members. A workspace package carries the complete application, runtime and source history needed to continue operating.

## Source and JavaScript entrypoints

The selected package exports the workspace, operator, server, native connection, original browser bridge/catalogue, runtime, archive, receiving and Applications modules. The maintained provider imports the original runtime-workspace lifecycle rather than maintaining a second process registry.

Server API:

~~~js
import {startPollarPartnerServer} from './server.mjs';
import {loadPollarPartnerConfiguration} from './operator.mjs';

const workspaceDirectory = '/absolute/private/pollar-workspace';
const configuration = await loadPollarPartnerConfiguration({
  workspaceDirectory,
  connectionsFile: '/absolute/private/pollar-connections.json',
  runtimeDirectory: '/absolute/private/pollar-runtime'
});
const application = await startPollarPartnerServer({
  workspaceDirectory, configuration,
  connectionsFile: '/absolute/private/pollar-connections.json',
  host: '127.0.0.1',
  port: 8778
});
console.log(application.startup);
await application.close();
~~~

The full operator request remains {method, args}. A write carries the original request UUID and expected workspace revision. HTTP callers also select X-Pollar-Workspace-ID. Archive transfers retain the selected manifest SHA256, original export ID and complete file bytes.
