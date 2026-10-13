# Review required content against the exact submission text

Open **Prepare submission → Required content** in the existing SCF application. This is the original submission draft and browser store. The review works with its nine canonical answers and the actual issuer fields already recorded in **Issuer form fields**.

An editorial status now has a complete text basis. Select the answers or fields you actually read, name the reviewer, enter the supporting location or reason, and explicitly record the decision. Later edits expose a full comparison. A local decision does not determine SCF eligibility or issuer acceptance.

## Operated user journey

1. Open the original saved draft or its complete exported JSON. Existing statuses and notes remain visible. A historical review without a recorded text basis says **Needs first review of exact text**; the application never silently attaches it to today's wording.
2. Open a requirement. Read its original criterion and the complete selected text. Select any combination of complete canonical answers and actual issuer fields. A field selection retains its exact label, prompt, answer text, source URL, observation date, limits, counting convention, answer associations and position among selected fields.
3. Enter the reviewer name and a precise note locating the useful evidence or explaining the decision. Choose **Covered in selected text**, **Needs editing**, or **Not applicable — explain why**. A covered decision needs at least one selected answer or field. Not applicable needs a named reviewer and an explicit reason.
4. Select **Record review of this exact text**. The operation keeps the current wording and retains the preceding complete working draft through the original Saved versions model. The recorded review retains the full selection, text, source-answer dependencies of selected fields, issuer form context, criteria URL/date, reviewer, decision and time.
5. Continue editing through the ordinary answer editor, field editor, source receiving or native planning workflow. Reopen Required content. Changes to selected text, field prompts/metadata, selected field order, linked source answers, form context or criteria edition make the review visibly changed. No background operation updates the original reviewed basis.
6. Read the full original and current values. Revise the answer or field through its existing editor where needed. Return to Required content and explicitly record the new decision. Earlier decisions remain in Saved versions. Restoring an older version restores its exact earlier text and review together.
7. In **Submission handover**, choose canonical answers or actual issuer fields and prepare the exact edition. The frozen required-content coverage uses that selected output. A covered review of canonical answers alone is marked **different-output** for issuer-field preparation. Pending decisions, changed bases and unbound historical reviews remain explicit observations.
8. Download the full draft and prepared report. Reopen the complete JSON through the original import control, save through the existing browser record, and continue. The prepared edition stays frozen while later work has its own comparison.

## What a review covers

The review retains complete selected text; it does not infer evidence from keyword matches, an external URL, a checked box or an attachment. Select the actual issuer fields when those are the submitted output. The field's linked answer texts are also retained so a later source/plan answer update remains visible even if the operator has deliberately kept the field wording.

An unselected answer or field is outside that decision. A review of one selected field does not establish that every other field is complete. **Covered** is the named reviewer's assessment; the application exposes exactly what was reviewed.

Published guidance is available from the original [SCF submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria), [budget guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines) and [official rules](https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions). The criteria require a complete, self-contained submission. Use the currently published issuer instructions and actual form; these local records do not perform submission.

## Unfinished work and recovery

Review controls write an unfinished selection into the original draft. Saving or exporting the draft retains that complete selection. A pending edit does not silently replace the last recorded decision. **Discard unfinished review edits** first retains the preceding working version and then removes only that unfinished selection.

Removing a selected form field does not delete the old reviewed text. Its comparison reports a missing field, and the unfinished selection can explicitly remove that missing identity before a new review is recorded.

The existing draft revision/CAS, import verification and complete export envelope remain the only save and receiving mechanisms. No second database, browser operation, issuer request or reviewer-round store is introduced. The original logical 16 MiB draft budget still applies. A candidate that exceeds it fails validation before replacing the open draft.

## Prepared handover and historical compatibility

Existing prepared editions keep their exact bodies and hashes. They remain readable and say when they predate exact required-content coverage.

New preparations contain an explicit coverage summary tied to their immutable authoring snapshot and selected output kind. Complete reviewed text is retained in the snapshot; the coverage summary does not make another large copy of each answer. Receiving recomputes that summary from the frozen snapshot and rejects a mismatch even when an outer envelope was rehashed.

The readable prepared report reconstructs its complete review text and comparisons from that frozen snapshot, including stale text as it stood at preparation. It never consults the current draft for the frozen coverage. Later edits continue to appear in the existing separate prepared-versus-current comparison.

## Maintained interfaces

- **dist/grant-requirement-review-core.mjs** supplies structural validation, exact basis capture, full current comparison, output coverage and the escaped readable coverage section.
- **recordRequirementReview(draft, id, input, at?)** in the original submission core retains the preceding version and returns the complete validated successor. Input is {actor,status,note,answerIds,fieldIds}.
- **requirementReviewInput(review)** returns the retained unfinished selection or the prior decision's editable selection.
- **requirementReviewStatus(draft,id,{criteria?})** returns the complete basis/current values and changes, with unbound, changed or current state.
- **requirementCoverage(draft,{outputKind,criteria?,includeText?})** maps every original requirement to its exact current editorial state for answers or fields.
- **dist/grant-requirement-review-workspace.mjs** borrows the original editor callbacks and uses the same Required content view.
- The existing **grant-submission.mjs** registers both additive browser modules and declares this review in the original source index. The actual static **browser-assets.json** also includes both routes for the maintained server and installed application.
- The original handover producer and verifier freeze/recompute coverage; the existing whole draft export remains **stellar-forge.grant-submission-export.v1**.

Operation: **SCF-REQUIRED-CONTENT-REVIEW-7108-20261013**. The existing cumulative source publisher and original saved-draft receiving owner retain publication/native execution. Source-function verification is reported separately from actual Page/IndexedDB receiving.


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
