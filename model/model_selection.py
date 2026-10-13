"""Explicit native model selections and their retained source/output requirements."""
from __future__ import annotations

from .common import (MODELS as MODEL_ORDER, MODEL_ROLES,
                     MODEL_OUTPUTS as NATIVE_OUTPUTS, selected_models,
                     required_roles as native_required_roles)

MODEL_LABELS = {"ndr": "Nutrient Delivery Ratio", "sdr": "Sediment Delivery Ratio"}
MODEL_OUTPUTS = {
    model: tuple(name for name, native in NATIVE_OUTPUTS.items() if native[0] == model)
    for model in MODEL_ORDER
}
OUTPUT_ORDER = tuple(NATIVE_OUTPUTS)
TABLE_FIELDS = {
    "ndr": ("lucode", "load_n", "load_p", "load_type_n", "load_type_p",
            "eff_n", "eff_p", "crit_len_n", "crit_len_p", "proportion_subsurface_n"),
    "sdr": ("lucode", "usle_c", "usle_p"),
}


def models(value=None, *, default=MODEL_ORDER):
    """Use the same model normalization as the maintained regional programme."""
    if value is None:
        value = list(default)
    return tuple(selected_models(value))


def selected(record, *, default=MODEL_ORDER):
    if not isinstance(record, dict):
        raise ValueError("Retain the complete native model selection")
    return models(record if "models" in record else None, default=default)


def normalize_selection(record, *, default=MODEL_ORDER):
    """Keep the historical complete-model identity when both models are selected."""
    result = dict(record)
    names = selected(result, default=default)
    if names == MODEL_ORDER:
        result.pop("models", None)
    else:
        result["models"] = list(names)
    return result, names


def required_roles(selection=None):
    return native_required_roles(models(selection))


def required_outputs(selection=None):
    wanted = set().union(*(MODEL_OUTPUTS[name] for name in models(selection)))
    return tuple(name for name in OUTPUT_ORDER if name in wanted)


def required_table_fields(selection=None):
    result = []
    for model in models(selection):
        for name in TABLE_FIELDS[model]:
            if name not in result:
                result.append(name)
    return tuple(result)


def grid_models(grid):
    return selected(grid["spec"])


def run_models(run):
    return selected(run["selection"])


def run_scope(run):
    selected_models = run_models(run)
    expected = required_outputs(selected_models)
    present = tuple(name for name in expected if name in run.get("artifacts", {}))
    completed = tuple(name for name in selected_models
                      if name in run.get("stages", {})
                      and all(item in present for item in MODEL_OUTPUTS[name]))
    return {
        "selected_models": list(selected_models),
        "native_stages_complete": [name for name in selected_models
                                   if run.get("stages", {}).get(name, {}).get("completed_at")],
        "completed_models": list(completed),
        "omitted_models": [name for name in MODEL_ORDER if name not in selected_models],
        "expected_artifacts": list(expected),
        "available_artifacts": list(present),
        "selected_models_complete": run.get("state") == "complete" and completed == selected_models,
        "full_model_outputs": run.get("state") == "complete" and completed == MODEL_ORDER,
    }


def validate_completed_run(run):
    scope = run_scope(run)
    if run.get("state") == "complete" and not scope["selected_models_complete"]:
        raise ValueError("Completed run lacks one of its selected native stages or original exports")
    return scope


def common_comparison_outputs(runs):
    if not runs:
        raise ValueError("Choose completed native model runs")
    available = set(OUTPUT_ORDER)
    for run in runs:
        scope = validate_completed_run(run)
        if not scope["selected_models_complete"]:
            raise ValueError("Finish the models selected for every compared run")
        available.intersection_update(scope["expected_artifacts"])
    if not available:
        raise ValueError("Compared runs must include at least one common native model")
    return tuple(name for name in OUTPUT_ORDER if name in available)


def require_complete_delivery(run):
    scope = validate_completed_run(run)
    if not scope["full_model_outputs"]:
        missing = [MODEL_LABELS[name] for name in MODEL_ORDER
                   if name not in scope["completed_models"]]
        raise ValueError("The complete seven-family delivery requires both native models. "
                         "Complete " + ", ".join(missing)
                         + " on the selected common grid/profile; retained selected-model "
                         "runs remain available in this workspace.")
    return scope
