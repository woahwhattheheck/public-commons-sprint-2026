# Experiment comparisons for upstream receiving areas

The comparison joins the native experiment engine's completed land-cover cases
to the source-water contributing-area inventory. Operators receive a single
printable report, detailed CSV and profile range table, with each profile linked
to its maps, HUC12 memberships and editable GeoPackage.

The experiment engine, receptor inventory and this adapter run in the same
scientific application and workspace. The adapter consumes completed NDR/SDR
physical output rasters. It can run in the GIS postprocessing environment after
native jobs complete without launching the native model queue again.

## Install in the cumulative application

Add model/receptor_experiments.py, model/receptor_experiment_cli.py and
model/RECEPTOR_EXPERIMENTS.md at the application root.

Required existing components:

- model/experiments.py and model/experiment_cli.py from ES-EXP-2319.
- model/receptor_network.py, model/receptors.py, model/receptor_cli.py and
  model/receptor_execution.py from
  the contributing-area component.
- Original model/common.py, model/workspace.py and retained source/grid/run
  data used by both components.

The operator may call receptor_experiments.plan(workspace, selection),
build(workspace, selection) or inspect(workspace, comparison_id) directly.
Each returned profile product points to its retained inventory and
workspace-relative files. The Source-water areas operator desk opens this same
component through the shared extension registry; its full controls, retained
tasks, reports and complete result ZIP are described in
operator/RECEPTORS_OPERATOR.md.

## Complete cohort and producing executions

Planning reads each completed selected case and its own profile's baseline
through the original Workspace. It resolves outputs common to that entire
completed cohort before comparing producing-stage versions. Each profile
inventory receives those same output names. Native run IDs, scenario IDs and
profile IDs stay attached to their original cases.

The maintained native-version helper gives each completed selected model stage
priority over an unrelated last-run runtime or requested declaration.
Compatibility is checked independently for NDR and SDR. A missing or
incompatible producing version is reported before this comparison is built.
Observed-run and requested-legacy fallback sources remain explicitly labeled.

The comparison identity includes the selected case snapshot and complete
producing-execution signature. Each group also checks that its inventory still
matches the planned native sources. Completed products and progress records
therefore reopen only for the same retained execution binding. Earlier saved
comparison IDs remain inspectable; collecting the original selection creates
a current separate edition when its producing sources or product revision
differ.

`native-execution.json` and the report table retain each original output
descriptor, run selection, model version, timestamp and reuse source.
The joined CSV carries the same sixteen provenance columns as the standalone
inventory, including both original raster hashes. Profile-range rows include
the producing model and version in their grouping and exported columns.
Whole-basin context columns continue to identify the original experiment case
snapshot; receiving-area quantities are read from the explicitly bound
physical rasters.

The source-water programme's existing **Collect comparison** action delegates
to this same planner and collector after its original completed-programme
synchronization. Its profile pairing and native execution service remain the
authoritative source of those runs.

## Build from a retained experiment

Create a selection JSON object with these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| experiment_id | Yes | Existing native experiment ID |
| receptor_spec | Yes | Complete receptor profile object, including anchors and original source references |
| title | No | Heading for the combined report |
| profile_ids | No | Selected profile IDs; omitted or empty means all profiles |
| scenario_ids | No | Selected land-cover scenario IDs; omitted or empty means all alternatives |
| delivery_ids_by_baseline | No | Map each own baseline run ID to its saved delivery ID for optional priority maps |

From the application directory, construct the selection using the retained
experiment ID and existing receptor profile file:

```python
import json
from pathlib import Path

experiment_id = "PASTE_RETAINED_EXPERIMENT_ID"
profile_path = Path("source/receptor-profiles/utility-focus-20261012.json")
selection = {
    "title": "Upper Savannah source-water scenario comparisons",
    "experiment_id": experiment_id,
    "receptor_spec": json.loads(profile_path.read_text(encoding="utf-8")),
}
Path("receptor-experiment-selection.json").write_text(
    json.dumps(selection, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
```

Use the installed scientific interpreter, such as /opt/pyvenv/bin/python when
that is the receiver's actual GIS environment:

```sh
python -B -m model.receptor_experiment_cli WORKSPACE plan receptor-experiment-selection.json
python -B -m model.receptor_experiment_cli WORKSPACE build receptor-experiment-selection.json
```

Plan reads all case pages and prints each profile's own baseline and completed
alternative run IDs. Build writes the products and prints actual IDs, states and
file paths. Open the returned directory's index.html to explore the comparison
using profile, scenario, receiving-area and pollutant filters. Tables also print.

The experiment ID is available from the installed experiment operator or
model.experiments.list_experiments(workspace). Select the experiment containing
the project's completed native baseline and chosen land-cover alternatives.

## Files and links

The combined comparison lives under:

    WORKSPACE/receptor-experiments/COMPARISON_ID/

| File | Content |
| --- | --- |
| index.html | Offline report with profile products, evaluated profile ranges and filterable comparisons |
| scenario-exports.csv | One row per profile, scenario, receiving area and pollutant, with experiment/case/run lineage |
| profile-ranges.csv | Minimum, median and maximum change across profiles for each area/scenario/pollutant |
| cases.csv | Every selected land-cover case and its current native state |
| groups.json | Each profile baseline, alternative IDs, inventory ID and file descriptors |
| snapshot.json | Every original experiment case, assembled in the engine's immutable case order |
| progress.json | Retained group completion records for an interrupted build |
| result.json | Saved comparison metadata, quantities, ranges and file descriptors |

Profile products remain under receptor-inventories/INVENTORY_ID/. Relative links
reach each profile's report, original memberships, scenario quantities and
GeoPackage. Model run raster bodies are reused in place.

Workspace backup includes both folders automatically. The original portable
backup traverses the workspace recursively and includes the model application
directory. Restore checks every archived member's bytes and hash. Keep the
comparison with its referenced profile inventories when transferring a partial
workspace; the complete workspace archive already does this.

Reopen the exact retained result:

```sh
python -B -m model.receptor_experiment_cli WORKSPACE inspect COMPARISON_ID
```

Add --full when a downstream consumer needs all records on stdout.
The compact output points to complete saved JSON and CSV files.

## Pairing and interpretation

The original experiment API supplies inspect(workspace, experiment_id,
offset=0, limit=100), cases, total_cases and next_offset. The adapter follows
next_offset until the full case count has been read. It checks immutable case
order and identifiers, then selects kind=landcover records.

Every completed case carries profile_id, baseline_run_id, run_id, scenario_id,
selection and original whole-basin metrics. Each group uses profile_id and its
own baseline_run_id. The actual baseline native run must use that profile and
the original-land-cover scenario. Alternative selections must match the
experiment record, and all selected cases share the original reporting grid.

A parameter-only case represents original land cover under a changed profile.
That run becomes the matching baseline for the profile's land-cover cases.
It remains in the complete snapshot; the land-cover report consumes the matching
baseline rather than pooling it with other profiles.

Detailed receiving-area quantities preserve:

- Complete valid-footprint baseline and alternative exports.
- Common-valid-footprint baseline and alternative exports.
- Alternative-minus-baseline change, reduction and percentage.
- Selected, baseline-valid, alternative-valid and common-valid pixel counts.
- Receiving-area common-valid coverage fraction.
- Original experiment case, profile, baseline, alternative and inventory IDs.
- Whole-basin metrics in separate basin_ columns, including the original valid
  support SHA-256. Unprefixed physical quantities describe the receiving area.

The common retained pollutant cohort determines each inventory's rows. A
completed NDR-only profile can report nitrogen and phosphorus; an SDR-only
profile can report sediment. Each group retains pollutants and run_pollutants
from the core inventory. Older saved inventories derive the available cohort
from their actual scenario_exports. The expected area/alternative/pollutant
rows use that real cohort. For a partial-model experiment, use the maintained engine edition that carries
its actual selected models into canonical case and paired-baseline identities.
The operator's direct-baseline mode can already consume completed NDR/SDR runs.

Physical units remain those recorded by the existing raster products. The
adapter applies no additional pixel-area multiplication. Negative change means
lower annual export. A percentage is blank for a zero baseline. Quantities are
blank when an area contains no common finite valid pixels.

A range row groups the same receiving area, retained scenario ID, pollutant and
unit across profiles. It counts profiles with quantities and those producing
lower, unchanged or higher export. The footprint flag compares original
whole-basin valid-pixel support signatures. Detailed coverage accompanies each
quantity. These are ranges over the explicitly evaluated choices.

Upstream receiving areas can overlap. Their individual quantities remain
separate. A combined geographic total requires a union of the selected land.
Scientific interpretation and anchor selection need expert review using the
retained source references and selected project methods.

## Progress and receiving

Completed groups are saved individually. An interrupted call can resume the
same selection, retain successful groups and retry unfinished ones. The
receptor builder reuses unchanged deterministic inventories.

When more native cases complete, repeat the selection. The changed case set
produces a new comparison snapshot; previous results remain available. A profile
that gains completed alternatives receives a new grouped inventory. Unchanged
profile selections reuse their existing products.

Build exit status 0 means all selected land-cover cases and profile groups are
complete. Status 2 means available groups and the report were retained while
native cases or group repairs remain. Status 1 identifies an input or operation
error. Group-specific errors appear in the saved report and CLI response while
other profile groups continue.

For the first native receiving run, compose the experiment and receptor modules,
select the actual existing experiment and receptor specification, then build
once. Inspect the resulting profile-to-baseline mapping and open the report.
Repeat only to continue unfinished work or receive newly completed native cases.

The operator's **Original watershed connections** mode receives the actual
original Esri JSON/GZIP/ZIP source before native rasters finish. It builds with
model.receptor_network_cli, saves original memberships and geometry, and offers
an ordered drainage-path inspector and complete linked source package. This
source-only entrypoint uses Python's standard library. Its saved specification
carries the original source collection and network entry into later native
comparisons. See operator/RECEPTORS_OPERATOR.md and model/RECEPTOR_NETWORK.md.

## Source basis

Written against ES-EXP-2319 source carrier F0C8MU63NB0, contributing-area
component revision 3 F0C8PMN99LJ, and original scientific workspace common and portable
interfaces. Native product IDs and physical quantities are produced by the
receiving workspace using its retained inputs.
