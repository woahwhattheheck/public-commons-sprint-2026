# SPDX-License-Identifier: MIT
"""Analyst request custody in the original QgisWorkspace SQLite database.

Domain changes continue through QgisWorkspace's original revision/request API.
This optional table retains a browser/native invocation across listener loss;
the original snapshot and package codecs carry its records and exact result files.
"""
from __future__ import annotations
import copy
import json
from contextlib import contextmanager
from pathlib import Path

from .model import (QgisWorkspace, QgisReceivingError, REQUEST, HASH, require,
                    json_bytes, value_sha, utc_now, descriptor, member, file_digest)

ANALYST_SCHEMA = "starforge.stac-qgis-analyst-request.v1"
ANALYST_TABLE = "analyst_requests"
MAX_REQUEST_BYTES = 32 * 1024 * 1024
STATUSES = frozenset(("READY", "RUNNING", "INTERRUPTED", "COMPLETED", "FAILED"))
ACTIONS = frozenset((
    "source.inspect", "source.import", "source.select", "layers.save",
    "edition.review", "map.inspect", "map.save", "map.reopen",
    "map.render", "map.features", "project.export", "project.receive",
    "field.command", "postgis.select", "postgis.check", "postgis.layers", "parcel.command", "parcel.capture", "evidence.command", "evidence.spatial",
))
MUTATIONS = frozenset(("source.import", "source.select", "layers.save",
                       "edition.review", "map.save", "field.command", "postgis.check", "postgis.layers", "parcel.command", "evidence.command", "evidence.spatial"))


ANALYST_MODULES = (
    "__init__.py", "actions.py", "worker.py", "uploads.py", "binding.py", "server.py", "EVIDENCE_BROWSER.md",
    "public/index.html", "public/app.js", "public/parcels.js", "public/evidence.js", "public/evidence-store.js", "public/evidence.css", "public/style.css",
)
ANALYST_ROOT_FILES = (
    "analyst.mjs", "application.mjs", "application-provider.mjs",
    "analyst-browser-assets.json", "ANALYST.md", "ANALYST_NATIVE.md",
    "analyst-native-receiving.mjs", "plugin-package.py", "cli.mjs", "bridge.mjs", "PARCELS.md", "parcel-native-receiving.py", "parcel-native-browser.mjs", "parcel-successor-receiving.py", "parcel-operation-restore.py",
    "evidence_cli.py", "evidence-native-receiving.py", "EVIDENCE_RECEIVING.md", "PARCEL_EVIDENCE.md", "AGENTS.md",
    "evidence-native-bootstrap.py", "EVIDENCE_BOOTSTRAP_INPUTS.example.json", "EVIDENCE_BOOTSTRAP.md",
    "evidence-foreground-receiving.mjs", "EVIDENCE_FOREGROUND.md",
    "address-review-receiving.py", "ADDRESS_REVIEW.md",
    "evidence-browser-receiving.mjs", "evidence-example/bloomington/parcel.json",
    "evidence-example/bloomington/parcel-metadata.json", "evidence-example/bloomington/flood-source-contract.json",
    "evidence-example/bloomington/README.md", "evidence-example/bloomington/flood-source-contract-superseded.json",
)


def analyst_source_paths(plugin_root):
    """Canonical receiving names for both repository and installed plugin layouts."""
    plugin_root = Path(plugin_root).resolve(strict=True)
    root = plugin_root if (plugin_root / "analyst" / "server.py").is_file() else plugin_root.parent
    paths = {"starforge_stac/analyst_state.py": plugin_root / "analyst_state.py"}
    paths.update({"starforge_stac/" + name: plugin_root / name for name in
                  ("parcel_evidence.py", "parcel_evidence_operator.py", "parcel_evidence_native.py", "parcel_evidence_reports.py", "address_review.py")})
    paths.update({"analyst/" + name: root / "analyst" / name for name in ANALYST_MODULES})
    paths.update({name: root / name for name in ANALYST_ROOT_FILES})
    # The native evidence bootstrap reuses the maintained vector producer.
    # Repository source keeps it beside qgis; received/plugin source keeps it
    # in this ordinary software closure without an independent maintained copy.
    vector_names = ("__init__.py", "common.py", "capture.py", "driver.py",
                    "materialize.py", "comparison.py", "archive.py", "engine.py")
    vector_root = next((candidate for candidate in (root / "vector", root.parent / "vector")
                        if all((candidate / name).is_file() and not (candidate / name).is_symlink()
                               for name in vector_names)), None)
    require(vector_root is not None, "EVIDENCE_VECTOR_SOURCE_MISSING",
            "Keep the complete maintained native vector producer with the receiving application.")
    paths.update({"vector/" + name: vector_root / name for name in vector_names})
    from .parcels.state import MODULES as PARCEL_MODULES
    paths.update({"starforge_stac/parcels/" + name: plugin_root / "parcels" / name for name in PARCEL_MODULES})
    for name, path in paths.items():
        require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 4 * 1024 * 1024,
                "ANALYST_SOURCE_MISSING",
                "Keep the complete original analyst software and receiving guide.", path=name)
    return paths


def analyst_software_files(plugin_root):
    return {name: path.read_bytes() for name, path in analyst_source_paths(plugin_root).items()}


def _table(db):
    db.execute("CREATE TABLE IF NOT EXISTS analyst_requests "
               "(request_id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, body TEXT NOT NULL)")


def analyst_snapshot(db):
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                  (ANALYST_TABLE,)).fetchone() is None:
        return []
    return [json.loads(row[0]) for row in
            db.execute("SELECT body FROM analyst_requests ORDER BY request_id")]


def _validate_record(row, workspace_id):
    require(isinstance(row, dict) and row.get("schema") == ANALYST_SCHEMA and
            isinstance(row.get("requestId"), str) and REQUEST.fullmatch(row["requestId"]),
            "ANALYST_REQUEST_INVALID", "Keep the original complete analyst request.")
    original = row.get("input")
    require(isinstance(original, dict) and original.get("workspaceId") == workspace_id and
            original.get("action") in ACTIONS and isinstance(original.get("payload"), dict) and
            isinstance(original.get("workspaceDirectory"), str) and Path(original["workspaceDirectory"]).is_absolute() and
            isinstance(original.get("actor"), str) and 0 < len(original["actor"].strip()) <= 240 and
            type(original.get("revision")) is int and original["revision"] >= 0 and
            isinstance(original.get("nativeRuntime"), dict) and
            row.get("inputSha256") == value_sha(original),
            "ANALYST_REQUEST_INPUT_CHANGED", "The analyst request differs from its frozen original input.")
    require(row.get("status") in STATUSES and isinstance(row.get("attempts"), list) and
            isinstance(row.get("files"), list), "ANALYST_REQUEST_STATE",
            "Keep the complete request status, attempts and retained files.")
    require(len(row["attempts"]) <= 10000, "ANALYST_ATTEMPT_LIMIT",
            "The original request has exceeded the supported attempt history.")
    seen = set()
    for raw in row["files"]:
        item = descriptor(raw)
        require(item["path"].startswith("analyst/results/") and item["path"] not in seen,
                "ANALYST_RESULT_PATH", "Keep distinct original analyst result files.")
        seen.add(item["path"])
    require(len(json_bytes(row)) <= MAX_REQUEST_BYTES, "ANALYST_REQUEST_LIMIT",
            "The complete analyst request exceeds the supported size.")
    return row


def validate_analyst_snapshot(snapshot, *, records=None):
    rows = snapshot.get("analystRequests", [])
    require(isinstance(rows, list) and len(rows) <= 100000,
            "ANALYST_HISTORY_INVALID", "Keep the complete analyst request history.")
    seen = set()
    for row in rows:
        _validate_record(row, snapshot["state"]["id"])
        require(row["requestId"] not in seen, "ANALYST_HISTORY_INVALID",
                "An analyst request identity appears twice.")
        seen.add(row["requestId"])
        if records is not None:
            for raw in row["files"]:
                item = descriptor(raw)
                expected = records.get(item["path"])
                require(expected is not None and
                        all(expected[key] == item[key] for key in ("bytes", "sha256")),
                        "ANALYST_FILE_CLOSURE",
                        "An analyst request references missing or changed result bytes.",
                        path=item["path"])
    return rows


def analyst_file_refs(snapshot):
    rows = validate_analyst_snapshot(snapshot)
    result = {}
    for row in rows:
        for raw in row["files"]:
            item = descriptor(raw)
            old = result.get(item["path"])
            require(old is None or old == item, "ANALYST_FILE_CLOSURE",
                    "An analyst result file has conflicting retained identities.")
            result[item["path"]] = item
    return [result[name] for name in sorted(result)]


def restore_analyst_snapshot(db, snapshot):
    rows = validate_analyst_snapshot(snapshot)
    if not rows:
        return
    _table(db)
    db.executemany("INSERT INTO analyst_requests VALUES(?,?,?)",
                   [(row["requestId"], row["inputSha256"],
                     json.dumps(row, ensure_ascii=False, allow_nan=False)) for row in rows])


class AnalystJournal:
    def __init__(self, workspace):
        require(isinstance(workspace, QgisWorkspace), "ANALYST_WORKSPACE",
                "Use the original QGIS project workspace.")
        self.workspace = workspace
        with workspace._connect() as db:
            _table(db)

    def get(self, request_id):
        require(isinstance(request_id, str) and REQUEST.fullmatch(request_id),
                "ANALYST_REQUEST_ID", "Select the original analyst request.")
        with self.workspace._connect() as db:
            row = db.execute("SELECT body FROM analyst_requests WHERE request_id=?",
                             (request_id,)).fetchone()
        require(row is not None, "ANALYST_REQUEST_NOT_FOUND",
                "The selected analyst request is not in this workspace.")
        return _validate_record(json.loads(row[0]), self.workspace.read()["id"])

    def list(self, *, offset=0, limit=50):
        require(type(offset) is int and offset >= 0 and type(limit) is int and
                1 <= limit <= 100, "ANALYST_PAGE", "Choose a page of 1 to 100 requests.")
        with self.workspace._connect() as db:
            db.execute("BEGIN")
            total = db.execute("SELECT count(*) FROM analyst_requests").fetchone()[0]
            records = [json.loads(row[0]) for row in db.execute(
                "SELECT body FROM analyst_requests ORDER BY rowid DESC LIMIT ? OFFSET ?",
                (limit, offset))]
        items = []
        for row in records:
            items.append({key: copy.deepcopy(row.get(key)) for key in
                          ("requestId", "inputSha256", "status", "createdAt", "updatedAt",
                           "error", "progress", "files")})
            items[-1].update({"action": row["input"]["action"],
                              "actor": row["input"]["actor"],
                              "inputRevision": row["input"]["revision"],
                              "attempts": len(row["attempts"])})
        return {"items": items, "offset": offset, "limit": limit,
                "total": total, "complete": offset + len(items) >= total}

    def create(self, *, request_id, action, payload, revision, actor, native_runtime=None):
        require(isinstance(request_id, str) and REQUEST.fullmatch(request_id),
                "ANALYST_REQUEST_ID", "Use one stable request ID for this complete action.")
        require(action in ACTIONS and isinstance(payload, dict), "ANALYST_ACTION",
                "Select an original analyst operation and its complete input.")
        require(type(revision) is int and revision >= 0 and isinstance(actor, str) and
                0 < len(actor.strip()) <= 240, "ANALYST_INPUT",
                "Use the displayed revision and the responsible analyst name.")
        state = self.workspace.read()
        original = {"workspaceId": state["id"], "workspaceDirectory": str(self.workspace.root), "action": action,
                    "payload": copy.deepcopy(payload), "revision": revision,
                    "actor": actor.strip(), "nativeRuntime": copy.deepcopy(native_runtime or {})}
        digest = value_sha(original)
        now = utc_now()
        row = {"schema": ANALYST_SCHEMA, "requestId": request_id,
               "input": original, "inputSha256": digest, "status": "READY",
               "createdAt": now, "updatedAt": now, "attempts": [],
               "files": [], "result": None, "error": None, "progress": None}
        _validate_record(row, state["id"])
        with self.workspace._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT input_sha256,body FROM analyst_requests WHERE request_id=?",
                                  (request_id,)).fetchone()
            if previous:
                require(previous[0] == digest, "REQUEST_REUSED",
                        "This analyst request ID belongs to different frozen input.")
                return json.loads(previous[1])
            current = json.loads(db.execute("SELECT body FROM workspace WHERE id=1").fetchone()[0])
            require(current["id"] == state["id"] and current["revision"] == revision,
                    "REVISION_CHANGED",
                    "Refresh the current project revision before starting the action.",
                    expected=revision, actual=current["revision"])
            require(db.execute("SELECT count(*) FROM analyst_requests").fetchone()[0] < 100000,
                    "ANALYST_HISTORY_LIMIT", "The complete analyst journal is at its supported limit.")
            db.execute("INSERT INTO analyst_requests VALUES(?,?,?)",
                       (request_id, digest, json.dumps(row, ensure_ascii=False, allow_nan=False)))
        return row

    def _update(self, request_id, update):
        with self.workspace._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT body FROM analyst_requests WHERE request_id=?",
                             (request_id,)).fetchone()
            require(old is not None, "ANALYST_REQUEST_NOT_FOUND", "The original request is missing.")
            row = json.loads(old[0])
            update(row)
            row["updatedAt"] = utc_now()
            _validate_record(row, row["input"]["workspaceId"])
            db.execute("UPDATE analyst_requests SET body=? WHERE request_id=?",
                       (json.dumps(row, ensure_ascii=False, allow_nan=False), request_id))
        return row

    def begin(self, request_id, *, instance_id, pid):
        def update(row):
            require(row["status"] != "COMPLETED", "ANALYST_ALREADY_COMPLETED",
                    "Reopen the retained result for this completed request.")
            row["status"] = "RUNNING"
            row["error"] = None
            row["attempts"].append({"instanceId": instance_id, "pid": pid,
                                    "startedAt": utc_now(), "endedAt": None})
        return self._update(request_id, update)

    def progress(self, request_id, value):
        # Only the worker holding the original OS lock writes progress.
        require(isinstance(value, dict) and len(json_bytes(value)) <= 65536,
                "ANALYST_PROGRESS", "Use a compact original progress record.")
        return self._update(request_id, lambda row: row.update(progress=copy.deepcopy(value)))

    def retain_files(self, request_id, files):
        retained = []
        for raw in files:
            item = descriptor(raw)
            file_digest(member(self.workspace.root, item["path"]), expected=item)
            retained.append(item)
        def update(row):
            previous = {item["path"]: item for item in row["files"]}
            for item in retained:
                require(item["path"] not in previous or previous[item["path"]] == item,
                        "ANALYST_FILE_CLOSURE", "An original retained result file changed.")
                previous[item["path"]] = item
            row["files"] = [previous[name] for name in sorted(previous)]
        return self._update(request_id, update)

    def finish(self, request_id, result, files=()):
        retained = []
        for raw in files:
            item = descriptor(raw)
            file_digest(member(self.workspace.root, item["path"]), expected=item)
            retained.append(item)
        def update(row):
            previous = {item["path"]: item for item in row["files"]}
            for item in retained:
                require(item["path"] not in previous or previous[item["path"]] == item,
                        "ANALYST_FILE_CLOSURE", "An original retained result file changed.")
                previous[item["path"]] = item
            row.update(status="COMPLETED", result=copy.deepcopy(result),
                       files=[previous[name] for name in sorted(previous)], error=None, progress=None)
            if row["attempts"]:
                row["attempts"][-1]["endedAt"] = utc_now()
                row["attempts"][-1]["status"] = "COMPLETED"
        return self._update(request_id, update)

    def fail(self, request_id, error, *, interrupted=False):
        require(isinstance(error, dict), "ANALYST_ERROR", "Keep the original error details.")
        def update(row):
            if row["status"] == "COMPLETED":
                return
            row["status"] = "INTERRUPTED" if interrupted else "FAILED"
            row["error"] = copy.deepcopy(error)
            if row["attempts"]:
                row["attempts"][-1]["endedAt"] = utc_now()
                row["attempts"][-1]["status"] = row["status"]
        return self._update(request_id, update)
