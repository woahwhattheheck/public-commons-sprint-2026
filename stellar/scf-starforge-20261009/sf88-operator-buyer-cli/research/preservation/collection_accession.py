#!/usr/bin/env python3
"""Original-file collection accession for the maintained preservation Workbench."""
from __future__ import annotations
import argparse
import contextlib
import csv
import hashlib
import html
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile
import preservation as p

SCHEMA = "stellar-forge.collection-accession.v1"
REVIEW = SCHEMA + ".review"
PROFILE = "original-file-collection-bagit-1"
DOC = "data/metadata/submissionDocumentation/"
MAX_FILES = 10000
MAX_JSON = 4 * 1024 * 1024
MAX_MEMBER = p.MAX_MEMBER
MAX_TOTAL = p.MAX_TOTAL
FIELDS = p.DC_FIELDS
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}")

def need(condition, message):
    if not condition:
        raise p.PreservationError(message)

def ident(value):
    need(isinstance(value, str) and ID.fullmatch(value), "Use a 1–96 character accession ID.")
    return value

def fields(value):
    need(isinstance(value, dict) and not set(value) - set(FIELDS), "Use Dublin Core field names.")
    result = {}
    for key, items in sorted(value.items()):
        need(isinstance(items, list) and len(items) <= 100, "Metadata fields contain up to 100 strings.")
        result[key] = [p.text(item, key, empty=False) for item in items]
    return result

def json_file(root, name):
    return p.parse_json(p.read_regular(root, name))

def file_hash(path):
    path = Path(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_MEMBER,
         "Select regular files within the 64 MiB member limit: " + str(path))
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), "Source changed while opening.")
        sha = hashlib.sha256()
        length = 0
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            length += len(block)
            need(length <= MAX_MEMBER, "Source grew beyond the member limit.")
            sha.update(block)
        after = os.fstat(stream.fileno())
        keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        need(all(getattr(opened, k) == getattr(after, k) for k in keys)
             and length == opened.st_size, "Source changed while reading.")
    return {"bytes": length, "sha256": sha.hexdigest()}

def inventory(source):
    source = Path(source).absolute()
    need(source.is_dir() and not source.is_symlink(), "Select an existing ordinary source directory.")
    files, directories = {}, []
    total = 0
    def traversal_error(error):
        raise error
    for parent, dirs, names in os.walk(source, followlinks=False, onerror=traversal_error):
        dirs.sort(); names.sort()
        for name in dirs:
            path = Path(parent) / name
            need(not path.is_symlink() and path.is_dir(), "Source directories must not be symlinks.")
            directories.append(p.safe_name(path.relative_to(source).as_posix()))
        for name in names:
            path = Path(parent) / name
            relative = p.safe_name(path.relative_to(source).as_posix())
            item = file_hash(path)
            total += item["bytes"]
            need(total <= MAX_TOTAL and len(files) < MAX_FILES, "Collection exceeds 2 GiB or 10,000 files.")
            files[relative] = item
        need(len(directories) <= MAX_FILES, "Collection has too many directories.")
    need(files, "Select a collection containing at least one original file.")
    value = {"schema": SCHEMA + ".inventory", "files": dict(sorted(files.items())),
             "directories": sorted(directories), "bytes": total}
    need(len(p.canonical(value)) <= MAX_JSON, "Original inventory exceeds the 4 MiB metadata profile.")
    return value | {"sha256": p.digest(p.canonical(value))}

def validate_inventory(value):
    need(isinstance(value, dict) and set(value) == {"schema", "files", "directories", "bytes", "sha256"}
         and value["schema"] == SCHEMA + ".inventory", "Invalid original collection inventory.")
    need(len(p.canonical(value)) <= MAX_JSON + 100, "Original inventory exceeds the metadata profile.")
    unhashed = {k: v for k, v in value.items() if k != "sha256"}
    need(value["sha256"] == p.digest(p.canonical(unhashed)), "Original collection inventory digest changed.")
    need(isinstance(value["files"], dict) and 0 < len(value["files"]) <= MAX_FILES, "Invalid original file count.")
    total = 0
    for name, entry in value["files"].items():
        p.safe_name(name)
        need(isinstance(entry, dict) and set(entry) == {"bytes", "sha256"}
             and type(entry["bytes"]) is int and 0 <= entry["bytes"] <= MAX_MEMBER
             and isinstance(entry["sha256"], str) and p.SHA_PATTERN.fullmatch(entry["sha256"]),
             "Invalid original file identity: " + name)
        total += entry["bytes"]
    dirs = value["directories"]
    need(isinstance(dirs, list) and len(dirs) <= MAX_FILES and dirs == sorted(set(dirs)), "Invalid directory inventory.")
    for name in dirs:
        p.safe_name(name)
        need(name not in value["files"], "File/directory identity collision.")
    all_names = set(value["files"]) | set(dirs)
    for name in all_names:
        parent = Path(name).parent.as_posix()
        while parent != ".":
            need(parent in dirs, "Missing original parent directory.")
            parent = Path(parent).parent.as_posix()
    need(type(value["bytes"]) is int and value["bytes"] == total <= MAX_TOTAL, "Original collection total changed.")
    return value

def inspect(source):
    value = inventory(source)
    return {"source": str(Path(source).absolute()), "inventory": value,
            "notice": "This is an exact file inventory. Rights, preservation eligibility and repository acceptance require their actual selections."}

def settings(value):
    need(isinstance(value, dict) and set(value) == {"id", "title", "organization", "contact", "sourceReference"},
         "Enter accession ID, title, organization, contact and original source reference.")
    result = {key: p.text(item, key, empty=key not in {"id", "title", "sourceReference"})
              for key, item in value.items()}
    ident(result["id"])
    need(not any(c in result["organization"] + result["contact"] for c in "\r\n"), "Sender fields must be single-line.")
    return result

def normalize_review(value, inv):
    need(isinstance(value, dict) and not set(value) - {"schema", "inventorySha256", "decisions", "note"}
         and value.get("schema") == REVIEW and value.get("inventorySha256") == inv["sha256"],
         "Review must bind the exact original collection.")
    need(len(p.canonical(value)) <= MAX_JSON, "The complete review exceeds the 4 MiB metadata profile.")
    need(isinstance(value.get("decisions"), list) and len(value["decisions"]) <= MAX_FILES, "Invalid review decisions.")
    result, seen = [], set()
    for item in value["decisions"]:
        need(isinstance(item, dict) and set(item) == {"path", "include", "fields", "reason"},
             "Each decision requires path, include, fields and reason.")
        name = item["path"]
        need(name in inv["files"] and name not in seen, "Unknown or repeated original file.")
        seen.add(name)
        need(type(item["include"]) is bool, "File selection must be boolean.")
        original_fields = fields(item["fields"])
        reason = p.text(item["reason"], "reason")
        need((item["include"] and not original_fields) or reason.strip(), "An exclusion or metadata edit requires its reason.")
        if "title" in original_fields:
            need(original_fields["title"], "Keep a title for this original file.")
        result.append({"path": name, "include": item["include"], "fields": original_fields, "reason": reason})
    return {"schema": REVIEW, "inventorySha256": inv["sha256"],
            "decisions": sorted(result, key=lambda x: x["path"]), "note": p.text(value.get("note", ""), "note")}

def mapped(inv, review):
    decisions = {item["path"]: item for item in review["decisions"]}
    rows = []
    for path, original in inv["files"].items():
        item = decisions.get(path)
        metadata = {"title": [Path(path).name], "identifier": [path]}
        if item:
            metadata.update(item["fields"])
        metadata["identifier"] = list(dict.fromkeys([path, *metadata.get("identifier", [])]))
        rows.append({"path": path, "payloadPath": "data/objects/" + path, "original": original,
                     "include": item["include"] if item else True, "fields": metadata,
                     "reason": item["reason"] if item else "",
                     "rightsUnspecified": not bool(metadata.get("rights"))})
    return rows

def project(root, verify=False):
    root = Path(root)
    need(root.is_dir() and not root.is_symlink(), "Open an existing original accession.")
    record = json_file(root, "accession.json")
    need(isinstance(record, dict) and set(record) == {"schema", "createdAt", "settings", "inventorySha256"}
         and record["schema"] == SCHEMA, "Unsupported accession workspace.")
    settings(record["settings"])
    inv = validate_inventory(json_file(root, "inventory.json"))
    need(record["inventorySha256"] == inv["sha256"], "Accession source binding changed.")
    if verify:
        need(inventory(root / "original") == inv, "Retained original files or directory inventory changed.")
    return record, inv

def history(root, inv):
    pointer = json_file(root, "current.json")
    need(isinstance(pointer, dict) and set(pointer) == {"revision", "reviewSha256"}
         and type(pointer["revision"]) is int and 0 <= pointer["revision"] <= 2000, "Invalid accession revision pointer.")
    result, previous = [], None
    for revision in range(pointer["revision"] + 1):
        saved = json_file(root, f"reviews/{revision:08d}.json")
        need(isinstance(saved, dict) and set(saved) == {"schema", "revision", "createdAt", "previousReviewSha256", "reviewSha256", "review"}
             and saved["schema"] == SCHEMA + ".revision" and saved["revision"] == revision
             and saved["previousReviewSha256"] == previous, "Accession review history changed.")
        normalized = normalize_review(saved["review"], inv)
        need(normalized == saved["review"] and saved["reviewSha256"] == p.digest(p.canonical(normalized)),
             "Saved accession review digest changed.")
        previous = saved["reviewSha256"]
        result.append(saved)
    need(previous == pointer["reviewSha256"], "Current review is not the retained history head.")
    return result

def status(root, verify=False):
    record, inv = project(root, verify)
    versions = history(root, inv)
    current = versions[-1]
    rows = mapped(inv, current["review"])
    return {"schema": SCHEMA + ".status", "workspace": str(Path(root).absolute()),
            "id": record["settings"]["id"], "settings": record["settings"], "createdAt": record["createdAt"],
            "inventory": inv, "revision": current["revision"], "reviewSha256": current["reviewSha256"],
            "review": current["review"], "reviewHistory": [{k: item[k] for k in ("revision", "createdAt", "reviewSha256", "previousReviewSha256")} for item in versions], "rows": rows,
            "summary": {"files": len(rows), "bytes": inv["bytes"], "directories": len(inv["directories"]),
                        "included": sum(row["include"] for row in rows), "excluded": sum(not row["include"] for row in rows),
                        "rightsUnspecified": sum(row["include"] and row["rightsUnspecified"] for row in rows)}}

def show(root, verify=False):
    with p.project_lock(root):
        return status(root, verify)

def copy_exact(source, target, identity):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    sha, length = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as incoming, open(target, "xb") as output:
        need(stat.S_ISREG(os.fstat(incoming.fileno()).st_mode), "Original source is no longer a file.")
        os.chmod(target, 0o600)
        for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
            length += len(chunk)
            need(length <= identity["bytes"], "Original file grew during retention.")
            sha.update(chunk); output.write(chunk)
        output.flush(); os.fsync(output.fileno())
    need({"bytes": length, "sha256": sha.hexdigest()} == identity, "Original file changed during retention.")

def initialize(source, root, value, expected_inventory):
    source, root = Path(source).absolute(), Path(root).absolute()
    selected = settings(value)
    need(not root.resolve().is_relative_to(source.resolve()), "The retained workspace must be outside its original source tree.")
    inv = inventory(source)
    need(inv["sha256"] == expected_inventory, "Original source changed after inventory review.")
    if root.exists() or root.is_symlink():
        observed = show(root, True)
        need(observed["settings"] == selected and observed["inventory"] == inv, "Existing accession contains another source or selection.")
        return {**observed, "reused": True}
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    p.fsync_dir(root.parent.parent)
    with p.project_lock(root.parent):
        if root.exists():
            observed = show(root, True)
            need(observed["settings"] == selected and observed["inventory"] == inv, "Concurrent accession selection changed.")
            return {**observed, "reused": True}
        stage = Path(tempfile.mkdtemp(prefix=".accession-", dir=root.parent))
        try:
            (stage / "original").mkdir(mode=0o700)
            for name in inv["directories"]:
                (stage / "original" / name).mkdir(parents=True, exist_ok=True, mode=0o700)
            for name, identity in inv["files"].items():
                copy_exact(source / name, stage / "original" / name, identity)
            need(inventory(source) == inv and inventory(stage / "original") == inv, "Source inventory changed during retention.")
            review = normalize_review({"schema": REVIEW, "inventorySha256": inv["sha256"], "decisions": [], "note": ""}, inv)
            digest = p.digest(p.canonical(review))
            stamp = p.utc()
            p.write_new(stage / "inventory.json", p.canonical(inv))
            p.write_new(stage / "accession.json", p.canonical({"schema": SCHEMA, "createdAt": stamp, "settings": selected, "inventorySha256": inv["sha256"]}))
            p.write_new(stage / "reviews/00000000.json", p.canonical({"schema": SCHEMA + ".revision", "revision": 0,
                "createdAt": stamp, "previousReviewSha256": None, "reviewSha256": digest, "review": review}))
            p.write_new(stage / "current.json", p.canonical({"revision": 0, "reviewSha256": digest}))
            p.write_new(stage / "workspace.lock", b"")
            p.sync_tree(stage)
            os.rename(stage, root)
            stage = None
            p.fsync_dir(root.parent)
        finally:
            if stage is not None:
                shutil.rmtree(stage)
    return {**show(root, True), "reused": False}

def save_review(root, supplied, expected_revision):
    need(type(expected_revision) is int and expected_revision >= 0, "Choose the original saved review revision.")
    with p.project_lock(root):
        _, inv = project(root)
        versions = history(root, inv)
        prior = versions[-1]
        review = normalize_review(supplied, inv)
        sha = p.digest(p.canonical(review))
        if review == prior["review"]:
            return {**status(root), "reused": True}
        need(prior["revision"] == expected_revision, "STALE_REVISION: reopen the current accession review before saving.")
        need(expected_revision < 2000, "This accession reached its retained review limit.")
        revision = expected_revision + 1
        path = Path(root) / f"reviews/{revision:08d}.json"
        value = {"schema": SCHEMA + ".revision", "revision": revision, "createdAt": p.utc(),
                 "previousReviewSha256": prior["reviewSha256"], "reviewSha256": sha, "review": review}
        if path.exists():
            retained = json_file(root, f"reviews/{revision:08d}.json")
            need({k: v for k, v in retained.items() if k != "createdAt"} ==
                 {k: v for k, v in value.items() if k != "createdAt"}, "Original interrupted review differs from this request.")
        else:
            p.write_new(path, p.canonical(value))
        p.replace_bytes(Path(root) / "current.json", p.canonical({"revision": revision, "reviewSha256": sha}))
        return {**status(root), "reused": False}

def bindings(parent, verify=False, locked=False):
    parent = Path(parent)
    if not parent.exists():
        return []
    need(parent.is_dir() and not parent.is_symlink(), "Invalid retained accession directory.")
    result = []
    for root in sorted(parent.iterdir()):
        if root.name.startswith(".") or root.name == "workspace.lock":
            continue
        ident(root.name)
        item = status(root, verify) if locked else show(root, verify)
        need(item["id"] == root.name, "Accession directory identity changed.")
        result.append({"id": item["id"], "title": item["settings"]["title"],
                       "inventorySha256": item["inventory"]["sha256"], "revision": item["revision"],
                       "reviewSha256": item["reviewSha256"], "summary": item["summary"]})
    return result

def restore_directories(parent):
    parent = Path(parent)
    if not parent.exists():
        return
    for root in sorted(parent.iterdir()):
        if root.name.startswith(".") or root.name == "workspace.lock":
            continue
        _, inv = project(root)
        for name in inv["directories"]:
            path = root / "original" / name
            need(not path.is_symlink(), "Received original directory is a symlink.")
            path.mkdir(parents=True, exist_ok=True, mode=0o700)

def metadata_csv(rows):
    selected = [row for row in rows if row["include"]]
    columns = [(key, n) for key in FIELDS
               for n in range(max((len(row["fields"].get(key, [])) for row in selected), default=0))]
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["filename", *("dc." + key for key, _ in columns), "original_sha256", "original_bytes", "review_reason"])
    for row in selected:
        writer.writerow([row["payloadPath"],
            *(row["fields"].get(key, [])[n] if n < len(row["fields"].get(key, [])) else "" for key, n in columns),
            row["original"]["sha256"], row["original"]["bytes"], row["reason"]])
    return out.getvalue().encode("utf-8")

def report_html(settings_value, inv, revision, rows):
    e = lambda value: html.escape(str(value), quote=True)
    body = "".join("<tr><td>" + e(row["path"]) + "</td><td>" +
        ("Included" if row["include"] else "Excluded") + "</td><td>" + e(row["original"]["bytes"]) +
        "</td><td>" + e("; ".join(row["fields"].get("rights", [])) or "Not supplied") +
        "</td><td>" + e(row["reason"]) + "</td></tr>" for row in rows)
    return ("""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Collection transfer</title><style>body{font:15px/1.5 system-ui;margin:0;color:#222;background:white}main{max-width:1200px;margin:auto;padding:24px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #bbb;overflow-wrap:anywhere}code{overflow-wrap:anywhere}.scroll{overflow:auto}th{background:#eee}@media(max-width:600px){main{padding:12px}td,th{padding:7px}}</style><main><h1>""" +
        e(settings_value["title"]) + "</h1><p>Accession " + e(settings_value["id"]) +
        " · review " + e(revision["revision"]) + "</p><p>Original source: " + e(settings_value["sourceReference"]) +
        "</p><p>This transfer contains the selected original file bytes. Excluded files remain in the complete private workspace, and only their original identities appear here. Entered rights statements are descriptive decisions, not grants of permission. Repository processing, preservation and storage remain separate receiving outcomes.</p><p>Source inventory SHA-256 <code>" +
        e(inv["sha256"]) + "</code><br>Review SHA-256 <code>" + e(revision["reviewSha256"]) +
        '</code></p><p><a href="metadata.csv">Original-file metadata CSV</a> · <a href="submissionDocumentation/mapping.json">Complete mapping</a> · <a href="submissionDocumentation/review.json">Saved review</a></p><div class="scroll"><table><thead><tr><th>Original path</th><th>Selection</th><th>Bytes</th><th>Rights statement</th><th>Reason</th></tr></thead><tbody>' +
        body + "</tbody></table></div></main></html>").encode("utf-8")

def bag_identity(record, inv, revision):
    value = {"schema": SCHEMA + ".bag", "profile": PROFILE, "settings": record["settings"],
             "inventorySha256": inv["sha256"], "reviewRevision": revision["revision"],
             "reviewSha256": revision["reviewSha256"]}
    return value | {"id": "collection-" + p.digest(p.canonical(value))}

def bag_info(identity, payload_bytes, count):
    return ("Bagging-Date: " + identity["baggingDate"] + "\nExternal-Identifier: " + identity["id"] +
            "\nBag-Group-Identifier: " + identity["inventorySha256"] +
            "\nPayload-Oxum: " + str(payload_bytes) + "." + str(count) + "\n").encode("utf-8")

def documentation(record, inv, revision):
    rows = mapped(inv, revision["review"])
    identity = bag_identity(record, inv, revision)
    identity["baggingDate"] = revision["createdAt"][:10]
    return identity, rows, {
        DOC + "profile.json": p.canonical(identity), DOC + "inventory.json": p.canonical(inv),
        DOC + "review.json": p.canonical(revision), DOC + "mapping.json": p.canonical(rows),
        "data/metadata/metadata.csv": metadata_csv(rows),
        "data/metadata/review.html": report_html(record["settings"], inv, revision, rows),
    }

def build(root, output, expected_revision):
    output = Path(output).absolute()
    need(not output.resolve().is_relative_to(Path(root).resolve()),
         "Choose a transfer output outside the retained accession and its original files.")
    with p.project_lock(root):
        record, inv = project(root, True)
        revision = history(root, inv)[-1]
        need(type(expected_revision) is int and revision["revision"] == expected_revision, "STALE_REVISION: choose the current saved accession.")
        identity, rows, documents = documentation(record, inv, revision)
        if output.exists() or output.is_symlink():
            retained = verify_bag(output)
            need(retained["identity"] == identity, "Existing output contains another reviewed collection.")
            return {**retained, "path": str(output), "reused": True}
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        p.fsync_dir(output.parent.parent)
        stage = Path(tempfile.mkdtemp(prefix=".collection-bag-", dir=output.parent))
        try:
            bag = stage / "bag"; bag.mkdir(mode=0o700)
            for row in rows:
                if row["include"]:
                    copy_exact(Path(root) / "original" / row["path"], bag / row["payloadPath"], row["original"])
            for name, body in documents.items():
                p.write_new(bag / name, body)
            payload = p.file_names(bag)
            total = sum((bag / name).stat().st_size for name in payload)
            need(total <= MAX_TOTAL, "Complete transfer exceeds the 2 GiB profile.")
            p.write_new(bag / "bagit.txt", p.BAGIT)
            p.write_new(bag / "bag-info.txt", bag_info(identity, total, len(payload)))
            for algorithm in ("sha256", "sha512"):
                p.write_new(bag / ("manifest-" + algorithm + ".txt"), p.checksums(bag, payload, algorithm))
            tags = ["bagit.txt", "bag-info.txt", "manifest-sha256.txt", "manifest-sha512.txt"]
            for algorithm in ("sha256", "sha512"):
                p.write_new(bag / ("tagmanifest-" + algorithm + ".txt"), p.checksums(bag, tags, algorithm))
            receipt = verify_bag(bag)
            archive_path = stage / "transfer.zip"
            with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for name in p.file_names(bag):
                    info = zipfile.ZipInfo(identity["id"] + "/" + name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    with archive.open(info, "w", force_zip64=True) as out, open(bag / name, "rb") as incoming:
                        shutil.copyfileobj(incoming, out, 1024 * 1024)
            with open(archive_path, "rb") as incoming:
                os.fsync(incoming.fileno())
            need(verify_bag(archive_path) == receipt, "Published ZIP differs from its complete original bag.")
            os.link(archive_path, output, follow_symlinks=False)
            p.fsync_dir(output.parent)
            return {**receipt, "path": str(output), "reused": False}
        finally:
            shutil.rmtree(stage)

def verify_bag(source):
    reader = p.BagReader(source)
    try:
        names = set(reader.names)
        need(reader.read("bagit.txt") == p.BAGIT, "Expected BagIt 1.0 UTF-8 declaration.")
        payload = {name for name in names if name.startswith("data/")}
        tags = {"bagit.txt", "bag-info.txt", "manifest-sha256.txt", "manifest-sha512.txt"}
        need(names == payload | tags | {"tagmanifest-sha256.txt", "tagmanifest-sha512.txt"}, "Unexpected bag member.")
        for algorithm in ("sha256", "sha512"):
            for prefix, expected in (("manifest", payload), ("tagmanifest", tags)):
                declared = p.parse_manifest(reader.read(prefix + "-" + algorithm + ".txt"), algorithm)
                need(set(declared) == expected, "Manifest inventory differs from original members.")
                for name, sha in declared.items():
                    need(p.digest(reader.read(name), algorithm) == sha, "Bag checksum mismatch: " + name)
        identity = reader.json(DOC + "profile.json")
        need(isinstance(identity, dict) and identity.get("schema") == SCHEMA + ".bag", "Unsupported collection profile.")
        inv = validate_inventory(reader.json(DOC + "inventory.json"))
        revision = reader.json(DOC + "review.json")
        need(isinstance(revision, dict) and set(revision) == {"schema", "revision", "createdAt", "previousReviewSha256", "reviewSha256", "review"}
             and revision["schema"] == SCHEMA + ".revision" and type(revision["revision"]) is int
             and 0 <= revision["revision"] <= 2000 and isinstance(revision["createdAt"], str)
             and re.fullmatch(r"\d{4}-\d{2}-\d{2}T.+", revision["createdAt"]), "Invalid saved collection review.")
        review = normalize_review(revision["review"], inv)
        need(review == revision["review"] and revision["reviewSha256"] == p.digest(p.canonical(review)), "Review digest changed.")
        record = {"settings": settings(identity.get("settings"))}
        expected_identity, rows, documents = documentation(record, inv, revision)
        need(identity == expected_identity, "Transfer identity differs from saved source and review.")
        expected_payload = set(documents) | {row["payloadPath"] for row in rows if row["include"]}
        need(payload == expected_payload, "Transfer selection or documentation inventory changed.")
        for name, body in documents.items():
            need(reader.read(name) == body, "Transfer metadata differs from saved review: " + name)
        for row in rows:
            if row["include"]:
                data = reader.read(row["payloadPath"])
                need({"bytes": len(data), "sha256": p.digest(data)} == row["original"], "Selected original bytes changed.")
        total = sum(len(reader.read(name)) for name in payload)
        need(reader.read("bag-info.txt") == bag_info(identity, total, len(payload)), "Original bag information changed.")
        return {"schema": SCHEMA + ".verification", "valid": True, "identity": identity,
                "sourceFiles": len(rows), "includedFiles": sum(row["include"] for row in rows),
                "excludedFiles": sum(not row["include"] for row in rows),
                "payloadFiles": len(payload), "payloadBytes": total, "manifestSha256": p.digest(reader.read("manifest-sha256.txt"))}
    finally:
        reader.close()

def compare(previous, current):
    receipts = [verify_bag(previous), verify_bag(current)]
    readers = [p.BagReader(previous), p.BagReader(current)]
    try:
        old, new = [{row["path"]: row for row in reader.json(DOC + "mapping.json")} for reader in readers]
        changes = []
        for path in sorted(set(old) | set(new)):
            before, after = old.get(path), new.get(path)
            kinds = []
            if before is None: kinds.append("SOURCE_ADDED")
            elif after is None: kinds.append("SOURCE_ABSENT")
            else:
                if before["original"] != after["original"]: kinds.append("ORIGINAL_BYTES_CHANGED")
                if before["include"] != after["include"]: kinds.append("SELECTION_CHANGED")
                if before["fields"] != after["fields"]: kinds.append("METADATA_CHANGED")
                if before["reason"] != after["reason"]: kinds.append("REVIEW_REASON_CHANGED")
            if kinds:
                changes.append({"path": path, "changes": kinds, "before": before, "after": after})
        return {"schema": SCHEMA + ".comparison", "previous": receipts[0]["identity"],
                "current": receipts[1]["identity"], "changes": changes,
                "note": "Source absence is an observed difference; it does not authorize deleting a preserved object."}
    finally:
        for reader in readers: reader.close()

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    item = commands.add_parser("inspect"); item.add_argument("--source", required=True)
    item = commands.add_parser("init")
    for name in ("source", "workspace", "settings", "inventory-sha256"): item.add_argument("--" + name, required=True)
    item = commands.add_parser("show"); item.add_argument("--workspace", required=True); item.add_argument("--verify", action="store_true")
    item = commands.add_parser("review-save"); item.add_argument("--workspace", required=True); item.add_argument("--input", required=True); item.add_argument("--expected-revision", required=True, type=int)
    item = commands.add_parser("build"); item.add_argument("--workspace", required=True); item.add_argument("--output", required=True); item.add_argument("--expected-revision", required=True, type=int)
    item = commands.add_parser("verify"); item.add_argument("--source", required=True)
    item = commands.add_parser("compare"); item.add_argument("--previous", required=True); item.add_argument("--current", required=True)
    args = parser.parse_args(argv)
    if args.command == "inspect": result = inspect(args.source)
    elif args.command == "init": result = initialize(args.source, args.workspace, p.parse_json(Path(args.settings).read_bytes()), args.inventory_sha256)
    elif args.command == "show": result = show(args.workspace, args.verify)
    elif args.command == "review-save": result = save_review(args.workspace, p.parse_json(Path(args.input).read_bytes()), args.expected_revision)
    elif args.command == "build": result = build(args.workspace, args.output, args.expected_revision)
    elif args.command == "verify": result = verify_bag(args.source)
    else: result = compare(args.previous, args.current)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (p.PreservationError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=__import__("sys").stderr)
        raise SystemExit(2)
