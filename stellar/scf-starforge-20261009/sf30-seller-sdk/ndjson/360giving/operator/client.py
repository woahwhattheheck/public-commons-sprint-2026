"""MIT. Operate the original open publisher through its current private connection."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from publisher_workspace import InputError, MAX_UPLOAD, encoded, file_info, load_json
from managed import STARTUP, regular_bytes

MAX_JSON = 128 * 1024 * 1024
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class PublisherClient:
    """Each call rereads the same saved connection; accepted request IDs stay unchanged."""

    def __init__(self, connection_file, timeout=120):
        self.connection_file = Path(connection_file).expanduser().absolute()
        self.timeout = timeout
        self.workspace_id = None
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def _record(self):
        data, _ = regular_bytes(self.connection_file, private=True, limit=65536)
        text = data.decode("utf-8").strip()
        record = None
        if text.startswith("{"):
            record = load_json(text)
            if (not isinstance(record, dict) or record.get("schema") != "stellar-forge.application-url.v1"
                    or record.get("command") != "dataset-360giving-workspace"
                    or not isinstance(record.get("workspaceId"), str)):
                raise InputError("Select the saved 360Giving Applications connection")
            text = record["url"]
        try:
            selected = urlsplit(text)
            port = selected.port
        except (TypeError, ValueError) as error:
            raise InputError("The original publisher connection URL is invalid") from error
        if (selected.scheme != "http" or selected.hostname != "127.0.0.1"
                or not port or not 1 <= port <= 65535 or selected.username or selected.password
                or selected.path != "/" or selected.query or not TOKEN.fullmatch(selected.fragment)):
            raise InputError("Select the original private loopback publisher connection")
        return {"url": text, "origin": "http://127.0.0.1:" + str(port),
                "token": selected.fragment, "record": record}

    def _open(self, connection, path, *, body=None, length=None, media="application/json"):
        if not path.startswith("/api/") or "\r" in path or "\n" in path:
            raise InputError("Select an original publisher API operation")
        headers = {"Authorization": "Bearer " + connection["token"], "Connection": "close"}
        if body is not None:
            headers.update({"Content-Type": media, "Content-Length": str(length)})
        request = Request(connection["origin"] + path, data=body, headers=headers,
                          method="POST" if body is not None else "GET")
        try:
            return self.opener.open(request, timeout=self.timeout)
        except HTTPError as error:
            try:
                raw = error.read(65537)
                message = load_json(raw).get("error") if len(raw) <= 65536 else None
            except (ValueError, TypeError, AttributeError):
                message = None
            finally:
                error.close()
            raise InputError(message or "The original publisher returned HTTP " + str(error.code)) from error
        except (URLError, TimeoutError, OSError) as error:
            raise InputError("The current publisher connection could not be reached; reopen its saved application and resume the same request") from error

    def _json(self, connection, path, body=None):
        raw = encoded(body) if body is not None else None
        with self._open(connection, path, body=raw, length=len(raw) if raw is not None else None) as response:
            if response.headers.get_content_type() != "application/json":
                raise InputError("The original publisher returned a different response type")
            length = response.headers.get("Content-Length", "")
            if not length.isdecimal() or int(length) > MAX_JSON:
                raise InputError("The original publisher JSON response exceeds its complete-response limit")
            data = response.read(int(length) + 1)
            if len(data) != int(length):
                raise InputError("The original publisher response was interrupted")
            return load_json(data)

    def connect(self):
        selected = self._record()
        launch = self._json(selected, "/api/launch")
        if (not isinstance(launch, dict) or launch.get("schema") != STARTUP
                or launch.get("status") != "360GIVING_WORKSPACE_READY"
                or launch.get("url") != selected["url"]
                or not isinstance(launch.get("workspaceId"), str)):
            raise InputError("The running publisher differs from its original connection")
        record = selected["record"]
        if record is not None:
            original = record.get("original", {})
            if (record["workspaceId"] != launch["workspaceId"]
                    or original.get("bindingSha256") != launch.get("bindingSha256")
                    or original.get("workspace") != launch.get("workspace")):
                raise InputError("The saved application points to a different publisher")
        if self.workspace_id is not None and self.workspace_id != launch["workspaceId"]:
            raise InputError("The original publisher workspace changed during this command")
        self.workspace_id = launch["workspaceId"]
        return selected

    def json(self, path, body=None):
        return self._json(self.connect(), path, body)

    def upload(self, filename):
        path = Path(filename).expanduser().absolute()
        expected = file_info(path, MAX_UPLOAD)
        connection = self.connect()
        with path.open("rb") as source:
            with self._open(connection, "/api/upload", body=source, length=expected["bytes"],
                            media="application/octet-stream") as response:
                data = response.read(65537)
                if len(data) > 65536:
                    raise InputError("The original upload response exceeds its expected size")
                result = load_json(data)
        if (result.get("id") != expected["sha256"] or result.get("sha256") != expected["sha256"]
                or result.get("bytes") != expected["bytes"]
                or file_info(path, MAX_UPLOAD) != expected):
            raise InputError("The complete uploaded file differs from the selected original")
        return result

    def wait(self, request_id):
        while True:
            record = self.json("/api/request?" + urlencode({"id": request_id}))
            if record.get("id") != request_id:
                raise InputError("The publisher returned another saved request")
            if record.get("status") == "complete":
                return record
            if record.get("status") == "interrupted":
                raise InputError(record.get("error", {}).get("message", "Resume this original publisher request"))
            if record.get("status") not in {"pending", "running"}:
                raise InputError("The original publisher request has an unknown saved state")
            time.sleep(0.5)

    def perform(self, request_id, action, body):
        accepted = self.json("/api/requests", {"id": request_id, "action": action, "input": body})
        if accepted.get("id") != request_id:
            raise InputError("The publisher admitted a different original request")
        return self.wait(request_id)

    def download(self, request_id, expected, output, copy_delivery, *, path=None, media="application/zip"):
        destination = Path(output).expanduser().absolute()
        identity = {"bytes": expected.get("bytes"), "sha256": expected["sha256"]}
        if destination.exists():
            found = file_info(destination, MAX_UPLOAD)
            if found["sha256"] != identity["sha256"] or (identity["bytes"] is not None and found["bytes"] != identity["bytes"]):
                raise InputError("The requested output already contains a different complete handoff")
            return str(destination)
        connection = self.connect()
        fd, name = tempfile.mkstemp(prefix=".360giving-download-", dir=destination.parent)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "wb") as out:
                route = path or "/api/download?" + urlencode({"request": request_id})
                with self._open(connection, route) as response:
                    declared = response.headers.get("Content-Length", "")
                    if (response.headers.get_content_type() != media or not declared.isdecimal()
                            or int(declared) > MAX_UPLOAD
                            or (identity["bytes"] is not None and int(declared) != identity["bytes"])):
                        raise InputError("The original download differs from its complete saved file")
                    identity["bytes"] = int(declared)
                    size, digest = 0, hashlib.sha256()
                    while block := response.read(1024 * 1024):
                        size += len(block)
                        if size > MAX_UPLOAD or size > identity["bytes"]:
                            raise InputError("The complete publisher handoff exceeds its saved byte count")
                        out.write(block)
                        digest.update(block)
                    out.flush()
                    os.fsync(out.fileno())
            if {"bytes": size, "sha256": digest.hexdigest()} != identity:
                raise InputError("The complete publisher handoff download was interrupted")
            return copy_delivery(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)


def remote_command(args, copy_delivery):
    command = args.command
    if command in {"init", "serve", "binding"}:
        raise InputError("Use --workspace for " + command + "; the selected connection already opens its publisher")
    client = PublisherClient(args.connection)
    if command == "state":
        return client.json("/api/state")
    if command == "upload":
        return client.upload(args.file)
    if command == "review":
        q = {"edition": args.edition}
        if args.decision:
            q["decision"] = args.decision
        return client.json("/api/review?" + urlencode(q))
    if command == "request":
        return client.json("/api/request?" + urlencode({"id": args.id}))
    if command == "resume":
        client.json("/api/resume", {"id": args.id})
        return client.wait(args.id)
    if command == "query":
        return client.json("/api/query", {
            "dataset": args.dataset, "build": args.build, "query": load_json(args.params)})
    if command == "native-state":
        return client.json("/api/native-state?" + urlencode({"dataset": args.dataset}))
    if command == "changes":
        return client.json("/api/changes?" + urlencode({
            "dataset": args.dataset, "comparison": args.comparison,
            "offset": args.offset, "limit": args.limit}))
    if command == "changes-file":
        native = client.json("/api/native-state?" + urlencode({"dataset": args.dataset}))
        selected = next((item for item in native["comparisons"] if item["id"] == args.comparison), None)
        if selected is None:
            raise InputError("Select an original saved comparison")
        destination = client.download(None, {"sha256": selected["changesSha256"]}, args.out, copy_delivery,
            path="/api/changes-file?" + urlencode({"dataset": args.dataset, "comparison": args.comparison}),
            media="application/x-ndjson")
        return {"comparison": selected, "copiedTo": destination, **file_info(destination, MAX_UPLOAD)}
    if command == "intake":
        body = {"dataset": args.dataset, "label": args.label, "sourceUrl": args.source_url,
                **{key: client.upload(getattr(args, key))["id"] if getattr(args, key) else None
                   for key in ("source", "registry", "capture", "transport")}}
    elif command == "decisions":
        body = {"edition": args.edition, "object": client.upload(args.file)["id"]}
    elif command == "candidate":
        body = {"edition": args.edition, "decision": args.decision}
    elif command == "build":
        body = {"edition": args.edition, "candidate": args.candidate}
    elif command == "compare":
        body = {"dataset": args.dataset, "before": args.before, "after": args.after}
    elif command == "export":
        body = {"edition": args.edition, "decision": args.decision, "candidate": args.candidate}
    elif command == "receive":
        body = {"object": client.upload(args.file)["id"]}
    else:
        raise InputError("Unknown original publisher operation")
    result = client.perform(args.request, command, body)
    if command == "export" and args.out:
        result = {**result, "copiedTo": client.download(args.request, result["result"], args.out, copy_delivery)}
    return result
