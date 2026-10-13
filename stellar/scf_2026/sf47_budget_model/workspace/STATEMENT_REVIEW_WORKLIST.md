# Returned review worklist

Open **Accounts → Statements → Returned review worklist** in the original grant case. The worklist keeps several colleagues' complete returned recommendations, operator notes and unfinished field choices together with the statement's named working copy.

The accountant review still starts with a saved edition and a current native preview. The returned file proposes changes; the account operator chooses each field and then uses the existing native statement preview and reviewed cash import.

## Receive and switch between complete returns

1. Preview the original statement in its intended account, currency and interpretation.
2. Under **Accountant recipient review**, enter the colleague's name and role, then choose **Save edition and download offline reviewer**. Give that complete HTML file to the intended colleague through the project's authorized delivery channel.
3. Choose **Open returned recommendations** to receive their complete attributed JSON return. The return must resolve to its exact issued review and locally saved original edition.
4. Receive other colleagues' returns the same way. Each distinct complete return becomes its own work item. Receiving the identical return again selects the existing item, retaining its note and choices. An amended return, including a changed reviewer note or timestamp, remains a separate original.
5. In **Returned review worklist**, find a reviewer, role, original filename, packet identity or note. Filter by **Received**, **Choices in progress** or **Applied to draft**. **Open return** selects that work item without replacing statement source bytes, row decisions or invoice work.

The list shows the original filename, account label, currency, issued edition, return time, received time, saved-choice count and application count. Ten returns appear per page. **Clear search** restores the full list. A selected return remains selected when a filter hides its row, so its note and comparison remain visible.

**Issued reviews** lists the retained original editions and recipients. **Download issued reviewer** returns the original complete offline reviewer again. It resolves the packet against the trusted local saved edition first. The selected original returned JSON can also be downloaded unchanged.

## Make and resume field choices

Choose **Compare original, current and returned**. The existing comparison shows the issued value, current draft value and returned recommendation for every changed field. Choose **Keep current** or **Use returned** explicitly for each field, including concurrent conflicts and already-current recommendations.

Choices are saved per returned file. **Save review progress** explicitly waits for this complete draft to be stored before you close or hand over the page. The **Operator note for this return** is separate from the colleague's original attribution and note. Changing this note does not edit the return or invalidate a current financial comparison.

Switch to another return, review it, and come back. The desk resolves the trusted original edition again and recomputes the comparison. It resumes saved choices only when the original context, current case version, row decisions, allocation work and preview basis still match. The persisted comparison stores editable basis and changed-field values; it does not recursively embed the complete worklist or repeat the original bank bytes in each comparison.

If something changed, the desk displays the reason and retains **Earlier comparison and saved choices** for inspection. **Apply** is unavailable until the operator compares again. A fresh comparison clears earlier choices when its basis differs, so changed work receives explicit new decisions. Merely opening another work item or adding an operator note does not clear current choices.

A normal page reload can resume the current saved draft's matching comparison. Opening a named edition or a downloaded recovery copy follows the existing source recovery behavior: it requires a new native preview. After that preview, matching saved choices can resume; changed interpretations or case versions require a fresh comparison.

## Apply one selected return

After selecting every field, choose **Apply selected recommendations to original draft**. The desk:

- recomputes the current comparison against the trusted local original;
- checks the saved comparison basis and every selected field;
- saves the complete pre-application working edition;
- rechecks the complete current draft after that save;
- applies the explicitly selected recommendations to the original draft;
- retains the complete attributed application in its existing review history;
- records the work item's applying operator, time and selected-field count;
- saves the resulting complete working edition.

The worklist marks this return **Applied to draft**. Earlier applications remain visible. A later explicit comparison can review current differences again. Changes from one colleague may make another colleague's unfinished comparison stale; the second colleague's original return, note and old choices remain retained.

Applying recommendations leaves cash creation to the original native preview and reviewed import. Every return is handled individually; the worklist does not silently combine reviewers' recommendations.

## Recovery and complete handover

The worklist travels inside the original statement draft and named copy editions. **Download recovery copy**, a saved complete edition, and **Download all working copies** retain complete returns, selected work item, operator notes, progress, comparison basis, field choices and application summaries. The existing archive also retains issued packets and their original immutable editions.

For another browser or authorized operator:

1. Open the same original grant case with the appropriate Staff context.
2. Import the complete working-copy archive.
3. Select and explicitly open the intended edition.
4. Preview the original statement against that case.
5. Open the retained return. The desk resolves its original saved edition locally and checks the current comparison before resuming choices.
6. Inspect any stale reason, compare again when needed, then apply explicit selections.

A returned JSON alone cannot supply the trusted edition. Keep the complete original working-copy archive with the case handover.

During an uncertain import or setup request, the original exact request remains authoritative. Worklist search, selection, notes and original downloads remain available as recovery operations. Starting a new review, importing recommendations, making field choices and applying changes require the retained request to finish. Staff storage scope, actor checks, source limits and the original immutable archive safeguards continue to apply.

Earlier drafts containing one active return migrate it and previously applied returns into the worklist. Migration preserves complete original return documents and application attribution. It does not invent earlier field choices that were never saved.

## Existing original receiving course

Use the maintained original operation under `operations/scf-statements-original-32c2-20261013/` and its original four input files, case, supplier invoice and account decisions. The worklist course runs inside the existing private recipient-review browser context before the first main CSV import.

Inspect the rendered worklist at desktop width and 390 pixels, including a second distinct return, independent notes and choices, switching and reload, stale-choice handling after a real draft edit, exact duplicate re-receiving, applied progress and complete archive recovery in empty browser storage. Preserve the original main-context CSV decisions and supplier invoice identity before continuing the original account course.

The existing [Accountant recipient review guide](STATEMENT_RECIPIENT_REVIEW.md) describes the offline colleague workflow and original native receiving. The [Working copies guide](STATEMENT_WORKING_COPIES.md) describes immutable editions and complete archive storage.
