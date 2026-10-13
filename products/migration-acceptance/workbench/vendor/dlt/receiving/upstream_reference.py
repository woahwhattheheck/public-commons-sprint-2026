#!/usr/bin/env python3
"""Join the unchanged upstream staged reference to the installed application runtime."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tarfile

SOURCE_COMMIT = "2360d229c77f7f64692acc31a4555f4cfcd50ed3"
OPERATION = "DLTHUB-PIPELINE-MIGRATION-0C7A-20261013"

def require(value, message):
    if not value:
        raise ValueError(message)

def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def identity(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Retain a regular original file: " + str(path))
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return {"bytes": path.stat().st_size, "sha256": value.hexdigest()}

def verify(path, selected):
    actual = identity(path)
    require(actual["bytes"] == selected["bytes"] and actual["sha256"] == selected["sha256"],
            "Original retained file changed: " + str(path))
    return actual

def lease_descriptors(job, ready_path):
    """Find only the two actual inherited original runtime/operation leases."""
    operation = job / "lifetime.lock"
    runtime = ready_path.parent / ".runtime.lease"
    inherited = os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_FD", "")
    require(inherited.isdigit() and int(inherited) >= 3, "Use the existing native runtime wrapper")
    require(os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_PATH") == str(operation),
            "The original runtime operation selects another directory")
    selected = {}
    for path in (operation, runtime):
        value = path.stat(follow_symlinks=False)
        require(stat.S_ISREG(value.st_mode), "Select the original regular runtime lease")
        selected[(value.st_dev, value.st_ino)] = path
    matches = {}
    for entry in Path("/proc/self/fd").iterdir():
        if not entry.name.isdigit() or int(entry.name) < 3:
            continue
        fd = int(entry.name)
        try:
            info = os.fstat(fd)
        except OSError:
            continue
        key = (info.st_dev, info.st_ino)
        if key in selected and stat.S_ISREG(info.st_mode):
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            matches.setdefault(selected[key], fd)
    require(set(matches) == {operation, runtime}, "Retain both inherited native lifetime leases")
    own = os.fstat(int(inherited))
    expected = operation.stat(follow_symlinks=False)
    require((own.st_dev, own.st_ino) == (expected.st_dev, expected.st_ino),
            "The inherited operation descriptor changed")
    return tuple(sorted(set(matches.values())))

def verify_archive(archive, receipt):
    verify(archive, receipt)
    expected = {member["path"]: member for member in receipt["members"]}
    require(len(expected) == len(receipt["members"]), "Original archive has duplicate member identities")
    observed = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            require(member.isfile() and member.name in expected and member.name not in observed,
                    "Original archive member selection differs")
            require(member.size == expected[member.name]["bytes"], "Original archive member size differs")
            stream = source.extractfile(member)
            require(stream is not None, "Original archive member cannot be read")
            value = hashlib.sha256()
            with stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    value.update(block)
            require(value.hexdigest() == expected[member.name]["sha256"], "Original archive member bytes differ")
            observed.add(member.name)
    require(observed == set(expected), "Complete original archive members are required")

def reference_lock(root):
    require(not root.is_symlink(), "Keep the original reference in this owned operation")
    root.mkdir(parents=True, exist_ok=True)
    path = root / ".reference.lock"
    require(not path.is_symlink(), "Retain the original regular reference lock")
    lock = path.open("a+b")
    try:
        require(stat.S_ISREG(os.fstat(lock.fileno()).st_mode), "Retain the original regular reference lock")
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        lock.close()
        raise
    return lock

def archive_matches_current(root, operation_path, archive, receipt_path):
    if not all(path.is_file() for path in (operation_path, archive, receipt_path)):
        return False
    state, receipt = read(operation_path), read(receipt_path)
    if state.get("state") != "complete":
        return False
    expected = {item["path"]: item for item in receipt["members"]}
    for name in ("operation.json", "index.html", state["destination_export"]["manifest"]):
        path = root / name
        if not path.is_file() or name not in expected:
            return False
        actual = identity(path)
        if any(actual[key] != expected[name][key] for key in ("bytes", "sha256")):
            return False
    return True

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--runtime-ready", type=Path, required=True)
    parser.add_argument("--companion", type=Path,
                        default=Path(__file__).resolve().parents[1] / "upstream_contracts")
    args = parser.parse_args()
    os.umask(0o077)
    job = args.directory.expanduser().resolve()
    ready_path = args.runtime_ready.expanduser().resolve()
    companion = args.companion.expanduser().resolve()
    require(job.is_dir() and not job.is_symlink(), "Use the existing prepared native job directory")
    ready = read(ready_path)
    require(ready.get("schema") == "dlt-workshare.runtime-ready.v1" and ready.get("state") == "ready",
            "Select the original installed runtime receipt")
    require(ready.get("sourceCommit") == SOURCE_COMMIT and ready.get("version") == "1.31.0",
            "Select the pinned original dlt engine")
    require(os.path.abspath(sys.executable) == os.path.abspath(ready["python"]["executable"]),
            "Use the selected interpreter invocation")
    inherited = lease_descriptors(job, ready_path)
    runner = companion / "run_original_staged_reference.py"
    specification = importlib.util.spec_from_file_location("original_dlt_staged_receiver", runner)
    require(specification and specification.loader, "Load the retained staged reference receiver")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    require(module.UPSTREAM_COMMIT == SOURCE_COMMIT and module.OPERATION_ID == OPERATION,
            "Retain the original selected reference")
    root = job / "original-reference"
    require(not root.is_symlink(), "Keep the original reference in this owned operation")
    operation_path = root / "operation.json"
    archive = root.with_name(root.name + "-complete.tar.gz")
    receipt_path = archive.with_suffix(archive.suffix + ".json")
    lock = reference_lock(root)
    try:
        if not archive_matches_current(root, operation_path, archive, receipt_path):
            lock.close()
            lock = None
            original_argv = sys.argv
            try:
                sys.argv = [str(runner), "--operation", str(root), "--companion", str(companion)]
                code = module.main(inherited_fds=inherited)
            finally:
                sys.argv = original_argv
            require(code == 0, "The unchanged original reference needs its retained native recovery")
            lock = reference_lock(root)
        require(archive_matches_current(root, operation_path, archive, receipt_path),
                "Retain the same complete original operation, report and archive edition")
        state, receipt = read(operation_path), read(receipt_path)
        require(state.get("state") == "complete" and state.get("operation_id") == OPERATION
                and state.get("upstream_commit") == SOURCE_COMMIT, "Receive the original complete native reference")
        require(receipt.get("operation_id") == OPERATION, "Original archive belongs to another operation")
        verify_archive(archive, receipt)
        check = state["destination_export"]["original_input"]
        require(check["source_issue_count"] == 100 and check["destination_issue_count"] == 100
                and check["original_issue_identity_matches"] is True, "Receive all 100 original issue identities")
        require(not state.get("failed_jobs") and not state.get("pending_transitions")
                and not state["native_queues"]["extracted"] and not state["native_queues"]["normalized"],
                "Preserve original unresolved native packages")
        result = {
            "schema": "dlthub.original-staged-reference-result.v1", "operation": OPERATION,
            "runtimeId": ready["runtimeId"], "sourceCommit": SOURCE_COMMIT,
            "pipelineName": state["pipeline_name"], "datasetName": state["dataset_name"],
            "completedAt": state["completed_at"], "sourceIssues": 100, "destinationIssues": 100,
            "loadIds": state["native_queues"]["completed"],
            "files": [
                {"kind": "complete_original_archive", "path": archive.relative_to(job).as_posix(), **identity(archive)},
                {"kind": "archive_manifest", "path": receipt_path.relative_to(job).as_posix(), **identity(receipt_path)},
                {"kind": "operation", "path": operation_path.relative_to(job).as_posix(), **identity(operation_path)},
                {"kind": "report", "path": (root / "index.html").relative_to(job).as_posix(), **identity(root / "index.html")},
                {"kind": "destination_manifest", "path": (root / state["destination_export"]["manifest"]).relative_to(job).as_posix(),
                 **identity(root / state["destination_export"]["manifest"])}
            ]
        }
        output = job / "original-reference-result.json"
        if output.exists():
            require(read(output) == result, "Retain the same original reference receiving result")
        else:
            module.write_json(output, result)
        print(json.dumps({"result": str(output), **identity(output), "sourceIssues": 100, "destinationIssues": 100}))
        return 0
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
