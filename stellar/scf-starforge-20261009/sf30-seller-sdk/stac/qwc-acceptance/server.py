"""Local operator for the original QGIS/QWC publication review workspace."""
from __future__ import annotations
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import contextlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import signal
import stat
import sys
import threading
import urllib.parse
import uuid

from qwc_acceptance import (PublicationReview, AcceptanceError, SCHEMA, MAX_SOURCE, MAX_BODY, MAX_CONFIG,
    need, identifier, load_json, pack, read_file, receive, render_report, sha)

HERE = Path(__file__).parent
STATIC = {"": ("static/index.html", "text/html; charset=utf-8"),
          "app.js": ("static/app.js", "text/javascript; charset=utf-8"),
          "style.css": ("static/style.css", "text/css; charset=utf-8"),
          "review-store.js": ("static/review-store.js", "text/javascript; charset=utf-8")}


def selected_sessions(path):
    if not path:
        return {}
    original = Path(path)
    info = original.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
         "SESSION_FILE", "The original local session file must be private to this operator")
    value = load_json(read_file(original, MAX_SOURCE))
    need(isinstance(value, dict), "SESSION_FILE", "The original session selection must be an object keyed by role")
    for key, session in value.items():
        identifier(key, "role_id")
        need(isinstance(session, dict) and session.get("role_id") == key,
             "SESSION_ROLE", "Each existing session must retain its original role binding")
    return value


class Operator:
    def __init__(self, review, session_path=None):
        self.review = review
        self.session_path = session_path
        self.token = secrets.token_urlsafe(32)
        self.jobs = {}
        self.lock = threading.Lock()
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qwc-publication-review")
        self.closing = False

    def sessions(self):
        return selected_sessions(self.session_path)

    def submit(self, payload):
        with self.lock:
            need(not self.closing, "CLOSING", "The operator is finishing its existing requests")
            operation_id = identifier(payload.get("operation_id"), "operation_id")
            fingerprint = sha(pack(payload))
            old = self.jobs.get(operation_id)
            if old:
                need(old["fingerprint"] == fingerprint, "OPERATION_INPUT_CHANGED",
                     "The retained local request has different input")
                return public_job(old)
            job = {"id": operation_id, "fingerprint": fingerprint, "state": "QUEUED",
                   "action": payload.get("action"), "completed": 0, "total": 1}
            self.jobs[operation_id] = job
            self.worker.submit(self.run, payload, job)
            return public_job(job)

    def run(self, payload, job):
        job["state"] = "RUNNING"
        try:
            action = payload.get("action")
            actor = payload.get("actor")
            operation_id = payload["operation_id"]
            if action == "add_run":
                sources = {}
                for item in payload.get("sources", []):
                    need(isinstance(item, dict) and isinstance(item.get("name"), str), "SOURCE_INPUT", "Select the original source files")
                    need(item["name"] not in sources, "DUPLICATE_SOURCE", "The original source filenames must be distinct")
                    try:
                        raw = base64.b64decode(item["base64"], validate=True)
                    except (ValueError, KeyError) as exc:
                        raise AcceptanceError("SOURCE_ENCODING", "An original source file is not valid base64") from exc
                    need(len(raw) <= MAX_SOURCE and sha(raw) == item["sha256"],
                         "SOURCE_HASH", "The uploaded original source bytes differ")
                    sources[item["name"]] = raw
                result = self.review.add_run(payload["plan"], sources, operation_id=operation_id,
                    actor=actor, expected_revision=payload.get("expected_revision"))
            elif action == "import_capture":
                original = payload.get("native_response", {})
                need(isinstance(original, dict) and set(original) == {"body", "metadata"},
                     "NATIVE_RESPONSE_INPUT", "Select the complete original body and its original metadata file")
                parts = {}
                for name, limit in (("body", MAX_BODY), ("metadata", MAX_CONFIG)):
                    part = original[name]
                    need(isinstance(part, dict) and isinstance(part.get("sha256"), str),
                         "NATIVE_RESPONSE_INPUT", "The selected original file needs its byte identity")
                    try:
                        raw = base64.b64decode(part["base64"], validate=True)
                    except (ValueError, KeyError) as exc:
                        raise AcceptanceError("NATIVE_RESPONSE_ENCODING", "An original native response file has invalid base64") from exc
                    need(len(raw) <= limit and sha(raw) == part["sha256"],
                         "NATIVE_RESPONSE_HASH", "The uploaded original native response differs from its byte selection")
                    parts[name] = raw
                metadata = load_json(parts["metadata"])
                need(isinstance(metadata, dict), "NATIVE_RESPONSE_METADATA", "Retain the original observed metadata object")
                result = self.review.capture(payload["run_id"], payload["check_id"], payload["role_id"],
                    operation_id=operation_id, actor=actor, supplied=(parts["body"], metadata, parts["metadata"]))
            elif action in ("capture", "capture_run"):

                plan = self.review.plan(payload["run_id"])
                sessions = self.sessions()
                selection = [(payload["check_id"], payload["role_id"])] if action == "capture" else [
                    (check["id"], role["id"]) for check in plan["checks"] for role in plan["roles"]]
                job["total"] = len(selection)
                result = []
                for check_id, role_id in selection:
                    current_id = operation_id if action == "capture" else operation_id[:64] + "-" + sha(pack([check_id, role_id]))[:20]
                    try:
                        capture = self.review.capture(payload["run_id"], check_id, role_id,
                            operation_id=current_id, actor=actor, session=sessions.get(role_id))
                        result.append({"check_id": check_id, "role_id": role_id, "capture": capture})
                    except Exception as exc:
                        error = exc.as_dict() if isinstance(exc, AcceptanceError) else {"code": type(exc).__name__, "message": str(exc)[:1000]}
                        result.append({"check_id": check_id, "role_id": role_id, "error": error})
                    job["completed"] += 1
                result = {"captures": result, "complete": all("capture" in item for item in result)}
            elif action == "review":
                result = self.review.save_review(payload["capture_id"], payload["decision"], payload["note"],
                    operation_id=operation_id, actor=actor, expected_revision=payload["expected_revision"])
            elif action == "export":
                result = self.review.export(operation_id=operation_id, actor=actor,
                    expected_revision=payload.get("expected_revision"))
            else:
                raise AcceptanceError("UNKNOWN_ACTION", "Select an operator action")
            job.update({"state": "COMPLETE", "result": result, "completed": job["total"]})
        except Exception as exc:
            job.update({"state": "FAILED", "error": exc.as_dict() if isinstance(exc, AcceptanceError)
                       else {"code": type(exc).__name__, "message": str(exc)[:1000]}})

    def job(self, operation_id):
        identifier(operation_id, "operation_id")
        with self.lock:
            if operation_id in self.jobs:
                return public_job(self.jobs[operation_id])
        record = self.review.read()["operations"].get(operation_id)
        need(record is not None, "JOB_NOT_FOUND", "The original operation is not retained here")
        return {"id": operation_id, **record}

    def close(self):
        with self.lock:
            self.closing = True
        self.worker.shutdown(wait=True, cancel_futures=False)


def public_job(job):
    return {k: v for k, v in job.items() if k != "fingerprint"}


class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False


def handler_for(operator):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def setup(self):
            super().setup()
            self.connection.settimeout(45)

        def log_message(self, *args):
            pass

        def valid_host(self):
            host = self.headers.get("Host", "")
            return host in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

        def body(self, status, raw, content_type="application/json; charset=utf-8", filename=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
            if filename:
                safe = "".join(x if x.isalnum() or x in "._-" else "_" for x in filename)
                self.send_header("Content-Disposition", f'attachment; filename="{safe}"')
            self.end_headers()
            self.wfile.write(raw)

        def error(self, exc):
            if isinstance(exc, AcceptanceError):
                status = 404 if exc.code in ("RUN_NOT_FOUND", "JOB_NOT_FOUND", "RETAINED_ARTIFACT_UNAVAILABLE") else 409
                self.body(status, pack({"error": exc.as_dict()}))
            elif isinstance(exc, FileNotFoundError):
                self.body(404, pack({"error": {"code": "FILE_NOT_FOUND", "message": "The selected original file is unavailable"}}))
            else:
                self.body(400, pack({"error": {"code": type(exc).__name__, "message": str(exc)[:1000]}}))

        def do_GET(self):
            try:
                need(self.valid_host(), "HOST", "Use this operator's original loopback address")
                parsed = urllib.parse.urlsplit(self.path)
                path = parsed.path
                if path.lstrip("/") in STATIC:
                    source, media = STATIC[path.lstrip("/")]
                    raw = read_file(HERE / source, MAX_SOURCE)
                    if path == "/":
                        raw = raw.replace(b"__OPERATOR_TOKEN__", operator.token.encode("ascii"))
                    self.body(200, raw, media)
                elif path == "/api/state":
                    state = operator.review.overview()
                    try:
                        state["session_roles"] = sorted(operator.sessions())
                    except Exception as exc:
                        state["session_roles"] = []
                        state["session_error"] = exc.as_dict() if isinstance(exc, AcceptanceError) else {"code": type(exc).__name__, "message": "The selected local session file could not be read"}
                    with operator.lock:
                        state["jobs"] = [public_job(job) for job in operator.jobs.values()]
                    self.body(200, pack(state))
                elif path.startswith("/api/jobs/"):
                    self.body(200, pack(operator.job(path.split("/")[-1])))
                elif path == "/api/compare":
                    query = urllib.parse.parse_qs(parsed.query)
                    self.body(200, pack(operator.review.compare(query.get("left", [""])[0], query.get("right", [""])[0])))
                elif path.startswith("/api/captures/") and path.endswith("/body"):
                    capture_id = path.split("/")[3]
                    capture = operator.review.capture_record(capture_id)
                    raw = operator.review.member(capture["body"])
                    operation = capture["request"]["operation"]
                    if raw[:8] == b"\x89PNG\r\n\x1a\n":
                        media, extension = "image/png", "png"
                    elif raw.startswith(b"%PDF-"):
                        media, extension = "application/pdf", "pdf"
                    elif capture["response"].get("media_type", "").split(";")[0] in ("application/json", "application/geo+json"):
                        media, extension = "application/json", "json"
                    else:
                        media, extension = "text/plain; charset=utf-8", "txt"
                    inline = operation == "GetMap" and media == "image/png" and "download" not in urllib.parse.parse_qs(parsed.query)
                    self.body(200, raw, media, None if inline else capture_id + "." + extension)
                elif path.startswith("/api/runs/") and "/sources/" in path:
                    parts = path.split("/")
                    run_id, index = identifier(parts[3]), int(parts[5])
                    run = operator.review.read()["runs"].get(run_id)
                    need(run is not None and 0 <= index < len(run["sources"]), "FILE_NOT_FOUND", "Select an original source")
                    item = run["sources"][index]
                    self.body(200, operator.review.member(item), "application/octet-stream", Path(item["path"]).name)
                elif path.startswith("/api/exports/"):
                    operation_id = identifier(path.split("/")[-1])
                    record = operator.review.read()["operations"].get(operation_id)
                    need(record and record["kind"] == "export" and record["state"] == "COMPLETE",
                         "JOB_NOT_FOUND", "Select a completed original export")
                    item = record["result"]["archive"]
                    file = operator.review.verify(item)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/zip")
                    self.send_header("Content-Length", str(item["bytes"]))
                    self.send_header("Content-Disposition", f'attachment; filename="QWC_Publication_Review_{operation_id}.zip"')
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    with file.open("rb") as stream:
                        while part := stream.read(1024 * 1024):
                            self.wfile.write(part)
                elif path == "/api/report":
                    self.body(200, render_report(operator.review.overview()).encode("utf-8"), "text/html; charset=utf-8", "publication-review.html")
                else:
                    self.body(404, pack({"error": {"code": "NOT_FOUND", "message": "Unknown operator route"}}))
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                self.error(exc)

        def do_POST(self):
            try:
                need(self.valid_host(), "HOST", "Use this operator's original loopback address")
                need(hmac.compare_digest(self.headers.get("X-Publication-Review-Token", ""), operator.token),
                     "OPERATOR_TOKEN", "Reload this original local operator before saving")
                length = int(self.headers.get("Content-Length", "0"))
                need(0 < length <= 52 * 1024 * 1024, "REQUEST_SIZE", "The selected operator input exceeds 52 MiB")
                payload = load_json(self.rfile.read(length))
                need(isinstance(payload, dict), "REQUEST_BODY", "Use an operator action object")
                if self.path == "/api/actions":
                    result = operator.submit(payload)
                    self.body(202, pack(result))
                else:
                    self.body(404, pack({"error": {"code": "NOT_FOUND", "message": "Unknown operator route"}}))
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                self.error(exc)
    return Handler


def command(review, action, value, sessions):
    actor = value.get("actor")
    operation_id = value.get("operation_id")
    if action == "overview":
        return review.overview()
    if action == "add-run":
        sources = {name: read_file(path, MAX_SOURCE) for name, path in value["sources"].items()}
        return review.add_run(value["plan"], sources, operation_id=operation_id, actor=actor,
                              expected_revision=value.get("expected_revision"))
    if action == "capture":
        supplied = None
        if "native_response" in value:
            original = value["native_response"]
            metadata_raw = read_file(original["metadata"], MAX_CONFIG)
            supplied = (read_file(original["body"], MAX_BODY), load_json(metadata_raw), metadata_raw)
        return review.capture(value["run_id"], value["check_id"], value["role_id"],
                              operation_id=operation_id, actor=actor, session=sessions.get(value["role_id"]), supplied=supplied)
    if action == "compare":
        return review.compare(value["left_run"], value["right_run"])
    if action == "review":
        return review.save_review(value["capture_id"], value["decision"], value["note"],
                                  operation_id=operation_id, actor=actor, expected_revision=value["expected_revision"])
    if action == "export":
        return review.export(operation_id=operation_id, actor=actor, expected_revision=value.get("expected_revision"))
    raise AcceptanceError("UNKNOWN_ACTION", action)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Review and receive an original QGIS/QWC publication")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--title")
    parser.add_argument("--port", type=int, default=8784)
    parser.add_argument("--sessions", help="Existing private role-session JSON; never included in a handover")
    parser.add_argument("--command", choices=("overview", "add-run", "capture", "compare", "review", "export"))
    parser.add_argument("--input")
    parser.add_argument("--receive", help="Complete original review ZIP to receive into a new directory")
    parser.add_argument("--expected-sha256")
    args = parser.parse_args(argv)
    if args.receive:
        result = receive(args.receive, args.workspace, expected_sha256=args.expected_sha256)
        print(pack(result).decode("utf-8"), end="")
        return
    if not Path(args.workspace).exists():
        need(args.title, "WORKSPACE_TITLE", "Create a new workspace with --title")
        review = PublicationReview.create(args.workspace, args.title)
    else:
        review = PublicationReview(args.workspace)
    if args.command:
        value = load_json(read_file(args.input, MAX_SOURCE)) if args.input else {}
        result = command(review, args.command, value, selected_sessions(args.sessions))
        print(pack(result).decode("utf-8"), end="")
        return
    need(0 <= args.port <= 65535, "PORT", "Use a local TCP port")
    operator = Operator(review, args.sessions)
    server = Server(("127.0.0.1", args.port), handler_for(operator))
    print(pack({"origin": f"http://127.0.0.1:{server.server_port}", "workspace_id": review.workspace_id,
                "workspace": str(review.root), "pid": os.getpid()}).decode("utf-8"), end="", flush=True)
    def stop(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        operator.close()
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        error = exc.as_dict() if isinstance(exc, AcceptanceError) else {"code": type(exc).__name__, "message": str(exc)[:1000]}
        print(pack({"error": error}).decode("utf-8"), end="", file=sys.stderr)
        raise SystemExit(1)
