# Conservation working files

## Continue unfinished work in Conservation planning

Open **Working files and recovery** in the existing Conservation planning screen. The editor saves complete unfinished study, source-acquisition, portfolio, priority and scenario forms, including literal partial inputs, selected planning units, matched families, weights and named case comparisons.

1. Continue entering the study or decision. The status line shows when the browser has saved the active working edition.
2. Enter a working-file name and choose **Save this complete edition** to retain a named version. Ordinary typing updates the active edition.
3. Choose **Download complete working file** to save the current active values, every named edition and original record references.
4. After reopening the application, choose the saved file and **Open saved file**. To receive a downloaded file, use **Open a downloaded working file**. The received file gets an independent local identity.
5. Review the complete authored values. Choose **Check original project records** to read the current original study, portfolio, source and candidate-cohort records.
6. Choose **Restore this edition into the editor**. The existing forms reopen with their raw values and selected original context. Named editions use the same review-and-restore flow.

The source comparison shows missing run or imported-source choices so they can be corrected in the restored draft. An existing decision form also needs its original study or saved portfolio. Receive those through the existing editable Study or complete Workspace transfer to continue in another application copy.

If another tab has advanced the same working file, its committed edition remains intact. **Download complete working file** retains the current local edits and named history. **Save independent working file** gives those local values their own retained identity. Storage errors keep the current values in the editor and display the same download and independent-save controls.

Opening a saved edition for review leaves the current editor available. Edits made during source review, saved-file refresh, download or other asynchronous controls are retained when the operation finishes. Restoration rereads original context and checks for intervening editor changes before replacing forms.

## Receiving this complete feature

The source includes the existing editor, both browser modules, the current Conservation extension descriptor, the component fragment, this guide and both maintained installers. The descriptor registers both imported assets; the installers require the complete module/guide/fragment closure.

Use the same original Conservation receiving application and Workspace. Open the actual current Conservation screen at desktop and narrow widths. Enter a partial numeric value and a scientific family reason, save a named edition, download the actual file, reload the application, open the browser copy, receive the downloaded copy, review original records, and restore the named version. Check the original study/plan context and exact entered values, then continue editing. Open a second tab to the same retained file, advance it in one tab, and use the other tab's download or independent-save action to retain its conflicting edits. Open the downloaded file itself and confirm every named edition and source reference is present.

## Working-file module


This browser module preserves unfinished Conservation work as editable working files. Its original project ID, saved-record references and raw form values travel together so the existing Conservation desk can explicitly restore and compare them.

## What the scientist can retain

The active draft includes unfinished strings, incomplete criteria, partial family choices, visible selections, and the original saved study or plan metadata supplied by the host. The module validates its project identity and JSON representation without validating scientific forms or filling missing values. A weight entered as "0." remains "0."; an unfinished family ID remains an empty string.

An ordinary save replaces the active draft and increments one revision. It does not create a historical edition. The scientist can explicitly name an edition and later restore that edition to the active draft. Named editions are immutable. A restore replaces the active draft; the UI must first offer to save or download any current unsaved work that the user wants to keep.

A downloaded file includes the active draft, all named editions, complete source originals and flat ancestry. Import creates a new independent local ID, retains the original project ID and all named editions, and records the imported file's exact hash and byte count. It does not replace an existing browser file, adopt its project into the current Workspace, or submit any native operation.

Default limits are 32 MiB per complete file, 256 named editions, 4,096 flat ancestry receipts, 128 JSON nesting levels and 2,000,000 JSON nodes. Exceeding a limit leaves the retained file unchanged. At the named-edition limit, export the complete existing file and explicitly start a new working file; a fork preserves the history and therefore does not reset this limit.

## Complete file contract

The public module is operator/web/conservation_working.mjs and has no external module imports.

A full file has:

    {
      schema: "upstate.conservation-working-file/v1",
      id,
      projectId,
      name,
      revision,
      previousSha256,
      createdAt,
      updatedAt,
      active: {payload, sha256},
      editions: [{id, label, createdAt, payload, sha256}],
      ancestry: [{
        id, projectId, revision, sha256, relation,
        importSha256?, importBytes?, filename?
      }],
      originals: [{
        sha256, bytes, labels: [{filename, mediaType}], base64
      }],
      sha256
    }

previousSha256 is null for a new, forked or imported local file, and otherwise binds its exact immediate predecessor. The outer sha256 hashes canonical JSON of the complete file excluding that one outer sha256 field. Active and edition hashes independently bind their complete payloads. Canonical object keys are sorted; array order and every string are preserved.

The payload must be a JSON object containing project.id as nonempty original text. The host's current getState().data.project is the project source. workspace_key is optional informational text or null, identifying a local Operator copy. Files are listed by projectId regardless of Workspace filesystem path or local workspace_key.

The core accepts these proposed host sections without assigning scientific authority:

    {
      project: {id, title},
      workspace_key,
      form, draft, portfolio, optimization, scenario, acquisition,
      selection: {
        study_id, plan_id, selected_ids, excluded_ids,
        retained_selection, selection_origin
      },
      originals: {study, plan, retained_selection},
      display: {...}
    }

The payload may contain additional ordinary JSON fields. Do not pass functions, undefined, class instances, dates, sparse arrays, circular objects, nonfinite numbers, negative zero or unsafe integers. Preserve exact or unfinished numeric text as strings. Existing native request metadata can be retained as information; this module never submits, resumes or replays it.

## Original bytes and bounded ancestry

Payload originals are retained record metadata supplied by the host. Separately, makeFile/create can accept source originals as byte-bearing inputs:

    originals: [{
      bytes: Uint8Array | ArrayBuffer | string,
      filename: "original-study.json",
      mediaType: "application/json"
    }]

Strings are encoded as UTF-8. Supply actual bytes when exact original encoding matters. The module keeps one body per SHA-256 and merges distinct filename/media-type labels for identical bodies. The portable file includes each unique source body once. IndexedDB keeps the body once in its shared objects store, rather than copying it into every file row.

The exact incoming portable file is also retained once locally in the imports store. readImportedBytes(importSha256) returns these exact original bytes after verification. Descendant portable files carry its flat import receipt, source originals and complete working state. They do not recursively embed previous portable containers. Consequently, intermediate container bytes can be recovered from the browser that imported them, while portable descendants preserve the verified ancestry receipt and complete working/source contents. This is deliberate and prevents exponential nesting across repeated export/import cycles.

## Public API

### Pure tools: available even when IndexedDB fails

    import {
      createConservationWorkingTools,
      makeFile, encodeFile, inspectFile, forkFile, makeImport
    } from "./conservation_working.mjs";

The named convenience functions use default capacities and browser crypto. createConservationWorkingTools(options) returns the same pure operations plus editionFile, restoreFile and validateFile, with optional crypto, now and capacity injection. A store also exposes its configured pure tools.

All input payloads, existing files and source bytes are copied before their first asynchronous hash operation.

- makeFile({payload, name?, existingFile?, originals?}) returns a complete newly sealed file. Without existingFile it creates a new local ID at revision 1. With existingFile it preserves editions, ancestry and original sources, replaces active payload, and advances exactly one revision.
- encodeFile(file) returns {file, bytes: Uint8Array, sha256, filename, mediaType}. sha256 here identifies the exact encoded download bytes; file.sha256 identifies its canonical complete contents. Use new Blob([result.bytes], {type: result.mediaType}) for the existing download control.
- inspectFile(bytes) returns {file, sha256, bytes: number} after fatal UTF-8 decoding, complete schema checks and all hashes. It does not change identity or storage.
- makeImport({bytes, expectedProjectId, name?, filename?}) returns {file, originalImport}. file is the independent local successor. originalImport is the exact byte record required by commitCandidate for atomic import retention.
- forkFile({existingFile, payload?, name?}) returns a new local file preserving all named editions and source originals. Supplying payload retains the current unsaved work in the fork.
- editionFile({existingFile, label, payload?}) saves the supplied or existing active payload as an explicit new named edition, advancing the revision.
- restoreFile({existingFile, editionId}) restores the selected named payload into active state, preserving all named editions and advancing the revision.
- validateFile(file) returns a verified independent copy.

These pure operations allow download without a successful database write. Keep the complete loaded file and current form state in the UI. Do not depend on a later database read to recover an unsaved draft after quota, permission, private-browsing or storage failures.

### IndexedDB store

    import {openConservationWorkingStore} from "./conservation_working.mjs";
    const working = await openConservationWorkingStore({
      onVersionChange() {
        // The connection is already closed. Keep the current in-memory file.
      }
    });

Options include indexedDB, crypto, now, databaseName and the capacities above. Production defaults use the original browser APIs; dependency injection is for controlled receiving or source exercises. The database name is upstate-conservation-working, version 1.

Methods:

| Method | Result |
| --- | --- |
| list(projectId) | Summary array for that original project, newest update first |
| read(projectId, fileId) | Complete verified file, with original source bytes |
| create({payload, name?, originals?}) | Complete committed new file |
| save({projectId, fileId, expectedRevision, payload, name?, existingFile?}) | Complete committed file |
| saveEdition({projectId, fileId, expectedRevision, label, payload?}) | Complete committed file with one new named edition |
| restoreEdition({projectId, fileId, expectedRevision, editionId}) | Complete committed file with restored active draft |
| fork({projectId, fileId?, existingFile?, payload?, name?}) | Complete committed independent file |
| importFile({bytes, expectedProjectId, name?, filename?}) | Complete committed independent imported file |
| exportFile(projectId, fileId) | Same result as encodeFile, after verified database read |
| commitCandidate(file, expectedRevision, {originalImport?}?) | Complete committed candidate |
| recover(projectId) | {projectId, files, issues}, validating each listed file independently |
| readImportedBytes(sha256) | Exact retained imported-container Uint8Array |
| close() | Closes this connection |

expectedRevision is null only when committing a new local ID, and a positive integer otherwise. A candidate must have revision equal to expectedRevision + 1 and previousSha256 equal to the retained predecessor seal. All mutation results resolve only after the entire IndexedDB transaction completes.

list returns only summaries; it does not load all named payloads and source bytes. Its summaries include id, projectId, name, revision, createdAt, updatedAt, sha256, editionCount, originalCount and the informational workspace_key. read performs full content validation. recover returns healthy complete files and per-file issues without hiding valid files because one file is damaged. It performs no scientific restoration or external action.

## Recommended UI save flow

Capture the original project and complete current raw payload when scheduling a save. Queue saves per local working file. Debounce raw edits, but do not create named editions during autosave.

    const base = currentWorkingFile;
    const capturedPayload = captureRawConservationState();
    const candidate = await working.makeFile({
      existingFile: base,
      payload: capturedPayload,
      name: workingName
    });

    try {
      const committed = await working.commitCandidate(
        candidate, base === null ? null : base.revision
      );
      // Adopt only if this is still the same project, file and UI save generation.
      // Preserve any edits made after capturedPayload instead of replacing them.
    } catch (error) {
      // Keep candidate and the newer live raw form values.
      // Offer explicit reload, download, or save as a new independent file.
    }

On the first save, pass existingFile: null. Once committed, keep the returned full file as the next base. Never silently refresh expectedRevision and overwrite a competing tab. CONFLICT includes current/expected revision context and the complete candidate when one has been prepared. QUOTA, STORAGE, CLOSED and transaction errors also retain the candidate passed to commitCandidate.

For a conflict fork, use the local candidate and current unsaved payload:

    const independent = await working.fork({
      projectId: candidate.projectId,
      existingFile: candidate,
      payload: captureRawConservationState(),
      name: "Independent working copy"
    });

If storage itself fails, encodeFile(candidate) remains available. For changes newer than candidate, first use makeFile with the newest raw payload and that complete candidate, then download. Its revision is a local working edition, not a claim that any database commit or native computation occurred.

Do not write an old project's captured draft under a newly selected project. Capture projectId/workspace_key and check the host's project/file/save generation before applying asynchronous results. Changing Workspace paths for the same project does not require copying or rewriting working files.

## Explicit adoption into the scientific workflow

Opening a working file is an editable restoration only. The host must re-read current original study and plan records, compare the stored source and selection identities, and present an explicit adoption action before using them for a scientific request. Keep imported originals for comparison; do not replace their identifiers with guessed current ones.

The active payload can be scientifically incomplete or invalid. Continue using the existing Conservation validators when the user chooses Preview, Save portfolio, Export scientific results or another actual domain action. The working-file store does not invoke these actions.

Pending request metadata is informational. Reopening a working file must not restart a model, resubmit a saved request, apply a plan or accept a result automatically.

## Atomicity and recovery

files, heads, objects and imports participate in the same read/write transaction. The file's revision and exact predecessor seal are read inside that transaction before any update. Named-edition and ancestry prefixes, every original source and its labels, and creation identity are preserved. A source-object collision aborts the whole transaction, including the file and its summary.

Hashing and other asynchronous preparation complete before the transaction begins. The transaction callback queues only IndexedDB requests; no network, digest or unrelated awaited operation can allow the transaction to become inactive. A browser interruption before commit leaves the old file; an interruption after commit leaves the new file and its matching list entry. Startup can use list and read/recover to find it even if the old tab never displayed a success message.

A blocked startup or version change keeps the current in-memory draft available. The module never deletes the database, retries a write with a new revision automatically, or silently falls back to lossy localStorage.

## Required product receiving

Source parsing and pure-function exercises do not establish browser readiness. The producing peer must open the exact assembled application, operate its real working-file controls and look at actual desktop and narrow screens. Use unfinished criteria and family inputs; save a named edition, reload, restore explicitly, export and reopen the actual downloaded file in an independent local file, and check the original raw values and sources. Operate a second tab with a stale revision and confirm the first file survives while the losing tab can download or fork its own work. Exercise an actual storage failure through the browser's controlled test boundary and retain the unsaved candidate.

Open the final outgoing attachment as a recipient and inspect both editable content and named history. This is the existing Conservation application and receiving course, not a new dashboard or model run.

## Source exercise record

The complete module's pure functions were executed in V8 with explicitly injected UTF-8/crypto facilities. The exercise preserved unfinished strings and caller snapshots; replaced only active state during ordinary saves; retained and restored named editions; round-tripped exact binary originals; created independent imported IDs; kept import ancestry flat; and rejected wrong-project imports, altered payload hashes, malformed UTF-8, nonfinite JSON and configured capacity excess.

Independent complete-source review checked IndexedDB transaction ordering, byte-object collision rollback, exact revision/predecessor CAS, immutable history, original-byte reconstruction and import/fork admission. Real IndexedDB/browser operation remains part of the product receiving above.

IndexedDB transaction semantics are based on the original W3C specification:
https://w3c.github.io/IndexedDB/#transaction-lifecycle
