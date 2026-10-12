# Source Tables workbench

Use Source Tables to turn complete CSV or TSV files into reviewed native merchant resources. One editable project retains the original files, field decisions, earlier source editions, complete comparisons and the merchant's existing route and payment settings.

The selected installation includes the browser workbench, native CLI, typed interface, original merchant and buyer commands, managed Applications and runtime transfer. The [field and source guide](../../stellar-forge/developer-site/SOURCE_TABLES.md) gives the exact parsing, mapping, comparison and archive contracts.

## Install the complete selected product

Use Node.js 22.16 or later. Git is needed to build from a checkout; the installed authoring workflow uses Node and a current browser. Native merchant runtime preparation also uses the original installer and its declared dependencies.

From a checkout containing the intended source commit, build its committed selection:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection source-tables \
  --out /absolute/packages/source-tables
~~~

Keep the returned archive, source commit, selection record, manifest and SHA-256 together. Continue an interrupted build using its existing output and the builder's original resume operation.

Install the actual returned archive in an application directory:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/package.tgz
npx --no-install starforge source
npx --no-install starforge doctor
npx --no-install starforge source-tables serve --port 8787
~~~

Open the printed `/source-tables.html` URL. Use `npx --no-install starforge` for the commands in this guide when the package's executable directory is not already on your PATH.

Keep one fixed local host and port for browser saves. If an existing setup listener serves the same installed manifest at that address, open its Source Tables page. Otherwise choose a free port and keep that address for later sessions. Selected source files are processed in the browser; download the project JSON for a portable copy.

## Operate through Applications

Prepare the native runtime from the actual completed source archive and hash:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/source-tables \
  --archive /absolute/path/to/package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/source-tables

starforge runtime-workspace init \
  --workspace /absolute/private/runtime-workspace

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/source-tables \
  --label 'Source Tables'

starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-workspace --port 0
~~~

Use the existing runtime workspace when it has already been initialized. Open its printed local URL, choose the attached runtime and open **Applications → Source Tables**. Give the application a recognizable label, select a fixed local port such as `8787`, review and save it, then start it. **Open** uses the URL announced by the original workbench process. Stop and restart use the same managed application.

The application review binds the actual CLI, original asset server, manifest and workbench assets. Startup checks the announced address and the served page against the installed source. Browser projects keep their existing source and revision history when that application restarts at the same origin.

The [runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) covers retained installation progress and recovery. The [runtime transfer guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_TRANSFER.md) covers delivering the prepared runtime to another compatible host.

## Prepare a deliverable

1. Create a named project. Import the existing merchant draft when it already contains the intended routes, prices and payment choices.
2. Add the complete source file and review its delimiter, header and empty-record settings. Bind it to an existing merchant resource or create a new one.
3. Review included fields, output names, types, empty-value handling and trimming. Add units and time meaning where the recipient needs them.
4. Select stable record-key fields. Compound keys preserve their declared order and must identify every row uniquely.
5. Retain the reviewed edition. Resolve any source-record issues, then save the project and export its native workspace.

Use **Integer text** for zero-padded identifiers and large integers, and **Decimal text** for exact amounts or measurements whose digits and scale must survive unchanged. An empty string, JSON null and an omitted field are separate choices. The workbench retains quoted newlines, source line endings, Unicode and a UTF-8 BOM. Its full review processes every row.

The exported resource includes `fields`, `keyFields`, `source` and all mapped `rows`. A table can retain a 16 MiB original source and up to 100,000 records; its complete selected native resource must fit the original generator's 1 MiB limit. Use the existing dataset/database workflow for larger publications.

## Update and explain changes

Add the next file as an edition of the existing table. Inspect changed headers and reset the mapping where needed. Retain the new review and choose the appropriate earlier review as its comparison baseline.

With the same ordered key fields, comparison reports added, removed and changed records with complete before/after values and source locations. When keys are absent or change, it compares complete rows as a multiset, preserving duplicate counts. Field definitions are compared independently.

Download the complete JSON or CSV comparison for handover. An edited source or mapping makes its previous review stale; retain the current review before exporting its native data. Draft projects remain editable and downloadable throughout the work.

## Complete the same workflow from the CLI

Every write takes a new output filename. The returned JSON gives the real document and review IDs.

~~~sh
starforge source-tables inspect \
  --source /absolute/source/accounts.csv --delimiter comma

starforge source-tables init \
  --source /absolute/source/accounts.csv --name Accounts \
  --out /absolute/work/accounts-01.json

starforge source-tables show --project /absolute/work/accounts-01.json

starforge source-tables mapping \
  --project /absolute/work/accounts-01.json \
  --document DOCUMENT_ID_FROM_SHOW \
  --out /absolute/work/accounts-mapping.json
~~~

Edit the complete mapping file, then retain and deliver it:

~~~sh
starforge source-tables map \
  --project /absolute/work/accounts-01.json \
  --document DOCUMENT_ID_FROM_SHOW \
  --mapping /absolute/work/accounts-mapping.json \
  --out /absolute/work/accounts-02.json

starforge source-tables review \
  --project /absolute/work/accounts-02.json \
  --document DOCUMENT_ID_FROM_SHOW \
  --out /absolute/work/accounts-03.json

starforge source-tables export \
  --project /absolute/work/accounts-03.json \
  --out /absolute/work/accounts-native.zip
~~~

Use `init --merchant /absolute/starter-input.json --resource RESOURCE_ID` to keep an existing merchant draft and bind its resource. Use `edition`, `review` and `compare` against that same project for the next delivery. `starforge source-tables help` lists the complete native command surface.

The typed interface is exported as `@tokenjunkielabs/starforge-merchant/source-tables`. It uses the same project, mapping, source review and native ZIP functions as the browser and CLI. Project-changing functions return a new project.

## Run the native merchant

Extract the complete exported workspace in its intended private directory. Its parent `README.md`, `seller.json`, `workspace.json` and `starter-input.json` come from the maintained merchant generator. Follow that README's exact configuration and native commands using the prepared runtime.

The product includes the existing seller, operations, dataset, buyer, release and merchant-host commands. Keep the original seller's ordered payment choices and public receiving identifiers with its saved configuration. The current dataset response is a startup snapshot; publish the next reviewed source through the original release/change operation.

Use the original buyer and merchant receiving workflow for an actual purchase. Keep the resulting purchase and delivered resource with the same customer workorder and source edition.

## Deliver and reopen the complete work

Deliver these materials together:

- The selected source package, its source manifest and archive hash, or its complete prepared-runtime transfer.
- The full native workspace ZIP, including every original table edition, saved mapping, review, complete comparison and editable project.
- The current customer workorder, agreed field meaning and the native receiving result when the work includes merchant operation.

Open `source-tables/project.json` from the delivered workspace in the recipient's installed workbench, or inspect it with `starforge source-tables show`. Reopening recomputes every source hash and reconstructs the retained reviewed outputs from their original mappings. The recipient can add a new edition, make field decisions and export a new native workspace.

`source-tables/materials.json` lists the retained source and review paths. `source-tables/files.json` records byte lengths and hashes for the native and authoring files preceding it. These files travel with the complete editable project.

Browser saves use an expected revision in one IndexedDB transaction. If another tab saved the same project, open its newer revision or save the current work as a separate browser copy. Download the project before changing host, port or browser.

For an existing commissioning case, attach the complete exported material through its current source-bundle writer and original request, terms and case revision. The [source guide](../../stellar-forge/developer-site/SOURCE_TABLES.md#existing-sf49-commissioning) describes that receiving relationship.
