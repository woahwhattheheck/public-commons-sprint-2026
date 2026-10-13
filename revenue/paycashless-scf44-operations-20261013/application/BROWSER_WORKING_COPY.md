# Complete Paycashless browser working copy

This feature preserves the actual Paycashless operator's local work beside its complete native SQLite delivery. Its storage remains `paycashless-operations-browser`; its portable schema is `paycashless.browser-working-copy.v1`. It does not change provider signatures, the native command envelope, workspace headers or payment authorization.

## Ordinary operation

In **Export & receive**, choose **Download complete working copy**. The JSON contains the full current view, unfinished book/allocation/preparation/source/reconciliation fields, exact raw provider JSON, filters, report-name/export drafts, original requests and attempts, and complete original file bytes. Files submitted earlier travel in their immutable request receipts. Selected files not yet submitted are retained separately with their filename, MIME type, modification time, byte length and SHA-256.

The access token remains in this tab's original session storage and is not exported. Provider credentials remain on the host. The working-copy file nevertheless contains private merchant/source data.

Select the JSON in the **same workspace**, choose **Inspect working copy**, then choose **Restore inspected working copy** explicitly. Inspection checks the whole envelope, every request intent, all complete files and the recognized editor shapes without writing. It displays the request, file and history counts. Changing the selected file invalidates the earlier inspection.

Restore freezes the editor while finishing outstanding local saves, preserving the current view and files, validating the imported file and making the atomic replacement. Missing original requests are added; matching current requests retain their current outcomes and full histories. Conflicting request identities stop the transaction. The previous working view is saved independently before replacement and can be downloaded from restore history. Subsequent whole exports include every previous-view receipt.

Imported requests display **Restored request · explicit recovery required**. Automatic opening and timer recovery skip them. Use the original **Request recovery** controls to inspect or continue the selected original request explicitly. Restoring or inspecting never dispatches a request.

## Selected files and unfinished forms

Each source-file, provider-file and archive field shows its retained file name, size and hash after reopening. **Download complete selected file** returns its original bytes. **Clear this file selection** affects only that form draft; existing submitted request files remain intact.

For browser security the file input itself is empty after reopening. The adjacent retained selection is used when the operator explicitly submits that original form. Choosing a new file replaces that draft selection only after its complete bytes are captured, with a generation guard preventing an older asynchronous selection from overwriting a newer one. No file selection alone sends a host/provider request.

Raw incomplete JSON stays editable and travels unchanged. Guided changes continue to require a valid complete original JSON object. The dynamic report-name and report-destination drafts are bound to their original selected record IDs. All native forms keep their actual Paycashless parameters; no Escala plan, SDP header or Amero database identifier is introduced.

A download captures the current in-memory view even if an earlier local save failed, provided the original request/history stores remain readable. It never omits unreadable original requests or files to create a partial handover. Restoring requires successful local storage, including the saved preceding view.

## Native delivery and customer return

The complete native workspace archive retains host source files, immutable business history, full application source and selected runtime. This separate browser file carries local unfinished work and request custody. Keep both in the original receiving operation.

An independently received native workspace has its own ID. The browser file deliberately refuses rebinding to that new ID. Reopen it in the original workspace to recover the original requests; use the received customer's own browser journal for new customer work. This prevents accidentally sending an old producer request against a different workspace.

## Implementation contract

The journal exports:
- `exportWorkingCopy(workspaceId,{view?})`: complete JSON envelope; optional current view is validated and used for an explicit local download.
- `inspectWorkingCopy(packet,workspaceId)`: full verification and counts, no write.
- `restoreWorkingCopy(packet,workspaceId)`: atomic missing-request merge, prior-view receipt and selected view replacement.
- `listWorkingCopyRestores(workspaceId)`: complete prior-view receipts.
- `packWorkingFile(file)` and `openWorkingFile(envelope)`: complete selected-file bytes/identity encoding and verification, no storage or transport.

IndexedDB version 2 preserves the original requests/views and adds restores. Metadata retains optional undefined error fields using an exact value/path representation. Original request arguments keep their strict canonical hash. Original native response metadata retains the browser's existing numeric representation, while source Files and native exact-number receipts remain complete.

The base journal and its request/File merge implementation derive from the independently reviewed complete Amero working-copy implementation, adapted to this actual Paycashless preimage. This does not reuse another product's workspace, requests or customer data.

## Actual receiving and rendered inspection

Use the existing original Paycashless commissioning owner and actual selected merchant case. No second native/provider programme is started by this feature. At desktop and narrow widths, operate every relevant form, keep an unfinished raw JSON edit, retain a selected file, download and inspect the complete working copy, make a later edit, restore and reopen. Verify the saved earlier view and exact selected/downloaded file bytes, the same original request IDs, and explicit-only imported recovery. Observe an invalid or wrong-workspace file rejection without losing current edits.

Actually LOOK at the rendered operator and downloaded files, use the controls, and open every relevant attachment before a customer/demo-ready claim. Source review and codec checks are not an actual browser or merchant commissioning result. Preserve the current source/runtime/operation IDs and actual outcomes in the original case.

## Retained application editions

New complete workspace deliveries include this guide and the app-local owner instructions in the `browser-working-copy-v1` source edition. Capture and receiving require every one of its 45 declared source members plus the complete manifest. Historical deliveries remain receivable only with the exact original 43-member source manifest (SHA-256 `e0b1368af2fca7dae0eba0b6019b9da66c97b11d997d182eff560e466225c077`); their source, runtime and immutable receiving receipts are preserved unchanged. An incomplete new source directory cannot fall back to the historical edition.

After reopening, verified retained files satisfy the three original file forms. Clearing a retained selection restores the required native file input. Every submission still checks and sends the selected complete original File through its existing request journal.
