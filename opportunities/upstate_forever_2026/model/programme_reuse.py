"""Explicit original native candidates for Programme stage reuse.

These functions admit and retain candidates. The existing NativeInputMatcher
and stage cache decide model-specific equivalence and verify transferred files.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier, output_models
from .model_selection import run_models, validate_completed_run


def normalize_candidates(value):
    if not isinstance(value, (list, tuple)) or not value:
        raise ValueError("Select one or more original completed native run IDs for reuse comparison")
    result = [identifier(key) for key in value]
    if len(result) != len(set(result)):
        raise ValueError("Native reuse candidate IDs must be distinct")
    return result


def _completed_models(run, wanted):
    validate_completed_run(run)
    result = []
    for model in run_models(run):
        if model not in wanted:
            continue
        stage = run.get("stages", {}).get(model, {})
        required = {native_id for _, native_id in output_models([model]).values()}
        if model == "sdr":
            required.add("ls")
        if (stage.get("completed_at") and stage.get("arguments")
                and required.issubset(stage.get("files", {}))):
            result.append(model)
    return result


def candidate_bindings(workspace, run_ids, target_run_id, selected_models):
    """Bind immutable input selections; actual output reuse stays with native."""
    target_run_id = identifier(target_run_id)
    wanted = set(selected_models)
    result = []
    for key in normalize_candidates(run_ids):
        if key == target_run_id:
            raise ValueError("A native run cannot select itself as a reuse candidate")
        run = workspace.inspect_run(key)
        if run.get("id") != key or digest(run["selection"]) != key:
            raise ValueError("Original native reuse candidate identity changed: " + key)
        shared = [model for model in run_models(run) if model in wanted]
        if not _completed_models(run, wanted):
            raise ValueError("A reuse candidate needs an original completed selected native stage: " + key)
        # Bind immutable model scope. Later completion of another native stage
        # must not change an existing Programme's retained candidate selection.
        result.append({
            "run_id": key, "native_selection": deepcopy(run["selection"]),
            "models": shared})
    return result


def successor_candidates(workspace, original_binding, target_run_id, selected_models):
    """Offer existing completed originals; never prepare or run a candidate."""
    pool = [original_binding["run_id"]]
    pool.extend(original_binding.get("source_runs", {}).values())
    pool.extend(original_binding.get("reuse_source_run_ids", []))
    eligible, skipped = [], []
    for key in dict.fromkeys(pool):
        if key == target_run_id:
            continue
        run = workspace.inspect_run(identifier(key))
        if run.get("id") != key or digest(run["selection"]) != key:
            raise ValueError("Original Programme reuse source identity changed: " + key)
        if not _completed_models(run, selected_models):
            skipped.append({"run_id": key, "reason": "No original completed stage supplies a selected native model"})
            continue
        eligible.append(key)
    bindings = candidate_bindings(workspace, eligible, target_run_id, selected_models) if eligible else []
    return {"run_ids": eligible, "candidates": bindings, "skipped": skipped}
