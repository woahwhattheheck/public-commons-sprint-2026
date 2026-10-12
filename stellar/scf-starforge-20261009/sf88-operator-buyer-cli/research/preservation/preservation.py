#!/usr/bin/env python3
"""Receive native research editions as reviewed Archivematica BagIt transfers.

Python 3.11+, standard library. Original source intake is delegated to the
adjacent maintained research/oai/oai_feed.py.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import fcntl
import hashlib
import html
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import uuid
import zipfile

SCHEMA = "stellar-forge.research-preservation.v1"
REVIEW_SCHEMA = "stellar-forge.research-preservation-review.v1"
BAG_SCHEMA = "stellar-forge.archivematica-research-bag.v1"
PROFILE = "archivematica-1.18-bagit-metadata"
LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
DOC = "data/metadata/submissionDocumentation/"
MAX_MEMBER = 64 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
DC_FIELDS = (
    "title", "creator", "subject", "description", "publisher", "contributor",
    "date", "type", "format", "identifier", "source", "language",
    "relation", "coverage", "rights",
)
REVIEW_FIELDS = frozenset(DC_FIELDS) - {"type", "format", "rights"}
ID_PATTERN = re.compile(r"https://openalex\.org/W[0-9]+")
SHA_PATTERN = re.compile(r"[0-9a-f]{64}")
BAGIT = b"BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n"


class PreservationError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data, algorithm="sha256"):
    return hashlib.new(algorithm, data).hexdigest()


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreservationError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def parse_json(data):
    return json.loads(data, object_pairs_hook=object_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          PreservationError("Non-finite JSON number: " + value)))


def safe_name(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise PreservationError("A nonempty relative member path is required")
    p = PurePosixPath(value)
    if (p.is_absolute() or str(p) != value or any(x in {".", "..", ""} for x in value.split("/"))
            or "\\" in value or ":" in value
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise PreservationError("Unsafe or noncanonical member path: " + repr(value))
    return value


def text(value, field, *, empty=True):
    if not isinstance(value, str):
        raise PreservationError(field + " must be a string")
    if len(value) > 20000 or any(
            not (c in "\t\n\r" or 32 <= ord(c) <= 0xD7FF
                 or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF)
            for c in value):
        raise PreservationError(field + " contains unsupported text")
    if not empty and not value.strip():
        raise PreservationError(field + " must not be empty")
    return value


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".unpublished-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # The final immutable name appears only after all bytes are durable.
        os.link(temporary, path, follow_symlinks=False)
        fsync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def replace_bytes(path, data):
    path = Path(path)
    temp = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    try:
        write_new(temp, data)
        os.replace(temp, path)
        fsync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def read_regular(root, name, limit=MAX_MEMBER):
    safe_name(name)
    root = Path(root).resolve()
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise PreservationError("Member escapes its original directory: " + name)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_size > limit:
            raise PreservationError("Expected a bounded regular member: " + name)
        with os.fdopen(fd, "rb", closefd=False) as handle:
            result = handle.read(limit + 1)
        if len(result) > limit:
            raise PreservationError("Member grew beyond the intake limit: " + name)
        return result
    finally:
        os.close(fd)


def sync_tree(root):
    for parent, _, _ in os.walk(root, topdown=False):
        fsync_dir(parent)


def oai_module():
    path = Path(__file__).resolve().parent.parent / "oai" / "oai_feed.py"
    if not path.is_file() or path.is_symlink():
        raise PreservationError("Install the maintained adjacent research/oai/oai_feed.py")
    name = "_research_preservation_original_oai"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


def load_original(path, prefix=""):
    original = oai_module()
    prepared = original.prepare(path, prefix)
    src = original.ExportSource(path, prefix)
    try:
        files = src.manifest.get("files")
        if not isinstance(files, dict):
            raise PreservationError("Native source manifest has no file mapping")
        total = 0
        for name, entry in files.items():
            safe_name(name)
            size = entry.get("bytes")
            if type(size) is not int or not 0 <= size <= MAX_MEMBER:
                raise PreservationError("Invalid native source member length: " + name)
            total += size
        if total > MAX_TOTAL:
            raise PreservationError("Native edition exceeds the 2 GiB intake limit")
        return prepared, src
    except BaseException:
        src.close()
        raise


def source_inventory(src):
    # Read each member once through the original hash/length checker.
    for name in sorted(src.manifest["files"]):
        yield name, src.read(name)
    yield "manifest.json", src.manifest_bytes


def normalize_review(value, prepared):
    if not isinstance(value, dict):
        raise PreservationError("Review must be a JSON object")
    unknown = set(value) - {"schema", "sourceManifestSha256", "decisions", "note"}
    if unknown:
        raise PreservationError("Unknown review fields: " + ", ".join(sorted(unknown)))
    if value.get("schema") != REVIEW_SCHEMA:
        raise PreservationError("Unsupported review schema")
    if value.get("sourceManifestSha256") != prepared["binding"]["manifestSha256"]:
        raise PreservationError("Review belongs to another original source manifest")
    decisions = value.get("decisions", [])
    if not isinstance(decisions, list):
        raise PreservationError("Review decisions must be an array")
    identifiers = {row["identifier"] for row in prepared["records"]}
    seen, normalized = set(), []
    for decision in decisions:
        if not isinstance(decision, dict) or set(decision) - {"identifier", "include", "fields", "reason"}:
            raise PreservationError("Decision fields are identifier, include, fields and reason")
        identifier = decision.get("identifier")
        if identifier not in identifiers or identifier in seen:
            raise PreservationError("Unknown or duplicate reviewed identifier: " + str(identifier))
        seen.add(identifier)
        include = decision.get("include", True)
        if type(include) is not bool:
            raise PreservationError("Decision include must be a boolean")
        fields = decision.get("fields", {})
        if not isinstance(fields, dict) or set(fields) - REVIEW_FIELDS:
            raise PreservationError("Review corrections must use editable Dublin Core field names")
        cleaned = {}
        for key in sorted(fields):
            values = fields[key]
            if not isinstance(values, list) or len(values) > 1000:
                raise PreservationError("Each Dublin Core field must contain an array of strings")
            cleaned[key] = [text(item, key, empty=False) for item in values]
        reason = text(decision.get("reason", ""), "reason")
        if (not include or cleaned) and not reason.strip():
            raise PreservationError("An exclusion or metadata correction requires its entered reason")
        normalized.append({"identifier": identifier, "include": include,
                           "fields": cleaned, "reason": reason})
    normalized.sort(key=lambda row: row["identifier"])
    return {"schema": REVIEW_SCHEMA,
            "sourceManifestSha256": prepared["binding"]["manifestSha256"],
            "decisions": normalized, "note": text(value.get("note", ""), "note")}


def empty_review(prepared):
    return {"schema": REVIEW_SCHEMA,
            "sourceManifestSha256": prepared["binding"]["manifestSha256"],
            "decisions": [], "note": ""}


def project_files(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PreservationError("Open an existing preservation workspace")
    project = parse_json(read_regular(root, "project.json"))
    if project.get("schema") != SCHEMA:
        raise PreservationError("Unsupported preservation workspace")
    prepared, original = load_original(root / "source")
    original.close()
    saved = parse_json(read_regular(root, "prepared.json"))
    if saved != prepared or project.get("binding") != prepared["binding"]:
        raise PreservationError("Saved source binding differs from the original edition")
    return project, prepared


@contextlib.contextmanager
def project_lock(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PreservationError("Open an existing preservation workspace")
    fd = os.open(root / "workspace.lock",
                 os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise PreservationError("Workspace lock is not a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def current_review(root, prepared):
    current = parse_json(read_regular(root, "current.json"))
    revision = current.get("revision")
    if type(revision) is not int or revision < 0:
        raise PreservationError("Invalid saved review revision")
    path = safe_name(current.get("path"))
    if not re.fullmatch(r"reviews/[0-9]{8}-[0-9a-f]{64}\.json", path):
        raise PreservationError("Invalid immutable review member")
    saved = parse_json(read_regular(root, path))
    review = normalize_review(saved.get("review"), prepared)
    review_sha = digest(canonical(review))
    if (saved.get("schema") != SCHEMA + ".revision" or saved.get("revision") != revision
            or current.get("reviewSha256") != review_sha
            or saved.get("reviewSha256") != review_sha
            or path != f"reviews/{revision:08d}-{review_sha}.json"):
        raise PreservationError("Saved review revision or digest changed")
    return current, saved


def initialize(source, workspace, prefix="", *, organization="", contact=""):
    root = Path(workspace).absolute()
    organization = text(organization, "organization")
    contact = text(contact, "contact")
    if any(c in organization + contact for c in "\r\n"):
        raise PreservationError("Bag contact values must be single line")
    prepared, src = load_original(source, prefix)
    temp = None
    try:
        if root.exists():
            project, existing = project_files(root)
            if (existing["binding"] != prepared["binding"]
                    or project.get("organization") != organization or project.get("contact") != contact):
                raise PreservationError("Existing workspace has different source or contact settings")
            return show(root)
        root.parent.mkdir(parents=True, exist_ok=True)
        temp = Path(tempfile.mkdtemp(prefix="." + root.name + "-", dir=root.parent))
        for name, body in source_inventory(src):
            write_new(temp / "source" / name, body)
        frozen = oai_module().prepare(temp / "source")
        if frozen != prepared:
            raise PreservationError("Copied native edition differs from its original preparation")
        stamp = utc()
        review = empty_review(prepared)
        review_sha = digest(canonical(review))
        path = f"reviews/{0:08d}-{review_sha}.json"
        project = {"schema": SCHEMA, "profile": PROFILE, "createdAt": stamp,
                   "organization": organization, "contact": contact,
                   "binding": prepared["binding"]}
        write_new(temp / "project.json", canonical(project))
        write_new(temp / "prepared.json", canonical(prepared))
        write_new(temp / path, canonical({"schema": SCHEMA + ".revision",
                  "revision": 0, "createdAt": stamp, "reviewSha256": review_sha, "review": review}))
        write_new(temp / "current.json", canonical(
            {"revision": 0, "reviewSha256": review_sha, "path": path}))
        write_new(temp / "workspace.lock", b"")
        sync_tree(temp)
        # The workspace is fully constructed before publishing this single directory.
        os.rename(temp, root)
        temp = None
        fsync_dir(root.parent)
        return show(root)
    finally:
        src.close()
        if temp:
            shutil.rmtree(temp)


def show(workspace):
    with project_lock(workspace):
        project, prepared = project_files(workspace)
        current, saved = current_review(workspace, prepared)
        mapped = mapped_records(prepared, saved["review"])
        return {"schema": SCHEMA + ".status", "workspace": str(Path(workspace).absolute()),
                "project": project, "revision": current["revision"],
                "reviewSha256": current["reviewSha256"], "review": saved["review"],
                "sourceRecords": len(prepared["records"]),
                "includedRecords": sum(row["include"] for row in mapped),
                "excludedRecords": sum(not row["include"] for row in mapped),
                "sourceFieldIssues": prepared["summary"]["fieldIssues"]}


def save_review(workspace, value, expected_revision):
    if type(expected_revision) is not int or expected_revision < 0:
        raise PreservationError("Expected review revision must be a nonnegative integer")
    with project_lock(workspace):
        _, prepared = project_files(workspace)
        current, prior = current_review(workspace, prepared)
        review = normalize_review(value, prepared)
        # Validate resulting required descriptive fields before publishing a review.
        mapped_records(prepared, review)
        review_sha = digest(canonical(review))
        if review_sha == current["reviewSha256"]:
            return {"revision": current["revision"], "reviewSha256": review_sha, "reused": True}
        if expected_revision != current["revision"]:
            raise PreservationError(f"STALE_REVISION: expected {expected_revision}, current {current['revision']}")
        revision = current["revision"] + 1
        path = f"reviews/{revision:08d}-{review_sha}.json"
        record = {"schema": SCHEMA + ".revision", "revision": revision,
                  "createdAt": utc(), "previousReviewSha256": current["reviewSha256"],
                  "reviewSha256": review_sha, "review": review}
        target = Path(workspace) / path
        if target.exists():
            orphan = parse_json(read_regular(workspace, path))
            if (orphan.get("review") != review or orphan.get("revision") != revision
                    or orphan.get("previousReviewSha256") != current["reviewSha256"]):
                raise PreservationError("Existing unpublished review conflicts with this operation")
        else:
            write_new(target, canonical(record))
            fsync_dir(target.parent)
        replace_bytes(Path(workspace) / "current.json", canonical(
            {"revision": revision, "reviewSha256": review_sha, "path": path}))
        return {"revision": revision, "reviewSha256": review_sha, "reused": False}


def mapped_records(prepared, review):
    decisions = {row["identifier"]: row for row in review["decisions"]}
    result = []
    for original in prepared["records"]:
        decision = decisions.get(original["identifier"], {})
        dc = {key: list(values) for key, values in original["dc"].items()}
        for key, values in decision.get("fields", {}).items():
            dc[key] = list(values)
        # Every descriptive record retains the stable original work identifier.
        dc["identifier"] = list(dict.fromkeys([original["identifier"], *dc.get("identifier", [])]))
        if not dc.get("title"):
            raise PreservationError("An included metadata record needs a title: " + original["identifier"])
        source_type, source_rights = original["dc"].get("type", []), original["dc"].get("rights", [])
        # These fields describe the JSON metadata payload, not a full-text copy.
        dc["type"], dc["format"], dc["rights"] = ["Dataset"], ["application/json"], [LICENSE]
        dc["description"] = [
            "OpenAlex bibliographic metadata record. The described work and its full text are separate resources.",
            *dc.get("description", []),
        ]
        result.append({"identifier": original["identifier"],
                       "payloadPath": "data/records/" + original["identifier"].rsplit("/", 1)[1] + ".json",
                       "include": decision.get("include", True),
                       "originalDc": original["dc"], "reviewedDc": dc,
                       "source": original["source"], "issues": original["issues"],
                       "sourceResourceRights": source_rights, "sourceWorkType": source_type,
                       "decision": decision or None})
    return result


def metadata_csv(rows):
    included = [row for row in rows if row["include"]]
    columns = [(field, index) for field in DC_FIELDS
               for index in range(max((len(row["reviewedDc"].get(field, []))
                                       for row in included), default=0))]
    custom = ("sourceIdentifier", "sourceEdition", "sourceQuerySha256", "sourcePage",
              "sourceRecordSha256", "sourceResourceRights", "sourceWorkType", "reviewReason")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["filename", *("dc." + field for field, _ in columns), *custom])
    for row in included:
        values = row["reviewedDc"]
        writer.writerow([row["payloadPath"],
            *(values.get(field, [])[index] if index < len(values.get(field, [])) else ""
              for field, index in columns),
            row["identifier"], row["source"]["editionId"], row["source"]["querySha256"],
            row["source"]["page"], row["source"]["recordSha256"],
            json.dumps(row["sourceResourceRights"], ensure_ascii=False),
            json.dumps(row["sourceWorkType"], ensure_ascii=False),
            (row.get("decision") or {}).get("reason", "")])
    return output.getvalue().encode("utf-8")


def human_csv(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["identifier", "included", "title", "source_page", "source_sha256", "review_reason"])
    def excel(value):
        value = str(value)
        return "'" + value if value[:1] in {"=", "+", "-", "@"} else value
    for row in rows:
        writer.writerow([excel(row["identifier"]), str(row["include"]).lower(),
                         excel("; ".join(row["reviewedDc"]["title"])), row["source"]["page"],
                         row["source"]["recordSha256"], excel((row.get("decision") or {}).get("reason", ""))])
    return output.getvalue().encode("utf-8")


def report_html(binding, rows, revision, review_sha):
    e = lambda value: html.escape(str(value), quote=True)
    included = sum(row["include"] for row in rows)
    body = []
    for row in rows:
        dc = row["reviewedDc"]
        fields = "".join("<dt>" + e(field) + "</dt><dd>" +
                         "<br>".join(e(value) for value in values) + "</dd>"
                         for field, values in dc.items())
        decision = row.get("decision") or {}
        body.append(
            '<tr data-included="' + str(row["include"]).lower() + '"><td>' +
            ('Included' if row["include"] else 'Excluded') + '</td><td><a href="' +
            e(row["identifier"]) + '">' + e(row["identifier"].rsplit("/", 1)[1]) +
            '</a><br><strong>' + e("; ".join(dc["title"])) + '</strong><details><summary>Metadata and source</summary><dl>' +
            fields + '</dl><p>Original record SHA-256: <code>' + e(row["source"]["recordSha256"]) +
            '</code></p><p>Reported resource-copy rights: ' +
            e("; ".join(row["sourceResourceRights"]) or "Absent in source") +
            '</p></details></td><td>' + e(row["source"]["page"]) +
            '</td><td>' + e(decision.get("reason", "")) + '</td></tr>')
    document = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research preservation transfer</title><style>
:root{color-scheme:light}body{margin:0;background:#fff;color:#202020;font:15px/1.55 system-ui,sans-serif}
main{max-width:1180px;margin:auto;padding:30px 22px}h1{font-size:27px;line-height:1.2}h2{font-size:20px}
p{max-width:90ch}code{font-size:12px;overflow-wrap:anywhere}a{color:inherit}table{border-collapse:collapse;width:100%}
th,td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #bbb}thead{background:#eee}
dl{display:grid;grid-template-columns:120px 1fr;gap:4px 14px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}
input,select{font:inherit;border:1px solid #777;background:white;padding:8px}label{display:inline-block;margin:8px 15px 15px 0}
.stats{padding:14px;border:1px solid #aaa;background:#f7f7f7}.scroll{overflow:auto}details{margin-top:8px}
@media(max-width:600px){main{padding:18px 12px}td,th{padding:7px}dl{display:block}dd{margin-bottom:8px}}
</style><main><h1>Research preservation transfer</h1>"""
    document += "<p class=stats><strong>" + str(included) + " included</strong> · " + str(len(rows) - included) + \
        " excluded · " + str(len(binding["pages"])) + " retained source pages · review revision " + str(revision) + "</p>"
    document += "<p>These payloads preserve bibliographic JSON metadata. Each selected record retains its original source hash, " \
        "page and request identity. Descriptive corrections and exclusions are separately recorded; the original edition remains " \
        "in submission documentation, including records excluded from the standalone record selection. Payload metadata is CC0. Reported article-copy rights are a separate source field.</p>"
    document += "<p>Edition <code>" + e(binding["editionId"]) + "</code><br>Query SHA-256 <code>" + \
        e(binding["querySha256"]) + "</code><br>Source manifest SHA-256 <code>" + e(binding["manifestSha256"]) + \
        "</code><br>Review SHA-256 <code>" + e(review_sha) + "</code></p>"
    document += '<p><a href="metadata.csv">Archivematica metadata CSV</a> · <a href="submissionDocumentation/review.json">Saved review</a> · ' \
        '<a href="submissionDocumentation/reconciliation.json">Reconciliation</a> · <a href="submissionDocumentation/records-review.csv">Spreadsheet review</a></p>'
    document += '<h2>Receiving workflow</h2><p>Validate the complete bag before transfer. Select the bag as a zipped or unzipped BagIt transfer ' \
        'in the receiving Archivematica installation. The descriptive filename column uses <code>data/records/…</code> inside this bag. ' \
        'The receiving operator selects its normal processing configuration and records the resulting transfer, SIP and AIP identifiers.</p>'
    document += '<label>Find records <input id=q type=search placeholder="Title, identifier or reason"></label><label>Show <select id=state>' \
        '<option value="">All records</option><option value=true>Included</option><option value=false>Excluded</option></select></label>' \
        '<div class=scroll><table><thead><tr><th>Selection</th><th>Record</th><th>Page</th><th>Review reason</th></tr></thead><tbody>' + "".join(body) + "</tbody></table></div>"
    document += '<script>const q=document.querySelector("#q"),s=document.querySelector("#state"),rows=[...document.querySelectorAll("tbody tr")];' \
        'function filter(){const needle=q.value.toLocaleLowerCase();for(const r of rows)r.hidden=!!((s.value&&r.dataset.included!==s.value)||' \
        '!r.textContent.toLocaleLowerCase().includes(needle));}q.addEventListener("input",filter);s.addEventListener("change",filter);</script></main></html>'
    return document.encode("utf-8")


def path_code(name):
    return name.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def parse_manifest(data, algorithm):
    result = {}
    length = hashlib.new(algorithm).digest_size * 2
    for line in data.decode("utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-fA-F]{" + str(length) + r"})[ \t]+(.+)", line)
        if not match:
            raise PreservationError("Invalid checksum manifest line")
        value, path = match.groups()
        # Only the three RFC8493 pathname escapes are decoded.
        path = re.sub(r"%(25|0[dD]|0[aA])",
                      lambda m: {"25": "%", "0d": "\r", "0a": "\n"}[m.group(1).lower()], path)
        safe_name(path)
        if path in result:
            raise PreservationError("Repeated manifest member: " + path)
        result[path] = value.lower()
    return result


def checksums(root, names, algorithm):
    lines = []
    for name in sorted(names):
        data = read_regular(root, name)
        lines.append(digest(data, algorithm) + "  " + path_code(name) + "\n")
    return "".join(lines).encode("utf-8")


def file_names(root):
    result = []
    for parent, directories, files in os.walk(root, followlinks=False):
        for item in directories + files:
            path = Path(parent) / item
            if path.is_symlink():
                raise PreservationError("Bag symlinks are not accepted")
        for item in files:
            name = (Path(parent) / item).relative_to(root).as_posix()
            safe_name(name)
            result.append(name)
    return sorted(result)


def transfer_identity(binding, revision, organization="", contact=""):
    sender = {"organization": text(organization, "organization"),
              "contact": text(contact, "contact")}
    if any(c in sender["organization"] + sender["contact"] for c in "\r\n"):
        raise PreservationError("Bag contact values must be single line")
    revision_sha = digest(canonical(revision))
    preimage = {"source": binding["manifestSha256"], "review": revision["reviewSha256"],
                "revisionRecordSha256": revision_sha, "sender": sender, "profile": PROFILE}
    return {"schema": BAG_SCHEMA, "profile": PROFILE,
            "id": "research-" + digest(canonical(preimage))[:24],
            "collectionId": "research-source-" + binding["manifestSha256"][:24],
            "source": binding, "reviewRevision": revision["revision"],
            "reviewSha256": revision["reviewSha256"],
            "revisionRecordSha256": revision_sha, "sender": sender, "metadataLicense": LICENSE}


def bag_information(identity, revision, payload_bytes, payload_files):
    info = [
        ("External-Identifier", identity["id"]),
        ("Bag-Group-Identifier", identity["collectionId"]),
        ("External-Description", "Reviewed OpenAlex metadata and complete retained native research edition"),
        ("Bagging-Date", revision["createdAt"][:10]),
        ("Payload-Oxum", str(payload_bytes) + "." + str(payload_files)),
    ]
    if identity["sender"]["organization"]:
        info.insert(0, ("Source-Organization", identity["sender"]["organization"]))
    if identity["sender"]["contact"]:
        info.insert(1, ("Contact-Email", identity["sender"]["contact"]))
    return info


def build(workspace, output, expected_revision, *, zipped=False):
    output = Path(output).absolute()
    with project_lock(workspace):
        project, prepared = project_files(workspace)
        current, revision = current_review(workspace, prepared)
        if expected_revision != current["revision"]:
            raise PreservationError("STALE_REVISION: reload the saved review before building")
        rows = mapped_records(prepared, revision["review"])
        identity = transfer_identity(prepared["binding"], revision,
                                     project["organization"], project["contact"])
        bag_id = identity["id"]
        if output.exists():
            prior = verify(output)
            if prior["identity"] != identity:
                raise PreservationError("Existing output belongs to another source or review")
            return {**prior, "path": str(output), "reused": True}
        output.parent.mkdir(parents=True, exist_ok=True)
        stage_parent = Path(tempfile.mkdtemp(prefix=".research-bag-", dir=output.parent))
        bag = stage_parent / bag_id
        bag.mkdir(mode=0o700)
        try:
            _, src = load_original(Path(workspace) / "source")
            wanted = {row["identifier"]: row for row in rows if row["include"]}
            written = set()
            try:
                for name, data in source_inventory(src):
                    write_new(bag / DOC / "native-export" / name, data)
                    if re.fullmatch(r"pages/[0-9]{8}/response\.json", name):
                        response = parse_json(data)
                        for work in response["results"]:
                            identifier = work.get("id")
                            if identifier in wanted and identifier not in written:
                                row = wanted[identifier]
                                record = oai_module().canonical(work)
                                if digest(record) != row["source"]["recordSha256"]:
                                    raise PreservationError("Record differs from its original source hash")
                                write_new(bag / row["payloadPath"], record)
                                written.add(identifier)
            finally:
                src.close()
            if written != set(wanted):
                raise PreservationError("Selected record missing from the original native pages")
            write_new(bag / "data/metadata/metadata.csv", metadata_csv(rows))
            write_new(bag / "data/metadata/review.html",
                      report_html(prepared["binding"], rows, current["revision"], current["reviewSha256"]))
            write_new(bag / DOC / "profile.json", canonical(identity))
            write_new(bag / DOC / "source-binding.json", canonical(prepared["binding"]))
            write_new(bag / DOC / "review.json", canonical(revision))
            write_new(bag / DOC / "mapping.json", canonical(
                {"schema": SCHEMA + ".mapping", "records": rows}))
            write_new(bag / DOC / "records-review.csv", human_csv(rows))
            reconciliation = {"schema": SCHEMA + ".reconciliation",
                "sourceRecords": len(rows), "sourceOccurrences": prepared["summary"]["sourceOccurrences"],
                "includedRecords": len(wanted), "excludedRecords": len(rows) - len(wanted),
                "sourcePages": len(prepared["binding"]["pages"]),
                "includedIdentifiers": sorted(wanted),
                "excludedIdentifiers": [row["identifier"] for row in rows if not row["include"]],
                "sourceFieldIssues": prepared["summary"]["fieldIssues"],
                "reviewRevision": current["revision"], "reviewSha256": current["reviewSha256"]}
            write_new(bag / DOC / "reconciliation.json", canonical(reconciliation))
            write_new(bag / "bagit.txt", BAGIT)
            payload = file_names(bag / "data")
            payload = ["data/" + name for name in payload]
            total = sum((bag / name).stat().st_size for name in payload)
            info = bag_information(identity, revision, total, len(payload))
            write_new(bag / "bag-info.txt", "".join(key + ": " + value + "\n" for key, value in info).encode("utf-8"))
            for algorithm in ("sha256", "sha512"):
                write_new(bag / f"manifest-{algorithm}.txt", checksums(bag, payload, algorithm))
            tags = ["bagit.txt", "bag-info.txt", "manifest-sha256.txt", "manifest-sha512.txt"]
            for algorithm in ("sha256", "sha512"):
                write_new(bag / f"tagmanifest-{algorithm}.txt", checksums(bag, tags, algorithm))
            receipt = verify(bag)
            sync_tree(bag)
            if zipped:
                archive = stage_parent / "transfer.zip"
                with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                    for name in file_names(bag):
                        info = zipfile.ZipInfo(bag_id + "/" + name, date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = (stat.S_IFREG | 0o600) << 16
                        with z.open(info, "w", force_zip64=True) as target, (bag / name).open("rb") as source:
                            shutil.copyfileobj(source, target, 1024 * 1024)
                with archive.open("rb") as handle:
                    os.fsync(handle.fileno())
                # Exclusive link prevents a concurrent output from being overwritten.
                os.link(archive, output)
            else:
                os.rename(bag, output)
            fsync_dir(output.parent)
            return {**receipt, "path": str(output), "zipped": zipped, "reused": False}
        finally:
            shutil.rmtree(stage_parent)


class BagReader:
    def __init__(self, path):
        self.path = Path(path).absolute()
        if self.path.is_symlink():
            raise PreservationError("Bag source must not be a symlink")
        self.zip = zipfile.ZipFile(path) if self.path.is_file() else None
        self.prefix = ""
        self.entries = {}
        if self.zip:
            raw = self.zip.infolist()
            names = [item.filename for item in raw]
            if len(names) != len(set(names)):
                raise PreservationError("ZIP contains duplicate members")
            for info in raw:
                if info.is_dir():
                    safe_name(info.filename.rstrip("/"))
                    continue
                safe_name(info.filename)
                if (info.external_attr >> 16) & 0o170000 not in {0, stat.S_IFREG}:
                    raise PreservationError("ZIP member is not a regular file")
            declarations = [name for name in names if name == "bagit.txt" or name.endswith("/bagit.txt")]
            if len(declarations) != 1:
                raise PreservationError("Select one complete bag archive")
            self.prefix = declarations[0][:-len("bagit.txt")]
            for info in raw:
                if info.is_dir():
                    continue
                if not info.filename.startswith(self.prefix):
                    raise PreservationError("ZIP contains data outside the selected bag")
                name = safe_name(info.filename[len(self.prefix):])
                self.entries[name] = info
            self.names = sorted(self.entries)
            sizes = [entry.file_size for entry in self.entries.values()]
        else:
            if not self.path.is_dir():
                raise PreservationError("Select an existing bag directory or ZIP")
            self.names = file_names(self.path)
            sizes = [(self.path / name).stat().st_size for name in self.names]
        if any(size > MAX_MEMBER for size in sizes) or sum(sizes) > MAX_TOTAL:
            raise PreservationError("Bag exceeds the configured member or total intake limit")

    def close(self):
        if self.zip:
            self.zip.close()

    def read(self, name):
        safe_name(name)
        if name not in self.names:
            raise PreservationError("Missing bag member: " + name)
        return self.zip.read(self.entries[name]) if self.zip else read_regular(self.path, name)

    def json(self, name):
        return parse_json(self.read(name))


def _verify_reader(reader):
    names = set(reader.names)
    if reader.read("bagit.txt") != BAGIT:
        raise PreservationError("Expected the BagIt 1.0 UTF-8 transfer profile")
    payload = {name for name in names if name.startswith("data/")}
    tags = names - payload - {"tagmanifest-sha256.txt", "tagmanifest-sha512.txt"}
    expected_tags = {"bagit.txt", "bag-info.txt", "manifest-sha256.txt", "manifest-sha512.txt"}
    if tags != expected_tags:
        raise PreservationError("Unexpected or missing transfer tag members")
    for algorithm in ("sha256", "sha512"):
        for prefix, expected in (("manifest", payload), ("tagmanifest", tags)):
            values = parse_manifest(reader.read(f"{prefix}-{algorithm}.txt"), algorithm)
            if set(values) != expected:
                raise PreservationError("Manifest inventory differs from actual members")
            for name, expected_sha in values.items():
                if digest(reader.read(name), algorithm) != expected_sha:
                    raise PreservationError("Checksum mismatch: " + name)
    info = {}
    for line in reader.read("bag-info.txt").decode("utf-8").splitlines():
        key, sep, value = line.partition(": ")
        if not sep or key in info or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", key):
            raise PreservationError("Invalid or duplicate bag information label")
        info[key] = value
    total = sum(len(reader.read(name)) for name in payload)
    if info.get("Payload-Oxum") != f"{total}.{len(payload)}":
        raise PreservationError("Payload-Oxum differs from the actual payload")
    identity = reader.json(DOC + "profile.json")
    if identity.get("schema") != BAG_SCHEMA or identity.get("profile") != PROFILE:
        raise PreservationError("Unsupported Archivematica research transfer profile")
    binding = reader.json(DOC + "source-binding.json")
    if identity.get("source") != binding or identity.get("metadataLicense") != LICENSE:
        raise PreservationError("Transfer source binding differs from its profile")
    revision = reader.json(DOC + "review.json")
    mapping = reader.json(DOC + "mapping.json")
    reconciliation = reader.json(DOC + "reconciliation.json")
    if (mapping.get("schema") != SCHEMA + ".mapping"
            or reconciliation.get("schema") != SCHEMA + ".reconciliation"
            or revision.get("schema") != SCHEMA + ".revision"):
        raise PreservationError("Unsupported saved transfer documentation")
    if (type(revision.get("revision")) is not int or revision["revision"] < 0
            or revision.get("reviewSha256") != digest(canonical(revision.get("review")))):
        raise PreservationError("Saved review digest changed")
    if (identity.get("reviewSha256") != revision["reviewSha256"]
            or identity.get("reviewRevision") != revision.get("revision")):
        raise PreservationError("Review and transfer revision identity differ")
    # Reuse the original source checker directly on either archive or directory.
    native_path = DOC + "native-export"
    source_path = reader.path
    source_prefix = (reader.prefix + native_path).strip("/")
    prepared = oai_module().prepare(source_path, source_prefix)
    if prepared["binding"] != binding:
        raise PreservationError("Original native query/page binding differs from the transfer")
    review = normalize_review(revision["review"], prepared)
    rows = mapped_records(prepared, review)
    if mapping["records"] != rows:
        raise PreservationError("Descriptive mapping differs from source plus saved review")
    sender = identity.get("sender")
    if not isinstance(sender, dict) or set(sender) != {"organization", "contact"}:
        raise PreservationError("Missing frozen bag sender inputs")
    expected_identity = transfer_identity(binding, revision, sender["organization"], sender["contact"])
    if identity != expected_identity:
        raise PreservationError("Transfer identity differs from its immutable revision and sender inputs")
    if info != dict(bag_information(identity, revision, total, len(payload))):
        raise PreservationError("Bag information differs from the frozen transfer identity")
    if reader.read("data/metadata/review.html") != report_html(binding, rows, revision["revision"], revision["reviewSha256"]):
        raise PreservationError("Human receiving report differs from its source and review")
    if reader.read(DOC + "records-review.csv") != human_csv(rows):
        raise PreservationError("Spreadsheet review differs from its source and review")
    if reader.read("data/metadata/metadata.csv") != metadata_csv(rows):
        raise PreservationError("Archivematica descriptive CSV differs from the reviewed mapping")
    record_paths = {row["payloadPath"] for row in rows if row["include"]}
    if {name for name in payload if name.startswith("data/records/")} != record_paths:
        raise PreservationError("Selected JSON payload inventory differs from the saved review")
    for row in rows:
        if row["include"] and digest(reader.read(row["payloadPath"])) != row["source"]["recordSha256"]:
            raise PreservationError("Selected original record checksum changed")
    included = [row["identifier"] for row in rows if row["include"]]
    excluded = [row["identifier"] for row in rows if not row["include"]]
    if (reconciliation.get("includedIdentifiers") != sorted(included)
            or reconciliation.get("excludedIdentifiers") != excluded
            or reconciliation.get("sourceRecords") != len(rows)
            or reconciliation.get("includedRecords") != len(included)
            or reconciliation.get("excludedRecords") != len(excluded)
            or reconciliation.get("sourceOccurrences") != prepared["summary"]["sourceOccurrences"]
            or reconciliation.get("sourcePages") != len(binding["pages"])
            or reconciliation.get("sourceFieldIssues") != prepared["summary"]["fieldIssues"]
            or reconciliation.get("reviewRevision") != revision["revision"]
            or reconciliation.get("reviewSha256") != revision["reviewSha256"]):
        raise PreservationError("Transfer reconciliation differs from its actual selected records")
    src = oai_module().ExportSource(source_path, source_prefix)
    try:
        native_members = {DOC + "native-export/" + name for name in src.manifest["files"]}
        native_members.add(DOC + "native-export/manifest.json")
        if {name for name in payload if name.startswith(DOC + "native-export/")} != native_members:
            raise PreservationError("Original native source member inventory changed")
        expected_documentation = {DOC + name for name in (
            "profile.json", "source-binding.json", "review.json", "mapping.json",
            "records-review.csv", "reconciliation.json")}
        expected_payload = record_paths | native_members | expected_documentation | {
            "data/metadata/metadata.csv", "data/metadata/review.html"}
        if payload != expected_payload:
            raise PreservationError("Payload has members outside this transfer profile")
        for name in src.manifest["files"]:
            safe_name(name)
            src.read(name)
    finally:
        src.close()
    return {"schema": SCHEMA + ".verification", "valid": True,
            "identity": identity, "bagId": identity["id"], "metadataProfile": PROFILE,
            "members": len(names), "payloadFiles": len(payload), "payloadBytes": total,
            "sourceRecords": len(rows), "includedRecords": len(included), "excludedRecords": len(excluded),
            "sourcePages": len(binding["pages"]),
            "manifestSha256": digest(reader.read("manifest-sha256.txt")),
            "payloadOxum": info["Payload-Oxum"]}


def verify(path):
    reader = BagReader(path)
    try:
        return _verify_reader(reader)
    finally:
        reader.close()


def receive(source, output):
    output = Path(output).absolute()
    reader = BagReader(source)
    stage = None
    try:
        receipt = _verify_reader(reader)
        if output.exists():
            existing = verify(output)
            if existing["manifestSha256"] != receipt["manifestSha256"] or existing["identity"] != receipt["identity"]:
                raise PreservationError("Existing receiving directory contains a different transfer")
            return {**existing, "path": str(output), "reused": True}
        output.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".research-receive-", dir=output.parent))
        for name in reader.names:
            write_new(stage / name, reader.read(name))
        received = verify(stage)
        if received != receipt:
            raise PreservationError("Received bag differs from the verified source")
        sync_tree(stage)
        os.rename(stage, output)
        stage = None
        fsync_dir(output.parent)
        return {**received, "path": str(output), "reused": False}
    finally:
        reader.close()
        if stage:
            shutil.rmtree(stage)


def compare(previous, current):
    readers = [BagReader(previous), BagReader(current)]
    try:
        receipts = [_verify_reader(reader) for reader in readers]
        rows = [{row["identifier"]: row for row in reader.json(DOC + "mapping.json")["records"]}
                for reader in readers]
        old, new = rows
        identifiers = sorted(set(old) | set(new))
        changes = []
        for identifier in identifiers:
            before, after = old.get(identifier), new.get(identifier)
            status = []
            if before is None:
                status.append("SOURCE_ADDED")
            elif after is None:
                status.append("SOURCE_ABSENT")
            else:
                if before["source"]["recordSha256"] != after["source"]["recordSha256"]:
                    status.append("SOURCE_RECORD_CHANGED")
                if before["include"] != after["include"]:
                    status.append("INCLUDED" if after["include"] else "EXCLUDED")
                if before["reviewedDc"] != after["reviewedDc"]:
                    status.append("DESCRIPTIVE_METADATA_CHANGED")
                if before.get("decision") != after.get("decision"):
                    status.append("REVIEW_CHANGED")
            if status:
                changes.append({"identifier": identifier, "changes": status,
                                "before": before, "after": after})
        return {"schema": SCHEMA + ".comparison",
                "previous": receipts[0]["identity"], "current": receipts[1]["identity"],
                "summary": {"previousRecords": len(old), "currentRecords": len(new), "changedRecords": len(changes),
                    "sourceAdded": sum("SOURCE_ADDED" in row["changes"] for row in changes),
                    "sourceAbsent": sum("SOURCE_ABSENT" in row["changes"] for row in changes),
                    "sourceChanged": sum("SOURCE_RECORD_CHANGED" in row["changes"] for row in changes),
                    "metadataChanged": sum("DESCRIPTIVE_METADATA_CHANGED" in row["changes"] for row in changes)},
                "changes": changes,
                "receivingNote": "Source absence and review exclusion identify transfer differences. The receiving institution chooses its preservation and retention action."}
    finally:
        for reader in readers:
            reader.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("init", help="Freeze an original completed research export")
    p.add_argument("--source", required=True); p.add_argument("--prefix", default="")
    p.add_argument("--workspace", required=True); p.add_argument("--organization", default="")
    p.add_argument("--contact", default="")
    for name in ("show", "review-template"):
        p = sub.add_parser(name); p.add_argument("--workspace", required=True)
    p = sub.add_parser("review-save", help="Save corrections and exclusions at the expected revision")
    p.add_argument("--workspace", required=True); p.add_argument("--input", required=True)
    p.add_argument("--expected-revision", type=int, required=True)
    p = sub.add_parser("build", help="Create a complete reviewed BagIt transfer")
    p.add_argument("--workspace", required=True); p.add_argument("--output", required=True)
    p.add_argument("--expected-revision", type=int, required=True); p.add_argument("--zip", action="store_true")
    p = sub.add_parser("verify"); p.add_argument("--source", required=True)
    p = sub.add_parser("receive"); p.add_argument("--source", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("compare"); p.add_argument("--previous", required=True); p.add_argument("--current", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            result = initialize(args.source, args.workspace, args.prefix,
                                organization=args.organization, contact=args.contact)
        elif args.command in {"show", "review-template"}:
            result = show(args.workspace)
            if args.command == "review-template":
                result = result["review"]
        elif args.command == "review-save":
            result = save_review(args.workspace, parse_json(Path(args.input).read_bytes()), args.expected_revision)
        elif args.command == "build":
            result = build(args.workspace, args.output, args.expected_revision, zipped=args.zip)
        elif args.command == "verify":
            result = verify(args.source)
        elif args.command == "receive":
            result = receive(args.source, args.output)
        else:
            result = compare(args.previous, args.current)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (PreservationError, ValueError, KeyError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
