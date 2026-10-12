#!/usr/bin/env python3
"""One complete original169 Archivematica HTTP and portable receiving journey.

This is a labeled local contract receiver against Archivematica Dashboard1.18.0
and Storage Service0.24.0. It uses the original reviewed source, actual HTTP,
generated AIP/METS bytes, and the maintained producer/client/Workbench. It does
not contact a deployed repository or claim tenant ingest acceptance.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
from collections import Counter
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import http.server
import importlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import select
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import traceback
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
import zipfile

SCHEMA = "commons.archivematica-original-receiving.v1"
OPERATION = "ARCHIVEMATICA-RESEARCH-RECEIVING-6BA15-20261012"
SOURCE_SHA = "948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b"
SOURCE_BYTES = 145901
DASHBOARD_COMMIT = "243867858da329bb27ac9d5cf1747b3389d39149"
STORAGE_COMMIT = "0c3129d6f549e1223a119c07f0d3f9f972b9c890"
PIPELINE = "a1111111-1111-4111-8111-111111111111"
TRANSFER = "a2222222-2222-4222-8222-222222222222"
DIP = "a3333333-3333-4333-8333-333333333333"
TRANSFER_LOCATION = "b1111111-1111-4111-8111-111111111111"
AIP_LOCATION = "b2222222-2222-4222-8222-222222222222"
DIP_LOCATION = "b3333333-3333-4333-8333-333333333333"
BACKLOG_LOCATION = "b4444444-4444-4444-8444-444444444444"
SPACE = "c1111111-1111-4111-8111-111111111111"
MCP_JOB = "d1111111-1111-4111-8111-111111111111"
CHOICE_BACKLOG = "f1111111-1111-4111-8111-111111111111"
CHOICE_REJECT = "f2222222-2222-4222-8222-222222222222"
ARRANGE_PATH = "/arrange/Original_Reviewed_169/"
NAMESPACE = uuid.UUID("e1111111-1111-4111-8111-111111111111")
DASHBOARD_KEY = "synthetic-local-dashboard-api-key"
STORAGE_KEY = "synthetic-local-storage-api-key"
SESSION_COOKIE = "sessionid=synthetic-local-archivematica-session"
CSRF_TOKEN = "synthetic-local-csrf-token"
MAX_BODY = 16 * 1024 * 1024
MAX_ARCHIVE = 64 * 1024 * 1024
METS = "http://www.loc.gov/METS/"
PREMIS = "http://www.loc.gov/premis/v3"
XLINK = "http://www.w3.org/1999/xlink"
DC = "http://purl.org/dc/elements/1.1/"
DCTERMS = "http://purl.org/dc/terms/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
for _prefix, _namespace in (("mets", METS), ("premis", PREMIS), ("xlink", XLINK),
                            ("dc", DC), ("dcterms", DCTERMS), ("xsi", XSI)):
    ET.register_namespace(_prefix, _namespace)

def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        need(stat.S_ISREG(before.st_mode), "Expected original regular file: " + str(path))
        h, length = hashlib.sha256(), 0
        while True:
            block = os.read(descriptor, 262144)
            if not block:
                break
            h.update(block)
            length += len(block)
        after = os.fstat(descriptor)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
             == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "File changed during bound read: " + str(path))
        return {"bytes": length, "sha256": h.hexdigest()}
    finally:
        os.close(descriptor)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_all(output, raw):
    pending = memoryview(raw)
    while pending:
        written = output.write(pending)
        need(isinstance(written, int) and written > 0, "Original output stopped before complete publication")
        pending = pending[written:]


def publish(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        need(not path.is_symlink() and path.read_bytes() == raw,
             "Immutable receiving member differs: " + str(path))
        return False
    descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-receiving-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb", buffering=0) as output:
            os.fchmod(output.fileno(), 0o600)
            write_all(output, raw)
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(not path.is_symlink() and path.read_bytes() == raw,
                 "Concurrent receiving publication differs")
        sync_directory(path.parent)
        return True
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def publish_json(path, value):
    return publish(path, canonical(value))


def replace_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-progress-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb", buffering=0) as output:
            os.fchmod(output.fileno(), 0o600)
            write_all(output, canonical(value))
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path):
    path = Path(path)
    need(not path.is_symlink() and path.is_file(), "Missing original JSON member: " + str(path))
    need(path.stat().st_size <= MAX_BODY, "Receiving JSON exceeds its bound")
    return json.loads(path.read_bytes())


def copy_immutable(source, target):
    expected = identity(source)
    target = Path(target)
    if target.exists():
        need(identity(target) == expected, "Existing retained copy differs")
        return expected
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-copy-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output, open(source, "rb") as incoming:
            os.fchmod(output.fileno(), 0o600)
            shutil.copyfileobj(incoming, output, 262144)
            output.flush()
            os.fsync(output.fileno())
        need(identity(temporary) == expected, "Retained original copy differs")
        os.link(temporary, target)
        sync_directory(target.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return expected


@contextlib.contextmanager
def receiving_lock(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    need(root.resolve() == root.absolute(), "Receiving root must be canonical")
    descriptor = os.open(root / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


@contextlib.contextmanager
def credentials(staging):
    supplied = {
        "ARCHIVEMATICA_DASHBOARD_KEY": DASHBOARD_KEY,
        "ARCHIVEMATICA_STORAGE_KEY": STORAGE_KEY,
        "ARCHIVEMATICA_SESSION_COOKIE": SESSION_COOKIE,
        "ARCHIVEMATICA_CSRF_TOKEN": CSRF_TOKEN,
        "ARCHIVEMATICA_TRANSFER_SOURCE_ROOT": str(Path(staging).absolute()),
        "NO_PROXY": "127.0.0.1,localhost,::1",
        "no_proxy": "127.0.0.1,localhost,::1",
    }
    previous = {key: os.environ.get(key) for key in supplied}
    os.environ.update(supplied)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def imports(application, *, workbench=True):
    application = Path(application).absolute()
    sys.path.insert(0, str(application / "research/preservation"))
    selected = ["preservation", "archivematica", "archivematica_client"]
    if workbench:
        selected.append("workbench")
    modules = []
    for name in selected:
        module = importlib.import_module(name)
        need(Path(module.__file__).resolve().parent == application / "research/preservation",
             "Another application module is loaded: " + name)
        modules.append(module)
    return tuple(modules)


def application_identity(application):
    application = Path(application).absolute()
    rows = {}
    for selected in (application / "research/preservation", application / "research/oai/oai_feed.py"):
        values = sorted(selected.rglob("*")) if selected.is_dir() else [selected]
        for path in values:
            need(not path.is_symlink(), "Application source is a symlink")
            if path.is_file() and "__pycache__" not in path.parts:
                rows[path.relative_to(application).as_posix()] = identity(path)
    need(all("research/preservation/" + name in rows for name in
             ("preservation.py", "archivematica.py", "archivematica_client.py",
              "ARCHIVEMATICA.md", "ARCHIVEMATICA_PROVIDER_CONTRACT.md",
              "archivematica-requirements.txt",
              "workbench.py", "workbench.html", "workbench.js")),
         "The complete original Archivematica and Workbench source is required")
    need("research/oai/oai_feed.py" in rows, "The exact original OAI source is required")
    return rows


def identity_bytes(raw):
    return {"bytes": len(raw), "sha256": sha(raw)}


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def namespaced(parent, namespace, name, text=None, **attributes):
    element = ET.SubElement(parent, "{" + namespace + "}" + name, attributes)
    element.text = text
    return element


def source_uuid(kind, path):
    return str(uuid.uuid5(NAMESPACE, kind + ":" + path))


def configuration(dashboard_port, storage_port):
    return {
        "schema": "stellar-forge.archivematica-client.v1",
        "dashboard": {"baseUrl": f"http://127.0.0.1:{dashboard_port}",
                      "username": "receiving-dashboard", "apiKeyEnv": "ARCHIVEMATICA_DASHBOARD_KEY",
                      "sessionCookieEnv": "ARCHIVEMATICA_SESSION_COOKIE",
                      "csrfTokenEnv": "ARCHIVEMATICA_CSRF_TOKEN"},
        "storage": {"baseUrl": f"http://127.0.0.1:{storage_port}",
                    "username": "receiving-storage", "apiKeyEnv": "ARCHIVEMATICA_STORAGE_KEY"},
        "deployment": {"dashboardVersion": "1.18.0", "storageVersion": "0.24.0"},
        "transferSourceRootEnv": "ARCHIVEMATICA_TRANSFER_SOURCE_ROOT",
        "timeoutSeconds": 10, "pollSeconds": 0.1, "waitSeconds": 0,
        "maxResponseBytes": MAX_BODY, "maxDownloadBytes": 2147483648,
        "caFile": None, "allowLoopback": True,
        "note": "Local released-contract receiving; all service credentials and UUIDs are fixture identities.",
    }


def settings(q):
    value = q.settings_template()
    value.update({
        "name": "Reviewed Research 169",
        "accession": "CC0-LOCAL-169",
        "accessSystemId": "local-original169",
        "transferSource": {"locationUuid": TRANSFER_LOCATION,
                           "relativePath": "research/original-reviewed-169.zip"},
        "processingConfiguration": "default", "pipelineUuid": PIPELINE,
        "aipLocationUuid": AIP_LOCATION,
        "dip": {"policy": "required", "locationUuid": DIP_LOCATION},
        "backlog": {"policy": "arrange", "locationUuid": BACKLOG_LOCATION},
        "fixity": {"requestAipCheck": True, "forceLocal": True},
        "note": "One reviewed source and original transfer/SIP; local contract receiving only.",
    })
    return q.normalize_settings(value)



def zip_bytes(members):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for name, raw in sorted(members.items()):
            need(isinstance(name, str) and name and "\\" not in name
                 and not name.startswith("/") and all(x not in {"", ".", ".."} for x in name.split("/")),
                 "Unsafe fixture archive member")
            need(isinstance(raw, bytes), "Fixture archive content is not exact bytes")
            info = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, raw)
    return output.getvalue()


def tar_bytes(members, *, compressed=False):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, raw in sorted(members.items()):
            need(name and not name.startswith("/") and "\\" not in name
                 and all(part not in {"", ".", ".."} for part in name.split("/")),
                 "Unsafe fixture TAR member")
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(raw), 0o600, 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            archive.addfile(info, io.BytesIO(raw))
    raw = output.getvalue()
    return gzip.compress(raw, compresslevel=6, mtime=0) if compressed else raw


def bag_members(payload, identifier):
    need(all(name.startswith("data/") for name in payload), "Bag payload lost its data/ prefix")
    members = dict(payload)
    members["bagit.txt"] = b"BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n"
    members["bag-info.txt"] = (
        "External-Identifier: " + identifier + "\n"
        + "Payload-Oxum: " + str(sum(map(len, payload.values()))) + "." + str(len(payload)) + "\n"
    ).encode()
    members["manifest-sha256.txt"] = "".join(
        sha(raw) + "  " + name + "\n" for name, raw in sorted(payload.items())
    ).encode("utf-8")
    members["tagmanifest-sha256.txt"] = "".join(
        sha(members[name]) + "  " + name + "\n"
        for name in ("bag-info.txt", "bagit.txt", "manifest-sha256.txt")
    ).encode("utf-8")
    return members


def build_mets(entries, label, *, transfer_uuid=None, record_map=None):
    """Produce the released METS/PREMIS/DC shapes from actual fixture bytes."""
    attributes = {"OBJID": transfer_uuid} if transfer_uuid else {}
    root = ET.Element("{" + METS + "}mets", attributes)
    header = namespaced(root, METS, "metsHdr", CREATEDATE="2026-10-12T00:00:00Z")
    agent = namespaced(header, METS, "agent", ROLE="CREATOR", TYPE="OTHER", OTHERTYPE="SOFTWARE")
    namespaced(agent, METS, "name", PIPELINE)
    namespaced(agent, METS, "note", "Archivematica dashboard UUID")
    record_map = record_map or {}
    for index, item in enumerate(entries, 1):
        record = record_map.get(item.get("source"))
        if record is None:
            continue
        item["dmdId"] = "dmdSec_" + str(index)
        section = namespaced(root, METS, "dmdSec", ID=item["dmdId"], STATUS="original",
                             CREATED="2026-10-12T00:00:00")
        wrapped = namespaced(section, METS, "mdWrap", MDTYPE="DC")
        xml = namespaced(wrapped, METS, "xmlData")
        dc = namespaced(xml, DCTERMS, "dublincore")
        dc.set("{" + XSI + "}schemaLocation",
               DCTERMS + " https://dublincore.org/schemas/xmls/qdc/2008/02/11/dcterms.xsd")
        for name, values in record["reviewedDc"].items():
            for value in values:
                namespaced(dc, DC, name, value)
    for index, item in enumerate(entries, 1):
        item["admId"] = "amdSec_" + str(index)
        amd = namespaced(root, METS, "amdSec", ID=item["admId"])
        tech = namespaced(amd, METS, "techMD", ID="techMD_" + str(index))
        wrapped = namespaced(tech, METS, "mdWrap", MDTYPE="PREMIS:OBJECT")
        xml = namespaced(wrapped, METS, "xmlData")
        obj = namespaced(xml, PREMIS, "object", version="3.0")
        obj.set("{" + XSI + "}type", "premis:file")
        ident = namespaced(obj, PREMIS, "objectIdentifier")
        namespaced(ident, PREMIS, "objectIdentifierType", "UUID")
        namespaced(ident, PREMIS, "objectIdentifierValue", item["uuid"])
        characteristics = namespaced(obj, PREMIS, "objectCharacteristics")
        namespaced(characteristics, PREMIS, "compositionLevel", "0")
        fixity = namespaced(characteristics, PREMIS, "fixity")
        namespaced(fixity, PREMIS, "messageDigestAlgorithm", "SHA-256")
        namespaced(fixity, PREMIS, "messageDigest", sha(item["raw"]))
        namespaced(characteristics, PREMIS, "size", str(len(item["raw"])))
        namespaced(obj, PREMIS, "originalName", item["originalName"])
    file_sec = namespaced(root, METS, "fileSec")
    groups = {}
    for item in entries:
        use = item["use"]
        if use not in groups:
            groups[use] = namespaced(file_sec, METS, "fileGrp", USE=use)
        file = namespaced(groups[use], METS, "file", ID="file-" + item["uuid"],
                          GROUPID="Group-" + item["uuid"], ADMID=item["admId"])
        flocat = namespaced(file, METS, "FLocat", LOCTYPE="OTHER", OTHERLOCTYPE="SYSTEM")
        flocat.set("{" + XLINK + "}href", item["path"])
        # Transfer METS generated by metsrw also records the file checksum.
        if transfer_uuid:
            file.set("CHECKSUM", sha(item["raw"]))
            file.set("CHECKSUMTYPE", "SHA-256")
            file.set("SIZE", str(len(item["raw"])))
    struct = namespaced(root, METS, "structMap", TYPE="physical", ID="structMap_1",
                        LABEL="Archivematica default")
    directory = namespaced(struct, METS, "div", TYPE="Directory", LABEL=label)
    subdirectories = {"": directory}
    for item in entries:
        parent = ""
        for component in PurePosixPath(item["path"]).parts[:-1]:
            following = parent + ("/" if parent else "") + component
            if following not in subdirectories:
                subdirectories[following] = namespaced(
                    subdirectories[parent], METS, "div", TYPE="Directory", LABEL=component)
            parent = following
        attributes = {"TYPE": "Item", "LABEL": PurePosixPath(item["path"]).name}
        if item.get("dmdId"):
            attributes["DMDID"] = item["dmdId"]
        div = namespaced(subdirectories[parent], METS, "div", **attributes)
        namespaced(div, METS, "fptr", FILEID="file-" + item["uuid"])
    return xml_bytes(root)


def build_repository_bytes(p, q, workspace, staged_zip, output, sip_uuid, transfer_basename):
    """Use the staged original bag; retain whole AIP/DIP and transfer METS bytes."""
    verified = q.verify(workspace)
    wanted = verified["manifest"]["originalBag"]
    need(identity(staged_zip) == {key: wanted[key] for key in ("bytes", "sha256")},
         "Staged transfer differs from the reviewed original ZIP")
    reader = p.BagReader(staged_zip)
    try:
        source_members = {name: reader.read(name) for name in sorted(reader.names)}
    finally:
        reader.close()
    expected_members = verified["manifest"]["bagMembers"]
    need([{"path": name, **identity_bytes(raw)} for name, raw in sorted(source_members.items())]
         == expected_members, "The staged source lost an original bag member")
    records = read_json(Path(workspace) / "records.json")
    included = {row["payloadPath"]: row for row in records if row["include"]}
    need(len(records) == 169 and len(included) == 169,
         "The original receiver must keep all169 reviewed source records")
    metadata_basename = "transfer-" + TRANSFER
    docs_basename = "transfer-" + transfer_basename
    aip_root = "Original_Reviewed_169-" + sip_uuid
    transfer_entries, aip_entries = [], []
    transfer_payload, aip_payload, mapping = {}, {}, []
    for name, raw in sorted(source_members.items()):
        original_uuid = source_uuid("original-transfer", name)
        if name.startswith("data/metadata/submissionDocumentation/"):
            suffix = name[len("data/metadata/submissionDocumentation/"):]
            transfer_relative = "metadata/submissionDocumentation/" + suffix
            aip_relative = "objects/submissionDocumentation/" + docs_basename + "/" + suffix
            use = "submissionDocumentation"
            copied = True
        elif name.startswith("data/metadata/"):
            suffix = name[len("data/metadata/"):]
            transfer_relative = "metadata/" + suffix
            aip_relative = "objects/metadata/transfers/" + metadata_basename + "/" + suffix
            use = "metadata"
            copied = True
        elif name.startswith("data/"):
            suffix = name[len("data/"):]
            transfer_relative = "objects/" + suffix
            aip_relative = "objects/" + suffix
            use = "original"
            copied = False
        elif name.startswith("manifest"):
            transfer_relative = "metadata/" + name
            aip_relative = "objects/metadata/transfers/" + metadata_basename + "/" + name
            use = "metadata"
            copied = True
        else:
            transfer_relative = "logs/BagIt/" + name
            aip_relative = "logs/transfers/" + metadata_basename + "/logs/BagIt/" + name
            use = None
            copied = True
        transfer_payload["data/" + transfer_relative] = raw
        if use is not None:
            transfer_entries.append({
                "path": transfer_relative, "raw": raw, "uuid": original_uuid,
                "originalName": "%transferDirectory%" + name,
                "use": use, "source": name,
            })
        aip_payload["data/" + aip_relative] = raw
        new_uuid = source_uuid("copied-sip", aip_relative) if copied else original_uuid
        original_name = ("%SIPDirectory%" + aip_relative if copied
                         else "%transferDirectory%" + name)
        if use is not None:
            aip_entries.append({
                "path": aip_relative, "raw": raw, "uuid": new_uuid,
                "originalName": original_name, "use": use, "source": name,
            })
        mapping.append({
            "sourcePath": name, **identity_bytes(raw),
            "transferFileUuid": original_uuid if use else None,
            "transferRelativePath": transfer_relative,
            "aipPath": aip_root + "/data/" + aip_relative,
            "aipRelativePath": "data/" + aip_relative,
            "aipFileUuid": new_uuid if use else None,
            "aipUse": use, "premisOriginalName": original_name if use else None,
            "isRecord": name in included,
        })
    transfer_mets = build_mets(transfer_entries, transfer_basename, transfer_uuid=TRANSFER)
    transfer_payload["data/metadata/submissionDocumentation/METS.xml"] = transfer_mets
    transfer_copy_path = "objects/submissionDocumentation/" + docs_basename + "/METS.xml"
    aip_payload["data/" + transfer_copy_path] = transfer_mets
    aip_entries.append({
        "path": transfer_copy_path, "raw": transfer_mets,
        "uuid": source_uuid("copied-sip", transfer_copy_path),
        "originalName": "%SIPDirectory%" + transfer_copy_path,
        "use": "submissionDocumentation", "source": None,
    })
    aip_mets = build_mets(aip_entries, aip_root, record_map=included)
    aip_payload["data/METS." + sip_uuid + ".xml"] = aip_mets
    aip_payload["data/README.html"] = (
        b"<!doctype html><title>Local Archivematica contract fixture</title>"
        b"<p>Generated from the exact staged original BagIt; not a repository engine run.</p>"
    )
    aip_bag = bag_members(aip_payload, sip_uuid)
    aip_members = {aip_root + "/" + name: raw for name, raw in aip_bag.items()}
    backlog_bag = bag_members(transfer_payload, TRANSFER)
    backlog_members = {transfer_basename + "/" + name: raw for name, raw in backlog_bag.items()}
    # A DIP is a separate non-BagIt package. Its object copies retain this
    # fixture's source bytes, but its UUID is not inferred from the SIP name.
    dip_members = {aip_root + "/objects/" + name[len("data/"):]: source_members[name]
                   for name in sorted(included)}
    dip_members[aip_root + "/metadata.xml"] = xml_bytes(ET.Element(
        "local-contract-receiving", {"aip": sip_uuid, "dip": DIP, "transfer": TRANSFER}))
    binary = {"aip.tar.gz": tar_bytes(aip_members, compressed=True),
              "dip.tar": tar_bytes(dip_members), "backlog.tar": tar_bytes(backlog_members),
              "aip-mets.xml": aip_mets, "transfer-mets.xml": transfer_mets}
    output = Path(output)
    for name, raw in binary.items():
        publish(output / name, raw)
    source = {
        "schema": SCHEMA + ".repository-source",
        "source": identity(staged_zip), "packageId": verified["packageId"],
        "transferUuid": TRANSFER, "sipUuid": sip_uuid, "dipUuid": DIP,
        "transferBasename": transfer_basename, "metadataBasename": metadata_basename,
        "submissionDocumentationBasename": docs_basename, "aipArchiveRoot": aip_root,
        "aipMetsPath": aip_root + "/data/METS." + sip_uuid + ".xml",
        "transferMetsPath": aip_root + "/data/" + transfer_copy_path,
        "mapping": mapping,
        "files": {name: identity_bytes(raw) for name, raw in sorted(binary.items())},
        "sourceContract": {"dashboardCommit": DASHBOARD_COMMIT, "storageCommit": STORAGE_COMMIT,
                           "workflowBlob": "3b735bd427b6f89425fb5e0467e7ce8852ae3baa",
                           "aipMetsBlob": "05abff365ff0cdbde6734fd358ab6a2299122943",
                           "transferMetsBlob": "02adbb416ce0d7d3a0b64b9dc55729ca5056e033",
                           "backlogMoveBlob": "b4138c53b0fdb581419d51e8881122384a26dfc4"},
    }
    publish_json(output / "repository-source.json", source)
    return source




def prepare_foundation(p, q, c, w, application, source, out, dashboard_port, storage_port):
    need(identity(source) == {"bytes": SOURCE_BYTES, "sha256": SOURCE_SHA},
         "The exact original 169-record source example is required")
    foundation = out / "foundation"
    status = p.initialize(source, foundation, "source-export",
                          organization="Commons local Archivematica receiving",
                          contact="Local protocol fixture; no tenant submission")
    need(status["sourceRecords"] == 169, "Original source record count differs")
    project, prepared = p.project_files(foundation)
    review = p.empty_review(prepared)
    first = sorted(row["identifier"] for row in prepared["records"])[0]
    review["note"] = "Original 169 metadata records; complete local Archivematica receiving."
    review["decisions"] = [{"identifier": first, "include": True,
                            "fields": {"subject": ["Local Archivematica receiving classification"]},
                            "reason": "Explicit local receiving review; the original work JSON remains byte-identical."}]
    desired = p.normalize_review(review, prepared)
    expected_sha = p.digest(p.canonical(desired))
    publish_json(out / "original-review-request.json", {
        "schema": SCHEMA + ".review-request", "source": identity(source),
        "sourceManifestSha256": project["binding"]["manifestSha256"],
        "review": desired, "reviewSha256": expected_sha,
    })
    if status["reviewSha256"] != expected_sha:
        need(status["revision"] == 0, "An existing source review has advanced; preserve its original operation")
        p.save_review(foundation, desired, status["revision"])
    status = p.show(foundation)
    need(status["reviewSha256"] == expected_sha and status["includedRecords"] == 169,
         "The saved original review differs")
    selection = {"sourceManifestSha256": project["binding"]["manifestSha256"],
                 "revision": status["revision"], "reviewSha256": status["reviewSha256"]}
    selected_settings = settings(q)
    request = {
        "id": OPERATION, "provider": "archivematica",
        "label": "Original 169-record Archivematica local receiving",
        "selection": selection, "settings": selected_settings,
        "configuration": c.normalize_configuration(configuration(dashboard_port, storage_port)),
        "jobTemplate": None,
    }
    publish_json(out / "original-destination-request.json", request)
    app = w.Workbench(foundation)
    try:
        app.prepare_migration(request)
        root, saved = app.operation(OPERATION)
        need(saved["requestSha256"] == p.digest(p.canonical(request)),
             "Workbench selected another original destination")
        workspace = root / "prepared"
        verified = q.verify(workspace)
        need(verified["summary"]["includedRecords"] == 169, "Prepared package lost source records")
        operation = c.show(workspace, OPERATION)["operation"]
        publish_json(out / "prepared-source-binding.json", {
            "schema": SCHEMA + ".source", "source": identity(source),
            "selection": selection, "package": verified,
            "operation": operation, "managedPreparedPath": str(workspace),
            "originalTransfer": identity(root / "original-transfer.zip"),
        })
        return app, foundation, workspace, selection, operation
    except BaseException:
        app.close()
        raise




def original_action(workspace, key):
    need(key and all(part not in {"", ".", ".."} for part in key.split("/"))
         and "\\" not in key and not key.startswith("/"), "Unsafe original action key")
    root = Path(workspace) / "operations" / OPERATION / "actions" / key
    request_path, result_path = root / "request.json", root / "result.json"
    if not request_path.exists():
        return None
    request = read_json(request_path)
    request_file = identity(request_path)
    started_path = root / "started.json"
    started = read_json(started_path) if started_path.exists() else None
    if started:
        need(started["actionKey"] == key
             and started["requestSha256"] == request_file["sha256"],
             "Original provider action changed")
    return {"request": request, "requestFile": request_file,
            "started": started, "startedFile": identity(started_path) if started else None,
            "result": read_json(result_path) if result_path.exists() else None,
            "resultFile": identity(result_path) if result_path.exists() else None}


def current_state(c, workspace):
    value = c.show(workspace, OPERATION)
    need(value["operation"]["id"] == OPERATION and value["state"]["operationId"] == OPERATION,
         "Current original client identity differs")
    return value["state"]


def state_identity(workspace):
    return identity(Path(workspace) / "operations" / OPERATION / "state.json")


def phase(out, label, workspace, c, fixture, action, expected, invoke,
          *, setup=None, interrupted_effect=None, verify=None):
    """Retain one invocation, reuse its saved return, and reconcile an interruption.

    Existing client actions remain authoritative. The fixture never clears them
    or dispatches a substitute write to force a fault scenario to start over.
    """
    root = out / "phases"
    request_path = root / (label + ".request.json")
    result_path = root / (label + ".result.json")
    if request_path.exists():
        request = read_json(request_path)
        need(request["schema"] == SCHEMA + ".phase-request"
             and request["operationId"] == OPERATION and request["label"] == label
             and request["action"] == action and request["expected"] == expected,
             "Retained phase belongs to different receiving work")
    else:
        request = {"schema": SCHEMA + ".phase-request", "operationId": OPERATION,
                   "label": label, "action": action, "expected": expected,
                   "beforeState": state_identity(workspace),
                   "beforeEffects": fixture.effect_counts(),
                   "beforeRequestNumber": fixture.sequence, "preparedAt": now()}
        publish_json(request_path, request)
    request_sha = sha(canonical(request))
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == request_sha and result["operationId"] == OPERATION,
             "Retained phase result differs")
        return result
    old = current_state(c, workspace)
    changed = state_identity(workspace) != request["beforeState"]
    inferred = interrupted_effect() if interrupted_effect else None
    if changed and old.get("state") == expected:
        value, basis = old, "Original terminal phase state recovered without redispatch"
    elif inferred:
        value = old
        basis = "Original effect and request retained; interruption reconstructed without redispatch"
    else:
        if setup is not None:
            setup()
        value = invoke()
        basis = "Original client call returned"
        need(isinstance(value, dict), "Expected the original returned client state")
    if inferred:
        need(expected == "RECONCILIATION_REQUIRED", "Only an original uncertain-write phase may use effect recovery")
    else:
        need(value.get("state") == expected,
             f"Phase {label}: expected {expected}, observed {value.get('state')}")
    if verify is not None:
        verify(value)
    result = {"schema": SCHEMA + ".phase-result", "operationId": OPERATION,
              "label": label, "requestSha256": request_sha, "basis": basis,
              "expected": expected, "observedState": value,
              "interruptedOriginalEffect": inferred,
              "afterEffects": fixture.effect_counts(),
              "lastRequestNumber": fixture.sequence, "observedAt": now()}
    publish_json(result_path, result)
    print(json.dumps({"phase": label, "state": value.get("state"), "basis": basis}), flush=True)
    return result


def provider_snapshot(q, c, workspace, output):
    """Reuse an exact complete original snapshot if publication already succeeded."""
    output = Path(output)
    selected_path = output.with_name(output.name + ".selection.json")
    state = current_state(c, workspace)
    operation = c.show(workspace, OPERATION)["operation"]
    if selected_path.exists():
        selected = read_json(selected_path)
        need(selected["operation"] == operation, "Snapshot selection changed its original operation")
    else:
        need(state.get("state") == "VERIFIED", "Export requires the complete observed original operation")
        selected = {"schema": SCHEMA + ".snapshot-selection", "operation": operation,
                    "state": state, "stateFile": state_identity(workspace)}
        publish_json(selected_path, selected)
    if not output.exists():
        need(state_identity(workspace) == selected["stateFile"],
             "Source state advanced before the selected snapshot was published")
        q.export(workspace, output)
    with zipfile.ZipFile(output) as archive:
        manifest = q.verify_snapshot(archive)
        need(manifest["packageId"] == operation["packageId"],
             "Snapshot contains another package")
        stored_operation = json.loads(archive.read("workspace/operations/" + OPERATION + "/operation.json"))
        stored_state = json.loads(archive.read("workspace/operations/" + OPERATION + "/state.json"))
        need(stored_operation == operation and stored_state == selected["state"]
             and stored_state.get("state") == "VERIFIED",
             "Snapshot does not contain the selected original verified state")
        proof_name = "workspace/" + stored_state["proof"]["path"]
        need(identity_bytes(archive.read(proof_name)) == {
            key: stored_state["proof"][key] for key in ("bytes", "sha256")},
            "Snapshot receiving proof differs")
        saved = {"path": str(output), **identity(output),
                 "manifestSha256": sha(archive.read("SNAPSHOT_MANIFEST.json")),
                 "members": len(manifest["members"]) + 1,
                 "packageId": operation["packageId"], "operationId": OPERATION,
                 "selectedStateSha256": selected["stateFile"]["sha256"]}
    publish_json(output.with_name(output.name + ".receiving.json"), saved)
    return saved


def workbench_snapshot(w, p, c, app, output, selection):
    output = Path(output)
    selected_path = output.with_name(output.name + ".selection.json")
    root, destination = app.operation(OPERATION)
    operation = c.show(root / "prepared", OPERATION)["operation"]
    progress = current_state(c, root / "prepared")
    wanted = {"schema": SCHEMA + ".workbench-snapshot-selection",
              "selection": selection, "operation": operation,
              "state": progress, "destination": destination}
    if selected_path.exists():
        selected = read_json(selected_path)
        need(selected["selection"] == selection and selected["operation"] == operation
             and selected["destination"] == destination,
             "Whole-workspace snapshot selection changed")
    else:
        need(progress.get("state") == "VERIFIED", "Whole workspace lacks a verified original operation")
        publish_json(selected_path, wanted)
        selected = wanted
    if not output.exists():
        need(progress == selected["state"], "Selected full workspace advanced before export")
        w.export_workspace(app, output)
    with zipfile.ZipFile(output) as archive:
        manifest = w.snapshot_manifest(archive)
        need(manifest["selection"] == selection and manifest["sourceRecords"] == 169,
             "Whole snapshot lost the original source/review")
        operation_prefix = "operator/operations/" + OPERATION + "/prepared/operations/" + OPERATION + "/"
        need(json.loads(archive.read(operation_prefix + "operation.json")) == operation
             and json.loads(archive.read(operation_prefix + "state.json")) == selected["state"],
             "Whole snapshot contains a different original operation")
        provider_group = {
            "application/research/preservation/" + name for name in
            ("archivematica.py", "archivematica_client.py",
             "ARCHIVEMATICA.md", "ARCHIVEMATICA_PROVIDER_CONTRACT.md",
             "archivematica-requirements.txt")}
        need(provider_group <= set(manifest["files"]),
             "The Archivematica operation needs its complete portable provider source")
    item = app.artifact(output, "complete-workspace", selection)
    result = {"path": str(output), **identity(output), "artifact": item,
              "members": len(manifest["files"]) + 1, "selection": selection,
              "operationId": OPERATION}
    publish_json(output.with_name(output.name + ".receiving.json"), result)
    return result





def process_observation(pid=None):
    # /proc may expose host PIDs while this interpreter sees a nested namespace.
    # Only /proc/self supplies the observer's actual PID in that procfs view.
    selected_path = "/proc/self/stat" if pid is None else f"/proc/{int(pid)}/stat"
    raw = Path(selected_path).read_text()
    opening, closing = raw.index("("), raw.rfind(")")
    fields = raw[closing + 2:].split()
    need(closing > opening and len(fields) > 19, "Original process stat is incomplete")
    actual_pid = int(raw[:opening].strip())
    if pid is not None:
        need(actual_pid == int(pid), "Original procfs identity changed its selected PID")
    return {"process": {
                "pid": actual_pid,
                "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "startTicks": fields[19],
            },
            "parentHostPid": int(fields[1])}


def process_identity(pid=None):
    return process_observation(pid)["process"]


def original_process_inactive(value):
    try:
        current = process_identity(value["pid"])
    except FileNotFoundError:
        return True
    return current != value


def publish_child_identity():
    descriptor = os.environ.pop("ARCHIVEMATICA_RECEIVING_IDENTITY_FD", None)
    request_sha = os.environ.pop("ARCHIVEMATICA_RECEIVING_IDENTITY_REQUEST", None)
    if descriptor is None:
        need(request_sha is None, "Original child identity request has no inherited channel")
        return
    need(isinstance(descriptor, str) and descriptor.isdecimal()
         and len(descriptor) <= 20 and int(descriptor) >= 3
         and isinstance(request_sha, str) and re.fullmatch(r"[a-f0-9]{64}", request_sha),
         "Original inherited child identity channel is invalid")
    descriptor = int(descriptor)
    with os.fdopen(descriptor, "wb", buffering=0) as output:
        need(stat.S_ISFIFO(os.fstat(output.fileno()).st_mode),
             "Original child identity channel is not a pipe")
        observed = process_observation()
        value = {"schema": SCHEMA + ".child-process-identity",
                 "operationId": OPERATION, "requestSha256": request_sha,
                 "process": observed["process"],
                 "parentHostPid": observed["parentHostPid"],
                 "namespacePid": os.getpid(),
                 "commandSha256": sha(Path("/proc/self/cmdline").read_bytes())}
        write_all(output, canonical(value))
        output.flush()


def receive_child_identity(descriptor, process, parent, request_sha, arguments):
    deadline, raw = time.monotonic() + 30, bytearray()
    while True:
        remaining = deadline - time.monotonic()
        need(remaining > 0, "Original child did not report its process identity")
        readable, _, _ = select.select([descriptor], [], [], remaining)
        need(bool(readable), "Original child process identity timed out")
        block = os.read(descriptor, 4096)
        if not block:
            break
        raw.extend(block)
        need(len(raw) <= 4096, "Original child process identity exceeded its bound")
    value = json.loads(raw)
    expected_command = sha(b"\0".join(os.fsencode(part) for part in arguments) + b"\0")
    need(isinstance(value, dict)
         and value.get("schema") == SCHEMA + ".child-process-identity"
         and value.get("operationId") == OPERATION
         and value.get("requestSha256") == request_sha
         and value.get("namespacePid") == process.pid
         and value.get("parentHostPid") == parent["pid"]
         and value.get("commandSha256") == expected_command,
         "Original child identity changed its inherited request or parent")
    selected = value.get("process")
    need(isinstance(selected, dict)
         and set(selected) == {"pid", "bootId", "startTicks"}
         and isinstance(selected.get("pid"), int) and selected["pid"] > 0
         and selected.get("bootId") == parent["bootId"]
         and isinstance(selected.get("startTicks"), str) and selected["startTicks"].isdecimal(),
         "Original child reported an invalid actual process identity")
    observed = process_observation(selected["pid"])
    need(observed["process"] == selected and observed["parentHostPid"] == parent["pid"]
         and process.poll() is None,
         "Original START-gated child no longer matches its actual procfs identity")
    return selected, value


def subprocess_phase(out, label, arguments, final_receipt):
    request_path = out / (label + ".process-request.json")
    process_path = out / (label + ".process.json")
    expected = {"schema": SCHEMA + ".process-request", "operationId": OPERATION,
                "label": label, "argv": arguments, "receipt": str(final_receipt)}
    publish_json(request_path, expected)
    request_sha = sha(canonical(expected))
    if process_path.exists():
        prior = read_json(process_path)
        need(prior["requestSha256"] == request_sha, "Original child request changed")
        if prior.get("exitCode") == 0:
            need(identity(final_receipt) == prior["receipt"], "Saved cold receiving result differs")
            return prior
        need(original_process_inactive(prior["process"]), "The original cold receiving child remains active")
    for attempt_path in sorted(out.glob(label + ".attempt-*.json")):
        retained_attempt = read_json(attempt_path)
        need(retained_attempt["requestSha256"] == request_sha, "Original child attempt differs")
        need(original_process_inactive(retained_attempt["process"]), "The original cold child is still active")
    # A completed receiving receipt also resolves loss between the child exit and
    # publication of the parent's process result. Its own bound artifact checks
    # are repeated by that child's same immutable entrypoint below.
    stdout = out / (label + ".stdout.log")
    stderr = out / (label + ".stderr.log")
    attempt = len(list(out.glob(label + ".attempt-*.json"))) + 1
    started = now()
    with open(stdout, "ab", buffering=0) as output, open(stderr, "ab", buffering=0) as errors:
        os.chmod(stdout, 0o600)
        os.chmod(stderr, 0o600)
        process, identity_read, identity_write = None, None, None
        try:
            parent = process_identity()
            identity_read, identity_write = os.pipe()
            environment = dict(os.environ)
            environment["ARCHIVEMATICA_RECEIVING_IDENTITY_FD"] = str(identity_write)
            environment["ARCHIVEMATICA_RECEIVING_IDENTITY_REQUEST"] = request_sha
            process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=output,
                         stderr=errors, close_fds=True, pass_fds=(identity_write,),
                         env=environment)
            os.close(identity_write)
            identity_write = None
            selected, observation = receive_child_identity(
                identity_read, process, parent, request_sha, arguments)
            os.close(identity_read)
            identity_read = None
            attempt_path = out / f"{label}.attempt-{attempt:04d}.json"
            publish_json(attempt_path, {"schema": SCHEMA + ".process-attempt",
                         "requestSha256": request_sha, "process": selected,
                         "startedAt": started, "parentProcess": parent,
                         "identityObservation": observation})
            process.stdin.write(b"START\n")
            process.stdin.flush()
            process.stdin.close()
            code = process.wait(timeout=900)
        except BaseException:
            # Every acquired child remains owned through identity publication,
            # the START gate, execution, and an actual terminal wait.
            if process is not None:
                with contextlib.suppress(OSError):
                    process.stdin.close()
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        process.kill()
                    process.wait()
            raise
        finally:
            for descriptor in (identity_read, identity_write):
                if descriptor is not None:
                    with contextlib.suppress(OSError):
                        os.close(descriptor)
        output.flush()
        errors.flush()
        os.fsync(output.fileno())
        os.fsync(errors.fileno())
    result = {"schema": SCHEMA + ".process-result", "requestSha256": request_sha,
              "process": selected, "exitCode": code, "startedAt": started,
              "finishedAt": now(), "stdout": identity(stdout), "stderr": identity(stderr),
              "receipt": identity(final_receipt) if Path(final_receipt).exists() else None}
    replace_json(process_path, result)
    need(code == 0 and result["receipt"] is not None, "Original cold receiving child did not complete")
    return result





class Fixture:
    """Durable synthetic repository state behind two actual HTTP servers."""
    def __init__(self, root, workspace, operation, p, q, dashboard_port, storage_port):
        self.root, self.workspace = Path(root), Path(workspace)
        self.operation, self.p, self.q = operation, p, q
        self.dashboard_port, self.storage_port = dashboard_port, storage_port
        self.guard = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self.exchanges = self.root / "exchanges"
        self.wire_bodies = self.root / "wire-bodies"
        self.effects = self.root / "effects"
        self.repository = self.root / "repository"
        for path in (self.exchanges, self.wire_bodies, self.effects, self.repository):
            path.mkdir(exist_ok=True)
        self.package = q.verify(workspace)["manifest"]
        self.records = read_json(self.workspace / "records.json")
        self.control_path = self.root / "control.json"
        if not self.control_path.exists():
            publish_json(self.control_path, {
                "stage": "START", "aipOnline": False,
                "aipContentsVisible": False, "extractOnline": False,
            })
        self.sequence = max([int(path.name.split("-", 1)[0])
                             for path in self.exchanges.glob("*-request.json")], default=0)
        self.server_errors = []
        self.sip_uuid = operation["arrangedSipUuid"]
        need(str(uuid.UUID(self.sip_uuid)) == self.sip_uuid and self.sip_uuid not in {TRANSFER, DIP},
             "The offline plan must retain a distinct original arranged SIP UUID")
        self.transfer_basename = "Reviewed_Research_169-" + TRANSFER
        publish_json(self.root / "binding.json", {
            "schema": SCHEMA + ".fixture", "operation": operation,
            "packageId": self.package["packageId"],
            "ports": {"dashboard": dashboard_port, "storage": storage_port},
            "transferUuid": TRANSFER, "sipUuid": self.sip_uuid, "dipUuid": DIP,
            "transferBasename": self.transfer_basename,
            "credentialScope": "Fixed synthetic local credentials; no existing account",
            "sourceContract": {"dashboardCommit": DASHBOARD_COMMIT,
                               "storageCommit": STORAGE_COMMIT},
        })

    def control(self):
        return read_json(self.control_path)

    def set_control(self, **values):
        with self.guard:
            old = self.control()
            old.update(values)
            replace_json(self.control_path, old)

    def record(self, kind, method, target, headers, body):
        with self.guard:
            self.sequence += 1
            selected = {key.lower(): value for key, value in headers.items()
                        if key.lower() in {"content-length", "content-type", "referer", "accept"}}
            record = {"schema": SCHEMA + ".http-request", "number": self.sequence,
                      "kind": kind, "method": method, "target": target,
                      "headers": selected, "bodyBytes": len(body), "bodySha256": sha(body),
                      "authorizationSha256": sha(headers.get("Authorization", "").encode()),
                      "cookieSha256": sha(headers.get("Cookie", "").encode()),
                      "csrfSha256": sha(headers.get("X-CSRFToken", "").encode()),
                      "observedAt": now()}
            if body:
                content_type = headers.get("Content-Type", "").split(";", 1)[0].strip()
                if content_type == "application/json":
                    record["json"] = json.loads(body)
                elif content_type == "application/x-www-form-urlencoded":
                    record["form"] = urllib.parse.parse_qs(body.decode("utf-8"), keep_blank_values=True)
            publish(self.wire_bodies / (sha(body) + ".bin"), body)
            record["bodyFile"] = "wire-bodies/" + sha(body) + ".bin"
            publish_json(self.exchanges / f"{self.sequence:08d}-request.json", record)
            return self.sequence

    def response_record(self, number, status, body, disposition, headers=None):
        publish(self.wire_bodies / (sha(body) + ".bin"), body)
        publish_json(self.exchanges / f"{number:08d}-response.json", {
            "status": status, "bytes": len(body), "sha256": sha(body),
            "bodyFile": "wire-bodies/" + sha(body) + ".bin",
            "headers": headers or {}, "disposition": disposition,
            "deliveryAuthority": "Prepared fixture response; the original client exchange determines delivery.",
        })

    def effect(self, label):
        path = self.effects / (label + ".json")
        return read_json(path) if path.exists() else None

    def commit_effect(self, label, number, value):
        path = self.effects / (label + ".json")
        need(not path.exists(), "Duplicate original provider mutation: " + label)
        request = read_json(self.exchanges / f"{number:08d}-request.json")
        value = {"schema": SCHEMA + ".provider-effect", "operationId": OPERATION,
                 "label": label, "requestNumber": number,
                 "requestFile": identity(self.exchanges / f"{number:08d}-request.json"),
                 "method": request["method"], "target": request["target"],
                 "value": value, "committedAt": now()}
        publish_json(path, value)
        return value

    def effect_counts(self):
        return dict(Counter(path.stem for path in self.effects.glob("*.json")))

    def counts(self):
        methods, routes = Counter(), Counter()
        for path in sorted(self.exchanges.glob("*-request.json")):
            value = read_json(path)
            methods[value["kind"] + ":" + value["method"]] += 1
            route = urllib.parse.urlsplit(value["target"]).path
            routes[value["kind"] + ":" + value["method"] + ":" + route] += 1
        return {"methods": dict(methods), "routes": dict(routes),
                "effects": self.effect_counts(), "requests": self.sequence}

    def build_repository(self, staging):
        staged = Path(staging) / self.package["settings"]["transferSource"]["relativePath"]
        result = build_repository_bytes(self.p, self.q, self.workspace, staged,
                                        self.repository, self.sip_uuid, self.transfer_basename)
        need(result["transferUuid"] == TRANSFER and result["sipUuid"] == self.sip_uuid,
             "Fixture repository changed the original transfer or SIP")
        return result

    def repository_source(self):
        return read_json(self.repository / "repository-source.json")

    def archive_bytes(self, package_uuid):
        name = {TRANSFER: "backlog.tar", self.sip_uuid: "aip.tar.gz", DIP: "dip.tar"}[package_uuid]
        path = self.repository / name
        need(identity(path) == self.repository_source()["files"][name],
             "Retained repository package changed")
        return path.read_bytes()

    def member_bytes(self, package_uuid, member):
        need(not member.startswith("/") and "\\" not in member
             and all(part not in {"", ".", ".."} for part in member.split("/")),
             "Unsafe original package extraction path")
        with tarfile.open(fileobj=io.BytesIO(self.archive_bytes(package_uuid)), mode="r:*") as archive:
            item = archive.getmember(member)
            need(item.isfile(), "The original extraction member is not a regular file")
            incoming = archive.extractfile(item)
            need(incoming is not None, "The original extraction member is unavailable")
            with incoming:
                return incoming.read()

    def contents(self, package_uuid):
        if package_uuid == DIP:
            return []
        if package_uuid == self.sip_uuid and not self.control()["aipContentsVisible"]:
            return []
        source = self.repository_source()
        rows = []
        for item in source["mapping"]:
            if package_uuid == TRANSFER:
                if item["transferFileUuid"] is None:
                    continue
                name = self.transfer_basename + "/data/" + item["transferRelativePath"]
                identifier, source_package = item["transferFileUuid"], TRANSFER
            else:
                if item["aipFileUuid"] is None:
                    continue
                name = item["aipPath"]
                identifier = item["aipFileUuid"]
                source_package = TRANSFER if item["isRecord"] else self.sip_uuid
            rows.append({"name": name, "source_id": identifier, "source_package": source_package,
                         "checksum": None, "origin": PIPELINE})
        return rows

    def finish_checks(self):
        need(not self.server_errors, "The original HTTP fixture recorded an unexpected route or contract error")
        source = self.repository_source()
        need(sum(item["isRecord"] for item in source["mapping"]) == 169,
             "Repository source mapping lost an original reviewed record")
        for name, wanted in source["files"].items():
            need(identity(self.repository / name) == wanted, "Original stored repository bytes changed")


class ReceivingServer(http.server.ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address


@contextlib.contextmanager
def servers(fixture):
    opened, threads = [], []
    try:
        for kind, port in (("dashboard", fixture.dashboard_port), ("storage", fixture.storage_port)):
            server = ReceivingServer(("127.0.0.1", port), Handler)
            server.fixture, server.kind = fixture, kind
            opened.append(server)
            thread = threading.Thread(target=server.serve_forever,
                                      kwargs={"poll_interval": 0.05},
                                      name="archivematica-local-" + kind, daemon=False)
            thread.start()
            threads.append(thread)
        yield
    finally:
        for server, thread in zip(opened, threads):
            if thread.is_alive():
                server.shutdown()
        for server in opened:
            server.server_close()
        for thread in threads:
            thread.join(timeout=15)
        need(all(not thread.is_alive() for thread in threads),
             "The original local receiving servers did not drain")


def b64_text(value):
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def decoded_query(value):
    need(isinstance(value, str), "The original path argument is missing")
    return base64.b64decode(value, validate=True).decode("utf-8")


def browse_value(entries, directories=(), properties=None):
    return {"entries": [b64_text(value) for value in entries],
            "directories": [b64_text(value) for value in directories],
            "properties": {b64_text(key): value for key, value in (properties or {}).items()}}


def location_model(fixture, identifier):
    purpose = {TRANSFER_LOCATION: "TS", AIP_LOCATION: "AS",
               DIP_LOCATION: "DS", BACKLOG_LOCATION: "BL"}[identifier]
    return {"uuid": identifier, "resource_uri": "/api/v2/location/" + identifier + "/",
            "description": "Original local contract " + purpose + " location",
            "purpose": purpose, "enabled": True, "relative_path": purpose.lower(),
            "path": str(fixture.root / ("mounted-" + purpose.lower())),
            "space": "/api/v2/space/" + SPACE + "/",
            "pipeline": ["/api/v2/pipeline/" + PIPELINE + "/"]}


def package_model(fixture, identifier):
    source = fixture.repository_source()
    if identifier == TRANSFER:
        kind, location = "transfer", BACKLOG_LOCATION
        current_path, name = "originals/" + fixture.transfer_basename, "backlog.tar"
        related = []
    elif identifier == fixture.sip_uuid:
        kind, location = "AIP", AIP_LOCATION
        current_path, name = source["aipArchiveRoot"] + ".tar.gz", "aip.tar.gz"
        related = ["/api/v2/file/" + DIP + "/"]
    elif identifier == DIP:
        kind, location = "DIP", DIP_LOCATION
        current_path, name = source["aipArchiveRoot"] + ".tar", "dip.tar"
        related = ["/api/v2/file/" + fixture.sip_uuid + "/"]
    else:
        raise RuntimeError("Unknown original package UUID")
    return {"uuid": identifier, "resource_uri": "/api/v2/file/" + identifier + "/",
            "package_type": kind, "status": "UPLOADED",
            "origin_pipeline": "/api/v2/pipeline/" + PIPELINE + "/",
            "current_location": "/api/v2/location/" + location + "/",
            "current_path": current_path, "size": source["files"][name]["bytes"],
            "related_packages": related, "description": "Generated local contract package"}


def choices_xml(fixture):
    root = ET.Element("MCP")
    if fixture.effect("approve-transfer") and not fixture.effect("processing-choice"):
        entry = ET.SubElement(root, "choicesAvailableForUnit")
        unit = ET.SubElement(entry, "unit")
        ET.SubElement(unit, "type").text = "Transfer"
        nested = ET.SubElement(unit, "unitXML")
        ET.SubElement(nested, "UUID").text = TRANSFER
        ET.SubElement(nested, "unitName").text = fixture.transfer_basename
        ET.SubElement(entry, "UUID").text = MCP_JOB
        choices = ET.SubElement(entry, "choices")
        selected = ET.SubElement(choices, "choice")
        ET.SubElement(selected, "chainAvailable").text = CHOICE_BACKLOG
        ET.SubElement(selected, "description").text = "Send the original transfer to backlog"
        other = ET.SubElement(choices, "choice")
        ET.SubElement(other, "chainAvailable").text = CHOICE_REJECT
        ET.SubElement(other, "description").text = "Reject transfer"
    return xml_bytes(root)


def arrangement_value(fixture, requested):
    chosen = fixture.effect("create-arrangement")
    if not chosen:
        return None
    root_path = chosen["value"]["arrangePath"]
    need(requested.startswith(root_path) and requested.endswith("/"),
         "The requested arrangement is outside the original selected path")
    relative = requested[len(root_path):]
    source = fixture.repository_source()
    expected = {item["transferRelativePath"][len("objects/"):]: item["transferFileUuid"]
                for item in source["mapping"]
                if item["transferRelativePath"].startswith("objects/")
                and item["transferFileUuid"]}
    if not fixture.effect("copy-original"):
        need(not relative, "An empty original arrangement has no child directories")
        return browse_value([])
    children, directories, properties = set(), set(), {}
    for name, file_uuid in expected.items():
        if not name.startswith(relative):
            continue
        suffix = name[len(relative):]
        child, separator, tail = suffix.partition("/")
        need(bool(child), "Empty original arrangement child")
        children.add(child)
        if separator:
            directories.add(child)
        else:
            properties[child] = {"file_uuid": file_uuid}
    need(bool(children) or not relative, "Unknown original arrangement directory")
    return browse_value(sorted(children), sorted(directories), properties)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CommonsArchivematicaContract/1"

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        fixture, number = self.server.fixture, None
        try:
            lengths = self.headers.get_all("Content-Length", [])
            need(len(lengths) <= 1 and not self.headers.get("Transfer-Encoding"),
                 "Ambiguous original HTTP request framing")
            length = int(lengths[0]) if lengths else 0
            need(0 <= length <= MAX_BODY, "Original HTTP request exceeds its declared bound")
            body = self.rfile.read(length)
            need(len(body) == length, "Original HTTP request ended before its declared body")
            number = fixture.record(self.server.kind, self.command, self.path, self.headers, body)
            parsed = urllib.parse.urlsplit(self.path)
            need(not parsed.scheme and not parsed.netloc, "Expected a same-origin HTTP request target")
            query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            need(all(len(value) == 1 for value in query.values()), "Repeated original query argument")
            path = parsed.path
            session = self.server.kind == "dashboard" and (
                path.startswith("/mcp/") or path.startswith("/filesystem/"))
            if session:
                need(self.headers.get("Authorization") is None,
                     "API credentials crossed into the original session route")
                need(self.headers.get("Cookie") == SESSION_COOKIE
                     and self.headers.get("X-CSRFToken") == CSRF_TOKEN
                     and self.headers.get("Referer") == f"http://127.0.0.1:{fixture.dashboard_port}/",
                     "The original Dashboard session scope differs")
            else:
                expected = ("ApiKey receiving-dashboard:" + DASHBOARD_KEY
                            if self.server.kind == "dashboard"
                            else "ApiKey receiving-storage:" + STORAGE_KEY)
                need(self.headers.get("Authorization") == expected,
                     "The selected original API credential scope differs")
                need(self.headers.get("Cookie") is None and self.headers.get("X-CSRFToken") is None,
                     "Dashboard session credentials crossed into an API route")
            with fixture.guard:
                self.route(number, path, {key: values[0] for key, values in query.items()}, body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except BaseException as error:
            failure = {"schema": SCHEMA + ".fixture-error", "requestNumber": number,
                       "type": type(error).__name__, "message": str(error),
                       "traceback": traceback.format_exc(), "observedAt": now()}
            fixture.server_errors.append(failure)
            if number is not None:
                publish_json(fixture.exchanges / f"{number:08d}-error.json", failure)
            try:
                self.respond(number, 500, {"error": True, "message": str(error)})
            except (OSError, RuntimeError):
                self.close_connection = True

    def respond(self, number, status, body=None, *, raw=None, content_type="application/json", lost=False):
        fixture = self.server.fixture
        value = canonical(body) if raw is None else raw
        headers = {"Content-Type": content_type, "Content-Length": str(len(value)),
                   "Connection": "close"}
        if self.server.kind == "dashboard":
            headers["X-Archivematica-Version"] = "1.18.0"
            headers["X-Archivematica-ID"] = PIPELINE
        if number is not None:
            fixture.response_record(number, status, value,
                "COMMITTED_RESPONSE_INTENTIONALLY_NOT_SENT" if lost else "RESPONSE_WRITE_STARTED", headers)
        self.close_connection = True
        if lost:
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            return
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(canonical(body) if raw is None else raw)
        self.wfile.flush()

    def route(self, number, path, query, body):
        f, method = self.server.fixture, self.command
        if self.server.kind == "dashboard":
            if method == "GET" and path == "/api/processing-configuration":
                need(not query and not body, "Unexpected configuration-list request")
                return self.respond(number, 200, {"processing_configurations": ["default"]})
            if method == "GET" and path == "/api/processing-configuration/default":
                need(not query and not body, "Unexpected original configuration read")
                raw = (b'<?xml version="1.0" encoding="UTF-8"?>'
                       b'<processingMCP><preconfiguredChoices/></processingMCP>')
                return self.respond(number, 200, raw=raw, content_type="application/xml")
            if method == "POST" and path == "/api/v2beta/package":
                need(not query, "Unexpected transfer creation query")
                supplied = json.loads(body)
                selected = f.package["settings"]
                expected = {"name": selected["name"], "type": "zipped bag",
                            "accession": selected["accession"],
                            "access_system_id": selected["accessSystemId"],
                            "path": b64_text(TRANSFER_LOCATION + ":" +
                                             selected["transferSource"]["relativePath"]),
                            "auto_approve": False, "processing_config": "default"}
                need(supplied == expected, "Transfer creation differs from the original prepared source")
                f.build_repository(os.environ["ARCHIVEMATICA_TRANSFER_SOURCE_ROOT"])
                returned = {"id": TRANSFER}
                f.commit_effect("start-transfer", number, {"request": supplied, "response": returned, "status": 202})
                f.set_control(stage="STARTED")
                return self.respond(number, 202, returned, lost=True)
            if method == "GET" and path == "/api/transfer/status/" + TRANSFER + "/":
                need(not query and not body, "Unexpected transfer status request")
                if not f.effect("start-transfer"):
                    return self.respond(number, 400, {"error": True, "message": "Original transfer has not started"})
                if f.effect("processing-choice"):
                    state, sip = "COMPLETE", "BACKLOG"
                elif f.effect("approve-transfer"):
                    state, sip = "USER_INPUT", None
                else:
                    state, sip = "PROCESSING", None
                return self.respond(number, 200, {"uuid": TRANSFER, "type": "transfer",
                    "status": state, "directory": f.transfer_basename, "sip_uuid": sip})
            if method == "GET" and path == "/api/ingest/status/" + f.sip_uuid + "/":
                need(not query and not body, "Unexpected original SIP status request")
                if not f.effect("create-sip"):
                    return self.respond(number, 400, {"error": True, "message": "Original SIP not yet created"})
                return self.respond(number, 200, {"uuid": f.sip_uuid, "type": "SIP",
                                                 "status": "COMPLETE"})
            if method == "GET" and path == "/api/transfer/unapproved/":
                need(not query and not body, "Unexpected unapproved transfer request")
                rows = ([{"uuid": TRANSFER, "type": "zipped bag", "directory": f.transfer_basename}]
                        if f.effect("start-transfer") and not f.effect("approve-transfer") else [])
                return self.respond(number, 200, {"results": rows})
            if method == "POST" and path == "/api/transfer/approve/":
                form = urllib.parse.parse_qs(body.decode(), keep_blank_values=True)
                need(form == {"directory": [f.transfer_basename], "type": ["zipped bag"]}
                     and f.effect("start-transfer"), "Approval lost its original transfer binding")
                result = {"uuid": TRANSFER}
                f.commit_effect("approve-transfer", number, {"response": result, "status": 200})
                f.set_control(stage="CHOICE")
                return self.respond(number, 200, result)
            if method == "GET" and path in {"/api/v2beta/jobs/" + TRANSFER,
                                           "/api/v2beta/jobs/" + f.sip_uuid}:
                need(query == {"detailed": ""} and not body, "Expected original detailed job inventory")
                return self.respond(number, 200, [{"uuid": MCP_JOB, "name": "Create SIP(s)",
                    "microservice": "Create SIP(s)", "currentstep": "Awaiting decision"
                    if not f.effect("processing-choice") else "Completed successfully",
                    "exitcode": None if not f.effect("processing-choice") else 0}])
            if method == "GET" and path == "/mcp/list/":
                need(not query and not body, "Unexpected original MCP choice request")
                return self.respond(number, 200, raw=choices_xml(f), content_type="application/xml")
            if method == "POST" and path == "/mcp/execute/":
                supplied = urllib.parse.parse_qs(body.decode(), keep_blank_values=True)
                need(not query and supplied == {"uuid": [MCP_JOB], "choice": [CHOICE_BACKLOG]}
                     and f.effect("approve-transfer"),
                     "Choice does not identify the original observed job and option")
                f.commit_effect("processing-choice", number, {
                    "unitUuid": TRANSFER, "jobUuid": MCP_JOB, "choiceId": CHOICE_BACKLOG,
                    "status": 200, "response": None})
                f.set_control(stage="BACKLOG")
                return self.respond(number, 200, raw=b"", content_type="text/plain", lost=True)
            if method == "GET" and path == "/filesystem/contents/arrange/":
                need(set(query) == {"path"} and not body, "Unexpected arrangement listing")
                requested = decoded_query(query["path"])
                result = arrangement_value(f, requested)
                if result is None:
                    return self.respond(number, 404, {"error": True, "message": "Original arrangement absent"})
                return self.respond(number, 200, result)
            if method == "POST" and path == "/filesystem/create_directory_within_arrange/":
                form = urllib.parse.parse_qs(body.decode(), keep_blank_values=True)
                need(set(form) == {"paths[]"} and len(form["paths[]"]) == 1,
                     "Expected one original arrangement directory")
                selected = decoded_query(form["paths[]"][0])
                need(selected == ARRANGE_PATH and f.effect("processing-choice"),
                     "Arrangement path differs from the explicit original decision")
                f.commit_effect("create-arrangement", number, {"arrangePath": selected})
                return self.respond(number, 201, {"message": "Directory created successfully"})
            if method == "POST" and path == "/filesystem/copy_to_arrange/":
                form = urllib.parse.parse_qs(body.decode(), keep_blank_values=True)
                expected = {"filepath": [b64_text("/originals/" + f.transfer_basename + "/data/objects/")],
                            "destination": [b64_text(ARRANGE_PATH)]}
                need(form == expected and f.effect("create-arrangement"),
                     "Original backlog copy changed source or destination")
                f.commit_effect("copy-original", number, {
                    "sourcePath": "/originals/" + f.transfer_basename + "/data/objects/",
                    "arrangePath": ARRANGE_PATH})
                return self.respond(number, 201, {"message": "Files copied successfully"})
            if method == "POST" and path == "/filesystem/copy_from_arrange/":
                form = urllib.parse.parse_qs(body.decode(), keep_blank_values=True)
                need(form == {"filepath": [b64_text(ARRANGE_PATH)], "uuid": [f.sip_uuid]}
                     and f.effect("copy-original"),
                     "SIP creation lost the offline-selected UUID or original arrangement")
                result = {"sip_uuid": f.sip_uuid}
                f.commit_effect("create-sip", number, {"status": 201, "response": result,
                                                       "arrangePath": ARRANGE_PATH})
                f.set_control(stage="STORED")
                return self.respond(number, 201, result, lost=True)
        else:
            if method == "GET" and path == "/api/v2/pipeline/" + PIPELINE + "/":
                need(not query and not body, "Unexpected original pipeline request")
                return self.respond(number, 200, {"uuid": PIPELINE, "enabled": True,
                    "resource_uri": "/api/v2/pipeline/" + PIPELINE + "/",
                    "description": "Original local released-contract pipeline"})
            if method == "GET" and path == "/api/v2/location/":
                need(query == {"pipeline__uuid": PIPELINE, "purpose": "BL", "offset": "0"},
                     "The original Dashboard first-BL query differs")
                return self.respond(number, 200, {"objects": [location_model(f, BACKLOG_LOCATION)],
                    "meta": {"limit": 20, "offset": 0, "total_count": 1, "next": None, "previous": None}})
            match = re.fullmatch(r"/api/v2/location/([0-9a-f-]+)/", path)
            if method == "GET" and match:
                need(not query and match[1] in {TRANSFER_LOCATION, AIP_LOCATION, DIP_LOCATION, BACKLOG_LOCATION},
                     "Unknown selected Storage location")
                return self.respond(number, 200, location_model(f, match[1]))
            match = re.fullmatch(r"/api/v2/location/([0-9a-f-]+)/browse/", path)
            if method == "GET" and match:
                need(set(query) == {"path"} and not body, "Unexpected original Storage browse request")
                requested = decoded_query(query["path"])
                if match[1] == TRANSFER_LOCATION:
                    need(requested == "research", "Original source listing changed directory")
                    target = Path(os.environ["ARCHIVEMATICA_TRANSFER_SOURCE_ROOT"]) / \
                        f.package["settings"]["transferSource"]["relativePath"]
                    need(identity(target) == {key: f.package["originalBag"][key]
                                              for key in ("bytes", "sha256")},
                         "Storage source listing does not have the original staged ZIP")
                    result = browse_value([target.name], properties={target.name: {"size": target.stat().st_size}})
                else:
                    need(match[1] == BACKLOG_LOCATION and requested ==
                         "originals/" + f.transfer_basename + "/data" and f.effect("processing-choice"),
                         "Original backlog listing differs")
                    result = browse_value(["objects", "metadata", "logs"], ["objects", "metadata", "logs"])
                return self.respond(number, 200, result)
            match = re.fullmatch(r"/api/v2/file/([0-9a-f-]+)/(contents/|download/|extract_file/|check_fixity/)?", path)
            if method == "GET" and match:
                identifier, endpoint = match[1], match[2] or ""
                need(identifier in {TRANSFER, f.sip_uuid, DIP}, "Unexpected original stored package")
                available = f.effect("processing-choice") if identifier == TRANSFER else f.effect("create-sip")
                if not available:
                    return self.respond(number, 404, {"error": True, "message": "Original package not stored"})
                if endpoint == "":
                    need(not query and not body, "Unexpected package-model parameters")
                    return self.respond(number, 200, package_model(f, identifier))
                if endpoint == "contents/":
                    need(not query and not body, "Unexpected stored contents parameters")
                    return self.respond(number, 200, {"success": True, "package": identifier,
                                                      "files": f.contents(identifier)})
                if endpoint == "download/":
                    need(not query and not body, "Unexpected whole package download parameters")
                    if identifier == f.sip_uuid and not f.control()["aipOnline"]:
                        return self.respond(number, 202, {"message": "Extraction in progress", "package": identifier})
                    return self.respond(number, 200, raw=f.archive_bytes(identifier),
                                        content_type="application/octet-stream")
                if endpoint == "extract_file/":
                    need(identifier == f.sip_uuid and set(query) == {"relative_path_to_file"},
                         "Extraction changed the original AIP identity or relative member")
                    if not f.control()["extractOnline"]:
                        return self.respond(number, 202, {"message": "Extraction in progress", "package": identifier})
                    return self.respond(number, 200, raw=f.member_bytes(identifier, query["relative_path_to_file"]),
                                        content_type="application/octet-stream")
                if endpoint == "check_fixity/":
                    need(identifier == f.sip_uuid and query == {"force_local": "true"},
                         "Effectful fixity must name the original AIP and selected option")
                    raw = f.archive_bytes(identifier)
                    original = f.repository_source()["files"]["aip.tar.gz"]
                    need(identity_bytes(raw) == original, "Original compressed AIP differs before fixity")
                    result = {"success": True, "message": "Package checksum verified",
                              "missing": [], "changed": [], "untracked": []}
                    f.commit_effect("check-fixity", number, {"status": 200, "response": result,
                                                             "packageUuid": identifier})
                    return self.respond(number, 200, result, lost=True)
        raise RuntimeError("Unexpected released-contract route: " + self.server.kind + " " + method + " " + self.path)



def original_response_evidence(out, workspace, fixture, label, key, effect_label, *, start=False):
    path = out / (label + ".evidence.json")
    action = original_action(workspace, key)
    effect = fixture.effect(effect_label)
    need(action and action["started"] and effect, "Original response lacks a dispatched request and retained effect")
    response_path = fixture.exchanges / f"{effect['requestNumber']:08d}-response.json"
    response = read_json(response_path)
    raw = (fixture.root / response["bodyFile"]).read_bytes()
    need(identity_bytes(raw) == {name: response[name] for name in ("bytes", "sha256")}
         and response["disposition"] == "COMMITTED_RESPONSE_INTENTIONALLY_NOT_SENT",
         "Evidence does not identify the original deliberately withheld complete response")
    evidence = {
        "schema": "stellar-forge.archivematica-operation.v1.reconciliation",
        "kind": "original-start-response" if start else "original-action-response",
        "requestSha256": action["requestFile"]["sha256"],
        "response": {"status": response["status"], "body": json.loads(raw) if raw else None},
        "note": "Operator-supplied original local fixture response, retained before intentional response loss; "
                "same original request and effect, with no new transfer, choice or fixity invocation.",
    }
    if not start:
        evidence["actionKey"] = key
    publish_json(path, evidence)
    publish_json(out / (label + ".evidence-source.json"), {
        "schema": SCHEMA + ".original-response-source", "operationId": OPERATION,
        "actionKey": key, "effect": effect,
        "actionRequest": action["requestFile"], "response": identity(response_path),
        "responseBody": identity_bytes(raw), "evidence": identity(path),
    })
    return evidence


def original_phase_state(out, label, expected):
    request = read_json(out / "phases" / (label + ".request.json"))
    result = read_json(out / "phases" / (label + ".result.json"))
    need(request.get("schema") == SCHEMA + ".phase-request"
         and request.get("operationId") == OPERATION and request.get("label") == label
         and request.get("expected") == expected
         and result.get("schema") == SCHEMA + ".phase-result"
         and result.get("operationId") == OPERATION and result.get("label") == label
         and result.get("expected") == expected
         and result.get("requestSha256") == sha(canonical(request)),
         "The original decision phase observation changed")
    state = result.get("observedState")
    need(isinstance(state, dict) and state.get("operationId") == OPERATION
         and state.get("state") == expected,
         "The retained decision phase belongs to another original state")
    return state


def verify_pending_observation(workspace, value):
    descriptor = value.get("observation")
    need(isinstance(descriptor, dict), "Missing original observation descriptor")
    relative = descriptor.get("path")
    need(isinstance(relative, str) and relative.startswith("operations/" + OPERATION + "/")
         and not relative.startswith("/") and "\\" not in relative
         and all(part not in {"", ".", ".."} for part in relative.split("/")),
         "The original observation left its prepared operation")
    path = Path(workspace).joinpath(*relative.split("/"))
    need(path.resolve() == path.absolute(), "The original observation path changed")
    need(isinstance(descriptor.get("bytes"), int) and not isinstance(descriptor["bytes"], bool)
         and 0 <= descriptor["bytes"] <= MAX_BODY
         and isinstance(descriptor.get("sha256"), str)
         and re.fullmatch(r"[0-9a-f]{64}", descriptor["sha256"])
         and identity(path) == {"bytes": descriptor["bytes"], "sha256": descriptor["sha256"]},
         "The original decision observation bytes changed")
    return descriptor["sha256"]


def original_choice(out, workspace):
    # This phase receipt precedes the first chosen-decision publication. It is
    # therefore the original observation even after later client state advances.
    state = original_phase_state(out, "04-approve-original-wait-choice", "WAITING_FOR_DECISION")
    matches = [item for item in state.get("pendingChoices", [])
               if item["unitUuid"] == TRANSFER and item["jobUuid"] == MCP_JOB]
    need(len(matches) == 1 and CHOICE_BACKLOG in {item["choiceId"] for item in matches[0]["choices"]},
         "The original pending processing choice was not observed")
    observed = matches[0]
    observed_sha = verify_pending_observation(workspace, observed)
    value = {"schema": "stellar-forge.archivematica-operation.v1.decision",
             "kind": "processing-choice", "unitUuid": TRANSFER,
             "jobUuid": MCP_JOB, "choiceId": CHOICE_BACKLOG,
             "observationSha256": observed_sha,
             "note": "Explicit local operator selection of the observed original backlog option."}
    path = out / "original-processing-choice.json"
    if path.exists():
        need(read_json(path) == value, "Original processing choice changed")
    # Reconcile a death after the choice but before its companion receipt. Both
    # files are exact immutable copies; neither path dispatches a decision.
    publish_json(out / "original-pending-choice.json", observed)
    publish_json(path, value)
    return value


def original_backlog(out, workspace):
    state = original_phase_state(out, "07-adopt-choice-observe-backlog", "BACKLOG")
    observed = state.get("pendingBacklog")
    need(observed and observed["transferUuid"] == TRANSFER
         and observed["sourcePath"].startswith("/originals/"),
         "The original transfer backlog was not observed")
    observed_sha = verify_pending_observation(workspace, observed)
    value = {"schema": "stellar-forge.archivematica-operation.v1.decision",
             "kind": "arrange-backlog", "transferUuid": TRANSFER,
             "observationSha256": observed_sha,
             "arrangePath": ARRANGE_PATH,
             "note": "Explicit original backlog inventory and one new arrangement path; use its offline-selected SIP UUID."}
    path = out / "original-backlog-choice.json"
    if path.exists():
        need(read_json(path) == value, "Original backlog arrangement changed")
    publish_json(out / "original-pending-backlog.json", observed)
    publish_json(path, value)
    return value


def run_phases(out, workspace, c, app, fixture):
    results = []
    def continued(action, evidence=None):
        value = app.continue_migration(OPERATION, action, evidence)
        need(value.get("operationId") == OPERATION and isinstance(value.get("result"), dict),
             "Workbench continuation returned another original operation")
        return value["result"]
    def step(label, action, expected, call, **options):
        result = phase(out, label, workspace, c, fixture, action, expected, call, **options)
        results.append(result)
        return result
    def one_effect(label):
        need(fixture.effect_counts().get(label) == 1, "Original provider effect was not retained once: " + label)
    def same_action(key, terminal=None):
        action = original_action(workspace, key)
        need(action and action["started"], "The original action was not journaled before dispatch")
        if terminal:
            need(action["result"] and action["result"]["state"] in terminal,
                 "The original action lacks its accepted retained result")
        else:
            need(action["result"] is None, "The deliberately uncertain original action was overwritten")
        return action

    step("01-start-response-lost", "run", "RECONCILIATION_REQUIRED", lambda: continued("run"),
         verify=lambda value: (one_effect("start-transfer"), same_action("start-transfer")))
    step("02-repeat-original-start", "run", "RECONCILIATION_REQUIRED", lambda: continued("run"),
         verify=lambda value: (one_effect("start-transfer"), same_action("start-transfer")))
    start_evidence = original_response_evidence(out, workspace, fixture, "original-start",
                                                "start-transfer", "start-transfer", start=True)
    step("03-adopt-original-transfer", "reconcile", "TRANSFER_PROCESSING",
         lambda: continued("reconcile", start_evidence),
         verify=lambda value: need(value.get("transferUuid") == TRANSFER,
                                   "Reconciliation returned another original transfer"))
    step("04-approve-original-wait-choice", "run", "WAITING_FOR_DECISION", lambda: continued("run"),
         verify=lambda value: (one_effect("approve-transfer"),
                              same_action("approve-transfer", {"CONFIRMED", "ADOPTED"})))
    choice = original_choice(out, workspace)
    step("05-original-choice-response-lost", "decide", "RECONCILIATION_REQUIRED",
         lambda: continued("decide", choice),
         verify=lambda value: (one_effect("processing-choice"), same_action("choices/" + MCP_JOB)))
    step("06-repeat-original-choice", "decide", "RECONCILIATION_REQUIRED",
         lambda: continued("decide", choice),
         verify=lambda value: (one_effect("processing-choice"), same_action("choices/" + MCP_JOB)))
    choice_evidence = original_response_evidence(out, workspace, fixture, "original-choice",
                                                 "choices/" + MCP_JOB, "processing-choice")
    step("07-adopt-choice-observe-backlog", "reconcile", "BACKLOG",
         lambda: continued("reconcile", choice_evidence))
    backlog = original_backlog(out, workspace)
    step("08-arrange-original-sip-response-lost", "decide", "RECONCILIATION_REQUIRED",
         lambda: continued("decide", backlog),
         verify=lambda value: (one_effect("create-arrangement"), one_effect("copy-original"),
                              one_effect("create-sip"), same_action("backlog/create-sip")))
    step("09-recover-original-planned-sip", "decide", "READY_TO_VERIFY",
         lambda: continued("decide", backlog),
         verify=lambda value: (
             need(value.get("sipUuid") == fixture.sip_uuid and value.get("aipUuid") == fixture.sip_uuid,
                  "Original arranged SIP and stored AIP changed"),
             one_effect("create-sip"), same_action("backlog/create-sip", {"ADOPTED"})))
    step("10-original-aip-offline", "run", "OFFLINE_RETRIEVAL_PENDING", lambda: continued("run"),
         verify=lambda value: need(value.get("details", {}).get("endpoint") == "download",
                                   "Expected the original offline package request"))
    step("11-original-extraction-offline", "run", "OFFLINE_RETRIEVAL_PENDING",
         lambda: continued("run"), setup=lambda: fixture.set_control(aipOnline=True),
         verify=lambda value: need(value.get("details", {}).get("endpoint") == "extract_file",
                                   "Expected the original offline extraction request"))
    step("12-whole-original-proof-fixity-response-lost", "run", "RECONCILIATION_REQUIRED",
         lambda: continued("run"), setup=lambda: fixture.set_control(extractOnline=True),
         verify=lambda value: (one_effect("check-fixity"), same_action("fixity/aip")))
    step("13-repeat-original-fixity-no-replay", "run", "RECONCILIATION_REQUIRED",
         lambda: continued("run"),
         verify=lambda value: (one_effect("check-fixity"), same_action("fixity/aip")))
    fixity_evidence = original_response_evidence(out, workspace, fixture, "original-fixity",
                                                 "fixity/aip", "check-fixity")
    step("14-adopt-original-fixity", "reconcile", "READY_TO_VERIFY",
         lambda: continued("reconcile", fixity_evidence),
         verify=lambda value: same_action("fixity/aip", {"ADOPTED"}))
    step("15-complete-original169", "run", "VERIFIED", lambda: continued("run"))
    # The initially empty AIP database inventory is not an archive manifest.
    # Later rows expose nullable checksums and original transfer provenance.
    step("16-observe-original-nullable-inventory", "refresh", "VERIFIED",
         lambda: continued("refresh"), setup=lambda: fixture.set_control(aipContentsVisible=True),
         verify=lambda value: need(bool(value.get("aipContents", {}).get("files")),
                                   "Expected the later original optional inventory"))
    return results


def verify_original_actions(workspace, fixture):
    labels = {"start-transfer": "start-transfer", "approve-transfer": "approve-transfer",
              "choices/" + MCP_JOB: "processing-choice",
              "backlog/create-directory": "create-arrangement",
              "backlog/copy-original": "copy-original",
              "backlog/create-sip": "create-sip", "fixity/aip": "check-fixity"}
    result = {}
    need(fixture.effect_counts() == {label: 1 for label in labels.values()},
         "The receiving flow must perform each original mutation exactly once")
    for key, label in labels.items():
        action = original_action(workspace, key)
        need(action and action["started"] and action["result"]
             and action["result"]["state"] in {"CONFIRMED", "ADOPTED"},
             "Unresolved original provider action remains: " + key)
        effect = fixture.effect(label)
        observed = read_json(fixture.exchanges / f"{effect['requestNumber']:08d}-request.json")
        description = action["request"]
        parsed = urllib.parse.urlsplit(description["url"])
        target = parsed.path + ("?" + parsed.query if parsed.query else "")
        need(description["method"] == observed["method"] and target == observed["target"],
             "Retained action differs from the actual provider request")
        raw = b"" if description["body"] is None else description["body"].encode("utf-8")
        need(identity_bytes(raw) == {"bytes": observed["bodyBytes"], "sha256": observed["bodySha256"]},
             "Retained original action body differs from actual HTTP")
        need(action["result"]["actionKey"] == key and
             action["result"]["requestSha256"] == action["requestFile"]["sha256"],
             "Original provider result lost its request binding")
        result[key] = {"request": action["requestFile"], "started": action["startedFile"],
                       "result": action["resultFile"], "state": action["result"]["state"],
                       "providerEffect": identity(fixture.effects / (label + ".json"))}
    return result


def verify_complete(c, q, workspace, fixture):
    state = current_state(c, workspace)
    need(state["state"] == "VERIFIED" and state["transferUuid"] == TRANSFER
         and state["sipUuid"] == fixture.sip_uuid and state["aipUuid"] == fixture.sip_uuid
         and state["dipUuids"] == [DIP], "The complete original repository identity differs")
    descriptor = state["proof"]
    proof_path = Path(workspace) / descriptor["path"]
    need(identity(proof_path) == {name: descriptor[name] for name in ("bytes", "sha256")},
         "Original proof bytes differ from their retained descriptor")
    proof = read_json(proof_path)
    summary = proof["summary"]
    expected = {"sourceRecords": 169, "includedRecords": 169, "excludedRecords": 0,
                "originalTransferUuid": TRANSFER, "originalSipUuid": fixture.sip_uuid,
                "originalAipUuid": fixture.sip_uuid, "dipUuids": [DIP],
                "allOriginalBytesVerified": True, "allMappedMetadataVerified": True,
                "allStoredBagitPayloadVerified": True, "allDeclaredBagitTagsVerified": True,
                "allSelectedRequirementsVerified": True}
    need(all(summary.get(key) == value for key, value in expected.items()),
         "Complete receiving did not prove all169 original source and mapped metadata records")
    prepared = q.verify(workspace)
    members = prepared["manifest"]["bagMembers"]
    need(len(proof["aip"]["files"]) == len(members)
         and len(proof["aip"]["records"]) == 169
         and summary["originalMembers"] == len(members),
         "Complete original bag or record inventory differs")
    actual = {item["submittedPath"]: {key: item[key] for key in ("bytes", "sha256")}
              for item in proof["aip"]["files"]}
    need(actual == {item["path"]: {key: item[key] for key in ("bytes", "sha256")} for item in members},
         "The actual received originals do not match the prepared BagIt")
    records = {row["payloadPath"]: row for row in read_json(Path(workspace) / "records.json") if row["include"]}
    need({row["payloadPath"] for row in proof["aip"]["records"]} == set(records),
         "Received source-record identities differ")
    need(proof["aip"]["transferUuid"] == TRANSFER
         and proof["aip"]["transferBasename"] == fixture.transfer_basename
         and proof["aip"]["metadataTransferBasename"] == "transfer-" + TRANSFER,
         "Backlog transfer metadata/submission associations differ")
    need(proof["fixity"]["success"] is True and proof["fixity"]["requested"] is True
         and len(proof["dips"]) == 1 and proof["dips"][0]["dipUuid"] == DIP,
         "The requested AIP fixity and distinct DIP receipt are incomplete")
    need(all(item.get("checksum") is None for item in state["aipContents"]["files"]),
         "The fixture must preserve nullable Storage checksums")
    archive_download = proof["aip"]["packageDownload"]["file"]
    need({key: archive_download[key] for key in ("bytes", "sha256")} ==
         fixture.repository_source()["files"]["aip.tar.gz"],
         "The client retained a different complete stored AIP")
    downloads = sorted((Path(workspace) / "operations" / OPERATION / "downloads").glob("*/result.json"))
    for path in downloads:
        item = read_json(path)
        need(identity(Path(workspace) / item["file"]["path"]) ==
             {key: item["file"][key] for key in ("bytes", "sha256")},
             "An original retained download changed")
    actions = verify_original_actions(workspace, fixture)
    fixture.finish_checks()
    return state, proof, {"actions": actions, "downloadCount": len(downloads),
                          "package": prepared, "proof": {"path": str(proof_path), **identity(proof_path)}}




def scan_snapshot_credentials(path):
    forbidden = tuple(value.encode() for value in
                      (DASHBOARD_KEY, STORAGE_KEY, SESSION_COOKIE, CSRF_TOKEN))
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("application/"):
                continue
            with archive.open(name) as incoming:
                tail = b""
                for block in iter(lambda: incoming.read(262144), b""):
                    window = tail + block
                    need(all(value not in window for value in forbidden),
                         "Portable repository state retained a credential value")
                    tail = window[-512:]


def cold_provider(args):
    p, q, c = imports(args.application, workbench=False)
    out, workspace = Path(args.out).absolute(), Path(args.workspace).absolute()
    out.mkdir(parents=True, exist_ok=True)
    request_path, result_path = out / "cold-request.json", out / "cold-result.json"
    operation = c.show(workspace, OPERATION)["operation"]
    if request_path.exists():
        request = read_json(request_path)
        need(request["operation"] == operation and request["workspace"] == str(workspace),
             "Cold original operation changed")
    else:
        need(current_state(c, workspace)["state"] == "VERIFIED",
             "Cold receiving requires the original completed repository state")
        request = {"schema": SCHEMA + ".cold-request", "operation": operation,
                   "workspace": str(workspace), "beforeState": state_identity(workspace),
                   "application": str(Path(args.application).absolute())}
        publish_json(request_path, request)
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == sha(canonical(request)),
             "Cold result binding changed")
        need(current_state(c, workspace)["state"] == "VERIFIED",
             "Cold original state is no longer verified")
        for artifact in result["artifacts"]:
            need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
                 "Cold completed artifact differs")
        print(json.dumps({"coldProvider": "REOPENED", "receipt": str(result_path)}), flush=True)
        return
    old = current_state(c, workspace)
    if state_identity(workspace) != request["beforeState"] and old["state"] == "VERIFIED":
        returned = old
        observed = [old["state"]]
        basis = "Original cold receiving recovered from its committed verified state"
    else:
        returned = c.refresh(workspace, OPERATION)
        observed = [returned.get("state")]
        if returned.get("state") != "VERIFIED":
            returned = c.run(workspace, OPERATION)
            observed.append(returned.get("state"))
        basis = "Received application refreshed and continued the same retained operation"
    need(returned["state"] == "VERIFIED",
         "Cold provider continuation did not verify the original repository package")
    need(c.show(workspace, OPERATION)["operation"] == operation,
         "Cold continuation replaced the original operation")
    output = provider_snapshot(q, c, workspace,
                               out / "Archivematica_Cold_Original_Operation.zip")
    scan_snapshot_credentials(output["path"])
    result = {"schema": SCHEMA + ".cold-result", "operationId": OPERATION,
              "requestSha256": sha(canonical(request)), "basis": basis,
              "observedStates": observed, "state": returned,
              "artifacts": [output], "process": process_identity(), "observedAt": now()}
    publish_json(result_path, result)
    print(json.dumps({"coldProvider": "VERIFIED", "receipt": str(result_path)}), flush=True)


def cold_workbench(args):
    p, q, c, w = imports(args.application)
    out, workspace = Path(args.out).absolute(), Path(args.workspace).absolute()
    out.mkdir(parents=True, exist_ok=True)
    request = read_json(args.request)
    result_path = out / "cold-workbench-result.json"
    if result_path.exists():
        result = read_json(result_path)
        need(result["requestSha256"] == sha(canonical(request)), "Cold Workbench request differs")
        need(w.source_selection(p.show(workspace)) == result["laterSourceSelection"],
             "Cold completed review changed")
        for artifact in result["artifacts"]:
            need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
                 "Cold Workbench artifact differs")
        print(json.dumps({"coldWorkbench": "REOPENED", "receipt": str(result_path)}), flush=True)
        return
    app = w.Workbench(workspace)
    try:
        before_root, before_selection = app.operation(OPERATION)
        before = current_state(c, before_root / "prepared")
        need(before["state"] == "VERIFIED", "Received Workbench lost the original verified operation")
        app.prepare_migration(request)
        root, selected = app.operation(OPERATION)
        after = current_state(c, root / "prepared")
        need(selected == before_selection and before == after,
             "Offline Workbench reopen changed the provider state or original selection")
        review_path = out / "later-review-request.json"
        project, prepared = p.project_files(workspace)
        if review_path.exists():
            review_request = read_json(review_path)
        else:
            current, saved = p.current_review(workspace, prepared)
            review = json.loads(json.dumps(saved["review"]))
            review["note"] = "Later local operator note; the completed original169 migration remains frozen."
            review_request = {"schema": SCHEMA + ".later-review", "operationId": OPERATION,
                              "expectedRevision": current["revision"],
                              "sourceManifestSha256": project["binding"]["manifestSha256"],
                              "review": p.normalize_review(review, prepared)}
            publish_json(review_path, review_request)
        desired_sha = p.digest(p.canonical(review_request["review"]))
        current = p.show(workspace)
        if current["reviewSha256"] != desired_sha:
            need(current["revision"] == review_request["expectedRevision"],
                 "Later review advanced beyond this original receiving request")
            p.save_review(workspace, review_request["review"], review_request["expectedRevision"])
        later = w.source_selection(p.show(workspace))
        need(later["reviewSha256"] == desired_sha
             and later["revision"] == review_request["expectedRevision"] + 1,
             "The original later review did not commit once")
        original_receive = w.receive_workspace(args.snapshot, args.receiver_root)
        need(original_receive["reused"] is True and w.source_selection(p.show(workspace)) == later,
             "Re-receiving the original full snapshot rolled back the later saved review")
        app.prepare_migration(request)
        after_root, retained = app.operation(OPERATION)
        need(retained == before_selection and current_state(c, after_root / "prepared") == before,
             "Reopening the frozen original migration changed its selected source or verified state")
        output = workbench_snapshot(w, p, c, app,
            app.control / "deliveries/Archivematica_Cold_Complete_Workbench.zip", later)
        scan_snapshot_credentials(output["path"])
        result = {"schema": SCHEMA + ".cold-workbench", "operationId": OPERATION,
                  "requestSha256": sha(canonical(request)), "workspace": str(workspace),
                  "prepared": str(root / "prepared"), "state": after,
                  "originalMigrationSelection": selected["selection"],
                  "laterSourceSelection": later, "originalSnapshotReused": True,
                  "artifacts": [output], "process": process_identity(), "observedAt": now()}
    finally:
        app.close()
    publish_json(result_path, result)
    print(json.dumps({"coldWorkbench": "VERIFIED", "receipt": str(result_path)}), flush=True)



def freeze_application(application, out):
    rows = application_identity(application)
    binding = {"schema": SCHEMA + ".application", "operationId": OPERATION, "files": rows}
    publish_json(out / "application-binding.json", binding)
    # The complete Workbench ZIP below includes these original application files.
    # This small plain-source copy makes the receiving entrypoint inspectable too.
    source = Path(__file__).absolute()
    copy_immutable(source, out / "receiving-source/run-archivematica-receiving.py")
    return binding


def final_checks(value):
    for artifact in value["artifacts"].values():
        need(identity(artifact["path"]) == {key: artifact[key] for key in ("bytes", "sha256")},
             "A completed original receiving artifact changed")
    for item in value["retainedChecks"]:
        need(identity(item["path"]) == {"bytes": item["bytes"], "sha256": item["sha256"]},
             "A retained original receiving checkpoint changed")



def report_html(result):
    import html
    escape = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr><td>" + escape(name) + "</td><td>" +
                   escape(value["bytes"]) + "</td><td><code>" +
                   escape(value["sha256"]) + "</code></td></tr>"
                   for name, value in result["artifacts"].items())
    phases = "".join("<li><code>" + escape(value["label"]) + "</code>: " +
                     escape(value["expected"]) + "</li>" for value in result["phases"])
    summary = json.dumps(result["summary"], ensure_ascii=False, indent=2)
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Archivematica original169 receiving</title>"
            "<style>body{font:16px/1.5 system-ui;max-width:1100px;margin:40px auto;padding:0 22px}"
            "table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:9px;border-bottom:1px solid #ccd5df}"
            "code{font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}"
            ".scope{padding:16px;background:#f2f2f2;border-left:4px solid #525252}"
            "</style><h1>Archivematica original research receiving</h1>"
            "<p class=\"scope\">This is one completed local protocol receiving operation against "
            "the maintained producer, client and Workbench. Actual Python HTTP requests used "
            "the released Dashboard1.18.0 and Storage Service0.24.0 shapes and synthetic credentials. "
            "The local fixture generated package/METS responses from the original staged source. "
            "No deployed Archivematica engine or repository tenant was contacted.</p>"
            "<p>Operation <code>" + escape(OPERATION) + "</code> retained all169 original CC0 "
            "bibliographic records and their explicit review, transfer <code>" + escape(TRANSFER) +
            "</code>, original arranged SIP <code>" + escape(result["sipUuid"]) +
            "</code>, and distinct related DIP <code>" + escape(DIP) + "</code>.</p>"
            "<h2>Interruption and explicit continuation</h2><ol>" + phases + "</ol>"
            "<p>The first transfer response was deliberately lost after its original effect. "
            "Reconciliation adopted the retained response and original transfer UUID. Processing "
            "choices and backlog arrangement used the observed original unit, job, choice, path "
            "and observation hash. Their action history remained fixed through every resume.</p>"
            "<h2>Preservation evidence</h2><p>The complete stored AIP TAR.GZ and related DIP "
            "were retained. The client checked actual archive members and BagIt manifests, "
            "every original record and supporting bag member, transfer METS OBJID, original "
            "FileUUIDs, PREMIS sizes/digests, AIP FLocat bytes, and reviewed Dublin Core values "
            "linked through the physical METS structure. Copied metadata, submission documentation "
            "and BagIt tags kept their actual backlog-specific paths and exact original bytes.</p>"
            "<p>Storage database contents were deliberately empty or had null checksums. They "
            "remain corroborating observations, separate from complete archive/METS proof. "
            "HTTP202 extraction and effectful fixity responses are retained with their actual "
            "pending or tri-state meaning; an empty failure list is never promoted to success.</p>"
            "<pre>" + escape(summary) + "</pre>"
            "<h2>Portable continuation</h2><p>The completed provider workspace and the whole "
            "Workbench were exported, received and reopened using their copied application in "
            "fresh Python processes. The original transfer/SIP/action identities remained fixed. "
            "Re-receiving the first provider archive preserved later observed state. A later "
            "saved operator review survived reopening the earlier whole-workspace archive, "
            "while the completed migration retained its original frozen review.</p>"
            "<p>Both loopback servers, their non-daemon request threads, both cold children and "
            "all Workbench locks drained before this completion was published. The actual "
            "source/control/prepared paths and complete application are retained for the "
            "original operator and browser handoff.</p>"
            "<h2>Complete portable artifacts</h2><table><thead><tr><th>Artifact</th><th>Bytes</th>"
            "<th>SHA-256</th></tr></thead><tbody>" + rows + "</tbody></table>"
            "<p>The original metadata is CC0. Described publications retain their separate "
            "rights. Provider acceptance remains a distinct step on an authorized deployment.</p></html>").encode("utf-8")

def delivery(out, result):
    """Publish one complete immutable evidence/source handoff after runtime drain."""
    output = out / "Archivematica_Original_169_Complete_Receiving.zip"
    descriptor_path = out / "Archivematica_Original_169_Complete_Receiving.delivery.json"
    required_checkpoints = {}
    root = Path(out).absolute()
    for item in result["retainedChecks"]:
        path = Path(item["path"]).absolute()
        need(path.is_relative_to(root) and path != root and path.resolve() == path,
             "A required receiving checkpoint left its original output root")
        name = path.relative_to(root).as_posix()
        need(name not in {"MANIFEST.json", output.name, descriptor_path.name},
             "A receiving checkpoint collides with its delivery envelope")
        expected = {"bytes": item["bytes"], "sha256": item["sha256"]}
        need(identity(path) == expected, "A required receiving checkpoint changed")
        previous = required_checkpoints.get(name)
        need(previous is None or previous["identity"] == expected,
             "Conflicting retained receiving checkpoint identities")
        required_checkpoints[name] = {"path": path, "identity": expected}
    if output.exists():
        # A later browser may append genuine readback exchanges to this same
        # fixture. Reopen the first immutable completed delivery by its own
        # selected inventory, never rebuild it from that later mutable history.
        with zipfile.ZipFile(output) as archive:
            manifest = json.loads(archive.read("MANIFEST.json"))
        need(manifest.get("schema") == SCHEMA + ".delivery"
             and manifest.get("operationId") == OPERATION
             and manifest.get("resultSha256") == identity(out / "receiving-result.json")["sha256"],
             "The completed archive belongs to another original receiving result")
        need(all(manifest["files"].get(name) == item["identity"]
                 for name, item in required_checkpoints.items()),
             "The completed archive omitted an original receiving checkpoint")
        verify_delivery(output, manifest)
        value = {"schema": SCHEMA + ".delivery-receipt", "operationId": OPERATION,
                 "path": str(output), **identity(output), "members": len(manifest["files"]) + 1,
                 "manifestSha256": sha(canonical(manifest)),
                 "receivingResult": identity(out / "receiving-result.json")}
        publish_json(descriptor_path, value)
        return value
    selected = {
        "receiving-result.json": out / "receiving-result.json",
        "Archivematica_Receiving_Report.html": out / "Archivematica_Receiving_Report.html",
        "receiving-binding.json": out / "receiving-binding.json",
        "application-binding.json": out / "application-binding.json",
        "original-destination-request.json": out / "original-destination-request.json",
        "original-review-request.json": out / "original-review-request.json",
        "prepared-source-binding.json": out / "prepared-source-binding.json",
        "original-source.zip": out / "original-source.zip",
        "receiving-final-control.json": out / "receiving-final-control.json",
    }
    for name, value in result["artifacts"].items():
        selected["artifacts/" + name + ".zip"] = Path(value["path"])
    for name in ("phases", "fixture", "receiving-source", "cold-provider", "cold-workbench"):
        root = out / name
        for path in sorted(root.rglob("*")):
            if path.is_symlink():
                raise RuntimeError("A receiving evidence path is a symlink")
            if path.is_file() and not path.name.endswith(".zip"):
                selected[name + "/" + path.relative_to(root).as_posix()] = path
    for path in sorted(out.glob("*.process*.json")):
        selected[path.name] = path
    for path in sorted(out.glob("*.attempt-*.json")):
        selected[path.name] = path
    for suffix in ("*.stdout.log", "*.stderr.log"):
        for path in sorted(out.glob(suffix)):
            selected[path.name] = path
    for name, item in required_checkpoints.items():
        need(name not in selected or Path(selected[name]).absolute() == item["path"],
             "A required checkpoint collides with another selected delivery member")
        selected[name] = item["path"]
    manifest = {"schema": SCHEMA + ".delivery", "operationId": OPERATION,
                "resultSha256": identity(out / "receiving-result.json")["sha256"],
                "scope": result["scope"],
                "files": {name: identity(path) for name, path in sorted(selected.items())}}
    manifest_raw = canonical(manifest)
    if not output.exists():
        descriptor, temporary = tempfile.mkstemp(prefix=".archivematica-delivery-", dir=out)
        os.close(descriptor)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                for name, path in sorted(selected.items()):
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    info.compress_type = zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED
                    with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                        shutil.copyfileobj(source, target, 262144)
                info = zipfile.ZipInfo("MANIFEST.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, manifest_raw)
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            verify_delivery(temporary, manifest)
            os.link(temporary, output)
            sync_directory(out)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    verify_delivery(output, manifest)
    value = {"schema": SCHEMA + ".delivery-receipt", "operationId": OPERATION,
             "path": str(output), **identity(output), "members": len(selected) + 1,
             "manifestSha256": sha(manifest_raw),
             "receivingResult": identity(out / "receiving-result.json")}
    publish_json(descriptor_path, value)
    return value


def verify_delivery(path, expected):
    with zipfile.ZipFile(path) as archive:
        need(len(archive.namelist()) == len(set(archive.namelist()))
             and set(archive.namelist()) == set(expected["files"]) | {"MANIFEST.json"},
             "Complete receiving ZIP has an unexpected member inventory")
        need(archive.read("MANIFEST.json") == canonical(expected),
             "Complete receiving ZIP manifest differs")
        for name, descriptor in expected["files"].items():
            h, length = hashlib.sha256(), 0
            with archive.open(name) as incoming:
                for block in iter(lambda: incoming.read(262144), b""):
                    h.update(block)
                    length += len(block)
            need({"bytes": length, "sha256": h.hexdigest()} == descriptor,
                 "Complete receiving ZIP member differs: " + name)
        need(archive.testzip() is None, "Complete receiving ZIP failed its CRC readback")




def immutable_checkpoint(path, value):
    path = Path(path)
    if path.exists():
        saved = read_json(path)
        need(saved == value, "Original receiving checkpoint changed: " + str(path))
        return saved
    publish_json(path, value)
    return value


def assert_workbench_closed(workspace):
    control = Path(str(Path(workspace).absolute()) + ".operator")
    path = control / "server.lock"
    need(path.is_file() and not path.is_symlink(), "Original Workbench runtime lock is missing")
    descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        os.close(descriptor)


def publish_completion(out, candidate, *, recovered=False):
    final_checks(candidate)
    assert_workbench_closed(candidate["workbenchWorkspace"])
    assert_workbench_closed(candidate["coldWorkbenchWorkspace"])
    for process in candidate["coldProcesses"]:
        need(process["exitCode"] == 0 and original_process_inactive(process["process"]),
             "An original cold receiving child has not drained")
    result_path = out / "receiving-result.json"
    if result_path.exists():
        result = read_json(result_path)
        need(result["completionCandidateSha256"] == sha(canonical(candidate)),
             "Completed result differs from the original candidate")
    else:
        result = dict(candidate)
        result["status"] = "PASS"
        result["completionCandidateSha256"] = sha(canonical(candidate))
        result["runtimeDrain"] = {
            "httpServers": "CLOSED",
            "requestThreads": "JOINED" if not recovered else "ORIGINAL_PROCESS_ABSENT",
            "coldChildren": "EXITED",
            "workbenchLocks": "REOPENED_WITH_EXCLUSIVE_LOCK",
            "basis": "Original context managers and children drained before final publication"
                     if not recovered else
                     "Exact saved candidate, original process absence, exited original children and exclusive runtime locks",
            "observedAt": now(),
        }
        publish_json(result_path, result)
    publish(out / "Archivematica_Receiving_Report.html", report_html(result))
    artifact = delivery(out, result)
    print(json.dumps({"status": "PASS", "operationId": OPERATION,
                      "recordCount": 169, "nativeState": "VERIFIED",
                      "result": str(result_path), "resultIdentity": identity(result_path),
                      "delivery": artifact, "reopened": recovered}), flush=True)
    return result


def main_journey(args):
    application, source, out = map(lambda value: Path(value).absolute(),
                                    (args.application, args.source, args.out))
    need(1 <= args.dashboard_port <= 65535 and 1 <= args.storage_port <= 65535
         and args.dashboard_port != args.storage_port, "Use two distinct valid loopback ports")
    need(identity(source) == {"bytes": SOURCE_BYTES, "sha256": SOURCE_SHA},
         "The original public169 source bytes differ")
    os.umask(0o077)
    with receiving_lock(out):
        application_binding = freeze_application(application, out)
        binding = {"schema": SCHEMA + ".binding", "operationId": OPERATION,
                   "source": identity(source), "application": application_binding,
                   "ports": {"dashboard": args.dashboard_port, "storage": args.storage_port},
                   "scope": "Local released-contract HTTP receiving, not deployed Archivematica acceptance"}
        publish_json(out / "receiving-binding.json", binding)
        copy_immutable(source, out / "original-source.zip")
        result_path = out / "receiving-result.json"
        candidate_path = out / "receiving-completion-candidate.json"
        if result_path.exists():
            result = read_json(result_path)
            need(result.get("status") == "PASS" and result.get("operationId") == OPERATION
                 and result.get("bindingSha256") == sha(canonical(binding)),
                 "Existing completed receiving result belongs to another original source")
            final_checks(result)
            publish(out / "Archivematica_Receiving_Report.html", report_html(result))
            artifact = delivery(out, result)
            print(json.dumps({"status": "PASS", "reopened": True, "operationId": OPERATION,
                              "result": str(result_path), "delivery": artifact}), flush=True)
            return result
        if candidate_path.exists():
            candidate = read_json(candidate_path)
            need(candidate["bindingSha256"] == sha(canonical(binding))
                 and candidate["operationId"] == OPERATION,
                 "Original completion candidate changed its bound input")
            need(original_process_inactive(candidate["process"]),
                 "The original receiving process still owns its unpublished completion")
            return publish_completion(out, candidate, recovered=True)
        p, q, c, w = imports(application)
        staging = out / "mounted-transfer-source"
        staging.mkdir(exist_ok=True)
        app, foundation, workspace, selection, operation = prepare_foundation(
            p, q, c, w, application, source, out, args.dashboard_port, args.storage_port)
        try:
            fixture = Fixture(out / "fixture", workspace, operation, p, q,
                              args.dashboard_port, args.storage_port)
            with credentials(staging), servers(fixture):
                phases = run_phases(out, workspace, c, app, fixture)
                state, proof, native_checks = verify_complete(c, q, workspace, fixture)
                original_effects = fixture.effect_counts()
                original_downloads = {
                    key: value for key, value in fixture.counts()["routes"].items()
                    if "/download/" in key or "/extract_file/" in key or "/check_fixity/" in key
                }
                # The source and provider operation are frozen before selecting
                # each complete portable artifact. Later cold state is separate.
                provider = provider_snapshot(q, c, workspace, out / "Archivematica_Original_Operation.zip")
                scan_snapshot_credentials(provider["path"])
                provider_root = out / "received-provider"
                received_provider = q.receive(provider["path"], provider_root)
                need(received_provider["binding"]["packageId"] == operation["packageId"],
                     "Provider receiving changed the original package")
                provider_workspace = Path(received_provider["workspace"])
                cold_provider_out = out / "cold-provider"
                cold_provider_out.mkdir(exist_ok=True)
                provider_args = [
                    sys.executable, "-B", str(Path(__file__).absolute()),
                    "--application", str(provider_root / "application"),
                    "--workspace", str(provider_workspace), "--out", str(cold_provider_out),
                    "--cold-provider", "--start-gate",
                ]
                provider_process = subprocess_phase(out, "cold-provider", provider_args,
                                                      cold_provider_out / "cold-result.json")
                provider_result = read_json(cold_provider_out / "cold-result.json")
                later_provider_state = state_identity(provider_workspace)
                reopened_provider = q.receive(provider["path"], provider_root)
                need(reopened_provider["reused"] is True and
                     state_identity(provider_workspace) == later_provider_state,
                     "Re-receiving the original provider snapshot rolled back later state")
                publish_json(out / "provider-receive-reopen.json", {
                    "schema": SCHEMA + ".provider-reopen", "operationId": OPERATION,
                    "archive": identity(provider["path"]), "originalBinding": received_provider["binding"],
                    "laterState": later_provider_state, "reused": True,
                })
                whole = workbench_snapshot(w, p, c, app,
                    app.control / "deliveries/Archivematica_Original_Complete_Workbench.zip", selection)
                scan_snapshot_credentials(whole["path"])
                whole_root = out / "received-workbench"
                received_workbench = w.receive_workspace(whole["path"], whole_root)
                need(received_workbench["status"]["sourceRecords"] == 169,
                     "Whole Workbench receiving lost original source records")
                cold_workbench_out = out / "cold-workbench"
                cold_workbench_out.mkdir(exist_ok=True)
                workbench_args = [
                    sys.executable, "-B", str(Path(__file__).absolute()),
                    "--application", str(whole_root / "application"),
                    "--workspace", str(whole_root / "workspace"),
                    "--out", str(cold_workbench_out), "--cold-workbench", "--start-gate",
                    "--request", str(out / "original-destination-request.json"),
                    "--snapshot", whole["path"], "--receiver-root", str(whole_root),
                ]
                workbench_process = subprocess_phase(out, "cold-workbench", workbench_args,
                    cold_workbench_out / "cold-workbench-result.json")
                workbench_result = read_json(cold_workbench_out / "cold-workbench-result.json")
                need(fixture.effect_counts() == original_effects,
                     "Cold receiving created another original provider effect")
                after_downloads = {
                    key: value for key, value in fixture.counts()["routes"].items()
                    if "/download/" in key or "/extract_file/" in key or "/check_fixity/" in key
                }
                need(after_downloads == original_downloads,
                     "Cold receiving replayed a complete original download, extraction or fixity action")
                final_state, final_proof, native_checks = verify_complete(c, q, workspace, fixture)
                need(final_state == state and final_proof == proof,
                     "Cold receiving mutated the original managed operation")
                original_artifacts = app.receiving_artifacts(OPERATION)
                need(len(original_artifacts) == 2
                     and all(item["operationId"] == OPERATION for item in original_artifacts),
                     "Workbench did not register the original receiving JSON and report")
                publish_json(out / "registered-original-receiving.json", {
                    "operationId": OPERATION, "artifacts": original_artifacts})
                publish_json(out / "receiving-final-control.json", {
                    "schema": SCHEMA + ".final-control", "operationId": OPERATION,
                    "control": fixture.control(), "counts": fixture.counts(),
                    "originalActions": native_checks["actions"],
                    "coldNoMutation": True, "coldNoRedownload": True,
                })
                artifacts = {
                    "original-provider-workspace": provider,
                    "cold-provider-workspace": provider_result["artifacts"][0],
                    "original-complete-workbench": whole,
                    "cold-complete-workbench": workbench_result["artifacts"][0],
                }
                checkpoints = [
                    out / "application-binding.json", out / "receiving-binding.json",
                    out / "original-source.zip", out / "original-review-request.json",
                    out / "original-destination-request.json", out / "prepared-source-binding.json",
                    out / "registered-original-receiving.json", out / "provider-receive-reopen.json",
                    out / "receiving-final-control.json", fixture.root / "binding.json",
                    fixture.repository / "repository-source.json",
                    cold_provider_out / "cold-result.json",
                    cold_workbench_out / "cold-workbench-result.json",
                    Path(native_checks["proof"]["path"]),
                ]
                checkpoints += sorted((out / "phases").glob("*.json"))
                checkpoints += sorted(out.glob("original-*.evidence*.json"))
                checkpoints += [out / "original-processing-choice.json", out / "original-pending-choice.json",
                                out / "original-backlog-choice.json", out / "original-pending-backlog.json"]
                candidate = {
                    "schema": SCHEMA + ".result", "status": "COMPLETED_PENDING_DRAIN",
                    "operationId": OPERATION, "recordCount": 169, "nativeState": "VERIFIED",
                    "packageId": operation["packageId"], "sourceSelection": selection,
                    "bindingSha256": sha(canonical(binding)),
                    "scope": binding["scope"], "source": identity(source),
                    "workbenchWorkspace": str(foundation),
                    "workbenchControl": str(app.control), "preparedWorkspace": str(workspace),
                    "application": str(application),
                    "coldWorkbenchWorkspace": str(whole_root / "workspace"),
                    "coldProviderWorkspace": str(provider_workspace),
                    "transferUuid": TRANSFER, "sipUuid": fixture.sip_uuid,
                    "aipUuid": fixture.sip_uuid, "dipUuids": [DIP],
                    "fixture": {"directory": str(fixture.root), "sourceRoot": str(staging),
                        "dashboardBaseUrl": f"http://127.0.0.1:{args.dashboard_port}",
                        "storageBaseUrl": f"http://127.0.0.1:{args.storage_port}",
                        "dashboardPort": args.dashboard_port, "storagePort": args.storage_port,
                        "configuration": configuration(args.dashboard_port, args.storage_port),
                        "restartArgv": [sys.executable, "-B", str(Path(__file__).absolute()),
                            "--application", str(application), "--out", str(out),
                            "--serve-fixture", "--dashboard-port", str(args.dashboard_port),
                            "--storage-port", str(args.storage_port)],
                        "restartControl": "Write STOP plus newline or close stdin after browser readback; no receiving run is replayed.",
                    },
                    "summary": proof["summary"], "nativeProof": native_checks["proof"],
                    "receivingReport": str(workspace / final_state["report"]),
                    "state": final_state, "phases": phases, "counts": fixture.counts(),
                    "actions": native_checks["actions"], "downloadCount": native_checks["downloadCount"],
                    "artifacts": artifacts, "registeredReceivingArtifacts": original_artifacts,
                    "providerCold": provider_result, "workbenchCold": workbench_result,
                    "coldProcesses": [provider_process, workbench_process],
                    "retainedChecks": [{"path": str(path), **identity(path)} for path in checkpoints],
                    "process": process_identity(), "python": sys.version,
                    "completedAt": now(),
                }
                publish_json(candidate_path, candidate)
        finally:
            app.close()
        # The servers' non-daemon request threads, both cold processes, and the
        # Workbench runtime lock are released before final PASS or delivery ZIP.
        return publish_completion(out, candidate)


def serve_existing_fixture(args):
    out, application = Path(args.out).absolute(), Path(args.application).absolute()
    with receiving_lock(out):
        result = read_json(out / "receiving-result.json")
        need(result.get("status") == "PASS" and result.get("operationId") == OPERATION,
             "Select the completed original receiving fixture")
        final_checks(result)
        need(application_identity(application) == read_json(out / "application-binding.json")["files"],
             "Fixture reopen changed the original selected application")
        config = result["fixture"]
        need(args.dashboard_port == config["dashboardPort"] and args.storage_port == config["storagePort"],
             "Fixture reopen must keep the original authenticated origins")
        p, q, c = imports(application, workbench=False)
        workspace = Path(result["preparedWorkspace"])
        operation = c.show(workspace, OPERATION)["operation"]
        fixture = Fixture(out / "fixture", workspace, operation, p, q,
                          args.dashboard_port, args.storage_port)
        before = fixture.effect_counts()
        session_id = str(uuid.uuid4())
        with credentials(config["sourceRoot"]), servers(fixture):
            print(json.dumps({"status": "READY", "scope": "Completed original fixture readback",
                "operationId": OPERATION, "sessionId": session_id,
                "dashboard": config["dashboardBaseUrl"], "storage": config["storageBaseUrl"]}), flush=True)
            deadline = time.monotonic() + 1800
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("Original browser fixture window exceeded its bound")
                readable, _, _ = select.select([sys.stdin], [], [], min(1, remaining))
                if readable:
                    line = sys.stdin.readline()
                    if line == "" or line.strip() == "STOP":
                        break
                    need(line.strip() in {"", "STATUS"}, "Unknown fixture-control input")
                    print(json.dumps({"status": "READY", "operationId": OPERATION,
                                      "counts": fixture.counts()}), flush=True)
        need(fixture.effect_counts() == before,
             "Completed browser readback attempted another original provider mutation")
        fixture.finish_checks()
        publish_json(out / "fixture-reopen" / (session_id + ".json"), {
            "schema": SCHEMA + ".fixture-reopen", "operationId": OPERATION,
            "sessionId": session_id, "counts": fixture.counts(), "effectsUnchanged": True,
            "httpServers": "CLOSED", "requestThreads": "JOINED", "closedAt": now(),
        })
        print(json.dumps({"status": "CLOSED", "operationId": OPERATION, "sessionId": session_id}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source")
    parser.add_argument("--out", required=True)
    parser.add_argument("--dashboard-port", type=int, default=18085)
    parser.add_argument("--storage-port", type=int, default=18086)
    parser.add_argument("--workspace")
    parser.add_argument("--request")
    parser.add_argument("--snapshot")
    parser.add_argument("--receiver-root")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--cold-provider", action="store_true")
    modes.add_argument("--cold-workbench", action="store_true")
    modes.add_argument("--serve-fixture", action="store_true")
    parser.add_argument("--start-gate", action="store_true")
    args = parser.parse_args()
    if args.start_gate:
        publish_child_identity()
        need(sys.stdin.buffer.readline(16) == b"START\n", "Original child start gate was not released")
    if args.cold_provider or args.cold_workbench:
        need(args.workspace, "Select the received original workspace")
        if args.cold_workbench:
            need(args.request and args.snapshot and args.receiver_root,
                 "Cold Workbench needs its exact original request and snapshot")
            cold_workbench(args)
        else:
            cold_provider(args)
    elif args.serve_fixture:
        serve_existing_fixture(args)
    else:
        need(args.source, "Select the original169 source ZIP")
        main_journey(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "FAILED", "operationId": OPERATION,
                          "errorType": type(error).__name__, "error": str(error),
                          "traceback": traceback.format_exc()}), file=sys.stderr, flush=True)
        raise
