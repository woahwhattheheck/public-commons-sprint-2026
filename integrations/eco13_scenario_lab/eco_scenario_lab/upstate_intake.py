"""Receive original Upper Savannah experiment results into the scenario workbench.

The original model.experiments and Workspace own scientific execution. This
module reads their current retained case/run records and copies their existing
results. It does not execute, resubmit, fit, aggregate or simulate native models.
"""
from __future__ import annotations
import copy
import csv
import io
import math
from pathlib import Path
import re
import shutil
import tempfile
from .engine import cost, safe_id, stamp
from .retention import RetentionSession
from .store import ScenarioError, atomic_bytes, atomic_json, digest, file_hash, inside, read_json

SOURCE_FORMAT = "upstate.experiment/v1"
MODE = "adopted-upstate-experiment"
INDEX_SCHEMA = "eco-upstate-received/v1"
MODEL_METRICS = {
    "ndr": ("nitrogen_export", "phosphorus_export"),
    "sdr": ("sediment_export",),
}


def _id(value, label):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ScenarioError(label + " must be an original complete project item ID")
    return value


def _models(selection):
    # This omission is the original core's both-model identity convention.
    models = selection.get("models", ["ndr", "sdr"])
    if (not isinstance(models, list) or not models or
            len(models) != len(set(models)) or set(models) - set(MODEL_METRICS)):
        raise ScenarioError("Original selected native models are invalid")
    return list(models)


def _pages(workspace, experiment_id, page_size):
    try:
        from model import experiments
    except ModuleNotFoundError as exc:
        raise ScenarioError("Receive with the original Upper Savannah application and its runtime on the Python path") from exc
    if type(page_size) is not int or page_size < 1:
        raise ScenarioError("page_size must be a positive integer")
    pages, cases, seen = [], [], set()
    offset, identity = 0, None
    while True:
        page = experiments.inspect(workspace, experiment_id, offset=offset, limit=page_size)
        if (page.get("schema") != SOURCE_FORMAT or page.get("id") != experiment_id
                or page.get("workspace_id") != workspace.project["id"]):
            raise ScenarioError("Original experiment page belongs to another selection")
        total = page.get("total_cases")
        if type(total) is not int or total < 1 or page.get("offset") != offset:
            raise ScenarioError("Original experiment page has invalid position/count")
        current = digest({"selection": page["selection"], "counts": page["counts"],
                          "workspace_id": page["workspace_id"], "total_cases": total})
        if identity is not None and current != identity:
            raise ScenarioError("Original experiment design changed while receiving pages")
        identity = current
        selected = page.get("cases")
        if not isinstance(selected, list) or not selected or len(selected) > page_size:
            raise ScenarioError("Original experiment page did not advance")
        for i, case in enumerate(selected):
            key = _id(case.get("id"), "Case ID")
            if key in seen or case.get("ordinal") != offset + i:
                raise ScenarioError("Original experiment pages duplicate or omit case positions")
            for field in ("profile_id", "scenario_id", "run_id", "baseline_run_id"):
                _id(case.get(field), field)
            if case.get("schema") != "upstate.experiment-case/v1":
                raise ScenarioError("Unexpected original case schema")
            if case.get("kind") not in {"reference", "parameter", "landcover"}:
                raise ScenarioError("Unexpected original experiment case kind")
            seen.add(key)
            cases.append(copy.deepcopy(case))
        pages.append(copy.deepcopy(page))
        offset += len(selected)
        wanted = offset if offset < total else None
        if offset > total or page.get("next_offset") != wanted:
            raise ScenarioError("Original experiment pagination does not cover its declared design")
        if wanted is None:
            break
    summary = experiments.read_summary(workspace, experiment_id)
    if summary is not None and (
            summary.get("schema") != "upstate.experiment-summary/v1" or
            summary.get("id") != experiment_id or
            summary.get("workspace_id") != workspace.project["id"]):
        raise ScenarioError("Original summary belongs to another experiment")
    return pages, cases, summary


class _Receiver:
    """Copy original bytes once, with stable relative paths and source checks."""
    def __init__(self, original, stage):
        self.original, self.stage = Path(original).resolve(), stage
        self.inventory = {}
        self.retention = RetentionSession(stage)

    def copy_file(self, relative, declared=None):
        member = Path(relative)
        if (member.is_absolute() or not member.parts or ".." in member.parts or
                member.as_posix() != relative or "\\" in relative):
            raise ScenarioError("Original member needs its retained relative path")
        source = inside(self.original, relative)
        if not source.is_file() or source.is_symlink():
            raise ScenarioError("Original member is not a regular file: " + relative)
        # Reject symlinks in every component, including links resolving inside root.
        candidate = self.original
        for part in Path(relative).parts:
            candidate = candidate / part
            if candidate.is_symlink():
                raise ScenarioError("Original member traverses a symlink: " + relative)
        target_name = "original/" + relative
        meta = self.retention.retain_file(source, target_name, declared=declared)
        self.inventory[target_name] = meta
        return target_name

    def copy_tree(self, relative):
        candidate = self.original
        for part in Path(relative).parts:
            candidate = candidate / part
            if candidate.is_symlink():
                raise ScenarioError("Original directory traverses a symlink: " + relative)
        root = inside(self.original, relative)
        if not root.is_dir() or root.is_symlink():
            raise ScenarioError("Original directory is unavailable: " + relative)
        for meta in self.retention.retain_tree(root, "original/" + relative):
            self.inventory[meta["path"]] = meta

    def verify(self):
        return self.retention.verify()

    def save(self, relative, value):
        path = inside(self.stage, relative)
        atomic_json(path, value)
        self.inventory[relative] = {"path": relative, "bytes": path.stat().st_size,
                                    "sha256": file_hash(path)}
        return copy.deepcopy(self.inventory[relative])


def _validate_run(workspace, run, case, *, baseline=False):
    selected = run["selection"]
    if run["id"] != (case["baseline_run_id"] if baseline else case["run_id"]):
        raise ScenarioError("Native run identity differs from the original case")
    if selected["grid_id"] != case["selection"]["grid_id"]:
        raise ScenarioError("Native run uses another reporting grid")
    if not baseline or case["kind"] == "landcover":
        if selected["profile_id"] != case["profile_id"]:
            raise ScenarioError("Native run uses another parameter profile")
    if not baseline and selected["scenario_id"] != case["scenario_id"]:
        raise ScenarioError("Native run uses another land-cover scenario")
    if _models(selected) != _models(case["selection"]):
        raise ScenarioError("Native run models differ from the original case")


def _descriptors(value):
    found = {}
    def visit(item):
        if isinstance(item, dict):
            if {"path", "bytes", "sha256"}.issubset(item):
                key = item["path"]
                if key in found and (found[key]["sha256"] != item["sha256"] or found[key]["bytes"] != item["bytes"]):
                    raise ScenarioError("Original native registrations disagree on a file")
                found[key] = item
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(value)
    return list(found.values())


def _registered_run_files(workspace, receiver, run):
    from model.common import verify_file
    directory = workspace.root / "runs" / run["id"]
    stage_files = [{key: stage[key] for key in ("files", "arguments", "requested_arguments", "artifact", "companions") if key in stage}
                   for stage in run.get("stages", {}).values()]
    descriptors = _descriptors({"artifacts": run.get("artifacts", {}), "stages": stage_files})
    for item in descriptors:
        verify_file(directory, item)
    receiver.copy_tree("runs/" + run["id"])
    if read_json(receiver.stage / "original" / "runs" / run["id"] / "run.json") != run:
        raise ScenarioError("Original completed run metadata changed during receiving")
    for item in descriptors:
        receiver.copy_file("runs/" + run["id"] + "/" + item["path"], item)


def _registered_partial_files(workspace, receiver, run, scope):
    """Retain available original model files while preserving the run's state."""
    from model.common import verify_file
    completed_models = scope.get("completed_models", [])
    metrics = {name for model in completed_models for name in MODEL_METRICS[model]}
    artifacts = {name: item for name, item in run.get("artifacts", {}).items() if name in metrics}
    stages = [
        {key: run["stages"][model][key] for key in ("files", "arguments", "requested_arguments", "artifact", "companions")
         if key in run["stages"][model]}
        for model in completed_models
    ]
    directory = workspace.root / "runs" / run["id"]
    for item in _descriptors({"artifacts": artifacts, "stages": stages}):
        verify_file(directory, item)
        receiver.copy_file("runs/" + run["id"] + "/" + item["path"], item)
    return list(completed_models)


def _retain_sources(workspace, receiver, grid, cases, complete_runs):
    collections = {grid["spec"]["source_collection_id"]}
    profiles = {case["profile_id"] for case in cases}
    scenarios = {case["scenario_id"] for case in cases}
    required_profiles = {run["selection"]["profile_id"] for run in complete_runs.values()}
    for kind, keys in (("profiles", profiles), ("scenarios", scenarios)):
        for key in sorted(keys):
            path = workspace.root / kind / (key + ".json")
            if not path.is_file():
                if kind == "profiles" and key not in required_profiles:
                    continue  # Original derived profiles are saved only when executed.
                raise ScenarioError("Original selected " + kind + " record is absent")
            value = workspace._get(kind, key)
            receiver.copy_file(kind + "/" + key + ".json")
            if value.get("source_collection_id"):
                collections.add(value["source_collection_id"])
    for key in sorted(collections):
        source = workspace._get("sources", key)
        receiver.copy_file("sources/" + key + ".json")
        manifest = source.get("original_manifest")
        if manifest is not None:
            receiver.copy_file(manifest["object"], manifest)
        for entry in source["entries"]:
            for body in [entry["body"], *entry.get("companions", [])]:
                receiver.copy_file(body["object"], body)


def adopt_workspace(workspace, experiment_id, destination, *, project_id, setup_id,
                    currency, scenario_costs=None, page_size=250):
    """Receive the exact original experiment through its installed current module.

    Caller supplies the original Workspace, e.g. Operator.ws. Missing costs stay
    unspecified. Completed case effects retain their original paired mask/units.
    Incomplete native stages remain visible as source status, without fabricated
    comparison values. The output is a new portable scenario reporting workspace.
    """
    if isinstance(workspace, (str, Path)):
        try:
            from model.workspace import Workspace
        except ModuleNotFoundError as exc:
            raise ScenarioError("Receive alongside the original Upper Savannah application and its runtime") from exc
        workspace = Workspace(Path(workspace))
    experiment_id = _id(experiment_id, "Experiment ID")
    for value, label in ((project_id, "project_id"), (setup_id, "setup_id")):
        safe_id(value, label)
    if currency not in {"USD", "EUR", "GBP", "CAD", "AUD", "NZD"}:
        raise ScenarioError("Select the original two-decimal currency")
    scenario_costs = {} if scenario_costs is None else dict(scenario_costs)
    destination = Path(destination).resolve()
    original = Path(workspace.root).resolve()
    if destination.exists() or destination.is_relative_to(original) or original.is_relative_to(destination):
        raise ScenarioError("Receiving needs a new directory outside the original workspace")
    started = stamp()
    pages, cases, summary = _pages(workspace, experiment_id, page_size)
    source_selection = pages[0]["selection"]
    alternatives = list(source_selection["scenario_ids"])
    if set(scenario_costs) - set(alternatives):
        raise ScenarioError("Scenario costs must name original selected land-cover alternatives")
    scenario_costs = {key: cost(value) for key, value in scenario_costs.items()}
    reference = workspace.inspect_run(source_selection["baseline_run_id"])
    baseline_scenario = reference["selection"]["scenario_id"]
    active_models = _models(reference["selection"])
    grid = workspace.get_grid(reference["selection"]["grid_id"])
    if any(_models(case["selection"]) != active_models or
           case["selection"]["grid_id"] != grid["id"] for case in cases):
        raise ScenarioError("Original experiment contains a different grid/model selection")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".upstate-receiving-", dir=destination.parent))
    receiver = _Receiver(original, stage)
    try:
        receiver.copy_file("workspace.json")
        receiver.copy_file("experiments/" + experiment_id + "/plan.json")
        retained_plan = read_json(stage / "original" / "experiments" / experiment_id / "plan.json")
        if digest(retained_plan) != experiment_id or retained_plan["selection"] != source_selection:
            raise ScenarioError("Original immutable experiment plan differs from its inspected design")
        if read_json(stage / "original" / "workspace.json") != workspace.project:
            raise ScenarioError("Original workspace identity changed during receiving")
        for i, page in enumerate(pages):
            receiver.save("original/experiment-pages/" + f"{i:06d}.json", page)
        if summary is not None:
            receiver.save("original/experiment-summary.json", summary)
        from model.common import verify_file
        for item in _descriptors(grid["files"]):
            verify_file(original / "grids" / grid["id"], item)
        receiver.copy_tree("grids/" + grid["id"])
        if read_json(stage / "original" / "grids" / grid["id"] / "grid.json") != grid:
            raise ScenarioError("Original grid definition changed during receiving")
        from model.model_selection import run_scope
        all_runs, complete_runs, unavailable, run_scopes, retained_run_models = {}, {}, {}, {}, {}
        wanted_runs = {case["run_id"] for case in cases} | {case["baseline_run_id"] for case in cases}
        for run_id in sorted(wanted_runs):
            source_path = original / "runs" / run_id / "run.json"
            if not source_path.is_file():
                unavailable[run_id] = "not_prepared"
                continue
            run = workspace.inspect_run(run_id)
            all_runs[run_id] = copy.deepcopy(run)
            run_scopes[run_id] = copy.deepcopy(run_scope(run))
            if run.get("state") == "complete":
                if not run_scopes[run_id]["selected_models_complete"]:
                    raise ScenarioError("Original complete run lacks its selected native output scope")
                _registered_run_files(workspace, receiver, run)
                complete_runs[run_id] = run
                retained_run_models[run_id] = list(run_scopes[run_id]["completed_models"])
            else:
                retained_run_models[run_id] = _registered_partial_files(workspace, receiver, run, run_scopes[run_id])
                receiver.save("original/run-snapshots/" + run_id + ".json", run)
        for case in cases:
            for baseline in (False, True):
                run = all_runs.get(case["baseline_run_id"] if baseline else case["run_id"])
                if run is not None:
                    _validate_run(workspace, run, case, baseline=baseline)
            if case["kind"] == "landcover":
                baseline_run = all_runs.get(case["baseline_run_id"])
                if baseline_run is not None and baseline_run["selection"]["scenario_id"] != baseline_scenario:
                    raise ScenarioError("Land-cover effect is not paired to its original baseline scenario")
            if case.get("state") == "complete":
                for key in (case["run_id"], case["baseline_run_id"]):
                    if key not in complete_runs:
                        raise ScenarioError("Completed case lacks its original completed native pair")
                if case.get("output_artifacts") != complete_runs[case["run_id"]].get("artifacts"):
                    raise ScenarioError("Original case and native output registration differ")
                comparison_id = case.get("comparison_id")
                if comparison_id:
                    receiver.copy_tree("comparisons/" + _id(comparison_id, "Comparison ID"))
        _retain_sources(workspace, receiver, grid, cases, complete_runs)
        index = {
            "schema": INDEX_SCHEMA, "source_format": SOURCE_FORMAT,
            "experiment_id": experiment_id, "original_workspace_id": workspace.project["id"],
            "source_selection": source_selection, "baseline_scenario_id": baseline_scenario,
            "reference_run_id": reference["id"], "grid_id": grid["id"],
            "selected_models": active_models, "original_counts": pages[0]["counts"],
            "cases": cases, "runs": all_runs, "run_scopes": run_scopes, "unavailable_runs": unavailable,
            "retained_run_models": retained_run_models,
            "snapshot_started_at": started, "snapshot_completed_at": stamp(),
            "page_count": len(pages), "summary_generated_at": summary.get("generated_at") if summary else None,
            "original_interpretation": summary.get("interpretation", {}) if summary else {},
        }
        index_meta = receiver.save("upstate-received.json", index)
        path_map = {"source_root": str(original), "retained_root": "original",
                    "meaning": "Original file bytes and native arguments are retained. Relative source paths map below original/."}
        receiver.save("original/path-map.json", path_map)
        profile_titles = {case["profile_id"]: case.get("profile_title") or case["profile_id"] for case in cases}
        scenario_titles = {case["scenario_id"]: case.get("scenario_title") or case["scenario_id"] for case in cases}
        state = {"schema": 1, "jobs": {}, "active_jobs": {}, "prepared": {}}
        for case in cases:
            scenario = case["scenario_id"] if case["kind"] == "landcover" else "baseline"
            run = all_runs.get(case["run_id"], {})
            for model in _models(case["selection"]):
                key = digest({"experiment": experiment_id, "case": case["id"], "model": model})[:32]
                scope = run_scopes.get(case["run_id"], {})
                state["jobs"][key] = {
                    "id": key, "case_id": case["profile_id"], "scenario_id": scenario, "model": model,
                    "status": case["state"], "original_case_id": case["id"],
                    "original_run_id": case["run_id"], "original_baseline_run_id": case["baseline_run_id"],
                    "original_experiment_id": experiment_id, "native_status": run.get("state", "not_prepared"),
                    "native_model_available": model in scope.get("completed_models", []),
                    "native_model_retained": model in retained_run_models.get(case["run_id"], []),
                    "native_selected_models_complete": bool(scope.get("selected_models_complete")),
                    "paired_result_available": case["state"] == "complete" and
                        all(isinstance(case.get("metrics", {}).get(name), dict) and
                            type(case["metrics"][name].get("paired_cells")) is int and
                            case["metrics"][name]["paired_cells"] > 0
                            for name in MODEL_METRICS[model]),
                    "engine_identity": "natcap.invest/" + case["selection"]["invest_version"],
                }
                position = "/".join((case["profile_id"], scenario, model))
                if position in state["active_jobs"]:
                    raise ScenarioError("Original cases duplicate a profile/scenario/model position")
                state["active_jobs"][position] = key
        plan = {
            "schema": 1, "mode": MODE, "project_id": project_id, "setup_id": setup_id,
            "currency": currency, "created_at": stamp(),
            "cases": [{"id": key, "title": title} for key, title in profile_titles.items()],
            "scenarios": [{"id": key, "title": scenario_titles[key], "cost_cents": scenario_costs.get(key),
                           "cost_status": "declared" if key in scenario_costs else "unspecified"} for key in alternatives],
            "models": {model: {"origin": SOURCE_FORMAT} for model in active_models},
            "native": {"invest_version": reference["selection"]["invest_version"]},
            "original_counts": pages[0]["counts"],
            "adopted_case_model_slots": len(state["jobs"]),
            "source_manifest": {"source_format": SOURCE_FORMAT, "original_experiment_id": experiment_id,
                                "original_workspace_id": workspace.project["id"], "index": index_meta,
                                "page_count": len(pages), "grid_id": grid["id"]},
            "inputs": sorted(receiver.inventory.values(), key=lambda item: item["path"]),
        }
        plan["plan_sha256"] = digest(plan)
        atomic_json(stage / "plan.json", plan)
        atomic_json(stage / "state.json", state)
        comparison = build_comparison(stage)
        from .results import render_report
        report = render_report(stage, comparison)
        storage = receiver.verify()
        atomic_json(stage / "receiving-storage.json", storage)
        stage.rename(destination)
        return {
            "workspace": str(destination), "original_experiment_id": experiment_id,
            "source_format": SOURCE_FORMAT, "page_count": len(pages), "storage": storage,
            "original_cases": len(cases), "adopted_case_model_slots": len(state["jobs"]),
            "retained_complete_runs": len(complete_runs),
            "retained_partial_runs": sum(bool(models) for key, models in retained_run_models.items() if key not in complete_runs),
            "selected_models": active_models, "paired_records": len(comparison["rows"]),
            "parameter_records": len(comparison["parameter_rows"]), "incomplete": comparison["incomplete"],
            "status": "partial" if comparison["incomplete"] else "complete",
            "report": str(destination / report.relative_to(stage)),
        }
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def adopt(selection_path, destination):
    selection_path = Path(selection_path)
    value = read_json(selection_path)
    if value.get("schema") != 1 or value.get("source_format") != SOURCE_FORMAT:
        raise ScenarioError("Select an upstate.experiment/v1 receiving specification")
    allowed = {"schema", "source_format", "workspace", "experiment_id", "project_id",
               "setup_id", "currency", "scenario_costs", "page_size"}
    if set(value) - allowed:
        raise ScenarioError("Unknown Upstate receiving fields: " + ", ".join(sorted(set(value) - allowed)))
    try:
        from model.workspace import Workspace
    except ModuleNotFoundError as exc:
        raise ScenarioError("Receive alongside the original Upper Savannah application and its runtime") from exc
    original = (selection_path.resolve().parent / value["workspace"]).resolve()
    return adopt_workspace(Workspace(original), value["experiment_id"], destination,
                           project_id=value["project_id"], setup_id=value["setup_id"],
                           currency=value["currency"], scenario_costs=value.get("scenario_costs"),
                           page_size=value.get("page_size", 250))


def _number(value, label, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ScenarioError("Original native metric is not finite: " + label)
    return value


def _csv(output, rows):
    if not rows:
        output.unlink(missing_ok=True)
        return
    fields = list(dict.fromkeys(key for row in rows for key in row))
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        safe = {key: ("'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r", "\n"))
                      else value) for key, value in row.items()}
        writer.writerow(safe)
    atomic_bytes(output, buffer.getvalue().encode("utf-8"))


def build_comparison(root):
    """Reopen captured original paired metrics without loading native dependencies."""
    root = Path(root)
    plan = read_json(root / "plan.json")
    if plan.get("mode") != MODE or digest({k: v for k, v in plan.items() if k != "plan_sha256"}) != plan["plan_sha256"]:
        raise ScenarioError("The received Upstate plan changed")
    meta = plan["source_manifest"]["index"]
    path = inside(root, meta["path"])
    if path.stat().st_size != meta["bytes"] or file_hash(path) != meta["sha256"]:
        raise ScenarioError("The retained native experiment snapshot changed")
    index = read_json(path)
    if index.get("schema") != INDEX_SCHEMA or index["experiment_id"] != plan["source_manifest"]["original_experiment_id"]:
        raise ScenarioError("Unexpected original experiment snapshot")
    costs = {item["id"]: item["cost_cents"] for item in plan["scenarios"]}
    case_labels = {case["profile_id"]: case.get("profile_title") or case["profile_id"] for case in index["cases"]}
    scenario_labels = {
        case["scenario_id"] if case["kind"] == "landcover" else "baseline":
            case.get("scenario_title") or case["scenario_id"] for case in index["cases"]
    }
    rows, parameter_rows, incomplete = [], [], []
    for case in index["cases"]:
        case_kind = case["kind"]
        scenario = case["scenario_id"] if case_kind == "landcover" else "baseline"
        common = {
            "project_id": plan["project_id"], "setup_id": plan["setup_id"], "plan_sha256": plan["plan_sha256"],
            "case_id": case["profile_id"], "scenario_id": scenario,
            "case_label": case_labels[case["profile_id"]], "scenario_label": scenario_labels[scenario],
            "cost_cents": costs.get(case["scenario_id"]), "currency": plan["currency"],
            "baseline_job": case["baseline_run_id"], "scenario_job": case["run_id"],
            "execution_engine": "natcap.invest/" + case["selection"]["invest_version"],
            "watershed_id": index["grid_id"], "spatial_unit_id": index["grid_id"],
            "spatial_label": "Reporting grid", "source_kind": SOURCE_FORMAT, "grid_id": index["grid_id"],
            "original_experiment_id": index["experiment_id"], "original_case_id": case["id"],
            "original_baseline_run_id": case["baseline_run_id"], "original_scenario_run_id": case["run_id"],
            "original_scenario_id": case["scenario_id"], "case_kind": case_kind,
            "profile_title": case["profile_title"], "scenario_title": case["scenario_title"],
            "source_run_id": case.get("source_run_id"), "source_baseline_run_id": case.get("source_baseline_run_id"),
        }
        for model in _models(case["selection"]):
            run = index["runs"].get(case["run_id"], {})
            availability = {
                "case_id": case["profile_id"], "scenario_id": scenario, "model": model,
                "case_label": case_labels[case["profile_id"]], "scenario_label": scenario_labels[scenario],
                "original_case_id": case["id"], "original_run_id": case["run_id"],
                "native_status": run.get("state", "not_prepared"),
                "native_model_available": model in index["run_scopes"].get(case["run_id"], {}).get("completed_models", []),
                "native_model_retained": model in index["retained_run_models"].get(case["run_id"], []),
                "native_selected_models_complete": bool(index["run_scopes"].get(case["run_id"], {}).get("selected_models_complete")),
            }
            if case["state"] != "complete":
                incomplete.append({**availability, "reason": "original_case_" + case["state"],
                                   "detail": case.get("error", {}).get("message", "")})
                continue
            for metric_name in MODEL_METRICS[model]:
                metric = case.get("metrics", {}).get(metric_name)
                if not isinstance(metric, dict):
                    incomplete.append({**availability, "metric": metric_name, "reason": "native_metric_unavailable"})
                    continue
                if (not isinstance(metric.get("units"), str) or not metric["units"] or
                        type(metric.get("paired_cells")) is not int or metric["paired_cells"] < 0):
                    raise ScenarioError("Original paired metric units/coverage are invalid")
                support = _id(metric.get("support_sha256"), "Paired support SHA256")
                empty = metric["paired_cells"] == 0
                if empty:
                    incomplete.append({**availability, "metric": metric_name, "reason": "no_paired_cells"})
                row = {
                    **common, "model": model, "metric": metric_name, "unit": metric["units"],
                    "baseline": _number(metric.get("baseline_total"), metric_name, nullable=empty),
                    "scenario": _number(metric.get("alternative_total"), metric_name, nullable=empty),
                    "change": _number(metric.get("delta"), metric_name, nullable=empty),
                    "percent_change": _number(metric.get("relative_change_pct"), metric_name, nullable=True),
                    "benefit": _number(metric.get("reduction"), metric_name, nullable=empty),
                    "direction": "minimize", "support_sha256": support,
                    "paired_cells": metric["paired_cells"], "reporting_cells": metric["reporting_cells"],
                    "coverage_fraction": metric["coverage_fraction"], "paired_area_ha": metric["paired_area_ha"],
                    "baseline_valid_cells": metric["baseline_valid_cells"],
                    "alternative_valid_cells": metric["alternative_valid_cells"],
                }
                (rows if case_kind == "landcover" else parameter_rows).append(row)
    output = {
        "schema": 1, "source_kind": SOURCE_FORMAT, "spatial_label": "Reporting grid",
        "project_id": plan["project_id"], "setup_id": plan["setup_id"], "plan_sha256": plan["plan_sha256"],
        "currency": plan["currency"], "grid_id": index["grid_id"], "rows": rows,
        "parameter_rows": parameter_rows, "incomplete": incomplete,
        "case_ids": [item["id"] for item in plan["cases"]], "scenarios": plan["scenarios"],
        "case_labels": case_labels, "scenario_labels": scenario_labels,
        "selected_models": index["selected_models"], "original_counts": index["original_counts"],
        "original_experiment_id": index["experiment_id"],
        "snapshot_started_at": index["snapshot_started_at"],
        "snapshot_completed_at": index["snapshot_completed_at"], "page_count": index["page_count"],
        "interpretation": "Original land-cover effects compare each alternative with its baseline under the same parameter profile and paired valid-cell support. Reference and parameter effects are retained separately. Values and units are carried from the original experiment results.",
        "original_interpretation": index["original_interpretation"],
    }
    atomic_json(root / "reports" / "comparisons.json", output)
    _csv(root / "reports" / "comparisons.csv", rows)
    _csv(root / "reports" / "parameter-effects.csv", parameter_rows)
    _csv(root / "reports" / "incomplete.csv", incomplete)
    return output
