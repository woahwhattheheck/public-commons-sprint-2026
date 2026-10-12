#!/usr/bin/env python3
"""A retained OpenAlex export -> OAI-PMH 2.0 feed for a CIIM source connector.

Python 3.11+; standard library only. Publishing is a local operator action.
HTTP is read-only. Native research source pages are verified, never fetched.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import hmac
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse, urlencode
import xml.etree.ElementTree as ET
import zipfile

OAI = "http://www.openarchives.org/OAI/2.0/"
DC = "http://purl.org/dc/elements/1.1/"
OAI_DC = "http://www.openarchives.org/OAI/2.0/oai_dc/"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
PROV = "https://tokenjunkielabs.com/ns/ciim-feed-provenance/1"
METADATA_LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
for prefix, uri in [("", OAI), ("oai_dc", OAI_DC), ("dc", DC), ("xsi", XSI), ("feed", PROV)]:
    ET.register_namespace(prefix, uri)
SCHEMA_VERSION = "tjl.ciim-oai-feed.v1"
PREPARED_VERSION = "tjl.ciim-feed-prepared.v1"
SOURCE_SCHEMA = "stellar-forge.research-export.v1"
VERBS = {"Identify", "ListMetadataFormats", "ListSets", "GetRecord", "ListIdentifiers", "ListRecords"}
IDENTIFIER = re.compile(r"https://openalex\.org/W[1-9][0-9]*\Z")
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?\Z")

class FeedError(ValueError):
    pass

class ProtocolError(ValueError):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

# Native research queries use a finite key vocabulary and Node localeCompare
# ordering. Keep this separate from the publisher's byte-sorted canonical form.
# Order reproduced from original research/workspace.mjs PARAMETERS + cursor.
_NATIVE_PARAMETER_ORDER = (
    "corpus", "cursor", "filter", "per_page", "search", "search.exact",
    "search.title", "search.title_abstract_keywords",
    "search.title_abstract_keywords.exact", "search.title_and_abstract",
    "search.title_and_abstract.exact", "search.title.exact", "select", "sort",
)

def native_contract(value):
    if not isinstance(value, dict) or set(value) not in (
        {"entity", "parameters"}, {"entity", "label", "parameters"}
    ):
        raise FeedError("Unexpected original query/request fields")
    parameters = value["parameters"]
    is_query = "label" in value
    allowed = set(_NATIVE_PARAMETER_ORDER) - ({"cursor"} if is_query else set())
    if (not isinstance(parameters, dict) or not set(parameters) <= allowed
        or any(not isinstance(v, str) for v in parameters.values())
        or not isinstance(value["entity"], str)
        or (is_query and not isinstance(value["label"], str))):
        raise FeedError("Unexpected original query/request parameter types")
    ordered = {"entity": value["entity"]}
    if is_query:
        ordered["label"] = value["label"]
    ordered["parameters"] = {k: parameters[k] for k in _NATIVE_PARAMETER_ORDER if k in parameters}
    # JSON.stringify escapes unpaired UTF-16 surrogates. Valid Unicode remains
    # UTF-8, matching native JSON bytes without a runtime ICU dependency.
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "backslashreplace")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def jread(path):
    return json.loads(Path(path).read_bytes())

def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name("." + path.name + "." + secrets.token_hex(8))
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        dfd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()

def clean(value):
    if not isinstance(value, str):
        return None
    if any(not (c in "\t\n\r" or 0x20 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF) for c in value):
        raise FeedError("A mapped source string contains an invalid XML 1.0 character")
    return value.strip() or None

def unique(values):
    return list(dict.fromkeys(v for v in values if v))

def map_work(work, source):
    identifier = work.get("id")
    if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
        raise FeedError("Each work must have its original canonical OpenAlex work URI")
    title = clean(work.get("title")) or clean(work.get("display_name"))
    if not title:
        raise FeedError("Required title is missing for " + identifier)
    authors = work.get("authorships") or []
    primary = work.get("primary_location") or {}
    venue = primary.get("source") or {}
    dc = {"title": [title], "identifier": [identifier]}
    def put(field, values):
        found = unique(clean(v) for v in values)
        if found:
            dc[field] = found
    put("identifier", [identifier, work.get("doi"), primary.get("landing_page_url")])
    put("creator", [(a.get("author") or {}).get("display_name") or a.get("raw_author_name") for a in authors])
    put("contributor", [i.get("display_name") for a in authors for i in a.get("institutions") or []])
    put("subject", [k.get("display_name") for k in (work.get("keywords") or [])])
    put("date", [work.get("publication_date")])
    put("type", [work.get("type")])
    put("language", [work.get("language")])
    put("source", [venue.get("display_name")])
    put("relation", [(a.get("author") or {}).get("id") for a in authors] +
        [i.get("id") for a in authors for i in a.get("institutions") or []])
    # Resource-copy rights and metadata rights are deliberately separate fields.
    put("rights", [primary.get("license_id") or primary.get("license")])
    issues = []
    for field in ["creator", "date", "language", "rights"]:
        if field not in dc:
            issues.append({"field": field, "state": "ABSENT_IN_SOURCE"})
    if work.get("is_retracted") is True:
        issues.append({"field": "is_retracted", "state": "SOURCE_FLAG", "value": True})
    return {"identifier": identifier, "dc": dc, "source": source, "issues": issues}

class ExportSource:
    """Read native export members without extracting an archive."""
    def __init__(self, path, prefix):
        self.path = Path(path)
        self.prefix = prefix.strip("/")
        self.archive = zipfile.ZipFile(path) if self.path.is_file() else None
        if self.archive:
            names = self.archive.namelist()
            if len(names) != len(set(names)):
                raise FeedError("Duplicate archive member names are not accepted")
        self.manifest_bytes = self.read("manifest.json", verify=False)
        self.manifest = json.loads(self.manifest_bytes)
        if self.manifest.get("schema") != SOURCE_SCHEMA:
            raise FeedError("Expected the original native research-export.v1 manifest")

    def close(self):
        if self.archive:
            self.archive.close()

    def read(self, name, verify=True):
        logical = PurePosixPath(name)
        if logical.is_absolute() or ".." in logical.parts:
            raise FeedError("Export paths must be relative members")
        relative = (self.prefix + "/" if self.prefix else "") + str(logical)
        if self.archive:
            info = self.archive.getinfo(relative)
            if info.file_size > 64 * 1024 * 1024:
                raise FeedError("An individual source member exceeds the intake limit")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise FeedError("Source archive symlinks are not accepted")
            data = self.archive.read(info)
        else:
            root = (self.path / self.prefix).resolve()
            path = root / logical
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise FeedError("Source path escapes its export")
            if path.stat().st_size > 64 * 1024 * 1024:
                raise FeedError("An individual source member exceeds the intake limit")
            data = path.read_bytes()
        if verify:
            descriptor = self.manifest.get("files", {}).get(name)
            if not descriptor or len(data) != descriptor.get("bytes") or sha(data) != descriptor.get("sha256"):
                raise FeedError("Original member bytes do not match their native manifest: " + name)
        return data

    def json(self, name):
        return json.loads(self.read(name))

def prepare(source_path, prefix=""):
    src = ExportSource(source_path, prefix)
    try:
        edition, query, coverage = (src.json(n) for n in ("edition.json", "query.json", "coverage.json"))
        query_sha = src.manifest.get("querySha256")
        query_contract = {"label": query.get("label"), "entity": query.get("entity"), "parameters": query.get("parameters")}
        if (query.get("entity") != "works" or query.get("sha256") != query_sha
            or sha(native_contract(query_contract)) != query_sha or edition.get("querySha256") != query_sha
            or src.manifest.get("editionId") != edition.get("id")
            or edition.get("queryId") != query.get("id")
            or edition.get("queryRevision") != query.get("revision")):
            raise FeedError("Original query, revision, edition and manifest identity must agree")
        if coverage.get("state") != "COMPLETE" or coverage.get("nextCursor") is not None:
            raise FeedError("Publishing requires the completed original source edition")
        files = src.manifest["files"]
        page_names = sorted(n for n in files if re.fullmatch(r"pages/[0-9]{8}/page\.json", n))
        if len(page_names) != coverage.get("pages"):
            raise FeedError("Retained source page count does not match coverage")
        records, page_sources, received, prior_cursor = {}, [], 0, "*"
        for number, page_name in enumerate(page_names, 1):
            page = src.json(page_name)
            stem = page_name.rsplit("/", 1)[0]
            body = src.read(stem + "/response.json")
            request = src.json(stem + "/request.json")
            response = json.loads(body)
            if page.get("index") != number or page.get("querySha256") != query_sha or page.get("editionId") != edition["id"]:
                raise FeedError("Retained source page identity changed")
            if page.get("sha256") != sha(body) or page.get("bytes") != len(body):
                raise FeedError("Retained response descriptor does not match the original bytes")
            expected_request = {"entity": query["entity"], "parameters": {**query["parameters"], "cursor": prior_cursor}}
            if (request != page.get("request") or request != expected_request
                or sha(native_contract(request)) != page.get("requestSha256")):
                raise FeedError("Original query parameters, request digest or cursor chain changed")
            if request.get("entity") != "works":
                raise FeedError("Only original works responses can populate this feed")
            if any(str(k).lower() in {"api_key", "authorization", "access_token"} for k in request.get("parameters", {})):
                raise FeedError("The public feed intake cannot contain provider credentials")
            results = response.get("results")
            if not isinstance(results, list) or len(results) != page.get("records"):
                raise FeedError("Original response record count changed")
            if (response.get("meta") or {}).get("count") != page.get("totalReported"):
                raise FeedError("Original provider count differs from its retained page descriptor")
            next_cursor = (response.get("meta") or {}).get("next_cursor")
            if next_cursor != page.get("nextCursor"):
                raise FeedError("Response cursor does not match the native page")
            if number < len(page_names) and next_cursor is None:
                raise FeedError("Terminal cursor appeared before the final retained page")
            if number == len(page_names) and next_cursor is not None:
                raise FeedError("Final retained page is not terminal")
            source = {
                "editionId": edition["id"], "querySha256": query_sha,
                "manifestSha256": sha(src.manifest_bytes), "page": number,
                "pageSha256": sha(body), "requestSha256": page.get("requestSha256"),
                "url": (page.get("source") or {}).get("url"),
                "retrievedAt": (page.get("source") or {}).get("retrievedAt"),
                "metadataLicense": METADATA_LICENSE,
            }
            page_sources.append(source)
            for work in results:
                item = map_work(work, {**source, "recordSha256": sha(canonical(work))})
                previous = records.get(item["identifier"])
                if previous and previous["source"]["recordSha256"] != item["source"]["recordSha256"]:
                    raise FeedError("A duplicate work ID has conflicting source versions")
                records.setdefault(item["identifier"], item)
            received += len(results)
            prior_cursor = next_cursor
        if received != coverage.get("recordsReceived"):
            raise FeedError("Received record count differs from native coverage")
        binding = {
            "nativeSchema": SOURCE_SCHEMA, "editionId": edition["id"],
            "queryId": query["id"], "querySha256": query_sha,
            "manifestSha256": sha(src.manifest_bytes), "coverage": coverage,
            "pages": page_sources, "metadataLicense": METADATA_LICENSE,
        }
        return {"schema": PREPARED_VERSION, "binding": binding,
            "records": [records[k] for k in sorted(records)],
            "summary": {"records": len(records), "sourceOccurrences": received,
                "pages": len(page_names), "fieldIssues": sum(len(r["issues"]) for r in records.values())}}
    finally:
        src.close()

class Repository:
    def __init__(self, directory):
        self.root = Path(directory).resolve()
        self.path = self.root / "feed.sqlite3"
        if not self.path.is_file() or self.path.is_symlink():
            raise FeedError("Initialize the exact feed workspace before use")
        with self.connect() as db:
            self.config = json.loads(db.execute("SELECT value FROM meta WHERE key='config'").fetchone()[0])
            self.secret = bytes.fromhex(db.execute("SELECT value FROM meta WHERE key='token_secret'").fetchone()[0])

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @classmethod
    def initialize(cls, directory, config):
        root = Path(directory).resolve()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = root / "feed.sqlite3"
        if target.exists():
            existing = cls(root)
            if existing.config != config:
                raise FeedError("This existing feed has a different configuration")
            return existing
        fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        try:
            with sqlite3.connect(target) as db:
                db.executescript("""
                    PRAGMA journal_mode=DELETE;
                    PRAGMA synchronous=FULL;
                    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                    CREATE TABLE revisions(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,
                        kind TEXT NOT NULL,binding TEXT NOT NULL,summary TEXT NOT NULL);
                    CREATE TABLE versions(identifier TEXT NOT NULL,revision INTEGER NOT NULL
                        REFERENCES revisions(id),datestamp TEXT NOT NULL,deleted INTEGER NOT NULL,
                        record TEXT,payload_sha256 TEXT NOT NULL,
                        PRIMARY KEY(identifier,revision));
                    CREATE INDEX version_revision ON versions(revision,identifier);
                """)
                db.executemany("INSERT INTO meta VALUES (?,?)", [
                    ("schema", SCHEMA_VERSION), ("config", canonical(config).decode()),
                    ("token_secret", secrets.token_hex(32))])
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return cls(root)

    @staticmethod
    def revision(db):
        return db.execute("SELECT COALESCE(MAX(id),0) FROM revisions").fetchone()[0]

    def current_revision(self):
        with self.connect() as db:
            return self.revision(db)

    @staticmethod
    def snapshot(db, revision, lower=None, upper=None):
        sql = """WITH latest AS (
            SELECT identifier,MAX(revision) AS revision FROM versions WHERE revision<=? GROUP BY identifier
        ) SELECT v.* FROM versions v JOIN latest l ON v.identifier=l.identifier AND v.revision=l.revision
        WHERE (? IS NULL OR v.datestamp>=?) AND (? IS NULL OR v.datestamp<=?) ORDER BY v.identifier"""
        return db.execute(sql, (revision, lower, lower, upper, upper)).fetchall()

    def publish(self, prepared, expected, restore_ids=()):
        if prepared.get("schema") != PREPARED_VERSION:
            raise FeedError("Expected the complete prepared native-source contract")
        binding = prepared["binding"]
        if binding.get("coverage", {}).get("state") != "COMPLETE":
            raise FeedError("The source edition is incomplete")
        rows = prepared["records"]
        if not rows or len({r["identifier"] for r in rows}) != len(rows):
            raise FeedError("Prepared records must be nonempty and uniquely identified")
        for row in rows:
            if not IDENTIFIER.fullmatch(row["identifier"]) or not row["dc"].get("title"):
                raise FeedError("Prepared record identity or required title is invalid")
            if row["source"]["querySha256"] != binding["querySha256"]:
                raise FeedError("A prepared record belongs to another source query")
        restore_ids = set(restore_ids)
        if not restore_ids <= {r["identifier"] for r in rows}:
            raise FeedError("Explicit restoration requires the original record in this prepared source")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.revision(db)
            if current != expected:
                raise FeedError("The feed changed; reopen its current revision before publishing")
            previous = {v["identifier"]: v for v in self.snapshot(db, current)}
            changes, unchanged, kept_withdrawn = [], 0, []
            for record in rows:
                payload = canonical(record).decode()
                fingerprint = sha(payload.encode())
                old = previous.get(record["identifier"])
                if old and old["deleted"] and record["identifier"] not in restore_ids:
                    kept_withdrawn.append(record["identifier"])
                    continue
                if old and not old["deleted"] and old["payload_sha256"] == fingerprint:
                    unchanged += 1
                else:
                    changes.append((record["identifier"], payload, fingerprint))
            incoming = {r["identifier"] for r in rows}
            absent = [k for k, v in previous.items() if k not in incoming and not v["deleted"]]
            if not changes:
                return {"revision": current, "changed": 0, "unchanged": unchanged,
                        "absentNotWithdrawn": absent, "keptWithdrawn": kept_withdrawn, "reused": True}
            revision, stamp = current + 1, utc()
            summary = {"changed": len(changes), "unchanged": unchanged,
                       "absentNotWithdrawn": absent, "keptWithdrawn": kept_withdrawn,
                       "explicitRestorations": sorted(restore_ids), "sourceRecords": len(rows)}
            db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)",
                (revision, stamp, "SOURCE_PUBLICATION", canonical(binding).decode(), canonical(summary).decode()))
            db.executemany("INSERT INTO versions VALUES(?,?,?,?,?,?)",
                [(identifier, revision, stamp, 0, payload, fingerprint) for identifier, payload, fingerprint in changes])
            return {"revision": revision, "datestamp": stamp, **summary, "reused": False}

    def withdraw(self, identifier, reason, expected):
        if not reason.strip():
            raise FeedError("A withdrawal requires an explicit operator reason")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = self.revision(db)
            if current != expected:
                raise FeedError("The feed changed; reopen its current revision before withdrawing")
            row = db.execute("SELECT * FROM versions WHERE identifier=? ORDER BY revision DESC LIMIT 1", (identifier,)).fetchone()
            if not row:
                raise FeedError("Cannot withdraw an unknown source record")
            if row["deleted"]:
                return {"revision": current, "reused": True, "identifier": identifier}
            revision, stamp = current + 1, utc()
            binding = {"identifier": identifier, "reason": reason, "previousRecordSha256": row["payload_sha256"]}
            db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)",
                (revision, stamp, "OPERATOR_WITHDRAWAL", canonical(binding).decode(), '{"withdrawn":1}'))
            db.execute("INSERT INTO versions VALUES(?,?,?,?,?,?)",
                (identifier, revision, stamp, 1, None, sha(canonical(binding))))
            return {"revision": revision, "datestamp": stamp, "identifier": identifier, "reused": False}

    def status(self):
        with self.connect() as db:
            revision = self.revision(db)
            rows = self.snapshot(db, revision)
            history = [dict(r) for r in db.execute("SELECT * FROM revisions ORDER BY id")]
            for row in history:
                row["binding"], row["summary"] = json.loads(row["binding"]), json.loads(row["summary"])
            return {"schema": SCHEMA_VERSION, "revision": revision, "config": self.config,
                    "records": sum(not r["deleted"] for r in rows),
                    "withdrawn": sum(r["deleted"] for r in rows), "history": history}

    def token(self, payload):
        body = base64.urlsafe_b64encode(canonical(payload)).rstrip(b"=")
        return (body + b"." + hmac.new(self.secret, body, hashlib.sha256).hexdigest().encode()).decode()

    def untoken(self, text, verb):
        try:
            body, signature = text.encode().split(b".")
            if not hmac.compare_digest(hmac.new(self.secret, body, hashlib.sha256).hexdigest().encode(), signature):
                raise ValueError()
            payload = json.loads(base64.urlsafe_b64decode(body + b"=" * (-len(body) % 4)))
            if payload["verb"] != verb or payload["expires"] < int(time.time()):
                raise ValueError()
            if not isinstance(payload["revision"], int) or not isinstance(payload["offset"], int) or payload["offset"] < 1:
                raise ValueError()
            return payload
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise ProtocolError("badResumptionToken", "This continuation does not belong to this retained harvest")

    def backup(self, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if destination.exists():
            raise FeedError("Choose a new backup file")
        fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
        return {"file": str(destination), "bytes": destination.stat().st_size, "sha256": sha(destination.read_bytes())}

def node(parent, name, value=None, attrs=None, namespace=OAI):
    child = ET.SubElement(parent, "{" + namespace + "}" + name, attrs or {})
    if value is not None:
        child.text = str(value)
    return child

def date_bounds(params):
    lower, upper = params.get("from"), params.get("until")
    if lower and upper and len(lower) != len(upper):
        raise ProtocolError("badArgument", "from and until must use the same supported granularity")
    converted = []
    for value, end in [(lower, False), (upper, True)]:
        if value is None:
            converted.append(None)
            continue
        if not STAMP.fullmatch(value):
            raise ProtocolError("badArgument", "Use a UTC date or UTC second-granularity timestamp")
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d" if len(value) == 10 else "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            raise ProtocolError("badArgument", "The selective-harvest date is invalid")
        converted.append(parsed.strftime("%Y-%m-%d") + ("T23:59:59Z" if end else "T00:00:00Z") if len(value) == 10 else value)
    if converted[0] and converted[1] and converted[0] > converted[1]:
        raise ProtocolError("badArgument", "from must not be after until")
    return converted

def header(parent, row, set_spec):
    h = node(parent, "header", attrs={"status": "deleted"} if row["deleted"] else {})
    node(h, "identifier", row["identifier"])
    node(h, "datestamp", row["datestamp"])
    node(h, "setSpec", set_spec)
    return h

def record_xml(parent, row, config):
    result = node(parent, "record")
    header(result, row, config["setSpec"])
    if row["deleted"]:
        return result
    record = json.loads(row["record"])
    metadata = node(result, "metadata")
    dc = node(metadata, "dc", attrs={
        "{" + XSI + "}schemaLocation": OAI_DC + " http://www.openarchives.org/OAI/2.0/oai_dc.xsd"
    }, namespace=OAI_DC)
    for field, values in record["dc"].items():
        for value in values:
            node(dc, field, value, namespace=DC)
    about = node(result, "about")
    provenance = node(about, "provenance", attrs={
        "{" + XSI + "}schemaLocation": PROV + " " + config["baseURL"].rsplit("/", 1)[0] + "/provenance.xsd"
    }, namespace=PROV)
    for key in ("editionId", "querySha256", "manifestSha256", "page", "pageSha256",
                "requestSha256", "recordSha256", "url", "retrievedAt", "metadataLicense"):
        if record["source"].get(key) is not None:
            node(provenance, key, record["source"][key], namespace=PROV)
    return result

def protocol(repository, raw):
    config = repository.config
    root = ET.Element("{" + OAI + "}OAI-PMH", {
        "{" + XSI + "}schemaLocation": OAI + " http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd"})
    node(root, "responseDate", utc())
    request_node = node(root, "request", config["baseURL"])
    try:
        if len(raw.get("verb", [])) != 1 or raw["verb"][0] not in VERBS:
            raise ProtocolError("badVerb", "Choose exactly one of the six OAI-PMH 2.0 verbs")
        if any(len(values) != 1 or not values[0] for values in raw.values()):
            raise ProtocolError("badArgument", "Arguments must occur once and have a value")
        params = {key: values[0] for key, values in raw.items()}
        verb = params.get("verb")
        if verb not in VERBS:
            raise ProtocolError("badVerb", "Choose one of the six OAI-PMH 2.0 verbs")
        allowed = {
            "Identify": {"verb"}, "ListMetadataFormats": {"verb", "identifier"},
            "ListSets": {"verb", "resumptionToken"},
            "GetRecord": {"verb", "identifier", "metadataPrefix"},
            "ListIdentifiers": {"verb", "metadataPrefix", "from", "until", "set", "resumptionToken"},
            "ListRecords": {"verb", "metadataPrefix", "from", "until", "set", "resumptionToken"}}
        if set(params) - allowed[verb]:
            raise ProtocolError("badArgument", "An argument is not supported by this verb")
        if "resumptionToken" in params and set(params) != {"verb", "resumptionToken"}:
            raise ProtocolError("badArgument", "A resumptionToken is exclusive of the other selection arguments")
        if verb == "GetRecord" and not {"identifier", "metadataPrefix"} <= set(params):
            raise ProtocolError("badArgument", "GetRecord requires identifier and metadataPrefix")
        if verb in {"ListRecords", "ListIdentifiers"} and not ({"metadataPrefix", "resumptionToken"} & set(params)):
            raise ProtocolError("badArgument", "The initial list request requires metadataPrefix")
        if "metadataPrefix" in params and not re.fullmatch(r"[A-Za-z0-9_\-.!~*'()]+", params["metadataPrefix"]):
            raise ProtocolError("badArgument", "metadataPrefix has invalid protocol characters")
        if "set" in params and not re.fullmatch(r"[A-Za-z0-9_\-.!~*'()]+(?::[A-Za-z0-9_\-.!~*'()]+)*", params["set"]):
            raise ProtocolError("badArgument", "set has invalid protocol characters")
        try:
            for value in params.values():
                clean(value)
        except FeedError:
            raise ProtocolError("badArgument", "An argument contains invalid XML characters")
        request_node.attrib.update(params)
        with repository.connect() as db:
            revision = repository.revision(db)
            if verb == "Identify":
                v = node(root, verb)
                for name, value in [("repositoryName", config["repositoryName"]), ("baseURL", config["baseURL"]),
                    ("protocolVersion", "2.0"), ("adminEmail", config["adminEmail"])]:
                    node(v, name, value)
                earliest = db.execute("SELECT MIN(datestamp) FROM versions").fetchone()[0] or utc()
                for name, value in [("earliestDatestamp", earliest), ("deletedRecord", "persistent"), ("granularity", "YYYY-MM-DDThh:mm:ssZ")]:
                    node(v, name, value)
            elif verb == "ListMetadataFormats":
                if params.get("identifier") and not db.execute("SELECT 1 FROM versions WHERE identifier=? LIMIT 1", (params["identifier"],)).fetchone():
                    raise ProtocolError("idDoesNotExist", "The item identifier is not present in this repository")
                v = node(node(root, verb), "metadataFormat")
                for key, value in [("metadataPrefix", "oai_dc"), ("schema", "http://www.openarchives.org/OAI/2.0/oai_dc.xsd"), ("metadataNamespace", OAI_DC)]:
                    node(v, key, value)
            elif verb == "ListSets":
                if params.get("resumptionToken"):
                    raise ProtocolError("badResumptionToken", "This repository returns its complete set list in one response")
                v = node(node(root, verb), "set")
                node(v, "setSpec", config["setSpec"]); node(v, "setName", config["setName"])
            elif verb == "GetRecord":
                if params["metadataPrefix"] != "oai_dc":
                    raise ProtocolError("cannotDisseminateFormat", "This feed supports oai_dc")
                row = db.execute("SELECT * FROM versions WHERE identifier=? ORDER BY revision DESC LIMIT 1", (params["identifier"],)).fetchone()
                if not row:
                    raise ProtocolError("idDoesNotExist", "The item identifier is not present in this repository")
                record_xml(node(root, verb), row, config)
            else:
                if params.get("resumptionToken"):
                    selected = repository.untoken(params["resumptionToken"], verb)
                    revision, offset = selected["revision"], selected["offset"]
                    if revision > repository.revision(db):
                        raise ProtocolError("badResumptionToken", "The retained publication revision is unavailable")
                else:
                    if params["metadataPrefix"] != "oai_dc":
                        raise ProtocolError("cannotDisseminateFormat", "This feed supports oai_dc")
                    lower, upper = date_bounds(params)
                    if params.get("set") not in {None, config["setSpec"]}:
                        raise ProtocolError("noRecordsMatch", "No records match the requested set")
                    offset = 0
                    selected = {"verb": verb, "revision": revision, "offset": 0, "lower": lower, "upper": upper,
                        "set": params.get("set"), "expires": int(time.time()) + 86400}
                rows = repository.snapshot(db, revision, selected["lower"], selected["upper"])
                if not rows:
                    raise ProtocolError("noRecordsMatch", "No records match the selected harvest")
                if offset >= len(rows):
                    raise ProtocolError("badResumptionToken", "The continuation offset is outside the retained harvest")
                page = rows[offset:offset + config["pageSize"]]
                v = node(root, verb)
                for row in page:
                    (record_xml(v, row, config) if verb == "ListRecords" else header(v, row, config["setSpec"]))
                next_offset = offset + len(page)
                if next_offset < len(rows):
                    token = repository.token({**selected, "offset": next_offset})
                    expires = datetime.fromtimestamp(selected["expires"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    node(v, "resumptionToken", token, {"completeListSize": str(len(rows)), "cursor": str(offset), "expirationDate": expires})
                elif params.get("resumptionToken"):
                    node(v, "resumptionToken", "", {"completeListSize": str(len(rows)), "cursor": str(offset)})
    except ProtocolError as error:
        for child in list(root)[2:]:
            root.remove(child)
        if error.code in {"badArgument", "badVerb"}:
            request_node.attrib.clear()
        node(root, "error", error.message, {"code": error.code})
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)

PROVENANCE_XSD = ('<?xml version="1.0" encoding="UTF-8"?>'
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="' + PROV + '" elementFormDefault="qualified">'
    '<xs:element name="provenance"><xs:complexType><xs:sequence>' +
    ''.join('<xs:element name="' + key + '" type="xs:string" minOccurs="0"/>' for key in
        ("editionId","querySha256","manifestSha256","page","pageSha256","requestSha256","recordSha256","url","retrievedAt","metadataLicense")) +
    '</xs:sequence></xs:complexType></xs:element></xs:schema>').encode()

def make_server(repository, host, port):
    class Handler(BaseHTTPRequestHandler):
        server_version = "CIIMSourceFeed/1"
        def log_message(self, format, *args):
            pass
        def send_bytes(self, code, body, content_type):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/oai":
                if len(parsed.query) > 16384:
                    return self.send_bytes(414, b"Request too long\n", "text/plain; charset=utf-8")
                return self.respond(parsed.query)
            if parsed.path == "/provenance.xsd":
                return self.send_bytes(200, PROVENANCE_XSD, "application/xml; charset=utf-8")
            if parsed.path == "/":
                status = repository.status()
                escaped = html.escape(repository.config["repositoryName"])
                links = "".join('<li><a href="/oai?' + urlencode(p) + '">' + html.escape(label) + '</a></li>' for label, p in [
                    ("Repository identity", {"verb": "Identify"}), ("Available metadata formats", {"verb":"ListMetadataFormats"}),
                    ("Source set", {"verb":"ListSets"}), ("Harvest records", {"verb":"ListRecords","metadataPrefix":"oai_dc"}),
                    ("Harvest identifiers", {"verb":"ListIdentifiers","metadataPrefix":"oai_dc"})])
                page = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
                    '<title>' + escaped + '</title><style>body{font:16px system-ui;margin:48px auto;max-width:850px;padding:0 24px;color:#191919;background:#fff}'
                    'header{border-bottom:2px solid #222}h1{font-size:28px}a{color:#222}li{margin:16px 0}code{background:#eee;padding:3px}</style>'
                    '<header><p>Source integration · OAI-PMH 2.0</p><h1>' + escaped + '</h1></header>'
                    '<p>Publication revision <strong>' + str(status["revision"]) + '</strong> · ' + str(status["records"]) +
                    ' available records · ' + str(status["withdrawn"]) + ' retained withdrawals.</p><ul>' + links +
                    '</ul><p>The operator publishes reviewed source editions locally. Harvest continuations retain their original publication revision.</p>'
                    '<p>OpenAlex supplies the source metadata under CC0. Each work keeps its own reported location rights.</p></html>')
                return self.send_bytes(200, page.encode(), "text/html; charset=utf-8")
            self.send_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
        def do_POST(self):
            if urlparse(self.path).path != "/oai":
                return self.send_bytes(404, b"Not found\n", "text/plain; charset=utf-8")
            if self.headers.get_content_type() != "application/x-www-form-urlencoded":
                return self.send_bytes(415, b"Use form-encoded OAI-PMH arguments\n", "text/plain; charset=utf-8")
            try:
                length = int(self.headers.get("Content-Length", "-1"))
                if not 0 <= length <= 16384:
                    raise ValueError()
                body = self.rfile.read(length).decode("utf-8")
            except (ValueError, UnicodeError):
                return self.send_bytes(400, b"Invalid form body\n", "text/plain; charset=utf-8")
            self.respond(body)
        def respond(self, query):
            try:
                args = parse_qs(query, keep_blank_values=True, strict_parsing=False, max_num_fields=30)
                body = protocol(repository, args)
                self.send_bytes(200, body, "text/xml; charset=utf-8")
            except ValueError:
                self.send_bytes(400, b"Invalid request encoding\n", "text/plain; charset=utf-8")
            except (sqlite3.Error, OSError):
                self.send_bytes(503, b"Retained feed temporarily unavailable; repeat the same request\n", "text/plain; charset=utf-8")
    return ThreadingHTTPServer((host, port), Handler)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--source", required=True); p.add_argument("--prefix", default=""); p.add_argument("--out", required=True)
    p = sub.add_parser("init"); p.add_argument("--workspace", required=True); p.add_argument("--base-url", required=True)
    p.add_argument("--name", required=True); p.add_argument("--admin-email", required=True); p.add_argument("--page-size", type=int, default=50)
    p.add_argument("--set-spec", default="openalex"); p.add_argument("--set-name", default="OpenAlex works")
    p = sub.add_parser("publish"); p.add_argument("--workspace", required=True); p.add_argument("--prepared", required=True); p.add_argument("--expected-revision", required=True, type=int)
    p.add_argument("--restore", action="append", default=[], help="Explicitly restore this previously withdrawn original identifier")
    p = sub.add_parser("withdraw"); p.add_argument("--workspace", required=True); p.add_argument("--identifier", required=True); p.add_argument("--reason", required=True); p.add_argument("--expected-revision", required=True, type=int)
    p = sub.add_parser("status"); p.add_argument("--workspace", required=True)
    p = sub.add_parser("backup"); p.add_argument("--workspace", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("serve"); p.add_argument("--workspace", required=True); p.add_argument("--bind", default="127.0.0.1"); p.add_argument("--port", type=int, default=8471)
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare(args.source, args.prefix); atomic_json(args.out, result)
        print(json.dumps({"prepared": args.out, **result["summary"], "binding": result["binding"]}))
    elif args.command == "init":
        parsed = urlparse(args.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path != "/oai" or parsed.query or parsed.fragment or parsed.username:
            raise FeedError("base-url must be the canonical HTTP(S) /oai endpoint")
        if not 1 <= args.page_size <= 1000 or not re.fullmatch(r"[A-Za-z0-9_!~*'().-]+", args.set_spec) or "@" not in args.admin_email:
            raise FeedError("Invalid page size, set spec or admin email")
        config = {"repositoryName": args.name, "baseURL": args.base_url, "adminEmail": args.admin_email,
                  "pageSize": args.page_size, "setSpec": args.set_spec, "setName": args.set_name}
        result = Repository.initialize(args.workspace, config).status()
        print(json.dumps(result))
    else:
        repository = Repository(args.workspace)
        if args.command == "publish":
            result = repository.publish(jread(args.prepared), args.expected_revision, args.restore)
        elif args.command == "withdraw":
            result = repository.withdraw(args.identifier, args.reason, args.expected_revision)
        elif args.command == "status":
            result = repository.status()
        elif args.command == "backup":
            result = repository.backup(args.out)
        else:
            server = make_server(repository, args.bind, args.port)
            print(json.dumps({"listening": server.server_address, "baseURL": repository.config["baseURL"], "revision": repository.current_revision()}), flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
            return
        print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (FeedError, OSError, sqlite3.Error, KeyError, json.JSONDecodeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}))
        raise SystemExit(1)

