"""Monitoring adapter over the original Operator queue, workspace and file tickets.

Loaded as a sibling of server.py; no second HTTP listener or execution queue.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
from model.monitoring_actions import invoke, READS, WRITES
from model.monitoring_common import file_sha256

ACTIONS = {"monitoring." + action for action in WRITES}


def perform(operator, task):
    action = task["action"]
    if action not in ACTIONS: raise ValueError("Select a registered monitoring write")
    workspace = operator.ws(task["workspace"])
    return invoke(workspace, action.removeprefix("monitoring."), task["payload"],
                  export_root=operator.root / "outputs" / "monitoring")


def read(operator, workspace_key, action, payload):
    if action not in READS: raise ValueError("Select a registered monitoring read")
    return invoke(operator.ws(workspace_key), action, payload)


def decorate_task(operator, task):
    if task.get("action") != "monitoring.export" or task.get("state") != "complete": return task
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
    if not (workspace.root / COLLECTIONS["networks"]).is_dir():
        return {"networks": 0, "campaigns": 0}
    service = MonitoringWorkspace(workspace)
    counts = {}
    for kind, folder in COLLECTIONS.items():
        paths = sorted((workspace.root / folder).glob("*.json"))
        for path in paths:
            record = service.get(kind, path.stem)
            if kind == "networks": service.verify_sources(record)
        counts[kind] = len(paths)
    campaigns = service.campaigns()
    for summary in campaigns:
        current = service.campaign(summary["campaign_id"])
        service.history(summary["campaign_id"])
        for record in current["events"]:
            service.get("plans", record["plan_id"])
            service.get("networks", record["network_id"])
    return {**counts, "campaigns": len(campaigns)}
