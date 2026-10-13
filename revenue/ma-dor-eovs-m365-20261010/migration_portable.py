#!/usr/bin/env python3
"""Complete, editable migration-workbench delivery using the original SQLite store."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import uuid
import zipfile

from migration_store import MigrationError, identifier, integer, identity as core_identity, text as core_text, describe_backup

SCHEMA = "commons.migration-workbench-delivery/v1"
READY_SCHEMA = "commons.migration-workbench-receiving/v1"
HASH = re.compile(r"^[0-9a-f]{64}$")
LEGACY_APPLICATION_FILES = (
    "audit.mjs", "audit.test.mjs", "README.md",
    "migration_store.py", "migration_formats.py", "migration_reconcile.py",
    "migration_workspace.py", "migration_cli.py", "migration_server.py",
    "migration_portable.py", "migration_reports.py", "OPERATING_WORKBENCH.md", "MIGRATION_CORE.md",
    "public/migration-index.html", "public/migration-style.css",
    "public/migration-app.js",
)
APPLICATION_PROFILE = "commons.case-migration-application/v1"
APPLICATION_FILES = LEGACY_APPLICATION_FILES + (
    "migration_cases.py", "CASE_MIGRATION.md", "CASE_RECEIVING.md", "case_receiving.py",
    "public/migration-cases.js",
)
BLOCK = 1024 * 1024


def application_selection(entries, *, profile=None):
    """Keep old complete deliveries executable without rewriting their source edition."""
    names = [entry.get("path") for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError("Frozen application inventory repeats a path")
    actual = set(names)
    legacy = {"application/" + name for name in LEGACY_APPLICATION_FILES}
    current = {"application/" + name for name in APPLICATION_FILES}
    if profile == APPLICATION_PROFILE and actual == current:
        return APPLICATION_PROFILE
    if profile is None and actual == legacy:
        return None
    raise ValueError("Frozen application inventory/profile is not one complete supported edition")


def captured_application_selection(entries):
    # A prepare started before this extension keeps its original complete roster.
    # New prepares always freeze APPLICATION_FILES before their reservation.
    names = {entry.get("path") for entry in entries}
    profile = APPLICATION_PROFILE if names == {"application/" + name for name in APPLICATION_FILES} else None
    return application_selection(entries, profile=profile)



def digest(path):
    value = hashlib.sha256()
    count = 0
    with Path(path).open("rb") as stream:
        for part in iter(lambda: stream.read(BLOCK), b""):
            count += len(part)
            value.update(part)
    return {"bytes": count, "sha256": value.hexdigest()}


def ordinary_directory(path, *, create=False):
    path = Path(path).expanduser().absolute()
    for item in reversed((path, *path.parents)):
        if item.is_symlink() or (item.exists() and not item.is_dir()):
            raise ValueError("Directory must use ordinary filesystem paths")
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise ValueError("Directory does not exist")
    return path


def member_name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value or ":" in value:
        raise ValueError("Invalid archive path")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Archive path must be an ordinary relative path")
    return str(pure)


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sync_parent(path):
    directory = os.open(Path(path).parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def retire_published_duplicate(temporary, published):
    """Only discard an independently verified complete local publication copy."""
    if temporary.exists() and published.is_file() and not published.is_symlink():
        if digest(temporary) == digest(published):
            temporary.unlink()
            sync_parent(published)


def publish_bytes(path, content):
    """Publish complete owned bytes; retain any failed original attempt."""
    path = Path(path)
    if path.is_symlink():
        raise ValueError("File must be ordinary")
    if path.exists():
        if not path.is_file() or path.read_bytes() != content:
            raise ValueError("Existing retained file differs")
        sync_parent(path)
        return
    temporary = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    with temporary.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.link(temporary, path)
    except FileExistsError:
        if path.is_symlink() or path.read_bytes() != content:
            raise ValueError("Concurrent retained file differs")
    sync_parent(path)
    retire_published_duplicate(temporary, path)

def file_description(path, relative):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Delivery source must be an ordinary file: " + relative)
    return {"path": member_name(relative), **digest(path)}



def capture_file(source_path, target_path, relative, expected=None):
    source_path, target_path = Path(source_path), Path(target_path)
    ordinary_directory(target_path.parent, create=True)
    description = expected or file_description(source_path, relative)
    if description.get("path") != relative:
        raise ValueError("Frozen application inventory path differs")
    if target_path.exists():
        if target_path.is_symlink() or digest(target_path) != {k: description[k] for k in ("bytes", "sha256")}:
            raise ValueError("Previously captured application source differs: " + relative)
        sync_parent(target_path)
        return description
    ordinary_directory(source_path.parent)
    if file_description(source_path, relative) != description:
        raise ValueError("An uncopied original application source changed; preserve its original capture")
    temporary = target_path.with_name(target_path.name + ".pending-" + uuid.uuid4().hex)
    fd = os.open(source_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source, temporary.open("xb") as target:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("Application source must be an ordinary file")
        for part in iter(lambda: source.read(BLOCK), b""):
            target.write(part)
        target.flush()
        os.fsync(target.fileno())
    if digest(temporary) != {k: description[k] for k in ("bytes", "sha256")}:
        raise ValueError("Application source changed while being captured")
    try:
        os.link(temporary, target_path)
    except FileExistsError:
        if target_path.is_symlink() or digest(target_path) != digest(temporary):
            raise ValueError("Concurrent captured application differs")
    sync_parent(target_path)
    retire_published_duplicate(temporary, target_path)
    return description

def _manifest_from_archive(archive):
    infos = archive.infolist()
    names = [member_name(info.filename) for info in infos]
    if len(names) != len(set(names)):
        raise ValueError("Archive repeats a member")
    if "delivery.json" not in names:
        raise ValueError("Complete delivery manifest is missing")
    manifest_info = archive.getinfo("delivery.json")
    if manifest_info.file_size > 16 * 1024 * 1024:
        raise ValueError("Delivery manifest exceeds the documented manifest limit")
    raw = archive.read(manifest_info)
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Unsupported delivery format")
    if raw != canonical(value):
        raise ValueError("Delivery manifest is not its original canonical byte representation")
    entries = value.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Delivery contains no complete file inventory")
    profile = value.get("application_profile")
    roster = APPLICATION_FILES if profile == APPLICATION_PROFILE else LEGACY_APPLICATION_FILES
    if profile not in (None, APPLICATION_PROFILE):
        raise ValueError("Unsupported application source profile")
    expected = {"delivery.json"}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid delivery file descriptor")
        name = member_name(entry.get("path"))
        size = entry.get("bytes")
        if name in expected or not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ValueError("Duplicate or invalid delivery file descriptor")
        if not isinstance(entry.get("sha256"), str) or not HASH.fullmatch(entry["sha256"]):
            raise ValueError("Invalid complete file identity")
        if name.startswith("application/"):
            if name[len("application/"):] not in roster:
                raise ValueError("Unexpected application member")
        elif name.startswith("workspace/"):
            if name.startswith("workspace/deliveries/"):
                if not re.fullmatch(r"workspace/deliveries/[0-9a-f]{64}\.zip", name):
                    raise ValueError("Historical delivery path is not canonical")
            elif name != "workspace/workspace.sqlite3":
                sha = entry["sha256"]
                if name != "workspace/objects/" + sha[:2] + "/" + sha:
                    raise ValueError("Original object member is not canonical")
        elif name.startswith("reports/"):
            parts = PurePosixPath(name).parts
            if len(parts) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]+\.(?:html|csv|ndjson)", parts[1]):
                raise ValueError("Unexpected report member")
        else:
            raise ValueError("Unexpected delivery subtree")
        expected.add(name)
    if expected != set(names):
        raise ValueError("Archive members do not match the complete manifest")
    for info in infos:
        mode = info.external_attr >> 16
        if info.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
            raise ValueError("Only ordinary files are supported")
        if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise ValueError("Unsupported encrypted or compressed archive member")
    application_selection([entry for entry in entries if entry["path"].startswith("application/")], profile=profile)
    required = {"application/" + name for name in roster}
    required.add("workspace/workspace.sqlite3")
    required.add("reports/review.html")
    if not required.issubset(expected):
        raise ValueError("Complete application or editable database is missing")
    return value, raw


def inspect_delivery(path, *, verify=True):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Delivery ZIP must be an ordinary file")
    archive_identity = digest(path)
    with zipfile.ZipFile(path) as archive:
        manifest, raw = _manifest_from_archive(archive)
        for entry in manifest["files"]:
            info = archive.getinfo(entry["path"])
            if info.file_size != entry["bytes"]:
                raise ValueError("Archive member size differs: " + entry["path"])
            if verify:
                count = 0
                value = hashlib.sha256()
                with archive.open(info) as stream:
                    for part in iter(lambda: stream.read(BLOCK), b""):
                        count += len(part)
                        if count > entry["bytes"]:
                            raise ValueError("Archive member exceeds its recorded size")
                        value.update(part)
                if count != entry["bytes"] or value.hexdigest() != entry["sha256"]:
                    raise ValueError("Archive member content differs: " + entry["path"])
    return {"archive": {"path": str(path), **archive_identity},
            "manifest_sha256": hashlib.sha256(raw).hexdigest(), "manifest": manifest}


class PortableService:
    """Use the original operation reservation, original backup, and original entities."""

    def __init__(self, workspace, directory, application_root):
        self.workspace = workspace
        self.directory = ordinary_directory(directory)
        self.application_root = ordinary_directory(application_root)
        self.delivery_root = ordinary_directory(self.directory / "deliveries", create=True)
        self.work_root = ordinary_directory(self.directory / "delivery-work", create=True)

    def prepare(self, payload):
        # Capture under the original reentrant mutex before reservation changes
        # the project revision. A registered export always has its original
        # complete snapshot, including every staged-file table entry.
        if not isinstance(payload, dict):
            raise MigrationError("INVALID_PAYLOAD", "Delivery request must be an object")
        operation_id = identifier(payload.get("operation_id"), "operation_id")
        expected = integer(payload.get("expected_revision"), "expected_revision")
        core_text(payload.get("actor"), "actor", max_length=512)
        core_text(payload.get("title", "Migration workbench handover"), "title")
        if not isinstance(payload.get("note", ""), str) or len(payload.get("note", "")) > 65536:
            raise ValueError("Handover note must be text of at most 65,536 characters")
        request_sha = core_identity({"operation": "delivery.prepare",
            "payload": {k: v for k, v in payload.items() if k not in ("operation_id", "expected_revision")}})
        token = hashlib.sha256(operation_id.encode("utf-8")).hexdigest()
        with self.workspace._mutex:
            prior = self.workspace._operation(operation_id, required=False)
            if prior:
                return self.workspace.execute("delivery.prepare", payload, self._prepare)
            if self.workspace.project["revision"] != expected:
                raise MigrationError("REVISION_CONFLICT", "Workspace changed before the delivery capture",
                                     {"actual_revision": self.workspace.project["revision"]})
            job = ordinary_directory(self.work_root / token, create=True)
            capture = {"schema": "commons.migration-delivery-capture/v1",
                       "operation_id": operation_id, "request_sha256": request_sha,
                       "source_revision": expected}
            publish_bytes(job / "capture-intent.json", canonical(capture))
            snapshot_path = job / "workspace.sqlite3"
            snapshot = (self.workspace.describe_backup(snapshot_path) if snapshot_path.exists()
                        else self.workspace.backup_to(snapshot_path))
            if snapshot["revision"] != expected:
                raise ValueError("Existing capture belongs to another selected source revision")
            publish_bytes(job / "snapshot.json", canonical(snapshot))
            application_intent = job / "application-intent.json"
            if application_intent.exists():
                application = json.loads(application_intent.read_text())
            else:
                application = [file_description(self.application_root / relative,
                               "application/" + relative) for relative in APPLICATION_FILES]
                publish_bytes(application_intent, canonical(application))
            captured_application_selection(application)
            for entry in application:
                relative = member_name(entry["path"])
                capture_file(self.application_root / relative[len("application/"):],
                             job / relative, relative, expected=entry)
            publish_bytes(job / "application.json", canonical(application))
            if (job / "reports.json").exists():
                report_files = json.loads((job / "reports.json").read_text())
                for entry in report_files:
                    if file_description(job / member_name(entry["path"]), entry["path"]) != entry:
                        raise ValueError("Frozen review report changed")
            else:
                from migration_reports import build_reports
                report_names = build_reports(self.workspace, job / "reports",
                    source_revision=expected, title=payload.get("title", "Migration workbench handover"),
                    note=payload.get("note", ""))
                report_files = [file_description(job / "reports" / name, "reports/" + name)
                                for name in report_names]
                publish_bytes(job / "reports.json", canonical(report_files))
            return self.workspace.execute("delivery.prepare", payload, self._prepare)

    def resume(self, payload):
        result = self.workspace.dispatch("operation.get", {"id": payload.get("target_operation_id")})
        original = result.get("operation")
        if not result.get("found") or not original:
            raise ValueError("Original delivery operation was not found")
        if original["operation"] != "delivery.prepare":
            raise ValueError("Selected original operation is not a delivery")
        return self.workspace.resume_original(original["id"], actor=payload.get("actor"),
            reason=payload.get("reason"), expected_revision=payload.get("expected_revision"),
            handler=self._prepare)

    def _prepare(self, operation):
        request = operation["request"]
        operation_id = operation["id"]
        token = hashlib.sha256(operation_id.encode("utf-8")).hexdigest()
        delivery_id = "delivery-" + token[:24]
        job = ordinary_directory(self.work_root / token, create=True)
        destination = self.delivery_root / (token + ".zip")
        intent = {
            "schema": "commons.migration-delivery-intent/v1",
            "operation_id": operation_id,
            "request_sha256": operation["request_sha256"],
            "reserved_revision": operation["reserved_revision"],
            "delivery_id": delivery_id,
        }
        publish_bytes(job / "intent.json", canonical(intent))
        if destination.exists():
            verified = inspect_delivery(destination)
            manifest = verified["manifest"]
            if manifest.get("operation_id") != operation_id or manifest.get("request_sha256") != operation["request_sha256"]:
                raise ValueError("Existing delivery belongs to a different original request")
            sync_parent(destination)
            return self._record(operation, delivery_id, verified)

        snapshot_path = job / "workspace.sqlite3"
        capture = json.loads((job / "capture-intent.json").read_text())
        if capture.get("operation_id") != operation_id or capture.get("request_sha256") != operation["request_sha256"]:
            raise ValueError("Original captured delivery request differs")
        snapshot = self.workspace.describe_backup(snapshot_path)
        if snapshot["revision"] != capture["source_revision"] or snapshot["revision"] != request["expected_revision"]:
            raise ValueError("Retained snapshot is not the original selected workspace revision")
        publish_bytes(job / "snapshot.json", canonical(snapshot))

        files = []
        paths = {}
        application = json.loads((job / "application.json").read_text())
        application_profile = captured_application_selection(application)
        reports = json.loads((job / "reports.json").read_text())
        for captured in application + reports:
            name = member_name(captured["path"])
            original = job / name
            description = file_description(original, name)
            if description != captured:
                raise ValueError("Frozen application or review report differs")
            files.append(description)
            paths[name] = original
        database = file_description(snapshot_path, "workspace/workspace.sqlite3")
        if {k: database[k] for k in ("bytes", "sha256")} != {k: snapshot[k] for k in ("bytes", "sha256")}:
            raise ValueError("Retained original database snapshot changed")
        files.append(database)
        paths[database["path"]] = snapshot_path
        seen = set()
        for record in snapshot["files"]:
            sha = record["sha256"]
            if not isinstance(sha, str) or not HASH.fullmatch(sha) or sha in seen:
                raise ValueError("Frozen source-object inventory is invalid")
            seen.add(sha)
            relative = "objects/" + sha[:2] + "/" + sha
            if record["relative_path"] != relative:
                raise ValueError("Frozen source object has an unexpected path")
            original = self.directory / relative
            ordinary_directory(original.parent)
            description = file_description(original, "workspace/" + relative)
            if description["sha256"] != sha or description["bytes"] != record["bytes"]:
                raise ValueError("An original source file differs from the frozen database")
            files.append(description)
            paths[description["path"]] = original
        for record in snapshot.get("deliveries", []):
            if record.get("status") != "complete":
                continue
            relative = member_name(record.get("relative_path"))
            if not re.fullmatch(r"deliveries/[0-9a-f]{64}\.zip", relative):
                raise ValueError("Frozen historical delivery has an invalid original path")
            original = self.directory / relative
            ordinary_directory(original.parent)
            description = file_description(original, "workspace/" + relative)
            if description["bytes"] != record["archive_bytes"] or description["sha256"] != record["archive_sha256"]:
                raise ValueError("An original completed delivery differs from its frozen database record")
            files.append(description)
            paths[description["path"]] = original
        files.sort(key=lambda entry: entry["path"])
        manifest = {
            "schema": SCHEMA, "id": delivery_id, "operation_id": operation_id,
            "request_sha256": operation["request_sha256"],
            "created_at": operation["created_at"],
            "title": request.get("title", "Migration workbench handover"),
            "note": request.get("note", ""),
            "workspace_id": snapshot["workspace_id"], "revision": snapshot["revision"],
            "scope": "Complete editable workspace, original source files, decisions, operation history and application",
            "database": {"path": database["path"], "bytes": database["bytes"], "sha256": database["sha256"]},
            "application_entrypoint": "application/migration_server.py",
            "files": files,
        }
        if application_profile is not None:
            manifest["application_profile"] = application_profile
        manifest_bytes = canonical(manifest)
        publish_bytes(job / "delivery.json", manifest_bytes)
        temporary = destination.with_name(destination.name + ".pending-" + uuid.uuid4().hex)
        published = False
        try:
            with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                archive.writestr("delivery.json", manifest_bytes)
                for entry in files:
                    info = zipfile.ZipInfo(entry["path"])
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    value = hashlib.sha256()
                    count = 0
                    with paths[entry["path"]].open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                        for part in iter(lambda: source.read(BLOCK), b""):
                            value.update(part)
                            count += len(part)
                            target.write(part)
                    if count != entry["bytes"] or value.hexdigest() != entry["sha256"]:
                        raise ValueError("Source changed during complete delivery: " + entry["path"])
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
            verified = inspect_delivery(temporary)
            try:
                os.link(temporary, destination)
            except FileExistsError:
                if digest(destination) != digest(temporary):
                    raise ValueError("Concurrent complete delivery differs")
            sync_parent(destination)
            published = True
        finally:
            if published:
                retire_published_duplicate(temporary, destination)
        verified["archive"]["path"] = str(destination)
        return self._record(operation, delivery_id, verified)

    def _record(self, operation, delivery_id, verified):
        manifest = verified["manifest"]
        receipt = {
            "id": delivery_id, "operation_id": operation["id"],
            "title": manifest["title"], "note": manifest["note"],
            "workspace_id": manifest["workspace_id"], "revision": manifest["revision"],
            "created_at": manifest["created_at"], "status": "complete",
            "archive_sha256": verified["archive"]["sha256"],
            "archive_bytes": verified["archive"]["bytes"],
            "manifest_sha256": verified["manifest_sha256"],
            "file_count": len(manifest["files"]),
            "filename": "Migration_Workbench_" + delivery_id + ".zip",
            "relative_path": "deliveries/" + Path(verified["archive"]["path"]).name,
        }
        self.workspace.put_entity("delivery", delivery_id, receipt, operation["reserved_revision"])
        return receipt

    def open_delivery(self, identifier):
        record = self.workspace.get_entity("delivery", identifier)
        if not record or record.get("status") != "complete":
            raise KeyError("Complete delivery not found")
        relative = member_name(record["relative_path"])
        if not relative.startswith("deliveries/") or len(PurePosixPath(relative).parts) != 2:
            raise ValueError("Delivery path is invalid")
        path = self.directory / relative
        ordinary_directory(path.parent)
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        stream = os.fdopen(fd, "rb")
        try:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("Complete delivery must be an ordinary file")
            actual = hashlib.sha256()
            count = 0
            for part in iter(lambda: stream.read(BLOCK), b""):
                actual.update(part)
                count += len(part)
            if count != record["archive_bytes"] or actual.hexdigest() != record["archive_sha256"]:
                raise ValueError("Complete delivery artifact differs")
            stream.seek(0)
            return record, stream
        except BaseException:
            stream.close()
            raise


def _copy_member(archive, entry, destination):
    target = destination / member_name(entry["path"])
    ordinary_directory(target.parent, create=True)
    if target.is_symlink():
        raise ValueError("Receiving file must be ordinary")
    if target.exists():
        if not target.is_file() or digest(target) != {k: entry[k] for k in ("bytes", "sha256")}:
            raise ValueError("Existing receiving file differs: " + entry["path"])
        sync_parent(target)
        return
    temporary = target.with_name(target.name + ".pending-" + uuid.uuid4().hex)
    count = 0
    value = hashlib.sha256()
    with archive.open(entry["path"]) as source, temporary.open("xb") as output:
        for part in iter(lambda: source.read(BLOCK), b""):
            count += len(part)
            if count > entry["bytes"]:
                raise ValueError("Receiving file exceeds its recorded size")
            value.update(part)
            output.write(part)
        output.flush()
        os.fsync(output.fileno())
    if count != entry["bytes"] or value.hexdigest() != entry["sha256"]:
        raise ValueError("Receiving file identity differs")
    try:
        os.link(temporary, target)
    except FileExistsError:
        if target.is_symlink() or digest(target) != {k: entry[k] for k in ("bytes", "sha256")}:
            raise ValueError("Concurrent receiving file differs")
    sync_parent(target)
    retire_published_duplicate(temporary, target)


def validate_snapshot_closure(description, manifest):
    database = {"path": "workspace/workspace.sqlite3",
                "bytes": description["bytes"], "sha256": description["sha256"]}
    if manifest.get("database") != database:
        raise ValueError("Manifest database identity differs from the actual retained snapshot")
    expected = {database["path"]: database}
    for record in description["files"]:
        path = "workspace/" + member_name(record["relative_path"])
        expected[path] = {"path": path, "bytes": record["bytes"], "sha256": record["sha256"]}
    for record in description.get("deliveries", []):
        if record.get("status") != "complete":
            continue
        relative = member_name(record["relative_path"])
        if not re.fullmatch(r"deliveries/[0-9a-f]{64}\.zip", relative):
            raise ValueError("Historical delivery is outside its original directory")
        path = "workspace/" + relative
        if path in expected:
            raise ValueError("Snapshot repeats a complete historical delivery path")
        expected[path] = {"path": path, "bytes": record["archive_bytes"], "sha256": record["archive_sha256"]}
    actual = {entry["path"]: entry for entry in manifest["files"] if entry["path"].startswith("workspace/")}
    if actual != expected:
        raise ValueError("Delivery does not include the exact original snapshot object and historical archive closure")

def receive_delivery(archive_path, destination):
    """Restore the complete original workspace; a completed receiving keeps later edits."""
    verified = inspect_delivery(archive_path)
    manifest = verified["manifest"]
    destination = Path(destination).expanduser().absolute()
    existed = destination.exists()
    destination = ordinary_directory(destination, create=True)
    marker = destination / ".migration-receiving.json"
    ready_path = destination / "READY.json"
    database_marker = destination / ".migration-database-verified.json"
    intent = {
        "schema": READY_SCHEMA, "delivery_id": manifest["id"],
        "archive_sha256": verified["archive"]["sha256"],
        "manifest_sha256": verified["manifest_sha256"],
        "workspace_id": manifest["workspace_id"],
        "source_revision": manifest["revision"],
    }
    if existed and not marker.is_file():
        if any(destination.iterdir()):
            raise ValueError("Receiving destination already contains another workspace")
    publish_bytes(marker, canonical(intent))
    if ready_path.exists():
        if ready_path.is_symlink() or json.loads(ready_path.read_text()) != {**intent, "complete": True}:
            raise ValueError("Completed receiving identity differs")
        for entry in manifest["files"]:
            if entry["path"] == "workspace/workspace.sqlite3":
                continue
            path = destination / entry["path"]
            if path.is_symlink() or not path.is_file() or digest(path) != {k: entry[k] for k in ("bytes", "sha256")}:
                raise ValueError("Retained immutable receiving member differs: " + entry["path"])
        from migration_workspace import MigrationWorkspace
        workspace = MigrationWorkspace(destination / "workspace", create=False)
        try:
            state = workspace.dispatch("state", {})
            project = state["project"]
            actual_id = project.get("id", project.get("workspace_id"))
            if actual_id != manifest["workspace_id"]:
                raise ValueError("Reopened editable workspace identity differs")
        finally:
            workspace.close()
        return {**intent, "complete": True, "reopened": True, "edits_preserved": True,
                "destination": str(destination), "workspace": str(destination / "workspace")}
    database_intent = {**intent, "database": manifest["database"], "verified_before_first_open": True}
    database_previously_verified = database_marker.exists()
    if database_previously_verified:
        if database_marker.is_symlink() or json.loads(database_marker.read_text()) != database_intent:
            raise ValueError("Original receiving database continuation identity differs")
    with zipfile.ZipFile(archive_path) as archive:
        for entry in manifest["files"]:
            if database_previously_verified and entry["path"] == "workspace/workspace.sqlite3":
                continue
            _copy_member(archive, entry, destination)
    publish_bytes(destination / "delivery.json", canonical(manifest))
    if not database_previously_verified:
        snapshot_description = describe_backup(destination / "workspace/workspace.sqlite3")
        if snapshot_description["workspace_id"] != manifest["workspace_id"] or snapshot_description["revision"] != manifest["revision"]:
            raise ValueError("Original receiving snapshot identity differs")
        validate_snapshot_closure(snapshot_description, manifest)
        # Opening the original store can change SQLite journal headers before
        # READY is published. Keep a durable identity before that first open so
        # an interrupted receiver does not overwrite or reject its own database.
        publish_bytes(database_marker, canonical(database_intent))
    from migration_workspace import MigrationWorkspace
    workspace = MigrationWorkspace(destination / "workspace", create=False)
    try:
        if workspace.project["id"] != manifest["workspace_id"] or workspace.project["revision"] != manifest["revision"]:
            raise ValueError("Original receiving store changed the selected snapshot identity")
    finally:
        workspace.close()
    publish_bytes(ready_path, canonical({**intent, "complete": True}))
    return {**intent, "complete": True, "reopened": False, "edits_preserved": True,
            "destination": str(destination), "workspace": str(destination / "workspace")}



def prepare_delivery(workspace, payload):
    """Original dispatch facade; freeze first, then reserve exactly once."""
    return PortableService(workspace, workspace.root, Path(__file__).parent).prepare(payload)


def continue_delivery(workspace, original_op):
    """Original operation.resume handler; reuse its frozen capture."""
    return PortableService(workspace, workspace.root, Path(__file__).parent)._prepare(original_op)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Read and verify a complete delivery")
    inspect.add_argument("--archive", required=True)
    receive = commands.add_parser("receive", help="Receive the full editable workspace into a new directory")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--destination", required=True)
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            value = inspect_delivery(args.archive)
        else:
            value = receive_delivery(args.archive, args.destination)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
