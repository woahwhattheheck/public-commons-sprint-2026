# Review findings across a changed audit revision

Operation: AUDIT-REVISION-IMPACT-REVIEW-24EA-20261013

This following feature continues the original Audit Exchange workspace. The same original XML, revisions, native review records, pending request/CAS journal and complete application exporter remain authoritative. It adds a staff workflow for deciding what an earlier finding means after the underlying XML changes. It never automatically resolves or moves a review.

## Work through the changed source

Open **Review following revisions**. Choose the original source and select retained reviews on earlier revisions. Reviews already on the current revision are excluded. **Preview selected earlier reviews** reads the actual current source/review heads and freezes one complete comparison. You can review up to 250 findings at once; each distinct earlier XML revision is compared with the target once.

Open a finding in Reviewed decisions. The source details show its complete earlier review/history, the earlier entity and the entity at the same current structural path, all changed scalar values and incoming/outgoing references within its entity and descendants, the whole source comparison, and both earlier/current validation. Ambiguous references retain all original candidate targets. A same-path entity is an inspection aid: duplicate IDs, changed identities, moved/removed entities and source diagnostics remain visible. It is not an automatic match or an assertion that the issue is fixed.

Choose **Retain on the earlier revision** with a reason, or **Review and update on the current revision** with a reason. An update requires an explicit current entity or Whole document and complete title, status, assignee, due date, note and evidence. You may carry an open finding, reopen a previously resolved one as investigating, update its evidence, or deliberately resolve/accept it based on your review. Those are operator decisions. All prior review fields, original revision, actor and evidence remain in the native review history.

**Keep complete decision** retains the unfinished work. **Apply explicit decisions and download source archive** requires a reason for every selection and a current preview. All selected changes use the original review.save implementation inside one existing SQLite transaction. Retained earlier reviews remain byte-for-byte unchanged. A failed review, stale workspace version or changed source/review head rolls back the whole apply. Original request replay precedes CAS, so retrying its exact accepted UUID returns the original result without applying it twice.

The result ZIP contains OPEN.html, the complete native preview/decisions/before-and-after review history and every selected complete earlier/current XML. The existing manifest binds every file by bytes and SHA-256. Nothing is omitted or reduced to excerpts. The selected XML total is bounded at 512 MiB, the complete native preview at 64 MiB; a capacity refusal leaves the original project unchanged. Choose fewer revision groups when necessary.

## Keep unfinished work and recover an interruption

Every field is saved to this browser's IndexedDB working-copy store as you type, including unfinished evidence lines. Saving compares that copy's original version. A competing tab's update is preserved and this tab is saved as a separate complete copy. Browser quota/storage failures keep the page contents available and the complete working-file download enabled, while blocking native apply until the work is retained.

Use Download complete working copy before changing browser or origin. Open a saved browser copy, or import the complete working JSON into the same original workspace. Import creates a separate copy. Its retained preview is hash-checked before display; native apply recomputes the actual preview and still requires the original workspace/source/review state. An imported working file is not a native acceptance receipt. Only the actual retained original workspace export establishes an applied result.

A new preview creates another saved working edition. Earlier decisions remain available in the previous copy. If the source/reviews changed, explicitly review the new preview and author its decisions; the UI does not silently copy decisions into a changed source.

The original installed application retains the exact full mutation envelope before dispatch. If a response is lost, use its retained request banner or original complete request file. Recover the same UUID/body. Recovery downloads the already accepted archive. An unrelated pending request remains intact and must be reconciled through its original workflow.

The earlier and current workspaces keep their normal version checks and leases. No draft editor or apply helper clears an uncertain request or invents a replacement identity.

## Hand over the complete original work

History lists every retained revision-review archive. Received archives are labelled with their original workspace. Their decision review IDs remain historical original IDs, even though the complete editable receiver creates new local operating record IDs.

Download an applied archive, extract it and open OPEN.html. Open its complete decision JSON and selected XML in the recipient's ordinary viewers. For editable onward work, use the existing full application/workspace export. That exporter automatically includes each complete revision-review ZIP as an ordinary retained output. The original receiver validates every object and XML revision, rebuilds native views, preserves prior review histories and keeps the original archive bytes. The received workspace can reopen and reexport the whole case.

This does not replace the colleague-correction return, recipient manuscript/preview/apply or ordered recipient queue. Their original source generations and requests remain selected until their owners complete those courses.

## Native, CLI and MCP

The original dynamic catalogue exposes:

- audit_review_transition_preview: sourceId, toRevisionId, reviewIds.
- audit_review_transition_history: no arguments; complete retained archive metadata.
- audit_review_transition_apply: the same selection plus previewSha256, decisions, actor, note, requestId and expectedVersion.

The native read envelope is {"action":"review.transition.preview","inputs":{"sourceId":"ACTUAL_SOURCE","toRevisionId":"ACTUAL_CURRENT_REVISION","reviewIds":["ACTUAL_REVIEW"]}}. Use the existing application.py action --directory /absolute/original-workspace --request-json /absolute/request.json, existing Node CLI, client or MCP; there is no separate adapter/CLI.

A decision is exactly {"reviewId":"ACTUAL_REVIEW","mode":"retain","reason":"Reviewed reason"}, or {"reviewId":"ACTUAL_REVIEW","mode":"update","reason":"Reviewed reason","review":{"entityKey":"ACTUAL_CURRENT_ENTITY_OR_EMPTY_WHOLE_DOCUMENT","status":"investigating","title":"Complete reviewed title","note":"Complete reviewed note","assignee":"Actual assignee","dueDate":"Reviewed literal date","evidence":[{"label":"Complete label","url":"https://actual-source.example/"}]}}. Preserve the preview's complete review order.

## Following original native/browser receiving

AUDIT_REVISION_REVIEW_RECEIVING.py runs only after the actual original queue course is complete. Its exact predecessor COMPLETE/RUN_RESULT and archive identity, both operation leases, original author workspace, full following 82-file application and explicit selection are frozen before native work. It borrows the original native server, original request helper, owned-child drain and complete archive saver. It never rewrites the preceding 72/77 source generation or their INPUT/request/results.

Supply a complete private selection JSON with exactly workspaceId, sourceId, toRevisionId, reviewIds, decisions, title, note and actor. Obtain these from the actual completed author's current source and earlier review rows. Do not guess IDs or label a fixture exercise as customer work. Decisions are the actual operator's intended review. If there are no earlier retained reviews, there is no eligible following selection; preserve the completed predecessor and use this feature when a real subsequent source revision needs review.

Run in the same selected equipped native lifetime:

~~~sh
python3 AUDIT_REVISION_REVIEW_RECEIVING.py \
  --completed-queue /absolute/completed-original-queue \
  --directory /absolute/following-revision-review \
  --selection /absolute/full-reviewed-selection.json \
  --chromium /absolute/current-verified-chromium \
  --playwright-module /absolute/current-playwright-module \
  --node node
~~~

The whole course operates the actual installed controls, retains and reopens unfinished decisions, compares the native preview, applies the complete decisions with an accepted-response interruption and exact original recovery, downloads/reopens the archive, and captures desktop/narrow screens. It then checks native before/after scope and exact request replay, exports the whole original application, independently receives/reopens it and reexports the complete received case. A saved BROWSER_RESULT is verified and reused; RUN_RESULT resumes packaging only. The first before/after observations are preserved across the course's own later export.

Its screenshots are real outgoing-version captures but are not themselves a visual acceptance. The responsible producing operator must view them and open/use all downloaded attachments before claiming recipient-ready. Source review and JavaScript parsing in the authoring lane do not establish a completed native/browser run. The existing6804 operation remains the execution owner; this following source is selected only after its predecessor actually finishes.

No GitHub Actions or paid compute is dispatched by this product or receiving course.


<!-- bryce-rendered-product-inspection:begin -->
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
<!-- bryce-rendered-product-inspection:end -->
