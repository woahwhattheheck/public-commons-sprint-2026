# Upper Savannah scientific operator

TokenJunkieLabs · maintained decision, source and native-model workflows

The modules in this directory extend the original Upper Savannah scientific application. They join source preparation, native-run work, saved scenario assessments, model programmes and source-bound water designations through the same Workspace, authenticated operator and task queue.

Needs expert review: environmental model interpretation and regulatory source applicability. The application preserves the selected inputs, physical units, geography and decision settings needed for that review.

Source preparation, annual-load calibration and operator extensions for the maintained Upper Savannah watershed application, authored by TokenJunkieLabs. The tools preserve the selected original inputs, native model runs and saved Workspace throughout acquisition, analysis and operator use.

The public source directory also includes the maintained [native compute programmes](PROGRAMMES.md), [conservation analysis](model/CONSERVATION.md), [receiving-water analysis](model/RECEIVING_WATERS.md), [receptor experiments](model/RECEPTOR_EXPERIMENTS.md) and [operator extension framework](operator/EXTENSIONS.md). Adopt these components into the complete maintained native application so they use its current Workspace, source selections, task queue and portable delivery.

## Work with retained model results

The Scenario decisions desk opens original completed runs, native paired comparisons and retained common-mask watershed reports. Nitrogen and phosphorus remain in kg/year; sediment remains in metric tonnes/year. Direction, priority weights, selected cases and reporting geography are explicit. Saving keeps the full physical comparison, original source snapshot, methods and revision parent.

Large assessments use resumable authenticated transfers within the original operator's request ceiling. The browser renders one table page while filtering and sorting the full cohort. JSON, CSV and text exports retain every computed row. Repeated workspace-state reads use compact derived saved-view summaries; opening and receiving a view verifies the original immutable record.

See [Scenario decisions](operator/SCENARIO_DECISIONS.md), the [component contract](operator/SCENARIO_DECISIONS_COMPONENT.md), and [performance notes](operator/SCENARIO_DECISIONS_PERFORMANCE.md).

## Install in the complete application

Compose these maintained source paths with the current complete Upper Savannah application and its original model/common.py, model/workspace.py, operator/server.py and operator/web/app.mjs. Keep the source-preparation and native-run component modules with their descriptors. The complete application receiver assembles these original dependencies and the current desk contributions together.

Run the shared installer against that actual application directory:

    python3 -B install_extensions.py --application /path/to/complete-application

For a source package held separately, add --source-root /path/to/current-source. The installer composes the original server/browser hooks, registered source roots, file tickets, task actions and workspace lifecycle. The [extension guide](operator/EXTENSIONS.md) documents full provider and browser contracts, typed report previews and nested GIS project members.

Use the original server with the scientific workspace:

    python3 -B operator/server.py --workspace /path/to/scientific-workspace

Open the operator_url returned by that server. The native model workflow retains the application's selected InVEST 3.20.0 NDR/SDR stages, source coefficients, grid and run identities. Existing complete workspaces can be transferred through their normal portable archive and receiving workflow.

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

## Effective water-designation workflow

The designation adapter consumes the original source crosswalk, declared rule edition and exact native geometry. It can import its selected source into the original Workspace, create a retained water-desk selection and pass that actual overlay into the original delivery operation. Effective classifications, source metadata and proposal context remain separately represented.

Use the original crosswalk builder's returned result with --crosswalk-result so its actual run directory and source-manifest identity are retained. Full commands, selection schema and source references are in [Water designation applicability](source_tools/WATER_DESIGNATION_APPLICABILITY.md).

## Focused development checks

The browser modules include focused checks for workspace-switch lifecycle and regional-cohort rendering/export behavior:

    node operator/web/extension_host.check.mjs
    node operator/web/scenario_decisions.performance.check.mjs

The receiving application exercises the original Python operator with its actual source imports, completed native results, saved assessments and portable restore. Verification notes in each guide distinguish the executed component checks from the receiving operation.

## Original sources and scientific references

- [USGS 3DEP elevation service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [Esri image export contract](https://developers.arcgis.com/rest/services-reference/enterprise/export-image/)
- [PRISM climate normals](https://prism.oregonstate.edu/normals/)
- [InVEST freshwater calibration guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)
- [InVEST nutrient delivery ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST sediment delivery ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

Scientific interpretation — **Needs expert review**: confirm the selected observation qualification, catchment coverage, period comparability and fitted parameter ranges before using results for watershed decisions.

## License

Authored code uses the repository's [MIT license](../../LICENSE). Original environmental data, regulatory documents and external source material retain their publisher terms and attribution.
