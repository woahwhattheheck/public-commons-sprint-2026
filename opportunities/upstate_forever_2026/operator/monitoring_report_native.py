"""Retained Monitoring report sources in the original operator queue and file transport."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import json

from model import monitoring_report_source
from model.common import identifier, verify_file

ACTION = "monitoring.report.prepare"


def _files(operator, workspace_key, record):
    workspace = operator.ws(workspace_key)
    return [
        operator._ticket(workspace_key, verify_file(workspace.root, item),
                         item, item.get("label") or Path(item["path"]).name)
        for item in record.get("files", [])
    ]


def perform(operator, task):
    if task.get("action") != ACTION:
        raise ValueError("Choose the registered monitoring report preparation")
    selection = task.get("payload")
    if not isinstance(selection, dict):
        raise ValueError("Choose an original saved monitoring design or campaign revision")
    return monitoring_report_source.prepare(operator.ws(task["workspace"]), selection)


def read(operator, workspace_key, payload):
    """Read the shared registry query context without creating another route host."""
    if not isinstance(payload, dict):
        raise ValueError("Monitoring report query must be an object")
    values = payload.get("payload", payload)
    if isinstance(values, str):
        values = json.loads(values)
    if not isinstance(values, dict):
        raise ValueError("Monitoring report query values must be an object")
    action = payload.get("action", values.get("action", "catalog"))
    workspace = operator.ws(workspace_key)
    if action == "catalog":
        return {"workspace_key": workspace_key,
                "reports": monitoring_report_source.catalog(workspace)}
    if action == "get":
        record = deepcopy(monitoring_report_source.inspect(
            workspace, identifier(values.get("id")), verify=True))
        record["workspace_key"] = workspace_key
        record["delivery_selection"] = monitoring_report_source.delivery_selection(
            workspace, record["source"], values.get("delivery_id") or None)
        record["_downloads"] = _files(operator, workspace_key, record)
        return record
    raise ValueError("Choose a saved monitoring report catalog or source")


def decorate_task(operator, task):
    if task.get("action") != ACTION or task.get("state") != "complete":
        return task
    public = deepcopy(task)
    result = public.get("result") or {}
    public.setdefault("_downloads", []).extend(_files(operator, task["workspace"], result))
    public["_monitoring_report"] = {
        "id": result.get("id"), "title": result.get("title"),
        "view": "monitoring", "source": result.get("source"),
    }
    return public


def verify_workspace(workspace):
    records = monitoring_report_source.catalog(workspace)
    for record in records:
        monitoring_report_source.inspect(workspace, record["id"], verify=True)
    return {"monitoring_report_sources": len(records)}
