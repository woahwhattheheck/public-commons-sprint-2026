# Simulated headwaters parameter course

This continuation operates the existing routing-lmax-v1 study on the one retained
simulated watershed. It joins its completed native runs to joint siting
comparisons, paired raster products and the original decision desk. The current
case generator owns the terrain, source masks, coefficients and baseline. The
current downstream driver owns native process supervision and the complete
Workspace archive and independent reopen.

## Receive the same case

Use the complete current application, including its ensemble, paired-ensemble,
decision and native modules. The additive component fragment declares those
existing dependencies. This source adds no operator route or background queue.

After the final terrain edition and both intervention masks are imported, form
this selection from the actual generated-case receipt:

```python
from source_tools.headwaters_parameter_course import prepare, continue_course

selection = {
    "grid_id": receipt["grid_id"],
    "baseline_scenario_id": receipt["baseline_scenario_id"],
    "base_profile_id": receipt["profile_id"],
    "alternative_scenario_ids": receipt["alternative_scenario_ids"],
}
prepared = prepare(ws, selection)
receipt["ensemble_id"] = prepared["ensemble_id"]
# Save the current driver's receipt now, using its existing phase mechanism.
result = continue_course(ws, prepared["ensemble_id"], execute=True)
receipt["parameter_course"] = result
```

The alternatives must include both the final riparian and the matched control
scenario. The native catalogue validates saved grid, profile and scenario
identities and preserves the original central profile first. This adapter also
reads the base profile's original retained source manifest, requires its explicit
SIMULATED DEMONSTRATION INPUTS classification and the same grid source edition.
It does not alter a source mask or prescribe a synthetic model output.

Run this continuation after the same case's central baseline and alternatives,
before the original whole-Workspace backup. Existing complete native selections
are reused by the maintained engine. The resulting comparison rasters, ensemble
reports, paired products and complete decision editions then travel in that same
scientific project.

The sprint's outer native owner preserves the 2026-10-13 14:00 UTC cutoff and
process lifecycle. This adapter runs in that owned process and uses the existing
native/ensemble locks. An interruption retains the actual ensemble, native
stages, paired-tile progress and course result for an explicit owner continuation.

## Native command

Write the exact selection above to a JSON file using the original receipt.
Preparation requires the installed native application and GIS stack; model
execution also requires its actual compatible InVEST runtime.

```sh
"$PYTHON" -B "$APPLICATION/source_tools/headwaters_parameter_course.py" \
  --application "$APPLICATION" --workspace "$WORKSPACE" \
  --selection "$ACTUAL_SELECTION_JSON" --prepare-only
```

Use the returned real ensemble ID for the continuation:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/headwaters_parameter_course.py" \
  --application "$APPLICATION" --workspace "$WORKSPACE" \
  --ensemble-id "$ACTUAL_ENSEMBLE_ID" --execute
```

Omitting --execute reads the saved native results and finishes their exports.
It does not run pending NDR/SDR cases. --without-raster-products skips the paired
raster phase when the caller deliberately selects only scalar and decision
products. Both commands return actual pending/failed member identities; exit 2
means the requested continuation is partial. The ordinary native worker remains
the single execution owner.

## What is varied

The maintained catalogue supplies linked NDR and SDR routing choices MFD and D8,
crossed with SDR maximum-L choices 122 and 333. The original base profile is
included and equivalent parameter members are deduplicated. If the base
parameters already match a factorial combination, it stays that exact original
profile and its existing native run identities.

Lmax is dimensionless: it caps the RUSLE slope-length factor L before multiplication
by the slope factor S. It is not a distance in metres. NDR has no Lmax input, so
coupled cases that differ only in SDR Lmax can repeat nutrient results. Any zero
response to this cap is retained as the actual selected terrain's result.

Sources:

- [Pinned InVEST 3.20 SDR implementation](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py), Git blob 0cac27add172011df367ff8026427dbbdbcda5b2.
- [Pinned InVEST 3.20 NDR implementation](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py).
- [Official SDR guide, Data Needs](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html).
- The installed model/ensembles.py parameter catalogue retains each axis's
  original source references and meanings in the saved design.

## Joint alternatives and geographic support

The original ensemble's scalar report retains each baseline-versus-alternative
pair. This continuation additionally calls the existing Workspace.compare_runs
once per completed member with that member's baseline followed by every original
alternative. It invokes no additional native calculation for these comparisons.

The original decision adapter reads their actual output rasters once and computes
common finite support across all available alternatives within each profile.
The same physical packet feeds the decision analyzer. The first completed member
of each distinct candidate/support pattern receives its own original decision
edition; the reference profile's edition is first. Each edition retains every
completed sensitivity comparison and the existing analyzer's exact reasons for
including or excluding a profile. Different routing masks are never pooled into
one asserted common area.

These are descriptive working-parameter choices. Their ranges and quantiles do
not represent probabilities or calibrated confidence intervals. Scalar ensemble
change is alternative minus baseline. Paired raster and decision avoided export
use baseline minus alternative. The original artifact units, geographic support
and integration rules remain authoritative: annual N/P masses are kg/year and
sediment masses are metric tonnes/year. Raster densities are integrated by their
actual projected cell area in the existing adapter; already integrated totals
receive no additional area conversion.

Costs and targets are empty because this demonstration has not supplied economic
inputs. The native decision desk still provides the physical scenario comparison,
Pareto relation and support-compatible sensitivity/rank results. The same-edition
source-loading and per-treated-hectare interpretation remains with the existing
scenario-summary owner.

## Retained outputs and reopening

All course outputs live under the original Workspace:

| Path | Content |
| --- | --- |
| ensemble_results/ID/headwaters-course.json | Immutable actual input selection, original source manifest identity and native catalogue design |
| ensemble_results/ID/headwaters-results.json | Current native operation, all comparisons, pending member IDs and decision editions |
| ensemble_results/ID/operation.json | Existing operation's process, original native/raster progress and report paths |
| ensemble_results/ID/joint-decisions/REPORT_ID/ | Original complete decision HTML, CSVs, JSON, physical packet, source/application companions and ZIP |
| ensemble_results/ID/joint-decisions/REPORT_ID-selection.json | Exact original selection for that support-group edition |
| ensemble_reports/REPORT_ID/ | Existing native scalar report and source references |
| ensemble-products/ANALYSIS_ID/ | Existing paired raster product and retained native progress |

Reopening uses the same Workspace and saved ensemble ID. The immutable selection
and native source identity are checked before continuation. Completed decision
member files are verified before reuse. The whole scientific backup retains
these directories through the original portable inventory; the current driver
should inspect the same ensemble and open its decision index from the independent
restored project.

The same-design typed scientific report is owned by A74F and can consume the
prepared ensemble ID directly. Its normal ordered SourceReports composer remains
the source of printable assembled report editions.
