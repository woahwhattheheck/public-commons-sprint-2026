# Receive an accepted classification case

The **Classification → Receive accepted package** view receives a complete accepted scenario JSON, or a ZIP of those JSON exports and their CSVs. It retains the original document IDs, content hashes, source fields, selected input editions and ordered reviews. The exact original archive and every individual member remain available for download.

Receiving creates a local receiving record. Its workspace ID, receiving time and local revision describe the receiving operation. The original documents keep their own authors, times and stored revision values. An exported package supplies classification history; a native workspace backup also carries that workspace's database and operation history.

## Operator workflow

1. Open or create the destination through the ordinary workbench. Open **Classification → Receive accepted package**.
2. Select the original accepted JSON or ZIP. The view retains the complete file bytes, name and SHA-256 across navigation and browser refresh.
3. Enter the receiving operator and the original handoff or source reference. Enter the original workspace ID when the handoff supplies it. This field records the source assertion; it does not rename the receiving workspace.
4. Select **Preview original accepted packages**. Inspect the scenario roots, complete document list, original acceptances, original source members, and the proposed receive/reuse actions. Every document remains accessible through the document pages.
5. Select **Receive these exact accepted packages**. This uses the reviewed source, context and preview identity. If another operator changes the destination before the request is accepted, reopen the current preview.
6. Open the receiving record. Open each original edition to inspect every row and review through the existing classification views. The existing **Use as a new draft** action creates a new editable edition with a reference to its original; it does not rewrite the received source.
7. Download the original archive, any individual original JSON/CSV, or the complete receiving record. Current accepted CSV and complete JSON use the existing accepted-export operations. These use the latest review in this workspace; the received historical files remain available unchanged.
8. Use **Workspace → Create complete backup** for the complete case, including the retained source blob, receiving record, original documents/reviews and local operation history. Restore that ZIP through the existing workspace restore.

The package view and source editors are cached across navigation. Each controller owns its own disabled controls, so completing a native request while a view is detached does not leave the returned view locked.

## What admission checks

Admission reads one immutable byte buffer. ZIP members are read in memory, without filesystem extraction. The source is limited to 24 MiB; a ZIP may contain at most 128 unique regular JSON/CSV files and 128 MiB in total expanded content. An individual member may not exceed 32 MiB. Absolute paths, traversal components, link entries, encrypted members and duplicate names are refused.

Each JSON must be a complete accepted scenario export with the original schema, root, documents and accepted review. Every original content hash is checked with the same JSON number semantics used by the original native loader. Duplicate JSON keys and non-finite numbers are refused. Raw input bytes remain unchanged, including UTF-8 BOMs when present.

Admission verifies:

- Each root is the exact original scenario and is accompanied by its recorded acceptance.
- The complete selected method, role, workforce and optional baseline-method graph is present.
- The role/workforce/method relationships and the saved calculation's selected input IDs and hashes agree.
- Every original review refers to its exact document and every retained upstream acceptance is included.
- Repeated document IDs carry identical immutable content.
- Repeated histories are compatible prefixes of the same ordered review sequence.
- Any supplied CSV matches the unchanged native CSV serialization of an included saved scenario.

The receiver retains saved calculations. It does not recompute them into replacement documents or generate new historical approvals. Content hashes check consistency of the supplied source. The original handoff and recorded reviewer fields identify its provenance.

A superseded edition outside the exported root graph remains an explicit external reference. An original native Job reference remains visible with any included snapshot. Receiving does not create an absent original Job record or manufacture the former workspace's operation journal.

## Existing records and later reviews

Original classification documents are immutable. A matching ID and content hash can be reused; a conflicting ID/content pair is refused.

Review histories may extend an existing compatible prefix. Divergent histories must be received into a separate workspace. If the destination already has later reviews, receiving an older prefix preserves those later reviews. It therefore cannot replace a local changes-requested review with an older acceptance.

The SQLite row revision records local receiving order. The original JSON stored_revision remains untouched. Review reads use local revision followed by insertion order, preserving the source's complete order when several historical reviews enter in one native transaction.

A new request for an identical source and identical receiving context reopens the original receiving record. Its original receiving date, counts and preview identity remain its historical record. A different operator or source handoff creates a new local receipt while reusing identical documents.

## Interrupted requests

Before any preview or receive mutation, the browser retains the complete original body, operation ID, expected workspace revision and source bytes in IndexedDB. The existing workbench request recovery also retains the native mutation request.

A returned native result is saved before changing the visible selection or refreshing the workspace. If a response or refresh is lost, use **Resume original request** or **Apply retained native result**. The original Workspace checks an existing operation before checking the current revision, so a completed original request reopens its saved result.

When the server explicitly refuses a request, the refusal and exact request remain available. **Review draft after returned refusal** retains that refusal and returns to the editable receiving context. An unknown transport outcome stays pending for original-request replay.

## Native caller

**classification/receive_accepted.py** composes the same original Workspace APIs. It can create a fresh receiving workspace or receive into an existing one. Its output directory retains the complete source, native requests, first responses, explicit replay response, document/source/export readbacks, native backup, restored readbacks and receiving selection.

Run from the maintained application root:

~~~bash
python3 -B classification/receive_accepted.py \
  --package /absolute/path/accepted-exports.zip \
  --expected-source-sha256 ORIGINAL_SHA256 \
  --workspace /absolute/path/received-workspace \
  --output /absolute/path/receiving-operation \
  --operation-id CLASSIFICATION-RECEIVING-ORIGINAL-OPERATION \
  --actor "Receiving operator" \
  --source-ref "Original handoff or source reference" \
  --origin-workspace-id ORIGINAL_WORKSPACE_ID
~~~

The original workspace ID is optional when the source handoff does not supply it. **--expected-source-bytes** can pin an observed complete length. **--restore-target** selects the native restore directory; its default is restored-workspace inside the operation output.

The caller uses a file lock for its own output, persists each exact request before Workspace.mutate, replays the receive with that same operation ID, and compares the original result and operation_revision. The current workspace revision is retained separately because later operations may have advanced it. The first returned response stays unchanged. The caller then uses prepare_backup, Workspace.backup and restore. The full result is durable before the progress record says complete.

For a new receiving directory, the caller runs the original initializer in a recorded staged native workspace, verifies its complete metadata and publishes it without replacing any existing target. Interrupted initialization directories are retained; a valid prepared workspace reopens with its original identity. Existing workspaces are never reset.

**--until received** finishes the receiving/readback leg first. Run the same command with **--until complete** to continue into backup and restore. Preserve the same source, native source files, workspace, output, context and operation ID. Existing results and completed destinations are checked and reopened.

**--require-original-export-bytes** requires every regenerated accepted JSON and CSV to match a supplied original member. This is useful for a fresh receiving case with unchanged complete source review histories. When legitimately joining longer histories in an existing workspace, use the original member downloads for exact historical bytes and the current accepted exports for the current native state.

## Native API

All writes use the original transaction and replay contract:

~~~json
{
  "operation_id": "original-stable-request-id",
  "expected_revision": 0,
  "content_base64": "COMPLETE_ORIGINAL_BYTES",
  "filename": "accepted-exports.zip",
  "expected_source_sha256": "ORIGINAL_SHA256",
  "actor": "Receiving operator",
  "origin_workspace_id": "Source workspace supplied by the handoff",
  "source_ref": "Original handoff",
  "notes": "Receiving context"
}
~~~

Use action **classification.preview_package** through the native caller, or POST **/api/extensions/classification/preview_package**. Its result.preview_sha256 is added as expected_preview_sha256 for **classification.receive_package**. Use a distinct stable operation ID and the actual next workspace revision for that second request.

The body uses scalar fields; parsed source records are private values obtained from the complete retained bytes. No source-owned mutable objects are read after request signing.

| Purpose | Native extension read |
| --- | --- |
| Complete receiving record | document, kind received, receipt ID |
| Paged receiving history | document, kind received-page, cursor string starting at 0 |
| Exact original ZIP or JSON | download, kind received-original, receipt ID |
| Complete receiving JSON | download, kind received-manifest, receipt ID |
| Exact original member | download, kind received-member, RECEIPT_ID~INDEX |
| Original classification document and reviews | Existing document, original kind and ID |
| Current accepted CSV/JSON | Existing download, kind scenario-csv / scenario-package, original scenario ID |

HTTP reads use the existing **/api/extensions/classification/document/KIND/ID** and **/download/KIND/ID** routes. A receiving page contains up to 25 items, total and next_cursor. Member indexes follow the receiving record's complete ordered members array. The original archive and selected member are checked again before download.

All extension reads use one query-only SQLite transaction. An accepted JSON's selected acceptance and complete document/review graph therefore come from the same native read snapshot.

## Original Apex case

The source selection and executable receiving example are in **examples/apex-accepted-package-receiving/**. They bind the original 119,254-byte six-export archive, three accepted scenario IDs, original method/role/workforce IDs and the original workspace provenance. The completed receiving case has its own workspace ID.

The existing FSU→Apex operator journey consumes the new RECEIVING-SELECTION.json and the native backup. Its original accepted document IDs remain valid. A continuation uses the actual receiving workspace identity from that selection.

## Populated original case inspection

Continue the original Apex operation and receiving selection. Open the actual populated **Receive accepted package** view and its received document/history screens, inspect the complete original six-export package, and operate preview, receive, source/member downloads, accepted CSV/JSON exports, backup and reopening. At the actual screenshare width and a narrow width, LOOK at the actual rendered product and repair unreadable tables, clipped controls, overflow or unclear feedback. Use the same retained requests for interrupted operations. Preserve the full original accepted graph and later local review decisions while checking the rendered views.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.
