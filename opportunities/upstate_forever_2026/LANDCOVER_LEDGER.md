# Native land-cover change ledger

Version 1.1.1 · ASTRA-LAND12 · Ecosystem Sciences sprint, 12 October 2026

This is a read-only accounting and reporting consumer for **existing categorical land-cover rasters and watershed polygons**. It takes a selected baseline and all selected alternatives through fractional-area transitions, common-coverage accounting, spatial exports, an offline operator report and complete portable receiving. It does not write scenarios or substitute a scientific model.

The original Upper Savannah Python Workspace, native InVEST 3.20 run history, original source refresh and scenario writers remain the integration owners. This package includes both a concrete file-level consumer and an extension for the original Workspace/operator. It registers no second Workspace, queue or web server. Its complete source belongs in the internal Ecosystem Sciences Slack project.

## Install into the maintained application

From this unpacked source directory:

```sh
python install_landcover.py /absolute/path/to/upstate_forever_2026
```

The installer adds eleven namespaced runtime/guide files, including the shared-host descriptor and client assets. It leaves `model/__init__.py`, the native server, scenario writer, source refresh, other modules and tests untouched. Identical existing files are reused. Exact authored 1.0.0 predecessors can be upgraded; their original SHA-256 values are enumerated in the installer. Other differing files are reported before writes. Complete temporary source files are atomically published, and repeated installation fills missing files. The target must be an existing original application containing `model/`.

Alternatively run directly from this source directory with its `model` namespace package. Use the existing GIS interpreter. Dependencies are NumPy, Rasterio, Shapely 2 and pyproj; `requirements-landcover.txt` contains compatible ranges, not a directive to replace an existing environment. The executed environment used Python 3.13, Rasterio 1.5, Shapely 2.1.2 and pyproj 3.7.2. Linux file locking is used for one writer per output edition.

## Native Workspace and shared operator extension

The primary application join is now `model.landcover_workspace.build(workspace, selection)`.
It uses the original `Workspace.inspect_run`, `get_grid`, `_get`, `source_file` and
`model.common.verify_file` contracts. The land-cover operand is the run's retained
`stages.landcover.artifact`; a baseline or coefficient-only scenario uses the
original `grid.files.NLCD`. A completed land-cover stage can be accounted before
pollutant modeling finishes, because this operation does not consume NDR/SDR output.
A land-cover scenario without that retained stage returns its actual missing-input error.

The original `OriginalEsriFeatures` reader handles retained Esri JSON/gzip sources;
other original polygon formats use Fiona. Original CRS, HUC strings, properties,
feature IDs, geometry and Esri geometry-operation metadata are retained. Selected
HUC IDs and property names are explicit. No hierarchy, utility label or watershed
assignment is inferred from a display title.

```python
from model.landcover_workspace import build, inspect, verify_all
edition = build(workspace, {
    "title": "Selected land-cover alternatives",
    "baseline_run_id": actual_baseline_run_id,
    "alternative_run_ids": actual_alternative_run_ids,
    "zones": {
        "source_collection_id": actual_source_collection_id,
        "source_id": actual_retained_watershed_source_id,
        "id_field": "huc12", "name_field": "name"
    },
    "options": {"support_scope": "all", "tile_size": 512}
})
reopened = inspect(workspace, edition["id"])
```

A native edition lives in `landcover-ledgers/<binding-id>/`. The binding retains
original run/scenario/grid/source identities and the actual reducer/adapter source
hashes. `edition.json` appears only after complete result and portable export creation.
Repeated original queue execution resumes committed windows or verifies and reuses
a complete edition. No original run or source record is modified. Complete workspace
receiving verifies relative source references with `verify_all`; a completed report
ZIP also remains separately portable.

`operator/extensions/landcover-ledger.json` follows the inspected
`upstate.operator-extension/v1` descriptor. It declares one original queued action,
`landcover.ledger.build`; read routes `/api/landcover-ledger/catalog` and
`/api/landcover-ledger/edition`; native state/download/receiving hooks; and the
`attachLandcoverLedger` client factory. The source contracts were read from private
Commons `4f96ddbf0c7bf1f5709a8f9b4320c433ebd80fef` (Workspace, native run, Esri reader)
and `f293e68f7f490346280419ae447748ef95ec76a3` (shared descriptor and operator bridge).
Installation uses the existing ECSA extension host rather than editing its server.

The interactive preview uses ECSA's typed retained-file successor, complete source
`F0C8TKYRX52`, registry SHA-256
`ae573df9f2ad99307f34b8638ffe430b215670caecf6ad8bd669859918acfe5e`.
Receive that current host before loading the 1.1.1 descriptor. The declared file
route `/api/file/landcover-ledger/{workspace_key}/{edition_id}` returns the original
verified report ticket plus its Content-Security-Policy. The host retains original
file-cookie authorization and `send_file`; no HTML is serialized through a JSON
route or re-created from a source path supplied by a caller. Script/style allowances
are hashes of the exact retained UTF-8 blocks; network, forms, objects and parent
DOM access stay disabled. The sandbox permits report controls, explicit downloads
and printing. CSP hash semantics follow https://www.w3.org/TR/CSP/ .

The edition JSON reader now returns `preview_url` instead of duplicate `document`
HTML. The browser opens that relative route in its existing sandbox. Newly built
1.1.1 reports recognize embedded mode and expose loaded JSON; complete companion
files remain in the original task downloads and portable ZIP. Previously retained
1.1.0 report files remain unchanged and should use their complete offline package
for companion links; they still have their verified original downloads.

The operator panel retains drafts by workspace and source identity, not changing
catalog positions. It reuses the original operation ID after a lost response,
observes the original tasks, resumes through `/api/task/resume`, and opens saved
reports in a sandboxed child document. Listener cancellation prevents duplicate
submits on remount. Original task download tickets carry the complete ZIP and every
retained GIS/CSV/report file. Embedded reports expose their loaded JSON rather than
incorrect relative links; the complete offline ZIP exposes its matching companions.

## Select original input files

For an existing file-layout workspace:

```sh
python -B -m model.landcover_cli run \
  --workspace /absolute/native/workspace \
  --scenario 'retained-scenario-id=/absolute/native/scenario/landcover.tif' \
  --output /absolute/new/landcover-ledger-edition
```

This explicit layout uses `rasters/landcover.tif` and `huc12.geojson` inside that workspace. Existing `run_manifest.json`, `grid.json` and `scenario_set.json` are hashed as context, never rewritten or reinterpreted. Resolve each completed scenario path through the **original writer**. Repeat `--scenario` for all alternatives that should share a comparison population. Preserve original scenario identifiers as names.

For any other maintained layout, pass the actual files directly:

```sh
python -B -m model.landcover_cli run \
  --baseline /absolute/original/baseline.tif \
  --zones /absolute/original/huc12.geojson \
  --scenario 'scenario-A=/absolute/original/scenario-A.tif' \
  --scenario 'scenario-B=/absolute/original/scenario-B.tif' \
  --context /absolute/original/source-manifest.json \
  --id-field huc12 --name-field name \
  --output /absolute/new/landcover-ledger-edition
```

The default band is 1. Use `--baseline-band` and named `--scenario-band NAME=BAND` selections for multiband files. Default GeoJSON fields are `huc12` and `name`; other original property names can be selected explicitly. HUC identifiers must be strings so leading zeros survive. GeoJSON defaults to WGS84 unless its CRS is declared or `--zone-crs` supplies the source CRS. Geometries must be valid nonempty polygons or multipolygons. Holes are preserved.

The baseline and every scenario must have identical CRS, affine transform, width and height. No implicit alignment or resampling is performed. Integer categorical bands are required. Analysis defaults to an equal-area projection, including the original EPSG:5070 grid. `--allow-projected-area` permits another projected grid but explicitly labels results as projected planar area; it does not make that projection equal-area. Longitude/latitude pixel areas are not accepted.

## Call from the original queue

```python
from pathlib import Path
from model.landcover_ledger import Options, RasterInput, run_ledger
from model.landcover_exports import export_report

result = run_ledger(
    RasterInput(baseline_path),
    {original_scenario_id: RasterInput(scenario_path)},
    original_huc_geojson,
    new_output_directory,
    options=Options(support_scope="all", tile_size=512),
    context_files=[original_source_manifest],
    progress=lambda event: existing_queue_progress(event),
)
export_report(new_output_directory)
```

Use the existing operator queue for this call. The result schema is `upstate.landcover-ledger/1`; the edition signature binds original byte hashes, bands, polygon interpretation, scenario order and options. `run_native_workspace(workspace, scenario_rasters, output, **kwargs)` supplies the explicit layout above. `export_report` is separate so the native receiver can retain the computed ledger before formatting its output.

The callback runs **after a committed window** and receives signature, state, completed_tiles and total_tiles. Raising `KeyboardInterrupt` or a queue cancellation exception stops work while preserving committed tiles. CLI progress is JSON on stderr; its final output inventory is JSON on stdout. The adapter returns the complete dictionary for existing consumers; all original input identifiers remain in the selected context manifests and input inventory.

## Measurement and comparison rules

For each zone and native pixel, area weight is the polygon–pixel intersection divided by pixel area. Interior pixels use rasterization; boundary pixels and adjacent cells use geometric intersections, including slivers, coincident boundaries and holes. The reducer checks conservation against the complete polygon area inside the grid. Exact geometric clipping is implemented in floating-point GEOS; subpixel class identity is still attributed from the original raster cell, not observed at finer resolution.

`cell_ha = abs(a*e - b*d) * linear_unit_to_m**2 / 10000` for the affine grid. A transition's hectares sum `cell_ha * polygon_fraction` on the selected supported cells. The implementation uses [Rasterio's native window API](https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html). Classes follow the [official MRLC NLCD legend](https://www.mrlc.gov/data/legends/national-land-cover-database-class-legend-and-description). Class groups retain separate forest, wetland, developed, crop, pasture, water, shrub and herbaceous accounting; barren and ice/snow remain in the complete class transition table.

The default `--support all` uses the intersection of valid, supported NLCD cells across the baseline **and every selected alternative**. A baseline-versus-A pair therefore uses the same land population as baseline-versus-B. `--support pair` instead uses each pair's own common cells and visibly labels that choice. Do not compare pair-specific percentages as if their populations were identical.

Each row exposes baseline/scenario raster-valid area, recognized-class area, pair-common area, analysis area, one-sided coverage, neither-supported area, unknown-class area, and area excluded by other scenarios. Unknown valid categories stop the default run. `--unknown-policy exclude` quantifies them and removes them from the analysis population. Finite measured zero is retained. With no analyzed cells, change, unchanged and class-group quantities are null; missing data does not become a zero-change finding.

Inside-grid, outside-grid and full polygon areas are retained separately. Overlapping reporting polygons are rejected by default. `--allow-overlap` permits them while computing the domain from their **unique union**. Individual overlapping rows are then nonadditive. Intersecting-cell counts count any positive-area touches, so a pixel crossing watershed borders can appear in both counts; hectares, not touched-cell counts, are the additive measure.

## Output edition

- `ledger.json`: complete quantities, coverage, source hashes, original identifiers, interpretation and a separate simplified display geometry.
- `watersheds.geojson`: full unsimplified reporting geometries in WGS84.
- `transition-<name-and-hash>.tif`: one native uint16 raster per alternative, code `baseline_code * 100 + scenario_code`; 0 means outside the selected domain/support.
- `study-area-fraction.tif`: unique domain intersection fraction in each original pixel. Multiply this by the reported cell hectares when integrating the transition raster.
- `watershed-summary.csv`, `transitions.csv`, `landcover-groups.csv`, `coverage.csv`, `unknown-classes.csv`, `zone-extent.csv`: full populations, not truncated previews.
- `report.html`: self-contained grayscale browser report with scenario and metric selection, clickable watersheds, filtering, transitions, coverage, source inventory and file exports.
- `export-manifest.json`: file lengths and SHA-256 values.
- `ledger.sqlite3`, `status.json`, `.writer.lock`: execution checkpoint and progress. These stay on the producing host and are not report-transfer members.

Open `report.html` in the received report folder to use all companion downloads. Selecting a different `ledger.json` reopens its quantities in the report; only that loaded JSON is then downloadable from the view, avoiding links to companions from the previous edition. The complete portable ZIP carries the new edition's matching rasters, CSV and geometry files. Printing uses the current selected scenario/zone and visible filter; CSV exports retain every row.

These quantities describe categorical land-cover change, not runoff, pollutant reduction, temperature, costs or conservation benefit. The existing InVEST and downstream decision engines supply those separate scientific and economic quantities.

## Resume, transfer and reopen

Rerun the identical command with `--resume` and the same output directory. Each tile's aggregate is committed only after its raster writes close; uncommitted tiles are recalculated and overwritten deterministically. Input and GDAL companion hashes are rechecked. A changed input, changed option, missing checkpoint raster or another active writer produces a concrete error rather than mixing editions. Keep original inputs and checkpoint outputs unchanged when resuming. Different scenario populations or options belong in a new output directory.

```sh
python -B -m model.landcover_cli report /complete/ledger
python -B -m model.landcover_cli pack /complete/ledger /exports/landcover-ledger.zip
python -B -m model.landcover_cli receive /exports/landcover-ledger.zip /new/received-ledger
```

Receiving is create-only. It checks member inventory, safe paths, lengths, hashes, schema and edition identity before copying verified files to the reserved destination. The received edition opens offline and can regenerate its report from retained JSON. Recomputing new scenarios still requires the original scientific input files; the report archive deliberately does not duplicate national source rasters or replace the native full-Workspace archive.

## Executed conformance and integration status

Four focused reducer journeys exercise independent brute-force pixel intersection, rotated cells/slivers/holes, all-scenario versus paired coverage, unique overlapping domain totals, interrupted-window resume, tile-size equivalence, exact transition raster values, source-change refusal and complete ZIP receiving. Run with:

```sh
python -B -m unittest discover -s tests -v
```

A fifth source-contract journey exercises original retained run/grid resolution, Fiona watershed conversion, interrupted native-adapter continuation, complete edition reopening, actual authored operator action/download hooks, unchanged original run records, full-directory receiving and changed-source refusal. Its Workspace/common fixture follows the inspected original interface; it is not an installed native scientific engine.

These journeys use explicitly constructed categorical cells to check implementation arithmetic; they are not Upper Savannah watershed results. Original regional baseline/scenario inputs are produced by the source and model owners. Their full 217-HUC run remains the native integration acceptance population. Browser navigation in this container returned `ERR_BLOCKED_BY_ADMINISTRATOR`; report source and JavaScript syntax can be checked here, while the original operator host performs the visible browser journey. The original source/scenario writers remain unchanged; native operator integration is supplied as the additive shared-host descriptor and adapters. Full original-host composition and regional source execution use the receiving integration owner’s environment.
