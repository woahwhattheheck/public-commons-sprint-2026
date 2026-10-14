"""Compare complete saved scientific report editions without re-running a study.

The native adapter validates each selection through ScientificReportEditions.
This dependency-free engine also operates on the exact extracted edition files,
so a recipient can compare delivered reports without installing the GIS runtime.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from contextlib import closing, contextmanager
import csv
import hashlib
from html import escape
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import unicodedata
from urllib.parse import quote
import zipfile

# Both invocation forms use the same maintained native filesystem and SQLite
# implementation. Importing this package never loads the scientific runtime.
if __package__:
    from . import portable_fs as _fs
    from .portable_databases import _database_uri
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from model import portable_fs as _fs
    from model.portable_databases import _database_uri

# Presentation revision creates a new saved comparison without replacing earlier exports.
VERSION = "1.0.1"
KIND = "scientific-report-comparisons"
SCHEMA = "upstate.scientific-report-comparison/v1"
EDITION_SCHEMA = "upstate.scientific-report-edition/v1"
BUNDLE_SCHEMA = "upstate.scientific-report-comparison-bundle/v1"
CHUNK = 1024 * 1024
PAGE_ROWS = 250


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Choose a complete saved report or comparison identifier")
    return value


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError("Duplicate JSON member: " + key)
        result[key] = value
    return result


@contextmanager
def _reader(path):
    """Pin one original regular file through reading, including native ChangeTime."""
    path = _fs.native_path(path)
    with os.fdopen(_fs.open_file(path, os.O_RDONLY), "rb") as stream:
        before = _signature(_fs.fd_stat(stream.fileno()))
        yield stream
        if (before != _signature(_fs.fd_stat(stream.fileno()))
                or before != _signature(_fs.path_stat(path))):
            raise ValueError("A retained report file changed while it was read")


def _read(path):
    with _reader(path) as stream:
        return json.load(stream, object_pairs_hook=_pairs,
                         parse_constant=lambda value: (_ for _ in ()).throw(
                             ValueError("Nonfinite JSON value: " + value)))


def _reject_link(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("A report member must not be a link or reparse point: " + path.name)


def _name(value):
    _fs.relative_name(value, windows=True)
    if (not isinstance(value, str) or not value or "\\" in value or ":" in value
            or "\x00" in value or value.startswith("/")):
        raise ValueError("Use a portable relative report member path")
    parts = value.split("/")
    for part in parts:
        if (part in {"", ".", ".."} or part.endswith((".", " "))
                or any(ord(c) < 32 or c in '<>"|?*' for c in part)
                or part.split(".")[0].upper() in
                {"CON", "PRN", "AUX", "NUL", *("COM" + str(n) for n in range(1, 10)),
                 *("LPT" + str(n) for n in range(1, 10))}):
            raise ValueError("Nonportable report member path: " + value)
    return value


def _path(root, name, *, exists=True):
    root = _fs.native_path(root).resolve(strict=True)
    name = _name(name)
    path = root
    for part in name.split("/"):
        path = path / part
        _reject_link(path)
    if exists:
        mode = _fs.path_stat(path).st_mode
        if not stat.S_ISREG(mode):
            raise ValueError("A report member must be a regular file: " + name)
    if not path.resolve().is_relative_to(root):
        raise ValueError("Report member leaves its original directory")
    return path


def _descriptor(root, path):
    root, path = _fs.native_path(root), _fs.native_path(path)
    checksum = hashlib.sha256()
    with _reader(path) as stream:
        before = _fs.fd_stat(stream.fileno())
        for block in iter(lambda: stream.read(CHUNK), b""):
            checksum.update(block)
    return {"path": path.relative_to(root).as_posix(), "bytes": before.st_size,
            "sha256": checksum.hexdigest()}


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _verify(root, item, cache=None):
    if (not isinstance(item, dict) or isinstance(item.get("bytes"), bool)
            or not isinstance(item.get("bytes"), int) or item["bytes"] < 0):
        raise ValueError("A report member requires its original length")
    _identifier(item.get("sha256"))
    path = _path(root, item.get("path"))
    signature = _signature(_fs.path_stat(path))
    expected = (item["bytes"], item["sha256"])
    cached = (signature, expected)
    if cache is None or cache.get(str(path)) != cached:
        actual = _descriptor(_fs.native_path(root), path)
        if (actual["bytes"], actual["sha256"]) != expected:
            raise ValueError("Retained report member changed: " + item["path"])
        if cache is not None:
            cache[str(path)] = cached
    return path


def _fsync_directory(path):
    _fs.sync_directory(path)


def _write(path, payload):
    path = _fs.native_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _reject_link(path)
    fd, name = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        _fs.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _write_json(path, value):
    _write(path, canonical(value) + b"\n")


@contextmanager
def _lock(path):
    # Match Workspace/Study transfer locks and release only acquired locks.
    with _fs.locked(path):
        yield


def _validate_members(members):
    if not isinstance(members, dict):
        raise ValueError("Keep the complete report member manifest")
    aliases, prefixes = set(), {}
    for name, item in members.items():
        _name(name)
        if (not isinstance(item, dict) or item.get("path") != name
                or not isinstance(item.get("bytes"), int) or isinstance(item["bytes"], bool)
                or item["bytes"] < 0):
            raise ValueError("Member name or length differs from its original descriptor")
        _identifier(item.get("sha256"))
        parts = name.split("/")
        for i in range(1, len(parts) + 1):
            prefix = "/".join(parts[:i])
            alias = unicodedata.normalize("NFC", prefix).casefold()
            if alias in prefixes and prefixes[alias] != prefix:
                raise ValueError("Report paths alias on another receiving filesystem")
            prefixes[alias] = prefix
        alias = unicodedata.normalize("NFC", name).casefold()
        if alias in aliases:
            raise ValueError("Report paths alias on another receiving filesystem")
        aliases.add(alias)
    for alias in aliases:
        if any("/".join(alias.split("/")[:i]) in aliases
               for i in range(1, len(alias.split("/")))):
            raise ValueError("A report file is also used as a directory")


def _copy(root, item, destination):
    source = _verify(root, item)
    destination = _fs.native_path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        _verify(destination.parent, {**item, "path": destination.name})
        return
    fd, name = tempfile.mkstemp(prefix=".retaining-", dir=destination.parent)
    temporary = Path(name)
    checksum, size = hashlib.sha256(), 0
    try:
        with os.fdopen(fd, "wb") as out, _reader(source) as incoming:
            for block in iter(lambda: incoming.read(CHUNK), b""):
                size += len(block)
                checksum.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
            raise ValueError("Original report changed during retention: " + item["path"])
        try:
            _fs.publish_file(temporary, destination)
        except FileExistsError:
            _verify(destination.parent, {**item, "path": destination.name})
        _fsync_directory(destination.parent)
    finally:
        temporary.unlink(missing_ok=True)


def edition(directory, *, project_id=None, cache=None):
    """Read one complete original saved edition; never manufacture missing files."""
    root = _fs.native_path(directory).resolve(strict=True)
    record = _read(_path(root, "edition.json"))
    key = _identifier(record.get("id"))
    identity = record.get("render_identity")
    if (record.get("schema") != EDITION_SCHEMA or record.get("state") != "complete"
            or not isinstance(identity, dict) or digest(identity) != key
            or (project_id is not None and record.get("project_id") != project_id)):
        raise ValueError("Choose a complete saved scientific report from the intended project")
    operation = _read(_path(root, "operation.json"))
    if (operation.get("state") != "complete"
            or operation.get("operation_id") != "observed-report-" + key[:20]
            or any(operation.get(name) != value for name, value in identity.items())
            or operation.get("files") != record.get("files")
            or any(operation.get(name) != record.get(name) for name in
                   ("operation_id", "source_count", "section_count", "figure_count", "sources", "title"))
            or _read(_path(root, "selection.json")) != identity):
        raise ValueError("The original saved edition differs from its completed operation")
    members = {}
    for item in record["files"].values():
        _verify(root, item, cache)
        name = item["path"]
        item = {field: item[field] for field in ("path", "bytes", "sha256")}
        if name in members and members[name] != item:
            raise ValueError("Two report roles disagree about one retained member")
        members[name] = {field: item[field] for field in ("path", "bytes", "sha256")}
    for name in ("edition.json", "operation.json", "selection.json"):
        item = _descriptor(root, _path(root, name))
        if name in members and members[name] != item:
            raise ValueError("A report metadata member changed")
        members[name] = item
    _validate_members(members)
    data_descriptor = record["files"].get("report_data")
    if data_descriptor is None:
        raise ValueError("The saved report must retain its original structured report data")
    document = _read(_verify(root, data_descriptor, cache))
    if (document.get("title") != record.get("title")
            or not isinstance(document.get("sections"), list)):
        raise ValueError("The original report title or structured sections differ")
    for section in document["sections"]:
        if (not isinstance(section, dict) or not isinstance(section.get("heading"), str)
                or not isinstance(section.get("blocks"), list)):
            raise ValueError("A scientific section needs its original heading and blocks")
        for block in section["blocks"]:
            if isinstance(block, dict) and block.get("kind") == "table":
                columns, rows = block.get("columns"), block.get("rows")
                if (not isinstance(columns, list) or not columns or not isinstance(rows, list)
                        or any(not isinstance(row, list) or len(row) != len(columns) for row in rows)):
                    raise ValueError("Keep every table row aligned with its original columns")
    return {"directory": root, "record": record, "operation": operation,
            "document": document, "members": members,
            "fingerprint": {"edition_id": key, "project_id": record["project_id"],
                            "members": members}}


def _summary(value):
    record = value["record"]
    return {"id": record["id"], "project_id": record["project_id"], "title": record["title"],
            "operation_id": record["operation_id"], "source_count": record["source_count"],
            "section_count": len(value["document"]["sections"]),
            "file_count": len(value["members"]),
            "bytes": sum(item["bytes"] for item in value["members"].values())}


def _sections(document):
    occurrences, result = Counter(), {}
    for position, section in enumerate(document["sections"]):
        heading = section["heading"]
        occurrences[heading] += 1
        key = canonical([heading, occurrences[heading]]).decode()
        result[key] = {**section, "position": position,
                       "identity": {"heading": heading, "occurrence": occurrences[heading]}}
    return result


def _blocks(section):
    counts, result = Counter(), {}
    for position, block in enumerate(section.get("blocks", [])):
        kind = block.get("kind", "object") if isinstance(block, dict) else "text"
        counts[kind] += 1
        result[(kind, counts[kind])] = (position, block)
    return result


def _tables(value):
    result = {}
    for section in _sections(value["document"]).values():
        for (kind, occurrence), (position, block) in _blocks(section).items():
            if kind != "table":
                continue
            identity = {"section": section["identity"], "table_occurrence": occurrence}
            key = digest(identity)
            result[key] = {"id": key, "identity": identity, "heading": section["heading"],
                           "position": position, "caption": block.get("caption", ""), "block": block}
    return result


def _column_pairs(left, right):
    lkeys = [canonical(c).decode() for c in left]
    rkeys = [canonical(c).decode() for c in right]
    lc, rc = Counter(lkeys), Counter(rkeys)
    index = {key: i for i, key in enumerate(rkeys)}
    return [{"left": i, "right": index[key], "label": left[i]}
            for i, key in enumerate(lkeys) if lc[key] == rc[key] == 1]


def preview(left, right):
    """Offer explicit key choices; a repeated heading is matched by occurrence."""
    left, right = edition(left), edition(right)
    lt, rt = _tables(left), _tables(right)
    tables = []
    for key in sorted(set(lt) | set(rt)):
        l, r = lt.get(key), rt.get(key)
        lb, rb = (l or {}).get("block"), (r or {}).get("block")
        tables.append({"id": key, "identity": (l or r)["identity"],
                       "heading": (l or r)["heading"],
                       "left_caption": l["caption"] if l else None,
                       "right_caption": r["caption"] if r else None,
                       "left_rows": len(lb["rows"]) if lb else 0,
                       "right_rows": len(rb["rows"]) if rb else 0,
                       "left_columns": lb["columns"] if lb else [],
                       "right_columns": rb["columns"] if rb else [],
                       "key_options": _column_pairs(lb["columns"], rb["columns"]) if lb and rb else []})
    return {"schema": SCHEMA, "left": _summary(left), "right": _summary(right), "tables": tables,
            "matching": "Section heading plus occurrence; block kind plus occurrence. Table row keys are explicit; the default is exact-row multiset comparison.",
            "same_project": left["record"]["project_id"] == right["record"]["project_id"]}


def _plan(plan, left_tables, right_tables):
    plan = {} if plan is None else plan
    if not isinstance(plan, dict) or set(plan) - {"row_keys", "include_positions"}:
        raise ValueError("Choose row_keys and optional include_positions")
    keys = plan.get("row_keys", {})
    positions = plan.get("include_positions", False)
    if not isinstance(keys, dict) or not isinstance(positions, bool):
        raise ValueError("Row keys must be an object and include_positions must be boolean")
    result = {}
    for key, values in keys.items():
        if key not in left_tables or key not in right_tables:
            raise ValueError("Choose keys only for a table present in both editions")
        if (not isinstance(values, list) or not values
                or any(isinstance(i, bool) or not isinstance(i, int) for i in values)
                or len(set(values)) != len(values)):
            raise ValueError("Choose each key column index once")
        pairs = _column_pairs(left_tables[key]["block"]["columns"], right_tables[key]["block"]["columns"])
        allowed = {pair["left"] for pair in pairs}
        if set(values) - allowed:
            raise ValueError("A selected key column is absent or has an ambiguous label")
        result[key] = list(values)
    return {"row_keys": result, "include_positions": positions}


def _connect(path, *, readonly=False):
    path = _fs.native_path(path).absolute()
    _reject_link(path)
    if readonly:
        return sqlite3.connect(_database_uri(path, "ro"), uri=True)
    db = sqlite3.connect(_database_uri(path, "rwc"), uri=True)
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA temp_store=FILE")
    db.execute("PRAGMA cache_size=-8192")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS changes(
          seq INTEGER PRIMARY KEY, category TEXT NOT NULL, table_id TEXT,
          status TEXT NOT NULL, locator TEXT NOT NULL,
          left_position INTEGER, right_position INTEGER,
          left_json TEXT, right_json TEXT, detail_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS changes_filter ON changes(category,table_id,status,seq);
        CREATE TABLE IF NOT EXISTS completed(unit TEXT PRIMARY KEY, detail_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS left_rows(k TEXT,occ INTEGER,pos INTEGER,j TEXT,PRIMARY KEY(k,occ));
        CREATE TABLE IF NOT EXISTS right_rows(k TEXT,occ INTEGER,pos INTEGER,j TEXT,PRIMARY KEY(k,occ));
    """)
    return db


def _emit(db, category, status, locator, left=None, right=None, *, table=None,
          left_position=None, right_position=None, detail=None):
    db.execute("INSERT INTO changes(category,table_id,status,locator,left_position,right_position,left_json,right_json,detail_json) VALUES(?,?,?,?,?,?,?,?,?)",
               (category, table, status, str(locator), left_position, right_position,
                canonical(left).decode() if left is not None else None,
                canonical(right).decode() if right is not None else None,
                canonical(detail or {}).decode()))


def _metadata(db, left, right):
    for field in ("title", "contact", "presentation", "schema", "display_precision", "binding", "source_records"):
        l, r = left["document"].get(field), right["document"].get(field)
        if canonical(l) != canonical(r):
            _emit(db, "metadata", "changed", field, l, r)
    ls, rs = left["record"].get("sources", []), right["record"].get("sources", [])
    def sources(values):
        result = {}
        for i, row in enumerate(values):
            key = canonical([row.get("source_collection_id"), row.get("source_id")]).decode()
            if key in result:
                raise ValueError("A saved report repeats an original source identity")
            result[key] = (i, row)
        return result
    li, ri = sources(ls), sources(rs)
    for key in sorted(set(li) | set(ri)):
        l, r = li.get(key), ri.get(key)
        if not l or not r or canonical(l[1]) != canonical(r[1]) or l[0] != r[0]:
            status = "added" if not l else "removed" if not r else "changed" if canonical(l[1]) != canonical(r[1]) else "position_changed"
            _emit(db, "source", status, key, l[1] if l else None, r[1] if r else None,
                  left_position=l[0] if l else None, right_position=r[0] if r else None)
    for name in sorted(set(left["members"]) | set(right["members"])):
        l, r = left["members"].get(name), right["members"].get(name)
        if l != r:
            _emit(db, "file", "added" if l is None else "removed" if r is None else "changed", name, l, r)
    lsections, rsections = _sections(left["document"]), _sections(right["document"])
    for key in sorted(set(lsections) | set(rsections)):
        l, r = lsections.get(key), rsections.get(key)
        if not l or not r or l["position"] != r["position"]:
            summary = lambda s: {"heading": s["heading"], "blocks": len(s["blocks"])} if s else None
            _emit(db, "section", "added" if not l else "removed" if not r else "position_changed",
                  key, summary(l), summary(r), left_position=l["position"] if l else None,
                  right_position=r["position"] if r else None)
        lb, rb = _blocks(l or {}), _blocks(r or {})
        for block_key in sorted(set(lb) | set(rb)):
            if block_key[0] == "table":
                continue
            a, b = lb.get(block_key), rb.get(block_key)
            if not a or not b or canonical(a[1]) != canonical(b[1]) or a[0] != b[0]:
                status = "added" if not a else "removed" if not b else "changed" if canonical(a[1]) != canonical(b[1]) else "position_changed"
                _emit(db, block_key[0], status, key + "/" + str(block_key),
                      a[1] if a else None, b[1] if b else None,
                      left_position=a[0] if a else None, right_position=b[0] if b else None)


def _row_fields(columns, row):
    counts, result = Counter(), {}
    for column, value in zip(columns, row):
        name = canonical(column).decode()
        counts[name] += 1
        result[canonical([column, counts[name]]).decode()] = value
    return result


def _table(db, key, left, right, plan, progress):
    lb, rb = (left or {}).get("block", {}), (right or {}).get("block", {})
    lm, rm = {k: v for k, v in lb.items() if k != "rows"}, {k: v for k, v in rb.items() if k != "rows"}
    if canonical(lm) != canonical(rm):
        _emit(db, "table", "added" if not left else "removed" if not right else "changed",
              (left or right)["heading"], lm or None, rm or None, table=key)
    selected = plan["row_keys"].get(key)
    pairs = _column_pairs(lb.get("columns", []), rb.get("columns", []))
    right_columns = {p["left"]: p["right"] for p in pairs}
    db.execute("DELETE FROM left_rows")
    db.execute("DELETE FROM right_rows")
    for side, block in (("left", lb), ("right", rb)):
        indexes = ([right_columns[i] for i in selected] if side == "right" else selected) if selected else None
        occurrences = Counter()
        for position, row in enumerate(block.get("rows", [])):
            encoded = canonical(row).decode()
            k = canonical([row[i] for i in indexes]).decode() if indexes else encoded
            occurrence = occurrences[k]
            occurrences[k] += 1
            if selected and occurrence:
                raise ValueError("Selected row keys repeat in " + side + " table " + key +
                                 " at row " + str(position + 1) + "; choose additional key columns")
            db.execute("INSERT INTO " + side + "_rows VALUES(?,?,?,?)", (k, occurrence, position, encoded))
            if progress and position % 2000 == 0:
                progress({"stage": "indexing", "table": key, "side": side, "rows": position + 1})
    sql = """SELECT l.k,l.pos,r.pos,l.j,r.j FROM left_rows l LEFT JOIN right_rows r
             ON l.k=r.k AND l.occ=r.occ
             UNION ALL SELECT r.k,NULL,r.pos,NULL,r.j FROM right_rows r LEFT JOIN left_rows l
             ON l.k=r.k AND l.occ=r.occ WHERE l.k IS NULL"""
    counts = Counter()
    for k, lp, rp, ljson, rjson in db.execute(sql):
        l, r = json.loads(ljson) if ljson is not None else None, json.loads(rjson) if rjson is not None else None
        changed_cells = []
        if l is None:
            status = "added"
        elif r is None:
            status = "removed"
        else:
            lf, rf = _row_fields(lb["columns"], l), _row_fields(rb["columns"], r)
            for field in sorted(set(lf) | set(rf)):
                if field not in lf or field not in rf or canonical(lf[field]) != canonical(rf[field]):
                    changed_cells.append({"column": json.loads(field), "left_present": field in lf,
                                          "right_present": field in rf, "left": lf.get(field), "right": rf.get(field)})
            status = "changed" if changed_cells else "position_changed" if lp != rp else "unchanged"
        counts[status] += 1
        if status != "unchanged" and (status != "position_changed" or plan["include_positions"]):
            _emit(db, "row", status, k if selected else "exact-row occurrence", l, r, table=key,
                  left_position=lp, right_position=rp,
                  detail={"matching": "explicit-key" if selected else "exact-row",
                          "changed_cells": changed_cells})
    db.execute("DELETE FROM left_rows")
    db.execute("DELETE FROM right_rows")
    return {"id": key, "heading": (left or right)["heading"],
            "identity": (left or right)["identity"],
            "left_caption": (left or {}).get("caption"), "right_caption": (right or {}).get("caption"),
            "left_columns": lb.get("columns", []), "right_columns": rb.get("columns", []),
            "left_rows": len(lb.get("rows", [])), "right_rows": len(rb.get("rows", [])),
            "matching": "explicit-key" if selected else "exact-row", "key_columns": selected or [],
            "counts": dict(counts), "position_details": plan["include_positions"]}


def _decode_row(row):
    seq, category, table, status, locator, lp, rp, left, right, detail = row
    left_value = json.loads(left) if left is not None else None
    right_value = json.loads(right) if right is not None else None
    return {"left_json": left, "right_json": right,
            "left_cells": [_display(v) for v in left_value] if isinstance(left_value, list) else None,
            "right_cells": [_display(v) for v in right_value] if isinstance(right_value, list) else None,
            "seq": seq, "category": category, "table_id": table, "status": status,
            "locator": locator, "left_position": lp, "right_position": rp,
            "left": json.loads(left) if left is not None else None,
            "right": json.loads(right) if right is not None else None, "detail": json.loads(detail)}


def rows(directory, *, after=0, limit=100, category=None, table_id=None, status=None, cache=None):
    record = inspect(directory, cache=cache)
    if (isinstance(after, bool) or not isinstance(after, int) or after < 0
            or isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000):
        raise ValueError("Use a nonnegative cursor and a page size from 1 to 1000")
    where, params = ["seq> ?"], [after]
    for column, value in (("category", category), ("table_id", table_id), ("status", status)):
        if value is not None:
            where.append(column + "=?")
            params.append(str(value))
    with closing(_connect(Path(directory) / "changes.sqlite", readonly=True)) as db:
        result = db.execute("SELECT * FROM changes WHERE " + " AND ".join(where) +
                            " ORDER BY seq LIMIT ?", (*params, limit + 1)).fetchall()
    more = len(result) > limit
    result = result[:limit]
    return {"comparison_id": record["id"], "rows": [_decode_row(row) for row in result],
            "next_after": result[-1][0] if more else None, "complete": not more}


def _display(value):
    if value is None:
        return "—"
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)


def _value_html(value, depth=0):
    """Readable original values; nested structures remain complete and expandable."""
    if isinstance(value, (dict, list)):
        if not value:
            return '<span class="scalar">' + ('{}' if isinstance(value, dict) else '[]') + '</span>'
        if depth >= 4:
            return '<pre>' + escape(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)) + '</pre>'
        if isinstance(value, dict):
            content = '<dl class="fields">' + ''.join(
                '<dt>' + escape(str(key)) + '</dt><dd>' + _value_html(item, depth + 1) + '</dd>'
                for key, item in value.items()) + '</dl>'
            label = '%d fields' % len(value)
        else:
            content = '<ol class="values">' + ''.join(
                '<li>' + _value_html(item, depth + 1) + '</li>' for item in value) + '</ol>'
            label = '%d values' % len(value)
        if depth or len(value) > 6:
            return '<details class="nested"><summary>' + label + '</summary>' + content + '</details>'
        return content
    if value is None:
        return '<span class="scalar">null</span>'
    text = _display(value)
    if text == '':
        return '<span class="empty">Empty string</span>'
    numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
    # Scientific tables also retain exact numeric strings, not rounded display values.
    numeric = numeric or (isinstance(value, str) and bool(re.fullmatch(
        r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', value)))
    return '<span class="' + ('number' if numeric else 'scalar') + '">' + escape(text) + '</span>'


def _cell(value):
    return _value_html(value)


def _edition_values(row, side, table):
    if row[side + '_json'] is None:
        return '<p class="empty">No value in this edition</p>'
    value = row[side]
    columns = table.get(side + '_columns', []) if table else []
    if row['category'] == 'row' and isinstance(value, list) and len(columns) == len(value):
        return '<dl class="fields row-fields">' + ''.join(
            '<dt>' + escape(_display(column)) + '</dt><dd>' + _value_html(item) + '</dd>'
            for column, item in zip(columns, value)) + '</dl>'
    return _value_html(value)


def _html(title, body, *, prefix='', interactive=False):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>' + escape(title) + '</title><link rel="stylesheet" href="' + prefix + 'comparison.css">'
            '</head><body><main>' + body + '</main>'
            + ('<script>' + REVIEW_SCRIPT + '</script>' if interactive else '')
            + '</body></html>\n').encode()


STYLE = """*{box-sizing:border-box}body{margin:0;color:#171717;background:#fff;font:15px/1.5 Arial,sans-serif}
main{max-width:1280px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:28px;border-bottom:1px solid #999;padding-bottom:8px}h3{font-size:16px;margin:0 0 12px}
a{color:inherit;text-decoration:underline}nav,.summary{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}nav a,.summary span{border:1px solid #888;padding:6px 10px}nav a:hover,button:hover{background:#eee}
.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:8px}th{background:#eee}
pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;max-height:26em;overflow:auto}small{display:block;color:#444}
.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.pair section{border:1px solid #888;padding:16px;min-width:0}.mono{font-family:monospace;overflow-wrap:anywhere}
.note{max-width:100ch}.status{white-space:nowrap;font-weight:bold}.removed{border-left:4px double #333}.added{border-left:4px solid #555}
[hidden]{display:none!important}button,input,select{font:inherit;color:inherit;background:#fff;border:1px solid #777;border-radius:0;padding:8px;max-width:100%;min-height:40px}button,summary{cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #171717;outline-offset:3px}
.filters{display:grid;grid-template-columns:minmax(180px,2fr) repeat(3,minmax(130px,1fr));gap:12px;padding:16px;background:#f4f4f4;border:1px solid #aaa}.filters label{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:13px;font-weight:bold}.filter-actions{grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:10px}.filter-actions output{margin-left:auto;font-size:13px}.filter-note{font-size:13px;margin:8px 0 20px}
.change{border:1px solid #aaa;border-left:4px solid #777;margin:12px 0;scroll-margin-top:16px;min-width:0}.change.removed{border-left-style:double}.change>details>summary{padding:12px 16px;background:#f6f6f6;overflow-wrap:anywhere}.change>details[open]>summary{border-bottom:1px solid #aaa}.change-title{font-weight:bold}.change-meta{margin-left:14px;font-size:13px;font-weight:normal;color:#444}.change-content{padding:16px}.change-content .pair section{border-color:#ccc}.change-content .pair{margin:16px 0}.change:target{outline:2px solid #333;outline-offset:2px}
.fields{display:grid;grid-template-columns:minmax(90px,2fr) minmax(0,3fr);margin:0;font-size:13px}.fields dt,.fields dd{padding:7px 8px;border-bottom:1px solid #ddd;margin:0;min-width:0;overflow-wrap:anywhere}.fields dt{font-weight:bold;background:#f7f7f7}.fields dd{overflow:auto}.number{display:block;white-space:nowrap;font-variant-numeric:tabular-nums;overflow-x:auto}.scalar{white-space:pre-wrap;overflow-wrap:anywhere}.empty{font-style:italic;color:#555}.values{padding-left:22px;margin:8px 0}.values li{margin:6px 0}.nested{margin:5px 0;min-width:0}.nested>summary{font-size:13px;text-decoration:underline;padding:4px 0}.nested[open]>summary{margin-bottom:8px}.original-location{font-size:13px;margin:8px 0}.counts{margin:0;padding-left:18px}.counts li{white-space:nowrap}.no-results{border:1px solid #777;padding:20px}
@media(max-width:800px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters .search-label{grid-column:1/-1}.filters .table-label{grid-column:1/-1}}
@media(max-width:700px){main{padding:14px}.pair{grid-template-columns:1fr}h1{font-size:23px}td,th{padding:5px}.change-content{padding:10px}.change>details>summary{padding:10px}.change-meta{display:block;margin-left:14px}.fields{grid-template-columns:minmax(90px,2fr) minmax(0,3fr)}.filter-actions output{margin-left:0;width:100%}.filters{padding:12px}.pair section{padding:12px}}
@media print{main{max-width:none;padding:0}nav,.filters,.filter-note,iframe{display:none}pre{max-height:none;overflow:visible}.table-wrap{overflow:visible}.pair{grid-template-columns:1fr}.change{break-inside:auto}.change>details>summary{break-after:avoid}.number{white-space:pre-wrap;overflow:visible}.fields dd{overflow:visible}thead{display:table-header-group}h2,h3{break-after:avoid}}
"""


REVIEW_SCRIPT = r"""(() => {
  'use strict';
  const form = document.querySelector('#review-filters');
  if (!form) return;
  const records = Array.from(document.querySelectorAll('article.change'));
  const query = document.querySelector('#review-query');
  const category = document.querySelector('#review-category');
  const status = document.querySelector('#review-status');
  const table = document.querySelector('#review-table');
  const count = document.querySelector('#review-count');
  const empty = document.querySelector('#review-empty');
  // textContent includes closed disclosures, so exact retained values are searchable.
  const searchable = new Map(records.map(node => [node, node.textContent.toLocaleLowerCase()]));
  function filter() {
    const term = query.value.trim().toLocaleLowerCase();
    let visible = 0;
    records.forEach(node => {
      node.hidden = Boolean((term && !searchable.get(node).includes(term)) ||
        (category.value && node.dataset.category !== category.value) ||
        (status.value && node.dataset.status !== status.value) ||
        (table.value && node.dataset.table !== table.value));
      if (!node.hidden) visible += 1;
    });
    count.textContent = visible + ' of ' + records.length + ' changes shown on this page';
    empty.hidden = visible !== 0;
  }
  form.hidden = false;
  form.addEventListener('submit', event => event.preventDefault());
  [query, category, status, table].forEach(control => control.addEventListener('input', filter));
  form.querySelector('[data-action="reset"]').addEventListener('click', () => {
    form.reset(); filter(); query.focus();
  });
  ['expand','collapse'].forEach(action => {
    form.querySelector('[data-action="' + action + '"]').addEventListener('click', () => {
      records.filter(node => !node.hidden).forEach(node => {
        node.querySelectorAll('details').forEach(detail => { detail.open = action === 'expand'; });
      });
    });
  });
  function revealAnchor() {
    const id = location.hash.slice(1);
    if (!/^change-\d+$/.test(id)) return;
    const node = document.getElementById(id);
    if (!node) return;
    if (node.hidden) { form.reset(); filter(); }
    node.querySelector('details').open = true;
    node.scrollIntoView({block:'start'});
  }
  let printState = null;
  addEventListener('beforeprint', () => {
    if (printState) return;
    printState = [];
    records.filter(node => !node.hidden).forEach(node => {
      node.querySelectorAll('details').forEach(detail => {
        printState.push([detail, detail.open]); detail.open = true;
      });
    });
  });
  addEventListener('afterprint', () => {
    if (printState) printState.forEach(([detail, open]) => { detail.open = open; });
    printState = null;
  });
  addEventListener('hashchange', revealAnchor);
  filter(); revealAnchor();
})();"""


def _review_controls(rows, tables):
    def options(values, label):
        return '<option value="">' + label + '</option>' + ''.join(
            '<option value="' + escape(value, quote=True) + '">' + escape(text) + '</option>'
            for value, text in values)
    categories = sorted({row['category'] for row in rows})
    statuses = sorted({row['status'] for row in rows})
    table_ids = {row['table_id'] for row in rows if row['table_id']}
    table_options = [(key, tables[key]['heading'] + ' · table ' +
                      str(tables[key]['identity']['table_occurrence']))
                     for key in tables if key in table_ids]
    return ('<form id="review-filters" class="filters" hidden aria-label="Filter changes on this page">'
            '<label class="search-label">Find a value, field or location<input id="review-query" type="search" autocomplete="off"></label>'
            '<label>Category<select id="review-category">' + options([(v, v.replace('_', ' ')) for v in categories], 'All categories') + '</select></label>'
            '<label>Status<select id="review-status">' + options([(v, v.replace('_', ' ')) for v in statuses], 'All statuses') + '</select></label>'
            '<label class="table-label">Original table<select id="review-table">' + options(table_options, 'All tables and other changes') + '</select></label>'
            '<div class="filter-actions"><button type="button" data-action="reset">Clear filters</button>'
            '<button type="button" data-action="expand">Expand shown values</button>'
            '<button type="button" data-action="collapse">Collapse shown values</button>'
            '<output id="review-count" aria-live="polite"></output></div></form>'
            '<p class="filter-note">Filters apply to this page only. Open a change to read both original editions. Printing includes all values in the shown changes.</p>'
            '<noscript><p>Open each change to read its full values. The complete CSV register includes every page.</p></noscript>')


def _change_html(row, table):
    status = row['status'].replace('_', ' ')
    heading = table['heading'] if table else row['category'].replace('_', ' ').capitalize()
    body = ('<article class="change ' + escape(row['status'], quote=True) + '" id="change-' + str(row['seq']) + '"'
            ' data-category="' + escape(row['category'], quote=True) + '" data-status="' + escape(row['status'], quote=True) + '"'
            ' data-table="' + escape(row['table_id'] or '', quote=True) + '"><details><summary>'
            '<span class="change-title">' + escape(heading) + '</span><span class="change-meta">#' + str(row['seq'])
            + ' · ' + escape(row['category']) + ' · ' + escape(status))
    if table:
        body += ' · table ' + str(table['identity']['table_occurrence'])
    positions = [(row[side + '_position'] + 1) if row[side + '_position'] is not None else None
                 for side in ('left', 'right')]
    if any(position is not None for position in positions):
        body += ' · original position ' + str(positions[0] if positions[0] is not None else 'absent')
        body += ' → ' + str(positions[1] if positions[1] is not None else 'absent')
    body += '</span></summary><div class="change-content">'
    body += '<p class="original-location"><strong>Original location</strong></p>' + _value_html(row['locator'])
    body += '<div class="pair">'
    for side, label in (('left', 'Earlier edition'), ('right', 'Later edition')):
        body += '<section><h3>' + label + '</h3>'
        if table and table.get(side + '_caption'):
            body += '<p class="note">' + escape(table[side + '_caption']) + '</p>'
        body += _edition_values(row, side, table) + '</section>'
    body += '</div>'
    if row['detail']:
        body += '<details class="nested"><summary>Exact comparison details</summary>' + _value_html(row['detail']) + '</details>'
    body += '</div></details></article>'
    return body


def _render(directory, record, db):
    title = record['title']
    tables_by_id = {table['id']: table for table in record['tables']}
    _write(directory / 'comparison.css', STYLE.encode())
    total = db.execute('SELECT COUNT(*) FROM changes').fetchone()[0]
    page_count = (total + PAGE_ROWS - 1) // PAGE_ROWS
    with (directory / 'changes.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['sequence', 'category', 'table_id', 'status', 'locator_json', 'left_position_1based',
                         'right_position_1based', 'left_json', 'right_json', 'detail_json'])
        for row in db.execute('SELECT * FROM changes ORDER BY seq'):
            seq, category, table, status, locator, lp, rp, l, r, detail = row
            # Keep the original lossless register independent of HTML presentation.
            writer.writerow([seq, category, table, status, json.dumps(locator, ensure_ascii=False),
                             lp + 1 if lp is not None else '', rp + 1 if rp is not None else '', l, r, detail])
        stream.flush()
        os.fsync(stream.fileno())
    first_table_change, first_row_change = {}, None
    cursor = db.execute('SELECT * FROM changes ORDER BY seq')
    for page in range(1, page_count + 1):
        selected = [_decode_row(row) for row in cursor.fetchmany(PAGE_ROWS)]
        for row in selected:
            href = 'pages/page-%05d.html#change-%d' % (page, row['seq'])
            if row['table_id']:
                first_table_change.setdefault(row['table_id'], href)
            if row['category'] == 'row' and first_row_change is None:
                first_row_change = href
        body = '<h1>Report changes</h1><p class="note">' + escape(title) + '</p><nav aria-label="Change pages"><a href="../index.html">Comparison overview</a>'
        if page > 1:
            body += '<a href="page-%05d.html">Previous page</a>' % (page - 1)
        if page < page_count:
            body += '<a href="page-%05d.html">Next page</a>' % (page + 1)
        body += '<a href="../changes.csv">Complete CSV register</a></nav>'
        body += '<p>Page %d of %d · %d changes on this page · %d across the complete comparison.</p>' % (page, page_count, len(selected), total)
        body += _review_controls(selected, tables_by_id)
        body += '<p id="review-empty" class="no-results" hidden>No changes on this page match these filters. Clear filters or open another change page.</p>'
        body += ''.join(_change_html(row, tables_by_id.get(row['table_id'])) for row in selected)
        body += '<nav aria-label="Complete change exports"><a href="../changes.csv">Complete change register CSV</a><a href="../changes.sqlite">Complete indexed change database</a><a href="../index.html">Comparison overview</a></nav>'
        _write(directory / 'pages' / ('page-%05d.html' % page), _html(title, body, prefix='../', interactive=True))
    body = '<h1>Report comparison</h1><p class="note">' + escape(title) + '</p>'
    body += '<p class="note">Review the earlier and later saved reports, then open a table to find its recorded changes. Original units, column labels and complete values are retained.</p><div class="pair">'
    for side, label in (('left', 'Earlier'), ('right', 'Later')):
        value = record[side]
        source = edition(directory / side)
        report = source['record']['files'].get('report_html', {})
        body += '<section><h2>' + label + '</h2><strong>' + escape(value['title']) + '</strong>'
        if report.get('path'):
            href = side + '/' + quote(report['path'], safe='/')
            body += '<p><a target="_blank" rel="noopener noreferrer" href="' + escape(href, quote=True) + '">Open complete original report</a></p>'
        body += '<p>%d original files · %s bytes</p>' % (value['file_count'], format(value['bytes'], ','))
        body += '<details class="nested"><summary>Original edition identifier</summary><p class="mono">' + escape(value['id']) + '</p></details></section>'
    body += '</div><div class="summary"><span>%d recorded changes</span><span>%d original tables compared</span><span>%d change pages</span></div>' % (total, len(record['tables']), page_count)
    body += '<nav aria-label="Review and exports">'
    if first_row_change:
        body += '<a href="' + first_row_change + '">Read table-row changes</a>'
    if page_count:
        body += '<a href="pages/page-00001.html">Read all change categories</a>'
    body += '<a href="changes.csv">Complete CSV register</a><a href="files.html">All retained original files</a></nav>'
    if not record['same_project']:
        body += '<p><strong>The selected editions belong to different original projects.</strong> Their project identities remain separate.</p>'
    body += '<details class="nested"><summary>Comparison method and original selections</summary><p class="note">Tables without a selected unique key use exact-row multiset matching: duplicate counts are retained, changed rows appear as removals and additions. With explicit keys, the same record is matched by the selected original columns. Position-only changes are counted separately; full position records are '
    body += ('included.' if record['plan']['include_positions'] else 'not requested. Both complete original row sequences remain in the retained reports.')
    body += '</p><p>This comparison reads saved results; it does not recalculate the scientific study.</p><a href="summary.json">Structured comparison summary</a> · <a href="changes.sqlite">SQLite change database</a></details>'
    body += '<h2>Table changes</h2><div class="table-wrap"><table><thead><tr><th scope="col">Original table</th><th scope="col">Matching</th><th scope="col">Earlier / later rows</th><th scope="col">Row counts</th></tr></thead><tbody>'
    for table in record['tables']:
        heading = escape(table['heading'])
        if table['id'] in first_table_change:
            heading = '<a href="' + first_table_change[table['id']] + '">' + heading + '</a>'
        body += '<tr><td>' + heading + '<small>Table ' + str(table['identity']['table_occurrence']) + '</small>'
        if table['right_caption'] or table['left_caption']:
            body += '<small>' + escape(table['right_caption'] or table['left_caption']) + '</small>'
        body += '</td><td>' + escape(table['matching']) + '</td><td>%d / %d</td><td><ul class="counts">' % (table['left_rows'], table['right_rows'])
        body += ''.join('<li>' + str(count) + ' ' + escape(status.replace('_', ' ')) + '</li>' for status, count in table['counts'].items())
        body += '</ul></td></tr>'
    body += '</tbody></table></div><h2>Read every recorded change</h2><nav aria-label="All change pages">'
    for page in range(1, page_count + 1):
        body += '<a href="pages/page-%05d.html">Changes %d to %d</a>' % (page, (page - 1) * PAGE_ROWS + 1, min(page * PAGE_ROWS, total))
    body += '</nav>' + ('<p>The two retained editions have no recorded content or source changes.</p>' if not total else '')
    _write(directory / 'index.html', _html(title, body))
    body = '<h1>Complete original report files</h1><nav><a href="index.html">Comparison overview</a></nav><div class="table-wrap"><table><thead><tr><th scope="col">Edition / file</th><th scope="col">Bytes</th><th scope="col">SHA256</th></tr></thead><tbody>'
    for side in ('left', 'right'):
        for name, item in record['identity'][side]['members'].items():
            href = side + '/' + quote(name, safe='/')
            body += '<tr><td><a href="' + escape(href, quote=True) + '">' + escape(side + '/' + name) + '</a></td><td>' + str(item['bytes']) + '</td><td class="mono">' + escape(item['sha256']) + '</td></tr>'
    body += '</tbody></table></div>'
    _write(directory / 'files.html', _html('Complete original report files', body))
    return page_count


def build(left, right, destination, *, plan=None, expected_id=None, progress=None):
    """Complete resumable comparison; native callers keep the original Workspace lock."""
    l, r = edition(left), edition(right)
    lt, rt = _tables(l), _tables(r)
    plan = _plan(plan, lt, rt)
    identity = {"schema": SCHEMA, "engine_version": VERSION, "left": l["fingerprint"],
                "right": r["fingerprint"], "plan": plan}
    key = digest(identity)
    if expected_id is not None and expected_id != key:
        raise ValueError("Review the current exact report selections and row keys again")
    destination = _fs.native_path(Path(destination).expanduser()).absolute()
    for value in (l, r):
        source = value["directory"]
        if destination.resolve().is_relative_to(source) or source.is_relative_to(destination.resolve()):
            raise ValueError("Build the comparison outside both original report directories")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = destination.parent / ("." + destination.name + ".building-" + key)
    with _lock(destination.parent / ("." + destination.name + ".lock")):
        if destination.exists():
            record = inspect(destination)
            if record["id"] != key:
                raise ValueError("The destination already contains another saved comparison")
            return record
        _reject_link(destination)
        _reject_link(stage)
        stage.mkdir(exist_ok=True)
        if (stage / "comparison.json").exists():
            record = inspect(stage)
            if record["id"] != key:
                raise ValueError("The completed staging directory contains another comparison")
            _fs.publish_directory(stage, destination)
            return record
        if (stage / "identity.json").exists() and _read(stage / "identity.json") != identity:
            raise ValueError("The interrupted comparison has different input selections")
        _write_json(stage / "identity.json", identity)
        for side, source in (("left", l), ("right", r)):
            for name, item in source["members"].items():
                _copy(source["directory"], item, _path(stage, side + "/" + name, exists=False))
            if progress:
                progress({"stage": "original retained", "side": side, "files": len(source["members"])})
        db = _connect(stage / "changes.sqlite")
        try:
            if not db.execute("SELECT 1 FROM completed WHERE unit='metadata'").fetchone():
                with db:
                    _metadata(db, l, r)
                    db.execute("INSERT INTO completed VALUES('metadata','{}')")
            tables = []
            for table in sorted(set(lt) | set(rt)):
                prior = db.execute("SELECT detail_json FROM completed WHERE unit=?", (table,)).fetchone()
                if prior:
                    result = json.loads(prior[0])
                else:
                    with db:
                        result = _table(db, table, lt.get(table), rt.get(table), plan, progress)
                        db.execute("INSERT INTO completed VALUES(?,?)", (table, canonical(result).decode()))
                tables.append(result)
                if progress:
                    progress({"stage": "table complete", "table": table, "counts": result["counts"]})
            stats = [{"category": c, "status": s, "count": n} for c, s, n in db.execute(
                "SELECT category,status,COUNT(*) FROM changes GROUP BY category,status ORDER BY category,status")]
            record = {"schema": SCHEMA, "id": key, "state": "complete", "identity": identity,
                      "title": "Report changes: " + l["record"]["title"] + " → " + r["record"]["title"],
                      "left": _summary(l), "right": _summary(r), "plan": plan, "tables": tables,
                      "same_project": l["record"]["project_id"] == r["record"]["project_id"],
                      "statistics": stats, "change_count": sum(row["count"] for row in stats)}
            record["page_count"] = _render(stage, record, db)
        finally:
            db.close()
        _write_json(stage / "summary.json", record)
        members = {}
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                name = path.relative_to(stage).as_posix()
                if name == "comparison.json":
                    continue
                if any(part.startswith(".writing-") or part.startswith(".retaining-") for part in path.parts):
                    path.unlink()
                    continue
                members[name] = _descriptor(stage, _path(stage, name))
        _validate_members(members)
        record["files"] = members
        _write_json(stage / "comparison.json", record)
        inspect(stage)
        _fs.publish_directory(stage, destination)
    return record


def identity_for(left, right, plan=None):
    l, r = edition(left), edition(right)
    value = {"schema": SCHEMA, "engine_version": VERSION, "left": l["fingerprint"],
             "right": r["fingerprint"], "plan": _plan(plan, _tables(l), _tables(r))}
    return digest(value)


def inspect(directory, *, cache=None):
    root = _fs.native_path(directory).resolve(strict=True)
    marker = _path(root, "comparison.json")
    signature = _signature(_fs.path_stat(marker))
    cache_key = ("complete-comparison", str(root))
    cached = cache.get(cache_key) if cache is not None else None
    if cached is not None and cached[0] == signature:
        record = cached[1]
        for item in record["files"].values():
            _verify(root, item, cache)
        return deepcopy(record)
    record = _read(marker)
    if (record.get("schema") != SCHEMA or record.get("state") != "complete"
            or digest(record.get("identity")) != _identifier(record.get("id"))
            or _read(_path(root, "identity.json")) != record["identity"]):
        raise ValueError("The completed comparison identity changed")
    _validate_members(record["files"])
    for item in record["files"].values():
        _verify(root, item, cache)
    for side in ("left", "right"):
        source = edition(root / side, cache=cache)
        if source["fingerprint"] != record["identity"][side] or _summary(source) != record[side]:
            raise ValueError("A comparison differs from its original retained edition")
    summary = dict(record)
    summary.pop("files", None)
    if _read(_path(root, "summary.json")) != summary:
        raise ValueError("The comparison summary differs from its completion record")
    if cache is not None:
        cache[cache_key] = (signature, deepcopy(record))
    return record


def members(directory, *, cache=None):
    record = inspect(directory, cache=cache)
    root = _fs.native_path(directory).resolve()
    result = dict(record["files"])
    result["comparison.json"] = _descriptor(root, root / "comparison.json")
    return record, result


def export(directory, archive_path):
    root = _fs.native_path(directory).resolve(strict=True)
    target = _fs.native_path(Path(archive_path).expanduser()).absolute()
    record, selected = members(root)
    if target.resolve().is_relative_to(root):
        raise ValueError("Keep the comparison ZIP outside its retained comparison directory")
    target.parent.mkdir(parents=True, exist_ok=True)
    with _lock(target.with_name("." + target.name + ".lock")):
        if target.exists() or target.is_symlink():
            info = inspect_archive(target)
            if info["comparison_id"] != record["id"] or info["members"] != selected:
                raise ValueError("The existing archive contains another comparison")
            return {"comparison_id": record["id"], **_descriptor(target.parent, target)}
        fd, name = tempfile.mkstemp(prefix=".comparison-", suffix=".zip", dir=target.parent)
        os.close(fd)
        temporary = Path(name)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as out:
                manifest = {"schema": BUNDLE_SCHEMA, "comparison_id": record["id"], "members": selected}
                out.writestr(zipfile.ZipInfo("bundle.json", (1980, 1, 1, 0, 0, 0)), canonical(manifest))
                for name, item in sorted(selected.items()):
                    source = _verify(root, item)
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100600 << 16
                    info.file_size = item["bytes"]
                    checksum, size = hashlib.sha256(), 0
                    with _reader(source) as incoming, out.open(info, "w", force_zip64=True) as outgoing:
                        for block in iter(lambda: incoming.read(CHUNK), b""):
                            size += len(block)
                            checksum.update(block)
                            outgoing.write(block)
                    if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                        raise ValueError("A comparison member changed during ZIP export")
            # Windows FlushFileBuffers requires a writable handle. Reopen the
            # completed ZIP without following a replaced final component.
            with os.fdopen(_fs.open_file(temporary, os.O_RDWR), "r+b") as stream:
                os.fsync(stream.fileno())
            try:
                _fs.publish_file(temporary, target)
            except FileExistsError:
                info = inspect_archive(target)
                if info["comparison_id"] != record["id"] or info["members"] != selected:
                    raise ValueError("A different comparison archive appeared during export")
            _fsync_directory(target.parent)
        finally:
            temporary.unlink(missing_ok=True)
    return {"comparison_id": record["id"], **_descriptor(target.parent, target)}


def inspect_archive(archive_path, *, verify=True, max_members=100000, max_bytes=2 * 1024**4):
    with _reader(archive_path) as incoming, zipfile.ZipFile(incoming) as archive:
        entries = archive.infolist()
        if len(entries) > max_members + 1 or sum(i.file_size for i in entries) > max_bytes:
            raise ValueError("The archive exceeds the configured receiving capacity")
        names = [i.filename for i in entries]
        if len(set(names)) != len(names) or names.count("bundle.json") != 1:
            raise ValueError("The archive repeats a member or lacks its complete manifest")
        for item in entries:
            _name(item.filename)
            mode = item.external_attr >> 16
            if item.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or item.flag_bits & 1:
                raise ValueError("Receive ordinary unencrypted report files only")
        header = archive.getinfo("bundle.json")
        if header.file_size > 32 * 1024**2:
            raise ValueError("The archive member manifest exceeds the receiving capacity")
        result = json.loads(archive.read("bundle.json"), object_pairs_hook=_pairs,
                            parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite manifest value")))
        if result.get("schema") != BUNDLE_SCHEMA:
            raise ValueError("Choose a complete scientific report comparison ZIP")
        _identifier(result.get("comparison_id"))
        selected = result["members"]
        _validate_members(selected)
        if set(names) != {"bundle.json", *selected}:
            raise ValueError("The ZIP differs from its complete declared member set")
        for name, item in selected.items():
            _identifier(item.get("sha256"))
            if archive.getinfo(name).file_size != item["bytes"]:
                raise ValueError("The ZIP member length differs: " + name)
            if verify:
                checksum = hashlib.sha256()
                with archive.open(name) as stream:
                    for block in iter(lambda: stream.read(CHUNK), b""):
                        checksum.update(block)
                if checksum.hexdigest() != item["sha256"]:
                    raise ValueError("The ZIP member differs: " + name)
    return result


def receive(archive_path, destination):
    """Create an independent, byte-complete, re-comparable report pair."""
    archive_path = _fs.native_path(archive_path).resolve(strict=True)
    destination = _fs.native_path(Path(destination).expanduser()).absolute()
    _reject_link(destination)
    manifest = inspect_archive(archive_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.is_relative_to(destination.resolve()):
        raise ValueError("Keep the original archive outside its receiving destination")
    with _lock(destination.with_name("." + destination.name + ".receive.lock")):
        if destination.exists():
            record, selected = members(destination)
            if record["id"] != manifest["comparison_id"] or selected != manifest["members"]:
                raise ValueError("The receiving destination contains different work")
            return record
        stage = destination.with_name("." + destination.name + ".receiving-" + manifest["comparison_id"])
        _reject_link(stage)
        stage.mkdir(exist_ok=True)
        with _reader(archive_path) as incoming, zipfile.ZipFile(incoming) as archive:
            for name, item in manifest["members"].items():
                target = _path(stage, name, exists=False)
                if target.exists():
                    _verify(stage, item)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, temporary_name = tempfile.mkstemp(prefix=".receiving-", dir=target.parent)
                temporary = Path(temporary_name)
                try:
                    checksum, size = hashlib.sha256(), 0
                    with os.fdopen(fd, "wb") as out, archive.open(name) as source:
                        for block in iter(lambda: source.read(CHUNK), b""):
                            size += len(block)
                            checksum.update(block)
                            out.write(block)
                        out.flush()
                        os.fsync(out.fileno())
                    if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                        raise ValueError("A source archive member changed while receiving")
                    try:
                        _fs.publish_file(temporary, target)
                    except FileExistsError:
                        _verify(stage, item)
                    _fsync_directory(target.parent)
                finally:
                    temporary.unlink(missing_ok=True)
        for path in stage.rglob("*"):
            if path.is_file() and path.relative_to(stage).as_posix() not in manifest["members"]:
                if path.name.startswith(".receiving-"):
                    path.unlink()
                else:
                    raise ValueError("The receiving stage contains an undeclared file")
        record = inspect(stage)
        if record["id"] != manifest["comparison_id"]:
            raise ValueError("The received comparison has another identity")
        _fs.publish_directory(stage, destination)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("preview", "build"):
        p = commands.add_parser(command)
        p.add_argument("left", type=Path)
        p.add_argument("right", type=Path)
        if command == "build":
            p.add_argument("destination", type=Path)
            p.add_argument("--plan", type=Path)
            p.add_argument("--expected-id")
    for command in ("inspect", "rows", "export"):
        p = commands.add_parser(command)
        p.add_argument("directory", type=Path)
        if command == "export":
            p.add_argument("archive", type=Path)
        if command == "rows":
            p.add_argument("--after", type=int, default=0)
            p.add_argument("--limit", type=int, default=100)
            p.add_argument("--category")
            p.add_argument("--table-id")
            p.add_argument("--status")
    p = commands.add_parser("receive")
    p.add_argument("archive", type=Path)
    p.add_argument("destination", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "preview":
            result = preview(args.left, args.right)
        elif args.command == "build":
            result = build(args.left, args.right, args.destination,
                           plan=_read(args.plan) if args.plan else None, expected_id=args.expected_id,
                           progress=lambda value: print(json.dumps(value), file=sys.stderr, flush=True))
        elif args.command == "inspect":
            result = inspect(args.directory)
        elif args.command == "rows":
            result = rows(args.directory, after=args.after, limit=args.limit,
                          category=args.category, table_id=args.table_id, status=args.status)
        elif args.command == "export":
            result = export(args.directory, args.archive)
        else:
            result = receive(args.archive, args.destination)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, sqlite3.Error, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": str(exc), "type": type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
