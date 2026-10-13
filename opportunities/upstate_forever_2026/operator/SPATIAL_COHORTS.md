# Native measurements across original polygon collections

## Working in the operator

Open Spatial review, select the original primary raster and optional alternative, then open the native feature cohort controls within Region measurements. Choose a retained vector layer or an existing filtered overlay. The source remains the original Workspace vector, including its native layer and typed property filter.

Leave the feature ID list empty to process the whole selected collection. To select specific original features, enter one original reader feature ID per line. A parcel number or HUC attribute can be used as the display label by choosing its original field; it does not replace the original feature identity.

Set a title, optional notes, native cell inclusion and histogram bins, then queue the collection analysis. The operation uses the same native raster engine as an individual region measurement. Each valid polygon produces an ordinary saved region result, with its original vector feature binding, raster selections, band numbers, units and exact grid descriptions.

The completed table is paginated on the server. Search by original feature ID, label or status; sort by those identifiers or supported numeric measurements. Open any completed feature's original region result to inspect full statistics, exact histograms, category counts and its original JSON/CSV downloads. The collection itself provides its original manifest, a summary CSV, a category CSV and an original SQLite row table.

## Native computation

Every polygon is measured against original native raster windows. The calculation does not sample browser images or resample a raster. The original mask, NaN and infinity exclusions, band scales and offsets, population standard deviation, exact histogram counts and category frequencies are inherited directly from SpatialRegions.

For aligned continuous rasters with matching declared physical units, the paired calculation uses cells that are valid in both rasters and inside the original polygon selection. The reported difference is alternative minus baseline. Relative change divides the common-support difference sum by the common-support baseline sum; a zero or absent denominator produces an empty value. Independent primary and alternative summaries retain their own valid-cell counts.

Original polygons can overlap. Each is measured independently, so summing rows from overlapping catchments, utility boundaries or parcels would double count their shared cells. Native physical pixel-value sums are reported as such. The operation does not infer density-to-total conversions or reinterpret the scientific meaning of a source quantity. Projected grid cell area is retained in square metres; a geographic grid keeps exact cell counts without treating its cells as equal metric areas.

A feature with missing, empty, non-polygon or invalid original geometry is retained as an excluded row with a reason. An explicitly requested feature ID absent from the selected native layer and filter becomes a missing row. Those rows remain visible in the completed table and CSV. A calculation failure preserves earlier completed feature work for the original task's resume action.

## Resume and performance

The exact normalized request includes the scientific project, original vector selection and binding, explicit subset when present, label field, original raster bindings, band numbers, title, notes, histogram bins and cell inclusion. Its digest identifies the working ledger and operation lock.

The source vector is scanned once per pass. Original geometry is handed directly to the existing region engine through an internal resolved-feature adapter; the engine does not rescan the entire vector for each feature. The layer catalogue is resolved once, while original source reads retain their normal signature checks. The batch ledger also avoids scanning every previously saved region at every feature.

After each completed feature, the ordinary region manifest is retained and its table row is committed to the SQLite work ledger. On resume, existing original results are reopened and their complete normalized region requests checked against the selected feature before being reused. Remaining features continue through the same native calculation. The original task identity and source request remain unchanged.

The exact-request operation lock covers computation, original vector read completion and final manifest retention. A second worker waiting on the same request rechecks for a completed cohort after acquiring that lock. Completed artifacts live separately from the working ledger: an independent original SQLite row table and CSVs are bound by length and SHA256 to the retained cohort manifest.

Server row queries read this completed table in pages and use an allowlist of sort columns. Numeric values stay numeric and null values sort last. Original results are available even when no browser session is running. Progress snapshots are throttled in the operator while per-feature work is committed independently.

## Command line

Run from the installed application's actual scientific Python environment:

    python -m model.cohort_cli catalog ACTUAL_WORKSPACE --describe
    python -m model.cohort_cli analyze-source ACTUAL_WORKSPACE ORIGINAL_VECTOR_ID ORIGINAL_RASTER_ID --title "Original catchment measurements" --label-field ORIGINAL_FIELD --export OUTPUT_DIRECTORY
    python -m model.cohort_cli analyze-source ACTUAL_WORKSPACE ORIGINAL_VECTOR_ID ORIGINAL_BASELINE_ID --comparison ORIGINAL_ALTERNATIVE_ID --export OUTPUT_DIRECTORY
    python -m model.cohort_cli analyze ACTUAL_WORKSPACE COHORT_PLAN.json --export OUTPUT_DIRECTORY
    python -m model.cohort_cli inspect ACTUAL_WORKSPACE ORIGINAL_COHORT_ID --export OUTPUT_DIRECTORY
    python -m model.cohort_cli page ACTUAL_WORKSPACE ORIGINAL_COHORT_ID --sort paired_mean_difference --descending --limit 100

Use the actual layer IDs returned by the original Workspace catalogue. The optional label field must exist in the original vector schema. For a particular native layer within a multi-layer file, pass --vector-layer. Typed property filters can be supplied through --where with a JSON object. Repeat --feature-id to select specific original reader IDs, or put the complete subset in a JSON plan.

A plan uses the same structure as the native operator action:

    {
      "title": "Original catchment measurements",
      "notes": "",
      "source_selection": {
        "layer_id": "ACTUAL_RETAINED_VECTOR_LAYER_ID",
        "where": {}
      },
      "feature_ids": null,
      "label_field": null,
      "primary": {
        "layer_id": "ACTUAL_RETAINED_BASELINE_LAYER_ID",
        "band": 1
      },
      "comparison": null,
      "histogram_bins": 32,
      "all_touched": false
    }

The placeholders above must be replaced with actual retained IDs. A null feature_ids selects the whole original filtered collection; a null comparison requests independent primary measurements. To measure an alternative, supply its real layer_id and band in comparison.

Standard output contains the complete retained manifest, paginated result or catalogue. Progress and useful errors go to standard error. Use --quiet-progress for unattended runs that already capture task progress elsewhere. Exports stream the original files into the requested directory, preserve matching existing files and reject conflicting files before writing.

## API and retained rows

The native action is spatial.cohort.analyze. The backend-only extension adds:

- GET or POST /api/spatial/cohorts/catalog.
- GET or POST /api/spatial/cohorts/result with id, offset, limit, search, sort and descending.
- Original item kind spatial_cohorts.
- State key spatial_cohorts and task progress field cohort_progress.
- Original restore verification through the extension and portable scientific Workspace reader.

The result route returns the saved manifest plus rows, offset, limit, total and has_more. The total is the count matching the current search; feature_count in the manifest is the complete retained collection count. Status values are complete, excluded and missing.

Flat rows include original feature_id, label, status, reason and region_analysis_id. Each independent side uses primary_ or comparison_ fields for kind, units, selected_cells, valid_cells, minimum, maximum, mean, standard_deviation, sum_native_pixel_values and valid_grid_area_m2. Pair fields retain common valid cells, baseline-only and alternative-only valid counts, mean and summed difference, relative change and units. Categorical layers retain counts in categories.csv and the original per-feature region records; their continuous summary cells remain empty.

All completed source files and row artifacts belong to the original Workspace inventory and portable archive. Restore verifies the collection manifest, original source bindings, artifact bytes and every completed row's original feature reference.

## Application integration

Ship these new files with the existing region engine and merged direct region CLI:

- model/spatial_cohorts.py and model/cohort_cli.py.
- operator/spatial_cohort_operations.py.
- operator/extensions/spatial-cohorts.json.
- operator/web/spatial_cohorts.mjs and spatial_cohorts.css.
- The composed existing spatial_regions.mjs, spatial.mjs and model/portable.py.
- This guide.

The existing region panel imports the new cohort controller, and the backend descriptor declares its two browser assets. It does not introduce another navigation view. The shared spatial joins expose the current source/overlay catalogue and refresh the collection controls when that selection changes; original viewport, rectangle, polygon display and saved-analysis settings stay in their maintained paths.

For native receiving, compile/import the new Python modules in the actual application interpreter, restart the existing operator to discover the extension, and reload the browser. Select a real retained vector and native raster pair. Run the collection, reopen a per-feature result, resume an interrupted original task, export its completed files, and restore that original scientific Workspace with the full current application.
