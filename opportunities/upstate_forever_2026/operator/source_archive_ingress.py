"""Discover and preview included source archives through the original operator.

Discovery reads only bounded artifact inventories and file metadata. Explicit
preview uses Operator.receive_upload and Operator.preview_source; those original
paths own ZIP validation, source selection and retained upload identity.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
from urllib.parse import quote
import zipfile

from model.common import digest

INVENTORY_LIMIT = 4 * 1024 * 1024
MEMBER_LIMIT = 20000
BUNDLED_SOURCE_ARCHIVE_INVENTORIES = (
    "results/native-assessment-annual-yields-20261013/artifacts.json",
)


def _name(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or re.search(r"[\x00-\x1f\x7f]", value)):
        raise ValueError("The archive inventory needs an original relative file name.")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in ("", ".", "..") or ":" in part for part in value.split("/"))):
        raise ValueError("Archive and manifest paths must stay inside their original edition.")
    return value


def _identity(row):
    if (not isinstance(row, dict)
            or not isinstance(row.get("bytes"), int) or isinstance(row["bytes"], bool)
            or row["bytes"] < 0
            or not isinstance(row.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"])):
        raise ValueError("The archive inventory needs each original byte count and SHA256.")
    return {"path": _name(row.get("path")), "bytes": row["bytes"], "sha256": row["sha256"]}


def _inventory(path):
    with path.open("rb") as stream:
        raw = stream.read(INVENTORY_LIMIT + 1)
    if len(raw) > INVENTORY_LIMIT:
        raise ValueError("The source archive inventory exceeds 4 MiB.")
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("schema") != "commons.artifacts/v1":
        raise ValueError("Choose a commons.artifacts/v1 source archive inventory.")
    return value, hashlib.sha256(raw).hexdigest()


class IncludedSourceArchives:
    def __init__(self, operator, fault, application, source_roots=()):
        self.operator, self.Fault = operator, fault
        self.application = Path(application).resolve()
        self.source_roots = tuple(source_roots)
        self.records = {}

    def _candidates(self):
        seen = set()
        for base, origin, configured in [
                (self.application, "Included with this application", False),
                *((Path(root).expanduser(), "Configured source", True) for root in self.source_roots)]:
            if base.is_file():
                paths = [base] if base.name == "artifacts.json" or base.name.endswith("-artifacts.json") else []
            else:
                paths = [base / name for name in BUNDLED_SOURCE_ARCHIVE_INVENTORIES]
                if configured and base.is_dir():
                    paths.extend(sorted(base.glob("*-artifacts.json")))
                    paths.append(base / "artifacts.json")
            for path in paths:
                resolved = path.resolve()
                if resolved in seen or not resolved.is_file():
                    continue
                # A configured inventory file explicitly selects its parent edition;
                # a configured directory cannot redirect discovery outside that root.
                root = base.parent.resolve() if base.is_file() else base.resolve()
                if not resolved.is_relative_to(root):
                    continue
                seen.add(resolved)
                yield resolved, origin

    def discover(self):
        records, editions, issues = {}, [], []
        for path, origin in self._candidates():
            try:
                value, inventory_sha = _inventory(path)
                if value.get("archive") is None:
                    continue
                archive = _identity(value["archive"])
                if PurePosixPath(archive["path"]).suffix.lower() != ".zip":
                    raise ValueError("Included source archives must be original ZIP files.")
                manifest_member = _name(value["archive"].get("manifest_member"))
                files = value.get("files")
                if not isinstance(files, list) or not files or len(files) > MEMBER_LIMIT:
                    raise ValueError("The archive inventory must list its original source members.")
                members = {}
                for item in files:
                    member = _identity(item)
                    prior = members.setdefault(member["path"], member)
                    if prior != member:
                        raise ValueError("The archive inventory repeats a member with a different identity.")
                if manifest_member not in members:
                    raise ValueError("The selected import manifest needs a byte-bound inventory entry.")
                root = path.parent.resolve()
                target = (root / archive["path"]).resolve()
                if not target.is_relative_to(root):
                    raise ValueError("The included archive resolves outside its selected source edition.")
                problems = []
                try:
                    if not target.is_file():
                        raise ValueError("The included ZIP is missing. Restore this complete source edition.")
                    if target.stat().st_size != archive["bytes"]:
                        raise ValueError("The installed ZIP size differs from its declared original.")
                    if archive["bytes"] > self.operator.upload_limit:
                        raise ValueError("This ZIP exceeds the operator's selected upload capacity.")
                except OSError as error:
                    problems.append({"member": archive["path"], "reason": str(error)})
                except ValueError as error:
                    problems.append({"member": archive["path"], "reason": str(error)})
                key = digest({"inventory": str(path), "sha256": inventory_sha,
                              "archive": archive, "manifest_member": manifest_member})
                title = value.get("title")
                if not isinstance(title, str) or not title.strip():
                    title = PurePosixPath(archive["path"]).name
                record = {
                    "archive_id": key, "inventory_path": str(path), "inventory_sha256": inventory_sha,
                    "archive_path": str(target), "archive": archive,
                    "manifest_member": manifest_member, "manifest": members[manifest_member],
                    "title": title,
                }
                records[key] = record
                editions.append({
                    "archive_id": key, "registered_id": None, "source_kind": "included_archive",
                    "manifest_sha256": members[manifest_member]["sha256"],
                    "manifest_name": manifest_member, "title": title, "origin": origin,
                    "archive_name": archive["path"], "archive_bytes": archive["bytes"],
                    "archive_sha256": archive["sha256"],
                    "inventory_name": path.name, "entry_count": None,
                    "member_count": len(members), "reports": [], "documents": [],
                    "source_ids": [item for item in (value.get("source_id"), value.get("interactive_source_id"))
                                   if isinstance(item, str) and item],
                    "regional_context": False, "vintages": [], "ready": not problems,
                    "problems": problems,
                })
            except (OSError, ValueError, TypeError, KeyError) as error:
                issues.append({"manifest": path.name, "reason": str(error)})
        self.records = records
        return editions, issues

    def preview(self, workspace, archive_id):
        if not isinstance(archive_id, str) or not re.fullmatch(r"[0-9a-f]{64}", archive_id):
            raise self.Fault("SOURCE_ARCHIVE_SELECTION", "Choose an included source archive.")
        record = self.records.get(archive_id)
        if record is None:
            raise self.Fault("SOURCE_ARCHIVE_SELECTION",
                             "Refresh the available editions and choose an included source archive.", 404)
        # Match the existing registered-source authorization for server-owned files.
        context = self.operator.team.current()
        if context:
            self.operator.team.require(context["principal"], administrator=True)
            if context["workspace"] != workspace:
                raise self.Fault("SOURCE_ARCHIVE_WORKSPACE", "Preview the archive in the selected Workspace.", 409)
        self.operator.ws(workspace)
        try:
            unused, current_sha = _inventory(Path(record["inventory_path"]))
            if current_sha != record["inventory_sha256"]:
                raise ValueError("The archive inventory changed. Refresh and select its current edition.")
            root = Path(record["inventory_path"]).parent.resolve()
            path = (root / record["archive"]["path"]).resolve(strict=True)
            if not path.is_relative_to(root) or str(path) != record["archive_path"]:
                raise ValueError("The included archive location changed. Refresh its source edition.")
            with path.open("rb") as stream:
                before = os.fstat(stream.fileno())
                if before.st_size != record["archive"]["bytes"]:
                    raise ValueError("The included ZIP size changed. Restore or refresh the source edition.")
                upload = self.operator.receive_upload(
                    stream, record["archive"]["bytes"], quote(path.name, safe=""), "application/zip")
                after = os.fstat(stream.fileno())
                if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                        after.st_size, after.st_mtime_ns, after.st_ino):
                    raise ValueError("The included ZIP changed during preview. Refresh and try again.")
            if any(upload.get(key) != record["archive"][key] for key in ("bytes", "sha256")):
                raise ValueError("The included ZIP bytes differ from their declared original. Restore this edition.")
            preview = self.operator.preview_source({
                "upload_id": upload["id"], "manifest_member": record["manifest_member"],
            })
            if (preview.get("kind") != "archive"
                    or preview.get("manifest_member") != record["manifest_member"]
                    or preview.get("manifest_sha256") != record["manifest"]["sha256"]
                    or preview.get("archive_sha256") != record["archive"]["sha256"]):
                raise ValueError("The archive's import manifest differs from the declared original edition.")
            return {"workspace_key": workspace, "archive_id": archive_id,
                    "archive": {key: upload[key] for key in ("id", "filename", "bytes", "sha256")},
                    "preview": preview}
        except self.Fault:
            raise
        except (OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile) as error:
            raise self.Fault("SOURCE_ARCHIVE_PREVIEW", str(error), 409) from error
