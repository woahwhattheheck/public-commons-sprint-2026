# Complete submission review rounds

Review the exact draft prepared in the existing Stellar Forge submission editor, return specific changes to its author, and receive the revised draft without losing the original review.

The workspace is at `/grant-review-round.html`. Open **Review prepared draft** from the application reader or submission editor. It uses the same browser draft store as Prepare submission and the other Stellar Forge workspaces.

A round keeps the complete original submission exports, not just copied answer snippets. Each decision is bound to its selected answer, issuer field, requirement or complete application. The original reviewer remains attached when another participant explicitly carries that decision to an unchanged revision.

## Complete operator journey

### 1. Prepare and open the original draft

Use the existing **Prepare submission** workspace to receive the complete application source, retain the actual issuer prompts and limits, and prepare the answers. The original native plan, source, handover and other extension fields remain part of that draft.

Choose **Download full draft** there. In Submission review, choose **Open submission draft**, select that complete JSON, enter a review name and the first reviewer's name, and choose plain text or Markdown. Alternatively, select **Review this saved submission** from the list of actual drafts in the same browser.

The selected format is retained for the whole round. A decision reviews exactly that format's output. Start another round if the review needs a different copy format.

The original application source files are checked against their complete UTF-8 byte counts, SHA-256 and Git blob identities. The complete native export is kept unchanged, including every retained source edition and native draft extension. A different logical submission draft starts a different round; it cannot silently replace this round's original draft.

### 2. Review the answers and issuer fields

The left navigation contains the complete application, all nine original answers, every native issuer-field identity and the original nine content requirements. Open a target and read its exact selected text.

Choose **Accepted for this review**, **Changes requested**, or **Not applicable — explain why**. Record the reviewer note and any supporting references. A reference can retain a complete HTTPS source URL, a written observation, or both. The review retains the full note and reference; it does not replace the underlying original source.

A specific change also records its title, priority, reason and an optional exact quotation. The quote must occur in the selected text. The request stays attached to that original target, export and reviewer even after the author receives another draft.

Decision and response forms retain their unrecorded text while switching targets, participants or views on the same page. Record a form before downloading the review or opening another round. **Discard unrecorded forms** clears only those unrecorded controls. Recorded actions remain in the round. Closing the page with unfinished form text triggers the browser's normal warning; unrecorded text is not represented as a saved decision.

### 3. Record the author's response and the reviewer's resolution

Add the named author through **Add a named participant**, then select that person in **Person recording this action**. Names have stable identities within the round. Adding another person does not rewrite earlier attribution.

In **Changes and replies**, record an author response: addressed, declined with an explanation, or clarification requested. Then select the reviewer and record a separate resolution: resolved, deferred, or reopened.

The author response and reviewer resolution are separate retained actions. A response does not silently resolve its request. A deferred request remains outstanding. When the selected target changes in a later draft, a previously resolved request reopens and retains the earlier resolution.

Participant names identify responsibility within the file; the workspace does not authenticate a person or claim an issuer approval.

### 4. Receive a revised native draft

The author continues the same draft in Prepare submission, then downloads its complete new export. In the review, open **Compare a revision** and choose **Open revised full draft**.

The comparison retains both complete texts and their context. It shows changed, unchanged, added and removed targets. Identical visible text can still require a fresh review when its source baseline, issuer prompt, limit, selected answer mapping or form observation changes.

Choose what happens to **every** current decision:

- **Carry the original decision forward** is available only when the full target and source context are unchanged.
- **Reopen for a fresh review** preserves the earlier decision in history and leaves the new target unreviewed.
- **Carry all unchanged decisions forward** is an explicit operator choice. Changed or removed targets stay selected for reopening.

Record why this draft is being received, then choose **Receive this revised draft**. The selecting participant is retained separately from the original reviewer. The original reviewer identity and original decision identity remain in each carried decision.

A later source delivery never edits the original source body. The submission editor's source/version behavior remains authoritative; the review retains its entire returned draft.

### 5. Finish, export and reopen

Choose **Finish or reopen review**.

**Return requested changes to the author** can complete an editorial handover while work remains. The report lists the outstanding work.

**Ready for the final author check** requires a current acceptable decision for every complete target, resolved requests and the original native field checks. It does not submit the application. The applicant and actual issuer workflow remain with their original owners.

Use the three downloads:

| Download | Complete contents | How it is used |
| --- | --- | --- |
| Complete review | Every original native export, stable participants, full action inputs, earlier/current decisions, requests, references, author responses, resolutions and source selections | Open in Submission review to inspect or continue the entire round |
| Review report | Current decisions and references, complete request/reply/resolution history, all nine selected answers, every selected issuer field and the retained export identities | Read the full editorial handover without reconstructing the application from links |
| Selected original draft | The exact original native export, unchanged | Open in Prepare submission to continue the same draft |

A complete review can be imported into another browser and saved as a separate browser copy. Its logical review, submission, reviewer and field identities remain unchanged. A completed review must be explicitly reopened before recording another action or selecting another draft.

The browser store uses the original revision comparison. If another tab has advanced a record, the complete current review remains available in the page. **Save separate browser copy** preserves it under a new browser-record identity without replacing the other tab's work.

## Source and portable contracts

The new files do not replace the submission editor's model or database.

| Layer | Original or new contract |
| --- | --- |
| Submission draft | `stellar-forge.grant-submission-draft.v1` |
| Exact native export | `stellar-forge.grant-submission-export.v1` |
| Review round | `stellar-forge.grant-review-round.v1` |
| Complete review export | `stellar-forge.grant-review-round-export.v1` |
| Browser store | Existing `drafts.mjs` list/load/save and `DraftConflictError` behavior |
| Selected workflow | `SCF-SUBMISSION-REVIEW-ROUND-7108-20261012` |

A complete review export is:

```js
{
  schema: 'stellar-forge.grant-review-round-export.v1',
  exportedAt: 'complete UTC ISO time',
  sha256: 'SHA-256 of JSON.stringify(round)',
  round
}
```


The round retains its initial complete native capture, all received captures and an ordered event journal. Each event retains its original request ID, expected revision, actor, kind, complete input, timestamp and preceding event digest. Receiving verifies the full native sources and reconstructs the entire current state from those actions.

Calling the same request ID with the same original input returns the current complete round, preserving later work. Reusing it with different input is rejected. Hashes check retained content; they are not signatures authenticating the named participants.

`applyReviewAction(round, request, incomingCapture)` is the shared mutation entry. Request fields are `requestId`, `expectedRevision`, `actorId`, `kind`, `input`, and a complete UTC `at`. The incoming capture is supplied only with the explicit receive action.

Other exports from the complete browser model:

```js
readSubmissionExport(exportText, {fileName, receivedAt})
captureSubmissionDraft(nativeDraft, {fileName, receivedAt})
createReviewRound(capture, {id, title, reviewer, format, now})
validateReviewRound(round)
reviewRoundView(round, {editionId})
compareReviewDraft(round, incomingCapture)
exportReviewRound(round, {now})
importReviewRound(serialized)
reviewReport(round)
```


The original native draft allowance is 16 MiB. The complete review is limited to 64 MiB, at most 100 complete draft editions and 20,000 retained events. A complete full-history export that exceeds its allowance is rejected; the workspace does not silently truncate it.

### Shared reviewer composition

The existing serial composer owns the current application and source index. It imports the additive helper and applies it after the existing reviewer-entry and submission hooks, before serializing the original four reader outputs:

```js
import {
  attachGrantReviewRounds,
  registerGrantReviewRoundAssets,
  attachReviewRoundToSubmission
} from './grant-review-round.mjs';

const reviewed = attachGrantReviewRounds({templateHtml: html, sourceIndex: index});
html = reviewed.templateHtml;
index = reviewed.sourceIndex;
manifest = registerGrantReviewRoundAssets(manifest);
submissionHtml = attachReviewRoundToSubmission(submissionHtml);
```


The helper preserves the complete current template, native submission page and unrelated manifest routes. It adds a single navigation link per owned marker and declares the complete four review routes. The source-index entry retains the current original application SHA/Git identity and the complete native/review schemas.

The source closure comprises the four review browser files, the helper, this guide and both receiving modules. Keep the current original `grant-submission-core.mjs` and all of its actual planning/handover dependencies, `drafts.mjs`, and the original application assets. Receive the complete source in the existing installed Developer portal contribution and browser manifest. A page that is present in Git but absent from the original server's manifest is not a complete installed integration.

The same full review JSON is suitable as explicitly selected evidence in the original submission-handover product. It should retain the exact JSON bytes and complete SHA, not summarize or rebuild its journal.

## Complete original-source receiving

`GRANT_REVIEW_ROUNDS_MODEL.mjs` exports:

```js
const model = await runGrantReviewModel({
  draft: originalNativeDraft,
  nextSource: originalNativeSource,
  operationId: 'your-original-model-operation',
  startedAt: 'your-retained-editorial-timeline-start',
  reviewer: {id: 'named-model-reviewer', label: 'Named automated model reviewer'},
  author: {id: 'named-model-author', label: 'Named automated model author'}
});
```


The caller supplies a real complete original native draft with a clearly labeled receiving-example field and a distinct real native source. The helper uses the original source/version/answer methods, keeps unknown native extensions, and exercises the complete review through changed-text rejection, explicit carry, author reply, source receiving, field-context reopening, completion, full export, independent receive/repeat and continued reopening.

It returns `{result, artifacts, fixtures}`. Each artifact has its complete content, relative path, byte count and SHA-256. The full result records the input source identities and every material receiving outcome. The isolated example decisions are labeled automated source-model observations, not human or issuer approval. Its caller-selected editorial timestamps form a deterministic exercise timeline; they do not claim new provider-acquisition times. Actual execution timestamps are reported separately.

The original completed receiving uses the retained 41,628-byte application (Git `ce32b5134a6c4a43b147959b90d952ae87ff64b5`) and its 25,397-byte later original front (Git `b56afba315258f4c099edecdc1ee73896e743b1f`). It preserves three exact native exports, nine full answers, the receiving-example field and four original author versions. All 33 recorded actions reconstruct, the complete received round matches the original, and explicit reopening adds its 34th action. These are retained source-model results; current canonical text continues to advance through its existing author.

## Browser receiving in the existing operation

`GRANT_REVIEW_ROUNDS_BROWSER.mjs` borrows an already-owned Playwright Page:

```js
const browser = await runGrantReviewBrowser({
  page: existingReceivingPage,
  baseUrl: actualOriginalReviewerBaseUrl,
  fixtures: model.fixtures,
  sourceFiles: selectedCompleteBrowserFileDescriptors,
  operationId: 'your-original-review-browser-operation',
  checkpoint: retainedCheckpointOrNull,
  retain: saveThroughTheExistingReceiver,
  timeoutMs: 60000
});
```


It does not launch a browser, listener, installer, issuer action or second native controller. The existing receiving owner keeps those lifetimes.

Each source descriptor is `{route, bytes, sha256, gitBlob}`. It must describe the actual selected source body, and the callback verifies the complete bytes served by the existing host. Required routes include all four review assets, the current native submission core and the original shared store. Also pass the actual native core's complete additional module closure from the selected original source manifest.

The callback performs the real UI sequence: open full native draft, name review, record decisions and a specific original quote, add/select the author, explicitly carry two unchanged decisions, respond, resolve, receive the newer source, observe the reopened request, return changes, and download every complete result. It then receives the exact full review into a separate browser record, reloads that record, checks both complete records, and explicitly reopens the received copy while preserving the original event prefix.

Desktop and 390-pixel mobile observations cover the actual side-by-side author comparison and final handover. The existing receiver retains those original PNGs for visual inspection. Customer artifacts are complete JSON and Markdown; the screenshots remain QA artifacts.

The checkpoint contains the exact source/input selection, original browser and logical round identities, full selected exported round, original download bodies, phase and complete file descriptors. The supplied `retain` callback must use the receiver's original atomic/CAS publication contract and preserve its returned outcomes. An unknown checkpoint write remains with that same writer.

A retry selects the same checkpoint and original browser record. Already recorded steps are found by their retained complete action and receiving marker before any new UI UUID is chosen. A frozen complete UI export and its artifacts are selected before repeating later receiving, preventing a new timestamp or screenshot from changing an already retained bundle. The independently received record has its own browser identity and the same logical review/source history.

A completed individual download is verified and reused before another download click, including interruption before the overall UI bundle is complete. Before either independent receiving or recovery creates a separate browser copy, the checkpoint writer retains the exact full copy input, original source record and pre-existing store identities. Continuation first reconciles the matching new record through the original store, or verifies its retained destination ID, before another Save copy action. This preserves one selected destination when a save succeeds but its reply or checkpoint continuation is lost.

On error, the callback leaves the original Page open and attaches `receivingCheckpoint` and browser observations to the error. When possible it reads the still-open complete review export and unrecorded form values into that same returned checkpoint. A saved newer native result is preserved as a separate browser copy on continuation, rather than replaying it under another request or overwriting a concurrent record. Preserve the original error and complete checkpoint; do not claim the browser journey passed from the source-model result alone.

Keep the original existing reviewer and Site publication operations. The source integration, browser receiving, issuer submission and Site publication remain separate facts in the final delivery.

## Complete working copies

A recorded review is an editorial journal. A working copy contains that entire journal plus the work needed to continue it: every unfinished decision, requested change, author response, reviewer resolution, receiving note and finish/reopen note; their exact original edition and participant; all unfinished supporting references; the complete selected incoming draft and carry choices; the complete starting draft and unfinished review name/person/format; the participant-name input; and current view selections.

Invalid text stays visible and downloadable. For example, an unfinished HTTP reference is retained exactly even though the original recorded-review action requires HTTPS. Only **Record decision**, **Record author reply**, or another original explicit action creates a journal entry. Working-copy persistence does not approve text, authenticate a person, finish a review or submit an application.

### Save, reload and separate windows

The page saves after a short pause and after completed staff actions using the original revision-checked IndexedDB store. **Save working copy now** waits for that store transaction. Read **Complete working copy saved** before closing the page. Pending or failed saves trigger the ordinary unload warning; a failed save keeps all current fields available for complete download.

Each page load has an independent working identity. Its URL selects the last complete working copy; reload verifies that saved original and opens a separate copy for this window. Opening the same link in another tab also creates an independent copy. Neither window silently overwrites the other's unfinished text. This deliberately retains earlier copies, which are listed under **Saved reviews → Complete working copies**.

Opening a saved working copy or receiving a working package gives its recorded review a new unsaved browser binding. An action continues the same logical review history in that separate native record. The original saved round remains available under **Saved review rounds**. Working-copy identity, native browser record identity and logical review identity have separate meanings.

**Save working as separate copy** retains local values after a conflict. **Open latest saved working version** first saves the local values independently, then opens the selected stored version as another independent copy. It never replaces the current fields until their complete local copy is durable. If storage is unavailable or full, download the complete working package and resolve storage before switching.

The original native review save continues to use its own expected browser revision. If another tab changed that native record, the existing conflict behavior keeps the complete local review and offers a separate saved record. A successful working save is not reported as a successful native-record overwrite.

### Download and receive all unfinished work

Use **Download complete working copy**, then **Open working package** on the receiving installation. The complete JSON includes the native review body and exact original start/incoming exports. Its whole-body SHA-256 is checked, every original native source is verified through the unchanged review/submission verifier, and each unfinished form retains its original source/participant context. The receiver validates everything before changing the open copy, and first saves the preceding local work.

A package does not import sender-local IndexedDB record IDs as a target for writes. Receiving creates a separate working identity and an unsaved native browser binding. The unchanged review engine validates any subsequent recorded action normally. Full working files support at most112 MiB; original recorded reviews retain their64 MiB limit and original submission drafts their16 MiB limit. Oversize source selection or unavailable storage does not truncate the selected work.

**Retained unfinished forms** exposes every unfinished form, including a form for an older received draft. Open its original context or read its exact raw values. A note from an older edition never becomes a decision about a new edition. Recording a revised draft does not erase unrelated older unfinished notes.

The three existing recorded downloads keep their original semantics: the complete native review, the readable recorded review report, and the selected exact original submission draft. They do not mislabel unfinished values as recorded decisions. Use the separate working package for unfinished work.

### Source and installation

The additive module is **dist/grant-review-working-copy.mjs**. Its exported contracts are:

- **newWorkingCopy** creates a complete empty working model.
- **validateWorkingCopy**, **exportWorkingCopy** and **importWorkingCopy** retain/verify the complete original sources and raw unfinished values.
- **forkWorkingCopy** creates a separate identity and by default clears sender-native record targeting.
- **saveWorkingCopy**, **loadWorkingCopy** and **listWorkingCopies** use the unchanged **drafts.mjs** transaction and revision contract.

The original review workspace and page integrate these controls. **grant-review-round.mjs** and **browser-assets.json** include the new browser route, so both the source server and original static-reader exporter ship the entire module. The canonical application, cumulative source package and existing native/Site operation remain with their original owners.

For actual browser receiving, use the existing review Page and original complete draft/round. Enter an unfinished decision note and reference, select a revised original draft and retain carry notes, then save/download the complete working copy. Reload and verify every unfinished value and both source identities. Open that exact package in a separate existing browser context, continue one original review action, download/reopen its whole native review, and confirm that the sender's working copy and original recorded history remain intact. Keep the actual browser result separate from source review and parsing; this source change starts no browser or listener.
