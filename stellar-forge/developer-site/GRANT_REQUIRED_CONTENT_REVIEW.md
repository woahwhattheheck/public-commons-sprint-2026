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
