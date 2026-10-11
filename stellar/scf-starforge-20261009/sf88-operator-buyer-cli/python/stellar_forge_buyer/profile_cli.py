"""Customer data profiles over the original local analysis workspace.

Use --launch with an already running browser workspace, or --workspace to own
its existing process lease for the duration of this command. Offline documents
need neither. The CLI never starts a separate HTTP server or payment runtime.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import http.client
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlencode, urlsplit
import uuid

from .dataset_profiles import ProfileDocument, _json, _MAX_DOCUMENT
from .errors import BuyerError, StateError
from .storage import digest, parse, read, write


class _Remote:
    def __init__(self, launch):
        record = parse(read(Path(launch), 1024 * 1024))
        url = urlsplit(record.get("url", ""))
        if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port or url.username or url.password or url.query or url.path not in {"/", ""} or not url.fragment:
            raise StateError("DATA_PROFILE_ORIGINAL_LOOPBACK_LAUNCH_REQUIRED")
        self.port, self.capability = url.port, url.fragment

    def request(self, path, body=None, *, raw=False):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        try:
            headers = {"X-Analysis-Capability": self.capability, "Content-Type": "application/json"}
            connection.request("GET" if body is None else "POST", path, None if body is None else _json(body).encode(), headers)
            response = connection.getresponse()
            data = response.read(_MAX_DOCUMENT + 1)
            if len(data) > _MAX_DOCUMENT:
                raise StateError("DATA_PROFILE_RESPONSE_TOO_LARGE")
            if response.status >= 400:
                result = parse(data)
                raise StateError(str(result.get("error", "DATA_PROFILE_HTTP_FAILED"))[:256])
            return data if raw else parse(data)
        finally:
            connection.close()

    def versions(self, before=None):
        return self.request("/api/versions" + ("?" + urlencode({"before": before}) if before else ""))

    def history(self, before=None):
        return self.request("/api/profiles" + ("?" + urlencode({"before": before}) if before else ""))

    def start(self, spec):
        return self.request("/api/start/profile", spec)

    def job(self, job_id):
        return self.request("/api/jobs/" + job_id)

    def document(self, job_id):
        return ProfileDocument(self.request("/api/profiles/" + job_id))

    def cancel(self, job_id):
        return self.request("/api/profiles/" + job_id + "/cancel", {})

    def compare(self, before, after):
        return self.request("/api/profile-compare?" + urlencode({"before": before, "after": after}))

    def review(self, job_id, spec):
        return self.request("/api/profiles/" + job_id + "/review", spec)

    def frequency(self, job_id, column):
        return self.request("/api/profiles/" + job_id + "/frequency?" + urlencode({"column": column}))


class _Local:
    def __init__(self, workspace):
        self.workspace = workspace

    def versions(self, before=None):
        return self.workspace.database.versions(before=before, limit=25)

    def history(self, before=None):
        return self.workspace.profiles.history(before=before)

    def start(self, spec):
        return self.workspace.start("profile", spec)

    def job(self, job_id):
        return self.workspace.job(job_id)

    def document(self, job_id):
        return self.workspace.profiles.document(job_id)

    def cancel(self, job_id):
        return self.workspace.profiles.cancel(job_id)

    def compare(self, before, after):
        return self.workspace.profiles.compare(before, after)

    def review(self, job_id, spec):
        return self.workspace.profiles.save_review(job_id, spec)

    def frequency(self, job_id, column):
        return self.workspace.profiles.frequency_query(job_id, column)


@contextmanager
def _client(args):
    if args.launch:
        yield _Remote(args.launch)
        return
    if not args.workspace:
        raise StateError("DATA_PROFILE_WORKSPACE_OR_LAUNCH_REQUIRED")
    from .analysis_workspace import AnalysisWorkspace
    workspace = AnalysisWorkspace(args.workspace)
    try:
        yield _Local(workspace)
    finally:
        workspace.close()


def _emit(value, destination=None):
    raw = (_json(value) + "\n").encode()
    if destination:
        write(Path(destination), raw, exclusive=True)
        print(_json({"path": str(destination), "bytes": len(raw), "sha256": digest(raw)}))
    else:
        print(raw.decode(), end="")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    owner = parser.add_mutually_exclusive_group()
    owner.add_argument("--launch", help="Existing private analysis-launch.json; use the live original server")
    owner.add_argument("--workspace", help="Existing customer database directory; own its original process lease")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("versions", "history"):
        p = sub.add_parser(name);p.add_argument("--before", type=int)
    p = sub.add_parser("run", help="Profile all rows of an exact imported version")
    p.add_argument("--version", required=True);p.add_argument("--id", default=None)
    p.add_argument("--column", action="append");p.add_argument("--top-values", type=int, default=12)
    p.add_argument("--timeout", type=int, default=3600)
    p.add_argument("--no-wait", action="store_true", help="Only with --launch; retain the original job ID for later inspection")
    for name in ("show", "cancel"):
        p = sub.add_parser(name);p.add_argument("--id", required=True)
    p = sub.add_parser("export");p.add_argument("--id", required=True)
    p.add_argument("--format", choices=("json", "html"), default="json");p.add_argument("--out", required=True)
    p = sub.add_parser("review");p.add_argument("--id", required=True)
    p.add_argument("--request", required=True, help="JSON: id, profile_sha256, expected_revision, decision, note, column_notes")
    p = sub.add_parser("frequency");p.add_argument("--id", required=True);p.add_argument("--column", required=True)
    p = sub.add_parser("compare");p.add_argument("--before", required=True);p.add_argument("--after", required=True);p.add_argument("--out")
    p = sub.add_parser("inspect-file");p.add_argument("--file", required=True)
    p = sub.add_parser("compare-files");p.add_argument("--before", required=True);p.add_argument("--after", required=True);p.add_argument("--out")
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect-file":
            _emit(ProfileDocument.open(args.file).record);return 0
        if args.command == "compare-files":
            _emit(ProfileDocument.open(args.before).compare(ProfileDocument.open(args.after)), args.out);return 0
        if args.command == "run" and args.no_wait and not args.launch:
            raise StateError("DATA_PROFILE_NO_WAIT_REQUIRES_RUNNING_WORKSPACE")
        with _client(args) as client:
            if args.command == "versions":
                _emit(client.versions(args.before))
            elif args.command == "history":
                _emit(client.history(args.before))
            elif args.command == "show":
                _emit(client.job(args.id))
            elif args.command == "cancel":
                _emit(client.cancel(args.id))
            elif args.command == "review":
                _emit(client.review(args.id, parse(read(Path(args.request), 128 * 1024))))
            elif args.command == "frequency":
                _emit(client.frequency(args.id, args.column))
            elif args.command == "compare":
                _emit(client.compare(args.before, args.after), args.out)
            elif args.command == "export":
                _emit(client.document(args.id).write(args.out, format=args.format))
            elif args.command == "run":
                job = client.start({"id": args.id or uuid.uuid4().hex, "version_id": args.version,
                    "columns": args.column, "top_values": args.top_values, "timeout": args.timeout})
                if args.no_wait:
                    _emit(job);return 0
                try:
                    while job["status"] == "RUNNING":
                        time.sleep(.2)
                        job = client.job(job["id"])
                except KeyboardInterrupt:
                    client.cancel(job["id"])
                    _emit({"id": job["id"], "cancellation_requested": True})
                    return 130
                _emit(job)
                return 0 if job["status"] == "COMPLETE" else 1
        return 0
    except (BuyerError, OSError, http.client.HTTPException, ValueError) as exc:
        _emit({"error": getattr(exc, "code", type(exc).__name__)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
