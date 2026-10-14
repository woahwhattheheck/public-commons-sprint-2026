"""Receive the original complete Community33 report handover as scientific source.

This helper is used by the existing Community receiving course while its parent
holds the original operation lease. It retains the exact completed source
archive; it does not create Community table/plan/report registry records.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

from model import community_report_context, community_report_handover
from model.portable_fs import (native_path as _native_fs_path,
                               sync_directory as _sync_directory, publish_file as publish_new,
                               open_file, fd_stat, path_stat)

PACKAGE_BYTES = 270296
PACKAGE_SHA256 = "dd952535cc715a9a12aa2f665c5cddae0878dcb55d11792cd70e8cdbd1cc685e"
ORIGINAL_PROJECT_ID = "1c9d74a3-b813-4ef4-9db3-4a40cfb124f7"
REPORT_ID = "153c431c1617bf3d47195fea1c83dd9d455c5ba28fa484ca78fa00f3ab098e91"
PLAN_ID = "d35858b2c34b63c48b5bb2c0298ce94bfe7c19f8ebb4100e7506be3ca6c608ba"
TABLE_ID = "48b8e3a03030c9575c8d3fb7a356ee886d8198274a0995760df7802286e04285"
REPORT_ARCHIVE_BYTES = 29241
REPORT_ARCHIVE_SHA256 = "8d7b0264b40c074e930073831b64e44a7e403a438fdb95f7e44cf78418606bff"
REPORT_RECORD_BYTES = 7691
REPORT_RECORD_SHA256 = "a907b7f38e1b0b226b9be3deba5abc11a0f38301812adb8a5ad77aca6cd3dd77"


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _read(path, expected_bytes=None, expected_sha256=None):
    path = Path(path).absolute()
    descriptor = open_file(path, os.O_RDONLY)
    with os.fdopen(descriptor, "rb") as stream:
        before = fd_stat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Receive the original as a regular file: " + str(path))
        if expected_bytes is not None and before.st_size != expected_bytes:
            raise ValueError("The original byte count changed: " + str(path))
        body = stream.read()
        if (_identity(fd_stat(stream.fileno())) != _identity(before)
                or _identity(path_stat(path)) != _identity(before)):
            raise ValueError("The original changed during receiving: " + str(path))
    if expected_sha256 is not None and _sha(body) != expected_sha256:
        raise ValueError("The complete original SHA256 changed: " + str(path))
    return body


def _json(body):
    def pairs(items):
        result = {}
        for name, value in items:
            if name in result:
                raise ValueError("The original JSON repeats a property: " + name)
            result[name] = value
        return result
    def invalid(value):
        raise ValueError("The original JSON contains a nonfinite number: " + value)
    return json.loads(body.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=invalid)


def _packed(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       indent=2, allow_nan=False) + "\n").encode("utf-8")


def _name(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or "\x00" in value or value.startswith("/")
            or ":" in value.split("/", 1)[0]):
        raise ValueError("Keep the complete original relative ZIP member name")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Keep each original ZIP member inside its receiving root")
    relative = PurePosixPath(value)
    if relative.as_posix() != value:
        raise ValueError("The original ZIP member name is not canonical")
    return relative


def _directory(root, relative=()):
    current = root
    if current.is_symlink():
        raise ValueError("The selected original input directory is a symlink")
    current.mkdir(parents=True, exist_ok=True)
    if not current.is_dir():
        raise ValueError("Select the original receiving output directory")
    for component in relative:
        current = current / component
        if current.is_symlink():
            raise ValueError("An original input directory is a symlink")
        current.mkdir(exist_ok=True)
        if not current.is_dir():
            raise ValueError("An original input path collides with a file")
    return current


def _retain(root, relative, body):
    name = _name(relative)
    parent = _directory(root, name.parts[:-1])
    destination = parent / name.name
    if destination.exists() or destination.is_symlink():
        if _read(destination, len(body), _sha(body)) != body:
            raise ValueError("An existing original input differs")
        return destination
    temporary = None
    try:
        # Keep an interrupted temporary write outside the frozen original-member
        # directory, so it cannot prevent continuation of the same selected input.
        staging = _directory(root.parent, (".community-input-staging",))
        with tempfile.NamedTemporaryFile(dir=_native_fs_path(staging), prefix=".community-input-",
                                         delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            publish_new(temporary, destination)
        except FileExistsError:
            if _read(destination, len(body), _sha(body)) != body:
                raise ValueError("An original input was concurrently changed")
        _sync_directory(parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return destination


def _descriptor(path):
    path = Path(path).absolute()
    body = _read(path)
    return {"path": str(path), "bytes": len(body), "sha256": _sha(body)}


def _inventory(root, expected):
    for directory, subdirectories, files in os.walk(root, followlinks=False):
        for name in subdirectories:
            if (Path(directory) / name).is_symlink():
                raise ValueError("Keep the original input directories unchanged")
        for name in files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if relative not in expected:
                raise ValueError("The selected input directory contains an unrelated file: " + relative)
            if path.is_symlink():
                raise ValueError("An original input member is a symlink")


def prepare_archive_input(workspace, package_path, output):
    """Retain Community33 and return its full native scientific-source handover.

    The caller owns its existing operation lease and an actual Workspace. All
    application/source editions, browser/server lifetimes and final backup stay
    in the original receiving course. Reopening reuses exact completed inputs.
    """
    package_body = _read(package_path, PACKAGE_BYTES, PACKAGE_SHA256)
    members = []
    with zipfile.ZipFile(io.BytesIO(package_body)) as bundle:
        entries = bundle.infolist()
        if len(entries) != 33:
            raise ValueError("Receive all 33 members of the original complete package")
        names = set()
        for member in entries:
            relative = _name(member.filename)
            mode = member.external_attr >> 16
            if (member.is_dir() or member.flag_bits & 1
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
                    or member.filename in names):
                raise ValueError("Retain each original regular ZIP member exactly once")
            names.add(member.filename)
            # Reading to EOF verifies the original member CRC as well.
            body = bundle.read(member)
            if len(body) != member.file_size:
                raise ValueError("An original member is incomplete")
            members.append({"name": relative.as_posix(), "body": body,
                            "bytes": len(body), "sha256": _sha(body)})
        for name in names:
            if any("/".join(name.split("/")[:index]) in names
                   for index in range(1, len(name.split("/")))):
                raise ValueError("Original archive members collide as file and directory")

    def selected(size, checksum, label):
        matches = [item for item in members
                   if item["bytes"] == size and item["sha256"] == checksum]
        if len(matches) != 1:
            raise ValueError("Select exactly one original " + label)
        return matches[0]

    archive_member = selected(REPORT_ARCHIVE_BYTES, REPORT_ARCHIVE_SHA256,
                              "Community report ZIP")
    record_member = selected(REPORT_RECORD_BYTES, REPORT_RECORD_SHA256,
                             "saved revised report")
    report = _json(record_member["body"])
    if (report.get("id") != REPORT_ID or report.get("plan_id") != PLAN_ID
            or report.get("table_id") != TABLE_ID):
        raise ValueError("The completed original report/plan/table selection changed")
    payload_descriptor = report["files"]["community-report.json"]
    if (report["files"]["community-report.zip"]["bytes"] != REPORT_ARCHIVE_BYTES
            or report["files"]["community-report.zip"]["sha256"] != REPORT_ARCHIVE_SHA256):
        raise ValueError("The original saved report selects a different report ZIP")
    with zipfile.ZipFile(io.BytesIO(archive_member["body"])) as report_bundle:
        payload_entries = [item for item in report_bundle.infolist()
                           if item.filename == "community-report.json"]
        if len(payload_entries) != 1:
            raise ValueError("Retain the unique complete original report JSON")
        payload_body = report_bundle.read(payload_entries[0])
    if (len(payload_body) != payload_descriptor["bytes"]
            or _sha(payload_body) != payload_descriptor["sha256"]):
        raise ValueError("The original full report JSON changed")
    payload = _json(payload_body)
    if (payload.get("plan", {}).get("id") != PLAN_ID
            or payload.get("original_table", {}).get("id") != TABLE_ID):
        raise ValueError("The original report payload selects different native records")

    selection = {
        "schema": "upstate.community-archive-input/v1",
        "package": {"bytes": PACKAGE_BYTES, "sha256": PACKAGE_SHA256},
        "original_project_id": ORIGINAL_PROJECT_ID,
        "report_id": REPORT_ID, "plan_id": PLAN_ID, "table_id": TABLE_ID,
        "report_sha256": payload_descriptor["sha256"],
        "report_archive": {"bytes": REPORT_ARCHIVE_BYTES,
                           "sha256": REPORT_ARCHIVE_SHA256},
        "report_record": {"bytes": REPORT_RECORD_BYTES,
                          "sha256": REPORT_RECORD_SHA256},
    }
    output = Path(output).absolute()
    if output.is_symlink():
        raise ValueError("Keep the original receiving output as a real directory")
    original = output / "original-community-input"
    expected = {"community-complete-receiving-20261013.zip", "selection.json"}
    expected.update("members/" + item["name"] for item in members)
    _directory(original)
    _inventory(original, expected)
    package = _retain(original, "community-complete-receiving-20261013.zip",
                      package_body)
    _retain(original, "selection.json", _packed(selection))
    retained = []
    for item in members:
        path = _retain(original, "members/" + item["name"], item["body"])
        retained.append({"member": item["name"], **_descriptor(path)})
    report_archive = original / "members" / archive_member["name"]
    report_record = original / "members" / record_member["name"]

    # This original engine verifies the report's own identity, all inner member
    # hashes, previous plan, table and scientific context without importing any
    # fabricated Community registry records or registering a source yet.
    prepared = community_report_context.prepare_archive(
        workspace, report_archive, report_record,
        original_project_id=ORIGINAL_PROJECT_ID,
        report_sha256=payload_descriptor["sha256"], import_source=False)
    handover_result = community_report_handover.export_archive(
        workspace, report_archive, report_record,
        original_project_id=ORIGINAL_PROJECT_ID,
        report_sha256=payload_descriptor["sha256"])
    offered = handover_result["files"]
    if len(offered) != 1:
        raise ValueError("Retain the original native source-handover ZIP")
    offered_path = workspace.root / _name(offered[0]["path"])
    handover = _descriptor(offered_path)
    if (handover["bytes"] != offered[0]["bytes"]
            or handover["sha256"] != offered[0]["sha256"]):
        raise ValueError("The original generated source handover changed")
    summary = community_report_handover.inspect_archive(
        offered_path, expected_sha256=handover["sha256"])
    if (summary.get("original_project_id") != ORIGINAL_PROJECT_ID
            or summary.get("report_id") != REPORT_ID
            or summary.get("report_sha256") != payload_descriptor["sha256"]):
        raise ValueError("The native handover selected another Community report")
    _inventory(original, expected)
    return json.loads(json.dumps({
        "selection": selection, "report": report, "payload": payload,
        "package": _descriptor(package),
        "report_archive": _descriptor(report_archive),
        "report_record": _descriptor(report_record),
        "handover": handover, "handover_summary": summary,
        "prepared": prepared, "members": retained,
    }, ensure_ascii=False, allow_nan=False))
