# Conservation portfolio to native experiment

This continuation connects a saved conservation portfolio to an exact land-cover
scenario and a paired NDR, SDR or combined experiment in the same Workspace.

For Tim: choose the land and its proposed cover change, then compare the same
models and parameters before and after that change.

## Operator path and input meaning

Open Conservation, finish a study, select its planning units and save the
portfolio. The saved selected_union GeoPackage is the scenario footprint.
This union already reflects the portfolio's original reporting-area selection.
Its source identities, selected unit IDs, geometry and byte hash are retained.

In the portfolio's scenario form:

1. Enter Title and Reason. These describe the actual proposed intervention and
   become part of the retained scenario selection.
2. Enter From land-cover codes and a replacement To code. Only matching original
   classes inside the saved footprint are edited. The native scenario kernel
   retains its rasterization and patch-order semantics.
3. Choose Save scenario, Prepare native run or Prepare paired experiment.
4. For a native run or experiment, choose a complete grid, a retained parameter
   profile and the native model families. The form can carry the study's actual
   baseline grid, profile and model choices forward.
5. For a paired experiment, use the resulting Open experiment action to inspect
   the prepared design. Run experiment uses the existing native operation queue.
   The experiment includes the matched baseline and portfolio land-cover case.

The grid supplies the model domain, original land-cover edition, prepared
physical inputs and reporting mask. The model domain must contain the entire
saved footprint. Reporting overlap is recorded separately, allowing a modeled
upstream intervention to be evaluated for a downstream reporting area.

The profile supplies the exact retained biophysical table and native algorithm
parameters. The source table is reopened and checked for the selected native
model families, original grid classes and all scenario replacement classes.
Additional retained profiles in an experiment receive the same checks.

The Models choice determines native work and available outputs:

| Models | Native outputs |
| --- | --- |
| ndr | nitrogen_export and phosphorus_export |
| sdr | sediment_export |
| ndr and sdr | all three outputs |

When Models is omitted, preparation uses the families supported by both the
chosen grid and profile. An explicit choice must be supported by both. A full
grid with an NDR-only profile therefore prepares NDR when the choice is omitted.
The full default selection keeps the original omitted-model ID convention.

## What is retained

A scenario uses the saved portfolio's source footprint without rebuilding or
simplifying its geometry. The independent copy helper retains its exact bytes.
The scenario's original collection, source mask, source URI, selected unit IDs,
study ID, plan ID and footprint hash stay connected.

Preparing a paired experiment chooses the original-landcover reference with
the same grid, parameter profile, native version and selected model families.
An explicitly supplied baseline must match that scope. Otherwise the original
study reference is reused when compatible, then other retained matching
baselines are considered. A new unchanged-landcover baseline is prepared only
when a suitable retained reference is absent.

The prepared baseline and alternative retain ordinary native run IDs. Their
experiment follows the existing parameter and scenario design engine. A
parameter exploration can reuse native stages through the shared cache when
one model's scientific inputs are unchanged.

Full default scenario selections preserve the original conservation bridge,
source collection, land-cover scenario and native run identities. Explicit
partial native choices receive their corresponding selected-model identities.
Preparing a later experiment is a continuation of the same scenario; changing
its experiment title, axes or profile set does not copy the footprint into a
different scenario merely to record the experiment.

## Exact Python and queue contracts

The current public entry points are:

    create_scenario(workspace, spec)
    prepare_experiment(workspace, spec)
    inspect_scenario(workspace, conservation_scenario_id)
    list_scenarios(workspace)

The existing conservation.scenario.create action continues to call
create_scenario. Its original fields remain plan_id, title, reason, from_codes,
to_code and optional prepare_run. prepare_run accepts grid_id, profile_id and
optional models, where models is a nonempty list containing ndr, sdr or both.

An optional prepare_experiment object on create_scenario prepares the paired
experiment immediately after the native scenario is saved. It is excluded from
the retained scenario identity and can be retried after an interruption.

The standalone queue action is conservation.experiment.prepare. It calls
prepare_experiment with:

- conservation_scenario_id: the saved conservation bridge ID returned by
  create_scenario, also available in list_scenarios.
- title and reason: optional experiment text; omitted values derive from the
  retained conservation scenario.
- baseline_run_id: optional matching original-landcover native run.
- prepare_run: optional grid_id, profile_id and models override for this
  experiment continuation.
- profile_ids: optional retained additional parameter profiles.
- scenario_ids: optional additional retained land-cover alternatives.
- design: one_at_a_time or factorial; one_at_a_time is the default.
- axes: optional explicit parameter paths, values and source references in the
  existing experiment engine format.

The paired portfolio scenario is always included alongside any additional
scenario IDs. Model-specific axes follow the selected baseline model families.
Use explicit source-supported values and parameter references for a sensitivity
design. The scenario and experiment APIs do not choose perturbation ranges.

A standalone continuation first uses its supplied prepare_run selection, then
the scenario's prepared run choice, then its supplied or original study baseline.
This makes an older scenario that was saved without a native run usable directly
when its current grid and profile are selected.

prepare_experiment returns top-level experiment_id, experiment,
conservation_scenario_id, plan_id, study_id, baseline_run_id and
alternative_run_id. It also returns models, pollutants, counts, primary_pair,
source_reference, run_coverage and retained file descriptors. primary_pair uses:

    {
      "profile_id": "retained profile ID",
      "baseline_run_id": "matched baseline ID",
      "alternative_run_id": "portfolio alternative ID",
      "scenario_id": "native land-cover scenario ID"
    }

The existing experiment.execute/experiment.run workflow calculates the full
design and produces its complete profile/scenario pair matrix for downstream
paired-raster and portfolio consumers.

create_scenario with prepare_experiment returns the same top-level identifiers
and an experiment_handoff object. The returned scenario id remains the
conservation bridge ID; scenario_id is the native land-cover scenario ID.

## Saved continuation and portable reopening

A continuation is stored under:

    conservation-scenarios/<conservation_scenario_id>/experiments/<handoff_id>/

selection.json retains the exact normalized experiment selection and original
portfolio source reference. handoff.json records preparation state, native pair
IDs and experiment ID. The link ID is derived from its source and normalized
selection. A repeat reopens the same native run and experiment identities.

The scenario is made durable before experiment preparation. If an interruption
occurs after source import or run preparation, repeating the same scenario
selection resumes its creation. If experiment preparation fails, its handoff
retains the error and the completed source/native preparations remain usable.
Repeating the standalone continuation retries the same experiment selection.

The operator overview can add scenario_bridges = list_scenarios(workspace).
This inventory reads saved metadata and includes every prepared experiment
handoff. A restored Workspace can therefore reopen a prepared experiment even
when the earlier operator task history belongs to another host.

All continuation references and retained files use Workspace-relative paths.
Scenario and handoff writes take the existing Workspace mutation lock, with
their own operation locks. The existing complete portable backup includes the
source objects, footprints, source views, parameter profiles, native runs,
experiment state and continuation metadata.

## CLI usage

Run these commands from the maintained application directory. The JSON files
contain actual selected IDs from that Workspace.

Create a scenario, optionally with its prepare_experiment object:

    python -B -m model.conservation_scenarios --workspace /owned/workspace scenario-selection.json

Continue an existing conservation scenario into its paired experiment:

    python -B -m model.conservation_scenarios --workspace /owned/workspace --experiment conservation-experiment-selection.json

Run or resume the returned experiment through the existing engine:

    python -B -m model.experiment_cli --workspace /owned/workspace run EXPERIMENT_ID

Inspect an exact case page or refresh the retained summary:

    python -B -m model.experiment_cli --workspace /owned/workspace inspect EXPERIMENT_ID --offset 0 --limit 100
    python -B -m model.experiment_cli --workspace /owned/workspace summary EXPERIMENT_ID

## Reading results

Use the matched native scenario comparison over the intended receiving/reporting
area to evaluate the intervention's effect. The plan's existing selected-parcel
quantities remain tied to the earlier full modeled scenarios from its study.
A transport-changing intervention can alter export outside the edited pixels;
the new native scenario recalculates that connected response.

The experiment retains common valid support, baseline and alternative quantities,
model families, parameter differences, source references and separate annual
units. Nitrogen and phosphorus are in kg/year; sediment is in metric_tonnes/year.
The current native raster adapter already performs its actual grid-area
conversion. A 300 m grid retains its corresponding native area through the same
adapter.

After running, use the experiment's paired maps and scenario report to compare
the portfolio choices. Descriptive parameter ranges show how the tested native
cases respond to the supplied values. Keep the selected profile, footprint and
reporting area visible when deciding which intervention to develop next.

## Source integration

Base conservation_scenarios.py is the exact 10,383-byte source
7d219c37ccd94094bf1e3355433ed12499a5aec389220cc7608d76140643ae6d
from E7A1 F0C8MS71HL6 and independently confirmed in the cumulative 252-file
application F0C8JNZTURK.

Base conservation_bindings.py is the exact 34,871-byte source
be59aef70c5a35c8e76e5a58d5b507ecb8a8833efad0d8a829bbebc0cdc9d49a
from the complete published-method/selected-output cohort F0C88M047RD.

The accompanying integration ledger gives exact guarded source edits for a
current application with additional peer changes. The full source retains the
original scenario/Workspace path and uses the experiment engine delivered in
operator v5 F0C8N2YCHHC. Independent native reuse and completed-stage assembly
are composed with shared source F0C8N3YVA5U and correction F0C8N5BDQLE.

Saved-scenario cards read the current retained experiment state and progress on each overview refresh. `preparation_state` and `prepared_at` preserve the handoff preparation history; nested `state`, `counts`, `progress`, and run timestamps describe the experiment as it stands now. One unavailable experiment record is reported on its own continuation card, while the other saved scenarios remain accessible.
