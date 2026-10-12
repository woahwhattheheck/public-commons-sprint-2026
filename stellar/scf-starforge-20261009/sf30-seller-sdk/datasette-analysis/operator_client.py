"""Typed local HTTP client for an already-open Datasette customer operator."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

SCHEMA = "stellar-forge.datasette-operator.v1"
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_MAX_JSON = 32 * 1024 * 1024
_QUERY = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")


def operator_route(route, *, mutation=False):
    """Select only the original Datasette or supported Analysis HTTP operation."""
    if not isinstance(route, str) or any(ord(char) < 32 for char in route) or "\\" in route:
        return False
    parsed = urlsplit(route)
    if parsed.scheme or parsed.netloc or parsed.fragment or not parsed.path.startswith("/api/"):
        return False
    if parsed.path.startswith("/api/datasette/"):
        return True
    if parsed.query:
        return False
    if not mutation and parsed.path == "/api/state":
        return True
    if re.fullmatch(r"/api/queries/[A-Za-z][A-Za-z0-9_]{0,63}", parsed.path):
        return True
    if mutation and parsed.path == "/api/start/query":
        return True
    return not mutation and re.fullmatch(r"/api/jobs/[a-f0-9]{32}", parsed.path) is not None


class DatasetteClientError(RuntimeError):
    def __init__(self, code, message, *, status=None, request_id=None):
        self.code, self.status, self.request_id = code, status, request_id
        super().__init__(message)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise DatasetteClientError("DATASETTE_OPERATOR_REDIRECT",
                                   "The original local operator redirected the request.")


@dataclass(frozen=True)
class OperatorConnection:
    origin: str
    capability: str
    operation_id: str | None = None
    workspace_id: str | None = None

    @classmethod
    def from_url(cls, value, *, operation_id=None, workspace_id=None):
        parsed = urlsplit(value)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
                or parsed.username or parsed.password or not parsed.port
                or parsed.path not in {"/", "/datasette", "/datasette/"}
                or parsed.query or not re.fullmatch(r"[A-Za-z0-9_-]{24,128}", parsed.fragment)):
            raise DatasetteClientError("DATASETTE_OPERATOR_LOCAL_URL_REQUIRED",
                                       "Use the complete original loopback operator URL.")
        if operation_id is not None and not _ID.fullmatch(operation_id):
            raise DatasetteClientError("DATASETTE_OPERATION_ID_INVALID",
                                       "Use the original operation ID.")
        return cls(f"http://127.0.0.1:{parsed.port}", parsed.fragment,
                   operation_id, workspace_id)

    @classmethod
    def from_workspace(cls, workspace):
        path = Path(workspace).expanduser().absolute() / "datasette-operator-launch.json"
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise DatasetteClientError("DATASETTE_LAUNCH_TOO_LARGE",
                                       "The local launch record is invalid.")
        control = json.loads(raw)
        if control.get("schema") != SCHEMA:
            raise DatasetteClientError("DATASETTE_LAUNCH_INVALID",
                                       "Open the original Datasette operator first.")
        return cls.from_url(control["url"], operation_id=control["operation_id"],
                            workspace_id=control["workspace_id"])


class DatasetteOperatorClient:
    """Operate the same server while its browser and original Analysis UI are open."""

    def __init__(self, connection: OperatorConnection, *, timeout=30):
        self.connection = connection
        self.timeout = timeout
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    @classmethod
    def from_workspace(cls, workspace, **options):
        return cls(OperatorConnection.from_workspace(workspace), **options)

    def _open(self, route, *, body=None, headers=None):
        if not operator_route(route, mutation=body is not None):
            raise DatasetteClientError("DATASETTE_OPERATOR_ROUTE_INVALID",
                                       "Use a supported route on the original Datasette and Analysis operator.")
        values = {"X-Analysis-Capability": self.connection.capability,
                  "Origin": self.connection.origin, **(headers or {})}
        data = None
        if body is not None:
            if isinstance(body, bytes):
                data = body
            else:
                data = json.dumps(body, ensure_ascii=False, allow_nan=False,
                                  separators=(",", ":")).encode()
                values["Content-Type"] = "application/json"
        request = Request(self.connection.origin + route, data=data, headers=values,
                          method="POST" if body is not None else "GET")
        try:
            return self.opener.open(request, timeout=self.timeout)
        except HTTPError as error:
            raw = error.read(_MAX_JSON + 1)
            try:
                content = json.loads(raw) if len(raw) <= _MAX_JSON else {}
            except (ValueError, UnicodeError):
                content = {}
            raise DatasetteClientError(content.get("error", "DATASETTE_HTTP_ERROR"),
                                       content.get("message") or content.get("error")
                                       or str(error), status=error.code) from None

    def _json(self, route, *, body=None, headers=None):
        with self._open(route, body=body, headers=headers) as response:
            raw = response.read(_MAX_JSON + 1)
        if len(raw) > _MAX_JSON:
            raise DatasetteClientError("DATASETTE_RESPONSE_TOO_LARGE",
                                       "Read the selected native file or a smaller data page.")
        return json.loads(raw)

    def status(self):
        value = self._json("/api/datasette/status")
        if (value.get("schema") != SCHEMA
                or self.connection.operation_id is not None
                and value.get("operation_id") != self.connection.operation_id
                or self.connection.workspace_id is not None
                and value.get("workspace_id") != self.connection.workspace_id):
            raise DatasetteClientError("DATASETTE_OPERATOR_IDENTITY_CHANGED",
                                       "Reconnect to the original workspace and operation.")
        return value


    def analysis_state(self):
        """Read the original Analysis views used to bind a customer query."""
        self.status()
        return self._json("/api/state")

    def saved_query(self, name):
        if not isinstance(name, str) or not _QUERY.fullmatch(name):
            raise DatasetteClientError("DATASETTE_QUERY_NAME_INVALID",
                                       "Use the original saved Analysis query name.")
        self.status()
        return self._json("/api/queries/" + name)

    def save_query(self, name, fields, *, expected_revision):
        if not isinstance(name, str) or not _QUERY.fullmatch(name):
            raise DatasetteClientError("DATASETTE_QUERY_NAME_INVALID",
                                       "Use the original saved Analysis query name.")
        if (not isinstance(fields, dict) or type(expected_revision) is not int
                or expected_revision < 0 or "expected_revision" in fields):
            raise DatasetteClientError("DATASETTE_QUERY_INPUT_INVALID",
                                       "Supply the saved SQL fields and its selected revision separately.")
        self.status()
        return self._json("/api/queries/" + name,
                          body={**fields, "expected_revision": expected_revision})

    def start_query(self, fields, *, job_id):
        if (not isinstance(fields, dict) or "id" in fields
                or not isinstance(job_id, str) or not _ID.fullmatch(job_id)):
            raise DatasetteClientError("DATASETTE_QUERY_JOB_INVALID",
                                       "Use the original query fields and stable Analysis job ID.")
        self.status()
        return self._json("/api/start/query", body={"id": job_id, **fields})

    def analysis_job(self, job_id):
        if not isinstance(job_id, str) or not _ID.fullmatch(job_id):
            raise DatasetteClientError("DATASETTE_QUERY_JOB_INVALID",
                                       "Use the original Analysis job ID.")
        self.status()
        return self._json("/api/jobs/" + job_id)

    def rows(self, *, edition_id=None, offset=0, limit=100):
        query = {"offset": offset, "limit": limit}
        if edition_id is not None:
            query["edition_id"] = edition_id
        return self._json("/api/datasette/rows?" + urlencode(query))

    def nld_status(self, *, project_id=None):
        self.status()
        query = "?" + urlencode({"project_id": project_id}) if project_id else ""
        return self._json("/api/datasette/nld/status" + query)

    def nld_rows(self, *, project_id, definition_id=None, run_id=None,
                 kind="source", offset=0, limit=100):
        self.status()
        query = {"project_id": project_id, "kind": kind, "offset": offset, "limit": limit}
        if definition_id is not None:
            query["definition_id"] = definition_id
        if run_id is not None:
            query["run_id"] = run_id
        return self._json("/api/datasette/nld/rows?" + urlencode(query))

    def submit(self, action, body, *, request_id):
        if not _ID.fullmatch(request_id):
            raise DatasetteClientError("DATASETTE_REQUEST_ID_REQUIRED",
                                       "Use a stable 32-character lowercase hexadecimal request ID.")
        self.status()
        return self._json("/api/datasette/requests",
                          body={"request_id": request_id, "action": action, "body": body})

    def request(self, request_id):
        if not _ID.fullmatch(request_id):
            raise DatasetteClientError("DATASETTE_REQUEST_ID_REQUIRED",
                                       "Use the original request ID.")
        return self._json("/api/datasette/requests/" + request_id)

    def resume(self, request_id):
        self.request(request_id)
        return self._json("/api/datasette/requests/" + request_id + "/resume", body={})

    def wait(self, request_id, *, timeout=3600, progress=None):
        deadline = time.monotonic() + timeout
        previous = None
        while True:
            value = self.request(request_id)
            marker = (value.get("status"), value.get("updated_at"))
            if progress and marker != previous:
                progress(value)
            previous = marker
            if value["status"] != "RUNNING":
                return value
            if time.monotonic() >= deadline:
                raise DatasetteClientError("DATASETTE_REQUEST_STILL_RUNNING",
                                           "The original request is still running; reopen this same request ID.",
                                           request_id=request_id)
            time.sleep(0.5)

    def intake(self, path):
        path = Path(path)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            raw = stream.read(_MAX_JSON + 1)
        if len(raw) > _MAX_JSON:
            raise DatasetteClientError("DATASETTE_HANDOVER_TOO_LARGE",
                                       "Use the existing local path for the complete handover.")
        self.status()
        return self._json("/api/datasette/intake", body=raw,
                          headers={"Content-Type": "application/json",
                                   "X-Datasette-Filename": quote(path.name)})

    def download(self, name, destination, *, edition_id=None, export_id=None, expected_sha256=None):
        query = {"name": name}
        if edition_id is not None:
            query["edition_id"] = edition_id
        if export_id is not None:
            query["export_id"] = export_id
        path = Path(destination).expanduser().absolute()
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.parent.resolve() != path.parent:
            raise DatasetteClientError("DATASETTE_DOWNLOAD_DIRECTORY_INVALID",
                                       "Choose a canonical destination directory.")
        descriptor, temporary = tempfile.mkstemp(prefix=".datasette-download-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as target, self._open(
                    "/api/datasette/download?" + urlencode(query)) as source:
                digest = source.headers.get("X-Content-SHA256", "")
                length_text = source.headers.get("Content-Length", "")
                if (not _HASH.fullmatch(digest) or not re.fullmatch(r"[0-9]+", length_text)
                        or expected_sha256 is not None and digest != expected_sha256):
                    raise DatasetteClientError("DATASETTE_DOWNLOAD_IDENTITY_CHANGED",
                                               "The original download identity differs from the selected file.")
                expected, actual, hasher = int(length_text), 0, hashlib.sha256()
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    actual += len(block)
                    if actual > expected:
                        raise DatasetteClientError("DATASETTE_DOWNLOAD_TOO_LONG",
                                                   "The download exceeds its original byte count.")
                    hasher.update(block)
                    target.write(block)
                if actual != expected or hasher.hexdigest() != digest:
                    raise DatasetteClientError("DATASETTE_DOWNLOAD_INCOMPLETE",
                                               "Repeat the same original file download.")
                target.flush()
                os.fsync(target.fileno())
            try:
                os.link(temporary, path, follow_symlinks=False)
                reused = False
            except FileExistsError:
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(descriptor, "rb") as existing:
                    same = os.fstat(existing.fileno()).st_size == expected
                    same = same and hashlib.file_digest(existing, "sha256").hexdigest() == digest
                if not same:
                    raise DatasetteClientError("DATASETTE_DOWNLOAD_DESTINATION_EXISTS",
                                               "Choose a new destination; the existing file is different.")
                reused = True
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            return {"filename": name, "path": str(path), "bytes": actual,
                    "sha256": digest, "reused": reused}
        finally:
            Path(temporary).unlink(missing_ok=True)
