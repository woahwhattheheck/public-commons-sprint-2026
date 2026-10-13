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

## Completed-result recovery and reference editions

An unchanged completed continuation now returns the exact saved result before
calling the original timestamp-writing ensemble operation. It validates the
project, selected design, all original member/run/comparison identities, requested
paired-product coverage and the retained scalar/decision report descriptors.
The existing headwaters-results.json and original operation timestamps remain
unchanged. The returned legacy record is also unchanged; no reuse marker is
injected into an already published record.

A deliberately expanded request that adds paired products to an earlier
--without-raster-products result is a new product generation. Its previous
completed record is first retained unchanged under
headwaters-result-editions/RESULT_DIGEST.json, then the existing operation builds
or resumes the additional paired products. No complete native run is recalculated.
Ordinary partial/interrupted continuation preserves the first recorded started_at.

The receiving caller can inspect its useful completed reference group explicitly:

```python
from source_tools.headwaters_parameter_course import reference_report_basis
basis = reference_report_basis(ws, prepared["ensemble_id"], result)
if basis["reference_ready"]:
    # Exact original first profile, reference runs and all-alternative comparison.
    reference_runs = basis["reference_run_ids"]
    comparison_id = basis["comparison_id"]
```

New course results retain this object as reference_report_basis. The callable also
supports an unchanged older complete result. It reports the original first
member/profile and ordered baseline plus alternative run IDs, their retained
comparison, planned and compared profile counts, current native progress and the
course's actual pending member record. It does not change result.state or mark
unfinished sensitivity members complete.

The original ensemble_study_source.prepare can render an edition from actual
completed contrasts while retaining native_state, selected cases and pending
progress. The actual reference trio is also sufficient for the existing utility
comparison and mapped native delivery. A receiving caller may therefore publish
a clearly identified reference-complete edition while keeping the same larger
parameter design and its unfinished cases. That edition must have its own
source/archive/reopening scope. The existing full-course archive and cold reader
continue to require every original member and requested paired product complete;
reference readiness is not a bypass for those full-edition checks.

The receiving caller owns phase recovery across scientific source, review,
handover and archive. In particular, the scientific-source producer updates its
operation timestamp on a repeated prepare call. When resuming a previously
selected completed handover, reuse its exact retained source/phase checkpoint
before verifying its original archive binding; do not rebuild a completed source
under the same frozen binding. Preserve previously published archive bytes and
all original source/report identities.

For the same actual completed Workspace, the focused native receiving check is
an unchanged report-only continuation: retain the original result and ensemble
operation byte identities, call continue_course(..., execute=False), confirm the
same returned result and those unchanged files, then continue the existing
archive/reopening boundary. A partial reference edition additionally verifies its
actual three original runs and carries the complete saved plan and pending
records. No additional model solve is needed for either report continuation.

## Current owner direction — complete consumed brief

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
