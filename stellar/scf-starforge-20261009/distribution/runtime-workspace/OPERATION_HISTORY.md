# Original operation history

The **Operations** desk searches and pages the original Runtime operation records.
It retains the actual request IDs and links to their existing Runtime, managed
home, Application, source build, Python operation, transfer and image controls.

## Find, inspect and continue existing work

Use **Find an operation** for an operation name, UUID, runtime, Application,
managed home, image or source-build identifier. Every word must match the
retained descriptor. Select **Active or queued**, **Needs attention** or
**Completed**, and optionally the actual runtime. The counts describe the whole
workspace; the matching count describes the current filters.

A page contains at most 20 rows. **Older operations** advances from the last
original creation-time/UUID pair. **Previous page** restores the previous boundary;
**Latest results** restarts the live selection. New work and status changes remain
visible in the current workspace. A filter change starts a new page selection.

**Open complete operation** reads that original operation through the existing
status reader and exposes its complete result, errors and original record fields.
**Download complete operation JSON** saves the complete opened API record.
**Open original worker output** uses the existing worker-output viewer. The
original row actions continue the same retained request or open its owning
workflow. Starting another command remains an explicit action in those controls.

Filters, page boundaries and the selected operation are saved per workspace in
this browser. Reopening reads the current original operation again. A late
response from a different workspace or selection cannot replace the visible
record. A failed refresh preserves the previously opened complete record and
shows the read failure; **Refresh selected operation** retries that same read.

## Native and authenticated API use

```sh
starforge runtime-workspace operations --workspace /private/runtime --filter attention --limit 20
starforge runtime-workspace operations --workspace /private/runtime --query managed-run --runtime-id RUNTIME_ID
starforge runtime-workspace operations --workspace /private/runtime --filter attention --cursor ORIGINAL_NEXT_CURSOR
starforge runtime-workspace operation-status --workspace /private/runtime --operation-id ORIGINAL_UUID
starforge runtime-workspace operation-log --workspace /private/runtime --operation-id ORIGINAL_UUID
```

The existing workspace model adds `operationHistory({query, filter, runtimeId,
limit, cursor})`; HTTP callers use authenticated `GET /api/operations` with
those query fields. Limits are whole numbers from 1 to 100. A cursor binds the
workspace, normalized search, status filter and runtime. Continue with the same
selection and its returned `nextCursor`; changing a selection starts without a
cursor. Returned fields include `items`, `total`, `matched`, whole-workspace
`counts`, `hasMore` and `nextCursor`. Items are compact original descriptors;
`resultAvailable` and `commandResultAvailable` identify retained full results.

The existing `state()` and `GET /api/state` remain full by default.
`state({operationDetail:'summary'})` or the matching HTTP query requests compact
operation descriptors. The browser uses compact activity outside the Managed,
Images, Transfers and Source Builds panes; those consumers continue requesting
their existing complete results. The selected operation always uses the
original full `operationStatus`/`GET /api/operation-status` endpoint.

## Restored workspace reads

Each overview or original-operation observation batch now owns one short-lived
receiving reader. The first required lookup reads and validates the original
receiving marker and workspace identity; subsequent records in that same batch
share indexed operation, runtime and managed-home selections. Binding validation
checks the complete original verified runtime/directory pairs once.

The Runtime list, Operations, Application overview/history/output, and Managed
home overview use that context. Application groups share it with their original
member observations where that workflow is installed. Every new refresh creates
a new reader. A context from another workspace is rejected; no context is saved
in the workspace, sent over HTTP, or retained as a cross-refresh cache.

Original Application head bytes are still reopened and hashed on every
classification, so saving a reviewed current-host successor immediately stops it
matching the archived head. Process identities, kernel leases and RUNNING-state
rereads remain live. The existing strict write, dispatch, stop, recovery and
receiving guards always reopen their current marker independently.

The original receiving phase records actual received-history IDs and bindings
from its current workspace, alongside complete source identities. Continue that
same phase on the current receiver after a restored workspace is opened. It
retains the original browser, directory, operation and source selection. Open
and look at its exact desktop/narrow screens and downloaded original records as
described below.

## Source reuse and current observations

Only unchanged original JSON bytes are reused. Each read opens the original
path with the existing no-symlink admission, validates a regular file within
4 MiB, and checks the opened file's device, inode, size and nanosecond change
times before returning a cached value. A changed file is read and decoded in
full, with a second opened-file identity check. Missing optional records remain
missing. Invalid JSON, file replacement or a native read error follows the
existing observation-error path.

The cache retains at most 128 original records and 8 MiB of source bytes per
open workspace, with least-recently-used eviction. Closing that workspace
clears it. Full legacy callers receive detached values. Compact reads copy
descriptor fields and never return cached result bodies.

The original four-slot operation reader continues sharing in-flight reads and
running current process/lease probes. It still rereads a RUNNING state after its
probe and observes a newly completed state. Cache reuse cannot establish worker
liveness, grant a mutation, bypass a lease or change a recovery request.

## Continue the existing native receiving operation

The existing `receiving/APPLICATION_INPUT_SETS_RECEIVE.mjs` programme now
includes `receive_original_operation_history` after reopening its complete
original workspace and Application. Invoke the same original command, case
directory, companion folder, runtime and browser paths. Existing completed
phases remain retained, and the new phase uses that restored native history.

Other current Runtime receivers can import
`receiving/OPERATION_HISTORY_RECEIVE.mjs` and call
`receiveOperationHistory({page, model, outputDirectory})` on their already
opened actual workspace. The helper does not create jobs or history fixtures.
It traverses actual history, reads the authenticated API, operates search and
paging when present, downloads a complete selected original record, reopens the
selection and records desktop/390px screens. Its temporary failed-read route
only exercises the browser's existing retained-value behavior; native records
and commands remain untouched.

All returned source hashes, complete JSON, download bytes and screenshots stay
under the caller's original private output directory. Zero-operation workspaces
are recorded as such. A returned `AWAITING_OPERATOR_VIEW` means the saved
screens still need to be opened and inspected. Keep the same receiver and join
its actual viewed result into the original Runtime thread.

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
