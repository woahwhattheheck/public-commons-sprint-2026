# Manufacturing data preparation desk

A complete offline operator for original item, revision-qualified BOM, inventory and open purchase-order exports. It retains every source edition, operator-selected column maps, explicit unit conversions, row-level exceptions and review decisions. The current source selection remains separate from newly opened files.

## Compare complete source and returned editions

The same desk can retain a baseline and one or more returned workspace editions beside its current editor. It opens complete workspace JSON, the existing handover JSON, or a complete working desk. Importing a comparison source keeps its exact UTF-8 text and original filename; it does not replace the active sources, mappings, notes or unfinished CSV editor.

1. Open or prepare the approved original four-family workspace and choose **Retain current edition**.
2. Import the complete returned edition in **Compare complete source editions**. Its sources must have been mapped explicitly through the same four-family core. Select the baseline and returned edition independently.
3. Review added, missing, changed and ambiguous identities. The display pages thirty differences and limits its on-screen source-issue excerpt; complete exports retain every issue, row reference and value.
4. Record a status and note against the exact source pair and difference. Review notes do not remove source exceptions or change readiness. Switching to another pair keeps the earlier review history without applying its decisions to that new comparison.
5. Download the complete comparison JSON, differences CSV and HTML report. Download **Complete working file** to retain both exact input files, current selectors, unfinished review text and full review history. Open that working file through the existing staged adoption flow; the displaced desk remains available.

Item identity is item/revision. Inventory adds site/location/lot; purchase orders use order/line. BOM identity uses parent/revision/explicit line ID when present and otherwise the explicit parent/component revision pair. Duplicate or blank primary identities are retained as ambiguous, without invented pairing. Blank revision is an explicitly accepted revision value. An absent, malformed or unmappable source makes its family incomparable; the report does not turn that failure into a mass deletion.

Quantities use exact decimal arithmetic, with the returned quantity minus the original quantity. A delta is produced only when item, revision and unit basis remain valid and identical. A changed unit or referenced item is called out and has no inferred conversion. Different decimal spellings can remain a visible source change with an exact zero delta and a numeric-equivalence note. This comparison concerns the admitted canonical representations; the implementation lead must approve any target-system extraction, entity mapping, variant/effectivity rules, stock valuation and cutover decisions.

The reusable comparator is `data_comparison.mjs`, importing the maintained core. It exports `compareWorkspaces`, `exportComparisonJSON`, `exportComparisonCSV` and `reportHTML`. Descriptors carry a sorted-key hash of the complete admitted workspace; retained original files separately carry their exact text hash. Those identities have different purposes and should not be substituted for one another.

The source exercise uses the existing explicitly labeled mechanical workspace and its actual four-family successor. It covers exact decimal differences, a changed unit, duplicate master rows, incomplete-family handling, review history and complete JSON reopening. It contains no customer operational records. Native receiving extends the original course and browser operation; use the complete original source pair supplied in its private input.

## Build and use

Run Node 20 or later:

```sh
node build.mjs /absolute/new/output-directory
```

An optional second argument is a JSON configuration file containing `title`, `workspaceId`, `storageKey`, `introduction` and `unitHelp`. Customer-specific configuration and operational data belong in the authorized private delivery. The reusable source contains no customer operational records.

The build creates one self-contained `data-desk.html`, four header-only CSV templates and a source/output manifest. Open the HTML attachment in a normal browser, enable JavaScript, then use its controls. It runs without a server, network service or ERP connection. The bundle embeds the complete core, comparison and controller once in one inline module script, preserving their exported bindings without nested base64 copies. A restrictive document-preview sandbox may disable module execution or downloads; download and open the complete HTML in the receiving browser.

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

Each open page retains its own complete draft journal before publishing the shared browser copy. When another page has saved a different copy, the current editor stays selected and its full draft remains separate. The recovery panel shows the shared copy, other page journals and retained predecessors. Choose **Continue as independent draft** to keep editing without replacing the shared copy; choose **Open current browser copy** to retain the displaced full draft and select the latest shared copy. **Use this draft as current browser copy** deliberately publishes the selected draft while preserving the complete displaced predecessor.

Browser localStorage has no atomic compare-and-swap. The independent journals preserve each page even if two writes overlap; a later page can stage and reopen either complete journal. The desk observes actual storage events and checks the shared head immediately before and after publication. A storage or quota failure leaves work open, displays a warning and offers the complete working-file download. Download before closing when the browser cannot retain the latest draft.

Browser-generated predecessors use a flat content-addressed recovery archive. Their complete editor, workspace, source history, comparison pair and unfinished notes remain in snapshots; older recovery entries are referenced by SHA rather than recursively embedded. A saved or downloaded working file carries the whole archive. Opening a retained snapshot resolves its complete earlier recovery records. External imported files remain verbatim originals, with the exact UTF-8 body and hash retained.

Opening another complete desk first stages it; adoption archives the current full editor. Draft source mappings, unit-editor text, comparison reviews and unfinished narrative stay in their original editor. Inputs and textareas are disabled during an awaited file operation so an in-flight import cannot discard newly typed text. Original requests in the core remain idempotent and bound to expected revision plus complete mutation input.

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


## Continue the original browser receiving

The complete native course is in [`receiving/RECEIVING.md`](receiving/RECEIVING.md), with executable `receiving/receive_data_readiness.mjs`. Its `runDataReadinessCourse({browser,inputFile,outputRoot,onProgress})` export uses the existing receiving browser and preserves its owner. The private input binds the exact generated desk, proposal, original mechanical workspace and core hashes. The course operates the full source/editor/export/cold-reopen workflow and returns the actual screenshot and output files for producing-peer inspection. Keep those customer inputs in the original authorized delivery; the reusable course contains no customer records.
