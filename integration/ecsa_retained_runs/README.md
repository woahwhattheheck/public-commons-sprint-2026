# ECSA retained native execution — 0.2.1

Original source delivery guide for the Ecosystem Sciences sprint, 12 October 2026.

The maintained implementation is the top-level `ecsa_runs/` package. The sibling `SOURCE_MANIFEST.json` records this original 0.2.1 delivery for provenance; it does not describe current maintained package hashes.

## Integrate with the existing application

The supported composition entry is `ecsa_runs.workspace_adapter.WorkspaceRetention`.
It is storage underneath the existing `model/workspace.py` writer and native queue.
It does not create application jobs, change IDs, select a run, install HTTP routes,
change model equations, or introduce a second customer interface. Call it when the
existing native worker succeeds, before native output cleanup. Store its returned
metadata using the original workspace's existing job writer.

```python
from ecsa_runs.workspace_adapter import WorkspaceRetention

retained = WorkspaceRetention(workspace_path / '.retained-native', project_id)
# `result`, IDs and inputs below are the original native queue's values.
metadata = retained.retain(
    job_id, result, attempt=attempt,
    model_family=model_family, run_id=run_id, scenario_id=scenario_id,
    inputs=frozen_inputs,
    input_files=explicit_input_role_to_path,
    output_pointers=tuple(explicit_output_json_pointers),
)
# Persist metadata on the same original job. On process restart:
result = retained.load(job_id, attempt)
```

Only three content references are needed alongside existing job metadata:
`retained_result_sha256`, `retained_input_sha256`,
`retained_artifacts_sha256`. The descriptor also repeats the original namespace,
job/attempt/family/run/scenario identity. Exact successful repeats are idempotent;
a different result cannot overwrite that attempt. A later native attempt retains
an independent edition. Returned result keys, typed tables and native identifiers
remain unchanged. Only explicitly declared output paths are relocated to verified
local copies. File trees include raster companions and shapefile sidecars.

Input and result bodies are written before the descriptor transaction commits.
Crashes can leave unreferenced content, but cannot publish a partial descriptor.
The application should persist this descriptor before marking its existing job
complete. If that second write fails, the same existing job/attempt can recover
from `metadata(...)` without recalculating its native model.

## Original Upper Savannah operator composition

The source-pinned original Operator, Workspace and native NDR/SDR invocation were
retrieved at commons revision `97d09111ac34899ea46ba9fdd599cccf5e46dbac`.
`ecsa_runs.upstate.invoke_original_run` now composes with that exact original
`Operator._perform → _invoke(run.start) → Workspace.run → native.execute_run` path.
The source-preserving installer changes one return call, backs up the original
file and leaves the entire existing task writer, comparison and UI unchanged:

```sh
python -m ecsa_runs integrate-upstate /path/to/operator/server.py --write
```

The original task owns its attempts. On success, the callable retains results
before the existing success write. If that write is lost, the original resume
path recovers the saved attempt and repairs absent native files without invoking
the numerical engine again. Receipt fields live on `task["retention"]`, not in a
replacement native result schema. The adapter adds the optional
`retained_native_tree_sha256` descriptor for complete selected-run files.

The captured dependency tree includes the original project identity, selected
profile/scenario metadata, grid metadata and rasters, source collections and their
original content-addressed files, and every native run output/intermediate/sidecar.
It is a portable **selected-run workspace**, not a claim to export unrelated
project histories. Inputs are frozen before execution. Retention state lives
outside the native workspace so it cannot recursively capture itself.

```python
from ecsa_runs.upstate import retention_for
saved = retention_for(operator, original_workspace)
saved.export('/delivery/selected-native-run.ecsar')
received = WorkspaceRetention.receive(
    '/delivery/selected-native-run.ecsar', '/new/run-store', saved.namespace
)
received.restore_native(original_task_id, '/new/native-workspace', attempt=1)
# Open /new/native-workspace with the ORIGINAL Workspace class / application.
```

Receiving restores native relative paths, source objects, IDs and result metadata;
no raster resampling or model math occurs in this layer. New receiving destinations
are create-only. Missing-file repair validates all existing members before writing
and preserves independent edits by reporting a concrete path conflict. The
installation was exercised against the retrieved original `_perform`/`_invoke`
methods, including a lost final task write, same-job recovery and independent
received-scenario execution. The running fleet application's deployment is owned
by the original operator integrators; the source patch and callable are included.

## Portable receiving

```python
retained.export('/delivery/native-results.ecsar')
receiver = WorkspaceRetention.receive(
    '/delivery/native-results.ecsar', '/new/workspace/.retained-native', project_id
)
result = receiver.load(job_id, attempt)
original_inputs = receiver.inputs(job_id, attempt)
```

The export contains a consistent SQLite backup, complete referenced result/input
bodies, complete declared files, hashes and logs. Receiving is create-only and
checks the archive, database, names, sizes and content hashes before adoption.
No sender filesystem paths are trusted for receiving. Imported original queue
identities remain addressable. The sender is not changed. The `inputs()` result
retains original roles and provides new verified local paths for input files.

## Optional native process execution

An application which needs a process executor can use `RunGateway.configure`,
`submit`, and `execute`, or the blocking `RetainedProvider` wrapper. This optional
executor uses the provider's existing signatures:

```python
run_model(family, inputs, data_dir=path)
run_scenario(family, inputs, scenario_name=name, data_dir=path)
```

The adapter module contains no hydrological equations. Supply the actual native
provider and its installed environment. Capture its complete local source/data
edition; declare external input file fields and output file fields explicitly.
The provided diagnostic fixture is never selected automatically.

The supervisor keeps child processes warm within an exact source/data edition,
heartbeats fenced leases, rejects stale commits, retries crashed workers, and
cancels process groups including child solver processes. The `run` command is a
foreground supervisor, not a detached service. Launch it through the existing
application's service/queue lifetime. Large files are copied and hashed in chunks.
Full typed results are materialized in memory during serialization; this is not
an out-of-core numerical tensor engine. Native providers still own their numerical
resource requirements and the application's canonical queue still owns its jobs.

Code snapshots include local provider dependencies and model data, not the entire
Python environment. Install the same native environment on receiving machines.
Credential dotfiles, version-control metadata and common caches are excluded from
source capture. Runtime logs are retained locally; review them before external
publication because providers may print sensitive paths or input details.

## Installation and operation

Python 3.11+; numpy and pandas; GeoPandas/Shapely when native results use geometry.
Install the included wheel in the application's existing scientific environment:

```sh
python -m pip install --no-deps ecsa_retained_runs-0.2.1-py3-none-any.whl
python -m ecsa_runs --help
python -m unittest discover -s tests -v
```

The CLI exposes configure, submit, submit-manifest, run, list, inspect, cancel,
retry, result, report, export, receive, integrate-upstate and recover. `gateway.py` and
`comparison.py` include standalone diagnostics developed against the earlier
provider-shaped seam; they are not replacements for the current operator's
comparison API, result-card schema, selected-model logic or scene memory.
Standalone exported report packets use relative native-file paths so the package
can be moved. The typed JSON retains nested tables; top-level tables also get CSV.

## Native input-manifest repair

`bindings.submit_manifest` retains original BC10 manifest IDs, families, scenarios,
asset roles and actual asset hashes/sizes. It accepts the dataclass or its JSON.
`repair-bc10 PATH` previews a source-preserving repair; add `--write` to apply it.
The parser edits only the `validate_native_bindings` function: uppercase dictionary
keys to match the existing uppercase lookup and materialize an asset iterable once.
The supplied original function had mixed-case InVEST_NDR and GTModel keys, making
missing inputs incorrectly appear ready; a generator was also consumed before
counting. The repair preserves unrelated source, is repeat-safe, records the
original hash, backs up the full original file and checks for intervening edits.

## Executed programme

Seven lifecycle programmes pass on Python 3.13.5 in the cloud container:

- Retrieved original Operator methods: one changed run-start call; unchanged
  task writer and comparison branch; native-file completion followed by a lost
  task write; missing-output repair on attempt two with one engine invocation;
  all 13 selected dependency files export/receive after deleting both native and
  operator originals; independent received-scenario execution and unchanged baseline.
- Existing application IDs: retain a two-megabyte native-shaped output, keep the
  complete typed result unchanged, create zero alternate queue jobs, export,
  remove every original, receive, reopen, recover weather bytes and retain a new
  attempt while the previous attempt remains addressable.
- Six process-executed jobs of 6,000 rows each on two warm workers, exact weather
  snapshots, source IDs, full native output files, saved selections, diagnostics,
  complete report, deletion of originals, portable receive and independent rerun.
- Real worker-process failure, fenced recovery, cancellation, retry and mutation
  rejection; exact-key idempotency; codecs and actual source-manifest checks;
  source-preserving BC10 repair and CLI invocation.

`EXECUTION.log` contains the actual output. These lifecycle workloads use an
explicit execution-protocol fixture to exercise operating-system and storage
behavior. They do not constitute an InVEST/GTModel scientific run or regional
calibration. The real native provider remains owned by the existing native lane.
