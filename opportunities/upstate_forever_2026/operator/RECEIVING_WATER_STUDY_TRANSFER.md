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
- Both `operator/extensions/receiving-waters.json` and `operator/receiving_waters.extension.json` are the same version 9 descriptor with the required shared-host capability.
- `model/study_transfer.py` admits the two existing Receiving dependency kinds as top-level selections. Its catalogue reads their selection from `identity.selection`, preserving the native saved-record layout.
- `operator/web/extensions/study_transfer.mjs` includes the two original root labels in its supported choices.
- `integration/component_fragments/receiving-water-study-navigation.json` appends the Study transfer dependency and this guide to the existing Receiving family. The original global catalogue and all other families remain unchanged.

The existing Study transfer component already retains both shared transfer modules and the Receiving dependency visitor. No new transfer schema, archive reader, request queue, server route, model engine or portable lock is introduced. The standalone Receiving installer verifies the current joined cohort and admits its known version 8 and version 7 descriptor predecessors while preserving earlier supported upgrades and concurrent shared source.

## Resume and reopen

If an export request loses its response, continue through the existing Study transfer pending-operation recovery and saved export list. Reuse that original operation instead of starting another archive. On the receiving side, use the maintained project receiver, then reopen the exact saved plan or analysis in **Receiving waters**. Its source selections, model results and original IDs are retained. A changed scientific case is a new operation based on those original inputs.


## Continue editing an original or received Receiving study

After **Transfer and restore → Open restored workspace**, the existing Study
transfer catalogue lists the retained original roots. **Open in Receiving waters**
on a source plan or completed analysis opens that exact record in the current
Workspace. The same action is available for Receiving records in a contents
preview. It reads the original record before navigation and requires its native
schema, identity and complete state. A changed Workspace, detached view or newer
open request discards an earlier read. Monitoring and the other original desk
actions remain available.

A saved source plan now offers **Revise source plan**. A completed analysis offers
**Revise analysis** and **Revise original source plan**. These commands read the
original immutable record and populate the maintained forms from
`identity.selection`. They do not reconstruct input choices from compiled
receptors, derived geometry, normalized results or accounting output tables.

### Retained source-plan choices

The form retains the original title, projected CRS, complete catchment selector,
layer, ID/downstream fields, every receptor and all original source filters.
Receptor pages contain twenty areas at a time; changing pages retains edits on
every page. Add/remove actions explicitly change that receptor population.

Known fields have ordinary controls. Unknown top-level, source, relationship,
classification and receptor metadata stay in the exact selection. This includes
intake-reference selectors, original evidence, explicit upstream seeds and
source-reader options. Unchanged feature-ID arrays keep original numeric/string
types, and attribute filters keep their JSON value types. An omitted optional
field remains omitted when its displayed default is unchanged.

Changing a source choice retains its existing layer, feature filters and
supporting metadata until they are explicitly edited. Review those settings
when choosing a different source edition. The original engine validates the
complete relationship and source selection on preparation.

### Retained analysis choices

Analysis revision retains the exact source-plan, baseline and alternative run
IDs, original alternative ordering, quantity domain, pollutant subset,
weights, normalization caps/reference and every accounting option. Its existing
accounting editor loads the selected original plan before accepting retained
groups. Group identities, parent/upstream/reservoir membership, references and
rationale are populated; unknown group properties remain retained for explicit review. Removing the last group deliberately removes the accounting setting, as required by the original engine; it does not submit an invalid empty group list.

Unavailable original run or source choices remain visible. A changed baseline
does not silently remove a selected alternative. A changed plan does not silently
remove an accounting group or its unavailable members. Correct those choices
explicitly or restore their original inputs before submission. The original
native analysis still validates cohort compatibility, scientific units,
geographic containment and accounting closure.

Clearing explicit weights or normalization deliberately removes that input
field, restoring the engine's default choice. It does not insert an empty
object. Leaving the controls unchanged preserves absent versus explicit
settings and original values.

### Advanced selections and saved editions

**Advanced retained selection** displays the complete original JSON. To change
unsupported settings, edit it and choose **Apply selection to form**. Applying
repopulates the controls and retains the complete new base. Submission refuses
unapplied JSON changes so they cannot disappear. The visible changed-settings
summary compares the current form with the original saved selection.

Saving uses the existing `receiving.water.plan` or
`receiving.water.analyze` queue action. The original saved plan/analysis is
unchanged. Changed scientific selections obtain their native content identity;
an unchanged selection may reuse a completed result or resume through the
original engine, depending on its state and current implementation identity.
No title is automatically renamed and no replacement Workspace is created.

The complete implementation adds
`operator/web/receiving_water_editing.mjs` to the existing Receiving family and
both identical version 9 descriptors. This module only preserves and edits
selection fields; the original Python preparation, analysis, transfer closure
and archive receiver remain authoritative. The Study transfer Receiving action
uses the shared host's existing `openExtension` capability and existing
Receiving `openPlan`/`openAnalysis` APIs; it introduces no reverse family
dependency.
