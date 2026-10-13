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


def cold_reopen(restored, manifest, receipt, output, extra_checks=None, *, selected_study=None):
    """Verify restored source and inspect selected results in a new interpreter.

    extra_checks names original parameter, field, customer, Programme, source or report identities.
    selected_study selects the same saved report's editable dependency archive.
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
            "selected_study": selected_study,
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
        else:
            self._unchanged(relative)
        return path

    def _unchanged(self, relative):
        """Accept a source-view hardlink only after rechecking archived bytes."""
        path = _member(self.root, relative)
        previous = self.checked[relative]
        current = _identity(path.lstat())
        if current == previous:
            return
        # Source views are omitted from portable archives. The restored product
        # may create them while opening maps or customer evidence, changing CAS
        # ctime. Keep the original inode/size/mtime and check its complete digest
        # and permissions; a same-length edit with restored mtime still fails.
        if current[:4] != previous[:4]:
            raise ValueError("Scientific file changed during inspection: " + relative)
        verified = _check_file(path, self.members["workspace/" + relative])
        if verified[:4] != previous[:4]:
            raise ValueError("Scientific file changed during rechecking: " + relative)
        self.checked[relative] = verified

    def verify_unchanged(self):
        for relative in self.checked:
            self._unchanged(relative)

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
        for field in ("arguments", "artifact", "files", "companions", "additional_files", "registry_outputs"):
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


def _paired_product(ws, files, product, plan):
    """Reopen the saved paired product without rebuilding its source-bound kernel."""
    from model.common import digest
    from model.paired_ensemble import EnsembleWorkspace
    key = product["analysis_id"]
    directory = ws.root / "ensemble-products" / key
    files.json("ensemble-products/" + key + "/analysis.json")
    files.json("ensemble-products/" + key + "/reports.json")
    result = EnsembleWorkspace(ws).describe(key)
    selected = result["selection"]
    if result["state"] != "complete":
        raise ValueError("Retain the completed original paired raster product")
    reference = selected["source_references"]
    if (reference["project_id"] != ws.project["id"] or reference["grid_id"] != plan["grid_id"]
            or reference["baseline_scenario"]["id"] != plan["baseline_scenario_id"]
            or reference["alternative_scenario"]["id"] != product["scenario_id"]):
        raise ValueError("Receiving changed the paired product's original case")
    expected = {}
    for member in plan["members"]:
        runs = {item["scenario_id"]: item["run_id"] for item in member["runs"]}
        expected[member["profile_id"]] = (
            runs[plan["baseline_scenario_id"]], runs[product["scenario_id"]], product["scenario_id"])
    actual = {member["profile_id"]: (
        member["baseline_run_id"], member["alternative_run_id"], member["scenario_id"])
        for member in selected["members"]}
    if (actual != expected or len(actual) != len(selected["members"])
            or selected["planned_member_count"] != len(plan["members"])
            or selected["selected_member_count"] != len(plan["members"])):
        raise ValueError("Receiving changed the paired product's original member selection")
    reports = result["reports"]
    if reports["ensemble_id"] != key or digest(reports) != product["report_signature"]:
        raise ValueError("Receiving changed the paired product's original report edition")
    files.descriptors(directory, result["artifacts"])
    files.descriptors(directory, reports["files"])
    files.file(ws.root, product["archive"])
    return {"id": key, "scenario_id": product["scenario_id"],
            "report_signature": product["report_signature"], "identity": "MATCH"}


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
    paired_products = []
    for product in raster_products:
        if product["state"] != "complete" or not product.get("archive"):
            raise ValueError("Retain the completed selected raster product and archive")
        paired_products.append(_paired_product(ws, files, product, plan))
    return {"kind": "parameter_course", "ensemble_id": key,
            "native_runs": sum(len(item["runs"]) for item in plan["members"]),
            "decision_report_ids": [item["report_id"] for item in products],
            "paired_products": paired_products}


def _latest_native_study_source(ws, files, ensemble_id, captured_operation_id):
    """Check the independent latest pointer without replacing a selected edition."""
    from model.common import digest, identifier
    from model.ensemble_study_source import DIRECTORY, SOURCE_ID

    pointer = files.json("ensemble_results/" + ensemble_id + "/latest-scientific-study.json")
    latest_id = identifier(pointer.get("source_operation_id"))
    if pointer != {"ensemble_id": ensemble_id, "source_operation_id": latest_id}:
        raise ValueError("The latest scientific source points to a different native design")
    if latest_id == captured_operation_id:
        # The selected operation receives the complete original checks below.
        return latest_id

    relative = DIRECTORY + "/" + latest_id
    latest = files.json(relative + "/operation.json")
    basis = latest.get("selection")
    if (latest.get("schema") != "upstate.ensemble-study-source/v1"
            or latest.get("id") != latest_id or not isinstance(basis, dict)
            or digest(basis) != latest_id
            or latest.get("workspace_id") != ws.project["id"]
            or latest.get("ensemble_id") != ensemble_id
            or basis.get("workspace_id") != ws.project["id"]
            or basis.get("ensemble_id") != ensemble_id):
        raise ValueError("The newer retained scientific source has another native identity")
    source = latest.get("source")
    if not isinstance(source, dict) or source.get("source_id") != SOURCE_ID:
        raise ValueError("The newer retained scientific source lacks its original import")
    collection_id = identifier(source["source_collection_id"])
    _sources(ws, files, collection_id)
    collection = ws._get("sources", collection_id)
    entries = [entry for entry in collection["entries"] if entry["id"] == SOURCE_ID]
    if len(entries) != 1:
        raise ValueError("The newer scientific source lacks its unique original entry")
    files.descriptors(ws.root, latest.get("files", {}))
    recipe_path = files.file(ws.root, latest["files"]["source_recipe"])
    if recipe_path != ws.root / relative / "source" / "scientific-report.json":
        raise ValueError("The newer scientific recipe is outside its original operation")
    recipe = files.json(recipe_path.relative_to(ws.root).as_posix())
    entry = entries[0]
    metadata = entry.get("metadata", {})
    if (recipe.get("schema") != "upstate.observed-report/v1" or recipe.get("basis") != basis
            or metadata.get("report_schema") != recipe["schema"]
            or metadata.get("source_basis") != "saved_native_ensemble"
            or metadata.get("workspace_id") != ws.project["id"]
            or metadata.get("ensemble_id") != ensemble_id
            or metadata.get("report_id") != basis.get("report_id")
            or metadata.get("source_operation_id") != latest_id
            or any(entry["body"][name] != latest["files"]["source_recipe"][name]
                   for name in ("bytes", "sha256"))):
        raise ValueError("The newer scientific source differs from its retained recipe")
    for item in recipe["inputs"]:
        files.file(recipe_path.parent, item)
    # A later prepared source can be source_ready while its rendering is pending.
    # It is retained independently; only the chosen report must be complete.
    return latest_id


def _native_study_source(ws, files, check, case, delivery=None, *, report_selection=None):
    """Reopen the report-bound study source from the same captured native course."""
    from model.common import digest, identifier
    from model import observed_context
    from model.ensemble_study_source import DIRECTORY, SOURCE_ID

    key = identifier(check["ensemble_id"])
    operation_id = identifier(check["source_operation_id"])
    captured = case.get("scientific_study")
    if (not isinstance(captured, dict) or captured.get("ensemble_id") != key
            or captured.get("source_operation_id") != operation_id
            or case.get("ensemble_id") != key):
        raise ValueError("The scientific source belongs to a different captured parameter course")
    if check.get("expected") != captured:
        raise ValueError("Select the original captured scientific source and report signature")
    relative = DIRECTORY + "/" + operation_id
    operation = files.json(relative + "/operation.json")
    selection = operation.get("selection", {})
    if (operation.get("schema") != "upstate.ensemble-study-source/v1"
            or operation.get("id") != operation_id or digest(selection) != operation_id
            or operation.get("state") != "complete" or operation.get("native_state") != "complete"
            or operation.get("workspace_id") != ws.project["id"]
            or selection.get("workspace_id") != ws.project["id"]
            or operation.get("ensemble_id") != key or selection.get("ensemble_id") != key):
        raise ValueError("Receiving changed the original completed scientific study operation")
    latest_operation_id = _latest_native_study_source(ws, files, key, operation_id)
    source = operation["source"]
    rendered = operation["report"]
    actual = {
        "source_operation_id": operation_id, "source": source, "ensemble_id": key,
        "report_id": selection["report_id"],
        "summary_signature": selection["summary_signature"],
        "run_signature": selection["run_signature"],
        "report_signature": rendered["signature"],
        "figure_count": operation["figure_count"],
    }
    if actual != captured or rendered.get("source") != source or source.get("source_id") != SOURCE_ID:
        raise ValueError("Receiving changed the retained scientific source, figures or rendering edition")
    files.descriptors(ws.root, operation["files"])
    recipe_path = files.file(ws.root, operation["files"]["source_recipe"])
    if recipe_path != ws.root / relative / "source" / "scientific-report.json":
        raise ValueError("The study recipe is outside its original operation")
    recipe = files.json(recipe_path.relative_to(ws.root).as_posix())
    if recipe.get("schema") != "upstate.observed-report/v1" or recipe.get("basis") != selection:
        raise ValueError("Receiving changed the scientific recipe's original native result basis")
    if len(recipe.get("figures", [])) != actual["figure_count"]:
        raise ValueError("Receiving changed the retained scientific figure selection")
    for item in recipe["inputs"]:
        files.file(recipe_path.parent, item)
    _sources(ws, files, identifier(source["source_collection_id"]))
    collection = ws._get("sources", source["source_collection_id"])
    entries = [entry for entry in collection["entries"] if entry["id"] == SOURCE_ID]
    if len(entries) != 1:
        raise ValueError("Retain this scientific source in its original collection")
    entry = entries[0]
    metadata = entry.get("metadata", {})
    if (metadata.get("source_basis") != "saved_native_ensemble"
            or metadata.get("workspace_id") != ws.project["id"]
            or metadata.get("ensemble_id") != key
            or metadata.get("report_id") != selection["report_id"]
            or metadata.get("source_operation_id") != operation_id
            or any(entry["body"][name] != operation["files"]["source_recipe"][name]
                   for name in ("bytes", "sha256"))):
        raise ValueError("The retained source entry differs from the captured scientific recipe")
    pdf = files.file(ws.root, rendered["files"]["report.pdf"])
    release = files.json((pdf.parent / "release.json").relative_to(ws.root).as_posix())
    if release != rendered:
        raise ValueError("Receiving changed the original standalone scientific report release")
    chosen = observed_context.source_choices(
        report_selection if report_selection is not None else delivery["selection"])
    if chosen.count(source) != 1:
        raise ValueError("The final mapped report does not contain this exact scientific study source")
    return {
        "kind": "native_study_source", **actual,
        "latest_source_operation_id": latest_operation_id,
        "selected_source_is_latest": latest_operation_id == operation_id,
        "state": "complete", "delivery_id": delivery["id"] if delivery is not None else None,
        "ordered_report_sources": chosen,
        "retained_source_members": len(recipe["inputs"]),
        "report_files": rendered["files"],
    }


def restore_selected_study(archive, saved, destination, *, expected_sources=None):
    """Reuse or restore the same original selected-study archive and its source."""
    from model import portable, study_transfer
    archive = Path(archive).resolve(strict=True)
    destination = Path(destination).absolute()
    _check_file(archive, saved)
    inspected = study_transfer.inspect_transfer_archive(archive, verify=False)
    manifest = inspected["manifest"]
    if inspected["study"]["id"] != saved["id"]:
        raise ValueError("The selected archive contains another original Study transfer")
    for name, expected_sha256 in (expected_sources or {}).items():
        retained = manifest["members"].get(name)
        if retained is None or retained["sha256"] != expected_sha256:
            raise ValueError("The selected archive contains another receiving implementation: " + name)
    if destination.is_symlink():
        raise ValueError("Keep selected-study receiving in its own actual directory")
    if destination.exists():
        restored = portable.resume_restore(
            archive, destination, expected_archive_sha256=saved["sha256"])
    else:
        restored = portable.restore(archive, destination)
    return restored, manifest


def _scientific_report(ws, files, captured):
    """Inspect the original ordered edition; the receiving child never renders."""
    from model import observed_context, scientific_report_editions
    from model.common import identifier
    key = identifier(captured["id"])
    files.json("scientific-report-editions/" + key + "/edition.json")
    value, selected, operation = scientific_report_editions.inspect(ws, key)
    for name in ("operation.json", "selection.json"):
        files.json((selected / name).relative_to(ws.root).as_posix())
    choices = observed_context.source_choices(value["render_identity"]["selection"])
    actual = {"id": key, "title": value["title"], "sources": choices,
              "source_count": value["source_count"], "figure_count": value["figure_count"]}
    if actual != captured or value["state"] != "complete" or value["project_id"] != ws.project["id"]:
        raise ValueError("Receiving changed the saved ordered scientific report")
    files.descriptors(selected, scientific_report_editions.files(value, selected))
    for source in choices:
        _sources(ws, files, source["source_collection_id"])
    return value, actual


def _selected_study(ws, files, selected, case):
    """Validate selected editable report dependencies in the archived application."""
    from model.common import digest, identifier
    from model import study_transfer

    key = identifier(selected["transfer_id"])
    captured = files.json("study-transfers/" + key + ".json")
    expected_selection = {
        "schema": "upstate.study-selection/v1",
        "title": selected["selection"]["title"],
        "roots": [{"kind": "scientific-report-editions", "id": case["scientific_report"]["id"]}],
        "include_related_results": False,
    }
    if (selected["selection"] != expected_selection
            or captured.get("schema") != "upstate.study-transfer/v1"
            or captured.get("id") != key or digest(captured["identity"]) != key
            or captured["identity"]["project_id"] != ws.project["id"]
            or captured["identity"]["selection"] != expected_selection):
        raise ValueError("The selected archive identifies a different saved scientific report")
    verified = study_transfer.verify_received_studies(ws)
    matching = [row for row in verified if row["id"] == key]
    if len(matching) != 1 or matching[0]["identity"] != "MATCH":
        raise ValueError("Reopen every original selected scientific dependency")
    edition, report = _scientific_report(ws, files, case["scientific_report"])
    source = _native_study_source(ws, files, {
        "ensemble_id": case["ensemble_id"],
        "source_operation_id": case["scientific_study"]["source_operation_id"],
        "expected": case["scientific_study"],
    }, case, report_selection=edition["render_identity"]["selection"])
    course = _parameter_course(ws, files, {
        "ensemble_id": case["ensemble_id"], "expected": {"project_id": ws.project["id"]},
    }, case)
    return {
        "scope": "selected_scientific_study", "study_transfer_id": key,
        "scientific_report": report, "scientific_study": source,
        "parameter_course": course, "study_verification": matching[0],
    }


def _sources(ws, files, key):
    files.json("sources/" + key + ".json")
    source = ws._get("sources", key)
    for descriptor in [source["original_manifest"],
                       *[body for entry in source["entries"]
                         for body in [entry["body"], *entry.get("companions", [])]]]:
        files.file(ws.root, {**descriptor, "path": descriptor["object"]})


def _field_qc_comparison(ws, files, check, receipt, delivery):
    """Read the original comparison and scientific binding in the restored process."""
    from model import observed_context, simulated_qc_comparison
    from model.common import identifier
    key = identifier(check["operation_id"])
    captured = receipt.get("qc_comparison")
    if (not isinstance(captured, dict) or captured.get("operation_id") != key
            or captured.get("field_operation_id") != receipt["fieldwork_operation_id"]
            or captured.get("plan_id") != receipt["fieldwork_plan_id"]
            or captured.get("original_project_id") != ws.project["id"]):
        raise ValueError("Retain the original same-case QC comparison receipt")
    files.descriptors(ws.root, captured["retained_files"])
    result = simulated_qc_comparison.inspect_comparison(ws, key)
    # inspect_comparison verifies the immutable original reviews and source,
    # while current_revision reports the receiver's current editable plan.
    original_snapshot = {name: value for name, value in captured.items()
                         if name != "current_revision"}
    received_snapshot = {name: value for name, value in result.items()
                         if name != "current_revision"}
    if (received_snapshot != original_snapshot or result["phase"] != "complete"
            or result["browser_choice"] != check.get("expected")):
        raise ValueError("Receiving changed the retained field/QC comparison")
    source = result["report_source"]
    _sources(ws, files, source["source_collection_id"])
    selected = observed_context.source_choices(delivery["selection"])
    if not any(all(row.get(name) == source[name] for name in (
            "source_collection_id", "source_id")) for row in selected):
        raise ValueError("The received mapped delivery omits its original QC comparison source")
    observed_context.bind(ws, result["delivery_selection"])
    return {"kind": "field_qc_comparison", "operation_id": key,
            "inspection": result}


def _customer_review(ws, files, check, receipt):
    """Use the restored application for the exact saved customer case and packages."""
    from model.simulated_customer_review import inspect_export, inspect_review, receive_review_case, STEPS
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
    expected_packages = {name: value for name, value in original_packages.items()
                         if name not in ("directory", "original_index", "handback_index")}
    if inspect_export(source) != expected_packages:
        raise ValueError("Receive the original customer packages selected by this demo receipt")
    for name in ("original_review", "engineering_handback"):
        _check_file(_member(source, original_packages[name]["archive"]["path"]),
                    original_packages[name]["archive"])
    received = receive_review_case(ws, source, check["output"])
    if any(received.get(name) != result[name] for name in stable):
        raise ValueError("The reopened customer packages changed their original scientific identities")
    return {"kind": "customer_review", "operation_id": key,
            "inspection": result, "receiving": received}


def _finish(request, application, ws, files, payload):
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
    files.verify_unchanged()
    return {
        "schema": SCHEMA, "attempt_id": request["attempt_id"], "state": "complete",
        "completed_at": _now(), "project": ws.project,
        "application": str(application), "workspace": str(ws.root),
        **payload,
        "verified_scientific_files": len(files.checked), "imported_modules": imported,
        "process": {"pid": os.getpid(), "python": sys.executable, "isolated": bool(sys.flags.isolated)},
    }


def _programme(ws, files, check, case):
    from model.common import digest, identifier
    from model.compute_programme import ComputeProgrammes
    run_ids = [case["baseline_run_id"], *case["alternative_run_ids"]]
    source_path = files.file(ws.root, check["input"])
    adoption_path = files.file(ws.root, check["adoption"])
    original, adopted = _read(source_path), _read(adoption_path)
    fields = ("schema", "operation", "demo_id", "classification", "project_id",
              "recipe_sha256", "input_summary", "source_collection_id", "source_ids",
              "grid_id", "profile_id", "baseline_run_id", "baseline_scenario_id",
              "alternative_run_ids", "alternative_scenario_ids", "control", "delivery_id")
    if any(original.get(name) != case.get(name) for name in fields):
        raise ValueError("Receiving changed the frozen Programme input selection")
    if (adopted.get("schema") != "upstate.simulated-programme-receiving/v1"
            or adopted.get("programme_id") != check["programme_id"]
            or adopted.get("project_id") != ws.project["id"]
            or adopted.get("recipe_sha256") != case["recipe_sha256"]
            or adopted.get("existing_delivery_id") != case["delivery_id"]
            or [row["run_id"] for row in adopted.get("native_runs", [])] != run_ids
            or any(adopted["original_receipt"].get(name) != check["input"][name]
                   for name in ("bytes", "sha256"))):
        raise ValueError("Receiving changed the original Programme adoption")
    key = check["programme_id"]
    record = files.json("compute-programmes/" + key + "/programme.json")
    files.json("compute-programmes/" + key + "/progress.json")
    if record.get("workspace_id") != ws.project["id"]:
        raise ValueError("The Programme belongs to another original project")
    manager = ComputeProgrammes(ws)
    status = manager.status(key, include_ensemble_candidates=False)
    if (status["state"] != "complete" or [row["run_id"] for row in status["runs"]] != run_ids
            or (adopted.get("programme_reused") is not True
                and any(not row.get("attempts") or row["attempts"][-1].get("reused") is not True
                        for row in status["runs"]))):
        raise ValueError("Receiving changed completed native Programme reuse")
    for row in status["runs"][1:]:
        comparison = status["comparisons"].get(row["key"])
        if not comparison or comparison.get("kind") != "native":
            raise ValueError("Retain each original native Programme comparison")
        _comparison(ws, files, comparison["id"], [run_ids[0], row["run_id"]])
    report = manager.read_report(key)
    if report.get("id") != check["report_id"]:
        raise ValueError("Receiving changed the original Programme report")
    for name in ("schema", "rows", "files"):
        if report.get(name) != adopted["report"].get(name):
            raise ValueError("Receiving changed Programme report " + name)
    files.descriptors(ws.root, report["files"])
    preview = manager.delivery_preview(key, adopted["native_study_selection"])
    if (not preview["ready"] or preview["selection"]["baseline_run_id"] != run_ids[0]
            or preview["selection"]["scenario_run_ids"] != run_ids[1:]):
        raise ValueError("Receiving changed the Programme's original mapped selection")
    opening = None
    scenario_ids = [case["baseline_scenario_id"], *case["alternative_scenario_ids"]]
    expected_session = check.get("operator_session")
    if expected_session is not None:
        if not isinstance(expected_session, dict):
            raise ValueError("Retain the original saved operator-session record")
        files.file(ws.root, check["operator_session_file"])
        saved = files.json("operator-session.json")
        original_opening = adopted["operator_opening"]
        saved_journey = saved.get("journey", {})
        if (check.get("operator_opening_id") != original_opening["id"]
                or original_opening["programme_id"] != key
                or saved_journey.get("recorded_context", {}).get("operator_opening", {}).get("id") != original_opening["id"]
                or saved_journey.get("selection") != original_opening["journey"]["selection"]):
            raise ValueError("The saved opening no longer represents the original Programme selection")
        journey = saved.get("journey", {})
        selection = journey.get("selection", {})
        if (saved != expected_session
                or saved.get("schema") != "upstate.operator-session/v1"
                or saved.get("project_id") != ws.project["id"]
                or journey.get("schema") != "upstate.operating-journey/v1"
                or journey.get("project_id") != ws.project["id"]
                or saved.get("revision") != digest(journey)):
            raise ValueError("Receiving changed the original saved guided opening")
        selected_run = selection.get("run_id")
        if (selection.get("baseline_run_id") != run_ids[0]
                or selected_run not in run_ids[1:]
                or selection.get("grid_id") != case["grid_id"]
                or selection.get("profile_id") != case["profile_id"]
                or selection.get("scenario_id") != scenario_ids[run_ids.index(selected_run)]
                or selection.get("delivery_id") != case["delivery_id"]):
            raise ValueError("The saved guided opening differs from the original demo")
        comparison_id = identifier(selection["comparison_id"])
        files.json("comparisons/" + comparison_id + "/comparison.json")
        comparison = ws.retained_item("comparisons", comparison_id)
        if (comparison["baseline_run_id"] != run_ids[0]
                or selected_run not in [item["run_id"] for item in comparison["alternatives"]]):
            raise ValueError("The saved opening comparison uses another native case")
        spatial_id = selection.get("spatial_review_id")
        if spatial_id:
            selected_reviews = case.get("spatial_review_ids")
            if selected_reviews is None and len(run_ids) == 2:
                selected_reviews = {run_ids[1]: case.get("spatial_review_id")}
            if not isinstance(selected_reviews, dict) or selected_reviews.get(selected_run) != spatial_id:
                raise ValueError("The saved opening map uses another original run pair")
        opening = {"revision": saved["revision"], "saved_at": saved["saved_at"],
                   "entry_view": "journey", "selection": selection}
    return {"kind": "compute_programme", "programme_id": key,
            "state": status["state"], "run_ids": run_ids, "report_id": report["id"],
            "input": check["input"], "adoption": check["adoption"],
            "files": report["files"], "native_study_selection": preview["selection"],
            "operator_opening": opening}


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
    if request.get("selected_study") is not None:
        return _finish(request, application, ws, files,
                       _selected_study(ws, files, request["selected_study"], receipt))
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
        elif check.get("kind") == "native_study_source":
            extra.append(_native_study_source(ws, files, check, receipt, delivery))
        elif check.get("kind") == "scientific_report":
            if check.get("expected") != receipt["scientific_report"]:
                raise ValueError("Select the captured ordered scientific report")
            _, report = _scientific_report(ws, files, receipt["scientific_report"])
            extra.append({"kind": "scientific_report", **report})
        elif check.get("kind") == "compute_programme":
            extra.append(_programme(ws, files, check, receipt))
        elif check.get("kind") == "customer_review":
            extra.append(_customer_review(ws, files, check, receipt))
        elif check.get("kind") == "field_qc_comparison":
            extra.append(_field_qc_comparison(ws, files, check, receipt, delivery))
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
    return _finish(request, application, ws, files, {
        "run_ids": run_ids, "comparison_id": comparison["id"],
        "native_process_report_id": process_id, "delivery_id": delivery_id,
        "footprints": footprints, "spatial_reviews": spatial_reviews, "extra_checks": extra,
    })


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
