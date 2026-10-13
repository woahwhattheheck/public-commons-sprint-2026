# Sample quality-control review in Implementation & fieldwork

The existing field plan can retain a complete scientific review of explicitly declared sample duplicates, replicates and blanks. The review uses an exact saved plan revision, preserves every original observation and source relationship, and records the reviewer's criteria and interpretation. Its output is a normal retained Implementation report edition that travels with the existing complete Workspace archive. The same review can become an ordinary ordered scientific report source.

## Review the original results

Open an existing native plan in **Implementation & fieldwork → Field records → Sample quality control**. The editor identifies the saved revision it uses. Unsaved field edits remain in the original plan editor; save those edits first when they should become part of a new review.

Enter a review title, scientific purpose, reviewer and review date. Search the retained observations by result ID, sample, site, parameter, unit, method, qualifier or original result text. The table pages through every matching record, and selection survives page changes. **Original record** downloads the complete observation together with its original activity, visit and site objects.

Declare one control group at a time:

| Group | Required original results | Declared relationships |
| --- | --- | --- |
| Duplicate | Exactly two | Field duplicate, laboratory duplicate, or split sample |
| Replicate | At least three | Field replicate or laboratory replicate |
| Blank | Exactly one original blank result | Field, equipment, trip, or method blank |

The **Relationship source / basis** field records why the selected results form that group. Original IDs alone do not declare a control role. For a blank, select any explicitly associated sample results separately. Associations remain visible with their original definitions and QA dispositions.

A group can remain descriptive, or use a stated acceptance criterion. Choose an applicable metric, enter its maximum, cite the criterion source, and describe its applicability to these exact results. The editor supplies no universal threshold. Optional quantitation conditions are expressed as a minimum multiple of **each selected result's original quantitation limit**.

Source qualifier and QA strings are exact. The default admitted arrays contain only the empty string, written as [""] in the form. To admit a qualified numerical result, explicitly include its original string in the corresponding array and retain the relevant method justification in the group. This changes only this review's evaluation selection; the observation's original qualifier and disposition remain intact.

Add the group, inspect the complete selected group table, and calculate the review. Edit or remove groups without changing the saved plan. Selection JSON can be saved and reopened independently. Receiving a selection first asks the original native evaluator to validate it against this exact plan and revision; an invalid selection leaves the current draft intact.

## Understand the calculations

The evaluator compares exact original parameter, unit, basis, fraction, observation method and activity method strings. Different definitions make the group unavailable for a numerical comparison. Equal unspecified fields remain visibly unspecified; their comparability must be addressed in the reviewer's declared relationship and criterion applicability.

For two compatible nonnegative numeric results x and y with a positive mean:

RPD (%) = 100 × |x − y| / ((x + y) / 2).

Absolute difference is |x − y| in the original measurement unit. Negative numeric results can have an absolute difference; a relative metric requires nonnegative results and a positive mean.

For at least three compatible nonnegative numeric replicate results with a positive mean, the evaluator reports the arithmetic mean, sample standard deviation with denominator n − 1, and:

RSD (%) = 100 × sample standard deviation / arithmetic mean.

These computations use scaled values to avoid unnecessary overflow. A result outside finite representation remains unavailable. A zero mean produces no relative metric. Original zeros remain zeros in the retained record; no epsilon or imputed concentration is added.

A blank criterion compares the original numeric blank result to the entered maximum in its original unit. A negative blank is retained for method review rather than being declared within a nonnegative criterion. Associated sample definitions are checked independently. The application does not subtract the blank or change associated samples' dispositions.

Censored, text and missing results stay in their original forms. Detection and quantitation limits remain visible, but no limit fraction is substituted for a measurement. A criterion that requests quantitation applicability needs a positive original quantitation limit on each selected result and sufficient measured value relative to that limit.

Each group returns one of these outcomes:

| Outcome | Meaning |
| --- | --- |
| descriptive | Numerical/context review without an entered acceptance criterion |
| within_entered_criterion | Available metric meets this entered maximum and the selected applicability conditions |
| exceeds_entered_criterion | Available metric exceeds this entered maximum |
| not_evaluated | Original result type, definitions, source disposition, quantitation support or selected metric prevents evaluation |

The full result retains concrete reasons, original qualifiers and QA strings, exact result IDs, declared relationships, all metrics, and the entered criterion. A descriptive metric can remain visible while a qualifier prevents acceptance evaluation. These are source-bound review outcomes; they do not replace a laboratory's original QA judgment or authorize a different sampling design.

### Primary method references

- [EPA National Functional Guidelines for Inorganic Superfund Methods Data Review, January 2017](https://www.epa.gov/sites/default/files/2017-01/documents/national_functional_guidelines_for_inorganic_superfund_methods_data_review_01302017.pdf): duplicate RPD and method-specific quantitation/application conditions.
- [EPA New England Environmental Data Review Program Supplement, April 2013, section 2.8](https://www.epa.gov/sites/production/files/2016-04/documents/epa-ne-edr-supplement.pdf): field duplicate, replicate and split-sample precision, including the role of project-specific criteria.

The equations are reusable descriptive tools. The references' numerical acceptance criteria apply to their stated methods and projects; the application therefore requires the actual reviewer criterion and source rather than transplanting one threshold.

## Save, report and reopen

**Save complete native review** submits the original operator action implementation.qc.save. The exact selection and original task/operation identities are retained before dispatch. After a lost response, **Recover original submit** resends that same operation and payload. Interrupted tasks use the existing native resume action. Closing the editor stops its reads and task polling while preserving the draft and pending operation.

A completed review appears in the plan's existing report history and in this editor's saved-review list. Reopening loads the immutable saved report and independently recalculates its result from the original retained plan and selection. A later field-plan revision does not relabel the earlier review.

The report retains:

- Original plan and original revision event.
- Full review selection, reviewer, purpose, date, criteria and relationship declarations.
- Every original observation, activity, site and visit relationship, including records outside the selected groups.
- Complete QC CSV, full original-record CSV, review JSON and printable HTML.
- Original local-file availability inventory and every available verified plan attachment. Attachment member names bind their source hashes and preserve an ordinary filename suffix; the inventory retains the original source name, path and label.
- Native report manifest, scientific report recipe and source manifest.

**Complete report and sources ZIP** exports this full flat report directory. It checks the finished archive's exact member names, lengths and hashes before publication. Reusing the same original export task reopens and verifies the same complete ZIP. After full Workspace receiving, an old completed export task retains its portable report downloads. Its sender-local ZIP is recreated through the same **Complete report and sources ZIP** action when needed; the receiving machine never follows an unrelated sender path. Unzip it and open report.html to read or print every group offline. The linked JSON/CSV and original source members remain together. The original complete Workspace export is the editable project transfer; receiving it reopens the same plan revisions and retained report editions through the existing portable verifier.

**Register with scientific reports** imports the retained qc-sources.json through the original Workspace source importer. The new document has the normal OBSERVED_CONTEXT role and original source binding. **Prepare scientific/client report** opens that existing workflow with the saved QC source selected. Add other retained scientific sources in the ordered report selector to compose the intended report.

## Native API and command-line interface

Run from the existing application directory with its native Python environment:

~~~sh
python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  records --plan-id ACTUAL_PLAN_ID --revision ACTUAL_REVISION

python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  preview --selection /absolute/actual-qc-selection.json

python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  save --selection /absolute/actual-qc-selection.json

python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  inspect --plan-id ACTUAL_PLAN_ID --report-id RETURNED_REPORT_ID

python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  source --plan-id ACTUAL_PLAN_ID --report-id RETURNED_REPORT_ID

python -B -m model.implementation_qc --workspace /absolute/original-workspace \
  export --plan-id ACTUAL_PLAN_ID --report-id RETURNED_REPORT_ID \
  --output /absolute/separate-output/qc-report.zip
~~~

Use the editor's exported selection to supply the actual IDs and entered criteria. The report ID is the original report manifest digest, while review_id identifies the scientific plan-and-selection calculation.

Model API:

~~~python
from model import implementation_qc

preview = implementation_qc.preview(workspace, selection)
saved = implementation_qc.save(workspace, selection)
opened = implementation_qc.inspect(workspace, saved["plan_id"], saved["report_id"])
source = implementation_qc.scientific_source(workspace, saved["plan_id"], saved["report_id"])
archive = implementation_qc.export(workspace, saved["plan_id"], saved["report_id"], outside_zip)
~~~

Original registered HTTP routes:

| Method and path | Parameters |
| --- | --- |
| GET /api/implementation-qc/records | workspace, plan_id, revision |
| GET /api/implementation-qc/list | workspace, plan_id |
| GET /api/implementation-qc/inspect | workspace, plan_id, report_id |
| POST /api/implementation-qc/preview | workspace and selection |
| POST /api/implementation-qc/save | workspace, operation_id and payload.selection |
| POST /api/implementation-qc/source | workspace, operation_id and payload containing plan_id/report_id |
| POST /api/implementation-qc/export | workspace, operation_id and payload containing plan_id/report_id |

Queued action names are implementation.qc.save, implementation.qc.source and implementation.qc.export. The editor uses the original /api/actions task protocol. File links are original authenticated operator tickets.

## Source integration

The family is additive: model/implementation_qc.py, operator/implementation_qc.py, operator/web/implementation_qc.mjs, operator/extensions/implementation-qc.json, this guide and integration/implementation_qc.json. The extension uses the existing implementation_operator provider base and normal report retention. It needs the original Implementation family, shared extension registry and observed-context scientific report consumer.

The current Implementation controller publisher composes a narrow Field records launch. Import openImplementationQC and detachImplementationQC from ./implementation_qc.mjs, call openImplementationQC(this) from the sample-qc button, and close its editor before a destructive parent render, plan switch or detach. The helper uses the exact nativePlan and preserves unsaved parent drafts. It introduces no competing plan editor or observation registry.

The component manifest identifies this complete source family for the maintained cumulative source selection. The shared application publisher retains its current complete controller, lab/results, source evidence and outcome-review changes when joining the launch. Restart the original operator after the new descriptor is installed, then reopen the existing saved plan.


## Carry a saved QC review into decisions and field follow-up

Open an exact saved review and choose **Review decisions and follow-up**. This opens that report's original duplicate, replicate and blank groups beside the latest saved Implementation plan. The heading displays three separate revisions: the original scientific review, the current field plan, and the revision targeted by the current action draft.

The original report remains the scientific reference. A later correction to a measurement appears as a source change with both complete original and current records. A removed observation remains visible as missing. The reviewer can decide how the original QC result applies to a particular use and retain the work required to resolve it.

### Record decisions with a specific use

Enter the reviewer and review date. Search all groups by original identifiers, result context, retained decisions or assigned tasks. The table pages through the entire original report. **Full original group and history** downloads the complete selected group, all its retained decision events, linked tasks and source changes.

Choose **Review group** and enter:

| Field | What the reviewer records |
| --- | --- |
| Decision | Unresolved, use as reviewed, restricted use, exclude from selected use, or follow-up required |
| Scientific / reporting use scope | The specific analysis, comparison, map, report or other use being reviewed |
| Decision reason | The method, observation or project context supporting this decision |
| Action state | Open or closed |
| Closeout note | The explanation and evidence supporting closure |

For example, a duplicate that exceeds an entered criterion might need a documented restriction for one reported comparison and a task to obtain the original laboratory review. A descriptive QC result can also need follow-up when its sampling relationship requires clarification. The choice belongs to the recorded reviewer and applies to the stated use.

The decision is separate from the original group's numerical outcome, qualifier, laboratory QA and result text. Retained events identify the original report, group, scientific revision, original group digest and preceding event.

### Connect the decision to actual fieldwork

Select existing tasks from the current plan. Each task keeps its original identity, phase, assignee and status. Alternatively, create one additional task with a title, assignee, phase, duration if known, earliest start date if applicable, and notes. Its default phase is **Quality follow-up**. A saved action batch creates that task inside the normal Implementation plan, with its original task fields and revision history.

Use the original plan's task controls to edit progress, dependencies and completion. Closing a QC reviewer action retains the linked tasks' actual statuses; outstanding tasks remain visible in the retained warnings and report. A reviewer can therefore close a documented use decision while longer-running field work continues, with that distinction available to the next operator.

Select evidence from the plan's original source links. The report retains their full descriptors and snapshots. To add new supporting material, retain it through the original field plan and refresh this view. The refresh shows current tasks and source changes while keeping the action draft's previous target revision explicit.

Choose **Add this decision to the draft**. Repeat for all groups that need review. This prepares one batch of decisions and new tasks. The draft table displays every staged group, its use, reason and follow-up. A group can be removed from the draft without changing its existing native history.

### Review, save and reopen the complete action batch

**Preview complete action review** validates the entire selection against the current saved plan. It displays all proposed decision events, created tasks, source changes and the original batch receipt. Download the complete preview when another reviewer needs to inspect it.

If the native plan has advanced, the editor retains the earlier expected revision. Inspect the current source changes, tasks and evidence, then choose **Use current saved plan revision** to update the draft explicitly. Saving still checks that revision atomically, so a concurrent field edit returns a conflict for reconciliation.

**Save decisions and follow-up tasks** queues the original implementation.qc.actions.save operation. Its selection and operation identity are retained before dispatch. **Recover original submit** reuses those same values after a lost response. **Refresh original task** and **Resume original task** continue the existing native operation. The operation index is keyed to the original plan, so the pending task remains recoverable when a successful save has advanced the plan revision.

The successful batch is retained as native plan history and a complete report edition. **Open updated field plan** returns directly to the latest native task tab. When the parent plan contains an unsaved draft, retain and reconcile those edits before reopening the updated native plan. The reviewer can reopen it from **Saved follow-through editions**, inspect its complete decisions and tasks, register it with the scientific report selector, or download the **Complete follow-through ZIP**. The package carries the original QC report members, saved field plan and revision, decision history, task and evidence snapshots, report files and retained attachments.

The native Workspace archive carries the editable plan and these report editions through the existing receiving workflow. After receiving on another machine, open the saved plan, its original QC report and the selected follow-through edition. A ZIP export uses the receiving operator's normal output path when a sender-local archive is unavailable.

### Retain browser drafts and independent selections

Each saved QC report has its own follow-through draft, containing staged decisions and the unfinished group editor. **Back to sample review** and **Close and retain draft** preserve it. The parent QC selection stays available independently.

**Export action selection JSON** retains the whole batch in an ordinary file. **Open action selection JSON** validates the file against this exact plan, original QC report and target revision before replacing the current draft. A selection for a different report remains separate. Files with an older target revision can be reviewed and updated in their original context before use.

The browser displays the original plan's unsaved-edit notice when applicable. Native follow-through works from the saved plan; retain and reconcile an unsaved parent draft before saving it over a newer native revision.

### Follow-through API and native commands

Read-only routes:

| Method and path | Parameters or body |
| --- | --- |
| GET /api/implementation-qc/actions | workspace, plan_id, report_id |
| GET /api/implementation-qc/actions-inspect | workspace, plan_id, report_id, action_report_id |
| POST /api/implementation-qc/actions-validate | workspace and selection; validate independent drafts against their exact original saved revision |
| POST /api/implementation-qc/actions-preview | workspace and selection; preview changes against the current saved revision |

The context returns the original review and groups, flattened immutable decision history, complete current tasks and source links, source changes, current native revision, and the plan's saved follow-through report editions. The preview returns a complete preview object with the normalized selection, base and proposed committed revisions, receipt, events and proposed tasks.

Queued native actions:

| Action | Payload |
| --- | --- |
| implementation.qc.actions.save | selection |
| implementation.qc.actions.source | plan_id, action_report_id |
| implementation.qc.actions.export | plan_id, action_report_id |

The selection schema is upstate.implementation-qc-actions-selection/v1. Its fields are plan_id, report_id, expected_revision, actor, as_of and decisions. Each decision contains group_id, decision, use_scope, reason, state, task_ids, evidence_refs and closure_note. Optional create_task carries title, assignee, phase, duration_days, start_not_before and notes. Use actual retained task and source-link IDs from the context response.

~~~sh
python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  context --plan-id ACTUAL_PLAN_ID --report-id ORIGINAL_QC_REPORT_ID

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  validate-selection --selection /absolute/actual-qc-action-selection.json

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  preview --selection /absolute/actual-qc-action-selection.json

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  save --selection /absolute/actual-qc-action-selection.json

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  inspect --plan-id ACTUAL_PLAN_ID --action-report-id RETURNED_ACTION_REPORT_ID

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  source --plan-id ACTUAL_PLAN_ID --action-report-id RETURNED_ACTION_REPORT_ID

python -B -m model.implementation_qc_actions --workspace /absolute/original-workspace \
  export --plan-id ACTUAL_PLAN_ID --action-report-id RETURNED_ACTION_REPORT_ID \
  --output /absolute/separate-output/qc-follow-through.zip
~~~

The additive model module is model/implementation_qc_actions.py. The existing QC provider, extension descriptor, complete family manifest, browser editor and this guide compose the feature. The existing shared Implementation controller still supplies the same Sample quality control entry point.
