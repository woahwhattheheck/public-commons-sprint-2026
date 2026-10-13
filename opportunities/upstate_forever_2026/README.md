# Upper Savannah watershed application extensions

Source preparation, annual-load calibration and operator extensions for the maintained Upper Savannah watershed application, authored by TokenJunkieLabs. The tools preserve the selected original inputs, native model runs and saved Workspace throughout acquisition, analysis and operator use.

The public source directory also includes the maintained [native compute programmes](PROGRAMMES.md), [conservation analysis](model/CONSERVATION.md), [receiving-water analysis](model/RECEIVING_WATERS.md), [receptor experiments](model/RECEPTOR_EXPERIMENTS.md) and [operator extension framework](operator/EXTENSIONS.md). Adopt these components into the complete maintained native application so they use its current Workspace, source selections, task queue and portable delivery.

## Terrain source preparation

The terrain package includes its native grid, geometry and transfer helpers. Planning and assembly use the application's GIS Python environment with NumPy, Rasterio, Fiona, pyproj and Shapely. A network worker can receive the saved requests with Python's standard library.

The [terrain operating guide](source_tools/DEM_WORKFLOW.md) covers selection, planning, progress, recovery, assembly and source import. The [transfer guide](source_tools/DEM_TRANSFER.md) covers the same source selection across existing network and GIS workers.

| Phase | Command | Result |
| --- | --- | --- |
| Plan on the GIS worker | python -B -m source_tools.raster_sources dem-plan | The selected grid, original metadata and disjoint requests |
| Receive on the network worker | python -B -m source_tools.dem_transfer receive | Original elevation bodies and their complete HTTP receipts |
| Inspect the received files | python -B -m source_tools.raster_sources dem-status --verify | Original hashes, TIFF dimensions, CRS and cell placement |
| Assemble on the GIS worker | python -B -m source_tools.raster_sources dem-assemble | The elevation mosaic and importable source entry |

Each command accepts --help for its complete arguments. The guides use the actual selected reference raster, full upstream model domain, service metadata and retained source directories.

Acquisition reports completed tiles, retained bytes and elapsed time. Continuing the same directory reuses completed original captures. Assembly copies their numeric cells into the planned grid and retains missing-data information. The original one-command dem and precipitation preparation interfaces remain available.

## Original USGS annual-load references

The [USGS release contract guide](source_tools/USGS_CONTRACT.md) binds the original P13YSTHM seasonal nitrogen and phosphorus release to the existing annual-load preparation pipeline. The [release recipe](source/usgs-seasonal-loads-20261012/contract-recipe.json) and original metadata attachment retain the publisher's archive identity, native member names and source locations.

The [original archive receiver](source_tools/USGS_ARCHIVE.md) receives the publisher's complete retained ZIP or exact members through its signed download URL. It uses the same GET method for its one-byte range bootstrap and subsequent conditional requests, preserving the original archive total and entity identity. Use `python -B -m source_tools.usgs_archive inspect --help` to inspect the original member inventory, then receive the selected dictionary, station, seasonal and model-review tables into the same intake directory.

Run `python -B -m source_tools.usgs_contract inspect --help` for original-member inspection and `python -B -m source_tools.usgs_contract compile --help` for compilation from the resulting binding. The complete guide supplies the receiving, field-selection, review-join and annualization commands.

The compiler reads the actual ten-column data dictionary, resolves native variable definitions and unit meanings, joins model-review records without multiplying source rows, and preserves every original record. Its source contract feeds the existing station qualification and annualization tools. Import the resulting annual observations and catchment source manifest into the Workspace used by the original baseline runs.

## Calibration in the existing application

Calibration selects among actual completed native baseline runs using retained annual-load observations and their original catchments. It joins the scientific Workspace and the existing operator's queued tasks, run history, source selections, downloads and portable receiving.

Candidate runs may contain NDR, SDR or both models. The declared positive-weight objectives use pollutant outputs shared by every selected run and the admitted annual references. Saved comparisons retain each original run's model scope and distinguish native run variants from distinct parameter profiles.

The [scientific guide](model/CALIBRATION.md) explains source selection, period aggregation, spatial grouping, parameter objectives and result interpretation. The [operator guide](operator/CALIBRATION.md) gives installation, the full browser journey and the command-line workflow.

Place this calibration source cohort alongside the complete maintained application, then run:

    python -B operator/install_calibration.py \
      --application "$UPSTATE_APPLICATION" \
      --source "$UPSTATE_CALIBRATION_SOURCE"

Set both variables to the actual application and complete calibration-source directories. The source cohort contains `model/`, `operator/` and `source_tools/`. The application supplies the maintained `install_extensions.py`, `operator/extension_registry.py` and `operator/web/extension_host.mjs`.

The calibration installer uses that shared extension framework to register the calibration descriptor, queued actions, state and browser view. It preserves the other installed extensions and migrates its known earlier calibration registrations into the maintained host. Installation retains the original shared files and records the exact resulting source.

In the running application, open **Calibration and validation**. Select compatible completed baseline runs, the retained annual-reference edition and its catchment source. Preview the actual catchments and spatial groups, assign complete groups to calibration or validation, save the selection, and analyze it through the normal task queue.

The result provides:

- The ranked native parameter candidates and selected working profile.
- Separate held-out evaluation using the selected profile.
- Physical-unit residuals, RMSE, bias and Nash–Sutcliffe efficiency.
- Per-catchment predictions and the range across calibration-Pareto candidates.
- Leave-one-calibration-group-out selection stability.
- Original source methods, periods, exclusions and native coverage.
- CSV, HTML and complete source-bound exports that stay with the saved Workspace.

The normalization and parameter ranking use only the declared calibration groups. Shared upstream land and repeated stations stay in the same spatial group. Complete annual periods receive equal yearly weight, including leap years; other source annualization periods have an explicit elapsed-day option.

For the command-line workflow, run from the complete application:

    python -B -m model.calibration --workspace "$UPSTATE_WORKSPACE" catalog
    python -B -m model.calibration --workspace "$UPSTATE_WORKSPACE" preview selection.json
    python -B -m model.calibration --workspace "$UPSTATE_WORKSPACE" prepare selection.json
    python -B -m model.calibration --workspace "$UPSTATE_WORKSPACE" analyze "$UPSTATE_CALIBRATION_PLAN"

Use the returned real plan identifier for analysis. The saved plan retains the candidate run IDs, observation edition, catchment selection and declared evaluation design.

## Adopt into the cumulative application

The files follow the maintained application paths. For terrain, apply source_tools/raster_sources.py, add source_tools/dem_transfer.py and the guides, and retain the application's current model/rasters.py and Workspace.prepare_grid. The included model helpers support standalone terrain use; compose any newer native application edits directly.

For calibration, install the complete model and operator cohort together. The extension uses the full maintained scientific application and the shared registry. The existing Workspace archive retains calibration plans, analyses and results.

To receive one complete application from the existing source packages, use `source_tools/calibration_assembly.py` with the current `source_tools/application_assembly.py`. The [complete receiving command](operator/CALIBRATION.md#assemble-the-complete-receiving-edition) selects the retained base, current local application, terrain/transfer/USGS overlays, scientific calibration and operator calibration. The driver composes the current extension registrations before creating the final source map, application directory and ZIP.

The portable Workspace inventory includes the maintained shared, experiment and terrain installers, the original source receiver, terrain requirements and source manifest, and receiving guides. This keeps the restored application’s documented installation and receiving commands available.

The current application is captured through the maintained assembler's `snapshot_application` API. Root installers, existing application modules and original external-file records travel with that source. The new receiving edition opens the same scientific Workspace; its directory, source map and ZIP all contain the registered application.

The terrain delivery is source-entry.json, its original GeoTIFF and declared companions. Select that entry in the existing source composer and import the complete source manifest into the Workspace. Keep the reporting boundary separate from the upstream contributing model domain.

## Original sources and scientific references

- [USGS 3DEP elevation service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Esri image export contract](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)
- [PRISM climate normals](https://prism.oregonstate.edu/normals/)
- [InVEST freshwater calibration guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)
- [InVEST nutrient delivery ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST sediment delivery ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

Scientific interpretation — **Needs expert review**: confirm the selected observation qualification, catchment coverage, period comparability and fitted parameter ranges before using results for watershed decisions.

Original providers' source attribution and terms remain with the selected input files. The code is covered by the repository MIT license.
