#!/usr/bin/env python3
"""MIT. Capture ACS table-based original rows, or import a verified public capture.

Python 3.10+ standard library. Selection is explicit: release, tables, GEO_IDs.
A completed capture is immutable. --resume continues its identical request.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import urllib.request
import uuid
import zipfile

SCHEMA = "stellar-forge.census-acs-capture.v1"
MANIFEST = "_census/capture-manifest.json"
MAX_TOTAL = 128 * 1024 * 1024
MAX_MEMBERS = 20000
TABLE = re.compile(r"^[BC][0-9]{5}[A-I]?$")
GEO = re.compile(r"^[0-9]{7}US[0-9A-Z]*$")
BASE = "https://www2.census.gov/programs-surveys/acs/summary_file/"


class CaptureError(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def safe_path(value, *, reserved=False):
    if not isinstance(value, str) or not value or len(value) > 600:
        raise CaptureError("CAPTURE_PATH_INVALID")
    parts = value.split("/")
    if any(p in ("", ".", "..") for p in parts) or "\\" in value or ":" in value:
        raise CaptureError("CAPTURE_PATH_INVALID")
    if any(ord(c) < 32 or ord(c) == 127 for c in value) or PurePosixPath(value).is_absolute():
        raise CaptureError("CAPTURE_PATH_INVALID")
    if not reserved and parts[0] == "_census":
        raise CaptureError("CAPTURE_RESERVED_PATH")
    return value


def read_file(path, maximum=MAX_TOTAL):
    path = Path(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
        raise CaptureError("CAPTURE_REGULAR_FILE_REQUIRED")
    with path.open("rb") as stream:
        data = stream.read(maximum + 1)
    after = path.lstat()
    if len(data) != before.st_size or len(data) > maximum or (
        before.st_ino, before.st_mtime_ns, before.st_ctime_ns
    ) != (after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
        raise CaptureError("CAPTURE_SOURCE_CHANGED")
    return data


def write_file(root, name, data):
    safe_path(name, reserved=name == MANIFEST)
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for parent in [path.parent, *path.parents]:
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise CaptureError("CAPTURE_SYMLINK_PATH")
        os.chmod(parent, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return {"path": name, "bytes": len(data), "sha256": digest(data)}


def replace_json(root, name, value):
    temporary = ".pending-" + uuid.uuid4().hex
    write_file(root, temporary, encoded(value))
    os.replace(root / temporary, root / name)


def selection(year, tables, geographies):
    if not isinstance(year, int) or year < 2018 or year >= time.gmtime().tm_year:
        raise CaptureError("ACS_TABLE_BASED_RELEASE_YEAR_REQUIRED")
    tables, geographies = sorted(set(tables)), sorted(set(geographies))
    if not tables or any(not TABLE.fullmatch(t) for t in tables):
        raise CaptureError("ACS_DETAILED_TABLE_IDS_REQUIRED")
    if not geographies or any(not GEO.fullmatch(g) for g in geographies):
        raise CaptureError("ACS_GEO_IDS_REQUIRED")
    return {"year": year, "period": {"start": year - 4, "end": year},
            "tables": tables, "geography_ids": geographies}


def lines(data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CaptureError("ACS_UTF8_REQUIRED") from exc
    values = text.splitlines()
    if not values or not values[0]:
        raise CaptureError("ACS_HEADER_REQUIRED")
    headers = values[0].split("|")
    if len(set(headers)) != len(headers):
        raise CaptureError("ACS_DUPLICATE_HEADER")
    records = []
    for number, value in enumerate(values[1:], 2):
        cells = value.split("|")
        if len(cells) != len(headers):
            raise CaptureError("ACS_ROW_WIDTH_INVALID: line " + str(number))
        records.append(dict(zip(headers, cells)))
    return headers, records


def from_archive(archive):
    raw = read_file(archive)
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        names = [x.filename for x in infos]
        if len(names) != len(set(names)) or len(names) > MAX_MEMBERS:
            raise CaptureError("CAPTURE_ARCHIVE_DUPLICATE_OR_TOO_MANY_MEMBERS")
        if sum(x.file_size for x in infos) > MAX_TOTAL:
            raise CaptureError("CAPTURE_ARCHIVE_TOO_LARGE")
        for info in infos:
            safe_path(info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise CaptureError("CAPTURE_ARCHIVE_MEMBER_INVALID")
        if "public-source-index.json" not in names:
            raise CaptureError("PUBLIC_CAPTURE_INDEX_REQUIRED")
        files = {name: z.read(name) for name in names}
    index = json.loads(files["public-source-index.json"])
    if index.get("schema") not in (
        "census.public-selected-source.v1", "public-census-selected-source.v1"
    ):
        raise CaptureError("PUBLIC_CAPTURE_INDEX_SCHEMA")
    declared = index.get("files")
    if not isinstance(declared, list) or not declared:
        raise CaptureError("PUBLIC_CAPTURE_INVENTORY_REQUIRED")
    seen = set()
    for entry in declared:
        name = safe_path(entry.get("path"))
        if name in seen or name not in files:
            raise CaptureError("PUBLIC_CAPTURE_MEMBER_MISSING_OR_DUPLICATE")
        data = files[name]
        if entry.get("sha256") != digest(data) or entry.get("bytes") != len(data):
            raise CaptureError("PUBLIC_CAPTURE_MEMBER_CHANGED: " + name)
        seen.add(name)
    if set(files) - seen - {"public-source-index.json", "README.md"}:
        raise CaptureError("PUBLIC_CAPTURE_UNDECLARED_MEMBER")
    shells = [p for p in seen if p == "table-shells.txt" or p.endswith("/table-shells.txt")]
    geos = [p for p in seen if p == "geographies.txt" or p.endswith("/geographies.txt")]
    if len(shells) != 1 or len(geos) != 1:
        raise CaptureError("PUBLIC_CAPTURE_TABLE_AND_GEOGRAPHY_FILES_REQUIRED")
    prefix = shells[0][:-len("table-shells.txt")]
    if geos[0] != prefix + "geographies.txt":
        raise CaptureError("PUBLIC_CAPTURE_MIXED_SOURCE_ROOT")
    table_ids = sorted(re.fullmatch(re.escape(prefix) + r"table-([BC][0-9]{5}[A-I]?)\.txt", p).group(1)
                       for p in seen
                       if re.fullmatch(re.escape(prefix) + r"table-([BC][0-9]{5}[A-I]?)\.txt", p))
    _, geography_rows = lines(files[geos[0]])
    geo_ids = [row["GEO_ID"] for row in geography_rows]
    year = index.get("year", index.get("release_year"))
    picked = selection(year, table_ids, geo_ids)
    if index.get("geography_ids") is not None and sorted(index["geography_ids"]) != picked["geography_ids"]:
        raise CaptureError("PUBLIC_CAPTURE_GEOGRAPHY_SELECTION_CHANGED")
    if isinstance(index.get("tables"), list) and sorted(index["tables"]) != picked["tables"]:
        raise CaptureError("PUBLIC_CAPTURE_TABLE_SELECTION_CHANGED")
    for table in picked["tables"]:
        name = prefix + "table-" + table + ".txt"
        _, rows = lines(files[name])
        if sorted(row["GEO_ID"] for row in rows) != picked["geography_ids"]:
            raise CaptureError("ACS_TABLE_GEOGRAPHIES_INCOMPLETE: " + table)
        receipt = json.loads(files[prefix + "table-" + table + ".capture.json"])
        if receipt.get("selected_sha256") != digest(files[name]) or receipt.get("selected_bytes") != len(files[name]):
            raise CaptureError("ACS_SELECTED_ROW_RECEIPT_CHANGED: " + table)
        if receipt.get("complete_for_requested_ids") is not True:
            raise CaptureError("ACS_SELECTION_INCOMPLETE: " + table)
    return picked, prefix, files, {"kind": "retained-public-archive",
        "sourceArchive": {"sha256": digest(raw), "bytes": len(raw)}}


def native_package(path, picked, files):
    raw = read_file(path)
    value = json.loads(raw)
    if value.get("schema") != "tjlabs.peoria-housing.acs-source-edition.v1":
        raise CaptureError("NATIVE_CAPTURE_PACKAGE_SCHEMA")
    for key in ("year", "period", "tables", "geography_ids"):
        actual = value.get(key)
        if key in ("tables", "geography_ids") and isinstance(actual, list):
            actual = sorted(actual)
        if actual != picked[key]:
            raise CaptureError("NATIVE_CAPTURE_SELECTION_CHANGED: " + key)
    seen = set()
    for record in value.get("files", []):
        name = safe_path(record.get("path"))
        if name in seen or record.get("encoding") != "base64":
            raise CaptureError("NATIVE_CAPTURE_MEMBER_INVALID")
        seen.add(name)
        try:
            data = base64.b64decode(record["content"], validate=True)
        except (ValueError, KeyError) as exc:
            raise CaptureError("NATIVE_CAPTURE_ENCODING_INVALID") from exc
        if len(data) != record.get("bytes") or digest(data) != record.get("sha256"):
            raise CaptureError("NATIVE_CAPTURE_MEMBER_CHANGED")
        matches = [p for p in files if p == name or p.endswith("/" + name)]
        if len(matches) != 1 or files[matches[0]] != data:
            raise CaptureError("NATIVE_CAPTURE_DOES_NOT_MATCH_PUBLIC_SOURCE: " + name)
    if not seen:
        raise CaptureError("NATIVE_CAPTURE_EMPTY")
    return raw


def write_once_exact(root, name, data):
    path = root / name
    if path.exists():
        if read_file(path) != data:
            raise CaptureError("CAPTURE_IMMUTABLE_FILE_CHANGED: " + name)
        return {"path": name, "bytes": len(data), "sha256": digest(data)}
    return write_file(root, name, data)


def finish(root, picked, source_prefix, members, provenance, annotations=()):
    if any(item["year"] != picked["year"] for item in annotations):
        raise CaptureError("ANNOTATION_RELEASE_YEAR_CHANGED")
    manifest = {"schema": SCHEMA, **picked, "source_prefix": source_prefix,
                "files": sorted(members, key=lambda x: x["path"]),
                "annotations": list(annotations), "provenance": provenance}
    data = encoded(manifest)
    write_once_exact(root, MANIFEST, data)
    source = {"schema": "stellar-forge.census-acs-source.v1",
              "capture": MANIFEST, "captureSha256": digest(data)}
    write_once_exact(root, "source.json", encoded(source))
    return {"source": str(root / "source.json"), "capture_id": digest(data),
            "year": picked["year"], "tables": len(picked["tables"]),
            "geographies": len(picked["geography_ids"]), "files": len(members)}


def add_annotations(root, specs, members):
    result = []
    used = {row["path"] for row in members}
    for spec_file in specs:
        spec = json.loads(read_file(spec_file))
        if not isinstance(spec, dict) or set(spec) != {"year", "file", "source_url", "receipt"} or not isinstance(spec["year"], int):
            raise CaptureError("ANNOTATION_SPEC_INVALID")
        from urllib.parse import urlparse
        url = urlparse(spec["source_url"])
        if url.scheme != "https" or url.hostname not in ("www.census.gov", "www2.census.gov") or url.username or url.password:
            raise CaptureError("ANNOTATION_CENSUS_SOURCE_REQUIRED")
        base = Path(spec_file).resolve().parent
        path = base / spec["file"]
        name = "annotations/" + path.name
        safe_path(name)
        if name in used:
            raise CaptureError("ANNOTATION_PATH_DUPLICATE")
        raw = read_file(path)
        record = write_once_exact(root, name, raw)
        members.append(record); used.add(name)
        receipt_raw = read_file(base / spec["receipt"])
        receipt = json.loads(receipt_raw)
        if receipt.get("url") != spec["source_url"] or receipt.get("status") != 200 or (
            receipt.get("sha256") != record["sha256"] or receipt.get("bytes") != record["bytes"]
        ):
            raise CaptureError("ANNOTATION_CAPTURE_RECEIPT_CHANGED")
        receipt_name = name + ".capture.json"
        members.append(write_once_exact(root, receipt_name, receipt_raw))
        item = {"path": name, "sha256": record["sha256"], "year": spec["year"],
                "source_url": spec["source_url"], "receipt_path": receipt_name}
        expected = "https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/" + str(spec["year"]) + "_Jam_Values.xlsx"
        if spec["source_url"] == expected:
            from jam_values import normalize_workbook
            normalized = normalize_workbook(raw, year=spec["year"], workbook_path=name, source_url=spec["source_url"])
            item["normalized_path"] = name + ".normalized.json"
            members.append(write_once_exact(root, item["normalized_path"], encoded(normalized)))
        result.append(item)
    return result

def import_capture(args):
    picked, prefix, files, provenance = from_archive(args.archive)
    if args.native_package:
        files["native-source-package.json"] = native_package(args.native_package, picked, files)
    if sum(map(len, files.values())) > MAX_TOTAL:
        raise CaptureError("CAPTURE_TOO_LARGE")
    root = Path(args.out).absolute()
    root.mkdir(parents=True, mode=0o700, exist_ok=False)
    if root.resolve() != root:
        raise CaptureError("CAPTURE_SYMLINK_PATH")
    members = [write_file(root, name, files[name]) for name in sorted(files)]
    annotations = add_annotations(root, args.annotation, members)
    return finish(root, picked, prefix, members, provenance, annotations)


def retrieve_rows(url, requested, key, *, unique, timeout, max_response_bytes, max_selected_bytes):
    """Keep each selected original record including its original line ending.

    stream_sha256 describes bytes actually consumed, which may be a prefix.
    selected_sha256 describes the exact retained header and selected row bytes.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "StellarForge-CensusACS/1.0",
                                                   "Accept-Encoding": "identity"})
    start = time.monotonic()
    stamp = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    started = stamp()
    desired, found = set(requested), set()
    retained, stream_hash = bytearray(), hashlib.sha256()
    total, rows, kept, complete = 0, 0, 0, False
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise CaptureError("ACS_HTTP_STATUS_" + str(response.status))
        from urllib.parse import urlparse
        resolved = response.geturl()
        u = urlparse(resolved)
        if u.scheme != "https" or u.hostname != "www2.census.gov":
            raise CaptureError("ACS_SOURCE_REDIRECT_CHANGED")
        headers = dict(response.headers.items())
        first = response.readline(2 * 1024 * 1024 + 1)
        total += len(first); stream_hash.update(first)
        columns = first.decode("utf-8-sig").rstrip("\r\n").split("|")
        if len(first) > 2 * 1024 * 1024 or key not in columns or len(set(columns)) != len(columns):
            raise CaptureError("ACS_SOURCE_HEADER_INVALID")
        position = columns.index(key)
        retained.extend(first)
        while True:
            if time.monotonic() - start > timeout:
                raise CaptureError("ACS_CAPTURE_TIMEOUT")
            line = response.readline(2 * 1024 * 1024 + 1)
            if not line:
                complete = True
                break
            total += len(line); stream_hash.update(line); rows += 1
            if len(line) > 2 * 1024 * 1024 or total > max_response_bytes:
                raise CaptureError("ACS_RESPONSE_LIMIT")
            cells = line.decode("utf-8").rstrip("\r\n").split("|")
            if len(cells) != len(columns):
                raise CaptureError("ACS_SOURCE_ROW_WIDTH_INVALID")
            value = cells[position]
            if value not in desired:
                continue
            if unique and value in found:
                raise CaptureError("ACS_DUPLICATE_GEOGRAPHY")
            retained.extend(line); found.add(value); kept += 1
            if len(retained) > max_selected_bytes:
                raise CaptureError("ACS_SELECTED_ROWS_LIMIT")
            if unique and found == desired:
                break
        if found != desired:
            raise CaptureError("ACS_REQUESTED_SELECTION_UNAVAILABLE: " + ",".join(sorted(desired - found)))
    data = bytes(retained)
    receipt = {"url": url, "resolved_url": resolved, "status": 200,
               "response_headers": headers, "started_at": started, "retrieved_at": stamp(),
               "selection_key": key, "requested_ids": sorted(desired), "retained_rows": kept,
               "complete_for_requested_ids": True, "complete_stream": complete,
               "selected_bytes": len(data), "selected_sha256": digest(data),
               "stream_bytes_read": total, "stream_rows_read": rows,
               "stream_sha256": stream_hash.hexdigest()}
    return data, receipt



def capture_annotations(root, year, timeout):
    """Retain the release's original Jam Values workbook and its HTTP capture."""
    url = ("https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/"
           + str(year) + "_Jam_Values.xlsx")
    name = str(year) + "_Jam_Values.xlsx"
    receipt_name = name + ".capture.json"
    if (root / receipt_name).exists():
        raw = read_file(root / name, 16 * 1024 * 1024)
        receipt = json.loads(read_file(root / receipt_name))
        if (receipt.get("url") != url or receipt.get("final_url") != url
                or receipt.get("status") != 200
                or receipt.get("bytes") != len(raw)
                or receipt.get("sha256") != digest(raw)):
            raise CaptureError("ANNOTATION_RESUME_MEMBER_CHANGED")
    else:
        request = urllib.request.Request(url, headers={
            "User-Agent": "StellarForge-CensusACS/1.0", "Accept-Encoding": "identity"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200 or response.geturl() != url:
                raise CaptureError("ANNOTATION_SOURCE_RESPONSE_CHANGED")
            raw = response.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise CaptureError("ANNOTATION_SOURCE_TOO_LARGE")
            receipt = {"url": url, "final_url": response.geturl(), "status": 200,
                       "bytes": len(raw), "sha256": digest(raw),
                       "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "response_headers": dict(response.headers.items())}
        write_once_exact(root, name, raw)
        write_once_exact(root, receipt_name, encoded(receipt))
    spec_name = "annotation-spec-" + str(year) + ".json"
    write_once_exact(root, spec_name, encoded({
        "year": year, "file": name, "receipt": receipt_name, "source_url": url}))
    return str(root / spec_name)


def capture(args):
    picked = selection(args.year, args.table, args.geo)
    request = {"schema": "stellar-forge.census-acs-request.v1", **picked}
    root = Path(args.out).absolute()
    if args.resume:
        if root.resolve() != root or not root.is_dir():
            raise CaptureError("CAPTURE_DIRECTORY_INVALID")
        if json.loads(read_file(root / "capture-request.json")) != request:
            raise CaptureError("CAPTURE_RESUME_REQUEST_CHANGED")
        if (root / "source.json").exists():
            value = json.loads(read_file(root / "source.json"))
            raw = read_file(root / MANIFEST)
            if value["captureSha256"] != digest(raw):
                raise CaptureError("CAPTURE_MANIFEST_CHANGED")
            manifest = json.loads(raw)
            for record in manifest["files"]:
                data = read_file(root / safe_path(record["path"]))
                if len(data) != record["bytes"] or digest(data) != record["sha256"]:
                    raise CaptureError("CAPTURE_FILE_CHANGED")
            return {"source": str(root / "source.json"), "capture_id": digest(raw), "reopened": True}
    else:
        root.mkdir(parents=True, mode=0o700, exist_ok=False)
        if root.resolve() != root:
            raise CaptureError("CAPTURE_SYMLINK_PATH")
        write_file(root, "capture-request.json", encoded(request))
    base = BASE + str(args.year) + "/table-based-SF/"
    operations = [
        ("table-shells", base + "documentation/ACS" + str(args.year) + "5YR_Table_Shells.txt",
         picked["tables"], "Table ID", False),
        ("geographies", base + "documentation/Geos" + str(args.year) + "5YR.txt",
         picked["geography_ids"], "GEO_ID", True),
    ] + [("table-" + t, base + "data/5YRData/acsdt5y" + str(args.year) + "-" + t.lower() + ".dat",
          picked["geography_ids"], "GEO_ID", True) for t in picked["tables"]]
    members = []
    for name, url, ids, key, unique in operations:
        data_file, receipt_file = name + ".txt", name + ".capture.json"
        try:
            if (root / receipt_file).exists():
                data = read_file(root / data_file)
                receipt = json.loads(read_file(root / receipt_file))
                if receipt.get("url") != url or receipt.get("requested_ids") != sorted(ids) or (
                    receipt.get("selected_sha256") != digest(data)
                    or receipt.get("selected_bytes") != len(data)
                    or receipt.get("complete_for_requested_ids") is not True
                ):
                    raise CaptureError("CAPTURE_RESUME_MEMBER_CHANGED")
            else:
                # A completed data write without its receipt is not a completed fetch.
                if (root / data_file).exists():
                    os.replace(root / data_file, root / (name + ".uncompleted-" + uuid.uuid4().hex))
                data, receipt = retrieve_rows(
                    url, ids, key, unique=unique, timeout=args.timeout,
                    max_response_bytes=args.max_response_bytes, max_selected_bytes=args.max_selected_bytes)
                write_file(root, data_file, data)
                write_file(root, receipt_file, encoded(receipt))
            for member in (data_file, receipt_file):
                raw = read_file(root / member)
                members.append({"path": member, "bytes": len(raw), "sha256": digest(raw)})
            if sum(item["bytes"] for item in members) > MAX_TOTAL:
                raise CaptureError("CAPTURE_TOTAL_SIZE_LIMIT")
            replace_json(root, "capture-progress.json", {"request": request, "complete": name,
                         "completed_files": len(members), "error": None})
            print(json.dumps({"captured": name, "selected_bytes": len(data)}), file=sys.stderr, flush=True)
        except Exception as exc:
            replace_json(root, "capture-progress.json", {"request": request, "error": str(exc),
                         "operation": name, "completed_files": len(members)})
            raise
    annotation_specs = args.annotation or ([capture_annotations(root, args.year, args.timeout)]
                                          if args.year in (2022, 2023, 2024) else [])
    annotations = add_annotations(root, annotation_specs, members)
    return finish(root, picked, "", members, {"kind": "original-table-based-summary-file-selected-rows",
                  "source_root": base}, annotations)


def activate_capture(args):
    """Review and atomically select a capture for one fixed publisher source."""
    import fcntl
    capture_root = Path(args.capture).absolute()
    if capture_root.resolve() != capture_root:
        raise CaptureError("CAPTURE_SYMLINK_PATH")
    declaration = json.loads(read_file(capture_root / "source.json"))
    if declaration.get("schema") != "stellar-forge.census-acs-source.v1" or declaration.get("capture") != MANIFEST:
        raise CaptureError("ORIGINAL_CAPTURE_DIRECTORY_REQUIRED")
    raw = read_file(capture_root / MANIFEST)
    if digest(raw) != declaration.get("captureSha256"):
        raise CaptureError("CAPTURE_MANIFEST_CHANGED")
    manifest = json.loads(raw)
    if manifest.get("schema") != SCHEMA:
        raise CaptureError("CAPTURE_MANIFEST_SCHEMA")
    for record in manifest["files"]:
        data = read_file(capture_root / safe_path(record["path"]))
        if len(data) != record["bytes"] or digest(data) != record["sha256"]:
            raise CaptureError("CAPTURE_FILE_CHANGED")
    source = Path(args.source).absolute()
    source.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if source.parent.resolve() != source.parent:
        raise CaptureError("SOURCE_POINTER_SYMLINK_PATH")
    try:
        relative = (capture_root / MANIFEST).relative_to(source.parent).as_posix()
    except ValueError as exc:
        raise CaptureError("CAPTURE_MUST_BE_INSIDE_SOURCE_PROJECT") from exc
    if source == capture_root / "source.json":
        raise CaptureError("CAPTURE_SOURCE_IS_IMMUTABLE")
    lock = source.parent / ("." + source.name + ".census-lock")
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "rb+") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            raise CaptureError("SOURCE_POINTER_LOCK_INVALID")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        previous = None
        if source.exists():
            previous = read_file(source)
            current = json.loads(previous)
            if args.create or current.get("schema") != "stellar-forge.census-acs-source.v1":
                raise CaptureError("SOURCE_POINTER_EXISTS")
            if not args.expect_source_sha or digest(previous) != args.expect_source_sha:
                raise CaptureError("SOURCE_POINTER_REVIEW_CHANGED")
        elif not args.create or args.expect_source_sha:
            raise CaptureError("SOURCE_POINTER_CREATE_REQUIRED")
        value = {"schema": "stellar-forge.census-acs-source.v1",
                 "capture": relative, "captureSha256": digest(raw)}
        data = encoded(value)
        if previous != data:
            temporary = ".source-pending-" + uuid.uuid4().hex
            write_file(source.parent, temporary, data)
            os.replace(source.parent / temporary, source)
            directory = os.open(source.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return {"source": str(source), "source_sha256": digest(data),
                "capture_id": digest(raw), "year": manifest["year"], "changed": previous != data}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    active = commands.add_parser("activate", help="Select a retained capture for a fixed publisher source")
    active.add_argument("--capture", required=True)
    active.add_argument("--source", required=True)
    active.add_argument("--create", action="store_true")
    active.add_argument("--expect-source-sha")
    imp = commands.add_parser("import", help="Retain and verify an existing public source ZIP")
    imp.add_argument("--archive", required=True)
    imp.add_argument("--native-package", help="Optional original customer-compatible capture JSON")
    cap = commands.add_parser("capture", help="Stream original public five-year table-based files")
    cap.add_argument("--year", required=True, type=int)
    cap.add_argument("--table", action="append", required=True)
    cap.add_argument("--geo", action="append", required=True)
    cap.add_argument("--resume", action="store_true")
    cap.add_argument("--timeout", type=int, default=300)
    cap.add_argument("--max-response-bytes", type=int, default=1024 * 1024 * 1024)
    cap.add_argument("--max-selected-bytes", type=int, default=MAX_TOTAL)
    for command in (imp, cap):
        command.add_argument("--out", required=True, help="New immutable capture directory")
        command.add_argument("--annotation", action="append", default=[],
                             help="JSON {year,file,receipt,source_url}; retain matching official annotation source")
    args = parser.parse_args(argv)
    if args.command == "capture" and any(getattr(args, key) <= 0 for key in
            ("timeout", "max_response_bytes", "max_selected_bytes")):
        parser.error("limits must be positive integers")
    result = activate_capture(args) if args.command == "activate" else import_capture(args) if args.command == "import" else capture(args)
    print(json.dumps(result,
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (CaptureError, OSError, ValueError, KeyError, zipfile.BadZipFile) as issue:
        print("CENSUS_CAPTURE: " + str(issue), file=sys.stderr)
        raise SystemExit(1)
