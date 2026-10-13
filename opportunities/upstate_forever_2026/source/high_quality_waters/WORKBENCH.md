# Classified-water source preparation in the operator

**Review status: native GIS execution and scientific interpretation require expert review.**

The existing **Prepare study inputs** desk now has an **SC DES classified waters** method. One saved source operation adopts the original SC DES edition, crosses its native features with the selected reporting boundary and HUC12 polygons, builds the complete linework inventory, and imports the combined legal and geographic sources. Its completed result opens **Water source review** with the imported crosswalk and full native-feature browser selected.

## Prepare the retained edition

1. Open the study and choose **Prepare study inputs → SC DES classified waters**.
2. Choose the retained input mode:
   - **Original metadata and complete features:** select the original SC DES layer metadata and complete 1,886-feature Esri JSON response. The bundled selection preserves the original three-prefix query and selected classes. A separate complete attribute response is optional.
   - **Existing adopted capture and companions:** select its original `capture.json` from an imported edition or registered source folder. The operation reads the original adopted selection from that capture. It preserves the original query and all listed companion bytes.
3. Keep the bundled native-field mapping and complete current R.61-69 source packet, or select the corresponding retained edition from the study.
4. Select the actual original geography: `PlanningBasins2023.shp`, the four-focus HUC12 response, and the complete upstream `network-selection.json`. The file chooser lists imported source bodies and companions and browses registered source folders. Available bundled planning/focus files appear as defaults.
5. Keep the bundled 217-HUC source inventory. It preserves the independent full-domain completeness comparison alongside the original acquisition query. Optional legal bindings retain their explicit candidate, partial or coextensive relation.
6. Leave **Import completed source edition** selected and choose **Prepare selected source**.
7. Open the saved result, then **Open water source review**. The review opens the actual imported `classified-water-crosswalk` entry and all retained native features. The same action is available from a restored completed source operation after project transfer.

Complete source packets and network selections need their original neighboring files. Select them from an imported source edition or a registered folder; uploading a lone manifest cannot supply its missing original companion pages. Single complete metadata/feature responses can be uploaded directly. No host path or source collection ID needs to be typed into the workflow.

## Existing native producers

The method uses the maintained producers without duplicating their scientific logic:

| Stage | Existing producer and preserved contract |
|---|---|
| Source retention | `SourcePreparation._snapshot` retains selected originals in the Workspace object store, including declared source-packet/capture companions and native upstream polygon pages. |
| Original adoption | `high_quality_waters.py adopt` verifies the original native OID, metadata identity, complete attributes, selected counts and source query. Existing adopted inputs keep their exact retained selection. |
| Geographic crosswalk | `build_crosswalk` receives the verified planning/focus paths and original upstream selection directly. It retains source geometries, original IDs, typed attributes, positive intersections, touch-only records and separate legal associations. |
| Complete source inventory | `high_quality_water_inventory_cli.mjs --capture` reads the adopted original Esri collection. It removes the former separate CSV staging step and preserves the complete feature index and diagnostics. |
| Intake | The existing source composer combines crosswalk, inventory, legal packet and optional full-domain inventory. `SourcePreparation._finish` banks every declared original and imports the completed edition with `Workspace.import_sources`. |
| Review | The existing extension host calls `water-source-review.openSource` using the actual workspace and imported collection. No second review application is created. |

The native operator needs its existing Python GIS environment (Fiona, PyProj and Shapely) and Node.js. The current crosswalk API accepts explicit `planning_path` and `focus_path`; the review controller supplies `openSource`. These companion changes must be installed with the method.

## Scope and original identity

The active source is [SC DES SCHydroClass, layer 2](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2), source ID `scdes-classified-streams-upper-savannah-20261012`. Its real native OID field is `OBJECTID`; the separate nullable integer `OBJECTID_1` is preserved as an ordinary attribute. The captured selected classes comprise 1,040 ORW, 247 TN and 599 TPGT features.

The three-prefix acquisition query stays unchanged. The separately retained original full-217-HUC inventory establishes that the selected-class feature set is complete for that domain. Other native source acquisitions, including FW linework, retain their own editions and declared scope.

The source mapping preserves provisional GIS status independently of the legal edition. The current R.61-69 registry preserves complete reach descriptions, partial reaches and the original regulation text. Automatic literal associations remain review candidates. Classified source linework includes banks, shorelines and other native feature types; its measured length is not a river-centerline total.

## Maintained input and result contracts

`source.prepare` uses `method: "classified-waters"`. The existing catalog supplies all input controls and their allowed source selectors. `options.input_mode` is `"original-responses"` or `"adopted-capture"`. Required shared inputs are `mapping`, `registry`, `planning`, `focus` and `network`; `coverage` and `bindings` are optional. In original mode the inputs are `metadata`, `features`, `selection` and optional `attributes`. In capture mode the input is `capture`.

Selectors remain the existing imported body/companion, uploaded file, bundled source or registered-folder chooser. Source references resolve only within the selected original packet. Referenced byte counts and hashes are checked before retention, and every snapshot is materialized with the same relative companion paths.

The task keeps its original request identity, immutable input snapshots, stage history and completed source bank. A resumed task reuses those originals. The producer's content-addressed crosswalk output is used from its returned `source_manifest`, and the complete composed manifest stays above all input/output files. Existing queue cancellation, failed-task resumption and restored-result handling remain with the source-preparation owner.

A completed result keeps the standard `upstate.source-preparation-result/v1` fields and adds the crosswalk counts, native source ID, review target, and retained native process logs. The open-review action passes:

```json
{
  "workspace_key": "<actual selected study>",
  "collection_id": "<actual imported source collection>",
  "source_id": "classified-water-crosswalk",
  "load_native": true
}
```

The source collection is the imported result returned by the existing Workspace API. The scientific source and legal review are available through the same saved study and transfer workflow.
