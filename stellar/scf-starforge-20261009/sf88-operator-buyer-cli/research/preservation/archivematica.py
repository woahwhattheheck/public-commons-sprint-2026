#!/usr/bin/env python3
"""Prepare and reopen reviewed research transfers for Archivematica 1.18.

The original BagIt ZIP, record review and entered receiving choices are one
immutable package. Dashboard and Storage Service operations are implemented
by the adjacent archivematica_client.py using the released provider contract.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import uuid
import zipfile

import preservation as preservation

SCHEMA = "stellar-forge.archivematica-prepared.v1"
SETTINGS_SCHEMA = "stellar-forge.archivematica-settings.v1"
SNAPSHOT_SCHEMA = "stellar-forge.archivematica-snapshot.v1"
MAX_BYTES = preservation.MAX_TOTAL
MAX_SNAPSHOT = 8 * 1024 ** 3
MAX_METADATA_BYTES = preservation.MAX_MEMBER
MAX_MEMBERS = 30000
HASH = re.compile(r"[0-9a-f]{64}")
PROFILE = {
    "dashboard": {"version": "1.18.0", "commit": "243867858da329bb27ac9d5cf1747b3389d39149"},
    "storageService": {"version": "0.24.0", "commit": "0c3129d6f549e1223a119c07f0d3f9f972b9c890"},
    "transferType": "zipped bag",
}


class ArchivematicaError(ValueError):
    pass


def canonical(value):
    return preservation.canonical(value)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return preservation.utc()


def parse(raw):
    return preservation.parse_json(raw)


def safe(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ArchivematicaError("Expected a nonempty relative POSIX path")
    if value.startswith("/") or any(x in {"", ".", ".."} for x in value.split("/")):
        raise ArchivematicaError("Unsafe relative path: " + value)
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ArchivematicaError("Control character in path")
    return value


def token(value, label="identifier"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", value):
        raise ArchivematicaError("Invalid " + label)
    return value


def file_identity(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(fd)
        if not stat.S_ISREG(initial.st_mode):
            raise ArchivematicaError("Expected a regular file: " + str(path))
        h = hashlib.sha256()
        length = 0
        with os.fdopen(fd, "rb", closefd=False) as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                h.update(block)
                length += len(block)
        final = os.fstat(fd)
        if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns) != (
                final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns, final.st_ctime_ns):
            raise ArchivematicaError("File changed during reading: " + str(path))
        return {"bytes": length, "sha256": h.hexdigest()}
    finally:
        os.close(fd)


def regular(root, name):
    root = Path(root).absolute()
    name = safe(name)
    current = root
    if root.is_symlink():
        raise ArchivematicaError("Source root is a symlink")
    for part in name.split("/"):
        current = current / part
        if current.is_symlink():
            raise ArchivematicaError("Source member is a symlink: " + name)
    if not current.is_file():
        raise ArchivematicaError("Missing regular member: " + name)
    return current


def read_json(root, name):
    path = regular(root, name)
    if path.stat().st_size > MAX_METADATA_BYTES:
        raise ArchivematicaError("JSON member exceeds its input limit: " + name)
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
            raise ArchivematicaError("Existing immutable member differs: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-write-", dir=path.parent)
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
                raise ArchivematicaError("Concurrent immutable member differs: " + str(path))
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_json(path, value):
    publish(path, canonical(value))


def replace_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-state-", dir=path.parent)
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
        raise ArchivematicaError("Open an existing package workspace")
    descriptor = os.open(root / "workspace.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ArchivematicaError("Workspace lock is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ArchivematicaError("WORKSPACE_BUSY: the original operation is still active") from exc
        yield
    finally:
        os.close(descriptor)


def names(root):
    root = Path(root)
    found = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ArchivematicaError("Symlink in workspace: " + str(path))
        if path.is_file():
            found.append(safe(path.relative_to(root).as_posix()))
        elif not path.is_dir():
            raise ArchivematicaError("Special file in workspace")
    return found


def settings_template():
    return {
        "schema": SETTINGS_SCHEMA,
        "name": "Reviewed research edition",
        "accession": "",
        "accessSystemId": "",
        "transferSource": {"locationUuid": "", "relativePath": "research/reviewed-edition.zip"},
        "processingConfiguration": "default",
        "pipelineUuid": "",
        "aipLocationUuid": "",
        "dip": {"policy": "not-requested", "locationUuid": None},
        "backlog": {"policy": "pause", "locationUuid": None},
        "fixity": {"requestAipCheck": True, "forceLocal": False},
        "note": "",
    }


def entered_uuid(value, field):
    if not isinstance(value, str):
        raise ArchivematicaError(field + " must be an existing UUID")
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ArchivematicaError(field + " must be an existing UUID") from exc
    if value.lower() != parsed:
        raise ArchivematicaError(field + " must use the full hyphenated UUID")
    return parsed


def entered_text(value, field, limit=10000, *, required=False, single_line=False):
    value = preservation.text(value, field, empty=not required)
    if len(value) > limit or single_line and any(c in value for c in "\r\n\t"):
        raise ArchivematicaError(field + " exceeds its text format")
    return value


def normalize_settings(value):
    expected = {"schema", "name", "accession", "accessSystemId", "transferSource",
                "processingConfiguration", "pipelineUuid", "aipLocationUuid",
                "dip", "backlog", "fixity", "note"}
    if not isinstance(value, dict) or set(value) != expected or value.get("schema") != SETTINGS_SCHEMA:
        raise ArchivematicaError("Use the complete Archivematica receiving settings template")
    name = entered_text(value["name"], "transfer name", 255, required=True, single_line=True)
    if name in {".", ".."} or any(c in name for c in "/\\"):
        raise ArchivematicaError("Transfer name must be a single name without path separators")
    source = value["transferSource"]
    if not isinstance(source, dict) or set(source) != {"locationUuid", "relativePath"}:
        raise ArchivematicaError("Select the existing transfer-source location and exact relative ZIP path")
    relative = preservation.safe_name(source["relativePath"])
    if not relative.lower().endswith(".zip"):
        raise ArchivematicaError("The reviewed transfer source must be its original .zip path")
    processing = value["processingConfiguration"]
    if not isinstance(processing, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,16}", processing):
        raise ArchivematicaError("Select the existing processing configuration name (1–16 letters, numbers or underscores)")
    dip = value["dip"]
    if (not isinstance(dip, dict) or set(dip) != {"policy", "locationUuid"}
            or dip["policy"] not in {"required", "optional", "not-requested"}):
        raise ArchivematicaError("Select an explicit DIP policy and existing location")
    dip_location = entered_uuid(dip["locationUuid"], "DIP location") if dip["locationUuid"] is not None else None
    if dip["policy"] == "required" and dip_location is None:
        raise ArchivematicaError("Required DIP receiving needs its existing storage location UUID")
    if dip["policy"] == "not-requested" and dip_location is not None:
        raise ArchivematicaError("A DIP location must accompany an optional or required DIP policy")
    backlog = value["backlog"]
    if (not isinstance(backlog, dict) or set(backlog) != {"policy", "locationUuid"}
            or backlog["policy"] not in {"pause", "arrange"}):
        raise ArchivematicaError("Choose pause or arrange for a transfer that enters the backlog")
    backlog_location = (entered_uuid(backlog["locationUuid"], "backlog location")
                        if backlog["locationUuid"] is not None else None)
    if (backlog["policy"] == "arrange") != (backlog_location is not None):
        raise ArchivematicaError("Arrange needs the existing backlog location UUID; pause uses null")
    fixity = value["fixity"]
    if (not isinstance(fixity, dict) or set(fixity) != {"requestAipCheck", "forceLocal"}
            or any(type(fixity[key]) is not bool for key in fixity)):
        raise ArchivematicaError("Fixity settings must be explicit boolean choices")
    return {
        "schema": SETTINGS_SCHEMA, "name": name,
        "accession": entered_text(value["accession"], "accession", 255, single_line=True),
        "accessSystemId": entered_text(value["accessSystemId"], "access-system identifier", 255, single_line=True),
        "transferSource": {"locationUuid": entered_uuid(source["locationUuid"], "transfer-source location"),
                           "relativePath": relative},
        "processingConfiguration": processing,
        "pipelineUuid": entered_uuid(value["pipelineUuid"], "pipeline"),
        "aipLocationUuid": entered_uuid(value["aipLocationUuid"], "AIP location"),
        "dip": {"policy": dip["policy"], "locationUuid": dip_location},
        "backlog": {"policy": backlog["policy"], "locationUuid": backlog_location},
        "fixity": dict(fixity),
        "note": entered_text(value["note"], "receiving note"),
    }


@contextlib.contextmanager
def output_lock(output):
    output = Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    path = output.parent / (".archivematica-output-" + sha(str(output).encode())[:32] + ".lock")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ArchivematicaError("Output lock is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ArchivematicaError("OUTPUT_BUSY: the original receiving process is active") from exc
        yield
    finally:
        os.close(descriptor)

def bag_inventory(source):
    """Read the verified original bag without transforming paths or payload."""
    receipt = preservation.verify(source)
    reader = preservation.BagReader(source)
    try:
        members = []
        for name in sorted(reader.names):
            body = reader.read(name)
            members.append({"path": name, "bytes": len(body), "sha256": sha(body)})
        records = reader.json(preservation.DOC + "mapping.json")["records"]
    finally:
        reader.close()
    payload = [dict(row) for row in members if row["path"].startswith("data/")]
    if len(members) > MAX_MEMBERS or sum(row["bytes"] for row in members) > MAX_BYTES:
        raise ArchivematicaError("The complete source bag exceeds the retained source intake limit")
    if (len(payload) != receipt["payloadFiles"]
            or sum(row["bytes"] for row in payload) != receipt["payloadBytes"]):
        raise ArchivematicaError("Original payload inventory differs from BagIt verification")
    summary = {key: receipt[key] for key in (
        "sourceRecords", "includedRecords", "excludedRecords", "sourcePages",
        "members", "payloadFiles", "payloadBytes")}
    return receipt, members, payload, records, summary


def binding_for(original, receipt, members, payload, settings):
    return {"schema": SCHEMA, "profile": PROFILE, "settings": settings,
            "originalBag": {"path": "source/bag.zip", **original},
            "bagIdentity": receipt["identity"], "bagManifestSha256": receipt["manifestSha256"],
            "bagMembers": members, "payloadFiles": payload}


def report_html(manifest, records):
    esc = lambda value: html.escape(str(value), quote=True)
    settings, summary = manifest["settings"], manifest["summary"]
    row_html = []
    for row in records:
        row_html.append(
            "<tr><td>" + esc(row["identifier"]) + "</td><td>" +
            esc("; ".join(row["reviewedDc"].get("title", []))) + "</td><td>" +
            ("Include" if row["include"] else "Exclude") + "</td><td>" +
            esc(row["payloadPath"] if row["include"] else "") + "</td></tr>")
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>Archivematica research receiving</title><style>"
        "body{font:15px system-ui,sans-serif;color:#20252b;background:#fff;max-width:1180px;"
        "margin:32px auto;padding:0 24px;line-height:1.55}h1{font-size:26px}h2{font-size:19px;"
        "margin-top:30px}table{width:100%;border-collapse:collapse}th,td{padding:9px 10px;"
        "border:1px solid #ccd0d4;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        "th{background:#f1f2f3}code,dd{overflow-wrap:anywhere}dt{font-weight:600}"
        "dd{margin:0 0 12px}small{color:#454c53}</style></head><body>"
        "<h1>Archivematica research receiving</h1><p>" +
        esc(summary["includedRecords"]) + " included records from " +
        esc(summary["sourceRecords"]) + " original records. The saved review excludes " +
        esc(summary["excludedRecords"]) + " records.</p><dl><dt>Prepared transfer</dt><dd>" +
        esc(settings["name"]) + "</dd><dt>Package</dt><dd><code>" +
        esc(manifest["packageId"]) + "</code></dd><dt>Original BagIt ZIP</dt><dd>" +
        esc(manifest["originalBag"]["bytes"]) + " bytes · <code>" +
        esc(manifest["originalBag"]["sha256"]) + "</code></dd>"
        "<dt>Existing transfer-source location</dt><dd>" +
        esc(settings["transferSource"]["locationUuid"]) + " / " +
        esc(settings["transferSource"]["relativePath"]) + "</dd><dt>Processing configuration</dt><dd>" +
        esc(settings["processingConfiguration"]) + "</dd><dt>Pipeline and AIP location</dt><dd>" +
        esc(settings["pipelineUuid"]) + " / " + esc(settings["aipLocationUuid"]) +
        "</dd><dt>DIP policy</dt><dd>" + esc(settings["dip"]["policy"]) +
        "</dd><dt>Backlog policy</dt><dd>" + esc(settings["backlog"]["policy"]) +
        "</dd><dt>Receiving note</dt><dd>" + esc(settings["note"]) + "</dd></dl>"
        "<h2>Original source and receiving</h2><p>The original ZIP, BagIt tags, payload, "
        "native export and saved record review travel together. The receiving operation "
        "stages this exact ZIP into the selected mounted transfer source, retains the "
        "Dashboard transfer and ingest identifiers, and verifies the selected Storage "
        "Service package. Ingest decisions use the choices returned for that original "
        "job. Saved operation history and receiving results are included in portable "
        "exports.</p><p>OpenAlex bibliographic metadata is CC0. Rights information for "
        "the described research is retained with each record and its original source.</p>"
        "<h2>Saved record review</h2><table><thead><tr><th>Original identifier</th>"
        "<th>Reviewed title</th><th>Selection</th><th>Original payload path</th>"
        "</tr></thead><tbody>" + "".join(row_html) + "</tbody></table>"
        "<p><small>Receiving profile: Archivematica Dashboard 1.18.0 and Storage Service "
        "0.24.0. The adjacent operator guide describes deployment setup, ingest choices, "
        "backlog continuation and receiving recovery.</small></p></body></html>"
    ).encode("utf-8")


def copy_original(source, target, expected):
    source = regular(Path(source).parent, Path(source).name)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(descriptor)
        if not stat.S_ISREG(initial.st_mode) or initial.st_size != expected["bytes"]:
            raise ArchivematicaError("Original transfer ZIP changed before copying")
        with os.fdopen(descriptor, "rb", closefd=False) as src, target.open("xb") as dst:
            os.fchmod(dst.fileno(), 0o600)
            shutil.copyfileobj(src, dst, 1024 * 1024)
            dst.flush()
            os.fsync(dst.fileno())
        final = os.fstat(descriptor)
        if ((initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns) !=
                (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns, final.st_ctime_ns)
                or file_identity(target) != expected):
            raise ArchivematicaError("Original transfer ZIP changed while copying")
    finally:
        os.close(descriptor)
    fsync_directory(target.parent)


def prepare(bag, output, settings):
    settings = normalize_settings(settings)
    bag, output = Path(bag).absolute(), Path(output).absolute()
    original = file_identity(regular(bag.parent, bag.name))
    if original["bytes"] > MAX_BYTES:
        raise ArchivematicaError("Original transfer ZIP exceeds the source intake limit")
    if output.exists():
        existing = verify(output)
        if (existing["manifest"]["originalBag"] != {"path": "source/bag.zip", **original}
                or existing["manifest"]["settings"] != settings):
            raise ArchivematicaError("Existing package belongs to another original bag or receiving selection")
        return {**existing, "path": str(output), "reused": True}
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".archivematica-prepare-", dir=output.parent))
    try:
        copy_original(bag, stage / "source/bag.zip", original)
        receipt, members, payload, records, summary = bag_inventory(stage / "source/bag.zip")
        binding = binding_for(original, receipt, members, payload, settings)
        package_id = "archivematica-" + sha(canonical(binding))
        manifest = {**binding, "packageId": package_id, "summary": summary, "preparedAt": now()}
        publish_json(stage / "settings.json", settings)
        publish_json(stage / "records.json", records)
        publish(stage / "report.html", report_html(manifest, records))
        manifest["files"] = [{"path": name, **file_identity(stage / name)} for name in names(stage)]
        publish_json(stage / "manifest.json", manifest)
        verify(stage)
        preservation.sync_tree(stage)
        with output_lock(output):
            if output.exists():
                existing = verify(output)
                if existing["packageId"] != package_id:
                    raise ArchivematicaError("Concurrent destination contains another original package")
                return {**existing, "path": str(output), "reused": True}
            os.rename(stage, output)
            stage = None
            fsync_directory(output.parent)
        return {**verify(output), "path": str(output), "reused": False}
    finally:
        if stage is not None:
            shutil.rmtree(stage)


def identity_row(value):
    if (not isinstance(value, dict) or set(value) != {"path", "bytes", "sha256"}
            or type(value["bytes"]) is not int or not 0 <= value["bytes"] <= MAX_SNAPSHOT
            or not isinstance(value["sha256"], str) or not HASH.fullmatch(value["sha256"])):
        raise ArchivematicaError("Invalid immutable file inventory")
    preservation.safe_name(value["path"])
    return value


def verify(workspace):
    root = Path(workspace).absolute()
    if root.is_symlink() or not root.is_dir():
        raise ArchivematicaError("Open an existing original Archivematica package")
    raw = preservation.read_regular(root, "manifest.json", MAX_METADATA_BYTES)
    manifest = parse(raw)
    expected_fields = {"schema", "profile", "settings", "originalBag", "bagIdentity",
                       "bagManifestSha256", "bagMembers", "payloadFiles",
                       "packageId", "summary", "preparedAt", "files"}
    if (not isinstance(manifest, dict) or set(manifest) != expected_fields
            or manifest.get("schema") != SCHEMA or manifest.get("profile") != PROFILE):
        raise ArchivematicaError("Unsupported original Archivematica package")
    settings = normalize_settings(manifest["settings"])
    original = identity_row(manifest["originalBag"])
    if original["path"] != "source/bag.zip" or original["bytes"] > MAX_BYTES:
        raise ArchivematicaError("Original package must retain source/bag.zip")
    files = manifest["files"]
    if not isinstance(files, list) or len(files) != 4:
        raise ArchivematicaError("Prepared package requires its complete four-file source closure")
    expected = {}
    for row in files:
        row = identity_row(row)
        if row["path"] in expected:
            raise ArchivematicaError("Repeated immutable package file")
        expected[row["path"]] = {"bytes": row["bytes"], "sha256": row["sha256"]}
    required = {"source/bag.zip", "settings.json", "records.json", "report.html"}
    if set(expected) != required:
        raise ArchivematicaError("Prepared source, settings, record review or report is missing")
    actual = {name for name in names(root)
              if name not in {"manifest.json", "workspace.lock"} and not name.startswith("operations/")}
    if actual != required:
        raise ArchivematicaError("Prepared package contains changed or additional source members")
    for name, wanted in expected.items():
        if file_identity(regular(root, name)) != wanted:
            raise ArchivematicaError("Immutable prepared member changed: " + name)
    if expected["source/bag.zip"] != {key: original[key] for key in ("bytes", "sha256")}:
        raise ArchivematicaError("Original ZIP identity differs from the complete package inventory")
    receipt, members, payload, records, summary = bag_inventory(root / "source/bag.zip")
    binding = binding_for({key: original[key] for key in ("bytes", "sha256")},
                          receipt, members, payload, settings)
    if any(manifest.get(key) != value for key, value in binding.items()):
        raise ArchivematicaError("Prepared source, payload or receiving selection differs from its original binding")
    package_id = "archivematica-" + sha(canonical(binding))
    if manifest["packageId"] != package_id or manifest["summary"] != summary:
        raise ArchivematicaError("Prepared package identity or original record counts changed")
    if read_json(root, "settings.json") != settings or read_json(root, "records.json") != records:
        raise ArchivematicaError("Saved receiving settings or record review changed")
    if regular(root, "report.html").read_bytes() != report_html(manifest, records):
        raise ArchivematicaError("Source-review report differs from the complete original package")
    entered_text(manifest["preparedAt"], "preparation timestamp", 100, required=True)
    return {"schema": SCHEMA + ".verification", "valid": True,
            "id": package_id, "packageId": package_id, "manifest": manifest,
            "manifestSha256": sha(raw), "summary": summary}


def show(workspace):
    return verify(workspace)


def application_files():
    own = Path(__file__).absolute().parent
    result = {}
    required = ("preservation.py", "archivematica.py", "archivematica_client.py",
                "ARCHIVEMATICA.md", "ARCHIVEMATICA_PROVIDER_CONTRACT.md")
    optional = ()
    for name in required + optional:
        path = own / name
        if path.exists():
            result["application/research/preservation/" + name] = path
        elif name in required:
            raise ArchivematicaError("Missing portable application dependency: " + name)
    oai = own.parent / "oai/oai_feed.py"
    if not oai.is_file():
        raise ArchivematicaError("Missing original OAI source dependency")
    result["application/research/oai/oai_feed.py"] = oai
    return result


def export(workspace, output):
    root = Path(workspace).absolute()
    output = Path(output).absolute()
    if output == root or root in output.parents:
        raise ArchivematicaError("Place the snapshot outside its source workspace")
    with lock(root):
        verified = verify(root)
        members = {"workspace/" + name: root / name for name in names(root)
                   if name != "workspace.lock"}
        members.update(application_files())
        rows = [{"path": name, **file_identity(path)} for name, path in sorted(members.items())]
        if len(rows) > MAX_MEMBERS or sum(row["bytes"] for row in rows) > MAX_SNAPSHOT:
            raise ArchivematicaError("Portable snapshot exceeds its receiving limits")
        manifest = {"schema": SNAPSHOT_SCHEMA, "packageId": verified["id"], "members": rows}
        raw = canonical(manifest)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output_lock(output):
            if output.exists():
                with zipfile.ZipFile(output) as prior:
                    if prior.read("SNAPSHOT_MANIFEST.json") != raw or verify_snapshot(prior) != manifest:
                        raise ArchivematicaError("Existing export belongs to a different saved state")
                return {"path": str(output), **file_identity(output), "manifest": manifest, "reused": True}
            descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-export-", dir=output.parent)
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
        raise ArchivematicaError("Snapshot has too many members")
    by_name = {}
    total = 0
    for info in entries:
        name = safe(info.filename)
        if info.is_dir() or name in by_name or info.flag_bits & 1:
            raise ArchivematicaError("Unsupported or duplicate snapshot member")
        mode = (info.external_attr >> 16) & 0o170000
        if mode not in {0, stat.S_IFREG}:
            raise ArchivematicaError("Snapshot contains a special file")
        total += info.file_size
        if total > MAX_SNAPSHOT or info.file_size > 2 * MAX_BYTES:
            raise ArchivematicaError("Snapshot exceeds the receiving byte limit")
        by_name[name] = info
    if "SNAPSHOT_MANIFEST.json" not in by_name:
        raise ArchivematicaError("Missing portable snapshot manifest")
    if by_name["SNAPSHOT_MANIFEST.json"].file_size > MAX_METADATA_BYTES:
        raise ArchivematicaError("Snapshot manifest is too large")
    manifest = parse(archive.read("SNAPSHOT_MANIFEST.json"))
    if (not isinstance(manifest, dict) or set(manifest) != {"schema", "packageId", "members"}
            or manifest.get("schema") != SNAPSHOT_SCHEMA
            or not isinstance(manifest.get("packageId"), str)
            or not re.fullmatch(r"archivematica-[0-9a-f]{64}", manifest["packageId"])
            or not isinstance(manifest.get("members"), list)
            or len(manifest["members"]) > MAX_MEMBERS):
        raise ArchivematicaError("Unsupported snapshot schema or original package identity")
    wanted = {}
    for row in manifest["members"]:
        identity_row(row)
        name = safe(row["path"])
        if name in wanted or not name.startswith(("workspace/", "application/")):
            raise ArchivematicaError("Invalid snapshot inventory")
        wanted[name] = row
    required = {"application/research/preservation/" + name for name in
                ("preservation.py", "archivematica.py", "archivematica_client.py",
                 "ARCHIVEMATICA.md", "ARCHIVEMATICA_PROVIDER_CONTRACT.md")}
    required.add("application/research/oai/oai_feed.py")
    if not required <= set(wanted):
        raise ArchivematicaError("Snapshot omits a mandatory portable application dependency")
    if set(by_name) != set(wanted) | {"SNAPSHOT_MANIFEST.json"}:
        raise ArchivematicaError("Snapshot inventory is not the exact archive closure")
    for name, row in wanted.items():
        h, length = hashlib.sha256(), 0
        with archive.open(name) as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                h.update(block)
                length += len(block)
        if length != row["bytes"] or h.hexdigest() != row["sha256"]:
            raise ArchivematicaError("Snapshot member differs: " + name)
    if archive.testzip() is not None:
        raise ArchivematicaError("Snapshot CRC validation failed")
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
            raise ArchivematicaError("Original received member changed or disappeared: " + name)
        if name.startswith("workspace/operations/"):
            operation_ids.add(token(name.split("/")[2], "operation ID"))
    operations = root / "workspace/operations"
    if operations.exists():
        if operations.is_symlink() or not operations.is_dir():
            raise ArchivematicaError("Original operations directory changed")
        for entry in operations.iterdir():
            if entry.is_symlink() or not entry.is_dir():
                raise ArchivematicaError("Unexpected member in original operations directory")
            operation_ids.add(token(entry.name, "operation ID"))
    if operation_ids:
        # Pure source/configuration binding reads: no credentials, network, or
        # provider factories are loaded by these functions.
        import archivematica_client
        for operation_id in sorted(operation_ids):
            archivematica_client.show(root / "workspace", operation_id)


def _archive_stat(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _assert_archive_stable(handle, original):
    if _archive_stat(os.fstat(handle.fileno())) != _archive_stat(original):
        raise ArchivematicaError("The held original archive changed during receiving")


def _reconcile_binding_temporaries(stage, binding, *, unbound):
    raw = canonical(binding)
    allowed = {"RECEIVE_BINDING.json", "RECEIVED_ARCHIVE.json"}
    for path in list(stage.iterdir()):
        if re.fullmatch(r"\.archivematica-write-[a-z0-9_]{8}", path.name):
            if path.is_symlink() or not path.is_file() or path.stat().st_size > len(raw):
                raise ArchivematicaError("Unexpected receiving binding temporary")
            content = path.read_bytes()
            if not raw.startswith(content):
                raise ArchivematicaError("Receiving binding temporary belongs to a different original archive")
            path.unlink()
            fsync_directory(stage)
        elif unbound:
            # Extraction never starts before this original binding is durable.
            raise ArchivematicaError("An unbound receiving stage contains retained unrelated bytes")
        elif path.name in allowed and path.is_symlink():
            raise ArchivematicaError("Receiving metadata is a symlink")


def receive(source, output):
    source, output = Path(source).absolute(), Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as held, output_lock(output):
        initial = os.fstat(held.fileno())
        if not stat.S_ISREG(initial.st_mode):
            raise ArchivematicaError("Expected a regular original snapshot")
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
                    raise ArchivematicaError("Existing receiving output is not a regular directory")
                saved = read_json(output, "RECEIVED_ARCHIVE.json")
                if saved != binding:
                    raise ArchivematicaError("Existing receiving directory belongs to another original archive")
                with lock(output / "workspace"):
                    verified = verify(output / "workspace")
                    if verified["id"] != manifest["packageId"]:
                        raise ArchivematicaError("Reopened package identity differs")
                    verify_received_members(output, manifest)
                    _assert_archive_stable(held, initial)
                return {"path": str(output), "workspace": str(output / "workspace"),
                        "application": str(output / "application"), "binding": binding,
                        "reused": True, "verification": verified}
            stage = output.parent / (".archivematica-receive-" + sha(str(output).encode())[:24])
            if stage.exists():
                if stage.is_symlink() or not stage.is_dir():
                    raise ArchivematicaError("Receiving stage is not a regular directory")
                bound = stage / "RECEIVE_BINDING.json"
                if bound.exists() or bound.is_symlink():
                    if read_json(stage, bound.name) != binding:
                        raise ArchivematicaError("Receiving stage belongs to another original archive")
                    _reconcile_binding_temporaries(stage, binding, unbound=False)
                else:
                    _reconcile_binding_temporaries(stage, binding, unbound=True)
                    publish_json(bound, binding)
            else:
                stage.mkdir(mode=0o700)
                fsync_directory(stage.parent)
                publish_json(stage / "RECEIVE_BINDING.json", binding)
            expected_paths = {row["path"] for row in manifest["members"]}
            for temporary in stage.rglob(".archivematica-receive-write-*"):
                relative = temporary.relative_to(stage).as_posix()
                if relative in expected_paths:
                    continue
                if (not re.fullmatch(r"\.archivematica-receive-write-[a-z0-9_]{8}", temporary.name)
                        or temporary.is_symlink() or not temporary.is_file()):
                    raise ArchivematicaError("Unexpected temporary in the bound receiving stage")
                temporary.unlink()
                fsync_directory(temporary.parent)
            for row in manifest["members"]:
                path = stage / row["path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists():
                    if file_identity(regular(stage, row["path"])) != {
                            "bytes": row["bytes"], "sha256": row["sha256"]}:
                        raise ArchivematicaError("Retained receiving member differs: " + row["path"])
                    continue
                descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-receive-write-", dir=path.parent)
                try:
                    with os.fdopen(descriptor, "wb") as destination, archive.open(row["path"]) as src:
                        os.fchmod(destination.fileno(), 0o600)
                        shutil.copyfileobj(src, destination, 1024 * 1024)
                        destination.flush()
                        os.fsync(destination.fileno())
                    if file_identity(temporary) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                        raise ArchivematicaError("Extracted original member differs")
                    os.link(temporary, path, follow_symlinks=False)
                    fsync_directory(path.parent)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            verified = verify(stage / "workspace")
            if verified["id"] != manifest["packageId"]:
                raise ArchivematicaError("Received native package differs")
            verify_received_members(stage, manifest)
            unexpected = set(names(stage)) - expected_paths - {"RECEIVE_BINDING.json", "RECEIVED_ARCHIVE.json"}
            if unexpected:
                raise ArchivematicaError("Unexpected retained files in receiving stage: " + ", ".join(sorted(unexpected)))
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
    commands.add_parser("settings-template")
    prep = commands.add_parser("prepare")
    prep.add_argument("--bag", required=True)
    prep.add_argument("--settings", required=True)
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
        if args.command == "settings-template":
            result = settings_template()
        elif args.command == "prepare":
            settings_path = Path(args.settings).absolute()
            result = prepare(args.bag, args.out, read_json(settings_path.parent, settings_path.name))
        elif args.command == "export":
            result = export(args.workspace, args.out)
        elif args.command == "receive":
            result = receive(args.source, args.out)
        else:
            result = globals()[args.command](args.workspace)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
