# CoinGecko installed Applications delivery

Operate an existing CoinGecko research project through its installed Stellar Forge Applications entry. The workflow keeps its original source captures, request collection, snapshots, comparisons and provider plan while exercising the customer's complete start, edit, stop, reopen, recovery and portable delivery journey.

The product entry is described in [COINGECKO_APPLICATIONS.md](../../../distribution/runtime-workspace/COINGECKO_APPLICATIONS.md). The receiving driver uses that original Applications model and the original CoinGecko HTTP interface.

## Choose the existing runtime first

If the selected source already has a READY original runtime installation, use it through `installed.mjs --retained-runtime` or directly with `applications.mjs`. Its `runtime-install.json`, original source archive, runtime profile, package lock and dependencies remain in that installation. The original runtime inspector validates the runtime and checks that the selected source directory is the one the installer owns.

If the selected source has not been installed, use `installed.mjs`. It calls the original `buildDistribution`, `prepareRuntimeInstall` and `installRuntime` modules from one immutable source commit. It creates a separate bare Git repository for that operation and can read an existing Git object directory through Git alternates. That donor stays read-only and must remain available while the receiving operation uses it.

Use a Node version supported by the original package, Python 3.11 or later, Git, npm, and an existing Playwright installation with Chromium. Browser code and the browser executable are explicit inputs. Browser receiving is part of this complete workflow. `browserArgs`, when supplied, is the exact argument array for the selected Chromium runtime. An omitted array uses Chromium defaults, with `--no-sandbox` and `--disable-dev-shm-usage` for a Linux process running as UID 0. The bootstrap carries an explicitly supplied array into the same immutable receiving manifest.

## Original project inputs

Select the existing project and its original source file IDs and SHA-256 values. The established CoinGecko delivery has five request families, fifteen original source files, captured provider examples, a request collection, two snapshots, a comparison, a research note and a provider plan. The workflow downloads the selected original sources and checks their contents before and after recovery.

A runtime manifest has this form:

```json
{
  "schema": "stellar-forge.coingecko-applications-receiving.v1",
  "sourceRoot": "/absolute/installed-runtime/package/source",
  "runtimeDirectory": "/absolute/installed-runtime",
  "consoleDirectory": "/absolute/receiving/console",
  "runtimeHome": "/absolute/receiving/runtime-store",
  "workspaceDirectory": "/absolute/original-market",
  "projectId": "ORIGINAL_PROJECT_UUID",
  "receivingDirectory": "/absolute/receiving/received-market",
  "operationPrefix": "coingecko-original-project-receiving",
  "originalSources": [
    {
      "fileId": "ORIGINAL_SOURCE_FILE_ID",
      "sha256": "ORIGINAL_SOURCE_SHA256"
    }
  ],
  "actor": "CoinGecko delivery operator",
  "playwrightModule": "/absolute/node_modules/playwright/index.js",
  "browserExecutable": "/absolute/chromium"
}
```

Replace the placeholders with the original project identity and every selected source. Keep this manifest for the whole operation. The checkpoint binds its exact bytes, so changing a completed or interrupted operation's selection is detected before further work.

Optional application inputs are `applicationLabel`, `port`, `configurationFile`, `allowLocalMerchant`, `sourceManifestSha256` and `browserArgs`. A saved private configuration is passed to the original launcher by filename. The receiving driver does not serialize that file's contents into its output.

Run the original installed workflow:

```sh
node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/receiving/applications.mjs --manifest /absolute/receiving/manifest.json --out /absolute/receiving/output
```

## Build and install the selected source when needed

The bootstrap's selection keeps the same existing workspace, project, operation prefix, source list and browser paths. Replace the runtime and console fields with:

```json
{
  "sourceCommit": "EXACT_40_CHARACTER_GIT_COMMIT",
  "gitObjectDirectory": "/absolute/existing-repository/.git/objects",
  "workspaceDirectory": "/absolute/original-market",
  "projectId": "ORIGINAL_PROJECT_UUID",
  "operationPrefix": "coingecko-original-project-receiving",
  "originalSources": [
    {
      "fileId": "ORIGINAL_SOURCE_FILE_ID",
      "sha256": "ORIGINAL_SOURCE_SHA256"
    }
  ],
  "actor": "CoinGecko delivery operator",
  "driver": "/absolute/source/stellar/scf-starforge-20261009/partners/coingecko-stellar-market/receiving/applications.mjs",
  "playwrightModule": "/absolute/node_modules/playwright/index.js",
  "browserExecutable": "/absolute/chromium"
}
```

`gitObjectDirectory` is optional; omit it when there is no original object donor. `npmCache` can point to an existing npm cache. An optional `configurationFile` passes through to the original application.

```sh
node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/receiving/installed.mjs --selection /absolute/receiving/selection.json --work /absolute/receiving/work --output /absolute/receiving/output
```

The bootstrap retains these original stages:

1. Fetch and resolve the exact commit in its own bare Git repository.
2. Extract that commit's distribution tooling.
3. Build the original manifest-selected package. A new output starts normally; an existing output resumes through the original build pin.
4. Prepare and install the original runtime with its schema dependency profile.
5. Write the selected installed-runtime manifest and invoke the complete Applications driver.

The original runtime lives at `work/runtime`, the Applications console at `work/console`, and its managed release home at `work/runtime-store`. Receiving writes a separate restored market to `work/received-market`. The original market stays at the selected original path.

## Receive with a retained original runtime

Use this route when the runtime owner has already completed the selected installation. The same bootstrap consumes its native identity and delegates to the complete Applications journey. It skips Git fetching, package extraction, building, npm and dependency copying.

Keep the original bootstrap selection unchanged. In particular, preserve its workspace, project, operation prefix and original source file IDs and hashes. Save the full JSON returned by the original `inspectMerchantRuntime` function as a separate file. This invokes the maintained inspector from that runtime's own source:

```sh
node --input-type=module -e '
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [source, runtime, output] = process.argv.slice(1);
const original = await import(pathToFileURL(join(source,
  "stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs")).href);
const identity = await original.inspectMerchantRuntime(runtime, { load: true });
await writeFile(output, JSON.stringify(identity, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
' /absolute/runtime/package/source /absolute/runtime /absolute/receiving/ready-runtime.json
```

The parent of the output file must already exist. The command creates that descriptor once and preserves an existing file. An actual successful descriptor has schema `stellar-forge.managed-runtime.v1`, state `READY`, and the original installation, profile, source-manifest and lock identities. The inspector verifies the original absolute installation paths, complete source package and selected dependency loads.

```sh
node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/receiving/installed.mjs \
  --selection /absolute/receiving/selection.json \
  --work /absolute/receiving/work \
  --output /absolute/receiving/output \
  --retained-runtime /absolute/receiving/ready-runtime.json
```

The bootstrap binds the exact descriptor bytes and path in its original checkpoint, then independently repeats the native inspection. It compares the installation ID, profile ID and hash, lock hash, source commit and manifest, dependency count and original runtime paths. Every continuation uses the same descriptor and original selection. It passes the actual selected source-manifest hash to the Applications driver and retains the requested source commit alongside the selected runtime's commit, so an explicitly selected following release remains visible.

An existing build checkpoint can adopt this explicit retained runtime if no runtime or application manifest has yet been prepared. The bootstrap preserves its prior build selection and any completed Git/build prefixes. After a retained runtime is selected, its descriptor stays fixed and a switch back to build mode is rejected. An already prepared original runtime, saved application manifest or completed receiving remains attached to its original selection. Use the original installer's recovery/upgrade and the application's existing continuation for those states.

A source archive, PREPARED profile or copied `node_modules` directory is not a completed runtime identity. If the original owner is still receiving dependencies, finish that same original installation before taking its READY descriptor. The maintained full-graph receiver uses the release's `adoptRuntimeDependencies` API to inspect and adopt the complete selected graph. It preserves PREPARED, interrupted and failed states and does not require fabricated state transitions. See the [maintained dependency receiving guide](https://github.com/woahwhattheheck/commons/blob/main/host/STELLAR_RUNTIME_DEPENDENCIES.md) and [original adoption API](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1832).

Runtime plans retain their original absolute directory, source and archive paths. Keep that completed installation in place. Relocated source/workspace archives use the original installer to prepare or recover the selected runtime at its new path; editing an old plan's paths does not establish a new installation.

## Complete operator journey

The driver retains seven stages in `output/application-checkpoint.json`.

| Stage | Result |
| --- | --- |
| Attach, save and connect | The installed runtime is attached to the original console, its CoinGecko Applications entry is saved, and its original release adoption completes. |
| Start original research | The private URL opens the selected original project. Original source bytes and the saved research collections are read through the operating HTTP interface. |
| Edit and browser receiving | A source-linked research note is saved on the existing comparison. Chromium opens the selected project at desktop and mobile sizes and records the two views. |
| Stop and reopen | The first instance closes, releases its operator lease and reopens through the saved Applications entry with a new instance ID. Original sources remain available. |
| Interruption and recovery | The driver identifies its own current managed instance through the live launch response, records that instance and PID, interrupts it, then uses the original recovery and start workflow. |
| Complete portable delivery | The original export endpoint creates the full source-bearing research handover. The original receiving server restores it into the separate market and reads back the selected original sources. |
| Final close and data reopen | The recovered application closes. Both original and received databases reopen, the original database identity is retained, and the original jobs remain unchanged. |

Application starts and mutations have retained operation IDs. A retry uses the original request body and revision. If a completed instance must be started again, the driver retains that ended instance in its history and gives the next start a distinct ID. The initial workspace and database identity survive driver restarts. A saved application is connected through the original `applicationsConnect` operation, which resumes its retained adoption when the worker was interrupted. The driver resumes a pending or queued application start through `applicationsRecover` under the same request ID. A later start receives a distinct ID only after the original run has an observed terminal result. If native recovery recognizes a surviving command whose supervisor is gone, its original stop operation ends that same command before a later start; the native response and prior run remain in the checkpoint.

The interruption stage acts on the driver's own managed CoinGecko listener after checking the saved and live instance IDs and PID. The remainder of the project is received through the original interfaces. This journey uses existing captured sources and does not prepare a new provider purchase.

## Resume an interrupted receiving

Use the same manifest or bootstrap selection, work directory and output directory. The checkpoint reopens completed stages and continues the next unfinished stage. Keep any retained native operation attached to its original runner; use that runner's existing status and resume mechanism before creating a replacement.

The bootstrap leaves a failed original runtime preparation in place. If the original installer reports that incomplete preparation requires recovery, use its maintained `runtime-install recover` workflow into a new directory and consume that completed runtime through the direct manifest path. Existing applications stay bound to their original installation.

Do not remove an original running instance or its workspace to make a restart appear clean. The stored start and launch records allow the actual original instance to be inspected and recovered. Shutdown follows the original run until it ends, including reconciliation of an interrupted worker that cannot consume its own stop marker. Original failed adoption messages and native recovery responses stay visible in the receiving checkpoint.

## Delivery files

A completed receiving writes:

- `NATIVE_APPLICATIONS_RECEIVING_RESULT.json`: the selected source, runtime, project and application IDs; every completed stage; original and restored source results; retained run history; final data counts.
- `coingecko-managed-complete-handover.json.gz`: the complete original research export including its portable application source.
- `coingecko-managed-desktop.png` and `coingecko-managed-mobile.png`: the actual selected-project views.
- `application-checkpoint.json`: the retained mutable receiving checkpoint for continuation.

The bootstrap also retains `installed-receiving-checkpoint.json` and the generated direct manifest in its work directory. Build mode retains its original package build and runtime there. Retained mode records the exact external runtime descriptor and native inspection, while the original installation remains at its existing path. These files let another operator continue the same source and project without reconstructing the work from screenshots or a chat transcript.

The managed application source was integrated in PR1640. The existing original MCP research and durable job recovery deliveries precede this installed Applications journey. Completion of this additional journey is recorded by its own final result after all seven stages return.


## Continue an ended source failure before application creation

An installer can produce a genuine READY receipt before the application review encounters a source defect. Preserve that READY receipt and the failed native result. A corrected source belongs to an explicit successor; the existing receiving manifest continues to describe the original attempt.

This source-continuation path is available when the original application checkpoint has no review, application, HTTP request, run or completed stage. It can retain an attached runtime ID and the original database binding. The receiver verifies that the selected native result actually ended with a nonzero exit and that the original checkpoint is bound to its exact original application manifest. A completed receiving result or any saved application work requires the existing application's recovery path.

Select four complete, retained originals in a private descriptor:

```json
{
  "schema": "stellar-forge.coingecko-source-continuation.v1",
  "reason": "Describe the observed source failure and the corrected source selected for this same receiving.",
  "predecessor": {
    "manifest": {
      "path": "/absolute/original-attempt/applications-receiving.json",
      "sha256": "<SHA-256 of those complete original bytes>"
    },
    "checkpoint": {
      "path": "/absolute/original-output/application-checkpoint.json",
      "sha256": "<SHA-256 of those complete original bytes>"
    },
    "terminal": {
      "path": "/absolute/original-native-record/result.json",
      "sha256": "<SHA-256 of the actual completed failed result>"
    },
    "runtime": {
      "path": "/absolute/original-output/retained-runtime.json",
      "sha256": "<SHA-256 of the actual original READY descriptor>"
    }
  }
}
```

The terminal record uses the maintained native fields: `state: "failed"`, nonzero integer `exit_code`, and actual `started_at`/`ended_at`. The runtime descriptor must identify the source and runtime directory in the failed manifest. Its installation, profile, lock and source-manifest hashes remain original even when that completed invocation's temporary runtime directory no longer exists. Keep the original archive and its independently retained dependency graph available through their existing custody.

Use the source publisher's complete corrected package and the original installer to prepare its runtime. When its compatible dependency graph already exists, use the original installer's explicit adoption API. Keep the real selected profile: a new complete schema/OpenAPI/MCP profile is distinct from a previously observed MCP-only profile. The new descriptor must come from the actual READY inspector result. This receiving continuation itself requires `--retained-runtime` and does not start a second source build or run npm.

Continue the same original selection, project, source-file IDs and operation prefix through a new receiving work/output prefix:

```sh
node receiving/installed.mjs \
  --selection /absolute/original/selection.json \
  --work /absolute/original-operation/source-continuations/01/work \
  --output /absolute/original-operation/source-continuations/01/output \
  --retained-runtime /absolute/corrected-runtime/ready-descriptor.json \
  --source-predecessor /absolute/original-operation/source-continuation.json
```

Use the maintained native placement's terminal-result successor when the original command has already ended. Retain its original business operation and input binding. The receiving work, console, runtime home and recipient directory are separate from the failed prefix; the research workspace and its database inode remain the originals. The old input, checkpoint, output, archive and result are not modified.

For direct use of `applications.mjs`, add `sourceContinuation: {path, sha256}` to the new application manifest, selecting the exact private descriptor above. The full manifest continues to select the actual READY runtime. `readCoinGeckoSourceContinuation(path, selection)` is also exported for the original caller's preflight. It only reads and validates the original evidence; it does not start an application or mutate the research database.

The successor validates the same operation prefix, project, workspace directory, actor, source-file list, private configuration and local-merchant choice. A true `allowLocalMerchant` selection is forwarded explicitly; an absent legacy flag continues to mean false. It then checks the actual original directory and database identities through the original managed-source API. Selecting corrected source never adopts a replacement research database.

With `--source-predecessor`, the bootstrap calls its published sibling `applications.mjs` directly. The original selection's `driver` path stays unchanged as historical input; it is not assumed to contain the corrected receiver. The generated manifest pins the paired receiver's absolute path and SHA-256 as `sourceContinuationReceiver`, and the bootstrap verifies the returned continuation receipt against those bytes and the selected runtime before reporting completion. Ordinary receiving without a source predecessor continues to delegate to the original configured driver.

Before any application review, the receiver retains the original managed API's configuration snapshot in `application-checkpoint.json.originalConfiguration`. This contains the configuration path and SHA-256, plus every selected profile's original path, config hash and workspace device/inode identity. The native configuration reader remains authoritative; this continuation does not create a signer or rewrite profiles. Reopening refuses a changed configuration or profile even if it remains at the same filename.

For an older failed checkpoint that selected a configuration file but has no `originalConfiguration`, add `predecessor.configuration: {path, sha256}` to the private descriptor. This must identify an existing original receipt containing the native returned `{configuration: {path, sha256, profiles}}` or that direct snapshot. Its complete original bytes are retained alongside the four required records. A newly read current configuration is not historical evidence. If both the old checkpoint and a receipt contain a snapshot, they must agree exactly. An original selection without a configuration file has the native empty snapshot `{path:null, sha256:null, profiles:[]}` and needs no extra receipt.

After verifying the actual database and configuration, and before creating the application, the receiver saves exact copies of the four small original JSON records, any supplied original configuration receipt, and the descriptor under `source-history/<descriptor-sha256>/`. Create-only publication preserves existing bytes. `SOURCE_CONTINUATION_RECEIPT.json` binds their original and retained paths, byte counts and hashes, the original failed outcome, the configuration snapshot, both runtime/source/profile identities, the actual receiver, the original configured driver and the successor manifest. It retains the original database binding and start time in the new checkpoint. The final native result and installed receiving checkpoint return that receipt's path and hash.

If this continuation is interrupted, reopen with the identical selection, descriptor, runtime descriptor, work and output paths. Its own saved request IDs and application lifecycle resume normally. Changing or removing the source-continuation descriptor, reusing the failed checkpoint as the new output, changing the original project inputs, or substituting different evidence is refused. A later failure after review or application creation stays with that newly saved original application and its normal recovery operations.
