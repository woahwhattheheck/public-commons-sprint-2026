# Citation update review

The **Update review** tab connects registered source updates to the evidence and findings in a saved Research dossier. It opens from retained editions, preserves each original source record, and saves an operator's evidence and finding changes together in one dossier revision.

## Open the working dossier

Start the existing Research dossier workspace and open its complete local address. Choose the saved dossier, then **Update review**. The tab is available when working from retained source data. Its notice list shows the registered notice, the DOI it updates, the selected evidence affected, and the number of affected findings.

Use **All notices**, **Pending and follow up**, or **Reviewed** to select the list. The counts describe the current dossier revision. The lookup-coverage section retains the actual edition's coverage, missing results and source representation.

A notice's registered type and title describe the original source metadata. The reviewer records what that update means for the dossier's findings.

## Read the original source

Open a notice and expand **Original notice assertions and source records**.

Each occurrence remains tied to its original edition and result key. **Inspect original record** opens the maintained source inspector; **Download original result record** saves the exact declared result serialization. **Download original edition** saves the complete retained edition and verifies its original byte count and SHA-256.

The source register distinguishes two input representations:

| Representation | Retained bindings |
| --- | --- |
| Original HTTP captures | Original URL, observed retrieval time, capture identity and role |
| Retained source documents | Original document identity, document metadata hash, source body hash and size, source URL and full transfer provenance |

A source document with an unexposed retrieval time retains the timestamps and transfer details actually supplied in its provenance. Multiple registered assertions remain available with their original source bindings.

## Prepare the complete review

Enter the reviewer, overall decision and reason. Work through every affected evidence occurrence and finding.

For evidence, edit its selection, classification and complete note. For each finding, edit the full title and text, select the original citation occurrences belonging to its research question, and give an explicit disposition and reason.

| Finding disposition | Result required in this review |
| --- | --- |
| Unchanged | Keep the finding's saved text, title and citations |
| Revised | Record an actual change to its text, title or citations |
| Affected citations removed | Remove every affected citation from that finding and retain the explicit reason |
| Follow up | Record the additional review needed, with any current edits kept explicit |

The overall decision records the operator's conclusion. The evidence and finding controls specify the exact content changes.

**Save complete review** submits the entire selection with the current dossier revision and notice fingerprint. The original engine validates every affected finding, applies the selected edits, and records their source bindings in one atomic revision. The saved review retains its original revision, resulting revision, author, reason, full changes and finding dispositions.

## Continue a draft or resolve a concurrent edit

Edits are saved in this browser's IndexedDB with their original base revision. Refreshing the notice or dossier preserves the working draft. Earlier branches remain available in **Other retained draft versions**. **Download draft** saves its full editable content and original base selection.

If another operator changes the dossier, the current source and the earlier draft remain visible. Choose **Compare draft with current revision**. Fields untouched in the draft adopt the current saved value. Fields edited in both versions show their original, current and working values together. Select each resolution and choose **Use resolved draft on revision …**. The earlier complete draft remains available.

The form preserves an unacknowledged browser write in memory until IndexedDB confirms that exact draft version. If storage fails, the page offers the complete unsaved draft as a download and warns before closing while those unacknowledged edits remain.

## Recover a save whose reply was interrupted

The browser commits the original request ID and full payload before submitting it. An interrupted reply leaves **Retry original save** available. That action sends the same request and reopens the engine's original saved review when it already exists.

A saved server receipt is retained before the corresponding draft is removed. Edits made to the draft during a save remain their own complete branch. A rejected revision check leaves the full draft available for explicit comparison with the current state.

## Open the saved reports and portable dossier

Saved review history provides **Previous report** and **Reviewed report** downloads at their exact dossier revisions. Each offers HTML, Markdown and a complete portable dossier. **Current report** opens the selected current revision.

The report contains the source-linked findings and citation-review history. Reopen a portable JSON or gzip file through the existing **Open dossier file** action to continue from its original retained sources and revision history.

The review endpoint accepts a complete UTF-8 JSON request up to 16 MiB. The maintained dossier engine applies its original saved-revision size limit. A size or validation error leaves the complete browser draft and request available for correction or download.

## Use the existing Merchant tools

The same review is available through an attached Research workspace. The host's existing Research configuration selects its original listener connection file, workspace directory and private exports directory. Attach with `merchant_research_attach`; all citation operations use that attachment's `workspace` alias.

| Tool | Complete operation |
| --- | --- |
| `merchant_research_citation_updates` | Page notices, counts and source coverage at a selected dossier revision |
| `merchant_research_citation_update` | Open the complete notice, original assertions, affected evidence and findings, citation options and review history |
| `merchant_research_citation_review` | Save one explicit atomic review or recover that exact original request |
| `merchant_research_export` | Retain HTML, Markdown or a portable dossier at the selected prior or reviewed revision |
| `merchant_research_file_read` | Read the original complete retained export in byte-verified chunks |
| `merchant_research_detach` | Drain this attachment and its export reads |

For a list, supply `workspace` and `dossierId`, with optional `status` (`all`, `pending`, `reviewed`), `revision`, `offset` and `limit`. Continue the returned `nextOffset` using the same returned dossier revision. The pending filter includes notices requiring review again and saved follow-up decisions.

Read a selected `noticeId` at that same revision. Its detail returns the full finding text and permitted citation occurrences, plus the original source-document or HTTP-capture bindings described above. Record its exact fingerprint and revision before preparing a decision.

The review tool takes the same complete request as the browser:

- `workspace`, `dossierId`, a stable `requestId`, and the original `noticeId`.
- `expectedRevision`, `expectedFingerprint`, `actor`, `decision` and a complete `reason`.
- `evidenceChanges`, with each occurrence's ID, selection, classification and full note.
- `findingChanges`, with each finding's ID, complete title and text, and the selected same-question `occurrenceIds`.
- `findingDispositions`, with each affected finding's ID, explicit disposition and complete reason.

Keep the entire prepared request in the caller's original operation record. A lost reply is recovered by resending the same values, including its original request ID, revision and fingerprint. The response returns the saved review with `duplicate: true` when it was already committed. Its dossier metadata can describe a later current revision; `review.originalRevision` and `review.revision` remain the two exact report selections.

Export both report editions with the original export tool:

```js
await merchant.call('merchant_research_export', {
  workspace,
  dossierId,
  kind: 'html',
  revision: saved.review.originalRevision
});

await merchant.call('merchant_research_export', {
  workspace,
  dossierId,
  kind: 'markdown',
  revision: saved.review.revision
});

await merchant.call('merchant_research_export', {
  workspace,
  dossierId,
  kind: 'portable-gzip',
  revision: saved.review.revision
});
```

Each receipt retains the actual revision, complete byte count and content-addressed export ID. Read it with `merchant_research_file_read` using its same `kind` and `exportId`, then continue the returned read ID and offset. Reopen a portable artifact through the existing `merchant_research_reopen` route in the receiving workspace. The original listener remains owned by the Research application when the Merchant attachment is detached.

## Original native customer operation

The exported function in [citation-review-browser.mjs](citation-review-browser.mjs) joins the existing native customer workflow:

```js
await runCitationReviewBrowser({
  url,
  dossierId,
  noticeId,
  runDirectory,
  playwrightModule,
  chromiumExecutable
});
```

Pass the original listener address and the actual seeded dossier and notice. The parent owns the native operation and listener lifetime. The function receives original retained source data, opens two affected research-question findings, reloads the actual browser draft, resolves a real concurrent finding edit, recovers the original accepted save after a lost reply, and opens the prior and reviewed reports. It returns the actual review and revision IDs plus explicit artifact descriptors.

Re-enter with the same run directory to reconcile that operation's saved request and completed output. The parent preserves its listener port so the browser can reopen the same origin's IndexedDB.

The Chromium profile is private runtime state under `citation-browser-profile`. Deliver the explicit `nativeOutputs`, the maintained product source, and the parent's complete portable dossier and reports. The source inspector, original dossier engine and full source-edition readers remain the authorities for retained bytes and revision replay.

## Native Merchant receiving phase

The same parent workflow calls the completed Merchant phase while its original Research listener is still open:

```js
await runCitationReviewMerchant({
  url,
  workspaceDirectory,
  runDirectory,
  dossierId,
  noticeId,
  selection: {
    reviewId,
    originalRevision,
    reviewedRevision,
    currentRevision
  },
  reviewRequest
});
```

The function lives in [citation-review-merchant.mjs](citation-review-merchant.mjs). Pass the exact already-saved browser request, without the Merchant workspace/dossier wrapper fields. The phase first verifies that saved review in the selected revision history. Its replay returns the original review with `duplicate: true`.

This phase pages the complete original notice list and source coverage, opens the prior, reviewed and current notice details, and receives each revision's HTML, Markdown and portable gzip through the existing Merchant retainer and byte-verified file reader. Existing export receipts are reconciled before another export is requested. An interrupted partial file is compared to the same original export chunks before continuation; the complete file must match its recorded length and SHA-256.

The private `citation-merchant` runtime directory keeps the original request, export inventory and actual attachment lifetimes. A reopened process borrows the same original Research workspace and retains the prior attachment receipts. The returned `nativeOutputs` selects the complete downloaded reports, dossiers, source-review records and operation receipt. The session connection file and internal retainer storage stay outside that output selection.
