"""Receive exact members of the original USGS seasonal-load archive.

The scientific definitions remain in source_tools.usgs_loads. This module
receives an already available original ZIP or its legitimate download URL.
"""
from __future__ import annotations

import argparse
from collections import Counter, OrderedDict
import contextlib
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib

from model.common import atomic_bytes, atomic_json, canonical, digest, held, now, read_json

DOI = "10.5066/P13YSTHM"
ITEM = "6675b4dbd34e6f159fd10baf"
ARCHIVE_BYTES = 1897877062
ARCHIVE_MD5 = "2dc4d81994c4fcbf7d27728eb16fdaef"
HEADERS = ("Content-Type", "Content-Length", "Content-Range", "Content-Encoding",
           "ETag", "Last-Modified", "Content-Disposition", "Accept-Ranges")
RANGE_BYTES = 4 * 1024 * 1024
MAX_DIRECTORY_BYTES = 64 * 1024 * 1024


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _stat(path):
    s = Path(path).lstat()
    if not stat.S_ISREG(s.st_mode):
        raise ValueError("Select an original regular archive file")
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def _path(name):
    if not isinstance(name, str) or "\\" in name or "\0" in name:
        raise ValueError("Archive member has an unsupported path")
    p = PurePosixPath(name)
    if (not p.parts or p.is_absolute() or ".." in p.parts
            or str(p) != name or ":" in p.parts[0]):
        raise ValueError("Archive member must remain below the receiving directory")
    return p


def _target(root, name):
    p = _path(name)
    result = root.joinpath(*p.parts)
    for parent in (result, *result.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError("Receiving paths must not follow filesystem aliases")
    return result


def _spec(path):
    raw = Path(path).read_bytes()
    value = json.loads(raw)
    a = value.get("original_archive", {})
    checksum = a.get("publisher_checksum", {})
    if (value.get("schema") != "upstate.usgs-seasonal-loads-source-capture/v1"
            or value.get("doi") != DOI or value.get("sciencebase_item_id") != ITEM
            or a.get("name") != "data_release3.zip" or a.get("bytes") != ARCHIVE_BYTES
            or checksum.get("type") != "MD5" or checksum.get("value") != ARCHIVE_MD5):
        raise ValueError("Select the retained original P13YSTHM source capture")
    return value, raw


def _header_record(response):
    return {k: response.headers[k] for k in HEADERS if k in response.headers}


def _download_url(url):
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != "https" or not parts.hostname
            or parts.username is not None or parts.password is not None):
        raise ValueError("Select the original HTTPS download URL")
    return parts


def _url_record(url):
    parts = urllib.parse.urlsplit(url)
    return {"sha256": _sha(url.encode("utf-8")), "scheme": parts.scheme,
            "host": parts.hostname, "path_sha256": _sha(parts.path.encode("utf-8")),
            "has_query": bool(parts.query)}


class _ArchiveRedirect(urllib.request.HTTPRedirectHandler):
    """Retain the actual redirect chain without publishing temporary credentials."""

    def __init__(self, on_receipt):
        super().__init__()
        self.on_receipt = on_receipt

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urljoin(req.full_url, newurl)
        record = {"event": "archive_redirect", "observed_at": now(),
                  "method": req.get_method(), "status": code,
                  "requested_range": req.get_header("Range"),
                  "requested_if_match": req.get_header("If-match"),
                  "source": _url_record(req.full_url), "target": _url_record(target),
                  "headers": {k: headers[k] for k in HEADERS if k in headers}}
        try:
            _download_url(target)
            redirected = super().redirect_request(req, fp, code, msg, headers, target)
            if redirected is None or redirected.get_method() != "GET":
                raise ValueError("Original archive redirects must preserve the signed GET method")
        except BaseException as error:
            record.update(outcome="rejected", error_type=type(error).__name__)
            self.on_receipt(record)
            raise
        record["outcome"] = "followed"
        self.on_receipt(record)
        return redirected


def _entity(response, expected_size):
    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
        raise ValueError("ZIP ranges require the original unencoded HTTP entity")
    mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if mime in ("text/html", "application/xhtml+xml"):
        raise ValueError("Select the actual file from the existing publisher download session")
    if response.status == 200:
        raw = response.headers.get("Content-Length")
        if raw is None or not raw.isascii() or not raw.isdecimal() or int(raw) != expected_size:
            raise ValueError("The original download must report its exact archive length")
    etag = response.headers.get("ETag", "").strip()
    if re.fullmatch(r'"[\x21\x23-\x7e\x80-\xff]*"', etag) is None:
        raise ValueError("Use a retained whole archive when its endpoint has no strong ETag")
    _download_url(response.url)
    return etag


class RangeArchive(io.RawIOBase):
    """Seek the publisher's original ZIP using conditional byte-range GETs."""

    def __init__(self, url, size, on_receipt):
        super().__init__()
        _download_url(url)
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ValueError("Select the original positive archive byte count")
        self.url = url
        self.size = size
        self.pos = 0
        self.cache = OrderedDict()
        self.on_receipt = on_receipt
        self._opener = urllib.request.build_opener(_ArchiveRedirect(on_receipt))
        # A publisher-issued S3 download can be signed specifically for GET.
        # Probe the same method used for members; HEAD is a different signature.
        request = urllib.request.Request(url, method="GET", headers={
            "Range": "bytes=0-0", "Accept-Encoding": "identity",
            "User-Agent": "Commons-Upper-Savannah-Source/1.0"})
        with self._request(request) as r:
            record = self._response_record(request, r, "archive_range_bootstrap")
            record.update(requested_start=0, requested_end=0, expected_archive_bytes=size,
                          body_bytes_read=0, complete_archive_retained=False)
            try:
                if r.status == 200:
                    record.update(outcome="range_unsupported",
                                  response_kind="whole_body_response",
                                  next_source_mode="verified_complete_archive")
                    # Close this response without starting a duplicate whole download.
                    # Its headers are evidence of the response, not a received ZIP.
                    raise ValueError(
                        "Publisher returned HTTP200 to the one-byte GET range. "
                        "Continue its existing whole-file capture and use --archive.")
                if r.status != 206:
                    raise ValueError("Original archive GET probe must return HTTP206")
                expected = "bytes 0-0/%d" % size
                if r.headers.get("Content-Range") != expected:
                    raise ValueError("GET probe must report the exact original archive total")
                etag = _entity(r, size)
                length = r.headers.get("Content-Length")
                if length is not None and (not length.isascii() or not length.isdecimal()
                                           or int(length) != 1):
                    raise ValueError("GET probe must report one response byte")
                data = r.read(2)
                record.update(body_bytes_read=len(data), body_sha256=_sha(data))
                if len(data) != 1:
                    raise ValueError("The original one-byte GET probe is incomplete or oversized")
                self.etag = etag
                self.final_url = r.url
                self.identity = {"kind": "conditional_http_ranges", "bytes": size,
                                 "etag": self.etag,
                                 "last_modified": r.headers.get("Last-Modified"),
                                 "download_url_sha256": _sha(url.encode("utf-8")),
                                 "final_url_sha256": _sha(r.url.encode("utf-8"))}
                self.cache[(0, 0)] = data
                record.update(outcome="accepted", response_kind="exact_archive_range",
                              identity=self.identity)
            except BaseException as error:
                record.setdefault("outcome", "rejected")
                record["error_type"] = type(error).__name__
                self.on_receipt(record)
                raise
            self.on_receipt(record)

    def _response_record(self, request, response, event):
        return {"event": event, "method": request.get_method(), "observed_at": now(),
                "status": response.status, "headers": _header_record(response),
                "requested_range": request.get_header("Range"),
                "requested_if_match": request.get_header("If-match"),
                "source": _url_record(self.url), "request": _url_record(request.full_url),
                "response": _url_record(response.url),
                "redirected": request.full_url != response.url}

    def _request(self, request):
        try:
            return self._opener.open(request, timeout=60)
        except urllib.error.HTTPError as error:
            record = self._response_record(request, error, "archive_http_error")
            record.update(outcome="http_error", error_type=type(error).__name__,
                          body_bytes_read=0, complete_archive_retained=False)
            try:
                self.on_receipt(record)
            finally:
                error.close()
            raise
        except urllib.error.URLError as error:
            self.on_receipt({"event": "archive_transport_error", "observed_at": now(),
                             "method": request.get_method(),
                             "requested_range": request.get_header("Range"),
                             "request": _url_record(request.full_url),
                             "error_type": type(error).__name__})
            raise

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        selected = offset if whence == io.SEEK_SET else (
            self.pos + offset if whence == io.SEEK_CUR else (
                self.size + offset if whence == io.SEEK_END else None))
        if selected is None or selected < 0:
            raise ValueError("Invalid original archive offset")
        self.pos = selected
        return selected

    def _range(self, start, end):
        for key, data in list(self.cache.items()):
            if key[0] <= start and end <= key[1]:
                self.cache.move_to_end(key)
                return data[start-key[0]:end-key[0]+1]
        request = urllib.request.Request(self.final_url, headers={
            "Range": "bytes=%d-%d" % (start, end), "If-Match": self.etag,
            "Accept-Encoding": "identity", "User-Agent": "Commons-Upper-Savannah-Source/1.0"})
        with self._request(request) as r:
            record = self._response_record(request, r, "archive_member_range")
            record.update(start=start, end=end, body_bytes_read=0,
                          complete_archive_retained=False)
            try:
                if r.status != 206:
                    if r.status == 200:
                        record.update(outcome="range_unsupported",
                                      response_kind="whole_body_response",
                                      next_source_mode="verified_complete_archive")
                    raise ValueError("Use the retained whole archive when byte ranges are unsupported")
                expected = "bytes %d-%d/%d" % (start, end, self.size)
                if r.headers.get("Content-Range") != expected:
                    raise ValueError("The returned range does not match the original offset and archive")
                if _entity(r, self.size) != self.etag or r.url != self.final_url:
                    raise ValueError("Original download identity changed between archive ranges")
                data = r.read(end-start+2)
                record.update(body_bytes_read=len(data), sha256=_sha(data))
                if len(data) != end-start+1:
                    raise ValueError("The original archive range is incomplete or oversized")
                record.update(outcome="accepted", bytes=len(data))
            except BaseException as error:
                record.setdefault("outcome", "rejected")
                record["error_type"] = type(error).__name__
                self.on_receipt(record)
                raise
            self.on_receipt(record)
        if len(data) <= RANGE_BYTES:
            self.cache[(start, end)] = data
            while len(self.cache) > 4:
                self.cache.popitem(last=False)
        return data

    def read(self, size=-1):
        if self.pos >= self.size:
            return b""
        if size is None or size < 0:
            size = self.size-self.pos
        size = min(size, self.size-self.pos)
        if size > MAX_DIRECTORY_BYTES:
            raise ValueError("Read the original archive through streaming ZIP members")
        output = []
        while size:
            count = min(size, RANGE_BYTES)
            output.append(self._range(self.pos, self.pos+count-1))
            self.pos += count
            size -= count
        return b"".join(output)


@contextlib.contextmanager
def _open_archive(capture, archive, access_file, on_receipt):
    if archive is not None:
        path = Path(archive)
        before = _stat(path)
        if before[2] != ARCHIVE_BYTES:
            raise ValueError("Original P13YSTHM archive byte count differs")
        md5, sha = hashlib.md5(), hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024*1024), b""):
                md5.update(block)
                sha.update(block)
            if _stat(path) != before or md5.hexdigest() != ARCHIVE_MD5:
                raise ValueError("Original full archive does not match the publisher checksum")
            source.seek(0)
            identity = {"kind": "verified_complete_archive", "bytes": before[2],
                        "md5": md5.hexdigest(), "sha256": sha.hexdigest()}
            on_receipt({"method": "local_file", "observed_at": now(), "identity": identity})
            yield source, identity
            if _stat(path) != before:
                raise ValueError("Original archive changed during receiving")
    else:
        url = (Path(access_file).read_text(encoding="utf-8").strip()
               if access_file else capture["original_archive"]["url"])
        with RangeArchive(url, ARCHIVE_BYTES, on_receipt) as source:
            yield source, source.identity


def _member(info, index):
    name = info.filename
    safe = True
    reason = None
    if not info.is_dir():
        try:
            _path(name)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("Archive symlink")
            if info.flag_bits & 1:
                raise ValueError("Encrypted archive member")
        except ValueError as error:
            safe, reason = False, str(error)
    return {"index": index, "name": name, "directory": info.is_dir(),
            "bytes": info.file_size, "compressed_bytes": info.compress_size,
            "compression": info.compress_type, "crc32": "%08x" % info.CRC,
            "header_offset": info.header_offset, "flags": info.flag_bits,
            "date_time": list(info.date_time), "safe_to_receive": safe,
            "path_review": reason}


def _inventory(z, raw, identity, capture, output, capture_bytes):
    if ARCHIVE_BYTES-z.start_dir > MAX_DIRECTORY_BYTES:
        raise ValueError("Original ZIP directory exceeds the supported retained directory size")
    position = raw.tell()
    raw.seek(z.start_dir)
    directory = raw.read(ARCHIVE_BYTES-z.start_dir)
    raw.seek(position)
    records = [_member(info, i) for i, info in enumerate(z.infolist())]
    names = [x["name"] for x in records if not x["directory"]]
    duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
    value = {"schema": "upstate.usgs-archive-inventory/v1", "doi": DOI,
             "source_capture_sha256": _sha(capture_bytes),
             "publisher_archive": {key: capture["original_archive"][key] for key in
                 ("name", "bytes", "publisher_checksum", "date_uploaded", "url")},
             "archive_identity": identity, "directory_offset": z.start_dir,
             "directory_bytes": len(directory), "directory_sha256": _sha(directory),
             "members": records, "duplicate_names": duplicates}
    value["id"] = digest(value)
    existing = output/"archive-inventory.json"
    if existing.exists():
        previous = read_json(existing)
        # URL renewal can retain the same exact object and directory.
        comparable = ("doi", "source_capture_sha256", "directory_offset", "directory_bytes",
                      "directory_sha256", "members", "duplicate_names")
        if any(previous[k] != value[k] for k in comparable):
            raise ValueError("Use a new receiving directory for a different original archive")
        old_identity = previous["archive_identity"]
        if (old_identity["kind"] == identity["kind"] == "conditional_http_ranges"
                and old_identity["etag"] != identity["etag"]):
            raise ValueError("The original download ETag changed; select a fresh receiving directory")
        if (old_identity["kind"] == "verified_complete_archive"
                and (identity["kind"] != old_identity["kind"]
                     or identity["sha256"] != old_identity["sha256"])):
            raise ValueError("Continue receiving from the same verified original archive")
        directory_path = output/"archive-directory.bin"
        if (not directory_path.is_file() or _sha(directory_path.read_bytes()) != _sha(directory)):
            raise ValueError("The retained original ZIP directory differs")
        value = previous
    else:
        atomic_bytes(output/"archive-directory.bin", directory, immutable=True)
        atomic_json(existing, value, immutable=True)
    atomic_bytes(output/"original-source-capture.json", capture_bytes, immutable=True)
    return value


def _survey(path):
    if path.suffix.lower() != ".csv":
        return None
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            rows, widths = 0, {}
            for row in reader:
                rows += 1
                widths[str(len(row))] = widths.get(str(len(row)), 0)+1
        return {"encoding": "utf-8-sig", "delimiter": ",", "columns": header,
                "rows": rows, "row_width_counts": widths}
    except (UnicodeError, csv.Error) as error:
        return {"encoding": "unresolved", "error": type(error).__name__}


def _publish_file(partial, destination):
    os.replace(partial, destination)
    for directory in {partial.parent, destination.parent}:
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def _file_hash(path):
    sha, crc, count = hashlib.sha256(), 0, 0
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            sha.update(block)
            crc = zlib.crc32(block, crc)
            count += len(block)
    return {"bytes": count, "sha256": sha.hexdigest(), "crc32": "%08x" % (crc & 0xffffffff)}


def _receive(z, inventory, names, output, maximum_bytes):
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) for name in names)
            or len(names) != len(set(names))):
        raise ValueError("Select distinct actual file names from archive-inventory.json")
    if not isinstance(maximum_bytes, int) or maximum_bytes <= 0:
        raise ValueError("Declare the maximum expanded bytes for this source selection")
    by_name = {}
    for row in inventory["members"]:
        by_name.setdefault(row["name"], []).append(row)
    rows = []
    for name in names:
        candidates = by_name.get(name, [])
        if (len(candidates) != 1 or candidates[0]["directory"]
                or not candidates[0]["safe_to_receive"]):
            raise ValueError("Select one unambiguous original regular ZIP member: " + name)
        rows.append(candidates[0])
    rows.sort(key=lambda row: row["index"])
    selected_bytes = sum(x["bytes"] for x in rows)
    if selected_bytes > maximum_bytes:
        raise ValueError("The complete selected members exceed the declared expanded-byte allowance")
    selection = {"schema": "upstate.usgs-archive-selection/v1",
                 "archive_inventory_id": inventory["id"], "members": rows}
    selection["id"] = digest(selection)
    atomic_json(output/"selections"/(selection["id"]+".json"), selection, immutable=True)
    root = _target(output, "original")
    root.mkdir(exist_ok=True)
    journal_path = output/"received-members.json"
    journal = read_json(journal_path) if journal_path.exists() else {
        "schema": "upstate.usgs-received-members/v1",
        "archive_inventory_id": inventory["id"], "files": []}
    if (journal.get("schema") != "upstate.usgs-received-members/v1"
            or journal.get("archive_inventory_id") != inventory["id"]):
        raise ValueError("Continue member receiving under the same original archive inventory")
    completed = {}
    for record in journal["files"]:
        name = record.get("name")
        candidates = by_name.get(name, [])
        if (len(candidates) != 1 or name in completed
                or any(record.get(k) != candidates[0][k] for k in candidates[0])
                or record.get("path") != "original/"+name
                or not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", ""))):
            raise ValueError("A retained member record differs from its original ZIP entry")
        destination = _target(root, name)
        if not destination.is_file() or _file_hash(destination) != {
                k: record[k] for k in ("bytes", "sha256", "crc32")}:
            raise ValueError("A retained original member changed: " + name)
        completed[name] = record
    state = _target(output, "member-state")
    state.mkdir(exist_ok=True)

    def save_completed(row, record, destination, pending_path):
        record["csv"] = _survey(destination)
        completed[row["name"]] = record
        journal["files"] = sorted(completed.values(), key=lambda item: item["index"])
        atomic_json(journal_path, journal)
        pending_path.unlink(missing_ok=True)

    # A selection may add files to earlier dictionary/site-list intake. The
    # inventory-bound journal and original tree hold each member exactly once.
    for row in rows:
        pending_path = state/("%d.received.json" % row["index"])
        if row["name"] in completed:
            pending_path.unlink(missing_ok=True)
            continue
        if pending_path.exists():
            record = read_json(pending_path)
            if (any(record.get(k) != row[k] for k in row)
                    or record.get("path") != "original/"+row["name"]
                    or not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", ""))):
                raise ValueError("Pending original-member selection changed")
            destination = _target(root, row["name"])
            partial = state/("%d.partial" % row["index"])
            selected = destination if destination.exists() else partial
            if selected.is_symlink() or not selected.is_file() or _file_hash(selected) != {
                    k: record[k] for k in ("bytes", "sha256", "crc32")}:
                raise ValueError("The original completed member differs during recovery")
            if selected == partial:
                destination.parent.mkdir(parents=True, exist_ok=True)
                _publish_file(partial, destination)
            elif partial.exists():
                if partial.is_symlink() or not stat.S_ISREG(partial.lstat().st_mode):
                    raise ValueError("Partial source path must remain a regular file")
                if _file_hash(partial) != {k: record[k] for k in ("bytes", "sha256", "crc32")}:
                    raise ValueError("Pending and published original members differ")
                partial.unlink()
            save_completed(row, record, destination, pending_path)

    needed = 0
    for row in rows:
        if row["name"] not in completed:
            partial = state/("%d.partial" % row["index"])
            if partial.exists():
                metadata = partial.lstat()
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise ValueError("Partial source path must be an owned single-link regular file")
                allocated = metadata.st_blocks * 512
            else:
                allocated = 0
            needed += max(0, row["bytes"]-allocated)
    if shutil.disk_usage(output).free < needed:
        raise OSError("Selected source members require %d additional bytes" % needed)
    for row in rows:
        name = row["name"]
        destination = _target(root, name)
        if name in completed:
            continue
        if destination.exists():
            raise ValueError("An original member exists without its receiving record: " + name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = state/("%d.partial" % row["index"])
        if partial.is_symlink():
            raise ValueError("Partial source path must remain a regular file")
        sha, crc, count = hashlib.sha256(), 0, 0
        info = z.infolist()[row["index"]]
        with z.open(info, "r") as source, partial.open("wb") as target:
            for block in iter(lambda: source.read(1024*1024), b""):
                count += len(block)
                if count > row["bytes"]:
                    raise ValueError("Expanded original member exceeds its native ZIP length")
                target.write(block)
                sha.update(block)
                crc = zlib.crc32(block, crc)
            target.flush()
            os.fsync(target.fileno())
        actual = {"bytes": count, "sha256": sha.hexdigest(),
                  "crc32": "%08x" % (crc & 0xffffffff)}
        if count != row["bytes"] or actual["crc32"] != row["crc32"]:
            raise ValueError("Original ZIP member is incomplete or corrupt: " + name)
        pending_record = {**row, **actual, "path": "original/"+name,
                          "source_uri": "https://doi.org/"+DOI+"#member="+urllib.parse.quote(name, safe=""),
                          "received_at": now(), "csv": None}
        pending_path = state/("%d.received.json" % row["index"])
        atomic_json(pending_path, pending_record)
        _publish_file(partial, destination)
        save_completed(row, pending_record, destination, pending_path)
    return selection, journal


def _finish_receive(output, inventory, selection, journal):
    """Publish a completed batch after the original archive context validates."""
    completed = {record["name"]: record for record in journal["files"]}
    batch = {"schema": "upstate.usgs-archive-selection-result/v1", "doi": DOI,
             "selection_id": selection["id"], "archive_inventory_id": inventory["id"],
             "files": [completed[row["name"]] for row in selection["members"]],
             "bytes": sum(row["bytes"] for row in selection["members"])}
    batch["id"] = digest(batch)
    batches = output/"selection-results"
    atomic_json(batches/(selection["id"]+".json"), batch, immutable=True)
    selection_ids, included = [], {}
    for path in sorted(batches.glob("*.json")):
        previous = read_json(path)
        previous_id = previous.get("id")
        unsigned = {key: value for key, value in previous.items() if key != "id"}
        if (previous.get("schema") != "upstate.usgs-archive-selection-result/v1"
                or previous.get("archive_inventory_id") != inventory["id"]
                or previous.get("selection_id") != path.stem
                or digest(unsigned) != previous_id):
            raise ValueError("A completed source selection differs")
        plan = read_json(output/"selections"/(path.stem+".json"))
        if (plan.get("id") != path.stem or plan.get("archive_inventory_id") != inventory["id"]
                or digest({key: value for key, value in plan.items() if key != "id"}) != path.stem
                or [row["name"] for row in plan["members"]]
                   != [row["name"] for row in previous["files"]]):
            raise ValueError("A completed source selection no longer matches its original plan")
        for record in previous["files"]:
            if completed.get(record["name"]) != record:
                raise ValueError("A completed source selection no longer matches retained members")
            included[record["name"]] = record
        selection_ids.append(path.stem)
    files = sorted(included.values(), key=lambda record: record["index"])
    result = {"schema": "upstate.usgs-archive-receiving/v1", "doi": DOI,
              "selection_ids": selection_ids, "archive_inventory_id": inventory["id"],
              "files": files, "bytes": sum(record["bytes"] for record in files),
              "original_root": "original", "source_capture": "original-source-capture.json",
              "source_inventory": "archive-inventory.json"}
    result["id"] = digest(result)
    result_path = "receiving-results/"+result["id"]+".json"
    atomic_json(output/result_path, result, immutable=True)
    contract_files = {}
    for record in files:
        key = "zip-"+hashlib.sha256(record["name"].encode("utf-8")).hexdigest()[:20]
        contract_files[key] = {"path": record["name"], "sha256": record["sha256"],
                               "bytes": record["bytes"], "uri": record["source_uri"]}
    contract = {"schema": "upstate.usgs-contract-source-files/v1", "doi": DOI,
                "archive_inventory_id": inventory["id"], "receiving_id": result["id"],
                "receiving_result": result_path, "original_root": "original",
                "files": contract_files}
    contract["id"] = digest(contract)
    atomic_json(output/"contract-manifests"/(contract["id"]+".json"), contract, immutable=True)
    # These two named files are latest projections; their immutable, linked
    # editions remain usable even if publication stops between the two writes.
    atomic_json(output/"contract-source-files.json", contract)
    atomic_json(output/"result.json", result)
    return result


def operate(output, *, capture_path, archive=None, access_file=None,
            members=None, maximum_bytes=512*1024*1024):
    """Inspect or add a reviewed source selection to one original archive intake."""
    output = Path(output).absolute()
    if output.is_symlink():
        raise ValueError("Receiving output must remain an owned directory")
    output.mkdir(parents=True, exist_ok=True)
    if archive and access_file:
        raise ValueError("Select either the retained whole archive or its download URL")
    capture, capture_bytes = _spec(capture_path)
    receipt_path = output/"access-receipts.jsonl"
    def receipt(value):
        with receipt_path.open("ab") as stream:
            stream.write(canonical(value)+b"\n")
            stream.flush()
            os.fsync(stream.fileno())
    with held(output/"receiving.lock"):
        try:
            with _open_archive(capture, archive, access_file, receipt) as (raw, identity):
                with zipfile.ZipFile(raw) as z:
                    inventory = _inventory(z, raw, identity, capture, output, capture_bytes)
                    received = (_receive(z, inventory, members, output, maximum_bytes)
                                if members is not None else None)
            return (_finish_receive(output, inventory, *received)
                    if received is not None else inventory)
        except BaseException as error:
            receipt({"event": "interrupted", "at": now(),
                     "error_type": type(error).__name__,
                     "http_status": error.code if isinstance(error, urllib.error.HTTPError) else None})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect", "receive"))
    parser.add_argument("--capture", required=True,
                        help="Retained usgs-seasonal-loads-20261012/capture.json")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--archive", help="The original complete local data_release3.zip")
    source.add_argument("--download-url-file",
                        help="Private file containing the legitimate current original download URL")
    parser.add_argument("--output", required=True)
    parser.add_argument("--members", help="JSON array of exact names from the retained ZIP inventory")
    parser.add_argument("--maximum-expanded-bytes", type=int, default=512*1024*1024)
    args = parser.parse_args(argv)
    members = read_json(args.members) if args.members else None
    if args.command == "receive" and (not isinstance(members, list) or not members):
        parser.error("receive requires --members with an array of actual original ZIP member names")
    if args.command == "inspect" and members is not None:
        parser.error("--members belongs to receive")
    result = operate(args.output, capture_path=args.capture, archive=args.archive,
                     access_file=args.download_url_file, members=members,
                     maximum_bytes=args.maximum_expanded_bytes)
    print(json.dumps({"id": result["id"], "schema": result["schema"],
                      "output": str(Path(args.output).absolute()),
                      "members": len(result.get("files", result.get("members", [])))},
                     sort_keys=True))


if __name__ == "__main__":
    main()
