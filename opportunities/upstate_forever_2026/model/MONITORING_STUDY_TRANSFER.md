# Transfer an editable Monitoring study

Saved Monitoring work uses the original **Study transfer** desk and Workspace archive. Choose a network, design, budget frontier, saved budget comparison, campaign, or observational context. The archive preserves the original project and record identities, full source collections and companions, saved design decisions, and editable campaign history.

## Operator workflow

1. Open the original workspace and Monitoring design desk.
2. Open the saved campaign, design, or network. An active campaign must refer to the currently open design; a different open design is transferred as that design.
3. In the existing export section, choose **Transfer editable study**. The open matching saved observational context is included when its checkbox is selected.
4. In Study transfer, review selected roots and the dependency preview. The catalogue also lists saved Monitoring budget comparisons and observational contexts.
5. Create the selected archive using the original queued `study.export` action. Use the existing download or block transfer workflow.
6. Restore through the original Workspace receiving form. Open Monitoring in the received project, then open the retained campaign and continue its field history.

The handoff includes the original workspace key. A workspace switch before it reaches the selected-study controller is rejected. Existing callers that pass a roots array retain their current behavior.

## What travels

| Selected original record | Retained dependencies |
| --- | --- |
| Network | Exact source editions, original body objects and every source companion |
| Design | Its network, explicit costs and calendar, and its original saved budget-comparison progress when present |
| Budget frontier | Every retained plan and original completed-budget mapping |
| Saved budget comparison | Its exact baseline choice, ordered original plans, frontier and network, and every specifically selected per-plan observed context |
| Campaign | Current head, all parent revisions, field events, every historical plan/network, source station bindings, and original operation replay fingerprints |
| Observational context | Its original observation edition, network and design, exact historical campaign revision, and the editable campaign when one is bound |
| Related completed Monitoring report | Whole original producer directory and descriptors, exact historical records, ordinary retained report source collection, and its editable campaign |

With **Include related results** enabled, an explicitly selected network includes saved work on that network. An explicitly selected design includes campaigns whose current saved design is that design. Chosen campaigns include their saved observational contexts and completed Monitoring report sources. Historical networks discovered during dependency expansion do not select unrelated campaigns.

Disabling related results retains the dependencies necessary to reopen the selected original records. It does not discard campaign parent revisions, field history, source companions, or the chosen context's historical revision.

A retained partial budget checkpoint records the completed budgets. To continue its pending budgets, repeat the exact original frontier request with its original configuration and budget list; the checkpoint does not invent an unsubmitted or unretained pending roster. A completed saved comparison retains every original plan and reported budget row.

All records keep their original content-addressed IDs. A saved source object is retained once even when several designs or campaign revisions use it. There is no new Monitoring solver, fieldwork queue, or archive format.

## Capture and continuation

The selected-study writer holds the original Workspace and native batch guards. It discovers Monitoring's existing campaign, report-source and budget-operation locks, reacquires the dependency closure under those locks, stages exact native members, and calls the existing portable archive writer.

The transfer receipt records each captured campaign head, its complete ordered revision chain, and original replay-operation mapping. Receiving verifies those captured identities. Later revisions and field events may append normally; they cannot replace captured history or change an original replay fingerprint. Completed budget mappings may gain additional budgets while existing original plans remain fixed. Historical observed context continues to refer to its original saved revision.

The same archive receipt remains verifiable after an independent receiving edit. Full-workspace backup continues to use its existing behavior.

## Original receiving command

The existing `operator/monitoring_receiving.py` supports both archive scopes. Add `"archive_scope": "selected"` to its original selection to exercise the selected-study workflow. Omitting the field preserves the complete-workspace receiving flow.

For an actual saved campaign and context:

```json
{
  "campaign_id": "ACTUAL_ORIGINAL_CAMPAIGN_ID",
  "observed_context": {"context_id": "ACTUAL_SAVED_CONTEXT_ID"},
  "archive_scope": "selected",
  "title": "Monitoring campaign receiving"
}
```

Use actual IDs from the current workspace. The same receiver also accepts an existing plan, an existing network with explicit design configuration, or its original source-manifest choice.

```sh
PYTHON -B operator/monitoring_receiving.py \
  --workspace ACTUAL_WORKSPACE \
  --selection ACTUAL_SELECTION_JSON \
  --output OUTSIDE_WORKSPACE_RECEIVING
```

The existing output lock and `receiving.json` preserve one operation. The receiver exports the original field package, creates `selected-monitoring-study.zip`, restores it through `model.portable.restore`, checks retained original records and observed context, appends one independent receiving revision, and verifies the selected-study receipt again. Original campaign history remains unchanged.

Receipt fields `selected_study_verification` and `continued_study_verification` describe the same native receipt before and after that continuation. The source-side `workspace_archive` descriptor retains the actual archive path, byte count and SHA256. Existing independent receiving requests and completed outputs are reused when the identical invocation resumes.

## Source composition

The implementation is additive `model/monitoring_study_transfer.py` with narrow joins in the existing selected-study model and browser. The Monitoring adapter mounts `monitoring-study-transfer.mjs` alongside its current report and fieldwork controls. The original observed-context controller exposes only the selected saved record's IDs/title for that handoff.

The current component catalogue includes the complete selected-study and Monitoring source dependencies. Preserve current report-lineage, Decision, native-run adoption, delivery and investigation snapshot joins when composing this shared source.

## Cold receiving and completed network reports

Original report inspection may create missing source-view hardlinks after a cold restore. The typed transfer permits only that exact declared-source inode transition: source hashes, device, inode, size and mtime must remain unchanged, and a changed ctime requires an increased link count plus the original full body hash. Every other captured file remains under the original strict signature check. This same verification runs during selection and after archive receiving. Selecting a network also discovers completed reports attached directly to its saved designs; historical networks reached through another campaign remain dependency-only.

An explicitly selected saved scientific report edition can follow this producer through `include_source`: its declared source ID, role, recipe kind, project and producer URN must agree with the original report record. Same-project reports retain their editable history. A foreign report keeps its contained source objects and original project provenance without borrowing local records.

## Original fieldwork returns

When a campaign event was returned from Implementation fieldwork, selected transfer retains the exact immutable `monitoring_field_returns/<request_id>/request.json` and `field-plan.json` that the original return producer recorded. Its maintained `source_binding` validator checks the reviewed request digest, original field-plan revision/document digest and complete event payload. The reviewed campaign revision enters the same typed history closure. Receiving repeats this validation from the transferred originals, so a field event remains tied to the actual saved fieldwork source.


## Saved budget choices and their original scientific report

In **Saved budget choices**, save or reopen a comparison, then choose **Transfer editable comparison**. The action reopens the exact saved native record before handing its original ID to Study transfer. Unsaved title, baseline or observed-context changes must first be saved as their own comparison. Navigation, workspace changes or changed selection during that read cancel the handoff.

The typed root is `monitoring_frontier_comparisons`. Its original `selection.frontier_id`, `baseline_plan_id` and ordered `context_ids` remain unchanged. Transfer reuses `monitoring_frontier_comparison.inspect` to verify the original frontier/network/plan/context digests and follows those exact immutable records through the existing Monitoring dependency graph. It does not rerun the solver or calculate a new budget table. Feasible and infeasible retained rows keep their original status.

With related results enabled, choosing a network or frontier discovers its saved comparison records and their completed original reports. Selecting a particular comparison retains its exact scientific inputs; a network reached only as a dependency does not pull unrelated later choices.

A saved **Monitoring budget comparison** scientific report uses the original `monitoring-budget-comparison` recipe. Its selected-report transfer now follows the report's `comparison_id`, validates `comparison-records.json`, and carries the complete `native-monitoring-comparison.zip`, extracted source/report members, map figures and retained source collection. The original plan/campaign report path continues to validate `history-records.json`. Same-project report lineage reopens its native comparison; a foreign report keeps its declared original project and contained source bodies.

For the existing Study transfer CLI or queued `study.export`, use this selection with the actual saved ID:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Saved regional monitoring budget choices",
  "roots": [
    {"kind": "monitoring_frontier_comparisons", "id": "ACTUAL_SAVED_COMPARISON_ID"}
  ],
  "include_related_results": true
}
```

Restore through the original Workspace receiver. Reopen the same saved comparison from **Saved budget choices**, review its original baseline and per-plan contexts, then create another comparison edition if new choices are needed. Existing campaign histories can continue independently. The original comparison exporter can produce its complete source/report ZIP from the received records; exports written outside a Workspace are regenerated through that existing command. Completed report-source directories retained inside the Workspace travel as their original bytes.

This joins the already accepted regional Monitoring receiving course. Use its actual saved comparison ID and current full application, preserve an already-started request, and return the original archive/restore result or first native exception to the same operation.

## Open a restored selection in Monitoring

In **Study transfer**, use **Open in Monitoring** beside an available Monitoring network, design, campaign or observational context. The original extension host opens the Monitoring desk in the selected Workspace before passing the typed record identity to it. A design opens its retained network and configuration; a campaign opens its actual current retained revision and design. A context opens its retained network and the immutable context itself.

A context can have no design or campaign. This is the ordinary opening for a source-backed observational network. Its station matches, original observation filters and complete context export remain available immediately. When an older context records a campaign revision, its saved calendar remains part of that context; opening it does not replace those dates with the campaign's later revision. Choose a design or campaign explicitly before making a new preview.

The receiving Workspace is the selection boundary. Switching workspaces while an opening request is in progress prevents its result from changing the newly selected desk. Selecting another network clears the previous design, campaign, frontier results and download links. The original Study transfer selection and archive controls remain independent of opening a record.
