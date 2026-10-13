# SPDX-License-Identifier: MIT
"""Named publisher captures through the original analyst journal and file closure."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path

from ..model import (HASH, REQUEST, MAX_JSON, require, member, descriptor, read_json,
    file_digest, json_bytes, value_sha, retain_bytes, retain_copy)
from ..analyst_state import AnalystJournal
from .intake import ParcelIntake, MANIFEST
from .capture.workspace import CaptureWorkspace, capture_lock, atomic, retrieve, read_json as capture_json
from .capture.providers import CaptureError, exact_bytes

SCHEMA = "starforge.parcel-analyst-capture-snapshot.v1"
ACTIONS = frozenset(("init", "advance", "retry", "finalize", "checkpoint", "restore"))
MAX_FILES = 25000
MAX_BYTES = 16 * 1024 * 1024 * 1024

def normalize(action, raw):
    keys = {
        "init": {"directory", "label"},
        "advance": {"directory", "maxRequests", "timeout"},
        "retry": {"directory", "jobId", "reason"},
        "finalize": {"directory", "publisherChangeReason"},
        "checkpoint": {"directory"},
        "restore": {"directory", "checkpointRequestId"},
    }
    require(action in ACTIONS and isinstance(raw, dict) and set(raw) <= keys[action],
            "PARCEL_CAPTURE_ACTION", "Choose the named capture action and its original fields.")
    value = copy.deepcopy(raw)
    optional = {"maxRequests", "timeout"} if action == "advance" else {"publisherChangeReason"} if action == "finalize" else set()
    require(keys[action] - optional <= set(value), "PARCEL_CAPTURE_ACTION", "Keep every required capture field.")
    path = value.get("directory")
    require(isinstance(path, str) and path.strip() and "\0" not in path and Path(path).expanduser().is_absolute(),
            "PARCEL_CAPTURE_DIRECTORY", "Choose an absolute directory for this named source capture.")
    value["directory"] = str(Path(path).expanduser().absolute())
    if action == "advance":
        value.setdefault("maxRequests", 8); value.setdefault("timeout", 45)
        require(type(value["maxRequests"]) is int and 1 <= value["maxRequests"] <= 64 and
                type(value["timeout"]) is int and 1 <= value["timeout"] <= 120,
                "PARCEL_CAPTURE_BUDGET", "Use 1–64 publisher requests and a 1–120 second request timeout.")
    for field in ("label", "jobId", "reason", "publisherChangeReason", "checkpointRequestId"):
        if field in value:
            require(isinstance(value[field], str) and value[field].strip() and len(value[field]) <= 4000,
                    "PARCEL_CAPTURE_FIELD", "Keep the original nonempty capture value.", field=field)
    if "checkpointRequestId" in value:
        require(REQUEST.fullmatch(value["checkpointRequestId"]), "PARCEL_CAPTURE_CHECKPOINT", "Select a saved capture request.")
    return value

def selected(workspace, directory):
    root = Path(directory).expanduser().absolute()
    resolved = root.resolve()
    project = workspace.root.resolve()
    require(resolved != project and project not in resolved.parents and resolved not in project.parents,
            "PARCEL_CAPTURE_LOCATION", "Keep the working capture directory separate from the project directory.")
    require(not root.is_symlink(), "PARCEL_CAPTURE_LOCATION", "Choose an ordinary working capture directory.")
    return CaptureWorkspace(root)

def snapshot_name(identity):
    require(isinstance(identity, str) and REQUEST.fullmatch(identity), "PARCEL_CAPTURE_REQUEST", "Retain the original analyst request ID.")
    return "analyst/results/parcel-captures/" + identity + "/snapshot.json"

def load_checkpoint(workspace, request_id):
    row = AnalystJournal(workspace).get(request_id)
    require(row is not None and row["status"] == "COMPLETED" and row["input"]["action"] == "parcel.capture",
            "PARCEL_CAPTURE_CHECKPOINT", "Select a completed original capture checkpoint.")
    name = snapshot_name(request_id)
    record = next((x for x in row["files"] if x["path"] == name), None)
    require(record is not None, "PARCEL_CAPTURE_CHECKPOINT", "The original capture checkpoint is absent.")
    path = member(workspace.root, name); file_digest(path, expected=record)
    snapshot_record = record
    body, _ = read_json(path, limit=MAX_JSON)
    require(body.get("schema") == SCHEMA and body.get("requestId") == request_id and
            body.get("workspaceId") == workspace.read()["id"],
            "PARCEL_CAPTURE_CHECKPOINT", "Retain the original capture checkpoint identity.")
    allowed = {x["path"]: x for x in row["files"]}
    for item in body["members"]:
        record = descriptor(item["object"])
        require(allowed.get(record["path"]) == record, "PARCEL_CAPTURE_CHECKPOINT", "The snapshot names an unretained source object.")
        file_digest(member(workspace.root, record["path"]), expected=record)
    return body, snapshot_record

def status(workspace, directory):
    capture = selected(workspace, directory)
    marker = capture.root / ".analyst-capture-receiving.json"
    require(not marker.exists() or (capture.root / ".analyst-capture-received.json").exists(),
            "PARCEL_CAPTURE_RECEIVING", "Continue the original capture restoration before advancing it.")
    value = capture.status()
    receipt_path = capture.root / "receiving.json"
    if receipt_path.exists():
        receipt = capture_json(receipt_path)
        manifest_path = capture.root / "delivery" / MANIFEST
        measured = file_digest(manifest_path)
        require(measured["sha256"] == receipt["manifestSha256"] and measured["bytes"] == receipt["manifestBytes"],
                "PARCEL_CAPTURE_RECEIVING", "The completed receiving manifest differs from its original receipt.")
        manifest = capture_json(manifest_path)
        value["receiving"] = {**receipt, "directory": str(capture.root / "delivery"),
            "publisherChangeReason": (manifest.get("capture") or {}).get("publisherChangeReview")}
    return {"directory": str(capture.root), **value}

def records(workspace, *, offset=0, limit=50):
    require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 100,
            "PARCEL_CAPTURE_PAGE", "Choose a page of 1–100 original capture requests.")
    result = []
    with workspace._connect() as db:
        present = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analyst_requests'").fetchone()
        if present:
            for saved in db.execute("SELECT body FROM analyst_requests ORDER BY rowid DESC"):
                row = json.loads(saved[0])
                if row["input"]["action"] != "parcel.capture": continue
                result.append({"requestId": row["requestId"], "status": row["status"],
                    "action": row["input"]["payload"]["action"], "input": row["input"]["payload"]["payload"],
                    "actor": row["input"]["actor"], "createdAt": row["createdAt"], "updatedAt": row["updatedAt"],
                    "result": row.get("result"), "error": row.get("error"),
                    "checkpoint": any(f["path"] == snapshot_name(row["requestId"]) for f in row.get("files", []))})
    return {"items": result[offset:offset+limit], "offset": offset, "total": len(result),
            "complete": offset + limit >= len(result)}

def _existing_result(workspace, identity, expected_input):
    path = member(workspace.root, snapshot_name(identity), existing=False)
    if not path.exists(): return None
    snapshot, _ = read_json(path, limit=MAX_JSON)
    require(snapshot.get("schema") == SCHEMA and snapshot.get("requestId") == identity and
            snapshot.get("workspaceId") == workspace.read()["id"] and snapshot.get("input") == expected_input,
            "PARCEL_CAPTURE_REQUEST", "This checkpoint belongs to another frozen capture request.")
    unique = {}
    for item in snapshot["members"]:
        record = descriptor(item["object"])
        require(record["path"].startswith("analyst/results/parcel-capture-objects/"),
                "PARCEL_CAPTURE_FILE", "Keep the original capture object path.")
        file_digest(member(workspace.root, record["path"]), expected=record)
        unique[record["path"]] = record
    record = {"path": snapshot_name(identity), **file_digest(path)}
    unique[record["path"]] = record
    return snapshot["result"], list(unique.values())

def _checkpoint(workspace, capture, identity, expected_input, result):
    # Capture files are copied under its existing writer lock. The immutable
    # content-addressed objects then join the original analyst result closure.
    with capture_lock(capture.root):
        capture.config()
        members, unique, total = [], {}, 0
        for path in sorted(capture.root.rglob("*")):
            if path.name in (".capture.lock", ".analyst-capture-receiving.json", ".analyst-capture-received.json"): continue
            require(not path.is_symlink(), "PARCEL_CAPTURE_FILE", "A capture checkpoint cannot contain symbolic links.")
            if path.is_dir(): continue
            require(path.is_file(), "PARCEL_CAPTURE_FILE", "Keep ordinary source capture files.")
            relative = path.relative_to(capture.root).as_posix()
            measured = file_digest(path)
            total += measured["bytes"]
            require(len(members) < MAX_FILES and total <= MAX_BYTES,
                    "PARCEL_CAPTURE_SIZE", "The complete capture checkpoint exceeds its supported file or byte limit.")
            retained = retain_copy(path, workspace.root,
                "analyst/results/parcel-capture-objects/" + measured["sha256"], measured)
            unique[retained["path"]] = retained
            members.append({"path": relative, "object": retained})
        # Review values can contain exact decimal metadata. Project those as
        # strings in the analyst result; the original response bytes stay intact.
        value = json.loads(exact_bytes({**result, **status(workspace, str(capture.root))}), parse_float=str)
        value["checkpoint"] = {"requestId": identity, "members": len(members), "expandedBytes": total,
                               "snapshotPath": snapshot_name(identity)}
        snapshot = {"schema": SCHEMA, "workspaceId": workspace.read()["id"], "requestId": identity,
                    "input": expected_input, "captureDirectory": str(capture.root),
                    "members": members, "result": value}
        body = json_bytes(snapshot)
        require(len(body) <= MAX_JSON, "PARCEL_CAPTURE_SIZE", "The complete checkpoint index exceeds its supported size.")
        retained = retain_bytes(workspace.root, snapshot_name(identity), body)
        unique[retained["path"]] = retained
        return value, list(unique.values())

def _restore(workspace, capture, checkpoint_request):
    snapshot, _ = load_checkpoint(workspace, checkpoint_request)
    with capture_lock(capture.root):
        marker = capture.root / ".analyst-capture-receiving.json"
        completed = capture.root / ".analyst-capture-received.json"
        identity = {"schema": SCHEMA, "workspaceId": workspace.read()["id"],
                    "checkpointRequestId": checkpoint_request, "snapshotSha256": value_sha(snapshot)}
        if completed.exists():
            require(capture_json(completed) == identity and capture.config()["captureId"] == snapshot["result"]["capture"]["captureId"],
                    "PARCEL_CAPTURE_ALREADY_RECEIVED", "The resumed capture has another received identity.")
            return {"restoredFromRequestId": checkpoint_request}
        if marker.exists():
            require(capture_json(marker) == identity, "PARCEL_CAPTURE_ALREADY_RECEIVED",
                    "This directory belongs to another received capture.")
        else:
            require(not any(path.name != ".capture.lock" for path in capture.root.iterdir()),
                    "PARCEL_CAPTURE_NEW_DIRECTORY", "Choose an empty directory for the saved capture.")
            atomic(marker, json_bytes(identity))
        for item in snapshot["members"]:
            relative = item["path"]
            require(relative not in (".capture.lock", ".analyst-capture-receiving.json", ".analyst-capture-received.json"),
                    "PARCEL_CAPTURE_FILE", "The snapshot contains a reserved working marker.")
            member(capture.root, relative, existing=False)
            source = member(workspace.root, item["object"]["path"])
            file_digest(source, expected=item["object"])
            retain_copy(source, capture.root, relative, item["object"])
        atomic(completed, json_bytes(identity))
    return {"restoredFromRequestId": checkpoint_request}


def _retry_once(capture, identity, frozen, payload):
    plan_path = capture.root / "analyst-requests" / (identity + ".json")
    with capture_lock(capture.root):
        if plan_path.exists():
            plan = capture_json(plan_path)
            require(plan["input"] == frozen, "PARCEL_CAPTURE_REQUEST", "Retain this retry's original input.")
        else:
            graph = capture.graph()
            item = next((item for item in graph["pending"] if item["id"] == payload["jobId"]), None)
            require(item is not None, "CAPTURE_JOB", "Select an existing unresolved publisher request.")
            plan = {"input": frozen, "previous": capture.blocked(item) or {},
                    "existingRetries": sorted(path.name for path in (capture.root / "retries").glob("*.json"))}
            atomic(plan_path, exact_bytes(plan))
        for path in (capture.root / "retries").glob("*.json"):
            if path.name in plan["existingRetries"]: continue
            receipt = capture_json(path)
            if (receipt.get("jobId") == payload["jobId"] and receipt.get("reason") == payload["reason"] and
                    receipt.get("previous") == plan["previous"]):
                return
        item = next((item for item in capture.graph()["pending"] if item["id"] == payload["jobId"]), None)
        require(item is not None and (capture.blocked(item) or {}) == plan["previous"],
                "PARCEL_CAPTURE_RETRY_CHANGED", "The publisher attempt changed; review its current status before a new retry.")
    capture.retry(payload["jobId"], payload["reason"])

def execute(workspace, action, payload, common, progress=None):
    payload = normalize(action, payload)
    identity, actor = common["request_id"], common["actor"]
    frozen = {"action": action, "payload": payload, "actor": actor}
    previous = _existing_result(workspace, identity, frozen)
    if previous is not None: return previous
    capture = selected(workspace, payload["directory"])
    result = {}
    if action == "init":
        capture.initialize(label=payload["label"], actor=actor,
                           capture_id="capture-" + value_sha({"workspaceId": workspace.read()["id"], "requestId": identity}))
    elif action == "restore":
        result = _restore(workspace, capture, payload["checkpointRequestId"])
    else:
        status(workspace, str(capture.root))
        if action == "advance":
            # Charge the original request immediately before each actual GET,
            # under the capture engine's existing writer lock. A retry cannot
            # spend this request's budget a second time.
            plan_path = capture.root / "analyst-requests" / (identity + ".json")
            with capture_lock(capture.root):
                if plan_path.exists():
                    plan = capture_json(plan_path)
                    require(plan["input"] == frozen, "PARCEL_CAPTURE_REQUEST", "The retained capture budget belongs to another input.")
                else:
                    plan = {"input": frozen, "requestsMade": 0}
                    atomic(plan_path, json_bytes(plan))
                remaining = max(0, payload["maxRequests"] - plan["requestsMade"])
            def bounded_retrieve(url, timeout):
                current = capture_json(plan_path)
                require(current["input"] == frozen and current["requestsMade"] < payload["maxRequests"],
                        "PARCEL_CAPTURE_BUDGET", "The original capture request has consumed its selected budget.")
                current["requestsMade"] += 1
                atomic(plan_path, json_bytes(current), immutable=False)
                return retrieve(url, timeout)
            if progress: progress({"phase": "publisher-capture", "remainingRequestBudget": remaining})
            if remaining:
                capture.advance(max_requests=remaining, timeout=payload["timeout"], transport=bounded_retrieve)
            result["requestsMade"] = capture_json(plan_path)["requestsMade"]
        elif action == "retry":
            _retry_once(capture, identity, frozen, payload)
        elif action == "finalize":
            receipt_path = capture.root / "receiving.json"
            if receipt_path.exists():
                receipt = capture_json(receipt_path)
                prepared = ParcelIntake(capture.root / "delivery", receipt["manifestSha256"]).prepare()
                manifest = capture_json(capture.root / "delivery" / MANIFEST)
                require((manifest.get("capture") or {}).get("publisherChangeReview") == payload.get("publisherChangeReason"),
                        "PARCEL_CAPTURE_REVIEW_CHANGED", "Reopen this finalized source with its original publisher-change review reason.")
                result["receiving"] = {**receipt, "directory": str(capture.root / "delivery"), "summary": prepared["summary"]}
            else:
                try:
                    result["receiving"] = capture.finalize(accept_publisher_change_reason=payload.get("publisherChangeReason"))
                except CaptureError as error:
                    if error.code != "CAPTURE_PUBLISHER_CHANGED": raise
                    result["publisherReview"] = error.value()
    return _checkpoint(workspace, capture, identity, frozen, result)
