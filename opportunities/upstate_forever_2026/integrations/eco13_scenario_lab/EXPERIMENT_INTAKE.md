# Legacy NativeJobsEngine experiment intake

This document covers the older inspection envelope used by the retained NativeJobsEngine adapter. For the current original Upper Savannah model.experiments workflow, start with [UPSTATE_RECEIVING.md](UPSTATE_RECEIVING.md). The ordinary adopt command selects the current receiver when source_format is upstate.experiment/v1.

Version 0.1.1 adds read-only receiving from the existing Upper Savannah
`NativeJobsEngine.inspect(experiment)` envelope. The original application still
plans, submits, supervises,
cancels and edits its experiments. Intake never invokes its submit or run methods.

Export the original inspection JSON using the application's existing
`inspect-experiment` or `render-experiment` command. Preserve the original
`experiment_key`, `plan`, `receipt.submitted` and `runs` fields. Build a selection
for complete results using actual job keys and explicit JSON Pointers into the
native inspection stored in each job. `model_type`, `version`, `invest_args` and
`workspace` are the default native field selectors; a `fields` map accommodates
other layouts without guessing aliases or manufacturing records.

```sh
python -m eco_scenario_lab.experiment_intake selection.json /work/new-comparison
python -m eco_scenario_lab compare /work/new-comparison --objectives objectives.json
python -m eco_scenario_lab export /work/new-comparison /delivery/experiment.zip
python -m eco_scenario_lab receive /delivery/experiment.zip /work/independent-copy
```

```json
{
  "schema": 1,
  "project_id": "upper-savannah",
  "setup_id": "selected-original-experiment-edition",
  "currency": "USD",
  "inspection": "original-experiment-inspection.json",
  "complete_value": "complete",
  "status_pointer": "/status",
  "models": {
    "sdr": {"args": {}, "result": {"id_field": "ws_id"}}
  },
  "cases": [{"id": "central"}],
  "scenarios": [{"id": "selected-treatment", "cost_cents": 0}],
  "runs": [
    {
      "job_key": "REPLACE_WITH_ORIGINAL_BASELINE_JOB_KEY",
      "case_id": "central", "scenario_id": "baseline", "model": "sdr",
      "native_pointer": "/result/native"
    },
    {
      "job_key": "REPLACE_WITH_ORIGINAL_TREATMENT_JOB_KEY",
      "case_id": "central", "scenario_id": "selected-treatment", "model": "sdr",
      "native_pointer": "/result/native"
    }
  ]
}
```

This is a selection template, not a regional result. Replace both job keys,
the native pointers, completion value and cost with the original application's
actual data. `cost_cents: 0` is not a real project estimate. The original baseline
must be selected as `scenario_id: baseline`. Multiple native model results may
come from one parent job; select their distinct native pointers. Every
case/scenario/model position is unique, and the same native result cannot be
reused as a different alternative. The default comparison requires unchanged
scientific parameters and non-LULC inputs within each matched case; sensitivity
populations belong in separate cases.

Optional `fields` maps logical names to JSON Pointers relative to the selected
native object:

```json
{
  "fields": {
    "args": "/invest_args",
    "workspace": "/workspace",
    "version": "/version",
    "model": "/model_type",
    "runtime": "/runtime",
    "model_code": "/module_sha256"
  }
}
```

When supplied, the runtime and code selectors are required and must match across
paired runs. Original inspection fields are also retained verbatim. Per-run
`fields` and `status_pointer` override the shared selectors. If the original
native output lives outside the experiment workspace, explicitly list the actual
host directories in `native_roots`; paths inside inspected job records alone do
not broaden filesystem receiving scope. Output table path/layer/metric overrides
use the existing `models[model].result` binding. The original `results_suffix`
is applied to the native table filename.

## What the recipient receives

All selected complete native directories, including hidden regular files and
logs; all original file arguments and their dataset sidecars; original inspection
and selection; original arguments plus portable argument paths; retained input
hashes; native result tables and extracted rows. CSV/JSON comparison records
include original baseline/treatment job keys and the original experiment key.
The grayscale HTML report uses the same completed comparison data. Full portable
export/receive keeps these originals. The storage extension retains each exact
complete native directory once within the received edition, with per-job
native-reference.json and the actual table path in state.jobs. The sender and
independently received workspaces keep separate files. See [RETENTION.md](RETENTION.md)
for the complete storage layout, copy behavior and receiving counters.

Existing incomplete experiments can be received as explicitly incomplete
comparisons by selecting their completed jobs. Partial results are never screened
as complete alternatives. An attempted selection of a running job is rejected.
The CLI returns 2 for an incomplete comparison and 1 for a selection/receiving
error. It publishes a new workspace atomically only after successful receiving.

`run` and `revise` on adopted workspaces direct execution back to the original
experiment queue; they never create a second scheduler. Use the original
application to edit and execute another experiment, then receive its edition.

## Version-specific bindings

Both 3.15.0 and 3.20.0 source specify `watershed_results_ndr.gpkg`,
`watershed_results_sdr.shp`, and `output/watershed_results_wyield.shp` for the
selected watershed outputs. Complete shapefile families remain mandatory.
Source inspected for 3.20.0:

- https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py
  (`f518b2867d4a327675fcb1c9b4ba56f29b12188d`)
- https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py
  (`0cac27add172011df367ff8026427dbbdbcda5b2`)
- https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/annual_water_yield/annual_water_yield.py
  (`85b8828007dca2ee339d66e6a4c0bb37bdc4c4fb`)

In 3.20.0 AWY is a package whose initializer re-exports the real execute method.
The standalone native-worker fingerprint now hashes the source containing that
method, not only the small `__init__.py`. The scientific engine remains the
installed exact InVEST version. Other versions require explicit result bindings.

## Upstream 0.1.1 software journey

The upstream 0.1.1 execution consumed the labeled software carriers from
`exercise.py`. It received eight original-style parent jobs / 24 selected result
carriers, produced 80 matched records, preserved the sender, retained 24 hidden
original files, and reopened a 197-file portable archive. The retained
intake-summary.json records that upstream execution. The storage edition's
exercise_intake.py follows each job's native_storage reference and records the
actual number of unique hidden files, preserving all 24 logical result selections. It also exercises mismatched
scientific parameters, original running-job rejection, partial receiving and
prevention of duplicate execution. Its engine identity remains
`SOFTWARE-FIXTURE-NOT-INVEST`; actual scientific execution uses the original
native host and the original regional inputs.
