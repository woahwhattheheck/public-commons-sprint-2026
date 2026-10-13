# Continue paired parameter-study results

A saved parameter study keeps its original baseline, case profiles, selected native
models and reporting areas. Run and Resume use those same native case IDs.
After the native cases finish, their nutrient or sediment exports are aggregated
on paired valid pixel centres using the existing mass-per-pixel method.

## Existing operator journey

Open **Parameter studies**, open the saved study, then choose **Resume remaining
cases** or **Refresh completed results**. The paired-result panel shows the
completed case–pollutant pairs, retained pairs reused, and the current case,
pollutant and raster-window position. A process interrupted during aggregation
continues from its last completely saved window. Existing completed native runs
stay attached to the same study.

The Gura broad-study suite uses the same engine. Its retained study records and
progress events carry `aggregation_progress` alongside native case progress.
Continue the existing suite with its original application, Workspace and inputs.

## Exact result reuse

Both raster bodies are verified against their retained descriptors before any
cached result is consumed. A cache context binds the original reporting areas,
their actual target-CRS geometry bytes, the current aggregation source files and
NumPy/Rasterio/GDAL/Shapely/Python versions. Each pair also binds both raster SHA256
values and lengths, and the pollutant. A changed input, reporting selection,
method or runtime selects another cache context.

The raster kernel keeps its original block order and float64 sums. A checkpoint
is written only after every reporting area has consumed a complete window.
It retains the accumulated masses, independent and paired cell counts, the next
window index and a checksum. Resume restores that exact accumulator and skips
only preceding complete windows. It does not divide, scale or sum a window twice.

Completed pair records keep their calculated masses, valid-cell counts,
support-change flags, percentages and original pixel area. Baseline-relative
parameter response and elasticity are still calculated from each current case's
own retained profile. Pairs with identical raster bytes can reuse the same
aggregation while retaining their separate case and profile labels.

Interrupted pair checkpoints are updated about every five seconds at completed
window boundaries. Operator notifications are limited to once per second during
ordinary progress. No native thread, queued operation or additional worker is
created. The original experiment lock covers aggregation and exports.

## Saved results and transfer

A study retains:

- `paired-results/<context-id>/context.json`: original area and implementation bindings.
- `paired-results/<context-id>/<pair-id>.partial.json`: the latest complete window checkpoint.
- `paired-results/<context-id>/<pair-id>.json`: a completed paired aggregation.
- `aggregation-progress.json`: the current compact progress observation.
- `aggregation.json`: this pass's completed pair reuse and continuation details.

The existing result JSON includes aggregation details. The existing results ZIP
includes the current context and completed pair records, and the operator exposes
the aggregation document as an additional download. A whole Workspace transfer
also retains unfinished windows, so continuation works after independent reopen.

A missing derived record is recomputed from the verified original rasters.
An invalid derived record is preserved under its cache context's `invalid/`
directory before recomputation. Original source data and scientific selections
remain in their existing stores.
