# Case and document migration workbench

## Purpose and operating boundary

This extension adds complete case/document projection, destination planning, independent rehearsal reconciliation, finding decisions and cutover review to the existing Migration Workbench. All accepted records, original uploads, request receipts and customer continuations use its original SQLite workspace and object store. The browser, command line, reports and portable delivery read the same immutable case editions.

The product records supplied evidence and explicit operator decisions. It does not connect to Dynamics, SharePoint, an archive or a loader, infer missing identities, change target permissions, perform a migration or authorize a tenant write. A loader receipt is retained separately from independently observed target inventory. “Approved” is a recorded supplied decision; the actual target execution and buyer acceptance remain separate operations.

Begin with the actual original case and its authorized source exports. Keep procurement and commercial correspondence with their existing owners.

## Install and reopen the existing project

Use Python 3.10 or later on a host with SQLite and ordinary local filesystem locking. The existing browser server and native CLI remain the entry points. Obtain the complete selected application, not an individual replacement module. Current delivery contains all 59 application files listed in migration_portable.APPLICATION_FILES, including the complete case workflow and the cumulative register and CRF extensions.

The original command syntax is:

    python3 migration_cli.py --workspace /absolute/original/workspace state
    python3 migration_cli.py --workspace /absolute/original/workspace case schema

An original workspace is the directory containing the original database and object store. Keep its original path and ownership. Stop a server that already holds that workspace before opening the native CLI. Different tools cannot bypass the workspace’s original kernel lock.

Use the original migration_server.py entry point described in OPERATING_WORKBENCH.md to run the browser. The new Cases & cutover section is mounted inside the existing application. Original Sources, principal mapping, reconciliation, tasks and handover remain available.

## Full operator journey

### 1. Retain the original exports

In original Sources, upload and import the complete supplied CSV or JSONL export using its original format and explicit source context. Retain exact bytes, filename, source identity and all original records. An attachment remains an attachment; do not turn unparsed evidence into an invented record table.

For the CLI, keep the existing import-source command. Its profile includes the original format/context and explicit original column mapping where needed:

    python3 migration_cli.py --workspace /absolute/original/workspace import-source /absolute/supplied.csv --profile /absolute/profile.json --operation-id actual-import-request --actor actual-operator --expected-revision 12

Select the actual current revision from state. The revision above illustrates command syntax, not a selected customer revision. A new operation needs its own actual operation ID; a retry uses the original ID and exact request.

### 2. Save explicit case/document/link projections

Open Cases & cutover → Source mappings. Select one actual original source. Choose the record family (cases, documents or links), evidence side (source, target or receipt) and, for target/receipt evidence, its destination. Configure enabled canonical fields with exact CSV headings or RFC 6901 JSON pointers. Explicit value maps translate only the supplied original strings selected for review.

Do not collapse blank, absent, false, zero, arrays or objects into a common string. Original values and source occurrences remain retained. Custom structured JSON values have unambiguous recursive typed identities; built-in normalized fields keep the model’s documented types. The full projection preview includes each original occurrence, original row, presence flags, source reference and interpretation findings.

Save a dataset only after reviewing the complete projection. A correction creates another immutable dataset with its selected parent_dataset_id. It does not rewrite the earlier source or mapping.

Native alternatives:

    python3 migration_cli.py --workspace /absolute/original/workspace case preview --payload /absolute/preview.json
    python3 migration_cli.py --workspace /absolute/original/workspace case create dataset --payload /absolute/dataset-request.json

The preview accepts actual source_id, kind, side, destination, columns, value_maps and explicit offset/limit. The create request includes title, review_note and optional parent_dataset_id, together with operation_id, expected_revision and actor. Get the installed exact field list from case schema; do not infer a new mapping from display labels.

### 3. Record the actual cutoff and destination policy

In Destination plans, select the exact source dataset editions. Supply an ISO timestamp with explicit timezone offset, exact live and closed status lists, and a nonnegative max_snapshot_age_seconds. Zero permits no stale capture window. The model evaluates the supplied lifecycle/capture dates relative to this explicit cutoff; it never treats a missing value as a date or assumes current status establishes historical status.

Choose document_id or document_version identity and the reviewed multi-case rule: require_single_destination or copy_per_destination. The destination policy retains live cases in Dynamics, live documents in SharePoint and closed cases/documents in the archive. Actual unresolved links, duplicate identities, conflicting lifecycle values and incompatible destinations remain findings.

Select the actual fields to compare for cases and documents. Identity, destination, relationship, lifecycle and capture checks are intrinsic. Keep the full review note and optional original parent_plan_id.

    python3 migration_cli.py --workspace /absolute/original/workspace case create plan --payload /absolute/plan-request.json

### 4. Reconcile an independent rehearsal

In Rehearsals, choose the exact plan, independent target dataset editions and separate loader receipt dataset editions. A receipt reporting success does not establish an independently observed target record. The complete result preserves source occurrences, expected destinations, observed target rows, reported loader rows, per-field checks and all findings.

Status labels are MATCH, DIFFERENT, UNKNOWN, AMBIGUOUS, MISSING and UNEXPECTED. Read each status together with its original values, units, IDs and findings.

Corrected evidence produces a successor rehearsal. Comparison requires matching source scope, logical identity namespace and document identity policy. The full comparison retains the before and after item for every identity and explicitly labels new identities, identities not selected, destination changes, status changes and unchanged statuses.

    python3 migration_cli.py --workspace /absolute/original/workspace case create rehearsal --payload /absolute/rehearsal-request.json
    python3 migration_cli.py --workspace /absolute/original/workspace command case.rehearsal.compare --payload /absolute/comparison-page.json

The latter is an explicit page; use each returned offset/total through completion. Full exports below are streamed automatically.

### 5. Preserve finding decisions

Finding decisions select the actual rehearsal and exact immutable item ID. Record rework, waiting_evidence, accepted_variance or withdrawn, the complete reason, responsible person and original evidence-row references. A successor must select the current parent_review_id; it cannot silently skip another recorded response.

An acceptance from a superseded review is not a current acceptance. Earlier reasons, original finding bodies and evidence remain available. A later corrected finding needs its own actual review context.

### 6. Record cutover readiness and decision

In Cutover, select the original rehearsal and current review editions. Record hold, ready_for_review or approved, the actual decision reason/owner, explicit window, rollback and complete tasks. Completed tasks require retained source-object SHA-256 evidence. Blank or merely named files do not establish task completion.

The model preserves unresolved findings and checks that each selected acceptance is current for the same original finding. A successor cutover retains its parent and all selected case/plan/rehearsal/review bodies.

The browser’s All case records view exposes every immutable edition. Complete descriptor reads are also available:

    python3 migration_cli.py --workspace /absolute/original/workspace case list cutover --offset 0 --limit 100
    python3 migration_cli.py --workspace /absolute/original/workspace case get cutover actual-case-cutover-id

## Working drafts and uncertain requests

The browser working-file panel preserves the complete local form drafts, selected scope, pending original command and prior stopped attempts. Download that working JSON before moving devices or intentionally abandoning edits. Reopen it explicitly; a conflicting tab must download its current work and load the saved version rather than overwrite silently.

A submitted mutation freezes the original request. Request inspection and retry use that same input and ID. The “revised draft” path is available only after a fresh original request response is INTERRUPTED and its full body matches. “Not found” alone cannot prove a delayed original POST will never arrive.

The native store replays a succeeded original request before comparing a new revision. Its returned revision belongs to that original result. Reread current state before issuing the next new mutation. To continue an incomplete original native request, use the existing operation.resume action with an explicit reason and a new control request ID; do not rename the original business request to bypass an uncertain outcome.

## Complete reports and exports

The new exports support every original case kind: case.dataset, case.plan, case.rehearsal, case.review and case.cutover.

    python3 migration_cli.py --workspace /absolute/original/workspace export case.rehearsal actual-rehearsal-id --format ndjson --out /absolute/rehearsal.ndjson
    python3 migration_cli.py --workspace /absolute/original/workspace export case.plan actual-plan-id --format csv --out /absolute/plan.csv

Each export includes the complete selected descriptor. Datasets then include every projected original occurrence; plans and rehearsals include every result item. Review/cutover descriptors already retain their complete selected original finding, evidence, task and decision objects. Exports validate pagination, reject repeated IDs/non-advancing pages, and retain one workspace revision for the entire stream.

NDJSON records identify selection versus row records. CSV’s complete_original_record_json column retains the entire original object. Human text columns neutralize spreadsheet formula prefixes. JSON/source values are not altered. CSV is a review/export format, not an implicit destructive import or a replacement for the whole workspace.

The browser uses GET /api/exports?kind=case.plan&id=ACTUAL_ID&format=csv or ndjson. The original server builds the complete selected stream under the workspace mutex, then returns the exact file length. No first-page-only export is presented as complete.

Generate the full report at an exact current revision:

    python3 migration_cli.py --workspace /absolute/original/workspace report --expected-revision 42 --out /absolute/review-directory --title "Actual case review" --note "Actual evidence and reviewer scope"

This creates original review.html, case-review.html, all existing original reports, all five case descriptor inventories and complete per-entity CSV/NDJSON. REPORT.json binds every complete file. Output is create-only: an exact completed replay is accepted, conflicting bytes retain both the original and the new partial. Choose a new directory for a deliberately different revision.

## Portable customer handover and return

Use the original delivery.prepare operation. It freezes the complete SQLite snapshot, all original source objects, full reports, application and request receipts. New preparations include the complete 59-file application and declare application_profile commons.migration-workbench-application/v6. Inspection requires precisely that complete roster; an incomplete application is rejected. Historical 21-file case editions retain commons.case-migration-application/v1.

    python3 migration_cli.py --workspace /absolute/original/workspace prepare-delivery --operation-id actual-delivery-request --actor actual-operator --expected-revision 42 --title "Actual case handover" --note "Actual scope"
    python3 migration_cli.py --workspace /absolute/original/workspace delivery-file actual-delivery-id --out /absolute/complete-handover.zip
    python3 migration_cli.py inspect-delivery /absolute/complete-handover.zip
    python3 migration_cli.py receive /absolute/complete-handover.zip --into /absolute/customer-receiving --sha256 ACTUAL_ARCHIVE_SHA --bytes ACTUAL_ARCHIVE_BYTES

The received project is /absolute/customer-receiving/workspace. Application sources are under application/. Keep the entire received tree. Continue the same original project in the received workspace, record new immutable editions, prepare a return delivery there and receive that return into a separate selected destination.

Re-receiving an earlier identical handover into the original receiving directory verifies its retained original selection and preserves later legitimate customer edits. It is not a rollback. A different archive needs an explicitly different receiving selection; do not overwrite the first operation.

Legacy compatibility is explicit. Complete original 16-file deliveries with no application_profile remain inspectable/receivable. A preparation that already froze the old 16-file application keeps its original source roster and manifest semantics. It is not relabeled as the current case application. Newly prepared case deliveries require the complete current APPLICATION_FILES roster; historical 21-, 24-, 31-, 39-, 48- and 56-file selections retain their exact advertised profiles. The database remains the original complete snapshot format.

## Source and lifecycle verification

CASE_RECEIVING.md describes the whole actual-input receiving driver. It requires actual original sources, one real project, explicit reviewed action payloads and a distinct corrected rehearsal. It retains original requests, full outputs, customer continuation, return receiving and same-ID replay. Until that selected programme returns COMPLETE, source review or packaging alone is not an actual native acceptance.

Continue using the original source formats, object hashes, operation history, SQLite backup, portable integrity checks and kernel workspace lock.


## Outgoing product inspection

The complete owner-directed rendered-product instruction is retained in [OPERATING_WORKBENCH.md](OPERATING_WORKBENCH.md#standing-lab-rule-inspect-the-rendered-product-before-presenting-it). Read and apply it before presenting the exact outgoing application or its attachments; open the actual product, operate its controls, view its rendered results and reopen its downloads. Include the instruction in delegated operating assignments.
