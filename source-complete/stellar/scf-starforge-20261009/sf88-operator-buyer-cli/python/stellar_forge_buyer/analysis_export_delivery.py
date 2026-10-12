"""Receive complete native query exports and resume interrupted file delivery.

The existing analysis server owns the job, SQL transaction and output files.
This client only reads its retained job and downloads. QueryExport remains the
validator and the offline application interface for the received result.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .errors import BuyerError, StateError
from .query_export import QueryExport
from .storage import digest, dump, lock, parse, private_directory, sync_directory, write

_SCHEMA = "stellar-forge.analysis-export-transfer.v1"
_JOB = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_NAMES = frozenset(("rows.jsonl", "rows.csv", "rows.sqlite3"))
_MAX_METADATA = 32 * 1024 * 1024
_MANIFEST_LIMIT = 16 * 1024 * 1024


@dataclass(frozen=True)
class ReceivedQueryExport:
    """The original reader and this delivery's actual transport observations."""

    export: QueryExport
    job_id: str
    workspace_id: str
    manifest_sha256: str
    downloaded_files: tuple[str, ...]
    reused_files: tuple[str, ...]
    network_requests: int
    resumed_files: tuple[str, ...]
    resumed_bytes: int


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise StateError("ANALYSIS_EXPORT_REDIRECT_REFUSED")


def _private(path, flags=os.O_RDONLY):
    fd = os.open(path, flags | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_uid != os.getuid() or info.st_mode & 0o077):
        os.close(fd)
        raise StateError("ANALYSIS_EXPORT_PRIVATE_FILE_REQUIRED")
    return fd


def _read_private(path, limit):
    with os.fdopen(_private(path), "rb") as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise StateError("ANALYSIS_EXPORT_METADATA_LIMIT")
    return raw


def _checked_file(path, record):
    try:
        with os.fdopen(_private(path), "rb") as source:
            if os.fstat(source.fileno()).st_size != record["bytes"]:
                raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
            if hashlib.file_digest(source, "sha256").hexdigest() != record["sha256"]:
                raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
    except FileNotFoundError:
        return False
    return True


def _launch(path):
    value = parse(_read_private(Path(path), 65536))
    if (not isinstance(value, dict) or value.get("schema") != "stellar-forge.customer-analysis.v1"
            or not isinstance(value.get("workspace_id"), str) or not _JOB.fullmatch(value["workspace_id"])
            or not isinstance(value.get("url"), str)):
        raise StateError("ANALYSIS_EXPORT_LAUNCH_INVALID")
    url = urlsplit(value["url"])
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.username or url.password
            or url.port is None or url.path not in ("", "/") or url.query
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", url.fragment)):
        raise StateError("ANALYSIS_EXPORT_LOCAL_LAUNCH_REQUIRED")
    return value["workspace_id"], f"http://127.0.0.1:{url.port}", url.fragment


def _state(path, job_id):
    if not path.exists():
        return None
    value = parse(_read_private(path, 131072))
    if (not isinstance(value, dict) or value.get("schema") != _SCHEMA or value.get("job_id") != job_id
            or not isinstance(value.get("workspace_id"), str) or not _JOB.fullmatch(value["workspace_id"])
            or not isinstance(value.get("manifest_sha256"), str) or not _HASH.fullmatch(value["manifest_sha256"])):
        raise StateError("ANALYSIS_EXPORT_TRANSFER_IDENTITY_CHANGED")
    return value


def receive_export(*, job_id: str, destination, launch_file=None, timeout=30,
                   max_output_bytes=None, chunk_bytes=1024 * 1024,
                   cancel=None, progress=None) -> ReceivedQueryExport:
    """Receive a retained export through the original private analysis server.

    ``destination`` is a private transfer directory. Its ``export`` child is
    the unchanged native QueryExport directory. Repeating the same job and
    destination verifies/reuses complete files and resumes an unfinished file
    with the original server's strong ETag and byte range. A complete delivery
    reopens without reading the launch file or making
    a network request. ``QueryExport.copy_to`` makes a portable recipient copy.

    Progress receives file, fileBytes, totalBytes, completedFiles, and complete.
    Cancelling preserves the transfer record and already finished files. No
    POST, SQL execution, acquisition or payment operation is available here.
    """
    if not isinstance(job_id, str) or not _JOB.fullmatch(job_id):
        raise StateError("ANALYSIS_EXPORT_ID_INVALID")
    if (type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 300
            or max_output_bytes is not None and (type(max_output_bytes) is not int or max_output_bytes < 1)
            or type(chunk_bytes) is not int or not 1024 <= chunk_bytes <= 1024 * 1024
            or cancel is not None and not callable(cancel) or progress is not None and not callable(progress)):
        raise StateError("ANALYSIS_EXPORT_RECEIVE_OPTIONS_INVALID")
    directory = private_directory(Path(destination))
    state_path = directory / "transfer.json"
    requests = 0
    downloaded, reused = [], []
    resumed, resumed_bytes = [], 0

    def check():
        if cancel is not None and cancel():
            raise StateError("ANALYSIS_EXPORT_RECEIVE_CANCELLED")

    with lock(directory):
        check()
        state = _state(state_path, job_id)
        if state is None and set(p.name for p in directory.iterdir()) - {"operation.lock"}:
            raise StateError("ANALYSIS_EXPORT_TRANSFER_DIRECTORY_NOT_EMPTY")
        result_dir = directory / "export"
        if state is not None and (result_dir / "manifest.json").exists():
            native = QueryExport(result_dir)
            manifest = native.inspect()
            if digest(_read_private(result_dir / "manifest.json", _MANIFEST_LIMIT)) != state["manifest_sha256"]:
                raise StateError("ANALYSIS_EXPORT_RECEIVED_MANIFEST_CHANGED")
            total = sum(r["bytes"] for r in manifest["outputs"].values())
            if max_output_bytes is not None and total > max_output_bytes:
                raise StateError("ANALYSIS_EXPORT_RECEIVE_SIZE_LIMIT")
            if progress:
                progress({"file": None, "fileBytes": 0, "totalBytes": total,
                          "completedFiles": len(manifest["outputs"]), "complete": True})
            return ReceivedQueryExport(native, job_id, state["workspace_id"], state["manifest_sha256"],
                                       (), tuple(manifest["outputs"]), 0, (), 0)
        if launch_file is None:
            raise StateError("ANALYSIS_EXPORT_PRIVATE_LAUNCH_FILE_REQUIRED")
        workspace_id, origin, capability = _launch(launch_file)
        if state is not None and state["workspace_id"] != workspace_id:
            raise StateError("ANALYSIS_EXPORT_WORKSPACE_CHANGED")
        opener = build_opener(ProxyHandler({}), _NoRedirect())

        def request(path, headers=None):
            nonlocal requests
            check()
            requests += 1
            message = Request(origin + path, headers={"X-Analysis-Capability": capability,
                                                     "Accept-Encoding": "identity", **(headers or {})}, method="GET")
            try:
                return opener.open(message, timeout=timeout)
            except HTTPError as exc:
                raise StateError("ANALYSIS_EXPORT_HTTP_" + str(exc.code)) from None
            except (URLError, TimeoutError, OSError):
                raise StateError("ANALYSIS_EXPORT_SERVER_UNAVAILABLE") from None

        def metadata(path, limit=_MAX_METADATA):
            with request(path) as response:
                raw = response.read(limit + 1)
            if len(raw) > limit:
                raise StateError("ANALYSIS_EXPORT_METADATA_LIMIT")
            return raw

        remote = parse(metadata("/api/state"))
        if not isinstance(remote, dict) or remote.get("workspace_id") != workspace_id:
            raise StateError("ANALYSIS_EXPORT_WORKSPACE_CHANGED")
        job = parse(metadata("/api/jobs/" + job_id))
        if (not isinstance(job, dict) or job.get("id") != job_id or job.get("kind") != "query-export"
                or job.get("status") != "COMPLETE" or not isinstance(job.get("result"), dict)):
            raise StateError("ANALYSIS_EXPORT_COMPLETE_JOB_REQUIRED")
        result = job["result"]
        checksum = result.get("manifest_sha256")
        if not isinstance(checksum, str) or not _HASH.fullmatch(checksum):
            raise StateError("ANALYSIS_EXPORT_MANIFEST_IDENTITY_REQUIRED")
        if state is not None and state["manifest_sha256"] != checksum:
            raise StateError("ANALYSIS_EXPORT_RETAINED_JOB_CHANGED")
        prefix = "/api/query-exports/" + job_id + "/file?"
        raw = metadata(prefix + urlencode({"name": "manifest.json"}), _MANIFEST_LIMIT)
        if digest(raw) != checksum:
            raise StateError("ANALYSIS_EXPORT_MANIFEST_CHANGED")

        # Persist the transfer identity before creating any staged files. An
        # interrupted first metadata write must resume in this same directory.
        state = {"schema": _SCHEMA, "job_id": job_id, "workspace_id": workspace_id,
                 "manifest_sha256": checksum}
        dump(state_path, state)

        # Retain the native review separately: the received export's completion
        # manifest is published only after every output has arrived intact.
        review_dir = private_directory(directory / "review")
        if (review_dir / "manifest.json").exists():
            if _read_private(review_dir / "manifest.json", _MANIFEST_LIMIT) != raw:
                raise StateError("ANALYSIS_EXPORT_REVIEW_CHANGED")
        else:
            write(review_dir / "manifest.json", raw, exclusive=True)
        manifest = QueryExport(review_dir).manifest
        if set(manifest["outputs"]) - _NAMES:
            raise StateError("ANALYSIS_EXPORT_OUTPUT_INVALID")
        total = sum(r["bytes"] for r in manifest["outputs"].values())
        if max_output_bytes is not None and total > max_output_bytes:
            raise StateError("ANALYSIS_EXPORT_RECEIVE_SIZE_LIMIT")
        result_dir = private_directory(result_dir)
        received = 0
        for name, record in manifest["outputs"].items():
            check()
            destination_file = result_dir / name
            if _checked_file(destination_file, record):
                received += record["bytes"]
                reused.append(name)
                if progress:
                    progress({"file": name, "fileBytes": record["bytes"], "totalBytes": received,
                              "completedFiles": len(reused) + len(downloaded), "complete": False})
                continue
            partial = result_dir / (name + ".part")
            try:
                fd = _private(partial, os.O_RDWR)
            except FileNotFoundError:
                fd = os.open(partial, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "r+b") as output:
                offset = os.fstat(output.fileno()).st_size
                if offset > record["bytes"]:
                    raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
                checksum_file = hashlib.sha256()
                while block := output.read(1024 * 1024):
                    check()
                    checksum_file.update(block)
                count = offset
                etag = '"sha256-' + record["sha256"] + '"'
                # A complete partial file can survive a lost rename/reply.
                # Verify and publish it without asking the server to send it.
                if offset == record["bytes"]:
                    if checksum_file.hexdigest() != record["sha256"]:
                        raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
                    reused.append(name)
                else:
                    headers = {"Range": f"bytes={offset}-", "If-Range": etag} if offset else None
                    with request(prefix + urlencode({"name": name}), headers) as response:
                        if response.headers.get("X-Content-SHA256") != record["sha256"]:
                            raise StateError("ANALYSIS_EXPORT_DOWNLOAD_IDENTITY_CHANGED")
                        if offset and response.status == 206:
                            expected_range = f"bytes {offset}-{record['bytes'] - 1}/{record['bytes']}"
                            if (response.headers.get("ETag") != etag
                                    or response.headers.get("Content-Range") != expected_range
                                    or response.headers.get("Content-Length") != str(record["bytes"] - offset)):
                                raise StateError("ANALYSIS_EXPORT_RANGE_IDENTITY_CHANGED")
                            resumed.append(name)
                            resumed_bytes += offset
                        elif response.status == 200:
                            if (response.headers.get("Content-Length") != str(record["bytes"])
                                    or response.headers.get("ETag") not in (None, etag)):
                                raise StateError("ANALYSIS_EXPORT_DOWNLOAD_IDENTITY_CHANGED")
                            # The original full-file endpoint remains usable
                            # when a server does not implement byte ranges.
                            output.seek(0)
                            output.truncate(0)
                            count, checksum_file = 0, hashlib.sha256()
                        else:
                            raise StateError("ANALYSIS_EXPORT_DOWNLOAD_STATUS_INVALID")
                        while block := response.read(chunk_bytes):
                            check()
                            count += len(block)
                            if count > record["bytes"]:
                                raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
                            output.write(block)
                            checksum_file.update(block)
                            if progress:
                                progress({"file": name, "fileBytes": count, "totalBytes": received + count,
                                          "completedFiles": len(reused) + len(downloaded), "complete": False})
                        check()
                        if count != record["bytes"] or checksum_file.hexdigest() != record["sha256"]:
                            raise StateError("ANALYSIS_EXPORT_RECEIVED_FILE_CHANGED")
                    downloaded.append(name)
                output.flush()
                os.fsync(output.fileno())
            # The transfer lease owns this destination. One rename avoids an
            # intermediate extra hard link if the receiver is interrupted.
            os.rename(partial, destination_file)
            sync_directory(result_dir)
            received += count
        check()
        write(result_dir / "manifest.json", raw, exclusive=True)
        native = QueryExport(result_dir)
        native.inspect()
        if progress:
            progress({"file": None, "fileBytes": 0, "totalBytes": received,
                      "completedFiles": len(manifest["outputs"]), "complete": True})
        return ReceivedQueryExport(native, job_id, workspace_id, state["manifest_sha256"],
                                   tuple(downloaded), tuple(reused), requests, tuple(resumed), resumed_bytes)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Receive and resume a retained customer SQL export.")
    parser.add_argument("--job", required=True, help="Existing completed query-export job ID")
    parser.add_argument("--out", required=True, help="Private transfer directory; the native result is its export child")
    parser.add_argument("--launch", help="Private analysis-launch.json, required until delivery is complete")
    parser.add_argument("--timeout", type=float, default=30, help="Per-request timeout in seconds, through 300")
    parser.add_argument("--max-output-bytes", type=int, help="Optional combined native file-size limit")
    args = parser.parse_args(argv)
    try:
        received = receive_export(job_id=args.job, destination=args.out, launch_file=args.launch,
                                  timeout=args.timeout, max_output_bytes=args.max_output_bytes)
        manifest = received.export.manifest
        print(json.dumps({"directory": str(received.export.directory), "job_id": received.job_id,
                          "workspace_id": received.workspace_id, "manifest_sha256": received.manifest_sha256,
                          "row_count": manifest["rowCount"], "downloaded_files": received.downloaded_files,
                          "reused_files": received.reused_files, "network_requests": received.network_requests,
                          "resumed_files": received.resumed_files, "resumed_bytes": received.resumed_bytes}))
        return 0
    except (BuyerError, OSError, ValueError, TypeError) as exc:
        print(json.dumps({"error": getattr(exc, "code", None) or type(exc).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
