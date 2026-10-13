# Original Gura: native calculation, class comparisons and a reopened operator

This workflow continues `GURA-NATIVE-01` in the maintained Upper Savannah
application. It receives original Gura inputs, prepares the original baseline,
runs NDR and SDR through InVEST 3.20.0, compares separately selected land-cover
substitutions, creates the watershed report and economic editing desk, saves
the whole Workspace, and can start the operator against those results.

The original Gura grid uses 300 m cells: 9 ha per square pixel. Its separate
upstream context selection is 300 m. Native rates are converted using the
actual pixel area. Regional Upper Savannah studies retain their own source
grids, source collections and programme selections.

## Application and runtime

Use the complete maintained application at
`opportunities/upstate_forever_2026/` in
`woahwhattheheck/public-commons-sprint-2026`. This release adds
`source_tools/gura_workflow.py`, `source_tools/gura_comparison.py` and this guide.
Keep the installed current `receive_gura.py`, programme coordinator, source
retention, native execution and portable Workspace modules. Earlier seven-file
carriers included the older 21,851-byte receiver; the current receiver's
22,545-byte successor reuses already extracted original ZIP members.

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
| NDR.zip | df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4c8af8bea53c6c7d |
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

Progress and outputs:

| Path | Contents |
| --- | --- |
| source/gura-workflow.json | Workflow phase, original and active programme IDs, runtime, current application inventory and command |
| source/original-native-programme.log | Original baseline native process output |
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
