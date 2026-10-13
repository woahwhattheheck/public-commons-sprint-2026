# Source-shaped return in the original Measurements workspace

Operation: ECO-WO46-SCIENTIST-SOURCE-RETURN-20261013. This is a separate browser module over the original native Measurements source-return routes. The original importer, measurement reviews, reach mappings and scientific calculators remain authoritative.

## Operator journey

Open **Source-shaped return** from Measurements. Choose the complete original files and any already-saved scientific results. Enter a return title and a source/decision note. A blank unfinished title can be saved and reopened; publication requires a title.

**Preview every selected source row** reads one exact workspace revision. The table retains the original column order and strings, including malformed surplus fields, and adds separate record IDs, review, eligibility, reasons and saved-result references. It displays 50 rows at a time. Search and paging change only the visible table; publication retains every original row. Leading blank records and full original mapping/provenance remain in Complete source accounting and the original file.

Inspect a row to see reported and normalized values separately, station/reach, constituent/fraction/basis, source date/time/timezone, censor bounds, review and eligibility reasons. A selected saved result keeps its own original revision. Its inclusion does not recalculate science or imply the current review matches an older result. Complete original JSON remains an optional download/detail.

The native publisher retains unchanged original bytes, the complete corresponding native project/context, all selected saved results and complete matching source collections. A supplied workbook remains intact. The literal-text companion remains available. For retained worksheet imports, delivery edition 3 also includes a reviewed copy of the original workbook with added source-bound review sheets. Its original worksheets, formulas, styles and macros are preserved; the exact original file is separately downloadable. CSV formula-sensitive strings are escaped for spreadsheet opening; the unchanged original and exact row JSON retain the source strings.

## Publication and recovery

Publication uses the complete original body:
expectedRevision, sourceIds, exportIds, previewSha256, title and note. Array order is retained. The edition ID is the SHA-256 of the maintained canonical object {format: 'upper-savannah-source-handback/v1', request: body}.

The browser latches its operation before any await. It retains the exact pending body and fingerprint, notifies the parent and downloads a small pending working file before sending. No second publication is enabled while that outcome is uncertain. A transport failure or malformed reply retains the request. Check original publication refreshes the native edition list and opens only the exact fingerprint and selection. If that successful lookup finds no matching edition, Resume exact original publication resends only the same retained body/fingerprint. It cannot start a different edition. Parent snapshot callbacks stop after child disposal, so a late failure from an old mount cannot replace newer retained work. The native publisher resolves an already-saved identical edition even if the scientific workspace has since advanced. A definite non-transient validation rejection clears the active pending request; its downloaded original working file remains.

The standalone child has no silent browser-storage fallback. The parent receives exact snapshots through onStateChange and must keep them in its existing workspace lifecycle. Save selection and unfinished title downloads the complete portable selection/pending envelope without requiring a network read. Reopen saved selection validates the whole candidate before replacing the current state and downloads the displaced working selection first. A failed receive leaves the existing work and exact selected file available. Selection changes and late reads are guarded; all current source and result IDs stay selected across catalogue refresh, even when missing from the newly opened workspace.

## Saved and returned editions

Open exact saved edition reads its immutable manifest and every member's byte count and SHA-256. Inspect saved source rows opens that edition's retained view, independent of current scientific revisions. Download complete verified ZIP checks the whole response's decoded bytes and SHA-256 before saving. Base64 admission uses a flat alphabet check plus exact trailing padding and canonical pad-bit validation; it does not recurse through a repeated-quartet regex. Individual saved originals are checked against their manifest member identities.

Receive complete return ZIP accepts the exact archive emitted by this feature. The original native receiver verifies the full members, original portable project/context and derived return. It retains a readonly edition without replacing current scientific measurements. Its original project.json can separately reopen through the original Measurements receive operation into an empty workspace.

The browser ZIP receive bound is 90 MiB, below the existing 128 MiB encoded JSON request ceiling. A larger archive must use the maintained source-handback-receive CLI with the complete original file. No subset is uploaded. Downloaded bundles are limited to 256 MiB in this browser module. Native CLI capabilities and actual available memory remain authoritative.

## Integration contract

New files:
- measurement_workspace/web/source_handback.mjs
- measurement_workspace/web/source_handback.css

Import mountSourceHandback from the first file. Its signature is:
mountSourceHandback(container, {request, refresh, initialState, onStateChange, css}).

request(path, method, value) is the existing Response-returning Measurements transport; the child passes relative paths beginning /handbacks or /sources. Do not pass the parent JSON-decoding api helper. The installed extension transport exposes ok/status/type/text rather than a full Response. Original CSV/GeoJSON downloads accept its exact UTF-8 text through TextEncoder when arrayBuffer is unavailable, and still verify the original SHA-256 (plus member byte count for saved originals) before saving. Edition 3 saved-member downloads use the native /handbacks/:id/member?name= route, returning exact Base64/bytes/SHA-256/type through this existing JSON transport. Binary workbooks are decoded as bytes and checked against the saved manifest; no binary companion goes through UTF-8 text conversion. The complete archive keeps the native Base64 bundle route. For direct fetch, keep the existing same-origin authentication, base path, headers and lifecycle signal. refresh is the original parent refresh callback after successful publication. css defaults to /measurements/source_handback.css.

The child returns snapshot(), refresh() and destroy(). The parent keeps a handback state variable, updates it from onStateChange and captures snapshot() before destroying the child on tab change. Remount with that exact initialState. Preserve the current 6A62 workspace.js result/source rendering and 22B7 guided intake; compose only an additional tab, child lifecycle and existing static-source registrations. Destroy the child with the parent.

Native routes:
- GET /handbacks: revision, retained sources, saved results and immutable manifests.
- POST /handbacks/preview: complete selected view with previewSha256.
- POST /handbacks: deterministic complete publication.
- POST /handbacks/receive: contentBase64 and whole-archive sha256.
- GET /handbacks/:id: full manifest, including selection and source member paths.
- GET /handbacks/:id/view: complete immutable row view.
- GET /handbacks/:id/bundle: filename, bytes, sha256 and contentBase64.
- GET /handbacks/:id/files?name=…: original raw member bytes.
- GET /sources/:id/original: original live-source bytes.

## Actual retained source and receiving

The five maintained original Eighteenmile WQP CSVs contain 533 records across SV-268, SV-374, SV-838, SV-839 and SV-840. Their exact 63 original headings were parsed without structural rejection. They contain no discharge characteristic and must not be presented as a positive concentration/discharge pairing. The existing DD6B/CB54 operated portable project and its retained result selection remain the original source pickup at 1791911361.436939 in the Eco parent. Do not invent reviews, result IDs, Tim files or a native result while that source is pending.

Source-only execution here parsed the full browser module and executed its actual pure working-file receiver with an unfinished empty title, exact pending request roundtrip and mismatched-pending rejection. This does not establish DOM behavior, native SQLite execution, browser appearance or recipient usability.

Use the existing original application course and current operator. Inspect actual 533-row source previews and any actual retained results; publish/download/open the full report, CSV, XLSX, JSON and archive; cold-receive the unchanged return ZIP into the original application and independently reopen its original project. Exercise an interrupted publication and recover the same immutable edition. Keep all existing scientific source and review IDs. No new controller, native queue or buyer message is created by this guide.

## Current owner direction and actual rendered-product rule

Read the complete repository AGENTS.md and opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md version 2026-10-13.4. The earlier morning cutoff is historical. The later post-call 52-order bank directs useful actual-file intake, preserved organization, human-readable results and scientist control. The temporary meeting browser hold ended under the owner's original release condition; preserve original browser owners and current active tabs instead of assuming an unused seat.

The following is the complete current root policy text received with this source:

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. For Ecosystem Sciences, read `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4`. Bryce's direct instruction at October 13, 2026, 10:46 a.m. Eastern renewed the existing work toward his call and superseded the earlier 10 a.m. cutoff. Preserve active workers, completed scientific outputs and all other standing controls while finishing and integrating the actual application.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


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


## Complete included-project preview

New delivery edition2 includes deliveryContext alongside the original row view. Before publication, the panel displays the counts for the entire included native project, explicitly including unselected imports/results, and every matching original companion collection/file with its bytes and SHA-256. Project and native-context identities remain available in details. The original request fingerprint formula is unchanged; previewSha256 binds this full delivery context. A changed matching companion inventory requires a new preview even when the scientific revision did not change.

A retained edition's Source rows view displays the same frozen inventory. Earlier edition1 returns retain their original rendering and receiving semantics; they are labelled as original editions instead of displaying a newly invented file inventory. The current server validates collection files against their native imports and compares all payload identities when a return ID already exists.

## Original workbook copies

See SOURCE_HANDBACK.md, delivery edition 3, for complete original-byte preservation, added review sheets, signed/protected originals, exact worksheet/physical-row lineage and the same-case source_workbook_course.mjs. Preview shows every original workbook, its retained preparations, added review sheets and unchanged-part count. Saved editions expose separate original, editable-reviewed, lineage and package-part downloads. These use the existing guarded member action and immutable saved manifest. Original edition 1 and 2 browser views remain supported.
