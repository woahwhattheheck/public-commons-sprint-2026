# Prepare the existing SCF submission

Open **Prepare submission** in the primary navigation of the existing application reader, or open **/grant-submission.html** on the same installed Site. The workspace uses the same complete application and source index as the reader.

The editor carries nine canonical answers through actual issuer-field preparation, whole-answer copying, saved editorial review, source updates and complete draft receiving. The original application/source composer and submission owner remain the publishing and issuer-form owners.

## Open the current source

The workspace reads grant-data/application.md and grant-data/source-index.json from its own host. It receives the complete UTF-8 application, checks its original byte count, SHA-256 and Git blob identity, then opens all nine answers in their existing order.

The first source edition remains in the draft. **Read current source** acquires the current reader edition again. Under **Source editions**, compare each changed answer with its earlier baseline and current draft. **Receive source and keep edited answers** updates untouched answers and preserves manually edited ones. Those edits retain their exact original source baseline.

**Use current source for this answer** deliberately replaces the selected draft answer. The complete preceding state is retained in Saved versions. All original source editions remain available for reading and individual Markdown download.

A source/index mismatch leaves the working draft open. Read the current source again after the original composer finishes publishing its same edition.

## Edit the complete answers

Choose one of the nine answers in the sidebar. Edit its full text and, if useful, add a working note. The preview shows the exact text selected for copying.

Choose **Plain text** or **Markdown** at the top. The plain-text conversion retains the answer content and source URLs, turns tables into labeled rows, and removes Markdown presentation markers. **Copy current answer**, **Copy all answers**, the text download and the print packet use the selected format. Working notes stay in the full draft; answer exports contain the selected answer text.

Counts describe that exact output:

| Count | Definition |
| --- | --- |
| Words | Nonempty whitespace-separated units. |
| Unicode characters | Unicode code points, including spaces and line breaks. |
| UTF-16 units | JavaScript string length; some characters occupy two units. |
| UTF-8 bytes | Bytes required to encode the copied text as UTF-8. |

The workspace displays these counts without assuming an issuer counting convention. A recorded field limit is compared with the selected output and the actual convention chosen for that field.

## Map the actual issuer form

Open **Issuer form fields** and expand **Issuer form and source**. Record the actual form name, URL, observation date and instructions. **Open recorded issuer form** opens that HTTPS location in another browser tab.

The nine canonical headings describe the maintained manuscript. Record the labels, full prompts and limits from the actual issuer form when preparing its fields. Leave limits empty where the form supplies none.

Create a field directly or use **Create a form field from this answer**. One field can select several canonical answers. **Refresh text from selected answers** composes the current selected answers into its editable field text and retains the preceding full version. Further field edits remain independent until another explicit refresh.

Each field keeps its own optional source URL and observation date, word limit, character limit and character-count convention. A field can inherit the form-level source and date. Incomplete issuer metadata remains editable and travels with the draft. The field view identifies missing metadata, unfinished answers and values above recorded limits.

Move fields into the issuer's order. Removing a field retains its preceding version. **Copy all form fields**, the answer-text download and the print packet follow that same order.

**Download form map** retains the exact form profile, field prompts, limits, selected answer IDs and field text. Opening that map in another working draft retains the prior mapping before importing the selected one.

## Use the original SF47 budget and delivery plan

Open **Planning edition** in the submission editor. **Receive native plan or planning ZIP** accepts either:

- The complete planning ZIP exported by the original SF47 workspace, including every saved plan revision, its exact original scenario file and the native manifest.
- One complete saved plan JSON from the native CLI's `show --part all` output. This carries the selected revision, full scenario, planning inputs and original calculation.

The original Grant Operations case export contains its complete planning export as `planning.zip`. Select that member when receiving a case's plan. The complete operations case remains in Grant Operations.

From the repository, the existing native commands are:

```sh
python stellar/scf_2026/sf47_budget_model/workspace/cli.py show \
  --workspace /private/original-planning-workspace \
  --plan ORIGINAL_PLAN_ID --part all \
  --output /private/receiving/plan.json

python stellar/scf_2026/sf47_budget_model/workspace/cli.py export \
  --workspace /private/original-planning-workspace \
  --plan ORIGINAL_PLAN_ID --expected-revision CURRENT_SAVED_REVISION \
  --output /private/receiving/planning.zip
```

Use the original saved plan ID and revision shown by that workspace. The original commands publish to a new output filename. If using the original browser workspace, its native ZIP export carries the same complete planning edition.

Receiving retains the exact file bytes, filename, SHA-256 and native revisions in the submission draft. ZIP receiving reads all eleven native entries, verifies their original manifest and source identities, and receives the matching current projections and revision history. Full JSON receiving verifies the saved scenario/planning content identity and its native calculation reference. The native calculator remains the source of the budget, conditional payments, cash requirement and contributor allocation.

Select a retained file and revision. The editor shows the requested award, complete priced packages, work windows, completion measures and three tranche groups. Expand **Conditional payment schedule and native cash requirement** to inspect the original four payment amounts, conditions, modeled payment days and working-capital input. The delivery cost of each tranche and the conditional payment schedule remain separate values.

Use all original packages for the complete canonical **Delivery** answer. A selected subset can prepare an individual issuer field. Change prices, hours, scope or modeled dates in the original native workspace, save the new plan revision, then receive that complete edition here.

**Prepare preview from selected native plan** builds a self-contained budget and roadmap: the requested award or selected package total, estimated hours, timing, each full deliverable and completion assessment, exact package prices, and the original conditional payment allocation. Edit the preview as needed. A changed package selection requires a fresh preview for that selection.

Choose the canonical **Delivery** answer, an existing issuer field, or a new issuer field. Choose whether to replace its text or append to it. Expand the complete target preview to read exactly what will result; an existing issuer field also shows its recorded limits. Review the preview and press **Apply reviewed plan to draft**. The previous full submission version is retained. A new field opens in the existing field editor so its actual issuer label, prompt and limits can be recorded.

Review **Project** and **Delivery capacity** alongside a revised budget to keep the requested award, schedule and funding assumptions consistent across the full application. The existing required-content review connects these answers. Applying a planning preview is an editorial change to the selected draft target.

**Save version**, browser reopening, complete draft download/import and source refresh retain every received planning file and the selected review. Receiving a later application source preserves the applied Delivery text as an edited answer with its original manuscript baseline. Restoring an earlier version restores that version's planning selection, notes, preview and application history; every original planning file remains available. A version from before planning reception can be restored with no selected plan, and the retained files can then be selected again.

The complete draft uses the existing 16 MiB logical allowance. Receiving checks the complete candidate draft before replacing the current editor state. Each original planning file is stored once per draft; saved editorial versions refer to its retained identity. Original file downloads reproduce the received JSON or ZIP bytes.

## Review a later revision against the edited submission

When the same native plan changes, receive its next complete JSON or planning ZIP through **Planning edition**. The original file is retained before the editor opens **Review incoming native plan revision**. The selected plan, edited Delivery answer and issuer fields stay in their current working state until the revision choices are applied.

A previously received file can also be selected through **Review another retained revision of this native plan**. Both original file identities and both selected native revision identities are displayed. The comparison uses the exact saved native plans, including their original calculations. It supports a later numbered revision, an earlier retained revision, and explicitly selected files containing different content under the same revision number. Shared history identities remain visible so the operator can recognize those different source histories.

### Compare the full scope and resulting answers

The comparison contains:

- Requested award, estimated hours, project completion day and package count.
- Every changed, added or removed work package, with its original and incoming price, scope, tranche, work window, effort and completion assessment.
- All three tranche deliverables, prices, submission days, completion measures and planning notes.
- The four conditional payment allocations and changed conditions or modeled payment dates.
- Native planning-input changes and both complete cash and contributor-capacity calculations.
- The canonical Delivery answer and each existing issuer field that includes Delivery or has received a native planning preview.
- The current Project and Delivery capacity answers, available beside the revised award and schedule.

Each target retains its own applied-plan baseline. A field that deliberately keeps an earlier edition continues to reference that earlier original plan when a later update is reviewed. Removing an issuer field preserves its earlier complete state in Saved versions; a later comparison includes the fields that still exist in the working draft.

New plan applications record the complete resulting target text and the exact native scope used to generate it. Earlier drafts remain readable. A legacy replacement application supplies its exact applied text as a baseline. Where a legacy appended field has no complete target baseline, the editor shows its full current text and incoming scope for explicit selection or editing.

### Choose the exact full text

For every target, read the complete compared text and select one of these choices:

| Choice | Result |
| --- | --- |
| Keep current edited answer | Retain that target's current text and original plan baseline. |
| Use incoming native scope | Replace that target with the selected incoming native scope. |
| Use proposed combined answer | Carry independent native changes and editorial changes into one full answer. This choice is available when the changes can be combined without an overlap. |
| Edit and use complete proposed answer | Edit the full proposed text, including any overlapping changes, then use that exact answer. |

Combination happens in two stages: edits made to the originally applied planning text are compared with the revised native scope; later edits to the working target are then carried forward against its applied baseline. Changes to different lines can be combined. Overlapping changes remain visible with both source texts and the complete editable proposal. The editor performs no text rewrite merely because a file was received.

The complete resulting answer is visible beneath each choice. Its word and character counts follow the existing output format. Issuer fields also display the actual recorded prompts, limits and counting convention through the maintained field review. The selected work-package scope travels with each target. A field containing a selected subset receives that subset's surviving package identities; a full-plan target includes newly added native packages. Removed selected scope is shown explicitly.

Use the related Project and Delivery capacity links to reconcile the requested amount, time frame and funding assumptions in those original answers. Returning to the planning comparison preserves its draft choices. **Refresh comparison against current draft** incorporates the latest target text and form context; unchanged choices carry forward, while changed target inputs require a current selection. The preceding complete review remains in Saved versions.

After reviewing the selected full answers and related application context, choose **Apply reviewed revision choices**. The editor retains the whole preceding submission version, applies the selected text decisions, and selects the reviewed incoming native plan. A target kept on its earlier text retains that original baseline. The review records all resulting full answers and choices.

**Keep current plan and close review** retains the current plan and all current target text. The incoming file and the completed keep decision remain available for a later comparison.

### Save and continue the same application

Use the existing **Save version**, **Download full draft**, **Open draft file** and **Browser drafts** controls. The ordinary complete export now includes the selected planning revision, current target baselines, pending or completed revision choices, every original planning file and all earlier versions. The original draft schema and IndexedDB revision check remain in use.

Restoring an earlier saved version restores its plan selection, target baselines and revision review together with its answers, issuer mapping and other review state. All received source files remain available. A version from before this capability opens with no target bindings or update review and can receive an original native plan normally.

**Download complete comparison and decisions** produces a separate full JSON report containing both selected native plans and calculations, their source identities, package/tranche/payment changes, each complete text alternative, notes and choices, and the current target text. Use the full submission export to continue editing with the complete original files and draft history.

A comparison is checked against the current planning selection, answer text, issuer-field instructions and related Project/Delivery capacity text before applying. If those inputs changed while the review was open, refresh it and review the current choices. The existing draft's logical size limit is checked on the complete candidate; a receiving or save error keeps the current working draft available.

### Source and receiving integration

The maintained submission asset registration includes /grant-plan-update-core.mjs and /grant-plan-update-workspace.mjs. Publish them with the existing complete source edition. The original plan calculator, native case amendment, manuscript composer and Page publication remain their existing components.

The exported model functions in grant-plan-update-core.mjs operate on the same complete draft:

- selectPlanningRevision selects a first or different native plan, or opens a same-plan revision review.
- beginPlanningUpdate starts a comparison from the retained original sources.
- choosePlanningUpdate retains a target's keep, incoming, combined or custom text decision.
- refreshPlanningUpdate updates the comparison against current edited inputs.
- planningUpdateReviewBasis identifies the exact current set of text choices reviewed by the operator.
- finishPlanningUpdate applies the reviewed choices or retains the current plan.
- exportPlanningUpdate returns the complete comparison and decision report.

The caller retains a full version before a transition and validates the resulting complete draft through the existing grant-submission-core.mjs. The browser already makes those calls. Existing full-export verification checks each original plan file when the same working draft is received again.

For the original equipped reviewer Page, continue with the same edited application. Receive the next actual saved revision of its selected native plan, review the original package and answer changes, resolve the affected targets, and retain the full export before reopening that file and the saved browser draft. Restore the preceding version through **Saved versions** to continue either editorial state. Use the saved original plan revisions and their native calculations as the inputs to this journey.


## Review the required content

**Required content** connects the nine answers to the issuer's current published criteria. Record an editorial status and a precise note locating the supporting content. The status is the operator's review decision.

The current criteria require a complete, self-contained application, demonstrated need or use, a technical Stellar architecture, a team and plan ready to build, eligible development costs, three priced deliverable tranches ending in mainnet, and second-tranche threat modeling and monitoring. Eligibility and track-specific conditions remain part of the applicant's actual form review.

The criteria links, original source answers and saved notes remain available together. The workspace does not turn a text match or a checked status into an issuer decision.

## Save, copy and receive the complete working draft

**Save version** writes to the original Stellar Forge IndexedDB draft store. It retains the complete answers, field mapping and review notes as a named version, together with every original source edition.

A browser record has its own optimistic revision. If another tab saves a newer record, the existing store rejects an overwrite. Reopen its latest browser draft or use **Save as separate draft** to retain the current work independently.

Before opening another draft, the workspace preserves unsaved current work. If another tab has advanced that record, preservation saves a separate browser record through the same original store. A storage failure keeps the working draft available for downloading.

**Download full draft** exports:

- The complete current working answers and notes.
- All original source Markdown, byte counts and source identities.
- The issuer profile, prompts, field limits, answer selections and field text.
- The saved required-content review.
- Every retained working version and its selected source edition.
- Every received native planning file, its complete saved revisions, selected packages, editorial preview, application history, target baselines and pending or completed revision choices.
- A SHA-256 over the full draft body.

**Open draft file** reads the complete export, checks its body and every original source edition, and preserves the current working draft before opening it. Save the received draft in that browser to continue. **Saved versions** can restore an earlier working state; the state being replaced is also retained.

The logical draft allowance is 16 MiB. Complete draft exports use compact JSON, so every accepted draft fits the encoded receiver allowance. A version save that exceeds the logical allowance leaves the current working draft unchanged in memory. If an unsaved answer itself makes the draft too large, copy that answer text before reducing the oversized addition. Preserve a complete draft at normal save points.

## Compose and publish through the same source

The existing grant-compose.mjs imports attachGrantSubmission from grant-submission.mjs. After composing the current nine answers and companion, it adds the submission navigation entry and source-index descriptor. Repeated composition preserves one entry and the same application source identity.

Continue using the existing composer options, selected product commits and source-pins output. The submission workspace reads the updated application edition on its next source refresh. It does not require an additional copy of the manuscript or a separate submission-data file.

The existing registerGrantSubmissionAssets function declares the complete submission routes:

- /grant-submission.html
- /grant-submission.css
- /grant-submission-core.mjs
- /grant-submission-workspace.mjs
- /grant-plan-core.mjs
- /grant-plan-source.mjs
- /grant-plan-workspace.mjs
- /grant-plan-update-core.mjs
- /grant-plan-update-workspace.mjs

The original /drafts.mjs and application/source-index routes remain its dependencies. Publish the complete existing dist directory through the original Site project and retain its current audience. The static browser carries its own working drafts; the established application and issuer-form workflow carry the submitted edition.

For an equipped receiving operator, exercise the whole real workflow on the original host: open the nine current answers, edit one, map the actual available issuer fields, save a version, copy and download the whole selected answer text, export the complete draft, reopen it in a separate browser record, receive a later original source edition, and restore the earlier version. Confirm that edited answers, source baselines, field mappings and notes remain available through the receiving.

## Primary issuer sources

Reviewed October 12, 2026:

- [Build submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria).
- [Budget and deliverable guidance](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines).
- [Official rules for submissions](https://stellar.gitbook.io/scf-handbook/scf-awards/official-rules-for-submissions).
- [SCF #46 round](https://communityfund.stellar.org/awards/recxrSMYwAl8vcglg), listing the November 8, 2026 full Build deadline and the interest-to-invitation route.

## Continue the original browser receiving with its existing Page

The installed receiving operator imports `receiveGrantPlanning` from `GRANT_PLANNING_RECEIVING.mjs` alongside the existing grant callback. Pass the original Playwright Page while it is on the installed `/grant.html` reader or the retained `/grant-submission.html` editor, the exact original planning file and SHA-256, the selected installed source commit, and the operation's private output directory:

```js
import {receiveGrantPlanning} from './GRANT_PLANNING_RECEIVING.mjs';

const result = await receiveGrantPlanning(page, {
  expectedOrigin: existingGrantOrigin,
  planningFile: originalPlanningZip,
  planningSha256: originalPlanningSha256,
  outputDirectory: privatePlanningDeliveryDirectory,
  sourceCommit: installedSourceCommit,
  operationId: 'SCF-PLAN-SUBMISSION-INTEGRATION-7F5A-20261012',
  title: 'SCF native plan — $38,000 / 400 hours',
});
```

Use the original `SCF-GRANT-REVIEWER-PUBLICATION-8910-20261012` receiving context and continue the same output directory. Each call uses the Page and listener already owned by that receiver. The callback compares the complete current submission and handover asset routes, including the original draft store, with their installed files.

The first invocation retains its original manuscript draft identity, receives the actual native plan and selects the current saved revision from that original file. When selecting it opens the incoming-plan review, the continuation uses the complete incoming native scope for Delivery and keeps every existing issuer field. It verifies the selected source and native revision before accepting those explicit choices. When the current native revision is already selected, it prepares and applies the ordinary full Delivery preview. The complete current draft is retained before either flow. It publishes the accepted complete draft and native roadmap before saving or beginning the subsequent reopen phases. The same original browser store then carries its saved draft and later revisions.

### Resume a retained operation

Repeat the same call with the original operation ID, planning file identity, title and output directory. The source file and output directory may be moved together to another equipped installation. The callback retains the selected file's exact bytes in `selected-input/` and uses that retained copy for native file intake. It checks that copy against the original input identity on every continuation. Select that installation's actual listener and source commit; the journal retains the original input/source selection and each subsequent installed source edition separately.

The continuation first reads its accepted files. An existing `SCF_Native_Plan_Submission.json` supplies the draft identity and complete original planning source. Intake and plan application resume only when the original delivery has not yet been accepted. If the earlier callback saved in IndexedDB and stopped before its full export, the continuation can recover a complete saved record with the same original title and planning file. It retains the matching browser records before selecting that saved working edition. Until a native browser record is bound, more than one matching record leaves the selection unresolved. Open the intended record through **Browser drafts** and repeat the same callback from that editor. The visible editor carries its actual saved record ID and revision; the callback reads and verifies the full record through the original draft store before retaining that choice. A missing bound record stays unresolved instead of selecting another copy with the same logical draft ID.

The accepted full draft must have a current planning review for the selected source, the exact selected preview basis, and the same reviewed replacement text in its current Delivery answer. An application retained only in an earlier version does not establish that current answer. If the accepted export is missing and later answer or review edits prevent that match, the callback retains the complete working and browser snapshots and leaves the original delivery unresolved. Open the exact accepted version, or explicitly review and apply the intended current Delivery in the original editor, before continuing. An already retained accepted export remains separate from later editorial work.

An interrupted call leaves the existing editor open and retains its complete working draft. On resumption, the callback verifies that open draft belongs to the same operation before navigating or opening another file. Successful completion returns the Page to its original reader and scroll position.

The remaining phases are explicit:

| Phase | Retained work |
| --- | --- |
| Original manuscript | The exact initial working draft and its original identity. |
| Delivery exported | Complete accepted draft, native planning file and exact applied roadmap. |
| Browser saved | Original IndexedDB record identity, revision and browser origin. |
| Full export reopened | The complete accepted draft received back through the original editor. |
| Original version restored | Its preceding manuscript, planning selection and handover selection, with every original file retained. |
| Browser reopened | The saved original browser record and its current editorial state. |
| Reader restored | The receiving Page returned to its original reader URL and scroll position. |

A phase's accepted export is read and verified before a retry repeats any browser action. Version restoration selects the retained version ID displayed by the editor. A later browser save is opened through its actual record and revision; the callback keeps its full newer answers, fields, notes, source selections and versions. The accepted native-plan delivery stays available beside that later editorial state.

The callback preserves complete matching browser revisions in `browser-snapshots/`. It uses the maintained `listDrafts` and `loadDraft` functions for those reads. When the selected browser has no saved copy yet, it receives the accepted draft and saves it through the existing editor. A retry recovers an already accepted browser save before issuing another save. The save phase requires the accepted full state in the actual record, one of its retained versions, or a verified earlier snapshot of that same saved record. A record containing only the prepared manuscript does not complete that phase. If the original editor still holds the accepted working state with the same record ID and revision, **Save version** finishes through the native revision check. If that live binding is gone, the callback retains the complete files and reports the unfinished save for an explicit receiving decision; the ordinary **Open draft file** control creates a separate working copy and is not treated as an update to a bound record.

### Receive the useful complete files

| File | Purpose |
| --- | --- |
| `SCF_Native_Plan_Submission.json` | The accepted complete editable draft with all source files, native plan revisions, answers, notes and versions. |
| `SCF_Native_Plan_Delivery.md` | The exact native budget and roadmap text that was applied. |
| `Reopened_Full_Submission.json` | The accepted full export received back through the editor. |
| `Restored_Previous_Submission.json` | The actual preceding manuscript restored through the editor. |
| `Reopened_Browser_Submission.json` | The original saved browser draft, including later editorial work present when it is reopened. |
| `Prepared_Source_Draft.json` | The original manuscript and draft identity retained before first native intake. |
| `selected-input/` | The exact selected native planning bytes used by the original file chooser. |
| `Planning_Delivery_Intent.json` | Fixed operation, planning bytes and input intent. |
| `Planning_Delivery_Journal.json` | Current named phases, accepted artifacts, installed editions and saved browser records. |
| `Planning_Delivery_Result.json` | The latest actual attempt result, updated atomically as the same operation continues. |
| `Planning_Delivery_Complete.json` | The first complete result, retained unchanged on subsequent calls. |
| `attempts/` | Each actual attempt and any complete interrupted editor draft; the earlier callback's result is retained here during adoption. |
| `browser-snapshots/` | Complete original saved browser revisions, including later edits encountered during receiving. |

An interrupted callback returns its actual phase and files on `error.result`. Repeating the original call continues that same operation. Its latest status can move from interrupted to complete, while completed delivery files and earlier attempts retain their original bytes. After completion, another identical call verifies and returns the saved completion with `reused: true`.

The original saved five-revision case used for this delivery is `plan-93b727c8a44346bab4f923e60481e020`. Its complete planning ZIP is 96,869 bytes with SHA-256 `2fcc813903a1fbd66532c0a3a17ed07d250f04d3e856f8a4c5dc84309a10e086`. It is the `planning.zip` member of the retained original `SCF_Operating_Case_with_Freeform_Event_Timing_20261012.zip` (647,130 bytes; SHA-256 `c71303844660d5a859d3936a569b5461c7b1679b739dfead95d907759693df2b`). Other actual saved native plans use their own selected file identities.
