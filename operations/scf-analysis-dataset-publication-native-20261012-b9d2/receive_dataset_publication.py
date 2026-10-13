#!/usr/bin/env python3
"""Materialize the existing complete Dataset programme and its original inputs.

Default mode prepares only. --execute runs the exact saved programme in this
same foreground after the receiver has explicitly accepted sole custody.
There is no new job controller, source acquisition or native engine here.
"""
import argparse
import ast
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
import zipfile

OPERATION = "SCF-ANALYSIS-DATASET-PUBLICATION-B9D2-20261012"
CARRIER = "a50bc2339f5736edd1a5becf7820713286963f6d"
PROJECT = "31a92f2bacd565eac461478519ec2ebc44df7af1fadeda2a9c82f62ab3c27355"
BACKUP = "4daa8c2c28cfe14263a69c32cb0e3733e043d223a320fdf83cc7daef51f7d0e3"
PYTHON = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/"
PRODUCT_TREE = "b5d3a26fbdc79d7cf7838f220051f762e2ee24dd"

def require(value, message):
    if not value:
        raise ValueError(message)

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()

def private(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    require(path.resolve() == path and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077
            and info.st_uid == os.getuid(), "Use a caller-owned private canonical directory")
    return path

def read(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, "Read a bounded regular input")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        require((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and len(raw) == info.st_size, "The selected input changed during read")
        return raw

def put(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        require(read(path, len(raw) + 1) == raw, "An immutable prepared input changed: " + str(path))
        return
    fd, pending = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(pending, path, follow_symlinks=False)
        except FileExistsError:
            require(read(path, len(raw) + 1) == raw, "A concurrent prepared input differs")
    finally:
        os.unlink(pending)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def relative(name):
    value = PurePosixPath(name)
    require(isinstance(name, str) and name and not value.is_absolute() and
            name == value.as_posix() and all(p not in ("", ".", "..") for p in name.split("/")) and
            "\\" not in name and "\0" not in name, "The retained member path is invalid")
    return value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--source-carrier", required=True, type=Path)
    parser.add_argument("--original-project", required=True, type=Path)
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE"))
    parser.add_argument("--playwright", type=Path)
    parser.add_argument("--chromium", type=Path)
    parser.add_argument("--temporary-root", type=Path, default=Path("/dev"))
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    root = private(args.directory)
    lock = open(root / ".source-receiving.lock", "a+b")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    carrier_raw = read(args.source_carrier, 8 * 1024 * 1024)
    require(git_blob(carrier_raw) == CARRIER, "Select the exact original complete source carrier")
    carrier = json.loads(carrier_raw)
    require(carrier["schema"] == "stellar-forge.analysis-dataset-publication-source.v1" and
            carrier["operation_id"] == OPERATION and carrier["product_tree"] == PRODUCT_TREE,
            "The prepared native programme identity changed")
    project_raw = read(args.original_project, 8 * 1024 * 1024)
    require(len(project_raw) == 4265758 and sha(project_raw) == PROJECT,
            "Select the exact already-completed Analysis project")
    files = {}
    with zipfile.ZipFile(io.BytesIO(project_raw)) as archive:
        members = archive.infolist()
        require(len({m.filename for m in members}) == len(members), "The original project has duplicate members")
        for member in members:
            relative(member.filename.rstrip("/"))
            require(not stat.S_ISLNK(member.external_attr >> 16), "Source symlinks are not selected")
        for member in members:
            if member.filename.startswith("runtime/python/stellar_forge_buyer/") and not member.is_dir():
                require(member.file_size <= 2 * 1024 * 1024, "An original module exceeds its bound")
                suffix = member.filename[len("runtime/python/"):]
                files[PYTHON + suffix] = {"raw": archive.read(member),
                    "origin": "original-operated-project-" + PROJECT}
        require(files and PYTHON + "stellar_forge_buyer/storage.py" in files,
                "The original complete Python source is absent")
        backup = archive.read("archives/analysis-workspace.zip")
        require(len(backup) == 218223 and sha(backup) == BACKUP, "Original nested workspace changed")
        pins = archive.read("runtime/python/module-pins.json")
    require(len(carrier["files"]) == 379, "The complete selected executable closure changed")
    declared = set()
    for item in carrier["files"]:
        name = str(relative(item["path"]))
        require(name not in declared, "The source carrier repeats a member")
        declared.add(name)
        raw = item["content"].encode("utf-8")
        require(len(raw) <= 2 * 1024 * 1024, "A retained source exceeds its bound")
        if item.get("git_blob"):
            require(git_blob(raw) == item["git_blob"], "Original native source bytes changed: " + name)
        files[name] = {"raw": raw, "origin": item["origin"], "git_blob": item.get("git_blob")}
    source = private(root / "source")
    records = []
    for name in sorted(files):
        item = files[name]; raw = item["raw"]
        put(source / name, raw)
        records.append({"path": name, "bytes": len(raw), "sha256": sha(raw),
                        "origin": item["origin"], "git_blob": item.get("git_blob")})
    inputs = private(root / "inputs")
    put(inputs / "analysis-workspace.zip", backup)
    put(inputs / "original-module-pins.json", pins)
    selection = {"schema": "stellar-forge.analysis-dataset-source-received.v1",
        "operation_id": OPERATION, "product_tree": PRODUCT_TREE, "carrier_git_blob": CARRIER,
        "original_project_sha256": PROJECT, "original_backup_sha256": BACKUP, "files": records}
    put(root / "source-selection.json", encoded(selection))
    node = Path(args.node or "").expanduser().resolve()
    require(args.node and node.is_file() and os.access(node, os.X_OK), "Select the actual installed Node executable")
    modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES")
    playwright = args.playwright or (Path(modules) / "playwright/index.mjs" if modules else None)
    require(playwright is not None and playwright.is_file(), "Select the actual installed Playwright entry")
    playwright = playwright.resolve()
    probe = subprocess.run([str(node), "--input-type=module", "-e",
        "const {chromium}=await import(" + json.dumps(playwright.as_uri()) +
        "); console.log(JSON.stringify({chromium:chromium.executablePath()}));"],
        check=True, capture_output=True, text=True)
    chromium = (args.chromium or Path(json.loads(probe.stdout)["chromium"])).resolve()
    require(chromium.is_file() and os.access(chromium, os.X_OK), "The selected actual Chromium binary is absent")
    temporary = args.temporary_root.expanduser().resolve()
    require(temporary.is_dir(), "Select an existing temporary-files root")
    pyroot = source / PYTHON
    for path in (pyroot / "stellar_forge_buyer").glob("*.py"):
        ast.parse(path.read_bytes(), filename=str(path))
    for relative_path in (
        PYTHON + "analysis-publication-bridge.mjs",
        PYTHON + "examples/analysis_publication_browser.mjs",
        PYTHON + "examples/analysis_publication_merchant.mjs",
        PYTHON + "examples/analysis_publication_mcp.mjs",
        "stellar-forge/mcp-paid-agent/native-analysis-publication.mjs",
        "stellar-forge/mcp-paid-agent/native-analysis-publication-schema.mjs"):
        subprocess.run([str(node), "--check", str(source / relative_path)], check=True)
    env = {**os.environ, "PYTHONPATH": str(pyroot), "PYTHONDONTWRITEBYTECODE": "1"}
    subprocess.run([sys.executable, "-B", "-c",
        "from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace; print('ANALYSIS_IMPORT_PASS')"],
        check=True, env=env, cwd=source)
    bridge = (source / PYTHON / "analysis-publication-bridge.mjs").as_uri()
    subprocess.run([str(node), "--input-type=module", "-e",
                    "await import(" + json.dumps(bridge) + "); console.log('BRIDGE_IMPORT_PASS');"],
                   check=True, cwd=source)
    command = [str(Path(sys.executable).resolve()), "-B",
        str(pyroot / "examples/analysis_publication_native.py"),
        "--directory", str(root / "native"),
        "--analysis-backup", str(inputs / "analysis-workspace.zip"), "--backup-sha256", BACKUP,
        "--query-export", carrier["native_input"]["query_export_id"],
        "--manifest-sha256", carrier["native_input"]["manifest_sha256"],
        "--checkout", str(source), "--node", str(node), "--playwright", str(playwright),
        "--chromium", str(chromium), "--temporary-root", str(temporary), "--operation-id", OPERATION]
    prepared = {"schema": "stellar-forge.analysis-dataset-native-command.v1",
        "operation_id": OPERATION, "source_selection_sha256": sha(encoded(selection)),
        "command": command, "environment": {"PYTHONPATH": str(pyroot), "PYTHONDONTWRITEBYTECODE": "1"},
        "working_directory": str(source), "native_directory": str(root / "native")}
    put(root / "native-command.json", encoded(prepared))
    print(json.dumps({"state": "PREPARED", "operation_id": OPERATION,
        "source_files": len(records), "source_selection": str(root / "source-selection.json"),
        "native_command": str(root / "native-command.json"), "command": command}), flush=True)
    if args.execute:
        # The original programme owns its own immutable request and receiving
        # lock. Preserve its exact directory/argv on every following invocation.
        lock.close()
        os.chdir(source)
        os.execve(command[0], command, env)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
