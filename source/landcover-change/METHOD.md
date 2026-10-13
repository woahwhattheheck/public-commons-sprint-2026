# Annual NLCD land-cover change

The module source_tools.landcover_change compares two retained original land-cover
rasters, records their source collection IDs and exact bytes, and emits a new
upstate.sources/v1 collection that the existing source importer can load.

## Application API

compare_landcover(from_raster, to_raster, output_dir, from_source, to_source,
                  align_to_from=False, from_classes=None, to_classes=None,
                  zones=None, zone_source=None, zone_id_field="huc12",
                  zone_layer=None, polygonize=True, block_size=512)

Source metadata accepts the application's retained entry shape, including
body.sha256 and body.bytes. Set entry.year to the selected map year and preserve
entry.year_selection. Exact source_time values (YYYY or ISO calendar date),
metadata.year, metadata.product_year and a four-digit vintage also identify the
product year. All supplied year fields must agree. Source bytes must match those
retained hashes. A vector
zone file can be a GeoPackage, GeoJSON, the retained gzip Esri JSON WBD source,
or a shapefile with its DBF/SHX/PRJ companions. Native vector reads and writes
use the application's existing GDAL/PROJ environment; original compressed
vectors use its existing gzip-aware source path.

A new comparison uses a new or empty output directory. Work stages in a sibling
temporary directory and is moved into place once the source collection is
complete. Repeating the identical request reopens that completed comparison
only after checking the requested source hashes, years, options, and every
retained output hash. It preserves the original created_at, captured_at, source
identity, and file bytes. An occupied directory for another request is rejected.

## Result

The JSON-serializable result includes manifest, summary_path, output_dir,
mask_source_id, transition_source_id, and the complete summary. The manifest
is written to output_dir/sources.json.

- transitions.tif: UInt16 class-pair codes; changed pixels use from*100+to;
  unchanged pixels retain their class; NoData is 9999.
- selected-change.tif: UInt8 mask; 1 is a selected observed transition;
  0 is another common-valid pixel; NoData is 255.
- selected-change.gpkg: change_mask layer, kind vector and role SCENARIO_MASK,
  ready for patches[].mask_source_id after source import. Polygon attributes
  include from/to class and area_ha. When no selected cells changed, the result
  retains its zero-change raster/tables, sets selection.mask_available to false,
  returns mask_source_id=None, and publishes no empty vector mask.
- class-transition.csv: complete canonical class matrix, including zero cells.
- summary.json: common-valid, NoData, invalid-class, unchanged, changed and
  selected coverage, paired validity matrix, input lineage and grid metadata.
- Optional zone-summary.csv and zone-transitions.csv: summaries for the actual
  input polygons and their stable IDs.

A filter such as from_classes=[41,42,43], to_classes=[21,22,23,24] creates a
scenario mask covering observed forest-to-developed transitions. The target
land-cover class for a new scenario remains an explicit scenario-patch choice.
With no filters, all common-valid changed pixels are selected. Same-year
comparisons are labeled edition_revision; differing years are map_year_change.

## Grid and area rules

The default requires identical CRS, dimensions and affine transform. Explicit
align_to_from=True uses rasterio WarpedVRT with nearest-neighbour resampling to
place the TO raster on the FROM grid. The original grids and performed
transformation are recorded. Pixels outside common valid coverage remain
NoData in the comparison and mask.

The FROM grid must be projected in metres. Hectares equal the absolute affine
determinant divided by 10,000. The implementation reads bounded raster blocks
but covers the complete supplied grid. Zone geometries are transformed locally
to this grid, and membership uses pixel centres. Duplicate IDs are unioned per
zone; distinct overlapping zones are independently summarized, with overlap
cell counts and hectares reported. No source data are fetched or changed.

Selected polygons are partitioned at processing-window boundaries to keep
polygonization streaming. Their combined footprint is the selected raster
footprint; a dissolve is unnecessary for the scenario mask's geometric use.

## Official product definitions

The class catalog and encodings follow USGS LSDS-2103, version 1.2, June 2026,
Sections 2.1.1, 2.1.2, 2.2.1, 2.2.3 and 2.2.5:

https://www.mrlc.gov/sites/default/files/docs/LSDS-2103%20Annual%20National%20Land%20Cover%20Database%20%28NLCD%29%20Collection%201%20Science%20Product%20User%20Guide%20-v1.2%202026_04_21.pdf

Annual NLCD land cover has sixteen canonical classes and NoData value 250.
Land-cover change codes concatenate previous and current class codes. The
Annual NLCD 2025 change product describes 2024 to 2025; a 2023 to 2025 comparison
therefore uses the two corresponding land-cover rasters directly.

Current MRLC products are Collection 1.2 and include map years through 2025:

https://www.mrlc.gov/data
https://www.usgs.gov/centers/eros/news/annual-nlcd-collection-12-now-available

Collection 1.2 adds the 2025 products and updates Spectral Change Day of Year for
2021–2024. This module compares actual land-cover bytes and keeps edition
lineage separate from map year. All acquisition stays with the existing
national-product download and local-clipping workflow.
