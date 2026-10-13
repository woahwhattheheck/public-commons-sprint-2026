# Native projected model grid

The Upper Savannah project defaults to one projected grid with exact 30 m by 30 m cells. Its anchor is the upper-left corner of the received reference land-cover raster. An explicitly selected `resolution_m` supports another original study at its actual native square-cell resolution; the reference raster must match that selection. The full native source raster and its original affine transform remain retained.

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

## Original example resolution

The official Gura sample reference uses nominal 300 m cells. Its receiving specification explicitly sets `resolution_m: 300`; omitted values continue to use the original 30 m default. Alignment and native export placement use that grid's actual affine coefficients. Annual per-hectare rates are multiplied by the affine determinant in square metres divided by 10,000, so the original 300 m square represents 9 hectares. The separately declared upstream buffer retains its own meaning as model context.
