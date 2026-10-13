"""One-file carrier for the original audited delivery directory."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import zipfile
from .common import canonical, describe_file, file_digest, relative_file

SCHEMA = "upstate.original-delivery-archive/v1"

def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)

def _member(path):
    if not isinstance(path, str) or "\\" in path:
        raise ValueError("Delivery member must be a canonical relative path")
    p = Path(path)
    if p.is_absolute() or not p.parts or any(x in (".", "..") for x in p.parts) or p.as_posix() != path:
        raise ValueError("Delivery member must be a canonical relative path")
    return path

def inspect_archive(path, *, expected_package_sha256=None, verify=True):
    """Reopen the complete carrier and bind every original package member."""
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)) or "transfer.json" not in names:
            raise ValueError("Delivery carrier has duplicate or missing members")
        for info in infos:
            _member(info.filename)
            mode = stat.S_IFMT(info.external_attr >> 16)
            if info.is_dir() or info.flag_bits & 1 or mode not in (0, stat.S_IFREG):
                raise ValueError("Delivery carrier requires ordinary unencrypted files")
        transfer = next(x for x in infos if x.filename == "transfer.json")
        if transfer.file_size > 16 * 1024 * 1024:
            raise ValueError("Delivery transfer manifest is too large")
        manifest = json.loads(archive.read(transfer))
        if manifest.get("schema") != SCHEMA:
            raise ValueError("Select an original audited delivery carrier")
        if expected_package_sha256 and manifest.get("package_sha256") != expected_package_sha256:
            raise ValueError("Delivery carrier belongs to another audited package")
        members = manifest.get("members")
        if not isinstance(members, dict) or set(members) | {"transfer.json"} != set(names):
            raise ValueError("Delivery carrier membership changed")
        for name, expected in members.items():
            info = archive.getinfo(name)
            if info.file_size != expected["bytes"]:
                raise ValueError("Delivery carrier member size changed: " + name)
            if verify:
                h = hashlib.sha256()
                with archive.open(info) as original:
                    for block in iter(lambda: original.read(1024 * 1024), b""):
                        h.update(block)
                if h.hexdigest() != expected["sha256"]:
                    raise ValueError("Delivery carrier member bytes changed: " + name)
        return manifest

def package_archive(directory, package_root, package):
    """Wrap the existing exact package, streaming original files without re-encoding."""
    directory, package_root = Path(directory).resolve(), Path(package_root).resolve()
    destination = directory / "delivery-package.zip"
    if destination.exists():
        manifest = inspect_archive(destination, expected_package_sha256=package["packageSha256"])
        return describe_file(directory, destination, package_sha256=package["packageSha256"],
                             members=len(manifest["members"]), schema=SCHEMA)
    expected = {row["path"]: {"bytes": row["bytes"], "sha256": row["sha256"]}
                for row in package["artifacts"]}
    if len(expected) != len(package["artifacts"]):
        raise ValueError("Original package repeats an artifact")
    for name in ("package.json", "index.html"):
        source = relative_file(package_root, name)
        expected[name] = {"bytes": source.stat().st_size, "sha256": file_digest(source)}
    sources = {name: relative_file(package_root, name) for name in expected}
    application = Path(__file__).resolve().parent.parent
    for name in ("audit.py", "raster_checks.py", "package_delivery.py",
                 "delivery_snapshot.py", "handoff_view.py", "README.md"):
        member = "tools/" + name
        if member in expected:
            raise ValueError("Original package uses the verification-tool member name")
        source = relative_file(application, name)
        sources[member] = source
        expected[member] = {"bytes": source.stat().st_size, "sha256": file_digest(source)}
    if "transfer.json" in expected:
        raise ValueError("Original package uses the reserved transfer manifest name")
    manifest = {"schema": SCHEMA, "package_sha256": package["packageSha256"],
                "audit_status": package["auditStatus"],
                "members": expected, "layout": "original package root; unchanged verification tools in tools/"}
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".delivery-", suffix=".zip", delete=False) as out:
            pending = Path(out.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for name in sorted(expected):
                _member(name)
                source = sources[name]
                fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
                h = hashlib.sha256()
                count = 0
                with os.fdopen(fd, "rb") as original:
                    before = os.fstat(original.fileno())
                    if not stat.S_ISREG(before.st_mode):
                        raise ValueError("Delivery member changed type")
                    info = zipfile.ZipInfo(name)
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    with archive.open(info, "w", force_zip64=True) as target:
                        for block in iter(lambda: original.read(1024 * 1024), b""):
                            target.write(block)
                            h.update(block)
                            count += len(block)
                    if _identity(before) != _identity(os.fstat(original.fileno())):
                        raise ValueError("Original delivery member changed during packaging")
                if count != expected[name]["bytes"] or h.hexdigest() != expected[name]["sha256"]:
                    raise ValueError("Original delivery member differs from its audited bytes: " + name)
            archive.writestr("transfer.json", canonical(manifest) + b"\n")
        with pending.open("rb") as original:
            os.fsync(original.fileno())
        # The ZIP writer has already checked each streamed source. Reopen its
        # directory here; the receiving command verifies every archived byte.
        inspect_archive(pending, expected_package_sha256=package["packageSha256"], verify=False)
        try:
            os.link(pending, destination)
        except FileExistsError:
            inspect_archive(destination, expected_package_sha256=package["packageSha256"])
        pending.unlink()
        pending = None
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        return describe_file(directory, destination, package_sha256=package["packageSha256"],
                             members=len(expected), schema=SCHEMA)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
