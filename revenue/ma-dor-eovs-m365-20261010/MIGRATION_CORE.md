# Retained migration evidence core

This is the operating core for the existing file-share migration acceptance product. The original audit.mjs and audit.test.mjs remain available unchanged for their original compact JSONL contract. The new Python modules use one SQLite workspace to retain original reports, inventory occurrences, reviewed mappings, explicit incremental-round selections, reconciliation results, corrections, and receiving history.

The core imports supplied evidence. It does not migrate tenant content, look up identities, change permissions, expand directory groups, enforce Purview policies, or infer that a report contains fields it does not contain. A local reference demonstration must declare capture_kind = local_reference; its generated inputs are not customer exports.

## Installed source and runtime

The coupled core files are:

- migration_store.py — original SQLite, immutable source objects, operations, snapshots, owner lock.
- migration_formats.py — streaming original report/inventory parsing and explicit nullable fields.
- migration_reconcile.py — immutable selected-round reconciliation and comparison.
- migration_workspace.py — public dispatch, reviewed mappings, corrections, paginated views.
- migration_cases.py — explicit case/document/link projections, cutoff/destination plans, independent rehearsals, immutable reviews and cutover decisions in the same original store.
- migration_cli.py — complete native command, original file intake/export, snapshot and portable receiving entry.
- migration_registers.py — explicit typed register projections, complete population and relationship findings, exact signed financial controls, immutable reviews and cutover decisions.

REGISTER_MIGRATION.md documents the complete register contract. REGISTER_OPERATOR.md describes the mounted interface. REGISTER_RECEIVING.md covers the native CLI, full delivery/customer-return programme and authored seven-register example.

The full application also includes the maintained server, interfaces, portable/report modules and guides. Delivery selects the complete 56-file APPLICATION_FILES roster in migration_portable.py under commons.migration-workbench-application/v5. This cumulative edition retains file evidence, cases, grants, financial reporting and property continuity, and adds typed register migration and CRF reporting with their complete receiving programmes. The original 16-, case 21-, grant 24-, financial 31-, property 39- and register 48-file editions remain valid under their exact historical profiles; an already frozen preparation retains its selected roster. Use the whole selected application when receiving or continuing its original workspace.

The core uses the Python standard library on Linux, Python 3.10 or later. It uses fcntl for the original exclusive owner lock and a held /proc/self/fd path to inspect exact SQLite snapshot bytes. Browser clients do not need Python. No package download is required by the core.

## One workspace and original evidence

MigrationWorkspace(directory, create=False, title=...) opens the original store. Create a new workspace explicitly with create=True.

The layout is:

| Member | Meaning |
|---|---|
| workspace.sqlite3 | Original project, rows, immutable entities, revisions and operation ledger |
| objects/HH/SHA256 | Complete original immutable bytes; path derives from their exact digest |
| staging/ | Owned incomplete upload attempts and any available error records |
| owner.lock | Live owner lock; not portable source evidence |

All selected paths are ordinary paths. Workspace symlinks are rejected. One process owns a workspace; concurrent HTTP threads share that process's reentrant mutex and the same SQLite connection. A long mutation or streaming export holds that mutex, so reads wait rather than observing an incomplete operation as a finished result.

stage_file(binary_stream, filename, expected_sha256=None, expected_bytes=None) consumes bounded binary chunks and returns {sha256, bytes, filename}. It verifies optional original identity before create-only publication and retains failed partials. The file table is independent of project revision: an uploaded supporting file may exist before any source.import operation. A complete snapshot/delivery therefore uses every original file-table entry, not only files referenced by a revisioned entity.

open_file(sha256) returns a held binary file after verifying the original type, full length and full digest. The caller closes it. file_info(sha256) returns the original stored descriptor.

## Operation identity and continuation

Every mutation carries:

| Field | Contract |
|---|---|
| expected_revision | Exact reviewed integer project revision |
| operation_id | Original flat identifier, 1–120 alphanumeric/underscore/hyphen characters |
| actor | Nonempty recorded operator identity |

The semantic request SHA covers {operation, payload}, excluding only operation_id and expected_revision from payload. Actor and every scientific/operating setting remain bound. The exact original full request is retained separately.

execute reserves the operation in a committed transaction, calls its handler without an outer SQLite write transaction, then commits the result in a short transaction. Reservation, completion and interruption each produce actual revision events. Do not assume a successful mutation advances revision by one; use the returned revision.

An exact repeated successful operation returns its original retained result and original completion revision with reused:true. Current state may have advanced since then. A different semantic request under the same operation ID is rejected. An interrupted operation requires an explicit operation.resume control operation; the original request and target operation ID remain intact.

The normal return is:

~~~json
{
  "revision": 12,
  "operation_id": "original-operation-id",
  "reused": false,
  "result": {"id": "retained-entity-id"}
}
~~~

The numbers and IDs in examples describe shape only. Read the actual returned values from your own workspace.

operation.get accepts {id} and returns {found, operation}; the full operation includes request, request_sha256, status, checkpoint, original actor, result and error.

operation.resume accepts {target_operation_id, reason} plus the normal mutation envelope. It runs a separate original control request whose result identifies the continued target. It never rewrites an old request or silently starts a replacement import. A changed normalizer or reconciliation implementation cannot continue its incomplete old prefix: preserve that original result and use its original installed edition or an explicitly new interpretation operation.

### Delivery reservation and snapshot

delivery.prepare is special: the public prepare_delivery(workspace,payload) wrapper freezes the selected SQLite revision and complete installed application bytes under the same original mutex **before** execute reserves the delivery operation. Its optional fields are title (default "Migration workbench handover") and note (default empty text).

continue_delivery(workspace, original_op) resumes that same frozen capture and result. It does not resnapshot a later live workspace. The frozen snapshot revision must equal the original request.expected_revision, not the later reservation revision.

If interruption occurs after snapshot publication but before reservation, the original capture remains. A retry against a changed live revision returns a conflict and retains that capture. It must not silently label newer bytes as the original selected revision.

## Complete and bounded read API

dispatch(operation,payload) returns ordinary JSON-compatible dictionaries.

| Read operation | Payload and result |
|---|---|
| schema | Installed exact profiles, headers, fields and action names |
| state | Project, latest 100 per collection, collection_totals, recent operations/events |
| entity.list | {kind,offset?,limit?,query?}; complete top-level paging |
| source.list / source.get | Page originals / get exact source by {id} |
| source.rows | {id,offset?,limit?,role?,task_id?,round_label?,job_id?,query?} |
| row.get | {id}; full raw row, values, presence, issues, locator and source context |
| round.list / round.get | Explicit immutable selected rounds |
| mapping.list / mapping.get | Reviewed mapping editions |
| mapping.rows | {id,offset?,limit?}; all original reviewed mapping occurrences |
| evidence_link.list / evidence_link.get | Exact individual supplemental-evidence links |
| reconciliation.list / reconciliation.get | Complete frozen result and selected configuration |
| reconciliation.items | {id,offset?,limit?,status?,query?}; complete item findings |
| reconciliation.compare | {before_id,after_id,offset?,limit?}; actual baseline-row transitions |
| correction.list / correction.get | Original correction plus current status and bounded recent history |
| correction.history | {id,offset?,limit?}; complete immutable update history |
| delivery.list / delivery.get | Original immutable delivery records |
| operation.get | {id}; original operation and continuation evidence |
| events | {offset?,limit?}; full revision-ordered event history |

Paged results are {rows,total,offset,limit}. The default limit is 100; the maximum is 500. entity.list kinds include source, round, mapping, evidence_link, reconciliation, correction, delivery, workspace_edit and the new case_dataset, case_plan, case_rehearsal, case_review and case_cutover entities. Search affects discovery only; identity matching remains exact and case-sensitive. Older IDs remain usable even when outside state’s summaries.

## Case and document operating contract

Case records share the original entities, operation ledger, object store and SQLite snapshot. Indexed case_dataset_rows and case_items retain every projected occurrence and plan/rehearsal result. They are included by the same complete database backup and portable receive; no second case database is created.

### Mutations

Every operation below uses the original operation_id / expected_revision / actor envelope. Bodies and selected dependencies become immutable accepted editions; corrections use explicit parent IDs.

| Operation | Actual selected fields |
| --- | --- |
| case.dataset.create | title, source_id, kind cases/documents/links, side source/target/receipt, destination, exact columns selectors, explicit value_maps, review_note, optional parent_dataset_id |
| case.plan.create | title, source_dataset_ids, explicit-offset cutoff_at, live_statuses, closed_statuses, max_snapshot_age_seconds, document_identity, multi_case_policy, checks, review_note, optional parent_plan_id/note |
| case.rehearsal.create | title, plan_id, independent target_dataset_ids, separate receipt_dataset_ids, note, optional parent_rehearsal_id |
| case.review.create | rehearsal_id, exact item_id, disposition, reason, assigned_to, evidence_row_ids, current parent_review_id for a successor |
| case.cutover.create | title, rehearsal_id, decision/reason/owner, window_start/window_end, rollback, current review_ids, complete tasks with evidence_file_sha256s, optional parent_cutover_id |

Column selectors are exactly {column:original_heading} or {pointer:RFC6901_pointer}. The installed case.schema lists fields, constraints and allowed vocabularies. Full original values, presence states, selectors, row references and findings remain in projections. Structured custom values use recursive typed encoding; built-in normalized fields retain their documented types.

The plan freezes exact source editions and the supplied cutoff/status policy. Independent targets and reported loader receipts remain separate. Rehearsal items preserve original expected/observed/reported rows and per-field checks. A review successor requires the current predecessor; a cutover selects only current unsuperseded acceptances and retained evidence for completed tasks.

### Complete reads and exports

| Read | Selection |
| --- | --- |
| case.schema | Exact installed contract |
| case.list | kind dataset/plan/rehearsal/review/cutover, offset/limit/query |
| case.dataset.get / case.plan.get / case.rehearsal.get / case.review.get / case.cutover.get | Exact immutable id |
| case.dataset.preview | Actual dataset configuration plus explicit page |
| case.dataset.rows | id plus offset/limit/query |
| case.plan.items | id plus offset/limit and optional kind/query |
| case.rehearsal.items | id plus offset/limit and optional kind/status/query |
| case.rehearsal.compare | before_id, after_id, offset/limit; matching scope/namespace/identity policy required |

Rows retain the original page shape {rows,total,offset,limit}; the maximum limit remains 500. Comparison records preserve before/after objects and the actual transition classification.

workspace.iter_export accepts case.dataset, case.plan, case.rehearsal, case.review and case.cutover with csv or ndjson. It holds the original mutex while yielding the full selection and rows. NDJSON identifies selection and record wrappers; CSV includes the same complete JSON beside safe indexing columns. Exact original JSON is never rewritten to sanitize a spreadsheet label. Browser GET /api/exports exposes these streams with a complete original file length.

Reports include every immutable case descriptor and all projected/result populations, preserving the original file-evidence reports. Complete portable packages include both reports and the full same-store source/decision history. [CASE_MIGRATION.md](CASE_MIGRATION.md) covers actual operator use; [CASE_RECEIVING.md](CASE_RECEIVING.md) specifies the full original-case/customer-return programme.

## Original input profiles

source.import accepts file_sha256, bytes, filename, format and context, with optional columns, header_mapping and column_mapping_note. It consumes only a previously staged complete file.

Every context declares:

~~~json
{
  "scope_id": "explicit-scope-name",
  "identity_namespace": "explicit-source-ID-namespace",
  "role": "source_inventory",
  "capture_kind": "local_reference",
  "coverage": {
    "mode": "complete",
    "description": "Why this exact received export is complete for the declared scope",
    "expected_rows": 3
  }
}
~~~

This is a labeled local-reference profile example, not a captured tenant report. expected_rows is optional. If supplied and inconsistent with the actual parsed occurrence count, the original discrepancy remains in the source summary and prevents a complete-inventory absence conclusion.

Optional original report-set context includes task_id, round_label, job_id, snapshot_id, report_set_id, producer, observed_at, captured_at, scan_job_id, scan_cycle_id, scan_mode, policy_only, encoding, delimiter and note. When a row supplies its own task/round/job value, that original value wins and conflicting context is recorded as an issue. Explicit context fills only absent, null or empty values; it does not merge all report rows into one invented event.

| Format | Original role and interpretation |
|---|---|
| mm_item_report | Attempted migration items; not independent target inventory |
| mm_item_failure_report | Original failure subset |
| mm_item_summary | Received per-round pipeline counts with distinct denominators |
| mm_task_summary | Actual task/aggregate rows; no assumed one-row shape |
| mm_scan_summary | Original scanned, filtered and expected counts |
| mm_structure_report | Original structure operations |
| mm_structure_failure_report | Structure failure subset |
| mm_structure_failure_summary | Actual original failure-summary rows |
| inventory_jsonl / inventory_csv | Explicit source_inventory or target_inventory |
| purview_csv | Explicitly mapped scanner evidence with original coverage context |
| user_mapping_csv | Headerless original principal map |
| identity_mapping_jsonl | Explicit source-row/target-row links |
| status_mapping_jsonl | Reviewed original status vocabulary |
| evidence_mapping_jsonl | Bulk exact original subject/evidence occurrence links |
| attachment | Complete uninterpreted original bytes |

### Documented report headings versus actual received headings

The installed schema returns all eight exact documented header lists. Critical differences include:

| Family | Documented headings |
|---|---|
| ItemReport | File name, File size, Incremental round, Task ID |
| ItemFailureReport | Item name, Item size, Error code, Incremental Round, Task ID |
| Aggregate summary | TaskID |
| Structure reports | Time stamp; task/round may require explicit report-set context |

Every original header and cell stays in the retained raw record. Localized or variant headings need an explicit header_mapping from a documented heading to the actual received heading, plus column_mapping_note. Generic inventory_csv and purview_csv require explicit columns mapping canonical field names to exact original headings. Original header cells remain separate from the provider alias view, including when aliases overlap.

CSV defaults to comma. A different single-character delimiter must be declared. UTF-8 and UTF-16 BOMs are supported; an explicit supported encoding can be supplied. Official user-mapping CSV remains comma-delimited and headerless.

CSV row locators retain original physical start/end line and actual encoding. JSONL locators retain byte offset/length plus physical line. Each source occurrence gets its own row ID, including duplicate provider records. Blank JSONL lines remain in the original file and are not invented records. Malformed nonblank JSONL records remain explicit invalid occurrences.

The original parser budget is 8 MiB per record/field. Nonnegative integral byte/count values are normalized exactly as decimal strings, with a 1,000 expanded-digit normalization budget checked before expansion. A value outside that implementation budget remains in the original token and is marked invalid; it is not rounded or treated as zero. This is a parser budget, not a claim about a customer's maximum file size.

Imports commit bounded row batches and retain their prefix. A parser/header/encoding failure leaves an INCOMPLETE source, original bytes and error. READY means the original file was completely parsed; it does not mean every row or business claim was valid. Row issues remain inspectable.

### Canonical evidence fields

Canonical inventory fields include source_id, target_id, path, expected_target_path, size_bytes, content_sha256, principals, label, classified_at and migrated_at. Additional original report fields include source/destination locations, name, type, status, category, message, error, package, task, round, job, device and scan identities.

Each field has a separate presence state: value, null, empty, missing or invalid. Values are never filled with zero/empty strings merely to make a comparison pass. Whitespace-only input is explicitly empty; nonempty opaque IDs are not trimmed or case-folded.

Opaque identifiers must be actual strings. Size/counts are exact nonnegative integer decimal strings. Content digests must be explicitly supplied SHA256 values. Principal declarations are explicit JSON arrays; original order and duplicates remain in raw evidence, while the comparison uses declared sets. Timestamps need explicit offsets.

Migration Manager ItemReport does not supply content SHA256, effective ACL or Purview policy proof. Its Destination is a reported location and is not silently assembled into a full file path. Additional fields only enter through actual extra columns and an explicit reviewed mapping. A report-file digest identifies that report's bytes; it is not substituted for any migrated item's content digest.

## Explicit rounds and mapping editions

round.create requires title, scope_id, round_label and sources:[{source_id,task_id?,round_label?,job_id?}], with optional task_id, parent_round_id and note. The round freezes source identities, declared context, selectors and every selected original row ID. Multiple selectors selecting the same retained row do not duplicate that row; distinct source occurrences remain distinct.

A row filter preserves a complete-inventory scope only if its exact task/round/job constraint was itself declared in the original source context. An arbitrary filtered subset is not automatically a complete namespace.

mapping.create requires title, kind, review_note and exactly one source_id or entries array. Inline entries are limited to 1,000; original mapping files stream through the same retained store. Optional parent_mapping_id links a new reviewed edition; it does not change the old one.

| Kind | Entry fields |
|---|---|
| identity | source_row_id, target_row_id, reason |
| principal | source_principal, target_principal, is_group, reason? |
| status | raw_status, classification, reason? |
| evidence | subject_row_id, evidence_row_id, fields, reason |

Identity links bind exact retained occurrences, not guessed filenames. Principal maps can retain explicit options.entra_fallback = enabled / disabled / unknown. No Entra lookup is performed. A missing mapping remains unknown even if an operator records that fallback is enabled.

The official headerless user map has exactly DOMAIN\user, destination UPN, TRUE or FALSE for an AD group. Extra columns or invalid original rows cannot be silently accepted as a valid three-column mapping. Import a corrected original edition and review that edition explicitly.

Status classifications are reported_success, reported_failure, reported_filtered and reported_in_progress. They remain separate from actual content/field verification.

evidence.link provides the same reviewed subject/evidence/fields/reason relationship for one pair. Bulk evidence_mapping_jsonl supports larger collections. Supplemental source and evidence rows must both be selected by the reconciliation's round. Neither date equality nor path similarity creates an evidence link automatically.

## Reconciliation meanings

reconciliation.create requires title, round_id and identity_policy:{mode,reason}. Its mode is shared_source_id or explicit_map.

Optional settings are target_basis (target_inventory by default, or migration_items), identity_mapping_id, principal_mapping_id, status_mapping_id, evidence_mapping_id, evidence_link_ids and checks. Default checks are presence, path, size, hash, principals, label and classification_order.

The selected source_inventory occurrences are the baseline. With target_basis = target_inventory, only actual selected target_inventory rows are primary target evidence; migration reports alongside them remain separate reported-status context. With migration_items, report occurrences are primary comparison rows and remain identified as attempts.

| Finding | Meaning |
|---|---|
| MATCH | Requested comparisons agree on supplied evidence |
| DIFFERENT | Known supplied values differ, or explicit mapped failure is reported |
| UNKNOWN | Required identity, field, coverage or status evidence is unavailable |
| AMBIGUOUS | Conflicting links, duplicate identity occurrences or contradictory evidence prevent one answer |
| MISSING | No target occurrence in an explicitly complete selected independent target inventory |
| UNEXPECTED | An independent target-inventory identifier is absent from an explicitly complete selected baseline |

An unpaired migration report remains an out-of-scope reported attempt; it does not assert unexpected physical target presence. A linked migration report alone leaves the independent presence check UNKNOWN, even if its reported status says success.

Shared-ID matching requires the exact declared namespace and original source ID. Duplicate source/target groups are not silently deduplicated. An exact reviewed occurrence link can resolve a specific selection, but the same target occurrence cannot satisfy another conflicting source link.

Known supplied mismatches remain differences even when another field is unknown. Ambiguous evidence remains visible. A reported failure can coexist with otherwise equal metadata. A reported success does not supply missing digests, paths, permissions or labels.

Principal comparison means declared set equality after any explicit reviewed mapping. It does not determine effective permissions, inheritance, roles, group membership or policy enforcement. Classification ordering compares supplied same-object timestamps only.

Purview policy-only and incremental reports remain limited to their actual coverage. Absence from them does not prove an item is unclassified. Scanner evidence requires explicit source/cycle/scope and any original matching decisions.

The complete result retains original references, all settings, selected source context and implementation identity. Its known byte totals are sums over retained occurrences, not a deduplicated content-volume claim. Complete items can be paged or exported; bounded interface previews never replace their original file.

## Corrections and incremental verification

correction.create binds reconciliation_id, item_id, title and note, with optional assigned_to and evidence_row_ids. It freezes the original status, exact baseline occurrence and required/problem checks.

correction.update requires id, status and note. Status is open, in_progress, waiting_evidence, resolved, accepted_variance or withdrawn. Original finding bytes do not change. Every update retains its actor, revision and supporting source references.

resolved requires verification:{reconciliation_id,item_id} selecting a later MATCH for the **same retained baseline row**, with every original required check retained and every original problem check now matching. Removing a check cannot manufacture resolution. Later reported success can address a prior reported-failure check, but independent target presence and other required fields must still be supported.

accepted_variance records an explicit decision and reason; it does not change a prior difference into verified agreement. Omitted assigned_to retains the current assignment; explicit null clears it. None of these actions sends a message.

reconciliation.compare uses exact retained baseline occurrence IDs. A different baseline is shown as BASELINE_NOT_SELECTED rather than silently remapped. All original source task/job/round occurrences remain separate.

## Snapshots and complete receiving

backup_to(new_path) publishes a complete SQLite snapshot atomically from an owned unique partial, verifies its full bytes, and returns:

~~~text
{path, bytes, sha256, workspace_id, revision,
 files:[{sha256,bytes,relative_path}], deliveries:[original_delivery_entity]}
~~~

The files list and complete earlier delivery entity bodies come from that exact saved database. The portable module retains those earlier native archives too, so their completed history remains usable after restore. describe_backup(path) reads the same shape from an already published snapshot, using its exact held inode. Existing snapshots are not overwritten; failed attempts remain available. Call backup_to outside a write transaction.

A database-only snapshot is not the full handover. The maintained portable module freezes that original snapshot, every declared immutable object, the full installed application source and its readable reports. receive_delivery verifies the complete package and restores the original layout; it does not replay source imports or reconstruct a separate store. A matching completed repeated receive preserves subsequent edits.

The original portable API is:

~~~python
from migration_portable import inspect_delivery, receive_delivery

inspection = inspect_delivery(archive_path, verify=True)
receiving = receive_delivery(archive_path, destination)
~~~

Receiving returns the original workspace_id and source_revision, complete/reopened/edits_preserved indicators, delivery/archive/manifest identities, destination and workspace. Read the actual current revision from the reopened workspace when continuing edits.

## Native CLI

Print the exact installed contract without opening a workspace:

~~~sh
python3 migration_cli.py schema
~~~

Create and inspect the original workspace:

~~~sh
python3 migration_cli.py --workspace /ordinary/path/workbench create --title "Migration evidence"
python3 migration_cli.py --workspace /ordinary/path/workbench state
~~~

Stage and import an original file with a reviewed UTF-8 profile:

~~~sh
python3 migration_cli.py --workspace /ordinary/path/workbench import-source ORIGINAL.csv \
  --profile PROFILE.json --operation-id ORIGINAL_OPERATION_ID \
  --expected-revision ACTUAL_REVISION --actor "Recorded operator"
~~~

Use the actual integer revision and flat original ID; uppercase placeholders above are not literal working values. The profile contains only format, context and optional explicit column/header mapping fields. Import-source retains the original file before dispatch. A later conflict does not discard that staged original.

All advertised operations use the same command path:

~~~sh
python3 migration_cli.py --workspace /ordinary/path/workbench command round.create --payload ROUND_REQUEST.json
python3 migration_cli.py --workspace /ordinary/path/workbench command reconciliation.create --payload RECONCILIATION_REQUEST.json
python3 migration_cli.py --workspace /ordinary/path/workbench command delivery.prepare --payload DELIVERY_REQUEST.json
~~~

Small command JSON can be read from stdin with --payload -. Original report contents stay in staged files, not giant JSON requests.

Continue an interrupted original operation:

~~~sh
python3 migration_cli.py --workspace /ordinary/path/workbench resume ORIGINAL_TARGET_OPERATION_ID \
  --reason "Recorded reason for this continuation" \
  --operation-id NEW_RESUME_CONTROL_ID --expected-revision ACTUAL_REVISION --actor "Recorded operator"
~~~

Stream complete original rows, findings or mappings:

~~~sh
python3 migration_cli.py --workspace /ordinary/path/workbench export source SOURCE_ID --out original-rows.ndjson
python3 migration_cli.py --workspace /ordinary/path/workbench export reconciliation RESULT_ID --format csv --out findings.csv
python3 migration_cli.py --workspace /ordinary/path/workbench export mapping PRINCIPAL_MAPPING_ID --format csv --out reviewed-user-map.csv
python3 migration_cli.py --workspace /ordinary/path/workbench file ORIGINAL_SHA256 --out original-report.csv
~~~

Source/finding CSV exports retain a complete original record JSON cell beside common indexing columns. Principal mapping CSV uses the original headerless three-column format. Exports create new output paths or accept an exact completed replay; they do not overwrite different existing bytes. Failed owned partials remain. --out - streams bytes to stdout and prints the identity summary to stderr.

Inspect and receive the complete original package:

~~~sh
python3 migration_cli.py inspect-delivery HANDOVER.zip
python3 migration_cli.py receive HANDOVER.zip --into /ordinary/path/received \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --bytes ORIGINAL_ARCHIVE_BYTES
~~~

The optional digest/length are independently retained original identities. Receiving uses the maintained portable module directly. No duplicate staging layout, alternate source loader or new target tenant is created.

## Primary evidence contracts

The complete original source carrier and machine-readable Microsoft evidence contract accompany the product. These primary references explain why the operating core keeps report families, original context and unknown evidence separate:

- [Migration Manager reports](https://learn.microsoft.com/en-us/sharepointmigration/mm-reports)
- [Migration Manager user-mapping file](https://learn.microsoft.com/en-us/sharepointmigration/mm-user-mapping-file)
- [Migration Manager settings](https://learn.microsoft.com/en-us/sharepointmigration/mm-settings)
- [Purview scanner operation and reports](https://learn.microsoft.com/en-us/purview/deploy-scanner-manage)

Documented headings are format contracts, not evidence that a customer export was received. Actual provider/customer bytes, runtime receiving, reviewer decisions and commercial outcomes must be reported from their own retained operations.


## Outgoing product inspection

The complete owner-directed rendered-product instruction is retained in [OPERATING_WORKBENCH.md](OPERATING_WORKBENCH.md#standing-lab-rule-inspect-the-rendered-product-before-presenting-it). Read and apply it before presenting the exact outgoing application or its attachments; open the actual product, operate its controls, view its rendered results and reopen its downloads. Include the instruction in delegated operating assignments.
