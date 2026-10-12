#!/usr/bin/env python3
"""Source-bound Preservica OPEX research packages and portable workspaces.

Python 3.11+, standard library. The maintained preservation.py owns native
research intake, review validation and original BagIt evidence. OPEX is generated
from those original records and reviewed Dublin Core, not from repository-specific
RODA fields. No repository request is made by this module.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import html
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preservation as p

SCHEMA = "stellar-forge.preservica-research.v1"
SETTINGS_SCHEMA = "stellar-forge.preservica-package-settings.v1"
SNAPSHOT_SCHEMA = SCHEMA + ".snapshot"
MANIFEST_SCHEMA = SCHEMA + ".workspace-manifest"
CATALOG_SCHEMA = SCHEMA + ".catalog"
OPEX_NS = "http://www.openpreservationexchange.org/opex/v1.0"
DC_NS = "http://purl.org/dc/elements/1.1/"
OAI_DC_NS = "http://www.openarchives.org/OAI/2.0/oai_dc/"
PROFILE = "preservica-opex-1.0-standard-ingest"
MAX_SMALL = 64 * 1024 * 1024
MAX_TRANSFER = 4 * 1024 * 1024 * 1024
MAX_SNAPSHOT = 8 * 1024 * 1024 * 1024
CHUNK = 256 * 1024
FIXED = frozenset({"original.zip", "settings.json", "catalog.json", "catalog.csv",
                   "review.html", "source-members.json", "transfer.zip", "handoff.json"})
APPLICATION = (
    "research/preservation/preservation.py",
    "research/preservation/roda.py",
    "research/preservation/roda_client.py",
    "research/preservation/README.md",
    "research/preservation/RODA.md",
    "research/preservation/RODA_REST.md",
    "research/preservation/preservica.py",
    "research/preservation/preservica_client.py",
    "research/preservation/PRESERVICA_PROVIDER_CONTRACT.md",
    "research/preservation/PRESERVICA.md",
    "research/preservation/workbench.py",
    "research/preservation/workbench.html",
    "research/preservation/workbench.js",
    "research/preservation/WORKBENCH.md",
    "research/preservation/cli.mjs",
    "research/oai/oai_feed.py",
)
SOURCES = (
    {"url": "https://developers.preservica.com/documentation/open-preservation-exchange-opex",
     "title": "Open Preservation Exchange: naming, manifests, fixities, descriptive metadata and duplicate handling",
     "role": "Native package format"},
    {"url": "https://developers.preservica.com/blog/using-opex-and-pax-for-ingesting-content",
     "title": "Using OPEX and PAX for Ingesting Content",
     "published": "2021-01-28", "role": "Standard OPEX ZIP ingest since Preservica 6.2"},
    {"url": "https://developers.preservica.com/api-reference/3-upload-content-s3-compatible",
     "title": "Upload Content (S3 Compatible)", "role": "Upload and asynchronous ingest are separate"},
)


class Error(p.PreservationError):
    pass


def equal(actual, expected, message):
    if actual != expected:
        raise Error(message)


def _stamp(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def file_digest(path, limit=MAX_TRANSFER):
    path = Path(path).absolute()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise Error("Select a bounded regular file: " + str(path))
        count, digest = 0, hashlib.sha256()
        while data := os.read(fd, CHUNK):
            count += len(data)
            if count > limit:
                raise Error("File grew beyond the receiving limit")
            digest.update(data)
        equal(_stamp(os.fstat(fd)), _stamp(before), "Source changed while hashing")
        equal(count, before.st_size, "Source length changed while hashing")
        return {"bytes": count, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def copy_new(source, destination, limit=MAX_TRANSFER):
    source, destination = Path(source).absolute(), Path(destination).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise Error("Select a bounded original file")
        count, digest = 0, hashlib.sha256()
        with open(destination, "xb") as target:
            os.chmod(destination, 0o600)
            while data := os.read(fd, CHUNK):
                count += len(data)
                if count > limit:
                    raise Error("Source exceeds its copy limit")
                target.write(data)
                digest.update(data)
            target.flush()
            os.fsync(target.fileno())
        equal(_stamp(os.fstat(fd)), _stamp(before), "Source changed while copying")
        equal(count, before.st_size, "Source length changed while copying")
        return {"bytes": count, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def json_member(root, name, limit=MAX_SMALL):
    return p.parse_json(p.read_regular(root, name, limit))


def settings_template():
    return {
        "schema": SETTINGS_SCHEMA,
        "title": "Reviewed research metadata",
        "description": "Original bibliographic metadata with source provenance and explicit review decisions.",
        "securityTag": None,
        "sourceIdNamespace": "urn:commons:research",
        "sourceIdPolicy": "edition-record",
        "opexNamespace": OPEX_NS,
        "targetPreservicaVersion": None,
    }


def validate_settings(value=None):
    defaults = settings_template()
    if value is None:
        value = defaults
    if not isinstance(value, dict) or set(value) - set(defaults):
        raise Error("Unknown Preservica package setting")
    result = {**defaults, **value}
    equal(result["schema"], SETTINGS_SCHEMA, "Unsupported package settings schema")
    equal(result["opexNamespace"], OPEX_NS, "Select the documented OPEX 1.0 namespace")
    equal(result["sourceIdPolicy"], "edition-record", "Unsupported SourceID policy")
    for field in ("title", "description", "sourceIdNamespace"):
        result[field] = p.text(result[field], field, empty=field == "description")
    namespace = result["sourceIdNamespace"]
    if (len(namespace) > 512 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*:[^\s<>\"']+", namespace)
            or namespace.endswith(":")):
        raise Error("SourceID namespace must be a nonempty URI prefix without a trailing colon")
    if result["securityTag"] is not None:
        result["securityTag"] = p.text(result["securityTag"], "securityTag", empty=False)
        if len(result["securityTag"]) > 240 or any(ord(c) < 32 for c in result["securityTag"]):
            raise Error("Enter one existing security tag or leave it null to inherit")
    version = result["targetPreservicaVersion"]
    if version is not None:
        if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", version):
            raise Error("Target version must be an entered major.minor version or null")
        if tuple(map(int, version.split(".")[:2])) < (6, 2):
            raise Error("This OPEX ZIP profile requires Preservica 6.2 or later")
    return p.parse_json(p.canonical(result))


def regular_names(root, *, include_lock=False):
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise Error("Open an original regular workspace directory")
    names = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            path = Path(parent) / name
            if path.is_symlink():
                raise Error("Workspace directory is a symlink")
        for name in files:
            path = Path(parent) / name
            rel = path.relative_to(root).as_posix()
            if name.startswith(".unpublished-") or name.startswith(".preservica-write-"):
                continue
            if not include_lock and name.endswith(".lock"):
                continue
            if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
                raise Error("Workspace contains an unsupported file: " + rel)
            names.append(p.safe_name(rel))
    return sorted(names)


def _review_history(root, prepared, current=None, saved=None):
    """Resolve the committed chain and retain every complete unpublished candidate."""
    root = Path(root).absolute()
    if current is None and saved is None:
        current, saved = p.current_review(root, prepared)
    elif current is None or saved is None:
        raise Error("Select both the current review pointer and its original record")
    reviews = root / "reviews"
    if reviews.is_symlink() or not reviews.is_dir():
        raise Error("Review history must be an original directory")
    records = {}
    for path in sorted(reviews.iterdir()):
        if path.is_symlink() or not path.is_file():
            raise Error("Review history contains an unsupported file")
        # Original write_new publishes only the final revision name. Its private
        # interrupted temporary writes remain in the source, not saved history.
        if path.name.startswith(".unpublished-"):
            continue
        match = re.fullmatch(r"([0-9]{8})-([0-9a-f]{64})\.json", path.name)
        if not match:
            raise Error("Unexpected review history file")
        raw = p.read_regular(reviews, path.name, MAX_SMALL)
        record = p.parse_json(raw)
        if not isinstance(record, dict) or type(record.get("revision")) is not int:
            raise Error("Invalid review history record")
        revision = int(match.group(1))
        review = p.normalize_review(record.get("review"), prepared)
        sha = p.digest(p.canonical(review))
        equal(record.get("schema"), p.SCHEMA + ".revision", "Review history schema changed")
        equal(record["revision"], revision, "Review history revision changed")
        equal(record.get("reviewSha256"), sha, "Review history content changed")
        equal(path.name, f"{revision:08d}-{sha}.json", "Review history filename changed")
        previous = record.get("previousReviewSha256")
        if revision:
            if not isinstance(previous, str) or not re.fullmatch(r"[0-9a-f]{64}", previous):
                raise Error("Review history has no valid previous review identity")
        elif previous is not None:
            raise Error("The initial review must not declare a previous revision")
        name = "reviews/" + path.name
        records[name] = {"record": record, "descriptor": {
            "path": name, "revision": revision, "reviewSha256": sha,
            "previousReviewSha256": previous, "bytes": len(raw), "sha256": p.digest(raw)}}
    selected_path = current["path"]
    expected_path = f"reviews/{current['revision']:08d}-{current['reviewSha256']}.json"
    equal(selected_path, expected_path, "Current review path changed")
    if selected_path not in records:
        raise Error("The selected immutable review record is missing")
    equal(records[selected_path]["record"], saved, "The selected review changed while reading history")
    committed, wanted_sha = [], current["reviewSha256"]
    for revision in range(current["revision"], -1, -1):
        name = f"reviews/{revision:08d}-{wanted_sha}.json"
        entry = records.get(name)
        if entry is None:
            raise Error("The committed review history is incomplete at " + name)
        committed.append(entry["descriptor"])
        wanted_sha = entry["descriptor"]["previousReviewSha256"]
    committed.reverse()
    committed_names = {entry["path"] for entry in committed}
    unpublished = [entry["descriptor"] for name, entry in sorted(records.items())
                   if name not in committed_names]
    current_after, saved_after = p.current_review(root, prepared)
    equal((current_after, saved_after), (current, saved),
          "The selected review changed while reading its original history")
    return {"source": prepared["binding"], "revision": current["revision"],
            "reviewSha256": current["reviewSha256"],
            "revisionRecordSha256": p.digest(p.canonical(saved)),
            "reviewHistoryRecords": len(committed), "committedReviews": committed,
            "unpublishedReviewRecords": len(unpublished), "unpublishedReviews": unpublished}, sorted(records)


def _source_snapshot(source, destination, expected_revision):
    with p.project_lock(source):
        project, prepared = p.project_files(source)
        current, saved = p.current_review(source, prepared)
        equal(current["revision"], expected_revision, "STALE_REVISION: reload the current review")
        history, review_names = _review_history(source, prepared, current, saved)
        paths = {"project.json", "prepared.json", "current.json", *review_names}
        if project.get("sourceProfile") is not None:
            paths.add("source-example.zip")
        manifest = json_member(Path(source) / "source", "manifest.json")
        profile = project.get("sourceProfile")
        native = profile["nativeFiles"] if profile else list(manifest["files"])
        paths.update("source/" + p.safe_name(name) for name in native)
        paths.add("source/manifest.json")
        destination.mkdir(mode=0o700)
        for name in sorted(paths):
            copy_new(Path(source) / name, destination / name, p.MAX_TOTAL)
        p.write_new(destination / "workspace.lock", b"")
        copied_project, copied_prepared = p.project_files(destination)
        copied_current, copied_saved = p.current_review(destination, copied_prepared)
        equal((copied_project, copied_prepared, copied_current, copied_saved),
              (project, prepared, current, saved), "Original review snapshot did not reopen exactly")
        copied_history, copied_names = _review_history(
            destination, copied_prepared, copied_current, copied_saved)
        equal((copied_history, copied_names), (history, review_names),
              "The copied committed or unpublished review history changed")
        return history

def _xml(element):
    ET.indent(element, space="  ")
    return ET.tostring(element, encoding="utf-8", xml_declaration=True) + b"\n"


def _opex(*, title, description, source_id, security_tag, dc=None, filename=None,
          payload=None, files=None, folders=None):
    ET.register_namespace("opex", OPEX_NS)
    ET.register_namespace("dc", DC_NS)
    ET.register_namespace("oai_dc", OAI_DC_NS)
    root = ET.Element("{" + OPEX_NS + "}OPEXMetadata")
    def add(parent, name, value=None, attributes=None):
        node = ET.SubElement(parent, "{" + OPEX_NS + "}" + name, attributes or {})
        if value is not None:
            node.text = str(value)
        return node
    properties = add(root, "Properties")
    add(properties, "Title", title)
    if description:
        add(properties, "Description", description)
    if security_tag is not None:
        add(properties, "SecurityDescriptor", security_tag)
    if dc:
        identifiers = add(properties, "Identifiers")
        for value in dc.get("identifier", []):
            add(identifiers, "Identifier", value, {"type": "OpenAlex" if p.ID_PATTERN.fullmatch(value) else "ResearchIdentifier"})
    transfer = add(root, "Transfer")
    add(transfer, "SourceID", source_id)
    if payload is not None:
        fixities = add(transfer, "Fixities")
        add(fixities, "Fixity", attributes={"type": "SHA-256", "value": payload["sha256"]})
        if filename:
            add(transfer, "OriginalFilename", filename)
    if files is not None or folders is not None:
        manifest = add(transfer, "Manifest")
        if folders:
            container = add(manifest, "Folders")
            for name in sorted(folders):
                add(container, "Folder", name)
        if files:
            container = add(manifest, "Files")
            for name, entry in sorted(files.items()):
                add(container, "File", name, {"size": str(entry["bytes"]), "type": entry["type"]})
    if dc:
        descriptive = add(root, "DescriptiveMetadata")
        document = ET.SubElement(descriptive, "{" + OAI_DC_NS + "}dc")
        for field in p.DC_FIELDS:
            for value in dc.get(field, []):
                ET.SubElement(document, "{" + DC_NS + "}" + field).text = value
    return _xml(root)


def _csv(catalog):
    out = io.StringIO(newline="")
    names = ["identifier", "include", "source_id", "payload_path", "payload_sha256", "payload_bytes",
             "title", "creator", "date", "source_record_sha256", "review_reason", "source_issues"]
    writer = csv.DictWriter(out, fieldnames=names, lineterminator="\n")
    writer.writeheader()
    def cell(value):
        value = str(value)
        return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value
    for row in catalog["records"]:
        payload = row.get("payload") or {}
        writer.writerow({key: cell(value) for key, value in {
            "identifier": row["identifier"], "include": row["include"], "source_id": row.get("sourceId") or "",
            "payload_path": row.get("nativePath") or "", "payload_sha256": payload.get("sha256", ""),
            "payload_bytes": payload.get("bytes", ""), "title": " | ".join(row["reviewedDc"].get("title", [])),
            "creator": " | ".join(row["reviewedDc"].get("creator", [])),
            "date": " | ".join(row["reviewedDc"].get("date", [])),
            "source_record_sha256": row["source"]["recordSha256"],
            "review_reason": (row.get("decision") or {}).get("reason", ""),
            "source_issues": json.dumps(row["issues"], ensure_ascii=False, sort_keys=True),
        }.items()})
    return out.getvalue().encode("utf-8")


def _report(catalog, settings, verification):
    esc = lambda v: html.escape(str(v), quote=True)
    body = []
    for row in catalog["records"]:
        decision = row.get("decision") or {}
        dc = row["reviewedDc"]
        body.append("<tr><td>" + ("Included" if row["include"] else "Excluded") + "</td><td><a href=\"" +
                    esc(row["identifier"]) + "\">" + esc(row["identifier"]) + "</a></td><td>" +
                    esc(" | ".join(dc.get("title", []))) + "</td><td>" +
                    esc(" | ".join(dc.get("creator", []))) + "</td><td>" +
                    esc(row.get("sourceId") or "") + "</td><td>" +
                    esc(decision.get("reason", "")) + "</td></tr>")
    counts = catalog["counts"]
    return ("""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Preservica research package</title><style>body{font:16px/1.5 system-ui;margin:2rem auto;max-width:1200px;padding:0 1rem;color:#172b3a}
h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{border:1px solid #cdd8de;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f6f8;padding:1rem}a{color:#075a88}</style>
<h1>""" + esc(settings["title"]) + "</h1><p>" + esc(settings["description"]) +
            "</p><p><strong>" + str(counts["includedRecords"]) + " included metadata records</strong> from " +
            str(counts["sourceRecords"]) + " unique source records; " + str(counts["excludedRecords"]) +
            " excluded. Review revision " + str(catalog["source"]["reviewRevision"]) + ".</p>"
            "<p>The preserved files are original OpenAlex bibliographic JSON. Full texts, paper copyrights and source-work "
            "licenses are separate. Reviewed Dublin Core describes these CC0 metadata files. Source corrections and exclusions "
            "retain their entered reasons.</p><h2>Destination package and original evidence</h2>"
            "<p>The native transfer contains an OPEX folder, a records folder, original included JSON files and paired OPEX metadata. "
            "Immediate folder manifests, byte lengths and SHA-256 fixities bind every payload. The complete handoff retains the "
            "source review workspace and its verified original BagIt evidence separately from the native OPEX transfer.</p>"
            "<p>SourceIDs identify this edition and review. Canonical OpenAlex IDs remain in descriptive metadata. Ingest duplicate "
            "handling depends on tenant settings; an upload receipt alone does not establish that the selected records were ingested.</p>"
            "<h2>Entered package settings</h2><pre>" + esc(json.dumps(settings, ensure_ascii=False, indent=2)) +
            "</pre><h2>Source and review binding</h2><pre>" + esc(json.dumps(catalog["source"], ensure_ascii=False, indent=2)) +
            "</pre><h2>Record review</h2><table><thead><tr><th>Decision</th><th>Original ID</th><th>Reviewed title</th>"
            "<th>Reviewed creators</th><th>Preservica SourceID</th><th>Entered reason</th></tr></thead><tbody>" +
            "".join(body) + "</tbody></table><h2>Verification</h2><pre>" +
            esc(json.dumps(verification, ensure_ascii=False, indent=2)) +
            "</pre><h2>Primary format sources</h2><ul>" +
            "".join("<li><a href=\"" + esc(item["url"]) + "\">" + esc(item["title"]) + "</a></li>" for item in SOURCES) +
            "</ul></html>").encode("utf-8")


def _derive(original_path, settings):
    settings = validate_settings(settings)
    original = file_digest(original_path)
    verified = p.verify(original_path)
    reader = p.BagReader(original_path)
    try:
        identity = verified["identity"]
        rows = reader.json(p.DOC + "mapping.json")["records"]
        package_id = "research-opex-" + p.digest(p.canonical({
            "profile": PROFILE, "original": original, "settings": settings,
        }))[:24]
        prefix = package_id + "/"
        namespace = settings["sourceIdNamespace"]
        folder_source_id = namespace + ":package:" + package_id
        records_source_id = folder_source_id + ":records"
        metadata, payloads, descriptions, catalog_rows = {}, {}, {}, []
        folder_files = {}
        for original_row in rows:
            row = p.parse_json(p.canonical(original_row))
            work = row["identifier"].rsplit("/", 1)[1]
            if not re.fullmatch(r"W[0-9]+", work):
                raise Error("Unexpected original research identifier")
            row.update({"sourceId": None, "nativePath": None, "metadataPath": None, "payload": None})
            if row["include"]:
                path = prefix + "records/" + work + ".json"
                raw = reader.read(row["payloadPath"])
                descriptor = {"bytes": len(raw), "sha256": p.digest(raw)}
                equal(descriptor["sha256"], row["source"]["recordSha256"], "Original record digest changed")
                source_id = namespace + ":edition:" + package_id + ":record:" + work
                sidecar = _opex(title=" | ".join(row["reviewedDc"].get("title", [])),
                    description="\n".join(row["reviewedDc"].get("description", [])),
                    source_id=source_id, security_tag=settings["securityTag"], dc=row["reviewedDc"],
                    filename=work + ".json", payload=descriptor)
                metadata[path + ".opex"] = sidecar
                payloads[path] = row["payloadPath"]
                descriptions[path] = descriptor
                folder_files[work + ".json"] = {**descriptor, "type": "content"}
                folder_files[work + ".json.opex"] = {"bytes": len(sidecar), "type": "metadata"}
                row.update({"sourceId": source_id, "nativePath": path, "metadataPath": path + ".opex",
                            "payload": descriptor})
            catalog_rows.append(row)
        metadata[prefix + "records/records.opex"] = _opex(
            title="Research records", description="Original reviewed bibliographic metadata assets",
            source_id=records_source_id, security_tag=settings["securityTag"], files=folder_files)
        package_dc = {"title": [settings["title"]], "description": [
            settings["description"], "Original bibliographic metadata; no paper full text is included."],
            "type": ["Collection"], "identifier": [folder_source_id],
            "source": ["urn:sha256:" + identity["source"]["manifestSha256"]],
            "rights": [p.LICENSE]}
        metadata[prefix + package_id + ".opex"] = _opex(
            title=settings["title"], description=settings["description"], source_id=folder_source_id,
            security_tag=settings["securityTag"], dc=package_dc, folders=["records"])
        counts = {"sourceRecords": verified["sourceRecords"], "includedRecords": len(payloads),
                  "excludedRecords": verified["excludedRecords"], "nativeContentFiles": len(payloads),
                  "nativeMetadataFiles": len(metadata), "nativeFolders": 2}
        if not payloads:
            raise Error("Select at least one research record before making an ingest package")
        source = {"originalTransfer": original, "originalBagId": verified["bagId"],
                  "manifestSha256": identity["source"]["manifestSha256"], "binding": identity["source"],
                  "reviewRevision": identity["reviewRevision"], "reviewSha256": identity["reviewSha256"],
                  "revisionRecordSha256": identity["revisionRecordSha256"],
                  "metadataLicense": p.LICENSE,
                  "sourceProfile": identity.get("sourceProfile")}
        catalog = {"schema": CATALOG_SCHEMA, "id": package_id, "profile": PROFILE,
                   "source": source, "counts": counts, "packageSourceId": folder_source_id,
                   "recordsFolderSourceId": records_source_id, "records": catalog_rows}
        members = {}
        for name in reader.names:
            data = reader.read(name)
            members[name] = {"bytes": len(data), "sha256": p.digest(data),
                             "retainedIn": "original.zip", "archiveMember": reader.prefix + name}
        source_members = {"schema": SCHEMA + ".source-members", "original": original, "files": members}
        expected = {name: {"bytes": len(data), "sha256": p.digest(data)} for name, data in metadata.items()}
        expected.update(descriptions)
        verification = {"schema": SCHEMA + ".opex-verification", "valid": True, "profile": PROFILE,
                        "opexNamespace": OPEX_NS, "id": package_id, "counts": counts,
                        "files": expected, "directories": [prefix, prefix + "records/"],
                        "payloadBytes": sum(x["bytes"] for x in descriptions.values()),
                        "packageSourceId": folder_source_id,
                        "sourceSemantics": "Original JSON metadata assets with reviewed Dublin Core; no full-text retrieval."}
        return {"id": package_id, "catalog": catalog, "metadata": metadata, "payloads": payloads,
                "expected": expected, "verification": verification, "originalVerification": verified,
                "settings": settings, "derived": {
                    "catalog.json": p.canonical(catalog), "catalog.csv": _csv(catalog),
                    "source-members.json": p.canonical(source_members),
                    "review.html": _report(catalog, settings, verification)}}
    finally:
        reader.close()


def zip_info(name, *, directory=False, stored=False):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED if stored or directory else zipfile.ZIP_DEFLATED
    info.external_attr = ((stat.S_IFDIR | 0o700) if directory else (stat.S_IFREG | 0o600)) << 16
    if directory:
        info.external_attr |= 0x10
    return info


def zip_copy(archive, name, source, *, stored=False):
    before = file_digest(source)
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        stamp = _stamp(os.fstat(fd))
        digest, count = hashlib.sha256(), 0
        with archive.open(zip_info(name, stored=stored), "w", force_zip64=True) as target:
            while chunk := os.read(fd, CHUNK):
                count += len(chunk)
                if count > before["bytes"]:
                    raise Error("Snapshot member grew while copying")
                target.write(chunk)
                digest.update(chunk)
        equal(_stamp(os.fstat(fd)), stamp, "Snapshot member changed while copying")
        equal({"bytes": count, "sha256": digest.hexdigest()}, before, "Snapshot member bytes changed")
        return before
    finally:
        os.close(fd)


def _write_transfer(path, original_path, derived):
    reader = p.BagReader(original_path)
    try:
        with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for name in derived["verification"]["directories"]:
                archive.writestr(zip_info(name, directory=True), b"")
            for name in sorted(derived["expected"]):
                data = derived["metadata"].get(name)
                if data is None:
                    data = reader.read(derived["payloads"][name])
                equal({"bytes": len(data), "sha256": p.digest(data)}, derived["expected"][name],
                      "Original-derived OPEX member changed")
                archive.writestr(zip_info(name), data)
        with open(path, "rb") as handle:
            os.fsync(handle.fileno())
        return file_digest(path)
    finally:
        reader.close()


def zip_inventory(archive, limit=MAX_SNAPSHOT, *, allow_directories=False):
    files, directories, total = {}, set(), 0
    for entry in archive.infolist():
        name = p.safe_name(entry.filename[:-1] if entry.is_dir() else entry.filename)
        if name in files or name in directories:
            raise Error("Duplicate ZIP member")
        if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise Error("Unsupported encrypted or compressed ZIP member")
        mode = (entry.external_attr >> 16) & 0o170000
        if entry.is_dir():
            if not allow_directories or mode not in (0, stat.S_IFDIR) or entry.file_size:
                raise Error("Unexpected ZIP directory")
            directories.add(name)
        else:
            if mode not in (0, stat.S_IFREG) or entry.file_size > MAX_TRANSFER:
                raise Error("Unsupported ZIP member")
            total += entry.file_size
            if total > limit:
                raise Error("ZIP exceeds the receiving byte limit")
            files[name] = entry
    for name in files:
        if any(parent.as_posix() in files for parent in PurePosixPath(name).parents if str(parent) != "."):
            raise Error("ZIP member shadows a directory")
    return files, directories


def zip_digest(archive, entry):
    count, sha = 0, hashlib.sha256()
    with archive.open(entry) as handle:
        while chunk := handle.read(CHUNK):
            count += len(chunk)
            if count > entry.file_size:
                raise Error("ZIP member grew beyond its declared length")
            sha.update(chunk)
    equal(count, entry.file_size, "ZIP member is incomplete")
    return {"bytes": count, "sha256": sha.hexdigest()}


def _verify_transfer(path, derived):
    with zipfile.ZipFile(path) as archive:
        entries, directories = zip_inventory(archive, MAX_TRANSFER, allow_directories=True)
        equal(set(entries), set(derived["expected"]), "Native OPEX file inventory changed")
        equal(directories, {x.rstrip("/") for x in derived["verification"]["directories"]},
              "Native OPEX directory inventory changed")
        for name, expected in derived["expected"].items():
            equal(zip_digest(archive, entries[name]), expected, "Native OPEX member changed: " + name)
    return derived["verification"]


def _handoff(derived, transfer, created_at, source_history):
    return {"schema": SCHEMA, "id": derived["id"], "profile": PROFILE, "createdAt": created_at,
            "sourceWorkspace": "source-workspace", "source": derived["catalog"]["source"],
            "sourceHistory": source_history, "settings": derived["settings"],
            "settingsSha256": p.digest(p.canonical(derived["settings"])),
            "transfer": {"path": "transfer.zip", **transfer},
            "originalTransfer": {"path": "original.zip", **derived["catalog"]["source"]["originalTransfer"]},
            "counts": derived["catalog"]["counts"], "packageSourceId": derived["catalog"]["packageSourceId"],
            "recordsFolderSourceId": derived["catalog"]["recordsFolderSourceId"],
            "formatSources": list(SOURCES), "verification": derived["verification"],
            "repositoryState": "NOT_SUBMITTED",
            "scope": "Package preparation verifies source and OPEX bytes; repository acceptance and entity readback are separate."}


def verify_workspace(workspace):
    """Verify immutable prepared bytes; caller may hold the ordinary workspace lock."""
    root = Path(workspace).absolute()
    if root.is_symlink() or not root.is_dir():
        raise Error("Open an existing Preservica package workspace")
    manifest = json_member(root, "MANIFEST.json")
    equal(manifest.get("schema"), MANIFEST_SCHEMA, "Unsupported package workspace manifest")
    declared = manifest.get("files")
    if not isinstance(declared, dict) or not FIXED.issubset(declared):
        raise Error("Incomplete package workspace inventory")
    for name, entry in declared.items():
        p.safe_name(name)
        if name not in FIXED and not name.startswith("source-workspace/"):
            raise Error("Unexpected immutable package member")
        if not isinstance(entry, dict) or set(entry) != {"bytes", "sha256"}:
            raise Error("Invalid package member descriptor")
        equal(file_digest(root / name, MAX_TRANSFER), entry, "Prepared member changed: " + name)
    actual = set(regular_names(root))
    if actual - set(declared) - {"MANIFEST.json"} - {n for n in actual if n.startswith("remote/")}:
        raise Error("Unexpected package workspace file")
    project, prepared = p.project_files(root / "source-workspace")
    current, saved = p.current_review(root / "source-workspace", prepared)
    settings = validate_settings(json_member(root, "settings.json"))
    derived = _derive(root / "original.zip", settings)
    equal(current["revision"], derived["catalog"]["source"]["reviewRevision"], "Frozen source review changed")
    equal(current["reviewSha256"], derived["catalog"]["source"]["reviewSha256"], "Frozen source metadata changed")
    equal(p.digest(p.canonical(saved)), derived["catalog"]["source"]["revisionRecordSha256"],
          "Frozen source revision record changed")
    equal(prepared["binding"], derived["catalog"]["source"]["binding"], "Frozen source edition changed")
    for name, data in derived["derived"].items():
        equal(p.read_regular(root, name, MAX_SMALL), data, "Derived package view changed: " + name)
    _verify_transfer(root / "transfer.zip", derived)
    handoff = json_member(root, "handoff.json")
    stamp = handoff.get("createdAt")
    try:
        when = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if when.tzinfo is None:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise Error("Invalid package creation timestamp")
    history = handoff.get("sourceHistory")
    expected_history, _ = _review_history(root / "source-workspace", prepared, current, saved)
    equal(history, expected_history, "Original committed or unpublished source history changed")
    equal(handoff, _handoff(derived, declared["transfer.zip"], stamp, history),
          "Prepared handoff differs from its original source, settings or transfer")
    return handoff


def show(workspace):
    root = Path(workspace).absolute()
    # All prepared files are immutable. Upload state has its own atomic snapshot;
    # UI reads do not wait for a long remote writer.
    handoff = verify_workspace(root)
    return {"schema": SCHEMA + ".status", "workspace": str(root), "handoff": handoff,
            "catalog": json_member(root, "catalog.json")}


def prepare(source_workspace, output_workspace, expected_revision, *, settings=None):
    source, root = Path(source_workspace).absolute(), Path(output_workspace).absolute()
    settings = validate_settings(settings)
    if type(expected_revision) is not int or expected_revision < 0:
        raise Error("Expected review revision must be a nonnegative integer")
    if root == source or root.is_relative_to(source) or source.is_relative_to(root):
        raise Error("Place the package workspace beside, rather than inside, its review source")
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_root = root.parent / ("." + root.name + ".publication")
    lock_root.mkdir(exist_ok=True, mode=0o700)
    with p.project_lock(lock_root):
        if root.exists() or root.is_symlink():
            prior = verify_workspace(root)
            current = p.show(source)
            equal(current["revision"], expected_revision, "STALE_REVISION: reload the saved review")
            equal(prior["source"]["manifestSha256"], current["project"]["binding"]["manifestSha256"],
                  "Existing package belongs to another source edition")
            equal(prior["source"]["reviewRevision"], expected_revision, "Existing package belongs to another review")
            equal(prior["source"]["reviewSha256"], current["reviewSha256"], "Existing package metadata changed")
            equal(prior["settings"], settings, "Existing package belongs to other settings")
            return {"workspace": str(root), "reused": True, "handoff": prior}
        stage = Path(tempfile.mkdtemp(prefix=".preservica-prepare-", dir=root.parent))
        try:
            history = _source_snapshot(source, stage / "source-workspace", expected_revision)
            # The existing producer is the authority for its source carrier. This
            # BagIt file is retained evidence, not the format sent to Preservica.
            p.build(stage / "source-workspace", stage / "original.zip", expected_revision, zipped=True)
            p.write_new(stage / "settings.json", p.canonical(settings))
            derived = _derive(stage / "original.zip", settings)
            for name, data in derived["derived"].items():
                p.write_new(stage / name, data)
            transfer = _write_transfer(stage / "transfer.zip", stage / "original.zip", derived)
            _verify_transfer(stage / "transfer.zip", derived)
            handoff = _handoff(derived, transfer, p.utc(), history)
            p.write_new(stage / "handoff.json", p.canonical(handoff))
            declared = {name: file_digest(stage / name) for name in regular_names(stage)}
            p.write_new(stage / "MANIFEST.json", p.canonical({"schema": MANIFEST_SCHEMA, "files": declared}))
            p.write_new(stage / "workspace.lock", b"")
            equal(verify_workspace(stage), handoff, "New Preservica package failed its original reopen")
            p.sync_tree(stage)
            os.rename(stage, root)
            stage = None
            p.fsync_dir(root.parent)
            return {"workspace": str(root), "reused": False, "handoff": handoff}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def verify_transfer(source):
    """Validate an existing prepared workspace including its complete native ZIP."""
    return verify_workspace(source)["verification"]


def compare(before, after):
    left, right = show(before), show(after)
    a = {r["identifier"]: r for r in left["catalog"]["records"]}
    b = {r["identifier"]: r for r in right["catalog"]["records"]}
    return {"schema": SCHEMA + ".comparison",
            "before": left["handoff"]["id"], "after": right["handoff"]["id"],
            "sameSource": left["handoff"]["source"]["manifestSha256"] == right["handoff"]["source"]["manifestSha256"],
            "added": sorted(set(b) - set(a)), "removed": sorted(set(a) - set(b)),
            "changed": [{"identifier": key,
                         "decisionChanged": a[key]["include"] != b[key]["include"],
                         "metadataChanged": a[key]["reviewedDc"] != b[key]["reviewedDc"],
                         "sourceChanged": a[key]["source"] != b[key]["source"]}
                        for key in sorted(set(a) & set(b))
                        if (a[key]["include"], a[key]["reviewedDc"], a[key]["source"]) !=
                           (b[key]["include"], b[key]["reviewedDc"], b[key]["source"])]}


def _snapshot_manifest(archive):
    entries, _ = zip_inventory(archive)
    if "MANIFEST.json" not in entries or entries["MANIFEST.json"].file_size > MAX_SMALL:
        raise Error("Receiving archive has no bounded manifest")
    raw = archive.read(entries["MANIFEST.json"])
    manifest = p.parse_json(raw)
    equal(manifest.get("schema"), SNAPSHOT_SCHEMA, "Unsupported Preservica receiving archive")
    declared = manifest.get("files")
    if not isinstance(declared, dict) or set(entries) != set(declared) | {"MANIFEST.json"}:
        raise Error("Receiving archive inventory differs from its manifest")
    required = {"application/" + name for name in APPLICATION}
    required.update("workspace/" + name for name in FIXED)
    required.add("workspace/MANIFEST.json")
    if not required.issubset(declared):
        raise Error("Receiving archive lacks the original runtime or source closure")
    for name, expected in declared.items():
        p.safe_name(name)
        if not name.startswith(("workspace/", "application/")):
            raise Error("Unexpected receiving member")
        if name.startswith("application/") and name[12:] not in APPLICATION:
            raise Error("Unexpected executable receiving source")
        if not isinstance(expected, dict) or set(expected) != {"sha256", "bytes"}:
            raise Error("Invalid receiving member descriptor")
        equal(zip_digest(archive, entries[name]), expected, "Receiving member checksum changed: " + name)
    equal(manifest.get("workspacePath"), "workspace", "Receiving workspace path changed")
    equal(manifest.get("applicationEntry"), "application/research/preservation/preservica.py",
          "Receiving application entry changed")
    return manifest, entries


def _verify_received(root, manifest):
    root = Path(root).absolute()
    declared = manifest["files"]
    actual = set(regular_names(root))
    allowed = set(declared) | {"MANIFEST.json"}
    if actual != allowed:
        raise Error("Receiving directory differs from the original archive; retain later work separately")
    for name, expected in declared.items():
        equal(file_digest(root / name, MAX_TRANSFER), expected, "Received member changed: " + name)
    equal(json_member(root, "MANIFEST.json"), manifest, "Received manifest changed")
    handoff = verify_workspace(root / "workspace")
    equal(handoff["id"], manifest["handoffId"], "Received source package changed")
    equal(file_digest(root / "workspace/handoff.json")["sha256"], manifest["handoffSha256"],
          "Received handoff identity changed")
    return handoff


def export(workspace, output):
    root, output = Path(workspace).absolute(), Path(output).absolute()
    if output == root or output.is_relative_to(root):
        raise Error("Place the portable export outside its source workspace")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with p.project_lock(root):
        handoff = verify_workspace(root)
        members = {"workspace/" + name: root / name for name in regular_names(root)}
        application_root = Path(__file__).resolve().parent.parent.parent
        for name in APPLICATION:
            path = application_root / name
            if path.is_symlink() or not path.is_file():
                raise Error("Install the complete receiving application before export: " + name)
            members["application/" + name] = path
        descriptors = {name: file_digest(path) for name, path in sorted(members.items())}
        if sum(x["bytes"] for x in descriptors.values()) > MAX_SNAPSHOT:
            raise Error("Portable snapshot exceeds the byte limit")
        manifest = {"schema": SNAPSHOT_SCHEMA, "createdAt": p.utc(),
                    "handoffId": handoff["id"], "handoffSha256": descriptors["workspace/handoff.json"]["sha256"],
                    "workspacePath": "workspace", "applicationEntry": "application/research/preservation/preservica.py",
                    "files": descriptors, "credentials": "Environment references only; supply authorized credentials on the receiving host."}
        if output.exists() or output.is_symlink():
            if output.is_symlink():
                raise Error("Portable export must be a regular original file")
            with zipfile.ZipFile(output) as archive:
                prior, _ = _snapshot_manifest(archive)
            equal(prior["files"], descriptors, "Existing export belongs to a different workspace revision or journal")
            equal(prior["handoffId"], handoff["id"], "Existing export belongs to another source")
            return {"path": str(output), **file_digest(output, MAX_SNAPSHOT), "members": len(descriptors) + 1, "reused": True}
        fd, name = tempfile.mkstemp(prefix=".preservica-snapshot-", dir=output.parent)
        os.close(fd)
        temporary = Path(name)
        temporary.unlink()
        try:
            with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for member, path in sorted(members.items()):
                    equal(zip_copy(archive, member, path, stored=member.endswith(".zip")), descriptors[member],
                          "Source changed while exporting")
                archive.writestr(zip_info("MANIFEST.json"), p.canonical(manifest))
            with zipfile.ZipFile(temporary) as archive:
                _snapshot_manifest(archive)
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            os.link(temporary, output, follow_symlinks=False)
            p.fsync_dir(output.parent)
            return {"path": str(output), **file_digest(output, MAX_SNAPSHOT), "members": len(descriptors) + 1, "reused": False}
        finally:
            temporary.unlink(missing_ok=True)


def receive(source, output):
    source, output = Path(source).absolute(), Path(output).absolute()
    source_descriptor = file_digest(source, MAX_SNAPSHOT)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_root = output.parent / ("." + output.name + ".publication")
    lock_root.mkdir(exist_ok=True, mode=0o700)
    with p.project_lock(lock_root), zipfile.ZipFile(source) as archive:
        manifest, entries = _snapshot_manifest(archive)
        if output.exists() or output.is_symlink():
            if output.is_symlink():
                raise Error("Receiving output must be an original directory")
            handoff = _verify_received(output, manifest)
            return {"path": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / manifest["applicationEntry"]), "reused": True, "handoff": handoff}
        stage = Path(tempfile.mkdtemp(prefix=".preservica-receive-", dir=output.parent))
        try:
            for name, entry in sorted(entries.items()):
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.open(entry) as src, open(target, "xb") as dst:
                    os.chmod(target, 0o600)
                    count, sha = 0, hashlib.sha256()
                    while chunk := src.read(CHUNK):
                        count += len(chunk)
                        if count > entry.file_size:
                            raise Error("Received member exceeded its original size")
                        dst.write(chunk)
                        sha.update(chunk)
                    dst.flush()
                    os.fsync(dst.fileno())
                equal(count, entry.file_size, "Received member was incomplete")
                if name != "MANIFEST.json":
                    equal({"bytes": count, "sha256": sha.hexdigest()}, manifest["files"][name],
                          "Received member hash differs from its original")
            handoff = _verify_received(stage, manifest)
            equal(file_digest(source, MAX_SNAPSHOT), source_descriptor, "Portable input changed during receive")
            p.sync_tree(stage)
            os.rename(stage, output)
            stage = None
            p.fsync_dir(output.parent)
            return {"path": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / manifest["applicationEntry"]), "reused": False, "handoff": handoff}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("settings-template")
    command = sub.add_parser("prepare")
    command.add_argument("--workspace", required=True, help="Existing source/review workspace")
    command.add_argument("--out", required=True, help="New frozen Preservica package workspace")
    command.add_argument("--expected-revision", type=int, required=True)
    command.add_argument("--settings")
    for name in ("show", "verify"):
        command = sub.add_parser(name)
        command.add_argument("--workspace", required=True)
    command = sub.add_parser("compare")
    command.add_argument("--before", required=True)
    command.add_argument("--after", required=True)
    command = sub.add_parser("export")
    command.add_argument("--workspace", required=True)
    command.add_argument("--out", required=True)
    command = sub.add_parser("receive")
    command.add_argument("--source", required=True)
    command.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.command == "settings-template":
        result = settings_template()
    elif args.command == "prepare":
        settings = None
        if args.settings:
            path = Path(args.settings).absolute()
            settings = json_member(path.parent, path.name)
        result = prepare(args.workspace, args.out, args.expected_revision, settings=settings)
    elif args.command == "show":
        result = show(args.workspace)
    elif args.command == "verify":
        result = verify_workspace(args.workspace)
    elif args.command == "compare":
        result = compare(args.before, args.after)
    elif args.command == "export":
        result = export(args.workspace, args.out)
    else:
        result = receive(args.source, args.out)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Error, p.PreservationError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
