# Use the received native runtime in the original application

The invocation entry joins the received Python/GIS environment to the existing
operator, scientific CLI or another original application Python entry. It selects
the native interpreter's own PROJ/GDAL data, loads the exact model source selected
by the application, and becomes the requested entry. All original arguments are
passed unchanged. The original operator retains its process, queue, saved task
identities and model-stage recovery.

## Start the existing operator

After receiving the complete native runtime using `NATIVE_RUNTIME.md`, run:

```sh
python3 -B /path/application/source_tools/native_runtime/invocation.py \
  --python /path/native-runtime/bin/python \
  --application /path/application \
  --entry operator/server.py -- \
  --workspace /path/workspace --operator-state /path/operator-state --port 0
```

The original server prints its local opening URL. That URL contains a local
credential; retain it privately rather than copying it into shared logs, source
manifests, Slack or a customer package. The invocation never logs forwarded
arguments or environment values. The original server's own output is unchanged.

An existing receiving launcher can use `prepare(...)` from this module to obtain
`command` and `environment`, then start that exact command itself. It must retain
the returned environment. This composes with the existing launcher; it does not
need a second service or additional queue.

## Restore a complete native project

Use a NEW receiving directory. The original restore command preserves the complete
application, source collections, profiles, scenarios, native run IDs, parameter
studies and their exports:

```sh
python3 -B /path/source/application/source_tools/native_runtime/invocation.py \
  --python /path/native-runtime/bin/python \
  --application /path/source/application --entry model/cli.py -- \
  restore /path/Native_Application_Workspace.zip /path/new-project
```

Then start `new-project/application/operator/server.py` with the same native
runtime and the restored `new-project/workspace`. Keep an existing receiving
project unchanged when using this independent-copy route.

## Inspect the actual runtime

```sh
python3 -B /path/application/source_tools/native_runtime/invocation.py \
  --python /path/native-runtime/bin/python --application /path/application \
  --inspect
```

The returned native provenance comes from the original `model.native.runtime`,
including the installed InVEST version and exact selected official source hashes.
This inspection loads the native libraries. It does not execute a scientific run.
The complete GIS round-trip probe remains available through the original
`source_tools/native_runtime/__main__.py probe` command.

The interpreter's executable path is kept intact rather than resolving a venv's
Python symlink to another installation. Inherited Python path/user-site injection,
foreign PROJ/GDAL data paths and pip destination configuration are cleared by the
existing runtime environment helper. The caller's native resource settings are
otherwise preserved. No browser access control or operating-system policy is
changed.

## Change inputs and calculate

Open the original **Parameter studies** view. Choose the saved baseline, enter the
explicit native parameter values and their rationale/references, preview, save,
and select **Run all cases**. The original queue performs the real native model
calculations. Reopen the same study to resume remaining cases. A complete study's
original report, result table, source profile, difference GeoTIFFs and full ZIP are
available through its ordinary downloads.

For direct execution or external receiving, use the existing
`model.parameter_studies` API and its `operator/PARAMETER_STUDIES.md` contract.
Do not compute a new study by altering already-completed raster values. Native
input changes create separately identified profiles and runs; completed cases
remain reusable.

## Operated complete example — 13 October 2026

The original 1,296 ha simulated Piedmont headwaters project was restored through
its own portable receiver. Its twelve completed native runs were kept unchanged.
Three original Parameter studies compared fixed present, riparian and matched-area
control scenarios under coupled NDR/SDR connectivity-shape values 1 and 3, against
the retained value 2. MFD routing, dimensionless SDR Lmax 122, the 120 by 120 grid,
all source inputs and the 0.09 ha cell area were unchanged.

All three studies completed through the ordinary authenticated operator queue:
nine case references, six new native runs and twelve new official model-stage
executions. Their complete result reports and difference GIS exports were written
by the original model modules. The resulting original project contains eighteen
completed runs and three saved parameter studies. These explicit input-sensitivity
cases retain their illustrative source classification.

The supplied working study is opened with the same original application and
receiver, not a separate result-only application. Further native cases are entered
and calculated through the same Parameter studies controls.
