#!/usr/bin/env python3
"""MIT. Complete, source-preserving archive transfer for the existing DSS receiver."""
import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
import zipfile

SCHEMA = "starforge.usgs-dss-handover.v1"
MAX_MEMBER = 256 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024 * 1024

def fail(message):
    raise ValueError(message)

def relative(value):
    if not isinstance(value, str) or len(value) > 1024 or "\\" in value or "\0" in value:
        fail("Invalid retained archive member path.")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts) or PurePosixPath(value).is_absolute():
        fail("An archive member leaves its receiving directory.")
    return value

def canonical_file(path):
    p = Path(path)
    if not p.is_absolute() or str(p.parent.resolve()) != str(p.parent):
        fail("Use a canonical absolute file path.")
    handle = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(handle)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_TOTAL:
        os.close(handle)
        fail("The input is not one regular retained file.")
    return handle, info

def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

def publish(path, value):
    p = Path(path)
    if p.exists() or p.is_symlink():
        fail("The receiving result already exists.")
    fd, temporary = tempfile.mkstemp(prefix=".result-", dir=p.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(encode(value))
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, p)
        os.unlink(temporary)
        directory = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def hash_file(path):
    digest = hashlib.sha256()
    fd, before = canonical_file(path)
    with os.fdopen(fd, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
        after = os.fstat(source.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail("The input changed while reading.")
    return {"bytes": before.st_size, "sha256": digest.hexdigest()}

def pack(spec_path, output):
    fd, _ = canonical_file(spec_path)
    with os.fdopen(fd, "r", encoding="utf-8") as source:
        spec = json.load(source)
    if spec.get("schema") != SCHEMA or not isinstance(spec.get("files"), list):
        fail("A complete DSS handover specification is required.")
    p = Path(output)
    if p.is_symlink() or not p.is_absolute() or p.parent.resolve() != p.parent:
        fail("Use a new output in a canonical directory.")
    seen = set()
    total = 0
    for member in spec["files"]:
        name = relative(member["path"])
        if name == "handover.json" or name in seen:
            fail("Repeated or reserved handover member.")
        seen.add(name)
        if not isinstance(member.get("bytes"), int) or not 0 <= member["bytes"] <= MAX_MEMBER:
            fail("An original member exceeds the retained edition limit.")
        total += member["bytes"]
    if total > MAX_TOTAL:
        fail("The complete handover exceeds the receiving format limit.")
    manifest = {key: value for key, value in spec.items() if key != "files"}
    manifest["files"] = [{key: member[key] for key in ("path", "bytes", "sha256")} for member in spec["files"]]
    if p.exists():
        retained = receive(str(p))
        if retained["manifest"] != manifest:
            fail("An existing handover contains different source work.")
        return {"schema": SCHEMA, "status": "READY", "output": str(p), "members": len(seen) + 1, "reopened": True, **hash_file(str(p))}
    fd, temporary = tempfile.mkstemp(prefix=".handover-", dir=p.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as target:
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for member in spec["files"]:
                    source_fd, before = canonical_file(member["source"])
                    if before.st_size != member["bytes"]:
                        os.close(source_fd)
                        fail("An original handover member changed size.")
                    info = zipfile.ZipInfo(member["path"])
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.create_system = 3
                    digest = hashlib.sha256()
                    with os.fdopen(source_fd, "rb") as source, archive.open(info, "w", force_zip64=True) as dest:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            digest.update(block)
                            dest.write(block)
                        after = os.fstat(source.fileno())
                    if digest.hexdigest() != member["sha256"] or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        fail("An original handover member changed bytes.")
                archive.writestr("handover.json", encode(manifest))
            target.flush()
            os.fsync(target.fileno())
        os.link(temporary, p)
        os.unlink(temporary)
        return {"schema": SCHEMA, "status": "READY", "output": str(p), "members": len(seen) + 1, **hash_file(str(p))}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def receive(archive_path, directory=None):
    target = Path(directory) if directory is not None else None
    if target is not None and (not target.is_absolute() or target.parent.resolve() != target.parent or target.exists() or target.is_symlink()):
        fail("Select a new private receiving directory.")
    fd, before = canonical_file(archive_path)
    created = False
    try:
        with os.fdopen(fd, "rb") as source, zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            if len(infos) > 100000 or len({info.filename for info in infos}) != len(infos):
                fail("The handover has too many or repeated members.")
            for info in infos:
                relative(info.filename)
                kind = (info.external_attr >> 16) & 0o170000
                if info.is_dir() or kind not in (0, stat.S_IFREG) or info.flag_bits & 1 or info.file_size > MAX_MEMBER:
                    fail("Only complete ordinary files are accepted in the handover.")
            if "handover.json" not in archive.namelist() or archive.getinfo("handover.json").file_size > 32 * 1024 * 1024:
                fail("The handover manifest is missing or too large.")
            manifest = json.loads(archive.read("handover.json"))
            if manifest.get("schema") != SCHEMA or not isinstance(manifest.get("files"), list):
                fail("The archive is not a DSS handover.")
            members = {}
            total = 0
            for member in manifest["files"]:
                name = relative(member["path"])
                if name in members or name == "handover.json":
                    fail("The manifest repeats a member.")
                if name not in archive.namelist() or member["bytes"] != archive.getinfo(name).file_size:
                    fail("The received member size differs from its manifest.")
                total += member["bytes"]
                members[name] = member
            if set(members) | {"handover.json"} != set(archive.namelist()) or total > MAX_TOTAL:
                fail("The handover manifest does not cover the complete archive.")
            if target is not None:
                target.mkdir(mode=0o700)
                created = True
            for name, member in members.items():
                destination = target.joinpath(*name.split("/")) if target is not None else None
                if destination is not None:
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                digest = hashlib.sha256()
                size = 0
                with archive.open(name) as original, (open(destination, "xb") if destination is not None else nullcontext()) as output:
                    if destination is not None:
                        os.chmod(destination, 0o600)
                    for block in iter(lambda: original.read(1024 * 1024), b""):
                        digest.update(block)
                        size += len(block)
                        if size > member["bytes"]:
                            fail("The archive expands beyond its original member size.")
                        if output is not None:
                            output.write(block)
                    if output is not None:
                        output.flush()
                        os.fsync(output.fileno())
                if size != member["bytes"] or digest.hexdigest() != member["sha256"]:
                    fail("The received member differs from the original handover.")
            if target is not None:
                publish(target / "handover.json", manifest)
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                fail("The handover archive changed while receiving.")
        return {"schema": SCHEMA, "status": "VERIFIED", "directory": str(target), "members": len(members), "manifest": manifest}
    except BaseException:
        if created:
            shutil.rmtree(target)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    packing = sub.add_parser("pack")
    packing.add_argument("--spec", required=True)
    packing.add_argument("--output", required=True)
    packing.add_argument("--result", required=True)
    receiving = sub.add_parser("receive")
    receiving.add_argument("--file", required=True)
    receiving.add_argument("--output-dir", required=True)
    receiving.add_argument("--result", required=True)
    args = parser.parse_args()
    try:
        result = pack(args.spec, args.output) if args.command == "pack" else receive(args.file, args.output_dir)
        publish(args.result, result)
        return 0
    except Exception as error:
        try:
            publish(args.result, {"schema": SCHEMA, "status": "ERROR", "error": {"message": str(error)}})
        except Exception:
            pass
        print(str(error), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
