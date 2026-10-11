"""Deliver a saved workbook through the original running customer workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

from .analysis_workbooks import WorkbookDelivery
from .errors import StateError
from .storage import digest, parse, private_directory, read, write


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise StateError("ANALYSIS_WORKBOOK_LOCAL_REDIRECT_REFUSED")


class WorkspaceWorkbookClient:
    """Use the existing lease holder and its current private launch capability."""

    def __init__(self, database, *, workspace_id=None):
        self.database = Path(database).absolute()
        self.workspace_id = workspace_id
        self.opener = build_opener(ProxyHandler({}), _NoRedirect)

    def _request(self, path, body=None):
        if not path.startswith("/api/") or path.startswith("//"):
            raise StateError("ANALYSIS_WORKBOOK_API_PATH_INVALID")
        launch = parse(read(self.database / "analysis-launch.json", 64 * 1024))
        url = urlsplit(launch["url"])
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port
                or url.username or url.password or url.query or url.path not in {"", "/"} or not url.fragment):
            raise StateError("ANALYSIS_WORKBOOK_ORIGINAL_LOCAL_LAUNCH_REQUIRED")
        if self.workspace_id is not None and self.workspace_id != launch["workspace_id"]:
            raise StateError("ANALYSIS_WORKBOOK_WORKSPACE_CHANGED")
        self.workspace_id = launch["workspace_id"]
        data = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        headers = {"X-Analysis-Capability": url.fragment}
        if data is not None:
            headers["Content-Type"] = "application/json"
        return Request(f"http://127.0.0.1:{url.port}" + path, data=data, headers=headers)

    def call(self, path, body=None):
        try:
            with self.opener.open(self._request(path, body), timeout=30) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise StateError("ANALYSIS_WORKBOOK_API_RESPONSE_TOO_LARGE")
                return parse(raw)
        except HTTPError as exc:
            try:
                error = parse(exc.read(64 * 1024)).get("error")
            except Exception:
                error = None
            raise StateError(error or "ANALYSIS_WORKBOOK_API_FAILED") from None

    def download(self, job_id, record, destination):
        destination = Path(destination).absolute()
        private_directory(destination.parent)
        if destination.exists():
            raw_size = destination.stat().st_size
            with destination.open("rb") as stream:
                old_sha = hashlib.file_digest(stream, "sha256").hexdigest()
            if raw_size == record["bytes"] and old_sha == record["sha256"]:
                return destination
            raise StateError("ANALYSIS_WORKBOOK_LOCAL_DOWNLOAD_CHANGED")
        fd, temporary = tempfile.mkstemp(prefix=".workbook-download-", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as output, self.opener.open(self._request(f"/api/workbook-runs/{job_id}/file?name={record['name']}"), timeout=30) as response:
                if (response.headers.get("X-Content-SHA256") != record["sha256"]
                        or int(response.headers.get("Content-Length", "-1")) != record["bytes"]):
                    raise StateError("ANALYSIS_WORKBOOK_DOWNLOAD_METADATA_CHANGED")
                size, checksum = 0, hashlib.sha256()
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    size += len(block)
                    if size > record["bytes"]:
                        raise StateError("ANALYSIS_WORKBOOK_DOWNLOAD_SIZE_CHANGED")
                    checksum.update(block)
                    output.write(block)
                if size != record["bytes"] or checksum.hexdigest() != record["sha256"]:
                    raise StateError("ANALYSIS_WORKBOOK_DOWNLOAD_CHANGED")
                output.flush()
                os.fsync(output.fileno())
            # Publish the complete download without replacing a prior file.
            os.link(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return destination

    def deliver(self, recipe, operation, *, wait_seconds=300):
        operation = private_directory(Path(operation))
        intent_path = operation / "intent.json"
        recipe_raw = json.dumps(recipe, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        if intent_path.exists():
            intent = parse(read(intent_path, 2 * 1024 * 1024))
            if intent["recipe_sha256"] != digest(recipe_raw) or intent["database"] != str(self.database):
                raise StateError("ANALYSIS_WORKBOOK_OPERATION_REUSED")
            self.workspace_id = intent["workspace_id"]
        else:
            state = self.call("/api/state")
            if state["workspace_id"] != self.workspace_id:
                raise StateError("ANALYSIS_WORKBOOK_WORKSPACE_CHANGED")
            intent = {"schema": "stellar-forge.workbook-client-operation.v1", "database": str(self.database),
                      "workspace_id": self.workspace_id, "recipe_sha256": digest(recipe_raw),
                      "save_request": {**recipe, "id": uuid.uuid4().hex}, "build_id": uuid.uuid4().hex}
            write(intent_path, json.dumps(intent, ensure_ascii=False, separators=(",", ":")).encode(), exclusive=True)
        # The same IDs survive both a lost HTTP reply and a client restart.
        saved = self.call("/api/workbooks/" + intent["save_request"]["name"], intent["save_request"])
        definition = self.call(f"/api/workbooks/{saved['name']}?revision={saved['revision']}")
        if saved["definition_sha256"] != definition["definition_sha256"]:
            raise StateError("ANALYSIS_WORKBOOK_SAVED_DEFINITION_CHANGED")
        spec = {"id": intent["build_id"], "name": saved["name"], "revision": saved["revision"],
                "definition_sha256": definition["definition_sha256"]}
        write(operation / "build-request.json", json.dumps(spec, separators=(",", ":")).encode())
        job = self.call("/api/start/workbook", spec)
        deadline = time.monotonic() + wait_seconds
        while job["status"] == "RUNNING":
            if time.monotonic() >= deadline:
                return {"status": "RUNNING", "id": job["id"], "operation": str(operation), "progress": job.get("progress", {})}
            time.sleep(0.5)
            job = self.call("/api/jobs/" + job["id"])
        if job["status"] != "COMPLETE":
            raise StateError(job.get("error") or "ANALYSIS_WORKBOOK_DELIVERY_" + job["status"])
        for record in job["result"]["files"]:
            self.download(job["id"], record, operation / record["name"])
        target = operation / "received"
        if target.exists():
            received = WorkbookDelivery(target, expected_manifest_sha256=job["result"]["manifest_sha256"])
        else:
            archive = next(item for item in job["result"]["files"] if item["name"] == "handoff.zip")
            received = WorkbookDelivery.receive(operation / "handoff.zip", target, expected_sha256=archive["sha256"])
        received.inspect()
        receipt = {"status": "COMPLETE", "id": job["id"], "name": saved["name"], "revision": saved["revision"],
                   "manifest_sha256": job["result"]["manifest_sha256"], "row_count": job["result"]["row_count"],
                   "workbook": str(target / "workbook.xlsx"), "received": str(target), "files": job["result"]["files"]}
        write(operation / "delivery.json", json.dumps(receipt, ensure_ascii=False, indent=2).encode())
        return receipt


def main():
    parser = argparse.ArgumentParser(description="Save, build, download and reopen a complete workbook through the running customer workspace.")
    parser.add_argument("--database", required=True, help="Directory of the existing running AnalysisWorkspace")
    parser.add_argument("--recipe", required=True, help="Private JSON workbook definition with expected_revision")
    parser.add_argument("--operation", required=True, help="Private durable request and receiving directory; reuse it to reconnect")
    parser.add_argument("--wait-seconds", type=int, default=300)
    args = parser.parse_args()
    if args.wait_seconds < 0:
        parser.error("--wait-seconds must be nonnegative")
    recipe = parse(read(Path(args.recipe), 1024 * 1024))
    if not isinstance(recipe, dict):
        parser.error("the recipe must be a JSON object")
    result = WorkspaceWorkbookClient(args.database).deliver(recipe, args.operation, wait_seconds=args.wait_seconds)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
