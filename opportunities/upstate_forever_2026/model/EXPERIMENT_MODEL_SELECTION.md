# Native model selection in experiments

Experiments use the native models selected by their retained baseline run. The
maintained common.selected_models, required_roles and output_models functions
provide the model names, physical inputs and actual export names. Native
execution still goes through Workspace.prepare_run, Workspace.run and the
existing operator queue.

## Selection and identity

Choose baseline_run_id in the existing experiment selection. Its
selection.models determines the whole experiment. Omitted models means the
historical NDR and SDR selection; ["ndr"] selects nutrient exports and ["sdr"]
selects sediment export. Every derived profile/scenario run and its paired
baseline carry that same selection.

The full-model run-selection and experiment-plan documents keep their existing
fields and IDs. Partial selections retain models in each run selection and in
the plan's baseline descriptor. Native profiles and grids must include the
selected families. A full profile may be used by a single-model experiment.

NDR axes are available only for an NDR baseline, and SDR axes only for an SDR
baseline. Parameter values and their source or scientific rationale remain
operator supplied. Explicit alternative profiles must contain the baseline's
models. Their reported parameter changes cover the selected families and the
retained table identity.

## Public results

preview, inspect and summarize expose models and pollutants. Case selections
carry the exact native run request. NDR cases report nitrogen_export and
phosphorus_export; SDR cases report sediment_export. Paired totals, differences,
support groups and CSV rows use those actual outputs. The units come from the
delivered annual per-pixel mass artifacts.

summary.pairs retains the existing contract:

    {profile_id, baseline_run_id, alternative_run_id, scenario_id}

The summary's models and pollutants identify which output families those pairs
provide. Land-cover effects still pair each alternative with the baseline under
the same parameter profile, grid and selected native models.

supported_axes(models=None) returns control metadata filtered to those model
families. The CLI accepts axes --models ndr and axes --models sdr; omitting
--models returns both families.

## Native programme composition

expanded_cases(workspace, experiment_id, offset=0, limit=100) returns the same
indexed page as inspect: cases, total_cases, next_offset, offset, limit and
experiment state. Each case includes its ordinal, selection, run_id,
baseline_run_id, profile_id and scenario_id. Direct mixed-radix indexing avoids
deriving skipped profiles.

materialize_cases(workspace, experiment_id, offset=0, limit=None) is a streaming
Python iterator. Consuming it prepares the selected derived profiles and native
run records and yields each case with native_state. It performs no native model
execution. The optional window starts directly at its first requested ordinal;
omitting limit consumes all remaining cases. Completed case results remain
intact. Restarting the iterator reuses its retained profiles and run selections.

The generator releases the experiment lock before each yield, so a programme
can consume a case without holding an experiment mutation lock. Callers should
collect or dispatch only the work they actually consume, and use each yielded
run_id through the original native programme. Source-linked profile builders can
supply their retained IDs through the existing profile_ids selection.

After external programme execution, invoke the existing experiment run action.
It reuses completed native runs and computes the corresponding paired summaries.
Completed experiment cases are reused directly; an interrupted experiment
continues through unfinished cases.
