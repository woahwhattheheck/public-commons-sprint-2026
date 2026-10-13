"""Exercise named-team HTTP boundaries against the original local operator.

Creates two empty original Workspaces and original task records. It runs no
scientific model. Keep the receiving directory outside application/workspaces.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model.common import atomic_json, canonical, digest
from model.workspace import Workspace
from server import start_server, Fault

def receive(directory):
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=False)
    project_a, project_b, state = root / "project-a", root / "project-b", root / "installation"
    server, receipt = start_server(project_a, state_directory=state, create=True, title="Team receiving A")
    app = server.operator
    second = app.register(Workspace(project_b, create=True, title="Team receiving B"))
    first = app.primary
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin, bootstrap = receipt["origin"], app.capability
    outcomes = []
    def mark(name, condition):
        if not condition:
            raise AssertionError(name)
        outcomes.append({"check": name, "result": "PASS"})
    def request(path, *, token=None, body=None, raw=None, headers=None):
        headers = dict(headers or {})
        if token:
            headers["Authorization"] = "Bearer " + token
        data = raw
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = canonical(body)
        req = urllib.request.Request(origin + path, data=data, headers=headers,
                                     method="POST" if body is not None or raw is not None else "GET")
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            parsed = json.loads(payload) if "application/json" in response.headers.get("Content-Type", "") else payload
            return response.status, parsed, response.headers
    def team_change(value):
        code, team, _ = request("/api/team", token=bootstrap)
        assert code == 200
        return request("/api/team", token=bootstrap, body={**value, "expected_revision": team["revision"]})
    try:
        code, analyst, _ = team_change({"operation": "create", "display_name": "Receiving analyst",
                                       "administrator": False, "projects": {first: "analyst"}})
        assert code == 201
        analyst_key = analyst["access_url"].split("#token=", 1)[1]
        code, viewer, _ = team_change({"operation": "create", "display_name": "Receiving viewer",
                                      "administrator": False, "projects": {second: "viewer"}})
        assert code == 201
        viewer_key = viewer["access_url"].split("#token=", 1)[1]
        code, who, _ = request("/api/whoami", token=viewer_key)
        mark("Named project catalogue and default selection", code == 200 and
             [x["id"] for x in who["workspaces"]] == [second] and who["default_workspace"] == second)
        code, _, _ = request("/api/state?workspace=" + first, token=viewer_key)
        mark("Other-project state denied", code == 403)
        code, _, _ = request("/api/actions", token=viewer_key,
                             body={"workspace": second, "action": "profile.save", "payload": {},
                                   "operation_id": "team-receiving-viewer-write"})
        mark("Viewer queued mutation denied", code == 403)
        code, upload, _ = request("/api/upload", token=analyst_key, raw=b"Original team receiving text\n",
                                  headers={"X-Workspace": first, "X-Upload-Filename": "team-receiving.txt",
                                           "Content-Type": "text/plain"})
        assert code == 201
        principal = app.team.authenticate("Bearer " + analyst_key, bootstrap)
        with app.team.scope(principal, first):
            mark("Uploaded source retained in its project", app.team.can_resource("upload", upload["id"]))
        with app.team.scope(app.team.authenticate("Bearer " + viewer_key, bootstrap), second):
            mark("Upload identity does not grant cross-project access",
                 not app.team.can_resource("upload", upload["id"]))
        operation = "team-receiving-original-request"
        payload = {"workspace": first, "action": "profile.save", "payload": {},
                   "operation_id": operation}
        code, task, _ = request("/api/actions", token=analyst_key, body=payload)
        expected_request = digest({k: payload[k] for k in ("workspace", "action", "payload")})
        mark("Actor attribution preserves original operation identity",
             code == 202 and task["requested_by"]["id"] == analyst["person"]["id"] and
             task["request_sha256"] == expected_request and
             task["id"] == digest({"workspace": first, "operation_id": operation}))
        code, reused, _ = request("/api/actions", token=analyst_key, body=payload)
        mark("Repeated operation keeps original task", code == 202 and reused["id"] == task["id"])
        code, _, _ = request("/api/task?id=" + task["id"], token=viewer_key)
        denied_task = code == 403
        code, _, _ = request("/api/task/cancel", token=viewer_key, body={"id": task["id"]})
        mark("Task status and cancellation use retained task project", denied_task and code == 403)
        code, _, _ = request("/source-refresh/api/plan", token=viewer_key,
                             body={"workspace": second})
        mark("Legacy source refresh plan enforces analyst access", code == 403)

        fixture = project_a / "team-receiving-original.txt"
        fixture.write_bytes(b"Original retained download boundary\n")
        ticket = app._ticket(first, fixture, {"bytes": fixture.stat().st_size,
                                             "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest()})
        code, _, session_headers = request("/api/session", token=analyst_key, body={})
        cookie = session_headers["Set-Cookie"].split(";", 1)[0]
        code, body, _ = request(ticket["url"], headers={"Cookie": cookie})
        own_download = code == 200 and body == fixture.read_bytes()
        code, _, _ = request(ticket["url"], token=viewer_key)
        mark("Download bearer and file session enforce ticket project", own_download and code == 403)
        code, _, _ = request("/api/actions", headers={"Cookie": cookie}, body=payload)
        mark("File session cannot authorize mutation", code == 401)
        code, rotated, _ = team_change({"operation": "rotate", "id": analyst["person"]["id"]})
        assert code == 200
        replacement = rotated["access_url"].split("#token=", 1)[1]
        code, _, _ = request("/api/whoami", token=analyst_key)
        old_key_denied = code == 401
        code, _, _ = request(ticket["url"], headers={"Cookie": cookie})
        old_session_denied = code == 401
        code, _, _ = request("/api/whoami", token=replacement)
        mark("Credential replacement invalidates old bearer and file session",
             old_key_denied and old_session_denied and code == 200)
        code, _, session_headers = request("/api/session", token=replacement, body={})
        cookie = session_headers["Set-Cookie"].split(";", 1)[0]
        code, _, _ = request("/api/logout", token=replacement, body={}, headers={"Cookie": cookie})
        code, _, _ = request(ticket["url"], headers={"Cookie": cookie})
        mark("Sign-out revokes the current file session", code == 401)
        code, _, _ = team_change({"operation": "disable", "id": analyst["person"]["id"]})
        code, _, _ = request("/api/whoami", token=replacement)
        mark("Disabled named access is rejected", code == 401)
        retained = (state / "team-access.json").read_text() + (state / "team-activity.jsonl").read_text()
        mark("Original credentials absent from registry and activity",
             all(key not in retained for key in (bootstrap, analyst_key, viewer_key, replacement)))
        deadline = time.monotonic() + 20
        while app.task(task["id"])["state"] in {"queued", "running"} and time.monotonic() < deadline:
            time.sleep(.05)
        archive = root / "project-a-portable.zip"
        app.ws(first).backup(archive)
        with zipfile.ZipFile(archive) as package:
            mark("Scientific archive excludes installation credentials and resource grants",
                 not any(Path(name).name in {"team-access.json", "team-resources.json", "team-activity.jsonl"}
                         for name in package.namelist()))
        mark("Detached supervision and original request catalogue remain installed",
             hasattr(app, "native_jobs") and hasattr(app, "task_requests"))
        result = {"schema": "upstate.team-access-receiving/v1", "checks": outcomes,
                  "scientific_runs_started": 0, "original_task_id": task["id"],
                  "project_a": first, "project_b": second,
                  "archive_bytes": archive.stat().st_size,
                  "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        atomic_json(root / "team-receiving.json", result)
        return result
    finally:
        server.shutdown()
        thread.join(timeout=10)
        server.server_close()
        app.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="A new separate directory for retained receiving output.")
    args = parser.parse_args()
    result = receive(args.directory)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
