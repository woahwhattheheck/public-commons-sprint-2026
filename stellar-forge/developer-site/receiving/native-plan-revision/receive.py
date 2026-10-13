#!/usr/bin/env python3
"""Operate and preserve the original saved SCF plan-revision receiving case."""
import argparse
import fcntl
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "source-and-input.json").read_text())
OPERATION = MANIFEST["operation"]

def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def write_json(path, value):
    temp = path.with_name(path.name + ".writing")
    with temp.open("w") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)

def validate_files(root, rows):
    for row in rows:
        relative = Path(row["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid selected source path")
        path = root / relative
        if not path.is_file() or path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
            raise ValueError("The selected complete source changed: " + row["path"])

def memory():
    result = {}
    for name in ("memory.current", "memory.max", "memory.stat", "memory.events"):
        path = Path("/sys/fs/cgroup") / name
        if path.is_file():
            result[name] = path.read_text()
    return result

def archive_case(attempt, name):
    validate_files(attempt / "case", MANIFEST["input"]["files"])
    validate_files(attempt / "source", MANIFEST["source"]["files"])
    target = attempt / name
    skipped_caches = {"Cache", "Code Cache", "GPUCache", "DawnCache", "ShaderCache", "Crashpad"}
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for directory in ("case", "source", "receiving"):
            for path in sorted((attempt / directory).rglob("*")):
                relative = path.relative_to(attempt)
                if path.is_file() and not path.is_symlink() and not (
                    "profile" in relative.parts and any(part in skipped_caches for part in relative.parts)
                ):
                    archive.write(path, relative.as_posix())
    return {"path": str(target), "bytes": target.stat().st_size, "sha256": digest(target),
            "members": len(zipfile.ZipFile(target).infolist())}

def preserve(archive, args, temporary, name):
    if not args.library_helper_dir:
        return {"status": "local", "archive": archive}
    sys.path.insert(0, str(Path(args.library_helper_dir).resolve()))
    from library_upload import LibraryUploadWorkflow, SignedUrlUploader
    from library_hosted_apps import HostedAppsClient
    from library_file_transfer import LibraryFileMaterializer
    result = LibraryUploadWorkflow(
        HostedAppsClient(), LibraryFileMaterializer(), SignedUrlUploader(), state_parent=temporary
    ).run({"uploads": [{"local_path": archive["path"], "purpose": "create_library_file"}]})
    write_json(temporary.parent / (name + "-library.json"), result)
    emit({name + "_library": result})
    return result

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def receive(args):
    app = Path(args.app).resolve()
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    lock = (out / ".receiving.lock").open("a+")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    status_path = out / "operation.json"
    previous = json.loads(status_path.read_text()) if status_path.exists() else None
    if previous and previous.get("operation") != OPERATION:
        raise ValueError("Use the output directory of this original operation.")
    if args.preserve_only:
        if not previous:
            raise ValueError("There is no original attempt in this output directory.")
        attempt = Path(previous["attempt"])
        temporary = attempt / "tmp"
        temporary.mkdir(exist_ok=True)
        archive = previous.get("archive")
        if not archive:
            archive = archive_case(attempt, "SCF_Native_Plan_Revision_Recovered_Workspace.zip")
        elif digest(archive["path"]) != archive["sha256"]:
            raise ValueError("The original saved workspace changed.")
        previous["recoveredArchive"] = archive
        previous["recoveryPreservation"] = preserve(archive, args, temporary, "recovery")
        write_json(status_path, previous)
        emit({"recovered_operation": previous})
        return 0
    if previous and previous.get("status") == "COMPLETE":
        archived = previous["archive"]
        if digest(archived["path"]) != archived["sha256"]:
            raise ValueError("The saved completed workspace changed.")
        emit({"completed_operation": previous})
        return 0
    validate_files(app, MANIFEST["source"]["files"])

    attempt = out / ("attempt-" + uuid.uuid4().hex[:12])
    attempt.mkdir(mode=0o700)
    temporary = attempt / "tmp"
    temporary.mkdir()
    os.environ.update({"TMPDIR": str(temporary), "TMP": str(temporary), "TEMP": str(temporary)})
    tempfile.tempdir = str(temporary)
    case = attempt / "case"
    case.mkdir()
    if args.case_zip:
        original = Path(args.case_zip).resolve()
        expected = MANIFEST["input"]
        if original.stat().st_size != expected["bytes"] or digest(original) != expected["sha256"]:
            raise ValueError("Select the retained original complete case archive.")
        with zipfile.ZipFile(original) as archive:
            for item in archive.infolist():
                relative = Path(item.filename)
                if relative.is_absolute() or ".." in relative.parts or "\\" in item.filename:
                    raise ValueError("Unsafe member in the retained archive.")
                if item.is_dir():
                    continue
                target = case / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(item))
    else:
        original = Path(args.case_dir).resolve()
        validate_files(original, MANIFEST["input"]["files"])
        if out == original or out.is_relative_to(original):
            raise ValueError("Keep the receiving output outside its original input directory.")
        for path in sorted(original.rglob("*")):
            if path.is_file() and not path.is_symlink():
                target = case / path.relative_to(original)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
    validate_files(case, MANIFEST["input"]["files"])

    source = attempt / "source"
    source.mkdir()
    for row in MANIFEST["source"]["files"]:
        target = source / row["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(app / row["path"], target)
    receiving = attempt / "receiving"
    receiving.mkdir()
    for filename in ("operate.mjs", "receive.py", "source-and-input.json", "README.md"):
        shutil.copyfile(HERE / filename, receiving / filename)
    before = memory()
    write_json(case / "installed-source.json", MANIFEST)
    write_json(case / "memory-before.json", before)
    state = {"operation": OPERATION, "status": "PREPARED", "pid": os.getpid(),
             "host": os.uname().nodename, "attempt": str(attempt), "startedAt": time.time(),
             "priorAttempt": previous.get("attempt") if previous else None,
             "sourceCommit": MANIFEST["source"]["commit"]}
    write_json(status_path, state)
    write_json(case / "native-operation.json", state)
    checkpoint = archive_case(attempt, "SCF_Native_Plan_Revision_Before_Browser.zip")
    state["checkpoint"] = checkpoint
    try:
        state["checkpointPreservation"] = preserve(checkpoint, args, temporary, "before-browser")
    except Exception as error:
        state["checkpointPreservationError"] = str(error)
    write_json(status_path, state)
    emit({"prepared_operation": state, "memory_before": before})

    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(source / "dist"))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = "http://127.0.0.1:" + str(server.server_address[1])
    command = [args.node, str(receiving / "operate.mjs"), str(source), str(case), origin,
               str(Path(args.chrome).resolve()), str(Path(args.playwright).resolve())]
    process = None
    code = 1
    state.update(status="RUNNING", origin=origin, command=command)
    write_json(status_path, state)
    try:
        with (case / "browser-process.log").open("w") as log:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, env=os.environ.copy(), start_new_session=True)
            state["browserPid"] = process.pid
            write_json(status_path, state)
            emit({"browser_started": state})
            for line in process.stdout:
                log.write(line)
                log.flush()
                print(line, end="", flush=True)
            code = process.wait()
    except BaseException as error:
        state["processError"] = repr(error)
    finally:
        if process:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        server.shutdown()
        server.server_close()
        write_json(case / "native-memory.json", {"before": before, "after": memory()})
        observed_code = process.returncode if process else None
        write_json(case / "browser-process.json", {"returncode": observed_code, "command": command,
                                                  "receivingExitCode": code, "operation": OPERATION})
        state.update(status="COMPLETE" if code == 0 else "INTERRUPTED",
                     browserReturncode=observed_code, receivingExitCode=code, finishedAt=time.time())
        write_json(case / "native-operation.json", state)
        state["archive"] = archive_case(attempt, "SCF_Native_Plan_Revision_Operated_Workspace.zip")
        write_json(status_path, state)
        try:
            state["preservation"] = preserve(state["archive"], args, temporary, "after-browser")
        except Exception as error:
            state["preservationError"] = str(error)
        write_json(status_path, state)
        emit({"operated_workspace": state})
    return 0 if code == 0 else 1

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, help="Selected stellar-forge/developer-site source")
    original = parser.add_mutually_exclusive_group(required=True)
    original.add_argument("--case-zip", help="Exact retained complete original case ZIP")
    original.add_argument("--case-dir", help="Extracted complete original case directory")
    parser.add_argument("--output", required=True, help="Private persistent directory for this operation")
    parser.add_argument("--chrome", required=True, help="Existing Chromium executable")
    parser.add_argument("--playwright", required=True, help="Existing Playwright index.mjs")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
    parser.add_argument("--library-helper-dir", help="Existing directory containing the three Library helpers")
    parser.add_argument("--preserve-only", action="store_true", help="Save an existing attempt without running Chromium")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    try:
        return receive(args)
    except BlockingIOError:
        emit({"operation": OPERATION, "status": "ALREADY_RUNNING", "output": args.output})
        return 3

if __name__ == "__main__":
    sys.exit(main())
