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

## Source polygon correction

Some native USDA AOI-clipped rings contain self-intersections. The geographic
index now derives valid polygonal geometry from the original linework with
GEOS MakeValid. Valid original geometries pass through unchanged. The complete
original response, including the original WKB, remains in `original/`.

Each corrected row records its original validity reason, source and indexed WKB
SHA-256, source and resulting geometry types, actual Shapely/GEOS versions, and
diagnostic planar square-degree areas in `properties.geometry_correction`.
These degree areas describe the correction; they do not replace the native
acreage or the projected raster-cell areas. The corrected indexed WKB and its
spatial bounds are committed in the same existing tile transaction. Vector
export carries the same correction properties and `coverage.json` reports the
number of corrected fragments. Geometry without valid polygonal support still
raises the concrete source error.

The actual source polygon 65688604 exposed this path during regional capture:
its original ring self-intersection was repaired from 936 to 938 coordinates,
producing a valid Polygon. The diagnostic degree area changed only at floating
point precision. This observation belongs to that polygon; it is not a blanket
area-preservation guarantee for every invalid input. The implementation uses
Shapely's default linework method, retaining compatibility with the existing
Shapely 2.x runtime. See the [Shapely MakeValid reference](https://shapely.readthedocs.io/en/stable/reference/shapely.make_valid.html).

Continue an interrupted original capture with the same `capture --resume`
arguments and output directory. Its already completed tile/index and retained
USDA responses remain reusable; the correction does not select a new domain,
request another source edition, or change native rating values.

## Prepare K on the actual NLCD grid

The corrected native Annual NLCD 2025 region is available in the application's
`source/annual-nlcd-native-20261013/source/` directory. Select its
`land-cover.tif` and retain the adjacent `source-manifest.json` and companions.
The corrected source ID is
`usgs-annual-nlcd-2025-native-region-3fa517b4cc3251b9`; its 9,443,751-byte TIFF has
SHA-256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`.
This full 217-HUC-plus-buffer edition has 6,443 × 6,319 categorical cells. It
supersedes the earlier `a9f6bfed…` raster, whose empty cached tile was corrected
from the retained original PNG by PR #3387. Select the corrected reference:

~~~sh
python3 -B -m source_tools.soil_region prepare \
  --capture "$UPSTATE_SOIL_REGION" \
  --reference "$UPSTATE_NLCD" \
  --output "$UPSTATE_SOIL_PREPARED" \
  --null-policy nlcd-water-zero
~~~

Preparation additionally uses the existing NumPy/Rasterio stack. The original `rasters.grid_definition` creates the exact 30 m grid at the retained reference's native upper-left anchor, and the source remains categorical during nearest-neighbor alignment.

The whole-soil interpretation remains `chorizon.kwfact`, **Dominant Condition / Surface Layer**. Native Choice strings are bound to their original legend. Missing choices stay missing. The preparer converts customary K once by **0.1317**, retaining the existing SDR units `t*ha*h/(ha*MJ*mm)`. This is the same source interpretation and conversion used by the maintained soil pipeline; the [official SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html) supplies the model's K input context.

Minimum and maximum mapunit/rating ranks preserve the original overlap behavior. Conflicting physical ratings remain NoData. The explicit `nlcd-water-zero` option sets K to zero only where original numeric NLCD class 11 is present, a native rating is absent, and ratings do not conflict. `--null-policy preserve` retains all those missing values instead.

The result includes `soil-k.tif`, actual cell coverage statistics, the full original capture and an existing `upstate.sources/v1` raster entry with role `K_FACTOR`, SI units and nearest-neighbor resampling. It declares the unit conversion already applied.

## Integration into the current product

Add this new component beside the original `soil_sources.py`; use the retained source version when installing. Neither command edits application files or another source workspace.

Import the capture's source manifest into the existing operator to inspect the original regional soils. After raster preparation, add the prepared `source-manifest.json` to the original `source_tools.compose` selection alongside DEM, NLCD, precipitation and R-factor. Bind the returned K source ID to `grid.input_sources.K_FACTOR` in the existing native plan.

The scientific run continues through the original `model.native_batch` and `operator/receiving.py` with the complete current source cohort. Return the completed soil capture/manifest and native worker path to the original internal Upstate source item and product thread.
