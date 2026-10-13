# Install the complete BIM application

The installer copies the selected authored application into a new installation, resolves or adopts its exact npm lock, and builds the real browser bundle with the pinned esbuild. It uses the existing native/watershed_process.py process owner under one inherited Linux lease. It does not create a workspace, contact a liquidity provider, sign a transaction, or start a server.

Use Linux, Python 3, and Node 22.16 or later. Select the actual regular Node executable and actual npm-cli.js file. Resolve distribution symlinks before selecting them. The selected PATH must find that exact Node first, because npm may launch Node children. The package pins the server Stellar SDK to 16.0.1, Wallets Kit to 2.7.1, and esbuild to 0.25.10. Kit's own transitive SDK is kept separately in the actual lock. Optional Privy/React peers belong to a selected host application; see NEXT_INTEGRATION.md.

## Select one complete installation

The source directory must contain source-inputs.json and every file it lists, including this driver and the unchanged native process owner. source-inputs.json is the self-excluding authored roster. Its complete bytes are the sourceManifestSha256 input, not a digest of parsed/reformatted JSON.

When sourceRoot also contains source-files.json, the driver selects the complete original installed edition. It verifies and freezes every listed original source, package lock, bundle and build artifact before npm, copies those exact bytes, and uses npm ci to materialize dependencies. The build entry adopts the existing COMPLETE bundle without rerunning esbuild. The original build/runtime claims remain unchanged in BUILD_RECEIPT; this recipient's actual Node/npm/runtime/process receipts are separate. This is the cold-recipient path for an exported installed application and keeps its original workspace source identity intact.

The directory below is an installation-operation directory. The application is built in its application child. Keep that tree separate from authored source and all live workspaces. The first invocation requires a new/empty directory. Later invocations require the exact same complete input, source, runtimes and driver.

Write one original input JSON using actual absolute paths and exact SHA-256 values:

~~~json
{
  "schema": "bim.install-input.v1",
  "operationId": "BIM-ORIGINAL-INSTALLATION-ID",
  "directory": "/ABS/new-bim-installation",
  "sourceRoot": "/ABS/complete-authored-application",
  "sourceManifestSha256": "REPLACE_WITH_SHA256_OF_COMPLETE_SOURCE_INPUTS_JSON",
  "node": {
    "path": "/ABS/node/bin/node",
    "sha256": "REPLACE_WITH_SHA256_OF_ACTUAL_NODE",
    "version": "v22.16.0"
  },
  "npm": {
    "path": "/ABS/node/lib/node_modules/npm/bin/npm-cli.js",
    "sha256": "REPLACE_WITH_SHA256_OF_ACTUAL_NPM_CLI_JS",
    "version": "REPLACE_WITH_ACTUAL_NPM_VERSION"
  },
  "searchPath": "/ABS/node/bin:/usr/bin:/bin",
  "timeoutSeconds": 1800
}
~~~

The shown Node version is a supported example; retain the actual selected version. Optional lockFile is an absolute path to an already frozen complete package-lock.json. Its root declarations and all direct exact versions must match the selected package.json. A lock from another application is rejected.

Run the actual source-selected entry:

~~~sh
python3 -B /ABS/complete-authored-application/native/install.py \
  --input /ABS/original-installation-input.json
~~~

No shell string is executed by the driver. It records and runs the exact argument arrays for Node version, npm version, dependency installation and browser build. It supplies empty, retained user/global npm configuration files, an owned cache, and the selected executable PATH. Do not put registry credentials into this input. This application uses public dependencies; an environment requiring an authenticated registry needs its own explicitly selected source/configuration integration.

Without a supplied lock, the first dependency command is the selected Node plus npm-cli.js install --ignore-scripts --no-audit --no-fund. With a supplied or retained lock it is ci with the same flags. A lock left by an interrupted original attempt is validated and frozen before a subsequent npm invocation. A differing lock is rejected, not overwritten.

The final build command is the selected Node plus application/tools/build.mjs. esbuild's native optional binary runs under the same original process owner. All children must close before the driver acknowledges success. The build retains the exact dependency input descriptors, full metafile, JS/CSS bundles, linked legal text, BUILD_SELECTION.json, BUILD_RECEIPT.json and source-files.json.

## Resume and inspect the same operation

Use the identical invocation and original input. A phase with an accepted complete receipt is verified and adopted. If the process completed and result.json was durably written but accepted.json publication was interrupted, the existing complete result and its full artifacts are adopted before any new invocation. Failed/unfinished attempts stay in their original numbered directories.

A complete installation is reopened by verifying all original phase receipts, source/runtime selections, full installed source roster, lock, build outputs and retained dependency inputs. It performs no npm operation or bundle rebuild. Changed source/runtime/build bytes are an error. Repair the selected installation using its original artifacts or choose an explicitly new installation; do not edit source-files.json to admit a changed file.

The operation root contains:

- input.json and complete executing-driver.py/executing-owner.py;
- authored-source.json and source-selection.json with the full original authored bodies and any selected original installed profile;
- adopted-installed-source.json when receiving a complete previously installed edition;
- actual runtime-selection.json and child environment.json;
- complete phase request/process/stdout/stderr/result/accepted files;
- the frozen package-lock.json and any supplied original lock;
- application with the actual installed dependencies and all generated artifacts;
- complete.json only after the whole source/build/process proof is complete.

Retain complete logs even when a phase fails. They contain the actual compiler/package-manager output needed to fix that original installation. The complete receipt says providerExecution:false. A successful install is a build result, not a wallet/provider or rendered-product result.

## Open the product

Follow BIM_OPS.md using the completed application child. Create the workspace outside the installation. Start either the standalone host or the selected persistent Next owner against that workspace, never both simultaneously. Keep the actual runtime/package lock and complete bundle with the installed edition. The Next public-asset publisher uses a separate explicit output directory.

Before client/demo readiness, follow the complete current owner instruction in AGENTS.md: open/run/render this exact installed product, actually LOOK at the screen or its real screenshots, operate critical controls at screenshare and narrow widths, inspect populated/empty/loading/error states, download and reopen every relevant attachment in its normal viewer, and fix the actual affected output. Compilation, an HTTP response, a screenshot not viewed, or source review is not this inspection. Preserve the original native job/host owner; this guide does not authorize duplicate native jobs or provider/wallet transactions.
