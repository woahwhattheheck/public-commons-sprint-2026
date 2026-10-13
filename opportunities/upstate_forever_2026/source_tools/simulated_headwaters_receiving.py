"""Open the retained demo in a fresh process using its restored application.

The parent verifies application members before launching the restored helper.
The receiving process reads original scientific records and files and reopens
selected original customer packages; it never continues a model, parameter
course or scientific delivery build.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
import uuid

SCHEMA = "upstate.simulated-headwaters-cold-receiving/v1"
HELPER = "source_tools/simulated_headwaters_receiving.py"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _member(root, name):
    if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
        raise ValueError("Retain a portable member name")
    parts = PurePosixPath(name)
    if parts.is_absolute() or ".." in parts.parts or parts.as_posix() != name:
        raise ValueError("Member escapes its retained root: " + name)
    path = Path(root)
    for part in parts.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("Retained member is a file alias: " + name)
    return path


def _check_file(path, expected):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Retain the original regular file: " + str(path))
    if before.st_size != expected["bytes"]:
        raise ValueError("Retained file length differs: " + str(path))
    mode = expected.get("mode")
    if mode is not None and stat.S_IMODE(before.st_mode) != (int(mode, 8) & 0o777):
        raise ValueError("Retained file permissions differ: " + str(path))
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        if _identity(os.fstat(stream.fileno())) != _identity(before):
            raise ValueError("Retained file changed before reading: " + str(path))
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        if _identity(os.fstat(stream.fileno())) != _identity(before):
            raise ValueError("Retained file changed while reading: " + str(path))
    if digest.hexdigest() != expected["sha256"] or _identity(path.lstat()) != _identity(before):
        raise ValueError("Retained file bytes differ: " + str(path))
    return _identity(before)


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")
    descriptor, name = tempfile.mkstemp(prefix=".cold-write-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _secondary(error, stage, secondary):
    value = {"stage": stage, "type": type(secondary).__name__,
             "message": str(secondary), "errno": getattr(secondary, "errno", None)}
    error.receiving_errors = [*getattr(error, "receiving_errors", []), value]
    if hasattr(error, "add_note"):
        error.add_note(stage + ": " + str(secondary))


def _application(root, members):
    selected = {name[len("application/"):]: value for name, value in members.items()
                if name.startswith("application/")}
    if HELPER not in selected or "model/workspace.py" not in selected:
        raise ValueError("The archive must retain its cold receiver and original Workspace")
    snapshots = {}
    for name, expected in selected.items():
        if expected.get("mode") is None:
            raise ValueError("Application inventory lacks declared permissions: " + name)
        snapshots[name] = _check_file(_member(root, name), expected)
    actual = set()
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError("Restored application contains an alias: " + str(path))
        actual.update((Path(directory) / name).relative_to(root).as_posix() for name in files)
    if actual != set(selected):
        raise ValueError("Restored application inventory differs from its archive")
    return snapshots


class ColdReopenError(RuntimeError):
    """The actual isolated receiving attempt did not complete."""


def cold_reopen(restored, manifest, receipt, output, extra_checks=None):
    """Verify restored source and inspect selected results in a new interpreter.

    extra_checks is an explicit list of parameter_course, field_campaign or
    customer_review selections. Each may carry an expected dictionary of stable original keys.
    A new attempt is retained for every invocation.
    """
    root = Path(restored["directory"]).resolve(strict=True)
    application = Path(restored["application"]).resolve(strict=True)
    workspace = Path(restored["workspace"]).resolve(strict=True)
    if application != root / "application" or workspace != root / "workspace":
        raise ValueError("Select the original receiving application and Workspace together")
    if restored["project"] != manifest["project"] or receipt["project_id"] != manifest["project"]["id"]:
        raise ValueError("The archive, receiving record and demo identify different projects")
    output = Path(output).resolve()
    if output == root or root in output.parents:
        raise ValueError("Keep cold receiving attempts outside the restored edition")
    attempt = uuid.uuid4().hex
    directory = output / attempt
    directory.mkdir(parents=True, exist_ok=False)
    request_path, result_path = directory / "request.json", directory / "result.json"
    stdout_path, stderr_path = directory / "stdout.log", directory / "stderr.log"
    process = None
    started = _now()
    try:
        snapshots = _application(application, manifest["members"])
        request = {
            "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
            "application": str(application), "workspace": str(workspace),
            "project": manifest["project"], "members": manifest["members"],
            "receipt": receipt, "extra_checks": [] if extra_checks is None else extra_checks,
        }
        _write(request_path, request)
        request_sha = hashlib.sha256(request_path.read_bytes()).hexdigest()
        command = [sys.executable, "-I", "-B", str(application / HELPER),
                   "--request", str(request_path), "--request-sha256", request_sha,
                   "--result", str(result_path)]
        _write(directory / "launch.json", {
            "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
            "command": command, "request_sha256": request_sha,
            "source_members": len(snapshots),
        })
        with stdout_path.open("xb", buffering=0) as stdout, stderr_path.open("xb", buffering=0) as stderr:
            process = subprocess.Popen(command, cwd=application, stdout=stdout, stderr=stderr)
            returncode = process.wait()
        if returncode:
            error = ColdReopenError("Restored application inspection exited "
                                    + str(returncode) + "; inspect " + str(stderr_path))
            error.returncode = returncode
            if result_path.is_file():
                try:
                    error.receiving_result = _read(result_path)
                except (OSError, ValueError) as result_error:
                    _secondary(error, "read child failure result", result_error)
            raise error
        result = _read(result_path)
        if (result.get("schema") != SCHEMA or result.get("attempt_id") != attempt
                or result.get("state") != "complete" or result.get("project") != manifest["project"]
                or result.get("request_sha256") != request_sha):
            raise ColdReopenError("The isolated receiver returned a different attempt or project")
        for name, identity in snapshots.items():
            path = _member(application, name)
            if _identity(path.lstat()) != identity:
                raise ValueError("Application changed during receiving: " + name)
        return {**result, "attempt_directory": str(directory),
                "request": str(request_path), "stdout": str(stdout_path),
                "stderr": str(stderr_path), "result": str(result_path),
                "returncode": returncode}
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
                _secondary(error, "stop receiving child", cleanup_error)
        failure = {
            "schema": SCHEMA, "attempt_id": attempt, "started_at": started,
            "failed_at": _now(), "state": "failed" if isinstance(error, Exception) else "interrupted",
            "error": {"type": type(error).__name__, "message": str(error)},
            "returncode": process.returncode if process is not None else None,
            "stdout": str(stdout_path), "stderr": str(stderr_path),
        }
        try:
            _write(directory / "parent-failure.json", failure)
        except OSError as receipt_error:
            _secondary(error, "retain receiving failure", receipt_error)
        raise


class _ScienceFiles:
    def __init__(self, workspace, members):
        self.root = workspace.root
        self.members = members
        self.checked = {}

    def file(self, scope, descriptor):
        path = _member(scope, descriptor["path"])
        relative = path.relative_to(self.root).as_posix()
        expected = self.members.get("workspace/" + relative)
        if expected is None or any(descriptor.get(key) != expected[key] for key in ("bytes", "sha256")):
            raise ValueError("Scientific descriptor differs from archived member: " + relative)
        previous = self.checked.get(relative)
        if previous is None:
            self.checked[relative] = _check_file(path, expected)
        elif _identity(path.lstat()) != previous:
            raise ValueError("Scientific file changed during inspection: " + relative)
        return path

    def json(self, relative):
        expected = self.members.get("workspace/" + relative)
        if expected is None:
            raise ValueError("The archive lacks the selected record: " + relative)
        path = self.file(self.root, {**expected, "path": relative})
        value = _read(path)
        if _identity(path.lstat()) != self.checked[relative]:
            raise ValueError("Selected record changed while reading: " + relative)
        return value

    def descriptors(self, scope, value):
        if isinstance(value, dict):
            if {"path", "bytes", "sha256"}.issubset(value):
                self.file(scope, value)
            else:
                for child in value.values():
                    self.descriptors(scope, child)
        elif isinstance(value, list):
            for child in value:
                self.descriptors(scope, child)


def _run(ws, files, key, expected=None):
    files.json("runs/" + key + "/run.json")
    run = ws.inspect_run(key)
    if run["state"] != "complete":
        raise ValueError("Retain the completed native run: " + key)
    if expected and any(run["selection"].get(name) != value for name, value in expected.items()):
        raise ValueError("Receiving changed the selected native case: " + key)
    from model.model_selection import run_models, validate_completed_run
    validate_completed_run(run)
    if tuple(run_models(run)) != ("ndr", "sdr"):
        raise ValueError("The teaching case requires its original NDR and SDR outputs")
    scope = ws.root / "runs" / key
    files.descriptors(scope, run["artifacts"])
    for stage in run.get("stages", {}).values():
        for field in ("arguments", "files", "companions", "additional_files", "registry_outputs"):
            files.descriptors(scope, stage.get(field))
    return run


def _comparison(ws, files, key, run_ids):
    files.json("comparisons/" + key + "/comparison.json")
    value = ws.retained_item("comparisons", key)
    if (value["baseline_run_id"] != run_ids[0]
            or [item["run_id"] for item in value["alternatives"]] != run_ids[1:]):
        raise ValueError("Receiving changed the comparison's original run ordering")
    from model.native_versions import validate_run_comparison
    validate_run_comparison(ws, value)
    for item in value["alternatives"]:
        files.descriptors(ws.root / "comparisons" / key, item["artifacts"])
    return value


def _spatial_reviews(ws, files, receipt):
    """Reopen each original paired view through the restored map implementation."""
    from source_tools.simulated_headwaters_rehearsal import save_native_review
    alternatives = receipt["alternative_run_ids"]
    selected = receipt.get("spatial_review_ids")
    if selected is None and len(alternatives) == 1 and receipt.get("spatial_review_id"):
        selected = {alternatives[0]: receipt["spatial_review_id"]}
    if (not isinstance(selected, dict) or set(selected) != set(alternatives)
            or any(not isinstance(value, str) or not value for value in selected.values())
            or len(set(selected.values())) != len(alternatives)
            or receipt.get("spatial_review_id") != selected[alternatives[0]]):
        raise ValueError("Retain the original paired map for every selected alternative")
    reviews = []
    for alternative_id in alternatives:
        key = selected[alternative_id]
        files.json("spatial-reviews/" + key + ".json")
        # Supplying an existing view ID selects the maintained read-only branch:
        # it compares the original baseline/alternative layers and validates them.
        review = save_native_review(
            ws, {"spatial_review_id": key, "recipe_sha256": receipt["recipe_sha256"]},
            {"baseline_run_id": receipt["baseline_run_id"],
             "alternative_run_ids": [alternative_id]})
        if review["id"] != key:
            raise ValueError("Receiving changed an original paired map identity")
        reviews.append({"id": key, "baseline_run_id": receipt["baseline_run_id"],
                        "alternative_run_id": alternative_id, "identity": "MATCH"})
    return reviews


def _parameter_course(ws, files, check, case):
    from model.ensembles import Ensembles
    key = check["ensemble_id"]
    record = files.json("ensemble_results/" + key + "/headwaters-course.json")
    expected = check.get("expected", {})
    for name, value in expected.items():
        if name not in {"ensemble_id", "selection", "selection_sha256", "project_id",
                        "input_source_collection_id", "input_manifest_sha256"}:
            raise ValueError("Unknown parameter-course stable key: " + name)
        if record.get(name) != value:
            raise ValueError("Receiving changed parameter-course " + name)
    from model.common import digest
    if (record["project_id"] != ws.project["id"] or record["ensemble_id"] != key
            or digest(record["selection"]) != record["selection_sha256"]):
        raise ValueError("Receiving changed the parameter-course selection")
    files.json("ensembles/" + key + ".json")
    plan = Ensembles(ws).inspect(key)
    selection = record["selection"]
    original_case = {"grid_id": case["grid_id"],
                     "baseline_scenario_id": case["baseline_scenario_id"],
                     "base_profile_id": case["profile_id"],
                     "alternative_scenario_ids": case["alternative_scenario_ids"]}
    if selection != original_case:
        raise ValueError("The parameter course belongs to a different demo selection")
    files.json("ensemble_results/" + key + "/state.json")
    if (plan["grid_id"] != selection["grid_id"]
            or plan["baseline_scenario_id"] != selection["baseline_scenario_id"]
            or plan["base_profile_ids"] != [selection["base_profile_id"]]
            or plan["alternative_scenario_ids"] != selection["alternative_scenario_ids"]
            or plan["members"][0]["profile_id"] != selection["base_profile_id"]):
        raise ValueError("Receiving changed the native parameter design")
    if plan["state"] != "complete":
        raise ValueError("Retain the completed native parameter design")
    for member in plan["members"]:
        files.json("profiles/" + member["profile_id"] + ".json")
        profile = ws._get("profiles", member["profile_id"])
        _sources(ws, files, profile["source_collection_id"])
        scenarios = [selection["baseline_scenario_id"], *selection["alternative_scenario_ids"]]
        if [item["scenario_id"] for item in member["runs"]] != scenarios:
            raise ValueError("Receiving changed a member's baseline/alternative order")
        for item in member["runs"]:
            _run(ws, files, item["run_id"], {
                "grid_id": selection["grid_id"], "profile_id": member["profile_id"],
                "scenario_id": item["scenario_id"]})
    result = files.json("ensemble_results/" + key + "/headwaters-results.json")
    if result["ensemble_id"] != key or result["selection"] != selection or result["state"] != "complete":
        raise ValueError("Retain the complete selected parameter course")
    joint = result["joint_decisions"]
    comparisons = {item["member_id"]: item for item in joint["comparisons"]}
    if (joint["state"] != "complete" or len(comparisons) != len(plan["members"])
            or len(comparisons) != len(joint["comparisons"])):
        raise ValueError("Retain one complete decision comparison per parameter member")
    for member in plan["members"]:
        comparison = comparisons.get(member["id"])
        expected_runs = [item["run_id"] for item in member["runs"]]
        if (comparison is None or comparison["profile_id"] != member["profile_id"]
                or [comparison["baseline_run_id"], *comparison["alternative_run_ids"]] != expected_runs):
            raise ValueError("Receiving changed a member's decision comparison")
        _comparison(ws, files, comparison["comparison_id"],
                    [comparison["baseline_run_id"], *comparison["alternative_run_ids"]])
    products = joint.get("support_group_reports") or [joint["report"]]
    for product in products:
        report_id = product["report_id"]
        relative = "ensemble_results/" + key + "/joint-decisions/" + report_id
        manifest = files.json(relative + "/manifest.json")
        report = files.json(relative + "/report.json")
        if manifest["report_id"] != report_id or report["id"] != report_id:
            raise ValueError("Receiving changed a support-group decision report")
        for descriptor in manifest["members"]:
            files.file(ws.root / relative, descriptor)
        if product["archive_identity"]["path"] != relative + "/decision-package.zip":
            raise ValueError("Retain this support group's original decision archive")
        files.file(ws.root, product["archive_identity"])
        files.json("ensemble_results/" + key + "/joint-decisions/" + report_id + "-selection.json")
    operation = result["operation"]
    saved_operation = files.json("ensemble_results/" + key + "/operation.json")
    if saved_operation["ensemble_id"] != key or saved_operation["state"] != "complete":
        raise ValueError("Retain the completed original parameter operation record")
    if operation["state"] != "complete":
        raise ValueError("Retain the completed native parameter operation")
    scalar = operation.get("report")
    if scalar:
        files.descriptors(ws.root / "ensemble_reports" / scalar["id"], scalar.get("files", {}))
    products_requested = operation.get("requested", {}).get("raster_products")
    raster_products = operation.get("raster_products", [])
    if products_requested and [item["scenario_id"] for item in raster_products] != plan["alternative_scenario_ids"]:
        raise ValueError("Retain every selected paired raster product")
    for product in raster_products:
        if product["state"] != "complete" or not product.get("archive"):
            raise ValueError("Retain the completed selected raster product and archive")
        files.file(ws.root, product["archive"])
    return {"kind": "parameter_course", "ensemble_id": key,
            "native_runs": sum(len(item["runs"]) for item in plan["members"]),
            "decision_report_ids": [item["report_id"] for item in products]}


def _sources(ws, files, key):
    files.json("sources/" + key + ".json")
    source = ws._get("sources", key)
    for descriptor in [source["original_manifest"],
                       *[body for entry in source["entries"]
                         for body in [entry["body"], *entry.get("companions", [])]]]:
        files.file(ws.root, {**descriptor, "path": descriptor["object"]})


def _customer_review(ws, files, check, receipt):
    """Use the restored application for the exact saved customer case and packages."""
    from model.simulated_customer_review import inspect_review, receive_review_case, STEPS
    key = check["operation_id"]
    relative = "implementation/simulated-customer-reviews/" + key
    files.json(relative + "/operation.json")
    for step in STEPS:
        files.json(relative + "/" + step + ".request.json")
        files.json(relative + "/" + step + ".result.json")
    result = inspect_review(ws, key)
    stable = ("operation_id", "project_id", "field_operation_id", "original_review_id",
              "response_id", "planning_handback_id", "revised_review_id", "handback_id")
    expected = check.get("expected", {})
    if (set(expected) != set(stable) or any(result.get(name) != expected[name] for name in stable)
            or result["phase"] != "ready" or result["project_id"] != ws.project["id"]
            or result["field_operation_id"] != receipt["fieldwork_operation_id"]
            or result["field_binding"]["recipe_sha256"] != receipt["recipe_sha256"]):
        raise ValueError("Receiving changed the original field customer review selection")
    if any(receipt["customer_review"].get(name) != result[name] for name in stable
           if name not in ("project_id", "field_operation_id")):
        raise ValueError("The original demo receipt names different customer records")
    for kind, keys in (
            ("reviews", ("original_review_id", "revised_review_id")),
            ("review-responses", ("response_id",)),
            ("review-handbacks", ("planning_handback_id", "handback_id"))):
        for name in keys:
            files.json(kind + "/" + result[name] + ".json")
    for collection_id in sorted({row["source_collection_id"] for choices in result["sources"].values()
                                 for row in choices}):
        _sources(ws, files, collection_id)
    source = Path(check["source"]).resolve(strict=True)
    original_packages = receipt["customer_review_packages"]
    if source != Path(original_packages["directory"]).resolve(strict=True):
        raise ValueError("Receive the original customer packages selected by this demo receipt")
    for name in ("original_review", "engineering_handback"):
        _check_file(_member(source, original_packages[name]["archive"]["path"]),
                    original_packages[name]["archive"])
    received = receive_review_case(ws, source, check["output"])
    if any(received.get(name) != result[name] for name in stable):
        raise ValueError("The reopened customer packages changed their original scientific identities")
    return {"kind": "customer_review", "operation_id": key,
            "inspection": result, "receiving": received}


def _inspect(request):
    application = Path(request["application"]).resolve(strict=True)
    if Path(__file__).resolve() != application / HELPER:
        raise ValueError("Run the helper retained inside this receiving application")
    sys.path.insert(0, str(application))
    importlib.invalidate_caches()
    from model.workspace import Workspace
    import model.workspace as workspace_module
    if Path(workspace_module.__file__).resolve() != application / "model/workspace.py":
        raise ValueError("The receiving process imported a different Workspace implementation")
    ws = Workspace(Path(request["workspace"]))
    files = _ScienceFiles(ws, request["members"])
    project = files.json("workspace.json")
    if project != request["project"] or ws.project != project:
        raise ValueError("Receiving changed the original project identity")
    receipt = request["receipt"]
    run_ids = [receipt["baseline_run_id"], *receipt["alternative_run_ids"]]
    scenarios = [receipt["baseline_scenario_id"], *receipt["alternative_scenario_ids"]]
    if len(run_ids) != len(scenarios) or len(set(run_ids)) != len(run_ids):
        raise ValueError("Retain matching distinct run and scenario selections")
    collections = {receipt["source_collection_id"]}
    for kind, key in [("profiles", receipt["profile_id"]),
                      *[("scenarios", key) for key in scenarios]]:
        files.json(kind + "/" + key + ".json")
        value = ws._get(kind, key)
        collections.add(value["source_collection_id"])
    files.json("grids/" + receipt["grid_id"] + "/grid.json")
    grid = ws.get_grid(receipt["grid_id"])
    files.descriptors(ws.root / "grids" / grid["id"], grid["files"])
    if grid["spec"]["source_collection_id"] != receipt["source_collection_id"]:
        raise ValueError("Receiving changed the original grid source collection")
    for key in sorted(collections):
        _sources(ws, files, key)
    runs = [_run(ws, files, key, {
        "grid_id": receipt["grid_id"], "profile_id": receipt["profile_id"], "scenario_id": scenario})
        for key, scenario in zip(run_ids, scenarios)]
    comparison = _comparison(ws, files, receipt["comparison_id"], run_ids)
    from model.scenario_footprint import get_footprint, RECORD_KIND
    footprints = []
    for key in receipt["scenario_footprint_ids"]:
        files.json(RECORD_KIND + "/" + key + ".json")
        footprint = get_footprint(ws, key, verify=False)
        selected = next((run for run in runs if run["id"] == footprint["run_id"]), None)
        if selected is None or footprint["selection"] != selected["selection"]:
            raise ValueError("Receiving changed a selected scenario footprint")
        files.descriptors(ws.root, footprint["files"])
        footprints.append({"id": key, "run_id": footprint["run_id"], "summary": footprint["summary"]})
    if {item["run_id"] for item in footprints} != set(run_ids):
        raise ValueError("Retain the footprint for every selected demo run")
    from model import native_process_report
    process_id = receipt["native_process_report_id"]
    files.json(native_process_report.ROOT + "/" + process_id + "/operation.json")
    report = native_process_report.inspect(ws, process_id)
    if (report["id"] != process_id or report["state"] != "complete"
            or report["selection"]["run_ids"] != run_ids):
        raise ValueError("Receiving changed the selected native process report")
    files.descriptors(ws.root, report["files"])
    delivery_id = receipt["delivery_id"]
    files.json("deliveries/" + delivery_id + "/delivery-state.json")
    delivery = ws.retained_item("deliveries", delivery_id)
    if (delivery["state"] != "complete"
            or delivery["selection"]["baseline_run_id"] != run_ids[0]
            or delivery["selection"]["scenario_run_ids"] != run_ids[1:]):
        raise ValueError("Receiving changed the selected mapped delivery")
    files.descriptors(ws.root / "deliveries" / delivery_id, delivery["files"])
    files.descriptors(ws.root / "deliveries" / delivery_id, delivery["maps"])
    spatial_reviews = _spatial_reviews(ws, files, receipt)
    checks = request["extra_checks"]
    if not isinstance(checks, list):
        raise ValueError("Extra receiving checks must be an explicit list")
    extra = []
    for check in checks:
        if not isinstance(check, dict):
            raise ValueError("Each receiving check must identify an original product")
        if check.get("kind") == "parameter_course":
            extra.append(_parameter_course(ws, files, check, receipt))
        elif check.get("kind") == "customer_review":
            extra.append(_customer_review(ws, files, check, receipt))
        elif check.get("kind") == "field_campaign":
            from model.simulated_fieldwork import inspect_campaign
            result = inspect_campaign(ws, check["operation_id"])
            if (result["operation_id"] != check["operation_id"]
                    or result["original_project_id"] != ws.project["id"]
                    or result["recipe_sha256"] != receipt["recipe_sha256"]):
                raise ValueError("The field campaign belongs to a different demo edition")
            for name, value in check.get("expected", {}).items():
                if name not in {"operation_id", "recipe_sha256", "original_project_id", "plan_id",
                                "phase", "completed_steps", "demo_id", "classification"}:
                    raise ValueError("Unknown field-campaign stable key: " + name)
                if result.get(name) != value:
                    raise ValueError("Receiving changed field-campaign " + name)
            extra.append({"kind": "field_campaign", "operation_id": check["operation_id"],
                          "inspection": result})
        else:
            raise ValueError("Unknown receiving check: " + str(check.get("kind")))
    imported = {}
    for name, module in list(sys.modules.items()):
        filename = getattr(module, "__file__", None)
        if filename is None:
            continue
        path = Path(filename).resolve()
        belongs = path == application or application in path.parents
        if not belongs:
            if name == "model" or name.startswith(("model.", "source_tools.", "ecsa_runs.")):
                raise ValueError("Receiving imported application code from another edition: " + name)
            continue
        relative = path.relative_to(application).as_posix()
        expected = request["members"].get("application/" + relative)
        if expected is None:
            raise ValueError("Imported application source is absent from its archive: " + relative)
        _check_file(path, expected)
        imported[name] = {"path": relative, "sha256": expected["sha256"]}
    for relative, identity in files.checked.items():
        if _identity(_member(ws.root, relative).lstat()) != identity:
            raise ValueError("Scientific file changed during receiving: " + relative)
    return {
        "schema": SCHEMA, "attempt_id": request["attempt_id"], "state": "complete",
        "completed_at": _now(), "project": ws.project,
        "application": str(application), "workspace": str(ws.root),
        "run_ids": run_ids, "comparison_id": comparison["id"],
        "native_process_report_id": process_id, "delivery_id": delivery_id,
        "footprints": footprints, "spatial_reviews": spatial_reviews, "extra_checks": extra,
        "verified_scientific_files": len(files.checked), "imported_modules": imported,
        "process": {"pid": os.getpid(), "python": sys.executable, "isolated": bool(sys.flags.isolated)},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args(argv)
    request = None
    try:
        data = args.request.read_bytes()
        if hashlib.sha256(data).hexdigest() != args.request_sha256:
            raise ValueError("The retained receiving request changed")
        request = json.loads(data)
        if request.get("schema") != SCHEMA or not sys.flags.isolated or not sys.dont_write_bytecode:
            raise ValueError("Use the original isolated receiving invocation")
        result = _inspect(request)
        result["request_sha256"] = args.request_sha256
        _write(args.result, result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)
        return 0
    except BaseException as error:
        result = {"schema": SCHEMA, "attempt_id": (request or {}).get("attempt_id"),
                  "state": "failed" if isinstance(error, Exception) else "interrupted",
                  "failed_at": _now(), "request_sha256": args.request_sha256,
                  "error": {"type": type(error).__name__, "message": str(error)}}
        try:
            _write(args.result, result)
        except OSError as receipt_error:
            _secondary(error, "retain child receiving failure", receipt_error)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
