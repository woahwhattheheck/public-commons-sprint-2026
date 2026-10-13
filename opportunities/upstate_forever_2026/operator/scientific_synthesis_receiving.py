"""Open literal synthesis downloads and verify independently received native editions.

Called by the maintained operator/receiving.py owner; no service or browser is started.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile
from model.common import atomic_json, file_digest, read_json
from model.scientific_synthesis import inspect as inspect_synthesis
from model import scientific_report_editions


def _same(path, descriptor):
    path = Path(path)
    if (not path.is_file() or path.is_symlink() or path.stat().st_size != descriptor["bytes"]
            or file_digest(path) != descriptor["sha256"]):
        raise ValueError("The complete original receiving file changed: " + str(path))
    return path


def _name(value):
    path = PurePosixPath(value)
    if (not value or "\\" in value or "\0" in value or path.is_absolute()
            or path.as_posix() != value or any(part in ("", ".", "..") or ":" in part for part in value.split("/"))):
        raise ValueError("A received archive member must retain its original relative path")
    return path


def _sync(directory):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _extract(archive, directory, inspected):
    archive = Path(archive)
    archive_sha = file_digest(archive)
    if archive_sha in inspected:
        return {"sha256": archive_sha, "same_complete_archive": inspected[archive_sha]["directory"]}
    directory.mkdir(parents=True, exist_ok=True)
    record = {"sha256": archive_sha, "bytes": archive.stat().st_size,
              "directory": str(directory), "members": [], "included_archives": []}
    # Keep one complete extraction for repeated literal ZIP companions.
    inspected[archive_sha] = record
    with zipfile.ZipFile(archive) as source:
        infos = source.infolist()
        names = [row.filename for row in infos]
        if len(names) != len(set(names)):
            raise ValueError("The actual received archive repeats a member")
        for info in infos:
            if info.is_dir():
                _name(info.filename.rstrip("/"))
                continue
            relative = _name(info.filename)
            kind = stat.S_IFMT(info.external_attr >> 16)
            if kind not in (0, stat.S_IFREG):
                raise ValueError("A complete scientific archive contains a non-file member")
            target = directory.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(directory.resolve()) or target.is_symlink():
                raise ValueError("A received member escapes its retained archive directory")
            checksum = hashlib.sha256()
            count = 0
            pending = None
            try:
                with source.open(info) as stream, tempfile.NamedTemporaryFile(
                        dir=target.parent, prefix=".synthesis-receiving-", delete=False) as output:
                    pending = Path(output.name)
                    while block := stream.read(1024 * 1024):
                        output.write(block)
                        checksum.update(block)
                        count += len(block)
                    output.flush()
                    os.fsync(output.fileno())
                if count != info.file_size:
                    raise ValueError("A literal archive member was incomplete")
                descriptor = {"path": relative.as_posix(), "bytes": count, "sha256": checksum.hexdigest()}
                if target.exists():
                    _same(target, descriptor)
                else:
                    try:
                        os.link(pending, target)
                    except FileExistsError:
                        _same(target, descriptor)
                    _sync(target.parent)
                record["members"].append(descriptor)
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
            if target.suffix.lower() == ".zip":
                nested = _extract(target, directory.parent / ("included-" + descriptor["sha256"]), inspected)
                record["included_archives"].append({"path": relative.as_posix(), **nested})
    # This sidecar lives outside the extracted member namespace.
    atomic_json(directory.parent / (directory.name + ".opened.json"), record, immutable=True)
    return record


def inspect_downloads(receiving_directory):
    root = Path(receiving_directory).resolve(strict=True)
    progress = read_json(root / "synthesis-receiving.json")
    if not progress.get("operated"):
        raise ValueError("Continue the original authored browser course before opening its attachments")
    artifacts = progress["artifacts"]
    inspected, opened = {}, []
    for name, descriptor in artifacts.items():
        _name(name)
        if name != descriptor["path"]:
            raise ValueError("The retained artifact roster differs")
        original = _same(root / name, descriptor)
        if original.suffix.lower() == ".zip":
            value = _extract(original, root / "opened-attachments" / (original.stem + "-" + descriptor["sha256"][:16]), inspected)
            opened.append({"artifact": descriptor, "opened": value})
        elif original.suffix.lower() == ".json":
            # Parse the complete actual outgoing file, not a reconstructed projection.
            with original.open("r", encoding="utf-8") as stream:
                json.load(stream)
        elif original.suffix.lower() == ".pdf":
            with original.open("rb") as stream:
                if not stream.read(5) == b"%PDF-":
                    raise ValueError("The actual scientific PDF has another format")
    result = {"schema": "upstate.scientific-synthesis-opened-attachments/v1",
              "selection": progress["selection"], "archives": opened,
              "artifacts": artifacts,
              "visual_inspection": "The producing operator opens the exact PDF, HTML, images and extracted source deliverables through its existing applications."}
    atomic_json(root / "opened-attachments.json", result)
    return result


def verify_received(workspace, receiving_directory):
    """Read both actual native source revisions and saved report after original restore."""
    root = Path(receiving_directory).resolve(strict=True)
    progress = read_json(root / "synthesis-receiving.json")
    control = read_json(_same(root / "authored-course-input.json",
                              progress["artifacts"]["authored-course-input.json"]))
    if workspace.project["id"] != control["project_id"]:
        raise ValueError("The received native Workspace has another original project")
    originals = []
    for name, document in zip(("first", "second"), control["documents"]):
        phase = progress["phases"][name]
        value = inspect_synthesis(workspace, phase["result"]["collection_id"])
        if (value["record"]["document"] != document
                or value["record"]["revision_id"] != phase["received_revision_id"]
                or value["record"]["operation_id"] != phase["request"]["payload"]["operation_id"]):
            raise ValueError("The independent native receiving changed an authored edition")
        originals.append(value)
    if len(originals[1]["history"]) != 2 or originals[1]["history"][0] != originals[0]["record"]:
        raise ValueError("The independent receiving lost the complete first authored revision")
    record, directory, report = scientific_report_editions.inspect(workspace, progress["report"]["id"])
    if record != progress["report"]["detail"]["edition"]:
        raise ValueError("The independently received scientific report differs")
    result = {"schema": "upstate.scientific-synthesis-native-reopened/v1",
              "operation_id": control["operation_id"], "project_id": workspace.project["id"],
              "authored_collections": [row["collection_id"] for row in originals],
              "authored_revision_ids": [row["record"]["revision_id"] for row in originals],
              "scientific_report_id": record["id"]}
    atomic_json(root / "native-reopened.json", result, immutable=True)
    return result
