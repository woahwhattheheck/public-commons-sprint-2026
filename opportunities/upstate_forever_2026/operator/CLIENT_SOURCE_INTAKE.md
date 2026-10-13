# Open my data — original scientific source intake

TokenJunkieLabs · ECO-CLIENT-SOURCE-INTAKE-20261013 · WO45/50.

This is an installed desk in the maintained Upper Savannah operator. It accepts ordinary client files, shows the original worksheet/layer/band and fields, retains explicit scientific interpretation, then saves a real source collection through Workspace.import_sources. The existing source preparation, native grid, parameter profile, scenario, model run, comparison and delivery engines remain authoritative.

## Use

Open the original operator and select **Open my data**. Give the intake a useful name. Select the actual CSV/TSV, modern Excel workbook, GeoTIFF, GeoPackage, GeoJSON or shapefile together with its original SHX/DBF/PRJ sidecars. Unsupported formats remain downloadable original documents. Files are first retained by the normal authenticated upload service.

Review the text encoding, CSV delimiter, original header row and formula mode. UTF-8, UTF-16 and Windows-1252 are explicit choices. A CSV separator can be detected for inspection, then selected explicitly if necessary. Formula mode defaults to showing original formulas; cached original results require an explicit choice. No macros or formula engine are executed. Missing cached formula results stop a native parameter projection instead of becoming blanks.

Choose **Inspect original files**. The existing task queue records the exact request and shows progress or a useful error. Open the completed result to see original names, all worksheets or layers, source row numbers, actual column labels, native CRS/bounds/geometry and raster metadata. The preview samples 30 rows; this is visibly a sample and does not truncate the retained file. Integer cells beyond JavaScript’s exact range are displayed as their original decimal text. Unnamed and duplicate headings remain separate numbered columns.

Choose **Review this source** for each part needed by the scientific work. Explicitly select its role, title, original reference, edition/vintage, physical units, period, time zone, reviewing scientist and interpretation. Original identifier/label columns are selected by column identity, without renaming the original file. Changing a choice clears its confirmation. Confirm each reviewed selection.

Workbook sheets are inspected independently. If the selected header row is beyond a short cover sheet or an empty sheet, that sheet shows its own reading error while the readable scientific sheets remain available in their original order. A sheet with an inspection error cannot be selected for scientific use. The complete original workbook still accompanies every saved interpretation. To review a sheet with a different header position, change the reading choice and create another inspection; earlier inspections and source editions remain retained.

Continuous rasters can have an explicitly sourced positive unit conversion; conversion is applied later exactly once by the existing native grid engine. Original pixels remain unchanged. Multi-band rasters produce an exact selected-band TIFF while retaining the entire original. Land-cover classes require nearest or mode resampling and have no numeric unit scale. A spatial source without a CRS or with a nontrivial native raster scale/offset remains saveable as explicitly unready CONTEXT. It must be corrected/prepared and reviewed for a scientific role before native use. Context keeps the complete original file and does not create a selected-band projection. Domain/reporting/watershed roles require polygon geometry. These checks do not guess scientific meaning.

For a biophysical table, exact native headings (case, spaces and hyphens normalized for matching only) suggest unambiguous column choices for review. No values or units are inferred. Choose NDR, SDR or both and map the original columns to the existing native parameter fields. The complete selected worksheet is projected into a CSV; the original model.profiles.inspect_table validates required columns, unique land-cover codes and native ranges. All original worksheets, formulas, extra columns and files remain companions. A measurement table is retained for the existing Measurements intake; this desk does not duplicate observation normalization.

The mapping form names each parameter and shows the required fields for the selected native model first, using the same field definitions as the native table reader. It reports any missing choices before saving. Additional native column selections stay available under their own disclosure and remain in the projected table when selected; switching models never discards a mapping. Original headings containing `s`, including `usle_c`, `usle_p` and `proportion_subsurface_n`, are preserved during heading recognition. Existing saved inspections remain unchanged; inspect the retained originals again to obtain updated suggestions.

Choose **Save reviewed scientific source edition**. Its native result exposes the exact source_collection_id and selected source_ids. Open that saved collection, then select it in the existing preparation/grid/profile/scenario/run controls. The desk provides direct links to those controls. The WO48 guided journey can consume the same result; this intake neither submits a scientific run nor invents defaults for its conclusions.

## Retention and reopening

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
