"""Operate editorial reviews through the existing Analysis HTTP lease holder."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid
from urllib.error import HTTPError

from .analysis_report_reviews import encoded, MAX_RETURN, _id, fail
from .workbook_client import WorkspaceWorkbookClient
from .storage import read, write, private_directory, lock, parse

class ReportReviewClient(WorkspaceWorkbookClient):
    def call(self, path, body=None):
        try:
            with self.opener.open(self._request(path, body), timeout=120) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
                if len(raw) > 64 * 1024 * 1024:
                    fail("API_RESPONSE_TOO_LARGE")
                return parse(raw)
        except HTTPError as error:
            try:
                code = parse(error.read(64 * 1024)).get("error")
            except Exception:
                code = "REPORT_REVIEW_HTTP_FAILED"
            fail(code or "HTTP_FAILED")

    def mutate(self, path, value, operation):
        """Retain exact request and workspace identity before dispatch.

        An operation's original request is replayed after an uncertain reply.
        The original workspace may have moved after full archive receiving.
        Its stable identity, path and complete request must still match.
        """
        operation = private_directory(Path(operation).expanduser().absolute())
        with lock(operation):
            current = self.call("/api/state")
            if current["workspace_id"] != self.workspace_id:
                fail("WORKSPACE_CHANGED")
            input_sha = hashlib.sha256(encoded(value)).hexdigest()
            intent_path = operation / "intent.json"
            if intent_path.exists():
                intent = parse(read(intent_path, MAX_RETURN + 1024 * 1024))
                if intent["workspace_id"] != self.workspace_id or intent["path"] != path or intent["input_sha256"] != input_sha:
                    fail("CLIENT_OPERATION_REUSED")
            else:
                body = json.loads(encoded(value))
                if path in {"/api/report-reviews"} or path.endswith("/apply"):
                    body.setdefault("id", uuid.uuid4().hex)
                intent = {"schema": "stellar-forge.report-review-client.v1", "workspace_id": self.workspace_id,
                          "original_database": str(self.database), "path": path, "input_sha256": input_sha, "request": body}
                write(intent_path, encoded(intent), exclusive=True)
            result = self.call(intent["path"], intent["request"])
            raw = encoded(result)
            observed = operation / ("result-" + hashlib.sha256(raw).hexdigest() + ".json")
            if observed.exists():
                if read(observed, 64 * 1024 * 1024) != raw:
                    fail("CLIENT_RESULT_CHANGED")
            else:
                write(observed, raw, exclusive=True)
            write(operation / "result.json", raw)
            return result

    def download_issue(self, identity, name, destination):
        _id(identity)
        if name not in {"review.html", "package.json"}:
            fail("DOWNLOAD_NAME_INVALID")
        destination = Path(destination).expanduser().absolute()
        private_directory(destination.parent)
        request = self._request(f"/api/report-reviews/{identity}/{name}")
        fd, temporary = tempfile.mkstemp(prefix=".report-review-", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as output, self.opener.open(request, timeout=120) as response:
                expected = response.headers.get("X-Content-SHA256")
                length = int(response.headers.get("Content-Length", "-1"))
                if not expected or not 0 <= length <= 512 * 1024 * 1024:
                    fail("DOWNLOAD_METADATA_INVALID")
                size = 0
                checksum = hashlib.sha256()
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    size += len(block)
                    if size > length:
                        fail("DOWNLOAD_LENGTH_CHANGED")
                    checksum.update(block); output.write(block)
                if size != length or checksum.hexdigest() != expected:
                    fail("DOWNLOAD_CHANGED")
                output.flush(); os.fsync(output.fileno())
            if destination.exists():
                if destination.is_symlink() or destination.stat().st_size != length:
                    fail("EXISTING_DOWNLOAD_CHANGED")
                with destination.open("rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                        fail("EXISTING_DOWNLOAD_CHANGED")
            else:
                os.link(temporary, destination)
            return {"name": name, "path": str(destination), "bytes": length, "sha256": expected}
        finally:
            Path(temporary).unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description="Use the original running Analysis workspace for complete report editorial review.")
    parser.add_argument("--database", required=True)
    parser.add_argument("--workspace-id", help="Expected original workspace identity, retained across full archive receiving")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("issue", "receive", "apply"):
        sub = commands.add_parser(command)
        sub.add_argument("--request", required=True, help="Complete JSON request; receive uses the exact attributed return")
        sub.add_argument("--operation", required=True, help="Private retained request directory; reuse after interruption")
        if command == "apply":
            sub.add_argument("--return-id", required=True)
    sub = commands.add_parser("preview"); sub.add_argument("--return-id", required=True); sub.add_argument("--mapping"); sub.add_argument("--output", required=True)
    sub = commands.add_parser("download"); sub.add_argument("--issue-id", required=True); sub.add_argument("--name", choices=["review.html", "package.json"], required=True); sub.add_argument("--output", required=True)
    sub = commands.add_parser("status"); sub.add_argument("--apply-id", required=True)
    sub = commands.add_parser("history"); sub.add_argument("--before", type=int); sub.add_argument("--limit", type=int, default=25)
    args = parser.parse_args()
    client = ReportReviewClient(args.database, workspace_id=args.workspace_id)
    if args.command in {"issue", "receive", "apply"}:
        value = parse(read(Path(args.request).expanduser().absolute(), MAX_RETURN))
        if not isinstance(value, dict):
            fail("REQUEST_OBJECT_REQUIRED")
        path = ("/api/report-reviews" if args.command == "issue" else "/api/report-review-returns" if args.command == "receive"
                else "/api/report-review-returns/" + _id(args.return_id) + "/apply")
        result = client.mutate(path, value, args.operation)
    elif args.command == "preview":
        mapping = parse(read(Path(args.mapping).expanduser().absolute(), 64 * 1024)) if args.mapping else None
        result = client.call("/api/report-review-returns/" + _id(args.return_id) + "/preview", {"mapping": mapping})
        output = Path(args.output).expanduser().absolute(); private_directory(output.parent)
        raw = encoded(result)
        if output.exists():
            if read(output, 64 * 1024 * 1024) != raw:
                fail("EXISTING_PREVIEW_CHANGED")
        else:
            write(output, raw, exclusive=True)
    elif args.command == "download":
        result = client.download_issue(args.issue_id, args.name, args.output)
    elif args.command == "status":
        result = client.call("/api/report-review-applies/" + _id(args.apply_id))
    else:
        path = "/api/report-reviews?limit=" + str(args.limit)
        if args.before is not None: path += "&before=" + str(args.before)
        result = client.call(path)
    print(encoded(result).decode("utf-8"))

if __name__ == "__main__":
    main()
