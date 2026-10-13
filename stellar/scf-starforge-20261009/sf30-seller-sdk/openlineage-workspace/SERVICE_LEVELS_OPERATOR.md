# Service-level operator desk

Open **Service levels** from the workspace header, or visit /service-levels on the running OpenLineage application. The desk uses the same workspace, access token, event sources and mutation journal as the existing HTTP service. All times in the forms use the browser's displayed time zone; requests store an RFC3339 UTC instant.

## Define the service target

Choose **Policies → New policy**. Select an observed job or enter its exact namespace and name. The selector preserves the original namespaced job identity. A policy can also cover a job whose first event has not arrived.

Give the policy an operational title, owner, effective time and optional HTTP or HTTPS runbook. Set one or more conditions:

- **Completion freshness** is the maximum age of a successful completion.
- **Execution duration** is the maximum duration of a run.
- **Failure observations** watches failed and aborted runs in the selected window.

Durations accept positive whole seconds, minutes, hours or days, up to 315,360,000 seconds. Blank optional durations leave that condition unset. At least one condition must be enabled.

Record the reason for the version, then save. Editing keeps the policy ID and stores the prior version with its previous conditions, owner and reason. **History** displays every version. Disabling a policy is another recorded version. Namespaces and job names remain exact strings; different namespaces are separate jobs.

The editor retains the workspace revision at which it opened. A concurrent workspace change produces a visible revision conflict instead of silently applying the old form to newer state. The recovery panel shows the retained input and offers an explicit application to the reviewed current revision.

## Preview and save an assessment

From **Overview**, choose the observation time and either the current workspace or a saved source edition. **Use current time** explicitly replaces the time selection. **Preview assessment** reads the service-level evaluator and displays:

- each policy's condition, owner, last successful completion, observed and active run counts;
- the exact findings, due and observed times, measured duration and policy threshold;
- source and event references, including downloads of the retained original sources;
- selected, eligible, projected and future event counts, plus invalid-time diagnostics.

The preview uses the original OpenLineage projection. Its source revision and time remain visible. Changing the selection or refreshing to a different revision requires a fresh preview.

**Save assessment** retains the source selection, policy snapshots, observations and findings at the preview's revision. For a current workspace assessment, leave **Update the current incident desk when saving** checked to apply those findings to the incident desk.

A saved edition is a historical assessment. An assessment whose time precedes the latest applied assessment also stays in history. The desk clears and disables incident updates for these selections. To update current incidents afterward, choose the current workspace and a time at or after the latest applied assessment, then explicitly check the incident-update option.

Assessment history records whether each assessment was applied. Open any record to inspect its complete findings, source references and policy snapshots.

## Work the incident desk

**Incidents** starts with records needing action. Search by policy, job, owner, finding or identity; filter by operator status and observed active/clear condition independently.

Open a record to see its first and latest observation, last evaluation, current owner, original and latest finding, originating assessments, and every decision. The source references remain available for download. The last finding assessment is distinct from the latest applied assessment that checked whether the condition had cleared.

Use **Review incident** to record one of these decisions:

| Decision | Result |
| --- | --- |
| Acknowledge | Mark the incident as being handled. |
| Assign owner | Record the responsible person or team; an owner is required. |
| Resolve | Close a condition already recorded as clear by an applied assessment. |
| Accept the condition | Record explicit acceptance and the operator's reason while keeping the observed condition visible. |
| Reopen | Return a record to the open queue and retain its earlier history. |

Every decision requires a reason. Resolution becomes available when the saved incident state is clear. If a later assessment observes a resolved finding again, the service engine can reopen it. Acceptance and observation remain separate properties: an accepted condition can still be active.

The review dialog retains the revision at which it opened. A later source import or concurrent operator write is handled through the same visible request-recovery flow.

## Recover an interrupted save

Before any mutation leaves the browser, the desk writes the exact serialized action body, operation ID, expected revision and workspace identity into the existing openlineage-operator IndexedDB database. Both page aliases use the same service-level journal key. An interrupted or unreadable response remains a retained request. Reopening the page displays that request and starts with reads.

Choose **Recover original request** to resend the identical body and operation ID. The original workspace writer reconciles that operation. The browser does not create another operation ID for an uncertain save.

After a server restart, open **Connection** and reconnect explicitly. The desk reads the current instance identity, verifies the same workspace, and then uses the current instance header for the original saved body. A changed workspace is rejected; the retained request remains available to download.

A confirmed revision conflict exposes the current workspace and retained input. **Apply to reviewed revision** creates an explicit replacement request with a new operation ID and records the previous request body and revision. A definitely unsaved prepared, blocked, rejected or conflicting request can be cancelled even while the connection is unavailable. Cancellation rereads the current journal entry within its write transaction; another tab starting the send prevents stale cancellation. A request whose outcome is uncertain stays recoverable.

Access tokens are held in the browser tab's session storage, separate from the retained request. Downloads of retained requests contain the action input and operation metadata. The desk serializes its request storage through an IndexedDB transaction so a second tab cannot replace another active operation or clear a request after its send has started.

## Download records and reports

A saved assessment offers four downloads:

- **Download assessment** is the exact saved assessment record, including its policy snapshots and source/event references.
- **HTML report** is a readable report suitable for printing.
- **CSV report** includes the record kind, ID, job, state, owner and complete detail.
- **JSON report** contains the complete report structure.

The report endpoint combines the selected saved assessment with the current policy records and current incident history. The desk states that scope beside the report controls. Use the assessment download when the selected assessment alone is required. A complete portable workspace export continues through the workspace's existing export action.

Incident records and original event sources also have individual downloads. Runbook links accept HTTP(S) URLs without embedded credentials. All observed text renders as text nodes, and downloads use the authenticated same-origin HTTP connection.

## Source integration

This desk adds four files to the existing portable application inventory:

- service-levels.html
- service-levels-browser.js
- service-levels.css
- SERVICE_LEVELS_OPERATOR.md

The original browser asset manifest gains /service-levels, /service-levels.html, /service-levels-browser.js and /service-levels.css. The workspace header gains a Service levels navigation link. Keep the existing routes and other header controls when composing concurrent source changes.

The browser uses GET /api/identity, POST /api/action and authenticated original-object downloads. Its action names are:

| Action | Use |
| --- | --- |
| workspace.read | Current jobs, editions, title and workspace revision. |
| service-levels.read | Current policies, saved assessments and incidents. |
| service-levels.policy.save | Versioned policy creation or change. |
| service-levels.evaluate | Read-only assessment preview. |
| service-levels.assessment.save | Retain an assessment and optionally apply its findings. |
| service-levels.incident.review | Record an operator decision. |
| service-levels.report | Download a report for the selected saved assessment. |

Mutations use the existing Bearer credential and X-OpenLineage-Workspace / X-OpenLineage-Instance headers. The current domain and shared workspace writer remain the authority for policy validity, incident transitions and operation replay.
