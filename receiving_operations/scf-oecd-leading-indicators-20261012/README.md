# OECD native analyst and customer receiving

This handover installs and opens the complete OECD leading-indicator application on the original equipped native host. It includes all 15 unchanged OECD data and structure responses, the maintained SDMX/XML/Macrobond engines, source review and revisions, publication-ready HTML/JSON/CSV briefings, the merchant and configured buyer, original accounting, complete delivery and a fresh customer project import.

Application PR [2171](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2171) is merged at `13953daeb150a90509d1b9e491b22ec5dfd5d767`. The receiving source at `02e086a1feeb551a1531f573d2affe7eb40a818e` includes both reviewed Python startup corrections: restore the OECD module path after the original native imports, and register the explicitly named XML workspace module before its dataclasses execute. The latter reuses only the matching original module and rolls back its own registration after an import failure.

## Receive the complete source

The [original source page](https://app.notion.com/p/3f7dd77231008187956ddf0410cb503d) retains the actual native ZIP attachments and exact transfer index. Download every named part, `OECD_SOURCE_TRANSFER.json`, `git-object-receiving.py`, and `receive-oecd.py` into one original directory. Keep each ZIP filename unchanged and beside the index.

The source uses the maintained `distribution/source-carrier-producer.mjs` and `git-object-receiving.py --source-transfer` protocol. A transport-only selected-source Git commit retains the complete operation's original application paths and blobs. The actual Git commit and full recursive-tree response for that projection are its authority. `SOURCE_SELECTION.json` identifies every application file's source commit, original Git blob, SHA-256, byte count and mode. The full Commons application remains the original source commit above.

The receiver restores every original source object and materializes every selected file before the application starts. It checks the real complete Git tree, part manifests and original member bytes, saves the source receiving state, and resumes the same cache when called again. The source page's transfer index gives the exact projection commit for `--commit`.

The supplied `receive-oecd.py` calls that unchanged receiver, verifies its pinned SHA-256, binds the existing equipped `node_modules`, and executes the original application program directly. The original program receives the process's stdout, signals and lifetime. It retains its own project and operation journal.

Use the existing Linux Python 3.11+ and Node 24 runtime, the existing Git executable with `--no-lazy-fetch`, and the original installed native packages. The selected Node dependencies are listed in `SOURCE_SELECTION.json`; they include the maintained Stellar/x402 packages, `yaml` and `re2js`. The source and its maintained Python engines use the Python standard library.

Use resolved absolute paths. The source cache, source directory and private project are distinct; keep the project outside its source directory. The existing `node_modules` path is read through a source-root binding. The application creates its own private project and actual output.

## One command: original source to revised briefing and fresh customer reopen

Run the source-only authoring operation first on the accepting host:

```sh
python3 /ABS/HANDOVER/receive-oecd.py \
  --source-transfer /ABS/HANDOVER/OECD_SOURCE_TRANSFER.json \
  --commit EXACT_PROJECTION_COMMIT_FROM_INDEX \
  --receiver /ABS/HANDOVER/git-object-receiving.py \
  --cache /ABS/OECD_SOURCE_CACHE \
  --source /ABS/OECD_SOURCE \
  --project /ABS/OECD_PROJECT \
  --node-modules /ABS/EXISTING_RUNTIME/node_modules \
  --node /ABS/EXISTING_RUNTIME/node \
  --python /ABS/EXISTING_RUNTIME/python3 \
  --mode briefing \
  --operation scf-oecd-cli-briefing-20261012
```

The launched original `examples/create-briefing.mjs` completes these operations in the same project:

1. Import the complete retained original OECD source family and its dataflow/DSD/codelist bindings.
2. Save the initial seven-country analyst briefing and its original native catalog edition.
3. Save a second editorial edition that carries the customer handover note and retains the exact original observation snapshot.
4. Export the revised full native dataset and original project ZIP.
5. Create the separately named `reopened-customer-project` workspace and import that revised original ZIP.
6. Compare every source row and the exact original HTML, JSON and CSV report bytes after import.
7. Return the real capture, both saved edition records, dataset, packet size/hash/path, separate customer workspace identity, and browser launch commands.

The input has 231 original observations for Canada, Germany, France, the United Kingdom, Italy, Japan and the United States, selected from January 2024 onward. Its monthly amplitude-adjusted index retains the provider's complete native values and metadata. The report computes exact Decimal calendar comparisons and marks missing baselines explicitly. The report's selected date window and the customer's complete retained source series are recorded separately.

The OECD CLI is a turning-point indicator around its long-term average of 100. The generated briefing uses that interpretation and preserves the source, units, adjustment, methodology, original status, observation attributes, retrieval details and complete source responses. The application guide links the original OECD methodology.

The real run prints its actual output paths. Open `briefing.html` directly for the complete offline report, use `observations.csv` for the full exported report rows, and retain `briefing.json` and the complete project ZIP together. The original project and the fresh received customer project each have their own browser command. Stop and reopen either workspace using that same command and directory.

## The original configured merchant and customer operation

The [original F1CB owner thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791767207368969) owns the native SDMX/Macrobond merchant and buyer relationship. The [same live host continuation](https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791810512860759) joins this complete source operation after its original Axiom/browser operation. Preserve its accepting owner, actual host, original merchant configuration, facilitator, signer, buyer workspace and funded terms.

The product's `examples/receiving.json` documents the original receiving configuration fields. The operator supplies its actual retained configuration. Launch it with the same source carrier and original project:

```sh
python3 /ABS/HANDOVER/receive-oecd.py \
  --source-transfer /ABS/HANDOVER/OECD_SOURCE_TRANSFER.json \
  --commit EXACT_PROJECTION_COMMIT_FROM_INDEX \
  --receiver /ABS/HANDOVER/git-object-receiving.py \
  --cache /ABS/OECD_SOURCE_CACHE \
  --source /ABS/OECD_SOURCE \
  --project /ABS/OECD_NATIVE_PROJECT \
  --node-modules /ABS/EXISTING_RUNTIME/node_modules \
  --node /ABS/EXISTING_RUNTIME/node \
  --python /ABS/EXISTING_RUNTIME/python3 \
  --mode receive \
  --config /ABS/ORIGINAL_OECD_RECEIVING_CONFIG.json
```

The original `receiving.mjs` imports and reviews the full source, publishes the native CSV-backed dataset through the existing SF82 release, starts the actual merchant, and uses the configured SF88 Dataset buyer. Its selected 150-row pages deliver all 231 observations in two pages. The original buyer ledger and configured payment terms remain attached to the same native session.

The receiver drains `Dataset.finalizeAll` through the maintained accounting page contract, saves the complete SF100 delivery, compares every native dimension/value/attribute/status, and reopens the original `DatasetDelivery`. It then saves the original second editorial briefing, receives its complete report/project ZIP into a separately named customer workspace, compares the full retained bytes and rows, and retains the corresponding provider output.

The original receiving checkpoint binds the configuration hash, project, merchant release and customer operation. Resume that same invocation and configuration to continue retained work. If a host timer interrupts an operation, inspect and continue its original saved checkpoint and native result. The direct launcher adds no payment retry or second operation.

## Browser and installed operator

After either successful project creation, reopen its workspace with the actual browser command returned by the original operation, or run:

```sh
node /ABS/OECD_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/sdmx/oecd/cli.mjs \
  serve --project /ABS/OECD_PROJECT --python /ABS/EXISTING_RUNTIME/python3
```

The same project exposes the complete source/review/revision/compare/activate/export/import operator, typed Node client, 17 lazy MCP tools and source-owned Applications provider. The browser has a plain industrial interface and exact current/native series and calendar-comparison views. Use the existing application guide for its original local authentication and launch binding.

## Deliver the native result

Post the actual completed source report, both saved editions, original project ZIP identity, separate customer workspace identity and browser result in the original F1CB thread. Join the configured native merchant/buyer/accounting/delivery outcome to that same operation after the original buyer run completes. The canonical SCF grant source and result tables refer to this project and its full original source.

The launch record is `CACHE/oecd-launch/MODE.json`. The maintained source receiver saves `CACHE/source-receiving.json`, its exact Git object cache and original part receipts. Source-only and economic receiving outputs remain in their respective original projects; the economic receiver's checkpoint owns the original payment continuation.
