"""Cold-open the geographic project using its own archived application.

The existing native receiving operation owns this invocation. This helper opens
saved native results, sources, the scientific report and customer review only.
It does not execute a model or rebuild a scientific product.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

APP = Path(__file__).resolve().parents[1]
HELPER = "source_tools/geographic_headwaters_reopen.py"
SCHEMA = "upstate.geographic-headwaters-cold-receiving/v1"

if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
from source_tools.receiving_process import (receiving_lock, lock_identity as _lock_identity,
                                            popen_with_lease, inherited_descriptor)


def _support():
    if str(APP) not in sys.path:
        sys.path.insert(0, str(APP))
    from source_tools import simulated_headwaters_receiving
    if Path(simulated_headwaters_receiving.__file__).resolve() != APP / "source_tools/simulated_headwaters_receiving.py":
        raise ValueError("Use the retained scientific receiving implementation")
    return simulated_headwaters_receiving


def _scientific_identity(scientific):
    selection, report = scientific["selection"], scientific["report"]
    return {
        "source_operation_id": scientific["id"], "source": scientific["source"],
        "ensemble_id": scientific["ensemble_id"], "report_id": selection["report_id"],
        "summary_signature": selection["summary_signature"],
        "run_signature": selection["run_signature"], "report_signature": report["signature"],
        "figure_count": scientific["figure_count"],
    }


def cold_reopen(restored, manifest, prepared, scientific, delivery_id, review_id,
                output, *, receiving_lock_fd, receiving_lock_path,
                review_response_id=None, receiving_context=None, scenario_context=None,
                reference_basis=None, programme=None, geographic_gis=None):
    """Retain and run one complete read-only cold-reopen invocation."""
    support = _support()
    root = Path(restored["directory"]).resolve(strict=True)
    application = Path(restored["application"]).resolve(strict=True)
    workspace = Path(restored["workspace"]).resolve(strict=True)
    if application != root / "application" or workspace != root / "workspace":
        raise ValueError("Select the archived application and Workspace together")
    if (restored["project"] != manifest["project"]
            or prepared["project_id"] != manifest["project"]["id"]
            or scientific["workspace_id"] != prepared["project_id"]
            or scientific["ensemble_id"] != prepared["ensemble_id"]):
        raise ValueError("Retain the original geographic project and scientific selection")
    output = Path(output).resolve()
    if (output.is_relative_to(root) or root.is_relative_to(output)
            or output.is_relative_to(APP) or APP.is_relative_to(output)):
        raise ValueError("Keep cold invocation history outside both application editions")
    lock_identity = _lock_identity(receiving_lock_fd, receiving_lock_path)
    attempt = uuid.uuid4().hex
    directory = output / attempt
    directory.mkdir(parents=True, exist_ok=False)
    request_path, result_path = directory / "request.json", directory / "result.json"
    stdout_path, stderr_path = directory / "stdout.log", directory / "stderr.log"
    process = None
    started = support._now()
    try:
        if "application/" + HELPER not in manifest["members"]:
            raise ValueError("The delivered archive must contain its geographic cold receiver")
        snapshots = support._application(application, manifest["members"])
        request = {
            "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
            "application": str(application), "workspace": str(workspace),
            "project": manifest["project"], "members": manifest["members"],
            "archive_sha256": restored["archive_sha256"],
            "archive_delivery": manifest.get("delivery"),
            "prepared": prepared, "scientific": _scientific_identity(scientific),
            "delivery_id": delivery_id, "review_id": review_id,
            "review_response_id": review_response_id,
            "receiving_context": receiving_context,
            "scenario_context": scenario_context,
            "reference_basis": reference_basis,
            "geographic_programme": programme,
            "geographic_gis": geographic_gis,
            "receiving_lock": lock_identity,
        }
        support._write(request_path, request)
        request_sha = hashlib.sha256(request_path.read_bytes()).hexdigest()
        command = [
            sys.executable, "-I", "-B", str(application / HELPER),
            "--request", str(request_path), "--request-sha256", request_sha,
            "--result", str(result_path), "--lock-fd", str(receiving_lock_fd),
        ]
        support._write(directory / "launch.json", {
            "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
            "command": command, "request_sha256": request_sha,
            "archive_sha256": restored["archive_sha256"],
            "source_members": len(snapshots), "receiving_lock": lock_identity,
        })
        _lock_identity(receiving_lock_fd, receiving_lock_path)
        with stdout_path.open("xb", buffering=0) as stdout, stderr_path.open("xb", buffering=0) as stderr:
            process = popen_with_lease(
                command, cwd=application, stdout=stdout, stderr=stderr,
                pass_fds=(receiving_lock_fd,))
            returncode = process.wait()
            os.fsync(stdout.fileno())
            os.fsync(stderr.fileno())
        if returncode:
            raise RuntimeError("Archived geographic application exited "
                               + str(returncode) + "; inspect " + str(stderr_path))
        result = support._read(result_path)
        if (result.get("schema") != SCHEMA or result.get("attempt_id") != attempt
                or result.get("state") != "complete" or result.get("project") != manifest["project"]
                or result.get("request_sha256") != request_sha
                or result.get("geographic_edition_id") != prepared["id"]
                or result.get("archive_sha256") != restored["archive_sha256"]
                or result.get("application") != str(application)
                or result.get("workspace") != str(workspace)
                or result.get("reference_basis") != reference_basis
                or result.get("geographic_programme") != programme
                or result.get("geographic_gis") != geographic_gis):
            raise ValueError("Cold receiving returned a different source, project or invocation")
        for name, identity in snapshots.items():
            if support._identity(support._member(application, name).lstat()) != identity:
                raise ValueError("Archived application changed during receiving: " + name)
        return {**result, "attempt_directory": str(directory),
                "request": str(request_path), "stdout": str(stdout_path),
                "stderr": str(stderr_path), "result": str(result_path), "returncode": returncode}
    except BaseException as error:
        if process is not None and process.poll() is None:
            try:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            except OSError as cleanup_error:
                support._secondary(error, "stop owned receiving child", cleanup_error)
        try:
            support._write(directory / "parent-failure.json", {
                "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
                "failed_at": support._now(),
                "state": "failed" if isinstance(error, Exception) else "interrupted",
                "error": {"type": type(error).__name__, "message": str(error)},
                "returncode": process.returncode if process is not None else None,
                "stdout": str(stdout_path), "stderr": str(stderr_path),
            })
        except OSError as receipt_error:
            support._secondary(error, "retain receiving failure", receipt_error)
        raise


def _reference_course(ws, files, prepared, basis):
    """Open one complete reference trio and the original unfinished full design."""
    from source_tools.geographic_archive import reference_snapshot
    support = _support()
    snapshot = reference_snapshot(ws, prepared, basis)
    for item in snapshot["members"].values():
        files.file(ws.root, item)
    plan = snapshot["plan"]
    reference_ids = basis["reference_run_ids"]
    states = {}
    for member in plan["members"]:
        files.json("profiles/" + member["profile_id"] + ".json")
        profile = ws._get("profiles", member["profile_id"])
        support._sources(ws, files, profile["source_collection_id"])
        scenarios = [plan["baseline_scenario_id"], *plan["alternative_scenario_ids"]]
        if [item["scenario_id"] for item in member["runs"]] != scenarios:
            raise ValueError("The received reference snapshot changed a planned scenario order")
        for item in member["runs"]:
            key = item["run_id"]
            saved = files.json("runs/" + key + "/run.json")
            run = ws.inspect_run(key)
            expected = {"grid_id": plan["grid_id"], "profile_id": member["profile_id"],
                        "scenario_id": item["scenario_id"]}
            if saved != run or any(run["selection"].get(name) != value for name, value in expected.items()):
                raise ValueError("The received reference snapshot changed an original native selection")
            states[key] = run["state"]
            if run["state"] == "complete":
                support._run(ws, files, key, expected)
            elif key in reference_ids:
                raise ValueError("The selected original reference run is not complete")
            else:
                files.descriptors(ws.root / "runs" / key, run.get("artifacts", {}))
    support._comparison(ws, files, basis["comparison_id"], reference_ids)
    return {"kind": "reference_course_snapshot", "ensemble_id": plan["id"],
            "completion_scope": "reference", "reference_state": "reference_complete",
            "course_state": basis["course_state"], "native_runs": len(reference_ids),
            "planned_native_runs": len(states), "reference_run_ids": reference_ids,
            "completed_run_ids": sorted(key for key, state in states.items() if state == "complete"),
            "pending_run_ids": sorted(key for key, state in states.items() if state != "complete"),
            "native_progress": basis["native_progress"], "pending_members": basis["pending_members"],
            "paired_products": snapshot["paired_products"]}


def _inspect(request, lock_fd):
    if request.get("schema") != SCHEMA:
        raise ValueError("Use the retained geographic receiving request")
    application = Path(request["application"]).resolve(strict=True)
    if APP != application or Path(__file__).resolve() != application / HELPER:
        raise ValueError("Run the geographic helper inside the delivered application")
    lock = _lock_identity(lock_fd, request["receiving_lock"]["path"])
    if lock != request["receiving_lock"]:
        raise ValueError("The child inherited another receiving lock")
    sys.path.insert(0, str(application))
    importlib.invalidate_caches()
    support = _support()
    from model.workspace import Workspace
    import model.workspace as workspace_module
    if Path(workspace_module.__file__).resolve() != application / "model/workspace.py":
        raise ValueError("The child imported another Workspace implementation")
    ws = Workspace(Path(request["workspace"]).resolve(strict=True))
    files = support._ScienceFiles(ws, request["members"])
    if files.json("workspace.json") != request["project"] or ws.project != request["project"]:
        raise ValueError("The delivered project identity changed")
    prepared = request["prepared"]
    saved = files.json("geographic-headwaters/" + prepared["id"] + "/prepared.json")
    if saved != prepared:
        raise ValueError("The delivered geographic preparation changed")
    case = {**prepared, "scientific_study": request["scientific"]}
    reference_basis = request.get("reference_basis")
    if reference_basis is not None:
        original_delivery = request.get("archive_delivery")
        original = (original_delivery or {}).get("files", {}).get("handover_record")
        if not original or original.get("path") != "delivery/handover-record.json":
            raise ValueError("Retain the reference opening page inside this original archive")
        expected = request["members"].get(original["path"])
        if expected is None or any(original.get(key) != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("The reference opening record differs from its archived descriptor")
        path = support._member(ws.root.parent, original["path"])
        before = support._check_file(path, expected)
        handover = support._read(path)
        if (handover.get("reference_basis") != reference_basis
                or handover.get("prepared") != prepared
                or handover.get("scientific", {}).get("id") != request["scientific"]["source_operation_id"]
                or handover.get("delivery_id") != request["delivery_id"]
                or support._identity(path.lstat()) != before):
            raise ValueError("The archived opening page changed its selected reference edition")
    parameter = (support._parameter_course(ws, files, {"ensemble_id": prepared["ensemble_id"]}, case)
                 if reference_basis is None else _reference_course(ws, files, prepared, reference_basis))
    runs = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    scenarios = [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]
    if len(runs) != len(scenarios) or len(set(runs)) != len(runs):
        raise ValueError("Retain distinct original run/scenario selections")
    for key, scenario in zip(runs, scenarios):
        support._run(ws, files, key, {
            "grid_id": prepared["grid_id"], "profile_id": prepared["profile_id"],
            "scenario_id": scenario})
    for key in (prepared["source_collection_id"],
                request["scientific"]["source"]["source_collection_id"]):
        support._sources(ws, files, key)
    delivery_id = request["delivery_id"]
    files.json("deliveries/" + delivery_id + "/delivery-state.json")
    delivery = ws.retained_item("deliveries", delivery_id)
    if (delivery["state"] != "complete"
            or delivery["selection"]["baseline_run_id"] != runs[0]
            or delivery["selection"]["scenario_run_ids"] != runs[1:]):
        raise ValueError("The delivered mapped report belongs to another selection")
    files.descriptors(ws.root / "deliveries" / delivery_id, delivery["files"])
    files.descriptors(ws.root / "deliveries" / delivery_id, delivery["maps"])
    scientific = support._native_study_source(ws, files, {
        "ensemble_id": prepared["ensemble_id"],
        "source_operation_id": request["scientific"]["source_operation_id"],
        "expected": request["scientific"]}, case, delivery, reference_basis=reference_basis)
    context = request.get("receiving_context")
    expected_source_ids = {
        prepared["source_collection_id"], request["scientific"]["source"]["source_collection_id"]}
    if context is not None:
        from model import geographic_receiving_context as utility_context
        context_id = context["id"]
        retained_context = files.json(utility_context.FOLDER + "/" + context_id + "/context.json")
        if retained_context != context or utility_context.inspect(ws, context_id) != context:
            raise ValueError("The delivered original utility context changed")
        if (context["prepared_id"] != prepared["id"]
                or context["baseline_run_id"] != runs[0]
                or context["alternative_run_ids"] != runs[1:]):
            raise ValueError("The delivered utility context belongs to another native case")
        from model import observed_context
        chosen_sources = observed_context.source_choices(delivery["selection"])
        for item in context["analyses"]:
            if chosen_sources.count(item["source"]) != 1:
                raise ValueError("The delivered report omits or duplicates an original utility analysis")
        for key in utility_context.source_collection_ids(context):
            support._sources(ws, files, key)
            expected_source_ids.add(key)
    interpretation = request.get("scenario_context")
    if interpretation is not None:
        from source_tools import geographic_scenario_context as source_context
        original_context = files.json(source_context.FOLDER + "/" + interpretation["id"] + "/context.json")
        if original_context != interpretation or source_context.inspect(ws, interpretation["id"]) != interpretation:
            raise ValueError("The delivered original source-loading context changed")
        if (interpretation["prepared_id"] != prepared["id"]
                or interpretation["ensemble_id"] != prepared["ensemble_id"]):
            raise ValueError("The interpreted source belongs to another geographic case")
        from model import observed_context
        if observed_context.source_choices(delivery["selection"]).count(interpretation["source"]) != 1:
            raise ValueError("The delivered mapped report omits its original source-loading interpretation")
        key = interpretation["source"]["source_collection_id"]
        support._sources(ws, files, key)
        expected_source_ids.add(key)
    programme = request.get("geographic_programme")
    programme_verification = None
    if programme is not None:
        from model.geographic_programme import verify as verify_programme
        item = (request.get("archive_delivery") or {}).get("files", {}).get("geographic_programme")
        expected = request["members"].get("delivery/geographic-programme.json")
        if (not item or item.get("path") != "delivery/geographic-programme.json"
                or expected is None or any(item.get(key) != expected[key] for key in ("bytes", "sha256"))):
            raise ValueError("Retain the exact Programme adoption inside the original archive")
        path = support._member(ws.root.parent, item["path"])
        before = support._check_file(path, expected)
        if (support._read(path) != programme or support._identity(path.lstat()) != before
                or programme.get("geographic_id") != prepared["id"]
                or programme.get("existing_delivery_id") != delivery_id):
            raise ValueError("The archived Programme adoption selects another original delivery")
        programme_verification = verify_programme(ws, programme)
    geographic_gis = request.get("geographic_gis")
    gis_verification = None
    if geographic_gis is not None:
        from model.geographic_gis_handover import verify as verify_reference_gis
        item = (request.get("archive_delivery") or {}).get("files", {}).get("geographic_gis")
        expected = request["members"].get("delivery/geographic-gis.json")
        if (not item or item.get("path") != "delivery/geographic-gis.json"
                or expected is None or any(item.get(key) != expected[key] for key in ("bytes", "sha256"))):
            raise ValueError("Retain the exact original geographic GIS edition inside the archive")
        path = support._member(ws.root.parent, item["path"])
        before = support._check_file(path, expected)
        if (support._read(path) != geographic_gis or support._identity(path.lstat()) != before
                or geographic_gis["identity"]["geographic_binding"]["geographic_id"] != prepared["id"]
                or geographic_gis["reference_run_ids"] != [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
                or geographic_gis["identity"]["delivery"]["path"] != "deliveries/" + delivery_id + "/delivery-state.json"):
            raise ValueError("The archived GIS handover selects another original geographic delivery")
        gis_verification = verify_reference_gis(ws, geographic_gis, receive=True)
    from model import reviews
    review_id = request["review_id"]
    files.json("reviews/" + review_id + ".json")
    review = reviews.show_review(ws, review_id, previews=False)
    selection = review["review"]["selection"]
    if (review["review"]["id"] != review_id or review["review"]["project"] != ws.project
            or selection["run_ids"] != runs or selection["delivery_ids"] != [delivery_id]
            or set(selection["source_collection_ids"]) != expected_source_ids):
        raise ValueError("The delivered customer review belongs to another scientific selection")
    response_prefix = reviews.response_prefix(
        review["responses"], through_response_id=request.get("review_response_id"))
    for response in response_prefix:
        original = files.json("review-responses/" + response["id"] + ".json")
        if original != {key: value for key, value in response.items() if key != "id"}:
            raise ValueError("The delivered original reviewer response prefix changed")
    result = support._finish(request, application, ws, files, {
        "geographic_edition_id": prepared["id"], "ensemble_id": prepared["ensemble_id"],
        "run_ids": runs, "delivery_id": delivery_id, "customer_review_id": review_id,
        "parameter_course": parameter, "scientific_source": scientific,
        "reference_basis": reference_basis,
        "completion_scope": "full_course" if reference_basis is None else "reference",
        "receiving_context": context,
        "scenario_context": interpretation,
        "geographic_programme": programme,
        "programme_verification": programme_verification,
        "geographic_gis": geographic_gis,
        "gis_verification": gis_verification,
        "review_response_id": request.get("review_response_id"),
        "review_response_ids": [row["id"] for row in response_prefix],
        "archive_sha256": request["archive_sha256"], "receiving_lock": lock,
        "identity": "MATCH",
    })
    return {**result, "schema": SCHEMA}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--lock-fd", type=int, required=True)
    args = parser.parse_args(argv)
    support = _support()
    request = None
    try:
        raw = args.request.read_bytes()
        if hashlib.sha256(raw).hexdigest() != args.request_sha256:
            raise ValueError("The exact original receiving request changed")
        request = json.loads(raw)
        with inherited_descriptor(args.lock_fd) as descriptor:
            result = _inspect(request, descriptor)
        result["request_sha256"] = args.request_sha256
        support._write(args.result, result)
        print(json.dumps({"state": "complete", "attempt_id": result["attempt_id"],
                          "geographic_edition_id": result["geographic_edition_id"],
                          "result": str(args.result)}, allow_nan=False), flush=True)
        return 0
    except BaseException as error:
        if request is not None:
            try:
                support._write(args.result, {
                    "schema": SCHEMA, "attempt_id": request.get("attempt_id"),
                    "request_sha256": args.request_sha256,
                    "state": "failed" if isinstance(error, Exception) else "interrupted",
                    "error": {"type": type(error).__name__, "message": str(error)},
                })
            except OSError as receipt_error:
                support._secondary(error, "retain child failure", receipt_error)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
