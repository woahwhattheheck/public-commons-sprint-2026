# Installed Finage customer receiving

The installed merchant package receives complete exports from the original Finage processor. It includes the original warehouse, the complete two-export receiving program, its existing desktop/mobile reading driver, and the shared Python engine used by customer backups.

Use the same package installation and configuration when resuming an operation. A named local selection, rollback, or exported customer view retains the original source coverage and assessment. It does not change the producer's interpretation or turn an incomplete capture into a complete one.

## Find the original installed source

Install the existing merchant distribution archive through the normal release workflow in [BUILDING.md](BUILDING.md). The source-owned [Finage contribution](contributions/finage.json) is composed by that builder; no separate Finage package registry or dependency installer is required.

From the installed project's command environment:

```bash
starforge registrations --source finage
starforge finage-receive info
starforge finage-warehouse --help
```

If the package is installed locally, use `./node_modules/.bin/starforge` for the same commands. The information result identifies the actual package version, full source commit, source root, both command entries, original operating guide and each receiving source file's size, SHA256 and Git blob. An installed archive's declarations and every receiving file are checked against its original manifest. A source checkout reports that distinction and requires an explicit full commit when preparing an operation:

```bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/finage/receiving/cli.mjs info --source-commit FULL_FORTY_CHARACTER_COMMIT
```

The commit declaration in a source checkout is an operator-supplied reference; the reported file identities describe the actual local bytes. The installed archive supplies its own retained commit and file inventory.

Python 3.11 or later on Linux or macOS runs the original warehouse using only the standard library. Node dispatches the installed commands. The complete desktop/mobile reading stage uses an existing Chromium executable and Playwright module; the receiving commands do not download them or start a second browser service.

## Prepare one complete receiving operation

Select two different complete export directories from the original producer. They must contain their original `manifest.json` and every manifest-listed member. Customer-audience exports are the usual customer handoff. An operator-audience export is accepted by the original engine only with its entire declared inventory; its private producer material is verified but not copied into the customer warehouse.

The producer decides the original edition, ordered columns, exact records, source scope and assessment. Inspect the selected manifests and keep their original SHA256 values with the receiving instruction.

```bash
starforge finage-receive prepare \
  --first /customer/incoming/first-original-export \
  --second /customer/incoming/second-original-export \
  --first-sha FIRST_ORIGINAL_MANIFEST_SHA256 \
  --second-sha SECOND_ORIGINAL_MANIFEST_SHA256 \
  --output /customer/operations/finage-receiving-001 \
  --config /customer/operations/finage-receiving-001.json \
  --actor "Customer receiving operator" \
  --operation-id finage-receiving-001 \
  --python /usr/bin/python3 \
  --playwright-module /customer/runtime/node_modules/playwright/index.js \
  --chromium /customer/runtime/chromium \
  --browser-node /customer/runtime/node
```

Replace the illustrative paths and hashes with the selected original files and installed runtime. The optional `--first-label` and `--second-label` attach operator-readable labels; their defaults are the original edition IDs. If either explicit manifest hash is omitted, preparation reads and retains the exact current original manifest hash.

Preparation creates only a private configuration. It does not receive rows, select an edition, call the provider, or make a payment. It binds both ordered original manifest identities, the named actor, the stable operation ID, the source commit, the actual shared engine, Finage profile, operating program and reading driver. Repeating preparation with identical arguments reuses the same file. A different intent at that path is rejected while preserving the original configuration.

Keep the configuration beside the output directory. The original operation creates and owns its new output directory and retains all checkpoints, command outputs, exports and recovery files there. If `--config` is omitted, preparation writes `OUTPUT.receiving.json`. Do not choose an unrelated populated output directory.

The optional exact filter is the original warehouse query object:

```bash
--filter-json '{"column":"symbol","op":"eq","value":"EURUSD","kind":"string"}'
```

The label and value above are examples. Use an actual label and typed value from the received mapping. With no supplied filter, the original operating program chooses an exact non-null value from the second delivery’s first received row and records that choice. Comparisons preserve exact numeric text and JSON kind.

Browser configuration is optional during preparation so a receiver can retain the original input selection before the runtime is assigned. The returned `browserConfigured` and `completeOperation` fields make that state explicit. The complete nine-stage run needs the existing browser paths for its final reading stage. Supply them during preparation, or add the `browser` object to this same private configuration before continuing; changing browser placement does not change the frozen source, input, actor or decision intent.

## Run and resume the same original program

```bash
starforge finage-receive run --config /customer/operations/finage-receiving-001.json
starforge finage-receive inspect --config /customer/operations/finage-receiving-001.json
starforge finage-receive resume --config /customer/operations/finage-receiving-001.json
```

Run and resume invoke the original `operate.py` using the selected Python executable. Their output is the original program's stage and command output, and their exit status is that child's actual exit status. Signals are forwarded to the owned child. The original operation's operating-system lock admits one writer to that output.

The program carries this complete customer operation through the existing native APIs:

| Stage | Retained original behavior |
| --- | --- |
| Source and delivery selection | Read both complete manifests and exact selected receiver source files; initialize the original customer warehouse. |
| Interrupted receiving | Observe the owned native receiving child after a committed batch and interrupt it when possible; retain the actual result if it finishes before that observation. |
| Same-input continuation | Resume the same committed original prefix, receive the other original export, and inspect completed duplicate intake. |
| Named selection | Retain the first selection, identical operation replay, actual stale-head response, and second selection. |
| Exact reading | Page every original record, compare its exact JSON, add the selected column index, and retain the exact query/filter result. |
| Customer export | Produce complete exports for both originals and the selected filtered export; compare original full CSV and NDJSON hashes. |
| Rollback and reopen | Select the previously active original edition with a named rollback and reopen it through a fresh native command. |
| Portable recovery | Save the original backup, restore it with its own bundled engine, and reopen, query and export the exact restored records and customer history. |
| Existing reading view | Read the generated customer HTML on desktop and mobile and retain the selected filtered view. |

An interruption retains the actual failed command and current stage. Resume keeps the same source selection, original inputs, operation ID, actor, intended decisions and warehouse. Completed stages are reused. It does not create another intake or replace a failed native result with an invented success.

If native receiving completes too quickly to interrupt after a committed prefix, the result truthfully reports `interrupted_prefix_observed: false` and its actual completion. That field remains distinct from the overall completed receiving operation.

`inspect` reads the existing configuration, native checkpoint and final result. It verifies their operation, actor, ordered original input identities and filter. It returns the retained stages, original command outputs, attempts, source revisions, export locations and final result with its exact size and SHA256. A stored process ID is historical metadata; use the existing execution owner's process state to determine whether a run is still live.

## Preserve the selected release

An operation is bound to its actual installed source and paths. Updating a global package installation in place does not silently update a retained customer operation. Keep the original release available beside its original configuration and output. The installed runner compares the selected engine, profile, operating program and reading driver bytes before it starts.

When a concrete implementation correction is necessary, preserve the old result and follow the original [source-revision continuation in OPERATE.md](../sf30-seller-sdk/finage/receiving/OPERATE.md). That original program records the previous and selected source identities and the stated correction. The installed convenience command does not silently rewrite the operation's selected source.

Moving a complete receiving operation to another machine requires an explicit receiving-state handoff because its checkpoint records the original input and source paths. For ordinary customer recovery, use the portable warehouse backup below; it is deliberately independent of the installed Node package and producer workspace.

## Use the individual warehouse commands

The installed warehouse command forwards the existing Python interface unchanged:

```bash
starforge finage-warehouse init --warehouse /customer/finage-warehouse
starforge finage-warehouse receive --warehouse /customer/finage-warehouse --delivery-directory /customer/incoming/original-export
starforge finage-warehouse status --warehouse /customer/finage-warehouse
starforge finage-warehouse inspect --warehouse /customer/finage-warehouse --delivery DELIVERY_ID
starforge finage-warehouse query --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --limit 50
```

Use `status`'s actual head and the displayed original delivery ID for a named selection:

```bash
starforge finage-warehouse activate --warehouse /customer/finage-warehouse --delivery DELIVERY_ID --expected-generation 0 --expected-delivery none --actor "Customer operator" --reason "Selected the reviewed original edition" --operation-id selection-001
```

Repeated identical selection arguments return the original result. A changed displayed head produces the original `HEAD_CONFLICT`; a reused operation ID with different arguments produces `OPERATION_CONFLICT`. Query and export can explicitly select either complete retained delivery; activation never discards the other edition.

Use `FINAGE_PYTHON_EXECUTABLE` to choose the Python executable for these individual Node-dispatched commands. The complete receiving program instead records its selected `--python` in its private operation configuration.

The complete [warehouse guide](../sf30-seller-sdk/finage/receiving/README.md) covers typed exact filters, original query cursors, indexes, full/filtered exports, the existing HTML reader and customer history.

## Recover with the original three-file backup

```bash
starforge finage-warehouse backup --warehouse /customer/finage-warehouse --out /customer/finage-backup
starforge finage-warehouse restore --bundle /customer/finage-backup --out /customer/finage-restored
```

The original backup includes `receiver.py`, `warehouse.sqlite3` and `README.md`, plus its backup manifest. Its receiver is the complete shared Python engine, not the thin installed Finage wrapper. On another Linux/macOS machine with Python 3.11 or later:

```bash
python3 /customer/finage-backup/receiver.py --profile finage status --warehouse /customer/finage-backup
python3 /customer/finage-backup/receiver.py --profile finage restore --bundle /customer/finage-backup --out /customer/finage-restored
python3 /customer/finage-backup/receiver.py --profile finage query --warehouse /customer/finage-restored --limit 50
```

Put `--profile finage` before the subcommand when using that bundled shared engine. The fixed Finage wrapper and installed warehouse command choose the profile themselves.

The backup retains exact rows, original customer documents, source hashes, column mappings, indexes, staged deliveries and named customer decisions. Complete received editions can be queried and exported without the provider, source producer, original input directories, Node package or network. Continuing a partially imported edition still needs its same complete original delivery directory.

## Programmatic integration

The existing package export points to the same installed module:

```javascript
import {
  inspectFinageReceivingInstallation,
  prepareFinageReceivingOperation,
  inspectFinageReceivingOperation,
  runFinageReceivingOperation,
} from '@tokenjunkielabs/starforge-merchant/seller/finage/receiving';

const installation = await inspectFinageReceivingInstallation();
const prepared = await prepareFinageReceivingOperation({
  operationId: 'finage-customer-receiving-001',
  actor: 'Customer operator',
  output: '/customer/operations/finage-customer-receiving-001',
  deliveries: [
    { directory: '/customer/incoming/first-original-export', manifest_sha256: 'FIRST_SHA256' },
    { directory: '/customer/incoming/second-original-export', manifest_sha256: 'SECOND_SHA256' },
  ],
  python: '/usr/bin/python3',
  browser: {
    node: process.execPath,
    playwright_module: '/customer/runtime/node_modules/playwright/index.js',
    chromium_executable: '/customer/runtime/chromium',
  },
});
const completed = await runFinageReceivingOperation({ configFile: prepared.path });
if (completed.code !== 0) {
  const retained = await inspectFinageReceivingOperation({ configFile: prepared.path });
  // Present the retained native stage and original command output to the operator.
}
```

The package name above follows the original distribution declaration. See `info.packageName` in the selected archive if consuming an explicitly named release variant. The API returns structured source, preparation, status or child-result data; it does not add its own warehouse or decision model.

Public source contains no provider exports or customer rows. Incoming exports, operation configurations, output histories and warehouse backups remain in the customer's chosen private directories.
