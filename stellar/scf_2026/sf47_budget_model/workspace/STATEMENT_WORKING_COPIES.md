# Statement working copies

Use **Accounts → Statements → Statement working copies** to prepare several bank files, accounts or periods in the same original grant case. Each named copy has complete immutable saved editions. The desk continues to use its original statement mapping, bank inspection, cash preview and receiving command.

## Keep the current work

Enter a **Copy name**, such as “Operating account · October”, and an **Edition note** describing what is ready and what remains. **Save as a new copy** creates a separate named copy. **Save next edition** retains another complete edition of the currently open copy. Earlier editions remain available.

A saved edition includes the original file bytes and observation, account/currency, format and columns, exact saved setup selection, all row decisions and reasons, unfinished per-row supplier allocations, native inspection/preview, pending request or accepted response, and the queued original-source handoff. The original request ID, actor and payload are preserved. Saving a working copy changes local preparation only; original cash is recorded by the existing reviewed native receiving command.

The desk automatically saves the current complete work before choosing another statement file, opening a retained original source or importing a recovery copy. If storage cannot retain that edition, the current work remains open. Download its complete recovery copy and resolve the browser storage message before replacing it.

Names and notes describe operator preparation. They do not change bank descriptions, source filenames, cash facts or invoice records.

## Find and open an edition

Search the complete saved-copy list by name, period, account key/label, original filename, format, currency, note or original request ID. Results page through every match. The table shows the latest edition, saved time, decision count, unfinished invoice rows and whether the original request is pending or awaiting readback.

Select **Choose edition**, then choose an edition number from 1 through the latest saved revision. Select **Review before opening**. The comparison identifies both file names, whether original bytes match, account/currency, source format, number/date interpretation, CSV mapping, saved setup edition, decision counts, unfinished invoice work and any retained request.

**Preserve current work and open this edition** saves the current complete work first. It opens the selected immutable edition as an editable statement. The native preview is cleared and must run against the current case. Unfinished invoice work is retained for its original row/source comparison and explicit review. A pending receive/setup request or an accepted response continues through its original recovery controls.

Changing the current working statement after preparing an opening comparison invalidates that comparison. Review it again. Finishing an unresolved request comes before switching statements; saving and downloading that original request remain available.

To fork an earlier edition, open it, revise the name and choose **Save as a new copy**. To continue the same copy, use **Save next edition**. Both choices retain all earlier editions.

## Complete downloads and independent receiving

**Download selected recovery copy** returns that exact edition as the existing complete statement recovery JSON. It opens through the original recovery control. It contains the full source and private financial preparation; retain it in the operator's private working directory.

**Download all complete copies** first saves the current complete work, then downloads every edition of every named copy for this case, including their original file bytes and request identities. The archive uses:

~~~json
{
  "schema": "sf47.statement-working-copy-archive.v1",
  "caseId": "ORIGINAL_CASE_ID",
  "index": {
    "schema": "sf47.statement-working-copies.v1",
    "caseId": "ORIGINAL_CASE_ID",
    "revision": 3,
    "copies": []
  },
  "editions": []
}
~~~

The actual download contains all complete summaries and editions, rather than the empty example arrays above. The archive checks every consecutive edition and its corresponding latest summary.

Open the original case in the intended receiving installation and operator session. Select **Import complete copy archive**. It adds missing whole editions without changing the open statement. Identical editions are reused. An existing copy ID/edition with different complete content rejects the entire import, leaving both original files available for inspection. Select an imported edition, review its complete opening comparison and open it explicitly.

The archive retains the original case ID. Use another browser on that same retained case, or restore the original installed workspace with its existing case identity when moving hosts. A native case ZIP imported as a new case has its own identity; review its recorded statements through that case's original-source controls. A pending request retains its original operator identity; the existing Staff request checks apply when opening and resuming it.

The current draft and all copies use the existing Staff-scoped Statements IndexedDB database, on the original host and port. Another Staff identity has its own storage. A full native case ZIP carries recorded sources and cash; download the working-copy archive as well to carry unfinished local preparation.

## Concurrent tabs and storage

Every saved-copy list update uses an IndexedDB read/write transaction with its observed list revision. An older tab receives an explicit refresh instruction instead of replacing another tab's editions. Refreshing the list leaves the open source and edits untouched. Immutable edition insertion and list advancement commit together.

Archive import is one transaction. A conflict or storage failure leaves the original list and editions unchanged. There is no removal control or silent truncation. The practical limits are 2,000 named copies, 10,000 complete editions, 64 MiB per recovery edition and 256 MiB per complete archive. The original native statement-file limit remains 8 MiB. Download complete archives periodically and retain them privately.

The desk keeps its existing per-case automatic draft separately from explicitly saved editions. The new list is stored in the same object store with case-scoped keys; it is not a second case or cash ledger. Browser site-data removal clears browser preparation, so retain its complete downloads.

The automatic draft now detects a changed same-Staff shared draft atomically and retains both complete versions before any recovery choice. Use **Statement drafts in this browser** to compare the local/shared source and original request, preserve both, and download or reopen the full tab-recovery archive. See [Statement draft recovery](STATEMENT_DRAFT_RECOVERY.md) for the exact controls and original-request continuation. These choices preserve named copies and their immutable editions.

## Accountant recipient review

The same current statement can be sent for complete offline finance review. Use the current native preview, retain its original edition, receive an attributed recommendation file, compare original/current/returned fields and apply explicit choices before the existing native re-preview. See [Accountant recipient review](STATEMENT_RECIPIENT_REVIEW.md) for the complete source, recovery and original receiving journey.

## Source integration

- **operations_statement_copies.mjs** supplies complete edition validation, before-open comparison, full archive merging, search, table controls and transactional access to the existing database.
- **operations_statements.mjs** joins saved editions to the original draft, source switch, recovery import, pending request controls and native preview.
- **operations_statements.css** owns paired light surfaces/dark text, readable form controls and the same responsive table layout, including when the host uses a dark theme.
- **operations_http.py** serves the module through the existing authenticated application.
- **managed-source.json** includes the full module and this guide for both maintained launchers and source distribution.

The pure model exports statementCopyIndex, prepareStatementCopySave, prepareStatementCopyArchive, mergeStatementCopyArchive, compareStatementCopy and statementCopySearch. The createStatementCopyStore entry receives the existing database opener and original case ID; it adds no separate database, server endpoint or financial writer.

## Same original account receiving course

Continue the existing A0D5/32C2/390E/0C75 account operation with its original four bank files, retained case/invoice and original request history. The complete runtime source remains assembled by its current4593 owner. Preserve an already completed account phase and its original replay before adding the following controls.

Within the original CSV preparation, save the reviewed October copy with its unfinished supplier allocation. Select the original OFX file; observe that the prior complete CSV is retained. Save the OFX preparation under a separate name, search the complete list and open the earlier CSV edition through its account/format/source comparison. Complete the original250USD invoice allocation through the existing native preview and import. Reopen the original pending request by its actual ID if its response is lost.

Download both the selected recovery and the full archive. Open the full archive in an independent browser context for the same retained case/operator and verify the complete original source, all editions, unfinished allocations and original request fields by using the desk. Reimporting the same archive adds no duplicate editions. Preserve an intentionally conflicting received archive as a private original, inspect the visible refusal and reopen the unchanged earlier edition. View desktop and narrow screenshots from populated, empty-search, storage/request/error and comparison screens, and open/use the actual downloaded files.

The maintained browser programme performs the independent copy receiving in a separate private BrowserContext on the same original browser/server/case. It imports every edition, opens the selected CSV, runs its original native preview and downloads the complete resulting archive, then returns to the original page for the one cash import. Original financial command routes are unavailable in that temporary receiving context, so the original account phase retains its writer. Screenshots and outputs carry the 00-copies-independent and statement-working-copies-independent names.

Keep complete working-copy outputs with the same private account archive and390E navigation handoff. Return actual screenshots to the producing32C2 seat for direct inspection and repair.


## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
