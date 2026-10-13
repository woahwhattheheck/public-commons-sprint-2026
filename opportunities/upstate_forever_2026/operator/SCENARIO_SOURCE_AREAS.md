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
        "source_plan_id": "ACTUAL_PREPARED_PLAN_ID",
        "receptor_ids": ["arjws-swpa-1500"],
        "source_relation_method": "source_area",
        "source_geometry_scope": "published_polygon"
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

The original runner supplies all four actual source selections, titles and utility/intake/protection metadata. The form preserves additional zone metadata, including source classification. No buffer or rank group is added by this handoff.

The file input accepts a UTF-8 BOM and the original direct zones envelope as well as selection.zones. It appends each imported origin to selection.source_area_origins and retains each zone's original metadata. It checks the current workspace and original form after asynchronous file reading, so a stale read does not populate another workspace or a replacement form.

## Scope and overlapping areas

With the original filters and zero added buffer, these results describe each published source polygon's intersection with the baseline reporting area. These source polygons remain distinct from upstream contributing catchments and the South Carolina reporting boundary.

The 200-foot and 1,500-foot polygons overlap. Separate area totals are not additive. Use the original receiving-water engine's union output for a combined family total. The form leaves rank_group unset and explains this distinction beside the prepared source-plan identities. A map-family choice identifies its planning layer; it does not change the physical unit or create an upstream load estimate.

If the operator edits a prepared zone's source edition, source, layer, filters or buffer, the saved zone includes original_source_selection and source_selection_changed:true. Its original plan and receptor IDs remain origin metadata. Restoring the original source binding clears that change flag. Display titles, map family and explicit rank-group choices retain their own selected values.

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

The module also exports parseAnalysisFilters(entries) and validateAnalysisZones(zones, sourceCatalog?) for the existing form intake. They preserve typed scalar source predicates and reject nonfinite numeric values before serialization. The scientific engine still performs the actual source and geometry validation when executing.

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
