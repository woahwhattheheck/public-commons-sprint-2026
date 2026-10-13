# Exact 30-metre model grid

The project uses one projected grid with exact 30 m by 30 m cells. Its anchor is the upper-left corner of the received reference land-cover raster. The full native source raster and its original affine transform remain retained.

## Receiving the Annual NLCD grid

The retained Annual NLCD WCS description publishes X spacing `29.999999995403137` m and Y spacing `-30.000000026127967` m. These are nominal 30 m values. The exact original XML is `source/annual-nlcd-service-20261012/coverage-description.xml`, SHA-256 `1a3cba52dca82969d46c0f08aa02f5f2047b5c94edb87bc476c8d172bbad0ff9`; its accompanying contract retains the original service URL and source-loader result.

The grid builder reads the actual received TIFF affine. It admits finite, unrotated, north-up, projected-metre reference grids whose two pixel sizes match 30 m within a relative tolerance of `1e-9` and absolute tolerance of `1e-12` m. It then constructs `Affine(30, 0, reference_left, 0, -30, reference_top)` before calculating any model-domain row or column.

Flooring the left/top indices and ceiling the right/bottom indices covers the complete selected, buffered model geometry. The returned transform, bounds, dimensions and pixel area all use this same exact grid. The original land-cover aligner uses nearest-neighbor sampling for class values; each continuous source retains its explicitly selected interpolation and physical-unit conversion.

## Retained normalization

Every new grid includes `reference_normalization` with:

- The source affine, dimensions and actual pixel sizes.
- The exact anchored model affine and selected integer row/column window.
- Whether the affine changed.
- The maximum displacement between original and normalized transforms at the four selected-window corners, in metres.
- The normalization and source-alignment methods.

Existing source objects, source manifests and original raster bytes keep their own identities. Normalization is part of the new grid record and its content identity. A reference already using exact 30 m cells retains the same affine.

## Elevation and native exports

The 3DEP export planner receives this exact grid and requests disjoint Float32 elevation tiles on the same pixel boundaries. Its native returned CRS, dimensions, affine and band type are checked before pixel assembly.

The original InVEST NDR and SDR stages consume the aligned model inputs. Delivery conversion checks their output grid and pixel centres before translating native annual per-hectare export into per-pixel mass. An exact 30 m square represents `0.09` hectares. Export values and structural stream omissions continue through the original native output and observation-comparison handling.

The normalization is performed before model execution. A different reference origin, reporting/model domain or source revision creates a new explicit grid selection.

## Original interfaces

- `model/rasters.py::grid_definition`: one grid contract used by workspace and source preparation.
- `model/rasters.py::align_source`: original raster alignment and source-unit conversion.
- `source_tools/raster_sources.py::prepare_dem`: original 3DEP tile capture and assembly.
- `model/rasters.py::rate_to_mass`: original native export placement and pixel-area conversion.
- [USGS Annual NLCD source service](https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wcs)
- [Original GeoServer WCS reference](https://docs.geoserver.org/stable/en/user/services/wcs/reference/)


## Regional preparation and recovery

`Workspace.prepare_grid` retains completed alignment tiles automatically. Continue
an interrupted preparation by rerunning the original `grid-prepare` selection.
Completed grid members keep their recorded identities; only the unfinished
source is continued. No change to the selection JSON is needed.

Each aligned source uses 256 by 256 pixel tiles. A tile is reusable only after
its NumPy body and checksum-bearing metadata have both been committed. The
checkpoint identity includes the full retained source edition and its companion
files, exact model grid, interpolation, conversion, output type and nodata,
and Rasterio/GDAL/PROJ versions. Changing any of those inputs creates a separate
checkpoint identity. Missing or damaged derived tiles are rebuilt from the
retained source; original input bodies stay intact.

The builder writes to a temporary TIFF, closes and synchronizes it, then
atomically replaces the destination. An interrupted temporary file is never a
complete grid member. After the TIFF has a retained checksum in `grid.json`,
its rebuildable tile cache is removed. An interruption before that record keeps
the tiles available for continuation.

Only one source's unfinished alignment cache is needed at a time. Its pixel
bodies require approximately `width * height * 4` bytes for either Int32 or
Float32, plus small NumPy headers and tile metadata; the final compressed TIFF
is written alongside it. Warp memory and the scoped GDAL cache remain 64 MB
and 64 MiB respectively. Physical conversion happens in a window and rejects
overflow or a collision with the output nodata sentinel.

A direct aligner caller can use the same recovery path:

```python
stats = align_source(
    original_source, aligned_output, retained_grid,
    resampling="bilinear",
    conversion=source_entry.get("conversion"),
    checkpoint_directory=working_directory / "alignment",
    source_identity={
        "body": source_entry["body"],
        "companions": source_entry["companions"],
    },
)
```

For a local source without an explicit identity, the aligner hashes each
GDAL-listed source file before reusing checkpoints. The returned
`stats["preparation"]` gives the completed and reused tile counts and the
checkpoint identity.

## Exact statistics at regional scale

`model/raster_stats.py` computes extrema, sum, mean and linear percentiles by
reading windows of at most 512 by 512 pixels by default. It never reads the
complete raster into a NumPy array. A scoped 64 MiB GDAL cache also limits
block caching during the scans. Percentile selection uses native numeric
order statistics: every selected pixel participates, with no random sample or
coarse-bin approximation. Adjacent selected values are interpolated at the
zero-based rank `(n - 1) * (q / 100)` using Float64 arithmetic.

The first scan collects statistics and the first key byte. Further scans refine
only the prefixes containing the requested ranks. Float32 percentiles need at
most four scans and Float64 at most eight, regardless of raster dimensions.
Multiple requested percentiles share these scans. Extrema, sum and mean without
percentiles need one scan.

```python
from .raster_stats import raster_percentile, raster_statistics

with rasterio.open(native_export) as source:
    cap = raster_percentile(source, 95, positive_only=True)
    summary = raster_statistics(source, percentiles=[50, 95, 98])

with rasterio.open(native_scenario_change) as change:
    change_scale = raster_percentile(
        change, 98, absolute=True, positive_only=True,
    )
```

Raster nodata, masks and non-finite values are excluded. `absolute=True`
transforms finite values before `positive_only=True` filters zero values.
Signed integer minima retain their correct unsigned magnitudes. This supports
one comparable map scale for signed changes without allowing a large unchanged
footprint to collapse the scale to zero.

`valid_cells` counts all finite unmasked cells; `selected_cells` additionally
applies the positive-only selection. The sum, mean, extrema and percentiles
describe those selected, optionally transformed values. An empty selection
returns a zero sum and `None` for mean, extrema and percentile values.
The default combined pollutant priority converts an empty positive selection
to a zero cap. Explicitly supplied priority caps remain in use without a
percentile scan.
