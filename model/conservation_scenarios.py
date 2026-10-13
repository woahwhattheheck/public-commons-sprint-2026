"""Create an original land-cover scenario from a saved conservation footprint.

Copyright 2026 TokenJunkieLabs. Selected land becomes a retained polygon source.
The maintained Workspace and its NDR/SDR runner calculate the resulting case.
"""
from __future__ import annotations

import json
from pathlib import Path

from .common import (INVEST_VERSION, atomic_json, describe_file, digest, held,
                     identifier, now, output_models, read_json, required_roles,
                     selected_models, verify_file)
from .profiles import checked_parameters, inspect_table
from .reuse import copy_verified
from . import conservation

SCHEMA = "upstate.conservation-scenario/v1"
SEMANTICS = (
    "A selected plan supplies the exact land-cover change footprint. "
    "The saved original scenario must be run through the maintained model to "
    "calculate the effect of changing only that footprint. Existing whole-scenario "
    "differences inside selected land describe those earlier scenarios."
)


def _spec(value):
    if not isinstance(value, dict):
        raise ValueError("Submit a conservation scenario selection")
    value = dict(value)
    plan_id = identifier(value.get("plan_id"))
    title = str(value.get("title") or "").strip()
    reason = str(value.get("reason") or "").strip()
    if not title or not reason:
        raise ValueError("Name the land-cover scenario and explain the proposed change")
    codes = value.get("from_codes")
    if not isinstance(codes, list) or not codes or any(type(x) is not int for x in codes):
        raise ValueError("List the original integer land-cover codes to change")
    to_code = value.get("to_code")
    if type(to_code) is not int:
        raise ValueError("Select the replacement integer land-cover code")
    codes = sorted(set(codes))
    if to_code in codes:
        raise ValueError("Exclude the replacement code from the original codes")
    run = value.get("prepare_run")
    if run is not None:
        if not isinstance(run, dict):
            raise ValueError("Choose the existing grid and parameter profile")
        run = _run_spec(run)
    return {"plan_id": plan_id, "title": title, "reason": reason,
            "from_codes": codes, "to_code": to_code, "prepare_run": run}


def _validate_run(workspace, selection, footprint, layer):
    """Require the actual change footprint inside the native modeled domain."""
    if selection["prepare_run"] is None:
        return None
    run = selection["prepare_run"]
    profile = workspace._get("profiles", run["profile_id"])
    grid = workspace.get_grid(run["grid_id"])
    if grid.get("state") != "complete":
        raise ValueError("Complete the selected model grid before preparing this scenario run")
    allowed = set(profile["table_summary"]["lucodes"])
    if selection["to_code"] not in allowed:
        raise ValueError("The selected parameter table needs coefficients for the replacement land-cover code")
    from . import rasters
    from pyproj import CRS
    crs = CRS.from_user_input(grid["grid"]["crs"])
    selected_rows, _ = rasters.vector_geometry(footprint, layer=layer, target_crs=crs)
    selected = rasters.polygon_union(selected_rows)
    if selected.is_empty or selected.area <= 0:
        raise ValueError("Choose a plan with selected land")
    grid_root = workspace.root / "grids" / grid["id"]
    domain_path = verify_file(grid_root, grid["files"]["model_domain"])
    domain_rows, _ = rasters.vector_geometry(domain_path, target_crs=crs)
    domain = rasters.polygon_union(domain_rows)
    reporting_path = verify_file(grid_root, grid["files"]["reporting_area"])
    report_rows, _ = rasters.vector_geometry(reporting_path, target_crs=crs)
    reporting = rasters.polygon_union(report_rows)
    outside = selected.difference(domain).area
    if outside > max(0.01, selected.area * 1e-9):
        raise ValueError("The selected native model domain does not cover the complete plan footprint. "
                         "Choose a grid covering the full proposed change area.")
    reporting_overlap = selected.intersection(reporting).area
    return {
        "grid_id": grid["id"], "profile_id": profile["id"],
        "covered_fraction": min(1.0, max(0.0, 1.0 - outside / selected.area)),
        "model_domain_covered_fraction": min(1.0, max(0.0, 1.0 - outside / selected.area)),
        "coverage_basis": "Complete proposed change footprint against the original native model_domain",
        "selected_area_ha": selected.area / 10000.0,
        "outside_model_domain_area_ha": outside / 10000.0,
        "reporting_overlap_area_ha": reporting_overlap / 10000.0,
        "reporting_overlap_fraction": min(1.0, max(0.0, reporting_overlap / selected.area)),
        "analysis_crs": crs.to_string(),
        "model_domain": grid["files"]["model_domain"],
        "reporting_area": grid["files"]["reporting_area"],
        "grid_file_reference_root": "grids/" + grid["id"],
    }


def _create_scenario(workspace, value):
    """Save a source-bound native scenario and optionally prepare its original run.

    Repeating exactly the same selection reopens the same scenario/run. A revised
    code, footprint, reason, grid or profile creates another retained selection.
    """
    selection = _spec(value)
    if selection["prepare_run"] is not None:
        selection["prepare_run"] = _effective_run(workspace, selection["prepare_run"])
    plan = conservation.get_plan(workspace, selection["plan_id"])
    if not plan.get("selected_ids"):
        raise ValueError("Select at least one planning unit and save the plan")
    descriptor = plan.get("files", {}).get("footprint")
    if not isinstance(descriptor, dict):
        raise ValueError("Rebuild the saved plan's selected-footprint GeoPackage")
    footprint = verify_file(workspace.root, descriptor)
    layer = descriptor.get("layer", "selected_union")
    stamp = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "selection": selection, "study_id": plan["study_id"],
        "footprint_sha256": descriptor["sha256"], "layer": layer,
        "selected_ids": list(plan["selected_ids"]),
    }
    key = digest(stamp)
    directory = workspace.root / "conservation-scenarios" / key
    directory.mkdir(parents=True, exist_ok=True)
    record_path = directory / "scenario.json"
    with held(workspace.root / ".workspace.lock", blocking=False), held(directory / ".create.lock"):
        if record_path.exists():
            result = read_json(record_path)
            if result.get("state") == "complete":
                workspace._get("scenarios", result["scenario_id"])
                workspace.source_file(result["source_collection_id"], result["mask_source_id"])
                if result.get("run_id"):
                    workspace.inspect_run(result["run_id"])
                return {**result, "reused": True}
        coverage = _validate_run(workspace, selection, footprint, layer)
        source_id = "conservation-plan-union-" + plan["id"]
        mask = directory / "selected-union.gpkg"
        copy_verified(workspace.root, descriptor, directory, path=mask.name)
        manifest = {
            "schema": "upstate.sources/v1",
            "title": selection["title"] + " — selected conservation footprint",
            "captured_at": plan.get("created_at"),
            "scope": {
                "purpose": "Exact union of the saved plan's reporting-clipped planning units",
                "study_id": plan["study_id"], "plan_id": plan["id"],
                "selected_ids": list(plan["selected_ids"]),
                "analysis_crs": plan.get("analysis_crs"),
            },
            "notes": [SEMANTICS],
            "entries": [{
                "id": source_id, "kind": "vector", "role": "SCENARIO_MASK",
                "title": selection["title"] + " — selected land",
                "uri": "urn:upstate:conservation-plan:" + plan["id"] + ":selected-union",
                "vintage": "Saved conservation plan " + plan["id"],
                "path": mask.name, "layer": layer, "sha256": descriptor["sha256"],
                "scope": {
                    "source_plan_id": plan["id"], "source_study_id": plan["study_id"],
                    "footprint_sha256": descriptor["sha256"],
                },
            }],
        }
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        state = {**stamp, "id": key, "state": "preparing",
                 "created_at": now(), "method": SEMANTICS,
                 "run_coverage": coverage}
        if record_path.exists():
            state["created_at"] = read_json(record_path).get("created_at", state["created_at"])
        atomic_json(record_path, state)
        # The original source store and native scenario methods retain their own
        # stable identities. A failed optional run preparation can resume here.
        collection = workspace.import_sources(manifest_path)
        scenario = workspace.save_scenario({
            "title": selection["title"], "kind": "landcover",
            "reason": selection["reason"],
            "source_collection_id": collection["id"],
            "patches": [{
                "mask_source_id": source_id, "layer": layer,
                "from_codes": selection["from_codes"], "to_code": selection["to_code"],
                "reason": selection["reason"],
            }],
            "conservation": {
                "study_id": plan["study_id"], "plan_id": plan["id"],
                "footprint_sha256": descriptor["sha256"],
                "selected_ids": list(plan["selected_ids"]),
            },
        })
        state.update(source_collection_id=collection["id"],
                     mask_source_id=source_id, scenario_id=scenario["id"],
                     scenario=scenario)
        atomic_json(record_path, state)
        if selection["prepare_run"] is not None:
            native_run = workspace.prepare_run({
                **selection["prepare_run"], "scenario_id": scenario["id"],
            })
            state.update(run_id=native_run["id"], run_state=native_run["state"])
        state.update(state="complete", completed_at=now(), files={
            "source_manifest": describe_file(workspace.root, manifest_path),
            "footprint": {**describe_file(workspace.root, mask), "layer": layer},
        })
        atomic_json(record_path, state)
        return state


def _run_spec(value):
    if not isinstance(value, dict):
        raise ValueError("Choose the existing grid and parameter profile")
    result = {"grid_id": identifier(value.get("grid_id")),
              "profile_id": identifier(value.get("profile_id"))}
    if "models" in value:
        result["models"] = selected_models(value)
    return result


def _effective_run(workspace, value):
    """Resolve exactly the native families supported by this grid and profile."""
    requested = _run_spec(value)
    profile = workspace._get("profiles", requested["profile_id"])
    grid = workspace.get_grid(requested["grid_id"])
    if grid.get("state") != "complete":
        raise ValueError("Complete the selected model grid before preparing this scenario run")
    available = [name for name in selected_models(grid["spec"])
                 if name in selected_models(profile)]
    if not available:
        raise ValueError("The selected grid and parameter profile have no native model in common")
    # Inspect the caller's explicit full selection before normalization removes
    # its historical default spelling.
    active = selected_models(value) if "models" in value else available
    if not set(active).issubset(available):
        raise ValueError("The selected models require matching prepared grid inputs and profile parameters")
    missing = set(required_roles(active)) - set(grid["files"])
    if missing:
        raise ValueError("The selected grid lacks native inputs: " + ", ".join(sorted(missing)))
    checked_parameters({**profile, "models": active})
    table, entry = workspace.source_file(profile["source_collection_id"],
                                         profile["biophysical_source_id"])
    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The original biophysical table differs from this saved parameter profile")
    retained = inspect_table(table, selected_models=active)
    if retained["lucodes"] != profile["table_summary"]["lucodes"]:
        raise ValueError("The parameter profile's land-cover rows differ from its original table")
    codes = {int(code) for code in grid["inputs"]["NLCD"]["class_counts"]}
    absent = codes - set(retained["lucodes"])
    if absent:
        raise ValueError("The selected table lacks original grid land-cover codes: "
                         + ", ".join(map(str, sorted(absent))))
    normalized = {"grid_id": grid["id"], "profile_id": profile["id"]}
    if active != ["ndr", "sdr"]:
        normalized["models"] = active
    return normalized


def _native_selection(run, scenario_id):
    return {**run, "scenario_id": identifier(scenario_id)}


def _native_id(selection):
    value = {"schema": "upstate.run-selection/v1",
             "grid_id": selection["grid_id"], "profile_id": selection["profile_id"],
             "scenario_id": selection["scenario_id"], "invest_version": INVEST_VERSION}
    active = selected_models(selection)
    if active != ["ndr", "sdr"]:
        value["models"] = active
    return digest(value)


def _read_scenario_record(workspace, conservation_scenario_id):
    """Read the retained bridge identity without opening its geometry sources."""
    key = identifier(conservation_scenario_id)
    record = read_json(workspace.root / "conservation-scenarios" / key / "scenario.json")
    names = ("schema", "project_id", "selection", "study_id", "footprint_sha256",
             "layer", "selected_ids")
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or digest({name: record[name] for name in names}) != key):
        raise ValueError("The retained conservation scenario selection changed")
    if record["project_id"] != workspace.project["id"]:
        raise ValueError("Open this scenario's original workspace or its complete portable restoration")
    return record


def inspect_scenario(workspace, conservation_scenario_id):
    """Read a retained bridge using its portable selection and footprint identity."""
    record = _read_scenario_record(workspace, conservation_scenario_id)
    plan = conservation.get_plan(workspace, record["selection"]["plan_id"])
    if (plan["study_id"] != record["study_id"]
            or plan["selected_ids"] != record["selected_ids"]
            or plan["files"]["footprint"]["sha256"] != record["footprint_sha256"]):
        raise ValueError("The scenario differs from its saved portfolio footprint")
    if record.get("state") == "complete":
        scenario = workspace._get("scenarios", record["scenario_id"])
        provenance = scenario.get("conservation", {})
        if (provenance.get("plan_id") != plan["id"]
                or provenance.get("footprint_sha256") != record["footprint_sha256"]
                or provenance.get("selected_ids") != record["selected_ids"]):
            raise ValueError("The retained native scenario has another conservation footprint")
        _, entry = workspace.source_file(record["source_collection_id"], record["mask_source_id"])
        if entry["body"]["sha256"] != record["footprint_sha256"]:
            raise ValueError("The native scenario mask differs from the selected portfolio")
        for descriptor in record.get("files", {}).values():
            verify_file(workspace.root, descriptor)
        if record.get("run_id"):
            workspace.inspect_run(record["run_id"])
    return record


def list_scenarios(workspace):
    """List saved portfolio scenarios and their prepared experiment continuations."""
    from . import experiments as experiment_engine
    result = []
    for path in sorted((workspace.root / "conservation-scenarios").glob("*/scenario.json")):
        key = path.parent.name
        try:
            record = _read_scenario_record(workspace, key)
            run = record["selection"]["prepare_run"]
            experiments = []
            for handoff_path in sorted((path.parent / "experiments").glob("*/handoff.json")):
                handoff = read_json(handoff_path)
                if handoff.get("conservation_scenario_id") != key:
                    raise ValueError("A prepared experiment references another conservation scenario")
                item = {name: handoff.get(name) for name in (
                    "id", "state", "experiment_id", "baseline_run_id", "alternative_run_id",
                    "models", "pollutants", "counts", "created_at", "updated_at", "error")}
                item["preparation_state"] = handoff["state"]
                item["prepared_at"] = handoff.get("updated_at")
                if item["experiment_id"]:
                    try:
                        current = experiment_engine._state(workspace, item["experiment_id"])
                        for name in ("state", "models", "pollutants", "counts", "progress",
                                     "created_at", "updated_at", "started_at", "completed_at", "files"):
                            if name in current:
                                item[name] = current[name]
                        item.pop("error", None)
                        if current.get("error"):
                            item["error"] = current["error"]
                    except (OSError, ValueError, KeyError, TypeError) as exc:
                        item["state"] = "unavailable"
                        item["error"] = {"type": type(exc).__name__, "message": str(exc)}
                experiments.append(item)
            result.append({
                "id": key, "conservation_scenario_id": key, "state": record["state"],
                "title": record["selection"]["title"],
                "plan_id": record["selection"]["plan_id"], "study_id": record["study_id"],
                "scenario_id": record.get("scenario_id"), "run_id": record.get("run_id"),
                "prepare_run": run, "models": selected_models(run) if run else [],
                "selected_ids": record["selected_ids"], "footprint_sha256": record["footprint_sha256"],
                "run_coverage": record.get("run_coverage"), "experiments": experiments,
            })
        except (OSError, ValueError, KeyError, TypeError) as exc:
            result.append({"id": key, "state": "unreadable",
                           "error": {"type": type(exc).__name__, "message": str(exc)}})
    return result


def _study_reference(workspace, record):
    study = conservation.inspect(workspace, record["study_id"], include_candidates=False)
    return study["selection"]["spec"].get("baseline_run_id")


def _experiment_run_compatible(candidate):
    """Admit a completed original or the current engine's resumable selection."""
    native = candidate["selection"]
    execution = conservation._native_execution(candidate, require_supported=False)
    if candidate.get("state") == "complete":
        # The original experiment engine validates and binds noncanonical
        # completed selections explicitly; never rewrite their requested version.
        return execution["supported"]
    if native.get("invest_version") != INVEST_VERSION:
        return False
    completed = [name for name in selected_models(native)
                 if ((candidate.get("stages") or {}).get(name) or {}).get("completed_at")]
    return all(execution["model_versions"][name]["comparison_version"] == INVEST_VERSION
               for name in completed)


def _same_scope(workspace, candidate, selection, *, required=False):
    native = candidate["selection"]
    compatible = _experiment_run_compatible(candidate)
    same = (native["grid_id"] == selection["grid_id"]
            and native["profile_id"] == selection["profile_id"]
            and selected_models(native) == selected_models(selection)
            and compatible
            and workspace._get("scenarios", native["scenario_id"])["kind"] == "baseline")
    if required and not same:
        raise ValueError(
            "Choose an original-landcover baseline with the same grid, profile and selected models, "
            "compatible per-model execution versions, and a completed original or current-version resumable selection")
    return same


def _reference_run(workspace, record, selection, baseline_run_id=None):
    """Reuse an actual matching baseline or prepare its unchanged land cover."""
    if baseline_run_id is not None:
        candidate = workspace.inspect_run(identifier(baseline_run_id))
        _same_scope(workspace, candidate, selection, required=True)
        return candidate
    preferred = _study_reference(workspace, record)
    if preferred:
        candidate = workspace.inspect_run(preferred)
        if _same_scope(workspace, candidate, selection):
            return candidate
    # Enumerate baseline scenarios, then address each exact run directly.
    # Large experiment run inventories do not need to be scanned here.
    candidates = []
    for scenario in workspace._list("scenarios"):
        if scenario["kind"] != "baseline":
            continue
        key = _native_id(_native_selection(selection, scenario["id"]))
        if (workspace.root / "runs" / key / "run.json").exists():
            candidate = workspace.inspect_run(key)
            _same_scope(workspace, candidate, selection, required=True)
            candidates.append(candidate)
    if candidates:
        return min(candidates, key=lambda item: (item["state"] != "complete",
                                                item.get("created_at", ""), item["id"]))
    grid = workspace.get_grid(selection["grid_id"])
    scenario = workspace.save_scenario({
        "title": "Original land cover for conservation comparisons",
        "kind": "baseline",
        "reason": "Use the retained grid's original land-cover edition as the reference for selected conservation changes.",
        "source_collection_id": grid["spec"]["source_collection_id"],
    })
    return workspace.prepare_run(_native_selection(selection, scenario["id"]))


def _alternative_run(workspace, record, selection, source_run_ids=()):
    """Use the explicitly selected original, then the scenario's retained run."""
    def same_case(candidate):
        native = candidate["selection"]
        return (native["grid_id"] == selection["grid_id"]
                and native["profile_id"] == selection["profile_id"]
                and native["scenario_id"] == record["scenario_id"]
                and selected_models(native) == selected_models(selection))

    explicit = []
    for run_id in source_run_ids:
        candidate = workspace.inspect_run(run_id)
        if same_case(candidate):
            explicit.append(candidate)
    if len(explicit) > 1:
        raise ValueError("Choose only one original source run for the conservation alternative")
    candidate = explicit[0] if explicit else None
    if candidate is None and record.get("run_id"):
        retained = workspace.inspect_run(record["run_id"])
        if same_case(retained):
            candidate = retained
    if candidate is not None:
        if not _experiment_run_compatible(candidate):
            raise ValueError(
                "The selected conservation alternative needs compatible per-model execution versions "
                "and a completed original or current-version resumable selection")
        return candidate
    return workspace.prepare_run(_native_selection(selection, record["scenario_id"]))


def _experiment_request(value):
    if not isinstance(value, dict):
        raise ValueError("Supply the conservation experiment selection")
    allowed = {"conservation_scenario_id", "title", "reason", "baseline_run_id",
               "prepare_run", "scenario_ids", "profile_ids", "design", "axes", "source_run_ids"}
    extra = set(value) - allowed
    if extra:
        raise ValueError("Unknown conservation experiment fields: " + ", ".join(sorted(extra)))
    requested = dict(value)
    requested["conservation_scenario_id"] = identifier(requested.get("conservation_scenario_id"))
    if requested.get("baseline_run_id") is not None:
        identifier(requested["baseline_run_id"])
    if "source_run_ids" in requested:
        if not isinstance(requested["source_run_ids"], list):
            raise ValueError("Original source run IDs must be a list")
        requested["source_run_ids"] = list(dict.fromkeys(
            identifier(run_id) for run_id in requested["source_run_ids"]))
    return requested


def _experiment_run_selection(workspace, record, request):
    selected = request.get("prepare_run")
    if selected is None:
        selected = record["selection"]["prepare_run"]
    if selected is None:
        baseline_id = request.get("baseline_run_id") or _study_reference(workspace, record)
        if baseline_id:
            baseline = workspace.inspect_run(baseline_id)
            selected = baseline["selection"]
    if selected is None:
        raise ValueError("Choose a prepared grid and parameter profile for the saved conservation scenario")
    return _effective_run(workspace, selected)


def prepare_experiment(workspace, value):
    """Prepare a matched native baseline/portfolio experiment and retain its link."""
    from . import experiments
    request = _experiment_request(value)
    record = inspect_scenario(workspace, request["conservation_scenario_id"])
    if record["state"] != "complete":
        record = _create_scenario(workspace, record["selection"])
    selected = _experiment_run_selection(workspace, record, request)
    plan = conservation.get_plan(workspace, record["selection"]["plan_id"])
    footprint = verify_file(workspace.root, plan["files"]["footprint"])
    coverage = _validate_run(
        workspace, {**record["selection"], "prepare_run": selected}, footprint, record["layer"])
    with held(workspace.root / ".workspace.lock", blocking=False):
        baseline = _reference_run(workspace, record, selected, request.get("baseline_run_id"))
        alternative = _alternative_run(workspace, record, selected, request.get("source_run_ids", ()))
        additional = request.get("scenario_ids", [])
        if not isinstance(additional, list):
            raise ValueError("Additional scenario IDs must be a list")
        scenarios = [record["scenario_id"]]
        for key in additional:
            key = identifier(key)
            if key not in scenarios:
                scenarios.append(key)
        experiment_selection = {
            "schema": "upstate.experiment-selection/v1",
            "title": request.get("title") or record["selection"]["title"] + " - conservation comparison",
            "reason": request.get("reason") or record["selection"]["reason"],
            "baseline_run_id": baseline["id"], "scenario_ids": scenarios,
            "profile_ids": request.get("profile_ids", []),
            "design": request.get("design", "one_at_a_time"), "axes": request.get("axes", []),
            "source_run_ids": list(dict.fromkeys([
                baseline["id"], alternative["id"], *request.get("source_run_ids", [])])),
        }
        preview = experiments.preview(workspace, experiment_selection)
        normalized = preview["selection"]
        destination_codes = set()
        for scenario_id in normalized["scenario_ids"]:
            scenario = workspace._get("scenarios", scenario_id)
            destination_codes.update(patch["to_code"] for patch in scenario.get("patches", []))
        for profile_id in dict.fromkeys([selected["profile_id"]] + normalized["profile_ids"]):
            _effective_run(workspace, {**selected, "profile_id": profile_id,
                                       "models": selected_models(selected)})
            profile = workspace._get("profiles", profile_id)
            absent = destination_codes - set(profile["table_summary"]["lucodes"])
            if absent:
                raise ValueError("Experiment profile " + profile_id
                                 + " lacks scenario replacement codes: "
                                 + ", ".join(map(str, sorted(absent))))
        source_reference = {
            "workspace_id": workspace.project["id"],
            "conservation_scenario_id": record["id"],
            "plan_id": plan["id"], "study_id": plan["study_id"],
            "selected_ids": list(plan["selected_ids"]),
            "footprint": plan["files"]["footprint"],
            "scenario_id": record["scenario_id"],
        }
        link = {
            "schema": "upstate.conservation-experiment-selection/v1",
            "source_reference": source_reference, "selection": normalized,
            "baseline_run_id": baseline["id"], "alternative_run_id": alternative["id"],
        }
        key = digest(link)
        folder = workspace.root / "conservation-scenarios" / record["id"] / "experiments" / key
        with held(folder / ".handoff.lock", blocking=False):
            atomic_json(folder / "selection.json", link, immutable=True)
            previous_path = folder / "handoff.json"
            previous = read_json(previous_path) if previous_path.exists() else None
            retained = {"schema": "upstate.conservation-experiment-handoff/v1",
                "id": key, "state": "preparing",
                "created_at": previous.get("created_at", now()) if previous else now(),
                "conservation_scenario_id": record["id"], "plan_id": plan["id"],
                "study_id": plan["study_id"], "source_reference": source_reference,
                "baseline_run_id": baseline["id"], "alternative_run_id": alternative["id"],
                "models": preview["models"], "pollutants": preview["pollutants"],
                "primary_pair": {"profile_id": selected["profile_id"],
                    "baseline_run_id": baseline["id"], "alternative_run_id": alternative["id"],
                    "scenario_id": record["scenario_id"]},
                "run_coverage": coverage, "selection": normalized}
            atomic_json(previous_path, retained)
            try:
                experiment = experiments.prepare(workspace, normalized)
            except BaseException as exc:
                retained.update(state="failed", updated_at=now(),
                                error={"type": type(exc).__name__, "message": str(exc)})
                atomic_json(previous_path, retained)
                raise
            retained.update(state="prepared", experiment_id=experiment["id"],
                            updated_at=now(), counts=experiment["counts"])
            atomic_json(previous_path, retained)
            return {
                **retained, "experiment": experiment,
                "baseline": baseline, "alternative": alternative,
                "reused": bool(previous and previous.get("experiment_id") == experiment["id"]),
                "files": {
                    "handoff": describe_file(workspace.root, previous_path),
                    "selection": describe_file(workspace.root, folder / "selection.json"),
                    "footprint": plan["files"]["footprint"],
                },
            }


def create_scenario(workspace, value):
    """Create the saved scenario, with an optional prepared paired experiment."""
    if not isinstance(value, dict):
        raise ValueError("Submit a conservation scenario selection")
    continuation = value.get("prepare_experiment")
    if continuation is not None and not isinstance(continuation, dict):
        raise ValueError("Supply the paired experiment options as an object")
    result = _create_scenario(workspace, value)
    result = {**result, "conservation_scenario_id": result["id"]}
    if result["selection"]["prepare_run"] is not None:
        active = selected_models(result["selection"]["prepare_run"])
        result.update(models=active, pollutants=list(output_models(active)))
    if continuation is None:
        return result
    if ("conservation_scenario_id" in continuation
            and continuation["conservation_scenario_id"] != result["id"]):
        raise ValueError("The experiment continuation must use the scenario just prepared")
    prepared = prepare_experiment(workspace, {
        **continuation, "conservation_scenario_id": result["id"]})
    return {
        **result, "conservation_scenario_id": result["id"],
        "plan_id": prepared["plan_id"], "study_id": prepared["study_id"],
        "experiment_id": prepared["experiment_id"], "experiment": prepared["experiment"],
        "baseline_run_id": prepared["baseline_run_id"],
        "alternative_run_id": prepared["alternative_run_id"],
        "models": prepared["models"], "pollutants": prepared["pollutants"],
        "experiment_handoff": {key: item for key, item in prepared.items()
                               if key not in ("experiment", "baseline", "alternative")},
    }


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--experiment", action="store_true",
                        help="Prepare the paired experiment for an existing conservation_scenario_id")
    parser.add_argument("selection", type=Path,
                        help="Retained scenario selection or conservation experiment selection JSON")
    args = parser.parse_args(argv)
    operation = prepare_experiment if args.experiment else create_scenario
    result = operation(Workspace(args.workspace), read_json(args.selection))
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
