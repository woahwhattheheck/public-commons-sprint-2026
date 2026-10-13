"""Executed native-model versions, preserving retained per-stage provenance."""
from __future__ import annotations

from copy import deepcopy
from urllib.parse import quote
from .model_selection import MODEL_OUTPUTS, run_models

POLICY = "completed_stage_runtime_else_observed_run_else_labeled_requested_legacy"


def _text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def native_version(run):
    """Retain the historical run-level declaration and last observed runtime."""
    requested = _text(run.get("selection", {}).get("invest_version"))
    observed = _text((run.get("runtime") or {}).get("version"))
    return {"requested": requested, "observed": observed,
            "comparison_version": observed or requested,
            "basis": "observed_runtime" if observed else "requested_legacy" if requested else "unavailable",
            "differs_from_requested": bool(observed and requested and observed != requested)}


def model_versions(run, models=None):
    """Read each completed model's execution source before run-level fallbacks."""
    selected = tuple(models) if models is not None else run_models(run)
    run_version = native_version(run)
    result = {}
    for model in selected:
        if model not in MODEL_OUTPUTS:
            raise ValueError("Choose an original native model.")
        stage = (run.get("stages") or {}).get(model) or {}
        stage_version = _text((stage.get("runtime") or {}).get("version")) if stage.get("completed_at") else None
        effective = stage_version or run_version["comparison_version"]
        result[model] = {
            "model": model, "comparison_version": effective,
            "basis": "completed_stage_runtime" if stage_version else
                     "observed_run_fallback" if run_version["observed"] else run_version["basis"],
            "observed_stage_version": stage_version,
            "observed_run_version": run_version["observed"],
            "requested_version": run_version["requested"],
            "differs_from_requested": bool(effective and run_version["requested"] and
                                            effective != run_version["requested"]),
            "stage_completed_at": stage.get("completed_at"),
            "reused_from": deepcopy(stage.get("reused_from")),
        }
    return result


def models_for_outputs(outputs):
    selected = set(outputs)
    return tuple(model for model, names in MODEL_OUTPUTS.items() if selected.intersection(names))


def comparison_versions(runs, models):
    """Resolve a per-common-model cohort without flattening mixed executed stages."""
    if not runs:
        raise ValueError("Choose retained native runs for this comparison.")
    selected = tuple(models)
    if not selected:
        raise ValueError("Choose at least one common native model.")
    by_run = {run["id"]: model_versions(run, selected) for run in runs}
    baseline = by_run[runs[0]["id"]]
    for run_id, versions in by_run.items():
        for model in selected:
            value = versions[model]["comparison_version"]
            if not value:
                raise ValueError("Native " + model.upper() + " run " + run_id +
                                 " has no completed-stage, observed-run or retained requested version.")
            if value != baseline[model]["comparison_version"]:
                raise ValueError("Compared " + model.upper() + " execution versions differ: " +
                                 str(baseline[model]["comparison_version"]) + " versus " + str(value) +
                                 " for run " + run_id + ".")
    return {"policy": POLICY, "models": list(selected),
            "versions": {model: baseline[model]["comparison_version"] for model in selected},
            "runs": by_run}


def version_label(info):
    """Describe a retained version without turning a fallback into execution evidence."""
    info = info or {}
    version = _text(info.get("comparison_version"))
    if not version:
        return "InVEST version unavailable"
    basis = info.get("basis")
    descriptions = {
        "completed_stage_runtime": "completed stage runtime",
        "observed_run_fallback": "observed run runtime; stage version unavailable",
        "observed_runtime": "observed run runtime",
        "requested_legacy": "requested legacy version; execution version unavailable",
    }
    description = descriptions.get(basis, "retained version; source basis unavailable")
    requested = _text(info.get("requested_version")) or _text(info.get("requested"))
    if requested and requested != version:
        description += "; requested " + requested
    return "InVEST " + version + " (" + description + ")"


def guide_url(model, info):
    """Return the model guide for the retained comparison version, when available."""
    if model not in MODEL_OUTPUTS:
        raise ValueError("Choose an original native model.")
    version = _text((info or {}).get("comparison_version"))
    if not version:
        return None
    return ("https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/" +
            quote(version, safe="") + "/userguide/en/" + model + ".html")


def run_label(run):
    """Keep each selected model's version and source basis visible in one label."""
    return "; ".join(model.upper() + ": " + version_label(info)
                     for model, info in model_versions(run).items())


def run_comparison_identity(runs):
    """Use the producing runtimes and common output scope of completed runs."""
    from .model_selection import common_comparison_outputs
    if len(runs) < 2 or len({run["id"] for run in runs}) != len(runs):
        raise ValueError("Select a baseline and distinct original alternative runs")
    if any(run.get("state") != "complete" for run in runs):
        raise ValueError("Finish the selected original native comparison runs")
    if any(run["selection"]["grid_id"] != runs[0]["selection"]["grid_id"] for run in runs[1:]):
        raise ValueError("Run comparison requires the same retained reporting/model grid")
    outputs = common_comparison_outputs(runs)
    versions = comparison_versions(runs, models_for_outputs(outputs))
    return {"runs": [run["id"] for run in runs], "direction": "alternative minus baseline",
            "native_version_provenance": versions}


def validate_run_comparison(workspace, comparison, *, expected_id=None):
    """Validate current and original legacy comparison identities without rerunning models."""
    from .common import digest, identifier
    from .model_selection import common_comparison_outputs
    if "source_refresh_context" in comparison:
        from .source_refresh_comparison import validate
        return validate(workspace, comparison, expected_id=expected_id)
    if (comparison.get("schema") != "upstate.run-comparison/v1"
            or comparison.get("direction") != "alternative minus baseline"):
        raise ValueError("Select the retained alternative-minus-baseline comparison")
    key = identifier(comparison.get("id"))
    if expected_id is not None and key != identifier(expected_id):
        raise ValueError("The original comparison identity differs")
    ids = [identifier(comparison.get("baseline_run_id"))] + [
        identifier(item.get("run_id")) for item in comparison.get("alternatives", [])]
    runs = [workspace.inspect_run(run_id) for run_id in ids]
    identity = run_comparison_identity(runs)
    outputs = list(common_comparison_outputs(runs))
    if "native_version_provenance" in comparison:
        if (comparison["native_version_provenance"] != identity["native_version_provenance"]
                or comparison.get("common_artifacts") != outputs):
            raise ValueError("The retained comparison's native version or output scope changed")
    else:
        # Legacy records retain their exact original IDs; their producing models
        # must still be compatible through the same current runtime resolver.
        identity.pop("native_version_provenance")
        if "common_artifacts" in comparison and comparison["common_artifacts"] != outputs:
            raise ValueError("The original comparison output scope changed")
    if digest(identity) != key:
        raise ValueError("The original native comparison changed its run cohort")
    for alternative, run in zip(comparison["alternatives"], runs[1:]):
        if (alternative.get("selection") != run["selection"]
                or set(alternative.get("artifacts", {})) != set(outputs)):
            raise ValueError("The native comparison differs from its original run or output selection")
    return comparison
