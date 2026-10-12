# EPA ECHO facility portfolios

Install and operate the complete original EPA ECHO product: facility portfolios, retained agency searches and reports, source tables, dated comparisons, staff review, SF30 datasets, native publisher releases, complete customer files and portable workspace receiving. The `epa-echo` source selection carries the original browser, CLI, merchant tools and saved Applications workflow through the maintained distribution and runtime installer.

The selected source includes the complete operating programme at `operations/epa-echo-portfolio-native-20261012/`. Its source-native browser, merchant and Applications stages share the same retained workspace and journals.

## Build or receive the selected source

Select the full immutable source commit containing this recipe and the complete EPA product. Use the existing source-owned distribution builder and retain its actual archive receipt:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout --ref COMPLETE_SOURCE_COMMIT \
  --selection epa-echo --out /absolute/epa-echo-release
~~~

The receipt and source manifest identify the selected commit, recipe path, Git blob, SHA-256 and byte count. The package version includes `.selection.epa-echo`. The archive contains the original relative source layout and the current selected registrations.

Continue that build using its same output directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/original-checkout \
  --out /absolute/epa-echo-release --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/epa-echo-release --status
~~~

Resume inherits the original source and selection. An explicitly different selection produces `DISTRIBUTION_SOURCE_SELECTION_CONFLICT`. A completed output returns its original verified archive. Give a deliberately different source selection its own output directory and retain the previous archive and build journal.

## Prepare and adopt the original runtime

Use the returned archive filename and SHA-256 with the maintained installer. The EPA workflow selects the original native Stellar dependencies, schema, OpenAPI, MCP and operator profile:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/epa-echo-runtime \
  --archive /absolute/epa-echo-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator
~~~

An existing equipped receiver can supply its complete retained dependency tree and original lock to this prepared runtime. After that original receiver has placed the selected tree and lock, adopt it under the installer’s existing lease:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/epa-echo-runtime --adopt-existing

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/epa-echo-runtime --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/epa-echo-runtime -- source
~~~

`--adopt-existing` is a boolean option. The retained tree and lock must satisfy the selected runtime profile, package imports and native checks. The original adoption path uses those existing dependencies. A host preparing its first dependency tree can use the same installer’s normal `install`, or its documented offline/cache options, then retain the resulting complete lock and READY identity.

Continue an interrupted installation with `runtime-install resume --dir` against that same directory. Source remains under `package/` and dependencies under the runtime’s adjacent `node_modules/`. Keep the source commit, archive SHA-256, recipe identity, runtime profile, dependency lock, source manifest and READY installation ID together in the handover.

The commands below use `starforge` from this READY runtime. Its equivalent absolute invocation is the same installer’s `run --dir /absolute/epa-echo-runtime --` followed by the command and arguments.

## Open the saved operator application

Use the original Runtime workspace. For a new private manager, initialize it once, attach this READY installation, then serve it:

~~~sh
starforge runtime-workspace init --workspace /private/epa-runtime-desk

starforge runtime-workspace attach --workspace /private/epa-runtime-desk \
  --runtime /absolute/epa-echo-runtime --label "EPA ECHO facility portfolios"

starforge runtime-workspace serve --workspace /private/epa-runtime-desk --port 8465
~~~

In **Applications**, select **EPA ECHO facility portfolios** and the attached runtime. Choose the private EPA workspace, an existing SF88 buyer inbox when receiving completed purchases, and the original private SF82 merchant runtime JSON when operating a publisher. An identifying User-Agent is optional.

Choose **Review**, **Save**, **Connect**, **Start**, then **Open**. Review binds the actual runtime, original workspace UUID and selected input files. The managed startup observer checks the original EPA startup record, process, installed source, workspace UUID and loopback URL. The manager retains the current private connection for subsequent browser and merchant use.

The direct command uses the same product:

~~~sh
starforge epa-echo-workspace --workspace /private/epa/portfolio \
  --inbox /private/epa/buyer-inbox \
  --release-runtime /private/epa/release-runtime.json --port 0
~~~

The inbox and runtime arguments are optional when only operating source portfolios. Use the saved Applications operation or the direct owner for a workspace. The workspace’s original writer lease remains authoritative. Keep the returned session URL private; the browser removes its capability from the address bar and sends authenticated requests.

### Source portfolios and staff review

Create a portfolio from its original facility identifiers. Acquire or import the source package, then inspect the agency search, each facility’s full report, all source tables and the retained source dates. A source package keeps original response bytes, differing wire bytes, provider URLs and its original acquisition metadata.

The bundled source is `source/stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/examples/dc-wastewater-source-20261012.json` inside the installation. It contains 826,432 bytes with SHA-256 `c737c859126057359c3918e20e4553651b31ab14532060c64aa49f25a7fe24d9`. Its eight retained EPA responses cover four facilities in this order:

| Original FRS ID | Selection position |
| --- | --- |
| 110072033839 | 1 |
| 110072235550 | 2 |
| 110029030144 | 3 |
| 110072237877 | 4 |

The original projections contain four facilities, 25 permits, ten compliance summaries, 4,836 quarterly fields, 54 inspections, eight enforcement records, 6,624 metadata rows and 9,300 source fields. These are the retained example’s source records. Its source dates and report provenance travel with the edition.

Open every table’s following pages through the returned opaque cursors. Retain the original source identifiers while filtering or sorting. Facility reports and printable reports are available from their original records. Capture another dated edition to compare additions, removals and changes against the selected prior edition.

Staff review records carry the selected source record, responsible team, notes and due date. If another actor changes the workspace while a form is open, review the current revision and save the retained entered values through the original compare-and-swap flow.

A source import retains its selected file fingerprint and operation ID before dispatch. If a reply is lost, reopen the same workspace and reselect that exact source file. The browser reconstructs the original request and recovers its result. The same rule applies to a complete workspace import.

## Prepare, publish and receive the original dataset

The dataset view projects the selected edition through the existing SF30 engine. The original facilities, permits and compliance views remain separately selectable. Inspect the configuration, source manifest, original provenance and query columns before preparing a merchant release. Use the engine’s returned cursors for following pages.

The publisher uses the maintained SF82 release store. Prepare an immutable release from the selected dataset, review its exact route, native payment settings and original source binding, then **Activate** and **Run** the selected generation. **Stop** drains that original generation; **Restore previous** selects its retained predecessor through the same release history.

A receiving operator selects the completed original SF88 intents in the same buyer inbox. The original SF100 receiver publishes five customer files:

| File | Receiving use |
| --- | --- |
| `dataset.csv` | Complete tabular result |
| `dataset.jsonl` | Complete row records |
| `review.html` | Portable readable review |
| `delivery.json` | Original delivery and source identities |
| `manifest.json` | Selected file inventory and hashes |

Download each file through the authenticated application or original merchant file client. The native receipt records every file’s byte count and SHA-256; the receiving workflow checks those exact values. Keep original page, intent, finalization and receipt identities with the customer result.

## Agent connection and complete files

The source-owned `epa-echo-workspaces` merchant provider exposes the original EPA tools through the existing merchant server. The source’s `merchant-setup.mjs` reads the private connection file or managed `applicationUrlFile`, and the maintained provider registry advertises the selected tools. The product’s `epa-echo-mcp` command and typed client use this same original console.

Use the installed `MCP.md` for the exact setup/client arguments, original tool schemas and file transfer contract. Source, reports, edition archives, customer files and complete workspace files retain their original resource IDs. Partial downloads keep their original prefix, expected full byte count and SHA-256. A restarted authenticated listener can continue the same selected resource; a changed file identity requires an explicit new selection.

The complete operating programme exercises all 35 EPA tools, source-linked review, saved query tables, original search/report exports, retained source/wire objects, complete customer files and offline reopened bytes. It also continues a saved source read after the original console has closed.

## Export, receive, stop and reopen

Export the complete workspace after selecting its current retained state. The package contains original portfolios, captures and failed-source records, immutable editions, staff history, dataset configuration and provenance, release history and complete customer files. Its manifest retains every selected object’s original byte length and SHA-256.

Receive the package through the application’s original complete-workspace action. Keep that exact operation ID on a lost reply. Receiving validates the required source objects, dataset receipts and files, original customer receipts and all five customer files. A missing or mismatched source is reported with its original path. The received workspace remains available as a preserved state, edition list and exact relative file inventory.

The receiving record retains the original source workspace UUID, revision and package identity. Browse and download retained original files from that record. Keep active host configuration, signing custody and session capabilities with their original operator.

Choose **Stop** in Applications. Reopen the same Runtime workspace and saved application to inspect its retained run history. A deliberate later **Start** creates another managed run for the same saved workspace. The product verifies the same workspace UUID before returning its current private listener.

## Operate the complete source programme

The selected archive includes the original seven-file programme:

`source/operations/epa-echo-portfolio-native-20261012/`

Read its `README.md` and `INPUTS.json` together with the original selected installation. The complete sequence operates the browser, original dataset publisher, two native customer pages, customer files, portable receiving, merchant tools and the installed Applications lifecycle.

Set the original request fields to the exact selected source and READY installation. When executing from this archive, `EPA_ECHO_PRODUCT_ROOT` is the installation’s `package/source` directory; `EPA_ECHO_ORIGINAL_SCF_RUNTIME` can name its `stellar/scf-starforge-20261009` directory. Both refer to the same selected original modules. Select the existing operator workspace, physical signer owner, private facilitator configuration, network transport and installed browser tools through their existing custody.

| Field | Required selection |
| --- | --- |
| `EPA_ECHO_SOURCE_COMMIT` | Complete immutable commit in the source and READY manifests |
| `EPA_ECHO_PRODUCT_ROOT` | Selected source root in its original relative layout |
| `EPA_ECHO_RUNTIME_DIRECTORY` | Actual READY directory for that same commit |
| `EPA_ECHO_JOURNEY_DIRECTORY` | Original retained private operation directory |
| `EPA_ECHO_ORIGINAL_SCF_RUNTIME` | Existing selected source containing the original native facilitator |
| `EPA_ECHO_ORIGINAL_OPERATOR_ROOT` | Original retained signer/facilitator custody directory |
| `EPA_ECHO_OPERATOR_WORKSPACE` | Original payer workspace and unchanged reviewed policy |
| `EPA_ECHO_NODE_EXECUTABLE` | Existing selected Node executable when explicit |
| `EPA_ECHO_PLAYWRIGHT_MODULE` | Existing installed Playwright module |
| `EPA_ECHO_CHROMIUM_EXECUTABLE` | Existing selected Chromium executable |

Run the original launcher through the maintained native operation:

~~~sh
python3 /absolute/epa-echo-runtime/package/source/operations/epa-echo-portfolio-native-20261012/native-run.py
~~~

The original operation is `epa-echo-portfolio-complete-b3909-20261012`. Inspect its existing native record and original child before dispatch or continuation. Retain the original controlling-terminal carrier and attend `private/operator-input.fifo` while the native buyer requests its explicit review.

The original p1 and p2 intents are `epa-echo-portfolio-b3909-20261012-p1` and `epa-echo-portfolio-b3909-20261012-p2`. Each selects two rows from the four-facility dataset at the original `/epa-facilities` route. Their published example terms are exact/stellar:testnet, asset `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, 10,000 atomic units per page. Original attempts, provider responses and finalizations stay with those exact intent IDs.

`private/native-journey.json` is the whole-operation journal. Its COMPLETE result is returned before another facilitator or buyer opens. Completed browser and merchant phases remain selected during continuation; the managed continuation resumes the same Applications identity and retains both original Start/Stop histories.

An interrupted payment continues through its existing original attempt. A changed source, runtime, policy, workspace or private input is reconciled against the saved selection before continuation. The programme retains its exact source files, browser downloads, partial transfer checkpoints and native outcome journals throughout that recovery.

## Installed source and handover

This selection includes the complete EPA component, original distribution and Runtime workspace, SF30 operations/developer/dataset lifecycle, SF82 publisher, SF88 buyer, SF100 receiving, Buyer workbench, original native signer/facilitator, merchant operator and the full source programme. The builder follows their actual static imports and browser manifests, retaining dependencies in their original relative paths.

Use `starforge registrations --source epa-echo` for the source-owned command, export, browser and provider declaration. The installed Applications catalog contains `epa-echo-portfolios`; the merchant registry contains `epa-echo-workspaces`. The Buyer and merchant console remain available through their original contributions.

Keep these original guides with the installation:

- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/README.md`
- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/MANAGED.md`
- `source/stellar/scf-starforge-20261009/sf30-seller-sdk/epa-echo/MCP.md`
- `source/operations/epa-echo-portfolio-native-20261012/README.md`
- `source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md`

The final receiving handover carries the actual source archive/selection, READY/profile/lock identities, original completed programme result, customer receipt and five file hashes, complete workspace package and retained Applications history. Archive size, installed size and resource use come from that original completed build and run.
