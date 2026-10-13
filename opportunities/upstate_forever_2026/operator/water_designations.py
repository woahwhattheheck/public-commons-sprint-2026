"""Water designation desk bindings for the original operator extension host."""
from __future__ import annotations
from contextlib import contextmanager
from pathlib import Path
from model import water_designations as designation
from model.common import digest

@contextmanager
def _read_access(operator, workspace_key, fault=None):
    ws = operator.ws(workspace_key)
    gate = operator.gates[workspace_key]
    if not gate.acquire(blocking=False):
        if fault is not None:
            raise fault("NATIVE_BUSY", "The current workspace operation is finishing. Retry this selection when it completes.", 409)
        raise ValueError("The current workspace operation is finishing; retry when it completes")
    try:
        yield ws
    finally:
        gate.release()

def _record(operator, workspace_key, record):
    ws = operator.ws(workspace_key)
    value = dict(record)
    directory = ws.root / "water-designations" / record["id"]
    value["_downloads"] = operator._files(workspace_key, value, directory)
    return value

def overview(operator, workspace_key):
    ws = operator.ws(workspace_key)
    return [{"id": item["id"], "title": item["title"], "purpose": item["purpose"],
             "summary": item["summary"], "source": item["source"],
             "delivery_overlay": item["delivery_overlay"], "created_at": item["created_at"]}
            for item in designation.selections(ws)]

def read(operator, workspace_key, operation, payload, fault=None):
    if not isinstance(payload, dict):
        raise ValueError("Provide the named water designation choices")
    with _read_access(operator, workspace_key, fault) as ws:
        if operation == "catalog":
            return {"sources": designation.sources(ws), "selections": overview(operator, workspace_key)}
        if operation == "inspect":
            return designation.inspect(ws, payload, offset=payload.get("offset", 0),
                                       limit=payload.get("limit", 500))
        if operation == "preview":
            return designation.preview(ws, payload["selection"], offset=payload.get("offset", 0),
                                       limit=payload.get("limit", 500))
        if operation == "item":
            return _record(operator, workspace_key, designation.get(ws, payload["id"]))
        if operation == "apply":
            return designation.apply_to_delivery(ws, payload["selection_id"], payload.get("delivery_selection", {}))
        if operation == "export":
            format = payload.get("format", "geojson")
            if format not in {"geojson", "csv"}:
                raise ValueError("Choose a GeoJSON or CSV download")
            choice = payload["selection"]
            name = digest({"workspace": workspace_key, "selection": choice, "format": format})
            destination = operator.root / "outputs" / "water-designations" / (name + "." + format)
            retained = designation.export_features(ws, choice, destination, format=format)
            ticket = operator._ticket(workspace_key, destination, retained, "Selected features")
            return {"download_url": ticket["url"], "filename": ticket["filename"],
                    "bytes": ticket["bytes"], "sha256": ticket["sha256"], "download": ticket}
        raise ValueError("Unknown water designation operation: " + str(operation))

def invoke(operator, workspace_key, action, payload):
    if action != "water-designation.save":
        raise ValueError("Unknown water designation action")
    return designation.save(operator.ws(workspace_key), payload["selection"])

def decorate_task(operator, task):
    if (task.get("action") == "water-designation.save" and task.get("state") == "complete"
            and isinstance(task.get("result"), dict)):
        result = _record(operator, task["workspace"], task["result"])
        task["result"] = result
        task["_downloads"] = result["_downloads"]
    return task
