# Parameter studies: executed versions and retained recovery

The Parameter studies desk retains each case's original run and scientific design.
Completed comparisons bind the selected models to their recorded execution versions.
The saved request remains visible separately.

## Start a new study or reopen an existing study

A new parameter design uses the maintained native runner's version. A completed
baseline stage is eligible when its effective version matches that runner.
For example, a baseline requested as 3.19.0 whose completed NDR stage records
3.20.0 can be used with the maintained 3.20.0 runner. The original baseline
request and run ID are retained.

An unfinished stage can still finish under the current runner. Its old requested
version alone does not describe a completed incompatible execution. Already
completed stages within an interrupted run retain their own version checks.

An existing study reopens before new-design version admission or preparation.
It keeps its original study specification, profile IDs, case IDs, run IDs and
native selections. Reopening calls no replacement run preparation. Matching
historical completed studies can be summarized even when the installed runner
has advanced. A study can contain different NDR and SDR versions when each
model's version agrees across all compared completed cases.

New case records freeze the exact original `run_selection`. Inspection matches
that complete selection to the retained run. Historical case records without
this field keep their original baseline-requested-version binding; they are
not silently widened to another version or selection.

## Read the source of a version

The maintained `model.native_versions` helper resolves each selected model:

| Basis | Meaning |
| --- | --- |
| `completed_stage_runtime` | The completed stage records its executed version, including a reused stage's origin. |
| `observed_run_fallback` | The run records an observed runtime; a completed-stage version is unavailable. |
| `requested_legacy` | Only the original requested version is available. This is labeled as legacy request metadata. |
| `unavailable` | No version is available for a comparison binding. |

The baseline preview and case details use these labels. Results include a
per-model comparison cohort and the individual run/model sources. Comparison
validation runs before raster inputs or aggregate caches open. A missing or
different effective version for the same selected model prevents that cohort
from being aggregated together.

`invest_version` remains the original baseline declaration and carries
`invest_version_basis: baseline_requested_declaration`. Consumers use
`native_versions` for the effective comparison cohort. Separate
`native_version_labels` and `native_version_guides` provide readable labels
and the matching model guide. The shared descriptors remain unchanged.

## Download complete results

Each refreshed study includes:

- `results.csv`: the original quantitative rows, units, support counts,
  signed changes, parameter responses and elasticity.
- `results.json`: those results plus the exact execution cohort and completed
  run selections.
- `native-versions.csv`: every completed case/model binding, including the
  requested and observed versions, source basis, stage completion and complete
  nested reuse ancestry.
- `native-versions.json`: the original shared cohort, run selections, labels
  and version-specific guide links.
- `report.html`: readable scientific results and recorded version sources.
- Requested difference GeoTIFFs with their original comparison and grid records.

The individual study ZIP includes the retained GIS members, both provenance
files, original executed argument documents and current requested arguments
when a reused stage records them. The Gura suite preserves every study's nested
relative paths, so report links continue to resolve after receiving.

Archive creation uses the existing export helper's ZIP64 streams and verifies
every member's original length, hash and open-file identity before publishing.
A failed archive replacement retains the prior complete archive. Completed
studies with an older export/version edition refresh their retained results
without rerunning native stages.

## Continue interrupted aggregation

The original reduction still processes the original raster block order and
uses the same float64 sums, valid-pixel masks, pixel-centre polygon membership,
annual-mass units and empty-support semantics. These numerical functions are
unchanged from PR3210.

This metadata edition can adopt PR3210's completed results and partial window
checkpoints, including the coordinated GIS-export successor. Adoption requires
the exact published predecessor engine/cache source pair, identical project,
study, GIS runtime and reporting-geometry context, and identical retained
baseline/alternative raster descriptors.

The receiving guard additionally checks the exact authored successor cache body
and the unchanged `_areas` and `_paired` function bodies. A future numerical or
cache implementation edit disables this specific compatibility route.
Ordinary source-bound cache selection remains available.

Only the small authenticated JSON records are rebound to the current context.
The original context and records remain intact. Each adopted record retains
its predecessor context, pair ID, path, byte count and SHA256. Completed pairs
reuse their existing values. Partial pairs resume at the next fully saved
original window after all areas have consumed the preceding window.

`aggregation.json` records actual reuse, resumed windows and adopted pairs.
The quantitative rows and scientific study/run identities do not depend on
these processing counters. Malformed partial JSON, including a valid JSON list
or null, is preserved in the cache's invalid directory before that pair recovers
from its verified source rasters.

## Receiving

Use the existing Parameter studies actions to run or refresh the selected saved
study. Programmatic callers continue to use
`model.parameter_studies.execute(workspace, study_id)` or
`model.parameter_studies.summarize(workspace, study_id)`. Both retain the
original study lock and existing native runner.

A focused standard-library receiving journey executed the actual production
preparation, inspection, source-compatibility, completed/partial adoption,
malformed-checkpoint recovery and CSV/JSON export functions. It confirmed exact
historical reopening, rejection before raster work, and preservation of original
records. The equipped original-data operation remains the route for numerical
raster/model execution.
