# Saved delivery preparation

## Open the original project

Open the scientific operator, select the original workspace, and choose **Delivery preparation**. Save the current baseline, explicit future land-cover alternatives, source editions and designations, map settings, reviews, metadata contact and interpretation before building the complete delivery.

A preparation can be saved before every source or run is ready. **Check current preparation** reads current source metadata and reports missing or changed selections. The actual build performs the existing engine's complete source, application and scientific validation.

| Map family | Original basis |
| --- | --- |
| Future sediment loss | Explicit future land-cover scenarios |
| Future nutrient runoff | Explicit future land-cover scenarios |
| Critical drinking-water areas | Original designated areas and source method |
| High-quality waters | Original designated waters and source method |
| Current nutrient export | Original baseline NDR results |
| Current sediment export | Original baseline SDR results |
| Combined pollutant export | Common support, selected pollutant weights and caps |

The reporting basin and externally buffered modeled domain remain distinct. Paper size and DPI change presentation, not the analytical grid.

## Prepare and save

Choose **New preparation** or an entry under **Revise a delivery**. A revised delivery starts with its complete original selection, including native fields outside the typed editor.

Give the preparation a name and purpose. Select a completed original baseline and completed land-cover alternatives on the same grid and parameter profile. The desk lists runs with completed NDR and SDR stages and all three native export rasters. The original engine remains authoritative for actual versions, common support and source compatibility.

Choose supporting sources and map overlays. Inspect their original source collections before replacement. A water designation may bind a saved selection, exact filter and scientific method. **Choose another source** explicitly releases that choice and records the complete previous choice in the working copy. Use the existing designation workflow to make the replacement scientific decision.

Current and future exports retain their separate meanings. Do not substitute designated areas for modeled export. Priority weights and caps use the actual raster units. A blank cap uses the original engine's reference percentile; an explicit zero remains zero.

Select Letter, A4 or A3 paper, whole-number DPI from 120 to 600, display percentile and map headings. Attach retained observation comparisons, spatial reviews and complete map packs. Complete the responsible contact and retain limitations, qualifications and interpretation in the notes.

**Additional exact scientific and delivery fields** shows the full selection, including source reports, scenario analysis, decisions, economic editions, receiving-water configuration and coefficient evidence. Applying a native JSON selection is explicit; editing that text alone does not replace the current selection.

Choose **Save preparation revision**. An accepted save retains the complete selection, source snapshot, original task and previous revision identity. A later save compares against the selected revision. If another person saved first, preserve the visible working copy and open the newer revision or save a separate named copy.

## Continue a complete working copy

The browser writes the full working copy transactionally as it changes. It retains unfinished field text, original project/revision, and exact submitted request bodies. Reloading or returning to the desk preserves it.

**Download working copy** creates complete JSON. **Open working copy** checks its project identity and verifies retained operation results before treating them as completed. Receive the original complete project before opening its working copy on another computer.

If another tab wins a local save, the losing tab retains its full visible body and original storage revision. Choose **Save these changes as a separate copy**, download the visible copy, or explicitly **Reopen the other saved copy**.

A separate copy has a new preparation lineage and preserves native source bindings. **Copy settings for another cohort** retains map, source and contact settings, clears the old run selection, and explicitly detaches linked analysis, report, decision and economic editions. Their complete originals remain in the copy's provenance. Review and select compatible attachments before building. Only the original engine recreates derived execution and renderer bindings.

## Recover an interrupted request

Before sending, the browser atomically retains the complete request and original operation ID. Choose **Read original result** on its operation card.

A queued task may exist before the preparation model begins. It is pending, not absent. The desk resolves the original operator task and any retained alias before reading its preparation journal.

If the exact original request is confirmed absent, **Submit same original request** sends the retained body and ID. It never reconstructs another request from the current form. For an accepted failed or interrupted task, **Resume same operation** uses the original operator continuation.

A received project retains canonical task identities, complete origins and exact accepted results. One explicit boundary remains: if a lost response concerned an operator-only alias and no canonical task ID was retained, receive the original operator task and alias handoff. Equal payloads cannot prove the missing identity.

A changed-workspace request is preserved rather than rebound. An imported completion claim must pass actual original receipt verification; missing proof does not authorize a new submission.

## Build and inspect the full delivery

Save current changes and choose **Build saved revision**. The exact revision goes to the maintained delivery engine.

The first build freezes its application and scientific source binding under the original operation. A repeated accepted operation returns its retained complete result. Changed installed source or selected mutable records require original-source continuation or a reviewed new preparation/build; they cannot silently change the old delivery.

**Open complete delivery** opens the original reports, maps, GIS, FGDC metadata and working-project files. Read actual reports, view PDF maps, inspect real GIS geometry and attributes, extract archives and open the editable project. Retain desktop and narrow-screen observations and actual inspection of all outgoing attachments.

An archive captured within a delivery may hold a received delivery snapshot before the producing process wrote its later outer package. The returned completion scope identifies that snapshot; it does not establish receipt of a later outer archive.

**Read complete saved history** opens every retained revision and build. **Open complete project handoff** uses the existing **Transfer and restore** desk. The original whole-workspace archive includes preparation records and original operation history.

## Maintained native commands

Use the installed model CLI with the original workspace:

~~~sh
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-list --offset 0 --limit 50
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-inspect ORIGINAL_PREPARATION_UUID --revision 1
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-preview /absolute/save-selection.json
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-save /absolute/save-selection.json --operation-id ORIGINAL_OPERATION_UUID
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-build /absolute/build-selection.json --operation-id ORIGINAL_BUILD_UUID
python -m model.cli --workspace /absolute/scientific-workspace delivery-preparation-operation ORIGINAL_OPERATION_UUID
~~~

A save file contains exactly preparation_id, expected_revision, title, purpose and selection. The first expected revision is zero. A build file contains exactly preparation_id and revision. Keep the complete input and original operation ID for retry.

A browser user operation ID differs from its canonical operator task ID. Native receiving uses the actual canonical build ID in the accepted receipt.

## Complete original receiving course

The delivered operator/delivery_preparation_receiving.mjs exports operateDeliveryPreparation and inspectReceivedDeliveryPreparation. It runs inside an existing authenticated, populated operator course and starts no browser, listener, model solver or source collection.

Supply the existing page, workspace/project/delivery IDs, original course operation ID, private output directory, and the existing authenticated request, screenshot, download and bounded-wait helpers. The first phase:

1. Copies the complete original selection, retains a working note and verifies full draft recovery after reload.
2. Downloads and opens the complete actual working-copy JSON.
3. Submits one save, retains actual server acceptance, interrupts its browser reply and recovers the same task and revision.
4. Reopens the accepted working-copy file and verifies original receipts.
5. Builds the exact saved revision and replays the original request.
6. Opens the complete delivery and downloads every original ticket, including every saved file page. Scientific and client HTML use the maintained authenticated report preview with their original assets. PDFs and browser-readable images open directly. Other HTML retains its complete native directory and relative assets for recipient viewing; GIS/archive members remain for original native inspection. Equal original byte bodies retain every filename/label association.
7. Reopens saved history at desktop and narrow widths.

Native build completion follows the original process stop/cutoff and polls at one-second intervals without an added job deadline. Failed, interrupted or source-changed work retains its original request and observed result for explicit same-operation continuation.

The resulting browser-receipt.json names the actual preparation, revision, canonical build operation, complete files and original requests. A completed continuation verifies and reuses its first receipt without rerunning the build or replacing later legitimate work.

Continue the native phase using that actual receipt:

~~~sh
python operator/delivery_preparation_receiving.py \
  --workspace /absolute/scientific-workspace \
  --preparation-id ORIGINAL_PREPARATION_UUID \
  --revision 1 \
  --operation-id ORIGINAL_CANONICAL_BUILD_ID \
  --output /absolute/private/preparation-native-receiving
~~~

That maintained continuation uses Workspace.backup and the original portable receiver, then verifies the selected preparation, operation, delivery files and restored editable project. Keep its first immutable archive and receipt on restart.

Open its exact received workspace through the existing application launcher. Call inspectReceivedDeliveryPreparation with the accepted browser receipt, the complete native command result as nativeReceipt, the authenticated received page and actual new workspace key. The native result’s receipt.receiver.application and receipt.receiver.workspace select the original restored application and workspace. Its immutable receipt.received remains the original completion; current_received reports current history without rewriting that first result. It reads original canonical histories, opens the selected revision and imports the same complete working-copy file under the received project.

The maintained source_tools/receive_geographic_handover_browser.mjs accepts delivery_preparation: true in its existing upstate.geographic-browser-input/v1 JSON file. Run it with the same actual node executable and one absolute path to that input. Keep the original operation_id, restored_root, connection_file, output_directory, playwright_module, executable, archive_sha256, handover_id and completion_scope fields. The continuation keeps its immutable intent and progress at output_directory/delivery-preparation and one private browser profile at output_directory/private/delivery-preparation-profile under the original browser lock. The original geographic binding remains unchanged; each attempt records whether this added phase was selected. Keep that private profile with the original course continuation so pinned working-copy IDs survive a process restart. A pending full request saved by the product before its HTTP dispatch is recovered from that same working copy before any new action is considered. The complete original course retains its browser and request ownership. Preserve its actual selected regional or reference scope. A reference case does not become a regional scientific result. The receiving worker must personally view actual screens and every outgoing attachment; automated capture alone is not visual acceptance.

## Source ownership

This desk prepares existing deliverables. Designation methods, native NDR/SDR calculations, decision criteria, parcel ranking, interpretation and approval remain in their original authored workflows. Exact reviewed decisions travel through their retained source selections and results. This includes the complete original plan.selection.optimization object, analysis_id, study/request/file descriptors and original plan identity when supplied; the preparation desk does not recalculate their priorities.

The customer application and this guide describe operation. Commercial terms, staffing and internal coordination remain in the original internal opportunity material.
