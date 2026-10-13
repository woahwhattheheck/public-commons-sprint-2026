# Native runoff references for the Upper Savannah study

The helper derives a reference mean from a completed native NDR baseline and saves ordinary parameter profiles for the current experiment engine. It uses the retained registry raster named "masked_runoff_proxy", after the native alignment and watershed mask. The original native raster, its companions, argument file, per-stage runtime and reuse lineage identify the calculation.

## Complete execution route

From the actual application directory, execute or resume a prepared baseline and derive the new profile:

    python -B -m model.runoff_reference \
      --workspace /path/to/original-workspace \
      --baseline-run-id ORIGINAL_BASELINE_RUN_ID \
      --execute-baseline \
      --profile-id ORIGINAL_PARAMETER_PROFILE_ID \
      --reason "Hold the original native watershed runoff reference across the study profiles." \
      --output /path/to/runoff-reference-result.json

Repeat --profile-id to derive several retained profiles from the same actual reference. Without that option the baseline's own parameter profile is selected. A completed NDR stage is sufficient to derive the reference when another selected model is still unfinished.

The result contains the complete retained reference, its actual mean and valid-cell count, and the saved profile IDs. The reference is retained under the workspace's runoff-references directory. Original profile files stay available; each derived profile is saved through Workspace.save_profile with the same source table, model selection, routing and biophysical settings, plus its explicit ndr.runoff_proxy_av.

## Study-wrapper API

    from model import experiments, runoff_reference

    reference = runoff_reference.from_run(workspace, original_baseline_run_id)
    derived = []
    for profile_id in actual_study_profile_ids:
        original = workspace._get("profiles", profile_id)
        profile = runoff_reference.save_profile(
            workspace, profile_id, reference,
            title="Fixed native runoff mean / " + original["title"],
            reason="Use the original native watershed runoff reference across the study.")
        derived.append(profile["id"])

    selection = {
        "schema": "upstate.experiment-selection/v1",
        "title": "Upper Savannah native profile and land-cover study",
        "reason": "Compare the retained study profiles and spatial alternatives.",
        "baseline_run_id": original_baseline_run_id,
        "profile_ids": derived,
        "scenario_ids": actual_retained_landcover_scenario_ids,
        "design": "factorial",
        "axes": [],
    }
    preview = experiments.preview(workspace, selection)
    experiment = experiments.prepare(workspace, selection)
    result = experiments.execute(workspace, experiment["id"])
    summary = experiments.read_summary(workspace, experiment["id"])

These are the actual current engine APIs in model/experiments.py from Canvas F0C8TFEQZUL, source SHA256 feb8e13c6ac00a8d9987d51f0cb1cdedd25d0e733613f7071b92c6f735b1127d. The engine includes the original reference profile and runs each selected profile's baseline before its land-cover alternatives. Run the wrapper with the combined NDR/SDR baseline used by the current full-output experiment engine.

## Meaning of the parameter

InVEST 3.20 uses RPI = RP / RP_average. The native automatic denominator is calculated from the aligned, watershed-masked raster. A positive uniform scaling c of a runoff raster cancels under automatic normalization because (c RP) / mean(c RP) = RP / mean(RP), apart from floating-point rounding.

For parameter sensitivity, ndr.runoff_proxy_av describes the selected normalization denominator. For a climate comparison, retain actual spatial runoff or precipitation sources for each period, in consistent units, and use the chosen baseline reference across those source selections. The current experiment engine keeps one baseline grid for its profile and land-cover cases; different climate grids therefore enter through their own normal core selections.

The helper always reports the computed masked-raster mean. It also preserves baseline_supplied_mean and baseline_effective_mean, so an original explicit denominator remains visible. The newly saved profile deliberately uses the computed masked-raster mean. When the original baseline used automatic normalization, this supplies the same physical reference. The method follows the raster's actual pixel geometry and works with both the regional 30 m grid and the original 300 m sample grid.

## Source and reduction

The implementation uses exactly the sum/count reducer, native raster_reduce defaults and mean division from InVEST 3.20's _normalize_raster. It retains the current derivation environment separately from the runtime that produced the original NDR stage. Repeated calls reuse the retained reference after checking its original source files and identities. Changes to the source raster or its companions during calculation are detected.

Native argument and runtime identities come from the NDR stage itself. This preserves their meaning when a later SDR execution updates the parent run runtime, or when the completed NDR stage was imported from another original run.

Primary references:

- InVEST 3.20 NDR source: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py
- Pinned source SHA256: 5c4353d9548af59d048c0ea14b39545e0f3e813d43371a93127e2f3cbc87508b
- NDR nutrient-load equations and user-supplied runoff mean: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html#nutrient-loads
- PyGeoprocessing raster_reduce: https://pygeoprocessing.readthedocs.io/en/latest/api/pygeoprocessing.html#pygeoprocessing.raster_reduce
