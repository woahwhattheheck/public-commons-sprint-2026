"""Receive the first original Gura case through the maintained application.

This is the original GURA-NATIVE-01 operation: acquire the two immutable release
archives, prepare the native source case, capture its scientific setup, execute
the maintained native workflow, and return its original saved result records.
It calls existing application commands and does not replace their model engine.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from urllib.request import Request, urlopen

SCHEMA = "upstate.gura-first-receiving/v1"
OPERATION = "GURA-NATIVE-01"
ARCHIVES = (
    {"name": "NDR.zip", "bytes": 701988,
     "sha256": "df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d",
     "url": "https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FNDR.zip?generation=1781204725169434&alt=media"},
    {"name": "SDR.zip", "bytes": 726334,
     "sha256": "34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779",
     "url": "https://storage.googleapis.com/download/storage/v1/b/releases.naturalcapitalproject.org/o/invest%2F3.20.0%2Fdata%2FSDR.zip?generation=1781204725769073&alt=media"},
)
TABLES = (
    ("source/gura-original-tables-3.20/NDR/biophysical_table_gura.csv",
     "e3f503cb1c82fb1035225eb68eb84303de8de7842b1bda6e94f4754fe538c42c"),
    ("source/gura-original-tables-3.20/SDR/biophysical_table_Gura.csv",
     "b27b1549a41c4929f161e3b18962d6bc8627c10ed7ed27e504203c175a0f5f69"),
)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def atomic(path, value):
    body = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True,
                       allow_nan=False) + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def artifact(path):
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest(path)}


def acquire(directory):
    directory.mkdir(parents=True, exist_ok=True)
    result = []
    for source in ARCHIVES:
        target = directory / source["name"]
        if not target.exists():
            descriptor, temporary = tempfile.mkstemp(prefix="." + source["name"] + ".", dir=directory)
            try:
                received = 0
                request = Request(source["url"], headers={"User-Agent": "TokenJunkieLabs-GURA-NATIVE-01"})
                with os.fdopen(descriptor, "wb") as output, urlopen(request, timeout=60) as incoming:
                    for chunk in iter(lambda: incoming.read(65536), b""):
                        received += len(chunk)
                        if received > source["bytes"]:
                            raise ValueError("Original archive response exceeds its retained source size")
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                candidate = Path(temporary)
                if received != source["bytes"] or digest(candidate) != source["sha256"]:
                    raise ValueError("Original archive response differs from its retained bytes: " + source["name"])
                # Publish without replacing any original file introduced by another operator.
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    pass  # The exact retained size/hash is checked below.
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        if target.stat().st_size != source["bytes"] or digest(target) != source["sha256"]:
            raise ValueError("Existing original archive differs: " + str(target))
        result.append({**source, "path": str(target)})
    return result


def execute(command, application, output, state, phase, lock_fd):
    attempts = state.setdefault("attempts", [])
    number = len(attempts) + 1
    log = output / (str(number).zfill(3) + "-" + phase + ".log")
    row = {"phase": phase, "argv": command, "cwd": str(application),
           "started_at": now(), "log": str(log), "state": "starting"}
    attempts.append(row)
    state.update(state="running", phase=phase, updated_at=now())
    atomic(output / "first-receiving.json", state)
    env = os.environ.copy()
    env.setdefault("GDAL_CACHEMAX", "16")
    env.setdefault("GDAL_NUM_THREADS", "1")
    # The child writes its retained log directly. Losing this orchestration caller
    # therefore does not close the child's stdout or replace its native operation.
    # Inherit the same flock description so that a live child also owns admission.
    with log.open("xb") as capture:
        process = subprocess.Popen(command, cwd=application, env=env,
                                   stdout=capture, stderr=subprocess.STDOUT, pass_fds=(lock_fd,))
        row.update(pid=process.pid, state="running")
        atomic(output / "first-receiving.json", state)
        print(json.dumps({"operation_id": OPERATION, "phase": phase,
                          "pid": process.pid, "log": str(log)}), flush=True)
        code = process.wait()
    row.update(exit_code=code, finished_at=now(), state="complete" if code == 0 else "failed")
    atomic(output / "first-receiving.json", state)
    if code:
        raise RuntimeError(phase + " returned " + str(code) + "; retained log: " + str(log))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--operation-root", required=True, type=Path,
                        help="Existing owned GURA-NATIVE-01 root; retains workspace/source/original-archives")
    parser.add_argument("--workspace", type=Path,
                        help="Actual retained Workspace path; defaults to operation-root/workspace for a new case")
    parser.add_argument("--source-directory", type=Path,
                        help="Actual retained Gura source directory; defaults to operation-root/source for a new case")
    parser.add_argument("--python", default=sys.executable, type=Path)
    parser.add_argument("--archives", type=Path,
                        help="Reuse actual retained NDR.zip and SDR.zip from this directory")
    args = parser.parse_args(argv)
    app = args.application.resolve(strict=True)
    root = args.operation_root.resolve()
    python = args.python.resolve(strict=True)
    workspace = (args.workspace or root / "workspace").resolve()
    source = (args.source_directory or root / "source").resolve()
    if root == app or root.is_relative_to(app):
        raise ValueError("Keep receiving data outside the application source")
    for label, directory in (("Workspace", workspace), ("source directory", source)):
        if (directory == app or directory.is_relative_to(app)
                or app.is_relative_to(directory)):
            raise ValueError("Keep the actual " + label + " separate from application source")
    if workspace == source:
        raise ValueError("Use distinct retained Workspace and source directories")
    if root == workspace or root.is_relative_to(workspace):
        raise ValueError("Keep receiving reports and the archive outside the actual Workspace")
    root.mkdir(parents=True, exist_ok=True)
    output = root / "first-receiving"
    output.mkdir(exist_ok=True)
    state_path = output / "first-receiving.json"
    lock = output / ".operation.lock"
    with lock.open("a+") as held:
        fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_text("utf-8")) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": OPERATION, "created_at": now(),
            "operation_root": str(root), "workspace": str(workspace),
            "source_directory": str(source),
        }
        if (state.get("schema") != SCHEMA or state.get("operation_id") != OPERATION
                or state.get("operation_root") != str(root)
                or state.get("workspace") != str(workspace)
                or state.get("source_directory") != str(source)):
            raise ValueError("Continue the original operation with its recorded Workspace and source-directory paths")
        state.pop("error", None)
        state.update(hostname=socket.gethostname(), python=str(python),
                     application=str(app), orchestration_pid=os.getpid(), updated_at=now())
        atomic(state_path, state)
        try:
            required = ["source_tools/gura_workflow.py", "source_tools/receive_gura.py",
                        "source_tools/gura_comparison.py", "source_tools/gura_setup_review.py",
                        "source_tools/receive_scientific_setup.py", "model/setup_review.py",
                        "source/gura-scientific-setup-request.json"]
            state["selected_application"] = {name: artifact(app / name) for name in required}
            state["original_tables"] = []
            for relative, expected in TABLES:
                selected = artifact(app / relative)
                if selected["sha256"] != expected:
                    raise ValueError("Retain the pinned original coefficient table: " + relative)
                state["original_tables"].append(selected)
            archives = (args.archives or root / "original-archives").resolve()
            # A prepared manifest already retains the actual original archive edition.
            # The maintained workflow owns reopening that exact edition and its grid.
            if not (source / "sources.json").is_file() and not (source / "receiving.json").is_file():
                state["original_archives"] = acquire(archives)
            atomic(state_path, state)
            base = [str(python), "-B", "-m", "source_tools.gura_workflow"]
            common = ["--workspace", str(workspace), "--source-directory", str(source),
                      "--archives", str(archives), "--convert", "5:8", "--convert", "5:19"]
            execute(base + ["prepare"] + common, app, output, state, "prepare", held.fileno())
            execute([str(python), "-B", "-m", "source_tools.gura_setup_review",
                     "--workspace", str(workspace), "--receiving", str(source / "receiving.json"),
                     "--request", str(app / "source/gura-scientific-setup-request.json"),
                     "--plan", str(source / "gura-comparison-plan.json"),
                     "--case", "class-5-to-8", "--case", "class-5-to-19",
                     "--output-dir", str(root / "scientific-setup")],
                    app, output, state, "scientific-setup", held.fileno())
            execute(base + ["run"] + common + ["--backup", str(root / "gura-complete.zip")],
                    app, output, state, "native-baseline-alternatives", held.fileno())
            execute([str(python), "-B", "-m", "source_tools.receive_scientific_setup",
                     "--workspace", str(workspace), "--catalog",
                     "--output-dir", str(root / "completed-catalog")],
                    app, output, state, "completed-catalog", held.fileno())
            state["results"] = {}
            for label, path in (
                    ("original_receiving", source / "receiving.json"),
                    ("native_workflow", source / "gura-workflow.json"),
                    ("native_comparison", source / "gura-comparison-result.json"),
                    ("scientific_setup", root / "scientific-setup/gura-setup-result.json")):
                state["results"][label] = {**artifact(path), "value": json.loads(path.read_text("utf-8"))}
            state["workspace_archive"] = artifact(root / "gura-complete.zip")
            state.update(state="complete", phase="native case and scientific setup received",
                         completed_at=now(), updated_at=now())
            atomic(state_path, state)
            print(json.dumps(state, ensure_ascii=False, indent=2), flush=True)
            return 0
        except BaseException as error:
            state.update(state="interrupted", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic(state_path, state)
            raise


if __name__ == "__main__":
    raise SystemExit(main())
