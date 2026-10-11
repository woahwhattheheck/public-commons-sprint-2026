# Oregon DEQ material-trace operator

A complete local workflow for reviewing supplier, facility, material-chain and risk-evidence exports. Staff retain original files, map their columns, reconcile every row, correct individual fields with a reason, review upstream gaps, and export a portable workspace for another operator.

The original `audit.mjs` remains the selected-path audit engine. The workbench joins it to full-source reconciliation and every upstream product branch. The browser, command history, Excel workbook, relationship tables and restored installation all consume that same retained state.

## Run the operator

Use Node.js 24 and a private persistent directory. The application uses Node's standard library; there is no package installation or build step.

~~~sh
node workbench/server.mjs --data /private/oregon-trace --port 8765
~~~

Open the printed local address. Read the access key from `/private/oregon-trace/operator-access.json`, enter it in the browser, and supply the reviewer's name. Keep the source package and private data directory as separate folders. The operator binds to `127.0.0.1`; the private key belongs to that installation.

| Section | Staff work |
| --- | --- |
| Overview | Review row counts, product coverage, all upstream branches and the original selected-path result; inspect facilities and links; set the review instant and evidence age. |
| Sources & mapping | Retain CSV, TSV or JSON bytes; map columns and source vocabularies; compare original and mapped records; correct, exclude or restore rows. |
| Findings & review | Open the linked source rows for conflicting identities and invalid records; retain reviewer decisions; revisit them after their source changes. |
| Handoff & exports | Download the portable workspace, Excel workbook, review JSON, normalized graph and relational CSV tables. |
| Edit history | Reopen retained commands with their revision, reviewer and time. |

## Import and map the actual source

Ordinary tables are UTF-8 CSV, TSV or JSON arrays of records. CSV/TSV use a header row; quoted delimiters and multiline values are supported. Identifiers remain strings, including leading zeroes. Each file may contain up to 16 MiB, 100,000 rows and 256 columns. A workspace may retain 100 imports and 250,000 source rows.

Choose its source type, upload the file, and confirm the field mapping. **Use matching headings** selects likely exact headings for review; **Save field mapping** applies the chosen correspondence. An original `oregon-deq.trace-evidence.v1` graph retains its four known record sections and original bytes as one source identity.

| Table | Canonical fields |
| --- | --- |
| Products | `id`, `name`, `destinationNode` |
| Facilities | `id`, `stage`, `name`, `country`, `latitude`, `longitude` |
| Material links | `id`, `productId`, `from`, `to`, `source`, `observedAt`, `evidenceJson` |
| Risk assessments | `nodeId`, `category`, `disposition`, `source`, `observedAt`, `evidenceJson` |
| Supporting evidence | `targetKind`, `targetId`, `nodeId`, `category`, `source`, `observedAt` |

Stages are `extraction`, `processing`, `manufacturing`, `distribution` and `oregon-market`. Risk categories are `labor`, `human_rights`, `environmental_justice`, `hazardous_substances` and `environmental_impacts`. Risk dispositions are `risk_found`, `reviewed_clear` and `unknown`.

The source-value translation editor maps a supplier's vocabulary to these values. A row correction follows that translation, preserving the reviewer's explicit canonical choice. `evidenceJson` accepts the original engine's array of evidence records. Separate evidence rows target a link ID or a facility/category risk identity.

[SOURCE_MAPPING.md](SOURCE_MAPPING.md) binds this workflow to the retrieved issuer and vendor requirements and documents the complete export tables.

## Reconcile and correct

Every row retains its import identity, exact file digest, row number, source line, mapped identity, disposition and correction status. All retained rows are processed; paged screens continue through the complete inventory.

Identical duplicate records contribute evidence and source references to one identity. Conflicting duplicates produce findings linked to every contributing row. Select the fields to override, enter their canonical values and save a reason. Clearing overrides returns the row to its source mapping. Excluding a row retains the original and its reason; restoring it includes it in processing again.

Unmapped and invalid records remain visible in source reconciliation and findings. The review workbook and portable workspace remain exportable, allowing another operator to continue that same review. The normalized graph becomes available once its source and graph errors are resolved.

Full-branch review follows every incoming material link for each product. It reports disconnected product links, branches ending before documented extraction, cycles, source age and missing facility/risk pairs. Shared facility/risk gaps retain the affected product IDs. The original selected-path audit remains available within the same report.

A review note records the reviewer, time, source revision and decision. Correcting the source removes its resolved finding from the active report while preserving the earlier note. Accepting a documented gap records that decision against the source revision. Later source or setting changes mark that decision for review again.

## Export and reopen

The portable workspace includes exact original bytes, every import association, settings, mappings, corrections, exclusions, reviewer decisions, the complete report, original audit result, Excel workbook and CSV relationship tables. Its file inventory records byte lengths, hashes and source associations. A normalized graph is included when the current source and graph are valid.

The native Excel workbook uses text cells for identifiers and supplied values. Long cells continue on an overflow sheet with their source-cell reference and ordered parts. CSV exports neutralize formula prefixes and retain nested relationships as complete JSON text. The original source files retain their exact bytes.

Restore a bundle into a new empty private directory:

~~~sh
node workbench/server.mjs restore \
  --bundle /path/trace-workspace.zip \
  --data /private/restored-trace
node workbench/server.mjs --data /private/restored-trace --port 8765
~~~

Restore checks archive structure, expanded-size limits, digests, source shape and retained state, then recomputes the original review. It prepares a complete private sibling directory before publishing the receiving directory. An interrupted preparation leaves the destination available for the same bundle to be restored again. The receiving operator creates its own private access key.

Bundles support up to 256 MiB of archive bytes, 512 MiB expanded and 4,096 entries. Plan source handoffs within those limits; the server reports an oversized handoff before returning an archive.

## Saving, retrying and private storage

Every edit uses the displayed revision and a stable operation identity. A stale operator receives the current revision for review. If a response is interrupted, **Retry the retained edit** sends the original operation and returns its original outcome.

Uploads synchronize a private temporary file before publishing complete bytes under their content identity. Saved versions, the current pointer and operation receipts are written atomically. Startup verifies retained sources and recovers a fully prepared next version from the same parent operation. Sources are stored once; revisions retain settings, mappings and review metadata.

Close the running operator before reopening its directory. If its process ended without releasing the private lock, the explicit recovery command verifies that the original same-host process has ended:

~~~sh
node workbench/server.mjs recover-lock --data /private/oregon-trace
~~~

Use a stable port for the ordinary browser session. Browser credentials are kept in that tab's session storage. The private directory contains original data and the access key; choose an appropriate private persistent volume. Portable exports carry source and review state, while each receiving installation creates its own browser key.

## Native interfaces

`workbench/server.mjs` exports `createWorkbench({directory, port})` and `restoreBundle(bundlePath, newDirectory)`. The running operator provides `url`, `accessFile`, `inspect()` and `close()`.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/view` | Current state, summary, paged findings, full branch summaries and export inventory. |
| `GET /api/rows?importId=…&offset=…&search=…` | Original/mapped/disposition comparison; 50 source rows per page. |
| `GET /api/trace?productId=…&nodeOffset=…&linkOffset=…` | Facilities and links with independent page offsets and full totals. |
| `GET /api/history?offset=…` | Revision history with 100-record continuation. |
| `GET /api/source?importId=…` | Exact retained original source download. |
| `POST /api/command` | `{operationId, expectedRevision, actor, command}` for intake, mapping, corrections, exclusions, review and settings. |
| `GET /api/export/{kind}?revision=…` | A bundle, workbook, graph, report or named CSV table for the exact revision. |

The server verifies its local host/origin and bearer key for operator requests. The original `audit.mjs` exports and CLI remain byte-identical to the merged source. The workbench's full-branch review extends that original workflow.

## Source and commercial handoff

This extends `business/oregon-deq-supplychain-acceptance-20261010/`. The original issuer source is [OregonBuys S-34000-00018168](https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-34000-00018168&external=true&parentUrl=close). The mapping guide records the retrieved RFP and Sourcemap's public integration capabilities.

[CONDITIONAL_PAID_WORKSHARE.md](CONDITIONAL_PAID_WORKSHARE.md) contains the single current commercial offer and acceptance workflow. Supplier exports use explicit field mapping in this operator. Prime-platform integrations can carry the resulting source-bound graph, tables and review handoff into their authorized delivery process.
