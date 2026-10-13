# Native soil coverage by original HUC12

Operation: `ECOSYSTEM-SCIENCES-SPRINT-20261012-KFACTOR-NATIVE`.

Run this reporting step immediately after either maintained native preparation completes: `source_tools.soil_sources` or A74F's `source_tools.soil_region prepare`. Both produce the existing K_FACTOR source entry. It reads the prepared physical K raster, the original numeric NLCD reference used for that preparation, and the retained full HUC12 domain. The outputs give the operator spatially explicit soil coverage, missing-land locations, open-water status, and a portable source edition for workspace import and archive.

## Inputs and source binding

Use the same actual reference and domain files named by the soil preparation. The reference hash comes from the preparation plan. For the original whole-soil preparation, the domain hash, buffer and vintage come from that same plan. For the regional preparation, the source-bound context comes from its retained `capture/capture.json` and `capture/plan.json`; these files are checked against the final K entry and preparation digest. The capture's file inventory also binds its selected original domain manifest and feature bindings. The manifest must select the same vector source ID and domain hash as the capture plan. The supplied feature-bindings file must match that original companion's exact bytes and source ID, so the reporting-intersection and upstream-ancestor memberships remain attached to the original domain. Both original plan schemas are preserved. The K raster must match the completed source entry, declared projected metric grid, preparation hash, and target physical units.

The original domain is retained as `/dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz`, with adjacent `feature-bindings.json`. The selected source contains 217 HUC12s: 116 reporting intersections and 101 upstream ancestors. The code reads those memberships from the original bindings and checks all selected HUC12 and native object IDs. It uses the actual buffer declared by soil preparation; the current operator selection is 1000 m.

The original domain ZIP is `libfile_cce17e762e948191be1d226b1dbce00d`, SHA256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.

If the original reporting polygon is available, pass its retained path, layer and exact attribute selection. This adds exact reporting totals and per-HUC reporting columns. The 116 intersection flags describe the original selection; they do not replace the reporting polygon.

## Regional source preparation

The current source-only acquisition uses the already retained **1000 m** buffer from 25FD source message `1791847432.704279`, 405F continuation `1791847717.698919`, and the maintained K selection `1791847510.685729`. The capture records this value and the original domain identity in its `plan.json`. The eventual native grid binds `model_domain` and `upstream_buffer_m` to that same retained selection. Capture starts from the original domain manifest while the numeric raster sources are being prepared.

A74F's capture runs before the numeric NLCD arrives and retains all original SDA geometry, ratings and survey editions. Its finalizer then runs on the actual reference:

```bash
"$UPSTATE_PYTHON" -B -m source_tools.soil_region prepare \
  --capture "$UPSTATE_SOIL_REGION" \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_PREPARED" \
  --null-policy nlcd-water-zero
```

Use the same final `UPSTATE_SOIL_PREPARED` directory for coverage below. The completed regional plan has schema `upstate.regional-soil-preparation/v1`; the coverage reader follows its retained source context directly. Original A74F source: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8RM735LH .

## Run

From the application root, using the same equipped Python interpreter as native soil preparation:

```bash
"$UPSTATE_PYTHON" -B -m source_tools.soil_coverage \
  --soil-source "$UPSTATE_SOIL_PREPARED" \
  --domain "$UPSTATE_UPSTREAM_DOMAIN" \
  --bindings "$UPSTATE_DOMAIN_BINDINGS" \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_COVERAGE"
```

Set these variables to the actual current worker paths. Use a separate output directory for this coverage edition. Add `--reporting "$UPSTATE_REPORTING_MASK"` and, where selected, `--reporting-layer "$UPSTATE_REPORTING_LAYER"` and `--reporting-where-json "$UPSTATE_REPORTING_FILTER_JSON"`.

Dependencies are the existing native stack: NumPy, rasterio, Fiona, pyproj, Shapely, and the application's `model.common` and `model.rasters`. The regional source path also reuses `source.capture_upstream_network.esri_polygon` and `source_tools.soil_sources._polygons`, matching A74F's original-ring correction and reprojection method. Its actual geometry corrections are recorded in the coverage plan. The regional command reads retained gzip Esri JSON through the same original-ring helper as capture and preparation. It processes 512-cell windows and uses the same nearest-neighbour original NLCD alignment and GDAL polygon pixel-centre selection as soil preparation.

## Outputs

| File | Use |
| --- | --- |
| `huc12-soil-coverage.gpkg` | Original HUC12 polygons projected to the prepared model CRS, with soil and land-cover coverage fields. Layer: `huc12_soil_coverage`. |
| `huc12-soil-coverage.csv` | The same per-HUC attributes for operator tables and analysis. Preserve HUC12 as text when importing CSV. |
| `soil-coverage-status.tif` | Compact uint8 bitmask on the exact prepared K grid, suitable for missing-data map overlays. |
| `coverage-summary.json` | Buffered model-domain, unbuffered HUC12-union and optional original reporting-area statistics; original preparation counts; source files; affected HUC12 lists. |
| `plan.json` | Source hashes, original binding identity, source grid, buffer, mask selection and method-code hash. |
| `source-entry.json`, `source-manifest.json` | Separate `SOIL_SOURCE_COVERAGE` vector source edition with all JSON, CSV and TIFF companions, original soil URI and vintage. |

## Interpretation

All counts use pixel centres. `joint_valid_cells` requires finite nonnegative K and a finite non-NoData value from the original NLCD raster. `joint_valid_pct` uses selected in-grid cells as its denominator. `outside_grid_area_m2` separately exposes polygon area omitted by the raster extent.

`land_k_unresolved_cells` counts valid NLCD cells other than open water that lack usable K. `nlcd_nodata_cells` reports missing or nonfinite land cover separately. `water_k_zero_cells` counts actual code-11 water pixels whose final K is zero. The original preparation counts retained in the summary identify the source-wide native-rating and explicit water-policy contributions. Per-HUC K statistics use the final physical SI raster values and finite nonnegative pixels. A zero is a value; NoData remains missing.

Regional totals are measured from union geometries, so shared HUC boundaries are not summed twice. Optional reporting totals use the original reporting polygon. The buffer-wide totals include the upstream and model-edge area needed by the source operation.

### Raster flags

Flags combine by bitwise OR; outside the buffered domain is zero.

| Bit | Meaning |
| --- | --- |
| 1 | Inside the actual buffered model domain |
| 2 | K is finite and nonnegative |
| 4 | K is source NoData |
| 8 | K has data but is negative or nonfinite |
| 16 | Original NLCD has a finite non-NoData value |
| 32 | Original NLCD value is 11, open water |
| 64 | Inside the selected original reporting geometry and model domain |

For example, a valid land cell normally has value 19 (1 + 2 + 16), and an unresolved land cell has value 21 (1 + 4 + 16). Add 64 when it also falls in the selected reporting polygon. Use bitwise operations for map styling because multiple conditions coexist.

## Workspace composition and continuation

Pass this coverage manifest alongside the original soil manifest to the existing source composer. Keep the composed manifest in an ancestor directory of all selected original files. The application accepts `kind: vector`, `role: SOIL_SOURCE_COVERAGE`; the complete edition and companions then travel through normal source import and archive/restore.

Each edition's ID derives from its source bytes, selected original domain/reporting mask, native grid and method code. Repeating the same invocation checks completed outputs and restores a missing terminal manifest. An interrupted calculation rebuilds the coverage outputs from the same retained inputs. A changed input or method belongs in a new output directory.

Source references: the existing `source_tools/SOIL_SOURCE.md`, `source/prepare_upstream_domain.py`, and `model/rasters.py` define the retained input contracts. USDA's native service documentation is https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html and https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx. This coverage method reads the prepared K values in their declared SI units; the customary-unit conversion belongs to native soil preparation.
