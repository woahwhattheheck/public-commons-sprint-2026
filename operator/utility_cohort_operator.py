"""Utility cohort desk for the original operator queue, state and downloads."""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import time

from model.common import (INVEST_VERSION, atomic_json, describe_file, digest,
                          identifier, now, read_json, relative_file, verify_file)
from model import (model_selection, native_versions, rasters, scenario_decisions,
                   utility_scenario_cohort as core)

ACTION = "utility.cohort.build"
ROOT = "utility-scenario-cohorts"
POLLUTANTS = tuple(core.POLLUTANTS)
LABELS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
          "sediment_export": "Sediment"}
PHASES = {"selections": "Binding original source areas", "analysis": "Planning priorities",
          "native_decisions": "Native physical outcomes",
          "utility_comparisons": "Joining utility outcomes", "complete": "Complete"}


def _signature(path):
    value = path.stat()
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


@lru_cache(maxsize=4)
def _json_cached(path, signature):
    # The original stat identity changes on every atomic replacement.
    return read_json(path)


def _json(path):
    return _json_cached(str(path), _signature(path))


def _cohort(workspace, key):
    key = identifier(key)
    directory = workspace.root / ROOT / key
    path = relative_file(workspace.root, ROOT + "/" + key + "/cohort.json")
    value = _json(path)
    if value.get("schema") != core.SCHEMA or value.get("id") != key:
        raise ValueError("The retained utility cohort has a different identity")
    return directory, value


def _compact(value):
    plan = value.get("analysis_selection", {})
    products = {name: {"id": product["id"], "directory": product["directory"]}
                for name, product in value.get("products", {}).items()}
    result = {name: value.get(name) for name in (
        "id", "title", "state", "phase", "created_at", "updated_at", "completed_at",
        "failed_at", "baseline_run_id", "run_ids", "grid_id", "row_count", "error")}
    result.update(schema="upstate.utility-cohort-operator-summary/v1",
                  report_kind=value.get("report_kind") or (
                      "reference_totals" if len(value.get("run_ids", [])) == 1 else "scenario_comparison"),
                  products=products, weight_grid=value.get("weight_grid", {}),
                  comparison_pollutants=value.get("comparison_pollutants", list(POLLUTANTS)),
                  source={name: value.get("source", {}).get(name) for name in (
                      "source_collection_id", "source_id", "title", "vintage")},
                  analysis_selection_sha256=digest(plan) if plan else None,
                  source_area_count=len(value.get("zone_bindings", [])))
    execution = value.get("native_execution")
    if isinstance(execution, dict):
        result["native_execution"] = {name: execution.get(name) for name in (
            "policy", "models", "versions")}
    progress = value.get("progress")
    if isinstance(progress, dict) and "label" in progress:
        result["progress"] = progress
    else:
        result["progress"] = {
            "phase": result.get("phase"), "label": PHASES.get(result.get("phase"), "Preparing"),
            "completed": value.get("row_count") if value.get("state") == "complete" else None,
            "total": value.get("row_count") if value.get("state") == "complete" else None,
            "unit": "outcome rows" if value.get("state") == "complete" else None,
            "percent": 100.0 if value.get("state") == "complete" else None,
            "updated_at": value.get("updated_at"), "detail": progress,
        }
    return result


@lru_cache(maxsize=128)
def _saved_summary(path, signature):
    path = Path(path)
    value = read_json(path)
    if path.name == "operator-summary.json":
        return value
    return _compact(value)


def _summary(directory):
    original = directory / "cohort.json"
    operator_summary = directory / "operator-summary.json"
    selected = operator_summary if (operator_summary.is_file()
                and operator_summary.stat().st_mtime_ns >= original.stat().st_mtime_ns) else original
    summary = _saved_summary(str(selected), _signature(selected))
    if summary.get("id") != directory.name:
        raise ValueError("A utility summary refers to a different cohort")
    return dict(summary)


@lru_cache(maxsize=128)
def _analysis_progress(path, signature):
    value = read_json(path)
    selection = value.get("selection")
    if selection is None:
        selection = value.get("selections")
    if not isinstance(selection, dict):
        return None
    return {"id": value["id"], "selection_sha256": digest(selection),
            "state": value.get("state"), "progress": value.get("progress"),
            "updated_at": value.get("updated_at") or value.get("created_at") or "",
            "error": value.get("error")}


def overview(operator, workspace_key):
    workspace = operator.ws(workspace_key)
    rows = []
    for path in (workspace.root / ROOT).glob("*/cohort.json"):
        try:
            rows.append(_summary(path.parent))
        except (ValueError, OSError, KeyError, TypeError) as error:
            rows.append({"id": path.parent.name, "title": "Utility cohort",
                         "state": "unreadable", "error": {"message": str(error)}})
    active = {row.get("analysis_selection_sha256"): row for row in rows
              if row.get("state") == "building" and row.get("phase") == "analysis"}
    if active:
        latest = {}
        for path in (workspace.root / "analyses").glob("*/summary.json"):
            try:
                summary = _analysis_progress(str(path), _signature(path))
            except (ValueError, OSError, KeyError, TypeError):
                continue
            key = summary["selection_sha256"] if summary else None
            if key in active and summary.get("progress"):
                if summary["updated_at"] >= latest.get(key, {}).get("updated_at", ""):
                    latest[key] = summary
        for key, summary in latest.items():
            active[key]["progress"] = {**summary["progress"], "product": "analysis",
                                        "analysis_id": summary["id"]}
    return sorted(rows, key=lambda row: row.get("created_at") or "", reverse=True)


def _catalog(operator, workspace_key):
    workspace = operator.ws(workspace_key)
    profiles = {item["id"]: item for item in workspace._list("profiles")}
    scenarios = {item["id"]: item for item in workspace._list("scenarios")}
    sources, runs, issues = [], [], []
    for collection in workspace.sources():
        for source in collection.get("entries", []):
            if source.get("kind") == "vector" and source.get("role") == core.SOURCE_ROLE:
                sources.append({
                    "source_collection_id": collection["id"], "source_id": source["id"],
                    "title": source.get("title", source["id"]), "vintage": source.get("vintage"),
                    "uri": source.get("uri"), "layer": source.get("layer"),
                    "sha256": source.get("body", {}).get("sha256"),
                    "bytes": source.get("body", {}).get("bytes"),
                })
    for path in (workspace.root / "runs").glob("*/run.json"):
        try:
            run = workspace.inspect_run(path.parent.name)
            selected = run["selection"]
            scenario = scenarios[selected["scenario_id"]]
            profile = profiles[selected["profile_id"]]
            native = set(scenario_decisions.available_pollutants(run))
            artifacts = run.get("artifacts", {})
            shared = [key for key, native_name in core.POLLUTANTS.items()
                      if native_name in native and key in artifacts
                      and artifacts[key].get("units") == rasters.MASS_UNITS[key]]
            scope_error = None
            try:
                scope = model_selection.validate_completed_run(run)
            except (ValueError, KeyError, TypeError) as error:
                scope, scope_error = {}, str(error)
            expected = set(scope.get("expected_artifacts", []))
            shared = [name for name in shared if name in expected]
            versions = native_versions.model_versions(
                run, native_versions.models_for_outputs(shared))
            version_eligibility = {}
            for output in shared:
                try:
                    core.native_cohort([run], [output])
                    version_eligibility[output] = {"eligible": True, "reason": None}
                except (ValueError, KeyError, TypeError) as error:
                    version_eligibility[output] = {"eligible": False, "reason": str(error)}
            ready = [name for name in shared if version_eligibility[name]["eligible"]]
            # Keep all original outputs. The selected cohort, not this catalogue,
            # determines the common models whose observed versions must agree.
            eligible = (run.get("state") == "complete" and bool(ready)
                        and scope.get("selected_models_complete", False))
            if run.get("state") != "complete":
                note = "Finish the original native run in Native runs."
            elif scope_error:
                note = scope_error
            elif not shared:
                note = "Complete the selected native model and retain its annual-mass exports."
            elif not ready:
                note = "; ".join(dict.fromkeys(
                    item["reason"] for item in version_eligibility.values()))
            else:
                note = ", ".join(LABELS[key] for key in ready) + " ready for comparison"
                if len(ready) != len(shared):
                    note += "; other outputs require their original observed model execution"
            runs.append({
                "id": run["id"], "state": run.get("state"), "eligible": eligible,
                "selection": selected, "comparison_pollutants": shared,
                "native_pollutants": sorted(native), "model_scope": scope, "note": note,
                "title": scenario.get("title", scenario["id"]),
                "scenario_kind": scenario.get("kind"), "profile_title": profile.get("title", profile["id"]),
                "completed_at": run.get("completed_at"),
                "runtime_version": (run.get("runtime") or {}).get("version"),
                "native_version": native_versions.native_version(run),
                "model_versions": versions, "version_eligibility": version_eligibility,
                "runtime": run.get("runtime") or {},
                "stages": {
                    model: {name: value for name, value in
                            ((run.get("stages") or {}).get(model) or {}).items()
                            if name in ("completed_at", "runtime", "reused_from")}
                    for model in versions
                },
            })
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"run_id": path.parent.name, "message": str(error)})
    runs.sort(key=lambda row: (row.get("completed_at") or "", row["id"]), reverse=True)
    return {
        "schema": "upstate.utility-cohort-catalog/v1", "workspace_key": workspace_key,
        "project": workspace.project, "sources": sources, "runs": runs,
        "cohorts": overview(operator, workspace_key), "issues": issues,
        "native_version_requirement": {
            "version": INVEST_VERSION, "observed_execution_required": True,
            "comparison_scope": "common_native_models",
        },
        "published_areas": list(core.AREAS), "pollutants": [
            {"id": key, "title": LABELS[key], "units": rasters.MASS_UNITS[key]} for key in POLLUTANTS],
        "source_preparation": {
            "module": "source_tools.prepare_public_source_water",
            "result": "public-water-preparation.json",
            "collection_field": "source_collection_id",
            "role": core.SOURCE_ROLE,
        },
    }


def _products(workspace, value):
    result = []
    for name, product in value.get("products", {}).items():
        if name not in ("analysis", "decisions"):
            raise ValueError("Unexpected utility product")
        key = identifier(product["id"])
        relative = ("analyses/" if name == "analysis" else "scenario-decisions/") + key
        if product["directory"] != relative:
            raise ValueError("A utility product leaves its original workspace scope")
        result.append((name, workspace.root / relative, product))
    return result


def _downloads(operator, workspace_key, directory, value):
    workspace = operator.ws(workspace_key)
    own = {"files": {**value.get("files", {}),
                     "cohort": describe_file(directory, directory / "cohort.json")}}
    downloads = [{**item, "group": "Utility cohort"} for item in
                 operator._files(workspace_key, own, directory)]
    for name, root, product in _products(workspace, value):
        group = "Planning analysis" if name == "analysis" else "Native physical report"
        downloads.extend({**item, "group": group} for item in
                         operator._files(workspace_key, product, root))
    unique = {}
    for item in downloads:
        unique.setdefault(item["id"], item)
    return list(unique.values())


def _retained_runs(workspace, ids):
    result = []
    for key in ids:
        run = workspace.inspect_run(key)
        selected = run["selection"]
        scenario = workspace._get("scenarios", selected["scenario_id"])
        profile = workspace._get("profiles", selected["profile_id"])
        result.append({"id": key, "title": scenario.get("title", scenario["id"]),
                       "profile_title": profile.get("title", profile["id"]),
                       "selection": selected})
    return result


def read(operator, workspace_key, operation, payload, fault):
    payload = payload or {}
    workspace = operator.ws(workspace_key)
    try:
        if operation == "catalog":
            return _catalog(operator, workspace_key)
        if operation == "preview":
            # The HTTP bridge passes workspace in the JSON body. Only selection enters the model.
            requested = payload.get("selection")
            if not isinstance(requested, dict):
                raise ValueError("Select the source edition and completed native reference first")
            gate = operator.gates[workspace_key]
            if not gate.acquire(blocking=False):
                raise fault("UTILITY_WORKSPACE_BUSY", "The current operation is updating this workspace. Inspect source areas after it finishes.", 409)
            try:
                plan = core.prepare(workspace, requested)
            finally:
                gate.release()
            return {"schema": "upstate.utility-cohort-preview/v1", "workspace_key": workspace_key,
                    **{name: plan[name] for name in (
                        "title", "report_kind", "run_ids", "baseline_run_id", "grid_id", "source",
                        "zone_bindings", "weight_grid", "notes")},
                    "comparison_pollutants": plan.get("comparison_pollutants", list(POLLUTANTS)),
                    "analysis_selection": plan["analysis_selection"],
                    "native_execution": plan.get("native_execution"),
                    "runs": _retained_runs(workspace, plan["run_ids"])}
        key = identifier(payload.get("id") or payload.get("cohort_id") or payload.get("view_id"))
        directory, value = _cohort(workspace, key)
        if operation == "status":
            row = next((item for item in overview(operator, workspace_key) if item["id"] == key), None)
            return {"workspace_key": workspace_key, "summary": row or _compact(value)}
        if operation == "cohort":
            # Detail opening verifies the cohort's small tables/selections; raster downloads
            # use the original operator's streaming hash verification.
            for descriptor in value.get("files", {}).values():
                verify_file(directory, descriptor)
            return {
                "schema": "upstate.utility-cohort-view/v1", "workspace_key": workspace_key,
                "summary": _summary(directory),
                "cohort": {name: item for name, item in value.items() if name != "rows"},
                "runs": _retained_runs(workspace, value.get("run_ids", [])),
                "_downloads": _downloads(operator, workspace_key, directory, value),
                "filters": {
                    "regions": [{"id": "reporting_area", "title": "Full reporting area"}] + [
                        {"id": row["region_id"], "title": row["title"]} for row in value.get("zone_bindings", [])],
                    "runs": list(value.get("run_ids", [])),
                    "pollutants": value.get("comparison_pollutants", list(POLLUTANTS)),
                },
            }
        if operation == "rows":
            if value.get("state") != "complete":
                raise fault("UTILITY_BUILDING", "Open the retained phase while this cohort is being calculated.", 409)
            filters = {name: payload.get(name) for name in ("region_id", "run_id", "pollutant")}
            rows = [row for row in value.get("rows", []) if all(
                not selected or row.get(name) == selected for name, selected in filters.items())]
            view = payload.get("view", "physical")
            if view not in ("physical", "priority", "coverage"):
                raise ValueError("Choose the physical, priority or native coverage table")
            if view == "priority":
                unique = {}
                for row in rows:
                    unique.setdefault((row["region_id"], row["run_id"]), row)
                rows = list(unique.values())
            offset, limit = int(payload.get("offset", 0)), int(payload.get("limit", 100))
            if offset < 0 or limit < 1 or limit > 500:
                raise ValueError("Use a nonnegative row offset and a page size from 1 to 500")
            return {"schema": "upstate.utility-cohort-rows/v1", "workspace_key": workspace_key,
                    "id": key, "filters": filters, "view": view, "offset": offset, "limit": limit,
                    "total": len(rows), "rows": rows[offset:offset + limit],
                    "more": offset + limit < len(rows)}
        raise fault("UTILITY_READ", "Choose a supported utility cohort view.", 404)
    except (ValueError, OSError, KeyError, TypeError, ImportError) as error:
        raise fault("UTILITY_COHORT", str(error)) from error


def invoke(operator, workspace_key, action, payload, fault):
    if action != ACTION:
        raise fault("UTILITY_ACTION", "Choose the utility cohort action.", 404)
    workspace = operator.ws(workspace_key)
    requested = payload.get("selection", payload)
    started = time.monotonic()
    saved = {"id": None, "phase": None, "pollutant": None, "at": 0.0,
             "phase_started": started, "summary": None}

    def retain(event):
        clock = time.monotonic()
        phase = event.get("phase", saved["phase"])
        pollutant = event.get("pollutant")
        boundary = phase != saved["phase"] or pollutant != saved["pollutant"]
        if phase != saved["phase"]:
            saved["phase_started"] = clock
        saved.update(id=event["id"], phase=phase, pollutant=pollutant)
        if not boundary and clock - saved["at"] < 2.0 and phase != "complete":
            return
        directory, value = _cohort(workspace, event["id"])
        summary = _compact(value)
        completed = event.get("completed_zones")
        total = event.get("total_zones")
        unit = "source areas" if total is not None else None
        if phase == "complete":
            completed = total = value.get("row_count", 0)
            unit = "outcome rows"
        label = PHASES.get(phase, phase or "Preparing")
        if pollutant:
            label += " / " + str(pollutant).replace("_", " ").capitalize()
        summary["progress"] = {
            "phase": phase, "label": label, "completed": completed, "total": total, "unit": unit,
            "percent": 100.0 * completed / total if total and completed is not None else (
                100.0 if phase == "complete" else None),
            "elapsed_seconds": round(clock - started, 3),
            "phase_elapsed_seconds": round(clock - saved["phase_started"], 3),
            "updated_at": event.get("updated_at") or now(),
            "detail": event.get("detail") or {name: event[name] for name in (
                "stage", "pollutant", "zone", "run_count") if name in event},
        }
        summary["updated_at"] = summary["progress"]["updated_at"]
        atomic_json(directory / "operator-summary.json", summary)
        saved.update(summary=summary, at=clock)

    try:
        result = core.build(workspace, requested, progress=retain)
        # Cached core results deliberately have no progress callback.
        if saved["id"] is None:
            retain({"id": result["id"], "state": "complete", "phase": "complete"})
        return {**_compact(result), "files": result["files"],
                "cohort_artifact": result["cohort_artifact"], "reused": result["reused"]}
    except BaseException:
        if saved["id"]:
            directory, value = _cohort(workspace, saved["id"])
            summary = _compact(value)
            if saved["summary"]:
                summary["progress"] = saved["summary"].get("progress")
            if summary.get("phase") == "analysis":
                latest = None
                for path in (workspace.root / "analyses").glob("*/summary.json"):
                    try:
                        current = _analysis_progress(str(path), _signature(path))
                    except (ValueError, OSError, KeyError, TypeError):
                        continue
                    if (current and current["selection_sha256"] == summary.get("analysis_selection_sha256")
                            and current.get("progress")):
                        if latest is None or current["updated_at"] >= latest["updated_at"]:
                            latest = current
                if latest is not None:
                    summary["progress"] = latest["progress"]
            atomic_json(directory / "operator-summary.json", summary)
        raise


def decorate_task(operator, task, fault):
    if task.get("action") != ACTION or task.get("state") != "complete":
        return task
    key = task.get("result", {}).get("id")
    if key:
        workspace = operator.ws(task["workspace"])
        directory, value = _cohort(workspace, key)
        task["_utility_cohort_id"] = key
        task["_downloads"] = _downloads(operator, task["workspace"], directory, value)
    return task


def verify_all(workspace):
    rows = []
    for path in (workspace.root / ROOT).glob("*/cohort.json"):
        directory, value = _cohort(workspace, path.parent.name)
        for item in value.get("files", {}).values():
            verify_file(directory, item)
        if value.get("state") == "complete":
            core._verify_products(workspace, value["products"])
        rows.append({"id": value["id"], "state": value["state"],
                     "row_count": value.get("row_count", 0), "files": len(value.get("files", {}))})
    return {"schema": "upstate.utility-cohort-receiving/v1", "cohorts": rows}
