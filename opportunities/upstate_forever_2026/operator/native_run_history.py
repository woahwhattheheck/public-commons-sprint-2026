"""Original native execution histories on the existing operator queue."""
from __future__ import annotations

from copy import deepcopy

from model import native_run_history as history
from model.common import identifier, read_json, verify_file

ACTION = "run.history.save"


def _product(operator, workspace_key, key):
    ws = operator.ws(workspace_key)
    record = history.inspect(ws, key)
    directory = ws.root / history.ROOT / record["id"]
    document = read_json(verify_file(directory, record["files"]["history.json"]))
    result = {**deepcopy(record), "workspace_key": workspace_key,
              "history": document, "_downloads": []}
    for name in ("index.html", "history.zip", "history.json", "runs.csv",
                 "attempts.csv", "stages.csv", "MANIFEST.json"):
        item = record["files"][name]
        path = verify_file(directory, item)
        ticket = operator._ticket(workspace_key, path, item,
                                  "Readable native execution history" if name == "index.html" else name)
        result["_downloads"].append({**ticket, "member": name})
    return result


def read(operator, workspace_key, operation, payload):
    ws = operator.ws(workspace_key)
    if operation == "catalog":
        return {"schema": "upstate.native-run-history-catalog/v1",
                "workspace_key": workspace_key, "project_id": ws.project["id"],
                "histories": history.catalog(ws)}
    if operation == "preview":
        return {**history.preview(ws, payload.get("selection", payload)),
                "workspace_key": workspace_key}
    if operation == "report":
        return _product(operator, workspace_key, identifier(payload.get("id")))
    raise ValueError("Choose the execution history catalogue, preview or saved report")


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the registered original execution history action")
    record = history.build(operator.ws(workspace_key), payload.get("selection"),
                           identifier(payload.get("expected_preview_id")))
    return {name: deepcopy(record[name]) for name in
            ("id", "project_id", "title", "selection", "captured_at", "summary")}


def decorate_task(operator, task):
    if task.get("action") != ACTION or task.get("state") != "complete":
        return task
    value = _product(operator, task["workspace"], task["result"]["id"])
    task["_downloads"] = value["_downloads"]
    task["_item"] = {"kind": "native-run-histories", "id": value["id"]}
    return task


def verify_workspace(workspace):
    count = 0
    for path in sorted((workspace.root / history.ROOT).glob("*/report.json")):
        history.inspect(workspace, path.parent.name)
        count += 1
    return {"native_run_histories": count}
