#!/usr/bin/env python3
"""Adopt maintained portable source over the actual retained original application.

This source-only installer never opens or changes a scientific Workspace. Run at
the existing application's source boundary, before issuing its original receiver.
"""
from __future__ import annotations

import argparse
import ast
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
import zipfile

BANK_SHA256 = "f352c142a62a4b07a7cc2071038b2c52666b1a08d5fd44a82d3e801c3f3b3c3e"
EXPECTED = {
    "model/portable.py", "model/portable_databases.py",
    "model/portable_acquisitions.py", "model/portable_implementation.py",
    "model/portable_parameter_studies.py", "model/received_delivery_navigation.py",
    "model/atlas_browser.py", "model/cartography.py",
}
ROOTS = [*sorted(EXPECTED), "model/workspace.py", "model/parameter_studies.py"]
PROBE = r"""
import inspect,json,pathlib,sys
app=pathlib.Path(sys.argv[1]).resolve(strict=True)
sys.path.insert(0,str(app))
from model import portable, parameter_studies
from model.workspace import Workspace
for name in ('backup','restore','resume_restore','_archive_identity','_archive_digest','_inspect_archive'):
    if not callable(getattr(portable,name,None)):
        raise ValueError('Missing maintained portable API: '+name)
if 'expected_archive_sha256' not in inspect.signature(portable.resume_restore).parameters:
    raise ValueError('Original resume_restore archive binding is unavailable')
for name in ('list_experiments','inspect'):
    if not callable(getattr(parameter_studies,name,None)):
        raise ValueError('Missing original parameter-study API: '+name)
if not callable(getattr(Workspace,'backup',None)):
    raise ValueError('Original Workspace.backup is unavailable')
for module in (portable, parameter_studies):
    if pathlib.Path(module.__file__).resolve() != app / 'model' / (module.__name__.split('.')[-1] + '.py'):
        raise ValueError('Import did not use the actual receiving application')
if pathlib.Path(inspect.getfile(Workspace)).resolve() != app / 'model/workspace.py':
    raise ValueError('Workspace import did not use the actual receiving application')
print(json.dumps({'portable':str(pathlib.Path(portable.__file__).resolve()),
                  'workspace':str(pathlib.Path(inspect.getfile(Workspace)).resolve()),
                  'api':'original portable receiving APIs available'}))
"""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def state(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def ordinary(path, *, directory=False):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError("Select original paths without aliases: " + str(part))
    info = path.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError("Expected an ordinary retained path: " + str(path))
    return path


def relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Invalid original source member")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or path.as_posix() != value or ".." in path.parts:
        raise ValueError("Original source member leaves its application")
    return path


def body(app, name):
    target = app.joinpath(*relative(name).parts)
    for part in (target, *target.parents):
        if part.is_symlink():
            raise ValueError("Application source contains an alias: " + name)
    return target.read_bytes() if target.exists() else None


def load_bank(path):
    raw = ordinary(path).read_bytes()
    if sha(raw) != BANK_SHA256:
        raise ValueError("Receive the exact published portable source bank")
    bank = json.loads(raw)
    rows = bank.get("files", [])
    if len(rows) != len(EXPECTED) or {row["path"] for row in rows} != EXPECTED:
        raise ValueError("Portable source inventory differs")
    supplied = {}
    for row in rows:
        data = base64.b64decode(row["content_base64"], validate=True)
        if len(data) != row["bytes"] or sha(data) != row["sha256"]:
            raise ValueError("Published source body differs: " + row["path"])
        git = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if git != row["git_blob"]:
            raise ValueError("Published original Git body differs: " + row["path"])
        ast.parse(data, filename=row["path"])
        supplied[row["path"]] = (data, row)
    return bank, supplied


def archive_preimages(path, expected_sha, project_id):
    path = ordinary(path)
    with path.open("rb") as stream:
        before = state(os.fstat(stream.fileno()))
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        if digest.hexdigest() != expected_sha:
            raise ValueError("The selected original archive SHA256 differs")
        stream.seek(0)
        with zipfile.ZipFile(stream) as bundle:
            entries = bundle.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)):
                raise ValueError("Original archive has duplicate member names")
            for item in entries:
                relative(item.filename)
                if item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError("Original archive has an unsupported member")
            info = bundle.getinfo("ARCHIVE.json")
            if info.file_size > 64 * 1024 * 1024:
                raise ValueError("Original archive manifest is too large")
            manifest = json.loads(bundle.read(info))
            members = manifest.get("members", {})
            if (manifest.get("schema") != "upstate.scientific-workspace-archive/v1"
                    or manifest.get("project", {}).get("id") != project_id
                    or not isinstance(members, dict)
                    or set(names) != {"ARCHIVE.json", *members}):
                raise ValueError("Select the original full scientific Workspace archive")
            original = {}
            for name in sorted(EXPECTED):
                descriptor = members.get("application/" + name)
                if descriptor is None:
                    continue
                data = bundle.read("application/" + name)
                if len(data) != descriptor["bytes"] or sha(data) != descriptor["sha256"]:
                    raise ValueError("Original archived source differs: " + name)
                original[name] = descriptor
        if (state(os.fstat(stream.fileno())) != before
                or state(path.lstat()) != before):
            raise ValueError("Original archive changed during source selection")
    return original, {"path": str(path), "bytes": before[2], "sha256": expected_sha,
                      "project_id": project_id, "members": len(members)}


def import_dependencies(app, supplied):
    """Resolve this import-time closure; preserve all unrelated lazy branches."""
    pending, seen = list(ROOTS), set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        data = supplied[name][0] if name in supplied else body(app, name)
        if data is None:
            raise ValueError("Original application dependency is missing: " + name)
        seen.add(name)
        tree = ast.parse(data, filename=name)
        package = list(PurePosixPath(name).parent.parts)

        # Conditional fallbacks and lazy record-specific imports retain their
        # native behavior. The isolated normal import below selects real startup
        # branches; this source pass follows only unconditional module imports.
        for node in tree.body:
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            targets = []
            if isinstance(node, ast.ImportFrom):
                if node.level:
                    if node.level > len(package):
                        raise ValueError("Relative dependency leaves application: " + name)
                    prefix = package[:len(package) - node.level + 1]
                    if node.module:
                        targets.append("/".join([*prefix, *node.module.split(".")]))
                    else:
                        targets.extend("/".join([*prefix, alias.name]) for alias in node.names)
                elif node.module and node.module.split(".")[0] in ("model", "source", "source_tools"):
                    targets.append(node.module.replace(".", "/"))
            else:
                targets.extend(alias.name.replace(".", "/") for alias in node.names
                               if alias.name.split(".")[0] in ("model", "source", "source_tools"))
            for target in targets:
                choices = [target + ".py", target + "/__init__.py"]
                chosen = next((p for p in choices if p in supplied or (app / p).is_file()), None)
                if chosen is None:
                    raise ValueError("Original import-time dependency is missing: " + target
                                     + " (required by " + name + ")")
                pending.append(chosen)
    return sorted(seen)


def write_atomic(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    ordinary(path.parent, directory=True)
    if path.is_symlink():
        raise ValueError('Source publication cannot replace an alias: ' + str(path))
    fd, temporary = tempfile.mkstemp(prefix=".write-portable-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(args):
    app = ordinary(args.application, directory=True)
    bank, supplied = load_bank(args.bank)
    original, archive = archive_preimages(args.original_archive, args.archive_sha256, args.project_id)
    changes, preimages, modes = {}, {}, {}
    for name, (data, row) in supplied.items():
        old = body(app, name)
        if old == data:
            continue
        expected = original.get(name)
        matches_archive = (old is not None and expected is not None
                           and len(old) == expected["bytes"] and sha(old) == expected["sha256"])
        matches_published = (old is not None
                             and sha(old) in row.get("accepted_predecessor_sha256", []))
        if not (matches_archive or matches_published or (old is None and expected is None)):
            raise ValueError("Preserved advanced or incomplete application source: " + name
                             + "; installed_sha256=" + (sha(old) if old is not None else "<absent>")
                             + ". Compose this original leaf before adopting.")
        changes[name], preimages[name] = data, old
        modes[name] = stat.S_IMODE((app / name).stat().st_mode) if old is not None else 0o644
    dependencies = import_dependencies(app, supplied)
    result = {"schema": "upstate.portable-source-adoption/v1",
              "application": str(app), "source_ref": bank["source_ref"],
              "operation_id": bank["operation_id"], "bank_sha256": BANK_SHA256,
              "original_archive": archive, "check_only": args.check,
              "changed_paths": sorted(changes), "import_time_dependencies": dependencies,
              "optional_record_dependencies": "Resolved by the maintained receiver only when selected records use them."}
    if args.check:
        return result
    lock = app / ".locks" / "extension-install.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    ordinary(lock.parent, directory=True)
    descriptor = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name, old in preimages.items():
            if body(app, name) != old:
                raise ValueError("Application changed during source adoption: " + name)
        import_dependencies(app, supplied)
        backup = app / ".portable-source-backups" / BANK_SHA256
        for name, old in preimages.items():
            if old is not None:
                target = backup / name
                if target.exists() and body(backup, name) != old:
                    raise ValueError("Original source backup differs: " + name)
                if not target.exists():
                    write_atomic(target, old, modes[name])
        written = []
        try:
            for name in sorted(changes, key=lambda p: (p == "model/portable.py", p)):
                if body(app, name) != preimages[name]:
                    raise ValueError("Application changed before publication: " + name)
                write_atomic(app / name, changes[name])
                written.append(name)
            probe = subprocess.run([sys.executable, "-I", "-B", "-c", PROBE, str(app)],
                                   capture_output=True, text=True, timeout=60)
            result["import_process"] = {"returncode": probe.returncode,
                                        "stdout": probe.stdout, "stderr": probe.stderr}
            if probe.returncode:
                raise ValueError("Original installed application import failed: " + probe.stderr)
            for name, (data, _) in supplied.items():
                if body(app, name) != data:
                    raise ValueError("Adopted portable source changed: " + name)
            result["source_backup"] = str(backup) if changes else None
            receipt = app / "integration" / "portable-source-adoptions" / (BANK_SHA256 + ".json")
            write_atomic(receipt, (json.dumps(result, indent=2, sort_keys=True) + "\n").encode())
            return result
        except BaseException:
            for name in reversed(written):
                if body(app, name) != changes[name]:
                    continue
                old = preimages[name]
                if old is None:
                    (app / name).unlink()
                else:
                    write_atomic(app / name, old, modes[name])
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--original-archive", type=Path, required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--project-id", default="b9d5d257-c6bb-4f07-b975-8e8c63705db3")
    parser.add_argument("--bank", type=Path, default=Path(__file__).with_name("source-bank.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args), indent=2))
    except (ValueError, OSError, KeyError, SyntaxError, subprocess.SubprocessError) as error:
        print(json.dumps({"state": "source_adoption_failed", "message": str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
