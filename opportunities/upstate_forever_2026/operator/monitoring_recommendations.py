"""Sampling priorities in the existing operator queue, Workspace and file transport.

TokenJunkieLabs. Observations, original Monitoring designs and field calendars
remain authoritative. This adapter creates no listener or independent queue.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from model import monitoring_recommendations as recommendations
from model import monitoring_working_copies as working_copies
from model.common import identifier, verify_file
from model.monitoring_common import atomic_json, digest, file_sha256, held, load_json

PREFIX = "monitoring.recommendations."
ACTIONS = {PREFIX + action for action in ("prepare", "design", "export", "working-save", "working-export")}


def _object(value, label):
    if not isinstance(value, dict):
        raise ValueError(label + " must be an object")
    return value


def _payload(task, names):
    value = _object(task.get("payload"), "Sampling request")
    unknown = set(value) - set(names)
    if unknown:
        raise ValueError("Unknown sampling request fields: " + ", ".join(sorted(unknown)))
    return deepcopy(value)


def perform(operator, task):
    action = task.get("action")
    if action not in ACTIONS:
        raise ValueError("Choose a registered sampling-priority action")
    workspace = operator.ws(task["workspace"])
    if action == PREFIX + "prepare":
        values = _payload(task, ("selection", "parent_id", "expected_parent_digest"))
        return recommendations.prepare(
            workspace, operation_id=identifier(task["id"]), **values)
    if action == PREFIX + "design":
        values = _payload(task, ("recommendation_id", "configuration", "title"))
        return recommendations.design(
            workspace, operation_id=identifier(task["id"]), **values)
    if action == PREFIX + "working-save":
        values = _payload(task, ("working_file", "parent_id", "expected_parent_digest"))
        return working_copies.save(
            workspace, operation_id=identifier(task["id"]), **values)
    return _export_task(operator, workspace, task)


def _export_task(operator, workspace, task):
    """Retain the exact selected edition and reuse the completed export on retry."""
    working = task["action"] == PREFIX + "working-export"
    payload = _payload(task, ("working_id", "format") if working else ("recommendation_id",))
    if working:
        payload = {"working_id": identifier(payload.get("working_id")),
                   "format": payload.get("format", "bundle")}
        if payload["format"] not in {"bundle", "workspace"}:
            raise ValueError("Choose a working bundle or original Workspace export")
    else:
        payload = {"recommendation_id": identifier(payload.get("recommendation_id"))}
    task_id = identifier(task["id"])
    root = operator.root / "outputs" / "monitoring-recommendations" / task_id
    request = {
        "workspace": task["workspace"], "project_id": workspace.project["id"],
        "task_id": task_id, "action": task["action"],
        "payload": payload,
    }
    request_sha256 = digest(request)
    intent_path, result_path = root / "selection.json", root / "completed.json"
    with held(root / ".export.lock", blocking=False):
        if intent_path.exists():
            previous = load_json(intent_path)
            if previous != {"request": request, "request_sha256": request_sha256}:
                raise ValueError("Sampling export belongs to a different queued selection")
        else:
            atomic_json(intent_path, {"request": request, "request_sha256": request_sha256},
                        immutable=True)
        if result_path.exists():
            completed = load_json(result_path)
            if completed.get("request_sha256") != request_sha256:
                raise ValueError("Saved sampling export belongs to another selection")
            result = completed["result"]
            _export_path(operator, task["id"], result)
            return result
        if working:
            result = working_copies.export(workspace, export_root=root, **payload)
        else:
            result = recommendations.export_recommendations(
                workspace, recommendation_id=payload["recommendation_id"], export_root=root)
        _export_path(operator, task["id"], result)
        atomic_json(result_path, {"request_sha256": request_sha256, "result": result},
                    immutable=True)
        return result


def _export_path(operator, task_id, result):
    result = _object(result, "Sampling export")
    allowed = (operator.root / "outputs" / "monitoring-recommendations" /
               identifier(task_id)).resolve()
    original = Path(result["path"])
    target = original.resolve(strict=True)
    if original.is_symlink() or not target.is_relative_to(allowed) or not target.is_file():
        raise ValueError("Sampling export must remain in its original task output directory")
    if (target.stat().st_size != result["bytes"]
            or file_sha256(target) != result["sha256"]):
        raise ValueError("The retained sampling export changed")
    return target



def _evidence_downloads(operator, workspace_key, result):
    """Use original file tickets; never save local URLs in scientific identity."""
    public, cache = deepcopy(result), {}
    workspace = operator.ws(workspace_key)
    for row in public.get("targets", []):
        evidence = row.get("model_evidence")
        if evidence is None:
            continue
        source = evidence["source"]
        key = source["collection_id"], source["source_id"]
        if key not in cache:
            links = []
            for item in [source["body"], *source["members"]]:
                name = item.get("view_path", item["filename"])
                target = verify_file(workspace.root, {**item, "path": item["object"]})
                ticket = operator._ticket(workspace_key, target, item,
                                          "Native sampling evidence: " + name)
                links.append({"path": name, "bytes": item["bytes"], "sha256": item["sha256"],
                              "download_url": "/api/file/" + ticket["id"] + "?download=1"})
            cache[key] = links
        evidence["downloads"] = deepcopy(cache[key])
    return public


def read(operator, workspace_key, payload):
    """Read registry query values through the existing authenticated route."""
    payload = _object(payload, "Sampling query")
    values = payload.get("payload", {})
    if isinstance(values, str):
        values = json.loads(values)
    values = _object(values, "Sampling query values")
    action = payload.get("action", "catalog")
    workspace = operator.ws(workspace_key)
    if action == "catalog":
        if values:
            raise ValueError("Sampling catalog takes no selection")
        return {"workspace_key": workspace_key, "project_id": workspace.project["id"],
                **recommendations.catalog(workspace)}
    if action == "compare-designs":
        if set(values) != {"recommendation_id", "left_design_id", "right_design_id"}:
            raise ValueError("Choose one exact recommendation and two saved designs")
        from model import monitoring_sampling_comparison as comparison
        value = comparison.compare(workspace, **values)
        return {"workspace_key": workspace_key, "project_id": workspace.project["id"],
                "comparison": value, "files": comparison.files(value)}
    if action == "working-list":
        if values:
            raise ValueError("Saved working-copy list takes no selection")
        return {"workspace_key": workspace_key, **working_copies.list_saved(workspace)}
    if action == "working-preview":
        if set(values) != {"working_file"}:
            raise ValueError("Working preview needs the complete original file")
        return {"workspace_key": workspace_key, **working_copies.preview(
            workspace, working_file=values["working_file"], workspace_key=workspace_key)}
    if action == "working-get":
        if set(values) != {"working_id"}:
            raise ValueError("Choose one immutable working copy")
        return {"workspace_key": workspace_key, **working_copies.get(
            workspace, identifier(values["working_id"]), workspace_key=workspace_key)}
    if action == "list":
        if values:
            raise ValueError("Saved sampling list takes no selection")
        return {"workspace_key": workspace_key,
                "recommendations": recommendations.list_saved(workspace)["records"]}
    if action == "preview":
        if set(values) != {"selection"}:
            raise ValueError("Sampling preview needs its complete selection")
        return {"workspace_key": workspace_key,
                **_evidence_downloads(operator, workspace_key,
                    recommendations.preview(workspace, selection=values["selection"]))}
    if action == "context":
        if set(values) != {"context_id"}:
            raise ValueError("Choose one complete saved observational context")
        return {"workspace_key": workspace_key,
                **recommendations.context(workspace, identifier(values["context_id"]))}
    if action == "get":
        if set(values) != {"recommendation_id"}:
            raise ValueError("Choose one complete saved sampling edition")
        original = recommendations.inspect(workspace, identifier(values["recommendation_id"]))
        designs = recommendations.designs(workspace, original["id"])
        return {"workspace_key": workspace_key, "project_id": workspace.project["id"],
                **_evidence_downloads(operator, workspace_key, original),
                "recommendation_digest": digest(original),
                "saved_designs": [{**row, "working_digest": digest(row)} for row in designs]}
    raise ValueError("Choose catalog, context, list, preview or get for sampling priorities")


def decorate_task(operator, task):
    if task.get("action") not in ACTIONS or task.get("state") != "complete":
        return task
    public = deepcopy(task)
    result = _object(public.get("result"), "Completed sampling result")
    if task["action"] in {PREFIX + "export", PREFIX + "working-export"}:
        target = _export_path(operator, task["id"], result)
        ticket = operator._ticket(task["workspace"], target, result,
                                  "Sampling priorities and original observations")
        result.pop("path", None)
        result["download_url"] = "/api/file/" + ticket["id"] + "?download=1"
        public["_downloads"] = [ticket]
    elif task["action"] == PREFIX + "working-save":
        public["_sampling_recommendations"] = {
            "view": "monitoring-recommendations", "working_id": result["id"],
            "recommendation_id": result["working_file"]["recommendation_id"],
        }
    else:
        public["_sampling_recommendations"] = {
            "view": "monitoring-recommendations",
            "recommendation_id": result.get("recommendation_id") or result.get("id"),
            "plan_id": result.get("plan_id"),
        }
    return public


def verify_workspace(workspace):
    return {**recommendations.verify_workspace(workspace),
            **working_copies.verify_workspace(workspace)}
