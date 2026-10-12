# Assigned Timescale remediation

This desk turns a saved Remediate or Defer decision into continuing assigned work in the original Timescale project. Staff can record responsibility and acceptance, link retained plans, inspect actual operation outcomes, assess a later captured edition, resolve or reopen an item, and carry its complete history into the original project handover.

The application borrows the existing workspace, operation journal, exclusive writer, HTTP listener, native plan controls, publisher and project export. It creates no second database, scheduler, credential store or execution authority. A work-item action never runs a refresh, changes a job, verifies an aggregate or publishes a dataset. Staff use those existing controls when the assigned task requires them, then record their actual outcomes here.

## Start with the existing project

Use the original Timescale command from a complete source/distribution installation:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/cli.mjs serve \
      --directory /absolute/path/to/original-timescale-workspace

Open the returned listener URL. The Assigned remediation section appears in the same application, before its original project export. The original host, origin, source declaration, maintenance declaration and connection rules still apply. The named operator records attribution; it does not create a separate login identity or grant database permissions.

An existing project needs no migration. Completed work revisions are ordinary entries of kind remediation in its existing journal. A new or old project with no such entries opens with an empty work list. Close the original listener/workspace once using its existing owner; the desk owns no independent closer.

## 1. Turn the actual review into assigned work

Complete the original capture, comparison and review workflow first. Only completed saved reviews with Remediate or Defer decisions are offered under Create work from an original review. The source chooser preserves the exact review UUID, comparison digest, change key, before/after editions, catalog identity, original field changes, reviewer and decision note.

Choose Load reviewed assignments, select the relevant change, and Open assignment. An already assigned review/change opens its existing work item. Fill in:

| Field | Use |
| --- | --- |
| Work title | A specific outcome the responsible engineer can recognize. |
| Responsible owner | The person or team accepting this task. |
| State | Open, In progress or Deferred. A resolved record is created through the separate resolution action. |
| Priority | Normal, High or Urgent. |
| Due date | An actual YYYY-MM-DD date, or empty when unscheduled. |
| Intended work | The concrete change or investigation being assigned. |
| Acceptance condition | The observable condition the receiving engineer will assess. |
| Operator and reason | Who is making this revision and why. |

Save once. The request UUID is retained before dispatch. The original operation must return COMPLETE before the application treats the item revision as saved. A create request uses its original request UUID as the work-item identity; later commands retain that item ID and increment its revision.

The source decision and the new work state remain distinct. For example, a Defer decision can become an In progress task once someone starts addressing it. Changing the assignment does not rewrite the original review.

Search by title, catalog identity, owner or work text, or filter by state and owner. Lists and original source choices are paged; Previous and Next controls continue the exact collection rather than assuming the first page is complete.

## 2. Link an original plan and inspect what really happened

Open an item and its Original plans panel. The choices are retained refresh, job-change and projection plans from the original reviewed database. Each keeps its UUID and digest, original edition and available window, job or relation fields. Describe why the selected plan addresses this work, then link it.

Open original plan moves to the existing application controls. Its review, permission, original request identity, dispatch and interruption behavior remain authoritative. A linked plan is not a claim that its action ran.

The Actual operations panel offers original refresh, job-change, verification and extraction operations for a plan linked to this item's current source. Inspect the original operation, enter the meaning of its returned outcome, and record it. The desk verifies the exact operation digest and retained native-record bytes before saving the observation.

Observations retain the state seen at that time, including FAILED, INTERRUPTED and OUTCOME_UNKNOWN. They also retain the underlying extraction state: a completed wrapper whose extraction failed is not a ready dataset. Later observations may record the same original operation after its state changes; the earlier observation stays in history. No retry is dispatched by recording an observation.

A projection link can lead into the existing extraction, dataset review and publisher workflow. This desk records that relationship and its actual outcome; the publisher continues to own publication, buyer-facing data and its own release history.

## 3. Continue work when the reviewed source changes

Edit owner, priority, schedule, status, work or acceptance with a reason. Each save is a new immutable work-item revision and retains the previous item digest.

If a later completed review supersedes the assigned source, use the source-rebase panel. It accepts another Remediate or Defer decision only when the original database target, catalog kind and identity agree. Review its exact new field changes before adopting it.

Earlier plans and observations remain visible as Earlier assignment. They do not silently become evidence for the new source. Link an applicable retained plan to the current assignment again and record the actual relevant outcomes. Another existing item for the same new review/change is opened instead of creating a duplicate assignment.

A resolved item must be explicitly reopened before changing its fields, source or links. Reopen selects Open, In progress or Deferred and records the reason. It clears the current resolution while preserving the prior resolved revision and its complete source-bound history.

## 4. Record the receiving engineer's resolution

Select a later retained edition from the same database and review the exact comparison from the assignment's reviewed-after edition to that later edition. The later edition must have a different UUID and a completion time at or after the assigned source edition. The comparison digest and later edition digest are retained with the resolution.

Choose one supported mode:

| Mode | What is recorded |
| --- | --- |
| Current-state review | The assigned operator's explicit assessment of the later catalog state. It does not claim aggregate completeness. |
| Complete aggregate verification | The actual matching result of the original native aggregate verifier, with its exact retained window, definition, snapshot and counts. |

A current-state assessment can record Remediated, Accepted current state or Superseded. Explain the decision against the item's acceptance condition. An unchanged catalog row is still shown as unchanged; it does not become an implicit success. The operator must make the assessment.

Complete aggregate verification additionally requires:

- A linked original plan with its exact digest for the current assignment.
- An original COMPLETE verification operation whose matches field is true.
- The exact retained verification record and definition digest.
- The same aggregate definition in the selected later edition.
- A verification completion time at or after that edition.

The saved resolution preserves the original verifier's counts, window and interpretation. It never samples a substitute, sums rounded values, broadens a verified window, or treats a materialized-only result as coverage of data outside the original measurement. Use the existing native verifier when this form of acceptance is required.

Once resolved, inspect the current resolution and history. Reopen is available when the condition changes or the receiver requests further work.

## 5. Recover a pending request without losing its identity

Before a browser command is sent, its complete original JSON is saved under the current workspace identity in session storage. The Original request recovery controls let the operator read its outcome, continue that exact request, or download its JSON for the original command line.

A successful HTTP acknowledgment binds the original workspace, request UUID and action. The following operation read verifies the exact semantic input against the retained journal, excluding only the original engine's expectedVersion retry allowance.

The browser clears an unsent command only for the original API's explicit, identity-bound pre-dispatch rejection codes. Transport errors, unreadable JSON, proxy HTML, ambiguous storage failures and unrelated rejection envelopes retain the command. Use Read original outcome before deciding what happened. Continue original request sends the same saved JSON and UUID.

A completed journal entry returns its original result on replay. A changed payload cannot reuse that UUID. A failed/interrupted desk action may continue through the existing original read-style operation semantics; the desk never retries a native database mutation for it. Preserve original native OUTCOME_UNKNOWN handling in the original operation controls.

Drafts remain available after a rejected save. If the current saved item revision changes while an older browser draft exists, Review saved revision against draft displays both versions before allowing that draft to use the current revision. The application does not silently overwrite the newer saved record.

If browser storage is unavailable, the application does not dispatch an unretained command. Save or download the complete request and use the original CLI, or restore browser storage and reopen the same workspace. Session storage is a local convenience; the completed original operation journal is the durable project record.

## 6. Export, receive and reopen the same work

Use the existing original project export and receiving commands in README.md. All desk revisions are already in that project journal, and source editions, plans, native records and publisher history remain in their original paths. The export carries them without a separate work database or a second archive format.

The item controls also export:

- JSON: the selected item revision, exact source, plans, observations, current resolution and complete revision metadata.
- HTML: a script-free printable report with the assignment, original changes, linked plans, observed outcomes, resolution and history.

The portable report is a readable selected-item view. Use the complete original project package for operational recovery or another receiving engineer. After receive, open that original project, find the same work-item UUID, and verify its revision, original request history and source references. Native credential declarations follow the existing receiving/setup process; no secret values are added to this report.

## Complete command-line surface

The existing Timescale CLI adds these commands:

    work-list --directory DIR [--status OPEN] [--owner NAME] [--query TEXT] [--offset 0 --limit 25]
    work-sources --directory DIR [--offset 0 --limit 25]
    work-item --directory DIR --id ITEM_UUID
    work-context --directory DIR --id ITEM_UUID [--edition EDITION_UUID] [--offset 0 --limit 25]
    work-command --directory DIR --input REQUEST.json
    work-report --directory DIR --id ITEM_UUID --format json
    work-report --directory DIR --id ITEM_UUID --format html

The common CLI supports --input - for JSON on stdin. Keep each mutation's original request JSON in a private local file. work-command waits for the existing operation completion and exits nonzero when it does not complete. operation --directory DIR --id REQUEST_UUID reads the retained original result after interruption.

These examples show the full shape. Replace the visibly named placeholders with values returned by the original commands; they are not executable IDs or fabricated runtime results.

Create from one row of work-sources:

    {
      "requestId": "NEW_CALLER_GENERATED_UUID",
      "expectedVersion": 12,
      "action": "create",
      "actor": "Assigned operator",
      "note": "Assigned from the completed original review.",
      "source": {
        "reviewId": "RETURNED_REVIEW_UUID",
        "comparisonDigest": "RETURNED_COMPARISON_SHA256",
        "changeKey": "RETURNED_EXACT_CHANGE_KEY",
        "digest": "RETURNED_SOURCE_SHA256"
      },
      "fields": {
        "title": "Review the recorded job schedule",
        "owner": "Receiving engineer",
        "dueDate": "",
        "priority": "NORMAL",
        "intent": "Assess the exact reviewed schedule change against the agreed operating window.",
        "acceptance": "Record the receiving engineer's assessment of a later retained edition.",
        "status": "OPEN"
      }
    }

Link one exact plan returned by work-context:

    {
      "requestId": "NEW_CALLER_GENERATED_UUID",
      "expectedVersion": 14,
      "action": "bind-plan",
      "actor": "Assigned operator",
      "note": "Link the original reviewed plan for this task.",
      "workItemId": "RETURNED_WORK_ITEM_UUID",
      "expectedRevision": 1,
      "planId": "RETURNED_PLAN_UUID",
      "planDigest": "RETURNED_PLAN_SHA256",
      "relevance": "This plan addresses the assigned job in the reviewed database."
    }

Record an actual operation returned by work-context:

    {
      "requestId": "NEW_CALLER_GENERATED_UUID",
      "expectedVersion": 16,
      "action": "observe",
      "actor": "Assigned operator",
      "note": "Retain the original operation's actual returned state.",
      "workItemId": "RETURNED_WORK_ITEM_UUID",
      "expectedRevision": 2,
      "operationId": "RETURNED_OPERATION_UUID",
      "operationDigest": "RETURNED_OPERATION_SHA256",
      "relevance": "The original outcome is relevant to the linked plan and current assignment."
    }

Resolve using the exact later comparison from work-context --edition:

    {
      "requestId": "NEW_CALLER_GENERATED_UUID",
      "expectedVersion": 20,
      "action": "resolve",
      "actor": "Receiving engineer",
      "note": "Record the assessment after inspecting the later retained edition.",
      "workItemId": "RETURNED_WORK_ITEM_UUID",
      "expectedRevision": 3,
      "resolution": {
        "editionId": "RETURNED_LATER_EDITION_UUID",
        "editionDigest": "RETURNED_EDITION_SHA256",
        "comparisonDigest": "RETURNED_LATER_COMPARISON_SHA256",
        "mode": "CURRENT_STATE_REVIEW",
        "outcome": "ACCEPTED_CURRENT_STATE",
        "statement": "Write the actual receiving assessment against this item's acceptance condition."
      }
    }

For COMPLETE_AGGREGATE_VERIFICATION, add verificationOperationId and verificationOperationDigest from the original completed matching verification. The command validates all additional source and time bindings described above.

Every non-create command also requires workItemId and expectedRevision. The other payloads are:

| Action | Additional fields |
| --- | --- |
| edit | fields, containing all seven mutable work fields shown in create. |
| rebase | source, containing the complete exact source reference shown in create. |
| reopen | status: OPEN, IN_PROGRESS or DEFERRED. |
| bind-plan | planId, planDigest and relevance. |
| observe | operationId, operationDigest and relevance. |
| resolve | The complete resolution object above. |

Actor and note are required on every command. dueDate is empty or a valid calendar date. Work fields and reasons have explicit text bounds; an item retains at most 1,024 plan references and 1,024 observed references. These bounds do not truncate the source journal or an existing item history.

## Programmatic integration

openTimescaleWorkspace returns the original workspace with a remediation facade:

    const workspace = await openTimescaleWorkspace(existingOptions);
    try {
      const desk = workspace.remediation;
      const choices = await desk.sources({offset: 0, limit: 25});
      const started = desk.command(retainedCompleteRequest);
      const originalOperation = await started.completion;
      const detail = await desk.item(originalOperation.data.result.workItemId);
      const report = await desk.report(detail.item.id);
      // Persist report.json or report.html through the receiving application's normal path.
    } finally {
      await workspace.close();
    }

Check originalOperation.state === COMPLETE before reading a success receipt. The shown request comes from the caller's retained JSON, using the exact source row and current item revision where required.

The facade snapshots the entire accepted input synchronously before dispatch. Mutating the caller's object afterward cannot change the stored request or the work callback. There is no second close method and no independently opened native connection.

| Method | Result |
| --- | --- |
| list({offset, limit, status, owner, q}) | Synchronous current work summaries, original version, state counts and paged items. |
| sources({offset, limit}) | Completed original review assignments with full source identity and an existing workItemId when assigned. |
| item(id) | Current exact item, digest, original version and complete revision metadata. |
| context(id, {editionId, offset, limit}) | Retained plans, linked-plan operations, editions and an optional exact later comparison. |
| command(input) | The original {id, completion, reused} operation handle. |
| report(id) | Work-item identity/revision plus readable HTML and full JSON detail. |

A source or original workspace version changing during an asynchronous read produces a conflict rather than a mixed-source view. Reopen the actual current result before authoring a new request.

## Borrowed HTTP interface

The existing listener serves the additive module and stylesheet under /timescale/. It keeps its original Host, same-origin and cross-site request policy. No extra HTTP server is started.

| Method and path | Use |
| --- | --- |
| GET /api/timescale/remediation/list | Paged work list and filters. |
| GET /api/timescale/remediation/sources | Paged exact completed review assignments. |
| GET /api/timescale/remediation/item?id=UUID | Selected item and complete revision metadata. |
| GET /api/timescale/remediation/context?id=UUID&editionId=UUID | Actual linked context and optional later comparison. |
| GET /api/timescale/remediation/operation?id=UUID | Read the original journal operation. |
| GET /api/timescale/remediation/report?id=UUID&format=json | Download the selected exact item detail. |
| GET /api/timescale/remediation/report?id=UUID&format=html | Download the standalone printable report. |
| POST /api/timescale/remediation/command | Submit the complete original request JSON. |

Lists accept offset and limit, with a maximum page size of 100. The command acknowledgment uses stellar-forge.timescale-remediation-ack.v1 and binds workspaceId, requestId, action, id and reused. It is an acknowledgment of the original operation, not a completion claim.

The error envelope uses stellar-forge.timescale-remediation-error.v1 and binds the same workspace plus the available request/action identity. Consumers must distinguish this confirmed original envelope from unreadable or intermediary errors. The operation read uses stellar-forge.timescale-remediation-operation.v1.

## Receiving in the original complete native workflow

The original native owner extends the already equipped PostgreSQL/Timescale operation; no second cluster, download, seller or browser is required.

1. Use its actual before/after editions and saved review. Mark a real changed catalog item Remediate or Defer through the original review API.
2. Create a work item, edit its owner/acceptance and read the saved revision. Retain its exact create request and replay it to confirm the same original completed result.
3. Link an existing applicable plan. Record a returned native operation, keeping its actual state. Open the original plan and operation from the desk.
4. Capture a later read-only edition in the same original project. Review that comparison and resolve with an explicit current-state assessment. If a complete matching aggregate verification is already part of the operation, exercise that supported resolution against its actual window and later-edition ordering.
5. Reopen the resolved work with a reason and retain its earlier resolved revision. If the receiving workflow has a later saved review of the same item, rebase explicitly and inspect the earlier-source links.
6. Export the original complete project, receive through its maintained archive client, reopen the received workspace, and read the same item/history and both portable reports.
7. Complete the original owner shutdown and return the actual native/operator result with its source identity.

This guide describes the supported source workflow. Report native completion only from that original equipped operation's actual return. No customer contact, scope change or additional commercial commitment is made by these controls.
