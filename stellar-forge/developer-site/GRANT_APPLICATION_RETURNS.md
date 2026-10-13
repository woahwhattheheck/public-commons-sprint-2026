# Returned editable SCF applications

This workflow lets the original application author issue a complete editable copy, continue their own work, and receive the colleague's returned answers and issuer form. It lives in **Prepare submission → Editable application returns** and uses the original application, source custody, saved-version history, and browser draft store.

The source includes the complete core, operator panel, unfinished-preparation state, existing-workspace integration, and one browser receiving course. Current authored manuscript, budget, native plans, product declarations and prepared submissions remain under their existing controls.

## Issue a complete editable copy

Open the actual original saved application. Read the current answers and issuer form before issuing it. In Editable application returns, enter a copy label, colleague or team, and instructions, then choose **Save and issue editable copy**. This is an explicit save to the selected original browser record using its current expected revision. A concurrent save is preserved by the existing conflict response. The download begins after the issued baseline is saved.

The issued JSON contains the complete original application and its source files. Its association identifies the issuing application and its exact saved baseline. The colleague opens it using **Open draft file** and receives a separate browser-native record when they save. No exported file selects a saved browser record from another machine.

The issued-copy history also offers **Download issued offline editor**. That file embeds the same actual editor dependency closure and issued draft. It opens without source-network access, provides the ordinary answer/form controls, and downloads a complete returned application. Reopening an issued copy reconstructs its original edition; it does not substitute the author's later work.

## Edit and return

The colleague edits ordinary answers, answer notes, application title and recorded issuer form fields. They can save a version locally and download the full draft, or use **Download complete returned application** in the returns view. Both carry the original issued-copy association.

A complete working export can also be selected by the original author when its contained native application is valid. Unfinished issuer limits and other incomplete values remain in their original working file; finish those controls or download a valid full draft before applying a return.

Source acquisition, native planning, product declarations, requirements approvals and prepared handover authority have their existing dedicated workflows. A return that changes those records reports their exact differences and requires their original source workflow to resolve them. The author retains the complete returned file while deciding how to handle such changes. Accepting a separate source or plan does not rewrite the original issued baseline. After handling those changes, use a corrected answer-and-form return against that baseline, or issue a fresh copy from the updated author application.

## Compare all three editable versions

In the original author's application, choose the returned JSON under **Receive a colleague's application**. This retains the exact incoming UTF-8 text, filename and later choices in the existing complete working copy. It does not change the current answers.

Choose **Preview returned changes** to compare:

- The issued baseline.
- The author's current application, including later edits.
- The colleague's returned application.

The comparison covers all nine answer texts and working notes, title, complete issuer form metadata, whole form-field records, field additions/removals and exact field order. Whole field records preserve prompts, limits, character-count method, selected source answers and field-source review material together.

For a differing current/returned value, choose **Keep current author value** or **Use returned value**. Conflicting rows open with all three complete values visible. The two bulk-choice buttons are explicit operator actions and can be followed by individual changes. Values that both authors changed identically already agree.

Field membership and field order must describe the same final set. If choices would remove a field while retaining it in the selected order, the original core explains the inconsistent choice and leaves the current application intact. Revise the field and order choices, then accept again.

Enter the reviewing author and an acceptance note, then choose **Save chosen changes to original draft**. The selected values, original branches, original issue, choices and review are saved together through the original native revision check. No issuer submission or prepared-handover action is performed by accepting an editable return.

## Keep work across reload and concurrent saves

The complete working copy retains the incoming file, comparison identity, individual choices and unfinished review text. Reload reopens that work. **Preview returned changes** recomputes the comparison against the current author application. If the author version changed, earlier choices are invalidated for a fresh decision; they cannot silently apply against a different basis.

The complete working JSON and offline editor also retain the pending original return. A portable working file clears browser-native writer references under the existing working-copy rules. Opening it cannot target another machine's same-named record. To accept a return in the original saved author application, open that original record and receive the original returned file.

Another tab's save remains protected by the original compare-and-save revision. When that check reports a conflict, retain the complete working file, open the actual current saved author record, and compare the same return there. The return core verifies the issued application and comparison basis again before constructing any successor.

After a successful acceptance, the immutable original return identity prevents a repeated acceptance from silently creating a second outcome. The retained history supplies the original result after an interrupted browser return. The original browser store and saved application remain the only native authority.

## Complete branch and source history

The author retains an append-only issue/acceptance history and complete branch snapshots. Original immutable application text, planning bytes and handover objects remain once in the existing source arrays. Each snapshot binds the exact original source identities and the preceding application-return history; hydrating a branch restores the full native application without recursively copying all earlier return histories.

An accepted return offers ordinary complete draft downloads for the issued baseline, author before acceptance, returned application and accepted result. Open these files in the original editor to inspect their exact answers, source selection, versions and preserved history. Later edits to the author application do not rewrite these retained branches.

The latest selected incoming file remains verbatim in the complete working copy. Its original byte count and SHA-256 are also recorded in the accepted history. **Download original returned file** preserves the original JSON text, including whitespace, key order and any working-envelope metadata. Download this file or its complete working export before selecting a following return when the original transport bytes are needed later.

The four historical branch downloads reconstruct complete logical native applications and exact source/file bytes. Each regenerated export receives its own ordinary native envelope and hash; it is not a byte-identical copy of the original uploaded JSON. Accepting another return preserves the earlier four native branches and raw-file identity.

The original native 16 MiB limit remains in Save/Prepare/export. Complete unfinished preparation retains its original 64 MiB allowance. The workflow shares source bytes instead of embedding several repeated multi-megabyte reviewer bundles in every acceptance. If the logical native history reaches the existing limit, the operation leaves the selected application unchanged and retains its original returned file for a separate complete working export.

## Source and native integration

The public and installed application use the same modules:

- dist/grant-application-return.mjs: complete issued/current/returned comparison, branch custody, exact history verification and explicit application.
- dist/grant-application-return-working.mjs: complete pending-file and decision snapshot validation.
- dist/grant-application-return-workspace.mjs: original author/colleague controls and branch downloads.
- dist/grant-submission-core.mjs and grant-handover-source.mjs: original shape and complete-source validation joins.
- dist/grant-handover-core.mjs: prepared snapshots keep application-return custody in their original parent instead of recursively embedding it.
- Existing workspace, working-copy module, page, stylesheet, route composer, browser manifest and grant-reviewer declaration: the same active application and original save paths.
- GRANT_APPLICATION_RETURNS_BROWSER.mjs: the actual complete browser receiving continuation.

The core exports createIssue, compareReturned, applyReturned, listApplicationReturns, issuedDraftFor, exportApplicationReturnBranch, validateApplicationReturns and verifyApplicationReturns. No second database, sender, issuer client, browser controller or background process is introduced.

## Continue the original receiving course

The original 22B7/81CF owner supplies its already-open browser Page, served application URL, selected saved draft and owned output directory to receiveApplicationReturns. This is a new product step in the same operating session, after receiving the complete merged successor and preserving the current application/source boundary.

The function opens the actual original saved application, records it, creates a separately named internal exercise through the normal **Save as separate draft** control, and runs the entire issue/download/offline-edit/return/conflict-choice/save path. The original application is compared at the end and remains unchanged. The internal exercise uses the actual manuscript and source rather than a replacement dataset.

It opens the issued HTML in another tab of that same browser, makes minimal explicit internal answer edits, downloads the actual returned file, preserves a later author edit, reloads pending choices, and accepts through the original author record and expected revision. It downloads all four complete branches, opens each in the real editor, and captures desktop/narrow views plus the exact downloaded files.

Return the actual source edition, original receiving operation, browser/process identity, complete result directory and viewable images to the same publisher/native thread. The producing source owner must personally view the rendered images and use every outgoing attachment. Repair the first concrete defect in this same source. The programme records screenshots as awaiting inspection until that actual observation occurs.

### Resume the same author and colleague exercise

Keep the original browser profile, served source edition, `draftId`, output directory and receiving controller. Call the same exported function again with the same four arguments:

```js
import { receiveApplicationReturns } from './GRANT_APPLICATION_RETURNS_BROWSER.mjs';
const result = await receiveApplicationReturns({
  page, baseUrl, draftId, directory,
});
```

The caller continues to own the existing browser and exclusive native operation. The helper binds the served application URL and original saved record before creating its internal exercise. It retains the original saved application, complete working input and measured runtime files. An explicit source upgrade belongs at a following reviewed source boundary; it cannot silently replace an incomplete exercise.

Thirteen immutable stages carry the complete original record, separate-copy candidate, issued baseline and files, later author edit, colleague return, complete pending review, selected acceptance and four reopened branches. Each ordinary download or rendered image lives in its own attempt directory. Repeating a completed step reads its retained files and identities; it does not replace those files with a fresh export.

Before the first **Save as separate draft**, the helper saves a unique internal exercise label and the complete original candidate. If the browser saved successfully but the process lost its response, continuation locates that exact saved copy and reconstructs the complete original save from its actual saved time and identity. It does not create another exercise merely because a receipt is absent. The issue, author Save and accepted-return steps similarly retain their complete candidates first, then compare the original saved revision and entire application against the original product functions using the actual recorded issue/adoption identity and time.

An unchanged preceding record permits its original UI action. An already-saved exact successor resumes from that result. A different saved successor preserves the current work and reports the exact mismatched stage instead of overwriting it. Complete working checkpoints reopen through the existing working-copy importer with their original native expected revision; ordinary portable colleague files continue to clear writer references through the maintained editor.

Each cold branch import waits for the original editor to install a new working identity and finish its file operation. The helper then downloads that complete reopened draft and compares every native field with the selected original branch before recording its screen.

The final `application-return-result.json` binds all stage files, full downloads and actual screenshots. Reopening a completed result verifies those complete files before returning it. Keep the entire directory with the browser profile and application source. Do not copy only the final result or remove an earlier attempt. The previous unjournaled helper's output is historical source: this successor will not interpret an unrelated or differently bound result as one of its completed stages.

An operated result retains `OPERATED_AWAITING_PIXEL_INSPECTION` until the producing peer actually views the desktop/narrow images and opens every complete attachment in its normal receiving application. Continue the existing original receiving and durable saved-case operation with that actual observation.

## Standing owner instruction

The complete owner-controlled instruction read for this source is reproduced below. Its dated Ecosystem cutoff applies to that original sprint; it does not create a new SCF deadline.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


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

