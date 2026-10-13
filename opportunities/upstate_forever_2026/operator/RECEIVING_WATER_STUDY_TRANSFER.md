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
when choosing a different source edition. Explicitly clearing the optional catchment-network selector removes that complete binding, including its advanced fields; it is rejected while an upstream-HUC relationship still needs it. The original engine validates the
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
repopulates the controls and retains the complete new base. Apply permits one in-flight source read; a closed or replaced form cannot be reopened by its late response. Submission refuses
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


## Choose original features before preparing or revising a study

The source-plan form's **Choose original features and relationship** opens an inline reader of the original retained source. Choose its source collection and original vector layer, then read actual native IDs, typed attributes and geographic features. The published-water catalogue uses the same reader through **Choose original published features**. Existing direct JSON, source sample inspection and advanced retained selections remain available.

The chooser calls the maintained Spatial catalogue, description and overlay APIs. Its Esri polygon reader is the same original reader used by Receiving preparation. Each response binds the original body SHA256 and selected layer. The map displays one paginated record page in the original coordinate reference system; its clipped display geometry never becomes scientific input. Saved plans continue to resolve the complete original source geometry through their native IDs. Exact attribute values appear alongside their original text so large integer identifiers are not rounded into new IDs.

Choose either specific native IDs or all matching original IDs. Specific selections remain retained when navigating pages; Apply verifies every selected ID against the current original source/filter. **All matching original IDs** reads every page using the server's actual continuation and saves the complete matching native-ID list. It never treats the visible page as the whole source. The explicit IDs also preserve the exact native feature cohort when strict Spatial scalar matching differs from general Python equality. An absent ID or changed source/filter stops Apply without silently removing retained choices.

Exact filters use actual original field names and JSON scalars: quoted strings, finite representable numbers, booleans or null. Pending filter edits must be read before Apply. Unsupported advanced filters remain in the original retained-selection editor. Selecting another source does not silently discard original filter or feature choices; the form explicitly retains other source metadata, intake references and evidence for review. The chooser can explicitly clear an attribute filter, remove selected IDs or select a different original layer. Values not supported by the original engine still require correction through its ordinary preparation diagnostics.

For an upstream relationship, **Choose original network and routing fields** reads the real catchment layer and supplies its actual catchment-ID and downstream fields. It preserves the complete retained network scope; it does not clip the graph to the visible viewport or discard routing context nodes. Existing advanced network filters and native-ID restrictions remain unchanged in this chooser and can be revised explicitly in the complete retained-selection editor.

### Contribution meaning

A published source-area relationship uses original polygon geometry and zero context buffer. A point or line requires an explicitly justified geometric context or an evidenced relationship to the original HUC / ToHUC graph. The chooser asks for that method and rationale; it does not infer drainage from proximity. Original intake references, explicit HUC seeds, scientific classification, evidence and advanced relation metadata remain part of the form's retained selection. Several chosen features form one receiving-area selection; use separate areas for waters that need separate scientific identities.

Applying a selection only edits the existing form. Saving uses the original plan/catalogue queue and immutable identities. The chooser guards the original form, workspace, source response and read generation; closing or replacing the form prevents late responses from applying a different selection. Existing saved-plan and completed-analysis revision, model calculations, C8FF accounting, Study transfer, Monitoring and report controls remain available.

### Actual rendered-product acceptance

Following Bryce's rendered-product instruction, publication and source-level checks alone do not establish that the operator is ready for a client demonstration. Open the exact outgoing installed application with a populated original Workspace, look at its actual rendered screens and operate the source/layer, filter, feature-page, map, Apply, save and reopen controls. Inspect desktop/screenshare and narrow/mobile widths, empty/loading/error states, original downloads and restored selections. Capturing screenshots without viewing them, DOM counts, HTTP200 or code review is insufficient. Repair clipped tables, unreadable identifiers, overflow, missing styles or broken controls in the same authorized workflow. Use the existing native/browser course; no replacement model calculation or new receiver is needed.

The browser course can identify the inline root with data-water-source-picker, loading/error with data-water-source-loading/data-water-source-error, geographic display with data-water-source-map, rows with data-water-source-rows/data-water-source-row, and continuation/commit with data-water-source-next/data-water-source-apply. These attributes refer to the actual operator controls and do not create a separate verification interface.


## Compare original source plans before revising an analysis

Receiving waters → Compare source plans opens two exact complete saved plans in the existing Receiving detail panel. The same control appears beside a saved plan. Choose a reference and a candidate; their original IDs, record digests, sources and scientific history remain unchanged. Choosing the same record deliberately produces a no-change view, so a single received plan can be inspected without manufacturing another edition.

The comparison aligns receiving waters only by their explicit saved receptor ID. Changing a name leaves that ID's history visible; changing the ID is an addition and removal. Search and change filters paginate the result. Inspect changes opens the original requested source selection, relationship, designation and context alongside prepared source identities and selected native-feature records. Open original plan and Review original geography return to the maintained Receiving and Spatial views.

The comparison separates these meanings:

- Original source body and provenance: exact retained source identities and body hashes.
- Requested selection: layer, typed filters, native feature tokens, relationship rationale/evidence, source metadata and original intake references.
- Selected native records: IDs and original attributes match only within the same original source body and requested layer. Different source editions list their native-ID populations separately; apparent equal IDs are not assumed to identify the same geographic object.
- Prepared relationship: saved method, precision, interpretation and original geometry-reader/feature-operation provenance.
- Prepared area: each water's original contribution hectares. A scalar difference is shown only when the recorded CRS, method, implementation and area-method metadata agree. Overlapping waters are never summed.
- Geometry files: changed container hashes are identified as file changes. Attributes and serialization can alter a GeoPackage hash; this view does not calculate intersected, gained, lost or otherwise changed land.

A Review row means exact numeric precision is unresolved in the browser, not that an original value changed. Browser-unsafe integer attributes remain unresolved and the comparison download marks them explicitly. Use the original saved plan JSON and source downloads for exact native numeric tokens. No source value, file or geometry is rewritten by comparison.

Download comparison JSON saves schema upstate.receiving-water-plan-comparison/v1 with both original plan IDs/record digests, all requested/source/preparation changes, complete per-water native-ID membership and field changes, the comparison scope and interpretation limits. Filename: receiving-plan-comparison-REFERENCE12-CANDIDATE12.json. It is a review export; complete editable studies continue to use the original Study transfer workflow. Comparison search affects the screen only; the JSON contains the complete pair, not the visible page. The existing workspace-scoped Receiving session selection retains the two IDs for desk reopening, and fresh passive reads revalidate both saved records.

### Continue an original analysis on the candidate plan

The comparison lists complete analyses whose original plan is the reference. Select one and choose Review analysis on candidate plan. The action re-reads that exact saved analysis and candidate, checks the current workspace/view/pair/request, and opens the existing analysis revision form. Only plan_id changes at that handoff. Native baseline and alternatives, original pollutant subset, quantity domain, weights, normalization/caps, accounting, title and advanced metadata remain as saved.

The form identifies retained accounting parent/upstream/reservoir IDs absent from the candidate. Correct them explicitly in the existing accounting controls, or deliberately remove an obsolete group. Missing members are never rebound by name or silently dropped. Original group validation still blocks unresolved membership on save. IDs present in both plans do not establish unchanged geographic relationships or raster support; the original analysis engine validates and computes the submitted selection.

Review the selected candidate and the complete advanced draft, then save through the original receiving.water.analyze queue. The prior analysis and both source plans stay immutable. The comparison itself starts no native run, raster calculation or background task.

### Operate the actual outgoing comparison

Under owner AGENTS2026-10-13.1, use the existing --editable-selection browser course on its original received Workspace. Open the actual original/current returned plan pair (or the same original record for a no-change view), LOOK at real rendered desktop/screenshare and narrow/mobile frames, operate pair selection, search/status/page/details, original geography and JSON download, then reopen that pair. Exercise populated, no-match, loading and read-error states. If an original completed analysis exists, open its candidate-plan revision, inspect the complete preserved cohort/accounting and cancel that unsaved draft; do not create another model case for the course. Native saving remains the existing deliberate operator action.

Stable selectors refer to real controls: [data-water-plan-comparison][data-reference][data-candidate], form names plan_compare_reference / plan_compare_candidate, [data-water-compare-search], [data-water-compare-status], [data-water-compare-analysis], and water-compare-new / water-compare-detail / water-compare-page / water-compare-download / water-compare-analysis actions. The enclosing original #water-selected exposes aria-busy while passive plan reads are outstanding. Source review and DOM/HTTP checks do not replace viewing and operating the exact outgoing interface.
