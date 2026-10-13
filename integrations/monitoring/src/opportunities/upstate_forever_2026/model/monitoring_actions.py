"""One monitoring command surface used by the original queued operator and CLI."""
from __future__ import annotations
import inspect
from .monitoring_common import ContractError
from .monitoring_workspace import MonitoringWorkspace

READS = {"list", "get", "frontier.progress", "campaign.get", "campaign.list", "campaign.history", "capabilities", "source.catalog"}
WRITES = {"network.import", "design", "frontier", "campaign.create", "campaign.revise", "campaign.event", "export"}

def invoke(workspace, action, params, *, export_root=None):
    if not isinstance(params, dict): raise ContractError("Monitoring parameters must be a JSON object")
    service = MonitoringWorkspace(workspace, export_root=export_root)
    commands = {
        "network.import": service.import_network, "list": service.list, "get": service.get,
        "design": service.design, "frontier": service.frontier, "frontier.progress": service.frontier_progress,
        "campaign.create": service.create_campaign, "campaign.get": service.campaign,
        "campaign.list": service.campaigns, "campaign.revise": service.revise_campaign,
        "campaign.event": service.field_event, "campaign.history": service.history, "export": service.export,
    }
    if action == "capabilities":
        return {"schema": "eco.monitoring.api/1.2", "commands": sorted(READS | WRITES),
                "native_write_route": "POST /api/actions", "native_read_route": "GET /api/monitoring",
                "action_prefix": "monitoring.", "geometry": "complete retained native vectors projected to WGS84",
                "source_selection": "source edition ID plus named entry ID", "default_coverage": "local",
                "editable_receiving": "original Workspace.backup and model.portable.restore"}
    if action == "source.catalog":
        if params: raise ContractError("Source catalog takes no parameters")
        if not callable(getattr(workspace, "sources", None)): return {"collections": []}
        return {"collections": [{"id": c["id"], "title": c.get("title", c["id"]), "entries": [
            {"id": e["id"], "title": e.get("title", e["id"]), "layer": e.get("layer"),
             "sha256": e["body"]["sha256"], "filename": e["body"]["filename"]}
            for e in c["entries"] if e.get("kind") == "vector"]} for c in workspace.sources()]}
    function = commands.get(action)
    if function is None: raise ContractError(f"Unknown monitoring action: {action}")
    try: inspect.signature(function).bind(**params)
    except TypeError as exc: raise ContractError(str(exc)) from exc
    return function(**params)
