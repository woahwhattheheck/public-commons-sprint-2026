"""MIT. Private publisher console over the saved operator and original review editor."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import threading
from urllib.parse import parse_qs

from publisher_workspace import PublisherWorkspace, InputError, PROFILE, HERE, MAX_UPLOAD, publisher, load_json
from server import OperatorServer as NativeServer, Handler as NativeHandler


class OperatorServer(NativeServer):
    def __init__(self, workspace: PublisherWorkspace, port=0):
        self.jobs_lock = threading.RLock()
        self.accepting = True
        self.active = {}
        self.launch_record = None
        self.jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="publisher")
        super().__init__(workspace, port, assets_directory=HERE / "public", handler_class=Handler)

    def submit(self, request_id, action=None, body=None):
        with self.jobs_lock:
            if not self.accepting:
                raise InputError("The console is closing; reopen the original workspace")
            record = (self.workspace.admit(request_id, action, body) if action
                      else self.workspace.request(request_id))
            if record["status"] != "complete" and request_id not in self.active:
                future = self.jobs.submit(self.workspace.execute, request_id)
                self.active[request_id] = future
                future.add_done_callback(lambda completed: self._finished(request_id, completed))
            return record

    def _finished(self, request_id, future):
        with self.jobs_lock:
            self.active.pop(request_id, None)
        # Full typed errors are already retained in the original request.
        future.exception()

    def server_close(self):
        with self.jobs_lock:
            self.accepting = False
        try:
            super().server_close()
        finally:
            self.jobs.shutdown(wait=True, cancel_futures=False)


class Handler(NativeHandler):
    server_version = "SF30-360Giving"

    def _json(self, value, status=200):
        # The original report may contain ExactNumber objects. Preserve its JSON tokens.
        data = (publisher.exact(value) + "\n").encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _run(self, callback):
        def checked():
            try:
                callback()
            except publisher.PublisherError as error:
                raise InputError(str(error)) from error
        super()._run(checked)

    def _query(self, target):
        raw = parse_qs(target.query, keep_blank_values=True)
        if any(len(values) != 1 for values in raw.values()):
            raise InputError("Repeated query parameters are not accepted")
        return {key: values[0] for key, values in raw.items()}

    def _asset(self, path, media):
        body = path.read_bytes()
        self._headers(200, media, len(body))
        self.wfile.write(body)

    def _get(self):
        target = self._gate(api=False)
        assets = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/review-bridge.js": ("review-bridge.js", "text/javascript; charset=utf-8")}
        if target.path in assets:
            name, media = assets[target.path]
            self._asset(self.server.assets_directory / name, media)
            return
        if target.path in {"/review.js", "/review.css"}:
            self._asset(PROFILE / target.path[1:],
                        "text/javascript; charset=utf-8" if target.path.endswith(".js")
                        else "text/css; charset=utf-8")
            return
        if target.path == "/review.html":
            # Serve the installed editor. Received HTML remains retained source.
            html = (PROFILE / "review.html").read_text("utf-8")
            html = html.replace("<style>__PUBLISHER_CSS__</style>",
                                '<link rel="stylesheet" href="/review.css">')
            html = html.replace("__PUBLISHER_DATA__", "{}")
            html = html.replace("<script>__PUBLISHER_JS__</script>",
                                '<script src="/review-bridge.js"></script>')
            body = html.encode("utf-8")
            self._headers(200, "text/html; charset=utf-8", len(body))
            self.wfile.write(body)
            return
        self._gate()
        q, ws = self._query(target), self.server.workspace
        if target.path == "/api/launch":
            if self.server.launch_record is None:
                raise InputError("Open this workspace through its original console command")
            self._json(self.server.launch_record)
        elif target.path == "/api/state":
            self._json(ws.state())
        elif target.path == "/api/request":
            self._json(ws.request(q["id"]))
        elif target.path == "/api/review":
            self._json(ws.review(q["edition"], q.get("decision")))
        elif target.path == "/api/native-state":
            self._json(ws.native_state(q["dataset"]))
        elif target.path == "/api/changes":
            self._json(ws.changes(q["dataset"], q["comparison"],
                                 int(q.get("offset", "0")), int(q.get("limit", "50"))))
        elif target.path == "/api/changes-file":
            with ws.mutex:
                self._download(ws._dataset(q["dataset"]).comparison_file(q["comparison"]),
                               "360giving-complete-changes.jsonl", "application/x-ndjson")
        elif target.path == "/api/download":
            self._download(ws.delivery(q["request"]), "360giving-complete-handoff.zip", "application/zip")
        else:
            self._json({"error": "Unknown publisher route"}, 404)

    def _post(self):
        target, ws = self._gate(), self.server.workspace
        if target.path == "/api/upload":
            self._json(ws.upload(self._body(MAX_UPLOAD)), 201)
            return
        body = load_json(self._body().read())
        if not isinstance(body, dict):
            raise InputError("Supply a complete request object")
        if target.path == "/api/requests":
            self._json(self.server.submit(body["id"], body["action"], body["input"]), 202)
        elif target.path == "/api/resume":
            self._json(self.server.submit(body["id"]), 202)
        elif target.path == "/api/query":
            self._json(ws.query(body["dataset"], body["build"], body.get("query", {})))
        else:
            self._json({"error": "Unknown publisher route"}, 404)
