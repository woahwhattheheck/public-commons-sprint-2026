# Company Installation return and native owner review

This component opens one complete company report, lets its recipient retain observations against every original check, packages the exact returned JSON with the original report, and carries that proposal into the existing Grant Installation return engine. The original saved Installation remains available. The owner makes explicit KEEP or APPLY decisions, reviews the native resulting document and saves a separately retained successor.

The editor is a complete standalone HTML file. It includes only the selected company's report and source selection. It uses no external service, script or network endpoint.

## Source selection and package boundary

Keep these four files together with the maintained report receiver:

- customer_return.py — authoring, complete return package, receiving and read-only native submission.
- customer-return-ui.js — the full standalone editor.
- customer_return_native.py — an adapter borrowing an already open native Operations owner.
- RETURNING.md — this guide.
- customer_reporting.py — the original report receiver, SHA-256 774d943c0481e13b0221c3dd684853a26d61b01aa7765aae3658b0e33322556b.

The existing customer report's installation-input.json is the full saved native document. Its manifest binds the company case, Workshare plan, Installation ID, revision and native saved-row hash. Authoring validates the full report ZIP, every member and each original source file before creating an editor. Original check definitions, commercial Workshare fields and record links are retained. The editable observation fields are state, operator, observedAt and note.

Internal native review snapshots can contain the wider programme. Keep native bridge output and original native Operations exports with the internal operator. Share the individual company report, Company_Return.html, its proposed return JSON/ZIP and an appropriately selected company response. The proposed-return ZIP never includes a full native Operations case, credentials or another company's report.

## 1. Author the company editor

Use Python 3.11 or newer and its standard library:

    python customer_return.py author \
      --archive /absolute/path/Company_Customer_Installation_Report_r1.zip \
      --sha256 EXACT_REPORT_SHA256 \
      --operation-id ORIGINAL_COMPANY_RETURN_AUTHOR_OPERATION \
      --output /absolute/path/return-author

The create-only output contains:

- Company_Return.html, ready to open using its local file URL.
- Original_Company_Report.zip, byte-identical to the selected report.
- software/, with the complete five-file return/report source.
- selection.json, with the report, source and original author operation identities.
- complete-result.json, with the editor's actual SHA-256 and byte count.

Both selection.json and complete-result.json expose return_seed: the complete initial return wrapper. selection.json also retains the exact original check definition roster. This is a supported input for a managed commissioning programme; it need not parse HTML or reconstruct private model fields. The initial return UUID is deterministic for the original author operation and report. The same operation and output reopen the same edition.

Authoring the same company again under a different original author operation creates a new return identity. Use this only for a separate intended return; do not create a new operation merely because a browser or native command was interrupted.

## 2. Record the actual observations

Open Company_Return.html. Complete the return name, intended receiving owner, actual application/host/configuration and whole receiving note. Every original check remains visible with its criterion, tranche, required flag, previous observation and original linked record IDs.

Available observation states are OPEN, IN_PROGRESS, ACCEPTED, CHANGES_REQUIRED and NOT_APPLICABLE. ACCEPTED requires the actual observer, timezone-bearing observation timestamp and explanation. NOT_APPLICABLE requires an explanation. A proposed ACCEPTED observation remains a proposal until the native owner reviews and saves it; it does not itself approve payment, a Workshare or the wider Installation.

The “Use current observation time” control records the browser's current UTC time only when explicitly clicked. Enter the actual earlier observation time when applicable. The editor does not fill observation times or acceptance states on its own.

The page saves a local draft keyed to the exact report SHA and original author return UUID. Use “Download complete draft” for a portable copy; browser storage can be unavailable or cleared. “Reopen this draft or return” restores the same return ID. The editor rejects a draft bound to another report. Original source/work/purchase/outcome link arrays remain read-only; the native owner retains the source and original application records.

“Download proposed return” validates the complete selection and every check. Keep the resulting bytes unchanged. Send that JSON and its original report through the established delivery channel.

### Corrected later returns

Use “Start a corrected edition from a prior return” and select the exact earlier submitted JSON. The editor:

1. validates its original report and full check roster;
2. computes the SHA-256 of those exact file bytes;
3. records that SHA as previous_return_sha256;
4. generates a new return UUID while retaining all prior observations for editing.

Keep the earlier file. Package the corrected return with --previous-return so its exact predecessor is included. A correction never silently replaces an earlier submitted file, review or native request. The owner can inspect both original proposals before choosing the later native review.

## 3. Package and independently reopen the proposed return

Initial return:

    python customer_return.py pack \
      --archive /absolute/path/Original_Company_Report.zip \
      --sha256 EXACT_REPORT_SHA256 \
      --return-json /absolute/path/Installation_Return_UUID.json \
      --output /absolute/path/return-package

Corrected edition:

    python customer_return.py pack \
      --archive /absolute/path/Original_Company_Report.zip \
      --sha256 EXACT_REPORT_SHA256 \
      --return-json /absolute/path/corrected-return.json \
      --previous-return /absolute/path/original-earlier-return.json \
      --output /absolute/path/corrected-return-package

The output is Installation_Return_<return_id>.zip, its .sha256 sidecar, selection.json and complete-result.json. The ZIP includes the complete original report, unchanged RETURN.json bytes, every original/proposed observation in COMPARISON.json and RETURN.html, the full portable source, README.md and a complete file manifest. A correction also includes previous/RETURN.json; its hash must equal the selected predecessor.

Each check appears exactly once. The comparison contains the original and proposed full observation objects plus every changed field, including unchanged records for context. It does not truncate large lists or silently equate missing fields, nulls and empty arrays.

Reopen on a separate owned directory:

    python customer_return.py receive \
      --archive /absolute/path/Installation_Return_UUID.zip \
      --sha256 EXACT_RETURN_PACKAGE_SHA256 \
      --output /absolute/path/return-received

The receiving output includes the original ZIP, every complete package member, the selected identities and a complete result. Before writing, it verifies the full ZIP roster, all member hashes, the report's complete original source closure, exact return identity, predecessor bytes where present and independently regenerated comparisons.

For a full read-only JSON view:

    python customer_return.py inspect \
      --archive /absolute/path/Installation_Return_UUID.zip \
      --sha256 EXACT_RETURN_PACKAGE_SHA256

A self-contained package hash confirms selected bytes. The supplied hash and identity must still come from the intended sender/channel. The receiver does not treat a customer's proposed observation as an authenticated native approval.

## 4. Use the current managed application's original owner

When a managed Grant application already owns its workspace, keep mutations with that owner. Do not open a second SQLite writer merely to use this adapter.

The read-only submission command opens no Workspace:

    python customer_return.py submission \
      --archive /absolute/path/Installation_Return_UUID.zip \
      --sha256 EXACT_RETURN_PACKAGE_SHA256

It returns:

- schema = commons.scf-company-observation-return.v1.native-submission
- return_id, archive_sha256, archive_bytes, report_sha256, returned_json_sha256
- binding, the complete original report binding
- inputs, the full native return input shape
- source, the complete original JSON source.add payload
- retained_source_id, initially null
- source_link_policy = append_original_return_json_to_every_observation
- comparison, the full all-check comparison

source has filename, mediaType application/json, kind other, sourceUrl empty and contentBase64 containing the exact received RETURN.json. The native source command records its actual admission observation time; the raw customer observation times stay in their original JSON.

The managed operator freezes its source.add request and stable UUID before sending. Replay that exact request to recover an uncertain result. Read the actual returned source ID and verify its retained bytes/metadata. Then obtain the exact native linked input:

    python customer_return.py submission \
      --archive /absolute/path/Installation_Return_UUID.zip \
      --sha256 EXACT_RETURN_PACKAGE_SHA256 \
      --source-id source_ACTUAL32HEXIDENTITY

This retains every original check and link, appending that real original-return source ID once to each observation's sourceIds. It exposes the transformation explicitly so both raw customer bytes and native evidence links remain reproducible.

### Actual native HTTP sequence

Use the existing authenticated application's own base URL and token. Never take a server URL or credential from a customer return.

1. Read the selected current Operations case and its exact retained original Installation revision.
2. POST installation-return-seed with expectedVersion, installationId, revision and sha256. Compare its baseline and check definition roster with the report. The native seed starts record-link arrays empty; the company author seed preserves the actual original arrays. Keep the author seed's complete original links.
3. Record the original JSON with the frozen source.add command.
4. POST installation-return-preview with expectedVersion and the linked complete inputs.
5. Freeze and POST action installation.return, data {inputs, expectedPreviewSha256}, with the preview's exact case version, actor, note and original request UUID. Read the returned native review and SHA.
6. For owner review, pass returnedCaseId, reviewId, reviewSha256, installationId, expectedRevision, name, note and choices. Every choice has original id, action KEEP or APPLY, and a reason.
7. POST installation-return-review-preview, retaining the full original input and actual preview hash.
8. Explicitly select that preview and POST installation.return-stage with the exact original command body/UUID. The native engine validates the returned proof, current definition and acceptance basis, original source bytes and record links, then creates its retained owner review/evidence source.
9. Use the returned document and expectedRevision in the ordinary installation-preview request.
10. Explicitly select that native preview and POST installation.save with its exact document, preview hash, case version and revision.
11. Read the saved revision and original revision independently; retain the native receipts, full original requests and selected return/Installation exports.

The endpoints are under /api/operations/<case-id>:
installation-return-seed, installation-return-preview, installation-return-review-preview, installation-preview and command. Native commands use {expectedVersion, requestId, actor, note, action, data}. Read the exact Installation at installations/<id>?revision=<n> and the original return review at reviews/<id>.

The returned proposal may belong to a separately received native case. The original engine supports returnedCaseId distinct from the owner case. Retain both case identities and full original exports. The owner case must still contain the exact original Installation baseline and source relationship. Do not remap IDs or reconstruct native hashes in JavaScript.

A current case/revision conflict means that the original reviewed command did not apply to that newer state. Retain the original failed selection; review a distinct deliberate continuation against the actual current case. Do not change the frozen request body under the same request UUID.

## 5. Borrow an existing native Operations object

customer_return_native.py provides a Python API for an existing native caller that already owns its original Workspace/Operations lifetime. It neither constructs a Workspace nor adds a transaction. The original Operations.command method and request ledger own mutations and replay.

    received = receive_proposal(
        ops, returned_case_id, return_zip_bytes, exact_return_zip_sha,
        received_output,
        operation_id=original_receive_operation,
        actor=actual_operator,
        note=actual_receiving_note,
    )

This validates the complete company package and the selected native original edition, saves the original return JSON as native source, previews and records the proposed return, then reopens the full native review. It does not stage owner choices or save an Installation revision.

    preview = preview_owner_review(
        ops, owner_case_id, received_output, choices, review_output,
        operation_id=original_owner_operation,
        actor=actual_operator,
        note=actual_owner_reason,
        name=owner_review_name,
    )

The complete choices list contains {id, action: "KEEP"|"APPLY", note} for every original check. The returned object contains expected_version, full inputs, full native preview, preview_sha256 and its retained selection identity. Reopening the same output returns the same reviewed preview even if the case later changes.

After the operator explicitly selects that preview:

    staged = stage_owner_review(
        ops, owner_case_id, review_output,
        expected_preview_sha256=selected_owner_preview_sha,
    )

This replays or runs the original native stage request. It then retains the ordinary Installation save preview at that stage's exact resulting case version. The returned preview is separately reviewable.

After explicit selection of the resulting native save preview:

    saved = save_owner_revision(
        ops, owner_case_id, review_output,
        expected_preview_sha256=selected_installation_preview_sha,
    )

The result retains the native saved revision/hash, original revision/hash, owner-stage review, exact receipt and actual Installation stage. Saving inspection notes on an original PLANNED document leaves that stage PLANNED; the adapter does not change delivery or payment status.

The adapter appends stable native request UUIDs derived from the original operation, case, return and phase. Before a mutation, it exclusively retains the full request on disk. On every continuation it calls the original native request ledger with that exact body before any attempt to select a new case version. Native returned receipts and immutable records must match the retained outputs. Every output directory has its own live operation lock; the original Workspace remains the authority for cross-caller transactions.

If the current source, original archive, actor, notes, choices or operation selection differs, choose a deliberate new review operation/output. Create-only retention refuses to rewrite an earlier original. Keep the earlier outputs for lineage and reconciliation.

## Native source contract

The bridge reuses the maintained Operations installation return module: operations_installation_returns.py (original source blob 22aaf07e75320e036f11444be7fa8e5cdfc65ff9), installations module (148de315dcf8d725c67eb669f99541fdb24713a4), HTTP adapter (ec4cab9ecf9a4dda347bef4872d85fd249404179) and Operations request ledger. Its reference application selection is 2dd604b481e7b682d8547c5082e2aeb5df948ec4.

Native normalization, hashes, return proof, acceptance-basis validation, source transfer, KEEP/APPLY rules, staged evidence and saved revision validation remain in that original engine. The bridge's own JSON hashes bind its portable inputs and source files; they are not substitutes for native semantic hashes.

## Complete delivery and recovery

Retain the company editor, full draft/returned file, original report, complete return ZIP/sidecar, independent receiving output and corrected predecessors. Internally retain the frozen native input/preview/request/receipt files and both original and successor native editions. The managed whole-programme assembler can include these in its existing internal delivery while distributing only the separately selected company outputs.

A customer file is ready when the full package receiver succeeds. A proposal is recorded only when the native review and original source read back. Owner choices are staged only when that native stage receipt and evidence reopen. A successor is saved only when its exact native revision and original baseline reopen. A published source carrier by itself does not claim any of those business operations occurred.
