# Flowable customer Installation: following source editions

Continue the customer's existing Installation when a later complete Flowable workspace or programme edition arrives. Retain the prior preparation, its actual saved Installation, the current saved Installation, and the complete later preparation. Review source changes and field choices, then use the original native Preview and Save to append the next revision to the same Installation ID.

This workflow uses the existing Flowable archive reader and programme model, the existing Source Desk request journal, the existing browser working-copy journal, and the original SF47 Installation writer. It does not dispatch a process, case, decision or other native engine operation. It does not create a second Installation store. Existing operation recovery and customer Workshare ownership remain unchanged.

## 1. Prepare the actual source and choose the saved history

In the original Customer installations Source Desk, open the Flowable tab. Prepare the later source through its existing whole-workspace course: upload the complete NDJSON, inspect the actual saved programme edition, receive the original current Workshare seed and commissioning source, edit the bindings, and prepare the full source sidecars. Do not save a new Installation.

Open the prior completed preparation from saved requests. In **Following source edition**, use **Use open preparation as prior**. Open the later completed preparation and use **Use open preparation as later**. Alternatively select their actual saved request UUIDs from the complete saved-request inventory. Load further request pages when needed. A previously completed following preparation may be the prior preparation for another round; the later candidate uses the maintained initial preparer.

Use **Read saved Installations**, select the actual Installation, and **Read current Installation and historical revisions**. Select the historical revision produced by the prior preparation. Load older pages when required. The historical and current records are read by the authenticated original Python bridge, not accepted as caller-supplied HTTP JSON.

The bridge normalizes the complete prior prepared document through the original historical snapshot. Its entire result must equal the selected baseline Installation document. A shared Workshare name or matching programme ID is insufficient. If the Installation was edited before its first Save and no exact baseline exists, preserve the source and use its original authoring workflow to establish a genuine matched preparation; do not nominate an unrelated revision.

The later preparation must use this exact current case and plan, and the same original Workshare. It must select the same programme at an equal or later saved revision. The original full archive catalogue must retain the exact earlier programme record and SHA. A receiving workspace may have a different workspace UUID, which remains visible, while the original immutable programme record establishes retained lineage.

## 2. Compare full source and choose every changed field

Choose **Compare original, current and later source**. The comparison freezes the selected original preparation hashes, full historical/current native rows, current case/plan identity, full later source and programme views, and exact original record lineage.

The desk shows all selected file changes, including added, removed, unchanged and changed files; each original native operation and its later recorded state; both whole programme views; and the complete prior/later source identities. These observations come from the retained original archives. Preparing this comparison does not rerun those operations.

Explicitly acknowledge the complete later source. Then choose one branch for **every changed editable field**:

| Choice | Result |
| --- | --- |
| Keep current | Preserve the actual current saved value |
| Use later | Adopt the value in the later full preparation |
| Use baseline | Restore the value in the matched historical saved Installation |

The scope includes the Installation name, selected merchant/buyer deployments, task fields, source fields, payment fields and receiving fields. Arrays are selected as whole values. Concurrent changes remain visible; no text or array merge is inferred. A payment difference always needs an explicit selection even if only one branch changed.

The current native stage, workorder, assignments, acceptance checks, Workshare, workflow periods, coordination, commercial binding, use calendar, commissioning and effort remain preserved. Their baseline/current/later differences are shown read-only. Their original application workflows own changes. New source content does not mark checks accepted, authorize payment, allocate funding, or replace a commercial agreement.

Record the reviewer identity and a concrete source/binding decision. These are recorded operator statements; they do not establish independently verified human identity. Choose **Prepare chosen following edition**. All selected values and the full review remain retained.

## 3. Preview and save the same Installation

The prepared result appears in the ordinary complete-preparation area. Download its complete ZIP and exact receiving selection. Preview in the original case, open the reviewed Installation draft, inspect the full current document, and deliberately use the original Save control.

The preview keeps the actual Installation ID and expected current revision. Save recomputes the original native preview and appends revision + 1. It never treats the following edition as a new null-ID Installation. All previous saved editions remain available.

If the original case or current Installation changed after comparison, preserve the old comparison and choices and compare against the fresh source/current native records. Do not update a frozen request's version or silently replay its mutation.

The full working copy, raw original inputs, choices, reviewer/note, comparison and original request identities are retained through the existing Source Desk working journal. Reopen the saved working copy or completed request after interruption. The standalone following-working download is a complete review record; the full desk working-copy export remains the portable authoring course.

## 4. Original request recovery

Both following actions use the existing immutable request UUID and complete-input journal.

- An uncertain transport result is read through the original request lookup and retried with the exact same input and UUID.
- A completed Node preparation is retained even if the case advanced before the Python response returned. Its historical preview is not described as current. A fresh current native preview and, where required, a new comparison are explicit.
- A known editable input rejection remains retained. Use the existing control to keep that rejected request and prepare corrected input under a new UUID.
- Unfinished review selections and notes stay in the existing working copy. Source selection or history changes invalidate its derived comparison.
- Reopening a result cannot overwrite a different active working copy while an earlier asynchronous read is completing.

The authenticated routes remain inside the original case's staff session/CSRF boundary:

~~~text
POST /api/operations/{caseId}/flowable-sources/following-compare
POST /api/operations/{caseId}/flowable-sources/following-prepare
GET  /api/operations/{caseId}/flowable-sources/requests/{requestId}
GET  /api/operations/{caseId}/flowable-sources/requests/{requestId}/archive.zip
~~~

The first request contains priorPreparationId, laterPreparationId, installationId, baseRevision, expectedBaseSha256, expectedRevision, expectedInstallationSha256, expectedVersion and requestId. The second retains the same six native-selection fields plus comparisonId, basisSha256, choices, reviewer, note and its own requestId. Choices is an object keyed by the complete comparison row key; source-edition requires ACCEPT_LATER_SOURCE. Native snapshots are injected only by the original private bridge.

## 5. Complete portable preparation

The output directory retains both original preparations, including their metadata files and all earlier nested history.

| Member | Complete retained content |
| --- | --- |
| prior/ | Entire previous preparation, including prepare-request.json and preparation.json |
| later/ | Entire later initial preparation and every original source/attachment |
| prepare-request.json | Frozen native selection, comparison inputs, review and complete nested file identities |
| preparation.json | Completed output inventory and exact source/native summaries |
| FLOWABLE_FOLLOWING.json | Full comparison, baseline/current native rows, choices, review and source lineage |
| FLOWABLE_CUSTOMER_SOURCE.json | Complete selected later source report |
| FLOWABLE_SOURCE_SELECTION.json | Compact exact source selection plus following history references |
| installation-input.json | Full chosen native Installation document |
| installation-preview-input.json | Same-ID/current-revision native preview selection |
| WORKORDER.md | Opening, native Save and full independent receiving instructions |

The mandatory current archive is later/source/flowable-workspace.ndjson. Prior archives remain under prior/ and any nested earlier preparations. Selected original output bytes are under later/delivery/files/. Existing commercial JSON/HTML/Markdown and all additional customer files remain in their full original preparations.

Cold reopen checks every nested byte identity, invokes the original archive inspection/adoption, reproduces the full comparison and chosen output, and compares the entire completed metadata object. It does not accept a changed summary merely because file bodies still match.

Use the direct source CLI when operating an exact retained native input:

~~~sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/flowable-installation-following.mjs prepare \
  --directory "$FOLLOWING_PREPARATION" \
  --prior "$ORIGINAL_PREPARATION" \
  --later "$LATER_PREPARATION" \
  --input "$PRIVATE_INPUT/following-native-input.json"

node stellar/scf_2026/sf49_data_commissioning/installation-workorders/flowable-installation-following.mjs reopen \
  --directory "$FOLLOWING_PREPARATION"
~~~

The input holds full native, selection and review objects from the original private bridge. It is not a substitute for native saved-row authority. The service/browser course supplies those objects without manual reconstruction. Paths are absolute private owned directories, outside installed source and separate from each other. The whole source chain is limited to 24 nested editions and the existing 8 GiB aggregate receiving allowance; no archive is truncated or replaced by a manifest. Original per-file and case attachment limits remain unchanged.

## 6. Independent complete receiving

Use the **existing** flowable-installation-receive command and its original input schema. Set preparationDirectory to the extracted complete following directory and expectedPreparationSha256 to its exact preparation.json identity. The browser receiving selection supplies the hash and file inventory; choose the actual extracted directory. HTTP does not expose a private server path.

An explicit save:{requestId,note} invokes the original Preview and Save at the prepared same ID/current revision, yielding the next revision. Alternatively supply the exact already-saved installationId and installationRevision = reviewed current revision + 1. The receiver preserves the original stable request and phase records.

The existing complete receiver copies every root and nested member, checks the actual baseline/current/successor Installation rows, exports the full original SF47 case, imports it independently, and compares all original source and saved history. It adopts each distinct full Flowable archive into one independent Flowable receiver. Every immutable manifest record and every selected programme/source edition is checked again after cold reopen, including distinct selections from the same archive. Old native basis hashes remain historical observations, not a claim that later legitimate work can never advance.

Use the same original equipped receiving operation. Do not launch another Flowable engine or create another Installation controller for this course. Preserve B43A's native-job recovery and the original Flowable owners.

## 7. Exact outgoing product use

Operate the actual saved baseline/current/later course in the existing Source Desk at the screenshare width and at 390 px. Inspect populated, empty, loading, validation failure and interrupted-request states. Choose a current payment against a differing later proposal, select a later source reference, keep current accepted native work, reopen the working choices, and verify the same-ID draft and Save. Download and open the full ZIP, review both original commercial attachments and every applicable outgoing source/report, then independently reopen the delivered complete case and source.

Source-level review and focused pure-module execution establish implementation evidence only. They do not claim native saving, successful customer receiving, viewed screenshots or rendered acceptance. The existing producing operator must perform and observe the exact delivered course and repair concrete defects.

## Producing operator instruction


This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949
