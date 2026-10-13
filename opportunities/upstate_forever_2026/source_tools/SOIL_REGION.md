# Regional whole-soil K acquisition and 30 m preparation

Operation: **UPSTATE-REGIONAL-SOIL-K-A74F-20261012**  
Source extension: `source_tools/soil_region.py`  
Original application: `opportunities/upstate_forever_2026`, retained 72-file source `F0C8F3MKR3M` at `7c4223a111581935b494d5ac4b9357ef86992d67`.

## Purpose

Acquire the full upstream region's soil geometry and native whole-soil K ratings while the national NLCD transfer proceeds. The existing `soil_sources.prepare` opens its actual NLCD reference before beginning USDA capture. The new `capture` command only requires the already retained upstream domain and the existing Shapely/pyproj runtime. The later `prepare` command places that same complete capture on the actual received NLCD grid.

The maintained capture/preparation component reuses `Sda` original-request storage, `_geometry_pages`, `_native_rule`, `_choice_coefficients` and `_polygons` behavior, and the original `source.capture_upstream_network.esri_polygon` reader. The acquisition-throughput edition updates the complete `soil_sources.py`, `soil_region.py` and this guide together; its page-consumer argument is optional for every existing caller. Existing source acquisition and scientific run identities continue in the same workspace.

## Inputs and geography

Use the original source manifest:

`/dev/shm/dbc61-upstate-model-domain-20261012/sources.json`

Its selected source ID is `upstate-wbd-upstream-domain-20261012`. The original source contains 217 HUC12 features; its decoded 11,220,042-byte body has SHA-256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. The source manifest and every declared companion travel with the new capture. Existing object IDs, source CRS and explicit geometry-correction records remain available.

The capture uses the selected upstream domain plus the same explicit 1,000 m model-context buffer. It partitions source acquisition into projected 15 km tiles in EPSG:5070, obtains geographic request envelopes with an additional 60 m margin, and retains the resulting native USDA polygon fragments. Those acquisition tiles are independent of the final model grid.

The PlanningBasins2023 reporting polygon and four utility watersheds keep their separate roles. The acquisition boundary is the full upstream domain. Raster preparation recomputes the model geometry in the actual NLCD CRS and checks that it lies within the retained capture support.

## Capture the entire region

Run from the complete existing product root. Use a normal writable volume for `UPSTATE_SOIL_REGION` and retain it across worker lifetimes. The source directory contains original geometry pages and the completed reusable regional layer.

The previously operated vector route is system `python3` with the existing `/dev/shm/dbc61-geometry-runtime` on `PYTHONPATH`, exposing Shapely 2.1.2 and pyproj 3.7.2. An existing equipped Muse/Linux runtime can run the same command with its own retained dependencies.

~~~sh
python3 -B -m source_tools.soil_region capture \
  --domain-manifest /dev/shm/dbc61-upstate-model-domain-20261012/sources.json \
  --domain-source-id upstate-wbd-upstream-domain-20261012 \
  --output "$UPSTATE_SOIL_REGION" \
  --vintage USDA-SDA-2026-10-12-native-capture \
  --buffer-m 1000 \
  --tile-edge-m 15000 \
  --halo-m 60 \
  --page-size 128 \
  --rating-batch 1000 \
  --resume
~~~

To consume the existing original metadata body, also pass:

~~~sh
  --attribute-metadata source/soil-interpretation-20261012/soil-erodibility-rule-form.body \
  --metadata-capture source/soil-interpretation-20261012/soil-erodibility-rule-form.capture.json
~~~

Those two optional arguments are paired. Without them, the capture reads and retains USDA's current native metadata using the same public SDA query and verifies the actual whole-soil rule before interpretation. The original retained 22,972-byte metadata body has SHA-256 `8c66678db4e2e1ef3806db50f9c5f29cb0d809a50501717d55f55ff2cb677b18`.

The code uses the published SDA POST service. Each geographic AOI supplies its complete original polygon count, IDs and exact WGS84 WKB pages. Native mapunit keys are then interpreted in batches of at most 1,000 using USDA's returned catalog, unchanged short-form defaults and full long-form metadata. Original requests, responses, headers and result IDs remain in `original/`. Provider survey editions bracket the acquisition, and all actual used surveys must agree.

USDA documents the distinction between geographic AOIs and mapunit-list AOIs and the native interpretation service in its [web-service contract](https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx) and [advanced-query guide](https://sdmdataaccess.nrcs.usda.gov/documents/AdvancedQueries.html).

## Complete capture products

| Output | Use |
| --- | --- |
| `soil-mapunits.geojson.gz` | Geographic soil layer with native AOI/polygon/mapunit identifiers, original Choice values and derived SI values. Import its manifest into the existing source workspace and spatial viewer. |
| `soil-polygons.sqlite` | Indexed WGS84 WKB with the complete original field rows. The raster preparer queries this local index per output window. |
| `ratings.json` | Every native rating, original legend, unchanged interpretation parameters and Choice-to-Decimal projection. |
| `geometry-capture.json` and `tiles/` | Complete source geometry page selections and tile AOI identities. |
| `survey-editions.json` | Original survey rows and observed spatial versions. |
| `coverage.json` | Actual feature, tile, polygon, mapunit, rated/null and survey counts. |
| `capture.json` | Complete reusable capture with every member's byte count and SHA-256. |
| `source-manifest.json` | Existing `upstate.sources/v1` source entry for the complete native soil vector. |
| `domain/` and `original/` | Original upstream source and all native USDA capture evidence. |
| `progress.json` | Last completed geometry/rating progress for continuation. |

Adjacent acquisition AOIs overlap. Their fragments retain source identity; summed fragment area is therefore not a regional area estimate. The final preparation uses geographic coverage and actual pixel rasterization.

Inspect the completed source with:

~~~sh
python3 -B -m source_tools.soil_region inspect --capture "$UPSTATE_SOIL_REGION"
~~~

For an interruption, preserve the same directory and continue the same `capture ... --resume` command. Completed requests and interpretation IDs are reused. The inherited original SDA transport retains attempts and honors provider Retry-After. The final manifest can be rebuilt from complete retained capture bytes if interruption occurs during its last save.

## Capture throughput and interruption recovery

The regional acquirer consumes each validated geometry page directly into the
existing SQLite/R-tree transaction. The shared page reader still verifies the
exact polygon IDs, source attributes, AOI, CRS and hexadecimal WKB before the
consumer runs. It releases the page before receiving the next one. This removes
the former second decompression and JSON decoding pass over the same page.

Provider requests remain serial, with the existing 64 MiB geometry-response
limit and original Retry-After handling. No additional tile queue or parallel
download worker is created. The tile loop, geographic rectangles, original
mapunit IDs, interpretation batches, null policy and final vector ordering use
the same source selections as before.

Each completed tile now commits its rows, R-tree entries and a small checkpoint
in the same `soil-polygons.sqlite` transaction. That checkpoint binds the exact
existing request documents, successful response records and compressed response
bodies. It also binds a streamed hash/count of the derived WKB/index rows.
Checkpoint data stays in the existing database; the original request/response
files retain their existing names and formats.

Run the same capture command with `--resume` and the same output directory.
Completed tiles verify their original retained file identities and stream the
stored index once, then reuse those rows directly. They do not decompress every
geometry page, parse every WKB or delete/reinsert the completed index. A failed
transaction leaves its previously committed state intact, while already received
provider pages remain available to the ordinary request cache.

An older incomplete capture without these checkpoints makes one normal pass
over its existing cached pages and records each completed tile. A missing or
changed derived row/index is rebuilt from those original pages. Changes to an
original request or body are reported with their actual retained file path.
Already complete captures retain their original complete manifest and members.

The existing `progress.json` geometry stage includes `reused_indexed_tiles` and
`newly_indexed_tiles` alongside completed tile and mapunit counts. These fields
show work actually reused during this invocation. The improvement removes
identified duplicate operations; elapsed time remains the accepting host's
observed runtime result.

Preparation continues to process the original raster in bounded windows
(default 512 cells per side), retain independent copies of the complete source
and use the unchanged grid/K/coverage methods. Place the existing capture on
the accepting host's owned persistent storage, preserving its original source
directory and lock when continuing the current operation.

## Prepare K on the actual NLCD grid

After the existing national NLCD owner returns the completed numeric regional raster, select that exact reference:

~~~sh
python3 -B -m source_tools.soil_region prepare \
  --capture "$UPSTATE_SOIL_REGION" \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_PREPARED" \
  --null-policy nlcd-water-zero
~~~

Preparation additionally uses the existing NumPy/Rasterio stack. The original `rasters.grid_definition` creates the exact 30 m grid at the retained reference's native upper-left anchor, and the source remains categorical during nearest-neighbor alignment.

### Original 2025 NLCD reference and native receiving

The corrected original Annual NLCD 2025 regional TIFF is retained in
[merged PR 3387](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3387),
commit `f7e5e885b200cc5d552dc887daa3ff071a472a96`.
Its complete body is **9,443,751 bytes**, SHA-256
`3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`,
with source ID
`usgs-annual-nlcd-2025-native-region-3fa517b4cc3251b9`.
The selected original region contains 217 HUC12s plus the same 1,000 m buffer:
6,443 by 6,319 cells in EPSG:5070, assembled from 49 original publisher PNGs.
The completed source correction verifies all 40,713,317 pixels against those
originals, with zero mismatches, class-0 cells or NoData.

The complete numeric raster is a normal retained application file:
`source/annual-nlcd-native-20261013/source/land-cover.tif`.
Its adjacent `source-manifest.json` identifies the corrected edition and
original companions. Reuse these already-published bytes in the current
application or the existing project source directory. Bind the actual path:

~~~sh
UPSTATE_NLCD="$APPLICATION/source/annual-nlcd-native-20261013/source/land-cover.tif"
~~~

Retain the adjacent manifest and verify the full byte count and SHA-256 above
before the existing `soil_region prepare --reference "$UPSTATE_NLCD"` step.
The maintained receiver can retain this original source in the existing project:

~~~sh
"$UPSTATE_PYTHON" -B "$APPLICATION/source/annual-nlcd-native-20261013/receive.py" \
  --raster "$UPSTATE_NLCD" \
  --output "$CURRENT_PROJECT/sources/nlcd-2025-native"
~~~

It verifies the complete TIFF, compressed and inflated strip hashes, class
counts and native georeference, and returns absolute `raster` and `manifest`
paths. Bind the returned `raster` path for soil preparation. The corrected
receiver uses `--raster`; the older `--parts` interface is superseded.

The [original source Page](https://chatgpt.com/space/page_4d1a1acaf17c8191934049834ea8a222)
preserves its source history, including tile 24's original PNG of 279,736 bytes,
SHA-256 `aada47d6e45c6bc57c692cd638690a991e1cd02393356e1904c1cbb80aa55eec`.
The earlier 9,237,060-byte TIFF with SHA-256
`a9f6bfedc4bd3936b20c05b68709f2f450b822df9fbd8cd53fa2f46bb27e5157`
had an empty decoded tile entry and is retained as the preceding edition.
The current preparation reference is the complete corrected 3fa517b4 TIFF.

The TIFF's exact original affine is
`[29.999999995403137, 0, 1114859.9994590343, 0, -30.000000026127967, 1428209.9983569037]`.
Each axis independently satisfies the maintained nominal-30-metre tolerance
(`rel_tol=1e-9, abs_tol=1e-12`). Recognize this existing nominal-30 case
before applying the separate square-axis rule used for other native grids.
Opposite source rounding makes the axis difference approximately
`3.072483067967369e-8` metres, just above that generic square threshold.

The existing normalization still anchors exact 30 m cells at the original
upper-left coordinate and retains the complete source affine and dimensions
in `grid.reference_normalization`. For the original full 6,443 by 6,319
reference window, the maximum corner shift from nominal normalization is
approximately **0.000167738125 metres**. The actual model window's measured
shift is recorded by the grid builder. The original TIFF is unchanged.
Explicit requested-resolution assertions and all other native-grid tolerances
retain their existing behavior.

The whole-soil interpretation remains `chorizon.kwfact`, **Dominant Condition / Surface Layer**. Native Choice strings are bound to their original legend. Missing choices stay missing. The preparer converts customary K once by **0.1317**, retaining the existing SDR units `t*ha*h/(ha*MJ*mm)`. This is the same source interpretation and conversion used by the maintained soil pipeline; the [official SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html) supplies the model's K input context.

Minimum and maximum mapunit/rating ranks preserve the original overlap behavior. Conflicting physical ratings remain NoData. The explicit `nlcd-water-zero` option sets K to zero only where original numeric NLCD class 11 is present, a native rating is absent, and ratings do not conflict. `--null-policy preserve` retains all those missing values instead.

The result includes `soil-k.tif`, actual cell coverage statistics, the full original capture and an existing `upstate.sources/v1` raster entry with role `K_FACTOR`, SI units and nearest-neighbor resampling. It declares the unit conversion already applied.

## Integration into the current product

Add this new component beside the original `soil_sources.py`; use the retained source version when installing. Neither command edits application files or another source workspace.

Import the capture's source manifest into the existing operator to inspect the original regional soils. After raster preparation, add the prepared `source-manifest.json` to the original `source_tools.compose` selection alongside DEM, NLCD, precipitation and R-factor. Bind the returned K source ID to `grid.input_sources.K_FACTOR` in the existing native plan.

The scientific run continues through the original `model.native_batch` and `operator/receiving.py` with the complete current source cohort. Return the completed soil capture/manifest and native worker path to the original internal Upstate source item and product thread.
