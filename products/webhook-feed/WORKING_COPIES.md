# Publisher working copies

Use **Webhook event operations** to edit a source, feed or the full native merchant plan. Open the original private workspace URL. The existing source store, validators, signed event receiver, pricing compiler and native save endpoints continue to own the actual publisher.

## Prepare and keep complete work

Each page opening starts a separate private working copy bound to the native store ID. Source and Feed forms retain incomplete text, every projection row, selected sources, enabled state and the exact native revision that was selected for editing. The **Retained source drafts** and **Retained feed drafts** controls reopen any draft in the current copy, including unsaved new definitions. Selecting a saved native definition returns to its retained draft when one already exists. Refresh updates native status and lists while keeping the original draft and its baseline.

The browser stores working copies locally under that store ID. Open **Working copies**, give the copy a useful title, and download the complete JSON before moving hosts or closing a browser whose storage is unavailable. A new working copy retains the earlier copy. Browser records belong to their original browser origin; a runtime restarted on a different port needs the exported JSON or the earlier original origin to reopen those drafts.

The portable JSON includes all current drafts, selected draft identities, complete preceding checkpoints, native request bodies and saved or uncertain results. It contains no listener bearer token, environment secret value, private event body or SQLite database. Treat definition names, payment terms and operating history as private customer material. The original Continuity snapshot remains the complete publisher backup; a working copy is the editable commissioning document.

## Merchant terms

The full native merchant-plan JSON is the authoritative editable input. Every original feed-specific payment and paymentOptions entry remains present. An existing heterogeneous plan is never reconstructed from its first payment. The existing SF30 compiler validates the entire selected plan on Save.

The optional **Prepare common terms for selected feeds** form produces a new full plan draft from explicit selections. Its action retains the preceding draft in a complete checkpoint, replaces only the working text and performs no native save. Review the full JSON before selecting **Save full merchant plan**. Normal application restart continues to bind the saved release; changing a draft does not change an operating merchant.

## Save and recover the original request

Save first writes the exact request, original expected revision and attempt identity into browser storage, then calls the existing native endpoint once. If browser storage is unavailable or full, the desk keeps current in-memory input and offers a complete JSON download; it does not begin a native write whose request could not be retained.

While a call is pending, the selected forms and navigation controls are frozen. The retained attempt remains attached to its original store, draft, definition identity and payload. A successful response advances the native baseline while retaining its full request and result.

After a transport interruption, reopen the same working copy and use **Inspect saved revision / recover**. The desk reads the original native store:

- If the original requested definition is currently present, retain that observed native revision and complete the local reconciliation.
- If the original expected revision is still current, **Retry exact original save** submits the saved body unchanged with the same native revision check.
- If native content changed, review the full current content, original baseline, working input and attempted requests. **Use reviewed current revision, keep my draft** retains a preceding checkpoint and the old attempt, then selects the inspected revision without changing the working input or writing native content. Compose and explicitly save the resulting draft.

A fresh read must still match the inspected revision before adoption. The original native endpoint rejects a stale different definition and reuses an identical current definition. Reconciliation establishes which complete content is currently saved; it does not invent a historical request-table receipt that this original store does not provide.

Native validation errors remain in the attempt history. Correct the input and save again. A server failure or lost response stays pending until the original content is inspected. Changing or reopening another working copy never dispatches a retained request automatically.

## Receive a complete working copy

In **Working copies**, select the complete downloaded JSON. The desk validates its structure and exact native store binding, then shows the entire received record before accepting it. **Open separate editable copy** first retains the departing copy and its checkpoint, then opens a new local identity with the full received history. It preserves the original received identity as provenance. A copy for another native store must be opened with that store.

Inspect current native revisions before resuming saves. Imported pending actions retain their complete original bodies and need explicit reconciliation. The original JSON and preceding local record remain available. To edit the same store from another browser, transfer the full JSON; browser storage itself does not cross origins or machines.

Working records have an 8 MiB logical receiving limit, with up to 16 MiB of encoded JSON accepted for inspection. Keep complete exports and begin a new copy before long revision histories exhaust that allowance. A storage failure leaves the full in-memory content available for rescue download. An oversized in-memory rescue is explicitly named and labeled; it preserves all bytes for source-assisted recovery and exceeds the ordinary import limit. The desk does not promise that ordinary Open can receive that oversized file.

## Complete receiving course

Use the original publisher/store/runtime and its selected source. The maintained `products/webhook-feed/receiving/working-copies.mjs` continues the actual completed publisher course, using its existing request, customer store and original lease:

```sh
node products/webhook-feed/receiving/working-copies.mjs \
  --source /absolute/selected/merchant/source \
  --commissioning /absolute/original/commissioning/operation \
  --directory /absolute/owned/working-copy-receiving \
  --chromium /absolute/installed/chromium \
  --playwright /absolute/installed/playwright/index.js
```

The predecessor is the full 62-source publisher programme at Commons `business/scf_webhook_event_operations_20261013`. Its whole original operation, request and customer store must finish first. The browser successor writes two complete working-copy JSON files, populated desktop/narrow screenshots and one complete result, then closes its own browser/listener. It introduces an explicitly authored unsaved multi-option plan to check complete draft preservation; it does not publish those illustrative terms. The two native source-label saves occur only in that original commissioning customer's example workspace. Open and inspect the returned actual screenshots before presenting the browser.

### Retain the actual course and finish its accepted result

The receiving directory belongs to this same original commissioning operation.
Before starting its host or browser, the receiver retains `COURSE-DISPATCHED.json`
with the original request and commissioning-result digests, store/operation IDs,
and selected executable/browser source identities. Reopening a directory with
that marker but no complete accepted result does not repeat the native source
label saves or the browser course. Preserve its partial outputs and reconcile
the original operation with its existing owner; starting another output directory
is not a substitute for that reconciliation. A legacy directory containing
course outputs without a complete result is also held for original-owner review.

After the actual course passes and its browser and host have closed, the receiver
verifies every outgoing file and retains the complete result in
`COMPLETE-ACCEPTED.json`, including its actual original completion timestamp.
It then publishes `RESULT.json` through a fully written, fsynced stage and a
no-replace hard link, followed by directory synchronization. A file publication
interruption reopens the exact accepted completion and finishes only the result
artifact. It does not start a host, browser, source save or new course, and does
not regenerate the accepted timestamp. Existing completed legacy results remain
valid when their original operation/store and every full output still match.
Different existing bytes are retained and rejected, never silently overwritten.

Exercise one whole useful operator course:

1. Open an existing source; edit its label and leave a new second draft incomplete. Switch drafts and refresh. Both full inputs and their original revisions remain.
2. Open an existing feed. Change its projection and page-byte bound; switch away and return. The complete ordered projection remains.
3. Open a full merchant plan with different payment options on its feeds. Reopen it unchanged, prepare explicit common terms, and inspect the preceding full checkpoint before deciding which draft to save.
4. Save a source, preserving its original native request and returned revision. Interrupt a save response after the native writer commits; inspect the original saved content and reconcile that same attempt. If another operator changes the native definition, inspect and explicitly adopt the current revision while preserving the local edit.
5. Download the full working copy, close the page, open the original private runtime URL in a fresh browser context and review/import that exact file. Reopen every selected draft and its request history. Confirm that import itself writes no source, feed or merchant plan.
6. Open the actual populated desktop and narrow views. Inspect the rendered screenshots, important controls, long source names, full JSON and recovery/error messages. Download and independently reopen each outgoing working-copy artifact. Keep the original private publisher snapshot alongside its separate editable commissioning file.

This is an extension of the existing 22B7 publisher operation. A66C/B028/F3BE retain original source and paid subscriber custody; Analysis/Event programmes and customer-agent registration keep their existing owners. The earlier 62-file receiving edition remains frozen until the accepting operator deliberately selects this full browser successor.

## Current rendered-product instruction

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
