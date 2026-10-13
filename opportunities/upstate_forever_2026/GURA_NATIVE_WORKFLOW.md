# Original Gura: native calculation, class comparisons and a reopened operator

This workflow continues `GURA-NATIVE-01` in the maintained Upper Savannah
application. It receives original Gura inputs, prepares the original baseline,
runs NDR and SDR through InVEST 3.20.0, compares separately selected land-cover
substitutions, creates the watershed report and economic editing desk, saves
the whole Workspace, and can start the operator against those results.

The workflow reads the native cell size from the selected original land-cover
raster. Gura source editions remain separate: a 300 m square cell covers 9 ha,
while a 15 m square cell covers 0.0225 ha. The upstream context distance is a
separate scientific selection. New wrapper intake uses zero added context;
reopening a prepared case retains that case's original grid and
context distance. Native rates use the actual pixel area. Regional Upper
Savannah studies retain their own source grids, collections and programmes.

## Application and runtime

Use the complete maintained application at
`opportunities/upstate_forever_2026/` in
`woahwhattheheck/public-commons-sprint-2026`. This release adds
`source_tools/gura_workflow.py`, `source_tools/gura_comparison.py` and this guide.
Install the matched current `receive_gura.py` and workflow together, preserving
the current programme coordinator, source retention, native execution and
portable Workspace modules. The receiver reads the selected raster's native
cell size and reuses already extracted original ZIP members.

Use the existing compatible GIS/native interpreter. The application
`environment.yml` defines Python 3.12, InVEST 3.20.0 and the required GIS
packages when an environment must be installed. A prepare-only command needs
NumPy, rasterio, Fiona, pyproj and shapely. Native execution additionally checks
InVEST 3.20.0, GDAL and pygeoprocessing. The workflow records the interpreter,
hostname, package versions, selected application files, child PID and command.

The existing native adapter selects TaskGraph's synchronous `n_workers=-1`.
The workflow defaults `GDAL_CACHEMAX=16` and `GDAL_NUM_THREADS=1` before GIS
imports and records the effective values. Explicit caller environment values
take precedence. The cache setting is in MB and controls GDAL's block cache;
the existing original input and output files remain necessary.

## Original inputs and provenance

For a new intake the workflow checks the retained generation-specific InVEST
3.20.0 release archives:

| Input | SHA256 |
| --- | --- |
| NDR.zip | df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d |
| SDR.zip | 34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779 |

The source code preserves the original Google Cloud Storage object generations
`1781204725169434` and `1781204725769073` in the NDR and SDR source URLs.
The two separate biophysical CSVs come from the original sample-data revision
`098183806c0c715e6422d4d0570db91321c0f4e8` and are supplied under
`source/gura-original-tables-3.20/`. Their full original bytes and URLs travel
with the imported collection. Nutrient columns come from NDR; SDR supplies
`usle_c` and `usle_p`, joined by original integer `lucode`.

An already prepared source manifest or receiving record keeps its own actual
archive hashes, source URLs and edition. This includes the original 3.16.1
archives referenced by the tagged InVEST 3.20.0 example datastacks. Restarting
the workflow reuses the selected retained bytes and preserves that provenance.
The new-intake release choice does not rewrite an existing source selection.

## Preparing the same Workspace

Run from the actual application root with the compatible interpreter:

```sh
env GDAL_CACHEMAX=16 GDAL_NUM_THREADS=1 /compatible/python -B -m source_tools.gura_workflow prepare \
  --workspace /absolute/gura/workspace \
  --source-directory /absolute/gura/source \
  --archives /absolute/gura/original-archives
```

The archive directory contains retained `NDR.zip` and `SDR.zip`. The known
original archive location on host `4bdbb5b17718` is
`/dev/shm/c8ff-upstate-planning-20261013/gura-3.20.0-inputs`.
Use the receiving host's existing operation paths. Once `sources.json` has
been retained, subsequent preparation can recover directly from its verified
original files without another archive download or external archive location.

The workflow prepares the original source collection, grid, coefficient
profile and baseline. It counts land-cover cells inside the original Gura
watershed and saves their areas using the actual affine determinant.

To assert the selected source edition explicitly, add
`--expected-resolution-m 15` for a 15 m source, or
`--expected-resolution-m 300` for a 300 m source. This checks the original
raster; it does not request resampling. Omitting the option reads the original
cell size. The same optional expectation is available on `receive_gura.py`.

Use `--upstream-buffer-m DISTANCE` to select the upstream context for a new
case. The current wrapper defaults to zero added context. An explicit
`--upstream-buffer-m 0` retains the original model-domain geometry without
adding a buffer. To retain a separately selected 300 m context, use
`--expected-resolution-m 15 --upstream-buffer-m 300`; the source cells stay 15 m.

Both the workflow and the direct `source_tools.receive_gura` command accept a
finite nonnegative context distance. Native cell resolution remains strictly
positive and source-matched. Direct receiving validates both choices before
copying or extracting any original inputs, so invalid selections do not consume
receiving storage.

To explicitly continue the retained 15 m edition with zero added context:

```sh
env GDAL_CACHEMAX=16 GDAL_NUM_THREADS=1 /compatible/python -B -m source_tools.gura_workflow prepare \
  --workspace /absolute/gura/workspace \
  --source-directory /absolute/gura/source \
  --archives /absolute/gura/original-archives \
  --expected-resolution-m 15 --upstream-buffer-m 0
```

Use the existing case's actual operation paths. Direct intake retains its
required archive, table, source-reference and context arguments; the same
`--upstream-buffer-m 0` selects zero added context there.

On resume or `serve`, omitted grid options retain the saved selections,
including an original zero buffer.
The same applies when an interrupted intake already saved
`programme-selection.json`, and after restoring the Workspace archive.
An explicit option must match that prepared case; to select another buffer
or source edition, use a separate Workspace and source directory. The original
source objects, grid, programme and completed runs remain bound to their
original selections.

The `original_inputs_prepared` event and `receiving.json` contain the inspected
`native_grid`: resolution, original affine transform and CRS, source cell area,
selected grid cell area, and the independently selected upstream buffer.

The default comparison pairs the dominant observed original class with every
other observed class in both directions. Each pair is a separate scenario.
The plan retains original class labels and coefficients, source-cell counts
and areas, watershed feature IDs and scenario selections. To select a
particular cohort, repeat `--convert FROM:TO` with original integer class
codes. Resume with the same cohort and `--zone-id-field` arguments.

## Native execution and recovery

Use the same paths with `run`:

```sh
env GDAL_CACHEMAX=16 GDAL_NUM_THREADS=1 /compatible/python -B -m source_tools.gura_workflow run \
  --workspace /absolute/gura/workspace \
  --source-directory /absolute/gura/source \
  --archives /absolute/gura/original-archives \
  --backup /absolute/gura/gura-complete.zip
```

The original `receiving.json` and `programme-selection.json` remain the source
lineage for the saved comparison plan. Interrupted preparation reuses the
saved source reference. On native execution the coordinator creates or reopens
a programme from that saved selection against the installed scientific source
inventory. The current programme ID is recorded separately as
`active_original_programme_id` in `gura-workflow.json`; its native run IDs and
completed stages are reused when their input and runtime identities match.

Both the original baseline and the comparison cohort use the maintained
CLI `resume` action. This clears a retained pause request before continuing.
A failed or interrupted native child leaves its actual command, PID, log,
return code and programme record available for recovery. Rerun the same
workflow command after correcting the concrete runtime issue.

The comparison executor checks every selected native run, verifies that
alternatives changed actual source cells, builds the watershed comparison,
creates economic editions where the original exports have common support,
and saves the full Workspace archive. Use `--physical-only` for the native
report without the economic companion. Archive paths must be outside the
Workspace. Existing verified complete archives are reused.

## Original baseline report during the comparison run

As soon as the original baseline programme completes, the workflow builds a
saved reference-only watershed report from that exact completed run and the
original zones in the comparison plan. Its annual totals use the original
native NDR/SDR outputs and actual raster support. It writes the report ID,
relative output descriptors and report directory into `gura-workflow.json`
before the broad class comparisons begin. Repeated execution reopens the
verified existing reference report.

The `reference_report_progress` and `reference_report_complete` JSON events
identify the actual report phase and saved files. Start the existing `serve`
command in a second terminal against the same Workspace to open those totals
while the comparison programme continues. The comparison and later economic
editions remain in that same Workspace; its portable archive retains the
reference report, comparison reports and original native source selections.

Programme progress polling reads the current programme and run status without
repeatedly enumerating ensemble candidates or completed donor-source catalogues.
The native executor and original scenario selection remain the same.

Progress and outputs:

| Path | Contents |
| --- | --- |
| source/gura-workflow.json | Workflow phase, original and active programme IDs, runtime, current application inventory and command |
| source/programme-executions/&lt;programme-id&gt;/original-native-programme.log | Original baseline native process output |
| source/gura-source-catalog.json | Actual original classes, cells, areas, tables and watershed features |
| source/gura-comparison-plan.json | Saved source-class cohort |
| source/gura-comparison-result.json | Final native reports, economic editions and archive |
| workspace/gura-comparisons/&lt;comparison-id&gt;/ | Comparison progress, native log, source selection, reports and archive receipt |

Inspect the recorded operation and currently imported runtime:

```sh
/compatible/python -B -m source_tools.gura_workflow status \
  --workspace /absolute/gura/workspace \
  --source-directory /absolute/gura/source \
  --inspect-runtime
```

## Operator and transferred Workspace

Add `--serve` to the native run to start the operator after the result and
archive are saved, or open the existing completed Workspace:

```sh
/compatible/python -B -m source_tools.gura_workflow serve \
  --workspace /absolute/gura/workspace \
  --source-directory /absolute/gura/source
```

The server prints its actual origin and `operator_url`. Open the returned URL
including its token fragment. Sources, native cases, comparisons, report
selections, notes, deliverable downloads and Workspace saving remain available.

For a transferred whole Workspace, call the maintained
`model.portable.restore(archive_path, new_destination)` API. Launch the returned
application's `operator/server.py` against its returned Workspace path:

```sh
/compatible/python /returned/application/operator/server.py \
  --workspace /returned/workspace \
  --operator-state /returned/operator-state \
  --port 0
```

The portable source includes the matched application and original source
collection. Ordinary Workspace root files, including a retained operator
session, preserve report selections and notes.

## Preserving a running child and reopening the workflow

The native launcher holds a programme-specific launch lock through an inherited
file descriptor. If its caller ends while the native child continues, the next
caller observes that issued process and its maintained programme/run state.
It starts a continuation after the existing process has settled. Every issued
attempt is retained under `programme-executions/<programme-id>/native-attempts`,
with the actual log path in its command record. Earlier operation-wide command
records remain available.

Completed programmes and reports retain their original source identity.
For an incomplete programme, the launcher checks the installed scientific
inventory immediately before execution. Only the coordinator's exact
scientific-source-change result triggers creation from the saved selection
under the current inventory. Its active programme ID and command ledger are
recorded separately, and canonical native run IDs remain bound to their
original inputs. All other identity or grid errors remain explicit.

The workflow saves original receiving and programme selections, the conversion
cohort, selected watershed field and progress inside
`workspace/gura-workflow` before the complete Workspace archive is built.
After `portable.restore`, run the matched application's workflow with the
returned Workspace and a new local source directory:

```sh
/compatible/python -B -m source_tools.gura_workflow run \
  --workspace /returned/workspace \
  --source-directory /returned/gura-source \
  --backup /returned/gura-continued.zip
```

The restored scientific project and source/grid/profile/scenario identities
are checked before local receipt and programme-selection paths are rebound.
The original cohort and watershed-field selection are restored from the
Workspace. The retained native runs and original source objects are available
without another original archive download.

To separate the operator's startup receipt from workflow JSON output, add
`--operator-ready-file /absolute/new-operator-ready.json` to `serve` or a
`run --serve` command. That receipt path must be new so an earlier server's
connection information is preserved. Open the actual returned `operator_url`.
A physical-only run defaults to a separate `-physical-complete.zip` backup
filename, preserving the archive containing economic editions.
