# Open my data — original scientific source intake

TokenJunkieLabs · ECO-CLIENT-SOURCE-INTAKE-20261013 · WO45/50.

This is an installed desk in the maintained Upper Savannah operator. It accepts ordinary client files, shows the original worksheet/layer/band and fields, retains explicit scientific interpretation, then saves a real source collection through Workspace.import_sources. The existing source preparation, native grid, parameter profile, scenario, model run, comparison and delivery engines remain authoritative.

## Use

Open the original operator and select **Open my data**. Give the intake a useful name. Select the actual CSV/TSV, modern Excel workbook, GeoTIFF, GeoPackage, GeoJSON or shapefile together with its original SHX/DBF/PRJ sidecars. Unsupported formats remain downloadable original documents. Files are first retained by the normal authenticated upload service.

Reading choices follow the original file type. CSV, TSV and text files show encoding, separator and header row; UTF-8, UTF-16 and Windows-1252 are explicit choices, and the separator can be detected for review. Excel workbooks show only the header row and formula mode. Raster, vector and other document uploads use their original metadata when inspected. Every previous reading choice remains in the saved working file. Formula mode defaults to showing original formulas; cached original results require an explicit choice. No macros or formula engine are executed. Missing cached formula results stop a native parameter projection instead of becoming blanks.

Choose **Inspect original files**. The existing task queue records the exact request and shows progress or a useful error. Open the completed result to see original names, all worksheets or layers, source row numbers, actual column labels, native CRS/bounds/geometry and raster metadata. The preview samples 30 rows; this is visibly a sample and does not truncate the retained file. Integer cells beyond JavaScript’s exact range are displayed as their original decimal text. Unnamed and duplicate headings remain separate numbered columns.

Choose **Review this source** for each part needed by the scientific work. Explicitly select its role, title, original reference, edition/vintage, physical units, period, time zone, reviewing scientist and interpretation. Original identifier/label columns are selected by column identity, without renaming the original file. Changing a choice clears its confirmation. Confirm each reviewed selection.

Workbook sheets are inspected independently. If the selected header row is beyond a short cover sheet or an empty sheet, that sheet shows its own reading error while the readable scientific sheets remain available in their original order. A sheet with an inspection error cannot be selected for scientific use. The complete original workbook still accompanies every saved interpretation. To review a sheet with a different header position, change the reading choice and create another inspection; earlier inspections and source editions remain retained.

Continuous rasters can have an explicitly sourced positive unit conversion; conversion is applied later exactly once by the existing native grid engine. Original pixels remain unchanged. Multi-band rasters produce an exact selected-band TIFF while retaining the entire original. Land-cover classes require nearest or mode resampling and have no numeric unit scale. A spatial source without a CRS or with a nontrivial native raster scale/offset remains saveable as explicitly unready CONTEXT. It must be corrected/prepared and reviewed for a scientific role before native use. Context keeps the complete original file and does not create a selected-band projection. Domain/reporting/watershed roles require polygon geometry. These checks do not guess scientific meaning.

For a biophysical table, exact native headings (case, spaces and hyphens normalized for matching only) suggest unambiguous column choices for review. No values or units are inferred. Choose NDR, SDR or both and map the original columns to the existing native parameter fields. The complete selected worksheet is projected into a CSV; the original model.profiles.inspect_table validates required columns, unique land-cover codes and native ranges. All original worksheets, formulas, extra columns and files remain companions. A measurement table is retained for the existing Measurements intake; this desk does not duplicate observation normalization.

The mapping form names each parameter and shows the required fields for the selected native model first, using the same field definitions as the native table reader. It reports any missing choices before saving. Additional native column selections stay available under their own disclosure and remain in the projected table when selected; switching models never discards a mapping. Original headings containing `s`, including `usle_c`, `usle_p` and `proportion_subsurface_n`, are preserved during heading recognition. Existing saved inspections remain unchanged; inspect the retained originals again to obtain updated suggestions.

Choose **Save reviewed scientific source edition**. Its native result exposes the exact source_collection_id and selected source_ids. Open that saved collection, then select it in the existing preparation/grid/profile/scenario/run controls. The desk provides direct links to those controls. The WO48 guided journey can consume the same result; this intake neither submits a scientific run nor invents defaults for its conclusions.

## Retention and reopening

### Reuse familiar table headings

For a selected biophysical table, open **Save or reuse column mapping**. After choosing the original parameter columns, name the mapping and choose **Save named mapping**. The mapping retains the complete original header list, filename, worksheet and original inspection/file identities. It is included in the existing complete working-file download and returns when that working file is reopened against its original saved inspection.

On another inspected table, choose its scientific role and model selection, then choose a saved mapping. The preview compares exact original header text with every current header. Reordered unique columns follow their names rather than old positional column IDs. Missing, blank or duplicate headings require manual selection; the application never guesses which duplicate has the intended meaning. The preview lists the selected model's required fields that would remain unmapped.

**Apply matching columns** replaces the entire current parameter mapping with the unambiguous matches and retains the previous full working selection in its history. It keeps the new source's models, units, references, reading choices and other scientific fields. It clears confirmation so the scientist reviews the new values and meaning before saving a source edition. Reuse does not import old coefficients or run a model. Earlier working files without saved mappings remain readable.



Every original is stored in the existing content store. Every inspection and committed edition is an original queued operation. Retrying identical selections reuses the same deterministic operation identity; a changed interpretation produces a new request and immutable source edition. Required files and hashes are verified before completed state is published and again on reuse. A completed edition includes the exact interpretation, source manifest, selected native projection and every raw original.

Working browser choices are saved per Workspace in the current tab’s session storage. Download the complete working JSON before closing the tab when those unfinished choices matter; native saved files and operations are durable separately. Storage failure leaves the complete valid working state editable and downloadable. An unreadable prior browser copy remains unchanged with an exact download. Opening another source interpretation or working file retains prior complete selections in the working-copy history. All saved/imported/exported working documents use one exact pretty-printed UTF-8 representation and a 64 MiB capacity; prior work is never evicted to make room.

A late upload response is retained as a separate original receipt, not written over a later draft. **Select retained original** restores that receipt into the current selection. A downloaded working file can reopen in its original Workspace or a receiving copy containing its exact retained inspection. Before replacing visible choices, the receiving operator verifies the inspection identity, original project, retained files and selected fields. A copy without a saved inspection cannot move between local Workspace identities; inspect its originals and export the whole Workspace first.

When opening a verified receiving copy, earlier request IDs and their original Workspace scopes remain intact, and the complete previous working document is retained in history. New explicit edits and requests belong to the receiving Workspace. The original operator's upload handles are not portable, so those handles are removed only from the active receiving selection and retained in its original history. Saved interpretations continue to use the complete originals in the restored inspection. Choose the actual files again only to create a new inspection. The working JSON references retained native files; it is not a substitute for exporting the full Workspace.

Use the original full Workspace backup/restore to move the complete project. Source collections already contain original and projection companions. The operator’s workspace.restore action invokes ExtensionRegistry.verify_workspace, including this extension’s semantic operation-file verification, before registration. Direct model.portable CLI restore independently verifies archive member identities but does not invoke extension semantics; open that restored project in the operator and inspect its intake results to perform these additional checks. Restore preserves project identity and original source IDs. No replacement workspace or parallel model is introduced.

## Installed source

Copy the complete additive files into the corresponding current application paths:

- model/client_source_files.py
- operator/client_source_intake.py
- operator/web/client_source_intake.mjs
- operator/web/client_source_mapping.mjs
- operator/web/client_source_intake.css
- operator/extensions/client-source-intake.json
- operator/CLIENT_SOURCE_INTAKE.md

The current operator’s ExtensionRegistry loads the descriptor; no replacement server.py or app.mjs is required. Use the original installed extension host and existing runtime. CSV reading uses Python’s standard library; workbook reading uses openpyxl, and GIS reading uses the application’s existing rasterio/Fiona/GDAL/PROJ environment. The maintained environment.yml includes openpyxl for ordinary workbook intake. Update the original runtime through that environment’s normal installation process; this desk neither downloads readers nor starts a service.

## Original API for guided-journey integration

POST /api/upload remains the original raw upload with its selected Workspace and original filename. It returns the upload id and verified bytes/SHA-256.

POST /api/actions receives:
- action client-source.inspect; payload {title, uploads: [{upload_id, options: {encoding, delimiter?, header_row, formula_mode}}]}.
- action client-source.commit; payload {title, inspection_id, selections: [{file_index, part_index, title, role, uri, vintage, units, period, timezone, reviewer, reference, notes, identifier_field, label_field, mapping, models, resampling, conversion?, confirmed: true}]}.

Both retain the ordinary workspace and operation_id fields and use the original single-worker task queue. A client must keep its original operation identity across an uncertain response.

POST /api/client-source/catalog with {workspace} returns saved operations, roles and native field/unit definitions.
POST /api/client-source/result with {workspace,id} returns the complete original operation and ordinary verified download tickets.
A committed result returns source_collection_id/source_ids and the original save/export/reopen next steps.

Mapping keys are the existing native table field names; values are inspected column IDs c0, c1, etc. A conversion is {factor: positive finite number, target_units, reference}; original_units is retained from the reviewed source. Roles, reading options, source indices, native fields, CRS and unit requirements are validated server-side. A current exact schema is the complete source; no private client data is present in these files.

## Receiving the actual product

Use the existing accepted original operator/compute owner. Keep the complete original application, scientific dependencies, source files, project and source versions together in one producing runtime. Do not launch a new cloud session or duplicate a selected scientific run. Exercise actual representative retained sources now; adapt to Tim’s real incoming files when provided. Do not fabricate Tim’s schema or scientific observations.

Before a customer-ready claim, open the exact installed version, operate upload/inspection/mapping/save, navigate into the actual original scientific setup/run flow, download the raw original and full Workspace, stop/reopen and independently restore it. Check malformed/unsupported inputs, a failed reading choice, corrected later inspection, unfinished working-file reopen and earlier source editions after later changes. Inspect desktop and narrow widths. Actually LOOK at the rendered pages and downloaded artifacts; screenshots without viewing them, source review, DOM checks and JSON results do not replace this requirement. Record precise actual execution/visual limitations if runtime admission is unavailable. Preserve current owner contact rules and original source/model/receiver ownership.

## Continue a reviewed coefficient table into a profile

In a saved source edition, each reviewed biophysical table has **Prepare parameter profile**. This opens the existing Profile workbench with that exact collection, native CSV and confirmed NDR/SDR scope. Workbook sheets remain separate choices. The editor carries the retained source citation, source period and notes; original scalar parameters stay blank for explicit scientific selection.

Returning through the same source action reopens its existing browser draft, including unfinished or invalid values. It does not replace another table's draft or save a profile automatically. Review the native fields and choose **Save working profile** to retain the scientific configuration in the ordinary Workspace. Earlier source editions and profiles remain available. A reviewed source mapping is distinct from an actual scientific review of the resulting profile.

## Readable source review and current operation progress

The current intake shows each original worksheet, layer or band by name, with its original field count, selected header and readable sample. Table preview counts describe only the actual retained sample; an additional-row indicator never becomes an invented whole-file row count. An unreadable worksheet shows its reading error and selected header instead of a fabricated zero-row table. Original sample cells beyond the chosen header remain visible as explicitly unlabeled columns; a shorter source row is distinguished from a blank cell. Only actual original header fields are offered for scientific column mapping. Detailed original spatial/reading metadata remains available in a disclosure.

The selected-upload table uses the same keyboard-focusable horizontal scroll region as the original worksheet preview, so its four original columns stay usable within a narrow screen. Every reading control and retained-file action stays inside that region; the whole page keeps its viewport width.

Each source interpretation has a live summary of its selected role, original identifier and label columns, physical units, period, time zone, scientist and explicit conversion. Changing the form updates that summary and retains the existing confirmation rule. Native model requirements and parameter column mappings continue to come from the maintained model contract. The original direct Profile workbench handoff retains the exact source collection, table and selected model scope. Completed source entries show their saved interpretation separately from the current unfinished form.

The selected operation's progress is read from its actual saved record or current task. A completed inspection offers **Open completed inspection**; a completed source save offers **Open saved source edition**. Failed/interrupted/cancelled states remain visibly distinct and use the original task detail and resume controls. The former queued notice does not persist after the task completes. This display neither replays nor dispatches a native operation.

The paired source-inspection report appears first among retained downloads. **Read Source inspection and reviewed meaning** opens its ordinary HTML ticket, and **Download HTML** preserves the standalone report. The complete original JSON and every source file remain available. Working-file reopen, upload recovery and exact original request identities are unchanged. This intake adds no tour cards; the maintained whole-workbench startup walkthrough remains the existing maximum-four-card flow.

Receiving uses the already accepted populated operator: open the original XLSX at desktop and 390px, inspect its actual worksheets and original values, change/review role and ID/label/unit/period choices, save the exact source edition, read and download the report, download/reopen the complete working selection and independently reopen the Workspace. Also inspect an existing delimited source to verify its encoding/separator controls remain present. Open and personally inspect the actual source/report/downloaded files, fixing concrete defects in the same receiver.


## Read and export every original table row

In each readable CSV or worksheet card, choose **Read / search every original row**. The reader opens over the existing intake without changing a mapping, review, saved working copy or scientific source edition. It is bound to the actual completed inspection, original file digest, selected worksheet and saved encoding, delimiter, header and formula choices.

The first page begins after the selected original heading. **Include original notes and heading** starts at row 1; **First original row** accepts another original record position. Pages show up to 50, 100 or 250 complete records, including physical CSV line spans for quoted multi-line fields. **Next page** follows the original-row continuation; search scans later original values and stored Excel values, with an explicit case-sensitive choice. Search is literal text, not a scientific filter or formula evaluator. A page is limited to 4 MiB of complete record data; a single larger record directs you to the complete export or original file.

Duplicate and blank headings remain distinct numbered columns. Extra cells beyond the selected heading remain visible in their original positions. Empty strings, empty cells and absent cells have separate labels. For Excel, **Cell values** switches between selected-reader and stored values; **Cell meaning** exposes both and the retained number format and native type. Thus stored integer 1 with unambiguous number format 000 may be shown as identifier 001 without rounding a measurement. Dates, censoring literals, analytical qualifiers and formulas follow the unchanged source reader. No numeric or unit conversion occurs in this reader.

**Download complete current page** saves its complete rows and source selection as JSON. **Export every original row** streams the entire selected table, including notes, heading, blank records and every later row, into three retained artifacts:

- **Original_Table.html** opens independently in a browser. It contains all original records, source/reading metadata, cancelable local search, 50/100/250-row paging at both ends, navigation to an original row and the selected-reader/stored-value switch. Search decodes one row at a time and yields to the browser between batches; a replacement search supersedes the earlier one, and Cancel keeps the previous complete result visible. Wide tables and expanded cell metadata stay inside the narrow-screen document. It needs no running workbench or saved local server address. Printing prints its currently displayed page.
- **Original_Table_Rows.jsonl** begins with the source/worksheet/reading selection, then stores one complete original record per line with original positions, row role, selected-reader values and Excel stored values/format/type metadata.
- **Original_Table_Values.csv** carries every selected-reader value in original column order, with duplicate/blank headings and preamble preserved. CSV has no native cell-type or workbook-format representation; use JSONL and the exact original workbook for those distinctions.

The same download group includes the exact original CSV/workbook. Exports are retained as original-object-store derivatives plus an immutable source-selection manifest inside the existing intake directory. Repeating the same export reopens those verified artifacts. The offline viewer revision is part of a new export’s cache identity, so updated viewer controls are generated without changing original table values. Earlier unversioned exports remain verified and readable alongside the newer saved edition. Workspace backup/restore carries this retained work; the table reader can be reopened from the original saved inspection and generates current authenticated download links. Use the delivered root workbench launcher to reopen the application when a former browser address has expired.

### Original receiving course extension: full-table operation

Continue the existing own-file CSV/multi-sheet workbook receiving operation in its temporary exercise workspace. Keep the original source IDs, saved request identities, original files and clean Tim — Own data workspace unchanged. Use the actual completed inspection rather than injecting a fabricated client result.

1. Open a table with more than 30 source rows. Read a later page and a literal value beyond the preview, then return to the original notes/header. Check original record numbers and physical CSV line spans against the retained file, including a quoted multi-line value, duplicate/blank headings and a trailing extra column where present.
2. Open each actual workbook worksheet with its retained non-first header. Read a zero-padded ID, date, censor/qualifier, fractional value and formula through the current reader, switch to stored values, and open Cell meaning. Verify the saved reading choice and complete original workbook bytes remain the same.
3. Keep an unfinished mapping/working selection, open/close the reader and export every row. Confirm the unfinished selection remains intact. Inspect all complete JSONL/CSV contents and source counts, open the HTML at desktop and narrow width, search a later record and switch stored values with the server unavailable. Inspect actual rendered screens and downloaded files.
4. Reopen the same export from the retained inspection, then continue the original save/source-edition and native backup/restore course. Cold-open the restored workspace and read the same original rows/downloads. Use the current launcher/readiness route; preserve the original local Windows receiving owner and existing native run/transport identities.

These steps extend the existing actual product receiving flow under approved48/51/55 and opening addition59. Deliver the feature together with the complete current application and its maintained model/client_source_files.py, not as an isolated replacement application.
