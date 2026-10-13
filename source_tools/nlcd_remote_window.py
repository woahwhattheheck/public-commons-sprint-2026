"""Prepare original Annual NLCD windows through retained, entity-pinned ranges.

The existing local capture remains usable. The range cache is an alternative
reader for that same national ZIP, with a measured byte allowance and the
existing native-grid scientific preparation. No national TIFF is expanded.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
import zlib

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json)
from model import rasters
from . import nlcd_static as native

ENTITY = {
    "url": native.ARCHIVE_URL,
    "bytes": 1457983950,
    "etag": '"56e711ce-64fec1a6cfdae"',
}
CHUNK_BYTES = 256 * 1024
DEFAULT_TRANSFER_BYTES = 512 * 1024 * 1024
MAX_READ_BYTES = 64 * 1024 * 1024
MAX_INDEX_BYTES = 32 * 1024 * 1024


class TransferAllowance(ValueError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("The pinned original range URL redirected to another resource")


def _regular(root, relative):
    return native._owned_path(root, relative)


def _integer(value, name):
    return native._positive_integer(value, name)


def _file_identity(path):
    info = path.stat()
    return (info.st_dev, info.st_ino, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


class OriginalRanges:
    """Disk-backed source ranges; each completed chunk has its own byte receipt."""

    def __init__(self, directory, *, maximum_bytes=DEFAULT_TRANSFER_BYTES,
                 timeout=60, progress=None, prefix=None, prefix_bytes=None,
                 prefix_sha256=None):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        _integer(maximum_bytes, "Maximum retained source bytes")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Use a positive provider timeout")
        self.maximum_bytes, self.timeout = maximum_bytes, timeout
        self.progress, self.stage = progress, "inspect"
        self.lock = threading.RLock()
        self.started = time.monotonic()
        self.received_bytes = self.reused_bytes = self.prefix_bytes_read = 0
        self.request_count = 0
        self.last_error = None
        self.records, self.verified = {}, {}
        self.prefix = None
        identity = {"schema": "upstate.original-ranges/v1", "entity": ENTITY,
                    "chunk_bytes": CHUNK_BYTES}
        atomic_json(_regular(self.root, "entity.json"), identity, immutable=True)
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect())
        range_root = self.root / "ranges"
        range_root.mkdir(exist_ok=True)
        if range_root.is_symlink():
            raise ValueError("The retained range directory must be an owned directory")
        for path in sorted(range_root.glob("*.json")):
            record = read_json(_regular(self.root, path.relative_to(self.root)))
            start, length = record.get("start"), record.get("bytes")
            if (type(start) is not int or start < 0 or start % CHUNK_BYTES
                    or type(length) is not int
                    or length != min(CHUNK_BYTES, ENTITY["bytes"] - start)
                    or length <= 0 or record.get("entity_sha256") != digest(ENTITY)
                    or record.get("path") != f"ranges/{start:016d}.bin"
                    or path.name != f"{start:016d}.json"
                    or not re.fullmatch(r"[0-9a-f]{64}", str(record.get("sha256", "")))):
                raise ValueError("A retained range receipt differs from the pinned source layout")
            body_path = _regular(self.root, record["path"])
            if not body_path.is_file() or body_path.stat().st_size != length:
                raise ValueError("A completed original range body is missing or has changed size")
            self.records[start] = record
        self.retained_bytes = sum(row["bytes"] for row in self.records.values())
        if self.retained_bytes > maximum_bytes:
            raise TransferAllowance("The retained source already exceeds this invocation's byte allowance")
        if any(value is not None for value in (prefix, prefix_bytes, prefix_sha256)):
            if (prefix is None or type(prefix_bytes) is not int or prefix_bytes <= 0
                    or prefix_bytes > ENTITY["bytes"]
                    or not re.fullmatch(r"[0-9a-f]{64}", str(prefix_sha256 or ""))):
                raise ValueError("A retained prefix requires its exact path, byte count and SHA256")
            path = Path(prefix).resolve(strict=True)
            identity = _file_identity(path)
            if (not path.is_file() or identity[2] != prefix_bytes
                    or file_digest(path) != prefix_sha256):
                raise ValueError("The supplied original prefix differs from its completed byte identity")
            if _file_identity(path) != identity:
                raise ValueError("The selected original prefix changed while verifying its SHA256")
            self.prefix = {"path": path, "bytes": prefix_bytes, "sha256": prefix_sha256,
                           "stat": identity}
        self._emit()

    def snapshot(self):
        return {
            "schema": "upstate.original-range-progress/v1", "stage": self.stage,
            "entity": ENTITY, "retained_bytes": self.retained_bytes,
            "received_bytes_this_invocation": self.received_bytes,
            "reused_bytes_this_invocation": self.reused_bytes,
            "prefix_bytes_this_invocation": self.prefix_bytes_read,
            "requests_this_invocation": self.request_count,
            "maximum_source_bytes": self.maximum_bytes,
            "completed_ranges": len(self.records),
            "elapsed_seconds": round(time.monotonic() - self.started, 3),
            "error": self.last_error,
        }

    def _emit(self):
        state = self.snapshot()
        atomic_json(_regular(self.root, "progress.json"), state)
        if self.progress:
            self.progress(state)

    def _body(self, start, *, count_reuse=True):
        record = self.records.get(start)
        if record:
            path = _regular(self.root, record["path"])
            identity = _file_identity(path)
            body = path.read_bytes()
            if len(body) != record["bytes"] or _file_identity(path) != identity:
                raise ValueError("A retained original range changed during reuse")
            if self.verified.get(start) != identity:
                if hashlib.sha256(body).hexdigest() != record["sha256"]:
                    raise ValueError("A retained original range failed its SHA256")
                self.verified[start] = identity
            if count_reuse:
                self.reused_bytes += len(body)
            return body
        length = min(CHUNK_BYTES, ENTITY["bytes"] - start)
        if self.retained_bytes + length > self.maximum_bytes:
            raise TransferAllowance(
                "The original reader reached its retained-byte allowance; reuse this "
                "same directory with a larger explicit --maximum-source-bytes to continue")
        end = start + length - 1
        details = {}
        if self.prefix and end < self.prefix["bytes"]:
            p = self.prefix["path"]
            identity = _file_identity(p)
            if identity != self.prefix["stat"]:
                raise ValueError("The selected original prefix changed during range preparation")
            with p.open("rb") as source:
                source.seek(start)
                body = source.read(length)
            if len(body) != length or _file_identity(p) != identity:
                raise ValueError("The selected original prefix changed while reading a retained chunk")
            self.prefix_bytes_read += length
            details = {"origin": "retained-original-prefix",
                       "prefix_bytes": self.prefix["bytes"],
                       "prefix_sha256": self.prefix["sha256"]}
        else:
            request = urllib.request.Request(ENTITY["url"], headers={
                "Range": f"bytes={start}-{end}", "If-Match": ENTITY["etag"],
                "Accept-Encoding": "identity",
                "User-Agent": "UpperSavannah-OriginalSource/1.0",
            })
            self.request_count += 1
            with self.opener.open(request, timeout=self.timeout) as response:
                expected = f"bytes {start}-{end}/{ENTITY['bytes']}"
                if (response.status != 206
                        or response.headers.get("Content-Range") != expected
                        or response.headers.get("ETag") != ENTITY["etag"]
                        or response.headers.get("Content-Encoding", "identity").lower() != "identity"):
                    raise ValueError("The provider did not return the exact ETag-pinned original range")
                declared = response.headers.get("Content-Length")
                if declared is not None and declared != str(length):
                    raise ValueError("The provider declared a different original range length")
                body = response.read(length + 1)
                if len(body) != length:
                    raise ValueError("The provider returned an incomplete or oversized original range")
                details = {"origin": "original-http-range", "status": response.status,
                           "headers": {name: response.headers.get(name) for name in
                                       ("ETag", "Last-Modified", "Content-Range", "Content-Length",
                                        "Content-Type", "Date", "Accept-Ranges")},
                           "received_at": now()}
            self.received_bytes += length
        relative = f"ranges/{start:016d}.bin"
        destination = _regular(self.root, relative)
        sha = hashlib.sha256(body).hexdigest()
        # A crash may leave a complete body before its companion receipt. Re-read
        # that original range and compare it before adopting the retained body.
        if not destination.exists():
            atomic_bytes(destination, body)
        identity = _file_identity(destination)
        if identity[2] != length or file_digest(destination) != sha:
            raise ValueError("The retained original range differs from the pinned provider body")
        if _file_identity(destination) != identity:
            raise ValueError("The retained original range changed while verifying its SHA256")
        record = {
            "schema": "upstate.original-range/v1", "entity_sha256": digest(ENTITY),
            "start": start, "end": end, "bytes": length, "sha256": sha,
            "path": relative, **details,
        }
        atomic_json(_regular(self.root, f"ranges/{start:016d}.json"), record, immutable=True)
        self.records[start] = record
        self.retained_bytes += length
        self.verified[start] = identity
        self._emit()
        return body

    def read(self, start, length):
        if (type(start) is not int or type(length) is not int
                or start < 0 or length < 0 or start + length > ENTITY["bytes"]
                or length > MAX_READ_BYTES):
            raise ValueError("The original range request is outside the source or read allowance")
        with self.lock:
            try:
                pieces = []
                cursor, end = start, start + length
                while cursor < end:
                    base = cursor // CHUNK_BYTES * CHUNK_BYTES
                    body = self._body(base)
                    take = min(end - cursor, len(body) - (cursor - base))
                    pieces.append(body[cursor - base:cursor - base + take])
                    cursor += take
                return b"".join(pieces)
            except Exception as error:
                self.last_error = type(error).__name__ + ": " + str(error)
                self._emit()
                raise

    def files(self):
        paths = [self.root / "entity.json"]
        for start, row in sorted(self.records.items()):
            self._body(start, count_reuse=False)
            paths.extend((self.root / row["path"], self.root / f"ranges/{start:016d}.json"))
        return paths


class _ZipView(io.RawIOBase):
    def __init__(self, ranges):
        self.ranges, self.position = ranges, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        value = (offset if whence == 0 else self.position + offset if whence == 1
                 else ENTITY["bytes"] + offset if whence == 2 else -1)
        if not 0 <= value <= ENTITY["bytes"]:
            raise ValueError("ZIP metadata sought outside the original entity")
        self.position = value
        return value

    def read(self, size=-1):
        size = min(ENTITY["bytes"] - self.position,
                   size if size >= 0 else ENTITY["bytes"] - self.position)
        body = self.ranges.read(self.position, size)
        self.position += len(body)
        return body


def _name(value):
    path = PurePosixPath(value)
    if (not value or value.startswith("/") or "\\" in value or "\x00" in value
            or ".." in path.parts or "{" in value or "}" in value):
        raise ValueError("The original ZIP contains an unsupported member name")
    return value


def _local(ranges, offset):
    values = struct.unpack("<4s5H3I2H", ranges.read(offset, 30))
    if values[0] != b"PK\x03\x04":
        raise ValueError("The original ZIP local header signature differs")
    raw = ranges.read(offset + 30, values[-2] + values[-1])
    name = raw[:values[-2]].decode("utf-8" if values[2] & 2048 else "cp437")
    return {"name": _name(name), "flags": values[2], "compression": values[3],
            "crc32": values[6], "compressed_bytes": values[7], "bytes": values[8],
            "data_offset": offset + 30 + len(raw), "local_header_offset": offset}


def _sozip(ranges, member, header):
    if member.compress_type != zipfile.ZIP_DEFLATED:
        return None
    after = header["data_offset"] + member.compress_size
    positions = [after]
    if member.flag_bits & 8:
        raw = ranges.read(after, min(28, ENTITY["bytes"] - after))
        for signature in (0, 4):
            if signature and raw[:4] != b"PK\x07\x08":
                continue
            for width, form in ((4, "<III"), (8, "<IQQ")):
                length = 4 + width * 2
                if len(raw) >= signature + length:
                    crc, compressed, uncompressed = struct.unpack(
                        form, raw[signature:signature + length])
                    if (crc == member.CRC and compressed == member.compress_size
                            and uncompressed == member.file_size):
                        positions.append(after + signature + length)
    expected = str(PurePosixPath(member.filename).with_name(
        "." + PurePosixPath(member.filename).name + ".sozip.idx"))
    for offset in dict.fromkeys(positions):
        if ranges.read(offset, 4) != b"PK\x03\x04":
            continue
        index = _local(ranges, offset)
        if index["name"] != expected:
            continue
        if (index["flags"] & 9 or index["compression"] != zipfile.ZIP_STORED
                or index["bytes"] != index["compressed_bytes"]
                or not 32 <= index["bytes"] <= MAX_INDEX_BYTES):
            raise ValueError("The original SOZip index header is inconsistent")
        raw = ranges.read(index["data_offset"], index["bytes"])
        if zlib.crc32(raw) & 0xffffffff != index["crc32"]:
            raise ValueError("The retained SOZip index failed its original ZIP CRC")
        version, skip, chunk, width, unpacked, packed = struct.unpack("<4I2Q", raw[:32])
        if (version != 1 or width != 8 or chunk <= 0 or unpacked <= chunk
                or unpacked != member.file_size or packed != member.compress_size):
            raise ValueError("The SOZip index describes a different compressed member")
        count = (unpacked - 1) // chunk
        if len(raw) != 32 + skip + count * 8:
            raise ValueError("The SOZip offset count differs from its declared stream")
        previous = 0
        first = last = None
        for (value,) in struct.iter_unpack("<Q", raw[32 + skip:]):
            if not previous < value < packed:
                raise ValueError("The SOZip compressed offsets are not strictly increasing")
            if first is None:
                first = value
            last = previous = value
        marker = b"\x00\x00\x00\xff\xff\x00\x00\x00\xff\xff"
        checks = []
        for value in sorted(set((first, last))):
            if value is None or value < len(marker):
                raise ValueError("The SOZip independent-chunk offset is invalid")
            actual = ranges.read(header["data_offset"] + value - len(marker), len(marker))
            checks.append({"compressed_offset": value, "flush_marker_matches": actual == marker})
        if not all(item["flush_marker_matches"] for item in checks):
            raise ValueError("The SOZip endpoint chunks lack their required independent flush markers")
        return {**index, "header_version": version, "skip_bytes": skip,
                "chunk_bytes": chunk, "offset_bytes": width, "offset_count": count,
                "index_sha256": hashlib.sha256(raw).hexdigest(),
                "first_and_last_chunk_checks": checks,
                "validation": "Index CRC, member sizes and every offset; endpoint flush markers"}
    return None


def inspect(ranges, *, raster_member=None):
    ranges.stage = "inspect"
    with zipfile.ZipFile(_ZipView(ranges)) as archive:
        members = archive.infolist()
        if not 1 <= len(members) <= 4096:
            raise ValueError("The original archive has an unexpected member inventory")
        names = [_name(row.filename) for row in members]
        if len(set(names)) != len(names):
            raise ValueError("The original archive contains ambiguous duplicate member names")
        rasters_in_zip = [row for row in members if row.filename.lower().endswith((".tif", ".tiff"))]
        candidates = ([row for row in rasters_in_zip if row.filename == raster_member]
                      if raster_member else rasters_in_zip)
        if len(candidates) != 1:
            raise ValueError("Select the single original national TIFF by its exact archive member name")
        selected = candidates[0]
        header = _local(ranges, selected.header_offset)
        if (header["name"] != selected.filename or header["compression"] != selected.compress_type
                or header["flags"] & 1 or selected.flag_bits & 1
                or header["data_offset"] + selected.compress_size > ENTITY["bytes"]):
            raise ValueError("The selected national TIFF has inconsistent original ZIP headers")
        index = _sozip(ranges, selected, header)
        access = ("stored" if selected.compress_type == zipfile.ZIP_STORED
                  else "sozip" if index else "deflate-unindexed"
                  if selected.compress_type == zipfile.ZIP_DEFLATED else "unsupported")
        report = {
            "schema": "upstate.annual-nlcd-range-inspection/v1", "entity": ENTITY,
            "raster_member": selected.filename,
            "members": [{"name": row.filename, "bytes": row.file_size,
                         "compressed_bytes": row.compress_size, "compression": row.compress_type,
                         "crc32": f"{row.CRC:08x}", "local_header_offset": row.header_offset}
                        for row in members],
            "raster_header": header, "sozip": index, "access": access,
            "economical_random_access": access in ("stored", "sozip"),
        }
    atomic_json(_regular(ranges.root, "inspection.json"), report, immutable=True)
    ranges._emit()
    return report


@contextmanager
def original_server(ranges):
    """Adapt the retained original bytes to GDAL's native HTTP range interface."""
    token = secrets.token_urlsafe(24)
    route = "/" + token + "/Annual_NLCD_LndCov_2025_CU_C1V2.zip"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format, *args):
            pass

        def _headers(self, status, length, content_range=None):
            self.send_response(status)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Type", "application/zip")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", ENTITY["etag"])
            self.send_header("Connection", "close")
            if content_range:
                self.send_header("Content-Range", content_range)
            self.end_headers()
            self.close_connection = True

        def do_HEAD(self):
            if self.path != route:
                self._headers(404, 0)
                return
            self._headers(200, ENTITY["bytes"])

        def do_GET(self):
            if self.path != route:
                self._headers(404, 0)
                return
            requested = self.headers.get("Range", "")
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            if not match or not any(match.groups()):
                self._headers(416, 0, f"bytes */{ENTITY['bytes']}")
                return
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), ENTITY["bytes"] - 1) if last else ENTITY["bytes"] - 1
            else:
                start, end = max(0, ENTITY["bytes"] - int(last)), ENTITY["bytes"] - 1
            if start > end or start >= ENTITY["bytes"] or end - start + 1 > MAX_READ_BYTES:
                self._headers(416, 0, f"bytes */{ENTITY['bytes']}")
                return
            try:
                body = ranges.read(start, end - start + 1)
                self._headers(206, len(body), f"bytes {start}-{end}/{ENTITY['bytes']}")
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                # The exact provider/budget error is retained in progress.json.
                self._headers(503, 0)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    url = f"http://127.0.0.1:{server.server_address[1]}{route}"
    try:
        yield url
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def probe(directory, *, maximum_bytes=DEFAULT_TRANSFER_BYTES, timeout=60,
          raster_member=None, progress=None):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(_regular(root, "ranges.lock"), blocking=False):
        ranges = OriginalRanges(root, maximum_bytes=maximum_bytes, timeout=timeout, progress=progress)
        report = inspect(ranges, raster_member=raster_member)
        return {"inspection": report, "progress": ranges.snapshot(),
                "directory": str(root), "hostname": socket.gethostname(), "python": sys.executable}


def prepare(directory, *, metadata_manifest, domain, buffer_m=1000, layer=None,
            where=None, expected_features=None,
            maximum_clip_pixels=native.DEFAULT_CLIP_PIXELS,
            maximum_source_bytes=DEFAULT_TRANSFER_BYTES, timeout=60,
            raster_member=None, allow_unindexed_deflate=False, progress=None,
            prefix=None, prefix_bytes=None, prefix_sha256=None):
    """Return the ordinary upstate.sources/v1 entry from the original ZIP entity."""
    import inspect as python_inspect
    import rasterio

    if "source_tags" not in python_inspect.signature(native._clip).parameters:
        raise ValueError("Apply the accompanying source_tags join to the maintained nlcd_static._clip")
    _integer(maximum_clip_pixels, "Maximum local clip pixels")
    if expected_features is not None:
        _integer(expected_features, "Expected domain feature count")
    if not math.isfinite(buffer_m) or buffer_m <= 0:
        raise ValueError("Use a positive domain buffer in metres")
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    domain = Path(domain).resolve(strict=True)
    contract, metadata, metadata_manifest = native.read_contract(metadata_manifest)
    members = native._domain_members(domain)
    domain_sha = file_digest(domain)
    selection = {
        "schema": "upstate.annual-nlcd-range-selection/v1", "entity": ENTITY,
        "source_contract": contract, "domain_sha256": domain_sha,
        "domain_bytes": domain.stat().st_size, "domain_members": members,
        "layer": layer, "where": where, "buffer_m": float(buffer_m),
        "expected_features": expected_features, "maximum_clip_pixels": maximum_clip_pixels,
        "selected_raster_member": raster_member,
    }
    with held(_regular(root, "prepare.lock"), blocking=False):
        atomic_json(_regular(root, "selection.json"), selection, immutable=True)
        entry_path = _regular(root, "source-entry.json")
        if entry_path.exists():
            entry = read_json(entry_path)
            if entry.get("selection_sha256") != digest(selection):
                raise ValueError("This prepared source belongs to another original entity or domain")
            return native._verify_entry(root, entry)
        retained = []
        for source, expected_sha in ((metadata, contract["metadata_sha256"]),
                                     (metadata_manifest, contract["metadata_manifest_sha256"])):
            target = root / "original" / "metadata" / source.name
            expected = {"bytes": source.stat().st_size, "sha256": expected_sha}
            native._retain(source, target, expected, root=root)
            retained.append(target)
        original_domain = root / "original" / "domain" / domain.name
        for item in members:
            target = root / "original" / "domain" / item["name"]
            native._retain(domain.parent / item["name"], target, item, root=root)
            retained.append(target)
        if file_digest(original_domain) != domain_sha:
            raise ValueError("The selected model-domain identity changed before retention")
        range_root = _regular(root, "original/ranges/ranges.lock").parent
        with held(range_root / "ranges.lock", blocking=False):
            ranges = OriginalRanges(
                range_root, maximum_bytes=maximum_source_bytes, timeout=timeout,
                progress=progress, prefix=prefix, prefix_bytes=prefix_bytes,
                prefix_sha256=prefix_sha256)
            try:
                report = inspect(ranges, raster_member=raster_member)
                mode = report["access"]
                if mode == "unsupported":
                    raise ValueError("The original TIFF ZIP compression is unsupported by this range path")
                if mode == "deflate-unindexed" and not allow_unindexed_deflate:
                    raise ValueError(
                        "The actual TIFF is ordinary Deflate without a SOZip index. "
                        "Use the existing complete local capture, or explicitly select "
                        "--allow-unindexed-deflate to measure the same entity through "
                        "the retained reader and its declared source-byte allowance.")
                version = tuple(int(part) for part in
                                re.match(r"(\d+)\.(\d+)", rasterio.__gdal_version__).groups())
                if mode == "sozip" and version < (3, 7):
                    raise ValueError("This rasterio GDAL must be at least 3.7 to use the actual SOZip index")
                ranges.stage = "native-grid"
                ranges._emit()
                with original_server(ranges) as url:
                    prefix_uri = "/vsizip/{/vsicurl/" + url + "}/"
                    native_path = prefix_uri + report["raster_member"]
                    environment = {
                        "GDAL_CACHEMAX": 64 * 1024 * 1024,
                        "CPL_VSIL_CURL_CHUNK_SIZE": "65536",
                        "CPL_VSIL_CURL_CACHE_SIZE": "16777216",
                        "GDAL_HTTP_MULTIRANGE": "SERIAL",
                        "GDAL_HTTP_MAX_RETRY": "0",
                        "GDAL_HTTP_TIMEOUT": str(max(120, int(timeout) * 4)),
                    }
                    with rasterio.Env(**environment), rasterio.open(native_path) as dataset:
                        native_crs, native_grid = native._inspect_grid(dataset, contract)
                        opened = []
                        original_names = {row["name"] for row in report["members"]}
                        for path in dataset.files:
                            if not path.startswith(prefix_uri):
                                raise ValueError("The native TIFF reader selected a source outside the pinned archive")
                            member_name = path[len(prefix_uri):]
                            if member_name not in original_names:
                                raise ValueError("The native reader opened an unlisted original archive member")
                            opened.append(member_name)
                        native_grid["opened_source_members"] = sorted(set(opened))
                        native_grid["reader_gdal_version"] = rasterio.__gdal_version__
                        rows, reader = native._domain_geometry(
                            original_domain, layer=layer, where=where, target_crs=native_crs)
                        if expected_features is not None and len(rows) != expected_features:
                            raise ValueError("The selected original domain has a different feature count")
                        for item in members:
                            if not native._matches(root / "original" / "domain" / item["name"], item):
                                raise ValueError("The retained model domain changed during native geometry reading")
                        union = rasters.polygon_union(rows)
                        geometry = union.buffer(buffer_m)
                        if geometry.is_empty or not geometry.is_valid:
                            raise ValueError("The complete projected buffered domain needs its source geometry repaired")
                        window = native._window(dataset, geometry, maximum_clip_pixels)
                        plan = {
                            **selection, "schema": "upstate.annual-nlcd-range-plan/v1",
                            "range_inspection_sha256": digest(report),
                            "raster_member": report["raster_member"],
                            "native_zip_access": mode, "native_grid": native_grid,
                            "domain_reader": reader, "domain_feature_count": len(rows),
                            "domain_bounds": list(union.bounds),
                            "buffered_domain_bounds": list(geometry.bounds),
                            "native_window": [int(window.col_off), int(window.row_off),
                                              int(window.width), int(window.height)],
                            "local_clip_bounds": list(rasterio.windows.bounds(window, dataset.transform)),
                            "processing": "Integer native pixel window from retained ranges of the original national ZIP; no spatial resampling",
                            "domain_mask": "The scientific model applies its retained buffered-domain mask after alignment",
                            "scratch_expansion_bytes": 0,
                            "uncompressed_prepared_pixel_bytes": int(window.width * window.height) * 4,
                        }
                        atomic_json(_regular(root, "plan.json"), plan, immutable=True)
                        member_record = next(row for row in report["members"]
                                             if row["name"] == report["raster_member"])
                        tags = {
                            "source_entity_url": ENTITY["url"],
                            "source_entity_etag": ENTITY["etag"],
                            "source_entity_bytes": str(ENTITY["bytes"]),
                            "source_member_crc32": member_record["crc32"],
                            "source_member_compressed_bytes": str(member_record["compressed_bytes"]),
                            "source_access": "Retained original entity-pinned HTTP ranges",
                        }
                        ranges.stage = "native-window"
                        ranges._emit()
                        clip = native._clip(dataset, window, root, plan, source_tags=tags)
                if ranges.last_error:
                    raise ValueError("The native reader encountered an original range failure: " + ranges.last_error)
                atomic_json(_regular(root, "original/native-grid.json"), native_grid, immutable=True)
                range_files = ranges.files()
                ranges.stage = "complete"
                ranges._emit()
                receipt_path = _regular(root, "range-receipt.json")
                identity = {
                    "entity": ENTITY, "plan_sha256": digest(plan),
                    "ranges": [{"start": row["start"], "end": row["end"],
                                "path": str((ranges.root / row["path"]).relative_to(root)),
                                "bytes": row["bytes"], "sha256": row["sha256"]}
                               for _, row in sorted(ranges.records.items())],
                }
                if receipt_path.exists():
                    receipt = read_json(receipt_path)
                    if receipt.get("identity") != identity:
                        raise ValueError("The completed range receipt differs from this source preparation")
                else:
                    receipt = {"schema": "upstate.annual-nlcd-range-receipt/v1",
                               "identity": identity, "progress": ranges.snapshot(),
                               "completed_at": now()}
                    atomic_json(receipt_path, receipt, immutable=True)
                companions = retained + range_files + [
                    ranges.root / "inspection.json", root / "selection.json",
                    root / "plan.json", root / "clip.json",
                    root / "original/native-grid.json", receipt_path,
                ]
                entry = {
                    "id": "annual-nlcd-2025-c1v2-range-" + digest(plan)[:16],
                    "title": "Annual NLCD 2025 Collection 1.2 original native-grid watershed window",
                    "kind": "raster", "role": "NLCD", "units": "class", "resampling": "nearest",
                    "uri": native.ARCHIVE_URL,
                    "vintage": "2025 land cover; Collection 1 Version 2; published 2026-06-30",
                    "citation": {"publisher": "U.S. Geological Survey",
                                 "url": native.DOI, "metadata": native.METADATA_URL},
                    **describe_file(root, root / "land-cover.tif"),
                    "selection_sha256": digest(selection), "preparation_sha256": digest(plan),
                    "original_archive_entity": ENTITY,
                    "original_member": member_record,
                    "original_range_receipt_sha256": file_digest(receipt_path),
                    "source_metadata_sha256": contract["metadata_sha256"],
                    "model_domain_sha256": domain_sha, "domain_feature_count": len(rows),
                    "source_resolution": "Original static 30 m WGS84 Albers pixel grid",
                    "source_time": "2025", "buffer_m": buffer_m, "native_grid": native_grid,
                    "prepared_grid": {key: clip[key] for key in (
                        "transform", "width", "height", "prepared_dtype", "prepared_nodata",
                        "class_counts", "valid_cells", "nodata_cells")},
                    "derivation": plan["processing"],
                    "companions": [describe_file(root, path) for path in sorted(set(companions))],
                }
                atomic_json(entry_path, entry, immutable=True)
                return native._verify_entry(root, entry)
            except Exception as error:
                ranges.stage = "failed"
                if not ranges.last_error:
                    ranges.last_error = type(error).__name__ + ": " + str(error)
                ranges._emit()
                raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("probe", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("--output", required=True)
        command.add_argument("--raster-member")
        command.add_argument("--maximum-source-bytes", type=int, default=DEFAULT_TRANSFER_BYTES)
        command.add_argument("--timeout", type=float, default=60)
        if name == "prepare":
            command.add_argument("--metadata-manifest", required=True)
            command.add_argument("--domain", required=True)
            command.add_argument("--layer")
            command.add_argument("--where-json")
            command.add_argument("--expected-features", type=int)
            command.add_argument("--buffer-m", type=float, default=1000)
            command.add_argument("--maximum-clip-pixels", type=int, default=native.DEFAULT_CLIP_PIXELS)
            command.add_argument("--allow-unindexed-deflate", action="store_true")
            command.add_argument("--prefix")
            command.add_argument("--prefix-bytes", type=int)
            command.add_argument("--prefix-sha256")
    args = parser.parse_args(argv)

    def progress(value):
        print(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False),
              file=sys.stderr, flush=True)

    if args.command == "probe":
        value = probe(args.output, maximum_bytes=args.maximum_source_bytes, timeout=args.timeout,
                      raster_member=args.raster_member, progress=progress)
    else:
        value = prepare(
            args.output, metadata_manifest=args.metadata_manifest, domain=args.domain,
            buffer_m=args.buffer_m, layer=args.layer,
            where=json.loads(args.where_json) if args.where_json else None,
            expected_features=args.expected_features,
            maximum_clip_pixels=args.maximum_clip_pixels,
            maximum_source_bytes=args.maximum_source_bytes, timeout=args.timeout,
            raster_member=args.raster_member, allow_unindexed_deflate=args.allow_unindexed_deflate,
            progress=progress, prefix=args.prefix, prefix_bytes=args.prefix_bytes,
            prefix_sha256=args.prefix_sha256)
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
