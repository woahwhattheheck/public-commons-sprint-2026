"""Compose complementary prepared grids and use the maintained native assembly."""
from __future__ import annotations
import copy
import hashlib
from pathlib import Path
from .common import (INVEST_VERSION, MODELS, MODEL_ROLES, ROLES, atomic_json,
                     canonical, digest, held, identifier, now, read_json,
                     retain_file, verify_file)
from .model_selection import grid_models, run_models, selected
from .reuse import copy_verified, native_companions
from .run_assembly import _input, _match, _scenario


def _input_collection(spec, role):
    """Resolve a retained raster role without changing its original source."""
    choices = spec.get("input_source_collections", {})
    if not isinstance(choices, dict) or set(choices) - set(ROLES):
        raise ValueError("input_source_collections must map physical raster roles to source editions")
    return identifier(choices.get(role, spec["source_collection_id"]))


def _compatible_grids(workspace, grids):
    """Use the maintained exact physical-input comparator on common preparations."""
    from pyproj import CRS
    first, second = (grids[name] for name in MODELS)
    a, b = first["grid"], second["grid"]
    fields = ("transform", "width", "height", "resolution_m", "pixel_area_ha", "bounds")
    if (any(a.get(key) != b.get(key) for key in fields)
            or CRS.from_user_input(a["crs"]) != CRS.from_user_input(b["crs"])):
        raise ValueError("Compose stages prepared on the same actual native grid")
    roots = {name: workspace.root / "grids" / grids[name]["id"] for name in MODELS}
    # The maintained comparator reads native cell/mask and feature/attribute
    # identity, including dataset companions. Native resolution is retained.
    names = {"DEM": "dem_path", "NLCD": "baseline_landcover",
             "reporting_mask": "reporting_mask",
             "model_domain": "watersheds_path", "reporting_area": "watersheds_path"}
    evidence, exact = {}, {}
    for role, input_name in names.items():
        inputs = []
        for name in MODELS:
            item = grids[name]["files"][role]
            path = verify_file(roots[name], item)
            inputs.append(_input(workspace, path, item))
        try:
            receipt = _match(input_name, inputs[0], inputs[1], exact)
        except ValueError as exc:
            raise ValueError("Grid composition differs for " + role + ": " + str(exc)) from exc
        evidence[role] = {**receipt, "input": role}
    return evidence


def _entry(workspace, collection_id, source_id):
    collection = workspace._get("sources", identifier(collection_id))
    entries = [item for item in collection["entries"] if item["id"] == source_id]
    if len(entries) != 1:
        raise ValueError("Joined grid refers to an absent original source edition entry")
    return entries[0]


def _grid_plan(workspace, grids):
    """Compose source metadata while retaining each original source object."""
    base = grids["ndr"]
    bindings, entries, origins = {}, {}, {}
    owners = {role: ("ndr" if role in MODEL_ROLES["ndr"] else "sdr") for role in ROLES}
    for role in ROLES:
        name, grid = owners[role], grids[owners[role]]
        if role not in grid["files"] or role not in grid["inputs"]:
            raise ValueError("Completed " + name.upper() + " grid lacks " + role)
        collection_id = _input_collection(grid["spec"], role)
        source_id = grid["spec"]["input_sources"][role]
        entry = _entry(workspace, collection_id, source_id)
        if grid["inputs"][role]["source_sha256"] != entry["body"]["sha256"]:
            raise ValueError("Joined grid source lineage differs for " + role)
        pair = (collection_id, source_id)
        bindings[role], entries[pair] = pair, entry
        origins[role] = {"source_collection_id": collection_id, "source_id": source_id,
                         "source_sha256": entry["body"]["sha256"], "source_grid_id": grid["id"],
                         "aligned_sha256": grid["files"][role]["sha256"],
                         "aligned_units": grid["files"][role].get("units")}
    for role in ("reporting_area", "model_domain"):
        choice = base["spec"][role]
        pair = (choice.get("source_collection_id", base["spec"]["source_collection_id"]),
                choice["source_id"])
        bindings[role], entries[pair] = pair, _entry(workspace, *pair)
    if (grids["ndr"]["id"] == grids["sdr"]["id"]
            and grid_models(base) == MODELS):
        return {"id": base["id"], "spec": base["spec"], "reused": True,
                "source_origins": origins, "source_composition": None}
    spec = copy.deepcopy(base["spec"])
    spec.pop("models", None)
    spec.pop("base_grid_id", None)
    spec.pop("input_source_collections", None)
    spec["stage_source_grids"] = {name: grids[name]["id"] for name in MODELS}
    source_collections = {pair[0] for pair in bindings.values()}
    composition = None
    if len(source_collections) == 1:
        collection_id = next(iter(source_collections))
        mapped = {pair: pair[1] for pair in entries}
    else:
        mapped = {pair: "joined-" + digest(list(pair)) for pair in entries}
        joined_entries, manifest_entries = [], []
        for pair in sorted(entries):
            original = entries[pair]
            entry = copy.deepcopy(original)
            entry["id"] = mapped[pair]
            entry["source_origin"] = {"source_collection_id": pair[0], "source_id": pair[1]}
            joined_entries.append(entry)
            # These native views are made from the retained source objects by
            # Workspace.source_file; original sidecar relationships stay intact.
            parent = Path("source-views") / pair[0] / digest(pair[1])
            manifest_entry = {key: copy.deepcopy(value) for key, value in entry.items()
                              if key not in ("body", "companions")}
            manifest_entry["path"] = (parent / original["body"].get(
                "view_path", original["body"]["filename"])).as_posix()
            manifest_entry["sha256"] = original["body"]["sha256"]
            manifest_entry["companions"] = [
                {"path": (parent / body.get("view_path", body["filename"])).as_posix(),
                 "sha256": body["sha256"]} for body in original["companions"]]
            manifest_entries.append(manifest_entry)
        scope = {"stage_source_grids": spec["stage_source_grids"],
                 "source_collections": sorted(source_collections)}
        notes = ["Original retained source entries composed for completed NDR and SDR stages.",
                 "Source views are recreated from the original content-addressed objects."]
        manifest = {"schema": "upstate.sources/v1", "title": "Completed-stage source composition",
                    "captured_at": None, "entries": manifest_entries, "notes": notes, "scope": scope}
        manifest_bytes = canonical(manifest) + b"\n"
        manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
        manifest_name = "stage-sources-" + digest(scope) + ".json"
        collection = {"title": manifest["title"], "captured_at": None, "entries": joined_entries,
                      "original_manifest": {"sha256": manifest_sha, "bytes": len(manifest_bytes),
                                            "object": "objects/" + manifest_sha, "filename": manifest_name},
                      "notes": notes, "scope": scope}
        collection_id = digest({**collection, "schema": "upstate.sources/v1"})
        composition = {"manifest": manifest, "manifest_name": manifest_name,
                       "collection": collection, "collection_id": collection_id}
    spec["source_collection_id"] = collection_id
    spec["input_sources"] = {role: mapped[bindings[role]] for role in ROLES}
    for role in ("reporting_area", "model_domain"):
        spec[role]["source_id"] = mapped[bindings[role]]
        if "source_collection_id" in spec[role]:
            spec[role]["source_collection_id"] = collection_id
    return {"id": digest({"spec": spec, "grid": base["grid"]}), "spec": spec,
            "reused": False, "source_origins": origins, "source_composition": composition}


def _joined_grid(workspace, grids, plan):
    """Retain the prepared role union using the current independent transfer path."""
    if plan["reused"]:
        return grids["ndr"]
    composition = plan["source_composition"]
    if composition is not None:
        manifest_path = workspace.root / composition["manifest_name"]
        atomic_json(manifest_path, composition["manifest"], immutable=True)
        actual = retain_file(workspace.root, manifest_path)
        if actual != composition["collection"]["original_manifest"]:
            raise ValueError("Joined source manifest changed during retention")
        retained = workspace._save("sources", composition["collection"])
        if retained["id"] != composition["collection_id"]:
            raise ValueError("Joined source edition differs from its selected identity")
    base, spec, key = grids["ndr"], plan["spec"], plan["id"]
    owners = {role: ("ndr" if role in MODEL_ROLES["ndr"] else "sdr") for role in ROLES}
    directory = workspace.root / "grids" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "grid.json"
    with held(directory / ".grid.lock", blocking=False):
        if state_path.exists():
            state = read_json(state_path)
            if state.get("spec") != spec or state.get("grid") != base["grid"]:
                raise ValueError("Retained composed grid selection changed")
            if (state.get("state") == "complete"
                    and state.get("composition_schema") == "upstate.prepared-grid-composition/v1"):
                for item in state["files"].values():
                    verify_file(directory, item)
                for items in state.get("input_companions", {}).values():
                    for item in items:
                        verify_file(directory, item)
                return workspace.get_grid(key)
        else:
            state = {"schema": "upstate.grid/v1", "id": key, "state": "building",
                     "created_at": now(), "spec": spec, "grid": base["grid"],
                     "files": {}, "inputs": {}, "input_companions": {},
                     "source_origins": plan["source_origins"],
                     "reused_inputs": {}, "transfer": {"files": 0, "bytes": 0, "methods": {}}}
            atomic_json(state_path, state)
        state.setdefault("input_companions", {})
        state.setdefault("reused_inputs", {})
        state.setdefault("transfer", {"files": 0, "bytes": 0, "methods": {}})
        state["source_origins"] = plan["source_origins"]
        try:
            state.pop("error", None)
            state["state"] = "building"
            for role in ROLES + ("model_domain", "reporting_area", "reporting_mask"):
                name = owners.get(role, "ndr")
                original = grids[name]
                root = workspace.root / "grids" / original["id"]
                item = original["files"][role]
                state["files"][role] = {
                    **copy_verified(root, item, directory, transfer=state["transfer"],
                                    replace_mismatch=True),
                    "source_grid_id": original["id"]}
                companions = {value["path"]: value
                              for value in original.get("input_companions", {}).get(role, [])}
                for value in native_companions(root, {role: item}):
                    companions.setdefault(value["path"], value)
                state["input_companions"][role] = [
                    copy_verified(root, companions[path], directory,
                                  transfer=state["transfer"], replace_mismatch=True)
                    for path in sorted(companions)]
                state["reused_inputs"][role] = {
                    "grid_id": original["id"], "path": item["path"], "sha256": item["sha256"]}
                if role in ROLES:
                    state["inputs"][role] = {
                        **original["inputs"][role], "source_id": spec["input_sources"][role],
                        "source_collection_id": spec["source_collection_id"],
                        "original_source_collection_id": _input_collection(original["spec"], role),
                        "original_source_id": original["spec"]["input_sources"][role],
                        "source_grid_id": original["id"]}
                atomic_json(state_path, state)
            state.update(state="complete", completed_at=now(),
                         composition_schema="upstate.prepared-grid-composition/v1")
            atomic_json(state_path, state)
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(state_path, state)
            raise
    return workspace.get_grid(key)


def _collect(workspace, run_ids, *, profile_id=None, scenario_id=None):
    """Select the prepared source union; V5 owns stage and execution compatibility."""
    if (not isinstance(run_ids, (list, tuple)) or len(run_ids) != 2
            or any(not isinstance(key, str) for key in run_ids)):
        raise ValueError("Select the NDR source run ID followed by the SDR source run ID")
    runs = {name: workspace.inspect_run(identifier(key)) for name, key in zip(MODELS, run_ids)}
    for name, run in runs.items():
        if (name not in run_models(run)
                or not run.get("stages", {}).get(name, {}).get("completed_at")):
            raise ValueError("Select the original completed " + name.upper() + " stage")
    if profile_id is None:
        values = {run["selection"]["profile_id"] for run in runs.values()}
        if len(values) != 1:
            raise ValueError("Select the retained full target profile with profile_id or --profile")
        profile_id = next(iter(values))
    profile = workspace._get("profiles", identifier(profile_id))
    if selected(profile) != MODELS:
        raise ValueError("Select the retained full NDR/SDR target profile")
    scenario_id = identifier(scenario_id or runs["ndr"]["selection"]["scenario_id"])
    scenario = workspace._get("scenarios", scenario_id)
    target_scenario = _scenario(workspace, scenario)
    for run in runs.values():
        original = workspace._get("scenarios", run["selection"]["scenario_id"])
        if _scenario(workspace, original) != target_scenario:
            raise ValueError("Compose stages for the same actual original land-cover scenario")
    grids = {name: workspace.get_grid(run["selection"]["grid_id"]) for name, run in runs.items()}
    compatibility = _compatible_grids(workspace, grids)
    plan = _grid_plan(workspace, grids)
    # Use the ordinary full-run identity. Native stage lineage stays in the
    # maintained assembly record and its selected original source runs.
    selection = {"schema": "upstate.run-selection/v1", "grid_id": plan["id"],
                 "profile_id": profile["id"], "scenario_id": scenario["id"],
                 "invest_version": INVEST_VERSION}
    return {"runs": runs, "grids": grids, "grid_plan": plan,
            "source_runs": {name: run["id"] for name, run in runs.items()},
            "selection": selection, "id": digest(selection), "compatibility": compatibility}


def preview(workspace, run_ids, *, profile_id=None, scenario_id=None):
    """Inspect the original grid/source composition before retaining its target."""
    value = _collect(workspace, run_ids, profile_id=profile_id, scenario_id=scenario_id)
    plan = value["grid_plan"]
    return {"schema": "upstate.completed-run-join-preview/v1", "id": value["id"],
            "selection": value["selection"], "grid_id": plan["id"],
            "grid_reused": plan["reused"], "source_origins": plan["source_origins"],
            "compatibility": value["compatibility"], "source_runs": value["source_runs"],
            "source_grids": {name: value["grids"][name]["id"] for name in MODELS},
            "grid": value["grids"]["ndr"]["grid"],
            "assembly": "Workspace.combine_runs / maintained model.run_assembly V5"}


def join_runs(workspace, run_ids, *, profile_id=None, scenario_id=None, execute=True):
    """Compose missing target inputs, then continue the maintained original run."""
    value = _collect(workspace, run_ids, profile_id=profile_id, scenario_id=scenario_id)
    _joined_grid(workspace, value["grids"], value["grid_plan"])
    result = workspace.combine_runs(value["selection"], value["source_runs"], execute=execute)
    if result["id"] != value["id"] or result["selection"] != value["selection"]:
        raise ValueError("The maintained assembly returned another selected target run")
    return result
