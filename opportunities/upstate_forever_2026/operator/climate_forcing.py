"""Climate-forcing desk for the existing operator and native task queue."""
from __future__ import annotations
from copy import deepcopy
from model import climate_forcing
from model.common import identifier, relative_file, describe_file

ACTIONS = {"climate-forcing.prepare", "climate-forcing.report"}

def one(payload, name, default=None):
    value = payload.get(name, default)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Choose one " + name)
        return value[0]
    return value

def selection(payload):
    value = payload.get("selection")
    if not isinstance(value, dict):
        raise ValueError("Choose a completed baseline and retained forcing sources")
    return value

def downloads(operator, workspace_key, report):
    workspace = operator.ws(workspace_key)
    directory = report["directory"]
    expected_prefix = "climate-forcing-studies/" + identifier(report["study_id"]) + "/reports/" + identifier(report["id"])
    if directory != expected_prefix:
        raise ValueError("Climate report has an inconsistent retained directory")
    result = []
    for name, item in report.get("files", {}).items():
        path = relative_file(workspace.root, directory + "/" + item["path"])
        actual = describe_file(path.parent, path)
        if any(actual.get(key) != item.get(key) for key in ("bytes", "sha256")):
            raise ValueError("A retained climate report member changed: " + name)
        ticket = operator._ticket(workspace_key, path, item, name.replace("_", " "))
        ticket["artifact_id"] = name
        result.append(ticket)
    return result

def decorate_report(operator, workspace_key, report):
    value = deepcopy(report)
    value["_downloads"] = downloads(operator, workspace_key, report)
    return value

def invoke(operator, task):
    workspace = operator.ws(task["workspace"])
    payload = task["payload"]
    if task["action"] == "climate-forcing.prepare":
        return climate_forcing.prepare(workspace, selection(payload), expected_id=payload.get("expected_id"))
    if task["action"] == "climate-forcing.report":
        return climate_forcing.report(workspace, identifier(payload.get("study_id")))
    raise ValueError("Choose a registered climate-forcing action")

def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return climate_forcing.catalog(workspace)
    if operation == "preview":
        return climate_forcing.preview(workspace, selection(payload))
    study_id = identifier(one(payload, "id"))
    if operation == "study":
        return climate_forcing.get(workspace, study_id)
    if operation == "report":
        report_id = one(payload, "report_id")
        report = climate_forcing.get_report(workspace, study_id, identifier(report_id) if report_id else None)
        return decorate_report(operator, workspace_key, report)
    raise ValueError("Choose a climate-forcing catalogue, study or report")

def updates(workspace):
    return {"studies": climate_forcing.list_studies(workspace)}

def decorate_task(operator, task):
    if task.get("action") == "climate-forcing.report" and task.get("state") == "complete":
        report = task.get("result") or {}
        if report.get("id"):
            task["_downloads"] = downloads(operator, task["workspace"], report)
    return task

def verify_workspace(workspace):
    return climate_forcing.verify_all(workspace)
