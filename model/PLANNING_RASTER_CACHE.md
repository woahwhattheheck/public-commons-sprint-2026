# Planning inventory raster read reuse

The existing planning inventory summarizes original polygons against completed native annual-mass rasters. Its scientific calculation is unchanged: it reads the same integer feature windows in the same order, intersects every selected run and pollutant's finite valid support, and performs the same float64 reductions before writing each original feature row.

A shared, operation-local native-block cache now serves those exact windows. Neighbouring and overlapping features can reuse raster data already read during the same inventory build. Original feature streaming, IDs, attributes, geometry, reporting masks and independent overlap semantics stay in the maintained planning engine.

## Memory budget

The default is 33,554,432 bytes (32 MiB) across all retained raster blocks in this one inventory operation. This counts the actual NumPy data arrays and Boolean masks. Existing caller windows, float64 working arrays, temporary native-block batch buffers, GDAL's cache and Python object overhead remain separate. Each temporary batch's data and normalized Boolean mask together fit within the same byte limit; this working allocation is additional to retained arrays.

The existing build call accepts an operational keyword:

    record = planning_inventory.build(
        workspace, selection, raster_cache_bytes=16 * 1024 * 1024)

The ordinary operator/API selection object can also supply an integer raster_cache_bytes field. The engine removes that operational field before normalizing the scientific selection. A supplied keyword and object field must agree when both are present.

Zero uses ordinary direct Rasterio reads. Negative values, booleans and non-integer budgets are rejected before the engine creates an output directory. If one native block or the complete block-aligned requested rectangle exceeds the entire budget, the request reads only its original window directly. No installed dataset is resized, retiled or copied.

Each cache is created for one inventory build and released by its existing resource stack. Keys identify the actual open single-band dataset and its native block position. Reopening a file in another operation creates a new cache. Missing blocks for a requested window are fetched in one contiguous batch, including when the original raster uses narrow strips. The cache copies individual block arrays from that batch so later evictions release their exact retained bytes. Returned windows own their data and masks, so changing a returned array cannot change retained blocks.

## Scientific identities and continuation

The operational budget, timings and counters do not enter METHOD, the scientific selection, selection_id, CSV, inventory.json or the saved planning inventory's ID. Existing completed inventories reopen as before, without rereading native rasters or regenerating their CSVs.

New successful builds retain a separate file:

    planning-inventory-data/<selection_id>/read-processing.json

It binds the actual inventory ID, selection ID and completed CSV hash to elapsed build time and read counters. It is stored separately from the immutable scientific record. The complete Workspace archive already carries this planning-inventory data directory.

Read it using:

    details = planning_inventory.read_processing(workspace, record["id"])

Older completed inventories return status "not-recorded"; their scientific results remain usable. Reopening a completed build does not invent counters or replace the original processing record.

## Reading the counters

| Field | Meaning |
| --- | --- |
| window_requests | Original integer windows requested by the planning engine. |
| requested_pixels | Cells across those requests, including repeated and overlapping windows. |
| source_reads | Actual calls to dataset.read made by this cache. |
| source_pixels | Cells returned by those calls; a first native block read can cover more cells than the requested feature window. |
| cache_hits / cache_misses | Reused or newly populated native blocks. |
| block_read_batches | Contiguous reads that populate one or more missing native blocks. |
| direct_reads | Requests served without retaining native blocks. |
| disabled_reads / oversized_block_reads / oversized_window_reads | Direct requests caused by a zero budget, an oversized native block, or an aligned requested rectangle larger than the budget. |
| evictions | Previously retained blocks removed to respect the budget; per-source counts identify the request that caused removal. |
| peak_retained_array_bytes | Largest actual retained data-plus-mask allocation in the operation. |
| sources | The same counters grouped by the reporting mask or original run/pollutant label. |

These measure Rasterio calls and returned cells. They do not claim a physical disk-read count or an OS/GDAL cache hit. source_reads equals block_read_batches plus direct_reads. A small budget or widely separated features can produce few hits; larger requested windows may cross several blocks. Even a cold request crossing many narrow strips uses at most one Rasterio read. Compare source_reads and source_pixels with the actual workload before changing the budget.

The cache never changes the feature window subdivision to improve a counter. This preserves the original summation order and byte-level scientific output for unchanged inputs.

## Focused receiving check on retained rasters

Run the supplied single check in an existing GIS interpreter against the actual reporting mask and aligned annual-mass rasters from the planning selection:

    <GIS_PYTHON> -B source/planning-inventory/reference_read_cache.py \
      --application <APPLICATION_ROOT> \
      --raster <RETAINED_REPORTING_MASK> \
      --raster <RETAINED_BASELINE_MASS_RASTER> \
      --raster <RETAINED_ALTERNATIVE_MASS_RASTER> \
      --cache-bytes 33554432

Repeat --raster for all selected runs and pollutants. The command reads original data without creating or changing native model outputs. It compares data, masks, dtype, shape, common finite support and float64 window sums against direct Rasterio reads. It covers original block boundaries, raster edges, repeated reads, caller mutation, zero budget, oversized-block and oversized-window fallback, plus a one-block budget with smaller original windows. It prints its input paths/stat identities, helper source hash and actual read counters as JSON.

The reporting mask and annual-mass artifacts must share the same retained grid. Use the already installed native Workspace and its original artifacts. The command performs a receiving check of the read path; native model calculation continues through the maintained Workspace/programme.
