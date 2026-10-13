# Native implementation planning and field monitoring

## Purpose and installation

This package turns retained candidate selections into an implementation plan, a dependency schedule, a cost ledger, a monitoring register and an operator report. It uses Python 3.10 or newer and the standard library. Copy the delivered model modules into the application's existing model directory. Run from the application root:

    python -m model.implementation_cli --workspace /path/to/workspace --help

The application may also construct ImplementationStore(workspace), where workspace is an existing object with a root attribute. The store reads only workspace.root; it does not import or require the application's Workspace class.

Retained candidate sources and source-link snapshots/bindings are immutable under their original IDs. Historical IDs also retain that meaning. Labels and additional operational metadata can be edited; a new source selection receives a new ID. A declared candidate source_link_id must resolve to the retained source link with the same declared source digest and identity.

The native module does not run the prioritization model. Candidate source snapshots and modeled_benefits are retained as supplied. Costs come from the operator's actual budget, commitment or expenditure records. Field observations come from actual visits and source results. The blank method catalog contains planning templates; it supplies neither measured results nor invented cost rates.

## Files and public API

The public module is model.implementation. It exposes:

- make_plan(plan_id, title, start_date, *, description="", target_date=None, working_days=None, holidays=None)
- validate_plan(document): returns a deep copied, validated document with unknown fields retained.
- read_document(path), load_json(bytes_or_text), canonical_bytes(document), document_digest(document), json_text(document)
- schedule_plan(document, as_of=None), summarize_plan(document, as_of=None)
- report_csv(document, table="tasks", as_of=None), render_report_html(document, as_of=None)
- ImplementationStore(workspace_or_path)
- ImplementationError, ValidationError and RevisionConflict

Store operations:

| Operation | Result |
| --- | --- |
| create(document, actor="") | New committed plan at revision 1; fails if the ID already exists |
| get(plan_id, revision=None) | Current or exact historical plan |
| list_plans() | IDs, titles, revisions and dates for existing plans |
| save(document, expected_revision, actor="") | Next committed revision, or current plan when content is unchanged |
| import_document(document, expected_revision=None, actor="") | Receipt with status, plan, source_document_digest, source_revision and applied_revision |
| history(plan_id) | Append-only event chain with actual revision file references |
| add_records(plan_id, collection, records, expected_revision, actor="") | Appends new original IDs; identical record replays are idempotent |
| attach_file(plan_id, path, expected_revision, actor="", label="") | Updated plan, source_link, and actual copied file_ref |
| export_json(plan_id, path, revision=None, *, overwrite=False) | Actual written JSON file_ref |
| report(plan_id, out_dir, as_of=None, *, revision=None) | Actual report directory and file references for the selected retained revision |

The CLI emits JSON on stdout. Errors emit JSON on stderr. Exit 0 means success, 2 means invalid input or an operation error, and 3 means a revision conflict. Revision conflict output includes the expected_revision, current_revision and preserved conflict_ref when an import needs reconciliation.

## Portable document contract

The schema is upstate.implementation-plan/v1.

Required top-level keys are schema, id, revision, title, description, start_date, currency, working_days, holidays, created_at, updated_at and all nine arrays: source_links, candidates, tasks, budget_lines, sites, monitoring_plans, visits, activities and observations. target_date is optional.

Currency is USD, stored with a minor-unit exponent of 2. Revision and integer amounts remain within the interoperable safe integer range, 0 through 9007199254740991. IDs contain 1–96 ASCII letters, digits, underscores or hyphens, starting with a letter or digit. IDs are unique within their typed collection. Original IDs are never regenerated from labels.

Dates are YYYY-MM-DD. Timestamps include a timezone, for example 2026-10-12T23:30:00Z. Working days use ISO weekday numbers 1 through 7, with Monday through Friday as the default. Holidays are exact dates excluded from the project calendar.

| Collection | Core fields |
| --- | --- |
| source_links | id, kind, label; optional reference |
| candidates | id, label, source, modeled_benefits; optional area_ha |
| tasks | id, title, phase, assignee, status, duration_days, depends_on, progress_pct, notes, evidence_refs; optional candidate_id and start_not_before |
| budget_lines | id, kind, label, amount_minor; optional task_id, date and reference |
| sites | id, label; optional latitude, longitude, candidate_id and source_ref |
| monitoring_plans | id, title, objective, site_ids, parameters, notes; optional method_ref and frequency |
| visits | id, site_id, observer, status, notes, evidence_refs; optional monitoring_plan_id, planned_date and visited_at |
| activities | id, visit_id, site_id, kind, notes; optional sample_id, collected_at, method and custody_ref |
| observations | id, activity_id, parameter, result_type, value, original_text, unit, notes; optional basis, fraction, qualifier, detection_limit, quantitation_limit, method and qa_status |

Task status is planned, in_progress, complete or cancelled. Duration is a nonnegative whole number of working days or null. Zero is a milestone. Progress is a finite number from 0 to 100; status/progress disagreement is reported without rewriting the original values.

Budget kind is budget, commitment or actual. Each is totaled separately. The app does not derive an expenditure from a commitment, sum commitments with actuals, or compute a cost rate from modeled benefits.

Site latitude and longitude must appear together when provided, within their normal geographic ranges. Site source_ref references source_links.id. The candidate references address candidates.id.

Visit status is planned, complete or cancelled. A completed visit requires its actual visited_at timestamp. Its site must belong to the referenced monitoring plan. Activity kinds are sample, measurement, inspection and photo. Activity site_id must match its visit. A sample activity requires its original sample_id.

Observation result_type is numeric, censored, text or missing. Numeric records have a finite value and retain original_text and unit. All other result types have value:null. Censored records require the original_text, original qualifier and unit; numeric detection_limit and quantitation_limit are optional and nonnegative. Text records retain the original text. Missing records retain an explicit missing state and can carry the reason in original_text or notes. Use unit "1" for a dimensionless numeric quantity. All pollutant names, units, bases, fractions, limits and QA metadata stay attached to the original record.

Unknown additional fields are retained in JSON, subject to safe JSON types, finite numbers, interoperable integers and a maximum nesting depth of 64. This accommodates richer method, laboratory, custody and source metadata without renaming core fields.

## First native session

Choose the actual workspace, project ID and start date:

    python -m model.implementation_cli --workspace /path/to/workspace create upper-savannah \
      --title "Upper Savannah implementation" --start-date 2026-10-13

A new plan has revision 1 and empty operational arrays. Import the catalog's blank plan if its retained guidance references and method catalog are wanted instead:

    python -m model.implementation_cli --workspace /path/to/workspace import path/to/blank-plan.json

An initial import accepts revision 0 and commits it as revision 1. An initial import with an existing positive revision preserves that revision. Existing plans use the import and reconciliation rules below.

Use current revision readback before an edit:

    python -m model.implementation_cli --workspace /path/to/workspace show upper-savannah
    python -m model.implementation_cli --workspace /path/to/workspace history upper-savannah

Add a task with an unknown duration until the operator estimates it:

    python -m model.implementation_cli --workspace /path/to/workspace add-task upper-savannah assess-01 \
      --title "Confirm site implementation scope" --phase assessment --duration unknown \
      --expected-revision 1

Edit against the returned revision. --duration accepts a whole workday count or unknown. --depends-on may repeat and replaces the complete predecessor list; --clear-depends removes that list. --start-not-before clear removes the date constraint.

    python -m model.implementation_cli --workspace /path/to/workspace edit-task upper-savannah assess-01 \
      --assignee "Project operator" --status in_progress --expected-revision 2

All commands return the resulting revision. Subsequent commands must use that revision rather than assuming a count.

## Field entry and sources

Convenience commands are add-site, add-monitoring-plan, add-visit, complete-visit, add-activity, add-observation and add-budget-line. Each requires the original record ID and --expected-revision. Run the individual command with --help for its full fields. complete-visit requires --visited-at; it never substitutes the command's execution time for an actual field visit.

For batch entry, put complete records into a JSON object with a records array, then append it to the chosen collection:

    python -m model.implementation_cli --workspace /path/to/workspace append upper-savannah sites \
      path/to/sites-records.json --expected-revision CURRENT_REVISION

Add referenced sites and monitoring plans before visits; add visits before activities; add activities before observations. A single whole-plan import can introduce all related records atomically in one revision. Matching original IDs and duplicate record comparison prevent accidental duplicate appends.

Retain actual source or custody files:

    python -m model.implementation_cli --workspace /path/to/workspace attach upper-savannah \
      path/to/source-file.pdf --label "Original source document" --expected-revision CURRENT_REVISION

The attachment is copied while hashing its actual bytes. The source link records the original filename, SHA-256, size and workspace-relative reference. The returned file_ref is an existing path. Use the retained reference in evidence_refs, custody_ref or the appropriate metadata field. Candidate source and modeled_benefits snapshots are entered from their existing source record, not reconstructed by a new model run.

## Calendar and scheduling semantics

For each task, start is the first project workday on or after the greatest of project start_date, task start_not_before and each predecessor's finish_exclusive.

A positive duration consumes that number of working dates. last_work_date is the final consumed working date; finish_exclusive is the next project workday boundary. A one-day Friday task on a Monday–Friday calendar consumes Friday and has a Monday finish boundary. A successor begins Monday. A zero-day milestone starts and finishes at the same boundary.

An unknown-duration task can retain a calculated start but has no calculated finish. A successor of a task with an unknown finish has no calculated start or finish. schedule_state is scheduled, unknown_duration, blocked_unknown or calendar_overflow. The operator-facing issue explains which predecessor needs duration or calendar information. A noncancelled task that depends on a cancelled task retains its schedule and receives a cancelled_dependency issue so the dependency can be reviewed deliberately.

At the selected as_of date, an unfinished positive-duration task is overdue when its exclusive finish boundary is on or before that date. A milestone is overdue when its start is earlier than as_of. Completed and cancelled tasks are excluded from overdue counts. Planned visits are overdue when planned_date is earlier than as_of. No claim of actual completion is inferred from elapsed planned dates.

schedule_plan returns as_of, calendar, tasks, issues, critical_finish_exclusive, latest_known_finish_exclusive and unknown_task_count. Each schedule row contains id, title, status, start, finish_exclusive, last_work_date, duration_days, schedule_state, issue_codes and overdue. critical_finish_exclusive is null when any noncancelled task lacks a known finish. Calendar overflow produces an explicit issue, never a wrapped or fabricated date.

## Offline editing and conflict recovery

Export a current snapshot:

    python -m model.implementation_cli --workspace /path/to/workspace export upper-savannah \
      path/to/upper-savannah-offline.json

Edit the snapshot while keeping its id, revision and created_at. Unknown fields, evidence references and original results remain with their records. Return it with:

    python -m model.implementation_cli --workspace /path/to/workspace import \
      path/to/upper-savannah-offline.json

If the imported revision is still current, the store validates the entire document and commits the next local revision. Reimporting the same document digest and source revision is idempotent: the receipt identifies its previously applied revision and returns the current plan. An exact copy of the current plan is unchanged.

A different stale or future revision is preserved under implementation/plans/PLAN_ID/conflicts/. Exit 3 and conflict_ref identify the actual preserved file. The current plan and all its history remain available. To reconcile, export the current plan, incorporate the wanted records or corrections from the conflict's incoming object using their original IDs, retain the current revision, then import the reconciled document. A new incoming candidate source selection requires a new candidate ID; source, area_ha and modeled_benefits cannot be overwritten under an existing candidate ID.

Historical candidate IDs also retain their original snapshot meaning if a candidate is removed and later reintroduced. No command silently chooses the last received copy. --expected-revision is an additional check, not an override flag. Save and import never force replacement of concurrent edits.

## Durable storage and recovery

Storage is under:

    WORKSPACE/implementation/plans/PLAN_ID/revisions/
    WORKSPACE/implementation/plans/PLAN_ID/conflicts/
    WORKSPACE/implementation/plans/PLAN_ID/attachments/

An OS advisory lock serializes each plan's writes and releases on process exit. A complete document and its revision event are flushed together, then published as an immutable revision file with an exclusive atomic link. Concurrent creates cannot overwrite each other. Temporary .pending files never count as committed revisions.

The highest committed revision is authoritative. There is no mutable pointer whose update can become separated from its document. Each event includes the predecessor revision and document digest. history verifies the chain. Source snapshots in historical revisions remain available through get or export with a specific revision. Keep the whole plan directory when transferring a native workspace, including attachments.

Reports reserve a new output directory and publish manifest.json last. A report directory without its final manifest is incomplete. Existing report directories are not overwritten; select a new directory for a fresh report.

## Reports for operator review

    python -m model.implementation_cli --workspace /path/to/workspace report upper-savannah \
      --as-of 2026-10-13 --out path/to/report-2026-10-13

The package contains report.html, plan.json, summary.json, tasks.csv, budget.csv, sites.csv, monitoring_plans.csv, visits.csv, activities.csv, observations.csv and manifest.json. The report is standalone, uses a neutral industrial layout and has a print stylesheet. File references are returned only after the package has been written.

The schedule displays unknown estimates, cancelled dependencies and overdue work. Budget, commitment and actual totals are separate USD amounts. Visits show completion and original evidence references. Observation tables retain results, qualifiers, limits and units. Recorded field forms display each original field key, label and answer, with reported numeric value and unit where entered. The complete original template, response and additional activity metadata remain available with the report and in the CSV extra_json column. CSV text that would begin a spreadsheet formula receives a protective apostrophe; plan.json retains the exact original text. No table aggregates nutrient observations into a cross-pollutant number or merges field observations with modeled benefits.

Single table CSV and standalone HTML commands are also available. Exported JSON is the complete exchange document; CSV and HTML are operator views. Source attachments stay in the retained workspace and retain their actual references in the plan. Archive the plan directory with a report when the recipient also needs the original attachment bytes.
