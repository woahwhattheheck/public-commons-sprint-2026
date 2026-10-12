# Safe transaction review — installed product

This selected Starforge package carries the complete original Safe buyer workflow: receive or capture the caller's transaction, prepare and review one native simulation purchase, recover the same intent, compare retained results, and receive its full portable handover. It also carries the original Tenderly merchant workspace and Buyer workspace so the customer and operator use one compatible installed source.

The original distribution builder reads [safe-review.json](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/selections/safe-review.json) before composing registrations. The archive retains that exact recipe, source commit, file inventory and dependency declarations. The installed Applications catalog contains **Safe simulation buyer**, the original **Tenderly** application and the original **Buyer** application.

## Build from the selected original source

Use the maintained source builder from the selected repository checkout:

```sh
node /absolute/checkout/stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout \
  --ref FULL_SOURCE_COMMIT_WITH_THIS_SELECTION \
  --selection safe-review \
  --out /absolute/releases/safe-review
```

The completed original build returns the source archive, complete archive SHA-256 and selected manifest. Pass those actual values to the installer. The version includes the source commit and `.selection.safe-review`; the source manifest binds the exact original recipe bytes.

Continue an interrupted build in that same output:

```sh
node /absolute/checkout/stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/releases/safe-review --resume

node /absolute/checkout/stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/safe-review --status
```

An omitted selection on resume inherits the retained selection. A different product uses its own output directory. The full toolkit and each existing customer build keep their original source and output identities.

## Install the complete runtime

Use Linux, Node.js 22.16 or newer, Python 3.11 or newer, npm and `flock`. The original selected dependency declarations determine any higher Node requirement. Create the real private parent directory before preparing a new installation.

Run the maintained `runtime-install` command from an existing toolkit, or use its original `distribution/runtime-install-cli.mjs` source entry:

```sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/safe-review-01 \
  --archive /srv/starforge/downloads/ORIGINAL_SAFE_REVIEW_ARCHIVE.tgz \
  --sha256 ORIGINAL_COMPLETE_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install \
  --dir /srv/starforge/runtimes/safe-review-01

starforge runtime-install inspect \
  --dir /srv/starforge/runtimes/safe-review-01 --load --source

starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- source

starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- \
  registrations --source palmera-safe-review
```

The native profile supplies the original Stellar/x402 dependencies. The selected `schema`, `openapi` and `mcp` features supply the maintained validation, merchant description and MCP runtimes. `--operator` records the original Linux/Python/flock requirements. These flags describe this complete merchant/customer edition; its actual profile, exact resolved lock and import checks determine readiness.

Installation uses the original npm registry/cache configuration. When the original cache is complete, append `--offline --cache /absolute/original/npm-cache` to the installer. For a failed installation, use `runtime-install resume --dir SAME_DIRECTORY`. For a partially prepared source or a runtime that needs receiving at another path, use the maintained `runtime-install recover --from ORIGINAL_DIRECTORY --dir NEW_DIRECTORY` workflow described in the [runtime installation guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md).

Preparation and inspection return `sourceRoot` and `dependencyRoot`. The original source tree normally sits at `RUNTIME/package/source`. The native Buyer runtime is that exact `sourceRoot` plus `stellar/scf-starforge-20261009/sf88-operator-buyer-cli`. Use the returned absolute path when configuring the customer application.

## Receive the original public Safe transaction

The package includes the original recorded Gnosis owner-replacement transaction, its source references, the exact receiving helper and the complete saved-record format. Use the existing caller application's original Palmera 1.0.0-beta.1 dependency and its own Protocol Kit 4.1.0 resolution. The Safe receiving helper checks those versions through the caller root. Keep that application's original dependency lock and installed runtime together.

Set the existing RPC environment variable through the host's private environment, then dispatch through the selected runtime:

```sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- \
  safe-review public-read \
  --caller-root /srv/palmera/application \
  --rpc-env GNOSIS_RPC_URL \
  --out /srv/starforge/safe-review/public-owner-change

starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- \
  safe-review public-open \
  --directory /srv/starforge/safe-review/public-owner-change

starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- \
  safe-review public-caller \
  --directory /srv/starforge/safe-review/public-owner-change \
  --out /srv/starforge/private/public-safe-transaction.mjs \
  --caller-root /srv/palmera/application \
  --rpc-env GNOSIS_RPC_URL
```

The live read retains the original outer transaction and receipt observed through the selected SDK, verifies the complete encoded calldata and Safe hash, and writes the original selection. The saved context carries its exact network, block position, outer caller, gas limit and decimal-string value. `public-open` verifies the saved bytes without another RPC read. The generated caller binds that exact receiving record and uses the original SDK when a capture reopens it.

The receiving directory is immutable. Copy its complete original files when moving it; generate a new caller filename for the new absolute record/runtime paths. The [public receiving guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/partners/palmera-safe-review/receiving/PUBLIC_SAFE_RECEIVING.md) describes the retained observation, source identity and full command/API contract.

## Open the operator and complete the purchase workflow

In the installed Applications host, select **Safe simulation buyer**. Bind the private operator workspace, the original SF88 runtime directory returned above, the existing Buyer state and analysis directories, and optionally the original buyer operator profile and generated caller module. Review, save and start the application through the original Applications controls. Open follows its authenticated loopback startup URL. Its Stop and restart history stay in the original application record.

The same original listener is available directly:

```sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/safe-review-01 -- \
  safe-review-workspace \
  --directory /srv/starforge/safe-review/operator \
  --runtime /srv/starforge/runtimes/safe-review-01/package/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/starforge/safe-review/buyer \
  --analysis /srv/starforge/safe-review/analysis \
  --capture-module /srv/starforge/private/public-safe-transaction.mjs \
  --operator-profile /srv/starforge/private/operator-profile.json \
  --port 0
```

Use the actual returned `sourceRoot` if the installation lives elsewhere. Omit the optional caller module or operator profile when receiving saved selections and completed handovers.

The complete operating sequence is:

1. **Capture or receive.** Capture through the original caller with the saved six-field context, or receive the exact `public-owner-change/selection` directory. Keep the capture UUID through a lost reply.
2. **Prepare or import.** Use the merchant's original plan and current body-bound ticket for the selected `simulation.json` bytes. Choose the original intent ID once. A saved preparation imports that same original Buyer operation.
3. **Review.** Open the complete original native review. The retained review SHA selects the exact saved review file, including after an interrupted HTTP reply.
4. **Purchase and recover.** Explicit execution uses the original Buyer, signing policy and Stellar payment journal. Reopen the same intent after transport loss. The operation's abort signal and cleanup remain with that original process.
5. **Analyze and compare.** Receive the complete native result into the original Tenderly analysis workspace. Both successful and reverted EVM simulation outcomes remain completed results for analysis.
6. **Deliver and reopen.** Export the complete handover, receive it in a new private directory, inspect the manifest and reopen its original selection, result, comparison and report. Downloaded member lengths and hashes come from those retained original descriptors.

The [full operator guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/partners/palmera-safe-review/operator/OPERATOR.md) includes the saved review, same-intent recovery, purchase controls and complete handover UI. The [adapter guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/partners/palmera-safe-review/README.md) supplies the exact CLI and application-owned SDK examples.

## Merchant and automation surfaces in the same edition

The selected `tenderly`, `tenderly-workspace`, `tenderly-customer` and `tenderly-analysis` commands operate their original merchant, customer and retained analysis source. The Tenderly Applications provider opens the existing merchant workspace. Use the actual merchant account, project, provider credentials, public endpoint, payment terms and selected facilitator from that configuration.

The original Buyer application and `buyer-agent` typed client expose the existing Buyer workspace and file receiving. The selected merchant MCP registry contains the original Buyer workspace and Tenderly workspace providers. Use `merchant-mcp`, `merchant-mcp-stdio` and `merchant-mcp-client-config` with their current original connection/configuration files. The preserved generic seller and operations commands support the same underlying merchant lifecycle.

All selected command and import names are recorded by `starforge registrations`. The package's Safe entrypoints remain under `@tokenjunkielabs/starforge-merchant/buyer/safe-review`; the receiving record and CLI are exported as `.../buyer/safe-review/receiving/record` and `.../buyer/safe-review/receiving-cli`.

## Source and receiving continuity

This recipe selects 31 original commands, 52 exports, three Applications providers and two merchant MCP providers. It keeps the full Safe, Tenderly and SF88 source trees, the original Python operator/governor roots, the existing merchant workspace templates, mapped browser assets, public receiving input and operating guides. The unchanged builder adds ordinary static import dependencies. The broad toolkit re-export index is excluded from this product selection; the named package exports above remain original source.

Keep the completed build's archive/manifest, the installed profile and resolved lock, and the actual customer workspace/result/handover identities together. Source installation and a customer purchase have their own retained operations. Continue each original operation in its own directory when receiving or recovering the product.
