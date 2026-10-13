"""Compose ECO13 plans with the retained Upper Savannah InVEST 3.20 workspace.

The scenario lab owns plans, matched jobs and reports. The original Workspace
owns scientific preparation, native execution, retained runs and comparisons.
"""
from __future__ import annotations

import copy
import importlib
from pathlib import Path
import shutil
import sys
import tempfile

from . import __version__
from .engine import cost, run_workspace, safe_id, stamp, verify_plan
from .store import (ScenarioError, atomic_json, dataset_hash, digest, file_hash,
                    inside, read_json, snapshot, source_family)

BRIDGE_SCHEMA = "upstate.scenario-lab-workspace/v1"
BRIDGE_VERSION = "ED6E-WORKSPACE-BRIDGE-20261013-2"
INVEST_VERSION = "3.20.0"
BINDINGS = {
    "ndr": {
        "registry_id": "watershed_results_ndr",
        "path": "watershed_results_ndr.gpkg", "id_field": "id",
        "metrics": {
            "nitrogen_export": {"field": "n_total_export", "unit": "kg/year", "direction": "minimize"},
            "phosphorus_export": {"field": "p_surface_export", "unit": "kg/year", "direction": "minimize"},
        },
    },
    "sdr": {
        "registry_id": "watershed_results_sdr",
        "path": "watershed_results_sdr.shp", "id_field": "id",
        "metrics": {
            "sediment_export": {"field": "sed_export", "unit": "metric_tonne/year", "direction": "minimize"},
        },
    },
}


def open_workspace(root):
    from model.common import INVEST_VERSION as actual_version
    from model.workspace import Workspace
    if actual_version != INVEST_VERSION:
        raise ScenarioError("This integration requires the current InVEST 3.20.0 Workspace")
    return root if isinstance(root, Workspace) else Workspace(root)


def core_identity() -> dict:
    files = {}
    for name in ("common", "profiles", "workspace", "native", "rasters"):
        module = importlib.import_module("model." + name)
        files["model/" + name + ".py"] = file_hash(Path(module.__file__))
    # These modules are additive in the current native reuse implementation.
    model_root = Path(importlib.import_module("model.native").__file__).parent
    for name in ("model_selection", "reuse", "stage_cache", "native_arguments", "run_assembly"):
        path = model_root / (name + ".py")
        if path.is_file():
            files["model/" + name + ".py"] = file_hash(path)
    return {"bridge": BRIDGE_VERSION, "invest_version": INVEST_VERSION, "files": files}


def _grid(workspace, key, models):
    from model.common import required_roles, verify_file
    record = workspace.get_grid(key)
    folder = workspace.root / "grids" / key
    names = required_roles(models) + ("model_domain", "reporting_mask")
    paths = {name: verify_file(folder, record["files"][name]) for name in names}
    return record, paths


def _args(workspace, grid_id, profile_id, models, *, grid_cache=None):
    """Use the current native.py argument contract, without run directories."""
    key = (grid_id, tuple(models))
    if grid_cache is None:
        grid, paths = _grid(workspace, grid_id, models)
    else:
        if key not in grid_cache:
            grid_cache[key] = _grid(workspace, grid_id, models)
        grid, paths = grid_cache[key]
    profile = workspace._get("profiles", profile_id)
    table, _ = workspace.source_file(profile["source_collection_id"], profile["biophysical_source_id"])
    if file_hash(table) != profile["table_summary"]["sha256"]:
        raise ScenarioError("Retained biophysical table changed")
    common = {"dem_path": str(paths["DEM"]), "lulc_path": str(paths["NLCD"]),
              "watersheds_path": str(paths["model_domain"]),
              "biophysical_table_path": str(table), "n_workers": -1}
    result = {}
    if "ndr" in models:
        result["ndr"] = {**common, **profile["ndr"], "calc_n": True, "calc_p": True,
                         "runoff_proxy_path": str(paths["PRECIPITATION"])}
    if "sdr" in models:
        result["sdr"] = {**common, **profile["sdr"],
                         "erosivity_path": str(paths["R_FACTOR"]),
                         "erodibility_path": str(paths["K_FACTOR"]), "drainage_path": ""}
    return result, grid, paths, profile


def _family_content(path: Path) -> dict:
    """Identity is independent of an input's directory or its filename stem."""
    return {p.name[len(path.stem):] if path.suffix.lower() == ".shp"
            else ("primary" if p == path else p.name[len(path.name):]): file_hash(p)
            for p in source_family(path)}


def _assert_lulc(left: Path, right: Path) -> dict:
    """Compare actual integer categories and valid support, regardless of encoding."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(left) as a, rasterio.open(right) as b:
        if (a.count != 1 or b.count != 1 or a.shape != b.shape or
                a.crs != b.crs or a.transform != b.transform):
            raise ScenarioError("Bound land-cover rasters use different grids")
        if not all(np.issubdtype(np.dtype(p.dtypes[0]), np.integer) for p in (a, b)):
            raise ScenarioError("Bound land cover must use integer categories")
        if any(p.scales != (1.0,) or p.offsets != (0.0,) for p in (a, b)):
            raise ScenarioError("Bound land cover contains an unapplied scale or offset")
        # Keep even very wide regional rasters within an approximately 32-MiB strip.
        height = max(1, min(256, (32 * 1024 * 1024) // max(1, a.width * 18)))
        valid_cells = 0
        for row in range(0, a.height, height):
            window = Window(0, row, a.width, min(height, a.height-row))
            x, y = a.read(1, window=window, masked=True), b.read(1, window=window, masked=True)
            mx, my = np.ma.getmaskarray(x), np.ma.getmaskarray(y)
            if not np.array_equal(mx, my) or not np.array_equal(x.data[~mx], y.data[~my]):
                raise ScenarioError("Prepared land cover differs from the retained Workspace scenario")
            valid_cells += int((~mx).sum())
        return {"comparison": "exact grid, integer categories and valid support",
                "width": a.width, "height": a.height, "valid_cells": valid_cells}


def _domain_signature(path: Path) -> dict:
    import fiona
    from pyproj import CRS
    from shapely.geometry import shape
    with fiona.open(path) as src:
        if "id" not in src.schema["properties"]:
            raise ScenarioError("Current Workspace model-domain vector requires its retained id field")
        crs = CRS.from_user_input(src.crs_wkt or src.crs)
        rows = {}
        for feature in src:
            key = str(feature["properties"]["id"])
            if key in rows or feature["properties"]["id"] is None or not feature.get("geometry"):
                raise ScenarioError("Model-domain IDs must be unique and have geometry")
            geometry = shape(feature["geometry"])
            if not geometry.is_valid or geometry.is_empty:
                raise ScenarioError("Model-domain geometry is invalid")
            rows[key] = geometry.normalize().wkb_hex
        if not rows:
            raise ScenarioError("Model domain is empty")
        return {"crs": crs, "rows": rows}


def _assert_domain(left: Path, right: Path):
    a, b = _domain_signature(left), _domain_signature(right)
    if a["crs"] != b["crs"] or a["rows"] != b["rows"]:
        raise ScenarioError("Sensitivity cases must retain the same model-domain geometry and IDs")


def _scenario(workspace, value: dict, *, baseline=False):
    if bool(value.get("scenario_id")) == bool(value.get("scenario")):
        raise ScenarioError("Select one scenario_id or provide one complete scenario object")
    record = (workspace._get("scenarios", value["scenario_id"]) if value.get("scenario_id")
              else workspace.save_scenario(value["scenario"]))
    expected = "baseline" if baseline else "landcover"
    if record["kind"] != expected:
        raise ScenarioError("Select a " + expected + " scenario for this position")
    return record


def _profile(workspace, case: dict, default_id: str):
    if case.get("profile") and case.get("profile_id"):
        raise ScenarioError("A case selects either profile_id or an inline profile revision")
    if not case.get("profile"):
        return workspace._get("profiles", case.get("profile_id", default_id))
    update = case["profile"]
    base = workspace._get("profiles", default_id)
    if not update.get("title") or not update.get("references"):
        raise ScenarioError("An inline parameter revision needs its own title and source references")
    for key in ("ndr", "sdr"):
        if key in update:
            base[key] = {**base.get(key, {}), **update[key]}
    base.update({k: v for k, v in update.items() if k not in ("ndr", "sdr", "id", "schema", "table_summary")})
    return workspace.save_profile(base)


def freeze_workspace(specification: Path, destination: Path, *, model_workspace=None) -> dict:
    """Freeze a native Workspace selection into the existing scenario-lab format."""
    from model.common import selected_models, verify_file
    from model import rasters

    specification, destination = Path(specification).resolve(), Path(destination).resolve()
    if destination.exists():
        raise ScenarioError("Choose a new scenario-lab workspace directory")
    spec = read_json(specification)
    if spec.get("schema") != BRIDGE_SCHEMA:
        raise ScenarioError("Use an " + BRIDGE_SCHEMA + " selection specification")
    location = model_workspace or spec.get("model_workspace")
    if not location:
        raise ScenarioError("Select the retained model workspace")
    if not hasattr(location, "root"):
        location = (specification.parent / location).resolve()
    workspace = open_workspace(location)
    models = selected_models(spec.get("models"))
    project_id, setup_id = (safe_id(spec.get(k), k) for k in ("project_id", "setup_id"))
    if spec.get("currency") not in {"USD", "EUR", "GBP", "CAD", "AUD", "NZD"}:
        raise ScenarioError("Select an explicit supported two-decimal currency")
    baseline = _scenario(workspace, spec["baseline"], baseline=True)
    alternatives, seen = [], {"baseline"}
    for item in spec.get("scenarios", []):
        item = copy.deepcopy(item)
        name = safe_id(item.get("id"), "scenario id")
        if name in seen:
            raise ScenarioError("Scenario IDs must be unique; baseline is reserved")
        seen.add(name)
        item["cost_cents"] = None if item.get("cost_cents") is None else cost(item["cost_cents"])
        alternatives.append((item, _scenario(workspace, item)))
    if not alternatives:
        raise ScenarioError("Select at least one complete land-cover alternative")
    cases, case_ids = [], set()
    for value in spec.get("cases", [{"id": "central"}]):
        name = safe_id(value.get("id"), "case id")
        if name in case_ids:
            raise ScenarioError("Case IDs must be unique")
        case_ids.add(name)
        profile = _profile(workspace, value, spec["profile_id"])
        cases.append({"id": name, "title": value.get("title", name),
                      "grid_id": value.get("grid_id", spec["grid_id"]), "profile_id": profile["id"]})
    if not cases:
        raise ScenarioError("Select at least one matched parameter/forcing case")

    case_inputs = {}
    grid_cache = {}
    selections = {}
    scenarios = [("baseline", baseline)] + [(i["id"], record) for i, record in alternatives]
    for case in cases:
        case_inputs[case["id"]] = _args(workspace, case["grid_id"], case["profile_id"], models,
                                          grid_cache=grid_cache)
        for name, scenario in scenarios:
            retained = workspace.prepare_run({"grid_id": case["grid_id"], "profile_id": case["profile_id"],
                                               "scenario_id": scenario["id"], "models": list(models)})
            selections[case["id"] + "/" + name] = {"run_id": retained["id"],
                "selection": retained["selection"], "state_at_planning": retained["state"]}
    first = case_inputs[cases[0]["id"]]
    _, first_grid, first_paths, _ = first
    for case in cases[1:]:
        _, grid, paths, _ = case_inputs[case["id"]]
        if grid["id"] != first_grid["id"]:
            _assert_lulc(first_paths["NLCD"], paths["NLCD"])
            _assert_domain(first_paths["model_domain"], paths["model_domain"])

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".workspace-planning-", dir=destination.parent))
    inventory = {}
    retained_paths = {}
    def retain(path):
        path = Path(path)
        signature = WorkspaceExecutor._stat_key(path)
        if signature not in retained_paths:
            relative, entries = snapshot(path, staging)
            inventory.update({e["path"]: e for e in entries})
            retained_paths[signature] = relative
        return retained_paths[signature]
    def retain_args(arguments):
        return {k: retain(v) if k.endswith("_path") and v not in ("", None) else v
                for k, v in arguments.items()}
    try:
        # Native selections and source editions remain inspectable after report export.
        context = {"workspace": workspace.project, "grids": {}, "profiles": {},
                   "scenarios": {}, "sources": {}, "scenario_sources": {}}
        frozen_args = {}
        for case in cases:
            arguments, grid, paths, profile = case_inputs[case["id"]]
            context["grids"][grid["id"]] = grid
            context["profiles"][profile["id"]] = profile
            context["sources"][profile["source_collection_id"]] = workspace._get(
                "sources", profile["source_collection_id"])
            context["sources"][grid["spec"]["source_collection_id"]] = workspace._get(
                "sources", grid["spec"]["source_collection_id"])
            frozen_args[case["id"]] = {m: retain_args(a) for m, a in arguments.items()}
            retain(paths["reporting_mask"])
        for name, scenario in scenarios:
            context["scenarios"][scenario["id"]] = scenario
            if scenario["kind"] == "baseline":
                continue
            collection_id = scenario["source_collection_id"]
            context["sources"][collection_id] = workspace._get("sources", collection_id)
            for patch in scenario["patches"]:
                key = collection_id + "/" + patch["mask_source_id"]
                if key not in context["scenario_sources"]:
                    path, entry = workspace.source_file(collection_id, patch["mask_source_id"])
                    context["scenario_sources"][key] = {"path": retain(path), "entry": entry}

        plan = {"schema": 1, "project_id": project_id, "setup_id": setup_id,
                "currency": spec["currency"], "created_at": stamp(),
                "package_version": __version__, "native": {"invest_version": INVEST_VERSION, "python": sys.executable},
                "source_manifest": {"workspace_id": workspace.project["id"], "context": "workspace-context.json"},
                "lulc_path": retain(first_paths["NLCD"]), "models": {}, "cases": [], "scenarios": [],
                "workspace_bridge": {"schema": BRIDGE_SCHEMA, "version": BRIDGE_VERSION,
                    "workspace_id": workspace.project["id"], "core_at_planning": core_identity(),
                    "selections": selections, "result_support": "complete native model-domain watershed totals"}}
        first_args = frozen_args[cases[0]["id"]]
        for model in models:
            plan["models"][model] = {"args": first_args[model],
                "result": {k: copy.deepcopy(v) for k, v in BINDINGS[model].items() if k != "registry_id"}}
        for case in cases:
            # Keep every case's explicit retained scientific inputs, including forcing rasters.
            plan["cases"].append({"id": case["id"], "title": case["title"],
                                  "overrides": frozen_args[case["id"]]})
        state = {"schema": 1, "jobs": {}, "prepared": {}}
        allowed = set.intersection(*(set(value[3]["table_summary"]["lucodes"]) for value in case_inputs.values()))
        for item, scenario in alternatives:
            name = item["id"]
            output = staging / "prepared" / name / "lulc.tif"
            output.parent.mkdir(parents=True, exist_ok=True)
            def loader(source_id, collection_id=scenario["source_collection_id"]):
                retained = context["scenario_sources"][collection_id + "/" + source_id]
                return inside(staging, retained["path"]), retained["entry"]
            if any(patch["to_code"] not in allowed for patch in scenario["patches"]):
                raise ScenarioError("A scenario destination code is absent from a case's biophysical table")
            existing = workspace.inspect_run(selections[cases[0]["id"] + "/" + name]["run_id"])
            if existing["state"] == "complete" and "landcover" in existing.get("stages", {}):
                stage = existing["stages"]["landcover"]
                native_lulc = verify_file(workspace.root / "runs" / existing["id"], stage["artifact"])
                state["prepared"][name] = {"path": retain(native_lulc),
                    "lulc_sha256": file_hash(native_lulc), "edits": stage["edits"],
                    "preparation": "retained Workspace landcover stage",
                    "source_run_id": existing["id"], "scenario_id": scenario["id"]}
            else:
                edits = rasters.make_scenario(inside(staging, plan["lulc_path"]), output,
                    first_grid["grid"], scenario["patches"], source_loader=loader, allowed_codes=allowed)
                state["prepared"][name] = {"path": output.relative_to(staging).as_posix(),
                    "lulc_sha256": file_hash(output), "edits": edits,
                    "preparation": "model.rasters.make_scenario", "scenario_id": scenario["id"]}
            plan["scenarios"].append({"id": name, "title": item.get("title", scenario["title"]),
                "cost_cents": item["cost_cents"], "interventions": copy.deepcopy(scenario["patches"]),
                "workspace_scenario_id": scenario["id"]})
        atomic_json(staging / "workspace-context.json", context)
        inventory["workspace-context.json"] = {"path": "workspace-context.json",
            "sha256": file_hash(staging / "workspace-context.json"),
            "bytes": (staging / "workspace-context.json").stat().st_size}
        plan["inputs"] = sorted(inventory.values(), key=lambda row: row["path"])
        plan["plan_sha256"] = digest(plan)
        atomic_json(staging / "plan.json", plan)
        atomic_json(staging / "state.json", state)
        atomic_json(staging / "workspace-selection.json", spec)
        # Root is a relocatable connection hint, outside immutable scientific identity.
        atomic_json(staging / "workspace-connection.json", {"model_workspace": str(workspace.root),
            "workspace_id": workspace.project["id"]})
        verify_plan(staging)
        staging.rename(destination)
        return {"workspace": str(destination), "plan_sha256": plan["plan_sha256"],
                "workspace_id": workspace.project["id"], "cases": len(cases),
                "scenarios": len(alternatives), "models": list(models),
                "retained_native_selections": len(selections),
                "complete_selections_available": sum(v["state_at_planning"] == "complete" for v in selections.values()),
                "prepared_landcover": len(state["prepared"])}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


class WorkspaceExecutor:
    """Existing ECO13 executor interface, bound to exact retained Workspace jobs."""

    def __init__(self, root: Path, model_workspace=None):
        self.root = Path(root).resolve()
        self.plan, self.state = verify_plan(self.root)
        bridge = self.plan.get("workspace_bridge", {})
        if bridge.get("schema") != BRIDGE_SCHEMA or self.plan["native"]["invest_version"] != INVEST_VERSION:
            raise ScenarioError("Select a current Workspace-backed scenario plan")
        connection = read_json(self.root / "workspace-connection.json")
        self.workspace = open_workspace(model_workspace or connection["model_workspace"])
        if self.workspace.project["id"] != bridge["workspace_id"]:
            raise ScenarioError("Connected model workspace has a different retained project identity")
        self.bridge = bridge
        self.identity = core_identity()
        self.engine_identity = "upstate-workspace/3.20.0/" + digest(self.identity)
        self._fingerprints = {}
        self._lulc_checks = {}
        self.case_args = {}
        grid_cache = {}
        from model.common import selected_models
        for case in self.plan["cases"]:
            binding = bridge["selections"][case["id"] + "/baseline"]
            selection = binding["selection"]
            arguments, _, _, _ = _args(self.workspace, selection["grid_id"],
                                        selection["profile_id"], selected_models(selection), grid_cache=grid_cache)
            self.case_args[case["id"]] = arguments

    @staticmethod
    def _stat_key(path: Path):
        return tuple((str(member.resolve()), member.stat().st_dev, member.stat().st_ino,
                      member.stat().st_size, member.stat().st_mtime_ns, member.stat().st_ctime_ns)
                     for member in source_family(path))

    def _content(self, path: Path):
        key = self._stat_key(path)
        if key not in self._fingerprints:
            self._fingerprints[key] = _family_content(path)
        return self._fingerprints[key]

    def _match_arguments(self, supplied: dict, retained: dict):
        excluded = {"workspace_dir", "results_suffix", "lulc_path"}
        a, b = ({k: v for k, v in row.items() if k not in excluded} for row in (supplied, retained))
        if set(a) != set(b):
            raise ScenarioError("Scenario job argument keys differ from its retained native selection")
        for name in sorted(a):
            if name.endswith("_path") and a[name] not in ("", None) and b[name] not in ("", None):
                if self._content(Path(a[name])) != self._content(Path(b[name])):
                    raise ScenarioError("Scenario input differs from its retained native selection: " + name)
            elif digest(a[name]) != digest(b[name]):
                raise ScenarioError("Scenario parameter differs from its retained native selection: " + name)
        if supplied.get("results_suffix", "") or retained.get("results_suffix", ""):
            raise ScenarioError("This selection uses separate run directories and empty result suffixes")

    def _relocate_arguments(self, arguments: dict, run_id: str, model: str) -> dict:
        """Resolve recorded absolute paths after a complete model workspace moves."""
        recorded_directory = Path(arguments["workspace_dir"])
        if tuple(recorded_directory.parts[-3:]) != ("runs", run_id, model):
            raise ScenarioError("Retained native argument directory does not match its run")
        recorded_root = recorded_directory.parents[2]
        result = dict(arguments)
        for name, value in arguments.items():
            if name.endswith("_path") and value not in ("", None):
                try:
                    relative = Path(value).relative_to(recorded_root)
                except ValueError as exc:
                    raise ScenarioError("Native input lies outside its recorded model workspace") from exc
                result[name] = str(inside(self.workspace.root, relative.as_posix()))
        return result

    def _stage_arguments(self, record: dict, model: str, stage: dict):
        """Bind the current request and retain the original executed stage."""
        from model.common import digest as native_digest, identifier, verify_file
        directory = self.workspace.root / "runs" / record["id"]
        executed_path = verify_file(directory, stage["arguments"])
        executed = read_json(executed_path)
        requested_item = stage.get("requested_arguments")
        requested_path = verify_file(directory, requested_item) if requested_item else executed_path
        requested = read_json(requested_path)
        current = self._relocate_arguments(requested, record["id"], model)
        origin = Path(executed["workspace_dir"])
        if len(origin.parts) < 3 or origin.parts[-3] != "runs" or origin.parts[-1] != model:
            raise ScenarioError("Original native argument directory does not identify its model run")
        execution_id = identifier(origin.parts[-2])
        runtime = stage.get("runtime") or record.get("runtime", {})
        selected = stage.get("input_signature")
        reuse = stage.get("reused_from")
        if bool(requested_item) != bool(reuse):
            raise ScenarioError("A reused stage must retain its current requested arguments and provenance")
        if selected and native_digest(selected["selection"]) != selected["id"]:
            raise ScenarioError("The retained native stage input signature changed")
        if reuse:
            visited = {record["id"]}
            node, original_id = reuse, None
            while node is not None:
                if not isinstance(node, dict):
                    raise ScenarioError("Native stage reuse provenance is malformed")
                original_id = identifier(node["run_id"])
                if original_id in visited:
                    raise ScenarioError("Native stage reuse provenance contains a cycle")
                visited.add(original_id)
                if node["model"] != model:
                    raise ScenarioError("Native stage reuse provenance selects another model")
                item = node["original_arguments"]
                if any(item[key] != stage["arguments"][key] for key in ("bytes", "sha256")):
                    raise ScenarioError("Native stage reuse changed the original executed argument body")
                node = node.get("previous_reuse")
            if execution_id != original_id:
                raise ScenarioError("Original executed run differs from the retained reuse ancestry")
        elif execution_id != record["id"]:
            raise ScenarioError("Native executed arguments do not belong to their retained run")
        # Completed-stage assembly can accept a different raster/vector encoding
        # after the native core checks every cell/mask or feature/attribute.
        # Retain that acceptance and the original signature; the current request
        # is matched to this workbench's actual inputs by the caller.
        assembly = record.get("assembly", {}).get("models", {}).get(model)
        provenance = {
            "executed_run_id": execution_id, "requested_run_id": record["id"],
            "executed_arguments": dict(stage["arguments"]),
            "requested_arguments": dict(requested_item) if requested_item else None,
            "input_signature": copy.deepcopy(selected),
            "input_signature_digest_verified": bool(selected),
            "input_signature_support": "retained native stage input identity",
            "reused_from": copy.deepcopy(reuse),
            "native_assembly": copy.deepcopy(assembly),
        }
        return current, executed_path, requested_path, runtime, provenance

    def _copy_table(self, source: Path, destination: Path, run_directory: Path, stage: dict) -> list[dict]:
        from model.common import verify_file
        destination.parent.mkdir(parents=True, exist_ok=True)
        retained = {}
        for item in list(stage["files"].values()) + stage.get("companions", []):
            path = inside(run_directory, item["path"])
            if path in retained and any(retained[path][key] != item[key] for key in ("bytes", "sha256")):
                raise ScenarioError("Native table has conflicting retained companion identities")
            retained[path] = item
        inventory = []
        for member in source_family(source):
            if member in retained:
                verify_file(run_directory, retained[member])
            suffix = member.name[len(source.stem):] if source.suffix.lower() == ".shp" else (
                "" if member == source else member.name[len(source.name):])
            target = (destination.with_name(destination.stem + suffix) if source.suffix.lower() == ".shp"
                      else Path(str(destination) + suffix))
            before = file_hash(member)
            shutil.copyfile(member, target)
            if file_hash(target) != before or file_hash(member) != before:
                raise ScenarioError("Native result family changed while it was retained")
            inventory.append({"source": member.relative_to(self.workspace.root).as_posix(),
                              "path": target.relative_to(self.root).as_posix(),
                              "sha256": before, "bytes": target.stat().st_size})
        source_family(destination)
        return inventory

    def __call__(self, model: str, args: dict, expected_version: str, python: str, log: Path) -> dict:
        from model.common import INVEST_SOURCE, verify_file
        if expected_version != INVEST_VERSION or model not in BINDINGS:
            raise ScenarioError("Current Workspace executes selected NDR/SDR models at InVEST 3.20.0")
        log = Path(log).resolve()
        attempt = log.parent
        if not attempt.is_relative_to(self.root / "runs"):
            raise ScenarioError("Scenario executor received an unrelated attempt directory")
        current = read_json(self.root / "state.json")
        job = current["jobs"].get(attempt.parent.name)
        relative_attempt = attempt.relative_to(self.root).as_posix()
        if (not job or job["model"] != model or job["status"] != "running" or
                job["attempts"][-1]["workspace"] != relative_attempt or
                Path(args["workspace_dir"]).resolve() != attempt / "native"):
            raise ScenarioError("Scenario attempt does not match the current retained job")
        scenario_id, case_id = job["scenario_id"], job["case_id"]
        binding = self.bridge["selections"][case_id + "/" + scenario_id]
        expected_lulc = (self.plan["lulc_path"] if scenario_id == "baseline" else
                         self.state["prepared"][scenario_id]["path"])
        if Path(args["lulc_path"]).resolve() != inside(self.root, expected_lulc):
            raise ScenarioError("Scenario attempt changed its selected prepared land cover")
        self._match_arguments(args, self.case_args[case_id][model])
        prepared = self.workspace.prepare_run(binding["selection"])
        if prepared["id"] != binding["run_id"] or prepared["selection"] != binding["selection"]:
            raise ScenarioError("Retained native selection identity changed")

        atomic_json(log.with_suffix(".workspace-request.json"), {
            "schema": BRIDGE_SCHEMA, "model": model, "case_id": case_id,
            "scenario_id": scenario_id, "run_id": binding["run_id"],
            "selection": binding["selection"], "core": self.identity})
        record = self.workspace.run(binding["run_id"])
        if record["state"] != "complete":
            raise ScenarioError("Native Workspace run has not completed")
        run_directory = self.workspace.root / "runs" / record["id"]
        stage = record["stages"][model]
        native_arguments, arguments_path, requested_path, runtime, provenance = self._stage_arguments(
            record, model, stage)
        if (runtime.get("version") != INVEST_VERSION or
                runtime.get("modules", {}).get(model, {}).get("git_blob") != INVEST_SOURCE[model + "_blob"]):
            raise ScenarioError("Retained native stage differs from the selected official InVEST source")
        self._match_arguments(args, native_arguments)
        lulc_pair = (self._stat_key(Path(args["lulc_path"])),
                     self._stat_key(Path(native_arguments["lulc_path"])))
        if lulc_pair not in self._lulc_checks:
            self._lulc_checks[lulc_pair] = _assert_lulc(Path(args["lulc_path"]),
                                                        Path(native_arguments["lulc_path"]))
        native_id = BINDINGS[model]["registry_id"]
        if native_id not in stage["files"]:
            raise ScenarioError("Original native result registry lacks " + native_id)
        table = verify_file(run_directory, stage["files"][native_id])
        target = inside(Path(args["workspace_dir"]), self.plan["models"][model]["result"]["path"])
        copied = self._copy_table(table, target, run_directory, stage)
        for source, name, item in (
                (arguments_path, "workspace-native-arguments.json", stage["arguments"]),
                (requested_path, "workspace-requested-arguments.json", stage.get("requested_arguments"))):
            if item:
                destination = attempt / name
                shutil.copyfile(source, destination)
                if file_hash(destination) != item["sha256"]:
                    raise ScenarioError("Native argument body changed during retention")
        atomic_json(attempt / "workspace-run.json", record)
        local_log = None
        source_log = run_directory / "native.log"
        if source_log.is_file():
            local_log = self.root / "workspace-runs" / record["id"] / "native.log"
            local_log.parent.mkdir(parents=True, exist_ok=True)
            expected_log = file_hash(source_log)
            if not local_log.exists() or file_hash(local_log) != expected_log:
                shutil.copyfile(source_log, local_log)
            if file_hash(local_log) != expected_log:
                raise ScenarioError("Native log changed during retention")
        receipt = {"schema": BRIDGE_SCHEMA, "invest_version": INVEST_VERSION, "model": model,
            "workspace_id": self.workspace.project["id"], "native_run_id": record["id"],
            "selection": record["selection"], "native_run_reused": bool(record.get("reused")),
            "native_stage_reused": bool(provenance["reused_from"]), "stage_provenance": provenance,
            "registry_id": native_id, "registry_path": stage["files"][native_id]["path"],
            "native_family": copied, "native_dataset_sha256": dataset_hash(target),
            "landcover_equivalence": self._lulc_checks[lulc_pair], "core": self.identity,
            "runtime": runtime, "run_runtime": record.get("runtime"),
            "native_log": local_log.relative_to(self.root).as_posix() if local_log else None,
            "native_log_in_model_workspace": (run_directory / "native.log").relative_to(self.workspace.root).as_posix(),
            "result_support": "complete native model domain", "completed_at": stamp()}
        atomic_json(log.with_suffix(".workspace-receipt.json"), receipt)
        log.write_text("Original Workspace run " + record["id"] + "\n"
                       "Native model: " + model + "\n"
                       "Retained native log: " + str(run_directory / "native.log") + "\n",
                       encoding="utf-8")
        return receipt


def binding_status(root: Path, *, model_workspace=None) -> dict:
    driver = WorkspaceExecutor(root, model_workspace)
    records = []
    for name, binding in driver.bridge["selections"].items():
        record = driver.workspace.inspect_run(binding["run_id"])
        records.append({"case_scenario": name, "run_id": record["id"], "state": record["state"],
                        "selection": record["selection"]})
    return {"schema": BRIDGE_SCHEMA, "workspace_id": driver.workspace.project["id"],
            "engine_identity": driver.engine_identity, "native_selections": records,
            "complete": sum(row["state"] == "complete" for row in records), "total": len(records)}


def resume_workspace(root: Path, *, model_workspace=None, compare_native=True) -> dict:
    """Run/resume through the existing job loop and assemble native comparison joins."""
    root = Path(root).resolve()
    driver = WorkspaceExecutor(root, model_workspace)
    state = run_workspace(root, executor=driver, engine_identity=driver.engine_identity)
    comparisons, native_runs = {}, {}
    for case in driver.plan["cases"]:
        identifiers = []
        for scenario in ["baseline"] + [item["id"] for item in driver.plan["scenarios"]]:
            binding = driver.bridge["selections"][case["id"] + "/" + scenario]
            record = driver.workspace.inspect_run(binding["run_id"])
            native_runs[case["id"] + "/" + scenario] = {"run_id": record["id"],
                "state": record["state"], "selection": record["selection"]}
            if record["id"] not in identifiers:
                identifiers.append(record["id"])
        if (compare_native and len(identifiers) > 1 and
                all(driver.workspace.inspect_run(key)["state"] == "complete" for key in identifiers)):
            comparisons[case["id"]] = driver.workspace.compare_runs(identifiers)
    index = {"schema": BRIDGE_SCHEMA, "version": BRIDGE_VERSION,
             "plan_sha256": driver.plan["plan_sha256"], "workspace_id": driver.workspace.project["id"],
             "engine_identity": driver.engine_identity, "native_runs": native_runs,
             "native_comparisons": comparisons, "updated_at": stamp(),
             "table_support": "Native model-domain totals in scenario-lab reports",
             "raster_support": "Original reporting-mask annual-mass differences in Workspace comparisons"}
    atomic_json(root / "reports" / "workspace-bindings.json", index)
    return {"state": state, "workspace_bindings": index}


def adopt_runs(specification: Path, destination: Path, *, model_workspace=None) -> dict:
    """Build a matched workbench directly from completed, selected native runs."""
    from model.common import selected_models
    specification = Path(specification).resolve()
    source = read_json(specification)
    if source.get("schema") != "upstate.scenario-lab-runs/v1":
        raise ScenarioError("Use an upstate.scenario-lab-runs/v1 completed-run selection")
    location = model_workspace or source.get("model_workspace")
    if not location:
        raise ScenarioError("Select the retained model workspace")
    if not hasattr(location, "root"):
        location = (specification.parent / location).resolve()
    workspace = open_workspace(location)
    baseline = workspace.inspect_run(source["baseline_run_id"])
    if baseline["state"] != "complete":
        raise ScenarioError("Adopt selects completed native runs; use plan for new selections")
    selected = baseline["selection"]
    models = selected_models(selected)
    alternatives = []
    for item in source["scenarios"]:
        record = workspace.inspect_run(item["run_id"])
        if record["state"] != "complete":
            raise ScenarioError("Adopt selects completed native runs; use plan for new selections")
        if (record["selection"]["grid_id"] != selected["grid_id"] or
                record["selection"]["profile_id"] != selected["profile_id"] or
                selected_models(record["selection"]) != models):
            raise ScenarioError("Adopt requires matched grid, profile and selected models")
        alternatives.append({"id": item["id"], "title": item.get("title", item["id"]),
                             "scenario_id": record["selection"]["scenario_id"],
                             "cost_cents": item.get("cost_cents")})
    spec = {"schema": BRIDGE_SCHEMA, "model_workspace": str(workspace.root),
            "project_id": source["project_id"], "setup_id": source["setup_id"],
            "currency": source["currency"], "models": list(models),
            "grid_id": selected["grid_id"], "profile_id": selected["profile_id"],
            "baseline": {"scenario_id": selected["scenario_id"]}, "scenarios": alternatives,
            "cases": [{"id": source.get("case_id", "retained")}],
            "adopted_native_runs": {"baseline": baseline["id"],
                                   "alternatives": [item["run_id"] for item in source["scenarios"]]}}
    with tempfile.TemporaryDirectory(prefix="eco-native-selection-") as temporary:
        path = Path(temporary) / "selection.json"
        atomic_json(path, spec)
        return freeze_workspace(path, destination, model_workspace=workspace)
