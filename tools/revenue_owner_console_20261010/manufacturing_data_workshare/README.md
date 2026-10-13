# Manufacturing data preparation desk

A complete offline operator for original item, revision-qualified BOM, inventory and open purchase-order exports. It retains every source edition, operator-selected column maps, explicit unit conversions, row-level exceptions and review decisions. The current source selection remains separate from newly opened files.

## Build and use

Run Node 20 or later:

```sh
node build.mjs /absolute/new/output-directory
```

An optional second argument is a JSON configuration file containing `title`, `workspaceId`, `storageKey`, `introduction` and `unitHelp`. Customer-specific configuration and operational data belong in the authorized private delivery. The reusable source contains no customer operational records.

The build creates one self-contained `data-desk.html`, four header-only CSV templates and a source/output manifest. Open the HTML attachment in a normal browser, enable JavaScript, then use its controls. It runs without a server, network service or ERP connection. The embedded module sources are exact UTF-8 data URLs. A restrictive document-preview sandbox may disable module execution or downloads; download and open the complete HTML in the receiving browser.

The writer creates new files or reuses identical files and refuses to replace a different completed edition. Use a new output directory for a changed build.

## Full operating workflow

1. Name the reviewer and record the agreed extraction cutoff in working notes.
2. Choose one source family and an explicit CSV delimiter. Open the complete original UTF-8 CSV. The reader decodes strictly and retains a leading UTF-8 BOM; invalid encodings require a fresh UTF-8 export.
3. Review each canonical field mapping. Exact field-name matches are preselected; other mappings remain blank. Revision fields offer an explicit **blank revision** choice for a source without a revision column. Blank revision is a specific identity, never the latest revision.
4. Inspect incoming rows and format/mapping issues, then select that source edition. Selecting a successor replaces only that family's active source. All originals and earlier mappings remain retained.
5. Record confirmed unit conversions as an array, for example `[{"fromUnit":"g","toUnit":"kg","factor":"0.001","note":"Reviewed conversion"}]`. This example describes syntax only. Conversions are direct explicit positive decimal factors, never guessed chains.
6. Review exceptions, their original row references and proposed corrective action. Record the rationale for working, deferred, accepted-risk or resolved labels. A label does not remove a source exception or certify target-system acceptance.
7. Receive the corrected source set, map/select the successor and inspect the resulting exceptions. Reopen an earlier source for remapping without destroying its original bytes.
8. Download the complete working file, readiness report, exceptions CSV, canonical tables and data handover. Reopen the working file; it is staged beside the current desk. Explicit adoption retains the displaced desk. The complete export includes unfinished incoming files, draft decision notes, unit-editor text and earlier desks.

## Source identities and data rules

- **Item:** item ID plus revision. Duplicate identities make dependent references ambiguous.
- **BOM:** explicit parent/revision plus line ID, or parent/revision plus component/revision when line ID is absent. Separate explicit line IDs may use the same component. Self edges and complete cyclic components are reported through an iterative graph traversal.
- **Inventory:** item/revision/site/location/lot. Quantities remain exact decimals; negative values require source correction.
- **Purchase order:** order and line. Ordered and received quantities remain exact. Over-receipts are retained as exceptions; open quantity is never silently clamped.
- Exact decimal arithmetic avoids binary floating-point rounding. Exponent notation, grouping separators and missing quantities are actionable source exceptions.
- Source strings, original file names, UTF-8 bytes, SHA-256 and maps are retained. Canonical values trim surrounding source whitespace; the original source remains unchanged.
- Canonical and exception CSV exports neutralize spreadsheet formula prefixes. Original-source downloads retain the exact imported CSV, including any original formula-like cells.
- A selected empty item master is an exception. Header-only BOM, inventory or purchase-order sources can represent explicit empty tables.
- The core supports up to 16 MiB and 200,000 rows per CSV; the desk accepts complete working files up to 128 MiB. These are implementation limits, not assumptions about the customer's operational size.

## State and recovery

The browser retains a complete working copy under the configured storage key when browser storage is available. A storage failure leaves the in-memory work selected and visibly asks the operator to download it. The downloadable working file is the portable source of continuity. Opening another complete desk first stages it; adoption archives the current full editor. Original requests in the core are idempotent and bound to expected revision plus complete mutation input.

The source checker reports data readiness only. Physical stock, engineering revisions and effectivity, reservations, serial/lot policy, scrap, valuation, target ERP import rules and production cutover remain decisions of the implementation lead. No ERP write, purchasing or inventory mutation is performed by this desk.

## Source layout

- `data_readiness.mjs`: CSV parsing, source editions, exact decimals, BOM graph, reconciliation, mutations, full reopen, reports and exports.
- `data_desk.mjs`: actual browser workflow and complete editor continuity.
- `data_desk.css`: restrained responsive operator presentation.
- `bundle.mjs`: complete offline HTML composition.
- `build.mjs`: create-only filesystem packaging and exact output identities.

## Rendered delivery requirement

Before describing a recipient-facing edition as ready, open the exact generated HTML in its normal receiving browser and look at the actual rendered result at desktop and narrow/mobile widths. Operate empty, populated and error states, source mapping, explicit blank revisions, units, decision notes, imports, downloads and full working-file reopen. Capture and actually view the screenshots. Open every outgoing report, CSV, JSON and archive/project attachment in its normal receiving form, including actual contained deliverables. Inspect all applicable report pages. Fix clipping, overflow, unreadable tables or broken controls within the delivered source.

Source checks, passing controller execution, screenshots only captured and schema validation do not replace viewing and operating the product. Keep this focused on the real delivery rather than adding a broad suite or another approval queue. Preserve the original receiving operation, original files and current source identities. Use simple industrial styling and preserve existing customer, spending, attribution, contact and owner controls. For any added audiovisual material, use suitable natural voice and generative media under existing permissions, then actually watch and listen to the final export.
