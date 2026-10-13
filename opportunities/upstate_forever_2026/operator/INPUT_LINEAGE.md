# Open the original inputs behind a native run

Operation: ECO-INPUT-LINEAGE-E258-20261013

Investigations connects a selected native run or prepared grid to the scientific inputs actually selected by that recipe. It displays the prepared grid, profile and full ordered scenario changes, then opens the complete original source file and every declared companion. The original Workspace and collection exporter retain the records and bytes.

## Operator journey

Open the maintained authenticated operator, select the scientific Workspace and choose **Investigations**. Create an investigation or reopen the intended saved one when you want to retain analyses or export a collection. Source navigation itself is read-only and does not require a new investigation.

1. Select a native model run or prepared-grid resource, then choose **Open input lineage**. A run view uses that run's actual grid, profile and scenario. A grid view includes the retained runs that selected it.
2. Read **Selected uses in native order**. Each source use retains its own run/profile/scenario context. Scenario patch numbers follow the original array order. Reusing the same source in several patches keeps all uses while avoiding duplicate file selections.
3. For each scenario mask, the complete identity is the original collection ID plus source ID. An explicitly selected patch collection wins over the scenario default. A missing or invalid explicit collection stays unavailable; it is never replaced by a similarly named source from another edition.
4. Open **Original grid preparation and spatial support**, **Original profile parameters and biophysical selection**, and **Complete original scenarios** to inspect the actual native recipe. These controls retain model domain and reporting support separately.
5. Choose **Open this exact source** or **Open original files and companions**. This resolves the original provider record, checks its declared body and companion identities, and returns authenticated downloads. The source page displays each full original member's bytes and SHA-256. **Download complete original collection manifest** gives the originally imported source manifest.
6. Use the source filter to find a collection edition, source ID, label or use. Two collections with the same source ID remain separate cards and separate selected pairs.
7. Choose **Add this source and companions to collection**, or **Add all original inputs and companions to collection**. The complete option is unavailable while any selected dependency or registered member is missing. Individual resolved sources remain readable. Prepared rasters are separate selections under **Prepared grid files**.
8. In **Source collections**, name and export the intended selected originals using the original queued operation. This includes the existing scientific inventory, portable catalog, original bodies and required companions. Source metadata and identities travel in that catalog. Keep a separately downloaded original source manifest with the delivery when the recipient needs the original intake document too.
9. Download the collection ZIP, extract it, open START.html and OPEN.html, and use the existing science_catalog_delivery.py verify command and portable CatalogRepository. Reopen the saved collection in Investigations to download the same retained edition.
10. Reload the operator and reopen Investigations. The navigator restores the selected run/grid and its exact lineage SHA-256. **Retained source views** reopens earlier selections. **Read current original selection** is an explicit refresh if the grid's run membership or other retained view data has changed.

Native scientific quantities, selected model behavior and calculation remain unchanged. Annual nutrient and sediment delivery retains its original declared units and spatial support. A retained file or completed scientific calculation is not an acceptance decision, a measurement of intake concentration, or a conclusion about fit for a particular use.

## What the view verifies

The first lineage read joins immutable/native records and declared descriptors. Its verification label deliberately says retained metadata. A selected source open uses the maintained repository.path method, which materializes the original typed source view and verifies the original source and declared companions. Prepared-file opening uses its actual registered prepared-grid dataset and original descriptor. The Operator's authenticated file service then checks the selected download identity.

The line-of-use record contains kind, selected collection/source, native context and, for masks, the original patch and zero-based patch_index. The visible order is one-based. Sources contain a stable key for the complete pair, all dependency IDs and all declared files. An unavailable selected record appears as an issue instead of being replaced or silently omitted.

The lineage SHA-256 binds the original native selection and retained lineage metadata. File opens carry that exact SHA and selected grid/run; a stale view must be reopened. Registered member IDs are obtained from the actual original provider's source_binding records, including primary/companion role and native member name. No provider IDs are guessed from filenames.

Source bytes stream through the normal download service. The browser does not load whole raster or archive files into a JavaScript hash buffer. Large downloads use the browser's native download manager. Browser filtering and source navigation do not edit scientific records.

## Maintained interfaces

The registered extension adds three authenticated GET reads:

| Route | Selection | Result |
| --- | --- | --- |
| /api/intelligence/lineage | workspace and grid_id or run_id; optional lineage_sha256 | Complete native selection, ordered dependencies, source pairs, original refs, prepared members, issues and selected edition |
| /api/intelligence/lineage-source | Same selection, exact lineage_sha256, collection_id and source_id | Complete selected source/collection metadata and verified original/companion/manifest downloads |
| /api/intelligence/lineage-file | Same selection, exact lineage_sha256 and dataset_id | One verified original or prepared member and its normal download ticket |

The original collection action remains intelligence.collection.export with session_id, title and original refs. It still owns freeze, continuation, verification and source delivery. These read routes never create another model run, native task or acceptance record.

The native selector is model.scenario_mask_sources.mask_pair. operator/science_catalog.py uses it directly. operator/intelligence_lineage.py adds only original provider/file navigation. The browser module is operator/web/investigation_lineage.mjs and mounts within the existing Investigations surface; its workspace-scoped retained state holds selections and history, not source file bytes.

## Complete source adoption

Use the current complete application source. The maintained install_intelligence_operator.py includes the new modules, actual native mask selector, guide and receiving helpers along with the existing Investigations component. It preserves unknown newer preimages and requires composition rather than overwriting them.

The extension manifest registers the three routes and the new static module. Copying investigations.mjs alone is incomplete. The selected source closure must include the matching science_catalog, intelligence, intelligence_lineage, extension manifest, browser modules and model.scenario_mask_sources. The current original full application collector follows these imports and keeps the existing complete operator/native product.

For an existing supported source installation:

    python install_intelligence_operator.py --application /actual/original/application --source-root /actual/current/complete/source --dry-run

After reviewing the actual source composition, use the same command without --dry-run. Do not replace an owner's unrelated newer files. Existing workspace records and calculations remain in their original directories.

## Native receiving using a saved run

Use the original equipped operator owner and existing verified Workspace. Stop or coordinate its same Workspace writer before invoking the original collection receiving course. The following command reads an actual saved run, verifies every exact source and companion, and executes only the maintained collection export/independent receive/reexport continuation:

    PYTHONDONTWRITEBYTECODE=1 python receiving/eco_intelligence/receive_input_lineage.py --application /actual/complete/application --workspace /actual/original/workspace --directory /actual/owned/lineage-receiving --run ORIGINAL_SAVED_RUN_ID --require-multiple-collections --require-companions

The optional require flags select an actual retained run that exercises multiple mask collections and required companions. Omit either only when that fact is genuinely absent from the chosen original data; the resulting receiving record states the actual source membership. Use --grid ORIGINAL_GRID_ID instead of --run for a grid-wide view.

The original scientific models are not rerun. The receiving directory retains input.json, complete lineage.json and receiving.json, plus the existing collection receiver's original selected refs, retained tasks, source ZIP, independently received portable catalog/files and companion reexport. Reissuing the exact command uses the same original source/request identities. A different source edition needs a distinct directory; keep earlier complete outputs.

The native helper checks the native mask_pair for every selected patch, complete registry membership, file download bytes, prepared descriptors, source conservation through the existing collector and exact cold lineage after original Operator restart. Its source-specific checks exist to close this user journey, not as a separate validation product.

## Browser receiving on the existing authenticated operator

The original equipped owner imports the helper and supplies its already-owned Page, authenticated API, exact workspace key, actual native receiving document and original ownership check. No browser installation or separate server is started.

    receiveInputLineage(page, {api, workspaceKey, receiving, outputDirectory, ownerCheck})

Import it from receiving/eco_intelligence/receive_input_lineage.mjs in the selected application. The outputDirectory is a distinct owned browser directory. receiving is the complete parsed native receiving.json above. api accepts an original relative operator route and returns its decoded value. ownerCheck confirms the original Page and current runtime ownership before user interaction.

The course opens the actual run/grid through Investigations, verifies the displayed dependency order, opens every original source and companion, downloads full bytes using the actual browser and hashes them in bounded native streams, operates collection-edition filtering at 390 pixels, adds the selected original refs to the existing collection, downloads the existing received collection ZIP, and reloads/reopens the exact lineage. Desktop and narrow PNGs are retained for actual producing-seat inspection.

The helper borrows the current browser; it never creates a scientific workspace or model run. It keeps its own atomic progress and output identities. A repeated completed invocation checks the retained output files and returns that same record. An interrupted invocation reuses exact retained files and the same completed native input.

Open and LOOK at the resulting screenshots and the full downloaded collection in their normal viewers. Independently received files belong to the native course; the browser course operates the actual original operator and its saved collection. Have the original owner open the independent received catalog in its normal application as well. Report the exact source edition, selected run, controls used, bytes received and any concrete defect; do not call an unexecuted helper or unseen PNG a ready product.

## Source and execution status

This contribution is generic maintained scientific application software. Its complete public source review and publication are separate from execution on an equipped user's actual data. Actual native/browser/visual results are recorded in the original Eco operation when the original owner returns them. Existing science/input/run/result/packaging owners continue their original work; this navigation reads those retained records.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
