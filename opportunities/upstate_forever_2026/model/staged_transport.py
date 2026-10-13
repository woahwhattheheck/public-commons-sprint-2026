"""Durable staged original-file transport for the existing HTTPS operator relay.

Uses E7A1's request/input/seal/result protocol. The native connector's journal
owns execution. This receiver never creates a replacement ID or automatically
retries an uncertain native mutation.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.parse
import uuid

from .retained_download import (OperatorTransport, _open, _sync_directory,
                                atomic_json, canonical, held, read_json)

SCHEMA = "upstate.workbench-staged-request/v1"
COMPLETE = "upstate.workbench-staged-result/v1"
BLOCK = 1024 * 1024
CONTROL_LIMIT = 1024 * 1024
RESULT_HEADERS = {"content-type", "content-length", "content-disposition",
                  "etag", "content-range", "accept-ranges", "cache-control",
                  "x-content-type-options", "x-eco-body-sha256"}
FORBIDDEN_HEADERS = {"authorization", "cookie", "host", "origin", "connection",
                     "content-length", "transfer-encoding", "proxy-authorization",
                     "x-eco-request-id", "te", "trailer", "upgrade", "keep-alive",
                     "proxy-connection"}


class StagedPending(RuntimeError):
    """The same request is retained; another explicit call can observe it."""
    def __init__(self, request_id, message):
        super().__init__(message + " Retained transfer: " + request_id)
        self.request_id = request_id


class StagedUncertain(StagedPending):
    """Never replace or automatically re-execute this original native request."""


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _sha(source):
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(BLOCK), b""):
        digest.update(block)
    return digest.hexdigest()


def _path(value):
    if not isinstance(value, str):
        raise ValueError("Choose the original relative API path.")
    parsed = urllib.parse.urlsplit(value)
    if (not value.startswith("/api/") or parsed.scheme or parsed.netloc
            or parsed.fragment or any(ord(c) <= 32 or ord(c) >= 127 for c in value)):
        raise ValueError("Choose an ASCII original relative API path without credentials.")
    return value


def _headers(value):
    if not isinstance(value, dict):
        raise ValueError("Retain the original declared content headers.")
    result = {}
    for name, content in value.items():
        if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]+", name)
                or name.lower() in FORBIDDEN_HEADERS
                or name.lower().startswith("x-forwarded-")
                or not isinstance(content, str)
                or any(ord(c) < 32 or ord(c) >= 127 for c in content)):
            raise ValueError("Use only original noncredential native content headers.")
        key = name.lower()
        if key in result:
            raise ValueError("Each original content header must be declared once.")
        result[key] = content
    result["accept-encoding"] = "identity"
    return dict(sorted(result.items()))


def _connection(transport, method, path, body=None, headers=None, timeout=60):
    connection = transport.connection(timeout=timeout)
    selected = {**transport.headers(), "Accept-Encoding": "identity", **(headers or {})}
    if body is not None:
        selected["Content-Length"] = str(len(body))
    try:
        connection.request(method, path, body=body, headers=selected)
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise ValueError("The staged transfer was redirected; no credential was forwarded.")
        if response.getheader("Content-Encoding", "identity") != "identity":
            raise ValueError("The staged transfer changed the original content encoding.")
        return connection, response
    except BaseException:
        connection.close()
        raise


def _control(transport, method, path, request_id, *, value=None, body=None,
             headers=None, timeout=60):
    if value is not None:
        body = canonical(value)
        headers = {**(headers or {}), "Content-Type": "application/json"}
    connection, response = _connection(transport, method, path, body, headers, timeout)
    try:
        raw = response.read(CONTROL_LIMIT + 1)
        if len(raw) > CONTROL_LIMIT:
            raise ValueError("The staged control response exceeds its original bound.")
        length = response.getheader("Content-Length")
        if length is not None and (not length.isdecimal() or int(length) != len(raw)):
            raise ValueError("The staged control response is incomplete.")
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError) as error:
            raise StagedPending(request_id, "The original control acknowledgement was unreadable.") from error
        if not isinstance(result, dict):
            raise ValueError("The staged control acknowledgement is not an object.")
        if not 200 <= response.status < 300:
            # A failed or lost acknowledgement never starts a replacement request.
            error = result.get("error")
            message = error.get("message") if isinstance(error, dict) else error
            raise StagedPending(request_id, str(message or "The original transfer did not acknowledge this step.")
                                + " HTTP " + str(response.status) + ".")
        return result
    finally:
        connection.close()


def _file_identity(path):
    with _open(path, os.O_RDONLY, "rb") as original:
        before = os.fstat(original.fileno())
        sha256 = _sha(original)
        if _signature(before) != _signature(os.fstat(original.fileno())):
            raise ValueError("The original input changed while its complete identity was read.")
    return {"bytes": before.st_size, "sha256": sha256}


def _verify_result(result, destination, binding):
    if (not isinstance(result, dict) or result.get("schema") != COMPLETE
            or result.get("request") != binding or result.get("path") != str(destination)
            or type(result.get("status")) is not int
            or not 100 <= result["status"] <= 599
            or _file_identity(destination) != {"bytes": result.get("bytes"),
                                              "sha256": result.get("sha256")}):
        raise ValueError("The saved original result differs from its complete receiving binding.")
    return result


def _publish(source, destination, expected):
    """Create only; an interrupted publication can match an existing same body."""
    try:
        os.link(source, destination)
    except FileExistsError:
        if _file_identity(destination) != expected:
            raise ValueError("The original result destination already contains different bytes.")
    _sync_directory(destination.parent)


def _save_response(response, destination, binding, *, upload=None):
    if response.getheader("Transfer-Encoding"):
        raise ValueError("The relay must preserve a known-length original result.")
    raw_length = response.getheader("Content-Length")
    if raw_length is None or not raw_length.isdecimal():
        raise ValueError("The relay did not retain the exact original result length.")
    expected = int(raw_length)
    expected_sha = response.getheader("X-Eco-Body-SHA256")
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
        raise ValueError("The relay did not retain a valid complete original result SHA-256.")
    headers = {}
    for key, value in response.getheaders():
        lower = key.lower()
        if lower in RESULT_HEADERS:
            if lower in headers and headers[lower] != value:
                raise ValueError("The relay returned conflicting original result headers.")
            headers[lower] = value
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".staged-result-", dir=destination.parent)
    count, digest = 0, hashlib.sha256()
    try:
        with os.fdopen(fd, "wb") as output:
            while count < expected:
                block = response.read(min(BLOCK, expected - count))
                if not block:
                    raise ValueError("The original result ended before its declared length.")
                output.write(block); digest.update(block); count += len(block)
            if response.read(1):
                raise ValueError("The original result exceeds its declared length.")
            output.flush(); os.fsync(output.fileno())
        if digest.hexdigest() != expected_sha:
            raise ValueError("The retained result differs from its original complete SHA-256.")
        # The original upload endpoint supplies a native complete-file receipt.
        if upload is not None and 200 <= response.status < 300:
            if count > CONTROL_LIMIT:
                raise ValueError("The native upload receipt exceeds its original bound.")
            value = read_json(Path(temporary))
            if (not isinstance(value, dict) or value.get("bytes") != upload["bytes"]
                    or value.get("sha256") != upload["sha256"]
                    or value.get("filename") != upload["filename"]):
                raise ValueError("The native upload receipt differs from the exact original file.")
        result = {"schema": COMPLETE, "request": binding, "path": str(destination),
                  "status": response.status, "headers": headers,
                  "bytes": count, "sha256": digest.hexdigest()}
        _publish(Path(temporary), destination, {"bytes": count, "sha256": digest.hexdigest()})
        return result
    finally:
        primary = sys.exc_info()[1]
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        except OSError as cleanup_error:
            if primary is None:
                raise
            if hasattr(primary, "add_note"):
                primary.add_note("Owned result temporary cleanup also failed: " + str(cleanup_error))


def stage_file(transport, *, workspace, method, path, filename, journal, result,
               headers, timeout=60, wait_seconds=60, upload_name=None, progress=None):
    """Send/receive one exact original file under one durable transport identity.

    The metadata and source SHA are saved before any network call. An explicit
    re-entry reuses that same ID, replays only identical staging bytes, and reads
    its original result. Native dispatch deduplication belongs to E7A1's journal.
    """
    if (not isinstance(transport, OperatorTransport)
            or transport.credential_kind != "recipient"):
        raise ValueError("Staging requires the explicit trusted recipient HTTPS connection.")
    if method not in {"POST", "PUT"}:
        raise ValueError("Choose the original POST or PUT file operation.")
    if not re.fullmatch(r"[0-9a-f]{64}", workspace or ""):
        raise ValueError("Keep the original selected workspace identity.")
    if wait_seconds < 0:
        raise ValueError("Choose a nonnegative result observation window.")
    path, headers = _path(path), _headers(headers)
    source_path = Path(filename).absolute()
    journal_path, destination = Path(journal).absolute(), Path(result).absolute()
    complete_path = Path(str(journal_path) + ".complete.json")
    state_path = Path(str(journal_path) + ".state.json")
    lock_path = Path(str(journal_path) + ".lock")
    if len({p.resolve() for p in (source_path, journal_path, destination, complete_path, state_path, lock_path)}) != 6:
        raise ValueError("Original input, transfer records and result must be distinct files.")
    journal_path.parent.mkdir(parents=True, exist_ok=True)
    with held(lock_path, blocking=False):
        identity = _file_identity(source_path)
        if upload_name is not None and (method != "POST" or path != "/api/upload"
                or upload_name != source_path.name
                or headers.get("x-upload-filename") != urllib.parse.quote(upload_name, safe="")):
            raise ValueError("Retain the original upload filename and native upload route.")
        upload = {"filename": upload_name, **identity} if upload_name is not None else None
        metadata = {"method": method, "path": path, "headers": headers,
                    "body_bytes": identity["bytes"], "body_sha256": identity["sha256"]}
        selected = {"origin": transport.origin, "workspace": workspace,
                    "metadata": metadata, "body_sha256": identity["sha256"],
                    "result_path": str(destination)}
        if journal_path.exists():
            binding = read_json(journal_path)
            # Published earlier journals bound the full source SHA locally but
            # omitted it from wire metadata. Keep their immutable wire identity.
            legacy_metadata = {key: value for key, value in metadata.items()
                               if key != "body_sha256"}
            legacy_selection = {**selected, "metadata": legacy_metadata}
            if (not isinstance(binding, dict) or binding.get("schema") != SCHEMA
                    or binding.get("selection") not in (selected, legacy_selection)
                    or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", binding.get("id", ""))):
                raise ValueError("The existing transfer selects different original bytes or endpoint.")
            metadata = binding["selection"]["metadata"]
        else:
            binding = {"schema": SCHEMA, "id": str(uuid.uuid4()), "selection": selected}
            atomic_json(journal_path, binding, immutable=True)
        request_id = binding["id"]
        if complete_path.exists():
            return _verify_result(read_json(complete_path), destination, binding)
        state = {}
        if state_path.exists():
            state = read_json(state_path)
            if state.get("id") != request_id:
                raise ValueError("The staged transfer checkpoint belongs to another request.")
            # A sealed/uncertain request may be observed again, never restaged.
            # The connector may later publish its reconciled original result.
        def checkpoint(state, **extra):
            atomic_json(state_path, {"id": request_id, "state": state, **extra})
            if progress: progress({"id": request_id, "state": state, **extra})
        try:
            if state.get("state") not in {"sealed", "uncertain", "complete"}:
                with _open(source_path, os.O_RDONLY, "rb") as original:
                    before = os.fstat(original.fileno())
                    if before.st_size != identity["bytes"] or _sha(original) != identity["sha256"]:
                        raise ValueError("The selected source changed before transfer.")
                    original.seek(0)
                    created = _control(transport, "POST", "/_eco/v1/requests", request_id,
                                       value={"id": request_id, **metadata}, timeout=timeout)
                    if created.get("id") != request_id:
                        raise ValueError("The relay returned another retained request ID.")
                    checkpoint("staging", confirmed_bytes=0)
                    offset, sent_hash = 0, hashlib.sha256()
                    while offset < identity["bytes"]:
                        block = original.read(min(BLOCK, identity["bytes"] - offset))
                        if not block:
                            raise ValueError("The original input ended during staging.")
                        sha256 = hashlib.sha256(block).hexdigest()
                        ack = _control(transport, "PUT",
                                       "/_eco/v1/requests/" + request_id + "/input?offset=" + str(offset),
                                       request_id, body=block,
                                       headers={"Content-Type": "application/octet-stream",
                                                "X-Chunk-SHA256": sha256}, timeout=timeout)
                        if (ack.get("id") != request_id or ack.get("input_offset") != offset + len(block)
                                or ack.get("bytes") != len(block) or ack.get("sha256") != sha256):
                            raise ValueError("The relay did not acknowledge the exact original chunk.")
                        offset += len(block); sent_hash.update(block)
                        checkpoint("staging", confirmed_bytes=offset)
                    if (sent_hash.hexdigest() != identity["sha256"]
                            or _signature(before) != _signature(os.fstat(original.fileno()))):
                        raise ValueError("The original input changed; its native request was not sealed.")
                    seal = {"body_bytes": identity["bytes"]}
                    if "body_sha256" in metadata:
                        seal["body_sha256"] = metadata["body_sha256"]
                    sealed = _control(transport, "POST", "/_eco/v1/requests/" + request_id + "/seal",
                                      request_id, value=seal, timeout=timeout)
                    if sealed.get("id") != request_id or sealed.get("sealed") is not True:
                        raise ValueError("The relay did not acknowledge the complete original input.")
                    checkpoint("sealed", confirmed_bytes=identity["bytes"])
            deadline = time.monotonic() + wait_seconds
            while True:
                connection, response = _connection(
                    transport, "GET", "/_eco/v1/requests/" + request_id + "/result", timeout=timeout)
                try:
                    returned = response.getheader("X-Eco-Request-ID")
                    if returned is not None and returned != request_id:
                        raise ValueError("The result returned another original request identity.")
                    if response.getheader("X-Eco-Uncertain") == "1":
                        checkpoint("uncertain")
                        raise StagedUncertain(request_id, "The original native mutation needs reconciliation.")
                    if response.getheader("X-Eco-Pending") == "1":
                        if time.monotonic() >= deadline:
                            raise StagedPending(request_id, "The original native request remains pending.")
                    elif response.status in {401, 403} and returned != request_id:
                        raise StagedPending(request_id, "Authorization was refused; retain this original request and resolve access before reentry.")
                    elif response.getheader("X-Eco-Transport-Error"):
                        raise StagedPending(request_id, "The retained result has a transport error; keep this same journal.")
                    elif returned != request_id or not response.getheader("X-Eco-Body-SHA256"):
                        raise StagedPending(request_id, "The relay has not supplied the original native result identity and complete hash; retain this request for reconciliation.")
                    else:
                        received = _save_response(response, destination, binding, upload=upload)
                        atomic_json(complete_path, received, immutable=True)
                        checkpoint("complete", result_bytes=received["bytes"],
                                   result_sha256=received["sha256"], native_status=received["status"])
                        return received
                finally:
                    connection.close()
                time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        except (OSError, http.client.HTTPException) as error:
            raise StagedPending(request_id, "Transport or local receiving I/O stopped; this exact request remains retained. " + str(error)) from error
