"""Reuse original completed files without altering either retained operation."""
from __future__ import annotations
import os
from pathlib import Path
import shutil
import tempfile
from .common import describe_file, file_digest, relative_file, verify_file


def destination_file(root, relative):
    root = Path(root).resolve()
    member = Path(relative)
    if (not isinstance(relative, str) or not member.parts or member.is_absolute()
            or ".." in member.parts or "\\" in relative or "\0" in relative
            or member.as_posix() != relative):
        raise ValueError("Retained reuse requires a portable relative file name")
    target = root / member
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError("Retained reuse destination escapes its operation")
    return target


def copy_verified(source_root, descriptor, destination_root, *, path=None):
    """Hardlink or copy a complete original, checking both actual file bodies."""
    source = verify_file(source_root, descriptor)
    relative = descriptor["path"] if path is None else path
    target = destination_file(destination_root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = {**descriptor, "path": relative}
    if target.exists():
        verify_file(destination_root, expected)
        return expected
    try:
        os.link(source, target)
    except FileExistsError:
        pass
    except OSError:
        pending = None
        try:
            with source.open("rb") as src, tempfile.NamedTemporaryFile(
                    dir=target.parent, prefix=".reuse-", delete=False) as out:
                pending = Path(out.name)
                shutil.copyfileobj(src, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())
            if (pending.stat().st_size != descriptor["bytes"]
                    or file_digest(pending) != descriptor["sha256"]):
                raise ValueError("Original retained file changed during reuse")
            try:
                os.link(pending, target)
            except FileExistsError:
                pass
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)
    verify_file(destination_root, expected)
    return expected


def native_companions(directory, files):
    """Preserve native Shapefile components and raster auxiliary/mask files."""
    result = {}
    claimed = {item["path"] for item in files.values()}
    for item in files.values():
        path = relative_file(directory, item["path"])
        suffix = path.suffix.lower()
        candidates = []
        if suffix == ".shp":
            candidates.extend(path.parent.glob(path.stem + ".*"))
        elif suffix in (".tif", ".tiff"):
            candidates.extend(Path(str(path) + tail) for tail in (".aux.xml", ".msk", ".ovr"))
        for companion in candidates:
            if not companion.is_file():
                continue
            descriptor = describe_file(directory, companion)
            if descriptor["path"] not in claimed:
                result[descriptor["path"]] = descriptor
    return [result[name] for name in sorted(result)]


def verify_stage(directory, stage):
    if not isinstance(stage, dict) or not stage.get("completed_at"):
        raise ValueError("Retain the completed original native stage")
    verify_file(directory, stage["arguments"])
    for item in stage["files"].values():
        verify_file(directory, item)
    for item in stage.get("companions", []):
        verify_file(directory, item)
    if stage.get("requested_arguments"):
        verify_file(directory, stage["requested_arguments"])
    return stage
