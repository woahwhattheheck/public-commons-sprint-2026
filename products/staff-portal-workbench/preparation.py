#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Private source intake for the original staff portal; no workspace or server is started."""
from __future__ import annotations
import argparse
import ast
import contextlib
import fcntl
import hashlib
import importlib
import json
import os
import platform
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import sysconfig
import time
import zipfile
from pathlib import Path, PurePosixPath

SOURCE_SCHEMA = "stellar-forge.staff-portal-workbench-source.v1"
PREPARED_SCHEMA = "stellar-forge.staff-portal-preparation.v1"
TRANSFER_SCHEMA = "stellar-forge.staff-portal-source-transfer.v1"
ORIGINAL_DELIVERY_SCHEMA = "tjlabs.staff-portal-delivery/v1"
MAX_SOURCE = 32 * 1024 * 1024
MAX_WORKSPACE = 1024 * 1024 * 1024
MAX_ARCHIVE = MAX_WORKSPACE + MAX_SOURCE * 3 + 32 * 1024 * 1024
HELPER = Path(__file__).resolve()
PUBLIC_ROOT = HELPER.parents[2]
CHILD = None
STOPPING = False
META = None

def need(ok, message):
    if not ok:
        raise RuntimeError(message)

def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()

def exact_json(body):
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result, "Duplicate JSON member.")
            result[key] = value
        return result
    return json.loads(body.decode("utf-8"), object_pairs_hook=pairs)

def sha(body):
    return hashlib.sha256(body).hexdigest()

def absolute(value):
    p = Path(value)
    need(p.is_absolute() and str(p) == os.path.normpath(str(p)), "Use an absolute normalized path.")
    return p

def ordinary(path, private=False, owned=True):
    path = absolute(str(path))
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISREG(info.st_mode) and (not owned or info.st_uid == os.getuid()),
         "Select an owned ordinary file without symbolic links.")
    need(not private or info.st_mode & 0o077 == 0, "Keep private input and preparation records private.")
    return info

def directory(path, create=False, private=True):
    path = absolute(str(path))
    if create and not path.exists():
        parent = path.parent
        need(parent.exists() and parent.resolve() == parent, "Create the parent before selecting a private preparation directory.")
        path.mkdir(mode=0o700)
        sync_dir(parent)
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid(),
         "Select an owned ordinary directory.")
    need(not private or info.st_mode & 0o077 == 0, "Use a private 0700 preparation directory.")
    return path

def beneath(path, parent):
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def mkdirs(path, root):
    need(beneath(path, root), "Keep staging directories inside the selected private preparation.")
    if path == root:
        directory(root)
        return
    mkdirs(path.parent, root)
    directory(path, create=True)

def identity(path, maximum=MAX_ARCHIVE, private=False, owned=True):
    before = ordinary(path, private, owned)
    need(before.st_size <= maximum, "The selected complete file exceeds its declared capacity.")
    h = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        first = os.fstat(fd)
        need((first.st_dev, first.st_ino) == (before.st_dev, before.st_ino), "The selected file changed.")
        with os.fdopen(os.dup(fd), "rb") as incoming:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                h.update(chunk)
        last = os.fstat(fd)
        need(all(getattr(first, k) == getattr(last, k) for k in
                 ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")), "The selected file changed during its complete read.")
    finally:
        os.close(fd)
    return {"path": str(path), "bytes": first.st_size, "sha256": h.hexdigest()}

def check(path, expected):
    got = identity(path, max(expected["bytes"], 1))
    need(got["bytes"] == expected["bytes"] and got["sha256"] == expected["sha256"], "A complete retained file identity changed.")
    return got

def raw(path, maximum=4 * 1024 * 1024, private=False):
    selected = identity(path, maximum, private)
    body = Path(path).read_bytes()
    need(len(body) == selected["bytes"] and sha(body) == selected["sha256"], "The selected JSON file changed.")
    return body

def document(path, maximum=4 * 1024 * 1024, private=True):
    return exact_json(raw(path, maximum, private))

def atomic(path, body, immutable=False):
    path = Path(path)
    directory(path.parent)
    if path.exists():
        prior = raw(path, max(len(body), 4 * 1024 * 1024), True)
        if prior == body:
            return identity(path)
        need(not immutable, "Preserve the complete original immutable preparation record.")
    candidate = path.with_name("." + path.name + "." + secrets.token_hex(10))
    try:
        fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(candidate, path)
        sync_dir(path.parent)
    finally:
        candidate.unlink(missing_ok=True)
    return identity(path)

def save(path, value, immutable=False):
    return atomic(path, encoded(value), immutable)

def private_candidate(target, selected):
    need(META is not None, "The original preparation metadata owner is required.")
    base = META / "copy-candidates"
    directory(base, create=True)
    scope = base / sha(str(target).encode())
    directory(scope, create=True)
    save(scope / "selection.json", {"target": str(target), "bytes": selected["bytes"], "sha256": selected["sha256"]}, True)
    # Interrupted candidates stay outside both immutable source inventories.
    # The same held preparation lease proves no earlier copy process still owns them.
    for prior in scope.glob("*.copying"):
        observed = identity(prior)
        save(prior.with_suffix(".interrupted.json"), {"state": "INTERRUPTED", "target": str(target), "candidate": observed}, True)
    return scope / (secrets.token_hex(10) + ".copying")

def preserve_candidate(candidate, target):
    if candidate.exists():
        observed = identity(candidate)
        save(candidate.with_suffix(".interrupted.json"), {"state": "INTERRUPTED", "target": str(target), "candidate": observed}, True)

def copy(source, target, selected):
    if target.exists():
        return check(target, selected)
    directory(target.parent)
    check(source, selected)
    candidate = private_candidate(target, selected)
    try:
        with Path(source).open("rb") as incoming, candidate.open("xb") as outgoing:
            os.chmod(candidate, 0o600)
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        check(candidate, selected)
        check(source, selected)
        os.rename(candidate, target)
        sync_dir(target.parent)
        sync_dir(candidate.parent)
    finally:
        preserve_candidate(candidate, target)
    return check(target, selected)

def member_name(value):
    need(isinstance(value, str) and 0 < len(value) <= 4096 and not value.startswith("/") and "\\" not in value and
         not any(ord(c) < 32 or ord(c) == 127 for c in value), "Invalid source or archive member path.")
    p = PurePosixPath(value)
    need(str(p) == value and all(x not in ("", ".", "..", "__pycache__") for x in value.split("/")), "Invalid source or archive member path.")
    return value

def descriptor(row):
    need(isinstance(row, dict) and set(row) == {"path", "bytes", "sha256"}, "Use exact complete source descriptors.")
    member_name(row["path"])
    need(type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_ARCHIVE and
         isinstance(row["sha256"], str) and re.fullmatch("[a-f0-9]{64}", row["sha256"]), "Invalid complete file identity.")
    return row

def authority(body):
    value = exact_json(body)
    need(isinstance(value, dict) and set(value) == {"schema", "files"} and value["schema"] == SOURCE_SCHEMA and
         isinstance(value["files"], list) and 7 <= len(value["files"]) <= 25000, "Select the complete private source authority.")
    names = set()
    for row in value["files"]:
        descriptor(row)
        need(row["path"].casefold() not in names and row["bytes"] <= MAX_SOURCE, "Duplicate or oversized original source.")
        names.add(row["path"].casefold())
    need(sum(row["bytes"] for row in value["files"]) <= MAX_SOURCE, "The original complete source exceeds its capacity.")
    need({"portal_delivery.py", "portal_server.py", "portal_cli.py", "engine.py", "store.py"}.issubset(names),
         "The original staff portal implementation is incomplete.")
    return value

def inventory(root):
    directory(root, private=False)
    result = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            p = Path(parent) / name
            need(not p.is_symlink(), "Linked source directories are not admitted.")
            directory(p, private=False)
        dirs[:] = [name for name in dirs if name != "__pycache__"]
        for name in files:
            p = Path(parent) / name
            ordinary(p)
            result.append(p.relative_to(root).as_posix())
    return sorted(result)

def original_constants(source):
    tree = ast.parse(raw(source / "portal_delivery.py", MAX_SOURCE).decode("utf-8"))
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("SOURCE_FILES", "SOURCE_EDITION"):
                    need(target.id not in found, "Ambiguous original source contract.")
                    found[target.id] = ast.literal_eval(node.value)
    names = found.get("SOURCE_FILES")
    need(isinstance(names, (tuple, list)) and names and all(isinstance(x, str) for x in names), "Retain the original literal SOURCE_FILES contract.")
    for name in names:
        member_name(name)
    need(len(set(names)) == len(names) and isinstance(found.get("SOURCE_EDITION"), str), "The original source edition is incomplete.")
    return sorted(names), found["SOURCE_EDITION"]

def verify_source(root, selected, complete=True):
    rows = selected["files"]
    for row in rows:
        check(root / row["path"], row)
    expected = sorted(row["path"] for row in rows)
    if complete:
        need(inventory(root) == expected, "Retain the whole original source tree without undeclared members.")
    names, edition = original_constants(root)
    need(names == expected, "The external private authority differs from original portal_delivery.SOURCE_FILES.")
    return {"files": len(rows), "bytes": sum(x["bytes"] for x in rows), "sourceEdition": edition}

def inspect_zip(path):
    ordinary(path, True)
    archive = zipfile.ZipFile(path)
    try:
        seen = set()
        total = 0
        for info in archive.infolist():
            name = member_name(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            need(not info.is_dir() and mode in (0, stat.S_IFREG) and not info.flag_bits & 1,
                 "Use only complete unencrypted ordinary archive members.")
            need(name.casefold() not in seen, "Duplicate archive member.")
            seen.add(name.casefold())
            total += info.file_size
        need(total <= MAX_ARCHIVE, "The selected complete private archive exceeds capacity.")
        return archive
    except BaseException:
        archive.close()
        raise

def zip_json(archive, name, maximum):
    info = archive.getinfo(name)
    need(info.file_size <= maximum, "Archive metadata exceeds its capacity.")
    return exact_json(archive.read(name))

def hash_member(archive, row):
    info = archive.getinfo(row["path"])
    need(info.file_size == row["bytes"], "Archive member size differs.")
    h = hashlib.sha256()
    with archive.open(info) as incoming:
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            h.update(block)
    need(h.hexdigest() == row["sha256"], "Archive member bytes differ.")

def extract_member(archive, row, target):
    if target.exists():
        return check(target, row)
    candidate = private_candidate(target, row)
    try:
        with archive.open(row["path"]) as incoming, candidate.open("xb") as outgoing:
            os.chmod(candidate, 0o600)
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        check(candidate, row)
        os.rename(candidate, target)
        sync_dir(target.parent)
        sync_dir(candidate.parent)
    finally:
        preserve_candidate(candidate, target)
    return check(target, row)

def receive_source(archive_path, staging, meta):
    with inspect_zip(archive_path) as archive:
        actual = set(archive.namelist())
        if "manifest.json" in actual:
            manifest = zip_json(archive, "manifest.json", 1024 * 1024)
            need(manifest.get("schema") == ORIGINAL_DELIVERY_SCHEMA and isinstance(manifest.get("files"), list),
                 "Select the original complete operating delivery.")
            rows = manifest["files"]
            for row in rows:
                descriptor(row)
            names = [x["path"] for x in rows]
            need(len(set(names)) == len(names) and actual == set(names) | {"manifest.json"},
                 "Original delivery has an undeclared or missing member.")
            source = [dict(x, path=x["path"][7:]) for x in rows if x["path"].startswith("source/")]
            need(set(names) == {"source/" + x["path"] for x in source} | {"workspace.zip", "HANDOVER.html"},
                 "Keep complete source, workspace and handover together.")
            need(next(x for x in rows if x["path"] == "workspace.zip")["bytes"] <= MAX_WORKSPACE,
                 "The original workspace exceeds its receiver capacity.")
            selected_body = encoded({"schema": SOURCE_SCHEMA, "files": sorted(source, key=lambda x: x["path"])})
            selected = authority(selected_body)
            for row in rows:
                hash_member(archive, row)
            for row in source:
                target = staging / row["path"]
                mkdirs(target.parent, staging)
                extract_member(archive, dict(row, path="source/" + row["path"]), target)
            summary = verify_source(staging, selected)
            need(manifest.get("sourceEdition") == summary["sourceEdition"], "The selected operating delivery names another original source edition.")
            original = copy(archive_path, meta / "original-delivery.zip", identity(archive_path))
            return selected_body, original, {"kind": "original-delivery", "archive": identity(archive_path),
                    "workspaceId": manifest.get("workspaceId"), "revision": manifest.get("revision")}
        need("TRANSFER.json" in actual and "SOURCE.json" in actual, "Select a complete private source transfer or original operating delivery.")
        manifest = zip_json(archive, "TRANSFER.json", 4 * 1024 * 1024)
        need(manifest.get("schema") == TRANSFER_SCHEMA and isinstance(manifest.get("files"), list),
             "Select the original private source-transfer schema.")
        rows = manifest["files"]
        for row in rows:
            descriptor(row)
        names = [x["path"] for x in rows]
        need(len(names) == len(set(names)) and actual == set(names) | {"TRANSFER.json"}, "Source transfer closure changed.")
        body = archive.read("SOURCE.json")
        selected = authority(body)
        source_rows = selected["files"]
        expected = {"SOURCE.json", "runtime-observation.json"} | {"source/" + r["path"] for r in source_rows}
        if "original-delivery.zip" in names:
            expected.add("original-delivery.zip")
        need(set(names) == expected, "The complete private transfer contains undeclared content.")
        declared = {x["path"]: x for x in rows}
        for row in source_rows:
            need(declared["source/" + row["path"]] == dict(row, path="source/" + row["path"]), "Source transfer authority differs.")
        for row in rows:
            hash_member(archive, row)
        for row in source_rows:
            target = staging / row["path"]
            mkdirs(target.parent, staging)
            extract_member(archive, dict(row, path="source/" + row["path"]), target)
        verify_source(staging, selected)
        observation = archive.read("runtime-observation.json")
        exact_json(observation)
        atomic(meta / "origin-runtime.json", observation, True)
        original = None
        if "original-delivery.zip" in names:
            original = extract_member(archive, declared["original-delivery.zip"], meta / "original-delivery.zip")
        return body, original, {"kind": "private-source-transfer", "archive": identity(archive_path)}

def python_identity(invocation):
    invocation = absolute(invocation)
    need(invocation.exists() and os.path.samefile(invocation, sys.executable), "Run preparation with the selected original Python invocation.")
    need(platform.python_implementation() == "CPython" and sys.version_info >= (3, 11), "Select an actual CPython 3.11 or later interpreter.")
    binary = Path(sys.executable).resolve()
    rows = []
    for name in ("json", "zipfile", "sqlite3", "_sqlite3", "ssl", "_ssl", "hashlib", "urllib.request", "http.server"):
        module = importlib.import_module(name)
        path = getattr(module, "__file__", None)
        if path and Path(path).exists():
            item = identity(Path(path).resolve(), 128 * 1024 * 1024, owned=False)
            rows.append({"module": name, **item})
    import sqlite3
    return {"executable": str(invocation), "binary": identity(binary, 128 * 1024 * 1024, owned=False),
            "version": sys.version, "implementation": platform.python_implementation(),
            "architecture": platform.machine(), "platform": sys.platform, "cacheTag": sys.implementation.cache_tag,
            "abi": sysconfig.get_config_var("SOABI"), "sqliteVersion": sqlite3.sqlite_version, "standardLibrary": rows}

def clean_env():
    result = dict(os.environ)
    for key in ("PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "PYTHONSTARTUP"):
        result.pop(key, None)
    result["PYTHONDONTWRITEBYTECODE"] = "1"
    return result

def original_inspect(source, archive, python, meta, lease_fd):
    global CHILD
    attempts = meta / "observations"
    directory(attempts, create=True)
    key = str(time.time_ns()) + "-" + secrets.token_hex(6)
    stdout = attempts / (key + ".stdout")
    stderr = attempts / (key + ".stderr")
    receipt = attempts / (key + ".json")
    program = "import json,sys;sys.path.insert(0,sys.argv[1]);import portal_delivery;print(json.dumps(portal_delivery.inspect(sys.argv[2]),sort_keys=True,separators=(',',':')))"
    argv = [python, "-I", "-B", "-c", program, str(source), str(archive)]
    record = {"schema": "stellar-forge.staff-portal-source-inspection.v1", "argv": argv, "startedAt": stamp(), "state": "PREPARED"}
    save(receipt, record)
    with stdout.open("xb") as out, stderr.open("xb") as error:
        os.chmod(stdout, 0o600)
        os.chmod(stderr, 0o600)
        try:
            need(not STOPPING, "Preparation was stopped before original inspection.")
            # Keep process acquisition atomic with respect to our stop handlers.
            # This helper is single-threaded; restore default child signal handling
            # and the prior mask before exec so the selected inspector can stop.
            previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
            try:
                def child_signal_setup():
                    signal.signal(signal.SIGTERM, signal.SIG_DFL)
                    signal.signal(signal.SIGINT, signal.SIG_DFL)
                    signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
                CHILD = subprocess.Popen(argv, stdout=out, stderr=error, env=clean_env(),
                                         pass_fds=(lease_fd,), preexec_fn=child_signal_setup)
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
            record.update(state="RUNNING", pid=CHILD.pid)
            save(receipt, record)
            CHILD.wait()
        finally:
            if CHILD is not None:
                if CHILD.poll() is None:
                    CHILD.terminate()
                code = CHILD.wait()
                CHILD = None
                record.update(state="CLOSED", exitCode=code, completedAt=stamp())
            out.flush()
            error.flush()
            os.fsync(out.fileno())
            os.fsync(error.fileno())
            record.update(stdout=identity(stdout), stderr=identity(stderr))
            save(receipt, record)
    need(record.get("exitCode") == 0 and not STOPPING, "The original selected delivery inspection did not finish successfully; retain its exact observation.")
    value = document(stdout, 4 * 1024 * 1024)
    need(value["sha256"] == identity(archive)["sha256"], "Original inspection returned another operating delivery.")
    return {"receipt": identity(receipt), "result": value}

def install_copy(source, destination, selected):
    if destination.exists():
        verify_source(destination, selected)
        directory(destination)
        return
    staging = destination.with_name(destination.name + ".staging")
    directory(staging, create=True)
    for row in selected["files"]:
        target = staging / row["path"]
        mkdirs(target.parent, staging)
        copy(source / row["path"], target, row)
    verify_source(staging, selected)
    for parent, _, _ in os.walk(staging, topdown=False):
        sync_dir(parent)
    os.rename(staging, destination)
    sync_dir(destination.parent)
    verify_source(destination, selected)

def inspect_prepared(root, python, lease_fd):
    meta = root / ".preparation"
    result = document(meta / "PREPARED.json")
    need(result.get("schema") == PREPARED_SCHEMA and result.get("state") == "READY" and result.get("directory") == str(root),
         "Select this complete original private preparation.")
    check(meta / "REQUEST.json", result["request"])
    request = document(meta / "REQUEST.json")
    need(request["helper"] == identity(HELPER) and request["python"] == python_identity(python),
         "The selected preparation helper or actual Python runtime changed.")
    selected_body = raw(meta / "SOURCE.json", 4 * 1024 * 1024, True)
    selected = authority(selected_body)
    need(sha(selected_body) == result["source"]["manifestSha256"], "The private source authority changed.")
    for key in ("primary", "receiving"):
        part = result[key]
        expected = {"applicationDirectory": str(root / key / "application"), "sourceManifestFile": str(meta / "SOURCE.json"),
                    "sourceManifestSha256": sha(selected_body), "python": python}
        need(part == expected, "The exact prepared application path or Python invocation changed.")
        verify_source(Path(part["applicationDirectory"]), selected)
        directory(Path(part["applicationDirectory"]))
    if result.get("originalDelivery"):
        check(Path(result["originalDelivery"]["path"]), result["originalDelivery"])
        inspected = result.get("originalInspection")
        need(isinstance(inspected, dict), "Retain the actual original delivery inspection.")
        check(Path(inspected["receipt"]["path"]), inspected["receipt"])
        receipt = document(inspected["receipt"]["path"])
        need(receipt.get("state") == "CLOSED" and receipt.get("exitCode") == 0, "Original delivery inspection was not complete.")
        for key in ("stdout", "stderr"):
            check(Path(receipt[key]["path"]), receipt[key])
        actual = document(receipt["stdout"]["path"])
        need(actual == inspected["result"] and actual["sha256"] == result["originalDelivery"]["sha256"],
             "The retained original inspection differs.")
    return result

def prepare(args, root, meta, lease_fd):
    python = args.python
    runtime = python_identity(python)
    source_path = absolute(args.source) if args.source else None
    archive_path = absolute(args.archive) if args.archive else None
    need(bool(source_path) != bool(archive_path), "Select either the trusted source folder or the complete trusted archive.")
    if source_path:
        directory(source_path, private=False)
        need(not beneath(root, source_path) and not beneath(source_path, root), "Keep original source and preparation in separate directories.")
        need(args.source_manifest and args.source_manifest_sha256, "Select the exact external private source authority.")
    if archive_path:
        need(not beneath(archive_path, root), "The selected incoming archive must remain outside the preparation.")
        selected_archive = identity(archive_path, MAX_ARCHIVE, True)
        need(selected_archive["sha256"] == args.archive_sha256, "Select the reviewed complete private archive digest.")
    body = raw(absolute(args.source_manifest), 4 * 1024 * 1024, True) if args.source_manifest else None
    if body is not None:
        need(sha(body) == args.source_manifest_sha256, "The exact supplied source authority differs.")
        selected = authority(body)
        if source_path:
            verify_source(source_path, selected)
    request = {"schema": "stellar-forge.staff-portal-preparation-request.v1", "directory": str(root),
               "mode": "source" if source_path else "archive", "source": str(source_path) if source_path else None,
               "archive": selected_archive if archive_path else None,
               "sourceAuthority": identity(absolute(args.source_manifest)) if body is not None else None,
               "python": runtime, "helper": identity(HELPER)}
    request_path = meta / "REQUEST.json"
    if request_path.exists():
        need(document(request_path) == request, "Resume the original exact private source/runtime intake.")
    else:
        save(request_path, request, True)
    if (meta / "PREPARED.json").exists():
        return inspect_prepared(root, python, lease_fd)
    original = None
    origin = {"kind": "source-folder", "path": str(source_path)} if source_path else None
    if archive_path:
        stage = root / "incoming-source"
        directory(stage, create=True)
        received_body, original, origin = receive_source(archive_path, stage, meta)
        if body is not None:
            supplied_authority, archive_authority = authority(body), authority(received_body)
            need(supplied_authority["schema"] == archive_authority["schema"] and
                 {row["path"]: (row["bytes"], row["sha256"]) for row in supplied_authority["files"]} ==
                 {row["path"]: (row["bytes"], row["sha256"]) for row in archive_authority["files"]},
                 "The trusted archive source differs from the selected external authority.")
        else:
            body = received_body
        selected = authority(body)
        source_path = stage
    atomic(meta / "SOURCE.json", body, True)
    for key in ("primary", "receiving"):
        base = root / key
        directory(base, create=True)
        install_copy(source_path, base / "application", selected)
    inspection = None
    if original:
        inspected = original_inspect(root / "primary" / "application", Path(original["path"]), python, meta, lease_fd)
        manifest_rows = inspected["result"]["manifest"]["files"]
        source_rows = [dict(x, path=x["path"][7:]) for x in manifest_rows if x["path"].startswith("source/")]
        need(sorted(source_rows, key=lambda x: x["path"]) == sorted(selected["files"], key=lambda x: x["path"]),
             "The original operating delivery source differs from the prepared complete tree.")
        inspection = inspected
    summary = verify_source(root / "primary" / "application", selected)
    result = {"schema": PREPARED_SCHEMA, "state": "READY", "directory": str(root), "resultPath": str(meta / "PREPARED.json"),
              "request": identity(request_path), "source": {"manifestSha256": sha(body), "files": summary["files"], "bytes": summary["bytes"]},
              "runtime": runtime, "origin": origin, "originalDelivery": original, "originalInspection": inspection,
              "completedAt": stamp()}
    for key in ("primary", "receiving"):
        result[key] = {"applicationDirectory": str(root / key / "application"), "sourceManifestFile": str(meta / "SOURCE.json"),
                       "sourceManifestSha256": sha(body), "python": python}
    candidate = meta / "candidate.json"
    if candidate.exists():
        prior = document(candidate)
        for field in ("completedAt", "originalInspection"):
            result[field] = prior[field]
        need(result == prior, "Preserve the exact first complete preparation candidate.")
    else:
        save(candidate, result, True)
    save(meta / "PREPARED.json", result, True)
    return inspect_prepared(root, python, lease_fd)

def export(args, root, meta, lease_fd):
    prepared = inspect_prepared(root, args.python, lease_fd)
    output = absolute(args.output)
    directory(output.parent)
    need(not beneath(output, root) and not beneath(output, PUBLIC_ROOT), "Keep the portable private output outside preparation and installed public source.")
    selected_body = raw(meta / "SOURCE.json", 4 * 1024 * 1024, True)
    selected = authority(selected_body)
    inputs = [("source/" + row["path"], root / "primary" / "application" / row["path"], row) for row in selected["files"]]
    inputs += [("SOURCE.json", meta / "SOURCE.json", identity(meta / "SOURCE.json"))]
    observation = meta / "runtime-observation.json"
    save(observation, prepared["runtime"], True)
    inputs += [("runtime-observation.json", observation, identity(observation))]
    if prepared.get("originalDelivery"):
        original = prepared["originalDelivery"]
        inputs += [("original-delivery.zip", Path(original["path"]), original)]
    rows = sorted([{"path": name, "bytes": row["bytes"], "sha256": row["sha256"]} for name, _, row in inputs], key=lambda x: x["path"])
    intent = {"schema": TRANSFER_SCHEMA, "files": rows, "sourceManifestSha256": sha(selected_body)}
    key = sha(str(output).encode())
    intent_path = meta / ("export-" + key + ".json")
    save(intent_path, {"output": str(output), "manifest": intent}, True)
    candidate = output.with_name(output.name + ".candidate")
    def validate(path):
        with inspect_zip(path) as archive:
            need(zip_json(archive, "TRANSFER.json", 4 * 1024 * 1024) == intent and
                 set(archive.namelist()) == {x["path"] for x in rows} | {"TRANSFER.json"}, "The selected private export differs.")
            for row in rows:
                hash_member(archive, row)
        return identity(path)
    if not output.exists():
        if candidate.exists():
            try:
                validate(candidate)
            except BaseException:
                preserved = candidate.with_name(candidate.name + "." + secrets.token_hex(8) + ".interrupted")
                os.rename(candidate, preserved)
                sync_dir(candidate.parent)
        if not candidate.exists():
            with zipfile.ZipFile(candidate, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                os.chmod(candidate, 0o600)
                for name, source, row in inputs:
                    check(source, row)
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    with archive.open(info, "w", force_zip64=True) as outgoing, source.open("rb") as incoming:
                        shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                    check(source, row)
                archive.writestr("TRANSFER.json", encoded(intent))
            with candidate.open("rb") as stream:
                os.fsync(stream.fileno())
            validate(candidate)
        os.rename(candidate, output)
        sync_dir(output.parent)
    portable = validate(output)
    receipt = {"schema": PREPARED_SCHEMA, "state": "EXPORTED", "portable": portable, "source": prepared["source"]}
    save(meta / ("export-" + key + "-result.json"), receipt, True)
    return receipt

def stopped(signum, frame):
    global STOPPING
    STOPPING = True
    if CHILD is not None and CHILD.poll() is None:
        CHILD.terminate()
    elif CHILD is None:
        raise KeyboardInterrupt("Preparation was stopped.")

def main():
    global META
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("mode", choices=("prepare", "receive", "inspect", "export"))
    for name in ("directory", "python"):
        parser.add_argument("--" + name, required=True)
    for name in ("source", "source-manifest", "source-manifest-sha256", "archive", "archive-sha256", "output"):
        parser.add_argument("--" + name)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    need(args.mode != "prepare" or args.source and not args.archive, "Prepare selects one trusted source folder.")
    need(args.mode != "receive" or args.archive and args.archive_sha256 and not args.source, "Receive selects one complete private archive and digest.")
    need(args.mode != "export" or args.output, "Select the complete private export path.")
    need(bool(args.source_manifest) == bool(args.source_manifest_sha256), "Select both source authority path and exact digest.")
    if args.mode in ("inspect", "export"):
        need(not any((args.source, args.archive, args.source_manifest, args.archive_sha256)),
             "Inspect/export uses its complete retained original request.")
    if args.mode != "export":
        need(args.output is None, "Only export accepts an output destination.")
    root = absolute(args.directory)
    need(not beneath(root, PUBLIC_ROOT) and not beneath(PUBLIC_ROOT, root), "Keep private preparation outside installed public source.")
    directory(root, create=args.mode in ("prepare", "receive"))
    meta = root / ".preparation"
    directory(meta, create=args.mode in ("prepare", "receive"))
    META = meta
    fd = os.open(meta / "lifetime.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "Retain the private original preparation lock.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path_info = (meta / "lifetime.lock").stat()
        need((info.st_dev, info.st_ino) == (path_info.st_dev, path_info.st_ino), "Preparation lock changed.")
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, stopped)
        if args.mode in ("prepare", "receive"):
            if (meta / "REQUEST.json").exists() and not (meta / "PREPARED.json").exists():
                need(args.resume, "Resume the same incomplete original private preparation explicitly.")
            result = prepare(args, root, meta, fd)
        elif args.mode == "inspect":
            result = {"schema": PREPARED_SCHEMA, "state": "READY", "result": inspect_prepared(root, args.python, fd), "verifiedAt": stamp()}
        else:
            result = export(args, root, meta, fd)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    finally:
        if CHILD is not None:
            CHILD.wait()
        os.close(fd)

if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"error": {"code": "STAFF_PORTAL_PREPARATION", "message": str(error)}}), file=sys.stderr)
        raise
