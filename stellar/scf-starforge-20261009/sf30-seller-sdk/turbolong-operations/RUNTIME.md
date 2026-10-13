# Turbolong original runtime and operating commands

This companion uses the selected original TurboLong installation. Its source selection is **Dgetsylver/TurboLong at f017de605bb020bf3d7f4285aae4c654508e8d86**: 276 files, including the Rust models and contracts, TypeScript keeper scripts, frontend, Cloudflare Worker, original lockfiles, vendor sources and vendor WASMs. The full publisher capsule is private because the selected repository does not declare a root reuse license. Supply an authorized original installation or its complete private source capsule. The public companion contains independently authored integration code and source metadata.

The runtime captures the actual installed dependencies, native tools, executable libraries, generated files, command receipts and source bytes. Independent receiving verifies these files and reconstructs their original confined links and modes before a native command can use them.

## Selecting an existing installation

All paths below are absolute examples to replace with the selected private paths. Keep runtime generations, source installations, credentials and execution directories outside the exported operator workspace.

From JavaScript:

~~~js
import {
  retainTurbolongRuntime,
  verifyTurbolongRuntime,
  publicTurbolongRuntime,
} from './runtime.mjs';

const runtime = await retainTurbolongRuntime({
  installationDirectory: '/private/turbolong/original',
  directory: '/private/turbolong/runtimes/generation-1',
  nodeExecutable: '/selected/bin/node',
  npmExecutable: '/selected/bin/npm',
  cargoExecutable: '/selected/bin/cargo',
  rustcExecutable: '/selected/bin/rustc',
  stellarExecutable: '/selected/bin/stellar',
  includeTools: ['node', 'npm', 'stellar', 'cargo', 'rustc'],
  includeRustToolchain: true,
});
await verifyTurbolongRuntime({
  directory: runtime.directory,
  expectedManifestSha256: runtime.manifestSha256,
});
console.log(publicTurbolongRuntime(runtime));
~~~

The default tool selection includes Node, npm, Stellar CLI, Cargo and Rust. Node is required. A source-only reconstruction can select just Node and npm and set includeRustToolchain to false. That selection proves source transport and the chosen native executable; it does not establish that the keeper dependencies or Rust binaries have been built. The descriptor exposes actual capabilities so missing build artifacts remain visible.

Retention requires all original source members and checks their identities. Installed dependency packages must have their required transitive dependencies available through their actual resolution graph. Optional dependencies are retained when installed. The selected Node executable determines the recorded Node ABI and platform. Original package versions and declaration bytes remain in the manifest; no substitute SDK or rewritten financial model is introduced.

## Building original source

~~~js
import {buildTurbolongRuntime} from './runtime.mjs';

const runtime = await buildTurbolongRuntime({
  sourceCapsuleFile: '/private/turbolong/publisher-source.json',
  installationDirectory: '/private/turbolong/original',
  buildDirectory: '/private/turbolong/build',
  directory: '/private/turbolong/runtimes/built-generation-1',
  buildTargets: [
    'scripts', 'binaries', 'contracts', 'frontend', 'alerts', 'cargo-sources',
  ],
  nodeExecutable: '/selected/bin/node',
  npmExecutable: '/selected/bin/npm',
  cargoExecutable: '/selected/bin/cargo',
  rustcExecutable: '/selected/bin/rustc',
  stellarExecutable: '/selected/bin/stellar',
  nodeHeapMB: 512,
  cargoJobs: 1,
  includeTools: ['node', 'npm', 'stellar', 'cargo', 'rustc'],
  includeRustToolchain: true,
  progress: observation => console.log(observation),
});
~~~

Use sourceDirectory instead of sourceCapsuleFile when the complete original tree already exists. The build uses the original npm scripts and Cargo sources. The selected upstream scripts and frontend have no committed npm lockfile; their first dependency resolution and resulting installed graph are therefore retained as the actual build selection. The alerts package has its original npm lockfile. Cargo uses the original lockfiles and selected native toolchain, and its vendored dependency sources can be captured with the cargo-sources target.

The build keeps each command's executable, argument order, input, process identity, complete stdout/stderr, exit result and generated artifacts. A resumed build inspects these original receipts before starting a remaining command. Failed reversible build attempts remain in the build history. The builder does not run repository test suites, deploy contracts, execute financial keeper actions or create a CI workflow.

Neither the original repository nor this companion invents a pinned Rust or Stellar CLI version. The manifest records the actual selected executable and its libraries. Received executable compatibility is checked against the receiving platform and Node ABI.

## Descriptor and portable manifest

A resolved runtime returns:

~~~js
{
  id,
  directory,
  manifest,
  manifestSha256,
  version: 'f017de605bb020bf3d7f4285aae4c654508e8d86',
  sourceDirectory,
  entrypoints,
  tools,
  platform,
  capabilities,
}
~~~

The public pin is {id, manifestSha256, version, platform}. Private absolute paths belong to the local descriptor and configuration.

The immutable manifest is manifest.json, encoded with JSON.stringify(manifest, null, 2) followed by one newline. Its schema is stellar-forge.turbolong-operations.runtime.v1. It declares every regular file with complete byte count, SHA256 and mode, directories, confined relative links, source identity, tool and package relationships, original build receipts and platform. The content identity does not depend on an originating absolute path.

readTurbolongRuntimeManifest({directory, expectedManifestSha256}) returns {manifest, manifestSha256, bytes}, where bytes is the exact manifest Buffer. verifyTurbolongRuntime verifies a complete original layout. resolveTurbolongRuntime selects and verifies an existing generation through directory or runtimeDirectory.

## Independent reconstruction

~~~js
import {
  restoreTurbolongRuntime,
  bindTurbolongRuntime,
} from './runtime.mjs';

const restored = await restoreTurbolongRuntime({
  sourceDirectory: '/private/received/runtime-files',
  destination: '/private/received/runtime-installed',
  expectedManifestSha256: originalManifestSha256,
});
const binding = await bindTurbolongRuntime({
  directory: restored.directory,
  applicationDirectory: '/private/received/application/source',
  expectedManifestSha256: restored.manifestSha256,
});
~~~

The transport may contain only manifest.json and its declared regular files. Symlinks may be absent and temporary directory modes may be private. Restore verifies every declared file, reconstructs confined links and original modes, and verifies the final runtime. Undeclared paths, traversal, conflicting generations and changed bytes are rejected. Binding returns the selected runtime source/tool configuration; it does not rewrite application source or substitute dependencies.

The operating workspace's full export carries every referenced runtime by ID and manifest hash. A report-only export carries the selected report members, without the full private execution directory. Receiving returns the actual runtime installation paths for the new host. Original commands and their installed packages resolve within the reconstructed graph.

## Private execution configuration

A connection may hold its private selection directly or under private:

~~~json
{
  "id": "selected-mainnet-installation",
  "network": "mainnet",
  "rpcUrl": "https://your-selected-rpc.example",
  "private": {
    "runtime": {
      "runtimeDirectory": "/private/turbolong/runtimes/generation-1",
      "expectedManifestSha256": "REPLACE_WITH_ACTUAL_MANIFEST_SHA256"
    },
    "executionDirectory": "/private/turbolong/executions/mainnet",
    "actorPublicKey": "REPLACE_WITH_ACTUAL_SELECTED_PUBLIC_ACCOUNT",
    "secretFiles": {
      "KEEPER_SECRET": "/private/credentials/keeper",
      "DEPLOY_SECRET_KEY": "/private/credentials/deployer",
      "KEEPER_INGEST_KEY": "/private/credentials/telemetry",
      "STELLAR_BROKER_PARTNER_KEY": "/private/credentials/broker"
    }
  }
}
~~~

Only provide bindings needed for the selected action. These examples are editing templates, not deployed accounts or credentials. Keep secret files owner-readable and outside the workspace. The original keeper receives its original environment variable names. The selected signer public key is derived through the retained original SDK and compared with actorPublicKey before a financial command starts.

Raw private command output remains in the private execution directory. Returned observations redact selected secret values, including escaped and encoded forms, while retaining the original wire byte count and digest. A private redaction binding retained with the operation supports later inspection after credential rotation. That private binding is excluded from artifact exports.

## Original execution interface

~~~js
const execution = await openTurbolongRuntimeExecution({connection});
const original = await execution.prepare({action, args, requestId});
const request = {
  schema: 'caller-selected-schema',
  id: requestId,
  requestId,
  action,
  args,
  original,
};
const outcome = await execution.perform({request});
await execution.close();
~~~

The product's native facade supplies its complete frozen request and hash. It stores the returned preparation unchanged under request.original. The preparation contains the public runtime pin, execution ID and origin, action, original arguments, ordered native commands, input descriptor, public actor identity and selected scope.

perform accepts this frozen request. reconcile({operation}) reads the same original command receipts. Outcomes preserve COMPLETED, PARTIAL, FAILED, PENDING or UNCERTAIN and return the runtime pin, original observations, content, logs, artifacts and transaction references.

Completed commands are not replayed. A read-only multi-command operation can continue a remaining never-started command after every prior original command completed successfully. A nonzero command remains failed. An uncertain mutating command is not resent, and a received mutation whose original execution custody is unavailable does not acquire a new signing authority. Its original transaction references support explicit provider reconciliation.

An execution receipt is process evidence. It does not itself prove a successful chain transaction. Transaction references extracted from the original output preserve their source offsets and hashes, and must be checked through the original provider before settlement is asserted.

## Original action boundaries

| Action | Original behaviour and retained boundary |
| --- | --- |
| vault.inspect | Reads selected deployed strategy methods through the original SDK and simulation path; retains native tuples, integers and scale information. |
| vault.shareInspect | Reads the actual selected share token's metadata, supply and requested balance or allowance. |
| keeper.rebalance.probe | Runs the original keeper dry run with actual contract configuration and health factor. |
| keeper.rebalance.execute | Runs the explicitly selected original corrective keeper with the original signer and vault list. Unknown dispatch is preserved for reconciliation. |
| keeper.harvest.quote | Runs the original mainnet quote flow. Telemetry is disabled unless explicitly selected, because the upstream dry run can post telemetry. |
| keeper.harvest.execute | Runs the original claim, route, swap and reinvest flow using the supplied actual vault configuration. Broker and Soroswap settlements retain one original execution identity. |
| routing.report | Uses the original route reporting script and retains its original report artifact and window. |
| rates.project | Runs the original Rust projection model with supplied original inputs. No replacement rate formula is used. |
| rates.simulate | Runs the original native simulation and real chain reads. It is not probed with an unsupported --version flag. |
| deployment.plan | Uses original DRY_RUN preparation. The upstream script stops after its first WASM installation preparation; it is not a complete deployment preview. |

rates.project accepts canonical decimal strings or safe JavaScript integers for the original i64 fields rBase, rOne, rTwo, rThree, utilOpt, irMod and backstopFP, and the u64 fields supplyEps and borrowEps. Bounds are validated with BigInt and serialized as original Rust JSON integer tokens without rounding. Floating point fields remain finite numeric inputs.

Each artifact is returned as a complete bodyBase64 or a contiguous complete chunks array, with exact byte count and SHA256. A pointer to an inaccessible old host is not an artifact delivery. readTurbolongExecutionFile provides bounded access to selected retained execution output.

## Whole native commissioning

The ordinary source programme is operations/native-programmes/operate-turbolong-operations.mjs in the parent SCF source tree. It accepts the complete companion source packet and privately supplied publisher source, existing installation or verified runtime. It preserves application generations while continuing the same original workspace, request IDs, process receipts and provider cursors.

It performs the selected original build or verifies an existing runtime; independently reconstructs the full runtime; captures actual public provider and selected vault history; produces immutable operating editions and reports; exercises the real operator and browser response-loss recovery; and transfers the complete workspace/application/runtime through archive receiving to an independent directory.

The full programme records failed required stages while continuing independent source, report and receiving work. It does not convert empty provider history, quote-only evidence, a successful HTTP read or a single commissioning cycle into 50 executed mainnet harvests, 30 days of rate history or a 14-day green watch. Those milestones require the original dated operational evidence described in OPERATING_DATA.md.

Published testnet deployment addresses come from the unchanged deployed-vaults.testnet.json. The selected upstream source does not provide a deployed mainnet strategy list, so mainnet strategy operations require an actual configured vault selection. The original completion report is a draft with mainnet gates; the programme preserves that source distinction.

No installer is necessary when the original dependency graph and runtime are already available. Use private task-local build/cache directories and retain outputs within one accepting native lifetime when the host's temporary filesystem is not persistent across calls.
