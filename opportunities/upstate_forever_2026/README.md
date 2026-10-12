# Upper Savannah source preparation and calibration

Reusable source tools for the Upper Savannah watershed application, authored by TokenJunkieLabs. The terrain module prepares original USGS elevation on the selected 30 m land-cover grid and carries the retained source edition into the scientific Workspace.

## Terrain preparation

The source package includes the complete raster preparation module and its native grid, geometry and transfer helpers. Use an equipped Linux Python environment with NumPy, Rasterio, Fiona, pyproj and Shapely.

From this directory:

    python -B -m source_tools.raster_sources dem-plan --help
    python -B -m source_tools.raster_sources dem-acquire --help
    python -B -m source_tools.raster_sources dem-status --help
    python -B -m source_tools.raster_sources dem-assemble --help

[The operating guide](source_tools/DEM_WORKFLOW.md) gives the complete source selection, worker handoff, recovery, assembly and import sequence. The original single-command dem and precipitation preparation interfaces remain available.

Planning binds the actual reference TIFF, selected upstream polygons, original image-service metadata, edition, explicit buffer and disjoint tile requests. Acquisition retains each original HTTP entity independently, reports actual progress and reuses completed captures. Worker concurrency changes execution only. Assembly uses the retained original numeric cells and publishes the same source-entry format for the scientific source composer.

The service edition and native source resolution are preserved with every selected input. Projection, 30 m grid alignment and bilinear elevation resampling remain explicit in the original request plan. Source data and scientific configuration need expert review for their intended application.

## Integration with the scientific application

The files follow the maintained application paths. When adopting into an existing application, retain its current model and operator files and apply the changed source_tools/raster_sources.py together with the guide. Its base source is identified in the guide; compose a newer local edit rather than replacing it blindly.

The terrain output is source-entry.json, its GeoTIFF and original companions. Select that entry in the existing source composer and import the resulting complete source manifest through the scientific Workspace. Keep the selected reporting boundary separate from the upstream contributing model domain.

Native execution status and source choices belong to the actual run and retained input directory. The guide supplies the same commands for the receiving operator to run on that selection.

## Original sources

- [USGS 3DEP elevation service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Esri image export contract](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)
- [PRISM climate normals](https://prism.oregonstate.edu/normals/)

Code is covered by the repository MIT license. Original providers' source attribution and terms remain with the selected input files.
