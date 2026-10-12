#!/usr/bin/env python3
"""Prepare, operate and reopen complete research transfers for RODA.

Python 3.11+, Unix, standard library. Original research and review verification
is performed by the adjacent maintained preservation.py and oai/oai_feed.py.
"""
from __future__ import annotations

import argparse
import contextlib
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
import urllib.parse
import zipfile

import preservation as p

SCHEMA = "stellar-forge.roda-research-transfer.v1"
AGREEMENT_SCHEMA = "stellar-forge.roda-submission-agreement.v1"
PROFILE = "roda-research-bagit-unique-basename-v1"
SIP_SCHEMA = "stellar-forge.roda-research-sip.v1"
MANIFEST_SCHEMA = SCHEMA + ".workspace-manifest"
SNAPSHOT_SCHEMA = SCHEMA + ".receiving-snapshot"
CATALOG_SCHEMA = SCHEMA + ".catalog"
INDEX_SCHEMA = SCHEMA + ".source-members"
MAX_ORIGINAL = p.MAX_TOTAL
MAX_TRANSFER = MAX_ORIGINAL + 512 * 1024 * 1024
MAX_SNAPSHOT = 2 * MAX_TRANSFER + 512 * 1024 * 1024
MAX_SMALL = p.MAX_MEMBER
MAX_FILES = 100000
CHUNK = 1024 * 1024
ORIGINAL_MEMBER = "data/source/original-research-transfer.zip"
FIXED = frozenset({
    "original.zip", "transfer.zip", "agreement.json", "handoff.json",
    "catalog.json", "catalog.csv", "review.html", "source-members.json",
})
APPLICATION = (
    "research/preservation/roda.py",
    "research/preservation/roda_client.py",
    "research/preservation/preservation.py",
    "research/preservation/cli.mjs",
    "research/preservation/README.md",
    "research/preservation/RODA.md",
    "research/preservation/RODA_REST.md",
    "research/oai/oai_feed.py",
)
Error = p.PreservationError


def _equal(actual, expected, message):
    if actual != expected:
        raise Error(message)


def _stamp(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def file_digest(path, limit=MAX_TRANSFER):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= limit:
            raise Error("Expected a bounded regular file: " + str(path))
        total, h = 0, hashlib.sha256()
        with os.fdopen(fd, "rb", closefd=False) as handle:
            while chunk := handle.read(CHUNK):
                total += len(chunk)
                if total > limit:
                    raise Error("File exceeds its byte limit: " + str(path))
                h.update(chunk)
        _equal(_stamp(os.fstat(fd)), _stamp(before), "File changed while reading: " + str(path))
        _equal(total, before.st_size, "File length changed while reading")
        return {"sha256": h.hexdigest(), "bytes": total}
    finally:
        os.close(fd)


def _copy_new(source, destination, limit=MAX_TRANSFER):
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    incoming = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    created = False
    try:
        before = os.fstat(incoming)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise Error("Expected a bounded regular source")
        outgoing = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        try:
            with os.fdopen(incoming, "rb", closefd=False) as src, os.fdopen(outgoing, "wb", closefd=False) as dst:
                count, h = 0, hashlib.sha256()
                while chunk := src.read(CHUNK):
                    count += len(chunk)
                    if count > limit:
                        raise Error("Source grew beyond the transfer limit")
                    h.update(chunk)
                    dst.write(chunk)
                dst.flush()
                os.fsync(outgoing)
            _equal(_stamp(os.fstat(incoming)), _stamp(before), "Source changed during copying")
            _equal(count, before.st_size, "Source length changed during copying")
            return {"sha256": h.hexdigest(), "bytes": count}
        finally:
            os.close(outgoing)
    except BaseException:
        if created:
            destination.unlink(missing_ok=True)
        raise
    finally:
        os.close(incoming)


def _json(root, name):
    value = p.parse_json(p.read_regular(root, name, MAX_SMALL))
    if not isinstance(value, dict):
        raise Error(name + " must contain a JSON object")
    return value


def _single(value, label, *, empty=False):
    value = p.text(value, label, empty=empty)
    if any(c in value for c in "\r\n\t"):
        raise Error(label + " must be a single line")
    return value


def normalize_url(value):
    value = _single(value, "repository.baseUrl")
    try:
        u = urllib.parse.urlsplit(value)
        port = u.port
    except ValueError as error:
        raise Error("Invalid repository.baseUrl") from error
    if (u.scheme not in {"http", "https"} or not u.hostname or
            u.username is not None or u.password is not None or
            u.query or u.fragment or any(c.isspace() for c in value)):
        raise Error("repository.baseUrl needs an HTTP(S) URL without credentials, query or fragment")
    if port is not None and not 1 <= port <= 65535:
        raise Error("Invalid repository port")
    path = u.path.rstrip("/")
    if ("%" in u.netloc or any(part in {".", ".."} for part in path.split("/"))
            or path.endswith("/api/v2")):
        raise Error("repository.baseUrl is the application root, before /api/v2")
    return value.rstrip("/")


def agreement_template():
    return {
        "schema": AGREEMENT_SCHEMA,
        "agreementId": "",
        "repository": {"name": "", "baseUrl": ""},
        "producer": {"name": "", "contact": ""},
        "collection": {"title": "", "parentAipId": "", "description": ""},
        "scope": {
            "contentDescription": "Reviewed OpenAlex bibliographic metadata and the complete retained source edition.",
            "completeOriginalEdition": True,
            "metadataLicense": p.LICENSE,
        },
        "notes": "",
    }


def validate_agreement(raw):
    obj = p.parse_json(raw)
    if not isinstance(obj, dict) or obj.get("schema") != AGREEMENT_SCHEMA:
        raise Error("Unsupported RODA submission agreement schema")
    for field in ("repository", "producer", "collection", "scope"):
        if not isinstance(obj.get(field), dict):
            raise Error("Agreement requires an object: " + field)
    _single(obj.get("agreementId"), "agreementId")
    _single(obj["repository"].get("name"), "repository.name")
    base_url = normalize_url(obj["repository"].get("baseUrl"))
    _single(obj["producer"].get("name"), "producer.name")
    _single(obj["producer"].get("contact"), "producer.contact")
    _single(obj["collection"].get("title"), "collection.title")
    parent = _single(obj["collection"].get("parentAipId", ""), "collection.parentAipId", empty=True)
    p.text(obj["collection"].get("description", ""), "collection.description")
    p.text(obj["scope"].get("contentDescription"), "scope.contentDescription", empty=False)
    if obj["scope"].get("completeOriginalEdition") is not True:
        raise Error("This profile retains the complete original edition, including excluded standalone records")
    if obj["scope"].get("metadataLicense") != p.LICENSE:
        raise Error("Metadata payload rights must preserve the original CC0 research profile")
    p.text(obj.get("notes", ""), "notes")
    return obj, {
        "repository": {"name": obj["repository"]["name"], "baseUrl": base_url},
        "collection": {"title": obj["collection"]["title"], "parentAipId": parent},
    }


def _safe_cell(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def catalog_csv(catalog):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(("identifier", "selection", "title", "creator", "date",
                     "original_record_member", "reviewed_metadata_member",
                     "source_record_sha256", "payload_rights", "described_work_rights", "review_reason"))
    for row in catalog["records"]:
        dc = row["reviewedDc"]
        values = (
            row["identifier"], "included" if row["include"] else "excluded standalone record",
            " | ".join(dc.get("title", [])), " | ".join(dc.get("creator", [])),
            " | ".join(dc.get("date", [])), row["rodaOriginalPath"] or "",
            row["rodaReviewedPath"], row["source"]["recordSha256"],
            " | ".join(dc.get("rights", [])), " | ".join(row["sourceResourceRights"]),
            (row.get("decision") or {}).get("reason", ""),
        )
        writer.writerow([_safe_cell(v) for v in values])
    return out.getvalue().encode("utf-8")


def report_html(catalog, agreement, original):
    esc = lambda value: html.escape(str(value), quote=True)
    rows = []
    for row in catalog["records"]:
        detail = {
            "originalDc": row["originalDc"], "reviewedDc": row["reviewedDc"],
            "source": row["source"], "issues": row["issues"],
            "decision": row["decision"], "sourceResourceRights": row["sourceResourceRights"],
            "sourceWorkType": row["sourceWorkType"],
        }
        rows.append(
            '<tr data-selected="' + ("yes" if row["include"] else "no") + '"><td><strong>' +
            esc(row["identifier"]) + '</strong><br>' +
            esc(" | ".join(row["reviewedDc"].get("title", []))) + '</td><td>' +
            ("Included" if row["include"] else "Excluded standalone record") +
            '</td><td class="path">' + esc(row["rodaOriginalPath"] or "Retained in the complete original archive") +
            '<br>' + esc(row["rodaReviewedPath"]) +
            '</td><td><details><summary>Source, rights and review</summary><pre>' +
            esc(json.dumps(detail, ensure_ascii=False, indent=2)) + '</pre></details></td></tr>')
    counts = catalog["summary"]
    return ("""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RODA research transfer review</title>
<style>
:root{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#f4f4f4}
*{box-sizing:border-box}body{margin:0}main{max-width:1480px;margin:auto;padding:28px}
header,section{background:white;border:1px solid #b9b9b9;padding:22px;margin:0 0 18px}
h1{margin:0 0 8px;font-size:26px}h2{font-size:18px}p{max-width:100ch}
dl{display:grid;grid-template-columns:160px 1fr;gap:8px;margin-bottom:0}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
.controls{display:flex;align-items:end;flex-wrap:wrap;gap:16px;margin-bottom:14px}
label{display:block;font-weight:600}input,select{display:block;min-height:42px;border:1px solid #777;background:white;padding:8px;font:inherit}
input{width:min(520px,80vw)}table{width:100%;border-collapse:collapse;text-align:left}
th,td{border-bottom:1px solid #c9c9c9;vertical-align:top;padding:10px}
th{background:#eee}td:first-child{min-width:230px}summary{cursor:pointer;text-decoration:underline}
pre,.path{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:pre-wrap}
.scroll{overflow:auto}output{font-weight:600}.note{border-left:3px solid #555;padding-left:14px}
@media(max-width:650px){main{padding:10px}header,section{padding:14px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}
</style><main><header><h1>RODA research transfer</h1><p>""" +
            esc(agreement["collection"]["title"]) + """</p><dl><dt>Repository</dt><dd>""" +
            esc(agreement["repository"]["name"]) + " · " + esc(agreement["repository"]["baseUrl"]) +
            "</dd><dt>Agreement reference</dt><dd>" + esc(agreement["agreementId"]) +
            "</dd><dt>Producer</dt><dd>" + esc(agreement["producer"]["name"]) + " · " +
            esc(agreement["producer"]["contact"]) + "</dd><dt>Research collection</dt><dd>" +
            esc(original["collectionId"]) + "</dd><dt>Original transfer</dt><dd>" +
            esc(original["bagId"]) + "</dd><dt>Records</dt><dd>" + str(counts["source"]) +
            " source · " + str(counts["included"]) + " selected · " + str(counts["excluded"]) +
            """ excluded standalone records</dd></dl></header><section><h2>Receiving model</h2>
<p>One BagIt submission package becomes one RODA archival information package. Each selected
record and its reviewed metadata remain separate files inside that package. RODA's BagIt
conversion derives package metadata from bag-info.txt. Per-record JSON and the retained
Archivematica CSV remain content files unless the receiving repository configures a catalogue
mapping.</p><p class="note">The complete original research transfer is retained byte for byte.
Excluding a standalone record preserves that record inside the complete original edition.
The payload contains bibliographic metadata; described works and their full text are separate
resources.</p><p>All outer payload basenames are globally unique, and one SHA-256 payload
manifest names every payload exactly once. The complete source member index preserves each
original path, length and checksum.</p></section><section><h2>Record review</h2>
<div class="controls"><div><label for="query">Find a record</label><input id="query" type="search" placeholder="Identifier, title, source or review text"></div>
<div><label for="selection">Selection</label><select id="selection"><option value="">All records</option><option value="yes">Included</option><option value="no">Excluded standalone records</option></select></div>
<output id="count" aria-live="polite"></output></div>
<div class="scroll"><table><thead><tr><th>Research record</th><th>Selection</th><th>Preserved files</th><th>Full metadata</th></tr></thead><tbody>""" +
            "".join(rows) + """</tbody></table></div></section></main>
<script>
const input=document.querySelector('#query'), select=document.querySelector('#selection');
const rows=[...document.querySelectorAll('tbody tr')], count=document.querySelector('#count');
const texts=rows.map(row=>row.textContent.toLocaleLowerCase());
function filter(){const q=input.value.trim().toLocaleLowerCase();let n=0;
rows.forEach((row,i)=>{const visible=(!select.value||row.dataset.selected===select.value)&&texts[i].includes(q);row.hidden=!visible;if(visible)n++});
count.textContent=n+' of '+rows.length+' records';}
input.addEventListener('input',filter);select.addEventListener('change',filter);filter();
</script></html>""").encode("utf-8")


def _derive(original_path, agreement_raw):
    agreement, context = validate_agreement(agreement_raw)
    descriptor = file_digest(original_path, MAX_ORIGINAL)
    verification = p.verify(original_path)
    reader = p.BagReader(original_path)
    try:
        original_rows = reader.json(p.DOC + "mapping.json")["records"]
        rows = []
        original_to_outer = {}
        for original in original_rows:
            work = original["identifier"].rsplit("/", 1)[1]
            if not re.fullmatch(r"W[0-9]+", work):
                raise Error("Unexpected original research identifier")
            raw_path = "data/records/record-" + work + "-original.json" if original["include"] else None
            reviewed_path = "data/metadata/record-" + work + "-reviewed.json"
            rows.append({**original, "rodaOriginalPath": raw_path, "rodaReviewedPath": reviewed_path})
            if raw_path:
                original_to_outer[original["payloadPath"]] = raw_path
        counts = {"source": verification["sourceRecords"], "included": verification["includedRecords"],
                  "excluded": verification["excludedRecords"]}
        original = {**descriptor, "path": ORIGINAL_MEMBER, "bagId": verification["bagId"],
                    "collectionId": verification["identity"]["collectionId"],
                    "metadataProfile": verification["metadataProfile"]}
        catalog = {"schema": CATALOG_SCHEMA, "original": original,
                   "packageModel": "one-bag-one-aip", "summary": counts, "records": rows}
        members = []
        for name in reader.names:
            data = reader.read(name)
            members.append({
                "originalPath": name, "bytes": len(data), "sha256": p.digest(data),
                "retainedIn": {"path": ORIGINAL_MEMBER, "member": reader.prefix + name},
                "standalonePath": original_to_outer.get(name),
            })
        source_index = {"schema": INDEX_SCHEMA, "original": original, "members": members}
        profile = {
            "schema": SIP_SCHEMA, "profile": PROFILE, "packageModel": "one-bag-one-aip",
            "id": "roda-research-" + p.digest(p.canonical({
                "profile": PROFILE, "originalSha256": descriptor["sha256"],
                "agreementSha256": p.digest(agreement_raw),
            }))[:24],
            "original": original, "originalVerification": verification,
            "agreementSha256": p.digest(agreement_raw), "records": counts,
            "metadataSemantics": "Bag information is package metadata; record JSON and the original Archivematica CSV are payload content.",
        }
        metadata = {
            "catalog.json": p.canonical(catalog),
            "catalog.csv": catalog_csv(catalog),
            "review.html": report_html(catalog, agreement, original),
            "source-members.json": p.canonical(source_index),
        }
        small_payload = {
            "data/metadata/transfer-profile.json": p.canonical(profile),
            "data/metadata/submission-agreement.json": agreement_raw,
            "data/metadata/research-catalog.json": metadata["catalog.json"],
            "data/metadata/research-catalog.csv": metadata["catalog.csv"],
            "data/metadata/research-review.html": metadata["review.html"],
            "data/metadata/source-member-index.json": metadata["source-members.json"],
        }
        for row in rows:
            small_payload[row["rodaReviewedPath"]] = p.canonical(row)
            if row["include"]:
                small_payload[row["rodaOriginalPath"]] = reader.read(row["payloadPath"])
        if any(len(data) > MAX_SMALL for data in small_payload.values()):
            raise Error("Derived metadata member exceeds the 64 MiB limit")
        basenames = [PurePosixPath(name).name for name in [*small_payload, ORIGINAL_MEMBER]]
        if len(basenames) != len(set(basenames)):
            raise Error("RODA outer payload basenames must be globally unique")
        return {
            "agreement": agreement, "context": context, "original": original,
            "originalVerification": verification, "profile": profile,
            "catalog": catalog, "metadata": metadata, "smallPayload": small_payload,
        }
    finally:
        reader.close()


def _bag_tags(derived, prepared_at):
    profile, agreement = derived["profile"], derived["agreement"]
    payload = {
        name: {"sha256": p.digest(data), "bytes": len(data)}
        for name, data in derived["smallPayload"].items()
    }
    payload[ORIGINAL_MEMBER] = {key: derived["original"][key] for key in ("sha256", "bytes")}
    total = sum(row["bytes"] for row in payload.values())
    if total > MAX_TRANSFER:
        raise Error("RODA payload exceeds its complete transfer limit")
    manifest = "".join(payload[name]["sha256"] + "  " + name + "\n" for name in sorted(payload)).encode("utf-8")
    info = [
        ("Source-Organization", agreement["producer"]["name"]),
        ("Contact-Email", agreement["producer"]["contact"]),
        ("External-Identifier", profile["id"]),
        ("Bag-Group-Identifier", derived["original"]["collectionId"]),
        ("External-Description", agreement["collection"]["title"]),
        ("Bagging-Date", prepared_at[:10]),
        ("Payload-Oxum", str(total) + "." + str(len(payload))),
        ("Submission-Agreement", agreement["agreementId"]),
        ("Source-Transfer-Identifier", derived["original"]["bagId"]),
        ("Source-Transfer-SHA256", derived["original"]["sha256"]),
        ("Research-Records", str(profile["records"]["source"])),
        ("Selected-Records", str(profile["records"]["included"])),
        ("Excluded-Standalone-Records", str(profile["records"]["excluded"])),
        ("Metadata-License", p.LICENSE),
    ]
    tags = {
        "bagit.txt": p.BAGIT,
        "bag-info.txt": "".join(key + ": " + _single(value, key) + "\n" for key, value in info).encode("utf-8"),
        "manifest-sha256.txt": manifest,
    }
    tags["tagmanifest-sha256.txt"] = "".join(
        p.digest(tags[name]) + "  " + name + "\n" for name in sorted(tags)
    ).encode("utf-8")
    return tags, payload, total


def _zip_info(name, *, stored=False):
    p.safe_name(name)
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
    return info


def _zip_copy(archive, name, path, *, stored=False):
    expected = file_digest(path, MAX_SNAPSHOT)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        with os.fdopen(fd, "rb", closefd=False) as src, archive.open(_zip_info(name, stored=stored), "w", force_zip64=True) as dst:
            count, h = 0, hashlib.sha256()
            while chunk := src.read(CHUNK):
                count += len(chunk)
                if count > expected["bytes"]:
                    raise Error("ZIP source grew beyond its verified length")
                h.update(chunk)
                dst.write(chunk)
        _equal(_stamp(os.fstat(fd)), _stamp(before), "ZIP source changed during publication")
        _equal({"sha256": h.hexdigest(), "bytes": count}, expected, "ZIP source differs from its checked identity")
    finally:
        os.close(fd)
    return expected


def _write_transfer(path, original_path, derived, prepared_at):
    tags, _, _ = _bag_tags(derived, prepared_at)
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name, data in sorted(tags.items()):
            archive.writestr(_zip_info(name), data)
        for name, data in sorted(derived["smallPayload"].items()):
            archive.writestr(_zip_info(name), data)
        _zip_copy(archive, ORIGINAL_MEMBER, original_path, stored=True)
    with open(path, "rb") as handle:
        os.fsync(handle.fileno())
    return file_digest(path, MAX_TRANSFER)


def _zip_inventory(archive, max_total=MAX_TRANSFER):
    infos = archive.infolist()
    if len(infos) > MAX_FILES:
        raise Error("Archive exceeds its member count limit")
    entries = {}
    total = 0
    for entry in infos:
        if entry.is_dir():
            raise Error("Transfer profile uses regular file members only")
        name = p.safe_name(entry.filename)
        mode = (entry.external_attr >> 16) & 0o170000
        if mode not in {0, stat.S_IFREG} or entry.flag_bits & 1:
            raise Error("Unsupported encrypted or nonregular ZIP member")
        if name in entries:
            raise Error("Duplicate ZIP member: " + name)
        if not 0 <= entry.file_size <= max_total:
            raise Error("ZIP member exceeds the complete byte limit")
        total += entry.file_size
        if total > max_total:
            raise Error("ZIP expands beyond the complete byte limit")
        entries[name] = entry
    return entries


def _zip_digest(archive, entry):
    count, h = 0, hashlib.sha256()
    with archive.open(entry) as handle:
        while chunk := handle.read(CHUNK):
            count += len(chunk)
            if count > entry.file_size:
                raise Error("ZIP member exceeds its declared length")
            h.update(chunk)
    _equal(count, entry.file_size, "ZIP member length changed")
    return {"sha256": h.hexdigest(), "bytes": count}


def _verify_transfer(path, derived, prepared_at):
    tags, payload, total = _bag_tags(derived, prepared_at)
    with zipfile.ZipFile(path) as archive:
        entries = _zip_inventory(archive)
        _equal(set(entries), set(tags) | set(payload), "RODA SIP member inventory differs from its original source and agreement")
        for name, data in tags.items():
            _equal(archive.read(entries[name]), data, "RODA bag tag changed: " + name)
        for name, expected in payload.items():
            _equal(_zip_digest(archive, entries[name]), expected, "RODA payload changed: " + name)
    return {
        "schema": SIP_SCHEMA + ".verification", "valid": True, "profile": PROFILE,
        "bagId": derived["profile"]["id"], "packageModel": "one-bag-one-aip",
        "members": len(tags) + len(payload), "payloadFiles": len(payload),
        "payloadBytes": total, "payloadOxum": str(total) + "." + str(len(payload)),
        "payloadManifestSha256": p.digest(tags["manifest-sha256.txt"]),
        "payloadChecksumAlgorithms": ["sha256"], "globallyUniquePayloadBasenames": True,
        "original": derived["originalVerification"],
    }


def _handoff(derived, transfer, verification, prepared_at):
    agreement_sha = derived["profile"]["agreementSha256"]
    fingerprint = p.digest(p.canonical({
        "transferSha256": transfer["sha256"], "agreementSha256": agreement_sha,
    }))
    return {
        "schema": SCHEMA, "id": "roda-research-" + fingerprint[:24],
        "fingerprintSha256": fingerprint, "createdAt": prepared_at,
        "transfer": {
            "path": "transfer.zip", **transfer, "bagId": derived["profile"]["id"],
            "collectionId": derived["original"]["collectionId"], "format": "bagit-1.0-zip",
        },
        "originalTransfer": {
            "path": "original.zip", **{key: derived["original"][key] for key in ("sha256", "bytes", "bagId")},
        },
        "verification": verification,
        "agreement": {"path": "agreement.json", "sha256": agreement_sha,
                      "agreementId": derived["agreement"]["agreementId"]},
        **derived["context"], "records": derived["profile"]["records"],
        "packageModel": "one-bag-one-aip",
    }


def _check_timestamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise Error("Prepared timestamp must be a UTC timestamp")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise Error("Invalid prepared timestamp") from error
    if parsed.tzinfo is None:
        raise Error("Prepared timestamp requires UTC")
    return value


def _regular_names(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise Error("Expected a regular directory: " + str(root))
    result = []
    for parent, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        files.sort()
        for name in dirs:
            path = Path(parent) / name
            if path.is_symlink():
                raise Error("Directory symlink is outside the receiving profile")
        for name in files:
            path = Path(parent) / name
            relative = path.relative_to(root).as_posix()
            p.safe_name(relative)
            if path.is_symlink() or not path.is_file():
                raise Error("Receiving members must be regular files")
            result.append(relative)
            if len(result) > MAX_FILES:
                raise Error("Too many receiving members")
    return sorted(result)


def verify_workspace(workspace):
    """Fully verify an already locked workspace; does not acquire workspace.lock."""
    root = Path(workspace).absolute()
    if root.is_symlink() or not root.is_dir():
        raise Error("Open an existing RODA workspace")
    manifest = _json(root, "MANIFEST.json")
    _equal(manifest.get("schema"), MANIFEST_SCHEMA, "Unsupported RODA workspace manifest")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != FIXED:
        raise Error("Prepared file inventory changed")
    for name, expected in files.items():
        if not isinstance(expected, dict) or set(expected) != {"sha256", "bytes"}:
            raise Error("Invalid prepared member descriptor")
        _equal(file_digest(root / name, MAX_TRANSFER), expected, "Prepared member changed: " + name)
    allowed = FIXED | {"MANIFEST.json", "workspace.lock"}
    for name in _regular_names(root):
        if name not in allowed and not name.startswith("remote/"):
            raise Error("Unexpected workspace member: " + name)
    handoff = _json(root, "handoff.json")
    _equal(handoff.get("schema"), SCHEMA, "Unsupported RODA handoff")
    prepared_at = _check_timestamp(handoff.get("createdAt"))
    raw = p.read_regular(root, "agreement.json", MAX_SMALL)
    derived = _derive(root / "original.zip", raw)
    for name, data in derived["metadata"].items():
        _equal(p.read_regular(root, name, MAX_SMALL), data, "Source-derived receiving view changed: " + name)
    verification = _verify_transfer(root / "transfer.zip", derived, prepared_at)
    expected = _handoff(derived, files["transfer.zip"], verification, prepared_at)
    _equal(handoff, expected, "Handoff differs from its complete original source and entered agreement")
    return handoff


def show(workspace):
    with p.project_lock(workspace):
        return verify_workspace(workspace)


def prepare(source, agreement_file, workspace):
    root = Path(workspace).absolute()
    source = Path(source).absolute()
    if source.is_symlink() or not source.is_file() or not zipfile.is_zipfile(source):
        raise Error("Select a complete existing original research BagIt ZIP")
    raw = p.read_regular(Path(agreement_file).absolute().parent, Path(agreement_file).name, MAX_SMALL)
    validate_agreement(raw)
    original_descriptor = file_digest(source, MAX_ORIGINAL)
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Separate parent publication lock does not alter the original research project.
    lock_root = root.parent / ("." + root.name + ".publication")
    lock_root.mkdir(mode=0o700, exist_ok=True)
    with p.project_lock(lock_root):
        if root.exists() or root.is_symlink():
            with p.project_lock(root):
                previous = verify_workspace(root)
                _equal(
                    {k: previous["originalTransfer"][k] for k in ("sha256", "bytes")},
                    original_descriptor, "Existing workspace belongs to another original transfer")
                _equal(previous["agreement"]["sha256"], p.digest(raw), "Existing workspace belongs to another entered agreement")
                return {"workspace": str(root), "reused": True, "handoff": previous}
        stage = Path(tempfile.mkdtemp(prefix="." + root.name + "-", dir=root.parent))
        try:
            _equal(_copy_new(source, stage / "original.zip", MAX_ORIGINAL),
                   original_descriptor, "Original input changed while preparing")
            p.write_new(stage / "agreement.json", raw)
            derived = _derive(stage / "original.zip", raw)
            prepared_at = p.utc()
            for name, data in derived["metadata"].items():
                p.write_new(stage / name, data)
            transfer = _write_transfer(stage / "transfer.zip", stage / "original.zip", derived, prepared_at)
            verification = _verify_transfer(stage / "transfer.zip", derived, prepared_at)
            handoff = _handoff(derived, transfer, verification, prepared_at)
            p.write_new(stage / "handoff.json", p.canonical(handoff))
            files = {name: file_digest(stage / name, MAX_TRANSFER) for name in sorted(FIXED)}
            p.write_new(stage / "MANIFEST.json", p.canonical({"schema": MANIFEST_SCHEMA, "files": files}))
            p.write_new(stage / "workspace.lock", b"")
            _equal(verify_workspace(stage), handoff, "Prepared workspace failed its complete reopen")
            p.sync_tree(stage)
            os.rename(stage, root)
            stage = None
            p.fsync_dir(root.parent)
            return {"workspace": str(root), "reused": False, "handoff": handoff}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def verify_transfer(source):
    """Verify a standalone outer SIP by reconstructing its complete original."""
    source = Path(source).absolute()
    descriptor = file_digest(source, MAX_TRANSFER)
    with tempfile.TemporaryDirectory(prefix="roda-receiving-") as temp:
        temp = Path(temp)
        with zipfile.ZipFile(source) as archive:
            entries = _zip_inventory(archive)
            required = {ORIGINAL_MEMBER, "data/metadata/submission-agreement.json", "bag-info.txt"}
            if not required.issubset(entries):
                raise Error("Missing original transfer, agreement or bag information")
            for name in required - {ORIGINAL_MEMBER}:
                if entries[name].file_size > MAX_SMALL:
                    raise Error("Oversized transfer metadata")
            raw = archive.read(entries["data/metadata/submission-agreement.json"])
            info = archive.read(entries["bag-info.txt"]).decode("utf-8")
            dates = [line.partition(": ")[2] for line in info.splitlines() if line.startswith("Bagging-Date: ")]
            if len(dates) != 1 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dates[0]):
                raise Error("Missing or ambiguous bagging date")
            prepared_at = _check_timestamp(dates[0] + "T00:00:00Z")
            original_path = temp / "original.zip"
            with archive.open(entries[ORIGINAL_MEMBER]) as src, open(original_path, "xb") as dst:
                count = 0
                while chunk := src.read(CHUNK):
                    count += len(chunk)
                    if count > MAX_ORIGINAL:
                        raise Error("Retained original transfer exceeds its byte limit")
                    dst.write(chunk)
                dst.flush()
                os.fsync(dst.fileno())
            _equal(count, entries[ORIGINAL_MEMBER].file_size, "Original archive length differs")
        derived = _derive(original_path, raw)
        result = _verify_transfer(source, derived, prepared_at)
        _equal(file_digest(source, MAX_TRANSFER), descriptor, "Source transfer changed during reopening")
        return {**result, "transfer": descriptor}


def compare(previous, current):
    roots = sorted({str(Path(previous).absolute()), str(Path(current).absolute())})
    with contextlib.ExitStack() as stack:
        for root in roots:
            stack.enter_context(p.project_lock(root))
        before, after = verify_workspace(previous), verify_workspace(current)
        original = p.compare(Path(previous) / "original.zip", Path(current) / "original.zip")
        return {
            "schema": SCHEMA + ".comparison",
            "previousHandoffId": before["id"], "currentHandoffId": after["id"],
            "sameRepository": before["repository"] == after["repository"],
            "sameAgreementBytes": before["agreement"]["sha256"] == after["agreement"]["sha256"],
            "sameTransferBytes": before["transfer"]["sha256"] == after["transfer"]["sha256"],
            "originalResearchComparison": original,
        }


def _snapshot_manifest(archive):
    entries = _zip_inventory(archive, MAX_SNAPSHOT)
    if "MANIFEST.json" not in entries or entries["MANIFEST.json"].file_size > MAX_SMALL:
        raise Error("Snapshot requires its complete manifest")
    manifest = p.parse_json(archive.read(entries["MANIFEST.json"]))
    if not isinstance(manifest, dict) or manifest.get("schema") != SNAPSHOT_SCHEMA:
        raise Error("Unsupported receiving snapshot")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != set(entries) - {"MANIFEST.json"}:
        raise Error("Snapshot manifest and ZIP inventory differ")
    required = {"workspace/" + name for name in FIXED | {"MANIFEST.json"}}
    required |= {"application/" + name for name in APPLICATION}
    if not required.issubset(files):
        raise Error("Snapshot omits prepared data or complete installed source")
    for name, expected in files.items():
        if (not name.startswith("workspace/") and not name.startswith("application/")):
            raise Error("Snapshot member lies outside workspace/application")
        if name.startswith("application/") and name not in required:
            raise Error("Unexpected executable source member")
        if name.startswith("workspace/"):
            relative = name[len("workspace/"):]
            if relative not in FIXED | {"MANIFEST.json"} and not relative.startswith("remote/"):
                raise Error("Unexpected saved workspace member")
        if not isinstance(expected, dict) or set(expected) != {"sha256", "bytes"}:
            raise Error("Invalid snapshot member descriptor")
        _equal(_zip_digest(archive, entries[name]), expected, "Snapshot member changed: " + name)
    return manifest, entries


def export(workspace, output):
    root, output = Path(workspace).absolute(), Path(output).absolute()
    if output == root or output.is_relative_to(root):
        raise Error("Place the receiving snapshot outside its original workspace")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with p.project_lock(root):
        handoff = verify_workspace(root)
        members = {}
        for name in _regular_names(root):
            if name == "workspace.lock":
                continue
            if name not in FIXED | {"MANIFEST.json"} and not name.startswith("remote/"):
                raise Error("Unexpected source workspace member")
            members["workspace/" + name] = root / name
        # This source closure executes both producer and repository client after receiving.
        application_root = Path(__file__).resolve().parent.parent.parent
        for name in APPLICATION:
            file = application_root / name
            if file.is_symlink() or not file.is_file():
                raise Error("Install the complete source closure before exporting: " + name)
            members["application/" + name] = file
        descriptors = {name: file_digest(path, MAX_TRANSFER) for name, path in sorted(members.items())}
        total = sum(item["bytes"] for item in descriptors.values())
        if total > MAX_SNAPSHOT:
            raise Error("Receiving snapshot exceeds its byte limit")
        manifest = {
            "schema": SNAPSHOT_SCHEMA, "createdAt": p.utc(), "handoffId": handoff["id"],
            "handoffSha256": descriptors["workspace/handoff.json"]["sha256"],
            "applicationEntry": "application/research/preservation/roda.py",
            "workspacePath": "workspace", "files": descriptors,
            "credentials": "Repository credentials are supplied by external environment references on the receiving host.",
        }
        if output.exists() or output.is_symlink():
            if output.is_symlink():
                raise Error("Snapshot output must not be a symlink")
            with zipfile.ZipFile(output) as archive:
                existing, _ = _snapshot_manifest(archive)
            _equal(existing["files"], descriptors, "Existing snapshot contains a different workspace, journal or application")
            _equal(existing["handoffId"], handoff["id"], "Existing snapshot belongs to another transfer")
            return {"path": str(output), "reused": True, "handoffId": handoff["id"],
                    **file_digest(output, MAX_SNAPSHOT), "members": len(descriptors) + 1}
        fd, temp_name = tempfile.mkstemp(prefix=".roda-snapshot-", dir=output.parent)
        os.close(fd)
        temporary = Path(temp_name)
        temporary.unlink()
        try:
            with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for name, path in sorted(members.items()):
                    actual = _zip_copy(archive, name, path, stored=name.endswith(".zip"))
                    _equal(actual, descriptors[name], "Source changed during complete snapshot")
                archive.writestr(_zip_info("MANIFEST.json"), p.canonical(manifest))
            with zipfile.ZipFile(temporary) as archive:
                _snapshot_manifest(archive)
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            os.link(temporary, output, follow_symlinks=False)
            p.fsync_dir(output.parent)
            return {"path": str(output), "reused": False, "handoffId": handoff["id"],
                    **file_digest(output, MAX_SNAPSHOT), "members": len(descriptors) + 1}
        finally:
            temporary.unlink(missing_ok=True)


def _verify_received(root, manifest):
    expected = set(manifest["files"]) | {"MANIFEST.json"}
    actual = set(_regular_names(root)) - {"workspace/workspace.lock"}
    _equal(actual, expected, "Received directory inventory changed")
    for name, descriptor in manifest["files"].items():
        _equal(file_digest(Path(root) / name, MAX_TRANSFER), descriptor, "Received member changed: " + name)
    _equal(_json(root, "MANIFEST.json"), manifest, "Received top-level manifest changed")
    with p.project_lock(Path(root) / "workspace"):
        handoff = verify_workspace(Path(root) / "workspace")
    _equal(handoff["id"], manifest["handoffId"], "Received original handoff differs")
    return handoff


def receive(source, output):
    """Create a new receiving directory; verify with installed trusted source."""
    source, output = Path(source).absolute(), Path(output).absolute()
    source_descriptor = file_digest(source, MAX_SNAPSHOT)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_root = output.parent / ("." + output.name + ".publication")
    lock_root.mkdir(mode=0o700, exist_ok=True)
    with p.project_lock(lock_root), zipfile.ZipFile(source) as archive:
        manifest, entries = _snapshot_manifest(archive)
        if output.exists() or output.is_symlink():
            if output.is_symlink():
                raise Error("Receiving output must not be a symlink")
            handoff = _verify_received(output, manifest)
            return {"path": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / manifest["applicationEntry"]),
                    "reused": True, "handoff": handoff}
        stage = Path(tempfile.mkdtemp(prefix=".roda-receive-", dir=output.parent))
        try:
            for name, entry in sorted(entries.items()):
                destination = stage / name
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.open(entry) as src, open(destination, "xb") as dst:
                    count = 0
                    while chunk := src.read(CHUNK):
                        count += len(chunk)
                        if count > entry.file_size:
                            raise Error("Receiving member exceeds its declared length")
                        dst.write(chunk)
                    dst.flush()
                    os.fsync(dst.fileno())
                _equal(count, entry.file_size, "Receiving member length differs")
            handoff = _verify_received(stage, manifest)
            _equal(file_digest(source, MAX_SNAPSHOT), source_descriptor, "Snapshot changed during receiving")
            p.sync_tree(stage)
            os.rename(stage, output)
            stage = None
            p.fsync_dir(output.parent)
            return {"path": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / manifest["applicationEntry"]),
                    "reused": False, "handoff": handoff}
        finally:
            if stage is not None:
                shutil.rmtree(stage)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "remote":
        import roda_client
        return roda_client.main(argv[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("agreement-template", help="Print the complete operator-entered agreement template")
    cmd = sub.add_parser("prepare", help="Prepare one complete RODA research SIP and receiving workspace")
    cmd.add_argument("--source", required=True)
    cmd.add_argument("--agreement", required=True)
    cmd.add_argument("--workspace", required=True)
    for name in ("show", "verify"):
        cmd = sub.add_parser(name, help="Fully reopen the prepared original source, agreement and transfer")
        cmd.add_argument("--workspace", required=True)
    cmd = sub.add_parser("verify-transfer", help="Reopen a standalone RODA SIP and its retained original research")
    cmd.add_argument("--source", required=True)
    cmd = sub.add_parser("compare", help="Compare complete original reviews and repository agreements")
    cmd.add_argument("--previous", required=True)
    cmd.add_argument("--current", required=True)
    cmd = sub.add_parser("export", help="Save complete prepared data, repository journal and installed application")
    cmd.add_argument("--workspace", required=True)
    cmd.add_argument("--output", required=True)
    for name in ("receive", "reopen"):
        cmd = sub.add_parser(name, help="Receive and reopen the complete application and original workspace")
        cmd.add_argument("--source", required=True)
        cmd.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "agreement-template":
            result = agreement_template()
        elif args.command == "prepare":
            result = prepare(args.source, args.agreement, args.workspace)
        elif args.command in {"show", "verify"}:
            result = show(args.workspace)
        elif args.command == "verify-transfer":
            result = verify_transfer(args.source)
        elif args.command == "compare":
            result = compare(args.previous, args.current)
        elif args.command == "export":
            result = export(args.workspace, args.output)
        else:
            result = receive(args.source, args.output)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (Error, OSError, zipfile.BadZipFile, UnicodeError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
