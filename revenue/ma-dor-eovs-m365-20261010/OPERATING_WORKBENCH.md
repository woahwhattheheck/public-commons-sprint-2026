# Migration workbench — operator guide

The workbench brings original file-share inventories, Migration Manager reports, reviewed mappings, item evidence and correction decisions into one editable project. It includes a local browser interface, streaming original-file intake, SQLite reconciliation, readable review reports, complete finding exports and an independently reopenable delivery.

It extends the original migration audit in this directory. The original audit.mjs and audit.test.mjs keep their existing strict input contract. Use the operating workbench when real reports contain partial, missing or unknown fields.

## Current navigation and case workflow

Sources, Rounds, Mappings & evidence, Reconciliation, Corrections and Handover & history retain the original file-evidence workflow below. **Cases & cutover** adds six views in the same project: Source mappings, Destination plans, Rehearsals, Finding decisions, Cutover and All case records.

For a case migration, import the actual originals in Sources, review the complete field projections, select explicit source editions and cutoff/status policy, reconcile independent target inventories separately from loader receipts, then record finding responses and cutover tasks. [CASE_MIGRATION.md](CASE_MIGRATION.md) gives the full operator sequence, request shapes, exports and customer-return steps. [CASE_RECEIVING.md](CASE_RECEIVING.md) describes the complete actual-input native programme.

Expand the Cases working-file panel to download or restore complete form drafts and original pending commands. These browser drafts are separate from accepted SQLite records. A conflicting tab preserves its own downloadable work; load the selected saved edition explicitly.

## Typed registers, financial reporting and property continuity

**Registers** adds reviewed typed field mappings, original source/target populations, explicit relationship and financial-control selections, two-edition comparison, finding decisions and attributed cutover review. It uses this same project's source intake and original request history. [REGISTER_OPERATOR.md](REGISTER_OPERATOR.md) explains the complete interface; [REGISTER_MIGRATION.md](REGISTER_MIGRATION.md) gives its domain contract.

Each register retains exact textual identity components and explicitly selected text, decimal, date, datetime, boolean or JSON fields. Signed measures stay separated by their selected currency/unit and period groups. Inspect population coverage and original source occurrences when interpreting a finding. A missing target inventory remains visible as unresolved evidence, including when it contains no observed rows.

Expand the Registers working-file panel to download or restore unsubmitted forms and pending original operations. [REGISTER_RECEIVING.md](REGISTER_RECEIVING.md) covers complete CSV/NDJSON exports, readable reports, editable producer/customer returns and the authored seven-register programme.

The header also links to the maintained [financial reporting](FINANCIAL_REPORTING.md) and [property continuity](PROPERTY_CONTINUITY.md) applications. The header also opens [CRF reporting and workbook return](CRF_REPORTING.md): six reviewed source families, interim/cumulative annual editions, complete differences, retained finding decisions, actual workbook bindings and complete portable receiving. All workflows preserve their original editions in the same SQLite workspace. [Housing commissioning](HOUSING_COMMISSIONING.md) connects Registers, Property and Financial reporting for one complete transition, including two recipient operators' continued work. The complete handover includes readable property and financial reports with every original record and full CSV/NDJSON sections.

## Open an operating workspace

Use Linux with Python 3.10 or later. The operating application uses the Python standard library. Node is only needed to run the existing standalone audit.

From this complete application directory:

    python migration_server.py \
      --workspace "/absolute/path/to/migration-workspace" \
      --create \
      --title "File migration operating workspace"

Open http://127.0.0.1:8083 in the browser. Enter the operator name that should be recorded with changes. To reopen the same project later, use the same command without --create. The server prints the actual local address and original workspace identity.

One process owns a workspace at a time. Stop its existing server before opening that same directory through the CLI. A separate received workspace has its own directory and can be opened independently. Keep application and workspace paths as ordinary directories.

The default listener is local to this machine. The --host and --port flags support an explicitly managed deployment. The supplied server has no account-management layer; any remote deployment must use the project's normal network access controls.

## 1. Retain the source and review its declared meaning

In Sources, choose the complete input file and select **Retain file & preview**. Intake streams the original bytes to the workspace; it does not load an entire large source in a browser JSON field.

Choose the actual report format, source role, scope and identity namespace. Every source also declares capture kind and coverage. Customer exports, public reference material and local product reference records remain distinct.

The scope identifies the migration cohort. The identity namespace identifies the system in which item IDs have the same meaning. A source inventory and a target inventory can share source IDs only when the operator has explicitly established that namespace relationship.

Declare complete, partial, failure-only or unknown coverage and explain it. An optional expected original-row count is checked against the imported row count. It is separate from a report's scanned, expected-to-migrate or migrated count.

Keep task, migration-job, report-set, snapshot, package, device and incremental-round identities where their original source provides them. The importer retains original row values and any separate context. A context conflict remains visible.

The header preview supports comma, semicolon, tab and pipe delimiters, plus declared UTF-8/UTF-16 variants. Changing encoding or delimiter refreshes the preview. It only previews headers and a few rows; import parses the full retained original file.

### Supported inputs

| Source family | Interpretation |
| --- | --- |
| Migration Manager ItemReport | Original attempted-item observations and reported status vocabulary |
| ItemFailureReport | Original failure subset |
| ItemSummary, TaskSummary and ScanSummary | Original pipeline and population counts with distinct denominators |
| Structure report and its two failure families | Original structure operations and failures |
| Inventory JSONL or CSV | Explicit source or target inventory with nullable fields |
| Purview CSV | Explicitly mapped classification evidence with declared scan/cycle/coverage |
| Microsoft custom user mapping CSV | Exact headerless source principal, destination UPN and TRUE/FALSE AD-group flag |
| Identity, status or evidence mapping JSONL | Original entries for a reviewed mapping edition |
| Attachment | Original supporting bytes retained without a derived tenant conclusion |

Generic inventory and Purview CSV require a reviewed canonical-field-to-exact-header map. Provider reports preserve documented spelling and case. Use the provider-heading mapping only for a reviewed locale or producer variant, with a mapping note.

Missing column, blank value, explicit JSON null, invalid value and zero remain different. Row issues and original locations are available through **Inspect & copy IDs**. Complete original bytes remain downloadable.

Microsoft's documented ItemReport and ItemFailureReport headings differ. In particular, File name/File size/Incremental round are not silently substituted for Item name/Item size/Incremental Round. A report's Source and Destination locations are not treated as full item paths without separate explicit evidence.

Sources:
- https://learn.microsoft.com/en-us/sharepointmigration/mm-reports
- https://learn.microsoft.com/en-us/sharepointmigration/mm-user-mapping-file
- https://learn.microsoft.com/en-us/sharepointmigration/mm-settings
- https://learn.microsoft.com/en-us/purview/deploy-scanner-manage

## 2. Select an exact migration round

In Rounds, select the baseline source inventory and the precise target/report captures to review together. Give the round its title, scope and label. A later round can name its predecessor.

When a source file contains multiple tasks, jobs or rounds, supply exact per-source selectors. Several selectors may refer to different parts of the same source. Selected original occurrences remain distinct. The workbench does not choose a latest result or silently deduplicate repeated source IDs.

The recent source list is a shortcut. Enter any exact retained source ID in the additional-ID field, or use **All records** to search the complete paged catalogue.

## 3. Review identity, principal, status and evidence mappings

Mappings & evidence creates immutable reviewed editions. Each edition can use an exact imported mapping source or manual entries.

- **Identity:** link an exact source occurrence to an exact target occurrence with a reason. Ambiguous or conflicting relationships remain review findings.
- **Principal:** preserve the declared source/destination principal and AD-group flag. Record the selected Entra fallback setting. Matching a principal declaration does not prove effective access, group expansion or inheritance.
- **Status:** classify actual provider vocabulary as reported success, failure, filtered or in progress. The original text stays available; a reported-success classification does not fill in missing target fields.
- **Evidence:** link a subject occurrence to a precise evidence occurrence and select the fields it supplies. A reviewed evidence mapping can contain the complete imported evidence collection; an individual evidence link is useful for a single review.

Inspect original rows before assigning IDs. Evidence is joined by an explicit reviewed relationship, rather than a guessed path/date match. An evidence row must belong to the selected round. Browse the complete mapping entries with the paged controls.

The default reconciliation uses target inventory as its observation basis. Select the attempted-item report basis deliberately when that is the evidence being reviewed. Mixing an independent target inventory and attempted-item report into one implicit target population would create misleading duplicates.

## 4. Reconcile and interpret field coverage

Create a reconciliation from the selected round. Choose shared-source-ID identity with its reason, or a reviewed exact-occurrence mapping. Bind the intended principal, status and evidence mapping editions and any individual evidence links. Choose the field checks required for this review.

| Result | Operating meaning |
| --- | --- |
| MATCH | Selected supplied evidence agrees for the evaluated checks |
| DIFFERENT | A selected field has a recorded difference |
| UNKNOWN | A required value, relationship or coverage conclusion is not established |
| AMBIGUOUS | The selected original occurrences or mappings do not resolve one relationship |
| MISSING | An expected item is absent from an explicitly complete selected target inventory for the same scope and namespace |
| UNEXPECTED | An actual selected target-inventory occurrence has no selected expected counterpart |

An unpaired migration-report observation cannot establish unexpected target presence. Failure-only reports cannot establish target absence or success. Purview policy-only and incremental captures retain their more limited effective coverage even when an operator's declared coverage says complete.

The review report shows declared and effective source coverage together. It also separates selected baseline occurrences, selected observation occurrences, explicitly linked pairs and each field's actual result counts. Known byte sums are labeled occurrence-based declared quantities; unknown sizes are counted separately.

For complete item details, use **Field evidence**. It retains original expected/observed values, presence states, mapping bases and source-row references. Use the exact finding ID to open a correction.

A report-file SHA identifies the retained report bytes. A content comparison requires explicitly supplied content hashes bound to the same item. Principal declarations, label values, classification timestamps, effective access and policy enforcement remain separate evidence questions.

## 5. Work the correction queue

Open a correction against the exact reconciliation and item. Give it a useful title, owner or unassigned state, note and supporting occurrence IDs.

Record progress, a request for evidence, resolution, accepted variance or withdrawal. Each decision appends to the original history and records the operator.

Resolution requires a later MATCH for the same retained baseline occurrence. Create a successor target capture/round/reconciliation and select its exact matching finding. An accepted variance records an operator decision and keeps the original field difference intact.

Correction history can be inspected in the browser and exported through the original CLI. **All records** searches the complete current projection; recent lists do not limit retained history.

## 6. Prepare a complete delivery

Handover & history prepares the full editable project at the selected revision. The operation freezes the database, full application and readable report under the same workspace owner mutex before reserving its export action. The sender records export reservation/completion afterward. The receiving project starts from the selected captured revision.

The ZIP contains:

- the complete application, original audit, Python core, HTTP interface, browser assets and guides;
- the original SQLite workspace snapshot, including source interpretations, rounds, mappings, findings, decisions, case datasets/plans/rehearsals/reviews/cutovers, complete case rows and operation history;
- every original object in that snapshot's file table, including retained inputs that have not yet been imported;
- every earlier completed delivery archive that the snapshot's delivery records reference;
- reports/review.html, a readable review of selected populations, coverage, reconciliation runs and current correction decisions;
- complete per-reconciliation CSV and NDJSON finding tables, plus machine-readable catalogues;
- reports/case-review.html, all five case descriptor inventories and complete selected descriptor/row exports for each case edition.

Current deliveries bind all 59 application files under commons.migration-workbench-application/v6. Complete earlier 16-, 21-, 24-, 31-, 39-, 48- and 56-file deliveries and preparations already frozen to their respective rosters retain their original application identity. See the portable contract in [CASE_MIGRATION.md](CASE_MIGRATION.md).

The readable report is an offline document and can be printed from a browser. It contains no external scripts, fonts or tracking. The full original decision history remains in SQLite even where a readable recent-history projection is shorter.

All exported counts, original IDs and numeric precision remain available in machine-readable records. CSV exports quote every field and keep user-supplied path/name values inside an exact JSON record column; the separate flat columns contain engine-owned IDs and status codes.

Earlier complete native ZIPs are retained because their recorded download links must keep working after receiving. Consequently, deliveries with substantial delivery history can be larger than a current-state-only export. No completed original archive is silently retired.

## 7. Receive and continue editing

Use the original receiver:

    python migration_portable.py receive \
      --archive "/absolute/path/to/Migration_Workbench_delivery.zip" \
      --destination "/absolute/path/to/received-migration"

Or use the same receiver through the operating CLI:

    python migration_cli.py receive "/absolute/path/to/Migration_Workbench_delivery.zip" \
      --into "/absolute/path/to/received-migration" \
      --sha256 "the recorded complete archive SHA256" \
      --bytes 123456

Replace the example byte count and SHA with the actual delivery record. Neither is a template value to submit unchanged.

Receiving verifies the full manifest and every archive member, then checks that the SQLite snapshot's original object and earlier-delivery inventory exactly equals the archive's workspace closure. Its database identity is verified before the first store open.

A durable receiving marker precedes restoration, and a separate verified-database marker precedes SQLite's first journal transition. An interrupted receiver can continue the same destination. It preserves failed original prefixes. Only a complete independently verified duplicate of a successfully published local file is retired.

Start the received application:

    python "/absolute/path/to/received-migration/application/migration_server.py" \
      --workspace "/absolute/path/to/received-migration/workspace"

Open the printed local address. Continue the original project by recording a receiving review note and assignment on an appropriate correction through the CLI or browser.

Repeating receive after READY rechecks the immutable application, original objects, reports and historical ZIPs, then reopens the same workspace identity. It preserves later editable database changes. It does not reset a received project back to the publication revision.

## 8. Resume an interrupted local operation

A submitted HTTP request can finish even if the browser loses its response. The browser retains the original command ID for that tab. In Handover & history, inspect the original operation before choosing its continuation.

A completed exact request returns its recorded result. Reusing an operation ID with changed semantic input is rejected. A revision conflict refreshes the current revision and preserves the form for review.

For an interrupted operation, choose the original operation ID and give the reason for continuation. The original source bytes, selected round/mappings, parser/engine version and request remain bound. A delivery continuation uses the captured application and database, including when the current deployment has since changed.

If an application capture stopped before copying every originally selected source file, the remaining bytes must still match the retained original inventory. The operation retains its partial capture and does not silently substitute a new deployment.

## Case API and complete exports

The case module uses the same POST /api/operations envelope and POST /api/read transport as the existing workbench. Its five create operations are case.dataset.create, case.plan.create, case.rehearsal.create, case.review.create and case.cutover.create. Read case.schema for the installed fields; use case.list/get and the original paged row/item/compare readers for complete history.

For full files, GET /api/exports?kind=case.rehearsal&id=ACTUAL_ID&format=csv (or ndjson) streams the exact selected complete descriptor plus all original result records. The five export kinds are case.dataset, case.plan, case.rehearsal, case.review and case.cutover. The server completes the selected stream under the original workspace mutex before sending the response length.

The native CLI exposes the same full export and a revision-bound report command. Its case schema/list/get/preview/create commands are documented in [CASE_MIGRATION.md](CASE_MIGRATION.md). New mutations always use a current state revision; an old successful request's replay returns its original result revision.

## Operating limits and verification

Whole input files and result exports are streamed. SQLite stores indexed original occurrences and findings. Browser row/result pages are bounded, while the full catalogue and full exports remain available. The maximum command JSON is 2 MiB; bulk records use streamed file intake. A single parsed original row is limited to 8 MiB. Numeric expansion also has a digit bound before formatting.

The local interface uses neutral grayscale, labeled controls, semantic tables, visible keyboard focus, live operation status and responsive reflow. These are implementation choices. Record actual automated/manual accessibility checks and their results for the intended deployment and assistive-technology environment.

The Commonwealth's published vendor obligations describe accessibility acceptance separately from this source implementation:
https://www.mass.gov/info-details/vendor-digital-accessibility-testing-obligations

Native integration should exercise one complete operating journey: actual source intake, mapping review, first-round findings, correction, successor reconciliation, complete publication, separate receiving, later editable change and repeat receiving with that edit preserved. A local product reference journey identifies its data as local_reference; a public source document is public_reference. Neither is presented as a customer migration result.

MIGRATION_CORE.md documents the exact original API, source profiles, normalization and operation semantics. This guide describes how an operator uses the complete workbench.


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
