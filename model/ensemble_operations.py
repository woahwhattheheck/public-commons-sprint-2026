"""Run catalogued studies and retain their native reports in one Workspace.

This module joins the original ensemble and paired-raster services. It creates
no background queue: the caller runs in its current native Python process.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import os
import platform
import sys
import time

from .common import atomic_json, digest, held, identifier, now, read_json, verify_file
from .ensembles import Ensembles, parameter_catalog

SCHEMA = "upstate.ensemble-operation/v1"


def workspace_context(workspace):
    """Expose actual saved selections through the same overview as the operator."""
    state = workspace.overview()
    return {
        "schema": "upstate.ensemble-context/v1",
        "workspace": str(workspace.root),
        "grids": state["grids"],
        "profiles": state["profiles"],
        "scenarios": state["scenarios"],
        "runs": state.get("runs", []),
        "ensembles": Ensembles(workspace).list(),
        "studies": parameter_catalog()["studies"],
    }


def study_design(workspace, study_id, *, grid_id, baseline_scenario_id,
                 base_profile_ids, alternative_scenario_ids=(), title=None,
                 reason=None):
    """Bind the actual source catalogue to explicit retained workspace choices."""
    matches = [item for item in parameter_catalog()["studies"] if item["id"] == study_id]
    if len(matches) != 1:
        choices = ", ".join(item["id"] for item in parameter_catalog()["studies"])
        raise ValueError("Choose an existing source catalogue study: " + choices)
    study = deepcopy(matches[0])
    spec = {
        "title": study["title"] if title is None else title,
        "reason": study["question"] if reason is None else reason,
        "grid_id": grid_id,
        "baseline_scenario_id": baseline_scenario_id,
        "base_profile_ids": list(base_profile_ids),
        "alternative_scenario_ids": list(alternative_scenario_ids),
        "design": study["design"],
        "models": deepcopy(study["models"]),
        "axes": deepcopy(study["axes"]),
    }
    # The same native design validation checks model/input availability, saved
    # profile and scenario identities, actual values and all source references.
    preview = Ensembles(workspace).preview(spec)
    return {"spec": spec, "preview": preview, "study": study}


def _native_process():
    return {"hostname": platform.node(), "pid": os.getpid(),
            "python_executable": sys.executable, "python_version": platform.python_version()}


def _report(workspace, ensemble_id):
    from . import ensemble_report
    release = ensemble_report.build(workspace, ensemble_id)
    directory = workspace.root / "ensemble_reports" / identifier(release["id"])
    files = {name: {**item, "absolute_path": str(verify_file(directory, item))}
             for name, item in release["files"].items()}
    return {"id": release["id"], "state": release["state"], "directory": str(directory),
            "report_state": release.get("report_state"),
            "summary_signature": release.get("summary_signature"),
            "paired_results": release["paired_results"],
            "parameter_results": release.get("parameter_results", 0),
            "support_groups": release.get("support_groups", 0), "files": files}


def _portable(workspace, service, analysis, directory, previous):
    """Reuse a verified original export or publish to a new exclusive filename."""
    analysis_id = identifier(analysis["id"])
    signature = digest(analysis.get("reports", {}))
    for item in previous:
        if item.get("analysis_id") != analysis_id or item.get("report_signature") != signature:
            continue
        retained = item.get("archive")
        if not isinstance(retained, dict):
            continue
        try:
            verify_file(workspace.root, retained)
        except (OSError, ValueError, KeyError, TypeError):
            continue
        return {**retained, "absolute_path": str(workspace.root / retained["path"])}, signature
    directory.mkdir(parents=True, exist_ok=True)
    stem = analysis_id + "-" + signature[:16]
    sequence = 0
    while True:
        suffix = "" if sequence == 0 else "-" + str(sequence)
        destination = directory / (stem + suffix + ".zip")
        if destination.exists() or destination.is_symlink():
            sequence += 1
            continue
        try:
            exported = service.portable(analysis_id, destination)
        except FileExistsError:
            # Another exporter won exclusive publication; retain that file and
            # use the next free name for this completed original product.
            sequence += 1
            continue
        path = Path(exported["path"]).resolve()
        relative = path.relative_to(workspace.root.resolve()).as_posix()
        return {"path": relative, "absolute_path": str(path),
                "bytes": exported["bytes"], "sha256": exported["sha256"],
                "schema": exported["schema"]}, signature


def operation(workspace, ensemble_id, *, run_native=False, continue_on_error=True,
              with_raster_products=False, resume_raster_products=False,
              source_study=None, on_progress=None):
    """Run/reopen the same saved design and export its actual completed results.

    Returns one machine-readable record. Native stage progress remains in the
    original ensemble/run manifests; raster tile progress remains in the
    original paired-product controls. The operation record links those files
    and survives loss of this command's terminal.
    """
    key = identifier(ensemble_id)
    manager = Ensembles(workspace)
    plan = manager.inspect(key)
    directory = workspace.root / "ensemble_results" / key
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "operation.json"

    with held(directory / ".operation.lock", blocking=False):
        previous = read_json(path) if path.exists() else {}
        if previous and (previous.get("schema") != SCHEMA or previous.get("ensemble_id") != key):
            raise ValueError("The saved operation belongs to another ensemble or schema")
        previous_exports = previous.get("archives", [
            {"analysis_id": item["analysis_id"], "report_signature": item["report_signature"],
             "archive": item["archive"]}
            for item in previous.get("raster_products", [])
            if all(name in item for name in ("analysis_id", "report_signature", "archive"))])
        record = {
            "schema": SCHEMA, "ensemble_id": key, "title": plan["title"],
            "workspace": str(workspace.root), "path": str(path),
            "state": "starting", "created_at": previous.get("created_at", now()),
            "started_at": now(), "updated_at": now(),
            "process": _native_process(),
            "requested": {"run_native": run_native, "continue_on_error": continue_on_error,
                          "raster_products": with_raster_products,
                          "resume_raster_products": resume_raster_products},
            "native_state_path": str(directory / "state.json"),
            "native_progress": plan["progress"], "model_scope": plan["model_scope"],
            "source_study": deepcopy(source_study or previous.get("source_study")),
            "report": None, "raster_products": [], "archives": deepcopy(previous_exports), "errors": [],
        }

        def save(phase=None, **values):
            if phase is not None:
                record["state"] = phase
            record.update(values, updated_at=now())
            atomic_json(path, record)
            if on_progress:
                on_progress({"phase": record["state"], "ensemble_id": key,
                             "operation_path": str(path), "progress": record["native_progress"]})

        def error(phase, exc, **values):
            record["errors"].append({"phase": phase, "type": type(exc).__name__,
                                     "message": str(exc), **values})
            save()

        save("running" if run_native else "exporting")
        try:
            if run_native:
                try:
                    manager.run(key, continue_on_error=continue_on_error)
                except Exception as exc:
                    # Preserve the completed members and continue their export.
                    # Interrupt/termination signals are handled by the outer
                    # BaseException block and are re-raised immediately.
                    error("native", exc)
            plan = manager.inspect(key)
            save("exporting", native_progress=plan["progress"], model_scope=plan["model_scope"])
            try:
                record["report"] = _report(workspace, key)
                save()
            except Exception as exc:
                error("report", exc)

            if with_raster_products:
                from .paired_ensemble import EnsembleWorkspace
                from .paired_ensemble.designs import design_cohort
                from .paired_ensemble.ensemble_store import digest as paired_digest
                paired = EnsembleWorkspace(workspace)
                plan = manager.inspect(key)
                for scenario_id in plan["alternative_scenario_ids"]:
                    entry = {"scenario_id": scenario_id, "state": "selecting",
                             "planned_member_count": len(plan["members"])}
                    record["raster_products"].append(entry)
                    save("rasterizing")
                    try:
                        cohort = design_cohort(workspace, key, scenario_id)
                        entry.update(selected_member_count=cohort["selected_member_count"],
                                     planned_member_count=cohort["planned_member_count"],
                                     pending_members=cohort["pending_members"],
                                     available_pollutants=cohort["available_pollutants"])
                        if not cohort["ready"]:
                            entry["state"] = "pending"
                            save()
                            continue
                        selection = cohort["selection"]
                        selection_path = directory / "paired-selections" / (identifier(scenario_id) + ".json")
                        selection_path.parent.mkdir(parents=True, exist_ok=True)
                        atomic_json(selection_path, selection)
                        entry.update(state="running", selection_path=str(selection_path),
                                     progress_path=str(workspace.root / "ensemble-products" /
                                                       "controls" / (paired_digest(selection) + ".json")))
                        save()
                        last_notice = [0.0]

                        def tile_progress(value):
                            moment = time.monotonic()
                            if on_progress and moment - last_notice[0] >= 2.0:
                                last_notice[0] = moment
                                on_progress({"phase": "rasterizing", "ensemble_id": key,
                                             "scenario_id": scenario_id, "tile_progress": value})

                        action = paired.resume if resume_raster_products else paired.build
                        product = action(selection, on_progress=tile_progress)
                        entry.update(state=product["state"], analysis_id=product["id"],
                                     directory=str(workspace.root / "ensemble-products" / product["id"]))
                        save()
                        if product["state"] == "complete":
                            archive, signature = _portable(
                                workspace, paired, product, directory / "paired-exports", record["archives"])
                            entry.update(archive=archive, report_signature=signature)
                            archived = {"analysis_id": product["id"], "report_signature": signature,
                                        "archive": archive}
                            if archived not in record["archives"]:
                                record["archives"].append(archived)
                            save()
                    except Exception as exc:
                        entry.update(state="failed", error={"type": type(exc).__name__, "message": str(exc)})
                        error("raster", exc, scenario_id=scenario_id)

            plan = manager.inspect(key)
            all_products_complete = all(item["state"] == "complete" for item in record["raster_products"])
            complete = (plan["state"] == "complete" and record["report"] is not None
                        and record["report"]["state"] == "complete" and not record["errors"]
                        and all_products_complete)
            result_state = "complete" if complete else (
                "partial" if plan["progress"].get("complete", 0) else "failed")
            save(result_state, native_progress=plan["progress"], model_scope=plan["model_scope"],
                 native_state=plan["state"], completed_at=now())
            return deepcopy(record)
        except BaseException as exc:
            record["errors"].append({"phase": record["state"], "type": type(exc).__name__,
                                     "message": str(exc)})
            save("failed" if isinstance(exc, Exception) else "interrupted")
            raise


def run_study(workspace, study_id, *, grid_id, baseline_scenario_id,
              base_profile_ids, alternative_scenario_ids=(), title=None, reason=None,
              continue_on_error=True, with_raster_products=False, on_progress=None):
    selected = study_design(workspace, study_id, grid_id=grid_id,
                            baseline_scenario_id=baseline_scenario_id,
                            base_profile_ids=base_profile_ids,
                            alternative_scenario_ids=alternative_scenario_ids,
                            title=title, reason=reason)
    manager = Ensembles(workspace)
    saved = manager.prepare(selected["spec"])
    return operation(workspace, saved["id"], run_native=True,
                     continue_on_error=continue_on_error,
                     with_raster_products=with_raster_products,
                     source_study={"catalogue": selected["study"], "spec": selected["spec"],
                                   "preview": selected["preview"]},
                     on_progress=on_progress)
