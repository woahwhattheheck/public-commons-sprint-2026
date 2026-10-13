"""Source-bound scenario and parameter experiments using original native runs.

A case is one profile/scenario selection. Land-cover effects always use the
baseline scenario under that same profile. Parameter cases use the selected
original baseline as their reference. Completed native runs and case summaries
are reused; a subsequent execute call retries unfinished cases.
"""
from __future__ import annotations

from bisect import bisect_right
import copy
import csv
import hashlib
import io
import itertools
import json

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, held, identifier, now, read_json,
                     verify_file, selected_models, required_roles, output_models)
from .profiles import NDR_KEYS, SDR_KEYS, checked_parameters
from . import rasters
from .native_versions import model_versions, comparison_versions
from .native_execution import storage_exhausted

SELECTION_SCHEMA = "upstate.experiment-selection/v1"
PLAN_SCHEMA = "upstate.experiment-plan/v1"
STATE_SCHEMA = "upstate.experiment/v1"
CASE_SCHEMA = "upstate.experiment-case/v1"
SUMMARY_SCHEMA = "upstate.experiment-summary/v1"

SUPPORTED_AXES = {
    "ndr.threshold_flow_accumulation": {"label": "NDR stream threshold", "units": "upstream cells", "rule": "positive"},
    "ndr.k_param": {"label": "NDR connectivity shape", "units": "dimensionless", "rule": "positive"},
    "ndr.flow_dir_algorithm": {"label": "NDR flow direction", "units": "algorithm", "values": ["mfd", "d8"]},
    "ndr.subsurface_critical_length_n": {"label": "N subsurface critical length", "units": "m", "rule": "positive"},
    "ndr.subsurface_eff_n": {"label": "N subsurface retention efficiency", "units": "fraction", "minimum": 0, "maximum": 1},
    "ndr.runoff_proxy_av": {"label": "NDR runoff-proxy average", "units": "input runoff-proxy units", "rule": "positive or null for native mean"},
    "sdr.threshold_flow_accumulation": {"label": "SDR stream threshold", "units": "upstream cells", "rule": "positive"},
    "sdr.k_param": {"label": "SDR connectivity shape", "units": "dimensionless", "rule": "positive"},
    "sdr.flow_dir_algorithm": {"label": "SDR flow direction", "units": "algorithm", "values": ["mfd", "d8"]},
    "sdr.sdr_max": {"label": "Maximum sediment delivery ratio", "units": "fraction", "minimum": 0, "maximum": 1},
    "sdr.ic_0_param": {"label": "SDR connectivity midpoint", "units": "dimensionless", "rule": "finite"},
    "sdr.l_max": {"label": "Maximum RUSLE L-factor", "units": "dimensionless", "rule": "positive"},
}


def _retain_model_choice(value, models):
    """Match the maintained native selector's historical full-model identity."""
    if list(models) == selected_models():
        value.pop("models", None)
    else:
        value["models"] = list(models)


def _profile_models(profile, models):
    missing = set(models) - set(selected_models(profile))
    if missing:
        raise ValueError("Select a profile containing the reference models: " + ", ".join(sorted(missing)))
    for model in models:
        if not isinstance(profile.get(model), dict):
            raise ValueError("The selected profile lacks its " + model.upper() + " parameters")
    return profile


def supported_axes(models=None):
    """Parameter controls for the selected native model families."""
    families = set(selected_models(models))
    return {path: copy.deepcopy(metadata) for path, metadata in SUPPORTED_AXES.items()
            if path.split(".", 1)[0] in families}


def _nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _ids(value, label):
    if not isinstance(value, list):
        raise ValueError(label + " must be a list")
    result = []
    for item in value:
        item = identifier(item)
        if item not in result:
            result.append(item)
    return result


def _parameter(profile, path):
    model, name = path.split(".", 1)
    return profile[model].get(name)


def _apply(profile, changes):
    value = copy.deepcopy(profile)
    for path, selected in changes.items():
        model, name = path.split(".", 1)
        if selected is None and path == "ndr.runoff_proxy_av":
            value[model].pop(name, None)
        else:
            value[model][name] = selected
    value.update(checked_parameters(value))
    return value



def _source_profile_in_design(workspace, selection, base, profile_id, models):
    """Match one retained source profile without expanding a factorial design."""
    profile = _profile_models(workspace._get("profiles", profile_id), models)
    if profile_id in {base["id"], *selection["profile_ids"]}:
        return True
    axes = selection["axes"]
    overrides = {axis["path"]: _parameter(profile, axis["path"])
                 for axis in axes
                 if _parameter(profile, axis["path"]) != _parameter(base, axis["path"])}
    if not overrides or _derived_profile(base, overrides, axes)["id"] != profile_id:
        return False
    return next(_matching_raw_positions(selection, base, overrides), None) is not None


def _source_binding(run, canonical_selection):
    """Freeze a complete original source under its actual immutable run identity."""
    original = run["selection"]
    if run.get("id") != digest(original):
        raise ValueError("The retained native source selection differs from its run ID")
    if run.get("state") != "complete":
        raise ValueError("Complete a noncanonical original source before adopting it into an experiment")
    models = selected_models(original)
    versions = model_versions(run, models)
    if any(row["comparison_version"] != INVEST_VERSION for row in versions.values()):
        raise ValueError("Every adopted producing model must use the supported native version "
                         + INVEST_VERSION + "; inspect the original completed-stage provenance")
    artifacts = {}
    for name in output_models(models):
        artifact = run.get("artifacts", {}).get(name)
        if (not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str)
                or type(artifact.get("bytes")) is not int or artifact["bytes"] < 1):
            raise ValueError("The completed native source lacks its original " + name + " descriptor")
        identifier(artifact.get("sha256"))
        artifacts[name] = copy.deepcopy(artifact)
    return {
        "schema": "upstate.experiment-native-source/v1",
        "canonical_run_id": digest(canonical_selection),
        "run_id": run["id"], "selection": copy.deepcopy(original),
        "models": list(models),
        "producing_versions": {model: versions[model]["comparison_version"] for model in models},
        "artifacts": artifacts,
    }


def _source_runs(workspace, selection, baseline, base):
    """Resolve explicit source cells once; ordinary canonical identities stay unchanged."""
    models = selected_models(baseline["selection"])
    allowed_scenarios = {baseline["selection"]["scenario_id"], *selection["scenario_ids"]}
    sources = {baseline["id"]: baseline}
    for key in _ids(selection.get("source_run_ids", []), "Original source run IDs"):
        if key not in sources:
            sources[key] = workspace.inspect_run(key)
    seen, retained = {}, []
    for key, run in sources.items():
        original = run["selection"]
        if (digest(original) != key
                or original["grid_id"] != baseline["selection"]["grid_id"]
                or selected_models(original) != models
                or original["scenario_id"] not in allowed_scenarios
                or not _source_profile_in_design(
                    workspace, selection, base, original["profile_id"], models)):
            raise ValueError("An original source run is outside the selected experiment's grid, models or cases: " + key)
        canonical_selection = _run_selection(
            original["grid_id"], original["profile_id"], original["scenario_id"], models)
        canonical_id = digest(canonical_selection)
        if canonical_id in seen and seen[canonical_id] != key:
            raise ValueError("Choose one original native source for each experiment profile/scenario case")
        seen[canonical_id] = key
        if key != canonical_id:
            retained.append(_source_binding(run, canonical_selection))
    return sorted(retained, key=lambda row: row["canonical_run_id"])


def _validate_sources(workspace, plan):
    """Reopen the exact saved originals without changing a retained plan or source."""
    selected = plan["selection"]
    retained = plan.get("source_runs", [])
    if not retained and "source_run_ids" not in selected:
        return
    baseline = workspace.inspect_run(plan["baseline"]["run_id"])
    base = workspace._get("profiles", plan["baseline"]["profile_id"])
    actual = _source_runs(workspace, selected, baseline, base)
    if (not retained or actual != retained
            or selected.get("source_run_ids") != sorted(row["run_id"] for row in actual)):
        raise ValueError("The experiment's frozen original source bindings differ from the retained runs")


def _adopted_selection(plan, canonical_selection):
    key = digest(canonical_selection)
    for source in plan.get("source_runs", []):
        if source["canonical_run_id"] == key:
            return copy.deepcopy(source["selection"]), copy.deepcopy(source)
    return canonical_selection, None


def _normalise(workspace, selected):
    if not isinstance(selected, dict):
        raise ValueError("Supply an experiment selection object")
    unknown = set(selected) - {"schema", "title", "reason", "baseline_run_id",
                               "scenario_ids", "profile_ids", "design", "axes", "source_run_ids"}
    if unknown:
        raise ValueError("Unknown experiment fields: " + ", ".join(sorted(unknown)))
    if selected.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Select an upstate.experiment-selection/v1 document")
    baseline = workspace.inspect_run(identifier(selected.get("baseline_run_id")))
    base_selection = baseline["selection"]
    models = selected_models(base_selection)
    if base_selection.get("invest_version") != INVEST_VERSION:
        _source_binding(baseline, _run_selection(
            base_selection["grid_id"], base_selection["profile_id"],
            base_selection["scenario_id"], models))
    grid = workspace.get_grid(base_selection["grid_id"])
    if not set(models).issubset(selected_models(grid["spec"])):
        raise ValueError("The reference run selects native models outside its retained grid")
    missing_roles = set(required_roles(models)) - set(grid["files"])
    if missing_roles:
        raise ValueError("The reference grid lacks selected model inputs: " + ", ".join(sorted(missing_roles)))
    base_profile = workspace._get("profiles", base_selection["profile_id"])
    _profile_models(base_profile, models)
    base_scenario = workspace._get("scenarios", base_selection["scenario_id"])
    if base_scenario["kind"] != "baseline":
        raise ValueError("The experiment reference must use the original land-cover baseline")
    scenario_ids = _ids(selected.get("scenario_ids", []), "Scenario IDs")
    for key in scenario_ids:
        value = workspace._get("scenarios", key)
        if value["kind"] != "landcover":
            raise ValueError("Experiment alternatives must be explicit retained land-cover scenarios")
    profile_ids = _ids(selected.get("profile_ids", []), "Profile IDs")
    profile_ids = [key for key in profile_ids if key != base_profile["id"]]
    for key in profile_ids:
        _profile_models(workspace._get("profiles", key), models)
    design = selected.get("design", "one_at_a_time")
    if design not in ("one_at_a_time", "factorial"):
        raise ValueError("Experiment design must be one_at_a_time or factorial")
    axes = selected.get("axes", [])
    if not isinstance(axes, list):
        raise ValueError("Parameter axes must be a list")
    normal_axes, seen = [], set()
    for axis in axes:
        if not isinstance(axis, dict) or set(axis) != {"path", "values", "reference"}:
            raise ValueError("Each parameter axis needs path, values and reference")
        path = axis["path"]
        if not isinstance(path, str) or path not in SUPPORTED_AXES:
            raise ValueError("Select an existing NDR or SDR native parameter")
        if path.split(".", 1)[0] not in models:
            raise ValueError(path + " does not belong to the reference run's selected models")
        if path in seen:
            raise ValueError("Parameter axes must have distinct paths")
        seen.add(path)
        reference = _nonempty(axis["reference"], "Parameter source or scientific rationale")
        if not isinstance(axis["values"], list) or not axis["values"]:
            raise ValueError("Supply explicit values for " + path)
        values, tokens = [], set()
        for raw in axis["values"]:
            value = _parameter(_apply(base_profile, {path: raw}), path)
            # Signed zeros select the same native value; retain their first spelling.
            token = canonical(0.0 if isinstance(value, float) and value == 0 else value)
            if token not in tokens:
                values.append(value)
                tokens.add(token)
        normal_axes.append({"path": path, "values": values, "reference": reference})
    normal_axes.sort(key=lambda item: item["path"])
    selection = {
        "schema": SELECTION_SCHEMA,
        "title": _nonempty(selected.get("title"), "Experiment title"),
        "reason": _nonempty(selected.get("reason"), "Experiment purpose"),
        "baseline_run_id": baseline["id"], "scenario_ids": scenario_ids,
        "profile_ids": profile_ids, "design": design, "axes": normal_axes,
    }
    requested_sources = _ids(selected.get("source_run_ids", []), "Original source run IDs")
    if requested_sources:
        selection["source_run_ids"] = requested_sources
    sources = _source_runs(workspace, selection, baseline, base_profile)
    if sources:
        selection["source_run_ids"] = sorted(row["run_id"] for row in sources)
    else:
        selection.pop("source_run_ids", None)
    # This also rejects nonfinite values in retained metadata before publication.
    canonical(selection)
    return selection, baseline, base_profile, base_scenario


def _changes(base, alternative, models=None):
    result = []
    families = set(selected_models(models))
    for model, names in (("ndr", NDR_KEYS), ("sdr", SDR_KEYS)):
        if model not in families:
            continue
        for name in sorted(names):
            before, after = base.get(model, {}).get(name), alternative.get(model, {}).get(name)
            if before != after:
                result.append({"path": model + "." + name, "before": before, "value": after})
    if base["table_summary"]["sha256"] != alternative["table_summary"]["sha256"]:
        result.append({"path": "biophysical_table_sha256",
                       "before": base["table_summary"]["sha256"],
                       "value": alternative["table_summary"]["sha256"]})
    return result


def _parameter_sets(selection, base):
    axes = selection["axes"]
    if not axes:
        return
    if selection["design"] == "one_at_a_time":
        for axis in axes:
            for value in axis["values"]:
                if value != _parameter(base, axis["path"]):
                    yield {axis["path"]: value}
    else:
        paths = [axis["path"] for axis in axes]
        for combination in itertools.product(*(axis["values"] for axis in axes)):
            changes = {path: value for path, value in zip(paths, combination)
                       if value != _parameter(base, path)}
            if changes:
                yield changes


def _derived_profile(base, overrides, axes):
    value = _apply(base, overrides)
    for name in ("id", "schema"):
        value.pop(name, None)
    labels = [path + "=" + json.dumps(selected, ensure_ascii=False)
              for path, selected in sorted(overrides.items())]
    value["title"] = base["title"] + " / " + "; ".join(labels)
    selected_axes = {axis["path"]: axis for axis in axes}
    references = copy.deepcopy(base["references"])
    if not isinstance(references, list):
        references = [references]
    derivation = []
    for path, selected in sorted(overrides.items()):
        reference = selected_axes[path]["reference"]
        if reference not in references:
            references.append(reference)
        derivation.append({"path": path, "before": _parameter(base, path),
                           "value": selected, "reference": reference})
    value["references"] = references
    value["experiment_derivation"] = {"base_profile_id": base["id"],
                                      "parameters": derivation}
    key = digest({**value, "schema": "upstate.profiles/v1"})
    return {"id": key, "profile": value, "derived": True, "changes": derivation}


def _profiles(workspace, selection, base, models=None):
    # Normalized axis values are unique. OAT choices and factorial combinations
    # therefore yield unique derived selections without retaining the matrix.
    retained_ids = {base["id"], *selection["profile_ids"]}
    yield {"id": base["id"], "profile": base, "derived": False, "changes": []}
    for key in selection["profile_ids"]:
        profile = workspace._get("profiles", key)
        yield {"id": key, "profile": profile, "derived": False,
               "changes": _changes(base, profile, models)}
    for overrides in _parameter_sets(selection, base):
        option = _derived_profile(base, overrides, selection["axes"])
        if option["id"] not in retained_ids:
            yield option



def _matching_raw_positions(selection, base, overrides):
    """Positions that yield these exact overrides in the original generator."""
    axes = selection["axes"]
    if not axes:
        return
    if selection["design"] == "one_at_a_time":
        offset = 0
        if len(overrides) > 1:
            return
        for axis in axes:
            path = axis["path"]
            if not overrides:
                for index, value in enumerate(axis["values"]):
                    if value == _parameter(base, path):
                        yield offset + index
            elif path in overrides:
                token = canonical(overrides[path])
                for index, value in enumerate(axis["values"]):
                    if canonical(value) == token:
                        yield offset + index
            offset += len(axis["values"])
        return
    choices = []
    for axis in axes:
        path = axis["path"]
        if path in overrides:
            token = canonical(overrides[path])
            indexes = [i for i, value in enumerate(axis["values"]) if canonical(value) == token]
        else:
            indexes = [i for i, value in enumerate(axis["values"])
                       if value == _parameter(base, path)]
        if not indexes:
            return
        choices.append(indexes)
    # These are matching positions, not the full design product. In particular,
    # signed-zero aliases of unchanged values retain their original positions.
    for selected in itertools.product(*choices):
        position = 0
        for index, axis in zip(selected, axes):
            position = position * len(axis["values"]) + index
        yield position


def _indexed_design(workspace, selection, base, models=None):
    """Count a design and locate profile ordinals without expanding its matrix."""
    retained = [{"id": base["id"], "profile": base, "derived": False, "changes": []}]
    for key in selection["profile_ids"]:
        profile = workspace._get("profiles", key)
        retained.append({"id": key, "profile": profile, "derived": False,
                         "changes": _changes(base, profile, models)})
    axes = selection["axes"]
    if selection["design"] == "one_at_a_time":
        raw_count = sum(len(axis["values"]) for axis in axes)
    else:
        raw_count = 1 if axes else 0
        for axis in axes:
            raw_count *= len(axis["values"])
    excluded = set(_matching_raw_positions(selection, base, {}))
    for option in retained[1:]:
        # Matching fields alone do not establish profile identity. Reconstruct
        # the exact existing title/references/table lineage and match its digest.
        overrides = {axis["path"]: _parameter(option["profile"], axis["path"])
                     for axis in axes
                     if _parameter(option["profile"], axis["path"]) != _parameter(base, axis["path"])}
        if not overrides:
            continue
        if selection["design"] == "one_at_a_time" and len(overrides) != 1:
            continue
        candidate = _derived_profile(base, overrides, axes)
        if candidate["id"] != option["id"]:
            continue
        excluded.update(_matching_raw_positions(selection, base, overrides))
    excluded = sorted(excluded)
    return {"retained": retained, "excluded": excluded, "raw_count": raw_count,
            "count": len(retained) + raw_count - len(excluded),
            "selection": selection, "base": base}


def _surviving_raw_position(index, excluded):
    """Select a raw position by rank among positions outside a sparse set."""
    low, high = index, index + len(excluded)
    while low < high:
        middle = (low + high) // 2
        through = middle + 1 - bisect_right(excluded, middle)
        if through > index:
            high = middle
        else:
            low = middle + 1
    return low


def _indexed_profile(layout, index):
    if index < 0 or index >= layout["count"]:
        raise IndexError("Experiment profile index is outside the selected design")
    retained = layout["retained"]
    if index < len(retained):
        return retained[index]
    position = _surviving_raw_position(index - len(retained), layout["excluded"])
    selection, base = layout["selection"], layout["base"]
    axes = selection["axes"]
    if selection["design"] == "one_at_a_time":
        for axis in axes:
            if position < len(axis["values"]):
                overrides = {axis["path"]: axis["values"][position]}
                break
            position -= len(axis["values"])
        else:
            raise ValueError("Experiment index differs from its selected axes")
    else:
        overrides = {}
        for axis in reversed(axes):
            position, level = divmod(position, len(axis["values"]))
            value = axis["values"][level]
            if value != _parameter(base, axis["path"]):
                overrides[axis["path"]] = value
    return _derived_profile(base, overrides, axes)


def preview(workspace, selection):
    selection, baseline, base, _ = _normalise(workspace, selection)
    models = selected_models(baseline["selection"])
    profile_count = _indexed_design(workspace, selection, base, models)["count"]
    case_count = profile_count * (1 + len(selection["scenario_ids"]))
    warnings = []
    if selection["design"] == "one_at_a_time" and len(selection["axes"]) > 1:
        warnings.append("One-at-a-time results describe individual parameter changes; interactions require a factorial design.")
    if not selection["axes"] and not selection["profile_ids"] and not selection["scenario_ids"]:
        warnings.append("This selection contains the reference baseline only.")
    for axis in selection["axes"]:
        if all(value == _parameter(base, axis["path"]) for value in axis["values"]):
            warnings.append(axis["path"] + " contains only the current value and creates no additional profile.")
    reference = {"run_id": baseline["id"], "profile_id": base["id"],
                 "scenario_id": baseline["selection"]["scenario_id"],
                 "grid_id": baseline["selection"]["grid_id"]}
    _retain_model_choice(reference, models)
    sources = _source_runs(workspace, selection, baseline, base)
    return {
        **({"source_runs": sources} if sources else {}),
        "schema": "upstate.experiment-preview/v1", "selection": selection,
        "baseline": reference, "models": list(models),
        "pollutants": list(output_models(models)),
        "counts": {"profiles": profile_count, "runs": case_count, "cases": case_count},
        "axis_values": [{**axis, "baseline_value": _parameter(base, axis["path"]),
                         "metadata": copy.deepcopy(SUPPORTED_AXES[axis["path"]])}
                        for axis in selection["axes"]],
        "warnings": warnings,
    }


def _directory(workspace, key):
    return workspace.root / "experiments" / identifier(key)


def _plan(workspace, key):
    directory = _directory(workspace, key)
    plan = read_json(directory / "plan.json")
    if (plan.get("schema") != PLAN_SCHEMA or digest(plan) != key
            or plan.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The experiment selection differs from the retained workspace")
    reference = workspace.inspect_run(plan["baseline"]["run_id"])
    selected = reference["selection"]
    if (any(selected[name] != plan["baseline"][name]
            for name in ("grid_id", "profile_id", "scenario_id"))
            or (selected.get("invest_version") != INVEST_VERSION
                and reference["id"] not in plan["selection"].get("source_run_ids", []))):
        raise ValueError("The experiment reference differs from its retained native selection")
    _validate_sources(workspace, plan)
    active = selected_models(selected)
    if ("models" in plan["baseline"]
            and selected_models(plan["baseline"]) != active):
        raise ValueError("The experiment reference native models differ from its retained selection")
    if active != ["ndr", "sdr"]:
        # Recover old partial-model plans in memory while retaining their
        # immutable original plan bytes, experiment ID, and generated case IDs.
        plan["_legacy_case_ids"] = "models" not in plan["baseline"]
        plan["baseline"] = {**plan["baseline"], "models": active}
    return plan


def _state(workspace, key):
    value = read_json(_directory(workspace, key) / "state.json")
    return _check_state(workspace, key, value)


def _check_state(workspace, key, value):
    """Use the same original checkpoint identity in full and catalogue reads."""
    if (value.get("schema") != STATE_SCHEMA or value.get("id") != key
            or value.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The retained experiment state belongs to another selection")
    return value


def prepare(workspace, selection):
    proposed = preview(workspace, selection)
    plan = {"schema": PLAN_SCHEMA, "workspace_id": workspace.project["id"],
            "selection": proposed["selection"], "baseline": proposed["baseline"],
            "counts": proposed["counts"]}
    if proposed.get("source_runs"):
        plan["source_runs"] = proposed["source_runs"]
    key = digest(plan)
    directory = _directory(workspace, key)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".experiment.lock", blocking=False):
        atomic_json(directory / "plan.json", plan, immutable=True)
        path = directory / "state.json"
        if path.exists():
            return _state(workspace, key)
        created = now()
        value = {
            "schema": STATE_SCHEMA, "id": key, "workspace_id": workspace.project["id"],
            "title": plan["selection"]["title"], "selection": plan["selection"],
            "models": proposed["models"], "pollutants": proposed["pollutants"],
            "counts": plan["counts"], "state": "prepared",
            "progress": {"complete": 0, "failed": 0, "pending": plan["counts"]["cases"],
                         "active_case_id": None},
            "created_at": created, "updated_at": created, "files": {},
        }
        atomic_json(path, value)
        return value


def _run_selection(grid_id, profile_id, scenario_id, models=None):
    value = {"schema": "upstate.run-selection/v1", "grid_id": grid_id,
             "profile_id": profile_id, "scenario_id": scenario_id,
             "invest_version": INVEST_VERSION}
    _retain_model_choice(value, selected_models(models))
    return value


def _case_definition(plan, option, scenario, ordinal):
    baseline = plan["baseline"]
    models = selected_models(baseline)
    baseline_selection, baseline_source = _adopted_selection(plan, _run_selection(
        baseline["grid_id"], option["id"], baseline["scenario_id"], models))
    own_baseline = digest(baseline_selection)
    is_baseline = scenario["id"] == baseline["scenario_id"]
    kind = ("reference" if option["id"] == baseline["profile_id"] else "parameter") if is_baseline else "landcover"
    run_selection, native_source = _adopted_selection(
        plan, _run_selection(baseline["grid_id"], option["id"], scenario["id"], models))
    run_id = digest(run_selection)
    paired_baseline = baseline["run_id"] if is_baseline else own_baseline
    if is_baseline:
        baseline_source = next((copy.deepcopy(row) for row in plan.get("source_runs", [])
                                if row["run_id"] == paired_baseline), None)
    adopted = {}
    if native_source is not None:
        adopted["native_source"] = native_source
    if baseline_source is not None:
        adopted["native_baseline_source"] = baseline_source
    identity = {"run_id": run_id, "baseline_run_id": paired_baseline, "kind": kind}
    original = {}
    case_identity = identity
    if plan.get("_legacy_case_ids"):
        source_selection = _run_selection(baseline["grid_id"], option["id"], scenario["id"])
        source_baseline = (baseline["run_id"] if is_baseline else digest(_run_selection(
            baseline["grid_id"], option["id"], baseline["scenario_id"])))
        case_identity = {"run_id": digest(source_selection),
                         "baseline_run_id": source_baseline, "kind": kind}
        original = {"source_run_id": case_identity["run_id"],
                    "source_baseline_run_id": source_baseline,
                    "source_selection": source_selection}
    return {
        "schema": CASE_SCHEMA, "id": digest(case_identity), "ordinal": ordinal,
        **identity, **original, **adopted, "profile_id": option["id"], "profile_title": option["profile"]["title"],
        "scenario_id": scenario["id"], "scenario_title": scenario["title"],
        "selection": run_selection, "models": list(models),
        "pollutants": list(output_models(models)), "state": "pending", "changes": option["changes"],
        "metrics": {}, "comparison_id": None,
    }


def _case_definitions(workspace, plan):
    selection, baseline = plan["selection"], plan["baseline"]
    base = workspace._get("profiles", baseline["profile_id"])
    scenarios = [workspace._get("scenarios", baseline["scenario_id"])]
    scenarios += [workspace._get("scenarios", key) for key in selection["scenario_ids"]]
    ordinal = 0
    for option in _profiles(workspace, selection, base, selected_models(baseline)):
        for scenario in scenarios:
            yield _case_definition(plan, option, scenario, ordinal), option
            ordinal += 1


def _retained_case(directory, expected):
    path = directory / "cases" / (expected["id"] + ".json")
    if not path.exists():
        return expected
    value = read_json(path)
    fields = ("schema", "id", "run_id", "baseline_run_id", "kind", "profile_id",
              "scenario_id", "selection", "ordinal")
    if all(value.get(field) == expected[field] for field in fields):
        if any(value.get(field) != expected.get(field)
               for field in ("native_source", "native_baseline_source")):
            raise ValueError("The retained experiment case changed its frozen native source")
        return {**expected, **value}
    if "source_selection" in expected:
        original = {**expected, "run_id": expected["source_run_id"],
                    "baseline_run_id": expected["source_baseline_run_id"],
                    "selection": expected["source_selection"]}
        if all(value.get(field) == original[field] for field in fields):
            # Prior metrics belong to the old native selection. Preserve that
            # record and collect fresh metrics from the canonical native run.
            return {**expected, "previous_case": value, "_binding_recovery": True}
    raise ValueError("The retained experiment case changed: " + expected["id"])


def _persist_case(directory, case):
    atomic_json(directory / "cases" / (case["id"] + ".json"), case)


def _progress(directory, state, *, active=None):
    complete = failed = 0
    for path in (directory / "cases").glob("*.json"):
        value = read_json(path)
        complete += value.get("state") == "complete"
        failed += value.get("state") == "failed"
    state["progress"] = {"complete": complete, "failed": failed,
                         "pending": max(0, state["counts"]["cases"] - complete - failed),
                         "active_case_id": active}
    state["updated_at"] = now()
    atomic_json(directory / "state.json", state)
    return state


def _recover_case_bindings(workspace, plan, directory, state):
    active = selected_models(plan["baseline"])
    if not plan.get("_legacy_case_ids") or state.get("native_binding_models") == active:
        return state
    # Seek only retained case ordinals. An old sparse factorial programme must
    # not expand its unmaterialized matrix merely to recover native bindings.
    records = []
    seen = set()
    for path in (directory / "cases").glob("*.json"):
        ordinal = read_json(path).get("ordinal")
        if (type(ordinal) is not int or ordinal < 0
                or ordinal >= plan["counts"]["cases"] or ordinal in seen):
            raise ValueError("The retained experiment case index differs from its plan")
        seen.add(ordinal)
        records.append((ordinal, path))
    if records:
        base = workspace._get("profiles", plan["baseline"]["profile_id"])
        layout = _indexed_design(workspace, plan["selection"], base, active)
        scenario_ids = [plan["baseline"]["scenario_id"]] + plan["selection"]["scenario_ids"]
        if layout["count"] * len(scenario_ids) != plan["counts"]["cases"]:
            raise ValueError("The indexed design differs from the retained experiment case count")
        previous_profile, option, scenarios = None, None, {}
        for ordinal, path in sorted(records, key=lambda item: item[0]):
            profile_index, scenario_index = divmod(ordinal, len(scenario_ids))
            if profile_index != previous_profile:
                option = _indexed_profile(layout, profile_index)
                previous_profile = profile_index
            scenario_id = scenario_ids[scenario_index]
            if scenario_id not in scenarios:
                scenarios[scenario_id] = workspace._get("scenarios", scenario_id)
            expected = _case_definition(plan, option, scenarios[scenario_id], ordinal)
            if expected["id"] != path.stem:
                raise ValueError("The retained case file differs from its experiment ordinal")
            case = _retained_case(directory, expected)
            if case.pop("_binding_recovery", False):
                case["binding_recovered_at"] = now()
                _persist_case(directory, case)
    state.update(native_binding_models=active, models=list(active),
                 pollutants=list(output_models(active)), bindings_recovered_at=now())
    # Previous summaries describe the old model bindings. Keep their files,
    # and advertise a new summary after the recovered cases are summarized.
    state.pop("summary_at", None)
    state["files"] = {}
    state = _progress(directory, state)
    if state["progress"]["complete"] != plan["counts"]["cases"]:
        state["state"] = ("partial" if state["progress"]["complete"] else
                          "failed" if state["progress"]["failed"] else "prepared")
        state.pop("completed_at", None)
        state.pop("error", None)
        atomic_json(directory / "state.json", state)
    return state


def list_experiments(workspace):
    result = []
    for path in sorted((workspace.root / "experiments").glob("*/state.json")):
        value = _state(workspace, path.parent.name)
        result.append(value)
    return sorted(result, key=lambda item: (item["updated_at"], item["id"]), reverse=True)


def _indexed_case_definitions(workspace, plan, offset, limit):
    """Select case ordinals without deriving any preceding profile."""
    total = plan["counts"]["cases"]
    if offset >= total:
        return
    base = workspace._get("profiles", plan["baseline"]["profile_id"])
    layout = _indexed_design(workspace, plan["selection"], base, selected_models(plan["baseline"]))
    scenario_ids = [plan["baseline"]["scenario_id"]] + plan["selection"]["scenario_ids"]
    scenario_count = len(scenario_ids)
    if layout["count"] * scenario_count != total:
        raise ValueError("The selected experiment index differs from its retained case count")
    stop = total if limit is None else min(total, offset + limit)
    scenario_cache, previous_profile, option = {}, None, None
    for ordinal in range(offset, stop):
        profile_index, scenario_index = divmod(ordinal, scenario_count)
        if profile_index != previous_profile:
            option = _indexed_profile(layout, profile_index)
            previous_profile = profile_index
        scenario_id = scenario_ids[scenario_index]
        if scenario_id not in scenario_cache:
            scenario_cache[scenario_id] = workspace._get("scenarios", scenario_id)
        yield _case_definition(plan, option, scenario_cache[scenario_id], ordinal), option


def _case_window(offset, limit, *, unlimited=False):
    if type(offset) is not int or offset < 0:
        raise ValueError("Use a nonnegative integer case offset")
    if limit is None and unlimited:
        return
    if type(limit) is not int or limit <= 0:
        raise ValueError("Use a positive integer page size")


def inspect(workspace, experiment_id, offset=0, limit=100):
    _case_window(offset, limit)
    plan = _plan(workspace, experiment_id)
    state = _state(workspace, experiment_id)
    directory = _directory(workspace, experiment_id)
    total = plan["counts"]["cases"]
    cases = [_retained_case(directory, case)
             for case, _ in _indexed_case_definitions(workspace, plan, offset, limit)]
    next_offset = offset + len(cases)
    models = selected_models(plan["baseline"])
    return {**state, "models": list(models), "pollutants": list(output_models(models)),
            "cases": cases, "offset": offset, "limit": limit,
            "total_cases": total, "next_offset": next_offset if next_offset < total else None}


def expanded_cases(workspace, experiment_id, offset=0, limit=100):
    """Read the exact indexed case page for native programme composition."""
    return inspect(workspace, experiment_id, offset=offset, limit=limit)


def _prepare_case_run(workspace, case, option):
    if case.get("native_source") is not None:
        run = workspace.inspect_run(case["run_id"])
        selected = run["selection"]
        canonical_selection = _run_selection(selected["grid_id"], selected["profile_id"],
                                             selected["scenario_id"], selected_models(selected))
        if (_source_binding(run, canonical_selection) != case["native_source"]
                or selected != case["selection"]):
            raise ValueError("The adopted original native run differs from its saved experiment case")
        return run
    if option["derived"]:
        path = workspace.root / "profiles" / (option["id"] + ".json")
        profile = (workspace._get("profiles", option["id"]) if path.exists()
                   else workspace.save_profile(option["profile"]))
        if profile["id"] != option["id"]:
            raise ValueError("Derived native profile differs from the planned selection")
    run = workspace.prepare_run(case["selection"])
    if run["id"] != case["run_id"]:
        raise ValueError("Prepared native run differs from the experiment case")
    return run


def materialize_cases(workspace, experiment_id, offset=0, limit=None):
    """Yield prepared cases in their exact order, without executing native work.

    This is a streaming iterator. Consume it to retain the selected derived
    profiles and original native run selections. An optional window jumps
    directly to its first ordinal. Completed experiment results stay intact;
    resuming this iterator reuses the already retained profiles and runs.
    """
    _case_window(offset, limit, unlimited=True)
    plan = _plan(workspace, experiment_id)
    directory = _directory(workspace, experiment_id)
    if plan.get("_legacy_case_ids"):
        with held(directory / ".experiment.lock", blocking=False):
            _recover_case_bindings(workspace, plan, directory, _state(workspace, experiment_id))
    for expected, option in _indexed_case_definitions(workspace, plan, offset, limit):
        with held(directory / ".experiment.lock", blocking=False):
            case = _retained_case(directory, expected)
            run = _prepare_case_run(workspace, case, option)
            if case["state"] != "complete":
                case.update(native_state=run["state"], materialized_at=case.get("materialized_at") or now())
                _persist_case(directory, case)
        yield {**case, "native_state": run["state"]}

def _reporting_cells(workspace, grid_id):
    import numpy as np
    import rasterio
    grid = workspace.get_grid(grid_id)
    path = verify_file(workspace.root / "grids" / grid_id, grid["files"]["reporting_mask"])
    count = 0
    with rasterio.open(path) as source:
        for _, window in source.block_windows(1):
            count += int(np.count_nonzero(source.read(1, window=window) == 1))
    if not count:
        raise ValueError("The selected reporting mask contains no cells")
    return count, grid["grid"]["pixel_area_ha"]


def _pair_metrics(workspace, baseline, alternative, reporting_cells, pixel_area_ha, comparison):
    import numpy as np
    import rasterio
    models = selected_models(baseline["selection"])
    if selected_models(alternative["selection"]) != models:
        raise ValueError("Experiment pairs must select the same native models")
    pollutants = output_models(models)
    for run in (baseline, alternative):
        missing = set(pollutants) - set(run["artifacts"])
        if missing:
            raise ValueError("The selected model run lacks completed outputs: " + ", ".join(sorted(missing)))
    metrics = {}
    for pollutant in pollutants:
        units = rasters.MASS_UNITS[pollutant]
        base_artifact = baseline["artifacts"][pollutant]
        alt_artifact = alternative["artifacts"][pollutant]
        if base_artifact.get("units") != units or alt_artifact.get("units") != units:
            raise ValueError("Experiment totals require the original delivered per-pixel annual masses")
        base_path = verify_file(workspace.root / "runs" / baseline["id"], base_artifact)
        alt_path = verify_file(workspace.root / "runs" / alternative["id"], alt_artifact)
        baseline_total = alternative_total = 0.0
        paired_cells = baseline_cells = alternative_cells = 0
        support = hashlib.sha256()
        with rasterio.open(base_path) as a, rasterio.open(alt_path) as b:
            rasters.check_same_grid(a, b)
            support.update(canonical({"grid_id": baseline["selection"]["grid_id"],
                                      "width": a.width, "height": a.height}))
            for _, window in a.block_windows(1):
                av = a.read(1, window=window, masked=True)
                bv = b.read(1, window=window, masked=True)
                ad = np.ma.getdata(av).astype("float64")
                bd = np.ma.getdata(bv).astype("float64")
                a_good = ~np.ma.getmaskarray(av) & np.isfinite(ad)
                b_good = ~np.ma.getmaskarray(bv) & np.isfinite(bd)
                paired = a_good & b_good
                baseline_cells += int(a_good.sum())
                alternative_cells += int(b_good.sum())
                paired_cells += int(paired.sum())
                baseline_total += float(ad[paired].sum(dtype="float64"))
                alternative_total += float(bd[paired].sum(dtype="float64"))
                support.update(canonical([int(window.col_off), int(window.row_off),
                                          int(window.width), int(window.height)]))
                support.update(np.packbits(paired, bitorder="little").tobytes())
        delta = alternative_total - baseline_total if paired_cells else None
        metric = {
            "units": units.replace("/pixel", ""),
            "baseline_total": baseline_total if paired_cells else None,
            "alternative_total": alternative_total if paired_cells else None,
            "delta": delta, "reduction": -delta if delta is not None else None,
            "relative_change_pct": 100.0 * delta / baseline_total if paired_cells and baseline_total > 0 else None,
            "paired_cells": paired_cells, "baseline_valid_cells": baseline_cells,
            "alternative_valid_cells": alternative_cells, "reporting_cells": reporting_cells,
            "coverage_fraction": paired_cells / reporting_cells,
            "paired_area_ha": paired_cells * pixel_area_ha,
            "support_sha256": support.hexdigest(),
            "direction": "alternative minus baseline",
        }
        if comparison is not None:
            artifact = comparison["alternatives"][0]["artifacts"][pollutant]
            metric["difference_raster_sum"] = artifact["sum_change"]
        metrics[pollutant] = metric
    return metrics


def _records(directory):
    result = []
    plan = read_json(directory / "plan.json")
    if digest(plan) != directory.name:
        raise ValueError("The original experiment plan identity changed")
    source_runs = {row["run_id"]: row for row in plan.get("source_runs", [])}
    lineage_keys = ("source_run_id", "source_baseline_run_id", "source_selection")
    for path in (directory / "cases").glob("*.json"):
        value = read_json(path)
        identity = {key: value[key] for key in ("run_id", "baseline_run_id", "kind")}
        for field, run_field in (("native_source", "run_id"),
                                 ("native_baseline_source", "baseline_run_id")):
            expected_source = source_runs.get(value[run_field])
            if value.get(field) != expected_source:
                raise ValueError("A retained experiment case differs from its frozen original native source")
        retained_lineage = [key in value for key in lineage_keys]
        if any(retained_lineage):
            if not all(retained_lineage):
                raise ValueError("A retained experiment case has incomplete source lineage")
            source = value["source_selection"]
            current = value["selection"]
            if (not isinstance(source, dict) or not isinstance(current, dict)
                    or digest(source) != value["source_run_id"]
                    or "models" in source
                    or source != {key: item for key, item in current.items() if key != "models"}):
                raise ValueError("A retained experiment case has changed source selection")
            # A recovered partial-model case keeps its original plan case ID.
            # Its current native selection is independently checked below.
            identity = {"run_id": value["source_run_id"],
                        "baseline_run_id": value["source_baseline_run_id"],
                        "kind": value["kind"]}
        if (value.get("schema") != CASE_SCHEMA or value.get("id") != path.stem
                or digest(identity) != path.stem or digest(value["selection"]) != value["run_id"]):
            raise ValueError("A retained experiment case has changed")
        result.append(value)
    return sorted(result, key=lambda row: row["ordinal"])


def _envelope(rows, pollutant):
    values = [row["metrics"][pollutant] for row in rows
              if row["metrics"].get(pollutant, {}).get("delta") is not None]
    if not values:
        return {"profiles": 0, "minimum_delta": None, "maximum_delta": None,
                "minimum_reduction": None, "maximum_reduction": None,
                "minimum_relative_change_pct": None, "maximum_relative_change_pct": None,
                "response": "no paired cells"}
    deltas = [value["delta"] for value in values]
    reductions = [value["reduction"] for value in values]
    percentages = [value["relative_change_pct"] for value in values
                   if value["relative_change_pct"] is not None]
    if all(value == 0 for value in deltas):
        response = "unchanged"
    elif all(value <= 0 for value in deltas):
        response = "lower export across evaluated profiles"
    elif all(value >= 0 for value in deltas):
        response = "higher export across evaluated profiles"
    else:
        response = "direction changes across evaluated profiles"
    return {
        "profiles": len(values), "units": values[0]["units"],
        "minimum_delta": min(deltas), "maximum_delta": max(deltas),
        "minimum_reduction": min(reductions), "maximum_reduction": max(reductions),
        "minimum_relative_change_pct": min(percentages) if percentages else None,
        "maximum_relative_change_pct": max(percentages) if percentages else None,
        "response": response,
    }


def _sensitivity(rows, selection, expected_profiles, pollutants=None):
    result = []
    for scenario_id in selection["scenario_ids"]:
        completed = [row for row in rows if row["kind"] == "landcover"
                     and row["scenario_id"] == scenario_id and row["state"] == "complete"]
        entry = {"scenario_id": scenario_id,
                 "scenario_title": completed[0]["scenario_title"] if completed else None,
                 "completed_profiles": len(completed), "expected_profiles": expected_profiles,
                 "complete": len(completed) == expected_profiles, "pollutants": {}}
        for pollutant in pollutants if pollutants is not None else rasters.MASS_UNITS:
            groups = {}
            for row in completed:
                metric = row["metrics"].get(pollutant)
                if metric is not None and metric.get("delta") is not None:
                    groups.setdefault(metric["support_sha256"], []).append(row)
            common = len(groups) == 1
            value = {"comparable_support": common, "support_groups": []}
            for support, selected in sorted(groups.items()):
                value["support_groups"].append({
                    "support_sha256": support,
                    "profile_ids": [row["profile_id"] for row in selected],
                    "paired_cells": selected[0]["metrics"][pollutant]["paired_cells"],
                    **_envelope(selected, pollutant),
                })
            if common:
                value.update(_envelope(completed, pollutant))
            else:
                value.update({"profiles": len(completed), "minimum_delta": None,
                              "maximum_delta": None, "minimum_reduction": None,
                              "maximum_reduction": None,
                              "minimum_relative_change_pct": None,
                              "maximum_relative_change_pct": None,
                              "response": "compare the separate valid-cell support groups" if groups else "awaiting completed pairs"})
            entry["pollutants"][pollutant] = value
        result.append(entry)
    return result


def _csv_text(value):
    text = str(value)
    return "'" + text if text.startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else text


def _csv_bytes(rows):
    output = io.StringIO(newline="")
    columns = ("case_id", "kind", "state", "profile_id", "profile_title", "scenario_id",
               "scenario_title", "models", "run_id", "baseline_run_id", "comparison_id",
               "parameters", "pollutant", "units", "baseline_total", "alternative_total",
               "delta", "reduction", "relative_change_pct", "paired_cells",
               "baseline_valid_cells", "alternative_valid_cells", "reporting_cells",
               "coverage_fraction", "paired_area_ha", "support_sha256", "error")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        common = {key: row.get(key) for key in ("kind", "state", "profile_id", "scenario_id",
                  "run_id", "baseline_run_id", "comparison_id")}
        common.update(case_id=row["id"], models=",".join(selected_models(row["selection"])),
                      profile_title=_csv_text(row["profile_title"]),
                      scenario_title=_csv_text(row["scenario_title"]),
                      parameters=_csv_text(json.dumps(row["changes"], ensure_ascii=False, sort_keys=True)),
                      error=_csv_text(row.get("error", {}).get("message", "")))
        if row["state"] != "complete":
            writer.writerow(common)
            continue
        for pollutant, metric in row["metrics"].items():
            writer.writerow({**common, "pollutant": pollutant,
                             **{key: metric.get(key) for key in columns if key in metric}})
    return output.getvalue().encode("utf-8-sig")


def _summarize_locked(workspace, experiment_id, plan, state):
    directory = _directory(workspace, experiment_id)
    rows = _records(directory)
    models = selected_models(plan["baseline"])
    pollutants = output_models(models)
    generated = now()
    summary = {
        "schema": SUMMARY_SCHEMA, "id": experiment_id, "workspace_id": workspace.project["id"],
        "title": state["title"], "reason": plan["selection"]["reason"],
        "state": state["state"], "selection": plan["selection"], "baseline": plan["baseline"],
        "counts": plan["counts"], "progress": copy.deepcopy(state["progress"]),
        "generated_at": generated, "rows": rows,
        "models": list(models), "pollutants": list(pollutants),
        "grid_id": plan["baseline"]["grid_id"],
        "pairs": [{"profile_id": row["profile_id"], "baseline_run_id": row["baseline_run_id"],
                   "alternative_run_id": row["run_id"], "scenario_id": row["scenario_id"]}
                  for row in rows if row["kind"] == "landcover" and row["state"] == "complete"],
        "sensitivity": _sensitivity(rows, plan["selection"], plan["counts"]["profiles"], pollutants),
        "interpretation": {
            "landcover": "Alternative land cover minus the baseline under the same parameter profile.",
            "parameter": "Baseline land cover under a selected profile minus the original reference profile.",
            "totals": "Delivered per-pixel annual masses summed over the same valid cells for each pair.",
            "positive_delta": "Higher annual export", "negative_delta": "Lower annual export",
            "ranges": "Sensitivity ranges over the explicitly evaluated profiles.",
            "zero_baseline": "Relative change is undefined when the paired baseline total is zero.",
        },
        "files": {},
    }
    atomic_bytes(directory / "results.csv", _csv_bytes(rows))
    summary["files"]["csv"] = describe_file(directory, directory / "results.csv")
    atomic_json(directory / "summary.json", summary)
    files = {**summary["files"], "json": describe_file(directory, directory / "summary.json")}
    state.update(files=files, summary_at=generated, updated_at=generated)
    atomic_json(directory / "state.json", state)
    return {**summary, "files": files}


def summarize(workspace, experiment_id):
    plan = _plan(workspace, experiment_id)
    directory = _directory(workspace, experiment_id)
    with held(directory / ".experiment.lock", blocking=False):
        state = _recover_case_bindings(workspace, plan, directory, _state(workspace, experiment_id))
        # Owning this lock establishes that no experiment executor is active.
        # Recover interrupted case markers before producing an operator report.
        for case in _records(directory):
            if case["state"] == "running":
                case.update(state="failed", updated_at=now(),
                            error={"type": "InterruptedExperiment",
                                   "message": "Execution stopped before this case was finalized; resume the experiment"})
                _persist_case(directory, case)
        state = _progress(directory, state)
        if state["progress"]["complete"] == plan["counts"]["cases"]:
            state.update(state="complete", completed_at=state.get("completed_at") or now())
            state.pop("error", None)
        elif state["progress"]["failed"] or state["state"] == "running":
            state["state"] = "partial" if state["progress"]["complete"] else "failed"
            state.pop("completed_at", None)
        else:
            state["state"] = "partial" if state["progress"]["complete"] else "prepared"
            state.pop("completed_at", None)
        return _summarize_locked(workspace, experiment_id, plan, state)


def read_summary(workspace, experiment_id):
    plan = _plan(workspace, experiment_id)
    directory = _directory(workspace, experiment_id)
    path = directory / "summary.json"
    if not path.exists():
        return None
    summary = read_json(path)
    if (summary.get("schema") != SUMMARY_SCHEMA or summary.get("id") != experiment_id
            or summary.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The retained summary belongs to another experiment")
    models = selected_models(plan["baseline"])
    if selected_models(summary) != models:
        return None
    if (summary.get("state") == "complete"
            and summary.get("progress", {}).get("complete") != plan["counts"]["cases"]):
        return None
    if plan.get("_legacy_case_ids"):
        state = _state(workspace, experiment_id)
        if (state.get("native_binding_models") != models
                or (state.get("bindings_recovered_at") and not state.get("summary_at"))):
            return None
    return {**summary, "files": {**summary.get("files", {}),
                                 "json": describe_file(directory, path)}}


def _remember_reuse_source(candidates, case):
    """Keep the reference and recent same-scenario donors while streaming cases."""
    values = candidates.setdefault(case["scenario_id"], [])
    if case["run_id"] not in values:
        values.append(case["run_id"])
        # This is an opportunistic cache, not a limit on the experiment matrix.
        # Preserve the first profile and the latest fifteen; the native indexed
        # cache continues to find exact inputs throughout the entire workspace.
        if len(values) > 16:
            del values[1]


def execute(workspace, experiment_id, *, completed_only=False):
    if type(completed_only) is not bool:
        raise ValueError("Choose whether to synchronize completed native runs only")
    plan = _plan(workspace, experiment_id)
    directory = _directory(workspace, experiment_id)
    # Use the existing native batch lock as well as the experiment's mutation
    # lock. The operator's original queue remains the entry point for jobs.
    with held(directory / ".experiment.lock", blocking=False), held(
            workspace.root / ".native-model-batch.lock", blocking=False):
        state = _recover_case_bindings(workspace, plan, directory, _state(workspace, experiment_id))
        state = _progress(directory, state)
        if state["progress"]["complete"] == plan["counts"]["cases"]:
            state["state"] = "complete"
            previous = read_summary(workspace, experiment_id)
            if (previous is not None and previous["state"] == "complete"
                    and previous["progress"]["complete"] == plan["counts"]["cases"]):
                atomic_json(directory / "state.json", state)
                return {**state, "reused": True}
            _summarize_locked(workspace, experiment_id, plan, state)
            return state
        state.update(state="running", started_at=state.get("started_at") or now())
        state.pop("error", None)
        atomic_json(directory / "state.json", state)
        active = None
        reuse_sources = {}
        try:
            if "reporting_cells" not in state:
                count, area = _reporting_cells(workspace, plan["baseline"]["grid_id"])
                state.update(reporting_cells=count, pixel_area_ha=area)
                atomic_json(directory / "state.json", state)
            for expected, option in _case_definitions(workspace, plan):
                case = _retained_case(directory, expected)
                if case["state"] == "complete":
                    _remember_reuse_source(reuse_sources, case)
                    continue
                active = case
                if case["state"] == "failed":
                    state["progress"]["failed"] -= 1
                    state["progress"]["pending"] += 1
                case.update(state="running", started_at=now(),
                            attempts=case.get("attempts", 0) + 1)
                case.pop("error", None)
                _persist_case(directory, case)
                state["progress"]["active_case_id"] = case["id"]
                state["updated_at"] = now()
                atomic_json(directory / "state.json", state)
                run = None
                try:
                    run = _prepare_case_run(workspace, case, option)
                    if run["state"] != "complete":
                        if completed_only:
                            raise RuntimeError("Complete the selected native run before synchronizing experiment results")
                        # Profile tables can differ only in the other model's
                        # columns. Retain explicit same-scenario candidates so
                        # the native matcher can compare the relevant inputs.
                        donors = list(dict.fromkeys(
                            list(run.get("reuse_source_run_ids", [])) +
                            list(reversed(reuse_sources.get(case["scenario_id"], [])))))
                        donors = [key for key in donors if key != run["id"]]
                        run = (workspace.run(run["id"], reuse_source_run_ids=donors)
                               if donors else workspace.run(run["id"]))
                    if run["state"] != "complete":
                        raise RuntimeError("The selected native model run has not completed")
                    reference = workspace.inspect_run(case["baseline_run_id"])
                    if reference["state"] != "complete":
                        raise RuntimeError("The paired baseline is unfinished; the alternative native outputs are retained")
                    producing_versions = comparison_versions(
                        [reference, run], selected_models(case["selection"]))
                    comparison = None
                    if reference["id"] != run["id"]:
                        comparison = workspace.compare_runs([reference["id"], run["id"]])
                    metrics = _pair_metrics(workspace, reference, run, state["reporting_cells"],
                                            state["pixel_area_ha"], comparison)
                    case.update(state="complete", completed_at=now(), metrics=metrics,
                                comparison_id=comparison["id"] if comparison else None,
                                native_completed_at=run["completed_at"],
                                native_runtime=run.get("runtime"),
                                native_versions=producing_versions,
                                native_stage_reuse={model: stage["reused_from"]
                                    for model, stage in run.get("stages", {}).items()
                                    if stage.get("reused_from")},
                                output_artifacts=run["artifacts"])
                    state["progress"]["complete"] += 1
                except Exception as exc:
                    failure = copy.deepcopy(getattr(exc, "native_failure", None)) or {
                        "type": type(exc).__name__, "message": str(exc)}
                    case.update(state="failed", updated_at=now(), error=failure)
                    state["progress"]["failed"] += 1
                    if storage_exhausted(exc):
                        raise
                if run is not None:
                    # A failed later model may still leave a complete reusable
                    # earlier stage. The native matcher verifies each stage.
                    _remember_reuse_source(reuse_sources, case)
                state["progress"]["pending"] -= 1
                state["progress"]["active_case_id"] = None
                state["updated_at"] = now()
                _persist_case(directory, case)
                atomic_json(directory / "state.json", state)
                active = None
            state = _progress(directory, state)
            if state["progress"]["failed"]:
                state["state"] = "partial" if state["progress"]["complete"] else "failed"
                state["error"] = {"type": "IncompleteExperiment",
                                  "message": str(state["progress"]["failed"]) + " experiment cases need resuming"}
            else:
                state.update(state="complete", completed_at=now())
                state.pop("error", None)
            _summarize_locked(workspace, experiment_id, plan, state)
        except BaseException as exc:
            capacity_failure = storage_exhausted(exc)
            failure = copy.deepcopy(getattr(exc, "native_failure", None)) or {
                "type": type(exc).__name__, "message": str(exc)}
            try:
                if active is not None and active.get("state") != "complete":
                    active.update(state="failed", updated_at=now(), error=failure)
                    _persist_case(directory, active)
                state = _progress(directory, state)
                state["state"] = "partial" if state["progress"]["complete"] else "failed"
                state["error"] = failure
                atomic_json(directory / "state.json", state)
            except OSError:
                if not capacity_failure:
                    raise
            # Existing completed exports remain available. A full filesystem
            # needs capacity recovery before another aggregation/export write.
            if not capacity_failure:
                try:
                    _summarize_locked(workspace, experiment_id, plan, state)
                except Exception:
                    pass
            raise
        if state["state"] != "complete":
            raise RuntimeError("Experiment " + experiment_id + ": " + state["error"]["message"])
        return state
