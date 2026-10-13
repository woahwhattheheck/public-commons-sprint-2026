## Field dispatch and supervisor follow-through

The dispatch board connects locally planned work to the actual captured County records and the saved inspection forms. Create a crew only when you have the intended local staffing information. A crew or assignment in this workbench is proposed configuration; it is not an assertion that the County assigned or approved that work.

### Prepare work

1. Import the complete original capture and save an inspection form against its real dataset. The assignment selector uses the actual saved form edition and captured ObjectIDs.
2. Add the crew name, named members and their roles, contact details and any operating notes. Deactivate a crew when it should receive no new work; existing assignments and history remain readable.
3. Create a work package with a title, scope notes, planned effort in whole minutes and an optional due timestamp.
4. Create the assignment under that package: select the crew, original form and actual captured object; enter instructions, priority, planned minutes and an optional due timestamp. The saved assignment retains the form key/revision/hash, service URL/item identity, capture/layer/ObjectID and the actual GlobalID when the service supplied one.

Planned package effort and the total planned effort assigned to its work are shown separately. Recorded effort is entered explicitly and never inferred from the time an inspection remained open.

### Carry out and review the work

Move an assignment from PLANNED to READY, then IN_FIELD, with a reason for each change. Open the inspection through the existing form workflow, using its original assignment ID. Link that actual inspection on the dispatch board. The link records its native version/hash; later inspection changes are visible without replacing the original link record.

The domain owns answers, geometry, attachments, validation, submission and supervisor decisions. Dispatch does not independently approve an inspection. An assignment can move to SUBMITTED only when a linked inspection has an actual current submission. CLOSED requires a current approved inspection and no unresolved supervisor follow-through. Closure records that exact inspection version/hash and approval ID. If a later correction changes or invalidates that approval, the board identifies the closure as no longer current.

BLOCKED requires an explanatory reason. CANCELLED preserves all work and history. To resume cancelled work, move it back to PLANNED; to reopen completed work, move CLOSED to IN_FIELD. These are deliberate commands with the current record version.

Record actual crew effort in whole minutes, with the time the work occurred and a meaningful note. If an entry is incorrect, void that specific entry with a reason and record the corrected entry separately. Both remain in the history; totals exclude the voided entry. Once effort has been recorded, its assignment retains the original work package. Use a separate assignment for a different package rather than moving recorded effort silently.

A supervisor follow-up records an assignment, action title, named owner, due timestamp, status and notes. Resolve or explicitly cancel the action with its recorded outcome. Open follow-ups remain separate from the inspection's technical validation and decision.

### Refresh after a new source capture

A source refresh is an explicit continuation of the same field work:

1. Retain the new complete capture through the original capture/import flow. Review the form and, when necessary, save its next edition under the same form key.
2. Use the domain's inspection rebase action for the actual linked inspection. Resolve its original field conflicts there; this is the only component that changes inspection answers or source binding.
3. On the dispatch assignment, choose Refresh from linked inspection and select that original inspection's current version. Supply the current assignment version and a reason.
4. The refresh verifies the same service URL/item, dataset and ObjectID, the original non-null GlobalID, and the same form key. It adopts the exact current inspection source/form edition, retains prior link snapshots and every earlier assignment version, clears the former closure and returns the assignment to IN_FIELD.
5. Complete the original inspection submission and supervisor review again, then submit and close the assignment against the new actual approval.

If the ObjectID now identifies another GlobalID, or the service or form lineage differs, the refresh is rejected. Create deliberate separate work against the new source identity.

### Freeze and hand over the operating report

Freeze a report with a stable report ID, useful title and notes when the operator is ready to preserve the current work. Its timestamp and actor come from the saved command. Later editing does not alter the report.

The report contains all crews and members, packages, assignments, planned and recorded minutes, overdue and unresolved work, follow-ups, effort corrections, original source/form references, actual linked inspection/approval summaries and complete retained record histories. Package progress counts closures whose original approved inspection is still current. A cancelled assignment is not counted as a completed inspection.

Download the frozen JSON or its readable HTML. The HTML includes tables plus the complete escaped JSON record, so the visible summary never limits the handover. Keep the original source/inspection workspace transfer with the report; the HTML is a frozen operating record, not a replacement for the editable original workspace.

### Source integration

The maintained pure Python component is highway/dispatch.py. It owns only workspace.dispatch and exposes new_dispatch(), apply_dispatch(workspace,command,read_blob), dispatch_view(workspace,read_blob) and dispatch_report_html(workspace,report_id). The original SQLite store owns command UUID recovery, full-envelope equality, workspace revision checks and atomic saves.

Existing record changes require expectedVersion. Refresh also requires expectedInspectionVersion. The original first result is recovered using the same complete request before a later workspace revision is considered. Read-only views do not issue County requests or create inspection decisions.

Commands: dispatch.crew.save, dispatch.package.save, dispatch.assignment.save, dispatch.assignment.link_inspection, dispatch.assignment.status, dispatch.assignment.refresh, dispatch.effort.record, dispatch.effort.void, dispatch.followup.save and dispatch.report.freeze.
