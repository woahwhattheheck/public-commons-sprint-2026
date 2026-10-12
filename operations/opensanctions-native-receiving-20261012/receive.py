#!/usr/bin/env python3
"""Receive the original OpenSanctions project through an existing Commons worker."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import urllib.request

OPERATION = "DCE4-OPENSANCTIONS-NATIVE-20261012"
SCHEMA = "starforge.opensanctions.equipped-receiving.v1"
INPUT_BYTES = 7700640
INPUT_SHA256 = "2773214cb71964dfd0059b144164df276a138a9c43a1d81b75766ee0c048097f"
SOURCE_REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
SOURCE_COMMIT = "4d4c9c32988e085607c870a1a37e1092f183fc2d"
SOURCE_ROOT = "stellar/scf-starforge-20261009/sf30-seller-sdk"
PACKAGE = Path(__file__).resolve().parent


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def emit(value):
    print(json.dumps(value, ensure_ascii=False, default=str), flush=True)


def file_hash(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with Path(path).open("rb") as stream:
        while block := stream.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()


def regular(path):
    path = Path(path).expanduser()
    if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("Select a regular retained file: " + str(path))
    return path.resolve(strict=True)


def directory(path, *, create=False):
    path = Path(path).expanduser()
    if path.is_symlink():
        raise ValueError("Select the original directory, rather than a symlink: " + str(path))
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = path.resolve(strict=True)
    if not path.is_dir():
        raise ValueError("Select a directory: " + str(path))
    return path


def identity(path):
    path = regular(path)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_hash(path)}


def verify_identity(item):
    actual = identity(item["path"])
    if actual != item:
        raise ValueError("The selected original file changed: " + item["path"])
    return actual


def retain_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink():
        target = regular(path)
        if target.read_bytes() != data:
            raise ValueError("Retained destination already contains different bytes: " + str(path))
        return identity(target)
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", suffix=".pending", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
        with contextlib.suppress(OSError):
            parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp)
    return identity(path)


def retain_file(source, destination, expected_bytes=None, expected_sha=None):
    source = regular(source)
    actual = identity(source)
    if expected_bytes is not None and actual["bytes"] != expected_bytes:
        raise ValueError("Original input byte count differs: " + str(source))
    if expected_sha is not None and actual["sha256"] != expected_sha:
        raise ValueError("Original input digest differs: " + str(source))
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        retained = identity(destination)
        if retained["bytes"] != actual["bytes"] or retained["sha256"] != actual["sha256"]:
            raise ValueError("The retained input is different: " + str(destination))
        return retained
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(prefix=destination.name + ".", suffix=".pending", dir=destination.parent)
    try:
        h = hashlib.sha256()
        count = 0
        with source.open("rb") as incoming, os.fdopen(fd, "wb") as out:
            while block := incoming.read(1024 * 1024):
                count += len(block)
                h.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if count != actual["bytes"] or h.hexdigest() != actual["sha256"]:
            raise ValueError("The original input changed during receiving")
        os.replace(temp, destination)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp)
    return identity(destination)


def source_manifest():
    path = regular(PACKAGE / "SOURCE_CLOSURE.json")
    value = json.loads(path.read_bytes())
    if (value.get("schema") != "starforge.opensanctions.native-source-closure.v1"
            or value.get("repository") != SOURCE_REPOSITORY
            or value.get("sourceCommit") != SOURCE_COMMIT
            or value.get("sourceRoot") != SOURCE_ROOT):
        raise ValueError("The selected merged source closure differs")
    seen = set()
    for row in value["files"]:
        relative = PurePosixPath(row["path"])
        if (relative.is_absolute() or ".." in relative.parts or str(relative) != row["path"]
                or row["path"] in seen or not re.fullmatch("[0-9a-f]{40}", row["gitBlob"])
                or type(row["bytes"]) is not int or row["bytes"] < 0):
            raise ValueError("Invalid original source member")
        seen.add(row["path"])
    if len(seen) != 29 or sum(row["bytes"] for row in value["files"]) != 386406:
        raise ValueError("The complete selected source population differs")
    return value


def source_blob(data):
    return hashlib.sha1(("blob " + str(len(data)) + "\0").encode() + data).hexdigest()


def materialize_source(root, manifest, existing=None):
    root = Path(root)
    original = directory(existing) if existing else None
    inventory = []
    for row in manifest["files"]:
        target = root / row["path"]
        if target.exists():
            data = regular(target).read_bytes()
            origin = "retained"
        elif original is not None:
            data = regular(original / row["path"]).read_bytes()
            origin = str(original / row["path"])
        else:
            url = ("https://raw.githubusercontent.com/" + manifest["repository"] + "/"
                   + manifest["sourceCommit"] + "/" + manifest["sourceRoot"] + "/" + row["path"])
            request = urllib.request.Request(url, headers={"User-Agent": "Starforge source receiving/1.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                if response.status != 200:
                    raise ValueError("Original source HTTP " + str(response.status))
                data = response.read(row["bytes"] + 1)
            origin = url
        if len(data) != row["bytes"] or source_blob(data) != row["gitBlob"]:
            raise ValueError("Original source member differs: " + row["path"])
        saved = retain_bytes(target, data)
        inventory.append({**row, **saved})
        emit({"step": "source_received", "file": row["path"], "gitBlob": row["gitBlob"],
              "bytes": row["bytes"], "origin": origin})
    return inventory


def executable(path):
    candidate = regular(Path(path).expanduser().resolve(strict=True))
    if not os.access(candidate, os.X_OK):
        raise ValueError("Selected runtime is not executable: " + str(candidate))
    return candidate


def runtime_versions(python, node):
    python_code = "import json,platform,sys;print(json.dumps({'version':list(sys.version_info[:3]),'executable':sys.executable,'system':platform.system(),'machine':platform.machine()}))"
    result = subprocess.run([str(python), "-c", python_code], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError("Selected Python failed: " + result.stderr[-2000:])
    selected = json.loads(result.stdout)
    if not (3, 11) <= tuple(selected["version"][:2]) <= (3, 14):
        raise ValueError("The original yente release needs Python 3.11 through 3.14")
    if selected["system"] != "Linux" or selected["machine"] not in ("x86_64", "amd64"):
        raise ValueError("Select Linux x86-64 for the pinned OpenSearch core distribution")
    result = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError("Selected Node failed: " + result.stderr[-2000:])
    match = re.fullmatch(r"v(\d+)\.\d+\.\d+\s*", result.stdout)
    if match is None or int(match.group(1)) < 22:
        raise ValueError("Select the installed Node 22 or later for this original source receiver")
    return {"python": selected, "node": result.stdout.strip()}


def host_inventory(host):
    return [{"relative": path.relative_to(host).as_posix(), **identity(path)}
            for path in sorted(host.glob("*.py")) if path.is_file()]


def load_controller(host):
    host = directory(host)
    sys.path.insert(0, str(host))
    foreground = importlib.import_module("native_foreground")
    if Path(foreground.__file__).resolve() != (host / "native_foreground.py").resolve():
        raise ValueError("A different native foreground module is already imported")
    native = foreground.load_native(host)
    if getattr(native, "NATIVE_LAUNCH_SCHEMA", None) != "commons.native-supervisor-launch/v1":
        raise ValueError("Select the maintained foreground-launch controller source")
    return native, foreground


def selected_account(name):
    if os.geteuid() != 0:
        if name and name != pwd.getpwuid(os.geteuid()).pw_name:
            raise ValueError("This worker runs OpenSearch under its current nonroot account")
        return None
    if not name:
        raise ValueError("Supply --search-user with the existing nonroot account on this worker")
    account = pwd.getpwnam(name)
    if account.pw_uid == 0 or not shutil.which("runuser"):
        raise ValueError("Select an existing nonroot account and native runuser launcher")
    return account.pw_name


def prepare(args):
    os.umask(0o077)
    root = directory(args.directory, create=True)
    descriptor = os.open(root / ".prepare-lock", os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = {"schema": SCHEMA, "operation": OPERATION, "directory": str(root)}
        retain_bytes(root / "operation.json", canonical(marker))
        host = directory(args.commons_host)
        state = directory(args.shared_state_root)
        memory = directory(args.memory_ledger)
        disk = directory(args.disk_ledger)
        python = executable(args.python or sys.executable)
        node = executable(args.node)
        versions = runtime_versions(python, node)
        search_user = selected_account(args.search_user)
        native, _ = load_controller(host)
        for expected in ("start", "inspect", "run_path", "resume_capacity", "stop"):
            if not callable(getattr(native, expected, None)):
                raise ValueError("The maintained controller is missing " + expected)
        manifest = source_manifest()
        copied_input = retain_file(args.input, root / "inbox/OpenSanctions_Receiving_Workspace.zip",
                                   INPUT_BYTES, INPUT_SHA256)
        copied_receiver = retain_file(PACKAGE / "native-receiver.py", root / "inbox/native-receiver.py")
        retain_bytes(root / "inbox/SOURCE_CLOSURE.json", canonical(manifest))
        files = materialize_source(root / "source", manifest, existing=args.source_root)
        selected = {
            **marker, "sourceCommit": SOURCE_COMMIT, "input": copied_input,
            "receiver": copied_receiver, "sourceFiles": files,
            "sourceManifest": identity(root / "inbox/SOURCE_CLOSURE.json"),
            "host": str(host), "hostSource": host_inventory(host),
            "python": identity(python), "node": identity(node), "versions": versions,
            "sharedStateRoot": str(state), "memoryLedger": str(memory), "diskLedger": str(disk),
            "recordsRoot": str(Path(args.records_root).expanduser().resolve()) if args.records_root
                           else str(root / "control/records"),
            "runtimeConsumersRoot": str(directory(args.runtime_consumers_root))
                                     if args.runtime_consumers_root else None,
            "searchUser": search_user,
            "searchArchive": identity(args.search_archive) if args.search_archive else None,
            "yenteBin": identity(executable(args.yente_bin)) if args.yente_bin else None,
            "privateDevelopmentPackages": bool(args.allow_private_development_packages),
            "memoryMib": args.memory_mib, "memoryReserveMib": 256,
            "memoryReclaim": args.memory_reclaim, "memoryStorage": "included",
            "diskSpace": ([str(root) + "=1792", "/tmp=1280"] if search_user
                          else [str(root) + "=3072"]),
            "diskInodes": ([str(root) + "=16000", "/tmp=8000"] if search_user
                           else [str(root) + "=24000"]),
            "diskReserveMib": 128, "diskReserveInodes": 512,
        }
        retain_bytes(root / "runtime-selection.json", canonical(selected))
        operation = directory(root / "operation", create=True)
        emit({"schema": SCHEMA, "state": "SOURCE_READY", "operation": OPERATION,
              "directory": str(root), "selection": identity(root / "runtime-selection.json"),
              "source": {"commit": SOURCE_COMMIT, "files": len(files),
                         "bytes": sum(row["bytes"] for row in files)},
              "input": copied_input, "versions": versions,
              "nativeRecord": str(native.run_path(OPERATION, selected["recordsRoot"])),
              "originalCase": "64e5904305d833550e4fcc96ae941879ca028fd07c4740ad9075fc3ef36837fb"})
    return 0


def selection(root, *, verify=True):
    root = directory(root)
    path = regular(root / "runtime-selection.json")
    selected = json.loads(path.read_bytes())
    if (selected.get("schema") != SCHEMA or selected.get("operation") != OPERATION
            or selected.get("directory") != str(root) or selected.get("sourceCommit") != SOURCE_COMMIT):
        raise ValueError("The retained native operation selection differs")
    if verify:
        for key in ("input", "receiver", "sourceManifest", "python", "node"):
            verify_identity(selected[key])
        for key in ("searchArchive", "yenteBin"):
            if selected.get(key):
                verify_identity(selected[key])
        for row in selected["sourceFiles"]:
            verify_identity({key: row[key] for key in ("path", "bytes", "sha256")})
        if host_inventory(Path(selected["host"])) != selected["hostSource"]:
            raise ValueError("The selected controller source changed; reconcile its original runtime handover")
    os.environ["SWARM_STATE_ROOT"] = selected["sharedStateRoot"]
    os.environ["SWARM_MEMORY_RESERVATIONS_ROOT"] = selected["memoryLedger"]
    os.environ["SWARM_DISK_RESERVATIONS_ROOT"] = selected["diskLedger"]
    return root, selected


def native_args(root, selected):
    operation = root / "operation"
    command = [selected["python"]["path"], "-B", selected["receiver"]["path"],
               "--directory", str(operation), "--source", str(root / "source"),
               "--application-directory", str(root / "source/ndjson/opensanctions"),
               "--input", selected["input"]["path"], "--node", selected["node"]["path"]]
    if selected["searchUser"]:
        command += ["--search-user", selected["searchUser"]]
    if selected["searchArchive"]:
        command += ["--search-archive", selected["searchArchive"]["path"]]
    if selected["yenteBin"]:
        command += ["--yente-bin", selected["yenteBin"]["path"]]
    if selected["privateDevelopmentPackages"]:
        command += ["--allow-private-development-packages"]
    runtime_paths = [selected["host"], str(root / "source"), str(root / "inbox"),
                     selected["python"]["path"], selected["node"]["path"]]
    if selected["searchArchive"]:
        runtime_paths.append(selected["searchArchive"]["path"])
    if selected["yenteBin"]:
        runtime_paths.append(str(Path(selected["yenteBin"]["path"]).parent.parent))
    return SimpleNamespace(
        peer="dce4-opensanctions-native", operation_id=OPERATION, project=str(operation),
        java=None, node=None, command=command,
        artifact=["results/run-result.json", "results/run-artifacts.json", "results/native-return.tar.gz"],
        artifact_on_success=[], artifact_on_failure=[], retain_artifacts=True,
        runtime_path=runtime_paths, runtime_consumers_root=selected["runtimeConsumersRoot"],
        memory_mib=selected["memoryMib"], memory_reserve_mib=selected["memoryReserveMib"],
        memory_reclaim=selected["memoryReclaim"], memory_storage=selected["memoryStorage"],
        memory_reservations_root=selected["memoryLedger"],
        disk_space=selected["diskSpace"], disk_inodes=selected["diskInodes"],
        disk_reserve_mib=selected["diskReserveMib"], disk_reserve_inodes=selected["diskReserveInodes"],
        disk_reservations_root=selected["diskLedger"], records_root=selected["recordsRoot"],
        worker_root=str(root / "control/worker"), temp_root=str(operation / "tmp"))


def native_view(native, report):
    if callable(getattr(native, "report_value", None)):
        return native.report_value(report, "summary")
    return {key: report.get(key) for key in (
        "ok", "operation_id", "state", "record", "exit_code", "process", "supervisor",
        "memory", "disk", "reused", "failure", "stop_requested", "stop_state")}


def start(args):
    root, selected = selection(args.directory)
    native, foreground = load_controller(selected["host"])
    launch = foreground.ForegroundLaunch(native)
    try:
        report = native.start(native_args(root, selected), launcher=launch)
        emit(native_view(native, report))
    finally:
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                raise SystemExit(code)
    return 0


def status(args):
    root, selected = selection(args.directory, verify=False)
    native, _ = load_controller(selected["host"])
    record = native.run_path(OPERATION, selected["recordsRoot"])
    if not record.is_dir():
        emit({"operation": OPERATION, "state": "SOURCE_READY", "nativeRecord": str(record),
              "selection": identity(root / "runtime-selection.json")})
        return 0
    report = native.inspect(record, capacity=True)
    emit(native_view(native, report))
    return 0


def resume(args):
    root, selected = selection(args.directory)
    native, foreground = load_controller(selected["host"])
    report = foreground.resume_foreground(
        native, OPERATION, selected["recordsRoot"], action="resume-capacity",
        recover_failure=args.recover_failure, report_format="summary")
    emit(native_view(native, report))
    return 0


def stop(args):
    root, selected = selection(args.directory, verify=False)
    native, _ = load_controller(selected["host"])
    record = native.run_path(OPERATION, selected["recordsRoot"])
    if not record.is_dir():
        raise ValueError("This original native operation has no execution record")
    current = native.inspect(record)
    supervisor = current.get("supervisor")
    if args.expected_supervisor:
        supervisor = json.loads(regular(args.expected_supervisor).read_bytes())
    report = native.stop(record, expected_supervisor=supervisor)
    emit(native_view(native, report))
    return 0


def collect(args):
    root, selected = selection(args.directory, verify=False)
    native, _ = load_controller(selected["host"])
    record = native.run_path(OPERATION, selected["recordsRoot"])
    report = native.inspect(record, capacity=True)
    result_root = root / "operation/results"
    manifest_path = regular(result_root / "run-artifacts.json")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("schema") != "starforge.native-artifacts.v1" or manifest.get("operation") != OPERATION:
        raise ValueError("The original native output manifest differs")
    files = []
    for row in manifest["files"]:
        relative = PurePosixPath(row["file"])
        if relative.is_absolute() or len(relative.parts) != 1 or relative.name in (".", ".."):
            raise ValueError("Unexpected native result member path")
        actual = identity(result_root / row["file"])
        if actual["bytes"] != row["bytes"] or actual["sha256"] != row["sha256"]:
            raise ValueError("An original native result changed: " + row["file"])
        files.append(actual)
    result = json.loads(regular(result_root / "run-result.json").read_bytes())
    if result.get("operation") != OPERATION or result.get("inputSha256") != INPUT_SHA256:
        raise ValueError("The original native result identifies another operation")
    output = identity(result_root / "native-return.tar.gz")
    receipt = {
        "schema": "starforge.opensanctions.native-return.v1", "operation": OPERATION,
        "native": native_view(native, report), "domainStatus": result["status"],
        "originalInput": selected["input"], "sourceCommit": SOURCE_COMMIT,
        "result": identity(result_root / "run-result.json"), "manifest": identity(manifest_path),
        "archive": output, "files": files, "processesClosedAt": result.get("processesClosedAt")}
    if args.return_directory:
        destination = directory(args.return_directory, create=True)
        # Receiving is immutable: the operation identity and archive digest name this selected return.
        name = "OpenSanctions_Native_Return_" + output["sha256"][:16] + ".tar.gz"
        receipt["retainedArchive"] = retain_file(output["path"], destination / name,
                                               output["bytes"], output["sha256"])
        fixed_receipt = {key: value for key, value in receipt.items() if key != "native"}
        retain_bytes(destination / (name + ".json"), canonical(fixed_receipt))
    emit(receipt)
    complete = (result["status"] == "NATIVE_RECEIVING_COMPLETE" and report.get("exit_code") == 0)
    return 0 if complete else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("prepare", help="Retain exact source and select this existing worker")
    p.add_argument("--directory", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--commons-host", required=True)
    p.add_argument("--shared-state-root", required=True)
    p.add_argument("--memory-ledger", required=True)
    p.add_argument("--disk-ledger", required=True)
    p.add_argument("--records-root")
    p.add_argument("--runtime-consumers-root")
    p.add_argument("--python")
    p.add_argument("--node", required=True)
    p.add_argument("--source-root", help="Existing exact merged sf30-seller-sdk directory, read only")
    p.add_argument("--search-user", help="Existing nonroot account when the selected worker is root")
    p.add_argument("--search-archive", help="Existing exact publisher OpenSearch core TAR, read only")
    p.add_argument("--yente-bin", help="Existing original yente5.5 installation, read only")
    p.add_argument("--allow-private-development-packages", action="store_true")
    p.add_argument("--memory-mib", type=int, default=1536)
    p.add_argument("--memory-reclaim", choices=("none", "clean-cache"), default="clean-cache")
    p.set_defaults(handler=prepare)
    for name, handler in (("start", start), ("status", status), ("resume", resume),
                          ("stop", stop), ("collect", collect)):
        p = sub.add_parser(name)
        p.add_argument("--directory", required=True)
        if name == "resume":
            p.add_argument("--recover-failure", help="Exact original pre-dispatch failure SHA from native status")
        if name == "stop":
            p.add_argument("--expected-supervisor", help="Retained original supervisor identity JSON")
        if name == "collect":
            p.add_argument("--return-directory", help="Selected persistent destination for the complete native return")
        p.set_defaults(handler=handler)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        emit({"schema": SCHEMA, "operation": OPERATION, "action": args.action,
              "error": {"type": type(error).__name__, "message": str(error)}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
