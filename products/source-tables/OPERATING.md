# Source Tables workbench

Use Source Tables to turn complete delimited files or explicitly selected document tables into reviewed native merchant resources. One editable project retains the original files, field decisions, earlier source editions, complete comparisons and the merchant's existing route and payment settings.

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

## Prepare tables from a document

Open a table-preserving HTML or Markdown extraction, or reopen its retained document-source JSON. Keep the original document URL, filename and supplied page locations with that source. Select the original table, header rows, data rows and columns, then choose how merged cells and whitespace contribute to the output.

Inspect the projected values and their original cell locations. Receive the selection as a new resource or as the next source edition of an existing table, then continue through the ordinary field mapping and retained review. The complete extraction remains in the editable project; omitted rows remain available for a later selection. Projected editions retain their complete selection and cell origins even when two different selections produce the same CSV text.

The native commands are `document-inspect`, `document-init`, `document-add` and `document-edition`. The [document intake guide](../../stellar-forge/developer-site/SOURCE_TABLES.md#receive-tables-extracted-from-a-document) includes exact command arguments, the typed `source-document-tables` interface, all six original WAGO supplier tables and the complete native receiving programme.

Native workspace exports include the original extraction and source metadata under `source-tables/documents/`, plus explicit selections, projections and row origins under `source-tables/projections/`. Reopening checks those records against the original source before restoring its reviewed resources.

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

## Retain unfinished document preparations

Every opened extraction and its per-table preparation now travels in the editable project before it is received into field mapping. Header/data ranges, columns, exclusion notes, merged-cell and whitespace choices, preview position, destination and CSV filename remain separate for each original table. Incomplete range text remains editable. Switching the retained extraction or table reopens its preceding choices.

Use **Save in browser**, **Save as copy** or **Download project** for the complete project, including unfinished intake. The existing browser revision comparison preserves conflicting saves. The unload prompt includes intake edits. Opening another project first asks about unsaved changes, then restores that project's own sources and preparations.

**Download all preparations** produces a complete document-intake JSON with original extractions and every table's working choices. Open that file through **Open extracted text / source JSON**. Receiving keeps preceding different choices in **Earlier preparation**, and restoring an earlier preparation retains the work it replaces. The original source identity is revalidated; arbitrary changed source bytes cannot be substituted. Project downloads remain available when browser storage is unavailable.

A restored target from another project remains visibly unresolved until an existing current destination is selected. Preparing the CSV always uses the original document projection engine, and **Use in field mapping** continues through the original source-edition/mapping/review path. Native workspace export still requires every received resource's current review. Unreceived preparations remain source material in the complete project; they do not become a merchant resource implicitly.

The same complete intake can move through the installed CLI:

```sh
starforge source-tables intake-export --project project.json --out new-preparations.json
starforge source-tables intake-open --project another-project.json --source new-preparations.json --out new-project-with-preparations.json
```

All CLI outputs use a new path and preserve their input files. Earlier projects without the optional intake field keep their original shape and behavior. Complete preparation files use the existing 128 MiB project receiving limit.


## Reviewed corrections within an original source

The **Review individual source records** panel pages through every parsed data record and source column. Select a cell to see its complete original and selected text. A named reviewer and a reason are required for a replacement, row exclusion or restoration. Empty replacement text is an explicit value; the existing field type and empty-value policy still determine the mapped result. Record numbers are physical CSV records (the header normally occupies record 1); columns in the API and CLI are zero based. The browser labels columns from 1.

The correction register binds to the original source edition, its SHA-256 and the parsing choices (delimiter, header and empty-record handling). A new source edition or a changed dialect does not inherit decisions. Returning to that same edition and dialect restores its retained decisions. A mapped field rename or type change keeps decisions at their original source coordinates.

Each decision retains its original value, prior selected decision, replacement or restoration, reviewer, timestamp and reason. IDs can be retried with identical content; reusing an ID for different content is rejected. Restoring a cell or row appends an event and leaves earlier reviews intact. A decision makes the current review stale. Use **Review and retain complete output** to create the successor and compare it with the previous review. The complete project and native ZIP contain original source bytes, all correction histories, every historical review and its exact correction snapshot.

CLI example, after choosing the original document ID with `show`:

```sh
node stellar-forge/developer-site/dist/source-table-cli.mjs records --project project.json --document TABLE_ID --offset 0 --limit 20
node stellar-forge/developer-site/dist/source-table-cli.mjs correct --project project.json --document TABLE_ID --decision decision.json --out corrected-project.json
node stellar-forge/developer-site/dist/source-table-cli.mjs review --project corrected-project.json --document TABLE_ID --out reviewed-project.json
node stellar-forge/developer-site/dist/source-table-cli.mjs corrections --project reviewed-project.json --document TABLE_ID --csv --out decision-history.csv
```

A complete decision input is:

```json
{"id":"operator-decision-001","action":"set-cell","record":3,"column":1,"value":"14.50","actor":"Receiving operator","reason":"Confirmed against the supplier correction","at":"2026-10-13T13:00:00Z"}
```

Use `exclude-row` or `restore-row` without a column/value, and `restore-cell` with a column but no value. These examples describe operator inputs; no changes to the supplied WAGO observations are preselected. Public source discrepancies stay literal until the responsible operator confirms a correction.

### Installed and rendered receiving

Use the existing Source Tables installation and original receiving case. Open the exact published `source-tables.html` at desktop and 390px, inspect actual pixels, and operate selection of a multiline source cell, a reasoned replacement, row exclusion, a new retained review and its comparison. Download the complete project and native ZIP, reopen the saved project, restore both decisions, retain the next review and confirm that the first review and original source are still available. Inspect text contrast, narrow actions, long source values and downloaded history. Source execution alone is not a rendered receiving result. Keep the original merchant resource, terms and native commissioning owner.


## Standing product receiving instruction

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949
