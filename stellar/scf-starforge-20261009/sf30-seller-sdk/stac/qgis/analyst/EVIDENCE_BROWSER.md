# Evidence browser operation and rendered review

This component extends the original QGIS analyst. It preserves the Capture pane and original project, authentication, journal, native worker, source, map, field and export routes.

## Source and file contract

Select **Evidence** in the original application navigation. Its sections are **Sources**, **Case & subjects**, **Findings**, **Later sources**, **Spatial**, **Reports** and **Recovery**. The original workspace header remains the place to enter the responsible analyst. All operational fields use typed forms. Complete original objects are available in lazy read-only inspections and downloads.

**Sources** accepts one original file up to 128 MiB through the existing upload API. It preserves the original upload ID, manifest and exact 8 MiB chunks; reselecting the file verifies existing chunks before continuing. A completed upload returns the original file path and full inventory. Inspect its original bytes, record the source role, issuer, jurisdiction, series, edition, dates, retrieval timestamp, media type, coordinate reference, document scope, query and coverage, then save. An original source is downloadable by its immutable record ID.

PDF references carry the original zero-based source page position separately from printed page and section. A free-text locator remains required. Effective/preliminary FEMA, LOMC, DNR best-available, ordinance, survey, parcel, structure and proposed-improvement sources keep separate roles. A GeoJSON or Esri response remains in its original representation. Local source-page completion is never represented as whole-publisher-dataset completeness.

## Cases, subjects and actual native maps

**Current case** selects an exact logical case. **Prepare new case** retains prior drafts and opens the new-case draft. Every case edition includes the complete subject list, purpose, proposed use, scope, as-of date, source references, assumptions and professional questions.

A subject may be documentary, selected from an original GeoJSON/Esri feature response, or bound to an actual completed native map.features request. Original feature position/hash and source file hash remain distinct from the actual business parcel ID. The selected original field must hold that business ID. Native bindings retain the original request, map/project, layer and native feature ID; staff add explicit source references before case save.

Feature pages are 25, 50 or 100 retained rows. The complete publisher response coverage/transfer-limit metadata is available beside the page. All original feature properties remain inspectable. Case subjects distinguish parcel, structure, proposed improvement and area.

The original **Maps** pane creates and renders real QGIS maps. **Spatial** accepts two subjects already bound to actual native map observations and an explicit projected measurement CRS. It submits the original evidence.spatial request. The returned predicates, intersection, measurement units, original source and native transform remain inspectable. Source/agency applicability and professional conclusions remain named findings.

## Findings, source succession and reports

**Findings** presents saved status separately from the current source-review state. Staff can prepare a complete original finding or a successor of an exact finding version. All statement, applicability, assumption, subject, source-reference, reviewer, time, next-action, responsible-role, due-date, answer, answer-reference and correction fields are retained.

**Later sources** compares two original editions of the same declared series. It retains the complete changed metadata and affected subjects/findings, including indirect subject citations. Every affected finding receives one explicit KEEP_EARLIER, REVIEW_REQUIRED, ADOPT_LATER or WITHDRAW decision with a reason. Adoption/withdrawal uses the complete replacement finding form; adoption requires the actual later source citation. The case/subject source edition remains an explicit successor decision.

**Reports** freezes the exact current case. Staff may select up to 20 existing completed native render request IDs; the original engine validates that those renders belong to the case's native projects. The full report, readable HTML, complete case JSON, findings CSV and action CSV are downloadable. Saved report bytes are never regenerated on download. The complete editable workspace export carries original source files, native maps, all evidence histories, saved operations and receiving software.

## Draft and original-operation recovery

Evidence drafts live in IndexedDB under the original workspace ID. Each draft retains its complete form body, original project revision and exact case/finding head basis. Refresh waits for pending draft persistence. Another tab's newer draft causes a visible conflict; the local body remains downloadable. Staff can inspect and explicitly adopt the saved draft or retain their body while explicitly adopting the reviewed current basis.

Before POST, the exact original request UUID/body and synchronous form/selection snapshot are retained atomically. Cross-tab dispatch and archive use the same Web Lock and IndexedDB original-request checks. A different unresolved request cannot be overwritten. Complete outcome receiving retains the full request, dispatch history and returned operation before clearing pending. Subsequent form edits and unrelated case selections remain untouched.

RUNNING operations are received under the original ID while the pane is active. Leaving the pane cancels its next poll; reopening preserves the same pending request. An unreadable response remains uncertain. A NOT_FOUND result offers an explicit same-request retry. A definitely unperformed archive is allowed only when there were no dispatch attempts or every retained attempt was definitively rejected; an earlier ambiguous attempt is never erased by a later rejection. Interrupted server operations use the original continue endpoint and input hash.

Recovery download includes all drafts, upload manifests, original pending request and complete receipts. Import is bound to the exact workspace, joins missing records and leaves conflicting local records intact. A concurrent edit during file reading prevents silent import replacement. Complete server state is exported through the original project handover, independently of browser drafts.

## Actual desktop and phone inspection contract

Use the existing private application launch URL, then enter the named analyst and click the navigation button **Evidence**. The component root has data-testid="evidence-workbench". Use accessible roles/names for all controls; field labels wrap their actual inputs.

The complete rendered course must operate the original accepted case at desktop width and **390 px**, inspect the actual source records and native map output, and check resulting files before calling the UI ready. Syntax/source review alone is not rendered acceptance.

Exact visible selectors/actions for the original operating course:

1. **Current case** selects the logical case; **Refresh saved evidence** receives current source state.
2. **Sources** → source-title button → **Complete original record**, plus **Download original file**.
3. **Case & subjects** → **Inspect complete original case and all history**, exact feature/native-page controls, and **Save reviewed successor case** when intended.
4. **Findings** → finding-title button → **Save complete named review**. Observe both **Original review status** and **Current source review**.
5. **Later sources** → **Earlier source**, **Later edition from the same declared series**, **Inspect all impacted current decisions**, all treatment/reason/replacement fields, **Save every reviewed source decision**.
6. **Spatial** → two native-bound subject selectors, **Reviewed projected measurement CRS**, **Run native geometry observation**; inspect original measurements and method.
7. **Reports** → **Read existing completed map renders**, exact original render checkboxes, **Build complete frozen report**. Download the original report ZIP and open the actual rendered map.
8. **Export complete editable workspace**, preserve that original operation, independently receive it through the original **Transfers** pane, then reopen the same evidence history.
9. **Recovery** → **Download complete browser recovery**. Exercise reload/receiving, two-tab conflict preservation, and a failed read without losing the current draft.

At 390 px, tabs wrap, fields use one column and full source tables scroll inside their own focusable frame. Inspect long business IDs, original source URLs, source page fields, error notices, finding replacement forms and report-download controls. Preserve readable controls without page-wide horizontal overflow.

## Composition

Add evidence.js, evidence-store.js and evidence.css to the original static/source inventory. The narrow app.js postimage is based on Capture merge 338a40976c9f6a9588a1d4055849677c45dc1a96, original app blob 7800cbac2819d4db1ea3e86ffd6d4ea3e69e9249. It adds one module import, one self-hosted stylesheet, the Evidence tab and the original host context; existing Capture callbacks and other panes are preserved. No inline styles or scripts are required by the component.

## Original request binding and reachable drafts

Before the first POST, the browser materializes the original export directory and documented native/spatial/path defaults. A returned operation must match its complete saved workspace ID and directory, action, payload, analyst and revision. The first matched original input and input SHA are retained and cannot change on later receiving/continuation. Recovery lists every saved draft with **Open saved draft**, including newly prepared unsent findings; opening preserves its original case/head basis. Asynchronous source-driven rendering holds the form inert under the current render generation so replacement cannot race fresh input.

## Owner-directed rendered-product inspection

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.

## Parcel evidence operator and receiving

Use the existing QgisWorkspace, its analyst request journal, source-native QGIS engine, complete project export and cold receiving. Preserve source editions, exact publisher IDs, coverage and page scope, analyst request identities and current concurrent parcel/capture writers. All case, finding and source adoption changes retain their original revision/head basis; recover an uncertain operation with the same full request before proposing another. Render and operate the exact populated Evidence pane, report, downloaded and reopened application at desktop and 390-pixel widths before a client-facing delivery. The current operating and receiving course is PARCEL_EVIDENCE.md and evidence-native-receiving.py.


## Every outgoing attachment

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and project as its recipient would. For archives, extract and open the actual contained deliverables and working project. Tests, checklists and screenshots merely captured are not substitutes. Use available high-quality generative media models and natural voice generation/TTS for videos; avoid robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment. Keep building and fixing; inspection is not review/test performance theatre.
