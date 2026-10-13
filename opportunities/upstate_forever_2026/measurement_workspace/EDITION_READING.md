# Reading a complete saved Measurements edition

Prepared by TokenJunkieLabs.

This reader opens the original eligible and excluded input populations of one saved collection edition. It uses that edition's immutable source binding, workspace revision, scientific filters, native counts and original member hashes. Every displayed row is the complete original JSON record. The original scientific writers, source interpretation, review choices, eligibility rules and model runs remain in the maintained Measurements engine.

## Short guidance in the view

Three plain cards sit beside the population controls, original-record table and original-file catalogue. Each explains that nearby feature and offers a button that moves focus to its actual control without operating it. **Got it** dismisses that card; **Show reading guidance** restores all three. Dismissal travels with the complete collection working copy and independent reading file. The view retains all scientific fields and terminology. Startup help is in the product rather than a separate launch document.

This implements the owner's October 13, 21:19–21:20 UTC direction for a small number of dismissible cards and approachable operation for experienced scientists. The original complete-workbench onboarding remains with its current owner.

## Open the selected edition

In **Observation collections and complete study editions**, open the existing collection and its saved complete study edition. The existing edition controls and whole-file downloads remain available. The recipient reader displays the collection ID, edition ID, saved workspace revision and original population counts. Expand **Complete native edition, source binding and scientific filters** to inspect the entire retained metadata.

The native collection binding retains its document hash and original source paths. A large edition does not necessarily carry the complete human-labelled collection manifest as a separate metadata response. The full original project and source documents remain in project.zip. The reader does not fill missing labels from the current live workspace.

Choose **Eligible measured inputs** or **Excluded measured inputs**. Select 1 to 200 records per page and choose **Read selected population**. The original record, source-result ID, station/reach, original date/time precision, constituent/basis/fraction, value, unit, censoring bounds and exclusion reasons are shown. **Complete original fields and source references** opens every field of that same record, including its original logical key and import/source references.

An **Absent** field was absent in the saved JSON. **Null** is the saved JSON null value. Neither is converted into a numerical zero, a detection limit, an uncensored measurement, a date or a guessed assignment. Eligible input means the native edition retained it as available for explicit model binding. This view performs no new calibration, scientific approval, annual-load calculation or result substitution.

## Filter and page through the original population

Station, constituent and exclusion-reason filters match the original strings exactly, including case. A blank control includes all values of that field. An exclusion-reason filter matches a complete member of the original reasons array. The view does not interpret a substring as a different chemical species, unit, fraction, reach or station alias.

Display filters are separate from the original scientific filters retained in the edition. They do not change the downloaded population or the original project. The complete original-file download buttons always select the entire member.

**Continue reading** resumes at the next original record boundary. **Previous page** reopens the preceding retained boundary under the same applied display filter. **Reopen saved page** reads the exact retained current page after opening a reading file or returning to the view. Editing controls does not silently change a displayed page: choose **Read selected population** to apply the new selection from the beginning. The displayed page explicitly states its applied filters and original byte range.

A page scans at most 8 MiB of original population bytes, finishing any already-started complete record. A sparse filter can therefore show zero matches with further bytes remaining. Continue reading until the view says it reached the end. The view reports the actual records inspected on the current page, the actual displayed rows and the original native population count. It does not declare a whole-population filtered count from one page.

The cache retains at most four original 256 KiB chunks. The native chunks are checked against their declared exact lengths and SHA-256 values before parsing. JSON records that cross chunk or UTF-8 character boundaries remain complete. This display supports individual records up to 16 MiB. If a single record exceeds that display budget, the view identifies the exact original member and leaves its complete download available; no partial record is substituted.

## Retain unfinished reading and recover

The complete reading state lives in the existing collection working copy. It includes the pinned edition metadata, applied population/filter/position, previous positions, unfinished filter controls and an interrupted exact read. It does not become part of the scientific collection definition or native receive request.

Use the original **Download complete working file** to retain the whole collection and its reader state. The reader also offers **Download complete reading file**, which retains the full selected edition and reading state independently of the surrounding collection. Original source bytes remain in the native edition or the complete received folder.

**Pause reading** retains the exact attempted population and position. A late response cannot replace a paused view. **Resume retained reading** selects that same request. Opening a saved reading file verifies that it identifies the exact current edition. If controls change while the file is being read, the newer controls remain and the user can select the saved file again explicitly.

The installed host retains the complete reader session when selecting another workspace or account and restores it only under the original account/workspace scope. File-system handles are never serialized. A returned offline session asks the user to reselect its exact original folder.

Up to 10,000 preceding page boundaries are retained in one reading history. **Retain file and start history here** offers the complete previous reading file for download, then starts a fresh page history at the same original position. It preserves the exact edition and applied filters, and does not discard the old source or scientific results.

The parent working file uses its existing browser persistence lease. If another tab changes the saved copy or local storage is full, the view retains current work in memory and displays an alert. Download the complete reading file and whole working file. Retain both tabs' files before reloading the browser's current saved copy and explicitly selecting the intended complete file.

A saved reading file is a position and source binding, not an independent scientific archive. To receive the complete editable project in another workspace, use the original project.zip and installed archive receiving workflow.

## Open a received folder offline

Use **Open received edition folder** and select the actual edition directory created by **Receive complete edition to folder**. This is the child containing EDITION.json, RECEIVED.json and files/. The original parent folder remains the selection for resuming a receiving operation.

Opening the reader checks the complete metadata and original receiving-result binding. It then checks each original byte chunk that is actually read for display. It does not contact the source workspace or write to the received directory. The existing **Verify received edition folder** command remains the full all-member scan.

Every offline complete-file download rereads and checks all of that member's original chunks before offering its File. A changed member is reported and retained in place. Its contents are not replaced or normalized. Keep the whole folder and project.zip for ordinary full receiving; the browser view does not rebuild a missing archive or source file.

## Complete original downloads

The original edition's file catalogue is shown in full. Online downloads use the maintained disk-backed checked-chunk downloadCollectionMember path. Offline downloads use the same selected metadata and actual local File handles, checking every chunk before offering the original file.

These operations retain original paths, bytes, CSV/JSON formatting and native whole-file identities. Display filters never create a new filtered scientific output. The collection's original folder receiver and project archive continue to provide the complete editable handover.

Open each outgoing population, CSV, complete archive and other original attachment in its normal recipient application. A working reading bookmark remains separate from those originals.

## Maintained source and lifecycle contract

The browser model is measurement_workspace/web/edition_reader.mjs; the view is edition_review.mjs. Installed aliases use the same complete bodies. Original checked transport and folder binding come from collection_transfer.mjs and collection_folder.mjs.

The model exports:

- createCollectionEditionReader({edition, readChunk, check, digest}): pins the complete metadata; page(selection) checks original chunks and returns full original rows plus exact continuation.
- openRemoteCollectionEditionReader({api, id, collectionId, check, digest}): uses the existing edition metadata and chunk API.
- openFolderCollectionEditionReader({directory, check, progress, digest}): opens the existing original folder binding and reads local original ranges. It exposes originalFile(name) for full-member receiving.
- collectionReadingPosition and validateCollectionReadingPosition: preserve and validate an exact immutable edition position, filters and preceding page boundaries.

The view mountCollectionEditionReader(host, {reader, workspaceKey, initialPosition, downloadOriginal, onChange, check}) returns snapshot(), hasUnsaved() and destroy(). onChange retains the complete serialized session in the parent's existing collection working copy and returns that original save operation's boolean. Parent controls and events exclude the nested data-edition-reader root. Parent destruction snapshots the view before disposing it and its owned read lifetime. No backend state or new native write route is introduced.

The complete saved metadata remains on reader.edition. Offline readers also expose folderName and originalFile. Current scientific interpretations and provider authority stay in the original product.

## Original producing course

Continue the existing 15227 / 7915–8007 collection receiving operation using its current complete installed source, original workspace, full source fixture and saved edition. Keep the original reconciliation-receiving.mjs --chapter large-collections outputs, native source transfers and cold receiving.

Open the exact current saved edition at desktop width and 390 pixels. Use each guidance card's control pointer, dismiss cards, reopen the complete working file and confirm their retained state, then restore the guidance. Operate eligible/excluded selection, empty populations, exact existing station/constituent/reason filters, sparse ranges, Previous/Continue, full original details and each original download. Save and reopen a complete reading file with unfinished filter controls. Pause an in-flight read, resume its original position and preserve its same-source result. Select another workspace/account and return to the original complete reader state.

Receive the full original edition through the already-owned folder control. Open that exact folder in the recipient reader, inspect the same original rows offline, exercise the original-file downloads, and separately run the complete folder verifier. The receiving workspace's new edition remains its own native edition; it never replaces the sender's historical archive.

The complete original eight-station case legitimately has zero chemistry rows when no measured chemistry original was selected. Its reader must show the correct zero population and source binding. Populated reading is exercised on the original operation's actual retained chemistry population, preserving its precise source and native edition; do not invent observations in that source case.

Inspect the actual screenshots and every attachment as a recipient, not only source or DOM counts. Record the exact source/version, original edition, viewports, controls, files and any repaired concrete defect in the same existing receiving result. Focused source execution does not replace the producing operator's actual native and visual receiving.

## Current owner direction

Read CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 and the active root/project AGENTS.md. Preserve current scientific workers, complete original sources/results, existing controller/runtime, TokenJunkieLabs attribution and every other standing owner instruction. The work remains in the existing original Eco course. Commercial methods and customer sales history stay on their internal project surfaces.

Before presenting any client-facing app, report, view, demo or attachment as ready, the responsible producing worker must open, run, render, LOOK at and use the exact outgoing version. Inspect its populated, empty, loading and error states, actual presentation and narrow widths, critical controls, original downloads and cold reopening. View captured screenshots. Open every outgoing attachment in its normal viewer. Repair unreadable, clipped, cramped, broken or unstyled results within the authorized work. Source review, HTTP success, unit checks, DOM counts and another worker's approval do not replace personal observation. This is focused delivery work, not a new review gate or a broad testing programme. Carry the full owner direction into every current delegated/native opening and handoff.
