"""Climate-forcing desk for the existing operator and native task queue."""
from __future__ import annotations
from copy import deepcopy
from model import climate_forcing, climate_working
from model.common import identifier, relative_file, describe_file

ACTIONS = {"climate-forcing.prepare", "climate-forcing.report",
           "climate-forcing.working.save", "climate-forcing.working.export"}

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
    if task["action"] == "climate-forcing.working.save":
        return {**climate_working.save(workspace, payload), "workspace_key": task["workspace"]}
    if task["action"] == "climate-forcing.working.export":
        return climate_working.export_files(workspace, identifier(payload.get("revision_id")))
    if task["action"] == "climate-forcing.prepare":
        return climate_forcing.prepare(workspace, selection(payload), expected_id=payload.get("expected_id"))
    if task["action"] == "climate-forcing.report":
        return climate_forcing.report(workspace, identifier(payload.get("study_id")))
    raise ValueError("Choose a registered climate-forcing action")

def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return {**climate_forcing.catalog(workspace), "working_designs": climate_working.list_series(workspace)}
    if operation == "working-list":
        return {"workspace_key": workspace_key, "items": climate_working.list_series(workspace)}
    if operation == "working-view":
        return {**climate_working.inspect(workspace, identifier(one(payload, "id"))), "workspace_key": workspace_key}
    if operation == "preview":
        return climate_forcing.preview(workspace, selection(payload))
    study_id = identifier(one(payload, "id"))
    if operation == "study":
        return climate_forcing.get(workspace, study_id)
    if operation == "run-request":
        return climate_forcing.run_request(workspace, study_id, one(payload, "case_id"))
    if operation == "report":
        report_id = one(payload, "report_id")
        report = climate_forcing.get_report(workspace, study_id, identifier(report_id) if report_id else None)
        return decorate_report(operator, workspace_key, report)
    raise ValueError("Choose a climate-forcing catalogue, study, case request or report")

def updates(workspace):
    return {"studies": climate_forcing.list_studies(workspace),
            "working_designs": climate_working.list_series(workspace)}

def decorate_task(operator, task):
    if task.get("action") == "climate-forcing.report" and task.get("state") == "complete":
        report = task.get("result") or {}
        if report.get("id"):
            task["_downloads"] = downloads(operator, task["workspace"], report)
    if task.get("action") == "climate-forcing.working.export" and task.get("state") == "complete":
        workspace_key = task["workspace"]
        workspace = operator.ws(workspace_key)
        result = task.get("result") or {}
        original = climate_working.export_files(workspace, identifier(result.get("revision_id")))
        if original != result:
            raise ValueError("The retained working export differs from its original history")
        task["_downloads"] = [operator._ticket(workspace_key, relative_file(workspace.root, item["path"]), item, name)
                              for name, item in original["files"].items()]
    return task

def verify_workspace(workspace):
    return {"forcing": climate_forcing.verify_all(workspace),
            "working_designs": climate_working.verify_all(workspace)}
