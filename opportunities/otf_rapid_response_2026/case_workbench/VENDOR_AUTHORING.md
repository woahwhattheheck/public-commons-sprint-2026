# Vendor proposal authoring

This module extends the existing Rapid Response Fund case desk with all nine proposal sections and the original issuer budget. The imported proposal remains an original document; its editable draft is a separate value. A draft can be exported and reopened without a case award.

## Existing desk integration

Import `VENDOR_SECTIONS` from `vendor-authoring-forms.mjs` and the functions from `vendor-authoring.mjs`. Render the nine sections with the existing field renderer. For these forms only, preserve the initial object and row fields before overlaying edited declared fields. Removed rows are removed explicitly; reordered rows carry their own original fields. Case-operation forms retain their strict schema.

1. Read the original JSON using the existing original-document path. Keep those exact source bytes and its review separately.
2. Call `createVendorDraft(original)`, then `readVendorFields(draft)` for field values. Amounts are plain USD text for editing.
3. Pass the complete returned field values to `applyVendorFields(draft, values)`. The function returns a new draft and leaves the prior object intact. Every supplied array is a complete replacement, not a partial row patch. A row missing any declared required field is rejected. Repeatable rows must include the original unknown fields retained by the form renderer; correspondence is carried by the actual row object rather than guessed from its array index. Optional declared fields returned as undefined or blank are cleared.
4. Await `reviewVendorDraft(draft)` for internal Markdown, readiness, outward-edition eligibility and the actual budget result. Await `prepareVendorDraft(draft)` for complete downloadable files. `exportVendorDraft(draft)` always supplies editable JSON.
5. Retain an authored draft through the existing `reviewVendorOriginal` / `retainVendorOriginal` operation when requested; this creates a new source document without changing the original imported source. The existing case ledger remains the only retained workspace.

The view should retain unfinished editor controls when navigating tabs, receiving a case operation or importing other sources. Downloading an export does not imply submitting it. Complete JSON and original-document bytes belong in the existing handover route.

## API

- `createVendorDraft(original = {})`: clone the input and add blank known fields. Unknown fields survive.
- `readVendorFields(draft)`: complete editable values, with cents shown as exact two-place USD strings.
- `applyVendorFields(draft, values)`: new schema-compatible draft. Five labor rows maximum; positive loaded/commercial rates, optional commercial amount; blank required amounts remain null; zero is allowed for actual direct costs.
- `reviewVendorDraft(draft)` (async): returns quality, internalMarkdown, submissionMarkdown, submissionIssues, budget, budgetError, contentComplete and submissionComplete. The budget has actual XLSX bytes and cell/source mapping. A browser capability error leaves internal review and JSON available.
- `prepareVendorDraft(draft)` (async): returns draft, review and files with name, media_type and Uint8Array bytes. These include the editable input, internal proposal, readiness, actual XLSX and mapping; a complete outward proposal is included only when the maintained compiler can render it.

Personnel CV and technical-example original evidence remain in cvEvidence/evidence. Optional cvPublicEvidence/publicEvidence choose outward HTTPS links or attachment:filename references. The maintained vendor core decides outward eligibility; authoring never converts a private source into a public one or creates an attestation.

## One spreadsheet transformation

`vendor_submission_20261011/issuer-budget-core.mjs` contains the single ZIP/XML transformation and yields only SHA-256 and raw-DEFLATE runtime effects. The existing Node `issuer-budget.mjs` API remains synchronous. `issuer-budget-browser.mjs` uses WebCrypto and DecompressionStream with bounded output. `issuer-template.mjs` retains the exact public original workbook, verified by its original 5983-byte / 1994a0b3ad589193c6ff8dd29bf8a9d08dfa4c6e85eebdb4a6aa5c9d994ce55d identity before editing.

No spreadsheet is reconstructed from a generic sheet. Nine unrelated original members stay byte-identical. The original worksheet and styles retain the documented input-cell mappings and corrected wrapped-name/rate layout. Browser inability to decode raw DEFLATE is reported explicitly; the original Node compiler remains available.

The portable sync and async paths were compared on the existing public authored workbook exercise and the retained private applicant input. The full XLSX and mapping bytes match their current originals in both paths. Unknown input fields and repeated-row fields survive editing and row reordering; optional-rate clearing and invalid decimal inputs were checked. The same equipped OTF receiving course must still operate the actual browser editor, narrow view, original file chooser and complete downloads/reopening.

## Build composition

Bundle in dependency order: vendor-attachments, vendor-core, issuer-budget-core, issuer-template, issuer-budget-browser, vendor-authoring-forms, vendor-authoring, then the existing case desk modules. Resolve relative vendor_submission imports to their module basenames. Only the existing browser/bundle/build integration owns its DOM and workspace; these modules create no second store, sender, network request or deployment.

## Included biographies and work evidence

The original RFP Section V asks for assigned staff biographical sketches or CVs and prior technical examples. It does not require public hosting. A selected outward evidence reference can therefore be `attachment:Staff-Biography.pdf` when the actual approved file accompanies the proposal.

The input's `outwardAttachments` inventory preserves each file as `{name,mediaType,bytes,sha256,contentBase64,approvedForSubmission}`. The chooser creates it with approval false. The person preparing the proposal explicitly selects that file for outward use and binds its exact name in the applicable staff/example field. The original private evidence field remains unchanged.

The shared `vendor-attachments.mjs` validates safe names, case-insensitive collisions, reserved generated names, media type, exact length, canonical base64 and actual SHA-256. Only files explicitly approved and selected by a staff/example row enter the outgoing file set. Its sync and async adapters use the same validation. Up to 64 entries and 16 MiB of selected original attachment bytes fit the existing 24 MiB editable source-file boundary after base64 expansion; the complete draft JSON is checked against that original source-file limit before export.

`prepareVendorDraft` returns two distinct inventories. `files` is the complete internal working edition, including editable input, private original evidence references, internal review and source mapping. `submissionFiles` contains only the eligible outward proposal, original-template XLSX and exact selected attachments. The browser should label/download these separately; the submission ZIP must never include original imported input or the internal working inventory. Both remain local preparation, with no send action.

The Node compiler returns the same `submissionFiles` selection and writes `submission-files.json` listing the exact outgoing names, byte counts and hashes. Its existing full output directory remains the internal working edition. Exact file bytes accompany the prepared result; a filename or public-looking link alone cannot satisfy the attachment binding.

For the desk integration, import `createOutwardAttachment` from the shared module and pass the existing SHA-256 function. A selected local file is retained in the current draft's inventory; approval, name/reference changes and removal invalidate prepared output. Preserve full inventory bytes when navigating and saving the draft. The existing complete-edition retention path must allow the original five/six generated files plus selected attachments and retains their actual bytes through source.record.

The attachment path was executed with a clearly authored biography file. Node and portable authoring select byte-identical outward proposal/XLSX/attachment files. A changed hash and colliding filename reject the outgoing edition; an unselected private file stays outside it. The current actual applicant package remains byte-identical with no attached file selected.
