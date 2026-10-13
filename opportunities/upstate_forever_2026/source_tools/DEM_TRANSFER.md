# Transport the saved 3DEP requests between existing workers

The terrain pipeline can split acquisition from numerical GIS processing. A GIS
worker freezes the exact domain-aligned elevation requests. A Linux worker with
network access receives those original requests using Python's standard library.
The GIS worker then validates each original TIFF and assembles the retained grid.

The transfer module uses the same capture() function and original tile filenames
as source_tools.raster_sources. Completed HTTP entities remain reusable by the
full GIS pipeline.

## Install the additive source

Place dem_transfer.py in the application's existing source_tools directory.
Install the phased raster_sources.py supplied with this feature. Preserve the
application's current model/rasters.py and other independently integrated changes.

Run commands from the application root so model and source_tools are importable.
The network worker needs Python 3.9 or newer on Linux; it needs the existing
model.common, model.rasters, source_tools.raster_sources and source_tools.source_transfer
modules, whose GIS imports occur inside their numerical functions. It can receive
tiles without installing Rasterio or pyproj. The planning and assembly worker uses
the application's existing GIS dependencies.

## 1. Retain one original plan on the GIS worker

Reuse an existing saved source selection when one already belongs to this run.
The selected directory contains:

- plan.json, binding the original reference, domain, metadata and exact grid.
- requests.json, binding the canonical plan digest and every disjoint tile request.
- original/service.json, or original/service.json.gz, retaining the service metadata.

For a new selection, use the existing planning command with the actual retained
reference raster, complete model domain and original service metadata:

~~~sh
python -B -m source_tools.raster_sources dem-plan \
  --reference "$UPSTATE_REFERENCE" \
  --domain "$UPSTATE_DOMAIN" \
  --service-metadata "$UPSTATE_SERVICE_METADATA" \
  --vintage "$UPSTATE_SERVICE_EDITION" \
  --buffer-m 1000 \
  --tile-size 2048 \
  --output "$UPSTATE_SOURCE"
~~~

UPSTATE_SOURCE is the source directory selected for this run; the other variables
refer to existing retained input paths and the observed service edition. Preserve
the run's actual buffer and tile-size choices when continuing an existing plan.
Add --layer and --where-json only when they are part of the selected domain.

Carry plan.json, requests.json and its original metadata member together to the
network worker through the existing source-transfer route. Keep relative paths
unchanged. Completed tile bodies and their adjacent .capture.json files can travel
with the selection and will be reused.

The frozen requests retain 30 m cells, the original CRS, disjoint row-major windows,
numeric Float32 elevation, unrendered band 0, bilinear interpolation and LZ77 TIFF.
A numeric EPSG request is checked against a CRS-level EPSG declaration when one
exists in the saved grid. The GIS planner can also infer an EPSG from equivalent
WKT parameters without an explicit root authority; transport preserves that exact
selected numeric reference. request_crs_binding records declared_epsg,
gis_inferred_epsg or exact_wkt. A WKT request retains the exact original WKT. The
receiving GIS stage checks the original TIFF CRS and transform against the saved
grid. The original plan, URLs and completed entities stay unchanged throughout.

## 2. Receive the same selection on the network worker

Inspect the saved selection before starting requests:

~~~sh
python -B -m source_tools.dem_transfer inspect --output "$UPSTATE_SOURCE"
~~~

Receive the original entities. Choose the concurrency to suit the existing worker
and service capacity; four concurrent requests is an operator selection:

~~~sh
python -B -m source_tools.dem_transfer receive \
  --output "$UPSTATE_SOURCE" \
  --workers 4
~~~

The command checks the plan digest, reference and domain digest syntax, original
metadata bytes, service limits, tile count, exact grid windows, filenames and
bounding boxes. It checks the HTTPS USGS exportImage origin and the entire saved
query, including matching bounding-box and output coordinate systems.

Only the selected original URLs are submitted. capture() hashes complete bodies,
records HTTP status and headers, atomically finishes each entity, and reuses its
matching completed receipt. Interrupted captures retain the original failure and
bytes received. Continuing the same command with the same source directory reuses
all complete entities.

The directory's prepare.lock prevents two pipeline phases from operating there
together. Tile-level capture locks provide the original per-entity exclusion.
Use one acquisition owner for this selection across workers: separate copies of
a directory cannot share a filesystem lock.

Structured progress goes to stderr after completed requests and is retained in
transfer-progress.json. It includes the plan/request identities, total/completed/
reused/pending/failed counts, bytes, elapsed time and each tile's latest state.
The result on stdout has state "transferred" once every selected original HTTP
entity is complete.

HTTP 401, 403 and 429, HTTP 503 with Retry-After, network/timeout failures and a full
output device stop dispatch of additional requests. Already running captures drain
and remain reusable. The actual HTTP status, error and Retry-After value appear in
the progress file. Resume the same directory when the observed condition permits
the original operation to continue. Per-tile failures remain visible alongside
successfully completed neighbors.

## 3. Carry completed bodies and receipts together

The bundle command checks complete entity hashes and writes a ZIP64-capable archive
outside the selected source directory:

~~~sh
python -B -m source_tools.dem_transfer bundle \
  --output "$UPSTATE_SOURCE" \
  --archive "$UPSTATE_ARCHIVE"
~~~

Use a new archive path for each edition. TIFF members use ZIP_STORED to avoid
spending CPU recompressing already compressed originals. The archive contains the
saved plan, request selection, original metadata and each complete tile body with
its matching capture receipt. A transfer-bundle.json manifest records member paths,
bytes and SHA-256 identities, the selection identities and complete/pending counts.

A partial archive can carry completed tiles while the original acquisition retains
its remaining work. transport_complete reports whether the entire selection has
arrived. Incomplete response bodies remain on their original worker for recovery;
the receiving worker gets the exact completed originals.

The command returns the final archive's path, byte length and SHA-256. Carry that
archive through the existing shared source-transfer route together with these
identities. Verify the original archive's hash after reception. Extract into a
fresh receiving source directory and preserve all relative paths. The application
can then continue from its saved plan and completed receipts. A later complete
archive supplies the full saved selection without requesting those tiles again.

## 4. Validate and assemble on the GIS worker

Point UPSTATE_SOURCE at the receiving directory. Run the original numerical
verification and assembly phases:

~~~sh
python -B -m source_tools.raster_sources dem-status \
  --output "$UPSTATE_SOURCE" --verify

python -B -m source_tools.raster_sources dem-assemble \
  --output "$UPSTATE_SOURCE"
~~~

GIS verification opens the retained TIFFs and checks receipt hashes, dimensions,
band count, Float32 storage, CRS and exact placement on the saved grid. Assembly
copies those original disjoint windows to the retained mosaic, preserves missing
cells, checks finite-cell coverage and produces the source entry through the
existing terrain pipeline. Its numerical result is the elevation product used by
the application's admission workflow.

## Operator integration

The module exposes three direct functions:

| Function | Purpose |
| --- | --- |
| inspect_transfer(directory, verify=False) | Validate the frozen selection and report HTTP entity state; verify=True also reads each complete body hash. |
| receive(directory, workers=1, progress=None) | Receive or resume all selected original entities; progress receives compact JSON-ready updates. |
| bundle(directory, archive) | Package the saved selection and hash-checked complete body/receipt pairs. |

Successful CLI operations emit one JSON result to stdout. Progress and errors go
to stderr. receive returns an error exit status when the selection remains
incomplete and retains the detailed recovery state beside the originals.

The HTTP transfer state and GIS source state are separate fields in the operator
flow. A useful sequence is planned -> receiving -> transferred -> GIS verified ->
assembled. Source admission consumes the GIS pipeline's completed source entry.
Keep the selected source directory, plan identity and request identity visible to
the receiving desk so the same operation can continue across existing workers.
