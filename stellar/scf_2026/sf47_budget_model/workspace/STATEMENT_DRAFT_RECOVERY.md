# Statement draft recovery

Use **Accounts → Statements** to continue an unfinished bank statement in the current case. The automatic draft keeps the complete source, interpretation and work in progress for the selected Staff identity in this browser. Named **Statement working copies** retain separate immutable editions.

## When another tab has changed the draft

An automatic save compares the full draft last read by this tab with the current shared draft. The comparison and save run in one IndexedDB read/write transaction. A changed shared draft is not replaced.

When they differ, the desk retains a complete recovery record containing both this tab's work and the shared saved work. It records the pair and its recovery index together. This includes original bank bytes, account and interpretation, row decisions, unfinished allocations and any original request or response. The comparison concerns the full working draft, so even a change to an unfinished mapping or a retained request is meaningful.

Under **Statement drafts in this browser**, open **Compare with shared draft** and inspect the two versions before choosing what to continue. Check the original filename and account, source interpretation, decisions and unfinished allocations, and especially any retained import or setup request.

| Choice | Result |
| --- | --- |
| Preserve this tab and open shared draft | Retains the complete pair and opens the exact shared draft reviewed in the comparison. |
| Preserve shared draft and continue this tab | Retains the complete pair and continues this tab's draft only when neither version has an unresolved import, accepted response or setup request. |

Each choice rechecks the exact shared draft in an atomic transaction. If another tab has saved again, review the new comparison. The earlier complete recovery pair remains available.

A recovery choice selects a whole working draft. It does not merge bank rows, replace an invoice, record cash or change an existing request identity. After opening editable work, inspect its original inputs and obtain a current native preview before another import.

## Original requests take priority

A retained import contains its original request ID, actor, expected case version, complete input and expected preview identity. An accepted response also carries the actual native result. A setup request retains its original setup action and response when one has arrived.

Keep those complete records together. Use **Resume original import** for a retained import and **Read saved case** for its accepted response. Setup requests use their existing setup recovery controls. Resume through the existing original request controls under the permitted Staff identity. The desk must retain the exact request before sending it. When the service has already accepted it, the original readback reconciles that result with the case's recorded sources and cash before preparation continues.

Changing tabs or importing a recovery archive does not authorize a new statement receive request. The complete original request is the recovery unit. Do not clear a request by opening a different bank file, changing its request ID or copying its rows into another import.

If one version has an unresolved request, **Preserve shared draft and continue this tab** is unavailable. **Preserve this tab and open shared draft** retains the local request as part of the complete pair and selects the current shared work. Reconcile the shared original request first. If the retained local request is still the work to recover afterward, inspect its retained pair and open its exact local snapshot through the original recovery reader. The original service replay/readback determines whether that request has already completed.

## Keep all recovery records

Select **Download complete tab recovery archive** to save `statement-tab-recovery-archive.json`. It carries this tab’s complete current draft and every retained immutable conflict pair for this case, with their complete source bytes and request states. This tab’s draft may differ from the shared saved draft; the complete compared shared version travels in its retained pair. Keep the archive privately with the corresponding original case.

**Download this tab** saves `statement-recovery.json`. **Download compared shared draft** saves the exact shared version currently displayed. In **Inspect retained pair**, **Download retained local draft** and **Download retained shared draft** save the complete respective original snapshots. The on-screen comparison suppresses long encoded bank-byte strings for readability; the downloads retain the full bytes.

Select **Open tab recovery archive** to receive a complete archive up to 256 MiB. It adds missing records and retains the archive’s current draft as a selectable recovery record. The active draft and its requests stay selected. A repeated identical record is reused. A different record with the same identity rejects the whole import, so it cannot rewrite an earlier recovery pair.

Choose **Inspect retained pair**, inspect both original sources and request states, then **Open retained local draft** when the current shared-draft conflict and current request are resolved. This uses the original recovery reader, retaining the current sourced work as a named immutable edition before opening the selected local snapshot. A retained shared snapshot can be downloaded and opened through the original recovery-file control. An editable recovery needs a fresh native preview; a retained request uses its original resume/readback control.

The recovery index retains up to 10,000 complete records and does not remove records automatically. Keep complete archives as work progresses. The original source-file limit remains 8 MiB; an individual complete recovery file can be up to 64 MiB.

The archive belongs to the original case and the intended Staff/browser working context. Reopen the retained case before receiving it. The original Staff request checks still govern any pending request. Importing an archive does not make another Staff member the actor on that request.

These files carry financial source data and unfinished preparation. Use the same private handling as for the bank file and statement working-copy archives.

## Automatic draft, named editions and recorded case

| Material | What it preserves | How to carry it |
| --- | --- | --- |
| Current automatic draft | This Staff member's complete unfinished Statements work for the case | Statements recovery controls |
| Tab-recovery archive | This tab’s complete current draft plus all retained immutable local/shared conflict pairs | Complete tab-recovery download |
| Named working-copy archive | All immutable saved editions of named statement copies | **Download all complete copies** |
| Native case archive | Recorded case sources, original receipts and cash | The existing native case archive controls |

Keep the relevant working archives as well as the native case archive when moving an installation. Browser site-data removal clears local preparation; recorded case data and downloaded recovery files have their own retained destinations.

Saved-copy list revision conflicts and automatic-draft conflicts are separate. Refreshing the named-copy list does not decide which automatic draft should continue. Conversely, resolving a tab-draft conflict does not remove named editions.

For saved editions, opening comparisons and complete archive receiving, see [Statement working copies](STATEMENT_WORKING_COPIES.md). For attributed finance recommendations, see [Statement recipient review](STATEMENT_RECIPIENT_REVIEW.md).

## If the saved draft cannot be opened

The desk shows **Preserve the saved original before recovery** when a saved value is present but cannot be opened as the complete original draft. It keeps that saved original unchanged and grants no automatic-save authority. Normal edits and native requests remain unavailable until the saved original is recovered.

Select **Download unreadable saved original** to retain `statement-unreadable-original.json`. Correct the interpretation or draft structure in a separate complete recovery file, preserving the original pending or accepted request payload and actual result exactly. Choose **Open repaired complete draft** to receive that file explicitly.

The repair validates the complete draft, checks that the saved original has not changed since it was read, and retains the full unreadable original in an immutable recovery pair before replacing the current draft. If another tab has changed it, read and compare that actual current original before choosing a repair. Removing or replacing an original request in the repaired file is rejected.

The selected retained pair offers **Download preserved unreadable original**. The complete tab-recovery archive also carries that original alongside the validated repaired draft, so later receiving retains both.

If browser storage itself cannot be read, the desk cannot supply an original it has not obtained; its unreadable-original download/repair controls remain unavailable. Restore the browser's storage access and reopen the same Statements case before choosing a recovery. A blank working view does not mean the saved original has been cleared.

## If saving is unavailable

Keep the current page open and download its complete recovery material before changing or clearing browser storage. A critical save failure stops the dependent original request from being sent. A successful file download gives a portable copy; inspect and retain it before closing the page.

When a save conflict appears, read the comparison instead of repeatedly pressing an import or setup action. The desk preserves the conflicting whole drafts so the operator can choose deliberately. A storage error and a changed shared draft are different conditions and retain their respective messages.

## Maintained source integration

The complete application serves `operations_statement_drafts.mjs` through the existing authenticated `operations_http.py` static routes. `managed-source.json` includes that module and this guide for the original managed launch/export/restore path. `operations_statements.mjs` supplies its existing Staff-scoped database opener, full snapshot and original native command lifecycle. Named-copy, recipient-review, rulebook and allocation work stay in the same desk.

`createStatementDraftAccess` owns atomic current-draft write/resolve and complete immutable recovery receiving. It uses the existing `drafts` object store, with case-scoped recovery keys. Source registration adds no database, server command or financial writer.

## Maintainer receiving course

Use the existing original Statements receiving operation and its retained case, bank file, Staff context and invoice identities. Keep the same native command writer and original financial import. The meaningful course must cover:

1. Open two tabs with the same Staff identity and case. Edit different unfinished source/mapping/decision work. Confirm that a stale save leaves the shared draft unchanged and retains both complete versions.
2. Inspect the complete comparison on desktop and narrow width. Open the selected shared version, then repeat with two editable versions and explicitly continue the local version. Change the shared draft after preparing a comparison and confirm the selection is rejected until refreshed.
3. Exercise the original pending import and setup boundaries. Preserve exact request ID, actor and payload, plus the actual result when acknowledged. Confirm that a conflicting request is not replaced by an editable draft and no new command is created during comparison or archive receiving.
4. Exercise an unreadable saved original as a separate recovery case. Confirm it grants no save token, download the full original, receive a valid explicit repair with unchanged request/result, and verify its preserved raw original survives archive receiving. A failed storage read must not grant replacement authority.
5. Download the complete recovery archive, inspect the actual file and independently reopen it against the same original case in an empty receiving browser context. Recover both complete sides, reuse identical records and reject a changed same-ID record atomically.
6. Re-preview the selected original bank source through the native Statements path. Preserve the expected final original decisions and invoice allocation, then continue the existing original import and readback course.
7. Open and inspect the actual wide/narrow screenshots, comparison views, exported files and cold-reopened archive. Verify usable controls, readable filenames and request states, and the absence of clipped or obscured actions.

Source/model checks establish their corresponding behavior only. Record the actual application/browser and download results from the same complete receiving operation.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999


## Current browser ownership

Bryce's instruction of 13 October 2026 applies from 16:00 UTC/noon Eastern: his local Codex in-app browser must remain untouched until he explicitly releases it. This includes navigation, reload, clicks, typing, capture, inspection, resizing, tab changes and automated checks. No end time is implied. Isolated cloud browsers and shell/source work can continue. Use an isolated cloud browser for this receiving course unless the owner explicitly releases his browser.

Original instruction: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791906463475599
