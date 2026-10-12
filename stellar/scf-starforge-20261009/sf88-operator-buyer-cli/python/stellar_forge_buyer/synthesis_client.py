"""Synthesis through the original live Analysis workspace and retained files.

The connection/capability owner is WorkspaceWorkbookClient. This module adds
source/protocol/run methods and one shared full/range file receiver; it starts no
server, opens no second Analysis database owner, and performs no acquisition.
"""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
import uuid

from .errors import StateError
from .storage import parse, private_directory, read, write
from .workbook_client import WorkspaceWorkbookClient

_ID = re.compile(r"[a-f0-9]{32}")
_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
_SHA = re.compile(r"[a-f0-9]{64}")
_FILE = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,191}")
_MAX_JSON = 128 * 1024 * 1024
_CHUNK = 1024 * 1024


def _need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_SYNTHESIS_CLIENT_" + code)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def _identifier(value):
    _need(isinstance(value, str) and _ID.fullmatch(value), "ORIGINAL_ID_REQUIRED")
    return value


def _name(value):
    _need(isinstance(value, str) and _NAME.fullmatch(value), "NAME_INVALID")
    return value


def _revision(value):
    _need(type(value) is int and value > 0, "REVISION_REQUIRED")
    return value


def _record(record):
    _need(isinstance(record, dict), "FILE_RECORD_REQUIRED")
    name = record.get("name", record.get("filename"))
    _need(isinstance(name, str) and _FILE.fullmatch(name)
          and name not in {".", ".."}, "FILE_NAME_INVALID")
    _need(type(record.get("bytes")) is int and record["bytes"] >= 0,
          "FILE_LENGTH_INVALID")
    _need(isinstance(record.get("sha256"), str) and _SHA.fullmatch(record["sha256"]),
          "FILE_DIGEST_INVALID")
    return {"name": name, "bytes": record["bytes"], "sha256": record["sha256"],
            "mime_type": record.get("mime_type", record.get("mime", "application/octet-stream"))}


def _same_file(path, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        _need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077,
              "PRIVATE_REGULAR_FILE_REQUIRED")
        return (info.st_size == expected["bytes"]
                and hashlib.file_digest(stream, "sha256").hexdigest() == expected["sha256"])


def _retain(path, value):
    """Publish an immutable local JSON postimage, then read the original bytes."""
    raw = _json(value)
    if path.exists():
        _need(read(path, _MAX_JSON) == raw, "RETAINED_INPUT_CHANGED")
    else:
        write(path, raw, exclusive=True)
    _need(read(path, _MAX_JSON) == raw, "REQUEST_NOT_RETAINED")


def receive_synthesis_file(record, destination, open_stream, *, binding=None):
    """Receive exact source/output bytes, retaining an interrupted partial file.

    open_stream(offset) is a context manager yielding (binary_stream, metadata).
    metadata is {status: 200|206, offset, length, bytes, sha256}. bytes/sha256
    identify the COMPLETE immutable file; offset/length identify this response.
    For native AnalysisSynthesis.download, seek(offset), then yield
    {status: 206 if offset else 200, offset, length: bytes-offset, bytes, sha256}.
    An HTTP server may return an exact full 200 when a range was requested; only
    after complete identity verification does this receiver restart that partial.
    Returns {path,name,bytes,sha256,mime_type,resumed_from}. Reuse destination and
    binding on resume. Existing different files are never replaced.
    """
    expected = _record(record)
    destination = Path(destination).expanduser().absolute()
    private_directory(destination.parent)
    identity = {"schema": "stellar-forge.synthesis-file-receiving.v1",
                "destination": str(destination), "file": expected, "binding": binding}
    # The same destination has one receiving owner. The kernel releases this
    # descriptor after a client crash, retaining the exact partial and identity.
    lock = destination.with_name("." + destination.name + ".synthesis-lock")
    lock_fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock_fd)
        _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
              "PRIVATE_DOWNLOAD_OWNER_REQUIRED")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StateError("ANALYSIS_SYNTHESIS_CLIENT_DOWNLOAD_ALREADY_OPEN") from None
        journal = destination.with_name("." + destination.name + ".synthesis-download.json")
        partial = destination.with_name("." + destination.name + ".synthesis-part")
        if destination.exists():
            _need(_same_file(destination, expected), "LOCAL_FILE_CHANGED")
            if journal.exists():
                _retain(journal, identity)
            return {**expected, "path": str(destination), "resumed_from": expected["bytes"]}
        if partial.exists() and not journal.exists():
            raise StateError("ANALYSIS_SYNTHESIS_CLIENT_PARTIAL_IDENTITY_MISSING")
        _retain(journal, identity)
        fd = os.open(partial, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "r+b") as output:
            info = os.fstat(output.fileno())
            _need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                  and not info.st_mode & 0o077 and info.st_size <= expected["bytes"],
                  "PARTIAL_FILE_CHANGED")
            original_offset = info.st_size
            checksum = hashlib.sha256()
            for block in iter(lambda: output.read(_CHUNK), b""):
                checksum.update(block)
            size = original_offset
            if size < expected["bytes"]:
                with open_stream(size) as (stream, metadata):
                    _need(isinstance(metadata, dict)
                          and metadata.get("sha256") == expected["sha256"]
                          and metadata.get("bytes") == expected["bytes"],
                          "DOWNLOAD_IDENTITY_CHANGED")
                    start = metadata.get("offset")
                    status = metadata.get("status")
                    length = metadata.get("length")
                    _need(type(start) is int and type(length) is int
                          and start in {0, size} and length == expected["bytes"] - start
                          and ((status == 200 and start == 0) or (status == 206 and start == size)),
                          "DOWNLOAD_RANGE_CHANGED")
                    if start == 0 and size:
                        output.seek(0)
                        output.truncate(0)
                        checksum = hashlib.sha256()
                        size = 0
                    else:
                        output.seek(size)
                    remaining = length
                    while remaining:
                        block = stream.read(min(_CHUNK, remaining))
                        _need(isinstance(block, bytes) and bool(block), "DOWNLOAD_INCOMPLETE")
                        _need(len(block) <= remaining, "DOWNLOAD_LENGTH_CHANGED")
                        output.write(block)
                        checksum.update(block)
                        size += len(block)
                        remaining -= len(block)
                    _need(stream.read(1) == b"", "DOWNLOAD_LENGTH_CHANGED")
            _need(size == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                  "DOWNLOAD_DIGEST_CHANGED")
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(partial, destination, follow_symlinks=False)
        except FileExistsError:
            _need(_same_file(destination, expected), "LOCAL_FILE_CHANGED")
        _need(_same_file(destination, expected), "PUBLISHED_FILE_CHANGED")
        partial.unlink()
        parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        return {**expected, "path": str(destination), "resumed_from": original_offset}
    finally:
        os.close(lock_fd)


class WorkspaceSynthesisClient(WorkspaceWorkbookClient):
    """Borrow the running customer's Analysis capability, with original IDs."""

    def _json_call(self, path, body=None, *, capture=None):
        request = self._request(path, body)
        try:
            response = self.opener.open(request, timeout=30)
        except HTTPError as exc:
            with exc:
                raw = exc.read(_MAX_JSON + 1)
                if capture:
                    capture(exc.code, raw)
                _need(len(raw) <= _MAX_JSON, "ERROR_RESPONSE_TOO_LARGE")
                try:
                    value = parse(raw)
                    code = value.get("error") if isinstance(value, dict) else None
                except Exception:
                    code = None
                raise StateError(code or "ANALYSIS_SYNTHESIS_CLIENT_HTTP_" + str(exc.code)) from None
        with response:
            raw = response.read(_MAX_JSON + 1)
            if capture:
                capture(response.status, raw)
            _need(len(raw) <= _MAX_JSON, "RESPONSE_TOO_LARGE")
            try:
                value = parse(raw)
            except Exception:
                raise StateError("ANALYSIS_SYNTHESIS_CLIENT_RESPONSE_INCOMPLETE") from None
            _need(isinstance(value, dict) and not value.get("error"), "RESPONSE_INVALID")
            return value

    def call(self, path, body=None):
        return self._json_call(path, body)

    def history(self, *, kind="protocols", before=None, limit=25):
        _need(kind in {"publications", "protocols", "runs"}, "HISTORY_KIND_INVALID")
        query = {"kind": kind, "limit": limit}
        if before is not None:
            query["before"] = before
        result = self.call("/api/synthesis?" + urlencode(query))
        _need(result.get("kind") == kind and isinstance(result.get("items"), list),
              "HISTORY_RESPONSE_INVALID")
        return result

    def iter_history(self, *, kind="protocols", limit=25):
        before, seen = None, set()
        while True:
            page = self.history(kind=kind, before=before, limit=limit)
            yield from page["items"]
            cursor = page.get("next_before")
            if cursor is None:
                return
            _need(type(cursor) is int and cursor > 0 and cursor not in seen
                  and (before is None or cursor < before), "HISTORY_CURSOR_CHANGED")
            seen.add(cursor)
            before = cursor

    def publication(self, name, *, revision=None, offset=0, limit=50):
        query = {"offset": offset, "limit": limit}
        if revision is not None:
            query["revision"] = revision
        result = self.call("/api/synthesis-publications/" + quote(_name(name), safe="")
                           + "?" + urlencode(query))
        metadata = result.get("publication")
        _need(isinstance(metadata, dict) and metadata.get("name") == name
              and (revision is None or metadata.get("revision") == revision)
              and isinstance(result.get("results"), list) and result.get("offset") == offset,
              "PUBLICATION_RESPONSE_CHANGED")
        for row in result["results"]:
            _need(isinstance(row, dict) and isinstance(row.get("descriptor"), dict)
                  and _SHA.fullmatch(str(row.get("descriptor_sha256", ""))),
                  "DESCRIPTOR_RESPONSE_INVALID")
        return result

    def iter_results(self, name, *, revision=None, limit=50):
        """Yield original descriptor envelopes from one fixed publication edition."""
        page = self.publication(name, revision=revision, limit=limit)
        selected = {key: page["publication"][key] for key in ("name", "revision", "sha256")}
        seen = set()
        while True:
            _need(all(page["publication"].get(k) == v for k, v in selected.items()),
                  "PUBLICATION_EDITION_CHANGED")
            yield from page["results"]
            offset = page.get("next_offset")
            if offset is None:
                return
            _need(type(offset) is int and offset > page["offset"] and offset not in seen,
                  "PUBLICATION_CURSOR_CHANGED")
            seen.add(offset)
            page = self.publication(name, revision=selected["revision"], offset=offset, limit=limit)

    def protocol(self, name, *, revision=None):
        path = "/api/synthesis-protocols/" + quote(_name(name), safe="")
        if revision is not None:
            path += "?" + urlencode({"revision": _revision(revision)})
        result = self.call(path)
        self._validate_saved("protocol", {"name": name}, result)
        _need(revision is None or result["revision"] == revision, "PROTOCOL_EDITION_CHANGED")
        return result

    def review(self, name, revision):
        result = self.call("/api/synthesis-review", {"name": _name(name), "revision": _revision(revision)})
        _need(result.get("saved_protocol", {}).get("name") == name
              and result["saved_protocol"].get("revision") == revision
              and isinstance(result.get("rows"), list) and type(result.get("can_run")) is bool,
              "REVIEW_RESPONSE_CHANGED")
        return result

    @staticmethod
    def _validate_saved(kind, request, result):
        _need(isinstance(result, dict), "MUTATION_RESPONSE_INCOMPLETE")
        if kind in {"publication", "protocol"}:
            _need(result.get("name") == request["name"]
                  and type(result.get("revision")) is int and result["revision"] > 0
                  and _SHA.fullmatch(str(result.get("sha256", ""))),
                  "SAVED_RESPONSE_CHANGED")
            if "expected_revision" in request:
                _need(result["revision"] == request["expected_revision"] + 1,
                      "SAVED_REVISION_CHANGED")
            if kind == "publication":
                _need(result.get("sha256") == request.get("expected_sha256", result["sha256"])
                      and type(result.get("bytes")) is int
                      and type(result.get("result_count")) is int, "SAVED_PUBLICATION_CHANGED")
            else:
                _need(isinstance(result.get("definition"), dict)
                      and isinstance(result.get("publication"), dict), "SAVED_PROTOCOL_INCOMPLETE")
                if "publication" in request:
                    _need(result["publication"] == request["publication"], "SAVED_SOURCE_CHANGED")
        elif kind == "run":
            _need(result.get("id") == request["id"] and result.get("kind") == "synthesis"
                  and result.get("status") in {"RUNNING", "COMPLETE", "INTERRUPTED", "FAILED", "CANCELLED"},
                  "RUN_RESPONSE_CHANGED")
            for key in ("protocol_name", "protocol_revision", "protocol_sha256"):
                _need(result.get("request", {}).get(key) == request[key], "RUN_SELECTION_CHANGED")
        else:
            raise StateError("ANALYSIS_SYNTHESIS_CLIENT_OPERATION_KIND_INVALID")

    def _retained_post(self, kind, path, recipe, operation, *, request_id=None):
        operation = private_directory(Path(operation).expanduser().absolute())
        intent_path = operation / "intent.json"
        recipe_sha = hashlib.sha256(_json(recipe)).hexdigest()
        if intent_path.exists():
            intent = parse(read(intent_path, _MAX_JSON))
            _need(intent.get("schema") == "stellar-forge.synthesis-client-operation.v1"
                  and intent.get("database") == str(self.database)
                  and intent.get("kind") == kind and intent.get("path") == path
                  and intent.get("recipe_sha256") == recipe_sha, "OPERATION_REUSED")
            _need(request_id is None or intent["body"]["id"] == request_id, "ORIGINAL_ID_CHANGED")
            _need(isinstance(intent.get("body"), dict)
                  and {key: value for key, value in intent["body"].items() if key != "id"} == recipe,
                  "RETAINED_REQUEST_CHANGED")
            _identifier(intent["body"].get("id"))
            if self.workspace_id is not None:
                _need(self.workspace_id == intent["workspace_id"], "WORKSPACE_CHANGED")
            self.workspace_id = intent["workspace_id"]
            _retain(intent_path, intent)
        else:
            state = self.call("/api/state")
            _need(state.get("workspace_id") == self.workspace_id, "WORKSPACE_CHANGED")
            intent = {"schema": "stellar-forge.synthesis-client-operation.v1", "kind": kind,
                      "database": str(self.database), "workspace_id": self.workspace_id,
                      "path": path, "recipe_sha256": recipe_sha,
                      "body": {**recipe, "id": _identifier(request_id or uuid.uuid4().hex)}}
            _retain(intent_path, intent)
        def capture(status, raw):
            sha = hashlib.sha256(raw).hexdigest()
            retained = operation / ("response-" + sha + ".bin")
            if retained.exists():
                _need(read(retained, _MAX_JSON + 1) == raw, "RESPONSE_FILE_CHANGED")
            else:
                write(retained, raw, exclusive=True)
            _retain(operation / ("response-" + sha + ".json"),
                    {"status": status, "bytes": len(raw), "sha256": sha,
                     "request_id": intent["body"]["id"]})
        result = self._json_call(path, intent["body"], capture=capture)
        self._validate_saved(kind, intent["body"], result)
        # Run state may advance on a later reconnect; each complete native
        # postimage is retained under its actual digest, without rewriting it.
        _retain(operation / ("result-" + hashlib.sha256(_json(result)).hexdigest() + ".json"), result)
        return result

    def import_publication(self, source, *, name, expected_revision, results_pointer,
                           source_context, operation, descriptor_pointer="", request_id=None):
        raw = source if isinstance(source, bytes) else read(Path(source), 64 * 1024 * 1024)
        _need(0 < len(raw) <= 64 * 1024 * 1024, "SOURCE_SIZE_INVALID")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise StateError("ANALYSIS_SYNTHESIS_CLIENT_SOURCE_UTF8_REQUIRED") from None
        recipe = {"name": _name(name), "expected_revision": expected_revision,
                  "raw_text": text, "expected_sha256": hashlib.sha256(raw).hexdigest(),
                  "results_pointer": results_pointer, "descriptor_pointer": descriptor_pointer,
                  "source_context": source_context}
        return self._retained_post("publication", "/api/synthesis-publications",
                                   recipe, operation, request_id=request_id)

    def save_protocol(self, *, name, expected_revision, publication, definition,
                      operation, request_id=None):
        return self._retained_post("protocol", "/api/synthesis-protocols",
            {"name": _name(name), "expected_revision": expected_revision,
             "publication": publication, "definition": definition}, operation, request_id=request_id)

    def start(self, *, protocol_name, protocol_revision, protocol_sha256,
              operation, request_id=None):
        return self._retained_post("run", "/api/synthesis-runs",
            {"protocol_name": _name(protocol_name), "protocol_revision": _revision(protocol_revision),
             "protocol_sha256": protocol_sha256}, operation, request_id=request_id)

    def resume(self, operation):
        operation = Path(operation).expanduser().absolute()
        intent = parse(read(operation / "intent.json", _MAX_JSON))
        recipe = {key: value for key, value in intent["body"].items() if key != "id"}
        return self._retained_post(intent["kind"], intent["path"], recipe, operation,
                                   request_id=intent["body"]["id"])

    def job(self, identifier):
        result = self.call("/api/jobs/" + _identifier(identifier))
        _need(result.get("id") == identifier and result.get("kind") == "synthesis",
              "JOB_CHANGED")
        return result

    def wait(self, identifier, *, timeout=300, interval=0.5):
        _need(type(timeout) in (int, float) and timeout >= 0
              and type(interval) in (int, float) and 0.1 <= interval <= 10,
              "WAIT_OPTIONS_INVALID")
        deadline = time.monotonic() + timeout
        while True:
            result = self.job(identifier)
            if result["status"] != "RUNNING" or time.monotonic() >= deadline:
                return result
            time.sleep(min(interval, max(0, deadline - time.monotonic())))

    def cancel(self, identifier):
        result = self.call("/api/synthesis-runs/" + _identifier(identifier) + "/cancel", {})
        _need(result.get("id") == identifier and type(result.get("cancel_requested")) is bool,
              "CANCELLATION_RESPONSE_CHANGED")
        return result

    def result(self, identifier):
        result = self.call("/api/synthesis-runs/" + _identifier(identifier))
        _need(result.get("id") == identifier and isinstance(result.get("files"), list),
              "RESULT_RESPONSE_CHANGED")
        names = set()
        for record in result["files"]:
            selected = _record(record)
            _need(selected["name"] not in names, "DUPLICATE_OUTPUT_NAME")
            names.add(selected["name"])
        return result

    @contextmanager
    def _open_download(self, path, record, offset):
        expected = _record(record)
        request = self._request(path)
        if offset:
            request.add_header("Range", "bytes=" + str(offset) + "-")
            request.add_header("If-Range", '"sha256-' + expected["sha256"] + '"')
        with self.opener.open(request, timeout=30) as response:
            _need(response.status in {200, 206}
                  and response.headers.get("X-Content-SHA256") == expected["sha256"]
                  and response.headers.get("ETag") == '"sha256-' + expected["sha256"] + '"',
                  "DOWNLOAD_HEADERS_CHANGED")
            length = int(response.headers.get("Content-Length", "-1"))
            start = 0
            if response.status == 206:
                match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+)",
                                     response.headers.get("Content-Range", ""))
                _need(match is not None, "DOWNLOAD_RANGE_INVALID")
                start, end, total = map(int, match.groups())
                _need(total == expected["bytes"] and start == offset
                      and end == total - 1 and length == end - start + 1,
                      "DOWNLOAD_RANGE_CHANGED")
            yield response, {"status": response.status, "offset": start, "length": length,
                             "bytes": expected["bytes"], "sha256": expected["sha256"]}

    def receive_publication(self, name, revision, destination):
        page = self.publication(name, revision=revision, limit=1)
        source = page["publication"]
        record = {"name": name + "-revision-" + str(revision) + ".json",
                  "bytes": source["bytes"], "sha256": source["sha256"],
                  "mime_type": "application/json"}
        path = "/api/synthesis-publications/" + quote(name, safe="") + "/source?" + urlencode({"revision": revision})
        return receive_synthesis_file(record, destination,
            lambda offset: self._open_download(path, record, offset),
            binding={"workspace_id": self.workspace_id, "publication": name, "revision": revision})

    def receive_run(self, identifier, directory):
        directory = private_directory(Path(directory).expanduser().absolute())
        result = self.result(identifier)
        binding = {"workspace_id": self.workspace_id, "run_id": identifier,
                   "protocol": result["protocol"], "publication": result["publication"]}
        _retain(directory / "synthesis-selection.json", {"binding": binding, "result": result})
        files = []
        for record in result["files"]:
            path = "/api/synthesis-runs/" + identifier + "/files/" + quote(record["name"], safe="")
            files.append(receive_synthesis_file(record, directory / record["name"],
                lambda offset, path=path, record=record: self._open_download(path, record, offset),
                binding=binding))
        receipt = {"schema": "stellar-forge.synthesis-client-reception.v1", "status": "COMPLETE",
                   "binding": binding, "directory": str(directory),
                   "files": [{key: value for key, value in item.items() if key != "resumed_from"}
                             for item in files]}
        _retain(directory / "synthesis-reception.json", receipt)
        return receipt

    def run_protocol(self, *, protocol_name, protocol_revision, protocol_sha256,
                     operation, wait_seconds=300, request_id=None):
        operation = private_directory(Path(operation).expanduser().absolute())
        job = self.start(protocol_name=protocol_name, protocol_revision=protocol_revision,
                         protocol_sha256=protocol_sha256, operation=operation / "run",
                         request_id=request_id)
        job = self.wait(job["id"], timeout=wait_seconds)
        if job["status"] != "COMPLETE":
            return {"status": job["status"], "id": job["id"], "operation": str(operation),
                    "progress": job.get("progress"), "error": job.get("error")}
        return self.receive_run(job["id"], operation / "files")
