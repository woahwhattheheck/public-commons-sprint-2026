"""Read-only registered Receiving source-impact API; uses the original host."""
from __future__ import annotations

import json
from model import receiving_source_impact


def read(operator, workspace_key, payload):
    if not isinstance(payload, dict):
        raise ValueError("Receiving source-impact query must be an object")
    values = payload.get("payload", payload)
    if isinstance(values, str):
        values = json.loads(values)
    if not isinstance(values, dict):
        raise ValueError("Receiving source-impact values must be an object")
    action = payload.get("action", values.get("action", "catalog"))
    workspace = operator.ws(workspace_key)
    if action == "catalog":
        result = receiving_source_impact.catalog(
            workspace, offset=values.get("offset"), limit=values.get("limit"))
    elif action == "page":
        result = receiving_source_impact.page(
            workspace, values.get("refresh_plan_id"), kind=values.get("kind", "plans"),
            offset=values.get("offset"), limit=values.get("limit"),
            snapshot=values.get("snapshot"), index_snapshot=values.get("index_snapshot"))
    elif action in ("detail", "download"):
        result = receiving_source_impact.detail(
            workspace, values.get("refresh_plan_id"), values.get("kind"), values.get("id"),
            snapshot=values.get("snapshot"))
    else:
        raise ValueError("Choose a saved refresh catalog, impact page or study detail")
    if action == "download":
        return {"workspace_key": workspace_key,
                "filename": "receiving-source-impact-" + result["kind"] + "-" + result["record"]["id"][:12] + ".json",
                "content": json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"}
    return {**result, "workspace_key": workspace_key}
