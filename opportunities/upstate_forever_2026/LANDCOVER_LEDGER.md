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

## Compare annual raster source editions

The Land-cover changes desk supports an annual source comparison directly from
the current Workspace. Choose **Annual raster source editions**, select an
original reference raster and one or more comparison rasters, and keep the
original categorical band for each. Each choice shows its retained title,
vintage and role. The source details also expose exact entry IDs and raster
SHA-256 values. Select actual NLCD class rasters; other integer scientific
rasters can have a different coding system.

Choose the original reporting polygons and their actual identifier and name
fields. Original HUC values remain strings. The maintained Esri/Fiona reader
retains the source CRS, attributes and feature identities; the existing ledger
transforms polygon geometry into the selected raster's native CRS. Equal-area
hectares are required by default. The explicit **Allow projected planar hectares**
option also supports retained projected grids such as an existing EPSG:26917
demonstration. This uses the reducer's original projected-planar area method;
its preview and report label the resulting area basis. It does not reproject
or resample the rasters.
It reads the rasters on their original lattice. The same width, height, CRS and
affine transform are required for all selected operands. No resampling or
modeled run is created by this mode.

**Check selected inputs** verifies the retained source bytes and companions,
integer band existence, common native lattice and area basis, and reporting identifiers.
**Build land-cover ledger** performs the actual polygon intersections,
NLCD-class validation, valid-data coverage and transitions through the original
queued action. Different source masks remain distinct. Keep **Across every
selected alternative** for a common comparison cohort, or explicitly choose
pair-specific support. Unknown classes stop the calculation by default; the
explicit exclusion option quantifies their omitted area. Overlapping reporting
polygons require the existing overlap option and retain the unique union total.

A completed edition opens its original report and exposes native downloads for
the portable ZIP, source bindings, CSV tables, complete geographic outputs and
derived rasters. The saved input details retain exact collection/source/band
references. Drafts and accepted tasks remain associated with their original
Workspace across desk return; a late response cannot replace an edited draft or
another Workspace. A failed native task can resume its original committed ledger
windows.

The model selection contract is:

```json
{
  "input_mode": "sources",
  "title": "Annual NLCD source comparison",
  "baseline_source": {
    "source_collection_id": "<original collection ID>",
    "source_id": "<original reference raster entry>",
    "band": 1
  },
  "alternative_sources": [
    {
      "source_collection_id": "<original collection ID>",
      "source_id": "<original comparison raster entry>",
      "band": 1
    }
  ],
  "zones": {
    "source_collection_id": "<original collection ID>",
    "source_id": "<original polygon entry>",
    "id_field": "huc12",
    "name_field": "name"
  },
  "options": {
    "support_scope": "all",
    "unknown_policy": "error",
    "allow_overlap": false
  }
}
```

Use actual retained IDs from the catalog. Reference and comparison describe the
chosen operand order, not a guessed chronology. Source titles and vintages stay
as published or supplied. An observed class difference does not by itself
identify its cause or the date of a land-management event.

### Retained identity and restoration

The source mode uses upstate.landcover-source-binding/v1. It stores the exact
original source entries and companions, selected bands, header/mask metadata,
stable source-view member names, native grid and complete reporting-source
binding. Source comparisons have a null grid_id because they read source
rasters directly; the native grid definition is retained in their binding.
Existing run-mode selections and saved upstate.landcover-binding/v1 editions
continue to use their original run and grid IDs.

Opening a completed source edition recreates verified source views from the
immutable original objects and checks their native headers and dependency
membership. Equivalent CRS serialization across PROJ versions is accepted while
the original display metadata remains retained; grid, band and mask meaning
must still agree. Every report artifact is hash verified. Complete report ZIPs
contain calculated outputs and bindings; use the original Workspace backup to
retain editable original raster and vector source bytes and application code.

An interrupted calculation resumes only against its existing source paths and
original reducer signature. Moving the entire Workspace after a completed run
supports verified reopen. Moving an unfinished reducer checkpoint changes its
absolute-path execution signature, so it must finish on its original native
operation before an editable project is moved.

### Install the complete comparison mode

Publish the adapter, desk, exports, native CLI and original installer together.
The maintained install_landcover.py retains the new source helper and additive
integration/component_fragments/landcover-source-inputs.json declaration,
accepts only the exact known predecessor bodies, and merges the single input
preview route into the current Team policy without replacing peer routes.
The registered queued build remains the existing analyst action; the input
preview is a workspace-authorized read.

### Read an original source comparison offline

A source comparison keeps the original reference edition and each selected comparison edition in their original order. The offline report's Comparison edition selector uses the retained source title and source time; choosing another edition updates the displayed reference/comparison pair, watershed quantities and matching transition-raster download together. The source panel retains each source collection and entry, band, original CRS, units, URI and exact raster byte count and SHA-256.

The complete portable report includes source-editions.csv and input-editions.json alongside the existing hectare/transition/coverage CSV files, complete watershed geometry, original calculation JSON and derived rasters. The CSV is a readable source index. input-editions.json carries the same complete binding hashed into the actual calculation, including original raster and reporting-geometry records. Normal archive receiving verifies these companions through its existing complete member inventory. Opening a different ledger JSON in the standalone viewer keeps its companion downloads associated with that ledger's own portable package.

All source comparisons retain the maintained fractional polygon/pixel area calculation and selected common-valid-data support. Published or simulated categorical input editions retain their own original labels; a class difference alone does not identify the cause or date of a land-management event. Existing run-based comparisons keep their original scenario selectors and exports.


## Native Workspace commands and portable reopening

The original land-cover CLI now accepts an existing retained Workspace directly.
The file-level `run`, `report`, `pack` and `receive` commands retain their original
arguments and behavior.

Run these commands from the installed application directory with the existing GIS
Python. The catalog supplies exact imported collection/source identifiers and
existing run identifiers; use those values in the original JSON selection.

```sh
python -B -m model.landcover_cli workspace --workspace /original/workspace catalog --result /receiving/landcover-catalog.json
python -B -m model.landcover_cli workspace --workspace /original/workspace preview --selection /receiving/annual-selection.json --result /receiving/landcover-preview.json
python -B -m model.landcover_cli workspace --workspace /original/workspace build --selection /receiving/annual-selection.json --receive-report /receiving/annual-report --archive /receiving/annual-workspace.zip --restore /receiving/annual-reopened --result /receiving/annual-operation.json
```

`preview` verifies the original raster bytes, retained companions, integer band,
equal-area grid compatibility, reporting source and selected original polygon
identifiers. The actual build computes the fractional polygon overlap and valid
NLCD class support. It produces the complete original CSV, GIS raster, geometry,
HTML and report ZIP, then reopens the original saved edition.

Optional `--receive-report` receives that exact report ZIP and compares its full
computed ledger and annual-source binding with the original. The paired
`--archive`/`--restore` options use the maintained full Workspace archive and
restore APIs, retain the original project, and inspect the completed edition
against the restored original source objects. The restored binding and report
must equal the producing edition; input source views are reconstructed by the
original Workspace reader. The same GIS interpreter then executes the restored
application’s own `model.landcover_cli workspace ... inspect` command, with no
model execution or recursive archive options. Its saved edition, binding, signature
and source-edition interpretation must match; the operation records the actual
process status and stderr. Archive, result and receiving destinations remain
outside the original Workspace and its ancestor directories, and separate from one another. The result JSON also remains separate from the input selection JSON.

The command returns complete JSON and optionally writes it to `--result`.
Its `edition` contains original file descriptors; `report_archive` identifies the
complete report ZIP, and the optional receiving fields identify the actual report
directory, Workspace ZIP and restored project. Progress from committed reducer
windows is emitted on stderr. Subsequent `workspace inspect EDITION_ID` commands
accept the same optional receiving arguments.

A repeat command reuses an already complete edition, verifies an existing report
destination against its original manifest, verifies an existing full archive and
reopens an existing restored edition. It preserves those completed artifacts
instead of replacing them. Resuming interrupted raster calculation still uses
the original source and output paths; portable reopening is the complete-edition
archive and inspect path, not relocation of an unfinished reducer checkpoint.

For the current regional native operation, the active original project is
`/mnt/data/eco-cohort-resume/received/workspace`, and its maintained application is
`/mnt/data/eco-cohort-resume/received/application` on the existing 640a host.
Use the actual installed source catalog to choose the original 2023 and corrected
2025 NLCD editions and reporting polygons. The corrected 2025 raster has SHA-256
`3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670`;
its imported source collection ID comes from that actual catalog. The source-only
path requires the existing GIS environment and does not require an InVEST run.



## Use a saved ledger in Scientific Reports

Open its saved edition in **Land-cover changes**, enter the source title and choose
**Prepare scientific report**. The original native queue retains this operation;
an interrupted preparation can resume from the same task. Preparation attaches the
completed ledger, complete watershed rows, source bodies, geometry, GIS outputs
and offline report. Source mode and retained-run mode use their original identities.

Open a completed source, then choose **Open Scientific Reports composer**. The
existing composer receives the exact source collection and entry; it preserves its
ordered selection of other reports and its editable title/contact fields. Complete
the ordinary preview and build there. The source ZIP is also available from this
ledger and the native task's original file tickets. Saved report sources reopen
with the ledger after returning to the desk or restoring its full Workspace.

A later task completion leaves a newer ledger selection or another Workspace in
place. Accepted preparation tasks remain in the original native queue across desk
changes. Returning to their ledger exposes the retained source without recomputing
land-cover transitions.

See [the complete source preparation guide](model/LANDCOVER_REPORT_SOURCE.md) for
the original Python API and CLI, input membership, portable source bundle and
scientific interpretation.
