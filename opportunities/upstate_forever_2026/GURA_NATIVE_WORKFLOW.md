# Original Gura: inputs, native comparisons and a reopened operator

The workflow uses the Natural Capital Project's retained InVEST 3.20.0 Gura
release archives and original biophysical CSVs pinned to revision
098183806c0c715e6422d4d0570db91321c0f4e8. It continues GURA-NATIVE-01 with the
operation's 300 m grid (9 ha per square pixel) and separate 300 m context buffer.

## Receiving the complete application

Use the complete current application from the public repository at
opportunities/upstate_forever_2026. The workflow composes its existing
source receiver, native programme executor, comparison reports and operator.
Keep those modules from the same current application checkout when receiving
or transferring the project.

Use the Python environment defined by environment.yml for native calculation.
The same workflow's prepare command can use an existing GIS interpreter with
NumPy, rasterio, Fiona, pyproj and shapely. Every native run uses InVEST 3.20.0,
GDAL and pygeoprocessing through the maintained application executor.

## Preparing the retained original inputs

From the actual received application root:

    python -B -m source_tools.gura_workflow prepare \
      --workspace /absolute/path/to/gura/workspace \
      --source-directory /absolute/path/to/gura/source \
      --archives /absolute/path/to/gura-3.20.0-inputs

The archive directory contains the retained NDR.zip and SDR.zip. The workflow
checks their original release digests and uses the two exact CSVs supplied
under source/gura-original-tables-3.20. Source URLs and original bytes stay with
the imported collection. It prepares the original grid, profile and baseline,
then counts actual land-cover cells inside the original Gura watershed.

The default comparison pairs the dominant observed original class with every
other observed class, in both directions, in separate native scenarios. Its
saved plan includes original class labels, original profile coefficients,
actual source-cell counts and areas, watershed features, and all scenario IDs.
For an intentionally selected cohort, repeat --convert FROM:TO using original
integer class codes. The same arguments resume the same saved selection.

The existing retained archive path on host 4bdbb5b17718 is:

    /dev/shm/c8ff-upstate-planning-20261013/gura-3.20.0-inputs

Use the existing GURA-NATIVE-01 Workspace/source paths of the receiving host.
The command above shows path placeholders; it does not select a second host
or another Workspace.

## Native calculation, reports and saved Workspace

Use the same arguments with run and the compatible native interpreter:

    python -B -m source_tools.gura_workflow run \
      --workspace /absolute/path/to/gura/workspace \
      --source-directory /absolute/path/to/gura/source \
      --archives /absolute/path/to/gura-3.20.0-inputs \
      --backup /absolute/path/to/gura/gura-complete.zip

The workflow first continues the original receiving programme and writes its
actual programme ID, host, PID and log path to progress. It then uses the
maintained programme executor for the complete selected comparison cohort.
That executor reuses completed baseline and alternative runs, continues
interrupted work, and keeps current process/run details in the comparison
directory. Each alternative must change actual source cells.
Completed outputs include a native watershed comparison, quantitative source
areas and exports, the economic editing desk, and a full Workspace archive
with the matched application and original source collection.

Progress is emitted as JSON lines and saved to source/gura-workflow.json.
The original programme writes source/original-native-programme.log. The native
comparison retains its own progress.json and native-programme.log
under workspace/gura-comparisons/<comparison-id>. Rerun the same command after
an interrupted process; the retained source selection and programme are reused.

    python -B -m source_tools.gura_workflow status \
      --workspace /absolute/path/to/gura/workspace \
      --source-directory /absolute/path/to/gura/source \
      --inspect-runtime

## Opening the real operator

Add --serve to run to start the operator after calculation and archive creation,
or use the existing completed Workspace:

    python -B -m source_tools.gura_workflow serve \
      --workspace /absolute/path/to/gura/workspace \
      --source-directory /absolute/path/to/gura/source

The server prints its actual origin and operator_url. Open the exact returned
operator_url, including its token fragment. The operator can inspect sources,
select models and cases, run native work, compare completed results, edit
report selections and notes, download deliverables, and save the Workspace.

## Reopening a transferred copy

Use the maintained portable.restore(archive_path, new_destination) API from
model.portable. Its returned application directory contains the matching
operator/server.py, and its returned workspace is the restored scientific
Workspace. Launch that returned application:

    /compatible/python /absolute/returned/application/operator/server.py \
      --workspace /absolute/returned/workspace \
      --operator-state /absolute/returned/operator-state \
      --port 0

The server again prints the actual operator_url. The current portable model
includes the cumulative application packages and ordinary Workspace root
files, including operator-session.json when present, so browser selections and
report notes travel with the Workspace.

## Continuing native work from the transferred archive

The workflow retains its original receiving record, original programme
selection, selected conversion cohort and watershed ID field under
workspace/gura-workflow before creating the archive. The original raster,
vector, ZIP and table objects are also retained by the scientific Workspace.

After portable.restore, use the matched application's workflow with the
returned Workspace and a new local source directory:

    python -B -m source_tools.gura_workflow run \
      --workspace /absolute/returned/workspace \
      --source-directory /absolute/returned/gura-source \
      --backup /absolute/returned/gura-continued.zip

The workflow verifies the restored project and source/grid/profile/scenario
identities, rebinds the receipt's local Workspace and programme-selection paths,
and restores the original conversion and watershed-field selections. It then
reuses the preserved native runs through the same programme executor. The
archive contains the original scientific inputs, so this continuation does not
need the original machine's source directory or another archive download.

## Application source

The workflow and this guide are maintained alongside receive_gura.py,
gura_comparison.py, the two pinned original CSVs and environment.yml. Each
execution records the actual application file hashes in its progress record.
The preserved source collection and the matching application travel with a
complete Workspace archive.
