"""Native conservation coalition outcomes and interaction attribution.

Every coalition is a retained Workspace scenario and selected-model run.
Action application has one fixed global order, independent of the permutations
used to estimate an allocation. Annual exports are reduced on one finite
reporting-area support shared by every coalition and every selected metric.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from contextvars import ContextVar
from copy import deepcopy
import csv
from itertools import combinations
import math
from pathlib import Path
import random
import time
from typing import Mapping

from .common import (
    atomic_json, describe_file, digest, held, identifier, now, read_json,
    verify_file, retain_file,
)

from .model_selection import required_outputs, run_models, validate_completed_run
from .native_versions import comparison_versions, models_for_outputs

PLAN_KIND = "interaction-plans"
RESULT_KIND = "interaction-results"
MASS_UNITS = {
    "nitrogen_export": "kg/pixel/year",
    "phosphorus_export": "kg/pixel/year",
    "sediment_export": "metric_tonnes/pixel/year",
}
SELECTION_FIELDS = {
    "title", "baseline_run_id", "actions", "estimator", "permutations",
    "seed", "max_cases", "include_pairwise", "zones",
}


def _integer(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError(name + " must be an integer at least " + str(minimum))
    return value


def _title(value, fallback):
    if value is None:
        return fallback
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Titles must be nonempty text")
    return value.strip()


def _object(workspace, kind, key):
    return workspace._get(kind, identifier(key))


def _source_entry(collection, source_id):
    rows = [row for row in collection.get("entries", []) if row.get("id") == source_id]
    if len(rows) != 1:
        raise ValueError("Select one unambiguous retained source: " + str(source_id))
    return rows[0]



def _patch_semantics(workspace, scenario, patch):
    """Physical identity for proving a full scenario's retained baseline prefix."""
    collection = _object(workspace, "sources", scenario["source_collection_id"])
    entry = _source_entry(collection, patch["mask_source_id"])

    def native_file(value):
        return {
            "sha256": value["sha256"], "bytes": value["bytes"],
            "view_path": value.get("view_path", value["filename"]),
        }

    computational = {
        key: deepcopy(value) for key, value in patch.items()
        if key not in ("mask_source_id", "reason", "title", "layer", "from_codes", "where")
    }
    computational.update({
        "layer": patch.get("layer") or entry.get("layer"),
        "from_codes": sorted(set(patch["from_codes"])),
        "where": deepcopy(patch.get("where") or {}),
        "mask": {
            "kind": entry["kind"], "body": native_file(entry["body"]),
            "companions": sorted(
                (native_file(item) for item in entry.get("companions", [])),
                key=lambda item: (item["view_path"], item["sha256"], item["bytes"])),
        },
    })
    return computational


def _action_indexes(workspace, baseline, scenario, raw, action_id):
    available = scenario.get("patches", [])
    if "patch_indexes" in raw:
        return raw["patch_indexes"]
    prefix = baseline.get("patches", [])
    if not prefix:
        return list(range(len(available)))
    matches = len(available) >= len(prefix) and all(
        _patch_semantics(workspace, baseline, before)
        == _patch_semantics(workspace, scenario, after)
        for before, after in zip(prefix, available))
    if not matches:
        raise ValueError(
            "Action " + action_id + " does not begin with the retained baseline edits. "
            "Choose explicit patch_indexes for the intended additional action; "
            "the complete alternative cannot be appended implicitly.")
    indexes = list(range(len(prefix), len(available)))
    if not indexes:
        raise ValueError("Action " + action_id + " contains only the existing baseline edits")
    return indexes


def _coalition_key(mask, count):
    return "c" + format(mask, "0" + str(max(1, (count + 3) // 4)) + "x")


def _coalitions(count, estimator, samples, seed, pairwise, max_cases):
    complete = (1 << count) - 1
    permutations = []
    if estimator == "exact":
        required = 1 << count
        if required > max_cases:
            raise ValueError(
                "Exact allocation requires " + str(required) + " native coalitions; "
                "max_cases is " + str(max_cases) + ". Select permutation sampling "
                "or explicitly increase max_cases.")
        masks = set(range(required))
    else:
        masks = {0, complete}
        masks.update(1 << index for index in range(count))
        if pairwise:
            masks.update((1 << a) | (1 << b) for a, b in combinations(range(count), 2))
        rng = random.Random(seed)
        for _ in range(samples):
            order = list(range(count))
            rng.shuffle(order)
            permutations.append(order)
            mask = 0
            for index in order:
                mask |= 1 << index
                masks.add(mask)
            if len(masks) > max_cases:
                raise ValueError(
                    "The requested permutation design exceeds max_cases="
                    + str(max_cases) + ". Select fewer permutations or explicitly "
                    "increase the available coalition count.")
    if len(masks) > max_cases:
        raise ValueError("Standalone and pairwise coalitions exceed max_cases")
    return sorted(masks, key=lambda mask: (mask.bit_count(), mask)), permutations


def _read_design(workspace, selection):
    if not isinstance(selection, Mapping):
        raise ValueError("Supply a coalition selection object")
    unknown = set(selection) - SELECTION_FIELDS
    if unknown:
        raise ValueError("Unknown coalition selection fields: " + ", ".join(sorted(unknown)))
    baseline = workspace.inspect_run(identifier(selection.get("baseline_run_id")))
    base_selection = deepcopy(baseline["selection"])
    grid = workspace.get_grid(base_selection["grid_id"])
    profile = _object(workspace, "profiles", base_selection["profile_id"])
    base_scenario = _object(workspace, "scenarios", base_selection["scenario_id"])
    raw_actions = selection.get("actions")
    if not isinstance(raw_actions, list) or len(raw_actions) < 2:
        raise ValueError("Choose at least two conservation actions")
    estimator = selection.get("estimator", "exact")
    if estimator not in ("exact", "permutation"):
        raise ValueError("estimator must be exact or permutation")
    samples = _integer(selection.get("permutations", 128), "permutations", 1)
    seed = _integer(selection.get("seed", 0), "seed")
    max_cases = _integer(selection.get("max_cases", 4096), "max_cases", 2)
    pairwise = selection.get("include_pairwise", True)
    if type(pairwise) is not bool:
        raise ValueError("include_pairwise must be a boolean")
    collections, scenarios, actions, seen = {}, {}, [], set()

    def retain_masks(scenario):
        patches = scenario.get("patches", [])
        if not patches:
            return
        collection_id = identifier(scenario.get("source_collection_id"))
        if collection_id not in collections:
            collections[collection_id] = _object(workspace, "sources", collection_id)
        collection = collections[collection_id]
        for patch in patches:
            entry = _source_entry(collection, patch.get("mask_source_id"))
            if entry.get("kind") not in ("vector", "raster"):
                raise ValueError("Each action mask must be a retained vector or binary raster source")
            if entry["kind"] == "raster" and (patch.get("layer") or patch.get("where")):
                raise ValueError("Binary raster action masks do not select a vector layer or attribute filter")

    retain_masks(base_scenario)
    for index, raw in enumerate(raw_actions):
        if not isinstance(raw, Mapping):
            raise ValueError("Each conservation action must be an object")
        unknown = set(raw) - {"id", "title", "scenario_id", "patch_indexes"}
        if unknown:
            raise ValueError("Unknown action fields: " + ", ".join(sorted(unknown)))
        action_id = raw.get("id", "action-" + str(index + 1))
        if not isinstance(action_id, str) or not action_id.strip() or action_id in seen:
            raise ValueError("Action identifiers must be unique nonempty text")
        seen.add(action_id)
        scenario_id = identifier(raw.get("scenario_id"))
        scenario = scenarios.setdefault(scenario_id, _object(workspace, "scenarios", scenario_id))
        available = scenario.get("patches", [])
        if not available:
            raise ValueError("Action " + action_id + " has no retained land-cover patches")
        indexes = _action_indexes(workspace, base_scenario, scenario, raw, action_id)
        if (not isinstance(indexes, list) or not indexes
                or any(type(i) is not int or i < 0 or i >= len(available) for i in indexes)
                or len(set(indexes)) != len(indexes)):
            raise ValueError("Select distinct existing patch indexes for action " + action_id)
        selected = deepcopy(scenario)
        selected["patches"] = [deepcopy(available[i]) for i in indexes]
        retain_masks(selected)
        actions.append({
            "id": action_id, "title": _title(raw.get("title"), scenario.get("title", action_id)),
            "scenario_id": scenario_id, "patch_indexes": list(indexes),
            "source_collection_id": identifier(scenario.get("source_collection_id")),
            "patches": selected["patches"],
        })
    zones = selection.get("zones")
    if zones is not None:
        if not isinstance(zones, Mapping):
            raise ValueError("zones must describe an actual retained vector source")
        unknown = set(zones) - {"source_collection_id", "source_id", "id_field", "layer", "where"}
        if unknown:
            raise ValueError("Unknown zone fields: " + ", ".join(sorted(unknown)))
        zones = deepcopy(dict(zones))
        zones["source_collection_id"] = identifier(zones.get("source_collection_id"))
        collection = collections.setdefault(
            zones["source_collection_id"],
            _object(workspace, "sources", zones["source_collection_id"]))
        if _source_entry(collection, zones.get("source_id")).get("kind") != "vector":
            raise ValueError("Attribution zones must be a retained vector source")
        if not isinstance(zones.get("id_field"), str) or not zones["id_field"].strip():
            raise ValueError("Choose the source field that identifies the real reporting zones")
    masks, permutations = _coalitions(
        len(actions), estimator, samples, seed, pairwise, max_cases)
    normalized = {
        "title": _title(selection.get("title"), "Conservation action interactions"),
        "baseline_run_id": baseline["id"],
        "actions": [{key: deepcopy(action[key]) for key in
                     ("id", "title", "scenario_id", "patch_indexes")} for action in actions],
        "estimator": estimator, "permutations": samples, "seed": seed,
        "max_cases": max_cases, "include_pairwise": pairwise, "zones": zones,
    }
    cases = [{
        "key": _coalition_key(mask, len(actions)), "mask": mask,
        "action_ids": [action["id"] for i, action in enumerate(actions) if mask & (1 << i)],
    } for mask in masks]
    snapshot = {
        "baseline_selection": base_selection,
        "grid": {"id": grid["id"], "spec": deepcopy(grid["spec"]), "grid": deepcopy(grid["grid"])},
        "profile": profile, "baseline_scenario": base_scenario,
        "action_scenarios": scenarios, "source_collections": collections,
    }
    return normalized, actions, cases, permutations, snapshot, baseline


def _preview_value(normalized, actions, cases, permutations, snapshot, baseline):
    return {
        "schema": "upstate.interaction-preview/v1", "selection": normalized,
        "baseline": {"run_id": baseline["id"], "state": baseline.get("state"),
                     "selection": deepcopy(baseline["selection"])},
        "actions": [{key: deepcopy(action[key]) for key in
                     ("id", "title", "scenario_id", "patch_indexes", "source_collection_id")}
                    | {"patch_count": len(action["patches"])} for action in actions],
        "coalitions": cases,
        "summary": {
            "action_count": len(actions), "coalition_count": len(cases),
            "nonbaseline_case_count": len(cases) - 1,
            "estimator": normalized["estimator"],
            "permutation_count": len(permutations),
            "selected_models": deepcopy(baseline["selection"].get("models")),
            "source_collection_count": len(snapshot["source_collections"]),
            "pairwise": normalized["include_pairwise"],
        },
        "application_order": [action["id"] for action in actions],
        "benefit_direction": "baseline annual export minus coalition annual export",
        "support_definition": (
            "Reporting-area cells with finite values in every selected native "
            "export raster across every retained coalition"),
        "overlap_semantics": (
            "Baseline patches first, then selected actions in their fixed global "
            "order. Each from_codes predicate sees the preceding patch results."),
    }


def preview(workspace, selection):
    """Preview exact case count and native selections without preparing any runs."""
    return _preview_value(*_read_design(workspace, selection))


def save_plan(workspace, selection):
    normalized, actions, cases, permutations, snapshot, baseline = _read_design(workspace, selection)
    report = _preview_value(normalized, actions, cases, permutations, snapshot, baseline)
    return workspace._save(PLAN_KIND, {
        "title": normalized["title"], "selection": normalized, "preview": report,
        "actions": actions, "coalitions": cases, "permutation_orders": permutations,
        "snapshot": snapshot,
    })


def _state_path(workspace, plan_id):
    return Path(workspace.root) / "interactions" / identifier(plan_id) / "state.json"


def _read_state(workspace, plan_id):
    path = _state_path(workspace, plan_id)
    if not path.exists():
        return None
    state = read_json(path)
    if state.get("plan_id") != plan_id:
        raise ValueError("Retained interaction state belongs to another plan")
    progress_path = path.with_name("progress.json")
    if progress_path.exists():
        progress = read_json(progress_path)
        if (progress.get("plan_id") != plan_id
                or progress.get("schema") != "upstate.interaction-progress/v1"):
            raise ValueError("Retained interaction progress belongs to another plan")
        if progress.get("checkpoint_generation") == state.get("checkpoint_generation"):
            for key in _PROGRESS_FIELDS:
                if key in progress:
                    state[key] = progress[key]
            active_rows = state.get("active_cases") or [state.get("active_case") or {}]
            for active in active_rows:
                key = active.get("coalition_key")
                if key in state.get("cases", {}) and active.get("run_id") == state["cases"][key]["run_id"]:
                    if active.get("native_state") is not None:
                        state["cases"][key]["state"] = active["native_state"]
    return state

def _state_summary(workspace, plan_id):
    """Read the small status record for catalogs; preserve phase-write ordering."""
    state_path = _state_path(workspace, plan_id)
    if not state_path.exists():
        return None
    progress_path = state_path.with_name("progress.json")
    if (progress_path.exists()
            and progress_path.stat().st_mtime_ns >= state_path.stat().st_mtime_ns):
        progress = read_json(progress_path)
        if (progress.get("plan_id") != plan_id
                or progress.get("schema") != "upstate.interaction-progress/v1"):
            raise ValueError("Retained interaction progress belongs to another plan")
        return progress
    return _read_state(workspace, plan_id)


def get_plan(workspace, plan_id):
    plan = _object(workspace, PLAN_KIND, plan_id)
    return {**plan, "state": _read_state(workspace, plan["id"])}


def list_plans(workspace):
    rows = []
    for plan in workspace._list(PLAN_KIND):
        state = _state_summary(workspace, plan["id"]) or {}
        rows.append({
            "id": plan["id"], "title": plan["title"],
            "baseline_run_id": plan["selection"]["baseline_run_id"],
            "summary": plan["preview"]["summary"],
            "state": state.get("state", "planned"), "phase": state.get("phase", "planned"),
            "completed_cases": state.get("completed_cases", 0),
            "result_id": state.get("result_id"), "updated_at": state.get("updated_at"),
            "execution": state.get("execution"), "active_cases": state.get("active_cases", []),
        })
    return sorted(rows, key=lambda row: (str(row.get("updated_at") or ""), row["id"]), reverse=True)


_PROGRESS_FIELDS = (
    "state", "phase", "updated_at", "completed_cases", "analysis_progress",
    "active_case", "active_cases", "execution", "result_id", "last_result_id", "native_execution_requested",
)
_CHECKPOINT_POLICY = ContextVar("native_interaction_checkpoint_policy", default=None)


@contextmanager
def _checkpoint_session():
    token = _CHECKPOINT_POLICY.set({"boundary": None, "last_progress": -math.inf})
    try:
        yield
    finally:
        _CHECKPOINT_POLICY.reset(token)


def _checkpoint(workspace, state, phase=None):
    if phase is not None:
        state["phase"] = phase
    state["updated_at"] = now()
    path = _state_path(workspace, state["plan_id"])
    policy = _CHECKPOINT_POLICY.get()
    boundary = (
        state.get("state"), state.get("phase"), len(state.get("errors", [])),
        state.get("result_id"), state.get("source_collection_id"),
    )
    full = policy is None or policy["boundary"] != boundary
    if full:
        state["checkpoint_generation"] = state.get("checkpoint_generation", 0) + 1
        state["case_status_snapshot_at"] = state["updated_at"]
        atomic_json(path, state)
    monotonic = time.monotonic()
    if full or monotonic - policy["last_progress"] >= 2.0:
        progress = {
            "schema": "upstate.interaction-progress/v1", "plan_id": state["plan_id"],
            "checkpoint_generation": state["checkpoint_generation"],
            **{key: deepcopy(state[key]) for key in _PROGRESS_FIELDS if key in state},
        }
        atomic_json(path.with_name("progress.json"), progress)
        if policy is not None:
            policy["last_progress"] = monotonic
    if policy is not None:
        policy["boundary"] = boundary


def _new_state(plan):
    return {
        "schema": "upstate.interaction-state/v1", "plan_id": plan["id"],
        "state": "planned", "phase": "planned", "created_at": now(),
        "source_collection_id": None, "mask_source_map": {},
        "cases": {}, "completed_cases": 0, "errors": [],
        "result_id": None, "native_execution_requested": False,
    }


def _check_snapshot(workspace, plan):
    snapshot = plan["snapshot"]
    baseline = workspace.inspect_run(plan["selection"]["baseline_run_id"])
    if baseline["selection"] != snapshot["baseline_selection"]:
        raise ValueError("The selected baseline run changed its immutable native selection")
    current_grid = workspace.get_grid(snapshot["grid"]["id"])
    if {key: current_grid[key] for key in ("id", "spec", "grid")} != snapshot["grid"]:
        raise ValueError("The selected native grid changed")
    for kind, rows in (
        ("profiles", [snapshot["profile"]]),
        ("scenarios", [snapshot["baseline_scenario"]] + list(snapshot["action_scenarios"].values())),
        ("sources", list(snapshot["source_collections"].values())),
    ):
        for row in rows:
            if _object(workspace, kind, row["id"]) != row:
                raise ValueError("An immutable coalition dependency changed: " + kind + "/" + row["id"])


def _composed_masks(workspace, plan, state):
    required = {}
    baseline = plan["snapshot"]["baseline_scenario"]
    groups = [(baseline.get("source_collection_id"), baseline.get("patches", []))]
    groups.extend((action["source_collection_id"], action["patches"]) for action in plan["actions"])
    for collection_id, patches in groups:
        for patch in patches:
            source_id = patch["mask_source_id"]
            key = digest({"collection_id": collection_id, "source_id": source_id})
            required[key] = (collection_id, source_id)
    entries, mapping = [], {}
    for key, (collection_id, source_id) in sorted(required.items()):
        collection = plan["snapshot"]["source_collections"][collection_id]
        entry = deepcopy(_source_entry(collection, source_id))
        native_id = "interaction-mask-" + key
        entry["id"] = native_id
        entry["original_source"] = {"collection_id": collection_id, "source_id": source_id}
        entries.append(entry)
        mapping[key] = native_id
    title = "Retained conservation masks for " + plan["title"]
    notes = [
        "A composed view of original retained source bodies and companions. "
        "Relative native-reader layout is preserved for every mask.",
    ]
    scope = {"purpose": "Ordered conservation coalition scenarios",
             "interaction_plan_id": plan["id"]}
    manifest_path = _state_path(workspace, plan["id"]).parent / "composed-source-manifest.json"
    atomic_json(manifest_path, {
        "schema": "upstate.retained-source-manifest/v1",
        "title": title, "captured_at": state["created_at"],
        "interaction_plan_id": plan["id"],
        "entries": entries, "notes": notes, "scope": scope,
        "source_collections": sorted({item[0] for item in required.values()}),
    }, immutable=True)
    original_manifest = retain_file(workspace.root, manifest_path)
    collection = workspace._save("sources", {
        "title": title, "captured_at": state["created_at"],
        "original_manifest": original_manifest,
        "entries": entries, "notes": notes, "scope": scope,
    })
    state["source_collection_id"] = collection["id"]
    state["mask_source_map"] = mapping
    _checkpoint(workspace, state, "scenarios")
    return collection["id"], mapping


def _remapped_patches(patches, collection_id, mapping):
    result = deepcopy(patches)
    for patch in result:
        key = digest({"collection_id": collection_id, "source_id": patch["mask_source_id"]})
        patch["mask_source_id"] = mapping[key]
    return result


def _prepare_cases(workspace, plan, state):
    collection_id, mapping = _composed_masks(workspace, plan, state)
    baseline = plan["snapshot"]["baseline_scenario"]
    old_selection = plan["snapshot"]["baseline_selection"]
    selected_models = run_models({"selection": old_selection})
    for case in plan["coalitions"]:
        key = case["key"]
        previous = state["cases"].get(key)
        if case["mask"] == 0:
            run = workspace.inspect_run(plan["selection"]["baseline_run_id"])
        else:
            patches = _remapped_patches(
                baseline.get("patches", []), baseline.get("source_collection_id"), mapping)
            for index, action in enumerate(plan["actions"]):
                if case["mask"] & (1 << index):
                    patches.extend(_remapped_patches(
                        action["patches"], action["source_collection_id"], mapping))
            scenario_value = deepcopy(baseline)
            scenario_value.update({
                "title": plan["title"] + " / " + ", ".join(case["action_ids"]),
                "kind": "landcover", "source_collection_id": collection_id,
                "reason": "Ordered coalition of retained conservation actions: "
                          + ", ".join(case["action_ids"]),
                "patches": patches,
                "interaction_context": {"plan_id": plan["id"], "coalition_key": key,
                                        "action_ids": case["action_ids"]},
            })
            scenario = workspace.save_scenario(scenario_value)
            selection = {name: old_selection[name] for name in ("grid_id", "profile_id")}
            selection["scenario_id"] = scenario["id"]
            if "models" in old_selection:
                selection["models"] = deepcopy(old_selection["models"])
            # A retained case keeps the original requested declaration and run ID
            # across native software updates. Only a new case is prepared today.
            run = (workspace.inspect_run(previous["run_id"]) if previous
                   else workspace.prepare_run(selection))
            for name in ("grid_id", "profile_id", "scenario_id"):
                if run["selection"].get(name) != selection[name]:
                    raise ValueError("Native preparation did not preserve coalition " + name)
            if run_models(run) != selected_models:
                raise ValueError("Native preparation did not preserve selected model stages")
            # Completed outcomes are compared by their executed model stages in
            # _native_inputs. A saved requested version is retained as provenance.
        if previous and (
                previous.get("run_id") != run["id"]
                or previous.get("selection") != run["selection"]):
            raise ValueError("A saved coalition checkpoint differs from its immutable action design")
        state["cases"][key] = {
            **deepcopy(case), "run_id": run["id"], "selection": deepcopy(run["selection"]),
            "state": run.get("state", "prepared"),
        }
        state["active_case"] = {
            "coalition_key": key, "run_id": run["id"], "native_state": run.get("state"),
        }
        _checkpoint(workspace, state, "scenarios")
    state["active_case"] = None
    state["completed_cases"] = sum(row["state"] == "complete" for row in state["cases"].values())
    _checkpoint(workspace, state, "prepared")


def _grid_file(workspace, grid, name):
    descriptor = grid.get("files", {}).get(name)
    if descriptor is None:
        descriptor = grid.get("files", {}).get(
            name + (".tif" if name == "reporting_mask" else ".gpkg"))
    if descriptor is None:
        raise ValueError("The retained grid is missing " + name)
    return verify_file(Path(workspace.root) / "grids" / grid["id"], descriptor)


def _native_inputs(workspace, plan, state):
    records, completed_runs, names = [], [], None
    baseline_selection = plan["snapshot"]["baseline_selection"]
    for case in plan["coalitions"]:
        retained = state["cases"].get(case["key"])
        if retained is None:
            raise ValueError("Prepare every coalition before analyzing its native outcomes")
        run = workspace.inspect_run(retained["run_id"])
        if run.get("state") != "complete":
            raise ValueError("Native coalition is not complete: " + case["key"])
        validate_completed_run(run)
        if run["selection"] != retained["selection"]:
            raise ValueError("Native coalition selection changed: " + case["key"])
        for key in ("grid_id", "profile_id"):
            if run["selection"].get(key) != baseline_selection.get(key):
                raise ValueError("Native coalitions differ in " + key)
        if run_models(run) != run_models({"selection": baseline_selection}):
            raise ValueError("Native coalitions differ in selected model stages")
        selected_names = set(run.get("artifacts", {})) & set(MASS_UNITS)
        if not selected_names:
            raise ValueError("The completed native run has no retained annual export rasters")
        if names is None:
            names = selected_names
        elif selected_names != names:
            raise ValueError("Every coalition must retain the same native annual export metrics")
        # The native core omits models for its canonical NDR + SDR selection.
        # Resolve that selection through the same contract used by Workspace.
        expected = set(required_outputs(run_models(run)))
        if selected_names != expected:
            raise ValueError("Native artifacts do not match the retained selected models")
        paths, descriptors = {}, {}
        for name in sorted(selected_names):
            descriptor = deepcopy(run["artifacts"][name])
            if descriptor.get("units") != MASS_UNITS[name]:
                raise ValueError("Native annual mass units differ for " + name)
            paths[name] = verify_file(
                Path(workspace.root) / "runs" / run["id"], descriptor)
            descriptors[name] = descriptor
        records.append({
            **deepcopy(case), "run_id": run["id"], "selection": deepcopy(run["selection"]),
            "artifacts": descriptors, "paths": paths,
        })
        completed_runs.append(run)
    names = sorted(names or [])
    versions = comparison_versions(completed_runs, models_for_outputs(names))
    return records, names, versions


def _assert_grid(dataset, grid):
    import rasterio
    expected = grid["grid"]
    if dataset.count != 1:
        raise ValueError("Native annual export rasters must contain exactly one band")
    if dataset.width != expected["width"] or dataset.height != expected["height"]:
        raise ValueError("A native output has different dimensions from its retained model grid")
    if dataset.crs != rasterio.crs.CRS.from_user_input(expected["crs"]):
        raise ValueError("A native output has a different CRS from its retained model grid")
    if tuple(dataset.transform)[:6] != tuple(expected["transform"])[:6]:
        raise ValueError("A native output has a different transform from its retained model grid")


def _raster_profile(reference, dtype, nodata):
    profile = reference.profile.copy()
    profile.update(
        driver="GTiff", count=1, dtype=dtype, nodata=nodata,
        compress="deflate", tiled=True, blockxsize=256, blockysize=256,
        BIGTIFF="IF_SAFER",
    )
    profile.pop("photometric", None)
    profile.pop("predictor", None)
    return profile


def _zone_shapes(workspace, selection, target_crs):
    if not selection:
        return []
    from shapely.ops import unary_union
    from . import rasters
    path, entry = workspace.source_file(
        selection["source_collection_id"], selection["source_id"])
    rows, _ = rasters.vector_geometry(
        path, layer=selection.get("layer"), where=selection.get("where"),
        target_crs=target_crs)
    field = selection["id_field"]
    groups, original_values = {}, {}
    for row in rows:
        value = row["properties"].get(field)
        if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).strip():
            raise ValueError("Every selected attribution zone needs a nonempty string/integer " + field)
        key = str(value)
        if key in original_values and type(original_values[key]) is not type(value):
            raise ValueError("Zone identifiers collide after string conversion: " + key)
        original_values[key] = value
        geometry = row["geometry"]
        if geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Attribution zones must be actual polygon areas")
        groups.setdefault(key, []).append(geometry)
    output = []
    for index, key in enumerate(sorted(groups), 1):
        geometry = unary_union(groups[key])
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("Selected zone geometry is empty or invalid: " + key)
        output.append({
            "index": index, "id": key, "source_value": original_values[key],
            "geometry": geometry,
        })
    return output


def _write_zones(reference, reporting_path, zones, path):
    import numpy as np
    import rasterio
    from rasterio.enums import MergeAlg
    from rasterio.features import rasterize
    from rasterio.windows import bounds as window_bounds, transform as window_transform
    from shapely.geometry import mapping
    with rasterio.open(reporting_path) as reporting, rasterio.open(
            path, "w", **_raster_profile(reference, "int32", 0)) as target:
        for _, window in reference.block_windows(1):
            height, width = int(window.height), int(window.width)
            left, bottom, right, top = window_bounds(window, reference.transform)
            selected = []
            for zone in zones:
                a, b, c, d = zone["geometry"].bounds
                if a <= right and c >= left and b <= top and d >= bottom:
                    selected.append((mapping(zone["geometry"]), zone["index"]))
            if selected:
                transform = window_transform(window, reference.transform)
                counts = rasterize(
                    [(geometry, 1) for geometry, _ in selected],
                    out_shape=(height, width), transform=transform, fill=0,
                    dtype="uint32", all_touched=False, merge_alg=MergeAlg.add)
                region = reporting.read(1, window=window, masked=True)
                inside = (~np.ma.getmaskarray(region)) & np.isfinite(region.data) & (region.data > 0)
                if np.any((counts > 1) & inside):
                    raise ValueError(
                        "Attribution zones overlap at native cell centres inside the reporting area; "
                        "use a nonoverlapping management-unit partition for additive zone totals")
                values = rasterize(
                    selected, out_shape=(height, width), transform=transform, fill=0,
                    dtype="int32", all_touched=False)
            else:
                values = np.zeros((height, width), dtype=np.int32)
            target.write(values, 1, window=window)


def _shared_support(workspace, plan, state, records, names, directory):
    import numpy as np
    import rasterio
    from . import rasters
    grid = workspace.get_grid(plan["snapshot"]["grid"]["id"])
    reporting_path = _grid_file(workspace, grid, "reporting_mask")
    first = records[0]["paths"][names[0]]
    support_path = directory / "shared-finite-support.tif"
    zones_path = directory / "attribution-zones.tif"
    with rasterio.open(first) as reference, rasterio.open(reporting_path) as reporting:
        _assert_grid(reference, grid)
        rasters.check_same_grid(reference, reporting)
        if reference.crs is None or not reference.crs.is_projected:
            raise ValueError("Native coalition area accounting requires a projected model CRS")
        _, linear_factor = reference.crs.linear_units_factor
        transform = reference.transform
        area_m2 = abs(transform.a * transform.e - transform.b * transform.d) * float(linear_factor) ** 2
        if not math.isfinite(area_m2) or area_m2 <= 0:
            raise ValueError("The actual native grid has no positive finite cell area")
        zones = _zone_shapes(workspace, plan["selection"].get("zones"), reference.crs)
        _write_zones(reference, reporting_path, zones, zones_path)
        reporting_cells = 0
        with rasterio.open(
                support_path, "w", **_raster_profile(reference, "uint8", 0)) as support:
            for _, window in reference.block_windows(1):
                data = reporting.read(1, window=window, masked=True)
                valid = (~np.ma.getmaskarray(data)) & np.isfinite(data.data) & (data.data > 0)
                reporting_cells += int(np.count_nonzero(valid))
                support.write(valid.astype(np.uint8), 1, window=window)
        inputs = [(record["paths"][name], record["key"], name)
                  for record in records for name in names]
        total = len(inputs)
        done = 0
        for offset in range(0, total, 16):
            batch = inputs[offset:offset + 16]
            with ExitStack() as stack:
                datasets = [stack.enter_context(rasterio.open(path)) for path, _, _ in batch]
                support = stack.enter_context(rasterio.open(support_path, "r+"))
                for native in datasets:
                    _assert_grid(native, grid)
                    rasters.check_same_grid(reference, native)
                for _, window in reference.block_windows(1):
                    common = support.read(1, window=window) > 0
                    for native in datasets:
                        if not np.any(common):
                            break
                        values = native.read(1, window=window, masked=True)
                        finite = (~np.ma.getmaskarray(values)) & np.isfinite(values.data)
                        common &= finite
                    support.write(common.astype(np.uint8), 1, window=window)
            done += len(batch)
            state["analysis_progress"] = {
                "completed_rasters": done, "total_rasters": total,
                "support_batch_size": len(batch),
            }
            _checkpoint(workspace, state, "shared-support")
        counts = np.zeros(len(zones) + 1, dtype=np.int64)
        unassigned = 0
        with rasterio.open(support_path) as support, rasterio.open(zones_path) as zone_grid:
            for _, window in reference.block_windows(1):
                common = support.read(1, window=window) > 0
                codes = zone_grid.read(1, window=window)
                bincount = np.bincount(codes[common], minlength=len(zones) + 1)
                if zones:
                    unassigned += int(bincount[0])
                bincount[0] = int(np.count_nonzero(common))
                counts += bincount
        if counts[0] == 0:
            raise ValueError(
                "No reporting-area cell has a finite native value in every coalition "
                "and every selected metric; shared-support attribution has no physical area")
        scopes = [{"index": 0, "id": "reporting-area", "zone_id": None,
                   "title": "Whole reporting area"}]
        scopes.extend({"index": z["index"], "id": "zone:" + z["id"],
                       "zone_id": z["id"], "title": z["id"]} for z in zones)
        for scope in scopes:
            scope["common_valid_cells"] = int(counts[scope["index"]])
            scope["common_area_ha"] = scope["common_valid_cells"] * area_m2 / 10000.0
        return {
            "support_path": support_path, "zones_path": zones_path,
            "reporting_path": reporting_path, "zones": zones, "scopes": scopes,
            "pixel_area_m2": area_m2, "reporting_cells": reporting_cells,
            "reporting_area_ha": reporting_cells * area_m2 / 10000.0,
            "common_valid_cells": int(counts[0]),
            "common_area_ha": int(counts[0]) * area_m2 / 10000.0,
            "excluded_reporting_cells": reporting_cells - int(counts[0]),
            "unassigned_common_cells": unassigned if zones else None,
            "crs": reference.crs.to_wkt(),
        }


def _annual_outcomes(workspace, state, records, names, support):
    import numpy as np
    import rasterio
    scope_count = len(support["scopes"])
    outcomes = []
    with rasterio.open(support["support_path"]) as common_grid, rasterio.open(
            support["zones_path"]) as zone_grid, rasterio.open(support["reporting_path"]) as reporting:
        for record in records:
            for name in names:
                common_mass = [[] for _ in range(scope_count)]
                excluded_mass = [[] for _ in range(scope_count)]
                valid_counts = np.zeros(scope_count, dtype=np.int64)
                with rasterio.open(record["paths"][name]) as native:
                    for _, window in native.block_windows(1):
                        values = native.read(1, window=window, masked=True)
                        region = reporting.read(1, window=window, masked=True)
                        inside = (~np.ma.getmaskarray(region)) & np.isfinite(region.data) & (region.data > 0)
                        finite = (~np.ma.getmaskarray(values)) & np.isfinite(values.data) & inside
                        shared = common_grid.read(1, window=window) > 0
                        if np.any(shared & ~finite):
                            raise ValueError("An output changed after shared native support was calculated")
                        excluded = finite & ~shared
                        codes = zone_grid.read(1, window=window)
                        native_values = np.asarray(values.data, dtype=np.float64)
                        common_sums = np.bincount(
                            codes[shared], weights=native_values[shared], minlength=scope_count)
                        excluded_sums = np.bincount(
                            codes[excluded], weights=native_values[excluded], minlength=scope_count)
                        counts = np.bincount(codes[finite], minlength=scope_count)
                        common_sums[0] = np.sum(native_values[shared], dtype=np.float64)
                        excluded_sums[0] = np.sum(native_values[excluded], dtype=np.float64)
                        counts[0] = int(np.count_nonzero(finite))
                        valid_counts += counts
                        for index in range(scope_count):
                            common_mass[index].append(float(common_sums[index]))
                            excluded_mass[index].append(float(excluded_sums[index]))
                for scope in support["scopes"]:
                    index = scope["index"]
                    annual_mass = math.fsum(common_mass[index])
                    excluded_annual_mass = math.fsum(excluded_mass[index])
                    if not math.isfinite(annual_mass) or not math.isfinite(excluded_annual_mass):
                        raise ValueError("Native annual mass aggregation overflowed")
                    outcomes.append({
                        "coalition_key": record["key"], "mask": record["mask"],
                        "action_ids": deepcopy(record["action_ids"]), "run_id": record["run_id"],
                        "scope_id": scope["id"], "zone_id": scope["zone_id"],
                        "metric": name, "units": MASS_UNITS[name].replace("/pixel", ""),
                        "annual_export": annual_mass if scope["common_valid_cells"] else None,
                        "support_status": "shared" if scope["common_valid_cells"] else "no_common_support",
                        "common_valid_cells": scope["common_valid_cells"],
                        "common_area_ha": scope["common_area_ha"],
                        "finite_reporting_cells": int(valid_counts[index]),
                        "excluded_valid_cells": int(valid_counts[index]) - scope["common_valid_cells"],
                        "excluded_annual_export": excluded_annual_mass,
                    })
                state["analysis_progress"] = {
                    "coalition_key": record["key"], "metric": name,
                    "completed_outcome_rows": len(outcomes),
                }
                _checkpoint(workspace, state, "annual-outcomes")
    return outcomes


def _allocation_rows(plan, outcomes, names, scopes):
    """Allocate a measured native coalition game; permutations never change edits."""
    count = len(plan["actions"])
    full = (1 << count) - 1
    lookup = {(row["scope_id"], row["metric"], row["mask"]): row for row in outcomes}
    actions, pairs, summaries = [], [], []
    for scope in scopes:
        for name in names:
            if scope["common_valid_cells"] == 0:
                empty = {
                    "scope_id": scope["id"], "zone_id": scope["zone_id"],
                    "metric": name, "units": MASS_UNITS[name].replace("/pixel", ""),
                    "common_valid_cells": 0, "common_area_ha": 0.0,
                    "support_status": "no_common_support",
                }
                for action in plan["actions"]:
                    actions.append({
                        **empty, "action_id": action["id"], "action_title": action["title"],
                        "standalone_benefit": None, "shapley_benefit": None,
                        "allocation_method": None, "permutation_sampling_standard_error": None,
                        "permutation_samples": len(plan["permutation_orders"]),
                    })
                summaries.append({
                    **empty, **{key: None for key in (
                        "baseline_annual_export", "combined_annual_export",
                        "combined_benefit", "sum_standalone_benefit", "combined_nonadditivity",
                        "sum_pair_nonadditivity", "higher_order_remainder",
                        "sum_allocated_benefit", "allocation_efficiency_residual",
                        "allocation_method")},
                })
                if plan["selection"]["include_pairwise"]:
                    for a, b in combinations(range(count), 2):
                        pairs.append({
                            **empty, "action_a": plan["actions"][a]["id"],
                            "action_b": plan["actions"][b]["id"], "pair_benefit": None,
                            "sum_standalone_benefit": None, "pair_nonadditivity": None,
                        })
                continue
            exports = {case["mask"]: lookup[(scope["id"], name, case["mask"])]["annual_export"]
                       for case in plan["coalitions"]}
            baseline = exports[0]
            benefits = {mask: baseline - value for mask, value in exports.items()}
            standalone = [benefits[1 << index] for index in range(count)]
            errors = [None] * count
            if plan["selection"]["estimator"] == "exact":
                allocations = []
                for index in range(count):
                    bit = 1 << index
                    terms = []
                    for mask in exports:
                        if mask & bit:
                            continue
                        size = mask.bit_count()
                        weight = 1.0 / (count * math.comb(count - 1, size))
                        terms.append(weight * (exports[mask] - exports[mask | bit]))
                    allocations.append(math.fsum(terms))
                method = "exact_coalition_shapley"
            else:
                samples = [[] for _ in range(count)]
                for order in plan["permutation_orders"]:
                    mask = 0
                    for index in order:
                        after = mask | (1 << index)
                        samples[index].append(exports[mask] - exports[after])
                        mask = after
                allocations = [math.fsum(values) / len(values) for values in samples]
                for index, values in enumerate(samples):
                    if len(values) > 1:
                        errors[index] = math.sqrt(
                            math.fsum((value - allocations[index]) ** 2 for value in values)
                            / (len(values) * (len(values) - 1)))
                method = "sampled_permutation_shapley"
            units = MASS_UNITS[name].replace("/pixel", "")
            common = {
                "scope_id": scope["id"], "zone_id": scope["zone_id"], "metric": name,
                "units": units, "support_status": "shared",
                "common_valid_cells": scope["common_valid_cells"],
                "common_area_ha": scope["common_area_ha"],
            }
            pair_total = None
            if plan["selection"]["include_pairwise"]:
                pair_terms = []
                for a, b in combinations(range(count), 2):
                    mask = (1 << a) | (1 << b)
                    if mask not in benefits:
                        raise ValueError("A requested pairwise native coalition is missing")
                    interaction = benefits[mask] - standalone[a] - standalone[b]
                    pair_terms.append(interaction)
                    pairs.append({
                        **common, "action_a": plan["actions"][a]["id"],
                        "action_b": plan["actions"][b]["id"],
                        "pair_benefit": benefits[mask],
                        "sum_standalone_benefit": standalone[a] + standalone[b],
                        "pair_nonadditivity": interaction,
                    })
                pair_total = math.fsum(pair_terms)
            for index, action in enumerate(plan["actions"]):
                actions.append({
                    **common, "action_id": action["id"], "action_title": action["title"],
                    "standalone_benefit": standalone[index],
                    "shapley_benefit": allocations[index],
                    "allocation_method": method,
                    "permutation_sampling_standard_error": errors[index],
                    "permutation_samples": len(plan["permutation_orders"]),
                })
            combined = benefits[full]
            standalone_sum = math.fsum(standalone)
            allocation_sum = math.fsum(allocations)
            summaries.append({
                **common, "baseline_annual_export": baseline,
                "combined_annual_export": exports[full],
                "combined_benefit": combined, "sum_standalone_benefit": standalone_sum,
                "combined_nonadditivity": combined - standalone_sum,
                "sum_pair_nonadditivity": pair_total,
                "higher_order_remainder": (
                    combined - standalone_sum - pair_total if pair_total is not None else None),
                "sum_allocated_benefit": allocation_sum,
                "allocation_efficiency_residual": combined - allocation_sum,
                "allocation_method": method,
            })
    for row in outcomes:
        row["benefit"] = (lookup[(row["scope_id"], row["metric"], 0)]["annual_export"]
                          - row["annual_export"]) if row["common_valid_cells"] else None
    return actions, pairs, summaries


def _write_csv(path, rows, fields):
    from .common import atomic_bytes
    import io
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        cells = {}
        for key, value in row.items():
            if key not in fields:
                continue
            if isinstance(value, (list, dict)):
                value = json_value(value)
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                value = "'" + value
            cells[key] = value
        writer.writerow(cells)
    atomic_bytes(path, stream.getvalue().encode("utf-8"))


def json_value(value):
    import json
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _write_attribution_geopackage(path, zones, rows, crs):
    if not zones:
        return False
    import fiona
    from shapely.geometry import MultiPolygon, mapping
    geometry_by_id = {zone["id"]: zone["geometry"] for zone in zones}
    schema = {
        "geometry": "MultiPolygon",
        "properties": {
            "zone_id": "str", "action_id": "str", "title": "str", "metric": "str",
            "units": "str", "allocation": "float", "standalone": "float",
            "mc_se": "float", "support_ha": "float", "valid_cells": "int",
            "support": "str",
        },
    }
    with fiona.open(path, "w", driver="GPKG", layer="action_attribution",
                    schema=schema, crs_wkt=crs) as output:
        for row in rows:
            if row["zone_id"] is None:
                continue
            geometry = geometry_by_id[row["zone_id"]]
            if geometry.geom_type == "Polygon":
                geometry = MultiPolygon([geometry])
            output.write({
                "geometry": mapping(geometry),
                "properties": {
                    "zone_id": row["zone_id"], "action_id": row["action_id"],
                    "title": row["action_title"], "metric": row["metric"],
                    "units": row["units"], "allocation": row["shapley_benefit"],
                    "standalone": row["standalone_benefit"],
                    "mc_se": row["permutation_sampling_standard_error"],
                    "support_ha": row["common_area_ha"],
                    "valid_cells": row["common_valid_cells"],
                    "support": row.get("support_status", "shared"),
                },
            })
    return True


def _requested_identity_is_equivalent(records, versions):
    """Keep original result IDs only where their requested binding is accurate."""
    if not records:
        return False
    declared = records[0]["selection"].get("invest_version")
    if any(row["selection"].get("invest_version") != declared for row in records):
        return False
    return all(
        value.get("comparison_version") and
        value["comparison_version"] == value.get("requested_version")
        for row in records for value in versions["runs"][row["run_id"]].values())


def _analysis_identity(workspace, plan, records, versions):
    grid = workspace.get_grid(plan["snapshot"]["grid"]["id"])
    reporting = grid.get("files", {}).get("reporting_mask")
    if reporting is None:
        reporting = grid.get("files", {}).get("reporting_mask.tif")
    identity = {
        "schema": "upstate.interaction-analysis-selection/v1",
        "plan_id": plan["id"], "baseline_run_id": plan["selection"]["baseline_run_id"],
        "grid_id": grid["id"], "reporting_mask": deepcopy(reporting),
        "runs": [{key: deepcopy(record[key]) for key in
                  ("key", "mask", "action_ids", "run_id", "selection", "artifacts")}
                 for record in records],
        "zones": deepcopy(plan["selection"].get("zones")),
        "support_method": "reporting-area-all-coalitions-all-selected-metrics-finite/v1",
        "allocation_method": "fixed-action-order-native-coalition-game/v1",
    }
    if not _requested_identity_is_equivalent(records, versions):
        identity["native_versions"] = deepcopy(versions)
    return identity


def _retained_native_versions(result):
    """Check frozen provenance without requiring historical run directories."""
    versions = result.get("native_versions")
    bound = result["selection"].get("native_versions")
    if versions is None:
        if bound is not None:
            raise ValueError("Retained interaction result lacks its bound native versions")
        return  # Historical results remain readable with their original declaration.
    if bound is not None and bound != versions:
        raise ValueError("Retained interaction result native-version binding differs")
    records = result["selection"]["runs"]
    models = list(models_for_outputs(result["metrics"]))
    if (not models or versions.get("models") != models
            or set(versions.get("versions", {})) != set(models)
            or set(versions.get("runs", {})) != {row["run_id"] for row in records}):
        raise ValueError("Retained interaction native-version scope differs")
    for record in records:
        actual = versions["runs"][record["run_id"]]
        if set(actual) != set(models):
            raise ValueError("Retained interaction native model provenance is incomplete")
        requested = record["selection"].get("invest_version")
        requested = requested.strip() if isinstance(requested, str) and requested.strip() else None
        for model in models:
            version = actual[model].get("comparison_version")
            if not version or version != versions["versions"][model]:
                raise ValueError("Retained interaction execution versions differ")
            if (actual[model].get("model") != model
                    or actual[model].get("requested_version") != requested):
                raise ValueError("Retained interaction native declaration differs")
    if bound is None and not _requested_identity_is_equivalent(records, versions):
        raise ValueError("Retained interaction provenance requires an explicit identity binding")
    expected = [{**deepcopy(record),
                 "native_versions": deepcopy(versions["runs"][record["run_id"]])}
                for record in records]
    if result.get("runs") != expected:
        raise ValueError("Retained native run index provenance differs")


def get_result(workspace, result_id, *, verify=True):
    result_id = identifier(result_id)
    directory = Path(workspace.root) / RESULT_KIND / result_id
    result = read_json(directory / "result.json")
    if (result.get("id") != result_id
            or digest(result.get("selection")) != result_id):
        raise ValueError("Retained native interaction result identity changed")
    _retained_native_versions(result)
    if type(verify) is not bool:
        raise ValueError("verify must be a boolean")
    if verify:
        for descriptor in result.get("artifacts", {}).values():
            verify_file(directory, descriptor)
    return result


def _analyze(workspace, plan, state):
    state["state"] = "analyzing"
    state["active_case"] = None
    state["active_cases"] = []
    _checkpoint(workspace, state, "verify-native")
    records, names, versions = _native_inputs(workspace, plan, state)
    identity = _analysis_identity(workspace, plan, records, versions)
    result_id = digest(identity)
    directory = Path(workspace.root) / RESULT_KIND / result_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".analysis.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            return get_result(workspace, result_id)
        _checkpoint(workspace, state, "shared-support")
        support = _shared_support(workspace, plan, state, records, names, directory)
        _checkpoint(workspace, state, "annual-outcomes")
        outcomes = _annual_outcomes(workspace, state, records, names, support)
        _checkpoint(workspace, state, "allocation")
        actions, pairs, summaries = _allocation_rows(
            plan, outcomes, names, support["scopes"])
        for row in summaries:
            row["efficiency_residual"] = row["allocation_efficiency_residual"]
        _checkpoint(workspace, state, "exports")
        common_fields = [
            "scope_id", "zone_id", "metric", "units", "support_status",
            "common_valid_cells", "common_area_ha",
        ]
        tables = {
            "coalition_outcomes": (
                outcomes, common_fields + [
                    "coalition_key", "mask", "action_ids", "run_id", "annual_export", "benefit",
                    "finite_reporting_cells", "excluded_valid_cells", "excluded_annual_export"]),
            "action_attribution": (
                actions, common_fields + [
                    "action_id", "action_title", "standalone_benefit", "shapley_benefit",
                    "allocation_method", "permutation_samples",
                    "permutation_sampling_standard_error"]),
            "pair_interactions": (
                pairs, common_fields + [
                    "action_a", "action_b", "pair_benefit",
                    "sum_standalone_benefit", "pair_nonadditivity"]),
            "summaries": (
                summaries, common_fields + [
                    "baseline_annual_export", "combined_annual_export",
                    "combined_benefit", "sum_standalone_benefit",
                    "combined_nonadditivity", "sum_pair_nonadditivity",
                    "higher_order_remainder", "sum_allocated_benefit",
                    "allocation_efficiency_residual", "allocation_method"]),
        }
        artifacts = {
            "shared_finite_support": describe_file(
                directory, support["support_path"], units="binary native cell support",
                common_valid_cells=support["common_valid_cells"],
                pixel_area_m2=support["pixel_area_m2"]),
            "attribution_zones": describe_file(
                directory, support["zones_path"], units="retained source zone index",
                source_selection=plan["selection"].get("zones"),
                zone_index=[{key: zone[key] for key in ("index", "id", "source_value")}
                            for zone in support["zones"]]),
        }
        for name, (rows, fields) in tables.items():
            path = directory / (name.replace("_", "-") + ".csv")
            _write_csv(path, rows, fields)
            artifacts[name + "_csv"] = describe_file(directory, path, rows=len(rows))
        native_run_index = [
            {**deepcopy(record), "native_versions": deepcopy(versions["runs"][record["run_id"]])}
            for record in identity["runs"]]
        index_path = directory / "native-run-index.json"
        atomic_json(index_path, native_run_index)
        artifacts["native_run_index"] = describe_file(directory, index_path)
        geometry_path = directory / "zonal-action-attribution.gpkg"
        if _write_attribution_geopackage(
                geometry_path, support["zones"], actions, support["crs"]):
            artifacts["zonal_action_attribution"] = describe_file(
                directory, geometry_path, layer="action_attribution",
                source_selection=plan["selection"]["zones"],
                rows=sum(row["zone_id"] is not None for row in actions))
        result = {
            "schema": "upstate.interaction-result/v1", "id": result_id,
            "plan_id": plan["id"], "title": plan["title"], "created_at": now(),
            "selection": identity,
            "selected_models": deepcopy(plan["snapshot"]["baseline_selection"].get("models")),
            "metrics": names,
            "application_order": [action["id"] for action in plan["actions"]],
            "estimator": plan["selection"]["estimator"],
            "permutation_samples": len(plan["permutation_orders"]),
            "support": {
                "definition": plan["preview"]["support_definition"],
                **{key: support[key] for key in (
                    "pixel_area_m2", "reporting_cells", "reporting_area_ha",
                    "common_valid_cells", "common_area_ha", "excluded_reporting_cells",
                    "unassigned_common_cells")},
                "common_area_is_shared_by_all_metrics": True,
                "zone_membership": "native cell centre; nonoverlapping dissolved source IDs",
            },
            "scopes": support["scopes"], "summaries": summaries,
            "action_attribution": actions, "pair_interactions": pairs,
            "coalition_outcomes": outcomes, "runs": native_run_index,
            "native_versions": deepcopy(versions),
            "native_version_binding": ("executed_model_cohort" if "native_versions" in identity
                                       else "legacy_requested_equivalent"),
            "artifacts": artifacts,
            "interpretation": {
                "csv_string_safety": (
                    "Leading spreadsheet formula/control characters in string cells "
                    "are prefixed with an apostrophe; numeric values retain their "
                    "numeric type and sign. Original identifiers remain in JSON and GeoPackage."),
                "benefit": "Baseline annual export minus coalition annual export",
                "nonadditivity": "Combined benefit minus the sum of standalone benefits",
                "pair_nonadditivity": "Pair benefit minus the two standalone benefits",
                "higher_order_remainder": (
                    "Combined nonadditivity minus all standalone pair nonadditivities"),
                "permutation_sampling_standard_error": (
                    "Monte Carlo uncertainty in allocation over the retained permutation "
                    "design; native physical outputs are unchanged"),
                "coverage": (
                    "Finite native mass outside shared support is reported separately "
                    "for every coalition, metric and reporting scope"),
                "portfolio_use": (
                    "Evaluate a different selected portfolio through its own retained "
                    "coalition game and corresponding common physical support"),
            },
        }
        atomic_json(result_path, result, immutable=True)
        return result


def _record_result(workspace, state, result):
    previous = state.get("result_id") or state.get("last_result_id")
    if previous and previous != result["id"]:
        history = state.setdefault("result_history", [])
        if previous not in history:
            history.append(previous)
    state["result_id"] = result["id"]
    state["last_result_id"] = result["id"]
    state["state"] = "complete"
    state["completed_cases"] = len(state["cases"])
    state["errors"] = []
    _checkpoint(workspace, state, "done")


def analyze_plan(workspace, plan_id):
    """Analyze completed actual native cases without launching any model runs."""
    plan = _object(workspace, PLAN_KIND, plan_id)
    with held(_state_path(workspace, plan["id"]).parent / ".interaction.lock", blocking=False), _checkpoint_session():
        _check_snapshot(workspace, plan)
        state = _read_state(workspace, plan["id"])
        if state is None:
            raise ValueError("Prepare the retained coalition plan before analyzing native results")
        state["state"] = "analyzing"
        state["errors"] = []
        if state.get("result_id"):
            state["last_result_id"] = state["result_id"]
        state["result_id"] = None
        _checkpoint(workspace, state, "analysis")
        try:
            result = _analyze(workspace, plan, state)
            _record_result(workspace, state, result)
            return deepcopy(state)
        except Exception as exc:
            state["state"] = "failed"
            state["errors"] = [{"phase": state["phase"], "error_type": type(exc).__name__,
                               "message": str(exc)}]
            _checkpoint(workspace, state)
            raise


def apply_plan(workspace, plan_id, run_models=False, *, workers=1, reuse_source_run_ids=None):
    """Prepare or resume all retained coalitions using the original Workspace runner."""
    if type(run_models) is not bool:
        raise ValueError("run_models must be a boolean")
    from .interaction_dispatch import options, run_cases
    workers, donors = options(workspace, workers, reuse_source_run_ids)
    plan = _object(workspace, PLAN_KIND, plan_id)
    with held(_state_path(workspace, plan["id"]).parent / ".interaction.lock", blocking=False), _checkpoint_session():
        _check_snapshot(workspace, plan)
        state = _read_state(workspace, plan["id"]) or _new_state(plan)
        state["state"] = "preparing"
        state["errors"] = []
        state["native_execution_requested"] = bool(state["native_execution_requested"]) or run_models
        if state.get("result_id"):
            state["last_result_id"] = state["result_id"]
        state["result_id"] = None
        _checkpoint(workspace, state, "sources")
        try:
            _prepare_cases(workspace, plan, state)
            if not run_models:
                state["state"] = "prepared"
                _checkpoint(workspace, state, "prepared")
                return deepcopy(state)
            run_cases(
                workspace, plan, state, workers=workers, reuse_source_run_ids=donors,
                checkpoint=lambda phase: _checkpoint(workspace, state, phase))
            if state["errors"]:
                state["state"] = "failed"
                _checkpoint(workspace, state, "native")
                return deepcopy(state)
            result = _analyze(workspace, plan, state)
            _record_result(workspace, state, result)
            return deepcopy(state)
        except Exception as exc:
            state["state"] = "failed"
            state["errors"].append({
                "phase": state["phase"], "error_type": type(exc).__name__, "message": str(exc)})
            _checkpoint(workspace, state)
            raise
