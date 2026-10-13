# Native execution and recovery

A retained run keeps its original grid, profile, scenario and run ID through
continuation. Use the same scientific workspace and application as its saved
selection.

## Inspect an active or interrupted run

From the application directory:

```sh
python -B -m model.cli --workspace /path/to/workspace run-status RUN_ID
```

The status reports the current native stage or export, attempt history, selected
models, actual run lock, available filesystem bytes and inodes, retained outputs,
and the final 16 KiB of the original native log. A saved running state with no
active run lock appears as interrupted. Reading status starts no model.

Use --log-bytes 0 to omit log content, or --verify to read and verify the original
retained stage and export hashes. Ordinary status checks output presence and
length; full verification is an explicit operation.

## Continue the original run

```sh
python -B -m model.cli --workspace /path/to/workspace run RUN_ID
```

The runner first checks every completed native stage and existing final export.
It loads the selected InVEST runtime only for unfinished native stages. If NDR
and SDR already completed before an interruption during export, continuation
uses their retained original outputs to complete only the missing export files.
That export step needs the application's GIS dependencies and original reporting
mask. A run with every completed stage and export needs no model or raster
calculation to finish its saved state.

The active phase is saved before runtime loading, source reads, validation,
native execution, completed-stage retention and each physical export. Each
failed or interrupted attempt stays in the run's execution history after retry.

## Storage exhaustion

The runner allocates a small recovery reserve on its own filesystem before
starting an attempt. The capacity is at least 256 KiB and grows with the saved
run metadata. It releases that reserve before recording a failure, leaving room
to replace run.json after working files consume the available storage. Successful
attempts release it too. An interrupted attempt's reserve is reclaimed under the
original run lock when that run continues.

This reserve is for recording the error and retained progress. The status reports
actual available storage; the native calculation still needs space for its real
working rasters and outputs.

For a storage failure, make room on the filesystem reported by run-status, then
continue the same run ID. The error retains its original type, message, active
stage and available storage. If the failure record itself cannot be written,
the same detailed event is emitted on stderr and the original exception remains
the caller's error.

Keep original source, stage and final-output files with the workspace. The
ordinary backup and restore workflow carries execution history and existing
completed results. Saved programme selections retain their original application
source contract; adopt a new application through the programme's normal copied
selection workflow while reusing the retained native run identities.

Storage observations carry their own `storage_recorded_at` timestamp. A failure
retains the measurement taken before reserve release in `error.storage_at_failure`;
the attempt also records storage after releasing that capacity. Allocation uses a
private staging name until its identity header and capacity have been flushed, so
continuation can recover a process killed while that reserve was still being written.
