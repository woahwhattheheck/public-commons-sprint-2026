#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run one retained parcel source, review, native map and independent receiving operation.

The same output directory retains every submitted original analyst request. Reopen
it after a transport or worker interruption; do not create another operation.
Native maps use the selected existing QGIS runtime. Browser work uses the existing
Node, Playwright and Chromium paths supplied in the browser configuration.
"""
from __future__ import annotations
import argparse
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, ProxyHandler
import zipfile

SOURCE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE_ROOT))
sys.path.insert(0, str(SOURCE_ROOT.parent))
from starforge_stac.model import QgisWorkspace, file_digest, json_bytes, value_sha
from starforge_stac.parcels.intake import ParcelIntake, MANIFEST
from starforge_stac.parcels.workspace import ParcelWorkspace
from starforge_stac.parcels.portfolio import get as get_portfolio
from starforge_stac.parcels.review import decision_input

SCHEMA = "starforge.parcel-native-receiving.v1"
AUTH = "X-Starforge-Qgis-Workspace"


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def public_file(path):
    path = Path(path)
    return {"path": str(path), **file_digest(path)}


def write(path, body, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if immutable and path.exists():
        ensure(path.is_file() and not path.is_symlink() and path.read_bytes() == body,
               "The retained original file changed: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        if immutable:
            try:
                os.link(name, path)
            except FileExistsError:
                ensure(path.read_bytes() == body, "The original retained file differs: " + str(path))
        else:
            os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def write_json(path, value, *, immutable=False):
    write(path, json_bytes(value), immutable=immutable)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class Listener:
    """Own exactly one child of the original analyst server."""
    def __init__(self, operation, label, workspace, source_root, runtime_file):
        self.operation, self.label = operation, label
        self.workspace, self.source_root = Path(workspace), Path(source_root)
        self.runtime_file = Path(runtime_file).absolute() if runtime_file else None
        self.connection_file = operation.root / "private" / (label + "-connection.json")
        self.child = None
        self.log = None
        self.connection = None
        self.opener = build_opener(ProxyHandler({}))

    def __enter__(self):
        self.connection_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        command = [sys.executable, "-B", str(self.source_root / "analyst" / "server.py"),
                   "--workspace", str(self.workspace), "--connection-file", str(self.connection_file)]
        if self.runtime_file:
            command += ["--native-runtime-file", str(self.runtime_file)]
        log_path = self.operation.root / "private" / (self.label + "-listener.log")
        self.log = open(log_path, "ab", buffering=0)
        os.chmod(log_path, 0o600)
        env = dict(os.environ)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        self.child = subprocess.Popen(command, cwd=self.source_root, stdin=subprocess.DEVNULL,
                                      stdout=self.log, stderr=self.log, env=env, start_new_session=True)
        deadline = time.monotonic() + 120
        try:
            while time.monotonic() < deadline:
                ensure(self.child.poll() is None,
                       "The original analyst listener ended during startup; inspect its private retained log.")
                if self.connection_file.is_file():
                    try:
                        candidate = read_json(self.connection_file)
                        if candidate.get("pid") == self.child.pid:
                            self.connection = candidate
                            self.origin, self.token = candidate["operatorUrl"].split("/#", 1)
                            self.token = self.token.strip()
                            ensure(len(self.token) == 64, "The original private listener key is malformed.")
                            launch = self.get("/api/launch")
                            ensure(launch["workspaceId"] == QgisWorkspace(self.workspace).read()["id"] and
                                   launch["instanceId"] == candidate["instanceId"],
                                   "The listener belongs to another original project.")
                            self.operation.record("listener-" + self.label, {
                                "workspaceId": launch["workspaceId"], "instanceId": launch["instanceId"],
                                "sourceSha256": launch["sourceSha256"],
                                "nativeRuntimeSelected": launch["nativeRuntimeSelected"], "at": now()})
                            return self
                    except (OSError, ValueError, KeyError, URLError):
                        pass
                time.sleep(.2)
            raise TimeoutError("The original analyst listener did not publish its connection in 120 seconds.")
        except Exception:
            self.close()
            raise

    def close(self):
        if self.child is not None and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=10)
        if self.log is not None:
            self.log.close()
        self.child = None
        self.log = None

    def __exit__(self, *args):
        self.close()

    def raw(self, method, path, body=None, *, headers=None, auth=True):
        ensure(path.startswith("/") and not path.startswith("//"), "Use the original local listener route.")
        extra = {AUTH: self.token, "Origin": self.origin} if auth else {}
        extra.update(headers or {})
        if body is not None and not isinstance(body, bytes):
            body = json_bytes(body)
            extra["Content-Type"] = "application/json"
        request = Request(self.origin + path, data=body, headers=extra, method=method)
        with self.opener.open(request, timeout=45) as response:
            return response.status, dict(response.headers.items()), response.read()

    def get(self, path):
        return json.loads(self.raw("GET", path)[2])

    def post(self, path, body):
        return json.loads(self.raw("POST", path, body)[2])

    def download(self, path, destination, expected):
        status, headers, body = self.raw("GET", path)
        measured = {"bytes": len(body), "sha256": digest(body)}
        ensure(status == 200 and all(measured[key] == expected[key] for key in ("bytes", "sha256")),
               "The complete downloaded original file differs: " + path)
        lowered = {key.lower(): value for key, value in headers.items()}
        ensure(lowered.get("x-content-sha256") == expected["sha256"] and
               "filename=" in lowered.get("content-disposition", ""),
               "The original download identity headers are incomplete.")
        write(destination, body, immutable=True)
        return {"route": path, **public_file(destination)}

    def upload(self, label, directory, files, kind="source"):
        identity = self.operation.identity(self.label + "-upload-" + label)
        manifest = {"uploadId": identity, "kind": kind, "files": files}
        self.operation.original("upload-" + self.label + "-" + label, manifest)
        status = self.post("/api/uploads", manifest)
        expected = {row["path"]: row for row in files}
        for row in status["files"]:
            path = Path(directory) / row["path"]
            file_digest(path, expected=expected[row["path"]])
            with path.open("rb") as source:
                source.seek(row["offset"])
                offset = row["offset"]
                while offset < row["bytes"]:
                    body = source.read(min(1024 * 1024, row["bytes"] - offset))
                    ensure(body, "An original upload source ended early.")
                    route = "/api/uploads/" + identity + "/file?" + urlencode({"path": row["path"], "offset": offset})
                    self.raw("PUT", route, body, headers={"Content-Type": "application/octet-stream",
                             "X-Content-SHA256": digest(body)})
                    offset += len(body)
        completed = self.post("/api/uploads/" + identity + "/complete", {})
        self.operation.record("upload-" + self.label + "-" + label, completed)
        return completed

    def call(self, name, action, payload):
        identity = self.operation.identity(self.label + "-" + name)
        path = self.operation.root / "requests" / (self.label + "-" + name + ".json")
        if path.exists():
            original = read_json(path)
            ensure(original["requestId"] == identity and original["action"] == action,
                   "The retained request belongs to another original action.")
        else:
            original = {"requestId": identity, "action": action,
                        "payload": payload() if callable(payload) else payload,
                        "revision": self.get("/api/state")["state"]["revision"], "actor": self.operation.actor}
            write_json(path, original, immutable=True)
        route = "/api/operations/" + identity
        try:
            row = self.get(route)
        except HTTPError as error:
            if error.code != 404:
                raise
            row = self.post("/api/operations", original)
        else:
            if row["status"] != "COMPLETED" and not row["workerActive"]:
                ensure(row["canResume"], "Continue this retained request in its original runtime and input location.")
                row = self.post(route + "/continue", {"inputSha256": row["inputSha256"]})
        deadline = time.monotonic() + self.operation.timeout
        last = None
        while row["status"] != "COMPLETED":
            state = (row["status"], row.get("displayStatus"), (row.get("progress") or {}).get("phase"))
            if state != last:
                self.operation.progress(name, status=row["status"], requestPhase=state[-1])
                last = state
            if row["status"] == "FAILED":
                self.operation.record("failed-" + self.label + "-" + name, row)
                raise RuntimeError("The original action " + name + " failed: " + json.dumps(row.get("error")))
            ensure(time.monotonic() < deadline, "The original request remains retained after its wait interval: " + identity)
            if not row["workerActive"] and row.get("canResume"):
                row = self.post(route + "/continue", {"inputSha256": row["inputSha256"]})
                time.sleep(.5)
            else:
                time.sleep(.5)
                row = self.get(route)
        ensure(row["input"]["action"] == original["action"] and row["input"]["payload"] == original["payload"] and
               row["input"]["actor"] == original["actor"], "The returned original request differs from its saved input.")
        self.operation.record(self.label + "-" + name, row)
        self.operation.progress(name, status="COMPLETED", requestId=identity)
        return row

    def parcel(self, name, action, payload):
        if callable(payload):
            return self.call(name, "parcel.command", lambda: {"action": action, "payload": payload()})
        return self.call(name, "parcel.command", {"action": action, "payload": payload})


class Operation:
    def __init__(self, args):
        self.root = Path(args.output).expanduser().absolute()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.actor = args.actor
        self.timeout = args.operation_timeout
        self.config = {"schema": SCHEMA, "operationId": args.operation_id,
                       "sourceManifestSha256": args.expected_manifest_sha256,
                       "actor": args.actor, "workspaceDirectory": str(self.root / "workspace")}
        self.original("operation", self.config)
        self.fd = None
        self.runtime_file = args.native_runtime_file
        self.browser_file = args.browser_config
        self.current_phase = "starting"

    def __enter__(self):
        import fcntl
        self.fd = os.open(self.root / "operation.lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return self

    def __exit__(self, *args):
        if self.fd is not None:
            import fcntl
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)

    def identity(self, name):
        return "parcel-" + digest((self.config["operationId"] + "\0" + name).encode())[:48]

    def original(self, name, value):
        write_json(self.root / "inputs" / (name + ".json"), value, immutable=True)
        return value

    def record(self, name, value):
        write_json(self.root / "results" / (name + ".json"), value)
        return value

    def progress(self, phase, **details):
        self.current_phase = phase
        print(json.dumps({"phase": phase, **details}, separators=(",", ":")), flush=True)

    def browser(self, label, listener, context):
        ensure(self.browser_file, "Select the existing Node, Playwright and Chromium in --browser-config.")
        config = read_json(self.browser_file)
        ensure(isinstance(config, dict) and set(config) == {"node", "playwrightModule", "chromium"} and
               all(Path(value).expanduser().is_file() for value in config.values()),
               "Use the existing installed browser executable and Playwright module files.")
        browser_root = self.root / "browser" / label
        selected = {**config, "connectionFile": str(listener.connection_file),
                    "output": str(browser_root), "actor": self.actor, **context}
        private = self.root / "private" / (label + "-browser.json")
        write_json(private, selected)
        log = self.root / "private" / (label + "-browser.log")
        with log.open("ab") as stream:
            os.chmod(log, 0o600)
            code = subprocess.call([config["node"], str(SOURCE_ROOT / "parcel-native-browser.mjs"), str(private)],
                                   stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT)
        ensure(code == 0, "The original browser continuation needs its retained log: " + str(log))
        result = read_json(browser_root / "result.json")
        ensure(result["status"] == "COMPLETED" and result["workspaceId"] == listener.get("/api/state")["state"]["id"],
               "The original browser result belongs to another workspace.")
        return self.record("browser-" + label, result)


def complete_files(directory):
    body = (directory / MANIFEST).read_bytes()
    manifest = json.loads(body)
    rows = [{"path": MANIFEST, "bytes": len(body), "sha256": digest(body)}]
    rows += [{"path": row["path"], "bytes": row["bytes"], "sha256": row["sha256"]} for row in manifest["files"]]
    for row in rows:
        file_digest(directory / row["path"], expected=row)
    return manifest, rows


def subset_source(operation, directory, manifest, keys):
    target = operation.root / "inputs" / "original-scope"
    selected_manifest = target / MANIFEST
    if not selected_manifest.exists():
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        for row in manifest["files"]:
            write(target / row["path"], (directory / row["path"]).read_bytes(), immutable=True)
        selected = copy.deepcopy(manifest)
        selected["label"] = manifest["label"] + " — initial reviewed subset"
        selected["createdAt"] = now()
        selected.pop("capturedAt", None)
        selected["selection"] = {"mode": "explicit", "keys": keys, "expectedDistinctKeys": len(keys),
            "invalidRecords": 0, "keysSha256": digest(json.dumps(keys, separators=(",", ":")).encode("ascii")),
            "parentSelection": copy.deepcopy(manifest["selection"])}
        selected["notes"] = [*([manifest["notes"]] if isinstance(manifest.get("notes"), str) else manifest.get("notes", [])),
            "This initial scope selects original keys from the parent edition. All provider response bytes and capture metadata are unchanged.",
            "Parent receiving manifest SHA-256: " + operation.config["sourceManifestSha256"]]
        write_json(selected_manifest, selected, immutable=True)
    actual, files = complete_files(target)
    ensure(actual["selection"]["keys"] == keys and all(
        next(row for row in actual["files"] if row["path"] == item["path"]) == item for item in manifest["files"]),
        "The original subset must retain the unchanged complete provider responses.")
    return target, digest(selected_manifest.read_bytes()), files


def decision_rules(reason):
    return {"uniqueAssertions": True, "sourcePreferences": {"status": "city-eproperties", "ward": "city-eproperties"},
            "accountableEntityId": None, "uniqueAssessment": True, "areaBasis": "county-reported-square-feet",
            "uniqueGeometry": True, "replaceReviewed": False, "reason": reason}


def save_batch(listener, label, edition, keys):
    prepared = listener.parcel(label + "-prepare", "review.prepare", {
        "editionId": edition, "keys": keys,
        "rules": decision_rules("Review the sole eligible original records; preserve ambiguous ownership and unassigned operational responsibility.")})["result"]
    if not prepared["decisions"]:
        return prepared
    preview = listener.parcel(label + "-preview", "review.preview",
                             {"editionId": edition, "decisions": prepared["decisions"]})["result"]
    return listener.parcel(label + "-save", "review.save", {
        "editionId": edition, "decisions": prepared["decisions"], "previewSha256": preview["previewSha256"]})["result"]


def portfolio_definition(edition, keys, title, basis="county-assessed"):
    return {"editionId": edition, "title": title, "selection": {"keys": keys},
            "assessmentBasis": basis, "areaBasis": "county-reported-square-feet",
            "groupBy": ["owner", "accountable", "ward"], "requireCompleteReview": True,
            "note": "Retained public-source assessment and reported area. Original tax year and as-of groups remain separate."}


def save_portfolio(listener, label, definition):
    preview = listener.parcel(label + "-preview", "portfolio.preview", {"definition": definition})["result"]
    created = listener.parcel(label + "-save", "portfolio.create", {
        "definition": definition, "previewSha256": preview["previewSha256"]})["result"]["portfolio"]
    for record in created["files"]:
        name = Path(record["path"]).name
        listener.download("/download/parcels/portfolios/" + created["id"] + "/" + name,
                          listener.operation.root / "downloads" / label / name, record)
    return created


def all_rows(listener, edition):
    result, offset = [], 0
    while True:
        page = listener.get("/api/parcels/rows?" + urlencode({"editionId": edition, "offset": offset, "limit": 100}))
        result.extend(page["items"])
        if page["complete"]:
            ensure(len(result) == page["total"], "The original parcel page set is incomplete.")
            return result
        offset += len(page["items"])


def original_source_receipt(workspace, edition):
    parcel = ParcelWorkspace(workspace)
    value = parcel.edition(edition)
    return {"editionId": edition, "summary": value["summary"],
            "manifest": value["manifest"],
            "originalFiles": [{"sourceId": row["sourceId"], "family": row["family"], "path": row["path"],
                "bytes": row["bytes"], "sha256": row["sha256"], "object": row["object"]} for row in value["inputs"]]}



def receive_reviewed_domain(operation, primary, workspace, exported, archive, context):
    """Reopen the actual complete source/review/portfolio project before native map work."""
    with zipfile.ZipFile(archive) as source:
        archived = json.loads(source.read("workspace-snapshot.json"))
    captured_file = operation.root / "inputs" / "domain-receiving-snapshot.json"
    if captured_file.exists():
        ensure(read_json(captured_file) == archived,
               "Continue from the original complete domain export.")
    else:
        current = workspace.snapshot()
        for key in ("schema", "state", "events", "requests"):
            ensure(archived.get(key) == current.get(key),
                   "The original domain export changed its saved source, decisions or history.")
        operation.original("domain-receiving-snapshot", archived)
    destination = operation.root / "received-domain"
    received = primary.call("receive-independent-domain", "project.receive", {
        "file": str(archive), "destination": str(destination),
        "expectedSha256": exported["result"]["sha256"]})["result"]
    original_request = read_json(operation.root / "requests" / "primary-receive-independent-domain.json")
    replay = primary.post("/api/operations", original_request)
    ensure(replay["status"] == "COMPLETED" and replay["result"] == received,
           "The same domain receiving request returned another receipt.")
    recipient = QgisWorkspace(destination)
    snapshot = recipient.snapshot()
    for key in ("schema", "state", "events", "requests", "analystRequests"):
        ensure(snapshot.get(key) == archived.get(key),
               "Independent domain receiving changed original state or request history.")
    for record in recipient.project_files(snapshot):
        file_digest(destination / record["path"], expected=record)
    with Listener(operation, "received-domain", destination, destination / "software", None) as listener:
        browser = operation.browser("received-domain", listener, {
            **context, "mode": "domain-receiving"})
    after = recipient.snapshot()
    for key in ("schema", "state", "events", "requests", "analystRequests"):
        ensure(after.get(key) == archived.get(key),
               "The recipient's read-only walkthrough changed the original parcel project.")
    result = {"schema": "starforge.parcel-domain-receiving.v1", "status": "COMPLETED",
        "completedAt": now(), "operationId": operation.config["operationId"],
        "workspaceId": snapshot["state"]["id"], "revision": snapshot["state"]["revision"],
        "originalRequestCount": len(archived.get("analystRequests", [])),
        "receipt": received["receipt"], "archive": public_file(archive),
        "receivedWorkspace": str(destination), "browser": browser}
    operation.record("domain-receiving", result)
    operation.progress("domain-receiving-complete", workspaceId=result["workspaceId"],
                       revision=result["revision"], originalRequests=result["originalRequestCount"])
    return result


def run(args):
    source_directory = Path(args.source_directory).expanduser().absolute()
    intake = ParcelIntake(source_directory, args.expected_manifest_sha256)
    prepared = intake.prepare()
    keys = [row["key"] for row in prepared["rows"]]
    ensure(len(keys) >= 2 and keys == sorted(keys), "Select at least two actual original parcel keys.")
    manifest, source_files = complete_files(source_directory)
    with Operation(args) as operation:
        try:
            workspace = QgisWorkspace(operation.root / "workspace", create=True, title=args.title)
            operation.original("workspace", {"workspaceId": workspace.read()["id"]})
            operation.record("original-source", {"manifestSha256": intake.id, "summary": prepared["summary"],
                                               "files": source_files})
            subset_keys = keys[:max(1, len(keys) // 2)]
            subset, subset_sha, subset_files = subset_source(operation, source_directory, manifest, subset_keys)
            with Listener(operation, "primary", workspace.root, SOURCE_ROOT, args.native_runtime_file) as listener:
                try:
                    listener.raw("GET", "/api/state", auth=False)
                    raise RuntimeError("The original workspace unexpectedly accepted an unauthenticated state read.")
                except HTTPError as error:
                    ensure(error.code == 403, "The original private workspace auth returned another outcome.")
                uploaded = listener.upload("initial-original-scope", subset, subset_files)
                directory = uploaded["directory"]
                preview = listener.parcel("initial-source-preview", "source.preview",
                    {"directory": directory, "expectedManifestSha256": subset_sha})["result"]
                initial = listener.parcel("initial-source-import", "source.import", {
                    "directory": directory, "expectedManifestSha256": subset_sha,
                    "previewSha256": preview["previewSha256"]})["result"]["editionId"]
                save_batch(listener, "initial-review", initial, subset_keys)
                early = save_portfolio(listener, "initial-portfolio",
                    portfolio_definition(initial, subset_keys, "Initial original parcel scope"))
                initial_portfolio = get_portfolio(ParcelWorkspace(workspace), early["id"])[1]
                original_early_sha = value_sha(initial_portfolio)

                uploaded = listener.upload("complete-original-edition", source_directory, source_files)
                preview = listener.parcel("full-source-preview", "source.preview", {
                    "directory": uploaded["directory"], "expectedManifestSha256": intake.id})["result"]
                full = listener.parcel("full-source-import", "source.import", {
                    "directory": uploaded["directory"], "expectedManifestSha256": intake.id,
                    "previewSha256": preview["previewSha256"]})["result"]["editionId"]
                comparison = listener.parcel("cohort-comparison", "successor.compare",
                    {"leftEditionId": initial, "rightEditionId": full})["result"]
                ensure(comparison["unchanged"] == subset_keys and comparison["added"] == keys[len(subset_keys):] and
                       not comparison["changed"] and not comparison["removed"],
                       "The unchanged provider response subset did not retain its exact original facts.")
                successor = listener.parcel("cohort-review", "successor.review", {"definition": {
                    "leftEditionId": initial, "rightEditionId": full,
                    "comparisonSha256": comparison["comparisonSha256"],
                    "unchanged": "carry-reviewed", "changed": "leave-unreviewed", "removed": "retain-history",
                    "note": "Expand to the complete original key cohort, carrying only unchanged reviewed source facts."}})["result"]
                ensure(successor["carriedReviews"] == len(subset_keys),
                       "The original unchanged decisions were not carried exactly once.")
                save_batch(listener, "additional-review", full, keys[len(subset_keys):])
                county = save_portfolio(listener, "county-before-correction",
                    portfolio_definition(full, keys, "Original complete County assessed portfolio"))
                municipal = save_portfolio(listener, "municipal-portfolio",
                    portfolio_definition(full, keys, "Original municipal and school assessed portfolio", "local-assessed"))
                base_year = save_portfolio(listener, "base-year-portfolio",
                    portfolio_definition(full, keys, "Original 2012 base-year appraisal portfolio", "base-year-2012-appraisal"))
                rows = all_rows(listener, full)
                ensure(len(rows) == len(keys) and all(row["decision"] for row in rows),
                       "Every original parcel must retain a reviewed decision.")
                review_key = args.review_key
                candidates = []
                for row in rows:
                    detail = listener.get("/api/parcels/detail?" + urlencode({"editionId": full, "key": row["key"]}))
                    city = [claim for claim in detail["parcel"]["claims"] if claim["kind"] == "owner-assertion" and
                            claim["field"] == "owner"]
                    if city:
                        candidates.append((row["key"], city[0]["id"]))
                ensure(candidates, "The actual source edition has no original City owner assertion to review.")
                selected = next((row for row in candidates if row[0] == review_key), candidates[0])
                review_context = operation.original("browser-review", {"editionId": full, "key": selected[0],
                    "ownerClaimId": selected[1], "reason":
                    "Select the original City eProperties owner assertion; retain the publisher's tax-agent observation separately."})
                before_browser_file = operation.root / "results" / "before-browser-history.json"
                if not before_browser_file.exists():
                    operation.record("before-browser-history", workspace.snapshot())
                browser = operation.browser("primary", listener, {
                    "mode": "review", "editionId": full, "keys": keys, "review": review_context,
                    "sourceManifestSha256": intake.id, "portfolioId": county["id"]})
                corrected = ParcelWorkspace(workspace).detail(full, selected[0])["decision"]
                ensure(corrected["owner"]["claim"]["id"] == selected[1] and
                       corrected["accountable"]["mode"] == "unassigned" and corrected["reason"] == review_context["reason"],
                       "The actual browser decision did not retain the selected owner assertion and responsibility choice.")
                ensure(value_sha(get_portfolio(ParcelWorkspace(workspace), early["id"])[1]) == original_early_sha,
                       "A later source review changed the original frozen portfolio.")
                reviewed = save_portfolio(listener, "reviewed-county-portfolio",
                    portfolio_definition(full, keys, "Reviewed complete County assessed portfolio"))
                mapped = listener.parcel("reviewed-map-source", "map.publish", {"portfolioId": reviewed["id"]})["result"]
                listener.call("save-parcel-layer", "layers.save", {"layers": [mapped["layer"]]})
                operation.record("domain-result", {"status": "PARCEL_DOMAIN_COMPLETED", "at": now(),
                    "workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"],
                    "originalSource": original_source_receipt(workspace, full),
                    "initialEditionId": initial, "successor": successor,
                    "portfolioIds": [early["id"], county["id"], municipal["id"], base_year["id"], reviewed["id"]],
                    "reviewedMap": mapped, "browser": browser})
                core_export = listener.call("core-complete-export", "project.export", {
                    "directory": str(operation.root / "archives" / "core")})
                listener.download("/download/operations/" + core_export["requestId"] + "/project",
                                  operation.root / "downloads" / "parcel-reviewed-project.zip", core_export["result"])
                domain_receiving = receive_reviewed_domain(operation, listener, workspace, core_export,
                    operation.root / "downloads" / "parcel-reviewed-project.zip", {
                        "editionId": full, "keys": keys, "review": review_context,
                        "sourceManifestSha256": intake.id, "portfolioId": reviewed["id"]})
                if not args.native_runtime_file:
                    result = {"schema": SCHEMA, "status": "PARCEL_RECEIVING_COMPLETED",
                        "completedAt": now(), "operationId": args.operation_id,
                        "sourceManifestSha256": intake.id, "workspaceId": workspace.read()["id"],
                        "revision": workspace.read()["revision"], "sourceSummary": prepared["summary"],
                        "successor": successor, "browser": browser, "domainReceiving": domain_receiving,
                        "files": [public_file(path) for path in sorted((operation.root / "downloads").rglob("*")) if path.is_file()],
                        "sourceRoot": str(SOURCE_ROOT), "originalWorkspace": str(workspace.root),
                        "receivedWorkspace": domain_receiving["receivedWorkspace"],
                        "nativeContinuation": {"phase": "original-qgis-map",
                            "portfolioId": reviewed["id"], "reviewedSourceId": mapped["source"]["id"],
                            "layerId": mapped["layer"]["id"], "inputArchive": domain_receiving["archive"]}}
                    operation.record("domain-completed", result)
                    write_json(operation.root / "result.json", result)
                    return result
                asset = workspace.source(mapped["source"]["id"]).asset_rows()[0]
                inspection = listener.call("inspect-native-parcels", "map.inspect", {
                    "sourceId": mapped["source"]["id"], "collection": asset["collection"],
                    "itemId": asset["itemId"], "assetKey": asset["assetKey"]})["result"]
                saved = listener.call("save-native-map", "map.save", {"projectCrs": "EPSG:4326"})["result"]["project"]
                rendered = listener.call("render-native-map", "map.render", {
                    "projectId": saved["id"], "width": 1400, "height": 900})
                image = rendered["result"]["file"]
                listener.download("/download/operations/" + rendered["requestId"] + "/files/0",
                                  operation.root / "downloads" / "original-native-map.png", image)
                features = listener.call("read-native-features", "map.features", {
                    "projectId": saved["id"], "layerId": mapped["layer"]["id"], "offset": 0, "limit": 100})["result"]
                ensure(int(features["nativeFeatureCount"]) == mapped["source"]["summary"]["features"],
                       "The actual QGIS feature count differs from the reviewed map source.")
                native_snapshot = workspace.snapshot()
                operation.record("native-snapshot", native_snapshot)
                exported = listener.call("final-complete-export", "project.export", {
                    "directory": str(operation.root / "archives" / "final")})
                archive = operation.root / "downloads" / "parcel-native-complete-project.zip"
                listener.download("/download/operations/" + exported["requestId"] + "/project", archive, exported["result"])
                with zipfile.ZipFile(archive) as source:
                    archived_snapshot = json.loads(source.read("workspace-snapshot.json"))
                ensure(archived_snapshot["state"] == native_snapshot["state"] and
                       archived_snapshot["events"] == native_snapshot["events"] and
                       archived_snapshot["requests"] == native_snapshot["requests"],
                       "The complete export changed the original domain history.")
                receive_dir = operation.root / "received"
                received = listener.call("receive-independent-project", "project.receive", {
                    "file": str(archive), "destination": str(receive_dir),
                    "expectedSha256": exported["result"]["sha256"]})["result"]
                replay = listener.post("/api/operations", read_json(operation.root / "requests" / "primary-receive-independent-project.json"))
                ensure(replay["status"] == "COMPLETED" and replay["result"] == received,
                       "Retrying the same receiving request changed its original result.")
            received_workspace = QgisWorkspace(receive_dir)
            received_snapshot = received_workspace.snapshot()
            for key in ("schema", "state", "events", "requests"):
                ensure(received_snapshot.get(key) == archived_snapshot.get(key),
                       "Independent receiving must preserve the exact original domain snapshot.")
            original_requests = {row["requestId"]: row for row in archived_snapshot.get("analystRequests", [])}
            current_requests = {row["requestId"]: row for row in received_snapshot.get("analystRequests", [])}
            allowed_received = {operation.identity("received-" + name) for name in (
                "reopen-original-native-map", "render-received-native-map", "read-received-features")}
            ensure(all(current_requests.get(key) == value for key, value in original_requests.items()) and
                   set(current_requests) - set(original_requests) <= allowed_received,
                   "Receiving must preserve each original analyst request and only its same retained continuation.")
            for record in received_workspace.project_files(received_snapshot):
                file_digest(receive_dir / record["path"], expected=record)
            with Listener(operation, "received", receive_dir, receive_dir / "software", args.native_runtime_file) as listener:
                reopened = listener.call("reopen-original-native-map", "map.reopen", {"projectId": saved["id"]})["result"]
                received_render = listener.call("render-received-native-map", "map.render", {
                    "projectId": saved["id"], "width": 1400, "height": 900})
                received_image = received_render["result"]["file"]
                listener.download("/download/operations/" + received_render["requestId"] + "/files/0",
                                  operation.root / "downloads" / "received-native-map.png", received_image)
                received_features = listener.call("read-received-features", "map.features", {
                    "projectId": saved["id"], "layerId": mapped["layer"]["id"], "offset": 0, "limit": 100})["result"]
                ensure(received_features["fields"] == features["fields"] and received_features["rows"] == features["rows"],
                       "The independently reopened native attributes differ from the original map.")
                received_browser = operation.browser("received", listener, {
                    "mode": "receiving", "editionId": full, "keys": keys, "review": review_context,
                    "sourceManifestSha256": intake.id, "portfolioId": reviewed["id"], "projectId": saved["id"],
                    "mapRequestId": received_render["requestId"]})
                ensure(received_workspace.read() == archived_snapshot["state"] and
                       received_workspace.history() == archived_snapshot["events"],
                       "Read-only received native inspection changed the original domain state.")
            result = {"schema": SCHEMA, "status": "COMPLETED", "completedAt": now(),
                "operationId": args.operation_id, "sourceManifestSha256": intake.id,
                "workspaceId": workspace.read()["id"], "revision": native_snapshot["state"]["revision"],
                "sourceSummary": prepared["summary"], "successor": successor,
                "nativeInspection": inspection, "nativeProject": saved["id"],
                "nativeFeatureCount": features["nativeFeatureCount"], "receiving": received["receipt"],
                "nativeReopen": reopened, "browser": browser, "receivedBrowser": received_browser,
                "domainReceiving": domain_receiving,
                "files": [public_file(path) for path in sorted((operation.root / "downloads").rglob("*")) if path.is_file()],
                "sourceRoot": str(SOURCE_ROOT), "originalWorkspace": str(workspace.root),
                "receivedWorkspace": str(receive_dir)}
            operation.record("completed", result)
            write_json(operation.root / "result.json", result)
            operation.progress("complete", workspaceId=result["workspaceId"], revision=result["revision"])
            return result
        except Exception as error:
            operation.record("continuation", {"schema": SCHEMA, "status": "RETAINED_CONTINUATION",
                "operationId": args.operation_id, "phase": operation.current_phase,
                "at": now(), "error": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--operation-id", default="C94-URBAN3-PARCEL-RECEIVING-20261012")
    parser.add_argument("--title", default="Pittsburgh public parcel source review")
    parser.add_argument("--review-key", default="0002A00132000001")
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--browser-config", required=True,
                        help="Private JSON with existing node, playwrightModule and chromium file paths.")
    parser.add_argument("--operation-timeout", type=int, default=600)
    args = parser.parse_args(argv)
    ensure(30 <= args.operation_timeout <= 3600, "Use a 30–3,600 second wait for each retained original operation.")
    ensure(args.actor.strip(), "Retain the actual responsible analyst.")
    args.actor = args.actor.strip()
    result = run(args)
    print(json.dumps({"status": result["status"], "result": str(Path(args.output).absolute() / "result.json"),
                      "workspaceId": result["workspaceId"]}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(2)
