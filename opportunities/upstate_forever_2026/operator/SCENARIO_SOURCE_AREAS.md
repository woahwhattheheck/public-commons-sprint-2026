# Prepared source areas in native scenario analysis

This source completes the original OP12 V3 form's source-area intake. The target remains its original native scenario.analyze action and selected-model engine. The form now retains supplied planning areas, original IDs, multiple typed attribute filters, map families and native preparation origins.

## User workflow

Open Scenario analysis and choose New analysis. The original form lists the completed native baseline and compatible alternatives. Under Planning areas, use Add prepared source areas to choose the generated scenario-source-areas.json from the native public-water preparation. All imported source editions must already exist in the current workspace.

The form appends the prepared areas to its current choices. Each row shows the actual area ID, title, source edition, vector source, layer, filters, optional buffer, map family and optional rank group. Attribute filters have an explicit value type: text, number, true/false or empty value. Add or remove as many predicates as the actual source selection needs. Duplicate area IDs and duplicate attribute names are explained before submitting a changed selection.

Completing Build analysis submits the original scenario.analyze operation. The native engine reads the original retained vectors and completed model rasters, reprojects source geometry to the selected baseline grid, clips each zone to its reporting area and retains the full selection in the saved analysis.

The original full reporting area remains included. A supplied preparation CRS documents the native source plan; the baseline grid still determines this analysis's coordinate system. The current form also keeps its existing NDR-only, SDR-only, combined and baseline-only behavior.

## Exact generated handoff file

The native public-water preparation runner writes this shape after its actual source import and prepare operation:

~~~json
{
  "schema": "upstate.scenario-source-areas/v1",
  "selection": {
    "title": "Published source-water planning areas",
    "zones": [
      {
        "id": "arjws-swpa-1500",
        "title": "Original prepared area title",
        "source_collection_id": "ACTUAL_IMMUTABLE_IMPORT_ID",
        "source_id": "scdes-arjws-prwd-swpa-20261012",
        "where": {
          "OBJECTID": 11,
          "INTAKE": "S04101",
          "BUFFER_FT": 1500
        },
        "map_family": "critical_drinking_water",
        "metadata": {
          "source_plan_id": "ACTUAL_PREPARED_PLAN_ID",
          "receptor_ids": ["arjws-swpa-1500"],
          "source_relation_method": "source_area",
          "source_geometry_scope": "published_polygon"
        }
      }
    ]
  },
  "origin": {
    "source_plan_id": "ACTUAL_PREPARED_PLAN_ID",
    "workspace": "ORIGINAL_NATIVE_WORKSPACE",
    "analysis_crs": "EPSG:26917",
    "source_collection_id": "ACTUAL_IMMUTABLE_IMPORT_ID"
  }
}
~~~

The uppercase identity strings above describe fields supplied by the actual preparation output. The generated file carries their real values. Its origin also retains the native source records, protection-source hash, original preparation and original selection references.

The four current published polygons are:

| Area ID | OBJECTID number | INTAKE text | BUFFER_FT number |
| --- | ---: | --- | ---: |
| arjws-swpa-1500 | 11 | S04101 | 1500 |
| arjws-swpa-200 | 12 | S04101 | 200 |
| prwd-swpa-1500 | 131 | S37109 | 1500 |
| prwd-swpa-200 | 132 | S37109 | 200 |

The original runner supplies all four actual source selections, titles and utility/intake/protection metadata. The form preserves additional zone metadata, including the original utility, intake, protection-source and classification fields inside metadata. The shipped native producer keeps this provenance nested. Legacy handoffs with direct plan/receptor keys remain readable without rewriting their representation. No buffer or rank group is added by this handoff.

The file input accepts a UTF-8 BOM and the original direct zones envelope as well as selection.zones. It appends each imported origin to selection.source_area_origins and retains each zone's original metadata. It checks the current workspace and original form after asynchronous file reading, so a stale read does not populate another workspace or a replacement form.

## Scope and overlapping areas

With the original filters and zero added buffer, these results describe each published source polygon's intersection with the baseline reporting area. These source polygons remain distinct from upstream contributing catchments and the South Carolina reporting boundary.

The 200-foot and 1,500-foot polygons overlap. Separate area totals are not additive. Use the original receiving-water engine's union output for a combined family total. The form leaves rank_group unset and explains this distinction beside the prepared source-plan identities. A map-family choice identifies its planning layer; it does not change the physical unit or create an upstream load estimate.

If the operator edits a prepared zone's source edition, source, layer, filters or buffer, the saved zone's existing lineage container includes original_source_selection and source_selection_changed:true: nested metadata for the current producer, or direct keys for legacy direct-lineage handoffs. Its original plan and receptor IDs remain origin metadata. Restoring the original source binding clears that change flag. Display titles, map family and explicit rank-group choices retain their own selected values.

## Existing host capability

The target's current shared-host bridge adds createForSourceAreas(request). A source-area producer can use the same generated envelope, with the current operator workspace key:

~~~js
await openExtension("scenario-analysis", "createForSourceAreas", {
  ...preparedSourceAreas,
  workspace_key: getState().workspace_key
});
~~~

The method validates every supplied source selection against the current workspace and opens the original form. If selection.baseline_run_id is present, the original create method also rechecks that exact native baseline, the supplied alternatives, grid, InVEST version and actual shared model outputs. If no baseline was supplied, the ordinary New analysis form offers the current completed runs.

The existing create(request) entry point now also preserves selection.zones. Its original explicit-baseline requirement remains suitable for the decision workbench's selected-native continuation. Both public methods use the original form and action.

## Pure preparation adapter

For consumers holding the actual native preparation outcome and its fully bound receiving-waters-spec.json, the existing scenario_analysis.mjs module exports:

~~~js
const zones = analysisZonesFromReceivingPlan({
  preparation: actualPublicWaterPreparation,
  nativeSelection: actualBoundReceivingWatersSpec,
  receptorIds: selectedOriginalReceptorIds // optional; defaults to preparation.receptor_ids
});
~~~

This adapter checks the original upstate.public-water-preparation/v1 outcome, imported collection ID, unique native receptor identities and source_area relation. It preserves the original receptor source choices and emits the existing V3 zone fields with plan/receptor metadata and any applicable map family. Requested receptor IDs must belong to that preparation outcome. Nonpolygon receiving relations use their existing native engine.

The adapter emits the same nested metadata shape as the native preparation runner and preserves the receptor's original metadata and classification. The module also exports parseAnalysisFilters(entries) and validateAnalysisZones(zones, sourceCatalog?) for the existing form intake. They preserve typed scalar source predicates and reject nonfinite numeric values before serialization. The scientific engine still performs the actual source and geometry validation when executing.

## Source and installation

This is a four-file successor to the complete frozen twelve-file native handoff bank on the same source Page. It includes the complete current:

- operator/web/scenario_analysis.mjs
- operator/web/scenario_analysis_bridge.mjs
- operator/web/scenario_analysis.css
- operator/SCENARIO_SOURCE_AREAS.md

Its exact predecessor metadata points to the frozen V3 handoff edition. The root-owned installer BOM handling and current SCENARIO_HANDOFF.md additions stay with the combined application. The root composes these four complete bodies into the same source bank and receiving application. Existing scenario-analysis asset registration already includes both browser modules and the stylesheet; no new backend route or host registry shape is required.

The direct file workflow uses the current original form, so the generated native preparation file is usable as soon as this source is installed. A producer desk can also invoke the public capability above.

## Focused executed behavior

The actual updated V3 desk was exercised through its public source-area entry point, original form controls and scenario.analyze submission. The four original published selection definitions retained all twelve typed predicate values, area IDs, map family, plan/receptor metadata, and zero added buffer. An edited filter preserved its original source binding; reverting restored the original state.

A second focused pass exercised the actual asynchronous file change handler with a BOM-prefixed handoff, the dynamic source rows and the original form submission. All four areas and the collective origin were retained; source_geometry_scope stayed published_polygon; the chosen native baseline was unchanged; an unavailable sediment output retained weight zero. Native identity values in these interface checks were mechanical fixtures. The production file is generated after the real native import and preparation and supplies those retained identities.


## Reopen completed areas and inspect their source bindings

The completed analysis now includes a Source areas tab. It shows every retained region, including the baseline reporting boundary, independently of the physical-table region filter. Each area displays its saved source edition and vector ID, layer, typed attribute predicates, actual added buffer, map family, optional rank group, geometry area inside the reporting boundary, selected grid-cell count and original source feature count.

The source title, original URI, vintage and SHA-256 remain visible. Prepared plan and receptor IDs retain their original namespace. Utility and source classification are displayed where retained; the complete original metadata and collective preparation/import records remain available in expandable sections. If a prepared source binding was edited, the view shows both the original preparation binding and the selected binding used for the calculation.

View physical results chooses that exact retained region in the original physical-results table and clears a prior run filter so all selected native runs are available. Open source edition uses the original openItem('sources', source_collection_id) capability. It does not reinterpret a receiving_waters.prepare plan ID as a receptor-network or receptor-inventory ID. An absent imported source edition is identified in the button's explanation while all saved analysis quantities and lineage remain readable.

Area totals stay separate. Published source polygons can overlap; the original native receiving-water union remains the source for a combined family total. Map families do not create upstream contributing catchments. The displayed geometry area is the native polygon's clipped area; selected grid-cell count is its separate pixel-centre selection quantity.

## Source exports and original settings

Download source areas JSON emits upstate.scenario-source-areas/v1. selection.zones carries the complete original per-region source selections, including nested metadata, typed filters, edited-binding origins and extra fields. The implicit reporting_area is omitted from those zones: the new analysis supplies its own baseline reporting boundary. Existing selection.source_area_origins are retained. The outer origin adds the original analysis ID, source grid and native run IDs, source-plan IDs and original reporting-area selection.

This export feeds directly into the existing Planning areas file input or createForSourceAreas(request). It carries source definitions, not a geometry union or a recomputed physical result. Reimport appends the explicit analysis origin to the original preparation origins.

Download source inventory CSV emits one row per retained region, including the baseline reporting area. It includes region/analysis/grid/native identities, map family and rank group, source plan/receptors, geometry area and selected-cell count, source edition/vector/layer/buffer, original source URI/vintage/hash, typed predicates, edit status and complete retained selection. Structured fields stay JSON in escaped CSV cells, preserving number, text, boolean and null types. Source exports always cover the full retained source set rather than the current physical-table filter.

The native file downloads remain in Download results. Download saved analysis settings additionally emits upstate.scenario-analysis-selection/v1 with the original source_analysis_id and selection payload, suitable for the existing scenario.analyze action.

Use saved settings opens the original form with the actual selected native baseline and alternatives, base weights, original explicit-caps or percentile mode, every sensitivity weight set with its original ID and title, all source areas and preparation origins. Extra retained selection metadata survives submission. New sensitivity rows receive a unique ID without renumbering retained rows. A repeat still rechecks the selected original native runs in the current workspace before submitting the native action.

## Receiving the actual South Carolina source-area analysis

The four published ARJWS/PRWD areas require an Upper Savannah native baseline whose retained reporting-area geometry overlaps those South Carolina polygons. Every selected alternative must use that same original grid, reporting mask and compatible observed native version. The original model reprojects the source geometry to the baseline grid, intersects each zone with the reporting area and rejects a zone with no areal overlap.

Complete source import and receiving_waters.prepare first, retaining the actual source_collection_id, source_plan_id and generated scenario-source-areas.json. Source preparation can finish in the regional workspace before model outputs are available. Join that file to the actual regional baseline_run_id and grid_id after the corresponding native NDR or SDR outputs complete, then submit the original scenario.analyze action. Keep the saved analysis ID, per-area selected cells and common coverage with that receiving result.

Gura remains a separate native engine acceptance run on its own original geography. The four-area receiving operation uses the actual Upper Savannah input, grid and run pipeline and the unchanged published South Carolina source selections.

## Observed native InVEST versions

The current executor records the actual installed version in run.runtime.version. The original selection.invest_version remains the requested version. Every compatibility gate in the handoff, form and analysis model now uses the observed version when present. Already-complete legacy runs can lack runtime metadata; those retain the saved requested version as an explicitly labeled legacy fallback.

The browser modules export scenarioNativeVersion(run):

~~~json
{
  "requested": "3.20.0",
  "observed": "3.21.0",
  "comparison_version": "3.21.0",
  "basis": "observed_runtime",
  "differs_from_requested": true
}
~~~

The example demonstrates the fields, not a claim about any production run. basis is observed_runtime, requested_legacy or unavailable. The form displays the observed version and a differing request together; legacy choices say that execution version was not retained.

The native handoff includes baseline_native_version and each accepted/rejected case's native_version. Its readiness and compatible-cohort behavior otherwise remain unchanged.

The analysis model stores native_version on every retained runs[] entry and input_binding[] entry. Observed-version provenance therefore participates in the immutable analysis identity alongside the source artifacts and original selections. The top-level native_version records the comparison version, policy observed_runtime_else_labeled_requested_legacy and requested_fallback_run_ids. Existing completed records retain their original data and remain readable. The model continues to use the original quantitative algorithm, common masks, units, baseline caps and selected native outputs.

## Executed retained-result check

One focused end-to-end interface check loaded a complete retained-analysis-shaped record through the actual current item-read path, rendered its Source areas tab, opened its original source edition, downloaded area JSON and inventory CSV, restored original form settings, submitted the native action, edited and reverted a nested prepared filter, and reimported the exported areas.

The four original published selector definitions retained all twelve typed predicate values. The source inventory contained four planning areas plus the reporting boundary. Nested preparation metadata and original origins were preserved. The exact saved settings were restored, including explicit caps, sensitivity ID water_focus.v1 and an extra retained selection field. The saved source record was unchanged by the workflow.

The same actual-module check exercised the observed-version join: differing requests with matching observations were compatible; matching requests with differing observations were rejected; missing observations retained the labeled requested_legacy fallback. Native identity and result-shape values were mechanical interface fixtures. This check exercised the original UI and handoff code through a focused HTML-control adapter; Python execution and the real retained-raster calculation are performed by the native receiving environment.
