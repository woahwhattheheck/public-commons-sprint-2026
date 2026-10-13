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
from model.common import atomic_json, canonical, identifier, read_json
from model.retained_download import download as receive_download, receive_cohort

MAX_JSON = 4 * 1024 * 1024
MAX_RESPONSE = 64 * 1024 * 1024
ACTIVE = {"queued", "running"}
OPERATION = re.compile(r"[A-Za-z0-9_-]{16,100}\Z")


class APIError(RuntimeError):
    def __init__(self, status, code, message):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code = status, code


class WorkbenchClient:
    def __init__(self, connection, *, workspace=None, timeout=60):
        value = read_json(Path(connection))
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
        self.port, self._token = url.port, tokens[0]
        self.workspace = identifier(workspace or value["workspace_key"])
        self.timeout = timeout

    def __repr__(self):
        return f"WorkbenchClient(port={self.port}, workspace={self.workspace!r})"

    def _headers(self):
        return {"Authorization": "Bearer " + self._token, "Accept": "application/json"}

    @staticmethod
    def _path(path):
        url = urllib.parse.urlsplit(path)
        if (not path.startswith("/api/") or url.scheme or url.netloc or url.fragment
                or any(ord(c) < 32 or ord(c) == 127 for c in path)):
            raise ValueError("Choose a relative original workbench API route.")
        return path

    def _response(self, response):
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError("Use the original paginated API for this large result.")
        declared = response.getheader("Content-Length")
        if declared is not None and (not declared.isdecimal() or int(declared) != len(raw)):
            raise ValueError("The complete API response length differs; retain the original request.")
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError) as error:
            raise ValueError("The operator returned an incomplete JSON response; retain the original request.") from error
        if not 200 <= response.status < 300:
            detail = value.get("error", {}) if isinstance(value, dict) else {}
            raise APIError(response.status, detail.get("code", "OPERATOR"),
                           detail.get("message", "The original API request did not complete."))
        return value

    def request(self, path, body=None):
        self._path(path)
        data = canonical(body) if body is not None else None
        if data is not None and len(data) > MAX_JSON:
            raise ValueError("Upload original files separately; JSON requests are limited to 4 MiB.")
        headers = self._headers()
        if data is not None:
            headers.update({"Content-Type": "application/json", "Content-Length": str(len(data))})
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)
        try:
            connection.request("POST" if data is not None else "GET", path, body=data, headers=headers)
            return self._response(connection.getresponse())
        finally:
            connection.close()

    def query(self, path, **values):
        return self.request(path + "?" + urllib.parse.urlencode({
            "workspace": self.workspace, **{k: v for k, v in values.items() if v is not None}}))

    def post(self, path, body):
        return self.request(path, {**body, "workspace": self.workspace})

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
        if not path.is_file() or path.is_symlink():
            raise ValueError("Choose a complete original regular file.")
        media_type = media_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if any(ord(c) < 32 or ord(c) == 127 for c in media_type):
            raise ValueError("Choose an ordinary original content type.")
        digest = hashlib.sha256()
        with path.open("rb") as original:
            before = os.fstat(original.fileno())
            for block in iter(lambda: original.read(1024 * 1024), b""):
                digest.update(block)
            original.seek(0)
            headers = {**self._headers(), "X-Workspace": self.workspace,
                       "X-Upload-Filename": urllib.parse.quote(path.name, safe=""),
                       "Content-Type": media_type, "Content-Length": str(before.st_size)}
            connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=self.timeout)
            try:
                connection.request("POST", "/api/upload", body=original, headers=headers)
                value = self._response(connection.getresponse())
            finally:
                connection.close()
            after = os.fstat(original.fileno())
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if (signature(before) != signature(after) or value.get("bytes") != before.st_size
                or value.get("sha256") != digest.hexdigest() or value.get("filename") != path.name):
            raise ValueError("The uploaded original changed or the receipt differs. Keep the original file and receipt.")
        return value

    def download(self, ticket, destination, *, progress=None):
        return receive_download(self.port, self._token, ticket, destination, progress=progress)

    def download_task(self, task_id, directory, *, progress=None):
        task = self.task(task_id)
        if task["state"] != "complete":
            raise ValueError("Open the completed original task before downloading its outputs.")
        tickets = task.get("_downloads", [])
        if not tickets:
            raise ValueError("This task has no retained output files.")
        return receive_cohort(self.port, self._token, tickets, directory,
                              source={"workspace": self.workspace, "task": task["id"]}, progress=progress)


def readable(value):
    if isinstance(value, dict) and "action" in value and "state" in value:
        lines = [f"Operation: {value['action']}", f"State: {value['state']}", f"Task: {value.get('id', '')}"]
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
    parser.add_argument("--json", action="store_true", help="Machine-readable output; ordinary task/status output is readable.")
    parser.add_argument("--out", type=Path, help="Save complete noncredential response JSON.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("state")
    sub.add_parser("catalog")
    sub.add_parser("runtime")
    get = sub.add_parser("get"); get.add_argument("path"); get.add_argument("--query", type=Path)
    post = sub.add_parser("post"); post.add_argument("path"); post.add_argument("--body", required=True, type=Path)
    upload = sub.add_parser("upload"); upload.add_argument("file", type=Path); upload.add_argument("--media-type")
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
    client = WorkbenchClient(args.connection, workspace=args.workspace)
    if args.command == "state": value = client.state()
    elif args.command == "catalog": value = client.catalog()
    elif args.command == "runtime": value = client.query("/api/runtime")
    elif args.command == "get": value = client.query(args.path, **(read_json(args.query) if args.query else {}))
    elif args.command == "post": value = client.post(args.path, read_json(args.body))
    elif args.command == "upload": value = client.upload(args.file, media_type=args.media_type)
    elif args.command == "freeze":
        value = client.freeze(args.action, read_json(args.payload), args.request, operation_id=args.operation_id)
    elif args.command == "submit": value = client.submit(read_json(args.request))
    elif args.command == "wait": value = client.wait(args.id, seconds=args.seconds)
    elif args.command == "download-task": value = client.download_task(args.id, args.directory)
    else: value = getattr(client, args.command)(args.id)
    if args.out:
        atomic_json(args.out, value)
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) if args.json else readable(value))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (APIError, ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
