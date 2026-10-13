# Gura original-source receiving

Save the Python source below as application/source_tools/receive_gura_release.py. It uses the retained application and an already equipped InVEST 3.20.0 interpreter. The driver performs the scientific operation locally and saves the ordinary Workspace source, profile, scenario, grid, run, and export records.

## Receiving command

On the equipped ASTRA-ECO12 worker, place the original release archives in /mnt/data/eco12-run/gura-3.20.0-inputs, then run:

    /opt/pyvenv/bin/python /mnt/data/eco12-source/source_tools/receive_gura_release.py \
      --application /mnt/data/eco12-source \
      --workspace /mnt/data/eco12-run/gura-3.20.0-workspace \
      --inputs /mnt/data/eco12-run/gura-3.20.0-inputs \
      --models ndr sdr --mode both

The exact original source archives are:

- NDR.zip: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip

- SDR.zip: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip

Their measured sizes and SHA256 values are embedded in the driver. It verifies those archive bytes before retaining their contents.

The cloud copy of both archives is /dev/shm/c8ff-upstate-planning-20261013/gura-3.20.0-inputs. The cloud application is /dev/shm/c8ff-upstate-planning-20261013/application. Use the interpreter that passes that application's original model.native.runtime(["ndr", "sdr"]) inspection.

For an immediate original NDR operation, use the same receiving command with --models ndr --mode native. For a prepared complete application that should execute only its retained Workspace run, use --mode workspace. The normal --mode both operation executes each original release model and its application baseline, then measures their actual annual-mass agreement on common cells. Completed original operations are reused when their source/runtime identity and saved output bytes match. Each native task directory is keyed by its original source and relevant native runtime dependency cohort, preserving completed work and preventing a changed runtime from silently using an earlier TaskGraph directory.

## Original scientific settings

The archive-supplied NDR argument file contains nitrogen and phosphorus enabled, MFD routing, threshold flow accumulation 1000, Borselli k 2, subsurface critical length 200 m, and subsurface efficiency 0.8.

The archive-supplied SDR argument file contains MFD routing, threshold flow accumulation 1000, Borselli k 2, IC0 0.5, SDR maximum 0.8, maximum L 122, and an empty additional drainage path.

The original JSON files retain their embedded InVEST labels 3.10.2 and 3.7.0. The receiving runtime selects the release 3.20.0 original engine. The direct operation keeps the original gura filename suffix; the ordinary Workspace uses its native empty suffix and recorded local output directories. Both use one synchronous worker. The profile normalizes the routing option to lowercase mfd, as required by the actual maintained profile contract.

The supplied rasters use EPSG:32737, 15 m cells and the original upper-left origin near (248950.6562500205, 9941896.999999935). The input grid has 1939 columns and 603 rows. Native engines intersect source extents with the original watershed bounds; their output may therefore occupy a smaller window on that same lattice.

The Workspace model_domain and reporting_area both select the original Gura watershed. An explicit upstream_buffer_m of 0 preserves the release's watershed mask and runoff normalization. The grid selection specifies resolution_m:15. The cumulative Workspace accepts this explicit zero buffer and retains the original source polygon without expansion. Its current raster preparation anchors the selected 15 m cells at the source upper-left coordinate.

## Table and source handling

Each original raster, shapefile sidecar, table, argument file and README is retained as a sourced Workspace edition. The original source files stay byte-identical to their supplied archive members.

For a joint NDR/SDR profile, the driver joins the original required biophysical columns by integer lucode. Original numerical strings and load-type strings are preserved. Descriptive columns are retained with their model prefix. The generated provenance file lists both input hashes and any table codes absent from the keyed intersection; Workspace checks coverage against the actual land-cover raster before preparing the run.

When both models are selected, the driver checks their common DEM and land-cover values, valid-data masks and grids, plus the original watershed geometry. Those checks establish that selecting one shared input for the combined application run preserves both supplied model inputs.

## Result locations and continued operation

The ordinary application Workspace is the path passed to --workspace. It can be opened directly by the existing operator.

The receiving record is:

    WORKSPACE/gura-receiving/gura-receiving-state.json

It contains actual runtime metadata, original archive and argument identities, model stages, the saved source_collection_id, profile_id, scenario_id, grid_id, run_id and artifact descriptions.

The original direct model directories are:

    WORKSPACE/gura-receiving/native-original/ndr/NATIVE_SELECTION_ID
    WORKSPACE/gura-receiving/native-original/sdr/NATIVE_SELECTION_ID

The original application selection documents are:

    WORKSPACE/gura-receiving/selections/ndr-sdr/profile.json
    WORKSPACE/gura-receiving/selections/ndr-sdr/scenario.json
    WORKSPACE/gura-receiving/selections/ndr-sdr/grid.json
    WORKSPACE/gura-receiving/selections/ndr-sdr/run.json

Single-model selections use the corresponding ndr or sdr directory name. The retained Workspace run lives under WORKSPACE/runs/RUN_ID. Native execution progress and the application run ID are emitted as structured JSON on stdout; native logging is retained in gura-receiving/native-operation.log and the original per-run log.

For a later resume, run the same command. The existing Workspace retains its run identity, source editions and native stage cache. An optional --archive /absolute/path/outside/workspace/gura-workspace.zip writes the existing Workspace backup after the actual application run completes.

## Native raster units

Official InVEST 3.20.0 MODEL_SPEC declares n_total_export and p_surface_export rasters in kilograms per hectare, and sed_export in metric tons per hectare. These are annual outputs; the corresponding 3.20.0 user guides explicitly label them per hectare per year. Both original model report implementations multiply raster zonal sums by pixel_area / 10000 to obtain annual watershed totals.

Consequently the application and driver each convert a native raster to annual mass once using its actual projected cell area. At 15 m this factor is 225 / 10000 = 0.0225 hectares per cell. Native watershed vector total fields are already annual masses.

The optional native/application comparison records common-cell totals, maximum and mean absolute cell differences, RMS cell difference, and mismatched valid-data cells. Its counts and numerical differences come from the actual output rasters. Each comparison also records both runtime cohorts and whether they match; same-model scope changes alone do not invalidate a completed original result.

Primary source references:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

- https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/ndr/ndr.py

- https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/sdr/sdr.py

## Cumulative application entry points

`source_tools/receive_gura_release.py` retains the exact official-release driver published in the original receiving Page. Its UTF-8 source is 39,318 bytes with SHA256 `3952c30cd34dbb3c471d737a5875830c6a70b763b302c886c9f6e0e68e625d67`. The separate `source_tools/receive_gura.py` entry point retains the earlier datastack operation and its explicit source choices. Each receiver continues its own retained Workspace and input edition.

The grid selection must supply its actual upstream buffer. An explicit zero uses the complete original model-domain polygon, which must still cover the reporting area. Existing positive-buffer selections retain their original geometry and saved identifiers. The operator form preserves each saved value and exposes the same zero-buffer choice.
