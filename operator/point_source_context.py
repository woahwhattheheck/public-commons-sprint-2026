"""Registered operations for original retained point-source observation context."""
from source import retained_point_sources as native

ACTIONS = {"observations.point_sources.bind"}


def invoke(operator, task):
    if task["action"] not in ACTIONS:
        raise ValueError("Unknown point-source context operation")
    payload = task["payload"]
    result = native.bind(operator.ws(task["workspace"]), payload["selection"],
                         expected_signature=payload["source_signature"])
    return {"binding_id": result["id"], "observations": result["observations"],
            "source_signature": result["source_signature"], "calendar_year": result["calendar_year"]}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return native.catalog(workspace)
    if operation == "preview":
        return native.preview(workspace, payload["selection"])
    if operation == "binding":
        key = payload.get("binding_id") or payload.get("id")
        if isinstance(key, list):
            if len(key) != 1:
                raise ValueError("Select one retained point-source binding")
            key = key[0]
        if not isinstance(key, str) or not key:
            raise ValueError("Select one retained point-source binding")
        return workspace._get("point-source-bindings", key)
    raise ValueError("Unknown point-source context view")


def state(operator, workspace_key):
    return {"bindings": native.summaries(operator.ws(workspace_key))}


def verify_workspace(workspace):
    return native.verify_workspace(workspace)
