# Aligned binary raster masks for native land-cover scenarios

Regional study allocations can remain on the model grid from preparation through native execution. Ordinary scenario patches now accept a retained single-band binary raster as their mask, alongside the existing polygon source. The resulting scenario land-cover raster follows the same native stage, identity and downstream delivery route.

## Retain and select the mask

Import the mask through the existing `Workspace.import_sources` source collection workflow. The source entry uses `kind: "raster"` and the original file descriptor, source identity and provenance required by that workflow. Use the returned collection identifier and the retained mask source identifier in the ordinary land-cover scenario:

```json
{
  "title": "Published forest-loss allocation",
  "reason": "Apply the retained allocation selected for this study scenario.",
  "kind": "landcover",
  "source_collection_id": "RETAINED_COLLECTION_ID",
  "patches": [
    {
      "mask_source_id": "RETAINED_MASK_SOURCE_ID",
      "from_codes": [41, 42, 43],
      "to_code": 22,
      "reason": "Convert eligible forest cells selected by the retained binary mask."
    }
  ]
}
```

Other ordinary scenario fields still apply. `Workspace.save_scenario` resolves every selected source through `source_file`, which verifies its retained file. The native land-cover stage calls the same source loader before using each mask. Changing a mask changes the retained source edition and therefore the scenario inputs.

## Exact grid contract

A raster mask has one numeric band. Its width, height, affine transform and parsed coordinate reference system must equal the prepared model grid. The implementation rejects a different grid instead of silently aligning it. Preserve the grid's exact affine coefficients when writing an allocation mask; use the grid's original dimensions and CRS.

Every valid cell must be either zero or one. A valid one selects that cell; zero and nodata do not. A value marked invalid by the source's nodata or GDAL mask is excluded even if its stored numeric value is one. Valid NaN, infinity and values outside zero or one are rejected. Numeric integer and floating-point zero/one masks are supported; byte output is appropriate for study allocations.

Raster masks always use band 1. Omit `layer` and `where`, which remain vector selectors. The source's storage and provenance must carry any GDAL mask companions on which validity depends; using an explicit nodata value or internal mask makes the binary mask self-contained.

## Patch behavior

Each patch applies `from_codes` to the land-cover values at that point in the declared patch order, then changes selected cells to `to_code`. A later patch therefore sees changes made by an earlier patch. The destination code must have a row in the selected biophysical table. Original land-cover nodata remains nodata.

The implementation continues returning each patch's index, changed-cell count, changed hectares and original patch record. It writes the same ordinary land-cover artifact and stage metadata, so native NDR/SDR execution, comparison summaries, land-cover workspace views and full regional delivery consume the result through their existing interfaces.

## Regional execution

Masks are opened once with `ExitStack` and closed when the scenario finishes or raises. Processing follows the destination raster's existing block windows. A shared raster mask is read once per output window even when several patches select it. This keeps memory proportional to the current window and patch set.

Polygon masks keep their existing geometry transformation and rasterization path. Raster masks avoid polygon extraction, geometry union and repeated source reads for large pixel allocations. Neither path changes the model grid or automatically reprojects raster selections.

Root's published-study programme can write the changed cells selected by the official InVEST Scenario Generator as ordinary binary rasters, retain those files, and use these patches directly. Percent-slope eligibility masks follow the same contract. Preserve the allocation's original parameters and selected-pixel/area accounting in the source provenance; this module applies the supplied selection without changing its quota or ranking method.

## Source composition

This change extends the current regional `model/rasters.py` edition whose SHA256 is `7b948d9f8f0cd42e3c7e8c7c36ba80c8e4a3901598b3fbe6bcf642ab9d7725e9`. It preserves the native-resolution and stored-CRS fixes in that edition. Two small companion changes allow raster sources in `Workspace.save_scenario` and describe the accepted mask types in scenario validation.

The native completed-run reuse hooks, selected-model support, grid restart and `combine_runs` method are composed independently into the current Workspace body. The final source packet includes full postimages and the exact retained predecessor identities.
