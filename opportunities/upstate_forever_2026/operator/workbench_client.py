#!/usr/bin/env python3
"""TokenJunkieLabs client for the existing local scientific workbench API.

Uses the original operator queue and authenticated file transport. No additional
server, scientific engine, background worker, or automatic mutation retry.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import time
import urllib.parse
import uuid

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.common import canonical, identifier, read_json
from model import portable_fs as _fs
from model.retained_download import (OperatorTransport, download as receive_download,
                                     receive_cohort, atomic_json)
from model.staged_transport import stage_file, StagedPending

MAX_JSON = 4 * 1024 * 1024
MAX_RESPONSE = 64 * 1024 * 1024
ACTIVE = {"queued", "running"}
OPERATION = re.compile(r"[A-Za-z0-9_-]{16,100}\Z")


class APIError(RuntimeError):
    def __init__(self, status, code, message):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code = status, code


class WorkbenchClient:
    def __init__(self, connection, *, workspace=None, timeout=60, trusted_origin=None):
        value = read_json(Path(connection))
        if not isinstance(value, dict):
            raise ValueError("Select the original private connection object.")
        if value.get("schema") == "upstate.workbench-remote-connection/v1":
            if set(value) != {"schema", "origin", "workspace_key", "recipient_token"}:
                raise ValueError("A recipient connection contains only its origin, workspace and recipient credential.")
            transport = OperatorTransport.recipient(
                value["origin"], value["recipient_token"], trusted_origin)
        else:
            # A native startup capability is accepted ONLY for the original
            # loopback service. Never repurpose it as a remote credential.
            if trusted_origin is not None or "recipient_token" in value:
                raise ValueError("Use the distinct recipient connection schema for a trusted HTTPS origin.")
            url = urllib.parse.urlsplit(value["operator_url"])
            origin = urllib.parse.urlsplit(value["origin"])
            tokens = urllib.parse.parse_qs(url.fragment).get("token", [])
            if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
                    or url.username is not None or url.password is not None
                    or url.path not in ("", "/") or url.query or len(tokens) != 1 or not tokens[0]
                    or origin.scheme != "http" or origin.hostname != "127.0.0.1"
                    or origin.port != url.port or origin.username is not None
                    or origin.password is not None or origin.path not in ("", "/")
                    or origin.query or origin.fragment):
                raise ValueError("Select the original local operator startup JSON.")
            transport = OperatorTransport.loopback(url.port, tokens[0])
        self._transport = transport
        self.port, self._token = transport.port, transport.credential
        self.workspace = identifier(workspace or value["workspace_key"])
        self.timeout = timeout

    def __repr__(self):
        return f"WorkbenchClient(origin={self._transport.origin!r}, workspace={self.workspace!r})"

    def _headers(self):
        return {**self._transport.headers(), "Accept": "application/json",
                "Accept-Encoding": "identity"}

    @staticmethod
    def _path(path):
        url = urllib.parse.urlsplit(path)
        if (not path.startswith("/api/") or url.scheme or url.netloc or url.fragment
                or any(ord(c) < 32 or ord(c) == 127 for c in path)):
            raise ValueError("Choose a relative original workbench API route.")
        return path

    def _response(self, response, *, relay_id=None, require_marker=False):
        returned = response.getheader("X-Eco-Request-ID")
        if relay_id is not None and returned is not None and returned != relay_id:
            raise ValueError("The relay returned a different original request ID.")
        transport_error = response.getheader("X-Eco-Transport-Error")
        if relay_id is not None:
            if response.getheader("X-Eco-Uncertain") == "1":
                raise StagedPending(relay_id, "The original native outcome is uncertain; observe or reconcile it without repeating the write.")
            if response.getheader("X-Eco-Pending") == "1":
                raise StagedPending(relay_id, "The relay is still waiting for the original native response; this is not a native task receipt.")
            if transport_error:
                raise StagedPending(relay_id, "The original relay reported " + transport_error + "; retain this ID and resolve transport or authorization.")
            if require_marker and returned != relay_id:
                raise StagedPending(relay_id, "The relay did not supply this original result identity.")
        if 300 <= response.status < 400:
            raise APIError(response.status, "REDIRECT_REJECTED",
                           "The original API request was redirected; credentials were not forwarded.")
        if response.getheader("Content-Encoding", "identity") != "identity":
            raise ValueError("The original API response encoding differs; retain the original request.")
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError("Use the original paginated API for this large result.")
        declared = response.getheader("Content-Length")
        if declared is not None and (not declared.isdecimal() or int(declared) != len(raw)):
            raise ValueError("The complete API response length differs; retain the original request.")
        declared_sha = response.getheader("X-Eco-Body-SHA256")
        if declared_sha is not None and (not re.fullmatch(r"[0-9a-f]{64}", declared_sha)
                or hashlib.sha256(raw).hexdigest() != declared_sha):
            raise ValueError("The original API result differs from its declared complete SHA-256.")
        if require_marker and declared_sha is None:
            raise StagedPending(relay_id, "The relay has not supplied the complete original native result hash.")
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError) as error:
            raise ValueError("The operator returned an incomplete JSON response; retain the original request.") from error
        if not 200 <= response.status < 300:
            detail = value.get("error", {}) if isinstance(value, dict) else {}
            if isinstance(detail, dict):
                code = detail.get("code", "OPERATOR")
                message = detail.get("message", "The original API request did not complete.")
            else:
                code, message = "OPERATOR", str(detail or "The original API request did not complete.")
            raise APIError(response.status, code, message)
        return value

    def request(self, path, body=None, *, method=None):
        self._path(path)
        method = method or ("POST" if body is not None else "GET")
        if method not in {"GET", "POST", "PUT"} or (method == "GET" and body is not None):
            raise ValueError("Use an original GET, POST or PUT API operation.")
        if method in {"POST", "PUT"} and body is None:
            raise ValueError("Keep the complete JSON body for the original write operation.")
        data = canonical(body) if body is not None else None
        if data is not None and len(data) > MAX_JSON:
            raise ValueError("Upload original files separately; JSON requests are limited to 4 MiB.")
        headers = self._headers()
        if data is not None:
            headers.update({"Content-Type": "application/json", "Content-Length": str(len(data))})
        relay_id = str(uuid.uuid4()) if self._transport.credential_kind == "recipient" else None
        if relay_id is not None:
            headers["X-Eco-Request-ID"] = relay_id
        connection = self._transport.connection(timeout=self.timeout)
        try:
            connection.request(method, path, body=data, headers=headers)
            return self._response(connection.getresponse(), relay_id=relay_id)
        except (OSError, http.client.HTTPException, ValueError) as error:
            if relay_id is not None:
                raise StagedPending(relay_id, "The original remote response was interrupted or unverifiable; observe the same ID before deciding any next operation. " + str(error)) from error
            raise
        finally:
            connection.close()

    def relay_result(self, request_id):
        """Observe an original small JSON response without submitting a write."""
        if (self._transport.credential_kind != "recipient"
                or not isinstance(request_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", request_id)):
            raise ValueError("Select a retained relay ID on the same trusted recipient connection.")
        connection = self._transport.connection(timeout=self.timeout)
        try:
            connection.request("GET", "/_eco/v1/requests/" + request_id + "/result",
                               headers=self._headers())
            return self._response(connection.getresponse(), relay_id=request_id, require_marker=True)
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise StagedPending(request_id, "The original result observation stopped; keep this same ID. " + str(error)) from error
        finally:
            connection.close()

    def query(self, path, **values):
        return self.request(path + "?" + urllib.parse.urlencode({
            "workspace": self.workspace, **{k: v for k, v in values.items() if v is not None}}))

    def _write_body(self, path, body):
        if not isinstance(body, dict):
            raise ValueError("Keep the complete original JSON object for this write.")
        route = urllib.parse.urlsplit(self._path(path)).path
        if route == "/api/measurement-workspace" or route.startswith("/api/measurement-workspace/"):
            # These APIs receive complete hash-bound documents. Workspace is
            # selected by the mounted native service, not an added document key.
            return body
        return {**body, "workspace": self.workspace}

    def post(self, path, body):
        return self.request(path, self._write_body(path, body))

    def put(self, path, body):
        return self.request(path, self._write_body(path, body), method="PUT")

    def state(self, *, compact=True):
        return self.query("/api/state", compact="1" if compact else "0")

    def catalog(self):
        return self.query("/api/workbench-api")

    def freeze(self, action, payload, destination, *, operation_id=None):
        if not isinstance(action, str) or not action or not isinstance(payload, dict):
            raise ValueError("Choose the original action and a complete payload object.")
        operation_id = operation_id or str(uuid.uuid4())
        if not OPERATION.fullmatch(operation_id):
            raise ValueError("Keep a stable 16-100 character operation ID using letters, digits, underscore or hyphen.")
        value = {"workspace": self.workspace, "action": action,
                 "payload": payload, "operation_id": operation_id}
        atomic_json(Path(destination), value, immutable=True)
        return value

    def submit(self, request):
        if (not isinstance(request, dict)
                or set(request) != {"workspace", "action", "payload", "operation_id"}
                or request["workspace"] != self.workspace
                or not isinstance(request["action"], str) or not request["action"]
                or not isinstance(request["payload"], dict)
                or not isinstance(request["operation_id"], str)
                or not OPERATION.fullmatch(request["operation_id"])):
            raise ValueError("Submit the complete frozen request for this exact original workspace.")
        return self.request("/api/actions", request)

    def task(self, task_id):
        value = self.request("/api/task?" + urllib.parse.urlencode({"id": identifier(task_id)}))
        if value.get("workspace") != self.workspace:
            raise ValueError("The retained task belongs to another selected workspace.")
        return value

    def wait(self, task_id, *, seconds=60, interval=1):
        if seconds < 0 or interval <= 0:
            raise ValueError("Use a nonnegative observation window and positive polling interval.")
        deadline = time.monotonic() + seconds
        while True:
            value = self.task(task_id)
            remaining = deadline - time.monotonic()
            if value.get("state") not in ACTIVE or remaining <= 0:
                return value
            time.sleep(min(interval, remaining))

    def resume(self, task_id):
        current = self.task(task_id)
        if current["state"] in ACTIVE or current["state"] == "complete":
            return current
        return self.request("/api/task/resume", {"id": current["id"]})

    def cancel(self, task_id):
        current = self.task(task_id)
        return self.request("/api/task/cancel", {"id": current["id"]})

    def upload(self, filename, *, media_type=None):
        path = Path(filename)
        if not _fs.native_path(path).is_file() or _fs.native_path(path).is_symlink():
            raise ValueError("Choose a complete original regular file.")
        media_type = media_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if any(ord(c) < 32 or ord(c) == 127 for c in media_type):
            raise ValueError("Choose an ordinary original content type.")
        digest = hashlib.sha256()
        with os.fdopen(_fs.open_file(path, os.O_RDONLY), "rb") as original:
            before = _fs.fd_stat(original.fileno())
            for block in iter(lambda: original.read(1024 * 1024), b""):
                digest.update(block)
            original.seek(0)
            headers = {**self._headers(), "X-Workspace": self.workspace,
                       "X-Upload-Filename": urllib.parse.quote(path.name, safe=""),
                       "Content-Type": media_type, "Content-Length": str(before.st_size)}
            relay_id = str(uuid.uuid4()) if self._transport.credential_kind == "recipient" else None
            if relay_id is not None:
                headers["X-Eco-Request-ID"] = relay_id
            connection = self._transport.connection(timeout=self.timeout)
            try:
                connection.request("POST", "/api/upload", body=original, headers=headers)
                value = self._response(connection.getresponse(), relay_id=relay_id)
            except (OSError, http.client.HTTPException, ValueError) as error:
                if relay_id is not None:
                    raise StagedPending(relay_id, "The original upload response stopped; observe this same ID and verify the original receipt. " + str(error)) from error
                raise
            finally:
                connection.close()
            after = _fs.fd_stat(original.fileno())
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if (signature(before) != signature(after) or value.get("bytes") != before.st_size
                or value.get("sha256") != digest.hexdigest() or value.get("filename") != path.name):
            if relay_id is not None:
                error = StagedPending(relay_id, "The uploaded original changed or its receipt differs; inspect this original result before any next operation.")
                error.receipt = value
                raise error
            raise ValueError("The uploaded original changed or the receipt differs. Keep the original file and receipt.")
        return value

    def stage_upload(self, filename, journal, result, *, media_type=None, wait_seconds=60):
        path = Path(filename)
        media_type = media_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return stage_file(self._transport, workspace=self.workspace, method="POST",
                          path="/api/upload", filename=path, journal=journal, result=result,
                          headers={"X-Workspace": self.workspace,
                                   "X-Upload-Filename": urllib.parse.quote(path.name, safe=""),
                                   "Content-Type": media_type}, upload_name=path.name,
                          timeout=self.timeout, wait_seconds=wait_seconds)

    def stage_json(self, method, path, filename, journal, result, *, wait_seconds=60):
        # The existing JSON file is transferred byte-for-byte. Its native action
        # operation_id/workspace or full Measurements document is never rebuilt.
        return stage_file(self._transport, workspace=self.workspace, method=method,
                          path=self._path(path), filename=filename, journal=journal, result=result,
                          headers={"Content-Type": "application/json",
                                   "X-Workspace": self.workspace},
                          timeout=self.timeout, wait_seconds=wait_seconds)

    def download(self, ticket, destination, *, progress=None):
        return receive_download(self.port, self._token, ticket, destination, progress=progress,
                                transport=self._transport)

    def download_task(self, task_id, directory, *, progress=None):
        task = self.task(task_id)
        if task["state"] != "complete":
            raise ValueError("Open the completed original task before downloading its outputs.")
        tickets = task.get("_downloads", [])
        if not tickets:
            raise ValueError("This task has no retained output files.")
        return receive_cohort(self.port, self._token, tickets, directory,
                              source={"workspace": self.workspace, "task": task["id"]}, progress=progress,
                              transport=self._transport)


def readable(value):
    if isinstance(value, dict) and "action" in value and "state" in value:
        lines = [f"Operation: {value['action']}", f"State: {value['state']}", f"Task: {value.get('id', '')}"]
        if value.get("action") == "intelligence.ask":
            progress = value.get("provider_wait")
            if isinstance(progress, dict):
                message = progress.get("message")
                phase = progress.get("phase")
                if isinstance(message, str) and message:
                    lines.append("Assistant: " + message)
                elif isinstance(phase, str) and phase:
                    lines.append("Assistant: " + phase.replace("_", " "))
                turn, maximum = progress.get("round"), progress.get("max_rounds")
                if type(turn) is int and type(maximum) is int and 0 < turn <= maximum:
                    lines.append(f"Provider round: {turn} of {maximum}")
                attempt = progress.get("attempt")
                if type(attempt) is int and attempt > 0:
                    lines.append(f"Provider attempt: {attempt}")
                elapsed = progress.get("elapsed_seconds")
                if type(elapsed) in (int, float) and 0 <= elapsed < float("inf"):
                    lines.append(f"Elapsed in phase: {elapsed:.1f}s")
                status = progress.get("http_status")
                if type(status) is int and 100 <= status <= 599:
                    lines.append(f"Provider HTTP status: {status}")
                retry_after = progress.get("retry_after_seconds")
                if type(retry_after) in (int, float) and 0 <= retry_after < float("inf"):
                    lines.append(f"Provider retry interval: {retry_after:g}s")
            if value.get("cancel_requested") and value.get("state") in ACTIVE:
                lines.append("Cancellation: requested; waiting for the task to finish stopping.")
            elif value.get("state") == "cancelled":
                lines.append("Cancellation: stopped; the original question is retained.")
        result = value.get("result") or {}
        if result.get("title"):
            lines.append("Result: " + str(result["title"]))
        if value.get("error"):
            lines.append("Action needed: " + str(value["error"].get("message", value["error"])))
        lines.extend("File: " + str(t.get("filename") or t.get("title") or t.get("id"))
                     for t in value.get("_downloads", []))
        return "\n".join(lines)
    if isinstance(value, dict) and "data" in value and "workspace_key" in value:
        data = value["data"]
        lines = ["Workspace: " + str(data.get("project", {}).get("title", value["workspace_key"]))]
        lines.extend(name.replace("_", " ").capitalize() + ": " + str(len(data.get(name, [])))
                     for name in ("sources", "profiles", "scenarios", "grids", "runs", "deliveries"))
        return "\n".join(lines)
    if isinstance(value, dict) and "filename" in value and "sha256" in value:
        return f"Original retained: {value['filename']}\nBytes: {value.get('bytes')}\nUpload: {value.get('id')}\nSHA-256: {value['sha256']}"
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", required=True, type=Path, help="Private original startup JSON; never publish it.")
    parser.add_argument("--workspace", help="Select another existing workspace on the SAME operator.")
    parser.add_argument("--trusted-origin", help="Explicit canonical HTTPS443 origin for a separate recipient connection.")
    parser.add_argument("--json", action="store_true", help="Machine-readable output; ordinary task/status output is readable.")
    parser.add_argument("--out", type=Path, help="Save complete noncredential response JSON.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("state")
    sub.add_parser("catalog")
    sub.add_parser("runtime")
    relay = sub.add_parser("relay-result"); relay.add_argument("id")
    get = sub.add_parser("get"); get.add_argument("path"); get.add_argument("--query", type=Path)
    post = sub.add_parser("post"); post.add_argument("path"); post.add_argument("--body", required=True, type=Path)
    put = sub.add_parser("put"); put.add_argument("path"); put.add_argument("--body", required=True, type=Path)
    upload = sub.add_parser("upload"); upload.add_argument("file", type=Path); upload.add_argument("--media-type")
    stage_upload = sub.add_parser("stage-upload"); stage_upload.add_argument("file", type=Path)
    stage_upload.add_argument("--media-type")
    stage_json = sub.add_parser("stage-json"); stage_json.add_argument("method", choices=["POST", "PUT"])
    stage_json.add_argument("path"); stage_json.add_argument("file", type=Path)
    for selected in (stage_upload, stage_json):
        selected.add_argument("--journal", required=True, type=Path)
        selected.add_argument("--result", required=True, type=Path)
        selected.add_argument("--seconds", type=float, default=60)
    freeze = sub.add_parser("freeze"); freeze.add_argument("action"); freeze.add_argument("--payload", required=True, type=Path)
    freeze.add_argument("--request", required=True, type=Path); freeze.add_argument("--operation-id")
    submit = sub.add_parser("submit"); submit.add_argument("request", type=Path)
    for name in ("task", "wait", "resume", "cancel", "download-task"):
        selected = sub.add_parser(name); selected.add_argument("id")
        if name == "wait":
            selected.add_argument("--seconds", type=float, default=60)
        if name == "download-task":
            selected.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    client = WorkbenchClient(args.connection, workspace=args.workspace,
                             trusted_origin=args.trusted_origin)
    if args.command == "state": value = client.state()
    elif args.command == "catalog": value = client.catalog()
    elif args.command == "runtime": value = client.query("/api/runtime")
    elif args.command == "relay-result": value = client.relay_result(args.id)
    elif args.command == "get": value = client.query(args.path, **(read_json(args.query) if args.query else {}))
    elif args.command == "post": value = client.post(args.path, read_json(args.body))
    elif args.command == "put": value = client.put(args.path, read_json(args.body))
    elif args.command == "upload": value = client.upload(args.file, media_type=args.media_type)
    elif args.command == "stage-upload":
        value = client.stage_upload(args.file, args.journal, args.result,
                                    media_type=args.media_type, wait_seconds=args.seconds)
    elif args.command == "stage-json":
        value = client.stage_json(args.method, args.path, args.file, args.journal, args.result,
                                  wait_seconds=args.seconds)
    elif args.command == "freeze":
        value = client.freeze(args.action, read_json(args.payload), args.request, operation_id=args.operation_id)
    elif args.command == "submit": value = client.submit(read_json(args.request))
    elif args.command == "wait": value = client.wait(args.id, seconds=args.seconds)
    elif args.command == "download-task": value = client.download_task(args.id, args.directory)
    else: value = getattr(client, args.command)(args.id)
    if args.out:
        atomic_json(args.out, value)
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) if args.json else readable(value))
    if args.command in {"stage-upload", "stage-json"} and not 200 <= value["status"] < 300:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (APIError, StagedPending, ValueError, OSError, KeyError, http.client.HTTPException) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
