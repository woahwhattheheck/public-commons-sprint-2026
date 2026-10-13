"""Cold-open the geographic project using its own archived application.

The existing native receiving operation owns this invocation. This helper opens
saved native results, sources, the scientific report and customer review only.
It does not execute a model or rebuild a scientific product.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

APP = Path(__file__).resolve().parents[1]
HELPER = "source_tools/geographic_headwaters_reopen.py"
SCHEMA = "upstate.geographic-headwaters-cold-receiving/v1"


@contextmanager
def receiving_lock(path):
    """Keep the original receiving flock alive in a surviving owned child."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield descriptor
    finally:
        # Do not explicitly LOCK_UN: a child can still own this open description.
        os.close(descriptor)


def _support():
    if str(APP) not in sys.path:
        sys.path.insert(0, str(APP))
    from source_tools import simulated_headwaters_receiving
    if Path(simulated_headwaters_receiving.__file__).resolve() != APP / "source_tools/simulated_headwaters_receiving.py":
        raise ValueError("Use the retained scientific receiving implementation")
    return simulated_headwaters_receiving


def _lock_identity(descriptor, path):
    if type(descriptor) is not int:
        raise ValueError("Retain the original receiving lock descriptor")
    path = Path(path).absolute()
    opened, current = os.fstat(descriptor), path.lstat()
    if (not stat.S_ISREG(opened.st_mode) or not stat.S_ISREG(current.st_mode)
            or (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino)):
        raise ValueError("The receiving lock path differs from its owned descriptor")
    return {"path": str(path), "device": opened.st_dev, "inode": opened.st_ino}


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
                review_response_id=None, receiving_context=None):
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
            "prepared": prepared, "scientific": _scientific_identity(scientific),
            "delivery_id": delivery_id, "review_id": review_id,
            "review_response_id": review_response_id,
            "receiving_context": receiving_context,
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
            process = subprocess.Popen(
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
                or result.get("workspace") != str(workspace)):
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
    parameter = support._parameter_course(ws, files, {"ensemble_id": prepared["ensemble_id"]}, case)
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
        "expected": request["scientific"]}, case, delivery)
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
        "receiving_context": context,
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
        result = _inspect(request, args.lock_fd)
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
