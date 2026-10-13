# Transfer an editable Receiving-water study

TokenJunkieLabs · Maintained Receiving waters and Study transfer integration.

## Open the original study

Open **Receiving waters** in the Workspace that contains the saved study. A complete source plan or completed model analysis has **Transfer editable study** beside its entry in the saved list and in its detail header. A completed Receiving-water plan/profile or analysis task offers the same action beside its original result.

The action opens the existing **Study transfer** desk with that exact saved record selected. Review the selected records and dependency preview, then use the ordinary export and receiving controls. Existing selections in Study transfer remain selected, so review that list before exporting.

A source plan can be transferred directly after its geometry has been prepared. The plan does not need a native model run or a rendered scientific report. A completed analysis retains its original source plan and actual native cohort. Source plans and analyses also appear as their own filters in the ordinary Study transfer catalogue.

Scientific report editions remain a separate selectable study. Use the edition's existing transfer action when the saved report, its ordered sources and the exact rendered files are part of the intended handoff. The direct plan/analysis action preserves the editable scientific study from which those outputs can be prepared.

## What the existing transfer engine retains

| Selected record | Existing original dependencies |
| --- | --- |
| Receiving-water source plan | Exact plan record and geometry tree, original explicit source collections and their complete retained members, nested source references such as intake metadata, and a plan grid only when the saved selection contains one |
| Completed Receiving-water analysis | Exact analysis record and result tree, its original plan record and geometry, original grid, actual baseline and alternative native run IDs, and the native runs' existing profile, scenario and source dependencies |

The maintained `study_delivery_transfer._receiving_water` visitor validates schema, complete state, project identity, the immutable selection digest and record digest. An analysis must still reference the exact saved plan hash. The existing study export takes the native locks, captures the selected dependency closure, writes its original receipt and uses the maintained portable archive format. Receiving preserves the saved IDs and editable source selections.

The controls do not prepare another plan, change geographic relationships or execute native models. They navigate to the same dependency preview and export operation already used by other saved scientific studies.

## Browser contract

The Receiving controller exposes:

```javascript
await receiving.openStudyTransfer({
  kind: 'plan', // or 'analysis'
  id: originalSavedRecordId,
  workspace_key: originalWorkspaceKey
});
```

The optional `workspace_key` on this controller method must match the current Workspace when supplied. All rendered buttons supply it. Before navigation the controller reads the original record using the existing `/api/receiving-waters/plan?plan_id=...` or `/api/receiving-waters/analysis?analysis_id=...` route. It requires the requested ID, the original Receiving schema and complete state.

It then delegates this exact shape to the shared host:

```javascript
context.openExtension('study-transfer', 'openForStudies', {
  workspace_key: originalWorkspaceKey,
  roots: [{
    kind: 'receiving-water-plans', // or 'receiving-water-analyses'
    id: originalRecord.id,
    title: originalRecord.title,
    state: originalRecord.state
  }]
});
```

The original Study transfer controller checks the Workspace and supported root type again, preserves any existing selected studies, opens its own view and previews the actual dependency closure before export.

A newer click supersedes an earlier pending record read. Detaching or repainting the Receiving view, or changing Workspace while that read is pending, discards the old navigation. A completed task from another Workspace receives no direct transfer button. Unsupported or incomplete records cannot enter this handoff. The existing host closes a task detail only after the selected original record has been accepted.

Registered Receiving descriptors require `openExtension`, which the maintained shared extension host already supplies. A legacy direct controller can instead be given an explicit `openStudyTransfer(selection)` callback with the same typed-selection contract. The shared host path takes precedence when both capabilities are available. Without either capability the direct transfer controls stay absent; the original Receiving features remain usable.

## Maintained source joins

- `operator/web/receiving_waters.mjs` adds scoped saved-list, detail and completed-task actions, a passive original-record read and guarded navigation.
- `operator/web/receiving_waters_extension.mjs` exposes the same method through the registered desk.
- Both `operator/extensions/receiving-waters.json` and `operator/receiving_waters.extension.json` are the same version 8 descriptor with the required shared-host capability.
- `model/study_transfer.py` admits the two existing Receiving dependency kinds as top-level selections. Its catalogue reads their selection from `identity.selection`, preserving the native saved-record layout.
- `operator/web/extensions/study_transfer.mjs` includes the two original root labels in its supported choices.
- `integration/component_fragments/receiving-water-study-navigation.json` appends the Study transfer dependency and this guide to the existing Receiving family. The original global catalogue and all other families remain unchanged.

The existing Study transfer component already retains both shared transfer modules and the Receiving dependency visitor. No new transfer schema, archive reader, request queue, server route, model engine or portable lock is introduced. The standalone Receiving installer verifies the current joined cohort and admits its known version 7 descriptor predecessor while preserving earlier supported upgrades and concurrent shared source.

## Resume and reopen

If an export request loses its response, continue through the existing Study transfer pending-operation recovery and saved export list. Reuse that original operation instead of starting another archive. On the receiving side, use the maintained project receiver, then reopen the exact saved plan or analysis in **Receiving waters**. Its source selections, model results and original IDs are retained. A changed scientific case is a new operation based on those original inputs.
