#!/usr/bin/env python3
"""Aviary migration workspace, reviewed mappings, native packages and receiving.

Uses the Python standard library. Provider transport is in aviary_client.py.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import fcntl
import hashlib
import html
import io
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import uuid
import zipfile

VERSION = "1.0.0"
CONTRACT = {
    "repository": "https://github.com/WeAreAVP/aviary-api-scripts",
    "commit": "9f189144f6434e6561696983edce17494aa66dd0",
    "bulkImporterBlob": "e8c612495fb851b1e756a32143c032feaa5d264d",
    "mediaImporterBlob": "20809b4ebd4024586a47e1a470d595d83fa48916",
    "transcriptExporterBlob": "0b57ecff919740a17fbdf71ac304f981221ebc7b",
    "guide": "https://coda.aviaryplatform.com/bulk-importing-248",
    "apiGuide": "https://coda.aviaryplatform.com/aviary-api-14",
    "apiSpecification": {
        "url": "https://www.aviaryplatform.com/aviary-api.json",
        "openapi": "3.0.0", "version": "1.0.0",
        "retrievedAt": "2026-10-12T09:20:11.412169+00:00",
        "bytes": 200348,
        "sha256": "1bf29e93ede6bc7aa755be25603e1fed4ddb899dac1964f4f63eaaca930c1291",
    },
}
KINDS = ("resources", "media", "transcripts", "indexes", "supplemental")
RESOURCE_METADATA = ("Description", "Date", "Agent", "Coverage", "Language",
    "Identifier", "Format", "Type", "Subject", "Relation", "Source", "Publisher",
    "Rights Statement", "Keyword", "Source Metadata URI", "Preferred Citation",
    "Location", "Alt Date", "Call Sign")
MEDIA_METADATA = ("Publisher", "Source", "Coverage", "Language", "Format",
    "Identifier", "Relation", "Subject", "Rights", "Description", "Date", "Type")
FIELDS = {
    "resources": ("aviary ID", "Resource User Key", "Title", "Public", "Featured",
                  "Custom Unique Identifier") + RESOURCE_METADATA,
    "media": ("aviary ID", "Resource User Key", "Media User Key", "Display Name",
              "Media Staging ID", "Path", "URL", "Embed Code", "Embed Source",
              "Target Domain", "Sequence #", "Public", "Media Thumbnail URL",
              "Media Thumbnail Path", "360 Video") + MEDIA_METADATA,
    "transcripts": ("aviary ID", "Media User Key", "Sequence #", "Language",
                    "Title", "Path", "Public", "Captions", "Ignore Title", "Description"),
    "indexes": ("aviary ID", "Media User Key", "Sequence #", "Language",
                "Title", "Path", "Public", "Description"),
    "supplemental": ("aviary ID", "Resource User Key", "Title", "Public",
                     "File Path", "Description"),
}
FILENAMES = {
    "resources": "Aviary-resource-csv-template.csv",
    "media": "Aviary-media-csv-template.csv",
    "transcripts": "Aviary-transcript-csv-template.csv",
    "indexes": "Aviary-index-csv-template.csv",
    "supplemental": "Aviary-supplemental-csv-template.csv",
}
EXTENSIONS = {
    "media": {".mp3", ".m4a", ".ogg", ".wav", ".wma", ".mp4", ".m4v",
              ".ogv", ".webm", ".wmv"},
    "transcripts": {".vtt", ".srt", ".txt", ".xml", ".json"},
    "indexes": {".vtt", ".xml"},
    "supplemental": {".jpg", ".jpeg", ".png", ".pdf"},
    "thumbnails": {".jpg", ".jpeg", ".png"},
}
KEY = re.compile(r"[1-9][0-9]{3}\Z")
ID = re.compile(r"[1-9][0-9]*\Z")
CHUNK = 256 * 1024
csv.field_size_limit(16 * 1024 * 1024)


class Problem(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self):
        return {"error": self.code, "message": str(self), "details": self.details}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def fingerprint(path):
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as source:
        while block := source.read(CHUNK):
            size += len(block)
            h.update(block)
    return {"bytes": size, "sha256": h.hexdigest()}


def relative(value):
    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        raise Problem("PATH", "Use a nonempty relative path with forward slashes.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise Problem("PATH", "Path must stay within the selected source.", value)
    return str(path)


def within(root, value):
    value = relative(value)
    root = Path(root).resolve()
    result = root.joinpath(*PurePosixPath(value).parts)
    current = root
    for component in PurePosixPath(value).parts:
        current = current / component
        if current.is_symlink():
            raise Problem("SYMLINK", "A source or workspace member is a symbolic link.", value)
    if not result.resolve().is_relative_to(root):
        raise Problem("PATH", "Path leaves the selected source.", value)
    return result


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_file(path, content, *, exclusive=False):
    """Publish a complete inode only after its bytes have reached the filesystem."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        if exclusive:
            os.link(temporary, path)
            os.unlink(temporary)
        else:
            if path.is_symlink():
                raise Problem("SYMLINK", "Refusing to replace a symbolic link.", str(path))
            os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value, **kwargs):
    write_file(path, encoded(value), **kwargs)


def read_json(path):
    with open(path, "r", encoding="utf-8") as source:
        return json.load(source)


@contextlib.contextmanager
def locked(workspace):
    root = Path(workspace).resolve()
    if not root.is_dir():
        raise Problem("WORKSPACE", "Workspace directory does not exist.", str(root))
    fd = os.open(root / "workspace.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Problem("BUSY", "Another operation is using this workspace.")
        yield root
    finally:
        os.close(fd)


def connect(workspace):
    path = Path(workspace) / "aviary.sqlite3"
    if not path.is_file() or path.is_symlink():
        raise Problem("WORKSPACE", "The Aviary workspace database is missing.")
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA synchronous=FULL")
    return db


def meta(db, key):
    row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    if row is None:
        raise Problem("WORKSPACE", "Workspace metadata is missing.", key)
    return json.loads(row["value"])


def mapping(db, revision=None):
    row = db.execute(
        "SELECT * FROM reviews ORDER BY revision DESC LIMIT 1" if revision is None
        else "SELECT * FROM reviews WHERE revision=?", () if revision is None else (revision,)
    ).fetchone()
    if row is None:
        raise Problem("REVISION", "Mapping revision does not exist.", revision)
    return {"revision": row["revision"], "created": row["created"],
            "document": json.loads(row["document"])}


def event(db, run_id, action, kind, data):
    db.execute("INSERT INTO events(run_id,action_key,kind,document,created) VALUES(?,?,?,?,?)",
               (run_id, action, kind, encoded(data).decode(), now()))


def inventory(root):
    root = Path(root).resolve()
    members = []
    for base, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            if (Path(base) / name).is_symlink():
                raise Problem("SYMLINK", "Source directory contains a symbolic link.", name)
        for name in files:
            path = Path(base) / name
            if not stat.S_ISREG(path.lstat().st_mode):
                raise Problem("FILE_TYPE", "Only regular source files are accepted.", str(path))
            rel = path.relative_to(root).as_posix()
            relative(rel)
            members.append({"path": rel, **fingerprint(path)})
    return sorted(members, key=lambda item: item["path"])


def read_csv(path):
    """Strict column accounting preserves malformed rows as actionable errors."""
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source, strict=True)
            raw_header = next(reader, None)
            if not raw_header:
                raise Problem("CSV_HEADER", "CSV has no header.", str(path))
            headers = [h.strip() for h in raw_header]
            if any(not h for h in headers) or len(set(headers)) != len(headers):
                raise Problem("CSV_HEADER", "CSV headers must be nonempty and unique.", headers)
            rows = []
            for row in reader:
                if not row or not any(value.strip() for value in row):
                    continue
                if len(row) != len(headers):
                    raise Problem("CSV_WIDTH",
                        f"CSV line {reader.line_num} has {len(row)} cells; expected {len(headers)}. "
                        "Quote values containing commas and save the corrected source.",
                        {"path": str(path), "line": reader.line_num,
                         "expected": len(headers), "actual": len(row), "values": row})
                rows.append({"line": reader.line_num, "values": dict(zip(headers, row))})
            return {"headers": headers, "rows": rows}
    except (UnicodeError, csv.Error) as exc:
        raise Problem("CSV_ENCODING", "CSV must be well-formed UTF-8: " + str(exc), str(path))


def default_mapping(root, manifest):
    names = {item["path"] for item in manifest["files"]}
    tables = {}
    for kind in KINDS:
        candidates = [value for value in (FILENAMES[kind], kind + ".csv") if value in names]
        if len(candidates) > 1:
            raise Problem("TABLE_SELECTION", "Select the intended CSV explicitly.", candidates)
        if candidates:
            table = read_csv(root / "source" / candidates[0])
            tables[kind] = {"path": candidates[0],
                "columns": {header: header for header in table["headers"]},
                "defaults": {}, "valueMaps": {}, "stripPathPrefix": ""}
    return {"schema": "stellar-forge.aviary-mapping.v1",
            "sourceManifestSha256": digest(manifest), "tables": tables,
            "keyMaps": {"resources": {}, "media": {}},
            "exclude": {}, "note": "Original column names selected."}


def initialize(source, workspace, supplied_mapping=None, label=None):
    source, root = Path(source).resolve(), Path(workspace).resolve()
    if not source.is_dir():
        raise Problem("SOURCE", "Select the directory containing the CSV files and assets.")
    if root == source or root.is_relative_to(source) or source.is_relative_to(root):
        raise Problem("PATH", "Source and workspace must be separate directory trees.")
    source_inventory = inventory(source)
    if not source_inventory:
        raise Problem("SOURCE", "The source directory is empty.")
    if root.exists():
        with locked(root), connect(root) as db:
            old = meta(db, "source")
            if old["files"] != source_inventory:
                raise Problem("SOURCE_CHANGED", "Existing workspace retains different source bytes.")
            return show(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    root.mkdir(mode=0o700)
    try:
        (root / "source").mkdir(mode=0o700)
        for item in source_inventory:
            old = within(source, item["path"])
            new = within(root / "source", item["path"])
            new.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with open(old, "rb") as incoming, open(new, "xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, CHUNK)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            os.chmod(new, 0o600)
            if fingerprint(new) != {k: item[k] for k in ("bytes", "sha256")}:
                raise Problem("SOURCE_CHANGED", "Source changed while it was retained.", item["path"])
        if inventory(source) != source_inventory:
            raise Problem("SOURCE_CHANGED", "Source inventory changed during initialization.")
        manifest = {"schema": "stellar-forge.aviary-source.v1", "label": source.name,
                    "files": source_inventory}
        write_json(root / "source-manifest.json", manifest, exclusive=True)
        db = sqlite3.connect(root / "aviary.sqlite3")
        db.executescript("""
        PRAGMA foreign_keys=ON;
        PRAGMA synchronous=FULL;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE reviews(revision INTEGER PRIMARY KEY,document TEXT NOT NULL,created TEXT NOT NULL);
        CREATE TABLE runs(id TEXT PRIMARY KEY,revision INTEGER NOT NULL REFERENCES reviews(revision),
            target TEXT NOT NULL,document TEXT NOT NULL,created TEXT NOT NULL);
        CREATE TABLE actions(run_id TEXT NOT NULL REFERENCES runs(id),action_key TEXT NOT NULL,
            state TEXT NOT NULL,request_sha TEXT NOT NULL,request TEXT NOT NULL,
            response TEXT,provider_id TEXT,error TEXT,updated TEXT NOT NULL,
            PRIMARY KEY(run_id,action_key));
        CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT,action_key TEXT,
            kind TEXT NOT NULL,document TEXT NOT NULL,created TEXT NOT NULL);
        CREATE INDEX events_run ON events(run_id,sequence);
        CREATE TABLE downloads(path TEXT PRIMARY KEY,document TEXT NOT NULL,created TEXT NOT NULL);
        """)
        values = {"identity": {"schema": "stellar-forge.aviary-workspace.v1",
                  "id": str(uuid.uuid4()), "label": label or source.name, "created": now(),
                  "version": VERSION, "sourceManifestSha256": digest(manifest)},
                  "source": manifest, "contract": CONTRACT}
        with db:
            db.executemany("INSERT INTO meta(key,value) VALUES(?,?)",
                           [(key, encoded(value).decode()) for key, value in values.items()])
            review = supplied_mapping or default_mapping(root, manifest)
            review = json.loads(json.dumps(review))
            review.setdefault("sourceManifestSha256", digest(manifest))
            validate_mapping(root, manifest, review)
            db.execute("INSERT INTO reviews VALUES(0,?,?)", (encoded(review).decode(), now()))
            event(db, None, None, "WORKSPACE_CREATED",
                  {"sourceFiles": len(source_inventory), "sourceManifestSha256": digest(manifest)})
        db.close()
        os.chmod(root / "aviary.sqlite3", 0o600)
        sync_dir(root)
        return show(root)
    except BaseException:
        shutil.rmtree(root)
        raise


def validate_mapping(root, manifest, review):
    if review.get("schema") != "stellar-forge.aviary-mapping.v1":
        raise Problem("SCHEMA", "Mapping schema must be stellar-forge.aviary-mapping.v1.")
    if review.get("sourceManifestSha256") != digest(manifest):
        raise Problem("SOURCE_BINDING", "Mapping belongs to a different source.")
    tables = review.get("tables")
    if not isinstance(tables, dict) or not tables:
        raise Problem("TABLE_SELECTION", "Select at least one source CSV table.")
    if set(tables) - set(KINDS):
        raise Problem("TABLE_SELECTION", "Unknown source table kind.", sorted(set(tables) - set(KINDS)))
    files = {item["path"] for item in manifest["files"]}
    for kind, selected in tables.items():
        if not isinstance(selected, dict) or selected.get("path") not in files:
            raise Problem("TABLE_SELECTION", "Table must name a retained source member.", kind)
        headers = read_csv(within(root / "source", selected["path"]))["headers"]
        columns = selected.get("columns", {})
        if not isinstance(columns, dict) or not all(
            isinstance(target, str) and target and isinstance(origin, str) and origin in headers
            for target, origin in columns.items()):
            raise Problem("MAPPING", "Each column mapping must name a retained source header.", kind)
        for field in ("defaults", "valueMaps"):
            if not isinstance(selected.get(field, {}), dict):
                raise Problem("MAPPING", field + " must be an object.", kind)
        if not all(isinstance(value, str) for value in selected.get("defaults", {}).values()):
            raise Problem("MAPPING", "Default values must be text.", kind)
        for target, replacements in selected.get("valueMaps", {}).items():
            if not isinstance(replacements, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in replacements.items()):
                raise Problem("MAPPING", "Value maps contain exact text-to-text substitutions.", target)
        ignored = selected.get("ignoredColumns", [])
        unused = set(headers) - set(columns.values()) - set(ignored)
        if unused:
            raise Problem("UNMAPPED_COLUMNS",
                "Map each original column or explicitly list it in ignoredColumns.", sorted(unused))
        if set(ignored) - set(headers):
            raise Problem("MAPPING", "Ignored columns must exist in the source.", kind)
        if kind not in ("resources", "media") and set(columns) - set(FIELDS[kind]):
            raise Problem("MAPPING", "Attachment columns must use Aviary field names.",
                          sorted(set(columns) - set(FIELDS[kind])))
    for kind in ("resources", "media"):
        selected = review.get("keyMaps", {}).get(kind, {})
        if not isinstance(selected, dict) or any(
            not isinstance(k, str) or not k or not isinstance(v, str) or not KEY.fullmatch(v)
            for k, v in selected.items()):
            raise Problem("KEY_MAP", "Assigned Aviary user keys must be four digits, 1000–9999.", kind)
        if len(set(selected.values())) != len(selected):
            raise Problem("KEY_MAP", "Assigned user keys must be unique.", kind)
    exclusions = review.get("exclude", {})
    if not isinstance(exclusions, dict):
        raise Problem("MAPPING", "Excluded records must be grouped by table.")
    for kind, entries in exclusions.items():
        if kind not in KINDS or not isinstance(entries, dict) or any(
            not isinstance(reason, str) or not reason.strip() for reason in entries.values()):
            raise Problem("MAPPING", "Each excluded row needs its original row key and reason.", kind)


def effective_values(kind, selected, original):
    values = {field: "" for field in FIELDS[kind]}
    values.update(selected.get("defaults", {}))
    values.update({target: original[origin].strip()
                   for target, origin in selected.get("columns", {}).items()})
    for field, replacements in selected.get("valueMaps", {}).items():
        values[field] = replacements.get(values.get(field, ""), values.get(field, ""))
    return values


def mapped_tables(root, review):
    tables = {kind: [] for kind in KINDS}
    for kind, selected in review["tables"].items():
        table = read_csv(within(root / "source", selected["path"]))
        for source_row in table["rows"]:
            original = source_row["values"]
            values = effective_values(kind, selected, original)
            raw_key = values.get("Resource User Key" if kind == "resources" else
                                "Media User Key" if kind == "media" else "", "")
            row_key = raw_key or str(source_row["line"])
            reason = review.get("exclude", {}).get(kind, {}).get(row_key)
            for field, key_kind in (("Resource User Key", "resources"), ("Media User Key", "media")):
                if field in values and values[field]:
                    values[field] = review.get("keyMaps", {}).get(key_kind, {}).get(values[field], values[field])
            tables[kind].append({"key": row_key, "source": {"path": selected["path"],
                "line": source_row["line"], "values": original}, "values": values,
                "included": reason is None, "exclusionReason": reason, "assets": {}})
    return tables


def preview(workspace, revision=None, supplied=None):
    root = Path(workspace).resolve()
    with connect(root) as db:
        manifest = meta(db, "source")
        current = mapping(db, revision)
        review = supplied if supplied is not None else current["document"]
        identity = meta(db, "identity")
    validate_mapping(root, manifest, review)
    tables = mapped_tables(root, review)
    files = {item["path"]: item for item in manifest["files"]}
    issues = []

    def issue(kind, row, code, message, field=None, level="error"):
        issues.append({"level": level, "table": kind, "key": row["key"],
                       "source": {"path": row["source"]["path"], "line": row["source"]["line"]},
                       "code": code, "message": message, "field": field})

    def boolean(kind, row, field, blank=True):
        value = row["values"].get(field, "").lower()
        if value not in ("yes", "no") and not (blank and not value):
            issue(kind, row, "BOOLEAN", "Enter yes or no" + (" or leave blank." if blank else "."), field)
        row["values"][field] = value

    def asset(kind, row, field, asset_kind):
        value = row["values"].get(field, "")
        if not value:
            return
        prefix = review["tables"][kind].get("stripPathPrefix", "")
        if prefix and value.startswith(prefix):
            value = value[len(prefix):].lstrip("/")
        elif value.startswith("/" + manifest["label"] + "/"):
            value = value[len(manifest["label"]) + 2:]
        try:
            value = relative(value)
            if value not in files:
                raise Problem("ASSET_MISSING", "File is not in the retained source.", value)
            if Path(value).suffix.lower() not in EXTENSIONS[asset_kind]:
                raise Problem("ASSET_FORMAT", "The file extension is not an accepted " + asset_kind + " format.", value)
            if files[value]["bytes"] <= 0:
                raise Problem("ASSET_EMPTY", "Upload assets must contain at least one byte.", value)
            if asset_kind == "media" and files[value]["bytes"] > 25_000_000_000:
                raise Problem("MEDIA_SIZE", "Media exceeds the provider's documented 25 GB file limit.", value)
            row["assets"][field] = {**files[value], "kind": asset_kind}
        except Problem as exc:
            issue(kind, row, exc.code, str(exc), field)

    resources, media = {}, {}
    for kind, key_field, result in (("resources", "Resource User Key", resources),
                                    ("media", "Media User Key", media)):
        for row in tables[kind]:
            if not row["included"]:
                continue
            value = row["values"][key_field]
            if not KEY.fullmatch(value):
                issue(kind, row, "USER_KEY", "Assign a four-digit user key from 1000 to 9999.", key_field)
            elif value in result:
                issue(kind, row, "DUPLICATE_KEY", "User key repeats another included row.", key_field)
            else:
                result[value] = row

    sequences = set()
    for kind in KINDS:
        for row in tables[kind]:
            if not row["included"]:
                continue
            values = row["values"]
            boolean(kind, row, "Public", blank=kind == "resources")
            if kind == "resources":
                if not values["Title"]:
                    issue(kind, row, "TITLE", "Resource title is required.", "Title")
                if values["aviary ID"]:
                    issue(kind, row, "RESOURCE_ID",
                          "Use the child table's aviary ID column to add content to an existing resource.", "aviary ID")
                boolean(kind, row, "Featured", blank=False)
                custom = values["Custom Unique Identifier"]
                if any(c in custom for c in "\\\"!*'();:@&=+$,/?%#[]"):
                    issue(kind, row, "CUSTOM_IDENTIFIER", "Custom identifier contains a character prohibited by Aviary.",
                          "Custom Unique Identifier")
                if not values["Rights Statement"]:
                    issue(kind, row, "RIGHTS_EMPTY", "No rights statement is present in this source row.",
                          "Rights Statement", "information")
                if values["Location"]:
                    issue(kind, row, "LOCATION_FIELD",
                          "The receiving collection must configure Location as geolocation metadata.",
                          "Location", "information")
                continue
            parent_kind = "media" if kind in ("transcripts", "indexes") else "resources"
            parent_field = "Media User Key" if parent_kind == "media" else "Resource User Key"
            local_key, existing = values.get(parent_field, ""), values.get("aviary ID", "")
            if bool(local_key) == bool(existing):
                issue(kind, row, "PARENT", "Enter exactly one parent user key or existing aviary ID.", parent_field)
            elif existing and not ID.fullmatch(existing):
                issue(kind, row, "PARENT_ID", "Existing Aviary parent ID must be a positive integer.", "aviary ID")
            elif local_key and local_key not in (media if parent_kind == "media" else resources):
                issue(kind, row, "PARENT_MISSING", "Parent user key does not identify an included row.", parent_field)
            row["parent"] = {"kind": parent_kind, "key": local_key, "providerId": existing}
            if kind in ("media", "transcripts", "indexes"):
                sequence = values["Sequence #"]
                if not ID.fullmatch(sequence):
                    issue(kind, row, "SEQUENCE", "Sequence # must be a positive integer.", "Sequence #")
                else:
                    sequence_key = (kind, local_key or "aviary:" + existing, int(sequence))
                    if sequence_key in sequences:
                        issue(kind, row, "DUPLICATE_SEQUENCE", "Sequence repeats another child of this parent.", "Sequence #")
                    sequences.add(sequence_key)
            if kind == "media":
                methods = [field for field in ("Path", "URL", "Embed Code", "Media Staging ID") if values[field]]
                if len(methods) != 1:
                    issue(kind, row, "MEDIA_SOURCE", "Select exactly one local path, URL, embed code or media staging ID.")
                if values["Media Staging ID"] and not ID.fullmatch(values["Media Staging ID"]):
                    issue(kind, row, "STAGING_ID", "Media staging ID must be a positive integer.", "Media Staging ID")
                if values["URL"]:
                    from urllib.parse import urlsplit
                    url = urlsplit(values["URL"])
                    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
                        issue(kind, row, "MEDIA_URL", "Enter an HTTP(S) media URL without embedded credentials.", "URL")
                if values["Embed Code"] and not values["Embed Source"]:
                    issue(kind, row, "EMBED_SOURCE", "Enter the embed source.", "Embed Source")
                boolean(kind, row, "360 Video")
                asset(kind, row, "Path", "media")
                asset(kind, row, "Media Thumbnail Path", "thumbnails")
                if values["Media Thumbnail Path"] and values["Media Thumbnail URL"]:
                    issue(kind, row, "THUMBNAIL", "Select one thumbnail path or thumbnail URL.")
                if values["360 Video"] == "yes" and values["Path"] and Path(values["Path"]).suffix.lower() != ".mp4":
                    issue(kind, row, "360_FORMAT", "Local 360 video must be MP4.", "Path")
                if not values["Rights"]:
                    issue(kind, row, "RIGHTS_EMPTY", "No media rights text is present.", "Rights", "information")
            elif kind in ("transcripts", "indexes"):
                if not values["Language"]:
                    issue(kind, row, "LANGUAGE", "Language is required.", "Language")
                if not values["Path"]:
                    issue(kind, row, "ASSET_MISSING", "Path is required.", "Path")
                asset(kind, row, "Path", kind)
                if kind == "transcripts":
                    boolean(kind, row, "Captions")
                    boolean(kind, row, "Ignore Title")
            else:
                if not values["File Path"]:
                    issue(kind, row, "ASSET_MISSING", "File Path is required.", "File Path")
                asset(kind, row, "File Path", "supplemental")
    excluded = {kind: len([r for r in rows if not r["included"]]) for kind, rows in tables.items()}
    counts = {kind: len(rows) - excluded[kind] for kind, rows in tables.items()}
    if not sum(counts.values()):
        issues.append({"level": "error", "table": None, "key": None, "code": "EMPTY",
                       "message": "Select at least one row.", "source": None, "field": None})
    return {"schema": "stellar-forge.aviary-preview.v1", "workspace": identity,
            "revision": current["revision"], "mappingSha256": digest(review),
            "sourceManifestSha256": digest(manifest), "counts": counts,
            "excluded": excluded, "tables": tables, "issues": issues,
            "ready": not any(item["level"] == "error" for item in issues)}


def save_mapping(workspace, document, expected_revision):
    with locked(workspace) as root, connect(root) as db:
        current = mapping(db)
        if current["revision"] != expected_revision:
            raise Problem("REVISION_CONFLICT", "Mapping changed. Reopen it before saving.",
                          {"expected": expected_revision, "actual": current["revision"]})
        validate_mapping(root, meta(db, "source"), document)
        if digest(document) == digest(current["document"]):
            return {"revision": current["revision"], "reused": True, "preview": preview(root)}
        revision = current["revision"] + 1
        with db:
            db.execute("INSERT INTO reviews VALUES(?,?,?)", (revision, encoded(document).decode(), now()))
            event(db, None, None, "MAPPING_SAVED",
                  {"revision": revision, "previousRevision": current["revision"],
                   "mappingSha256": digest(document)})
        return {"revision": revision, "reused": False, "preview": preview(root)}


def allocate_keys(workspace, expected_revision):
    with connect(workspace) as db:
        selected = mapping(db)
    if selected["revision"] != expected_revision:
        raise Problem("REVISION_CONFLICT", "Mapping changed. Reopen before assigning keys.")
    review = json.loads(json.dumps(selected["document"]))
    tables = mapped_tables(Path(workspace).resolve(), review)
    for kind, field in (("resources", "Resource User Key"), ("media", "Media User Key")):
        assignments = review.setdefault("keyMaps", {}).setdefault(kind, {})
        source_keys = [effective_values(kind, review["tables"][kind], row["source"]["values"])[field]
                       for row in tables[kind]] if kind in review["tables"] else []
        if any(not key for key in source_keys):
            raise Problem("USER_KEY", "Map a nonempty original identifier before assigning user keys.", kind)
        if len(set(source_keys)) != len(source_keys):
            raise Problem("DUPLICATE_KEY", "Original source identifiers are duplicated.", kind)
        used = set(assignments.values()) | {key for key in source_keys if KEY.fullmatch(key)}
        candidate = 1000
        for original in source_keys:
            if original in assignments or KEY.fullmatch(original):
                continue
            while str(candidate) in used and candidate <= 9999:
                candidate += 1
            if candidate > 9999:
                raise Problem("USER_KEY_CAPACITY", "This package exceeds Aviary's 9,000 four-digit user keys.", kind)
            assignments[original] = str(candidate)
            used.add(str(candidate))
    review["note"] = (review.get("note", "") + "\nAssigned Aviary user keys from retained original identifiers.").strip()
    return save_mapping(workspace, review, expected_revision)


def verify_source(root, selected_paths=None):
    with connect(root) as db:
        source = meta(db, "source")
    if read_json(Path(root) / "source-manifest.json") != source:
        raise Problem("SOURCE_BINDING", "Source manifest differs from the saved original.")
    for item in source["files"]:
        if selected_paths is not None and item["path"] not in selected_paths:
            continue
        path = within(Path(root) / "source", item["path"])
        if not path.is_file() or fingerprint(path) != {key: item[key] for key in ("bytes", "sha256")}:
            raise Problem("SOURCE_CHANGED", "Retained source member differs from its original bytes.", item["path"])
    return source


def show(workspace, run_id=None):
    root = Path(workspace).resolve()
    with connect(root) as db:
        identity, current = meta(db, "identity"), mapping(db)
        runs = []
        for row in db.execute("SELECT * FROM runs ORDER BY created"):
            if run_id and row["id"] != run_id:
                continue
            counts = dict(db.execute("SELECT state,count(*) FROM actions WHERE run_id=? GROUP BY state",
                                     (row["id"],)).fetchall())
            runs.append({"id": row["id"], "revision": row["revision"], "created": row["created"],
                         "target": json.loads(row["target"]), "states": counts,
                         "actions": [dict(action) for action in db.execute(
                             "SELECT action_key,state,provider_id,error,updated FROM actions WHERE run_id=? ORDER BY rowid",
                             (row["id"],))]})
        files = meta(db, "source")["files"]
        return {"schema": "stellar-forge.aviary-status.v1", "workspace": identity,
                "mapping": current, "source": {"files": files, "bytes": sum(f["bytes"] for f in files)},
                "runs": runs, "eventCount": db.execute("SELECT count(*) FROM events").fetchone()[0],
                "downloads": [json.loads(row["document"]) for row in db.execute("SELECT document FROM downloads ORDER BY path")]}


def package_rows(root, model):
    rows, assets = {}, {}
    for kind in KINDS:
        rows[kind] = []
        for row in model["tables"][kind]:
            if not row["included"]:
                continue
            values = dict(row["values"])
            for field, item in row["assets"].items():
                suffix = Path(item["path"]).suffix.lower()
                filename = item["sha256"][:16] + "-" + re.sub(r"[^A-Za-z0-9._-]", "_", Path(item["path"]).name)
                destination = item["kind"] + "/" + filename
                if destination in assets and assets[destination]["sha256"] != item["sha256"]:
                    raise Problem("ASSET_COLLISION", "Two assets mapped to the same destination.", destination)
                assets[destination] = item
                values[field] = "/aviary-package/" + destination
            rows[kind].append(values)
    return rows, assets


def write_native_zip(root, model, output):
    rows, assets = package_rows(root, model)
    entries = []
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                         allowZip64=True) as archive:
        for kind in KINDS:
            extra = sorted({field for row in rows[kind] for field in row} - set(FIELDS[kind]))
            fields = list(FIELDS[kind]) + extra
            buffer = io.StringIO(newline="")
            writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows[kind])
            content = buffer.getvalue().encode("utf-8")
            name = "aviary-package/" + FILENAMES[kind]
            archive.writestr(name, content)
            entries.append({"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        for name, item in sorted(assets.items()):
            path = within(root / "source", item["path"])
            name = "aviary-package/" + name
            archive.write(path, name)
            entries.append({"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
    verify_zip(output, entries)
    return {"schema": "stellar-forge.aviary-package.v1", "revision": model["revision"],
            "mappingSha256": model["mappingSha256"],
            "sourceManifestSha256": model["sourceManifestSha256"], "counts": model["counts"],
            "files": entries, **fingerprint(output)}


def verify_zip(path, manifest):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        expected = {item["path"]: item for item in manifest}
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise Problem("ZIP_INVENTORY", "Archive member inventory differs from its manifest.")
        for entry in archive.infolist():
            relative(entry.filename)
            h, count = hashlib.sha256(), 0
            with archive.open(entry) as source:
                while block := source.read(CHUNK):
                    count += len(block)
                    h.update(block)
            item = expected[entry.filename]
            if (count, h.hexdigest()) != (item["bytes"], item["sha256"]):
                raise Problem("ZIP_MEMBER", "Archive member bytes differ from their manifest.", entry.filename)


def build_package(workspace, output, revision=None):
    output = Path(output).resolve()
    with locked(workspace) as root:
        if output.exists():
            raise Problem("OUTPUT_EXISTS", "Choose a new package output path.", str(output))
        if output.is_relative_to(root / "source"):
            raise Problem("OUTPUT", "Output cannot be written into retained source.")
        model = preview(root, revision)
        if not model["ready"]:
            raise Problem("VALIDATION", "Resolve the listed mapping issues before building.", model["issues"])
        verify_source(root)
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".aviary-package-", dir=output.parent)
        os.close(fd)
        try:
            result = write_native_zip(root, model, temporary)
            os.link(temporary, output)
            sync_dir(output.parent)
            write_json(output.with_suffix(output.suffix + ".manifest.json"), result, exclusive=True)
            return {"output": str(output), **result}
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def report_html(model, status):
    e = lambda value: html.escape(str(value), quote=True)
    sections = []
    for kind in KINDS:
        rows = []
        for row in model["tables"][kind]:
            if not row["included"]:
                continue
            v = row["values"]
            name = v.get("Title") or v.get("Display Name") or v.get("Path") or v.get("File Path") or row["key"]
            rights = v.get("Rights Statement", v.get("Rights", ""))
            parent = row.get("parent", {})
            rows.append("<tr><td>" + e(row["key"]) + "</td><td>" + e(name) +
                "</td><td>" + e(parent.get("key") or parent.get("providerId") or "") +
                "</td><td>" + e(rights) + "</td><td>" + e(row["source"]["path"]) +
                ":" + str(row["source"]["line"]) + "</td></tr>")
        sections.append("<h2>" + e(kind.title()) + "</h2><table><thead><tr><th>Source key</th>"
                        "<th>Title / file</th><th>Parent</th><th>Source rights</th><th>Source row</th>"
                        "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>")
    findings = "".join("<li>" + e(item["table"] or "Package") + " / " + e(item["key"] or "") +
                       ": " + e(item["message"]) + "</li>" for item in model["issues"])
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
      '<title>Aviary migration review</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202124;'
      'max-width:1180px;margin:36px auto;padding:0 22px}h1{font-size:29px}h2{margin-top:32px}'
      'table{width:100%;border-collapse:collapse;margin:15px 0}th,td{padding:10px;text-align:left;'
      'border:1px solid #d4d4d4;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}'
      'code,pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#555}'
      '@media print{body{margin:0;font-size:10pt}tr{break-inside:avoid}}</style><main>'
      '<h1>' + e(status["workspace"]["label"]) + '</h1><p>Aviary migration review · mapping revision ' +
      str(model["revision"]) + '</p><p>' + e(", ".join(str(count) + " " + kind for kind, count in model["counts"].items())) +
      '</p><p>Source manifest <code>' + e(model["sourceManifestSha256"]) + '</code></p>' +
      ('<h2>Review notes</h2><ul>' + findings + '</ul>' if findings else '') +
      "".join(sections) + '<h2>Saved operations</h2><pre>' +
      e(json.dumps(status["runs"], ensure_ascii=False, indent=2)) +
      '</pre><p>Provider contract: <a href="' + CONTRACT["repository"] + '/tree/' +
      CONTRACT["commit"] + '">Aviary maintained import scripts</a>.</p></main></html>')


def portable(value, path=()):
    """Remove provider capability URLs from transferable response/event copies."""
    if isinstance(value, dict):
        return {key: portable(item, path + (key,)) for key, item in value.items()}
    if isinstance(value, list):
        return [portable(item, path) for item in value]
    if isinstance(value, str):
        if path and (path[-1] == "presigned_url" or
                     path[-1] == "url" and "multipart_upload" in path):
            return "[local upload URL removed]"
        if value.startswith(("https://", "http://")):
            from urllib.parse import parse_qsl, urlsplit
            secrets = {"signature", "x-amz-signature", "x-goog-signature",
                       "sig", "token", "access_token", "api_key"}
            query = {key.lower() for key, _ in parse_qsl(urlsplit(value).query)}
            if query & secrets:
                return "[temporary provider URL removed]"
    return value


def export_workspace(workspace, output):
    output = Path(output).resolve()
    with locked(workspace) as root:
        if output.exists() or output.is_relative_to(root):
            raise Problem("OUTPUT", "Choose a new output file outside the workspace.")
        model, status = preview(root), show(root)
        for run in status["runs"]:
            for action in run["actions"]:
                if action["error"]:
                    action["error"] = encoded(portable(json.loads(action["error"]))).decode()
        native_model = model if model["ready"] else None
        if native_model is None:
            with connect(root) as history:
                candidates = [row[0] for row in history.execute("SELECT revision FROM reviews ORDER BY revision DESC")]
            for candidate in candidates:
                prior = preview(root, candidate)
                if prior["ready"]:
                    native_model = prior
                    break
        verify_source(root)
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary_root = Path(tempfile.mkdtemp(prefix=".aviary-handoff-", dir=output.parent))
        try:
            native = temporary_root / "Aviary_Native_Package.zip" if native_model else None
            package = (write_native_zip(root, native_model, native) | {"available": True,
                        "latestMappingRevision": model["revision"]}) if native_model else {
                        "schema": "stellar-forge.aviary-package.v1", "available": False,
                        "latestMappingRevision": model["revision"],
                        "reason": "No saved mapping revision is ready for a native package.",
                        "issues": model["issues"]}
            dbcopy = temporary_root / "aviary.sqlite3"
            with connect(root) as original, sqlite3.connect(dbcopy) as copied:
                original.backup(copied)
                copied.row_factory = sqlite3.Row
                with copied:
                    for row in copied.execute("SELECT run_id,action_key,response,error FROM actions").fetchall():
                        replacements = [encoded(portable(json.loads(row[key]))).decode() if row[key] else None
                                        for key in ("response", "error")]
                        copied.execute("UPDATE actions SET response=?,error=? WHERE run_id=? AND action_key=?",
                                       (*replacements, row["run_id"], row["action_key"]))
                    for row in copied.execute("SELECT sequence,document FROM events").fetchall():
                        copied.execute("UPDATE events SET document=? WHERE sequence=?",
                                       (encoded(portable(json.loads(row["document"]))).decode(), row["sequence"]))
            members = []
            archive_path = temporary_root / "handoff.zip"
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6, allowZip64=True) as archive:
                def add_bytes(name, value):
                    archive.writestr(name, value)
                    members.append({"path": name, "bytes": len(value),
                                    "sha256": hashlib.sha256(value).hexdigest()})
                def add_file(name, value):
                    archive.write(value, name)
                    members.append({"path": name, **fingerprint(value)})
                if native:
                    add_file("delivery/Aviary_Native_Package.zip", native)
                add_bytes("delivery/native-package-manifest.json", encoded(package))
                add_bytes("delivery/review.html", report_html(model, status).encode("utf-8"))
                add_bytes("delivery/preview.json", encoded(model))
                add_bytes("delivery/status.json", encoded(status))
                add_file("workspace/aviary.sqlite3", dbcopy)
                add_file("workspace/source-manifest.json", root / "source-manifest.json")
                for item in meta_from_workspace(root, "source")["files"]:
                    add_file("workspace/source/" + item["path"], within(root / "source", item["path"]))
                for item in status["downloads"]:
                    path = within(root, item["path"])
                    if fingerprint(path) != {key: item[key] for key in ("bytes", "sha256")}:
                        raise Problem("DOWNLOAD_CHANGED", "Retained transcript export changed.", item["path"])
                    add_file("workspace/" + item["path"], path)
                application = Path(__file__).resolve().parent
                from managed import SOURCE_FILES
                for name in SOURCE_FILES:
                    path = application / name
                    if not path.is_file():
                        raise Problem("APPLICATION", "Complete receiving source is missing.", name)
                    add_file("application/" + name, path)
                guide = ("# Aviary migration handoff\n\n"
                    "Open delivery/review.html and native-package-manifest.json. The latter identifies "
                    "the exact saved revision used for the native package, or the unresolved mapping "
                    "issues when no revision is ready. "
                    "The original source, mapping revisions, operation IDs, child progress and "
                    "downloaded transcript bytes are retained in workspace/.\n\n"
                    "Run: python3 -B application/aviary.py serve --workspace workspace\n\n"
                    "API credentials remain in the receiving process environment. Signed upload URLs "
                    "are removed from this portable database; an unfinished upload can adopt a fresh "
                    "provider upload manifest for the same media and original upload ID using refresh-upload. "
                    "Completed actions retain their provider IDs and remain completed.\n")
                add_bytes("DELIVERY.md", guide.encode())
                manifest = {"schema": "stellar-forge.aviary-handoff.v1", "created": now(),
                            "workspaceId": status["workspace"]["id"], "files": members,
                            "contract": CONTRACT}
                archive.writestr("MANIFEST.json", encoded(manifest))
            check = members + [{"path": "MANIFEST.json", "bytes": len(encoded(manifest)),
                                 "sha256": hashlib.sha256(encoded(manifest)).hexdigest()}]
            verify_zip(archive_path, check)
            os.link(archive_path, output)
            sync_dir(output.parent)
            return {"output": str(output), "schema": manifest["schema"], "members": len(check),
                    "workspaceId": manifest["workspaceId"], **fingerprint(output)}
        finally:
            shutil.rmtree(temporary_root)


def meta_from_workspace(root, key):
    with connect(root) as db:
        return meta(db, key)


def _receiving_metadata_temporaries(directory, prefix, expected_prefix):
    """Retire only this receive's interrupted atomic metadata writes."""
    retired = False
    for path in directory.glob(prefix + "*"):
        if path.is_symlink() or not path.is_file():
            raise Problem("RECEIVE_METADATA", "Receiving metadata temporary is not a regular file.", str(path))
        value = path.read_bytes()
        if not (expected_prefix.startswith(value) or value.startswith(expected_prefix)):
            raise Problem("RECEIVE_METADATA", "Receiving metadata temporary differs from this handoff.", str(path))
        path.unlink()
        retired = True
    if retired:
        sync_dir(directory)


def _receiving_prefix(archive, item, destination):
    """Validate a complete member or the exact bytes retained before interruption."""
    if destination.is_symlink():
        raise Problem("RECEIVE_SYMLINK", "A receiving member is a symbolic link.", item["path"])
    if not destination.exists():
        return None, None
    before = destination.stat()
    if not stat.S_ISREG(before.st_mode):
        raise Problem("RECEIVE_MEMBER", "A receiving member is not a regular file.", item["path"])
    original = fingerprint(destination)
    wanted = {key: item[key] for key in ("bytes", "sha256")}
    if original == wanted:
        return before, original
    if original["bytes"] >= item["bytes"]:
        raise Problem("RECEIVE_CHANGED", "Retained member bytes differ from this handoff.", item["path"])
    prefix, remaining = hashlib.sha256(), original["bytes"]
    with archive.open(item["path"]) as incoming:
        while remaining:
            block = incoming.read(min(CHUNK, remaining))
            if not block:
                raise Problem("RECEIVE_PREFIX", "The archive is shorter than the retained prefix.", item["path"])
            prefix.update(block)
            remaining -= len(block)
    if prefix.hexdigest() != original["sha256"]:
        raise Problem("RECEIVE_CHANGED", "Retained prefix differs from this handoff.", item["path"])
    return before, original


def _receiving_inventory(root, expected, *, completion=False):
    directories = {str(parent) for name in expected for parent in PurePosixPath(name).parents
                   if str(parent) != "."}
    for path in root.rglob("*"):
        name = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise Problem("RECEIVE_SYMLINK", "A receiving path is a symbolic link.", name)
        if path.is_dir():
            if name not in directories:
                raise Problem("RECEIVE_EXTRA", "Receiving contains an undeclared directory.", name)
        elif not path.is_file():
            raise Problem("RECEIVE_MEMBER", "Receiving contains a special file.", name)
        elif name not in expected and not (completion and name in (
                "RECEIVING.json", "workspace/workspace.lock",
                "workspace/aviary.sqlite3-journal", "workspace/aviary.sqlite3-wal",
                "workspace/aviary.sqlite3-shm")):
            raise Problem("RECEIVE_EXTRA", "Receiving contains an undeclared file.", name)


def _received_status(output, manifest, declared):
    # Mapping, API actions and downloaded transcripts can advance after receiving.
    # The original archive, application, source and delivery stay byte-bound.
    for item in declared:
        if item["path"] == "workspace/aviary.sqlite3":
            continue
        path = within(output, item["path"])
        if not path.is_file() or fingerprint(path) != {key: item[key] for key in ("bytes", "sha256")}:
            raise Problem("RECEIVE_CHANGED", "A received original member has changed.", item["path"])
    with locked(output / "workspace"):
        verify_source(output / "workspace")
        status = show(output / "workspace")
        if status["workspace"]["id"] != manifest["workspaceId"]:
            raise Problem("WORKSPACE_BINDING", "Received workspace identity differs from the manifest.")
    return status


def receive(source, output):
    """Continue an archive-bound receive and publish its complete directory once."""
    source, requested = Path(source).resolve(), Path(output).absolute()
    if not requested.name or requested.is_symlink():
        raise Problem("OUTPUT", "Choose a receiving directory without a symbolic link.", str(requested))
    output = requested.parent.resolve() / requested.name
    source_identity = fingerprint(source)
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        if names.count("MANIFEST.json") != 1:
            raise Problem("MANIFEST", "Handoff must contain exactly one manifest.")
        manifest_bytes = archive.read("MANIFEST.json")
        manifest = json.loads(manifest_bytes)
        if manifest.get("schema") != "stellar-forge.aviary-handoff.v1":
            raise Problem("SCHEMA", "This is not an Aviary workspace handoff.")
        entries = manifest.get("files")
        if not isinstance(entries, list) or not entries:
            raise Problem("MANIFEST", "Handoff member inventory is missing.")
        for item in entries:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                raise Problem("MANIFEST", "Handoff member declaration is invalid.")
            relative(item["path"])
            if (type(item.get("bytes")) is not int or item["bytes"] < 0 or
                    not isinstance(item.get("sha256"), str) or
                    not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])):
                raise Problem("MANIFEST", "Handoff member identity is invalid.", item["path"])
        paths = [item["path"] for item in entries]
        if len(paths) != len(set(paths)) or any(name in paths for name in ("MANIFEST.json", "RECEIVING.json")):
            raise Problem("MANIFEST", "Handoff member declarations repeat a reserved or original path.")
        required = {"workspace/aviary.sqlite3", "workspace/source-manifest.json",
                    "delivery/preview.json", "delivery/status.json",
                    "delivery/native-package-manifest.json", "delivery/review.html", "DELIVERY.md"}
        required.update("application/" + name for name in (
            "aviary.py", "aviary_client.py", "server.py", "index.html",
            "app.js", "cli.mjs", "README.md", "PROVIDER_CONTRACT.md"))
        if "application/managed.py" in paths or "application/APPLICATIONS.md" in paths:
            required.update(("application/managed.py", "application/APPLICATIONS.md"))
        if not required.issubset(paths) or not isinstance(manifest.get("workspaceId"), str):
            raise Problem("APPLICATION", "Handoff lacks its complete application, source or workspace identity.",
                          sorted(required.difference(paths)))
        declared = entries + [{"path": "MANIFEST.json", "bytes": len(manifest_bytes),
                              "sha256": hashlib.sha256(manifest_bytes).hexdigest()}]
        verify_zip(source, declared)
        if fingerprint(source) != source_identity:
            raise Problem("SOURCE_CHANGED", "The handoff archive changed while it was being verified.")
        binding = {"schema": "stellar-forge.aviary-receiving.v1", "archive": source_identity,
                   "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                   "workspaceId": manifest["workspaceId"]}
        expected = {item["path"]: item for item in declared}
        completion_prefix = encoded({"binding": binding})[:-2] + b","
        output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        prefix = ".aviary-receive-" + hashlib.sha256(os.fsencode(output)).hexdigest()[:24]
        lock_path = output.parent / (prefix + ".lock")
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise Problem("RECEIVE_LOCK", "Receiving lock is not a regular file.", str(lock_path))
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Problem("BUSY", "Another receive operation is using this output.", str(output))
            staging = output.parent / (prefix + ".staging")
            content = staging / "content"
            state_path = staging / "binding.json"
            if output.is_symlink():
                raise Problem("OUTPUT", "Receiving output became a symbolic link.", str(output))
            if output.exists():
                if not output.is_dir():
                    raise Problem("OUTPUT_EXISTS", "Receiving output is not a directory.", str(output))
                receipt_path = within(output, "RECEIVING.json")
                if receipt_path.exists():
                    receipt = read_json(receipt_path)
                    if receipt.get("binding") != binding:
                        raise Problem("RECEIVE_BINDING", "This output belongs to a different handoff.", str(output))
                    status = _received_status(output, manifest, declared)
                    _receiving_metadata_temporaries(output, ".RECEIVING.json.", completion_prefix)
                    return {"output": str(output), "workspace": str(output / "workspace"),
                            "application": str(output / "application"), "status": status,
                            "reused": True, "receiving": receipt}
                immutable_complete = all(
                    within(output, item["path"]).is_file() and
                    fingerprint(within(output, item["path"])) ==
                    {key: item[key] for key in ("bytes", "sha256")}
                    for item in declared if item["path"] != "workspace/aviary.sqlite3")
                database_path = within(output, "workspace/aviary.sqlite3")
                database_partial = not database_path.is_file()
                if immutable_complete and database_path.is_file():
                    database_item = expected["workspace/aviary.sqlite3"]
                    if database_path.stat().st_size < database_item["bytes"]:
                        try:
                            _receiving_prefix(archive, database_item, database_path)
                        except Problem as error:
                            if error.code != "RECEIVE_CHANGED":
                                raise
                        else:
                            database_partial = True
                    if not database_partial:
                        # A complete earlier receive may already have later database revisions.
                        status = _received_status(output, manifest, declared)
                        _receiving_metadata_temporaries(output, ".RECEIVING.json.", completion_prefix)
                        receipt = {"binding": binding, "completedAt": now(), "adoptedExisting": True}
                        write_json(receipt_path, receipt, exclusive=True)
                        return {"output": str(output), "workspace": str(output / "workspace"),
                                "application": str(output / "application"), "status": status,
                                "reused": True, "receiving": receipt}
                # Older receivers wrote into the visible output. Move only a fully
                # verified original partial tree into private staging before resuming.
                _receiving_metadata_temporaries(output, ".RECEIVING.json.", completion_prefix)
                _receiving_inventory(output, expected)
                for item in declared:
                    _receiving_prefix(archive, item, within(output, item["path"]))
            if staging.is_symlink():
                raise Problem("RECEIVE_SYMLINK", "Receiving staging is a symbolic link.", str(staging))
            staging.mkdir(exist_ok=True, mode=0o700)
            if not staging.is_dir():
                raise Problem("RECEIVE_STAGE", "Receiving staging is not a directory.", str(staging))
            if state_path.is_symlink():
                raise Problem("RECEIVE_SYMLINK", "Receiving binding is a symbolic link.", str(state_path))
            wanted_state = {"binding": binding, "output": str(output)}
            if state_path.exists():
                if read_json(state_path) != wanted_state:
                    raise Problem("RECEIVE_BINDING", "Retained staging belongs to a different handoff.", str(staging))
            else:
                # An interrupted atomic metadata write precedes any original media.
                _receiving_metadata_temporaries(staging, ".binding.json.", encoded(wanted_state))
                if any(staging.iterdir()):
                    raise Problem("RECEIVE_BINDING", "Existing staging has no original archive binding.", str(staging))
                write_json(state_path, wanted_state, exclusive=True)
            _receiving_metadata_temporaries(staging, ".binding.json.", encoded(wanted_state))
            if any(path.name not in ("binding.json", "content") for path in staging.iterdir()):
                raise Problem("RECEIVE_EXTRA", "Receiving staging contains an undeclared member.", str(staging))
            if output.exists():
                if content.exists() or content.is_symlink():
                    raise Problem("RECEIVE_CONFLICT", "Both the original output and staging contain work.", str(output))
                os.rename(output, content)
                sync_dir(output.parent)
                sync_dir(staging)
            else:
                if content.is_symlink():
                    raise Problem("RECEIVE_SYMLINK", "Receiving content is a symbolic link.", str(content))
                content.mkdir(exist_ok=True, mode=0o700)
            _receiving_metadata_temporaries(content, ".RECEIVING.json.", completion_prefix)
            _receiving_inventory(content, expected, completion=True)
            saved_receipt = content / "RECEIVING.json"
            if saved_receipt.exists() and read_json(saved_receipt).get("binding") != binding:
                raise Problem("RECEIVE_BINDING", "Retained completion belongs to another handoff.")
            recovered, reused = [], 0
            for item in declared:
                destination = within(content, item["path"])
                before, original = _receiving_prefix(archive, item, destination)
                wanted = {key: item[key] for key in ("bytes", "sha256")}
                if original == wanted:
                    reused += 1
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                flags = os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW
                if before is None:
                    flags |= os.O_CREAT | os.O_EXCL
                member_fd = os.open(destination, flags, 0o600)
                with os.fdopen(member_fd, "ab") as outgoing, archive.open(item["path"]) as incoming:
                    opened = os.fstat(outgoing.fileno())
                    if ((before is None and opened.st_size != 0) or
                            (before is not None and
                             (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) !=
                             (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns))):
                        raise Problem("RECEIVE_CONCURRENT_CHANGE", "Retained member changed before continuation.", item["path"])
                    if original is not None:
                        incoming.seek(original["bytes"])
                    while block := incoming.read(CHUNK):
                        outgoing.write(block)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                if fingerprint(destination) != wanted:
                    raise Problem("RECEIVE_MEMBER", "Received member bytes differ from the archive.", item["path"])
                sync_dir(destination.parent)
                recovered.append({"path": item["path"], "retainedBytes": original["bytes"] if original else 0,
                                  "writtenBytes": item["bytes"] - (original["bytes"] if original else 0)})
            status = _received_status(content, manifest, declared)
            receipt = {"binding": binding, "completedAt": now(), "reusedMembers": reused,
                       "recoveredMembers": recovered}
            write_json(saved_receipt, receipt)
            for directory in sorted((path for path in content.rglob("*") if path.is_dir()),
                                    key=lambda path: len(path.parts), reverse=True):
                sync_dir(directory)
            sync_dir(content)
            if output.exists() or output.is_symlink():
                raise Problem("RECEIVE_CONCURRENT_CHANGE", "Receiving output appeared before publication.", str(output))
            os.rename(content, output)
            sync_dir(output.parent)
            # The output lock inode stays in place so waiting receivers share one lock.
            state_path.unlink()
            staging.rmdir()
            sync_dir(output.parent)
            return {"output": str(output), "workspace": str(output / "workspace"),
                    "application": str(output / "application"), "status": status,
                    "reused": bool(reused or any(x["retainedBytes"] for x in recovered)),
                    "receiving": receipt}
        finally:
            os.close(fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Aviary migration workspace")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("init", "show", "preview", "mapping", "save-mapping", "assign-keys",
                    "package", "export", "serve", "plan", "run", "reconcile", "refresh-upload",
                    "transcripts", "binding", "managed"):
        child = sub.add_parser(command)
        child.add_argument("--workspace", required=True)
        if command == "init":
            child.add_argument("--source", required=True)
            child.add_argument("--mapping")
            child.add_argument("--label")
        if command in ("preview", "package"):
            child.add_argument("--revision", type=int)
        if command == "save-mapping":
            child.add_argument("--input", required=True)
        if command in ("save-mapping", "assign-keys"):
            child.add_argument("--expected-revision", required=True, type=int)
        if command in ("package", "export"):
            child.add_argument("--output", required=True)
        if command in ("serve", "managed"):
            child.add_argument("--port", type=int, default=0 if command == "managed" else 8769)
        if command == "managed":
            child.add_argument("--expected-binding", required=True)
        if command == "plan":
            child.add_argument("--config", required=True)
            child.add_argument("--operation-id", required=True)
            child.add_argument("--revision", type=int)
        if command in ("run", "reconcile", "refresh-upload", "transcripts"):
            child.add_argument("--operation-id", required=True)
        if command == "reconcile":
            child.add_argument("--action", required=True)
            child.add_argument("--provider-id", required=True)
            child.add_argument("--note", required=True)
        if command == "refresh-upload":
            child.add_argument("--media-key", required=True)
            child.add_argument("--input", required=True)
        if command == "transcripts":
            child.add_argument("--resource-id", action="append")
    child = sub.add_parser("receive")
    child.add_argument("--source", required=True)
    child.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "init":
        result = initialize(args.source, args.workspace, read_json(args.mapping) if args.mapping else None, args.label)
    elif args.command == "show":
        result = show(args.workspace)
    elif args.command == "preview":
        result = preview(args.workspace, args.revision)
    elif args.command == "mapping":
        with connect(args.workspace) as db:
            result = mapping(db)
    elif args.command == "save-mapping":
        result = save_mapping(args.workspace, read_json(args.input), args.expected_revision)
    elif args.command == "assign-keys":
        result = allocate_keys(args.workspace, args.expected_revision)
    elif args.command == "package":
        result = build_package(args.workspace, args.output, args.revision)
    elif args.command == "export":
        result = export_workspace(args.workspace, args.output)
    elif args.command == "receive":
        result = receive(args.source, args.output)
    elif args.command == "binding":
        from managed import binding
        result = binding(args.workspace)
    elif args.command == "managed":
        from managed import serve
        return serve(args.workspace, args.port, args.expected_binding)
    elif args.command == "serve":
        from server import serve
        return serve(args.workspace, args.port)
    else:
        import aviary_client as client
        if args.command == "plan":
            result = client.plan(args.workspace, read_json(args.config), args.operation_id, args.revision)
        elif args.command == "run":
            result = client.run(args.workspace, args.operation_id)
        elif args.command == "reconcile":
            result = client.reconcile(args.workspace, args.operation_id, args.action, args.provider_id, args.note)
        elif args.command == "refresh-upload":
            result = client.refresh_upload(args.workspace, args.operation_id, args.media_key, read_json(args.input))
        else:
            result = client.export_transcripts(args.workspace, args.operation_id, args.resource_id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.modules.setdefault("aviary", sys.modules[__name__])
    try:
        raise SystemExit(main())
    except Problem as error:
        print(json.dumps(error.as_dict(), ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
