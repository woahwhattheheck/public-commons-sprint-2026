# Upper Savannah terrain preparation

This is the existing 3DEP input path split into planning, acquisition, status and assembly. The selected NLCD reference, full upstream model domain, retained service edition, request grid, pixel values, original response files and source-entry identity remain attached to the same preparation. Authored by TokenJunkieLabs.

## Start from the current regional source selection

Run from the maintained Upper Savannah product root in the existing GIS Python environment. Use the real retained NLCD TIFF, complete selected model-domain geometry and original service metadata. Reuse the original output directory if its selection is unchanged.

    python -B -m source_tools.raster_sources dem-plan \
      --reference "$UPSTATE_NLCD_REFERENCE" \
      --domain "$UPSTATE_MODEL_DOMAIN" \
      --layer "$UPSTATE_MODEL_DOMAIN_LAYER" \
      --service-metadata "$UPSTATE_3DEP_METADATA" \
      --vintage "$UPSTATE_3DEP_EDITION" \
      --buffer-m 1000 \
      --output "$UPSTATE_DEM_DIRECTORY"

Omit --layer when the retained vector uses its sole default layer. Set the actual explicit buffer used by the scientific grid; 1000 above is the retained workflow's example value. Where a selection is necessary, use the actual --where-json dictionary. The original reference determines projection, pixel origin and 30 m alignment.

Planning writes plan.json, requests.json and the complete original service metadata. It returns the actual grid, tile count and uncompressed mosaic size. It requests no elevation pixels. Receivers retain the original request's numeric or WKT coordinate-system representation across GIS versions, verify its relationship to the saved grid, and check the exact tile geometry and query before use. Transfer these small planning files with their same relative paths to an equipped worker to acquire terrain there, without transferring the full NLCD image or domain a second time.

## Acquire and resume the original numeric tiles

    python -B -m source_tools.raster_sources dem-acquire \
      --output "$UPSTATE_DEM_DIRECTORY" --workers 4

Workers is the number of simultaneous original HTTP exports. It changes execution concurrency, not the scientific request or source identity. Coordinate this value with the source operator and current provider conditions. The default is one. Each URL is attempted once in a command invocation; completed tiles are reused on re-entry.

The original per-file response receipts and exact tile filenames are preserved. acquisition-progress.json and stderr show actual completed tiles, retained bytes, reused tiles and elapsed time. New dispatch stops on authentication/refusal/throttling or a 503 with Retry-After; already-running captures finish and their bytes are retained. Resume the same directory after the recorded condition is resolved. An unavailable file, invalid TIFF grid or incomplete capture produces a nonzero command result with the affected filename.

Only one plan/acquisition/assembly writer runs in a preparation directory. A second writer exits with the normal held-lock error. Read progress from another process while the existing worker continues.

## Inspect progress

    python -B -m source_tools.raster_sources dem-status \
      --output "$UPSTATE_DEM_DIRECTORY"

The default status reports receipt/file-size readiness without re-reading all large original bodies. The response labels that inspection explicitly. For a transferred source selection, --verify also reads each original hash and TIFF grid.

States distinguish acquiring, ready-to-assemble, complete and invalid-output. The response includes the actual counts, per-tile errors, provider Retry-After where present, and the last acquisition/assembly record. Historical progress timestamps remain visible after an interrupted process; they do not assert that a worker is still running.

## Assemble without network access

    python -B -m source_tools.raster_sources dem-assemble \
      --output "$UPSTATE_DEM_DIRECTORY"

Assembly reads every retained original tile against its HTTP receipt and expected grid. It copies the same numeric blocks into the output mosaic without another resampling operation. It retains source NoData and counts valid/missing cells. An all-missing source does not produce a completed entry.

The original dem.tif, tiles.json and source-entry.json are the delivery. All original tile bodies, receipts and service metadata remain declared companions. Feed the entry to the existing source_tools.compose command, then import that same complete source manifest in the Workspace/operator. Interrupted assembly can be restarted from the already-completed tiles. assembly-progress.json records failed or interrupted assembly with the actual exception and completed tile count, so an unfinished mosaic remains visible in the operator's progress view.

The original one-command dem interface remains available and accepts --workers. Original PRISM preparation and completed SourceArtifacts transfer receipt handling are retained.

## Explain this step

| What the operator does | What they should see | Meaning | Plain-language explanation |
| --- | --- | --- | --- |
| Plan the retained study | Projection, 30 m grid, tile count and actual source edition | The elevation requests cover the selected model domain on the land-cover grid | “The terrain and land-cover inputs use the same cells, so the model can connect runoff between them.” |
| Acquire with the current worker count | Completed tiles, original bytes and elapsed time increase | Each completed regional piece is kept independently | “We retain each completed download and continue the remaining pieces after an interruption.” |
| Open status during a run | Ready, incomplete and pending counts with the original error where needed | Progress comes from the saved request results | “This shows which original data have arrived and which still need to finish.” |
| Assemble and import source-entry.json | Original elevation mosaic, physical metres and retained source record | The terrain source is ready for the scientific grid preparation | “This is the terrain input that the sediment and nutrient calculations use.” |

## Source and integration

Base source: source_tools/raster_sources.py, original Git blob 45b5d53ffe38388367b0235e4aa3002c900ec1e0. Preserve a later source author's changes when adopting this successor. The --transfer PRISM intake remains in the full postimage.

Current original service and contract:

- [USGS 3DEP elevation service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Esri image export contract](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)

The October 12 service read advertises one Float32 band, the numeric None raster function, 8000 × 8000 maximum export dimensions and the retained original service metadata's edition. Actual work uses the source operator's selected metadata bytes rather than this prose as a configuration input.
