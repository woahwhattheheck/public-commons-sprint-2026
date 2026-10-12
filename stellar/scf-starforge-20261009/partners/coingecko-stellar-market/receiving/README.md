# CoinGecko installed Applications delivery

Operate an existing CoinGecko research project through its installed Stellar Forge Applications entry. The workflow keeps its original source captures, request collection, snapshots, comparisons and provider plan while exercising the customer's complete start, edit, stop, reopen, recovery and portable delivery journey.

The product entry is described in [COINGECKO_APPLICATIONS.md](../../../distribution/runtime-workspace/COINGECKO_APPLICATIONS.md). The receiving driver uses that original Applications model and the original CoinGecko HTTP interface.

## Choose the existing runtime first

If the selected source already has a READY original runtime installation, use it directly with `applications.mjs`. Its `runtime-install.json`, original source archive, runtime profile, package lock and dependencies remain in that installation. The driver's initial inspection validates the runtime and checks that the selected source directory is the one the installer owns.

If the selected source has not been installed, use `installed.mjs`. It calls the original `buildDistribution`, `prepareRuntimeInstall` and `installRuntime` modules from one immutable source commit. It creates a separate bare Git repository for that operation and can read an existing Git object directory through Git alternates. That donor stays read-only and must remain available while the receiving operation uses it.

Use a Node version supported by the original package, Python 3.11 or later, Git, npm, and an existing Playwright installation with Chromium. Browser code and the browser executable are explicit inputs. Browser receiving is part of this complete workflow.

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

Optional application inputs are `applicationLabel`, `port`, `configurationFile`, `allowLocalMerchant` and `sourceManifestSha256`. A saved private configuration is passed to the original launcher by filename. The receiving driver does not serialize that file's contents into its output.

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

Application starts and mutations have retained operation IDs. A retry uses the original request body and revision. If a completed instance must be started again, the driver retains that ended instance in its history and gives the next start a distinct ID. The initial workspace and database identity survive driver restarts.

The interruption stage acts on the driver's own managed CoinGecko listener after checking the saved and live instance IDs and PID. The remainder of the project is received through the original interfaces. This journey uses existing captured sources and does not prepare a new provider purchase.

## Resume an interrupted receiving

Use the same manifest or bootstrap selection, work directory and output directory. The checkpoint reopens completed stages and continues the next unfinished stage. Keep any retained native operation attached to its original runner; use that runner's existing status and resume mechanism before creating a replacement.

The bootstrap leaves a failed original runtime preparation in place. If the original installer reports that incomplete preparation requires recovery, use its maintained `runtime-install recover` workflow into a new directory and consume that completed runtime through the direct manifest path. Existing applications stay bound to their original installation.

Do not remove an original running instance or its workspace to make a restart appear clean. The stored start and launch records allow the actual original instance to be inspected and recovered.

## Delivery files

A completed receiving writes:

- `NATIVE_APPLICATIONS_RECEIVING_RESULT.json`: the selected source, runtime, project and application IDs; every completed stage; original and restored source results; retained run history; final data counts.
- `coingecko-managed-complete-handover.json.gz`: the complete original research export including its portable application source.
- `coingecko-managed-desktop.png` and `coingecko-managed-mobile.png`: the actual selected-project views.
- `application-checkpoint.json`: the retained mutable receiving checkpoint for continuation.

The bootstrap also retains `installed-receiving-checkpoint.json`, the original package build, original runtime installation and generated direct manifest in its work directory. These files let another operator continue the same source and project without reconstructing the work from screenshots or a chat transcript.

The managed application source was integrated in PR1640. The existing original MCP research and durable job recovery deliveries precede this installed Applications journey. Completion of this additional journey is recorded by its own final result after all seven stages return.
