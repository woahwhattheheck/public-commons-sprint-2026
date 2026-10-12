# Fuul programmes in Applications

**Fuul programmes** opens the complete programme operator through the maintained Applications process lifecycle. The browser, terminal and JavaScript interface share the same immutable programme versions, original source pages, event deduplication identities, action prerequisites, run progress, reconciliation editions, reports and package receiving.

Use Node **22.16.0 or newer** for the application. The original SDK build selects **@fuul/sdk-stellar 0.3.0**, **@stellar/stellar-sdk 17.2.1**, **Bun 1.3.12** and **TypeScript 5.9.3**. The original runtime profile already records the application Node requirement.

[README.md](README.md) contains the native API, programme and operating examples. This guide covers installed source, Applications, original runtime building and full receiving.

## Build the selected product

Run the maintained distribution builder from the actual source checkout and selected Git revision:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref HEAD \
  --selection stellar-fuul-programmes \
  --out /absolute/private/fuul-programmes-package
~~~

Keep the resulting archive, selected source commit and build manifest together. Install that package with the existing runtime installation workflow, then open the existing Applications workspace.

The selected package provides three executable names:

| Executable | Source and purpose |
| --- | --- |
| stellar-fuul-programmes | Complete native programme CLI, including the local serve command. |
| starforge | Maintained dispatcher with the selected Fuul, installation and runtime commands. |
| starforge-merchant | The same maintained dispatcher under its merchant alias. |

Each of these opens the same application:

~~~sh
stellar-fuul-programmes serve --workspace /absolute/private/fuul-workspace
starforge stellar-fuul-programmes serve --workspace /absolute/private/fuul-workspace
starforge-merchant stellar-fuul-programmes serve --workspace /absolute/private/fuul-workspace
~~~

The contribution declares the command, original module exports, Applications provider and three browser assets. Both contribution and source selection explicitly include the complete application cohort, original source capsules and maintained dynamic distribution dependencies.

## Build and retain the original Stellar SDK

The source capsule at source/sdk-stellar.json contains all 74 original publisher files from:

- Repository: https://github.com/fuul-protocol/protocol-sdk-stellar
- Commit: ea3dc792506a206991d053ef98f888da71c2248f
- SDK: @fuul/sdk-stellar 0.3.0, ISC
- Stellar dependency: @stellar/stellar-sdk 17.2.1
- Original Bun lock SHA256: 4629b81191558d99c4f9fa758be47cf0a96242b03967cbeb4c7c472b56d7f0fc
- Full public source capsule SHA256: 1d99414917744d68c2e01373c3b73d3e163200b8c767993be8a68619791c48c3

This includes the original license, package metadata, frozen Bun lock, TypeScript build script, generated factory/manager/project bindings, contracts.json and original documentation. The original build compiles both ESM and CommonJS outputs and verifies the committed binding hashes before completing.

Build into a dedicated private consumer project and retain its complete runtime:

~~~sh
stellar-fuul-programmes runtime-build \
  --installation-directory /absolute/private/fuul-native-installation \
  --destination /absolute/private/fuul-native-runtime
~~~

The optional --source-directory selects an existing complete checkout of that same original publisher source. Its declared files are checked and copied into the build operation; the default uses the retained source capsule.

If Bun and npm are installed at private paths, select their actual executables:

~~~sh
stellar-fuul-programmes runtime-build \
  --installation-directory /absolute/private/fuul-native-installation \
  --destination /absolute/private/fuul-native-runtime \
  --bun-executable /absolute/private/toolchain/bin/bun \
  --npm-executable /absolute/private/toolchain/bin/npm
~~~

The native build follows the publisher's sequence:

1. Materialize and verify the complete original source.
2. Run Bun install with the original frozen lock.
3. Run the publisher's build script through Bun.
4. Record the complete compiled file selection, including every original export, and run native npm pack --ignore-scripts against those verified outputs. The original prepack repeats the same build, which has already completed.
5. Install that exact retained archive in the selected private consumer.
6. Capture the complete installed SDK, Stellar and source/compiler dependency graph before importing the SDK.

The consumer pins transitive versions to the original Bun selection. The runtime retains the original archive, consumer package and lock, build metadata, all generated outputs, source files, licenses, dependency edges, native file modes and logical links. Shared packages are consolidated only when their complete source bytes, layout and effective dependency graph are equivalent.

The source-build package is linked to the same retained publisher source root. It contains the TypeScript compiler dependency and original build script needed to compile those retained bindings. Separate packages remain separate when their source bytes or actual dependency selections differ.

### Continue an interrupted build

Repeat runtime-build with the same installation directory, runtime destination and original source selection. The operation retains each native child command, private stdout/stderr, exact process identity and completed result. An existing completed child is recovered; an active original child remains the executing operation. A failed native command returns its retained output paths, so the underlying installation or compiler error can be corrected before repeating the same build.

For a memory-constrained host, supply --node-heap-mb 512. This sets the original Node child's heap ceiling in MB; valid values are 128 through 65536. The selected ceiling is recorded with each new native command. A later retry can select a different ceiling while preserving completed work and earlier failures.

The original compiler removes dist before emitting ESM and CommonJS files. If an earlier interrupted prepack removed or changed those files, recovery runs that same complete original build under a retained recovery request before creating a compiled-output checkpoint. Subsequent packaging verifies every selected file, mode and export and reuses the completed output. A changed or missing output creates another original build recovery; existing failed attempts and completed output selections remain available in the same operation.

The build's private work is under the installation's sibling .fuul-build directory. The installed project has its original .fuul-sdk-build.json selection. Keep these together until the complete runtime has been retained.

Once the runtime manifest has been written and verified, independent receiving uses that immutable full runtime. The live compiler project is then unnecessary for opening the received application.

### Retain an existing compatible installation

A host that already has the exact original compiled SDK and dependency selection can retain it directly:

~~~sh
stellar-fuul-programmes runtime-retain \
  --installation-directory /absolute/private/existing-fuul-installation \
  --destination /absolute/private/fuul-native-runtime
~~~

Resolution follows the original Node package rules from the selected installation directory. The retainer checks the SDK version and full package metadata, native Stellar version, original dependency versions, and every declared ESM/CommonJS entrypoint. It reads and retains the graph before importing publisher code.

Use runtime-verify to reopen a selected retained generation:

~~~sh
stellar-fuul-programmes runtime-verify \
  --runtime-directory /absolute/private/fuul-native-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

### JavaScript runtime interface

~~~js
import {
  buildFuulRuntime, publicFuulRuntime, loadFuulStellar
} from './runtime.mjs';

const retained = await buildFuulRuntime({
  installationDirectory: '/absolute/private/fuul-native-installation',
  directory: '/absolute/private/fuul-native-runtime',
  bunExecutable: '/absolute/private/toolchain/bin/bun',
  progress: stage => process.stdout.write(JSON.stringify(stage) + '\n')
});

const pin = publicFuulRuntime(retained);
const { sdk, stellar, runtime } = await loadFuulStellar({
  runtimeDirectory: retained.directory,
  expectedManifestSha256: pin.manifestSha256
});

console.log({
  runtime,
  originalSdk: typeof sdk.FuulSdk === 'function',
  originalFactory: typeof sdk.FactoryContract.Client === 'function',
  originalRpc: typeof stellar.rpc.Server === 'function'
});
~~~

The loader returns the original SDK namespace, original Stellar namespace and public runtime descriptor. The SDK's ten original entrypoints and Stellar's root, rpc and contract entrypoints remain represented in the manifest, with both ESM and CommonJS resolutions and their original declarations.

The public descriptor contains id, manifestSha256, version 0.3.0 and stellarVersion 17.2.1. Private filesystem paths remain in host configuration.

## Select private source connections

Use the complete connection examples in the operating README. Each saved source alias selects its original project or network and host-private authentication. The runtime settings on a Stellar connection are:

| Field | Meaning |
| --- | --- |
| installationDirectory | Original installed SDK project used when a runtime has not yet been retained. |
| runtimeDirectory | Complete retained or independently received SDK generation. |
| expectedManifestSha256 | Expected hash of that generation's exact manifest bytes. |
| retained | Additional prior generations, each with its original runtime ID, directory and manifest hash, used by existing captured sources or actions. |

A connection's runtime portion can be composed from a returned build or receiving result:

~~~json
{
  "runtime": {
    "runtimeDirectory": "/absolute/private/fuul-native-runtime",
    "expectedManifestSha256": "ORIGINAL_RUNTIME_MANIFEST_SHA256"
  }
}
~~~

The surrounding connection retains its actual provider, project/network, endpoint and authentication fields. Keep this JSON outside the workspace directory. A workspace export carries the public source and runtime identities, while the receiving host selects its private credentials.

When a programme uses multiple generations, keep each referenced generation in runtime.retained. Complete export verifies coverage of every runtime pinned by sources, captures and prepared actions.

The native Stellar source adapter uses the original SDK event-page and decoder APIs. Its original RPC client's HTTP transport is extended to retain full request and response bytes before the SDK parses or filters the page. The source therefore retains every original response record alongside the SDK's decoded event projection.

## Open through Applications

Choose **Fuul programmes**, save the application settings and start that saved application.

| Setting | Meaning |
| --- | --- |
| Private Fuul workspace | Absolute directory containing the complete editable programme and original work history. |
| Private source connections | Optional absolute path to the original alias-to-connection JSON outside the workspace. |
| Programme profile | Optional absolute JSON file with the organisation and programme profile. |
| Local listen address | 127.0.0.1 by default, or ::1. |
| Local port | 8776 by default. Reuse the same port to preserve the browser's recovery origin. An explicit 0 selects an available port. |
| Private environment JSON | Existing Applications option for the managed child process's private environment. |

Preparation resolves the complete installed source, reads the original connection configuration and inspects an existing workspace identity. The native command receives that identity as --expected-workspace-id.

The provider selects the port exactly once. The maintained Applications environment and process supervisor remain responsible for the managed child. Startup verifies the original release source directory, workspace UUID, private configuration paths, revision, PID, loopback address and actual port.

Applications retains the first accepted startup announcement and its local session URL. The browser receives a 43-character token in the URL fragment, retains it in tab session storage and removes the fragment from the visible address.

## Open the same application directly

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fuul-programmes/cli.mjs serve \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/fuul-connections.json \
  --profile-file /absolute/private/fuul-profile.json \
  --host 127.0.0.1 \
  --port 8776 \
  --startup-format json
~~~

The optional profile and connections flags can be omitted when opening retained work without a new connection. Add --expected-workspace-id with the actual saved UUID to bind a launch to that exact workspace.

The startup object uses schema stellar-forge.fuul-programmes-workspace-startup.v1 and status FUUL_PROGRAMMES_READY:

| Fields | Launched values |
| --- | --- |
| url | Actual local HTTP URL and process session token fragment. |
| host, port | Selected loopback host and actual listening port. |
| workspaceDirectory, workspaceId | Continuing private workspace and original UUID. |
| revision | Original nonnegative workspace revision at startup. |
| pid | Actual process ID. |
| sourceDirectory | This installed application's source directory. |
| connectionsFile, profileFile | Exact selected private paths, or null when omitted. |

Keep the full local session URL private.

## Continue original queued work

The workspace records programme revisions and complete request identities before native work. Captures retain their cursor and in-flight native page request. Events retain original deduplication IDs and complete bodies. Batches freeze their exact event selection. Actions preserve preparation sources and ordered prerequisite actions. Runs freeze the entire task selection and retain progress.

Read the original queue or run before continuing:

~~~sh
stellar-fuul-programmes queue-read \
  --workspace /absolute/private/fuul-workspace \
  --table actions --id ORIGINAL_ACTION_UUID

stellar-fuul-programmes run-read \
  --workspace /absolute/private/fuul-workspace \
  --run-id ORIGINAL_RUN_UUID
~~~

Resume an intentionally paused original action, then continue its retained request:

~~~sh
stellar-fuul-programmes queue-resume \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/fuul-connections.json \
  --table actions --id ORIGINAL_ACTION_UUID

stellar-fuul-programmes queue-next \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/fuul-connections.json \
  --table actions --id ORIGINAL_ACTION_UUID \
  --resume-original
~~~

Original action prerequisites are separate retained actions. Resume the selected prerequisite queue entries as well when continuing them on a receiving host. Their existing status and provider response remain visible; a completed prerequisite remains completed.

For a complete saved run:

~~~sh
stellar-fuul-programmes run-resume \
  --workspace /absolute/private/fuul-workspace --run-id ORIGINAL_RUN_UUID

stellar-fuul-programmes run-execute \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/fuul-connections.json \
  --run-id ORIGINAL_RUN_UUID --resume-original
~~~

The CLI's original-request option recovers retained capture, dispatch or run arguments. Explicit new mutations can also supply --request-id and --expected-revision. Keep the same original request and body when recovering a lost acknowledgement.

The browser's workspace-bound request journal is described in the operating README. Keep the same origin and selected workspace when reopening that journal. HTTP writes use X-Fuul-Workspace-ID with the selected workspace's actual UUID.

## Export a complete workspace

~~~sh
stellar-fuul-programmes workspace-export \
  --workspace /absolute/private/fuul-workspace \
  --connections-file /absolute/private/fuul-connections.json \
  --destination /absolute/private/fuul-delivery \
  --request-id ORIGINAL_EXPORT_UUID
~~~

The export pins an exact workspace revision and head, original source files, executing application cohort and every referenced runtime before copying. Large hashes, source copies and file syncs happen outside the short workspace writer lock. A retry uses the original pinned selection and completed copies even if the live workspace has advanced.

The complete package includes:

- Original workspace state, genesis and full selected history.
- Programme definitions and versions.
- Complete capture plans, page exchanges and original response bodies.
- Original source projections, event requests, batch bodies, action preparation and dispatch records.
- Full run manifests, task selection, progress, in-flight request and prerequisite identities.
- Immutable decisions, reconciliation editions and report artifacts.
- Complete application source and its source manifest.
- Every referenced original SDK/Stellar runtime, including regular files, package metadata, source/build selection and the exact native link/mode manifest.
- Original package manifest and receiving guide.

The local browser can download the complete package as a streamed POSIX tar/PAX gzip archive. Its response includes X-Fuul-Manifest-SHA256. Upload and inspection preserve that manifest selection before independent receiving.

## Receive and reopen independently

~~~sh
stellar-fuul-programmes package-inspect \
  --source-directory /absolute/private/fuul-delivery \
  --expected-manifest-sha256 ORIGINAL_PACKAGE_MANIFEST_SHA256

stellar-fuul-programmes package-receive \
  --source-directory /absolute/private/fuul-delivery \
  --destination /absolute/private/fuul-client \
  --expected-manifest-sha256 ORIGINAL_PACKAGE_MANIFEST_SHA256 \
  --request-id ORIGINAL_RECEIVE_UUID
~~~

Receiving verifies every declared original file, reconstructs runtime links and permission modes from the original runtime manifest, reopens the full workspace history, records one receiving transition and atomically publishes the independent destination.

The returned result contains:

| Result | Meaning |
| --- | --- |
| workspace.directory | Complete received workspace path. |
| workspace.workspaceId | Preserved original workspace identity. |
| workspace.sourceRevision, sourceHead | Exact sender selection. |
| workspace.preparation | Recorded pause transition and selected capture/event/batch/action/run IDs. |
| application.cli, application.server | Exact independently copied application entrypoints. |
| application.runtimeConnections | Original runtime IDs and new receiving-host directories/hashes. |
| runtimes | Complete restored native runtime selections. |
| manifestSha256 | Exact original package manifest hash. |

Open the returned application.cli with serve, the returned workspace.directory and receiving-host private connections. Merge the returned runtime connection selections into the matching original Stellar aliases.

Captures, events, batches and actions reopen paused. An incomplete capture or unfinished run has status PAUSED. Complete run tasks, original event bodies and deduplication identities, provider acknowledgements, in-flight attempts and ordered action prerequisites remain preserved. Resume the selected work through the same original queue/capture/run operations.

A repeated receive request for the same destination and original manifest reopens its existing receipt. The stable parent-directory lock covers staging recovery and final rename, so a simultaneous retry selects the same receiving operation.

### Transport a runtime separately

A runtime can also travel as its manifest plus every declared regular file. Restore those exact bytes independently:

~~~sh
stellar-fuul-programmes runtime-restore \
  --source-directory /absolute/private/runtime-transport \
  --destination /absolute/private/runtime-installed \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

The original modes and symlinks are rebuilt from the native manifest. To attach the retained packages directly to another complete source copy:

~~~sh
stellar-fuul-programmes runtime-bind \
  --runtime-directory /absolute/private/runtime-installed \
  --application-directory /absolute/private/independent-application \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

Binding verifies existing package aliases before adding missing relative links to the retained SDK and Stellar roots. All original application source files remain selected by their source manifest.

## Deliver a scoped report

~~~sh
stellar-fuul-programmes report-export \
  --workspace /absolute/private/fuul-workspace \
  --report-id ORIGINAL_REPORT_UUID \
  --destination /absolute/private/fuul-report-delivery \
  --request-id ORIGINAL_REPORT_EXPORT_UUID
~~~

A scoped report package includes its original rendered HTML, JSON and CSV members and the sealed report metadata at report/report.json. It preserves the selected project/user scope and original programme/reconciliation identities. Complete raw API pages and SDK generations remain part of a full workspace delivery.

Use report-file with --format and --output for any complete original artifact. Source, edition and queue file commands likewise stream the full retained file unless an explicit range is selected.
