# Transfer an editable Monitoring study

Saved Monitoring work uses the original **Study transfer** desk and Workspace archive. Choose a network, design, budget comparison, campaign, or observational context. The archive preserves the original project and record identities, full source collections and companions, saved design decisions, and editable campaign history.

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
| Budget comparison | Every retained plan and original completed-budget mapping |
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
