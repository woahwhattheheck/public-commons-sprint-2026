#!/usr/bin/env python3
"""Create-only receiving extraction of the original verified complete handover."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

CHUNK = 1024 * 1024

def identity(filename):
    before = filename.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("The original selected file must be regular")
    h, size = hashlib.sha256(), 0
    with filename.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            h.update(chunk)
            size += len(chunk)
    after = filename.lstat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or size != before.st_size:
        raise ValueError("The selected complete file changed while reading")
    return {"bytes": size, "sha256": h.hexdigest()}

def verify(filename, expected):
    if identity(filename) != {"bytes": expected["bytes"], "sha256": expected["sha256"]}:
        raise ValueError("A retained complete receiving member changed: " + str(filename))

def directory(filename, create=False):
    if create:
        filename.mkdir(mode=0o700, exist_ok=True)
    info = filename.lstat()
    if not stat.S_ISDIR(info.st_mode) or filename.resolve() != filename:
        raise ValueError("Use the original canonical receiving directory")

def destination(root, relative, source):
    source.relative(relative)
    current = root
    for part in relative.split("/")[:-1]:
        current /= part
        directory(current, create=True)
    return current / relative.split("/")[-1]

def extract_member(archive, root, entry, source):
    name = source.relative(entry["path"])
    info = archive.getinfo(name)
    kind = stat.S_IFMT(info.external_attr >> 16)
    if info.is_dir() or kind not in (0, stat.S_IFREG) or info.file_size != entry["bytes"]:
        raise ValueError("The original archive member is not its declared regular file: " + name)
    target = destination(root, name, source)
    partial = target.with_name(target.name + ".receiving-partial")
    mode = 0o600 | (0o100 if entry.get("executable") else 0)
    if target.exists() or target.is_symlink():
        verify(target, entry)
        completed = target.lstat()
        if bool(completed.st_mode & 0o111) != bool(entry.get("executable")):
            raise ValueError("The original receiving executable mode changed: " + name)
        if partial.exists() or partial.is_symlink():
            retained = partial.lstat()
            if not stat.S_ISREG(retained.st_mode) or (retained.st_dev, retained.st_ino) != (completed.st_dev, completed.st_ino):
                raise ValueError("Preserve the unrelated original partial member for recovery: " + name)
            partial.unlink()
            source.sync_directory(target.parent)
        return
    offset = 0
    if partial.exists() or partial.is_symlink():
        selected = partial.lstat()
        if not stat.S_ISREG(selected.st_mode) or selected.st_size > entry["bytes"]:
            raise ValueError("Retain the invalid original partial member for recovery: " + name)
        offset = selected.st_size
        with archive.open(name, "r") as original, partial.open("rb") as retained:
            while chunk := retained.read(CHUNK):
                if original.read(len(chunk)) != chunk:
                    raise ValueError("Retain the mismatching original partial member: " + name)
    flags = os.O_WRONLY | os.O_NOFOLLOW | (os.O_APPEND if offset or partial.exists() else os.O_CREAT | os.O_EXCL)
    descriptor = os.open(partial, flags, mode)
    with os.fdopen(descriptor, "ab") as writer, archive.open(name, "r") as reader:
        os.fchmod(writer.fileno(), mode)
        remaining = offset
        while remaining:
            chunk = reader.read(min(CHUNK, remaining))
            if not chunk:
                raise ValueError("The original archive member is truncated: " + name)
            remaining -= len(chunk)
        while chunk := reader.read(CHUNK):
            writer.write(chunk)
        writer.flush()
        os.fsync(writer.fileno())
    verify(partial, entry)
    os.link(partial, target)
    source.sync_directory(target.parent)
    partial.unlink()
    source.sync_directory(target.parent)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--application-manifest-sha256", required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--archive-bytes", type=int, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--input-sha256", required=True)
    args = parser.parse_args()
    for selected in (args.app, args.archive, args.destination):
        if not selected.is_absolute() or selected.resolve() != selected:
            raise ValueError("Use the original absolute canonical paths")
    directory(args.app)
    manifest_file = args.app / "source-manifest.json"
    if identity(manifest_file)["sha256"] != args.application_manifest_sha256:
        raise ValueError("The selected original application manifest changed")
    app_manifest = json.loads(manifest_file.read_bytes())
    package = next(item for item in app_manifest["files"] if item["path"] == "package.py")
    verify(args.app / "package.py", package)
    spec = importlib.util.spec_from_file_location("ldw_original_handover", args.app / "package.py")
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    source.verify_inherited_receiving_lease()
    lease = json.loads(os.environ["LDW_RECEIVING_LEASE_IDENTITY"])
    if lease["operationId"] != args.operation_id or lease["inputSha256"] != args.input_sha256:
        raise ValueError("The inherited lease names another complete receiving operation")
    archive_identity = {"bytes": args.archive_bytes, "sha256": args.archive_sha256}
    verify(args.archive, archive_identity)
    request = source.read_request(args.archive)
    manifest = source.check_archive(args.archive, request)
    if request["applicationSourceSha256"] != args.application_manifest_sha256:
        raise ValueError("The complete archive belongs to another selected application")
    selected = {"schema": "lightdash-commissioning.handover-receiving-selection.v1",
                "operationId": args.operation_id, "inputSha256": args.input_sha256,
                "archive": {"path": str(args.archive), **archive_identity},
                "destination": str(args.destination), "handoverId": request["id"],
                "workspaceId": request["workspaceId"], "workspaceRevision": request["workspaceRevision"],
                "applicationSourceManifest": manifest["applicationSourceManifest"]}
    directory(args.destination.parent)
    if not args.destination.exists():
        args.destination.mkdir(mode=0o700)
    directory(args.destination)
    selection_file = args.destination / "selection.json"
    if selection_file.exists():
        if source.read_json(source.selected(args.destination, "selection.json")) != selected:
            raise ValueError("Retained receiving extraction names another original handover")
    else:
        if list(args.destination.iterdir()):
            raise ValueError("The unbound receiving directory is not empty")
        source.atomic_json(selection_file, selected)
    payload = args.destination / "package"
    directory(payload, create=True)
    with zipfile.ZipFile(args.archive, "r") as archive:
        manifest_bytes = archive.read("manifest.json")
        entries = list(manifest["files"]) + [{"path": "manifest.json", "bytes": len(manifest_bytes),
                   "sha256": hashlib.sha256(manifest_bytes).hexdigest(), "executable": False}]
        names = [source.relative(item["path"]) for item in entries]
        if len(set(names)) != len(names):
            raise ValueError("The original complete manifest contains duplicate members")
        allowed = set(names) | {name + ".receiving-partial" for name in names}
        for base, directories, members in os.walk(payload, followlinks=False):
            for name in directories:
                directory(Path(base) / name)
            for name in members:
                selected_file = Path(base) / name
                if selected_file.relative_to(payload).as_posix() not in allowed or not stat.S_ISREG(selected_file.lstat().st_mode):
                    raise ValueError("The original receiving directory contains an unselected file")
        for entry in entries:
            extract_member(archive, payload, entry, source)
    actual = set()
    for base, directories, members in os.walk(payload, followlinks=False):
        for name in directories:
            directory(Path(base) / name)
        for name in members:
            selected_file = Path(base) / name
            if not stat.S_ISREG(selected_file.lstat().st_mode):
                raise ValueError("A receiving member is not regular")
            actual.add(selected_file.relative_to(payload).as_posix())
    if actual != set(names):
        raise ValueError("The full extracted receiving inventory differs")
    verify(args.archive, archive_identity)
    result = {"schema": "lightdash-commissioning.handover-extraction.v1", "state": "COMPLETE",
              **{key: selected[key] for key in ("operationId", "inputSha256", "handoverId", "workspaceId", "workspaceRevision", "archive", "applicationSourceManifest")},
              "packageDirectory": str(payload), "applicationDirectory": str(payload / "app"),
              "workspaceDirectory": str(payload / "workspace"), "members": len(entries),
              "manifest": {"path": str(payload / "manifest.json"), **identity(payload / "manifest.json")},
              "selection": {"path": str(selection_file), **identity(selection_file)}}
    result_file = args.destination / "extraction.json"
    if result_file.exists():
        if source.read_json(source.selected(args.destination, "extraction.json")) != result:
            raise ValueError("The original extraction result changed")
    else:
        source.atomic_json(result_file, result)
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "INCOMPLETE", "error": {"type": type(error).__name__, "message": str(error)}}), file=sys.stderr)
        raise SystemExit(3)
