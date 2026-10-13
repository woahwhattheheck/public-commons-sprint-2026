# Native region analysis

Region measurements is part of the existing Spatial review. It measures original retained raster cells selected by a visible extent, a drawn rectangle, or an original inspected polygon, then retains the calculation in the scientific Workspace.

## Operator workflow

1. Open Spatial review and choose the baseline raster. Select an alternative for a paired comparison.
2. Choose **Use visible extent**, select **Area** and drag a rectangle, or inspect an original vector polygon and choose **Measure this original polygon**.
3. Set an analysis title, cell inclusion rule, histogram bin count and any interpretation notes.
4. Choose **Calculate and save**. The existing workspace queue retains the complete selection. The operator can continue working while it runs.
5. Open the completed result to read independent layer statistics, exact histogram counts, category frequencies, and the comparison over cells valid in both original rasters.
6. Download the saved analysis JSON and CSV tables. **Reopen selected area** restores the original raster selections and geographic extent. Saved analyses remain searchable after restarting or restoring the Workspace.

The Area tool also uses the A keyboard shortcut. The visible-extent control provides a keyboard-accessible area selection. Existing pan, inspect, marker and map-export tools retain their behavior.

## Scientific behavior

The native SpatialReview object remains the source resolver. Its retained layer identities, band descriptions, file/companion verification, units and original comparison rules are reused directly. Native utility, source, grid, model-run, comparison and delivery layers registered with that object are eligible.

The calculation reads 512-by-512 windows at the original raster resolution. No display image, overview or resampled map value enters a statistic. The source dataset mask and nonfinite values are excluded; original band scale and offset are applied to valid stored values.

Continuous layers report valid count, minimum, maximum, mean, population standard deviation and sum of native physical pixel values. The sum has exactly that meaning: a density raster is not silently converted into a physical total. Projected grid area uses the absolute affine determinant and both native linear-unit conversion factors. It is labeled native projected grid area; geographic-grid cells retain counts without a false constant metric area.

Histograms use the exact observed minimum and maximum, followed by a second native-window pass. Every valid cell contributes to one bin. The last upper boundary is inclusive. Constant-valued regions retain a single bin with the constant value. Category layers retain their original physical category values and exact frequency counts instead of a mean over class identifiers.

Each layer reports selected cells within its original source footprint, valid cells, NoData/nonfinite cells, valid fraction and available grid area. Areas outside the raster footprint do not become artificial zero-valued cells.

Paired subtraction follows the original SpatialReview compatibility decision: aligned native dimensions, CRS and affine transform, matching declared physical units, and continuous data. It intersects both selected region masks with both original validity masks. The result reports baseline and alternative statistics on this shared support, alternative-minus-baseline statistics, exclusive valid-cell counts and relative change against the common baseline sum. A zero baseline or empty common support yields an undefined relative percentage.

Region coordinates retain their original CRS. Polygon edges are transformed adaptively with a maximum tested deviation of 0.05 native cells at quarter, midpoint and three-quarter positions; a projection discontinuity raises a useful selection error. This tolerance concerns polygon projection, not raster resampling. Same-CRS polygons retain their original coordinates.

For an inspected vector polygon, the request retains its original vector layer selection and feature identifier. The backend reopens that retained source, resolves the feature and original filters, and uses its original polygon. It does not substitute a simplified display geometry or trust browser geometry as the original source.

## Retained records and downloads

The original action is spatial.region.analyze. Its complete immutable request identity supports normal queue retries and restart recovery. Native progress is stored on the original task as region_progress.

Analysis records use Workspace._save("spatial-regions",...). They include the normalized region and source selections, original source bindings, algorithm identity, cell masks and inclusion rule, units, exact statistics and histogram bins. Identical completed requests reuse the saved calculation. The original workspace archive captures these records and all application source; restore validates their retained source bindings.

The extension owns the spatial_regions item and state key. It uses the installed registry, original HTTP handler, queue, workspace gates and file tickets:

- POST /api/actions, action spatial.region.analyze
- GET or POST /api/spatial/regions/catalog
- GET or POST /api/spatial/regions/result, with the saved analysis id
- GET /api/item?workspace=...&kind=spatial_regions&id=...

The result contains original _downloads tickets for the saved JSON, summary.csv, histograms.csv and categories.csv. CSVs are regenerated from the retained calculation if their local derived copies are absent or changed. The ordinary authenticated /api/file/:ticket?download=1 transport serves them.

## Installation

Install the complete files together:

- model/spatial_regions.py
- operator/spatial_region_operations.py
- operator/extensions/spatial-regions.json
- operator/web/spatial_regions.mjs
- operator/web/spatial_regions.css
- the composed operator/web/spatial.mjs
- the composed model/portable.py
- this guide

The descriptor is backend-only and explicitly lists its browser assets. Spatial review imports its region module directly. It does not register a second spatial menu or require a viewless client descriptor. Restart the existing operator to discover the descriptor and reload the browser.

The shared spatial and portable files retain all current owners' source. Their joins add the region panel, rectangle selection, original polygon action, saved-result reopening, lifecycle cleanup and archive receiving verification.

## Native receiving

Compile the two new Python files in the application's actual interpreter, import them beside the original SpatialReview, and let the existing operator discover the descriptor. Use an original retained Workspace with real native rasters and select an actual published/model result polygon or viewport. Open its complete result and the original CSV tickets. For a pair, use compatible original rasters and inspect the shared validity count; for land cover, inspect the original class frequencies.

The region JSON retains every calculation input needed to repeat the same operation. Original model/source owners remain responsible for the scientific meaning of the source quantities and native model parameters.

## Native command line

The same retained model is available without an operator HTTP session. Run from the installed application directory in its actual scientific Python environment:

    python -m model.region_cli catalog ACTUAL_WORKSPACE --describe
    python -m model.region_cli describe ACTUAL_WORKSPACE ORIGINAL_LAYER_ID
    python -m model.region_cli analyze-source ACTUAL_WORKSPACE ORIGINAL_LAYER_ID --title "Original regional result" --export OUTPUT_DIRECTORY
    python -m model.region_cli analyze-source ACTUAL_WORKSPACE ORIGINAL_LAYER_ID --comparison ORIGINAL_ALTERNATIVE_LAYER_ID --export OUTPUT_DIRECTORY
    python -m model.region_cli analyze ACTUAL_WORKSPACE REGION_PLAN.json --export OUTPUT_DIRECTORY
    python -m model.region_cli inspect ACTUAL_WORKSPACE SAVED_ANALYSIS_ID --export OUTPUT_DIRECTORY

The catalogue returns actual layer IDs, native units, grid descriptions and retained result identities. Full-source analysis obtains its extent and CRS from the selected original raster. JSON plans use the same primary, comparison, region, title, notes, histogram_bins and all_touched fields as the operator action; source_feature selections resolve the original retained polygon. Standard output is the complete result JSON; progress and useful errors go to standard error. The export directory receives the unchanged original analysis manifest and the three numeric CSV tables. Repeating an identical export reuses its existing exact bytes.
