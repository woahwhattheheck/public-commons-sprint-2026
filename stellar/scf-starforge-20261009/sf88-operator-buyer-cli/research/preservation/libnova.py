#!/usr/bin/env python3
"""Reviewed research packages for an existing LIBNOVA container.

This module extends the original research preservation source. It does not
create a repository, container, metadata schema, or provider account.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import fcntl
import hashlib
import html
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile

import preservation as preservation

SCHEMA = "stellar-forge.libnova-research-package.v1"
MAPPING_SCHEMA = "stellar-forge.libnova-research-mapping.v1"
SNAPSHOT_SCHEMA = "stellar-forge.libnova-research-snapshot.v1"
MAX_BYTES = 1024 ** 3
MAX_RECORDS = 1000
MAX_SNAPSHOT = 8 * 1024 ** 3
MAX_METADATA_BYTES = 16 * 1024 ** 2
MAX_MEMBERS = 30000
DC_FIELDS = set(("title creator subject description publisher contributor date "
                 "type format identifier source language relation coverage rights").split())
TYPES = {"STRING": 1, "LONGSTRING": 2, "NUMBER": 3, "DATE": 4, "BOOL": 5}


class LibnovaError(ValueError):
    pass


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return preservation.utc()


def parse(raw):
    return preservation.parse_json(raw)


def safe(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise LibnovaError("Expected a nonempty relative POSIX path")
    if value.startswith("/") or any(x in {"", ".", ".."} for x in value.split("/")):
        raise LibnovaError("Unsafe relative path: " + value)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise LibnovaError("Control character in path")
    return value


def token(value, label="identifier"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", value):
        raise LibnovaError("Invalid " + label)
    return value


def file_identity(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode):
            raise LibnovaError("Expected a regular file: " + str(path))
        h = hashlib.sha256()
        length = 0
        with os.fdopen(fd, "rb", closefd=False) as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                h.update(block)
                length += len(block)
        final = os.fstat(fd)
        if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) != (
                final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns):
            raise LibnovaError("File changed during reading: " + str(path))
        return {"bytes": length, "sha256": h.hexdigest()}
    finally:
        os.close(fd)


def regular(root, name):
    root = Path(root).absolute()
    name = safe(name)
    current = root
    if root.is_symlink():
        raise LibnovaError("Source root is a symlink")
    for part in name.split("/"):
        current = current / part
        if current.is_symlink():
            raise LibnovaError("Source member is a symlink: " + name)
    if not current.is_file():
        raise LibnovaError("Missing regular member: " + name)
    return current


def read_json(root, name):
    path = regular(root, name)
    if path.stat().st_size > MAX_METADATA_BYTES:
        raise LibnovaError("JSON member exceeds its input limit: " + name)
    return parse(path.read_bytes())


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish(path, data):
    """Publish immutable bytes only after a complete fsynced temporary inode."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise LibnovaError("Existing immutable member differs: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".libnova-write-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if path.is_symlink() or path.read_bytes() != data:
                raise LibnovaError("Concurrent immutable member differs: " + str(path))
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_json(path, value):
    publish(path, canonical(value))


def replace_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".libnova-state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(canonical(value))
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def lock(root):
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise LibnovaError("Open an existing package workspace")
    descriptor = os.open(root / ".libnova.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise LibnovaError("Workspace lock is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise LibnovaError("WORKSPACE_BUSY: the original operation is still active") from exc
        yield
    finally:
        os.close(descriptor)


def names(root):
    root = Path(root)
    found = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise LibnovaError("Symlink in workspace: " + str(path))
        if path.is_file():
            found.append(safe(path.relative_to(root).as_posix()))
        elif not path.is_dir():
            raise LibnovaError("Special file in workspace")
    return found


def mapping_template():
    return {
        "schema": MAPPING_SCHEMA,
        "fields": [
            {"dcField": field, "iecode": "dc." + field, "dataType": "LONGSTRING"}
            for field in ("title", "creator", "identifier", "description", "rights")
        ],
        "note": "Replace these example codes/types with descriptors from the existing "
                "target schema. Unmapped Dublin Core values remain in the unchanged bag."
    }


def normalize_mapping(value):
    if not isinstance(value, dict) or value.get("schema") != MAPPING_SCHEMA:
        raise LibnovaError("Unsupported LIBNOVA mapping")
    if set(value) - {"schema", "fields", "note"}:
        raise LibnovaError("Unknown mapping properties")
    fields = value.get("fields")
    if not isinstance(fields, list) or not fields or len(fields) > len(DC_FIELDS):
        raise LibnovaError("Enter one or more explicit descriptor mappings")
    result, seen_dc, seen_code = [], set(), set()
    for row in fields:
        if not isinstance(row, dict) or set(row) != {"dcField", "iecode", "dataType"}:
            raise LibnovaError("Each mapping needs dcField, iecode and dataType")
        field, code, typ = row["dcField"], row["iecode"], row["dataType"]
        if field not in DC_FIELDS or field in seen_dc:
            raise LibnovaError("Unknown or repeated Dublin Core field")
        if (not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", code)
                or code in seen_code):
            raise LibnovaError("Invalid or repeated descriptor code")
        if typ not in TYPES:
            raise LibnovaError("Supported entered descriptor types: " + ", ".join(TYPES))
        seen_dc.add(field)
        seen_code.add(code)
        result.append({"dcField": field, "iecode": code, "dataType": typ})
    note = value.get("note", "")
    if not isinstance(note, str) or len(note) > 10000:
        raise LibnovaError("Mapping note exceeds its limit")
    return {"schema": MAPPING_SCHEMA,
            "fields": sorted(result, key=lambda row: row["iecode"]), "note": note}


def typed_value(value, kind):
    if not isinstance(value, str):
        raise LibnovaError("The reviewed Dublin Core source must contain strings")
    if kind in {"STRING", "LONGSTRING"}:
        return value
    if kind == "NUMBER":
        from decimal import Decimal, InvalidOperation
        try:
            number = Decimal(value)
            if not number.is_finite():
                raise InvalidOperation
        except InvalidOperation as exc:
            raise LibnovaError("Entered NUMBER mapping contains a nonnumeric value: " + value) from exc
        # Keep the exact entered string; the API descriptor controls storage type.
        return value
    if kind == "DATE":
        import datetime
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            datetime.date.fromisoformat(value)
        except ValueError as exc:
            raise LibnovaError("DATE mapping requires an explicit ISO calendar date: " + value) from exc
        return value
    if value not in {"true", "false"}:
        raise LibnovaError("BOOL mapping requires the literal true or false")
    return value


def record_metadata(rows, mapping):
    result = []
    mapped = {row["dcField"] for row in mapping["fields"]}
    for row in rows:
        if not row["include"]:
            continue
        values = []
        for descriptor in mapping["fields"]:
            for value in row["reviewedDc"].get(descriptor["dcField"], []):
                values.append({"iecode": descriptor["iecode"],
                               "value": typed_value(value, descriptor["dataType"])})
        result.append({
            "identifier": row["identifier"], "path": safe(row["payloadPath"]),
            "sourceSha256": row["source"]["recordSha256"], "metadata": values,
            "reviewedDc": row["reviewedDc"],
            "unmappedFields": sorted(set(row["reviewedDc"]) - mapped),
            "sourceResourceRights": row["sourceResourceRights"],
        })
    return result


def report_html(package, records):
    escape = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr><td>" + escape(row["identifier"]) + "</td><td>" +
                   escape(row["path"]) + "</td><td>" + escape(len(row["metadata"])) +
                   "</td><td>" + escape(", ".join(row["unmappedFields"])) + "</td></tr>"
                   for row in records)
    summary = package["summary"]
    return (
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>LIBNOVA research handoff</title>"
        "<style>body{font:16px system-ui;max-width:1100px;margin:36px auto;padding:0 20px;color:#18212b}"
        "table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ccd3db;"
        "text-align:left;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style>"
        "<h1>Reviewed research handoff for LIBNOVA</h1><p>Package <code>" +
        escape(package["id"]) + "</code></p><p>" + escape(summary["includedRecords"]) +
        " included metadata records from " + escape(summary["sourceRecords"]) +
        " source records; " + escape(summary["excludedRecords"]) +
        " excluded by the saved review. The complete original BagIt payload, native source, "
        "review revision and rights information travel together.</p><p>This package is prepared "
        "for an existing container and explicit descriptor mapping. It has not been uploaded "
        "or accepted by a tenant. The receiving client requires actual S3 content, indexed "
        "File objects, mapped metadata and the original Function job to be reconciled. "
        "A job status alone does not establish receiving.</p>"
        "<p>Each work JSON contains bibliographic metadata. CC0 covers the OpenAlex metadata; "
        "described articles, media and full text are separate resources with their own rights.</p>"
        "<h2>Saved record mapping</h2><table><thead><tr><th>Original identifier</th><th>Bag path</th>"
        "<th>Mapped values</th><th>Preserved unmapped fields</th></tr></thead><tbody>" +
        rows + "</tbody></table></html>"
    ).encode("utf-8")


def prepare(bag, output, mapping):
    mapping = normalize_mapping(mapping)
    bag = Path(bag).absolute()
    output = Path(output).absolute()
    verified = preservation.verify(bag)
    if verified["includedRecords"] > MAX_RECORDS or verified["payloadBytes"] > MAX_BYTES:
        raise LibnovaError("Initial profile permits at most 1,000 metadata records and 1 GiB")
    reader = preservation.BagReader(bag)
    try:
        rows = reader.json(preservation.DOC + "mapping.json")["records"]
        records = record_metadata(rows, mapping)
        bag_members = [{"path": name, "bytes": len(reader.read(name)),
                        "sha256": sha(reader.read(name))} for name in reader.names]
    finally:
        reader.close()
    if sum(row["bytes"] for row in bag_members) > MAX_BYTES:
        raise LibnovaError("Complete source/export material exceeds the 1 GiB profile")
    binding = {"schema": SCHEMA, "bagIdentity": verified["identity"],
               "bagManifestSha256": verified["manifestSha256"],
               "bagMembers": bag_members, "mapping": mapping}
    package_id = "libnova-research-" + sha(canonical(binding))
    if output.exists():
        prior = verify(output)
        if prior["id"] != package_id:
            raise LibnovaError("Existing package belongs to another original bag or mapping")
        return {**prior, "path": str(output), "reused": True}
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".libnova-prepare-", dir=output.parent))
    try:
        preservation.receive(bag, stage / "bag")
        publish_json(stage / "mapping.json", mapping)
        publish_json(stage / "record-metadata.json", records)
        summary = {key: verified[key] for key in
                   ("sourceRecords", "includedRecords", "excludedRecords", "sourcePages",
                    "members", "payloadFiles", "payloadBytes")}
        package = {"schema": SCHEMA, "id": package_id, "binding": binding, "summary": summary,
                   "preparedAt": now(), "metadataLicense": "CC0-1.0",
                   "profile": "libnova-existing-container-unpacked-bagit-v1"}
        if bag.is_file():
            original = file_identity(bag)
            if original["bytes"] > MAX_BYTES:
                raise LibnovaError("Original archive exceeds the profile limit")
            source = regular(bag.parent, bag.name)
            with source.open("rb") as src, (stage / "original-bag.zip").open("xb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
                dst.flush()
                os.fsync(dst.fileno())
            if file_identity(stage / "original-bag.zip") != original:
                raise LibnovaError("Original archive changed while freezing")
            package["originalArchive"] = original
        publish(stage / "report.html", report_html(package, records))
        package["files"] = [{"path": name, **file_identity(stage / name)} for name in names(stage)]
        publish_json(stage / "package.json", package)
        verify(stage)
        for path in sorted([p for p in stage.rglob("*") if p.is_dir()], reverse=True):
            fsync_directory(path)
        fsync_directory(stage)
        # A receiving lock at the destination prevents a second publication.
        with output_lock(output):
            if output.exists():
                prior = verify(output)
                if prior["id"] != package_id:
                    raise LibnovaError("Concurrent destination contains a different package")
                return {**prior, "path": str(output), "reused": True}
            os.rename(stage, output)
            stage = None
            fsync_directory(output.parent)
        return {**verify(output), "path": str(output), "reused": False}
    finally:
        if stage is not None:
            shutil.rmtree(stage)


@contextlib.contextmanager
def output_lock(output):
    output = Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    path = output.parent / (".libnova-output-" + sha(str(output).encode())[:32] + ".lock")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise LibnovaError("Output lock is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise LibnovaError("OUTPUT_BUSY: the original receiving process is active") from exc
        yield
    finally:
        os.close(descriptor)


def verify(workspace):
    root = Path(workspace).absolute()
    package = read_json(root, "package.json")
    if package.get("schema") != SCHEMA:
        raise LibnovaError("Unsupported package workspace")
    binding = package.get("binding", {})
    if package.get("id") != "libnova-research-" + sha(canonical(binding)):
        raise LibnovaError("Package identity changed")
    mapping = normalize_mapping(read_json(root, "mapping.json"))
    if binding.get("mapping") != mapping:
        raise LibnovaError("Mapping differs from the frozen package")
    files = package.get("files")
    if not isinstance(files, list) or len(files) > MAX_MEMBERS:
        raise LibnovaError("Invalid package inventory")
    expected = {}
    for row in files:
        name = safe(row["path"])
        if name in expected or name == "package.json" or name.startswith("operations/"):
            raise LibnovaError("Invalid or repeated package member")
        expected[name] = {"bytes": row["bytes"], "sha256": row["sha256"]}
        if file_identity(regular(root, name)) != expected[name]:
            raise LibnovaError("Frozen package member differs: " + name)
    actual = {name for name in names(root)
              if name not in {"package.json", ".libnova.lock"} and not name.startswith("operations/")}
    mandatory = {"mapping.json", "record-metadata.json", "report.html"} | {
        "bag/" + row["path"] for row in binding.get("bagMembers", [])}
    if package.get("originalArchive") is not None:
        mandatory.add("original-bag.zip")
    if set(expected) != mandatory:
        raise LibnovaError("Package contains members outside its original profile")
    if actual != set(expected):
        raise LibnovaError("Frozen package has missing or additional members")
    receipt = preservation.verify(root / "bag")
    if (receipt["identity"] != binding.get("bagIdentity")
            or receipt["manifestSha256"] != binding.get("bagManifestSha256")):
        raise LibnovaError("Original bag identity or review changed")
    inventory = [{"path": name, **file_identity(root / "bag" / name)}
                 for name in names(root / "bag")]
    if inventory != binding.get("bagMembers"):
        raise LibnovaError("Original bag member closure changed")
    rows = read_json(root / "bag", preservation.DOC + "mapping.json")["records"]
    records = record_metadata(rows, mapping)
    if read_json(root, "record-metadata.json") != records:
        raise LibnovaError("Saved record metadata differs from source and mapping")
    summary_keys = {"sourceRecords", "includedRecords", "excludedRecords", "sourcePages",
                    "members", "payloadFiles", "payloadBytes"}
    if set(package.get("summary", {})) != summary_keys:
        raise LibnovaError("Incomplete package summary")
    expected_summary = {key: receipt[key] for key in summary_keys}
    if package["summary"] != expected_summary or receipt["includedRecords"] > MAX_RECORDS:
        raise LibnovaError("Package counts or initial profile differ")
    if sum(row["bytes"] for row in inventory) > MAX_BYTES:
        raise LibnovaError("Package exceeds the initial source/export byte profile")
    if package.get("originalArchive") is not None:
        if file_identity(regular(root, "original-bag.zip")) != package["originalArchive"]:
            raise LibnovaError("Original archive identity changed")
        archived = preservation.verify(root / "original-bag.zip")
        if archived != receipt:
            raise LibnovaError("Original archive and frozen bag differ")
    if regular(root, "report.html").read_bytes() != report_html(package, records):
        raise LibnovaError("Prepared report differs from the frozen package")
    return {"schema": SCHEMA + ".verification", "valid": True, "id": package["id"],
            "packageSha256": sha(canonical(package)), "bag": receipt, "summary": package["summary"],
            "mappingSha256": sha(canonical(mapping))}


def show(workspace):
    result = verify(workspace)
    root = Path(workspace)
    operations = []
    directory = root / "operations"
    if directory.exists():
        for path in sorted(directory.iterdir()):
            if path.is_symlink() or not path.is_dir():
                raise LibnovaError("Unexpected operation entry")
            operation = read_json(path, "operation.json")
            state = read_json(path, "state.json") if (path / "state.json").exists() else None
            operations.append({"operationId": operation["id"], "state": state})
    return {**result, "path": str(root.absolute()), "operations": operations}


def application_files():
    own = Path(__file__).absolute().parent
    result = {}
    required = ("preservation.py", "libnova.py", "libnova_client.py", "libnova-requirements.txt")
    optional = ("LIBNOVA.md", "LIBNOVA_PROVIDER_CONTRACT.md")
    for name in required + optional:
        path = own / name
        if path.exists():
            result["application/research/preservation/" + name] = path
        elif name in required:
            raise LibnovaError("Missing portable application dependency: " + name)
    oai = own.parent / "oai/oai_feed.py"
    if not oai.is_file():
        raise LibnovaError("Missing original OAI source dependency")
    result["application/research/oai/oai_feed.py"] = oai
    return result


def export(workspace, output):
    root = Path(workspace).absolute()
    output = Path(output).absolute()
    if output == root or root in output.parents:
        raise LibnovaError("Place the snapshot outside its source workspace")
    with lock(root):
        verified = verify(root)
        members = {"workspace/" + name: root / name for name in names(root)
                   if name != ".libnova.lock"}
        members.update(application_files())
        rows = [{"path": name, **file_identity(path)} for name, path in sorted(members.items())]
        if len(rows) > MAX_MEMBERS or sum(row["bytes"] for row in rows) > MAX_SNAPSHOT:
            raise LibnovaError("Portable snapshot exceeds its receiving limits")
        manifest = {"schema": SNAPSHOT_SCHEMA, "packageId": verified["id"], "members": rows}
        raw = canonical(manifest)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output_lock(output):
            if output.exists():
                with zipfile.ZipFile(output) as prior:
                    if prior.read("SNAPSHOT_MANIFEST.json") != raw or verify_snapshot(prior) != manifest:
                        raise LibnovaError("Existing export belongs to a different saved state")
                return {"path": str(output), **file_identity(output), "manifest": manifest, "reused": True}
            descriptor, temporary = tempfile.mkstemp(prefix=".libnova-export-", dir=output.parent)
            os.close(descriptor)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=6) as archive:
                    for name, path in sorted(members.items()):
                        archive.write(path, name)
                    archive.writestr("SNAPSHOT_MANIFEST.json", raw)
                with open(temporary, "rb") as handle:
                    os.fsync(handle.fileno())
                with zipfile.ZipFile(temporary) as archive:
                    verify_snapshot(archive)
                os.link(temporary, output, follow_symlinks=False)
                fsync_directory(output.parent)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        return {"path": str(output), **file_identity(output), "manifest": manifest, "reused": False}


def verify_snapshot(archive):
    entries = archive.infolist()
    if len(entries) > MAX_MEMBERS + 1:
        raise LibnovaError("Snapshot has too many members")
    by_name = {}
    total = 0
    for info in entries:
        name = safe(info.filename)
        if info.is_dir() or name in by_name or info.flag_bits & 1:
            raise LibnovaError("Unsupported or duplicate snapshot member")
        mode = (info.external_attr >> 16) & 0o170000
        if mode not in {0, stat.S_IFREG}:
            raise LibnovaError("Snapshot contains a special file")
        total += info.file_size
        if total > MAX_SNAPSHOT or info.file_size > 2 * MAX_BYTES:
            raise LibnovaError("Snapshot exceeds the receiving byte limit")
        by_name[name] = info
    if "SNAPSHOT_MANIFEST.json" not in by_name:
        raise LibnovaError("Missing portable snapshot manifest")
    if by_name["SNAPSHOT_MANIFEST.json"].file_size > MAX_METADATA_BYTES:
        raise LibnovaError("Snapshot manifest is too large")
    manifest = parse(archive.read("SNAPSHOT_MANIFEST.json"))
    if manifest.get("schema") != SNAPSHOT_SCHEMA:
        raise LibnovaError("Unsupported snapshot schema")
    wanted = {}
    for row in manifest.get("members", []):
        name = safe(row["path"])
        if name in wanted or not name.startswith(("workspace/", "application/")):
            raise LibnovaError("Invalid snapshot inventory")
        wanted[name] = row
    required = {"application/research/preservation/" + name for name in
                ("preservation.py", "libnova.py", "libnova_client.py", "libnova-requirements.txt")}
    required.add("application/research/oai/oai_feed.py")
    if not required <= set(wanted):
        raise LibnovaError("Snapshot omits a mandatory portable application dependency")
    if set(by_name) != set(wanted) | {"SNAPSHOT_MANIFEST.json"}:
        raise LibnovaError("Snapshot inventory is not the exact archive closure")
    for name, row in wanted.items():
        h, length = hashlib.sha256(), 0
        with archive.open(name) as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                h.update(block)
                length += len(block)
        if length != row["bytes"] or h.hexdigest() != row["sha256"]:
            raise LibnovaError("Snapshot member differs: " + name)
    if archive.testzip() is not None:
        raise LibnovaError("Snapshot CRC validation failed")
    return manifest


def verify_received_members(root, manifest):
    """Keep the original snapshot's immutable history while permitting progress."""
    root = Path(root)
    operation_ids = set()
    for row in manifest["members"]:
        name = row["path"]
        match = re.fullmatch(r"workspace/operations/([^/]+)/state\.json", name)
        if match:
            operation_ids.add(token(match.group(1), "operation ID"))
            continue
        if file_identity(regular(root, name)) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
            raise LibnovaError("Original received member changed or disappeared: " + name)
        if name.startswith("workspace/operations/"):
            operation_ids.add(token(name.split("/")[2], "operation ID"))
    operations = root / "workspace/operations"
    if operations.exists():
        if operations.is_symlink() or not operations.is_dir():
            raise LibnovaError("Original operations directory changed")
        for entry in operations.iterdir():
            if entry.is_symlink() or not entry.is_dir():
                raise LibnovaError("Unexpected member in original operations directory")
            operation_ids.add(token(entry.name, "operation ID"))
    if operation_ids:
        # Pure source/configuration binding reads: no credentials, network, or
        # provider factories are loaded by these functions.
        import libnova_client
        for operation_id in sorted(operation_ids):
            libnova_client.show(root / "workspace", operation_id)


def _archive_stat(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _assert_archive_stable(handle, original):
    if _archive_stat(os.fstat(handle.fileno())) != _archive_stat(original):
        raise LibnovaError("The held original archive changed during receiving")


def _reconcile_binding_temporaries(stage, binding, *, unbound):
    raw = canonical(binding)
    allowed = {"RECEIVE_BINDING.json", "RECEIVED_ARCHIVE.json"}
    for path in list(stage.iterdir()):
        if re.fullmatch(r"\.libnova-write-[a-z0-9_]{8}", path.name):
            if path.is_symlink() or not path.is_file() or path.stat().st_size > len(raw):
                raise LibnovaError("Unexpected receiving binding temporary")
            content = path.read_bytes()
            if not raw.startswith(content):
                raise LibnovaError("Receiving binding temporary belongs to a different original archive")
            path.unlink()
            fsync_directory(stage)
        elif unbound:
            # Extraction never starts before this original binding is durable.
            raise LibnovaError("An unbound receiving stage contains retained unrelated bytes")
        elif path.name in allowed and path.is_symlink():
            raise LibnovaError("Receiving metadata is a symlink")


def receive(source, output):
    source, output = Path(source).absolute(), Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as held, output_lock(output):
        initial = os.fstat(held.fileno())
        if not stat.S_ISREG(initial.st_mode):
            raise LibnovaError("Expected a regular original snapshot")
        h, length = hashlib.sha256(), 0
        for block in iter(lambda: held.read(1024 * 1024), b""):
            h.update(block)
            length += len(block)
        _assert_archive_stable(held, initial)
        identity = {"bytes": length, "sha256": h.hexdigest()}
        held.seek(0)
        with zipfile.ZipFile(held) as archive:
            manifest = verify_snapshot(archive)
            binding = {"schema": SNAPSHOT_SCHEMA + ".received", "archive": identity,
                       "manifestSha256": sha(canonical(manifest)), "packageId": manifest["packageId"]}
            if output.exists():
                if output.is_symlink() or not output.is_dir():
                    raise LibnovaError("Existing receiving output is not a regular directory")
                saved = read_json(output, "RECEIVED_ARCHIVE.json")
                if saved != binding:
                    raise LibnovaError("Existing receiving directory belongs to another original archive")
                with lock(output / "workspace"):
                    verified = verify(output / "workspace")
                    if verified["id"] != manifest["packageId"]:
                        raise LibnovaError("Reopened package identity differs")
                    verify_received_members(output, manifest)
                    _assert_archive_stable(held, initial)
                return {"path": str(output), "workspace": str(output / "workspace"),
                        "application": str(output / "application"), "binding": binding,
                        "reused": True, "verification": verified}
            stage = output.parent / (".libnova-receive-" + sha(str(output).encode())[:24])
            if stage.exists():
                if stage.is_symlink() or not stage.is_dir():
                    raise LibnovaError("Receiving stage is not a regular directory")
                bound = stage / "RECEIVE_BINDING.json"
                if bound.exists() or bound.is_symlink():
                    if read_json(stage, bound.name) != binding:
                        raise LibnovaError("Receiving stage belongs to another original archive")
                    _reconcile_binding_temporaries(stage, binding, unbound=False)
                else:
                    _reconcile_binding_temporaries(stage, binding, unbound=True)
                    publish_json(bound, binding)
            else:
                stage.mkdir(mode=0o700)
                fsync_directory(stage.parent)
                publish_json(stage / "RECEIVE_BINDING.json", binding)
            expected_paths = {row["path"] for row in manifest["members"]}
            for temporary in stage.rglob(".libnova-receive-write-*"):
                relative = temporary.relative_to(stage).as_posix()
                if relative in expected_paths:
                    continue
                if (not re.fullmatch(r"\.libnova-receive-write-[a-z0-9_]{8}", temporary.name)
                        or temporary.is_symlink() or not temporary.is_file()):
                    raise LibnovaError("Unexpected temporary in the bound receiving stage")
                temporary.unlink()
                fsync_directory(temporary.parent)
            for row in manifest["members"]:
                path = stage / row["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists():
                    if file_identity(regular(stage, row["path"])) != {
                            "bytes": row["bytes"], "sha256": row["sha256"]}:
                        raise LibnovaError("Retained receiving member differs: " + row["path"])
                    continue
                descriptor, temporary = tempfile.mkstemp(prefix=".libnova-receive-write-", dir=path.parent)
                try:
                    with os.fdopen(descriptor, "wb") as destination, archive.open(row["path"]) as src:
                        os.fchmod(destination.fileno(), 0o600)
                        shutil.copyfileobj(src, destination, 1024 * 1024)
                        destination.flush()
                        os.fsync(destination.fileno())
                    if file_identity(temporary) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                        raise LibnovaError("Extracted original member differs")
                    os.link(temporary, path, follow_symlinks=False)
                    fsync_directory(path.parent)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            verified = verify(stage / "workspace")
            if verified["id"] != manifest["packageId"]:
                raise LibnovaError("Received native package differs")
            verify_received_members(stage, manifest)
            unexpected = set(names(stage)) - expected_paths - {"RECEIVE_BINDING.json", "RECEIVED_ARCHIVE.json"}
            if unexpected:
                raise LibnovaError("Unexpected retained files in receiving stage: " + ", ".join(sorted(unexpected)))
            publish_json(stage / "RECEIVED_ARCHIVE.json", binding)
            # Both the opened archive and the owned stage remain bound through
            # the single publication boundary, including process-loss recovery.
            _assert_archive_stable(held, initial)
            for path in sorted([p for p in stage.rglob("*") if p.is_dir()], reverse=True):
                fsync_directory(path)
            fsync_directory(stage)
            os.rename(stage, output)
            fsync_directory(output.parent)
            return {"path": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / "application"), "binding": binding,
                    "reused": False, "verification": verified}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("mapping-template")
    prep = commands.add_parser("prepare")
    prep.add_argument("--bag", required=True)
    prep.add_argument("--mapping", required=True)
    prep.add_argument("--out", required=True)
    for command in ("verify", "show"):
        sub = commands.add_parser(command)
        sub.add_argument("--workspace", required=True)
    out = commands.add_parser("export")
    out.add_argument("--workspace", required=True)
    out.add_argument("--out", required=True)
    rec = commands.add_parser("receive")
    rec.add_argument("--source", required=True)
    rec.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "mapping-template":
            result = mapping_template()
        elif args.command == "prepare":
            result = prepare(args.bag, args.out, parse(Path(args.mapping).read_bytes()))
        elif args.command == "export":
            result = export(args.workspace, args.out)
        elif args.command == "receive":
            result = receive(args.source, args.out)
        else:
            result = globals()[args.command](args.workspace)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (LibnovaError, preservation.PreservationError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"status": "ERROR", "error": type(exc).__name__, "message": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
