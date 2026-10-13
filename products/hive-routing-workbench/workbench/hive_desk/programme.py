"""Execute the complete selected client programme and preserve full native results."""
from __future__ import annotations
from contextlib import contextmanager
import fcntl
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .editions import edition_operations, load_edition
from .native import status
from .util import json_text, require, same_process
from .workspace import now, sha

class OriginalRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None

def _read_result(workspace, run_id):
    item = workspace.get("programme", run_id)
    require(item, "Select a saved native programme.")
    return item

@contextmanager
def programme_lock(workspace, run_id):
    directory = workspace.root / "programme-locks"
    directory.mkdir(exist_ok=True, mode=0o700)
    descriptor = os.open(directory / (run_id + ".lock"), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)

def _save(workspace, run_id, data):
    current = _read_result(workspace, run_id)
    return workspace.save("programme", run_id, data, current["revision"])

def request_for(operation, base_url):
    method = operation.get("method", "POST")
    path = operation.get("path", "/graphql")
    raw = None
    if method == "POST":
        raw = json_text(operation["body"]).encode("utf-8")
    elif operation.get("body"):
        require(isinstance(operation["body"], dict), "GET request parameters must be an object.")
        parameters = [(key, json_text(value) if isinstance(value, (dict, list)) else str(value))
                      for key, value in operation["body"].items()]
        path += ("&" if "?" in path else "?") + urllib.parse.urlencode(parameters)
    headers = {"Accept": "application/graphql-response+json, application/json"}
    if raw is not None:
        headers["Content-Type"] = "application/json"
    headers.update(operation.get("headers", {}))
    for key, env_name in operation.get("header_env", {}).items():
        require(env_name in os.environ, "Connect the original private operation header: " + env_name)
        value = os.environ[env_name]
        require("\r" not in value and "\n" not in value, "Original private header contains a line break.")
        headers[key] = value
    require(all(k.lower() not in {"host", "content-length", "transfer-encoding", "connection"} for k in headers),
            "The native HTTP client owns connection and message framing headers.")
    request = urllib.request.Request(base_url + path, data=raw, headers=headers, method=method)
    public = {"method": method, "path": path, "body": operation.get("body"),
              "headers": operation.get("headers", {}), "header_env": operation.get("header_env", {})}
    return request, raw, public

def _execute(workspace, operation, base_url, timeout):
    request, raw, public = request_for(operation, base_url)
    request_file = workspace.put_bytes((json_text(public) + "\n").encode("utf-8"))
    body_file = workspace.put_bytes(raw) if raw is not None else None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), OriginalRedirects())
    started = time.monotonic()
    try:
        response = opener.open(request, timeout=float(timeout))
    except urllib.error.HTTPError as error:
        response = error
    with response:
        header_rows = list(response.headers.items())
        original = workspace.put_stream(response)
        code = response.status
    result = {"status": code, "headers": header_rows, "body": original,
              "elapsedMs": round((time.monotonic() - started) * 1000, 3),
              "request": request_file, "requestBody": body_file}
    try:
        parsed = json.loads(workspace.object_bytes(original["sha256"]))
    except (ValueError, UnicodeError):
        result["bodyFormat"] = "original-bytes"
    else:
        result["bodyFormat"] = "json"
        if isinstance(parsed, dict):
            errors = parsed.get("errors")
            result["graphql"] = {"hasData": "data" in parsed,
                "dataIsNull": parsed.get("data") is None,
                "errorCount": len(errors) if isinstance(errors, list) else 0,
                "hasExtensions": "extensions" in parsed, "keys": sorted(parsed)}
    return result

def run(workspace, deployment_id, run_id=None, name=None):
    """Run all selected operations once; preserve ambiguous interrupted requests for explicit review."""
    deployment = status(workspace, deployment_id)
    require(deployment["observation"].get("readiness", {}).get("status") == 200,
            "Start the original native deployment and wait for its readiness.")
    data = deployment["data"]
    native_attempt = data.get("currentAttempt", {})
    native_process = deployment["observation"].get("nativeProcess")
    require(same_process(native_process), "Reopen the actual native router child.")
    edition = load_edition(workspace, data["edition"])
    selected = edition_operations(workspace, edition)
    run_id = run_id or uuid.uuid4().hex
    require(isinstance(run_id, str) and run_id and all(c.isalnum() or c in "._-" for c in run_id),
            "Use a plain stable native programme id.")
    existing = workspace.get("programme", run_id)
    if not existing:
        existing = workspace.save("programme", run_id, {"name": name or edition["data"]["name"],
            "deployment": deployment_id, "edition": data["edition"], "nativeAttempt": native_attempt["id"],
            "sourcePin": data["binary"]["sourcePin"], "operations": selected,
            "state": "prepared", "rows": [], "createdAt": now()})
    require(existing["data"]["deployment"] == deployment_id and existing["data"]["edition"] == data["edition"],
            "This programme belongs to its original deployment and edition.")
    if existing["data"]["state"] == "complete":
        return existing
    with programme_lock(workspace, run_id):
        current = _read_result(workspace, run_id)["data"]
        require(current["nativeAttempt"] == native_attempt["id"],
                "Use a new programme for a different original native process attempt.")
        rows = list(current["rows"])
        uncertain = [row["id"] for row in rows if row["state"] == "started"]
        require(not uncertain, "Review the retained request outcome before replaying: " + ", ".join(uncertain))
        completed = {row["id"] for row in rows}
        current = {**current, "state": "running", "startedAt": current.get("startedAt", now())}
        _save(workspace, run_id, current)
        for operation in selected["operations"]:
            if operation["id"] in completed:
                continue
            row = {"id": operation["id"], "name": operation.get("name", operation["id"]),
                   "expectation": operation.get("expectation"), "state": "started", "startedAt": now()}
            rows.append(row)
            current = {**current, "rows": rows}
            _save(workspace, run_id, current)
            try:
                require(same_process(native_process), "The original native router stopped during this programme.")
                row["response"] = _execute(workspace, operation, data["baseUrl"],
                    operation.get("timeout_seconds", selected.get("timeout_seconds", 120)))
                row["state"] = "received"
            except Exception as error:
                row["state"] = "request-error"
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            row["endedAt"] = now()
            _save(workspace, run_id, {**current, "rows": rows})
        state = "complete" if all(row["state"] == "received" for row in rows) and len(rows) == len(selected["operations"]) else "needs-review"
        result = {**current, "rows": rows, "state": state, "completedAt": now(),
                  "counts": {"selected": len(selected["operations"]), "received": sum(row["state"] == "received" for row in rows),
                             "requestErrors": sum(row["state"] == "request-error" for row in rows)}}
        return _save(workspace, run_id, result)

def response_body(workspace, run_id, operation_id):
    run_item = _read_result(workspace, run_id)
    row = next((r for r in run_item["data"]["rows"] if r["id"] == operation_id), None)
    require(row and row.get("response"), "This operation has no received native body.")
    return workspace.object_bytes(row["response"]["body"]["sha256"])

def _json_differences(left, right, path=""):
    differences = []
    if type(left) is not type(right):
        return [{"path": path or "/", "before": left, "after": right}]
    if isinstance(left, dict):
        for key in sorted(set(left) | set(right)):
            target = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in left:
                differences.append({"path": target, "change": "added", "after": right[key]})
            elif key not in right:
                differences.append({"path": target, "change": "removed", "before": left[key]})
            else:
                differences.extend(_json_differences(left[key], right[key], target))
    elif isinstance(left, list):
        for index in range(max(len(left), len(right))):
            target = path + "/" + str(index)
            if index >= len(left):
                differences.append({"path": target, "change": "added", "after": right[index]})
            elif index >= len(right):
                differences.append({"path": target, "change": "removed", "before": left[index]})
            else:
                differences.extend(_json_differences(left[index], right[index], target))
    elif left != right:
        differences.append({"path": path or "/", "before": left, "after": right})
    return differences

def compare(workspace, baseline_id, candidate_id):
    baseline, candidate = (_read_result(workspace, key) for key in (baseline_id, candidate_id))
    require(baseline["data"]["state"] == candidate["data"]["state"] == "complete",
            "Compare the complete received native programmes.")
    a = {row["id"]: row for row in baseline["data"]["rows"]}
    b = {row["id"]: row for row in candidate["data"]["rows"]}
    rows = []
    for key in sorted(set(a) | set(b)):
        left, right = a.get(key), b.get(key)
        row = {"id": key, "baseline": left, "candidate": right}
        if not left or not right:
            row["state"] = "operation-added" if right else "operation-removed"
        elif left["state"] != "received" or right["state"] != "received":
            row["state"] = "request-review"
        else:
            before, after = left["response"], right["response"]
            row.update({"requestChanged": before["request"]["sha256"] != after["request"]["sha256"],
                "httpStatusChanged": before["status"] != after["status"],
                "responseHeadersChanged": before["headers"] != after["headers"],
                "originalBodyIdentical": before["body"] == after["body"]})
            if before["bodyFormat"] == after["bodyFormat"] == "json":
                row["differences"] = _json_differences(json.loads(workspace.object_bytes(before["body"]["sha256"])),
                    json.loads(workspace.object_bytes(after["body"]["sha256"])))
                row["state"] = "changed" if row["differences"] or row["httpStatusChanged"] else "same-result"
            else:
                row["state"] = "same-result" if row["originalBodyIdentical"] and not row["httpStatusChanged"] else "changed"
        rows.append(row)
    comparison_id = sha((baseline_id + "\n" + candidate_id).encode("utf-8"))
    value = {"baseline": baseline_id, "candidate": candidate_id, "rows": rows,
             "counts": {"operations": len(rows), "changed": sum(row["state"] != "same-result" for row in rows)}, "at": now()}
    original = workspace.get("comparison", comparison_id)
    if original:
        return original
    return workspace.save("comparison", comparison_id, value)

def review(workspace, run_id, decisions, note, expected=None):
    item = _read_result(workspace, run_id)
    require(item["data"]["state"] == "complete", "Receive every selected native operation before its complete review.")
    require(isinstance(note, str) and note.strip(), "Record the engineering review of the full programme.")
    require(isinstance(decisions, list), "Review every original operation.")
    expected_ids = {row["id"] for row in item["data"]["rows"]}
    selected = set()
    for decision in decisions:
        require(decision.get("id") in expected_ids and decision["id"] not in selected, "Review each native operation once.")
        require(decision.get("decision") in {"accept", "change-required"}, "Choose accept or change-required.")
        require(isinstance(decision.get("reason"), str) and decision["reason"].strip(), "Record the observed result and engineering reason.")
        selected.add(decision["id"])
    require(selected == expected_ids, "Complete the review across all selected operations.")
    return workspace.save("programme-review", run_id, {"programme": run_id, "programmeRevision": item["revision"],
        "edition": item["data"]["edition"], "deployment": item["data"]["deployment"],
        "nativeAttempt": item["data"]["nativeAttempt"], "decisions": decisions, "note": note,
        "accepted": all(row["decision"] == "accept" for row in decisions), "at": now()}, expected)
