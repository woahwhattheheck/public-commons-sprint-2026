"""Restoration extent studies in the original authenticated operator and task queue.

TokenJunkieLabs. Scientific preparation/accounting remains in the original model.
"""
from __future__ import annotations
import copy
from pathlib import Path
from model.common import identifier, read_json, relative_file, file_digest, atomic_bytes, describe_file, verify_file
import restoration_extent_reports as readable
from model import restoration_extent_studies as studies

ACTIONS = {"restoration-extent.prepare", "restoration-extent.report"}


def invoke(operator, task):
    workspace = operator.ws(task["workspace"])
    payload = task["payload"]
    if task["action"] == "restoration-extent.prepare":
        if set(payload) != {"spec"} or not isinstance(payload["spec"], dict):
            raise ValueError("Supply the complete explicit restoration extent definition.")
        return studies.prepare_study(workspace, payload["spec"])
    if task["action"] == "restoration-extent.report":
        if set(payload) != {"study_id"}:
            raise ValueError("Select one retained restoration extent study.")
        report = studies.build_report(workspace, identifier(payload["study_id"]))
        study = studies.inspect_study(workspace, report["study_id"])["record"]
        path = _readable_path(workspace, report)
        body = readable.html_document(study, report).encode("utf-8")
        atomic_bytes(path, body, immutable=True)
        return report
    raise ValueError("Choose a registered original restoration extent action.")


def catalog(operator, workspace_key):
    workspace = operator.ws(workspace_key)
    profiles = {row["id"]: row.get("title", row["id"]) for row in workspace._list("profiles")}
    scenarios = {row["id"]: row.get("title", row["id"]) for row in workspace._list("scenarios")}
    runs = []
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        row = read_json(path)
        runs.append({"id": row["id"], "state": row["state"],
                     "selection": copy.deepcopy(row["selection"]),
                     "profile_title": profiles.get(row["selection"]["profile_id"]),
                     "scenario_title": scenarios.get(row["selection"]["scenario_id"])})
    sources = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry["kind"] == "vector":
                sources.append({"source_collection_id": collection["id"],
                    "collection_title": collection.get("title"), "source_id": entry["id"],
                    "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
                    "body": copy.deepcopy(entry["body"]),
                    "metadata": copy.deepcopy({k: v for k, v in entry.items()
                        if k not in {"body", "companions"}})})
    return {"schema": "upstate.restoration-extent-catalog/v1",
            "workspace_key": workspace_key, "project": workspace.project,
            "runs": runs, "vector_sources": sources,
            "studies": studies.list_studies(workspace),
            "selection_note": "Vector candidates retain their actual source identity. Preparation validates that the selected layer and features are line geometry."}


def source_fields(operator, workspace_key, payload):
    workspace = operator.ws(workspace_key)
    collection = identifier(payload.get("source_collection_id"))
    source_id = payload.get("source_id")
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("Select an exact retained stream source.")
    original = operator.source_info(workspace_key, collection, source_id, payload.get("layer") or None)
    entry = original["source"]
    if entry["kind"] != "vector":
        raise ValueError("Select the original retained vector source.")
    return {"workspace_key": workspace_key, "project_id": workspace.project["id"],
            "source_collection_id": collection, "source_id": source_id,
            "source_sha256": entry["body"]["sha256"], "layers": original["layers"],
            "selected_layer": original["selected_layer"], "fields": original["fields"],
            "geometry_type": original["geometry_type"], "crs": original["crs"],
            "total_features": original["feature_count"],
            "examples": [{"id": row["native_id"],
                "properties": {k: v for k, v in row.items() if k != "native_id"}}
                for row in original["sample"]],
            "note": "Original source preview; first " + str(original["sample_limit"]) +
                    " feature records shown. Preparation applies your filters to the complete retained layer."}


def _readable_path(workspace, report):
    return (workspace.root / "restoration-extent-readable" / report["id"] /
            file_digest(Path(readable.__file__)) / "Restoration_Response.html")


def _tickets(operator, workspace_key, value):
    result = copy.deepcopy(value)
    result["_downloads"] = []
    workspace = operator.ws(workspace_key)
    files = dict(value.get("files", {}))
    readable_path = _readable_path(workspace, value)
    if readable_path.is_file():
        files["readable_report"] = describe_file(workspace.root, readable_path)
    for name, item in files.items():
        path = verify_file(workspace.root, item)
        ticket = operator._ticket(workspace_key, path, item, name.replace("_", " "))
        result["_downloads"].append({**ticket, "artifact_id": name})
    return result


def read(operator, workspace_key, operation, payload):
    if operation == "catalog":
        return catalog(operator, workspace_key)
    if operation == "source-fields":
        return source_fields(operator, workspace_key, payload)
    if operation == "inspect":
        value = studies.inspect_study(operator.ws(workspace_key), identifier(payload.get("id")))
        return {**value, "workspace_key": workspace_key}
    if operation == "report":
        # The read route never computes or changes a scientific result.
        report = studies.read_report(operator.ws(workspace_key), identifier(payload.get("id")))
        return {"workspace_key": workspace_key, "report":
                _tickets(operator, workspace_key, report) if report else None}
    raise ValueError("Choose the retained study catalogue, selection or completed report.")


def decorate_task(operator, task):
    if task.get("action") == "restoration-extent.report" and task.get("state") == "complete":
        task["_downloads"] = _tickets(operator, task["workspace"], task["result"])["_downloads"]
    return task


def verify_workspace(workspace):
    records = studies.list_studies(workspace)
    for row in records:
        studies.inspect_study(workspace, row["id"])
    return {"restoration_extent_studies": len(records)}
