# Colleague review of complete Flowable programme source

Use **Colleague source review** in the existing programme authoring desk when another engineer needs to edit a programme while the author continues working. The exchange carries the complete original model, catalogue, input and configuration sources. The author sees the issued baseline, current draft and returned proposal together, chooses each changed row, and then builds the resulting programme with the existing compiler.

Open the installed Flowable workspace and create, load or reopen a source programme. The review panel sits between **Programme configuration** and **Complete source inventory**. A colleague needs the same installed authoring desk; the command-line interface is documented in [SOURCE_REVIEW_CLI.md](SOURCE_REVIEW_CLI.md).

## 1. Issue the editable source

Expand **Issue the current source to a colleague**. Enter the review title, your name, the colleague's name and the requested changes. Select **Issue and download complete source**.

The desk first saves the current draft and then downloads a complete `.source-review.json` file. Send that file through your agreed delivery channel. It contains the source itself, so the colleague can open it independently.

The issued baseline remains fixed while you continue editing your current draft. Issuer, reviewer and adopting-engineer names are recorded attribution. They should identify the people doing the work.

Issuing a further round from a draft with an existing review opens a **separate saved local draft**. The previous draft keeps its original review, returns and decisions. Use **Refresh saved drafts** and **Reopen draft** to return to it. A clear review title and operation key help distinguish rounds.

## 2. Edit and return a complete proposal

In the colleague's authoring desk, create or reopen a source draft so that the review panel is available. Under **Edit an issued draft and return a proposal**, choose the received file with **Open an issued review as a separate draft**.

The desk opens the issued source with a new local draft identity. Edit the actual programme configuration and complete source members through the existing controls:

- Select **Open source** to inspect or edit a whole member.
- Add or remove complete source files, or use **Apply source path** for a renamed member.
- Review catalogue references, selected families, typed input paths and role identities after changing sources.
- For decision models, use **Update catalogue model identities** after editing the model bytes so that the catalogue identifies the current sources.

A path rename appears in review as a removed member and an added member. Check references in the catalogue and other source files when renaming.

Enter the reviewer name and a useful note describing the changes, then select **Save and download complete proposal**. Return the downloaded `.source-return.json` file to the author. It includes the issued baseline and the full proposed source.

A saved local reviewer draft can produce another explicit return later. Each return has its own identity, timestamp, attribution and source edition.

## 3. Compare with the author's current work

The author reopens the original local draft, including any work completed since issue. Under **Compare a returned proposal and choose changes**, open the colleague's file with **Open returned source proposal**. This stages the proposal alongside the current source.

If the packet includes several returns, select the intended **Returned edition**. Then select **Compare against my current draft**.

The comparison includes one row for every changed source path and one row for the complete programme configuration. Configuration includes the title, kind, operation, tenant, role identities, catalogue and family/input selections. Those options are selected together as a complete configuration edition.

| Comparison | What changed from the issued baseline |
| --- | --- |
| Returned changed | The colleague changed this row; the current author value still matches the baseline. |
| Current changed | The author changed this row; the returned value still matches the baseline. |
| Same change | Author and colleague reached the same changed value. |
| Conflict | Current and returned values differ from each other and from the baseline. |

Select **View all three editions** to inspect the complete issued, current and returned source text or configuration. An absent member is shown explicitly. Wide screens show the three editions side by side; narrow screens stack them.

Choose a disposition for **every changed row**, including current-only and identical changes:

| Choice | Result for that row |
| --- | --- |
| Keep current | Preserve the value currently in the author's draft. |
| Take returned | Use the colleague's returned value. |
| Use issued baseline | Restore the value from the original issue. |

Selecting an absent value removes that member. Selecting a present value can restore or add it. Unchanged rows keep their original current value.

Enter the adopting engineer and an adoption note, then select **Adopt explicitly selected changes**. The complete chosen draft and review history are saved together through the existing draft store. The current local author identity stays the same.

Editing source or configuration after comparison requires another comparison. The desk clears choices when the comparison basis changes, so a decision made against an earlier source or review history cannot silently apply to a later edition.

## 4. Compile and continue the existing programme workflow

After adoption, select **Build complete programme preview**. This runs the existing compiler for the selected BPMN process, CMMN case or DMN decision programme. Review the compiled steps, original sources and operation selections.

Correct any source, catalogue or configuration problem in the normal authoring controls and build a fresh preview. The colleague exchange preserves what was proposed and adopted, even if further author edits are needed.

Use **Download compiled programme** for an independent compiled file, or **Save programme for native review** to continue through the workspace's existing programme review and engine operation controls. Keep using the original workspace and native operation. Source comparison and adoption do not execute programme steps.

## Save, receive and recover complete work

The browser saves the complete current draft and its review together. That includes issue details, all retained exchanges, the exact incoming text, selected return, unfinished choices and notes.

Use **Download complete review working file** when transferring an in-progress review, changing computers, or retaining edits after a save error. It downloads the current in-memory draft and review, including unfinished choices. It remains available when another tab has changed the saved edition.

To continue elsewhere, create or reopen a source draft, then choose the file with **Reopen complete review working file**. It opens as a separate local draft and preserves the original issuing identity inside the exchange. Compare again before adoption; choices survive when the complete comparison basis is still the same.

The ordinary **Download complete draft** control carries only the editable programme source. Use the **complete review working file** when the receiver needs the review history and unfinished decisions as well.

If a concurrent-edit message appears, retain the complete review working file or select **Save a new copy**. Both preserve the current draft and review. **Reopen saved edition** restores the current stored edition after you have retained any unsaved work you need.

## Inspect complete historical source

Expand **Retained review history** and select a **Retained source edition**. The selector includes:

- The complete issued baseline.
- Each complete colleague return.
- The baseline, then-current author source, returned source and adopted result for every adoption.

Select **Download complete selected source branch**. Open the resulting `.source-draft.json` through **Reopen complete source-draft JSON** to inspect or edit that historical edition as a separate local draft. The active author draft and its newer history remain available.

**Download retained exchange** exports the complete content-addressed source pool, snapshots and history. Keep the untouched incoming return or complete working file when the exact received outer JSON representation is needed; a normalized exchange export can have different formatting.

## Complete-file limits

The existing source draft remains limited to 16 MiB and 500 complete UTF-8 text members. A complete exchange or review working state is limited to 64 MiB; the combined downloadable working file is limited to 80 MiB. A review that reaches its complete-history limit can continue as a separately issued round, retaining the preceding local draft and downloaded working file.

The desk reports oversized or invalid complete files without cutting source text. Repair invalid UTF-8 source text before compilation. Retained unfinished text stays visible for correction.

## Engineering integration

The browser, typed pure module and command line share `programme-source-review.mjs`. Review source is served by the maintained browser manifest and static routes. Draft persistence uses the existing workspace-scoped IndexedDB store and its revision comparison; draft and review update in the same transaction.

For command metadata, complete output recovery and the current owner-directed receiving instructions, see [SOURCE_REVIEW_CLI.md](SOURCE_REVIEW_CLI.md). Product receiving uses the original installed desk, original compiler and existing native owner.
