# Static terrain preparation

This extension supplies the retained-file alternative to the maintained ImageServer DEM workflow. It receives original USGS 3DEP GeoTIFFs and XML, preserves their native sidecars, mosaics a common native lattice, and reprojects once onto the **original 30-metre model grid**. The resulting `upstate.sources/v1` manifest enters the existing Upper Savannah `Workspace.import_sources` writer.

The seven additive `source_tools/terrain_*.py` modules do not replace `raster_sources.py`, `model/rasters.py`, `Workspace.prepare_grid`, the native InVEST engines, or any operator writer. The static files and the online ImageServer exports are different source editions. Record the edition actually used; do not silently exchange their inputs in an existing scientific run.

## Install and open

Extract the complete source archive into a new directory. Run its installer with the actual existing product root:

```sh
python install_terrain.py /absolute/path/opportunities/upstate_forever_2026
```

The installer verifies every distributed byte before any change. Existing identical additions are reused; conflicting files are preserved and reported. It does not edit the shared server, grid, model, or online-source modules. To use acquisition and preparation separately, install into a new directory with `--standalone` and use that directory as the Python working directory.

The current application already needs NumPy, Rasterio, Fiona, pyproj and Shapely. The terrain inspector additionally uses Pillow. `requirements-terrain.txt` lists the dependency ranges. This source was exercised with Python 3.13.5, Rasterio 1.5.0, Fiona 1.10.1, pyproj 3.7.2, Shapely 2.1.2, NumPy 2.3.5 and Pillow 12.3.0.

From the product root, the entry point is:

```sh
python -m source_tools.terrain_cli --help
```

All acquisition and preparation results live in an explicitly selected terrain store, separate from the product source and the original scientific Workspace. JSON is returned on standard output. `--progress` sends preparation progress to standard error. Failures have an explicit error type and message; `--debug` also exposes the traceback to the operator.

## 1. Select the complete original terrain footprint

Reuse an already retained domain and acquisition first. Discovery can run before the large NLCD raster arrives:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition discover \
  --domain /data/original-domain/model-domain.esri.json.gz \
  --buffer-m 1000 --buffer-crs EPSG:5070
```

`--layer` and `--where-json` select an original vector layer and explicit attribute filter when needed. Without a filter every original polygon is selected. Discovery buffers the original domain in the explicitly named metre coordinate system, then finds all nominal one-degree cells intersecting its geographic bounds. **This discovery coordinate system does not choose or change the model grid.** The saved selection records the original domain hash, feature count, buffer and reference system.

A directly supplied four-number extent is also accepted:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition discover \
  --bounds WEST SOUTH EAST NORTH
```

Replace those four words with the actual original longitude/latitude extent. The operation reads and retains the publisher's real directory listings; it selects GeoTIFF and XML links that the publisher actually returns. It also retains the tile GeoPackage when listed. A repeated discovery in the same store reuses that retained edition; a new directory requests a new publisher edition.

The public one-arc-second product is organized in one-degree GeoTIFF tiles. Its native geographic spacing is one arc-second, **not an exact projected 30 metres**. Source files may include overlapping edge samples. The source XML and raster header determine the actual extent, lattice, vertical units and datum. [USGS product catalogue][1]

## 2. Acquire or receive original files

Use the `catalog_path` returned by discovery:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition acquire \
  /data/terrain-edition/catalog/CATALOG_ID.json --workers 2
```

The downloader preserves full HTTP entities, ETag or Last-Modified validators, lengths and original source URLs. After interruption it checks the retained prefix hash and requests the exact remaining suffix. A changed publisher entity is not combined with an older prefix. Rerun the same acquisition to reuse completed files and continue interrupted receiving. Choose a new store for a deliberately refreshed edition.

Already retained files need no second network fetch:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition adopt \
  --raster /data/original/USGS_1_n35w083.tif \
  --metadata /data/original/USGS_1_n35w083.xml \
  --origin https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/1/TIFF/current/n35w083/USGS_1_n35w083.tif \
  --label n35w083
```

That is one named publisher tile, not a definition of the complete Upper Savannah domain. Receive every source selected by the actual domain catalogue. Retained external TIFF masks and GDAL sidecars are copied under their original native filenames. Additional acquisition records can be supplied with repeated `--companion` arguments.

When transferring a geographically identified crop instead of an entire original tile, supply `--derivation original-window.json`. Retain the full-parent identity, parent URI, source pixel window, source and target transforms, exact output hash and any processing operation in that document. The crop's actual raster footprint remains visible; it is not presented as the full publisher tile. The full original should remain with the original source host.

The source XML supplies publication vintage, vertical units and vertical datum. Explicit `--vintage`, `--units`, `--datum` and `--unit-reference` support original sources whose metadata requires an explicit selection. Conflicting declared units are rejected. International feet and US survey feet have different factors; the engine applies the selected original scale and offset and then the documented unit factor exactly once. Heights remain in their declared datum; no vertical datum shift is performed. The USGS documents the datum and resolution of its DEM products. [USGS datum and resolution guidance][2]

## 3. Freeze the original model grid

The strongest integration route is to select the actual existing Workspace source IDs:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition plan-workspace \
  --workspace /data/current-scientific-workspace \
  --reference-collection-id REFERENCE_COLLECTION_ID \
  --reference-source-id NLCD_SOURCE_ID \
  --domain-collection-id DOMAIN_COLLECTION_ID \
  --domain-source-id MODEL_DOMAIN_SOURCE_ID \
  --buffer-m 1000
```

This calls the existing `source_tools.raster_sources.source_grid` through the original retained `Workspace.source_file` views. The source IDs, actual numeric reference identity, domain, buffer and complete grid definition are frozen in `plans/PLAN_ID.json`.

Alternatively, select the original local numeric files:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition plan \
  --reference /data/current-original-nlcd.tif \
  --domain /data/original-domain/model-domain.esri.json.gz --buffer-m 1000
```

With `--reference` and `--domain`, the same original grid writer is used. A supplied `--grid-json /data/frozen-grid.json` uses an existing complete grid definition directly: `crs`, six-value `transform`, `width`, and `height`. It must be north-up, projected in metres, with square exact 30-metre cells. Do not substitute EPSG:5070 for an original NLCD Albers definition merely because both are Albers projections.

Optional repeated `--source-id` arguments freeze a particular source order. The default selects every retained source. `--resampling` is `bilinear` by default, with `nearest` and `average` available as explicit new preparation editions. The default processing chunk is 1,024 cells; `--chunk-size` changes memory/work partitioning, not the selected geographic extent.

## 4. Prepare, inspect and import

Use the returned `plan_id`:

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition prepare PLAN_ID \
  --workspace /data/current-scientific-workspace --progress
```

Preparation first normalizes original masks, scale, offset and units into metres. It then mosaics sources on their shared native lattice. At overlap, the first valid source in the declared order wins; invalid and nonfinite samples do not erase later valid samples. The native mosaic is reprojected once to the frozen target grid. No polygon-edge zero fill, depression filling or hydrologic conditioning is added. The existing InVEST engine retains its own preprocessing.

Each completed target chunk has its exact window, file hash and coverage statistics. A process restart reuses those chunks. The final GeoTIFF is assembled without a second resampling. The existing scientific Workspace imports the completed source manifest through its own writer; repeated imports of that exact manifest reuse the original source collection.

The operator receives:

| File | Use |
|---|---|
| `prepared/PLAN_ID/dem.tif` | Full numeric Float32 terrain on the original 30-metre grid, in metres. |
| `prepared/PLAN_ID/coverage.json` | Every grid cell and every selected-domain pixel centre: valid/NoData counts, elevations, areas and domain extent coverage. |
| `prepared/PLAN_ID/inspector/report.html` | Self-contained monochrome terrain preview, sampled-cell inspection, source inventory, exact grid and complete interpretation. |
| `source-entry-PLAN_ID.json` | Original-compatible `DEM` source entry with full companion inventory. |
| `sources-PLAN_ID.json` | Native `upstate.sources/v1` manifest for the existing source-import action or CLI. |
| `original/`, `sources/`, `plans/`, `selections/` | Complete original files, XML, sidecars, source records, frozen selection and original domain. |

Open the report from the complete source store or received packet. Its preview and interactive sampled values are embedded, so the report itself remains readable when opened separately. Related original-file links use the complete packet's relative paths. On narrow screens, source/coverage tables scroll horizontally.

Coverage uses the entire target rectangle and unique selected-domain pixel centres. Exact vector area is reported separately from raster-cell area. A domain extending outside the computational grid is explicitly recorded and cannot be labelled complete. Zero and negative finite elevations are valid measurements; NoData is retained as NoData. Missing-data counts do not cause invented replacement elevations.

The source manifest can also enter the original operator's existing **source import** workflow. Select `sources-PLAN_ID.json`, retain the returned collection/source IDs, and use that DEM role in the existing grid/profile/run selection. No additional approval action or replacement server is introduced.

## Stop, recover and reopen

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition status PLAN_ID
python -m source_tools.terrain_cli --store /data/terrain-edition pause PLAN_ID
python -m source_tools.terrain_cli --store /data/terrain-edition resume PLAN_ID --progress
```

Pause is observed between target chunks. Restart uses the same plan ID and completed originals/chunks; it does not create a second scheduler. A stopped process can be resumed by repeating `prepare` or `resume`. `list` shows retained sources and plans. The complete source inventory and preparation selection remain independently inspectable JSON.

## Complete transfer to another equipped host

```sh
python -m source_tools.terrain_cli --store /data/terrain-edition pack PLAN_ID \
  --output /data/delivery/upper-savannah-terrain.zip

python -m source_tools.terrain_cli receive /data/delivery/upper-savannah-terrain.zip \
  --output /data/received-terrain --sha256 SENDER_PACKET_SHA256

python -m source_tools.terrain_cli --store /data/received-terrain import PLAN_ID \
  --workspace /data/current-scientific-workspace
```

The ZIP64 packet contains the complete original sources, metadata, sidecars, selected domain, immutable plan, full prepared DEM, coverage and reports. It omits redundant transient chunk/mosaic caches. Receiving verifies the descriptor and every file before publishing the new directory; existing directories are preserved. The recipient can reuse the completed result or create a new plan using the retained sources, without changing the sender. The original source writer preserves native relative filenames when copying the result into its scientific Workspace.

## Engineering journey and source integration

The single `tools/terrain_native_journey.py` programme builds explicitly authored numerical fixtures and exercises the full production API. It is a code-verification programme, separate from the regional scientific study:

```sh
python tools/terrain_native_journey.py
```

The exercised journey covers 4,718,592 source cells; native overlap and nonfinite-mask handling; exact equality with direct Rasterio reprojection across 507,904 prepared cells; three retained chunks across interruption; pause/resume; exact scale/offset and foot conversion; external-mask retention; HTTP suffix recovery and changed-entity rejection; complete-body crash recovery; packet corruption rejection; and independent editable receiving. Desktop and phone-width report rendering was also checked in Chromium using the generated self-contained document.

The runtime's direct `file://` browser navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; the browser inspection used the original report's DOM and embedded numeric/PNG content. The reported numerical journey is an authored engineering case, while the regional source and InVEST run remain the current native source hosts' retained study.

Concrete importable entry points:

```python
from source_tools.terrain_workspace import plan_from_workspace, prepare_and_import

selection = plan_from_workspace(
    terrain_store, existing_workspace,
    reference_collection_id=reference_collection_id,
    reference_source_id=nlcd_source_id,
    domain_collection_id=domain_collection_id,
    domain_source_id=model_domain_source_id,
    buffer_m=1000,
)
result = prepare_and_import(terrain_store, selection["id"], existing_workspace)
```

The returned `workspace_source` contains `source_collection_id`, `source_id`, actual original-view path, units, plan ID and reuse status. The existing source desk can consume that same return value and native source manifest directly.

[1]: https://data.usgs.gov/datacatalog/data/USGS%3A35f9c4d4-b113-4c8d-8691-47c428c29a5b
[2]: https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model
