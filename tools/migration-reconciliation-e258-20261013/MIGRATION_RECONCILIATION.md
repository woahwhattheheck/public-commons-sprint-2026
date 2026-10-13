# Complete source and target migration reconciliation

This application runs a complete frozen migration edition through the maintained discovery engine, compares every record in the selected source and target tables, preserves every unresolved difference, and opens the resulting case in a read-only industrial inspector. It includes the full original CSV snapshots, original and normalized declarations, complete comparison and total exports, selected application source, ordinary case archive, and an independent receiving route.

The product operates customer/account, premise, service or meter association, meter-read, tariff-assignment, bill-line, payment, payment-allocation and balance exports through explicit table and field selections. These names describe suitable uses; the calculator does not hardcode one customer schema. The selected manifest and interpretation identify the actual original columns, keys, currency, unit, sign convention, null policy and tolerances.

## Operating environment and complete source

Use an existing Python 3.11 or later installation with SQLite. The calculator and localhost server use the Python standard library. Source and target exports are ordinary UTF-8 CSV with their complete original rows. The original eleven discovery-engine files remain unchanged. Read this guide as the migration entry point; README.md and OPERATOR_GUIDE.md preserve the maintained engine's original operation and schema.

The product consists of the original engine, migration_reconciliation.py, migration_server.py, migration_report.py, complete selection and HTTP declarations, native receiving course, browser receiving helper, and three complete invented source editions. Original source ownership and MIT attribution remain in the full source archive.

A large cohort needs disk space for the original CSV snapshots, original normalized SQLite database, temporary source/crosswalk/total indexes, complete JSONL and CSV results, comparison index, archives and independent receiving directories. The selected record count is a workload scope, not a measured throughput guarantee. Record widths, number of compared fields, duplicate groups and storage determine actual elapsed time and size. The actual receiving course records its own host and results.

All selected records are processed. Both comparison rows and grouped totals stay disk-backed and stream to complete exports. The inspector pages through those indexes. No record or group is replaced by a sample merely to fit a browser.

## Declare one complete source edition

Keep the untouched exports in a private input directory. Use a manifest with schema commons.discovery.cohort-manifest.v1 and a distinct edition identifier. Its data_class is DEMONSTRATION for the bundled invented records or AUTHORIZED_CUSTOMER_EXPORT for an actual authorized extraction. Retain the extraction owner and original authority/reference in source_authorization.

Each manifest table names its original relative CSV path, declared delimiter/quote character/UTF-8 encoding, exact original header columns, types and required/null/trim decisions. The original engine supports text, integer, decimal, date and boolean. Declare the actual primary keys and same-system foreign keys when they are known. The engine profiles every row, duplicate key and relationship, and retains its original input. It never supplies an absent source row.

A selected migration consists of complete source and target tables plus any complete crosswalk files. For a workshare scoped to ten logical pairs, that can mean twenty primary exports and separately identified crosswalk files. Count all source, target and crosswalk data rows when measuring a supplied cohort; CSV headers are not data rows. Capacity agreed in a customer plan is separate from the generic engine's schema.

Use one selection file with schema tjlabs.migration-reconciliation.selection.v1. Preserve its interpretation_reference and population_reference. Each pair provides a stable id, label, source/target table names and ordered key columns, comparison_reference, compared fields, required dimensions and any explicit crosswalk. MIGRATION_SELECTION_API.json contains the complete reviewed shape and interpretation rules.

The selected tables are already the complete agreed frozen cohort. The calculator does not apply a hidden date, account, status or row filter. If an extraction needs a narrower business scope, create a distinct source-owned extraction and retain that actual scope and source reference. An inspector filter changes only the displayed or explicitly filtered export view.

## Keys, crosswalks and complete membership

Without a crosswalk, ordered source and target key columns must have corresponding declared types and arity. Their full normalized values define the business key. Text remains exact unless the original manifest explicitly declares trimming/null handling. Identifiers that look numeric must be declared text when leading zeroes are meaningful.

For changed identifiers, key_mapping names an original crosswalk table, source_columns, target_columns and the reviewed reference. Column types/arity must match the corresponding source and target keys. Each participating source key must have exactly one valid mapping, and that mapping's target key must be unique across the complete crosswalk.

A duplicate, invalid, missing or colliding mapping remains unresolved. Every offending original crosswalk record is exported with its original table and record number. Every unusable or duplicate business-key record remains in the comparison population. A duplicate group is represented by each original member and complete group counts, preventing an arbitrarily large reference array from consuming memory. No member is chosen automatically.

Full source-only and target-only membership is explicit. The source and target row counts and comparison-record counts describe different things: one matched pair creates one comparison, while every member of an ambiguous key group creates its own comparison record. Crosswalk findings are additional comparison records. Use those recorded meanings rather than assuming comparison count equals original row count.

## Compared meanings and exact arithmetic

Each field names its source and target original columns and a kind. Text, integer, date and boolean compare the exact normalized original values of the matching declared type. They do not perform fuzzy matching, case folding, date inference or silent canonicalization beyond the manifest.

A decimal field accepts original integer/decimal columns and requires an explicit nonnegative tolerance. Each side may declare exact base-ten string multiplier, divisor and offset. Divisor and multiplier must be nonzero. A changed scale, sign or offset needs the corresponding side's reference. All arithmetic uses exact rational numbers, so translating reviewed pence to pounds or a declared debit/credit sign convention does not pass through binary floating-point.

Every amount preserves numerator and denominator. The decimal value is a twelve-place HALF_EVEN display; it is not the basis of equality or tolerance. No currency conversion, rounding-to-match, tariff recomputation, allocation of payments, substitution of credits or other inferred financial rule occurs.

Dimensions are selected nondecimal field IDs, for example currency, period start/end, tariff identifier or quantity-unit label. All must be present and equal before decimal fields are compared. A nominally equal amount in different currencies or periods remains uncomputed for that comparison.

Both-null equivalence must be explicitly selected for each field. A one-sided null is a null mismatch. Two unaccepted nulls remain uncomputed. Invalid original rows retain their original source-quality findings and unresolved key-group status; they do not become zeros.

Totals cover the complete selected original populations, including original duplicates as real rows, grouped by the exact selected dimensions. Each side reports eligible subtotal, original row count and uncomputed row count. Incomplete totals retain their subtotal and the unresolved count; their difference remains uncomputed. Complete totals do not erase missing membership, ambiguous keys or an individual exception. A sum balancing at the end is not acceptance of every underlying account.

## Run, inspect and pack

Choose a new output directory for every extraction or interpretation revision:

    python migration_reconciliation.py run \
      --manifest /private/input/manifest.json \
      --selection /private/input/selection.json \
      --output /private/cases/migration-edition-a

Use --input-root only when the manifest's original relative paths intentionally resolve under another selected input directory. All source paths must remain inside that root.

The command first creates the maintained original case, profiles full sources and relationships, then runs the selected whole migration. The final output directory appears only after the complete product is written. A failed run removes its own temporary stage and preserves earlier editions.

The migration directory contains:

| File | Purpose |
| --- | --- |
| selection.original.json | Exact received interpretation bytes. |
| selection.json | Parsed canonical selection. |
| result.json | Whole source binding, every pair definition, all row/group counts, source quality and output identities. |
| rows.jsonl | Every comparison and crosswalk issue, with exact source record references and field results. |
| rows.csv | Every comparison in formula-safe presentation CSV. |
| totals.jsonl | Every exact dimension/field total. |
| totals.csv | Every total in formula-safe presentation CSV. |
| comparisons.sqlite | Read-only indexed copies of full comparison/total payloads. |
| report.html | Industrial inspector application bound to this source edition. |
| delivery.json | Complete measured immutable migration member set. |

Original source CSV files remain under inputs/. Original manifest bytes, the source report and receiving manifest remain at case root. JSONL is the full exact row interchange; CSV deliberately escapes formula-leading display strings. Neither visible page size nor active browser filter changes those retained complete files.

Pack the verified complete edition:

    python migration_reconciliation.py pack \
      --run /private/cases/migration-edition-a \
      --output /private/handover/Migration_Edition_A.zip

Packing verifies original CSV hashes, manifest and interpretation bindings, every migration output and the complete selected calculator/renderer/server source. It includes all actual case files plus the original and migration operating code/guides. SQLite can be rebuilt for the original discovery case; the migration comparison index is included with its verified full JSONL/CSV sources.

A changed source, interpretation or derived output requires a new complete edition. The command does not repair a modified prior result into its original identity. Preserve the earlier archive when corrections arrive.

## Open the native inspector

Start the original selected application's server against the complete case. Keep its process open during browser use:

    python migration_server.py \
      --case /private/cases/migration-edition-a \
      --archive /private/handover/Migration_Edition_A.zip \
      --receipt /private/operations/edition-a-server.json \
      --port 0

The server verifies the selected case, application source and complete archive before listening. It binds only 127.0.0.1, selects an actual free port when 0 is used, and publishes the complete private receipt atomically. Open the exact origin in that receipt. The unpredictable access token is part of the local URL; keep that receipt with the private operation. The server exposes read-only GET routes, checks its actual Host/Origin and does not log source keys or access-token request paths.

A server receipt belongs outside the immutable case and uses a new filename. Restarting the original server chooses a fresh actual origin/token; use the new receipt. The parent receiving course or original operator may stop its own process after use. There is no remote mutation or stop endpoint.

The interface can page/search selected pair and classification, open exact field comparisons, inspect all grouped totals, and request the actual original CSV record for a source reference. Source records are parsed with the declared original CSV dialect, preserving full headers, extra cells and blank records. Reading a deep original record scans its original CSV; result browsing uses the independent index.

Full JSONL/CSV downloads stream the entire population. Filtered exports stream all matching records across every page. Their URL carries the exact applied filters and no page limit. The complete ZIP retains all original sources and application files regardless of the current view. Source metadata and exact summary JSON are available separately.

The archive argument is optional for reading an unarchived complete case. Its absence is shown by capabilities and a complete ZIP cannot be downloaded until the operator packs the case and reopens the server with that archive. No HTTP action creates an archive or changes source data.

MIGRATION_HTTP_API.json describes every route, successful shape, error envelope, filter and actual server receipt.

## Receive the exported case independently

Use a new receiving directory:

    python migration_reconciliation.py receive \
      --archive /private/handover/Migration_Edition_A.zip \
      --output /private/received/migration-edition-a

The original receiver checks the full ZIP member set, paths, byte counts and hashes before making the received directory visible. Its workbench directory contains the actually selected source and guides.

To rerun that received program against its complete retained inputs:

    python /private/received/migration-edition-a/workbench/migration_reconciliation.py run \
      --manifest /private/received/migration-edition-a/manifest.receiving.json \
      --selection /private/received/migration-edition-a/migration/selection.original.json \
      --input-root /private/received/migration-edition-a \
      --output /private/received/migration-edition-a-rerun

The receiving manifest points to the retained complete CSV snapshots. Its run identity can differ because the source-path declaration is intentionally changed; compare the complete semantic row/total populations and original input hashes. Do not replace a first edition with a later correction or borrow the result of another source identity.

The three-edition native receiving course operates the complete example inputs, compares real keyed results, exports/receives actual archives, executes the received program, and operates the actual server's rows, totals, source records and complete downloads. The browser course subsequently operates the existing actual server and produces desktop/narrow screenshots, exports and viewed-state captures for direct examination. Use those actual course instructions and outputs; a source review does not substitute for operating and looking at the product.

## Interpreting and resolving the complete findings

Use original data-owner decisions to resolve unmapped identifiers, duplicate records, source-system invalid data, missing membership, tariff/period/currency differences and payment-allocation meaning. Store those decisions with the business case and reflect accepted corrections in the next complete extract or selection. The supplied inspector is read-only; a displayed status is a calculated finding rather than a customer acceptance signature.

The original full foreign-key report remains visible with source quality. If a comparison needs account-to-premise, meter, read, bill or allocation linkage, declare the actual same-system relationship in the manifest and include the corresponding explicit association fields/pairs. The product does not infer an unprovided cross-system business graph.

Only the actual selected prime/customer can accept its own scope and outcomes. Preserve full application source and TJLabs attribution in deliverables. Private source exports, account data, operator receipts and counterpart-specific commercial terms belong in the authorized private case, not the public implementation repository.

## Required full product and outgoing artifact review

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## Read-only migration case inspector

The inspector opens the **complete saved migration case through its original private localhost server**. It never uploads source data, runs SQL supplied by a browser, changes the calculation, accepts a migration or changes a production system. Retain TokenJunkieLabs (TJLabs) attribution.

The result population is disk-backed: comparison rows and dimension totals stay in complete JSONL/CSV files plus the verified SQLite index. Even when millions of original records or dimension groups are selected, the browser requests at most forty rows or totals per normal page. Full downloads stream directly from the original case. The HTML application alone is not a complete case and is not advertised as a self-contained full-population report.

### Open the original verified edition

Use the selected application source and an existing complete case. Place the private server receipt outside the immutable case:

```bash
python migration_server.py \
  --case /absolute/received-case \
  --archive /absolute/Migration_Case.zip \
  --receipt /absolute/private/new-server.json \
  --port 0
```

The server verifies original source/results/application hashes and, when supplied, the complete archive. Open the exact private token-bearing URL in its LISTENING result or receipt. It binds only 127.0.0.1 and accepts its own Host/Origin. Do not publish the private URL or receipt. The launching operator owns that process and stops it locally; the inspector exposes no remote mutation or shutdown route.

If the original archive was not selected, the page disables the case-ZIP link and explains how to reopen with a complete prepacked archive. Summary, full rows/totals and original manifest/report remain available. A changed immutable file is an explicit error, not a silently refreshed calculation.

### Inspect every selected population and its meaning

- **Records & differences:** apply an exact pair, native classification and literal key-text filter; then use forty-record pages. The count identifies the full matching population. Open any comparison record to inspect the original/selected keys, source and target record references, duplicate-group sizes, every typed field comparison, exact rational arithmetic/tolerance, and all original issues. The field selector narrows only that detail view. Crosswalk ambiguity and duplicate groups remain unresolved rather than receiving arbitrary matches.
- **Dimension totals:** filter pair, numeric field, literal dimensions text and native state. Every dimension group remains in the complete disk-backed totals; the table pages forty groups and opens a complete selected total. Source/target computable subtotals, full row counts and uncomputed counts stay distinct. A subtotal with omitted/uncomputed values is not a complete total. Aggregate agreement does not accept individual record differences.
- **Mappings & coverage:** read every selected key/field transformation, explicit dimension definition, source/target row coverage, native status counts and complete pair interpretation. Open the full crosswalk-issue population using the original row route; summary counts do not replace those records.
- **Original sources:** read the complete original table definitions, profiles, lineage inventories, original manifest/report and selected recipe identities. Click a source or target reference to read its complete raw CSV record through the actual native CSV reader. Headers, source bytes/SHA and record ordinal remain visible. A blank CSV record is an empty array; a present empty field is an empty string. Quoted multiline records retain their original record number.
- **Complete downloads:** stream every original row/total as JSONL or formula-safe CSV, download complete result/source report/original manifest bytes, and receive the prepacked whole case ZIP when available. Original full downloads remain complete regardless of the current view. The filtered stream links include only the explicit applied filters, never the page offset/limit.

Quantities use the saved exact numerator/denominator and native decimal display. The inspector does not recompute tolerances, round differences to equality, infer missing values or turn unavailable values into zero. **Show exact fractions** reveals the rational components. Original integer/decimal JSON tokens that cannot be represented exactly in browser numbers use a lossless view representation; complete record/total/source JSON downloads retain their original server response text.

### Reopen a view and distinguish subset exports

**Download view settings** retains only the source-run/interpretation identity, selected filters, page offsets and selected detail IDs. It contains no localhost access token. **Restore settings** accepts that same original case/interpretation and rereads the original records from its server. It does not restore a different data edition as if unchanged.

**Current page CSV** and **Current page snapshot HTML** are explicitly limited exports containing the visible page and its original identities. They do not replace the full population. A downloaded snapshot opens offline, contains no server token or active API, and clearly gives the visible/full matching counts. JSONL remains the complete exact machine-readable population. Print produces the current review view, not the whole case.

Use Tab/Shift+Tab throughout, Left/Right or Home/End among the five section tabs, Enter/Space for buttons and disclosures, and Escape to close a source dialog. Focus returns to the source-reference control. At narrow widths the controls stack, long identities wrap and exact data tables remain horizontally scrollable.

### Renderer interface

`render_html(result, source_report, original_manifest) -> str` is called by the original atomic calculation. It validates the exact source-run, original manifest hash, complete source table inventory and selected interpretation. The generated HTML contains only a small original-case identity bootstrap and the application code; it does not embed population rows or dimension groups. All data calls are relative to the server's token-scoped root. A restrictive content security policy permits only the original inline script/style hashes and same-origin reads.

Keep the actual selected renderer and server source with the complete application. Do not replace report.html after its native delivery manifest is written. For a new inspection copy, use a new complete native edition; a copied HTML file still requires the matching original server and is not itself a whole report.

### Complete browser receiving on the already-running server

The adjacent helper consumes the actual private server receipt. It does not start another server, create example records, calculate a new case or install dependencies:

```bash
/actual/node receiving_migration_browser.mjs \
  --server-receipt /absolute/private/new-server.json \
  --directory /absolute/migration-browser-receiving \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

Select the existing installed Playwright module that exposes chromium. The installed Python Playwright wheel's actual driver/package/index.mjs may be used if the selected Node imports it. Keep browser artifacts outside the immutable case and retain the original server receipt privately.

An interrupted receiving course uses the same arguments and directory plus `--resume`. It retains incomplete attempts, exact source/runtime/input identities and atomic progress/completion receipts. A completed result is reused only after saved artifact hashes are verified. A live or foreign process lock is not overridden.

The helper operates actual pair/classification/key filters, complete row/field/source drilldown, totals/filter/detail paging, all five sections, exact view-settings export/restoration, streamed JSONL/CSV and whole archive downloads, a cold browser context and downloaded subset-HTML reopen. It saves actual desktop/narrow screenshots and a current-view PDF. The original native receiving course owns full archive verification, cold case receiving and server reopening; this helper consumes that real server.

**The receiving owner must then actually open/view every saved screenshot, PDF and exported HTML, and inspect the complete JSONL/CSV/archive identities under VIEWING.md.** Browser functional completion remains separate from actual visual receiving. Report the real outcome in the existing original receiving operation. Preserve user-selected tabs and current owner browser instructions; no parallel duplicate course is needed.
