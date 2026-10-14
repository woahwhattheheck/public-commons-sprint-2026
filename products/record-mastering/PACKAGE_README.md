# Record Mastering: install, review and deliver complete customer records

This package joins overlapping source lists into an editable master-record workspace. Keep each original CSV edition, review possible matches, choose merges, splits and field values explicitly, then issue a complete customer dataset with field provenance. A separate private workspace export preserves the original sources, decisions, requests and delivery history for independent editing.

The SQLite workspace owns record decisions. Runtime Workspace Applications owns the listening application and its process history. The installed setup, browser and eight Merchant tools use those same owners.

## Guides and source

| Work | Maintained source |
| --- | --- |
| Prepare a runtime, review and save an application, connect the Merchant host and retain deliveries | [Operating guide](OPERATING.md) |
| Run the complete installed example, resume its saved requests and reopen customer exports | [Installed receiving](receiving/README.md) |
| Select actual source, dependency, runtime and browser paths | [Preparation input](receiving/preparation.example.json) |
| Review source editions, matching, explicit decisions and delivery formats | [Native workspace guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/README.md) |
| Inspect typed native calls and the original eight tools | [Typed client](../../stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/client.d.mts) and [Merchant tools](../../stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/mcp-tools.mjs) |
| Build, install and transfer the exact selected release | [Build](../../stellar/scf-starforge-20261009/distribution/BUILDING.md), [installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) and [transfer](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) |

[PUBLIC_SOURCE.json](PUBLIC_SOURCE.json) records complete original source identities and the shared interfaces used for this public package. [AGENTS.md](AGENTS.md) carries the source preservation and actual product inspection instructions.

## Build an immutable public source edition

From the complete public repository, select the actual commit containing this product:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /ABS/public-commons-sprint-2026 \
  --ref ACTUAL_PUBLIC_COMMIT_SHA \
  --selection record-mastering-workspace \
  --out /ABS/PRIVATE/record-mastering-release
~~~

Keep the returned archive, source manifest and complete byte count/SHA-256. An interrupted build resumes its same original commit, recipe and output directory with `--resume`. A deliberate source change uses a separately selected build. Preserve any already installed receiving operation's original package, requests, customer state and runtime selection.

The recipe composes four existing source-owned contributions:

| Contribution | Role |
| --- | --- |
| `record-mastering` | Native CLI/client, Application provider, Merchant provider and original browser assets |
| `record-mastering-workspace` | Installed prepare/save/connect/start/recover/stop/export workflow |
| `merchant-provider-tools` | Inspection of the selected Merchant provider declarations |
| `merchant-console-browser-assets` | The maintained Merchant Console's declared browser assets |

It retains the complete mastering application and installed receiving programme, together with the original Runtime, SF82 release store, Merchant host, buyer/seller and dataset support selected by the recipe. Shared provider and application loaders remain the maintained implementation. The native builder performs the final source/import and browser-route closure against the chosen Git edition.

There is no separate Record Mastering Grant Installation profile in this adoption. Use its existing runtime-profile/runtime-install and Applications workflow described below.

## Install and operate the same workspace

Use the Node version required by the selected public runtime profile; the standalone native engine requires Node 22.16 or newer with `node:sqlite`. The managed host also needs its declared Linux/Python/flock environment. The standalone mastering command has no npm dependencies; Merchant MCP uses the exact dependency graph declared by the selected runtime profile.

Prepare, install and inspect the original archive:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /ABS/PRIVATE/record-mastering-runtime \
  --archive /ABS/PRIVATE/record-mastering-release/ACTUAL_ARCHIVE.tgz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --operator --feature mcp

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /ABS/PRIVATE/record-mastering-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /ABS/PRIVATE/record-mastering-runtime --load --source
~~~

Use the original installer's actual READY result. A compatible complete retained dependency tree and its matching lock can use the documented adoption path. Offline mode requires the actual selected package bytes; preserve the chosen mode and original dependency inspection.

The [operating guide](OPERATING.md) supplies complete request examples and commands for creating or receiving the original workspace, preparing its installed setup, reviewing and saving Applications, connecting the original Merchant host and starting that saved application. Actual source/input paths stay in the private request. Input aliases retain their full file identities. Changing inputs requires a new reviewed setup.

Both `record-mastering` and `record-mastering-workspace` run through the installation's maintained `runtime-install-cli.mjs run --dir ... --` entry. Keep the setup's `product.json`, original request/source, Merchant configuration, starts and exports with that same operator workspace. Use its existing `status`, `recover` and `stop` commands for the actual operation; a saved request or disconnected UI does not establish that the owned process has closed.

## Review records and produce a complete handover

Import a whole inspected CSV into its source, compare the saved refresh and activate it explicitly. Matching groups are suggestions for review. Merges, splits, chosen field values, annotations and exclusions use the native revision-bound writer and stable request IDs. Exact text values, including leading zeroes and decimal strings, remain intact.

Inspect all required pages of master records, matching groups, field candidates, source changes and history. When a source-selected field changes, retain the existing decision and review its new candidate rather than silently substituting a value.

Create an immutable delivery from the selected source editions and reviewed fields. Its complete dataset includes `master.csv`, `dataset.json`, field provenance, conflicts and recipient instructions. Original seller configuration owns any optional commercial distribution.

An editable workspace packet is a separate deliverable containing the original sources and private decisions. Explicitly select its recipient. The receiver verifies its full SHA-256 and uses a new destination, preserving the workspace identity and history while subsequent editing becomes independent. The packet does not include arbitrary host paths, credentials, browser sessions or the installation's dependency tree.

The eight Merchant tools use the same configured workspace and native writer. Retained exports and large results must be read through every offset until completion and checked against their whole identity. Reuse the saved export request after interruption; later sender edits must not relabel its earlier frozen bytes.

## Continue the complete original receiving course

Use [receiving/README.md](receiving/README.md) and its complete preparation input. Replace all illustrative absolute paths and `sourceCommit` with the actual selected public checkout, immutable commit, build/runtime directories, existing dependency inputs and available browser executables.

~~~sh
node products/record-mastering/receiving/prepare-installed.mjs \
  --request /ABS/PRIVATE/preparation-request.json

node products/record-mastering/receiving/installed-receiving.mjs \
  --case /ABS/PRIVATE/preparation/receiving-case.json
~~~

The programme operates the original fictional CRM/billing sources through Applications, desktop and narrow browser use, all eight Merchant tools, exact customer/export receiving, later sender work, independent recipient edits and cold reopening. Reuse its original request and operation directory after interruption. Retain native source/dependency diagnostics and reconcile the existing owner before resuming.

All records in the committed example directory are explicitly fictional. The original recipe excludes the optional prebuilt `example/customer-delivery.gz`; the original initializer and writer generate a new selected example delivery. An actual customer archive remains a separately supplied authorized input with its own complete identity.

## Inspect the exact delivered product

Before presenting this product or calling it ready, its producing worker must open the exact outgoing version, personally look at its actual desktop and narrow screens, and operate important populated, empty, loading and error states. Exercise source import/refresh, matching and field choices, delivery, download and independent editable reopening.

Open every outgoing attachment in its normal recipient-facing viewer: the CSV, configuration, provenance, conflicts, instructions, archive contents and editable workspace. Inspect every relevant report page; play any accompanying media. Actual screenshots must be viewed. Repair unreadable text, poor contrast, clipping, overflowing controls or broken navigation in the maintained source and inspect the affected outgoing version again.

Source review and pure composition establish source selection only. They do not establish a successful Node installation, native SQLite operation, rendered browser or completed customer handover. Preserve the original actual receiving result and any precise unresolved runtime issue without inventing acceptance.

## Saved customer delivery comparison

The existing Deliveries desk compares two immutable editions with complete record, field, exact-text, resolution and original-provenance changes. The same native read powers CLI, typed client and Merchant query. Complete JSON/HTML/CSV exports and verified reopen retain both original deliveries; source activation and editing remain with the original workspace. See [the full comparison guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/DELIVERY_COMPARISON.md).
