#!/usr/bin/env python3
"""Open the original retained OpenSearch workspace without external transport.

This receiving command performs preparation, release comparison and customer
export, followed by an independent Node process that reopens the saved workspace.
It never starts the Playground bridge or a live seller. Python 3.10+, Node 24+.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from uuid import uuid4
import zipfile

PREFIX = "stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving"
EXTENSIONS = ("retained-local-network.mjs", "retained-review.mjs", "run-retained-review.py", "RETAINED-REVIEW.md")


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


def regular(path, maximum=40 * 1024 * 1024):
    flags = os.O_RDONLY | os.O_NONBLOCK
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, "Use a bounded regular file: " + str(path))
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        need(len(raw) <= maximum and len(raw) == info.st_size == after.st_size
             and info.st_mtime_ns == after.st_mtime_ns, "Input changed during read: " + str(path))
        return raw


def safe_name(value):
    name = PurePosixPath(value)
    need(isinstance(value, str) and value and not name.is_absolute()
         and "\\" not in value and all(part not in ("", ".", "..") for part in value.split("/"))
         and str(name) == value, "Use an unambiguous relative source member")
    return name


def atomic(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def retain(path, raw, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    except FileExistsError:
        need(regular(path) == raw, "Retain the first exact completed source/receipt: " + str(path))
        return
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def assemble(archive, expected_sha256, target, extension_root):
    raw = regular(archive)
    need(digest(raw) == expected_sha256, "Selected source archive checksum differs")
    from io import BytesIO
    with zipfile.ZipFile(BytesIO(raw)) as saved:
        names = saved.namelist()
        need(len(names) == len(set(names)) and names.count("SOURCE_MANIFEST.json") == 1,
             "Retain the original complete source archive")
        need(saved.getinfo("SOURCE_MANIFEST.json").file_size <= 1024 * 1024, "Source manifest exceeds 1 MiB")
        manifest = json.loads(saved.read("SOURCE_MANIFEST.json"))
        need(manifest.get("schema") == "stellar-forge.opensearch-managed-source.v1",
             "Use the original managed source manifest")
        members = manifest.get("files")
        need(isinstance(members, dict) and 1 <= len(members) <= 5000
             and set(names) == set(members) | {"SOURCE_MANIFEST.json"}, "Source member inventory differs")
        total = 0
        for name, item in sorted(members.items()):
            relative = safe_name(name)
            need(isinstance(item, dict) and item.get("mode") in (0o644, 0o755)
                 and type(item.get("bytes")) is int and 0 <= item["bytes"] <= 32 * 1024 * 1024,
                 "Invalid retained source member")
            info = saved.getinfo(name)
            need(info.file_size == item["bytes"] and stat.S_IMODE(info.external_attr >> 16) == item["mode"],
                 "Source member length/mode differs: " + name)
            body = saved.read(info)
            need(len(body) == item["bytes"] and digest(body) == item["sha256"], "Source member checksum differs: " + name)
            total += len(body)
            need(total <= 32 * 1024 * 1024, "Source edition exceeds its original declared scope")
            retain(target / str(relative), body, item["mode"])
        need(total == manifest["bytes"], "Source total differs")
        retain(target / "SOURCE_MANIFEST.json", saved.read("SOURCE_MANIFEST.json"), 0o644)
    extensions = {}
    for name in EXTENSIONS:
        body = regular(extension_root / name, 256 * 1024)
        relative = PREFIX + "/" + name
        if relative in members:
            need(regular(target / relative) == body,
                 "The selected archive contains another retained-review source edition")
        else:
            retain(target / relative, body, 0o755 if name.endswith(".py") else 0o644)
        extensions[relative] = {"bytes": len(body), "sha256": digest(body)}
    return {"schema": "stellar-forge.opensearch-retained-source-assembly.v1",
            "baseArchive": {"filename": archive.name, "bytes": len(raw), "sha256": digest(raw)},
            "baseSourceSha256": manifest["sourceSha256"], "baseFiles": len(members),
            "baseBytes": total, "extensions": extensions}


def stop(child):
    if child is None or child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=15)


def interrupted(signum, frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-archive-sha256", required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    os.umask(0o077)
    directory = args.directory.expanduser().absolute()
    root = directory.resolve()
    runtime = args.runtime_root.expanduser().resolve()
    need(root != runtime and root not in runtime.parents and runtime not in root.parents,
         "Keep reproducible runtime separate from the retained workspace")
    need((directory / "receiver.lock").is_file() and (directory / "workspace/workspace.sqlite3").is_file(),
         "Use the existing original receiver and its lock")
    selection_raw = regular(args.selection, 256 * 1024)
    selection = json.loads(selection_raw)
    need(selection.get("schema") == "stellar-forge.opensearch-retained-selection.v1",
         "Use the explicit retained-review selection")
    node = shutil.which(args.node)
    need(node is not None, "Use the selected Node 24+ runtime")
    environment = os.environ.copy()
    environment.pop("NODE_OPTIONS", None)
    environment.pop("NODE_PATH", None)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    version = subprocess.run([node, "--version"], check=True, capture_output=True,
                             text=True, env=environment).stdout.strip()
    need(int(version.lstrip("v").split(".")[0]) >= 24, "Node 24+ is required")
    output = directory / "retained-review"
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    checkpoint = directory / "deployment-journey.json"
    before = regular(checkpoint, 4 * 1024 * 1024)
    need(digest(before) == selection["originalLiveReportSha256"],
         "The original live checkpoint changed; reconcile it before continuing")
    state = {"schema": "stellar-forge.opensearch-local-receiving.v1",
             "operation": selection["operation"], "startedAt": now(), "node": version,
             "selectionSha256": digest(selection_raw), "originalLiveReportSha256": digest(before),
             "mode": "retained-input-local-only", "processes": []}
    child = None
    handlers = {}
    with (directory / "receiver.lock").open("r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(regular(checkpoint, 4 * 1024 * 1024) == before, "The live checkpoint changed before receiver ownership")
        runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = Path(tempfile.mkdtemp(prefix="retained-review-", dir=runtime))
        try:
            handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
            source = temporary / "source"
            source.mkdir(mode=0o700)
            assembly = assemble(args.archive, args.expected_archive_sha256, source, Path(__file__).resolve().parent)
            retain(output / "source-assembly.json", encoded(assembly))
            retain(output / "selection.json", selection_raw)
            state["sourceAssembly"] = assembly
            state["phase"] = "SOURCE_READY"
            atomic(output / "receiving-run.json", encoded(state))
            driver = source / PREFIX / "retained-review.mjs"
            common = [node, "--max-old-space-size=192", str(driver),
                      "--workspace", str(directory / "workspace"), "--directory", str(output),
                      "--source", str(directory / "managed-source.json"),
                      "--plan", str(directory / "workspace/packages" / selection["basePackageId"] / "merchant-plan.json"),
                      "--selection", str(output / "selection.json")]
            environment["TMPDIR"] = str(temporary)
            for mode, expected in (("operate", "LOCAL_OPERATIONS_COMPLETE"), ("reopen", "COMPLETE")):
                state["phase"] = mode.upper()
                record = {"mode": mode, "startedAt": now()}
                state["processes"].append(record)
                atomic(output / "receiving-run.json", encoded(state))
                child = subprocess.Popen(common + ["--mode", mode], cwd=source, env=environment,
                                         start_new_session=True)
                record["pid"] = child.pid
                atomic(output / "receiving-run.json", encoded(state))
                code = child.wait()
                record.update(endedAt=now(), exitCode=code)
                child = None
                atomic(output / "receiving-run.json", encoded(state))
                need(code == 0, "Original local " + mode + " process exited " + str(code))
                report = json.loads(regular(output / "retained-review.json", 4 * 1024 * 1024))
                need(report.get("state") == expected, "Original local receiving stage is incomplete")
                need(regular(checkpoint, 4 * 1024 * 1024) == before, "Original live checkpoint changed")
            state.update(phase="COMPLETE", completedAt=now(),
                         originalLiveReportUnchanged=True,
                         report={"filename": "retained-review.json",
                                 "sha256": digest(regular(output / "retained-review.json", 4 * 1024 * 1024))})
            atomic(output / "receiving-run.json", encoded(state))
            print(json.dumps({"state": "COMPLETE", "directory": str(output), "report": state["report"]}), flush=True)
            return 0
        except KeyboardInterrupt:
            state.update(phase="INTERRUPTED", endedAt=now())
            atomic(output / "receiving-run.json", encoded(state))
            return 130
        except Exception as error:
            state.update(phase="FAILED", endedAt=now(), error=str(error))
            atomic(output / "receiving-run.json", encoded(state))
            print(json.dumps({"state": "FAILED", "error": str(error)}), flush=True)
            return 1
        finally:
            stop(child)
            for sig, previous in handlers.items():
                signal.signal(sig, previous)
            shutil.rmtree(temporary)
            with contextlib.suppress(OSError):
                runtime.rmdir()
            state["childrenDrainedAt"] = now()
            atomic(output / "receiving-run.json", encoded(state))
            fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == "__main__":
    raise SystemExit(main())
