# Saved projects

Open `/saved-projects.html` from the existing Stellar Forge application. The page collects work saved in the original shared draft store and opens each supported project in its original editor. The existing grant manuscript and source publisher remain independent of the browser's saved work.

## Scope and complete originals

The desk covers merchant setup, CoCart customer setup, SCF submission drafts, recorded submission reviews and unfinished submission-review working copies. Each record keeps its original ID, revision, name, timestamp and complete input, including retained source files, field text, original export text, review notes and unresolved input supported by its original editor. Unknown record kinds remain visible and downloadable without conversion.

The shared store is `stellar-forge-merchant-drafts`, version 1, object store `drafts`. This feature uses that same database. Companion-reader and Source Desk workspaces have separate stores and remain in their own original export/receive workflows. Unsaved forms in another editor are not a saved project: use that editor's Save or complete export before leaving it.

The desk adds its own receiving history and working reviews to the same store under reserved IDs. The original merchant picker shows merchant records, while this desk separates project records, receiving history and unfinished library reviews. No incoming history becomes a local command merely because it was included in an archive.

## Find, open and back up

Search by project name, type or ID, and order by name, type or last saved time. Selection survives filters. **Download selected** includes complete selected projects, together with the desk's retained receiving history and unfinished receiving reviews. **Download complete backup** selects all project records in this shared store. Both use one complete read-only database transaction for the source snapshot.

Open a project through its original workflow link. Merchant setup, CoCart and submission links select the exact saved ID; their existing editors retain their own validation and revision guards. A recorded review opens through its existing review ID. Opening a submission-review working copy uses that workflow's existing independent-copy behavior. Unsupported record kinds have no guessed editor link.

**Inspect** shows the complete record representation, with a bounded visual preview if the record is large. Its Download action contains every field. This single-record inspection format is separate from the complete archive format used by Receive archive; use Download selected for a directly receiveable one-project archive.

The archive is JSON with an identified body and full record hashes. A tagged graph represents undefined values, exact special numbers, sparse arrays, dates, binary buffers/views, shared objects and cycles instead of silently coercing them to ordinary JSON. Binary view offsets and shared backing buffers survive receiving. Unsupported structured object types fail clearly; preserve those through their original workflow. Plain strings, including unfinished text, retain their exact JavaScript contents.

Each archive is limited to 256 MiB and 5,000 total project/history/working records. Whole records are never truncated to fit. The API can omit history or working copies explicitly for a project-only transfer; the staff desk's default backup includes both. Clear the relevant checkboxes for an explicit project-only transfer. A history/working-only backup is available even when no project records remain. The inventory remains available when the store is larger; the bound applies to the complete selected archive.

## Receive and compare

Choose the complete archive file. Its raw text is retained in a local working review before validation. A malformed or incomplete file can therefore still be downloaded or reopened for correction; it is never treated as a completed project import.

A comparison shows each incoming project against its current complete local record:

- **New:** restore the original project or keep the current absent position.
- **Identical:** keep the identical original.
- **Conflict:** keep local work or explicitly replace it. Replacement retains the complete beforeimage in the receiving history.
- **Restore new projects:** restore only absent IDs and keep existing IDs. It does not invent new IDs for opaque projects.
- **Keep all local work:** record that choice without overwriting projects.

Project IDs are preserved across independent receiving. The desk does not rewrite nested native identities to manufacture separate copies. To create an independent submission or merchant copy, use that original editor's Save as new action.

Before applying, the full comparison, choices, request ID and exact archive text are saved as one unfinished working review. All project comparisons, selected writes and the original receiving receipt then commit in a single IndexedDB read-write transaction. A changed local record aborts the transaction. Recompare explicitly and review the resulting choices; another window's edits are never silently adopted as a new baseline.

Restoring an absent project keeps its original saved record. Replacing an existing project increments the current local revision and timestamp while preserving the complete incoming input. The receipt retains both the incoming original and previous local record.

## Reloads, conflicts and uncertain responses

The URL identifies the current saved working review. Reloading restores its exact raw archive, choices and any pending original request. A pending request is frozen. **Recover original result** resends that same request ID, body and comparison. The transaction checks for its completed receipt before checking a stale baseline, so replay returns the first result even after later project edits.

A working-review save uses the original draft revision guard. If another window saved that working review first, download the complete current review or choose **Save as separate working copy**. A fork of pending work retains the same pending operation ID and original comparison; it cannot create a second receiving operation accidentally.

The completed receipt is separate from the current recipient summaries. Later edits remain visible as current state and do not change the original receipt. Downloading a working review retains its complete raw text and request. Importing that downloaded review creates a new local review: earlier requests remain passive source history and a fresh explicit comparison is required before any new application.

Closing a review saves it and removes it only from the active screen. This feature does not delete the retained review. Malformed unfinished input remains available for full download.

## History and selective undo

Open a receiving result to inspect its original decision receipt, separately observed current project summaries and passive imported history. Full downloaded results include the original archive and complete before/after records. A backup includes these receipts so an independent recipient can retain their history.

Undo is selective. Compare the receipt's accepted after-values with the current saved records. An unchanged replacement can return to its original local input as a new local revision. An unchanged project created by receiving can be removed. A project that staff changed or deleted since receiving is unavailable for undo. Unselected and staff-changed records are reported separately and remain untouched.

Undo has its own durable working request and receipt, committed atomically against the selected unchanged current records. If those records change between review and application, the operation aborts. Recover an uncertain undo using its original ID; do not create a new request merely because an acknowledgment was lost.

Incoming history is passive. It does not authorize undo against unrelated local records. A recovered incoming unfinished working review creates a new local copy retaining the exact original record as provenance. Its earlier receiving/undo request, comparison and recipient links remain passive; compare again with this browser.

## Privacy and operational limits

Archives contain the full original saved inputs and may include source exports, commercial notes, unfinished answers and earlier receiving archives. Review recipients before sharing. The desk uses local browser storage and explicit downloads; it does not send saved projects to a server.

Use HTTPS or the existing loopback host for Web Crypto and IndexedDB. Browser storage availability and quota still apply. An unavailable or full store is an error, not a saved result. Complete downloaded archives are the portable copies to retain before clearing browser data.

The archive hashes establish internal byte/value consistency, not the author's identity or permission to act on an external system. Receiving a project does not submit a grant, publish a website, make a payment, run a customer service or approve a review.

## Maintained integration

`dist/saved-project-library.mjs` owns archive interpretation, original record summaries, receiving and undo. `drafts.mjs` retains the original database owner and adds complete snapshot and atomic multi-record operations. The staff interface is `saved-projects.html/.mjs/.css`. The existing browser asset manifest exposes these complete files; `saved-projects.mjs` at the developer-site root supplies additive navigation and asset composition helpers.

The maintained package exports `./grant/saved-projects` and `./grant/saved-projects/composition`. Keep the same complete source edition together, including the shared draft store. Browser storage/receiving success requires operating the real installed page; source review and syntax parsing alone do not establish that result.

### Programmatic interface

- `readLibrary()`: project, local receipt and working-review summaries.
- `exportProjects({ids,label,includeHistory:true,includeWorking:true})`: complete text, filename, exact raw SHA/bytes and archive ID.
- `openArchive(text)`: validated serializable archive view retaining exact original text.
- `reviewReceiving(archive)`: serializable incoming/current comparison and complete expected records.
- `commitReceiving({archive,review,choices,requestId,label})`: first receipt, replay flag and separate current summaries.
- `readReceipt(id)`, `exportReceipt(id)`: original result and passive history.
- `reviewUndo(receiptId)`, `commitUndo({review,ids,requestId,label})`: selective unchanged-record recovery.
- `saveWorking({id,revision,value})`, `loadWorking(id)`: original guarded local working records.
- `recoverWorking(receiptId,sourceWorkingId)`: a new local working copy with complete value and passive original provenance.
- `downloadProject(id)`: complete single-record inspection representation.

Use explicit stable request IDs. Keep an opaque archive/review exactly as returned. Retry the same request after an uncertain result; prepare a new comparison only as an explicit subsequent operation.

## Complete collection memory and selected snapshots

The current desk projects its inventory through one read-only transaction in the original version-1 store. It inspects one complete cursor record at a time, computes that record's exact existing tagged-value hash, and retains only the original summary for the inventory. It does not load all saved inputs or launch a parallel queue of complete record encoders just to open the desk. Equal-time ordering, supported editor links, original IDs and complete record interpretation remain unchanged.

A selected backup captures its selected complete projects, and any explicitly included history/working copies, from one original read-only snapshot. Unselected projects are not packed into the archive. Selected record order follows the operator's selected IDs; history and unfinished-work order remain the original database key order. There is no per-project transaction that could silently mix different source revisions into one archive.

Receiving comparisons and undo capture only their exact incoming or previously applied project IDs in one original snapshot. Their full expected values still reach the original atomic comparison/write/receipt transaction. An intervening edit aborts that application; a previously completed request returns its original receipt before attempting a stale comparison. Current summaries after the result are a separate observed snapshot and may include later staff edits.

The cursor callback is deliberately synchronous. It never awaits Web Crypto or another promise while holding an IndexedDB cursor. Complete record hashes use the retained MIT-licensed `emn178/js-sha256` 1.0.0 implementation on the actual `TextEncoder` bytes; its original source, upstream identity and full license travel inside the same library module. Archive/review/request hashes and exact version-1 representations remain unchanged. No new store, index, schema, native service or source-module dependency is required.

Archive opening verifies every member and reduces each decoded original to its ordinary summary before decoding the next. It still preserves the complete original archive text for download and original-request recovery. This is not a claim that a whole backup uses constant memory: the selected tagged graphs, full archive text, chosen expected records and transaction before/after values must remain complete. The existing 256 MiB archive and 5,000-record bounds still apply; history may itself contain earlier full archives. No record is truncated or silently omitted to fit.

The original `readDraftRecords()` full-snapshot API remains available unchanged for callers that explicitly need complete records. The library uses the added `projectDraftRecords(mapper, {ids})` hook in that same transaction owner: one synchronous projection per selected cursor record, no asynchronous mapper, and transaction failure if projection fails. This hook is a memory-lifecycle implementation detail, not a second saved-record interface for end users.

## Operate the saved collection normally

Use the actual presentation width and a narrow/mobile width. Open a complete existing project, filter/select the inventory, inspect and download full records, prepare a selected and complete backup, independently compare/receive it, preserve a later staff edit during original-request replay, review selective undo, reload unfinished choices and reopen the actual delivered files. For downloaded complete project/working JSON, reopen the original supported editor and operate it. View the actual archive contents and downloaded HTML in their recipient-facing form.

The allocation change's source-function comparison against complete retained project inputs establishes format and workflow compatibility only. It does not establish IndexedDB execution, browser heap usage, screenshots, installed native receiving or customer acceptance. The existing selected native/browser operation and its frozen input retain their original owner; adopt a newer source edition deliberately at that owner's next supported boundary.

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
