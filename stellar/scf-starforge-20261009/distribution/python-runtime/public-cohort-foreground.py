#!/usr/bin/env python3
"""Retain one admitted public Python cohort before its private mount ends.

The published run-public-cohort.sh and engine.py own resolution and packaging.
This receiving shell keeps their exact result and full stage logs, then uses the
existing connected Library workflow to retain the public output.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import zipfile

SCHEMA = "stellar-forge.public-cohort-foreground.v1"
OPERATION = "scf-public-python-e287-workbooks-agents-a66c-20261012"
SOURCE_ID = "63faa446741cc98429d80516b34ee993ffe060e1b2739223bc84f18c8e4a88d5"
CANDIDATE = "ecd877ea50015f8ff76b8c3b07156250e62b425574e0392052106295f5494e8c"
ENGINE_SHA = "0a11ddd116f0d093470f0f67e4707da3192d250f08d9a894c5ebf7596e144be8"
WRAPPER_BLOB = "c9054cc5d3b026a0387759ad430cd18847992f00"
SESSION_SHA = "dfd802b9cc17dc0aaac48a6d0f70bcf39ee2515fb33730d97286c4f55aa83e48"
HELPERS = {
    "library_upload.py": "5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767",
    "library_hosted_apps.py": "97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59",
    "library_file_transfer.py": "5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378",
}
MAX_RESULT = 4 * 1024 * 1024
TAIL_BYTES = 65536
_stop_signal = None


def need(condition, code):
    if not condition:
        raise ValueError(code)


def checksum(path):
    with Path(path).open("rb") as body:
        return hashlib.file_digest(body, "sha256").hexdigest()


def private(path, create=False):
    path = Path(path)
    need(path.is_absolute(), "absolute_private_path_required")
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and
         path.resolve() == path and info.st_uid == os.getuid() and
         not info.st_mode & 0o077, "owned_private_directory_required")
    return path


def regular(path):
    path = Path(path)
    need(path.is_absolute() and not path.is_symlink(), "absolute_regular_file_required")
    need(stat.S_ISREG(path.lstat().st_mode), "regular_file_required")
    return path


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".pending")
    data = encode(value)
    with temporary.open("wb") as body:
        os.fchmod(body.fileno(), 0o600)
        body.write(data)
        body.flush()
        os.fsync(body.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def tail(path):
    path = Path(path)
    if not path.exists():
        return {"bytes": 0, "tail": "", "tail_truncated": False}
    size = path.stat().st_size
    with path.open("rb") as body:
        body.seek(max(0, size - TAIL_BYTES))
        data = body.read(TAIL_BYTES)
    return {"bytes": size, "sha256": checksum(path),
            "tail": data.decode("utf-8", "replace"), "tail_truncated": size > len(data)}


def allocation(directory):
    size = 0
    seen = set()
    for path in (Path(directory), *Path(directory).rglob("*")):
        info = path.lstat()
        identity = (info.st_dev, info.st_ino)
        if path.is_symlink() or identity in seen:
            continue
        seen.add(identity)
        size += info.st_blocks * 512
    return {"allocated_bytes": size, "inodes": len(seen)}


def process_signal(number, _frame):
    global _stop_signal
    _stop_signal = number


def signal_owned(child, number):
    if child is not None and child.poll() is None:
        try:
            os.killpg(child.pid, number)
        except ProcessLookupError:
            pass


def drain_owned(child):
    if child is None or child.poll() is not None:
        return
    signal_owned(child, signal.SIGTERM)
    try:
        child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        signal_owned(child, signal.SIGKILL)
        child.wait()


def attempt_diagnostics(root, producer):
    phase = producer.get("phase")
    if phase not in ("resolve", "inspect", "bundle"):
        return None
    attempt = Path(producer["attempt"])
    need(attempt.is_absolute() and not attempt.is_symlink()
         and attempt.resolve(strict=True).parent == root
         and attempt.name.startswith("attempt-"), "original_attempt_outside_operation")
    result = {"phase": phase, "attempt": str(attempt), "files": {}}
    for label, suffix in (("stdout", ".json"), ("stderr", ".stderr"),
                          ("progress", "-progress.json")):
        path = attempt / (phase + suffix)
        try:
            result["files"][label] = {"path": str(path), "exists": path.exists(), **tail(path)}
        except (OSError, ValueError) as error:
            result["files"][label] = {"path": str(path), "error": str(error)}
    progress_path = attempt / (phase + "-progress.json")
    if progress_path.is_file() and progress_path.stat().st_size <= MAX_RESULT:
        try:
            progress_value = json.loads(progress_path.read_bytes())
            if isinstance(progress_value, dict) and progress_value.get("log"):
                log = regular(progress_value["log"])
                need(log.resolve(strict=True).is_relative_to(root),
                     "original_stage_log_outside_operation")
                result["stage_log"] = {"path": str(log),
                    "stage": progress_value.get("stage"),
                    "state": progress_value.get("state"), **tail(log)}
        except (OSError, ValueError, KeyError, TypeError) as error:
            result["stage_log_error"] = str(error)
    return result


def run_wrapper(plan, root, control, lock_fd):
    stdout_path, stderr_path = root / "producer.stdout", root / "producer.stderr"
    started = time.time()
    command = ["/bin/bash", plan["wrapper"], str(root), plan["engine"],
               plan["source"]["directory"], plan["python"]]
    environment = dict(os.environ)
    environment["COHORT_DISK_LIMIT_BYTES"] = str(plan["limits"]["disk_bytes"])
    environment["COHORT_DISK_RESERVE_BYTES"] = str(plan["limits"]["reserve_bytes"])
    child, wrapper_error = None, None
    with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
        try:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     cwd=root, env=environment, start_new_session=True,
                                     pass_fds=(lock_fd,))
            write(control / "progress.json", {"schema": SCHEMA, "operation_id": OPERATION,
                  "state": "RUNNING", "stage": "original-public-producer",
                  "pid": child.pid, "started_at": started})
            deadline = None
            while child.poll() is None:
                if _stop_signal is not None and deadline is None:
                    signal_owned(child, signal.SIGTERM)
                    deadline = time.monotonic() + 30
                if deadline is not None and time.monotonic() >= deadline:
                    signal_owned(child, signal.SIGKILL)
                    deadline = float("inf")
                time.sleep(0.2)
        except BaseException as error:
            wrapper_error = {"type": type(error).__name__, "message": str(error)}
        finally:
            drain_owned(child)
            for body in (stdout, stderr):
                body.flush()
                os.fsync(body.fileno())
    code = child.returncode if child is not None else None
    result = {"schema": SCHEMA, "operation_id": OPERATION,
              "native_operation_id": plan["native_operation_id"],
              "state": "COMPLETED" if code == 0 and wrapper_error is None else "FAILED",
              "exit_code": code, "started_at": started, "ended_at": time.time(),
              "source_id": SOURCE_ID, "candidate": CANDIDATE,
              "engine_sha256": ENGINE_SHA, "wrapper_git_blob": WRAPPER_BLOB,
              "admission": plan["observed_admission"],
              "stdout": tail(stdout_path), "stderr": tail(stderr_path),
              "allocation": allocation(root)}
    if wrapper_error is not None:
        result["foreground_error"] = wrapper_error
    if _stop_signal is not None:
        result["stop_signal"] = _stop_signal
    if stdout_path.stat().st_size <= MAX_RESULT:
        try:
            value = json.loads(stdout_path.read_bytes())
            result["producer"] = value
            if isinstance(value, dict) and value.get("state") == "FAILED":
                try:
                    result["engine_diagnostics"] = attempt_diagnostics(root, value)
                except (OSError, ValueError, KeyError, TypeError) as error:
                    result["engine_diagnostics_error"] = str(error)
            if code == 0:
                need(value.get("state") == "COMPLETED" and value.get("candidate") == CANDIDATE and
                     value.get("source", {}).get("id") == SOURCE_ID,
                     "original_producer_identity_differs")
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            result.update(state="FAILED", result_error=str(error))
    else:
        result.update(state="FAILED", result_error="producer_result_exceeds_supported_size")
    # Preserve the compact observed outcome before any archive or network step.
    try:
        write(control / "producer-result.json", result)
    except OSError as error:
        result["shared_result_error"] = {"type": type(error).__name__, "message": str(error)}
        print(json.dumps({"schema": SCHEMA, "operation_id": OPERATION,
                          "state": "FAILED", "stage": "retain-compact-producer-result",
                          "producer_state": result["state"], "exit_code": code,
                          "error_type": type(error).__name__, "error": str(error)}),
              file=sys.stderr, flush=True)
    write(root / "producer-result.json", result)
    return result


def retained_logs(root, result):
    selected = [root / "producer-result.json", root / "producer.stdout", root / "producer.stderr"]
    selected += sorted((root / "runtime" / "logs").glob("*"))
    selected += sorted(root.glob("attempt-*/*.json"))
    selected += sorted(root.glob("attempt-*/*.stderr"))
    files = []
    for path in selected:
        if path.is_file() and not path.is_symlink():
            files.append({"path": path.relative_to(root).as_posix(),
                          "bytes": path.stat().st_size, "sha256": checksum(path)})
    manifest = {"schema": "stellar-forge.public-cohort-diagnostics.v1",
                "operation_id": OPERATION, "state": result["state"], "files": files}
    target = root / "public-cohort-diagnostics.zip"
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in files:
            archive.write(root / item["path"], item["path"])
        archive.writestr("MANIFEST.json", encode(manifest))
    with target.open("rb") as body:
        os.fsync(body.fileno())
    directory_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return target


def save_outputs(plan, root, control, result, diagnostics):
    bridge = plan["library"]
    session = regular(bridge["session"])
    need(checksum(session) == SESSION_SHA, "original_library_bridge_changed")
    helpers = Path(bridge["helpers"])
    need(helpers.is_absolute(), "absolute_library_helper_directory_required")
    for name, expected in HELPERS.items():
        need(checksum(regular(helpers / name)) == expected, "original_library_helper_changed")
    sys.path.insert(0, str(helpers))
    from library_upload import LibraryUploadWorkflow, LibraryFileMaterializer, SignedUrlUploader
    from library_hosted_apps import HostedAppsToolError
    spec = importlib.util.spec_from_file_location("scf_public_connected_library", session)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    uploads = []
    if result["state"] == "COMPLETED":
        bundle = result["producer"]["bundle"]
        archive = regular(bundle["path"])
        need(archive.resolve().is_relative_to(root), "original_cohort_outside_operation")
        need(archive.stat().st_size == bundle["bytes"] and checksum(archive) == bundle["sha256"],
             "original_cohort_publication_changed")
        uploads.append({"local_path": str(archive), "purpose": "create_library_file",
                        "library_artifact_type": "other"})
    uploads.append({"local_path": str(diagnostics), "purpose": "create_library_file",
                    "library_artifact_type": "other"})
    write(control / "progress.json", {"schema": SCHEMA, "operation_id": OPERATION,
          "state": "RUNNING", "stage": "retaining-original-public-output",
          "files": [{"path": x["local_path"], "bytes": Path(x["local_path"]).stat().st_size,
                     "sha256": checksum(x["local_path"])} for x in uploads]})
    workflow = LibraryUploadWorkflow(
        apps_client=module.ConnectedLibraryApp(control, HostedAppsToolError),
        materializer=LibraryFileMaterializer(), uploader=SignedUrlUploader(),
        state_parent=root / "library-state")
    response = workflow.run({"uploads": uploads})
    rows = response.get("results") if isinstance(response, dict) else None
    need(isinstance(rows, list) and len(rows) == len(uploads),
         "original_library_output_count_differs")
    need({row.get("local_path") for row in rows} == {item["local_path"] for item in uploads},
         "original_library_output_paths_differ")
    need(all(row.get("status") == "succeeded" and row.get("library_file_id") and row.get("file_id")
             for row in rows), "original_library_output_not_saved")
    return response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    args = parser.parse_args()
    plan_file = regular(args.plan)
    need(plan_file.stat().st_size <= 128 * 1024, "public_plan_too_large")
    plan = json.loads(plan_file.read_bytes())
    need(plan.get("schema") == "stellar-forge.public-cohort-plan.v1" and
         plan.get("operation_id") == OPERATION, "select_original_public_producer")
    need(isinstance(plan.get("native_operation_id"), str) and plan["native_operation_id"],
         "native_operation_identity_required")
    limits = plan.get("limits", {})
    need(type(limits.get("disk_bytes")) is int and limits["disk_bytes"] > 0 and
         type(limits.get("reserve_bytes")) is int and limits["reserve_bytes"] >= 0,
         "original_disk_limit_and_reserve_required")
    root = private(plan["directory"], create=True)
    control = private(plan["control"])
    need(root != control and not control.is_relative_to(root), "retain_controls_outside_private_mount")
    engine, wrapper = regular(plan["engine"]), regular(plan["wrapper"])
    need(checksum(engine) == ENGINE_SHA, "published_engine_changed")
    body = wrapper.read_bytes()
    need(hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest() == WRAPPER_BLOB,
         "published_producer_wrapper_changed")
    source = Path(plan["source"]["directory"])
    need(source.is_absolute() and source.is_dir() and not source.is_symlink(), "original_source_required")
    need(plan["source"].get("id") == SOURCE_ID, "source_identity_changed")
    need(len(plan["source"]["files"]) == 40, "complete_original_source_selection_required")
    need(len({item["path"] for item in plan["source"]["files"]}) == 40,
         "duplicate_original_source_member")
    for item in plan["source"]["files"]:
        relative = Path(item["path"])
        need(not relative.is_absolute() and ".." not in relative.parts and "." not in relative.parts,
             "invalid_original_source_member")
        path = regular(source / relative)
        need(path.stat().st_size == item["bytes"] and checksum(path) == item["sha256"],
             "original_source_member_changed")
    request_path = regular(plan["capacity_request"])
    request = json.loads(request_path.read_bytes())["intent"]
    need(request["operation_id"] == plan["native_operation_id"],
         "original_admission_identity_changed")
    selected = [row for row in request["disk"]["paths"]
                if Path(row["path"]).resolve() == root]
    need(len(selected) == 1 and selected[0]["bytes"] == limits["disk_bytes"] and
         request["disk"]["reserve_bytes"] == limits["reserve_bytes"],
         "original_disk_declaration_changed")
    plan["observed_admission"] = {
        "request_sha256": checksum(request_path),
        "disk_path": selected[0],
        "disk_reserve_bytes": request["disk"]["reserve_bytes"],
        "disk_reserve_inodes": request["disk"]["reserve_inodes"],
        "memory_peak_bytes": request["memory"]["peak_bytes"],
        "memory_reserve_bytes": request["memory"]["reserve_bytes"],
    }
    lock = os.open(control / "producer.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(not (control / "custody.json").exists(), "original_public_output_already_retained")
        for name in (signal.SIGINT, signal.SIGTERM):
            signal.signal(name, process_signal)
        result = run_wrapper(plan, root, control, lock)
        diagnostics = retained_logs(root, result)
        try:
            custody = save_outputs(plan, root, control, result, diagnostics)
        except Exception as error:
            write(control / "custody-error.json", {"schema": SCHEMA, "operation_id": OPERATION,
                  "error_type": type(error).__name__, "error": str(error),
                  "producer_state": result["state"], "observed_at": time.time()})
            raise
        value = {"schema": SCHEMA, "operation_id": OPERATION,
                 "native_operation_id": plan["native_operation_id"],
                 "producer_state": result["state"], "producer_exit_code": result["exit_code"],
                 "source_id": SOURCE_ID, "candidate": CANDIDATE,
                 "diagnostics": {"sha256": checksum(diagnostics), "bytes": diagnostics.stat().st_size},
                 "allocation": allocation(root), "saved": custody}
        write(control / "custody.json", value)
        print(json.dumps({"schema": SCHEMA, "operation_id": OPERATION,
                          "native_operation_id": plan["native_operation_id"],
                          "state": "SAVED", "producer_state": result["state"],
                          "producer_exit_code": result["exit_code"],
                          "source_id": SOURCE_ID, "candidate": CANDIDATE,
                          "custody_path": str(control / "custody.json"),
                          "producer_result_path": str(control / "producer-result.json"),
                          "diagnostics": value["diagnostics"],
                          "saved_files": [{key: row[key] for key in
                              ("status", "library_file_id", "file_id", "file_name", "file_size_bytes")
                              if key in row} for row in custody["results"]]}, sort_keys=True), flush=True)
        return 0 if result["state"] == "COMPLETED" else 1
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"schema": SCHEMA, "operation_id": OPERATION, "state": "FAILED",
                          "error_type": type(error).__name__, "error": str(error)}),
              file=sys.stderr, flush=True)
        raise SystemExit(1)
