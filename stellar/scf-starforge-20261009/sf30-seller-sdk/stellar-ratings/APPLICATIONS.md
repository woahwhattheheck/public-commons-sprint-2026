# Stellar ratings in Applications

**Stellar ratings** opens the complete wallet and asset activity workspace through the maintained Applications process lifecycle. Its browser, terminal and JavaScript operator use the same versioned asset registry, saved rating policy, original provider pages, daily collection cursors, wallet and activity editions, institutional reports and receiving history.

Use Node **22.16.0 or newer** for the application. Native Stellar operations use the complete original **@stellar/stellar-sdk 17.2.1** distribution and its installed dependency graph. The application can open saved work and original reports before a new source connection is selected.

[README.md](README.md) contains the complete registry, policy, connection, source and operating examples. This guide covers product installation, managed launch, the original SDK runtime, complete exports and independent receiving.

## Build the selected product

Use the maintained distribution builder from the selected source checkout:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/tjlabs-stellar-merchant-workspace \
  --ref HEAD \
  --selection stellar-ratings \
  --out /absolute/private/stellar-ratings-package
~~~

Keep the resulting archive, selected source commit and build manifest together. Install that package through the existing runtime installation workflow and open the existing Applications workspace.

The selected package supplies these executable names:

| Executable | Purpose |
| --- | --- |
| stellar-ratings | Complete wallet, activity, runtime, report and receiving CLI. |
| starforge | Maintained dispatcher with the selected product and installation commands. |
| starforge-merchant | The same maintained dispatcher under its merchant alias. |

The direct executable and both dispatchers select the same command:

~~~sh
stellar-ratings serve --workspace /absolute/private/ratings-workspace
starforge stellar-ratings serve --workspace /absolute/private/ratings-workspace
starforge-merchant stellar-ratings serve --workspace /absolute/private/ratings-workspace
~~~

The contribution registers the Applications provider, complete module exports, browser asset map and command. Both the contribution and source selection explicitly include the complete application source cohort, the original API and SDK source capsules, example files, daily collection worker and maintained dynamic distribution dependencies.

## Install and retain the original Stellar runtime

The native library is the publisher's compiled package:

| Selection | Value |
| --- | --- |
| Package | @stellar/stellar-sdk |
| Version | 17.2.1 |
| Publisher source commit | b4893496f69116d9db2a4a90214a7236831b6656 |
| Original package license | Apache-2.0, with the package's retained third-party notices |
| Registry source | source/stellar-sdk-registry.json |
| Original registry body SHA256 | fd25b568ca98b7ec3b4382e62d79603f99dd879e112241e6e9142e91ac07eec9 |

The retained registry body comes from the original [npm version endpoint](https://registry.npmjs.org/@stellar/stellar-sdk/17.2.1). The complete licensed native source capsule includes the publisher's actual [license](https://github.com/stellar/js-stellar-sdk/blob/b4893496f69116d9db2a4a90214a7236831b6656/LICENSE), SDK source, RPC parser and original generated XDR source used by the adapters.

### Start with a fresh private project

~~~sh
stellar-ratings runtime-install \
  --installation-directory /absolute/private/ratings-packages \
  --destination /absolute/private/ratings-runtime
~~~

The installer creates its own private consumer package with the exact SDK version, runs the original npm installation and retains the actual complete installed graph before importing the SDK. It records the original Node/npm toolchain, package and lockfile hashes, registry integrity, native command attempts and completed installation receipt.

If npm has a specific installed path, select it directly:

~~~sh
stellar-ratings runtime-install \
  --installation-directory /absolute/private/ratings-packages \
  --destination /absolute/private/ratings-runtime \
  --npm-executable /absolute/private/toolchain/bin/npm
~~~

The installation project and retained runtime destination are separate directories. Repeating the same command with the same directories continues the original installation operation. Its process identity and command receipts distinguish an active original child, a completed child and a failed attempt. A failed attempt retains complete stdout and stderr for the following continuation.

Private installation work is retained beside the project under the .stellar-ratings-install suffix. Keep that operation directory and the installation project together until the immutable runtime has been captured.

### Reuse an existing original installation

A host with the exact SDK already installed can retain it directly:

~~~sh
stellar-ratings runtime-retain \
  --installation-directory /absolute/private/existing-stellar-project \
  --destination /absolute/private/ratings-runtime
~~~

Package resolution follows the original Node ancestor rules from installationDirectory. It can therefore select a normal project root or the installed application directory beneath that project. The runtime capture verifies the original SDK version and complete package metadata before importing publisher code.

The retained generation contains all declared regular package files, licenses, type declarations, assets, dependency edges, executable modes and logical package links. It preserves both ESM and CommonJS entrypoints for the original root, rpc, xdr, base, axios, contract, axios/rpc, axios/contract and http-client/axios exports.

Shared dependencies are consolidated only when their complete retained bytes, native layout and effective dependency selection agree. A different installed dependency graph receives its own runtime identity.

### Verify or restore a retained generation

~~~sh
stellar-ratings runtime-verify \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

Replace the capitalized hash placeholder with the actual lowercase SHA256 returned by the runtime operation. The expected hash names the exact manifest bytes.

A file-only transport needs manifest.json and every regular file declared by that manifest. Restore the native package layout into a separate directory:

~~~sh
stellar-ratings runtime-restore \
  --source-directory /absolute/received/runtime-source \
  --destination /absolute/private/ratings-runtime-received \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

Restoration checks every declared regular file, reconstructs the original permission modes and logical dependency links, then verifies the complete installed graph. It returns the same runtime ID and manifest hash. A transfer does not need to preserve symlinks or Unix permission bits itself.

To make an independently materialized application resolve those packages through ordinary Node resolution:

~~~sh
stellar-ratings runtime-bind \
  --runtime-directory /absolute/private/ratings-runtime-received \
  --application-directory /absolute/private/ratings-application-source \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256
~~~

Binding adds only missing relative package aliases beneath that application's node_modules. An existing alias must already name the same retained package. The application source bytes and package metadata remain the selected originals.

### JavaScript runtime interface

~~~js
import {
  installRatingsRuntime,
  publicRatingsRuntime,
  loadRatingsStellar
} from './runtime.mjs';

const retained = await installRatingsRuntime({
  installationDirectory: '/absolute/private/ratings-packages',
  directory: '/absolute/private/ratings-runtime',
  progress: stage => process.stdout.write(JSON.stringify(stage) + '\n')
});

const pin = publicRatingsRuntime(retained);
const { stellar, runtime } = await loadRatingsStellar({
  runtimeDirectory: retained.directory,
  expectedManifestSha256: pin.manifestSha256
});

console.log({
  runtime,
  asset: typeof stellar.Asset === 'function',
  muxedAccount: typeof stellar.MuxedAccount === 'function',
  rpc: typeof stellar.rpc.Server === 'function',
  contractSpec: typeof stellar.contract.Spec === 'function'
});
~~~

The loader returns the original Stellar namespace and the public runtime descriptor:

~~~json
{
  "id": "ORIGINAL_RUNTIME_ID",
  "manifestSha256": "ORIGINAL_RUNTIME_MANIFEST_SHA256",
  "version": "17.2.1"
}
~~~

Host configuration holds private runtime directories. Captures, source records, runs and result editions retain only the public descriptor.

## Select the source and runtime configuration

Begin with [examples/connections.example.json](examples/connections.example.json). Each connection alias names its actual network, original endpoint and source behavior. Keep credentials and connection JSON outside the workspace directory.

The default native runtime is selected separately from provider connection aliases. Wallet planning uses the original SDK to validate and canonicalize addresses before a native page is captured, so select this runtime when starting the operator:

~~~sh
stellar-ratings serve \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --port 8777
~~~

The alternative --installation-directory selects the original installed package project from which the first retained generation can be captured. An explicit retained runtime takes precedence for that selected generation.

Individual Stellar connections can also carry their own runtime selection:

~~~json
{
  "runtime": {
    "runtimeDirectory": "/absolute/private/ratings-runtime",
    "expectedManifestSha256": "ORIGINAL_RUNTIME_MANIFEST_SHA256",
    "retained": []
  }
}
~~~

Merge this fragment into the actual provider connection from the example file. Additional historical generations belong in runtime.retained, with id, runtimeDirectory and expectedManifestSha256. A complete workspace export checks every runtime referenced by its sources, captures, runs and editions, including the generation used during address planning.

The source catalogue exposes the current original read methods and their argument schemas. Price, score and CMS sources keep the original supplied values and selected field mappings. A saved registry identifies network, asset code and issuer or the original asset contract. The saved policy selects methodology, freshness and coverage; its exact version remains attached to each result edition.

## Open through Applications

Choose **Stellar ratings**, save its settings and start the saved application.

| Setting | Purpose |
| --- | --- |
| Private Stellar ratings workspace | Absolute directory containing the editable registry and policy versions, original source captures, complete results, daily progress and private lookup history. |
| Private source connections | Optional absolute path to the original alias-to-connection JSON outside the workspace. |
| Workspace profile | Optional JSON profile. Existing saved profile revisions remain part of the workspace. |
| Retained original Stellar runtime | A complete retained or independently received SDK 17.2.1 generation. Preparation pins its actual manifest before launch. |
| Original installed packages | Optional existing project used when a native runtime has not yet been captured. |
| Expected runtime manifest SHA256 | Optional exact expected hash for the selected retained runtime. |
| Daily collection at startup | Use on to enable collection of closed UTC days when the service starts. Off leaves the saved workspace setting in effect. |
| Local listen address | 127.0.0.1 by default, or ::1. |
| Local port | 8777 by default. Reuse the same port for the browser's retained recovery origin; an explicit 0 chooses an available port. |
| Private environment JSON | The existing Applications setting for the managed process environment. |

Preparation resolves the complete installed product source, reads the original connection configuration, validates the selected runtime manifest and inspects any existing workspace identity. It passes that identity to the native CLI as --expected-workspace-id.

The maintained Applications environment and process supervisor own the child lifecycle. The product provider supplies the exact command and selected input descriptors. It verifies the accepted startup against the original release source directory, workspace UUID, configuration paths, selected runtime, revision, PID, loopback address, collection flag and actual port.

Applications retains the accepted startup announcement and local session URL. The browser takes its 43-character bearer token from the URL fragment, stores it in tab session storage and removes the fragment from the visible address.

## Open the same application directly

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-ratings/cli.mjs serve \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --profile-file /absolute/private/ratings-profile.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --host 127.0.0.1 \
  --port 8777 \
  --startup-format json \
  --collect-daily
~~~

Omit profile and connection flags when opening retained work without a new source request. Add --expected-workspace-id with the actual saved UUID to bind a launch to that workspace.

The startup object has schema stellar-forge.stellar-ratings-workspace-startup.v1 and status STELLAR_RATINGS_READY. It includes:

| Field | Selected value |
| --- | --- |
| workspaceDirectory, workspaceId, revision | The actual opened workspace and observed revision. |
| sourceDirectory | The original installed stellar-ratings source directory. |
| connectionsFile, profileFile | The selected private configuration paths, or null. |
| runtimeDirectory, expectedManifestSha256, installationDirectory | The actual CLI runtime selections, or null. |
| collectDaily | Whether the explicit startup flag enabled daily collection. The saved workspace profile can also enable the service. |
| pid, host, port, url | The running process and actual local browser address. |

The server also observes state.profile.collectDaily dynamically. A saved Boolean setting overrides the launch default, so the Settings control can stop or start the service after a launch with --collect-daily. Daily work is implemented by the complete worker.mjs module and uses the same saved collection versions and native original requests as manual collection.

## Save a registry and policy

Use the actual source-selected examples:

- [examples/registry.template.json](examples/registry.template.json) contains the verified asset registry seed.
- [examples/wallet-policy.template.json](examples/wallet-policy.template.json) contains the saved rating, freshness and coverage policy.
- [examples/collection.template.json](examples/collection.template.json) contains the daily collection definition.
- [examples/prices.headers.csv](examples/prices.headers.csv) and [examples/scores.headers.csv](examples/scores.headers.csv) show the original receiving fields for documentary sources.

Save the complete selected definitions:

~~~sh
stellar-ratings registry-save \
  --workspace /absolute/private/ratings-workspace \
  --file /absolute/private/registry.json

stellar-ratings policy-save \
  --workspace /absolute/private/ratings-workspace \
  --file /absolute/private/wallet-policy.json
~~~

Each save returns an original ID and immutable version. Later edits append versions. A running wallet review or collection retains the versions with which it began.

Create a complete wallet review from a JSON request containing the selected registryId, policyId, addresses and connectionAliases:

~~~sh
stellar-ratings wallet-review \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --input /absolute/private/wallet-review.json
~~~

The operation retains the original address selection, canonical G/M account relationship, source tasks, provider exchanges, prices, methodology and coverage. The original native SDK performs address and XDR handling. Its complete result edition remains available independently of subsequent registry, policy or provider changes.

## Collect complete UTC days

A collection definition selects an accepted launch date, the original registry and policy versions, named source connections and source IDs. Save the complete definition before starting its collection:

~~~sh
stellar-ratings collection-save \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --file /absolute/private/daily-collection.json

stellar-ratings collection-run \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --collection-id ORIGINAL_COLLECTION_UUID
~~~

The operation freezes its whole selected date interval and retains the next UTC date, pending daily run, original tasks and each completed daily edition. The --to boundary is exclusive. The default end is the start of the current UTC day, so the operation collects closed days.

The service mode continually advances enabled collections as further UTC days close. Changing the collection definition appends a version; existing work keeps its original selection and continuation arguments.

Pause and resume use the original workspace operations:

~~~sh
stellar-ratings collection-pause \
  --workspace /absolute/private/ratings-workspace \
  --collection-id ORIGINAL_COLLECTION_UUID

stellar-ratings collection-resume \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --collection-id ORIGINAL_COLLECTION_UUID

stellar-ratings collection-run \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --collection-id ORIGINAL_COLLECTION_UUID \
  --resume-original
~~~

A PARTIAL run retains its completed edition and actual missing source work. The original run-resume operation can repair that selection and retain the earlier edition. Receiving preserves PARTIAL as a result status so that branch remains available.

## Continue the original request after interruption

Mutations keep a requestId and expectedRevision. The CLI accepts both explicitly and otherwise prints the selected values to stderr before invoking the native operation. Retain the complete request body with its ID when recovery must survive terminal loss.

An identical completed request recovers its original result before a new revision is selected. A different body under the same ID is a conflict. Use request-status to inspect the actual saved request and workspace-history to inspect its transition.

Long operations retain their own complete arguments, native page request and child IDs. Use --resume-original with capture-next, capture-run, run-next, run-continue or collection-run to recover that retained argument body. A paused operation must be explicitly resumed before its original continuation proceeds.

The browser journals original method arguments and uploaded files before a mutation is sent. Reopening the same workspace uses its saved original request identity; a new workspace at the same local address does not inherit a previous workspace's queued mutation. Keep the default port stable when continuing a browser session.

## Read full results and original files

The workspace list, source, run and edition APIs are paged. Their cursors and offsets select the full retained tables. The file operations provide the complete original body, with SHA256 and byte count retained in their descriptors.

~~~sh
stellar-ratings source-file \
  --workspace /absolute/private/ratings-workspace \
  --source-id ORIGINAL_SOURCE_UUID \
  --part body \
  --output /absolute/private/original-source.bin

stellar-ratings edition-file \
  --workspace /absolute/private/ratings-workspace \
  --edition-id ORIGINAL_EDITION_UUID \
  --output /absolute/private/wallet-or-activity-edition.json
~~~

With --output and no offset or length, the CLI streams the whole file in bounded ranges and verifies the original final byte count and hash. An explicitly selected offset or length downloads only that range.

The private lookup table retains exact canonical-account counts and edition associations. The popular-wallet presentation retains its selected ranking tiers and Bluechip attribution. Full workspace receiving carries the original private counts; institutional report packages select their saved report scope.

## Create and deliver a report

Create a report from an original complete edition. The native API accepts formats html, json and csv and an optional saved account or asset scope. The original report.json file is the sealed report metadata; each rendered artifact has its own filename.

~~~sh
stellar-ratings report-create \
  --workspace /absolute/private/ratings-workspace \
  --edition-id ORIGINAL_EDITION_UUID \
  --name "Wallet review"

stellar-ratings report-file \
  --workspace /absolute/private/ratings-workspace \
  --report-id ORIGINAL_REPORT_UUID \
  --format html \
  --output /absolute/private/wallet-review.html
~~~

To export the complete selected report package:

~~~sh
stellar-ratings report-export \
  --workspace /absolute/private/ratings-workspace \
  --report-id ORIGINAL_REPORT_UUID \
  --destination /absolute/private/report-delivery \
  --name "Wallet review"
~~~

A report delivery includes its sealed metadata and all rendered members of that saved report, with byte counts, hashes and original scope. A workspace delivery contains the complete editable workspace and source application.

## Export the whole working product

~~~sh
stellar-ratings workspace-export \
  --workspace /absolute/private/ratings-workspace \
  --connections-file /absolute/private/ratings-connections.json \
  --runtime-directory /absolute/private/ratings-runtime \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --destination /absolute/private/ratings-delivery \
  --name "Stellar wallet and activity workspace"
~~~

A complete workspace package retains:

- The original workspace identity, exact selected state, genesis and journal history.
- Every immutable registry, policy and collection version.
- Capture requests, provider response bytes, source manifests and projections.
- Original wallet and daily activity runs, task selections, cursors and execution state.
- Complete result editions, comparison inputs, decisions and rendered reports.
- Private canonical-account lookup counts and their original edition associations.
- Every referenced original Stellar runtime, with its manifest and full regular-file graph.
- The complete original application source, source manifest, source capsules, examples and maintained dependency cohort.
- An operating guide and the package's full manifest.

The export pins the selected workspace state, report selection, runtime generations and complete application files under a short writer lease. Hashing and copying occur after that writer is released. The acknowledgement is added to the current workspace only after confirming that the selected source revision remains in its original history.

If copying is interrupted, repeat the exact export request and destination. A sealed original intent and copy plan preserve the selected state even if the live workspace advances. Already copied files are checked and reused. A lost acknowledgement recovers the same completed package and records it in state.exports.

## Transfer a full archive or folder

The package manifest names every regular file, original byte count, SHA256, file role and mode. The archive module streams the complete selection as tar.gz, including long original paths through POSIX PAX records.

The browser's package download uses this same stream. The receiving browser uploads the complete archive and inspects its manifest before invoking the original package receiving operation. Folder transport can also copy manifest.json and every declared file directly.

For native transport:

~~~js
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  streamRatingsDelivery,
  unpackRatingsDelivery
} from './archive.mjs';

const sourceDirectory = '/absolute/private/ratings-delivery';
const expectedManifestSha256 = 'ORIGINAL_PACKAGE_MANIFEST_SHA256';

await pipeline(
  await streamRatingsDelivery({sourceDirectory, expectedManifestSha256}),
  createWriteStream('/absolute/private/ratings-delivery.tar.gz', {
    flags: 'wx',
    mode: 0o600
  })
);

const inspected = await unpackRatingsDelivery({
  input: createReadStream('/absolute/private/ratings-delivery.tar.gz'),
  destination: '/absolute/received/ratings-delivery',
  expectedManifestSha256
});

console.log(inspected);
~~~

The extractor verifies original paths, modes, lengths and hashes, handles bounded input chunks and retains its own interrupted receiving state. It recreates only the declared package members. A complete repeated upload with the same manifest reuses the completed inspected selection.

## Receive independently and open the delivered application

Inspect the original package first:

~~~sh
stellar-ratings package-inspect \
  --source-directory /absolute/received/ratings-delivery \
  --expected-manifest-sha256 ORIGINAL_PACKAGE_MANIFEST_SHA256
~~~

Receive it into a new absolute destination:

~~~sh
stellar-ratings package-receive \
  --source-directory /absolute/received/ratings-delivery \
  --destination /absolute/private/ratings-client \
  --request-id ORIGINAL_RECEIVE_UUID \
  --expected-manifest-sha256 ORIGINAL_PACKAGE_MANIFEST_SHA256
~~~

Use the same receive UUID, original source package, expected manifest and destination when continuing an interrupted receive. The stable parent-directory lock covers source selection, stage replay, copy, runtime reconstruction, receiving preparation, receipt publication and the final directory rename.

The returned result contains:

| Field | Meaning |
| --- | --- |
| directory | Complete independent receiving directory. |
| exportId, manifestSha256 | Original package identity and exact manifest hash. |
| workspace.directory | The independently opened editable workspace directory. |
| workspace.workspaceId, revision, head | Original workspace identity plus its explicit receiving transition. |
| workspace.sourceRevision, sourceHead | The exact original exported state selection. |
| application.directory | Complete retained source root. |
| application.cli, application.server | Actual entrypoint paths from that source. |
| application.runtimeConnections | Original runtime IDs with their receiving-host directories and manifest hashes. |
| runtimes | Complete restored runtime descriptors and retained source locations. |
| report | Selected report paths for a report-only receiving result. |
| replayed | Whether this operation recovered its original completed receipt. |

Unfinished captures, wallet or activity runs and daily collection executions are paused on receiving. Their original source requests, inflight attempts, child IDs, date cursor and progress survive. Terminal PARTIAL runs preserve their original result status and retained edition. Completed editions, journal history and private lookup counts stay selected.

Use the returned CLI and workspace paths to open the actual delivered product:

~~~sh
node /absolute/private/ratings-client/application/source/stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-ratings/cli.mjs serve \
  --workspace /absolute/private/ratings-client/workspace \
  --runtime-directory /absolute/private/ratings-client/runtimes/ORIGINAL_RUNTIME_ID/installed \
  --expected-manifest-sha256 ORIGINAL_RUNTIME_MANIFEST_SHA256 \
  --connections-file /absolute/private/received-ratings-connections.json \
  --port 8777 \
  --startup-format json
~~~

Use the exact paths from the result if the receiving destination differs. Choose the desired original runtime generation as the default for wallet planning, and merge any additional application.runtimeConnections into private connection runtime.retained selections.

Configure the receiving host's source access with the same public aliases before resuming an original capture, wallet run or daily collection. The received product can read original source files, editions and reports directly from the retained package.

## JavaScript workspace and receiving interface

~~~js
import { openStellarRatingsOperator } from './operator.mjs';
import { receiveRatingsDelivery } from './receiving.mjs';

const operator = await openStellarRatingsOperator({
  workspaceDirectory: '/absolute/private/ratings-workspace',
  connections: {},
  runtime: {
    runtimeDirectory: '/absolute/private/ratings-runtime',
    expectedManifestSha256: 'ORIGINAL_RUNTIME_MANIFEST_SHA256'
  }
});

try {
  const before = await operator.describe();
  const exported = await operator.invoke({
    method: 'workspace.export',
    args: {
      requestId: 'ORIGINAL_EXPORT_UUID',
      expectedRevision: before.revision,
      destination: '/absolute/private/ratings-delivery',
      name: 'Complete Stellar ratings workspace'
    }
  });

  const received = await receiveRatingsDelivery({
    sourceDirectory: exported.directory,
    destination: '/absolute/private/ratings-client',
    requestId: 'ORIGINAL_RECEIVE_UUID',
    expectedManifestSha256: exported.manifestSha256
  });

  console.log({
    workspace: received.workspace,
    cli: received.application.cli,
    runtimes: received.application.runtimeConnections
  });
} finally {
  await operator.close();
}
~~~

The same complete receive API handles workspace and report packages. Export acknowledgements are kept in state.exports; source acquisition and private lookup history retain their own original tables.

## Original source and licensing

The application source manifest selects the complete product and its maintained dependencies. The runtime registry body selects the actual publisher package, and each native source capsule retains its original source records and license notices.

The original Stellar SDK and XDR implementation remains under its publisher's retained Apache-2.0 license and notices. The original Stellar Expert OpenAPI source retains its own license and attribution. Independently authored workspace, runtime and receiving modules carry their source license headers.

Institutional reports retain their saved scope and the original **by Bluechip** attribution and https://bluechip.org/ source link. Future reads append source and result editions to the same original workspace so prior published methodology and observations remain inspectable.
