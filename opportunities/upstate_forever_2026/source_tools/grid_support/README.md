# Upper Savannah geographic and land-cover source workspace

Complete original-source compilation, offline exploration and additive Science Workspace import. These are the same seven source files used for the delivered October 13 model-grid and native land-cover products, published together as one reusable course.

Follow [the current owner direction](../../CURRENT_OWNER_DIRECTION.md), version `2026-10-13.3`, and the October 13, 2026 14:00 UTC cutoff. The complete brief is retained in the delivered native package. Existing regional baseline/riparian/control producers retain their projects and active computations. These tools supply their source geometry, masks and descriptive land-cover context.

## Delivered working products

All original files, editable results, executed source and working offline views are in `/Ecosystem Sciences/Handoffs`:

| Product | Library file | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `Upper_Savannah_Model_Grid_Support_20261013.zip` | `file_000000000d8481f89989c3cdfc171327` | 25,412,589 | `ac2af056361975216fed256bbfaa843eaadfb053c98f44a2354447a58f19dc71` |
| `Upper_Savannah_Native_Landcover_Support_20261013.zip` | `file_00000000e1a481f68dc225680b85fe91` | 44,011,516 | `2756f9c8733bffd587d6b53bf78bd6b61c6347c0df8d04fcc6ccc5f5a827b156` |
| `Upper_Savannah_Corrected_NLCD2025_Original_Source_20261013.zip` | `file_0000000084b88243a48cef24799c8a17` | 9,758,841 | `fbfe9dbd8b3e0ecee2c2e4de7f1b74e15791894cb0b9f446d5acc95448574736` |

Standalone native viewer: `file_00000000cdf481f4b94e9b5dcbaed16f`. The complete delivery is recorded in the original Ecosystem thread at message `1791892075.724539` in `C0BTTA66TK3`, parent `1791724121.853269`.

Open `OPEN_SUPPORT.html` from either package. It includes its own data and offline downloads. The native view supports watershed selection, independent geographic scopes, forest/agriculture/development/wetland shading, exact original class tables, model-intersection selection and filtered CSV export. The GeoPackage and full-resolution GeoTIFFs remain editable outside the viewer. Only the displayed SVG geometry is generalized.

## Two explicit grids

The model-grid course compiles the retained HW13 EPSG:26917 definition: 5,858 columns by 6,582 rows, affine `[30, 0, 254610, 0, -30, 3893940]`. Its original full-domain count is 20,947,261 cells and SC-reporting intersection is 9,193,349. The raw SC polygon includes 76 additional cells outside the domain. Both raw and intersected masks are retained.

The native-source course measures the unchanged corrected 2025 NLCD raster on its original EPSG:5070 affine, 6,443 columns by 6,319 rows. It processed all 40,713,317 source cells. Its full-domain count is 20,949,527 and SC-reporting intersection is 9,195,766; the raw SC polygon has 95 additional cells. Exact affine determinants define area. These grids have different edges and must not be treated as interchangeable masks.

Each course retains 217 original HUC12 units, 71 original intake records, the 4-HUC and 32-HUC utility memberships, four independent focus anchors and four independent protection polygons. The nine supports overlap. A bitfield and exact membership tables allow union computations without counting nested supports twice. Original intake-point geometry and protection polygons remain independent.

## Run from existing original sources

The completed runtime used Python 3.13.5, NumPy 2.3.5, GeoPandas 1.1.2, Pyogrio 0.12.1, Rasterio 1.5.0 and Shapely 2.1.2 on Linux. Both compiler paths operate by raster windows, without reading a full stack or resampling the source classes. Use an existing GIS environment and a new output directory.

`APP` is the complete Upper Savannah application root. `GEO` is the original geography package root containing `source-selections.json` and its retained `workspace` objects. `NLCD` is the corrected source directory containing the seven original companion files, not an older application-relative raster. `HW13` is the original grid-definition JSON.

```sh
TOOLS="$APP/source_tools/grid_support"

python "$TOOLS/compile_model_grid.py" \
  --geography "$GEO" \
  --reporting-shp "$APP/source/geography/planning_basins2023/PlanningBasins2023.shp" \
  --grid "$HW13" --output "$MODEL_SUPPORT"
python "$TOOLS/prepare_handoff.py" "$MODEL_SUPPORT"

python "$TOOLS/compile_grid_support.py" \
  --application "$APP" --geography "$GEO" \
  --source-directory "$NLCD" --output "$NATIVE_SUPPORT"
python "$TOOLS/prepare_native_handoff.py" "$NATIVE_SUPPORT"
```

The corrected raster is 9,443,751 bytes, SHA-256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`. Its source identity is `usgs-annual-nlcd-2025-native-region-3fa517b4cc3251b9`. The published source ZIP includes all six matching original companions. The completed recovery used the retained original tile and reproduced this canonical TIFF byte for byte; the historical earlier source was preserved.

## Add to a working scientific project

```sh
python "$TOOLS/import_support.py" --application "$APP" \
  --workspace "$WORKSPACE" --manifest "$MODEL_SUPPORT/source-manifest.json"
python "$TOOLS/import_support.py" --application "$APP" \
  --workspace "$WORKSPACE" --manifest "$NATIVE_SUPPORT/source-manifest.json"
python "$TOOLS/import_support.py" --application "$APP" \
  --workspace "$WORKSPACE" --manifest "$NLCD/source-manifest.json"
```

The normal application importer retains the complete source family. Select the returned collection and entry explicitly. Existing project identity, source history, plans and results remain unchanged. The delivered execution performed these imports and reopened the primary source through a fresh Workspace object.

## Completed execution and use

Reuse the delivered actual runs: model-grid compilation took 10.705 seconds with 269.477 MB peak resident memory; the complete native class compilation took 10.627 seconds with 275.707 MB peak memory. The native class totals matched the complete original inventory, with zero unexpected or missing land-cover cells. Both original/working geometry editions and the two recorded working polygon repairs are retained. The maintained native Esri reader has its own original-geometry interpretation; this independent working-copy log does not replace that reader.

The final desktop and 390 px views were operated and visually inspected. Watershed/scoping controls, the exact displayed CSV export, and downloaded TIFF/GeoPackage files were opened. The phone class-table clipping was fixed in the delivered renderer. The ZIP includes the working screens, source code and original data. Computation and recipient use are already recorded; repository publication reuses those completed outputs.

## Scientific interpretation

Land-cover composition is descriptive source measurement. Native nitrogen and phosphorus delivery in kg/year and sediment delivery in tonnes/year belong to the existing scientific scenario run. Source areas do not establish treatment effectiveness, intake concentration or stream delivery. Keep original class codes and all actual geographic scopes when joining the completed native model outputs.

The full source workspace gives the receiving analyst original inputs, editable geometry, complete counts and an immediately usable exploration/export surface.
