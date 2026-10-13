"""Monitoring adapter over the original Operator queue, workspace and file tickets.

Loaded as a sibling of server.py; no second HTTP listener or execution queue.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
from model.monitoring_actions import invoke, READS, WRITES
from model.monitoring_common import atomic_json, digest, file_sha256, held, load_json
from model.common import identifier
from model.monitoring_workspace import MonitoringWorkspace

ACTIONS = {"monitoring." + action for action in WRITES}


def perform(operator, task):
    action = task["action"]
    if action not in ACTIONS: raise ValueError("Select a registered monitoring write")
    workspace = operator.ws(task["workspace"])
    if action in {"monitoring.export", "monitoring.context.export"}:
        return export_task(operator, workspace, task)
    result = invoke(workspace, action.removeprefix("monitoring."), task["payload"],
                    export_root=operator.root / "outputs" / "monitoring")
    if action in {"monitoring.campaign.fieldwork", "monitoring.campaign.fieldwork.return"}:
        result["workspace_key"] = task["workspace"]
    return result


def export_task(operator, workspace, task):
    """Retain one queued export selection and its completed original file."""
    task_id = identifier(task["id"])
    root = operator.root / "outputs" / "monitoring" / task_id
    request = digest({"workspace": task["workspace"], "project_id": workspace.project["id"],
                      "action": task["action"], "payload": task["payload"]})
    intent_path, result_path = root / "selection.json", root / "completed.json"
    with held(root / ".export.lock", blocking=False):
        if intent_path.exists():
            intent = load_json(intent_path)
            if intent.get("request_sha256") != request or intent.get("task_id") != task_id:
                raise ValueError("Monitoring export belongs to a different queued selection")
        else:
            payload = deepcopy(task["payload"])
            if payload.get("campaign_id") and payload.get("expected_revision_id") is None:
                campaign = MonitoringWorkspace(workspace).campaign(payload["campaign_id"])
                payload["expected_revision_id"] = campaign["revision"]["id"]
            intent = {"schema": "upstate.monitoring-export-operation/v1",
                      "request_sha256": request, "task_id": task_id, "payload": payload}
            atomic_json(intent_path, intent, immutable=True)
        if result_path.exists():
            completed = load_json(result_path)
            if completed.get("request_sha256") != request:
                raise ValueError("Monitoring export result belongs to another original operation")
            result = completed["result"]
            path = Path(result["path"]).resolve(strict=True)
            if (not path.is_relative_to(root.resolve()) or not path.is_file()
                    or path.stat().st_size != result["bytes"]
                    or file_sha256(path) != result["sha256"]):
                raise ValueError("The completed monitoring export changed")
            return result
        result = invoke(workspace, task["action"].removeprefix("monitoring."), intent["payload"], export_root=root)
        atomic_json(result_path, {"request_sha256": request, "result": result}, immutable=True)
        return result


def read(operator, workspace_key, action, payload):
    if action not in READS: raise ValueError("Select a registered monitoring read")
    result = invoke(operator.ws(workspace_key), action, payload)
    if action == "campaign.fieldwork.preview-return":
        result["workspace_key"] = workspace_key
    return result


def decorate_task(operator, task):
    if task.get("action") == "monitoring.campaign.fieldwork.return" and task.get("state") == "complete":
        public = deepcopy(task)
        result = public["result"]
        workspace = operator.ws(task["workspace"])
        report = result["campaign_report"]
        root = workspace.root / "monitoring_field_returns" / identifier(result["request_id"])
        path = root / "campaign-report.html"
        if (path.is_symlink() or not path.resolve().is_relative_to(root.resolve())
                or path.stat().st_size != report["bytes"] or file_sha256(path) != report["sha256"]):
            raise ValueError("The retained returned campaign report changed")
        ticket = operator._ticket(task["workspace"], path, report, "Returned campaign report")
        result["campaign_report"].pop("path", None)
        result["campaign_report"]["download_url"] = "/api/file/" + ticket["id"] + "?download=1"
        public["_downloads"] = [ticket]
        public["_item"] = {"kind": "implementation_plans", "id": result["fieldwork"]["plan_id"]}
        return public
    if task.get("action") == "monitoring.campaign.fieldwork" and task.get("state") == "complete":
        public = deepcopy(task)
        result = public["result"]
        workspace = operator.ws(task["workspace"])
        attachment = result["attachment"]
        path = (workspace.root / attachment["reference"]).resolve(strict=True)
        allowed = (workspace.root / "implementation" / "plans" / result["plan_id"] / "attachments").resolve()
        if (not path.is_relative_to(allowed) or path.stat().st_size != attachment["size_bytes"]
                or file_sha256(path) != attachment["sha256"]):
            raise ValueError("The saved fieldwork source packet changed")
        public["_downloads"] = [operator._ticket(task["workspace"], path,
            {"bytes": attachment["size_bytes"], "sha256": attachment["sha256"]}, attachment["label"])]
        public["_item"] = {"kind": "implementation_plans", "id": result["plan_id"]}
        return public
    if task.get("action") not in {"monitoring.export", "monitoring.context.export"} or task.get("state") != "complete": return task
    result = task.get("result", {})
    target = Path(result["path"]).resolve(strict=True)
    allowed = (operator.root / "outputs" / "monitoring").resolve()
    if not target.is_relative_to(allowed) or not target.is_file():
        raise ValueError("Monitoring output must remain in its original operator output directory")
    if target.stat().st_size != result["bytes"] or file_sha256(target) != result["sha256"]:
        raise ValueError("The retained monitoring export changed")
    ticket = operator._ticket(task["workspace"], target, result, "Monitoring " + result["format"])
    public = deepcopy(task)
    public["result"].pop("path", None)
    public["result"]["download_url"] = "/api/file/" + ticket["id"] + "?download=1"
    public["_downloads"] = [ticket]
    return public


def read_registered(operator, workspace_key, payload):
    """Decode the shared registry's original HTTP query context."""
    import json
    if not isinstance(payload, dict): raise ValueError("Monitoring query must be an object")
    values = payload.get("payload", {})
    if isinstance(values, str): values = json.loads(values)
    return read(operator, workspace_key, payload.get("action"), values)


def verify_workspace(workspace):
    """Verify monitoring records inside the original receiving registration."""
    from model.monitoring_workspace import MonitoringWorkspace, COLLECTIONS
    from model.monitoring_sources import verify_retained_binding
    service = MonitoringWorkspace(workspace)
    counts = {}
    return_cache = {}
    for kind, folder in COLLECTIONS.items():
        paths = sorted((workspace.root / folder).glob("*.json"))
        for path in paths:
            record = service.get(kind, path.stem)
            if kind == "networks":
                for binding in record["source_bindings"].values():
                    if binding:
                        verify_retained_binding(workspace, binding)
            elif kind == "plans":
                service.get("networks", record["network_id"])
            elif kind == "frontiers":
                for plan_id in record["plan_ids"]:
                    if service.get("plans", plan_id)["network_id"] != record["network_id"]:
                        raise ValueError("Monitoring frontier names a different source network")
            elif kind in {"revisions", "events"}:
                if kind == "events" and record.get("values", {}).get("fieldwork_return") is not None:
                    from model.monitoring_field_return import source_binding
                    source_binding(workspace, record, return_cache)
                plan = service.get("plans", record["plan_id"])
                if plan["network_id"] != record["network_id"]:
                    raise ValueError("Monitoring field history names a different source network")
        counts[kind] = len(paths)
    campaigns = service.campaigns()
    for summary in campaigns:
        current = service.campaign(summary["campaign_id"])
        for revision in service.history(summary["campaign_id"]):
            if revision["campaign_id"] != summary["campaign_id"]:
                raise ValueError("Monitoring history crosses independent campaigns")
        for record in current["events"]:
            service.get("plans", record["plan_id"])
            service.get("networks", record["network_id"])
    from model.monitoring_observed_context import verify_workspace as verify_observed
    return {**counts, "campaigns": len(campaigns), **verify_observed(workspace)}
