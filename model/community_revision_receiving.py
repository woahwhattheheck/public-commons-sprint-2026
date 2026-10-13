"""Receive complete Community comparison handovers in the original Workspace.

Original plans remain archived source records. This module retains the exact
comparison ZIP and its members; editable study adoption belongs to Study transfer.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

from . import community_revisions as revisions
from .common import describe_file, digest, file_digest, held, identifier, verify_file

KIND = "community-received-revisions"
SCHEMA = "upstate.community-received-revisions/v1"
ARCHIVE = "community-revision-comparison.zip"
DEFAULT_LIMIT = 64 * 1024 ** 3


def _archive(path, maximum_bytes):
    """Validate safe regular members before independent original-plan reading."""
    if isinstance(maximum_bytes, bool) or not isinstance(maximum_bytes, int) or maximum_bytes < 1:
        raise ValueError("Use the operator's positive archive extraction capacity")
    path = Path(path)
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        members = set()
        total = 0
        for item in infos:
            name = revisions._member(item.filename)
            mode = item.external_attr >> 16
            if (name != item.filename or name in members or item.is_dir()
                    or item.flag_bits & 1 or mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("The Community handover needs unique unencrypted regular file members")
            members.add(name)
            total += item.file_size
            if total > maximum_bytes:
                raise ValueError("The Community handover exceeds this operator's extraction capacity")
        for name in members:
            if any(parent.as_posix() in members for parent in PurePosixPath(name).parents
                   if parent.as_posix() != "."):
                raise ValueError("A Community handover member overlaps another file")
        if ARCHIVE in members:
            raise ValueError("The comparison ZIP cannot contain its own download member")
        if "COMPARISON.json" not in members:
            raise ValueError("Choose a complete Community revision handover ZIP")
        inventory = json.loads(archive.read("COMPARISON.json").decode("utf-8"))
    reopened = revisions.inspect_archive(path)
    return reopened, inventory, total


def preview(path, *, maximum_bytes=DEFAULT_LIMIT):
    path = Path(path)
    reopened, inventory, total = _archive(path, maximum_bytes)
    return {"schema": SCHEMA + "/preview", "source_project_id": inventory["project_id"],
            "selection": deepcopy(reopened["selection"]), "comparison": reopened["comparison"],
            "archive": {"sha256": file_digest(path), "bytes": path.stat().st_size},
            "original_plans": reopened["original_plans"], "member_count": reopened["files"] + 1,
            "expanded_bytes": total, "identity": "MATCH"}


def _copy(root, relative, stream, expected):
    root = root.resolve()
    target = root.joinpath(*PurePosixPath(relative).parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError("A retained handover member leaves its receiving directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError("A retained handover member leaves its receiving directory")
    if target.exists():
        verify_file(root, {"path": relative, **expected})
        return target
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".receiving-", delete=False) as out:
            pending = Path(out.name)
            checksum, size = hashlib.sha256(), 0
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                size += len(block)
                if size > expected["bytes"]:
                    raise ValueError("A received Community member exceeds its declared bytes")
                checksum.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if size != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
            raise ValueError("A received Community member differs from its original bytes")
        os.link(pending, target)
        pending.unlink()
        pending = None
        return target
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def receive(workspace, path, *, expected_sha256=None, maximum_bytes=DEFAULT_LIMIT):
    """Retain one original ZIP identity, independent of upload name or request ID."""
    path = Path(path)
    selected = preview(path, maximum_bytes=maximum_bytes)
    if expected_sha256 is not None and selected["archive"]["sha256"] != identifier(expected_sha256):
        raise ValueError("The selected Community upload differs from its reviewed original ZIP")
    selection_id = digest({"schema": SCHEMA, "archive_sha256": selected["archive"]["sha256"]})
    directory = workspace.root / KIND / selection_id
    if not directory.resolve().is_relative_to(workspace.root.resolve()):
        raise ValueError("Retain the comparison inside this receiving Workspace")
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".receiving.lock"):
        files = {}
        with path.open("rb") as source:
            retained = _copy(directory, ARCHIVE, source, selected["archive"])
        reopened, inventory, _ = _archive(retained, maximum_bytes)
        if (reopened["comparison"] != selected["comparison"]
                or inventory["project_id"] != selected["source_project_id"]):
            raise ValueError("The selected Community handover changed while receiving")
        with zipfile.ZipFile(retained) as archive:
            for name in archive.namelist():
                if name == "COMPARISON.json":
                    body = archive.read(name)
                    expected = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                else:
                    expected = {key: inventory["files"][name][key] for key in ("bytes", "sha256")}
                with archive.open(name) as source:
                    member = _copy(directory, "members/" + name, source, expected)
                files[name] = describe_file(workspace.root, member, title=name)
        files[ARCHIVE] = describe_file(workspace.root, retained,
                                      title="Original complete Community revision handover")
        return workspace._save(KIND, {
            "title": selected["selection"]["title"],
            "selection_id": selection_id,
            "source_project_id": selected["source_project_id"],
            "receiving_project_id": workspace.project["id"],
            "archive_sha256": selected["archive"]["sha256"],
            "archive_bytes": selected["archive"]["bytes"],
            "selection": selected["selection"], "comparison": selected["comparison"],
            "original_plans": selected["original_plans"],
            "member_count": selected["member_count"], "expanded_bytes": selected["expanded_bytes"],
            "files": files,
        })


def inspect(workspace, key, *, maximum_bytes=DEFAULT_LIMIT):
    record = workspace._get(KIND, identifier(key))
    if record.get("receiving_project_id") != workspace.project["id"]:
        raise ValueError("Open this received Community handover in its receiving project")
    files = record["files"]
    archive = verify_file(workspace.root, files[ARCHIVE])
    if (files[ARCHIVE]["sha256"] != record["archive_sha256"]
            or files[ARCHIVE]["bytes"] != record["archive_bytes"]):
        raise ValueError("The received handover archive identity changed")
    reopened, inventory, total = _archive(archive, maximum_bytes)
    if (reopened["comparison"] != record["comparison"] or reopened["selection"] != record["selection"]
            or inventory["project_id"] != record["source_project_id"]
            or reopened["original_plans"] != record["original_plans"]
            or total != record["expanded_bytes"]
            or reopened["files"] + 1 != record["member_count"]
            or set(files) != set(inventory["files"]) | {"COMPARISON.json", ARCHIVE}):
        raise ValueError("The received handover differs from its original comparison")
    with zipfile.ZipFile(archive) as original:
        manifest = original.read("COMPARISON.json")
    if (files["COMPARISON.json"]["bytes"] != len(manifest)
            or files["COMPARISON.json"]["sha256"] != hashlib.sha256(manifest).hexdigest()):
        raise ValueError("The received comparison manifest differs from its original archive")
    for name, item in files.items():
        verify_file(workspace.root, item)
        if name in inventory["files"] and any(
                item[field] != inventory["files"][name][field] for field in ("bytes", "sha256")):
            raise ValueError("A received handover member differs from its original inventory")
    return record


def catalog(workspace):
    return [{"id": row["id"], "title": row["title"], "received": True,
             "selection": row["selection"], "source_project_id": row["source_project_id"],
             "receiving_project_id": row["receiving_project_id"],
             "archive_sha256": row["archive_sha256"], "archive_bytes": row["archive_bytes"],
             "before_plan": row["comparison"]["before_plan"], "after_plan": row["comparison"]["after_plan"],
             "counts": row["comparison"]["counts"], "costs": row["comparison"]["costs"]}
            for row in workspace._list(KIND)]
