# Native WordPress publication and customer receiving

This is one runnable customer journey through the maintained WordPress source workspace, the original Socrata publisher, SF82 release operator, and SF88/SF100 buyer and source-file delivery. It creates a private native WordPress 6.8.3 installation and retains its original responses, editions, merchant sessions, and acquired source.

The component selection is pinned in `component-source.json` to its exact published composition commit. The selector verifies all 19 component files against their native Git blob identities. The runtime launcher separately binds the managed component's original 17-file source inventory.

## Select the existing equipment

Use the existing installed merchant release layout:

```text
<release>/
  source/
    stellar/scf-starforge-20261009/
      sf30-seller-sdk/wordpress/
      sf82-seller-pilot/
      sf88-operator-buyer-cli/
      sf100-buyer-dataset-delivery/
      distribution/runtime-workspace/
```

Retain the original transitive source and installed dependencies. The WordPress runner imports those modules directly; the same SDK, signer, approval channel, RPC selection, and original buyer workspace execute the customer pages.

The selected equipment needs:

| Selection | Original input |
| --- | --- |
| `--source` | The canonical `<release>/source` directory containing the pinned WordPress component and its maintained publisher/buyer dependency closure. |
| `--helper` | Installed `integrations/native_wordpress/native-php.mjs`, released in Commons commit `408fe378d693678c25bc2e2b4227bdefea80ce1e`. Its original sibling modules remain installed together. |
| `--php` | Existing PHP 8.3 executable or extension-enabled wrapper. |
| `--wordpress-core` | Clean, unconfigured official WordPress 6.8.3 source. The helper shares its original `wp-admin` and `wp-includes` trees and keeps the new site's application state private. |
| `--sqlite` | Existing native SQLite integration selected by the helper's successful installation closure. |
| `--python` | Existing Python executable used by the packet and original SF88 receiving bridge. |
| `--chromium`, `--playwright` | Existing Chromium executable and the actual Playwright module file. |
| `--buyer-workspace` | The original configured SF88 testnet buyer workspace with its existing signer, operator approval channel and RPC references. |
| `--merchant` | Original saved merchant terms, or an original `stellar-forge.seller-service.v1` configuration. |
| `--seller-runtime` | Optional original SF82 runtime JSON containing `port`, `facilitator` and/or `allowLocalFacilitator`. |
| `--work`, `--results` | Private operation directories, separate from selected source and the existing buyer workspace. |

The merchant selector preserves the exact `network`, `asset`, `payTo`, atomic amount and remaining original payment fields. It requires `stellar:testnet`. If the original seller configuration has several routes, select one by its original ID using `--route`.

A saved terms file has the existing workspace shape:

```json
{
  "origin": "the original merchant publicOrigin",
  "path": "the original selected route path",
  "payment": {
    "network": "stellar:testnet",
    "asset": "the original configured asset",
    "payTo": "the original configured recipient",
    "amount": "the original exact positive atomic amount"
  }
}
```

Use the actual saved file for the invocation. Credential values stay in the original local environment and buyer workspace. The private WordPress fixture creates its own application password and retains it in the operation's private WordPress database and work directory.

## Freeze one invocation

Run the selector from this directory with actual canonical absolute paths:

```sh
node prepare.mjs \
  --out /absolute/operation/selected.json \
  --operation scf-wordpress-native-receiving-83dd-20261012 \
  --source /absolute/installed-release/source \
  --helper /absolute/commons/integrations/native_wordpress/native-php.mjs \
  --work /absolute/operation/work \
  --results /absolute/operation/results \
  --python /absolute/installed/python \
  --chromium /absolute/installed/chromium \
  --playwright /absolute/installed/playwright/index.mjs \
  --buyer-workspace /absolute/original/sf88-buyer \
  --merchant /absolute/original/seller.json \
  --seller-runtime /absolute/original/release-runtime.json \
  --php /absolute/installed/php-wrapper \
  --wordpress-core /absolute/official/wordpress-6.8.3 \
  --sqlite /absolute/installed/sqlite-database-integration
```

The selector writes `selected.json` privately and publishes it only once. Repeating the same selection reuses its exact bytes. It reports the invocation ID, selector SHA-256 and runner path. An existing nonempty work directory must contain the same original journey checkpoint.

The selected source directory must be named `source` beneath its original release directory. The final native CLI startup observer uses that real installed layout when checking the launched and selected source inventories.

The public runner imports the installed native WordPress helper by reference. The helper's source and original equipment remain with their maintained Commons distribution.

## Execute the original native operation

Register the selected command with the existing cloud/native job lifecycle or give this exact command to the current equipped owner:

```sh
node /absolute/installed-release/source/stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress/native/journey.mjs \
  --config /absolute/operation/selected.json
```

Use the selected native operation ID for registration, status, logs and recovery. The complete command owns its PHP server, source operator, release children, browser, and received-workspace CLI. It closes those resources before recording the final result. Select the complete component map before this operation's first registration. A retained selector and journey checkpoint continue to use their original source selection.

The source workspace and local operator retain a failed close for retry on the same owner. The workspace writer is released only after its source jobs and original publishers have closed successfully. Successful cleanup remains shared across concurrent Stop calls. The local operator normalizes its announced origin, including the default HTTP port, so the browser and selected Applications listener use the same address.

The native operation includes WordPress/PHP, Node, Python and Chromium in one equipment namespace. Its declaration must account for that whole process envelope and the private database, captures, source packet, original buyer responses and delivery files. It reuses installed runtimes.

The original testnet customer executes every required dataset page. Its session limits are computed from the actual native row count and selected page size; the total atomic cap is the original per-page amount multiplied by that page count. The source-file product uses the maintained ten-row page limit. Original signer and approval behavior remains in SF88.

## What the journey operates

| Phase | Actual behavior and retained output |
| --- | --- |
| Native source installation | Opens WordPress 6.8.3 through the existing PHP 8.3/SQLite helper. Creates published posts, a staff draft, parent/child pages, a media attachment, a taxonomy and a custom REST collection. |
| Discovery and capture recovery | Saves the source through the browser, discovers the actual REST index, then ends one real capture process with exit 73 after a response is saved and before its cursor advances. The original source engine reuses that exact response and continues native pagination. WordPress's own request counter verifies the first page was fetched once. |
| Reviewed native editions | Projects the exact PHP integer `9223372036854775807` as a string, builds the first native edition, changes/removes/adds actual WordPress records, and builds and compares the second edition. |
| Original publication and customer | Prepares and starts the original release, publishes the changed dataset through the existing version store, and runs the original SF88 customer through complete acquisition, accounting and export. |
| Browser operation | Opens native capture records, previews and compares editions, downloads the original CSV and checks the real desktop/mobile workspace. |
| Complete source receiving | Creates the original portable packet, exercises repeated exact packet restoration, projects the full source through the original dataset contract, buys all pages with SF88, then calls the original finalized-delivery and WordPress source receiver. |
| Received CLI and startup observer | Reopens the acquired private source, verifies original workspace and edition identities, launches the maintained WordPress CLI, and checks its real listener with the source-owned Applications startup observer. |

The final source metadata uses the same compact manifest summary as the product. The complete manifest remains in the original `wordpress-source.json` dataset member and is consumed by the source-file receiver. The original publisher's 1 MiB source metadata limit is preserved.

## Continue retained work

The runner writes `work/journey-checkpoint.json`, stable workspace operation UUIDs, capture IDs and original buyer session IDs. It keeps source and merchant listener selections stable across a continuation.

The native fixture stores its original operation binding and progress in the same private WordPress database. Interrupted term, post, media and added-record creation reuse their exact native identities. An already completed original deletion remains completed. Native credentials stay in that private database and selected work directory.

A completed phase is reused. Restarting an unowned process uses a new continuation operation for the current invocation while keeping the original release generation, capture and customer session. A completed purchase is read from its original acquisition. A buyer session advances only when the original SF88 report is `READY`; paid or uncertain original attempts remain with their original recovery and accounting operations. The actual report, page identity and next action are retained if the journey encounters a native continuation that needs the existing operator.

After an interrupted carrier, inspect its original native record and owned children first, then resume that same command through the maintained lifecycle. Reuse `selected.json`, the private work directory and the original buyer workspace. Earlier failed acceptance records are kept under `results/history/` when the same journey continues.

The deliberately interrupted source-capture child is part of the one journey. Its expected exit 73 is recorded in `capture-child-exit.json`; the completed journey itself must exit 0.

## Result and source adoption

The terminal result is `results/NATIVE_ACCEPTANCE.json`. It contains:

- The actual native operation and component source identity, all selected source hashes, and runner/fixture hashes.
- Each completed phase with actual source, edition, merchant, acquisition and received-workspace identities.
- The original comparison and customer reports, source manifest identity, screenshots and CSV digest.
- Final `passed`, `resourcesClosed`, cleanup errors and any retained native failure.

Desktop/mobile and received-workspace screenshots, the native CSV download and edition comparison stay beside that result. The application's existing source table and cumulative merchant package consume the same PR/component; the completed native result is joined into their original receiving/demo entry.

The CLI startup phase exercises the actual source-owned startup observer. Installation into a cumulative Applications runtime is completed by its original package owner using the existing `applicationProviders.wordpress` contribution.
