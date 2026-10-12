"""Receive an existing finalized native room through the original data engines.

Host registration selects paths. Agent requests use a retained receiving ID.
The existing source alias table and import job remain the only analytical owners.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from .datasets import DatasetAcquisition, DatasetDelivery
from .errors import StateError
from .runtime import Runtime
from .storage import digest, parse, private_directory, read

_HASH = re.compile(r"[a-f0-9]{64}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_KIND = "finalized-dataset"
_FORMATS = {"SF100_SCAN", "SF88_SESSION"}


def _path(value):
    if (not isinstance(value, str) or "\0" in value or not os.path.isabs(value)
            or os.path.abspath(value) != value):
        raise StateError("ANALYSIS_FINALIZED_DATASET_PATH_INVALID")
    path = Path(value)
    if private_directory(path, create=False) != path:
        raise StateError("ANALYSIS_FINALIZED_DATASET_PATH_CHANGED")
    return path


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":"))


def _file(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_mode & 0o077 or before.st_uid != os.getuid()
                or before.st_size > maximum):
            raise StateError("ANALYSIS_FINALIZED_PRIVATE_FILE_REQUIRED")
        checksum, count = hashlib.sha256(), 0
        while block := stream.read(65536):
            checksum.update(block)
            count += len(block)
            if count > maximum:
                raise StateError("ANALYSIS_FINALIZED_FILE_TOO_LARGE")
        after = os.fstat(stream.fileno())
        if count != before.st_size or any(getattr(before, key) != getattr(after, key)
               for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")):
            raise StateError("ANALYSIS_FINALIZED_SOURCE_CHANGED")
    return {"path": str(path), "bytes": count, "sha256": checksum.hexdigest()}


def open_finalized(checkout, node, room, *, session=None):
    """Original direct SF100 scan/receiver, or original COMPLETE SF88 reopen."""
    room = _path(room)
    before = read(room / "manifest.json", 4 * 1024 * 1024)
    session_path = _path(session) if session is not None else None
    original_session = read(session_path / "session.json", 4 * 1024 * 1024) if session_path else None
    if session_path:
        acquisition = DatasetAcquisition(checkout=checkout, node=node, session=session_path)
        report = acquisition.inspect()
        if report.get("status") != "COMPLETE":
            raise StateError("ANALYSIS_COMPLETE_NATIVE_SESSION_REQUIRED")
        delivery = acquisition.deliver(room)
        if (delivery.native.get("resumed") is not True or delivery.native.get("appendedPages") != 0
                or delivery.native.get("sourceDirectory") != str(session_path)):
            raise StateError("ANALYSIS_EXISTING_FINALIZED_ROOM_REQUIRED")
        source_format = "SF88_SESSION"
    else:
        runtime = Runtime(checkout, node=node, timeout=360, output_limit=16_777_216)
        result = runtime.checked(["--room", room], target="finalized-dataset",
                                 mode="SF100_FINALIZED_SCAN")
        delivery = DatasetDelivery.from_finalized_scan(result["scan"])
        source_format = "SF100_SCAN"
    manifest_raw = delivery.file("manifest.json").read_bytes(limit=4 * 1024 * 1024)
    if (manifest_raw != before or read(room / "manifest.json", 4 * 1024 * 1024) != before
            or session_path and read(session_path / "session.json", 4 * 1024 * 1024) != original_session):
        raise StateError("ANALYSIS_FINALIZED_SOURCE_CHANGED")
    manifest = parse(manifest_raw)
    fields = manifest["dataset"]["projectedFields"]
    first = parse(read(room / "pages" / "00000.json", 2 * 1024 * 1024 + 4096))["payload"]
    columns = {column["name"]: column for column in first["dataset"]["columns"]}
    if any(field not in columns for field in fields):
        raise StateError("ANALYSIS_FINALIZED_COLUMNS_CHANGED")
    # Exact native archives let the receiving registry recheck an immutable room
    # without reparsing/re-executing a provider request on each small file read.
    archives = {"session.json": _file(room / "session.json", 4096)}
    for index in range(delivery.status["pages"]):
        name = f"pages/{index:05d}.json"
        archives[name] = _file(room / name, 2 * 1024 * 1024 + 4096)
    source_files = {}
    if session_path:
        source_files["session"] = _file(session_path / "session.json", 4 * 1024 * 1024)
        marker = room.parent / ("." + room.name + ".sf88-source.json")
        source_files["marker"] = _file(marker, 8192)
    original_identity = ({"sessionId": report["sessionId"],
                          "configurationSha256": report["configurationSha256"],
                          "sourceId": report["pages"][0]["datasetSha256"]}
                         if session_path else {"sourceId": digest(manifest_raw)})
    receipt = {"schema": "stellar-forge.finalized-dataset-receiving.v1",
               **original_identity,
               "sourceFormat": source_format, "room": str(room),
               "session": str(session_path) if session_path else None,
               "manifestSha256": digest(manifest_raw),
               "sourceBindingSha256": delivery.native["sourceBindingSha256"],
               "native": delivery.native, "archives": archives, "sourceFiles": source_files,
               "columns": [columns[field] for field in fields]}
    return delivery, receipt


def _expected(value):
    if (not isinstance(value, dict)
            or set(value) != {"sourceFormat", "sourceBindingSha256", "manifestSha256"}
            or value["sourceFormat"] not in _FORMATS
            or any(not isinstance(value[key], str) or not _HASH.fullmatch(value[key])
                   for key in ("sourceBindingSha256", "manifestSha256"))):
        raise StateError("ANALYSIS_FINALIZED_IDENTITY_REQUIRED")
    return value


def _bound(workspace, source):
    if workspace.checkout is None:
        raise StateError("ANALYSIS_ORIGINAL_RUNTIME_CHECKOUT_REQUIRED")
    expected = _expected(source["expected_native"])
    delivery, receipt = open_finalized(workspace.checkout, workspace.node, source["room"],
                                      session=source.get("session"))
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise StateError("ANALYSIS_FINALIZED_IDENTITY_CHANGED")
    return delivery, receipt


def register_finalized_source(workspace, body):
    """Authenticated route; keep the original source-alias revision transaction."""
    if (not isinstance(body, dict)
            or set(body) != {"name", "expected_revision", "room", "session", "expected_native"}
            or not isinstance(body["name"], str) or not _NAME.fullmatch(body["name"])
            or type(body["expected_revision"]) is not int or body["expected_revision"] < 0):
        raise StateError("ANALYSIS_FINALIZED_SOURCE_REQUEST_INVALID")
    expected = _expected(body["expected_native"])
    source = {"kind": _KIND, "name": body["name"], "room": str(_path(body["room"])),
              "session": str(_path(body["session"])) if body["session"] is not None else None,
              "source_format": expected["sourceFormat"], "expected_native": expected}
    delivery, receipt = _bound(workspace, source)
    source.update(native_status="COMPLETE", rows=delivery.status["rows"],
                  snapshot=delivery.status["snapshot"],
                  native_delivery={"schema": delivery.native["schema"],
                    "sourceBindingSha256": receipt["sourceBindingSha256"],
                    "manifestSha256": receipt["manifestSha256"],
                    "paymentStatus": delivery.payment_status,
                    **({"semantics": delivery.native["semantics"]} if delivery.native.get("semantics") else {})},
                  registered_at=datetime.now(timezone.utc).isoformat())
    with workspace.database._connection() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT revision,record FROM sf_analysis_sources WHERE name=?",
                             (source["name"],)).fetchone()
        if current:
            old = parse(current["record"].encode())
            keys = ("kind", "room", "session", "expected_native")
            if all(old.get(key) == source.get(key) for key in keys):
                db.commit()
                return old
        revision = current["revision"] if current else 0
        if revision != body["expected_revision"]:
            raise StateError("ANALYSIS_SOURCE_CHANGED")
        source["revision"] = revision + 1
        db.execute("INSERT INTO sf_analysis_sources VALUES(?,?,?) "
                   "ON CONFLICT(name) DO UPDATE SET revision=excluded.revision,record=excluded.record",
                   (source["name"], source["revision"], _json(source)))
        db.commit()
    return source


def import_finalized_source(workspace, source, columns):
    """Runs inside the original persistent import job; no second SQL engine."""
    if source.get("kind") != _KIND:
        raise StateError("ANALYSIS_FINALIZED_SOURCE_REQUIRED")
    delivery, receipt = _bound(workspace, source)
    version = workspace.database.import_delivery(delivery, columns=columns)
    return {"version": version, "source": source["name"], "source_revision": source["revision"],
            "native_delivery": {"status": delivery.status, "source_format": receipt["sourceFormat"],
              "appended_pages": 0, "payment_status": delivery.payment_status}}
