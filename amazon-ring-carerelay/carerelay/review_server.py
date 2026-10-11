"""Local CareRelay inbox using the existing deterministic workspace reducer."""
from __future__ import annotations

import fcntl
import json
import os
import re
import tempfile
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .core import CareRelayError, canonical_json, strict_json_loads
from .workspace import load_workspace, record_review, save_workspace

_HEX = re.compile(r"[a-f0-9]{64}\Z")
_STATUSES = {"all", "pending", "approved", "rejected"}
_WEB = Path(__file__).with_name("web")


class RevisionConflict(CareRelayError):
    pass


class Inbox:
    """One writer per revision directory, immutable versions, atomic current pointer."""

    def __init__(self, original: Path, directory: Path):
        initial = load_workspace(original)
        self.base_revision = initial["receipt"]["state_sha256"]
        self.directory = directory
        self.lock = threading.RLock()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._lease = os.open(directory / "server.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(self._lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if (directory / "current.json").exists():
                with (directory / "current.json").open("rb") as stream:
                    pointer = strict_json_loads(stream.read(16_385))
                if (not isinstance(pointer, dict) or set(pointer) != {"schema", "base_revision", "revision"}
                        or pointer["schema"] != "carerelay-inbox/v1"
                        or pointer["base_revision"] != self.base_revision
                        or not isinstance(pointer["revision"], str)
                        or not _HEX.fullmatch(pointer["revision"])):
                    raise CareRelayError("review directory belongs to another workspace or has invalid saved state")
                self.workspace = load_workspace(directory / self.filename(pointer["revision"]))
                if self.revision != pointer["revision"] or self.workspace["receipt"]["source"] != initial["receipt"]["source"]:
                    raise CareRelayError("saved revision does not match its workspace")
                # Reviews cannot import or replace the original source events.
                if self.workspace["state"]["events"] != initial["state"]["events"]:
                    raise CareRelayError("saved review directory has different source events")
                retained = {row["proposal_id"]: row for row in self.workspace["state"]["approvals"]}
                if any(retained.get(row["proposal_id"]) != row for row in initial["state"]["approvals"]):
                    raise CareRelayError("saved review directory does not retain the original decisions")
            else:
                self.workspace = initial
                self._save_version(initial)
                self._point_to(self.revision)
        except BlockingIOError as exc:
            os.close(self._lease)
            raise CareRelayError("this review directory is already open in another server") from exc
        except BaseException:
            os.close(self._lease)
            raise

    @property
    def revision(self):
        return self.workspace["receipt"]["state_sha256"]

    @staticmethod
    def filename(revision):
        return f"workspace-{revision}.json"

    def close(self):
        os.close(self._lease)

    def _save_version(self, workspace):
        path = self.directory / self.filename(workspace["receipt"]["state_sha256"])
        if path.exists():
            if canonical_json(load_workspace(path)) != canonical_json(workspace):
                raise CareRelayError("existing revision contains different workspace data")
        else:
            save_workspace(path, workspace)

    def _point_to(self, revision):
        pointer = {"schema": "carerelay-inbox/v1", "base_revision": self.base_revision, "revision": revision}
        fd, name = tempfile.mkstemp(prefix=".current-", dir=self.directory)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(canonical_json(pointer) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.directory / "current.json")
        finally:
            Path(name).unlink(missing_ok=True)

    def view(self, *, status="pending", page=1, page_size=25):
        if status not in _STATUSES or not 1 <= page_size <= 100 or page < 1:
            raise CareRelayError("invalid inbox page or status")
        with self.lock:
            state = self.workspace["state"]
            events = {event["event_id"]: event for event in state["events"]}
            reviews = {review["proposal_id"]: review for review in state["approvals"]}
            counts = {"events": len(events), "proposals": len(state["proposals"]),
                      "pending": 0, "approved": 0, "rejected": 0,
                      "quiet": len(events) - len({p["event_id"] for p in state["proposals"]})}
            items = []
            for proposal in state["proposals"]:
                review = reviews.get(proposal["proposal_id"])
                current = review["decision"] if review else "pending"
                counts[current] += 1
                if status == "all" or status == current:
                    items.append({"proposal": proposal, "event": events[proposal["event_id"]], "review": review})
            items.sort(key=lambda item: (datetime.fromisoformat(item["event"]["occurred_at"]),
                                         item["proposal"]["proposal_id"]), reverse=True)
            pages = max(1, (len(items) + page_size - 1) // page_size)
            page = min(page, pages)
            return {"revision": self.revision, "source": self.workspace["receipt"]["source"],
                    "workspaceFile": self.filename(self.revision), "totals": counts,
                    "selection": {"status": status, "page": page, "pageSize": page_size,
                                  "pages": pages, "total": len(items)},
                    "items": items[(page - 1) * page_size:page * page_size]}

    def review(self, body):
        if (not isinstance(body, dict) or set(body) != {"revision", "proposalId", "reviewer", "decision"}
                or not isinstance(body["revision"], str) or not _HEX.fullmatch(body["revision"])):
            raise CareRelayError("provide revision, proposalId, reviewer and decision")
        with self.lock:
            if body["revision"] != self.revision:
                raise RevisionConflict("this workspace changed; refresh before choosing a decision")
            updated = record_review(self.workspace, proposal_id=body["proposalId"],
                                    approver=body["reviewer"], decision=body["decision"])
            revision = updated["receipt"]["state_sha256"]
            self._save_version(updated)
            self._point_to(revision)
            self.workspace = updated
            decision = next(row for row in updated["state"]["approvals"]
                            if row["proposal_id"] == body["proposalId"])
            return {"revision": revision, "source": updated["receipt"]["source"],
                    "workspaceFile": self.filename(revision), "decision": decision, "saved": True}

    def download(self):
        with self.lock:
            return self.filename(self.revision), canonical_json(self.workspace) + b"\n"


def create_server(inbox: Inbox, port: int):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(5)
            super().setup()

        def log_message(self, *_):
            pass  # No event identifiers or review attribution in request logs.

        def respond(self, status, data, content_type="application/json", **headers):
            payload = data if isinstance(data, bytes) else canonical_json(data)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
            for key, value in headers.items():
                self.send_header(key.replace("_", "-"), value)
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            try:
                url = urlsplit(self.path)
                if url.path == "/api/inbox":
                    query = parse_qs(url.query, keep_blank_values=True)
                    if set(query) - {"status", "page", "pageSize"} or any(len(value) != 1 for value in query.values()):
                        raise CareRelayError("invalid inbox query")
                    result = inbox.view(status=query.get("status", ["pending"])[0],
                                        page=int(query.get("page", ["1"])[0]),
                                        page_size=int(query.get("pageSize", ["25"])[0]))
                    return self.respond(200, result)
                if url.path == "/api/workspace" and not url.query:
                    name, payload = inbox.download()
                    return self.respond(200, payload, Content_Disposition=f'attachment; filename="{name}"')
                files = {"/": ("index.html", "text/html; charset=utf-8"),
                         "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                         "/style.css": ("style.css", "text/css; charset=utf-8")}
                if url.path in files and not url.query:
                    name, content_type = files[url.path]
                    return self.respond(200, (_WEB / name).read_bytes(), content_type)
                self.respond(404, {"error": "not found", "code": "not_found"})
            except (CareRelayError, ValueError):
                self.respond(400, {"error": "invalid inbox query", "code": "invalid_request"})
            except OSError:
                self.respond(500, {"error": "local file operation failed", "code": "storage_error"})

        def do_POST(self):
            if self.path != "/api/reviews":
                return self.respond(404, {"error": "not found", "code": "not_found"})
            if self.headers.get_content_type() != "application/json":
                return self.respond(415, {"error": "application/json required", "code": "invalid_content_type"})
            try:
                lengths = self.headers.get_all("Content-Length", [])
                if self.headers.get("Transfer-Encoding") or len(lengths) != 1:
                    raise CareRelayError("one Content-Length is required")
                length = int(lengths[0])
                if not 1 <= length <= 16_384:
                    raise CareRelayError("review body exceeds size limit")
                self.connection.settimeout(5)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise CareRelayError("incomplete review body")
                self.respond(200, inbox.review(strict_json_loads(body)))
            except RevisionConflict as exc:
                self.respond(409, {"error": str(exc), "code": "stale_revision", "revision": inbox.revision})
            except (CareRelayError, ValueError, TypeError, UnicodeError, RecursionError):
                self.respond(400, {"error": "review rejected; check the selected proposal, reviewer and decision", "code": "invalid_review"})
            except OSError:
                self.respond(500, {"error": "review could not be saved; refresh before retrying", "code": "storage_error"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    # Finish in-flight file writes before releasing the directory's writer lock.
    server.daemon_threads = False
    return server


def serve_inbox(workspace: Path, directory: Path, *, port=8792):
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise CareRelayError("port must be between 0 and 65535")
    inbox = Inbox(workspace, directory)
    try:
        server = create_server(inbox, port)
        print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}",
                          "source": inbox.workspace["receipt"]["source"],
                          "workspaceFile": inbox.filename(inbox.revision)}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    finally:
        inbox.close()
