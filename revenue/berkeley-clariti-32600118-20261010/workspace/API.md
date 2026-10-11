# Retained permitting workspace API

This local service wraps the original `../audit.mjs` comparator. Run `python3 app.py --db /path/to/review.sqlite --port 8798` with Python 3.10+ and Node.js 22+ available. Set `BERKELEY_NODE` to a Node executable when it is not on `PATH`. The browser and service use `http://127.0.0.1:8798`.

## Session and concurrency

The service replaces `__SESSION_TOKEN__` in the served page with a process-specific token. Include it as the `X-Workspace-Token` header on every JSON POST. Each write includes the integer `revision` last read from `/api/state`. A stale revision returns HTTP 409 with `{error, message, current_revision}`. Other invalid requests return `{error, message}` with HTTP 400. Reload state after a successful write; the write response identifies the affected object.

Original bytes, mapping choices, run input manifests and reviewer decisions stay in the selected SQLite file. Uploading or selecting another export changes the inputs for the next run. Completed comparisons retain their input hashes and mappings. Download a full backup to transfer or reopen a workspace, using `python3 app.py --restore backup.sqlite --db /new/path.sqlite`. Restore requires a new destination.

## Workspace state and settings

`GET /api/state` returns:

```json
{
  "revision": 12,
  "settings": {
    "cohort": "core-permits-2026-10-11",
    "currency": "USD",
    "currency_scale": 2,
    "scope_note": "Same observation point; agreed permit population, departments and excluded records.",
    "scenarios": [
      {
        "id": "linked-fire-finalization",
        "title": "Building and Fire finalization",
        "criterion": "A Building permit cannot be finalized until its linked Fire permits are finalized. Record the actual case IDs and observed lifecycle behavior.",
        "required": true
      }
    ]
  },
  "datasets": [],
  "runs": [],
  "fields": ["id", "type", "department", "status", "relatedIds", "reviewStates", "reviewAssignments", "reviewDueAt", "attachments", "paymentMinor"],
  "required_fields": ["id", "type", "department", "status", "attachments"]
}
```

Use `POST /api/settings` with `{revision, settings}`. Each required scenario needs a unique ID, title and explicit criterion. Scenario decisions are attached to a completed run, so a corrected run gets its own current acceptance decision. An agreed nonblank scope note is required before a comparison.

A dataset in state has `id`, `side` (`source`, `target` or `crosswalk`), `filename`, `sha256`, `created_at`, `captured_at`, `mapping`, `confirmed`, `current`, `headers`, `rows` and `preview`. `preview` contains up to five original `{line, data}` rows. A run list entry has `id`, `label`, `created_at` and `source_revision`.

State also includes `scenario_recipes`, containing the two source-derived configurable scenarios with `source_url`, `source_locator` and optional `check` objects. Copy a recipe into settings after adjusting the actual normalized department names and statuses.

## Original exports, mapping and selection

`POST /api/upload` takes `{revision, side, filename, captured_at, base64}`. `base64` is the standard base64 encoding of the original UTF-8 CSV or JSON bytes. `captured_at` is the export's ISO timestamp with an explicit offset. Each file is at most 25 MiB and 500,000 records. CSV headers must be unique and nonblank; JSON may be an array or `{cohort, records}`. The optional embedded cohort must agree with workspace settings.

The response is `{dataset_id, rows}`. Uploading selects the export for its side and proposes matching canonical column names, but the operator must confirm the mapping before running it.

`POST /api/mapping` takes `{revision, dataset_id, mapping}`. The complete mapping object is:

```json
{
  "fields": {
    "id": "Permit Number",
    "type": "Record Type",
    "department": "Department",
    "status": "Permit Status",
    "relatedIds": "Related Permit IDs",
    "reviewStates": "",
    "reviewAssignments": "",
    "reviewDueAt": "",
    "attachments": "Document Count",
    "paymentMinor": "Collected Amount"
  },
  "related_separator": "|",
  "reviews": {"Fire": "Fire Review Status", "Public Works": "PW Review Status"},
  "reviewers": {"Fire": "Assigned Fire Reviewer"},
  "review_due_dates": {"Fire": "Fire Review Due"},
  "type_aliases": {"Building Permit": "permit"},
  "department_aliases": {"B&S": "Building", "PW": "Public Works"},
  "status_aliases": {"Complete": "Finalized"},
  "review_aliases": {"Approved": "Passed"},
  "reviewer_aliases": {},
  "payment_format": "decimal"
}
```

Every mapped value names an original column or JSON path; an empty string omits an optional field. Supported types are `permit`, `license`, `inspection` and `special_event`. Mapping is explicit and case-sensitive. Fields `id`, `type`, `department`, `status` and `attachments` are required. Attachment count is an integer, including an explicitly supplied zero.

`reviewStates`, `reviewAssignments` and `reviewDueAt` may each map a JSON object or a CSV cell containing one. Alternatively, `reviews`, `reviewers` and `review_due_dates` map each named department to its separate export column. Multiple maps for the same department and value are rejected. Department aliases also apply to review-map keys. Reviewer aliases are an explicit equivalence decision; unmatched original names remain differences.

Review due values accept ISO dates (`2026-10-20`) or ISO timestamps with offsets (`2026-10-20T17:00:00-07:00`). Intake preserves date-only meaning and normalizes offset timestamps to UTC. Ambiguous local dates and timestamps require an explicit preparation step in the source export.

Payments use nonnegative integer minor units or exact dot-decimal strings, selected by `payment_format`; `currency_scale` determines decimal conversion. Floating-point JSON payment values and rounding beyond the configured scale are rejected. The retained payment field is a case-level comparison, with transaction reconciliation requiring its own transaction export contract.

`POST /api/select-dataset` takes `{revision, dataset_id}`. It selects an already confirmed retained export or crosswalk for the next comparison without changing its bytes or mapping. An unconfirmed export must be mapped first. The response is `{dataset_id, side}`.

`POST /api/crosswalk` takes `{revision, filename, base64}` for a CSV with exactly `source_id,target_id`. It selects an explicit one-to-one target-to-source ID crosswalk. The mapping applies to both target case IDs and target related IDs. Every supplied target identifier must be represented. `POST /api/crosswalk/remove` with `{revision}` removes its current selection while retaining the original file and all completed runs.

`GET /api/datasets/:id/preview?offset=0&limit=50&normalized=1` returns `{rows, total, offset, limit, errors}`. Each normalized row contains its original `line`, `data`, canonical `normalized` record or null, and an `errors` array. Omit `normalized=1` to inspect the untouched export. Maximum page size is 500. `GET /api/datasets/:id/download` returns the exact original bytes.

## Comparison and case review

`POST /api/run` takes `{revision, label}` and returns `{run_id}`. It normalizes the selected confirmed exports and calls `auditDetailedSnapshots` from the original engine. Input errors produce a retained `INPUT_REVIEW_REQUIRED` run with row-level errors. Valid inputs retain the original aggregate report and a separate exact private finding for each discrepancy.

`GET /api/runs/:id?summary=1` returns:

- `id`, `label`, `created_at`, `source_revision`.
- Frozen `settings`, original input `manifest` (including each dataset ID, byte count, SHA-256, capture timestamp and mapping), and `engine` source SHA-256.
- `public_report`: original aggregate status, source and target counts, total findings, issue counts and bounded anonymous examples.
- `input_errors` and `normalization_summary` with source row totals, normalized row totals and error counts.
- `continuity` identifies the previous retained run for this cohort and counts unchanged, new/changed and no-longer-present findings; invalid-input runs leave those counts null. `scenario_results` retains the configured candidate checks.
- `reviews`, `scenario_reviews`, `cutover`, `counts`, `cutover_blockers`.
- The latest 20 `review_history` entries in chronological order, plus `review_history_total`.

Omit `summary=1` to include the complete findings and review history. Paginate private findings with `GET /api/runs/:id/findings?offset=0&limit=50&query=&code=&status=`. The response is `{rows, total, offset, limit, counts}`. Query matches case ID or issue code. `status` is `open`, `needs_fix` or `accepted_difference`; counts cover the whole run.

A finding contains `id`, `case_id`, `code`, `message`, `source`, `target`, `details`, `source_context`, `target_context` and `review`. Its original contexts contain `{dataset_id, line, values}` for direct inspection and download. Its normalized comparator rows use `type`, `department`, `status`, `links`, `reviews`, `reviewAssignments`, `reviewDueAt`, `attachments` and `paymentMinor`.

An unchanged finding can include `prior_review: {run_id, run_label, finding_id, status, owner, note, updated_at}`. Matching uses the case, issue class, relationship details and the actual compared before/after values. This makes the previous review available while the current run keeps its own explicit reviewer decision.

`GET /api/runs/:id/cases?offset=0&limit=50&query=&type=` returns `{rows, total, offset, limit}` for the entire same-cohort case population. Each row has `case_id`, `source`, `target`, `finding_ids` and `review_status`. Source and target are the canonical input form, with `relatedIds` and `reviewStates`. Matched records remain available for lifecycle inspection. A source or target can be null for a missing or unexpected record.

Original issue classes are missing/unexpected records, type, department, status, relationships, review states, attachments, payment minor units and orphan target relationships. Optional review metadata also enables `REVIEW_ASSIGNMENTS_CHANGED` and `REVIEW_DUE_CHANGED`. Old snapshots without this metadata retain their original aggregate issue shape.

`POST /api/review` takes `{revision, run_id, finding_id, status, owner, note}`. Decisions require a named reviewer. Acceptance of a difference requires a reason. Every change appends history. A corrected export is uploaded, mapped and compared in a new run; previous input bytes, discrepancies and decisions stay available.

## Cutover scenarios and handoff

`POST /api/scenario-review` takes `{revision, run_id, scenario_id, status, owner, note}`. Status is `pending`, `passed` or `failed`. Passing or failing requires an observation note.

An optional scenario `check` runs against the actual normalized candidate. Supported configurations are:

```json
{"kind":"linked_finalization","parent_type":"permit","parent_department":"Building","child_type":"permit","child_department":"Fire","finalized_statuses":["Finalized"]}
```

```json
{"kind":"required_review_fields","departments":["Fire","Public Works","Land Use"],"open_states":["Open","In Review"]}
```

Each `scenario_results` entry contains `{scenario_id, kind, status, checked, violation_count, violations, violations_truncated}`. Status is `passed`, `failed` or `not_exercised`. The linked-finalization check counts Building records with a supplied linked Fire record and identifies any finalized parent with an unfinished child. The review-field check counts the selected open department reviews and identifies missing assigned reviewers or due dates. Each violation retains the exact `case_id` and its relevant linked ID or department. Up to 1,000 violation details are retained per scenario, with the complete count recorded. A cohort with no applicable cases is marked `not_exercised` so the operator can choose an appropriate cohort or recipe.

`POST /api/cutover` takes `{revision, run_id, status, owner, note}`. Status is `pending`, `ready` or `deferred`. The service accepts `ready` only when both snapshots contain records, input errors are resolved, every finding is accepted as an explained difference or removed through a corrected run, at least one required scenario exists, and every required scenario is passed. A later finding or scenario decision change reopens an existing ready decision and retains the earlier decision in history.

Required configured checks must also return `passed` before a ready cutover decision. The named scenario review records the operator's real case observation and lifecycle acceptance alongside that candidate snapshot result.

| Download | Contents |
| --- | --- |
| `/api/runs/:id/handoff` | Complete private run, settings, manifests, original contexts, all cases, decisions and history as JSON |
| `/api/runs/:id/findings.csv` | Exact case findings, review notes and original source/candidate contexts; spreadsheet formula prefixes escaped |
| `/api/runs/:id/summary` | Original aggregate report with anonymous example tags |
| `/api/backup` | Consistent SQLite copy containing all original bytes, mappings, comparisons and decision history |

## Berkeley source recipes

Adopt each scenario with the actual departmental vocabulary, selected cohort and responsible reviewers. The original sources support the following concrete choices:

| Source | Configurable acceptance work |
| --- | --- |
| [To-Be Appendix B, PDF p. 6, Sessions 1/6/24](https://berkeleyca.gov/sites/default/files/documents/Appendix%20B%20-%20Rapid%20Workflow%20To-Be%20Business%20Process%20Maps_0.pdf) | A Building permit cannot be finalized until linked Fire permits are finalized; inspect record relationships and retained lifecycle results. |
| [Addendum E, question 71](https://berkeleyca.gov/sites/default/files/documents/24-11661-C%20-%20Addendum%20E%20-%20Additional%20Vendor%20Questions%20and%20Second%20Extension.pdf) | Reconcile assigned reviewer, due dates and status for open Fire reviews, and the agreed Public Works/Land Use population. Map the actual departmental Excel columns. |
| [To-Be Appendix B, PDF pp. 66–68, Session 21](https://berkeleyca.gov/sites/default/files/documents/Appendix%20B%20-%20Rapid%20Workflow%20To-Be%20Business%20Process%20Maps_0.pdf) and Addendum E question 80 | Define a separate financial transaction acceptance cohort for daily permit-system versus Tyler Munis ERMA receivables, partial payments and corrections when those exports are commissioned. |
| [May 12 contract 32600118 amendment](https://berkeleyca.gov/sites/default/files/2026-04/2026-05-12%20Item%2005%20Contract%20No.%2032600118%20Amendment.pdf) | Special-event intake, multi-department review, fees and inspections are a distinct implementation population after the core system; keep its observation point and acceptance criteria explicit. |
| [Clariti Enterprise product contract](https://www.claritisoftware.com/products/enterprise-permitting-software) | Request native configurable-report CSV exports and the supplied platform's actual field/relationship definitions for the agreed acceptance cohort. |

The January contract report is [Item 16, January 20, 2026](https://berkeleyca.gov/sites/default/files/2026-01/2026-01-20%20Item%2016%20Contract%20Clariti%20Cloud%20Inc.pdf). The special-events amendment was adopted in [May 12 annotated council actions, p. 4, Item 5, Resolution 72,256–N.S.](https://berkeleyca.gov/sites/default/files/city-council-meetings/2026-05-12%20Annotated%20Agenda%20-%20Council.pdf).
