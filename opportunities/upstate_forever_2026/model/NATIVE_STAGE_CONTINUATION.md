# Continue original native stage reuse

Native runs keep their original selected models, grid, profile, scenario and
InVEST source. This continuation improves the existing native runner and its
operator console.

## Run and follow the original calculation

1. In **Native model runs**, open the prepared selection and choose **Run original
   models**. A failed selection offers **Resume original models**.
2. Open **Open calculation console** from that run's task. For a run programme,
   use the same console from the retained programme task.
3. The console follows the original worker. During stage reuse it shows the
   selected model, exact-index or explicit-source candidate, original source run,
   current file, completed verified file and logical-byte counts, and observed
   lookup/transfer time.
4. Open **Inspect native result** to use the saved physical export rasters. The
   original registry and source-run provenance remain in the completed stage.
   **Download operation record** retains the visible worker and native journal.

The existing CLI status command exposes the same journal without starting a
model:

```sh
python -B -m model.cli --workspace WORKSPACE run-status RUN_ID --log-bytes 0
```

The journal is `execution.stage_reuse` in the retained `runs/RUN_ID/run.json`.
Its progress is written at most about once a second, plus phase admission and
completion boundaries. Counts describe complete verified independent output
files, including retained files from an earlier attempt. They are logical bytes;
a filesystem reflink can use less additional physical storage. A large individual
file remains the current file until its verified transfer finishes.

## Exact matches before broader source comparisons

The existing stage-cache index is consulted first. A candidate must retain the
exact selected scientific arguments, original input and companion bodies,
native module sources and runtime environment. The index is a pointer to the
original run; every copied output is still checked against its retained byte
length and SHA256.

If indexed candidates are unavailable, the runner continues through the existing
explicit original source IDs. That path retains the maintained scientific
comparison of original raster values, masks, grids, domain geometry and relevant
biophysical columns. A stale index does not prevent the same explicitly selected
source from being compared through this path.

The receiving run's selected IDs, official native arguments and calculation
methods are unchanged. No new native execution queue or cache store is created.
A completed reused stage adds `reuse_lookup` observations alongside its existing
`input_signature`, `reused_from`, `transfer`, original timestamps and complete
registry descriptors.

## Continue after storage exhaustion

Actual `ENOSPC` or `EDQUOT` failures stop the selected run through its original
recovery journal. The same failure also stops the remaining run programme,
scenario experiment, parameter study or Gura parameter suite. Scientific or
input errors confined to an independent case retain the existing per-case
continuation behavior.

The console retains the original capacity error and the actual run filesystem
observation. Free capacity on that filesystem, preserving the original inputs,
Workspace and completed outputs, then resume the same retained run, study or
programme. The next attempt rechecks previously copied complete independent
files and continues the transfer. It does not start another model merely because
the first source could not fit.

The native run reserves space for its own failure metadata. If a larger
coordinator record cannot be published on the full filesystem, the original
native error remains primary; the coordinator can reconcile the actual saved
runs when resumed. Existing completed reports remain available. New aggregation
or export writes wait for the resumed attempt.

## Existing source editions and transfer

Completed stage and run identities remain unchanged. Old records without reuse
progress continue to open normally. Whole Workspace backup retains the native
journal, completed independent outputs and original source provenance through
the existing inventory.

The programme records the selected scientific source edition. After installing
an updated application, use its existing programme creation/selection route to
register that edition while reusing the same native run IDs, then continue the
retained programme. A live original worker keeps its admitted source and
selection; reconnect it through the existing task.

## Source receiving

The implementation spans the original stage cache, NativeExecution journal,
coordinators and calculation console. The browser module and its real renderer
were executed in V8 against indexed-transfer, unavailable-source and legacy
records. The actual original-data run uses the existing GURA-NATIVE-01 receiver:
its run status and console provide candidate counts, source ID, file progress
and the retained native result for that same operation.
