# Gauge catchments from the saved model DEM

This workflow runs the installed **InVEST 3.20.0 DelineateIt** producer on an existing saved grid. It keeps the original observation CSV, source row identities, published outlet coordinates and original basin geometry beside a separate native D8 catchment edition. The resulting source can be reopened, downloaded and selected directly in the existing Calibration desk.

The producing owner must inspect the actual outgoing map, reading HTML and source downloads at desktop and narrow widths, then reopen the complete source in a separate Workspace. Use the actual original source and current native runtime for this check. Source review alone does not establish that a native watershed was produced.

## Operate the existing Calibration desk

1. Open the intended scientific Workspace and choose **Calibration and validation → Prepare gauge catchments**.
2. Choose the exact **saved model grid**, original observation edition and original basin source. Inspect the original layer and its real identifier field; that field must match the observation catchment IDs. The preview checks that every selected original ID has one original polygon.
3. Choose the **coordinate carrier** explicitly: original CSV columns or retained `source_records` metadata. Choose its actual longitude and latitude fields, and confirm that the original values are WGS84 decimal degrees. The original strings or numbers remain retained. A field from another carrier is never substituted automatically. For data in a different datum or coordinate system, retain an explicitly documented source conversion before using this adapter.
4. Choose the original catchment IDs to delineate. Optional stream snapping has two editable settings: stream initiation area in hectares and a search window in grid cells. Keep source period, interpretation and terrain-extent notes in the form.
5. Choose **Inspect original outlets and terrain**. Read each original coordinate, exact raster row/column, finite-cell status and fraction of the original basin within the DEM rectangle. Out-of-grid and NoData outlets prevent the native run. The original polygon's rectangle coverage is an extent diagnostic; it is not a claim that every cell or upstream terrain is complete. Changing a field requires a fresh preview.
6. Choose **Run native delineation**. This uses the existing serial operator task and original request identity. Open its completed source and reading report. Review original and D8 areas, original-basin overlap, actual outlet movement, stream membership and cells adjoining DEM edge/NoData.
7. Choose **Use these catchments in calibration**. The maintained Calibration form receives the original observation edition, exact selected original record IDs and new source selector. Existing scientific objective, period and baseline-candidate controls remain available. If no completed baseline exists yet, those source choices remain saved as a draft.
8. Choose **Download complete original source**. The task provides the complete ZIP and, where the exact original grid is present, a Workspace-specific annual-reference input contract. Extract the ZIP and open `index.html`; its relative links open the retained analysis, native GeoJSON and outlet CSV. Import its original `sources.json` through the normal source intake to reopen the same source collection in another Workspace.

The local form preserves unfinished raw controls in browser session storage. Its preview is scoped to the current Workspace, current form and exact current values. A restored draft is inspected again before it can start a native task.

## What the native producer does

The authoritative implementation is [InVEST 3.20.0 DelineateIt](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/delineateit/delineateit.py). The retained native arguments use the saved prepared DEM, original outlet vector, `detect_pour_points=False`, `skip_invalid_geometry=False` and the explicit snapping choice.

DelineateIt fills pits, derives D8 flow directions and delineates the full upstream D8 basin for each retained outlet. When snapping is selected it also retains flow accumulation, the stream raster and the resulting outlet vector. The source package preserves the original prepared DEM, separately filled DEM, flow directions, accumulation and stream rasters when present, original and selected outlet vectors, native watershed vector, original basin geometry and all native sidecars.

This is a **D8 catchment source**. NDR and SDR transport routing retain their own native implementation. A common terrain identity does not make D8 and MFD transport equivalent. Existing raster conditioning is preserved as input; DelineateIt's own pit filling is a separate retained output.

### Units and snapping behavior

| Setting or result | Exact meaning |
| --- | --- |
| Prepared DEM | Existing saved raster; one elevation band, square north-up pixels, projected metre coordinates |
| Stream initiation area | Hectares, converted to `ceil(hectares × 10,000 / cell_area_m²)` native flow-accumulation cells |
| Stream search window | Positive whole number of grid cells passed to native `snap_distance` |
| Reported outlet movement | Geodesic distance in metres between original WGS84 location and actual model outlet |
| Basin area | Native projected polygon area divided by 10,000, in hectares |
| Original overlap fraction | Intersection area divided by the original basin area |
| DEM edge/NoData count | D8 basin cells whose 3×3 neighborhood adjoins the native raster boundary, mask or nonfinite elevation |

The native snapping parameter describes a pixel search window. It is not a circular geodesic maximum-distance promise. If no stream is found, the native implementation may leave the outlet at its original grid-cell center. The result therefore reports both actual movement and whether the selected outlet lies on a stream cell. Inspect these values before using that basin as a gauge reference.

A basin touching DEM edges or internal NoData may omit contributing terrain. Neither a valid outlet cell nor a geometrically valid basin proves whole-catchment physical coverage. Review the original basin comparison and retained native terrain. Extend the actual source/model domain through the existing source owner when needed.

All titles, vintages, source URIs and original raw DEM identities remain those of the selected grid. Applying this workflow to a teaching DEM keeps that simulated input identity; it does not turn it into measured regional terrain.

## Source and operation identity

The operation binds the producer source hash, full normalized selection, prepared DEM and original DEM source identities, original observation CSV, original basin body and actual installed native versions. The installed DelineateIt source file hash is also retained. A changed source or setting creates a new operation.

The original outlet GPKG is written to a staged file, closed, checked against every exact original point and then atomically installed. Existing outlets are checked before a completed native registry can be reused. Native completed files retain their original size and SHA. Interrupted task graph work resumes through the original native implementation.

The generated `upstate.sources/v1` collection contains one vector source with role `CATCHMENTS`. Its companions include the complete native outputs and the original input bodies. Source-relative hierarchy is preserved, including nested shapefile DBF/PRJ sidecars.

The `upstate.annual-reference-delineation/v1` record contains a **source-local** selector: source ID and identifier field. It cannot contain the content-addressed ID of its own future collection. After import, the returned binding contains the actual collection ID. The course checks both identities together.

The ZIP uses the exact imported collection's original manifest bytes and every retained member at its original `source_path`. It does not create a replacement normalized manifest. Source-only recipients can open the reading report, inspect all native geometry and export the full source without having the former execution directory or grid.

## Native command interface

Run from the existing application root using its installed native Python:

```bash
"$ECO_PYTHON" -m model.calibration_catchments --workspace "$ACTUAL_WORKSPACE" catalog
"$ECO_PYTHON" -m model.calibration_catchments --workspace "$ACTUAL_WORKSPACE" preview "$SELECTION_JSON"
"$ECO_PYTHON" -m model.calibration_catchments --workspace "$ACTUAL_WORKSPACE" build "$SELECTION_JSON"
"$ECO_PYTHON" -m model.calibration_catchments --workspace "$ACTUAL_WORKSPACE" inspect "$RETURNED_SOURCE_SELECTOR"
"$ECO_PYTHON" -m model.calibration_catchments --workspace "$ACTUAL_WORKSPACE" export "$RETURNED_SOURCE_SELECTOR"
```

The selection uses schema `upstate.calibration-catchment-selection/v1`, actual `grid_id`, `observation_id`, `original_catchments` selector, explicit `coordinate_carrier` (`original` or `source_records`), `coordinate_crs: "EPSG:4326"`, original coordinate field names, original `catchment_ids`, `snap_points` and notes. Snapping additionally requires `stream_area_ha` and `snap_distance_cells`.

The original basin selector contains actual `source_collection_id`, `source_id`, `id_field` and optional retained layer/where selection. The returned generated selector contains the actual imported collection ID, generated source ID and `id_field: "catchment_id"`.

## Original SPARROW annual-reference course

The existing [candidate course](../source/usgs-southeast-sparrow-2012/CANDIDATE_COURSE.md) keeps its seven original target records and three original NLDI basin bodies unchanged. A full three-basin derived edition can be supplied with:

```bash
"$ECO_PYTHON" -m source_tools.sparrow_candidate_course \
  --workspace "$ACTUAL_WORKSPACE" \
  --candidate-run-id "$ACTUAL_BASELINE_RUN_ONE" \
  --candidate-run-id "$ACTUAL_BASELINE_RUN_TWO" \
  --catchments "$RETURNED_SOURCE_SELECTOR" \
  --input-contract "$EXPORTED_INPUT_CONTRACT" \
  --output "$NEW_OR_MATCHING_COURSE_OUTPUT"
```

Use the actual completed baseline run IDs on the matching grid. The exported contract pins every actual model input role, original source body, prepared model-domain/reporting mask and retained derivation record. It is emitted only when that exact grid is present in the current Workspace.

The course resolves original producer records from their retained companion object hashes and sizes, so an independently received source does not need the former producer's directory layout. It still verifies the original DEM, original basin body, selected derived body, original coordinate values and outlet-within-basin membership. The original source-specific target units and measurement periods remain unchanged.

A partial basin selection can be used in the ordinary Calibration form with its exact original observation subset. The fixed historical seven-record course requires all three original basins; it does not silently rewrite that preset. Completed simulated regional runs remain separate candidate cases unless their actual source, domain and original reference support meet the saved scientific selection.

## Portable installation and reopening

The maintained `operator/install_calibration.py` includes this producer, client module, guide, source-course adapter and component fragment. Use that installer from the new source checkout against the actual receiving application. It preserves unknown concurrent changes instead of overwriting them, and includes the current profile-history, selected-profile continuation and direct Parameter Study controls.

The additive fragment supplies the same runtime to Calibration, Parameter study, selected Study receiving and scientific report consumers. The unchanged native source collection is included by the existing calibration/Study source closure when used in a saved calibration. The separate source ZIP supports intake before a calibration is created.

After producing the actual source, the owner should operate the full sequence: preview → native build → reading map and relative links → original file downloads → complete source export → separate import → exact observation-subset handoff → saved calibration source selection. Record the actual returned source/operation/task IDs and any native exception in the existing receiving case.
