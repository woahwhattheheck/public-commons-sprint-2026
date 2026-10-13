"""Original queued Operator binding for retained Web Map source admission."""
from __future__ import annotations

import copy
from pathlib import Path

from model import webmap_sources
from model.common import relative_file


class WebmapSources:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault

    def _invoke_read(self, workspace_key, payload):
        workspace = self.operator.ws(workspace_key)
        result = webmap_sources.catalog(workspace, payload)
        tasks = self.operator.task_list(workspace_key)
        by_admission = {}
        for task in reversed(tasks):
            if (task.get("action") == "webmap.source.admit" and
                    task.get("state") == "complete" and isinstance(task.get("result"), dict)):
                admission_id = task["result"].get("admission_id")
                if admission_id:
                    by_admission[admission_id] = task["id"]
        result["admissions"] = [
            self._decorate_result(workspace_key, row, by_admission.get(row["admission_id"]))
            for row in result.get("admissions", [])]
        return result

    def read(self, workspace_key, operation, payload):
        if operation != "catalog":
            raise self.fault("WEBMAP_OPERATION", "Unknown published map operation.", 404)
        if not isinstance(payload, dict):
            raise self.fault("WEBMAP_SELECTION", "Provide the original source selection.")
        try:
            # Immutable source records and native read/ticket services remain
            # available while a long queued scientific run holds the write gate.
            return self._invoke_read(workspace_key, payload)
        except (ValueError, KeyError, TypeError, OSError) as error:
            raise self.fault("WEBMAP_SOURCE", str(error)) from error

    def _decorate_result(self, workspace_key, result, task_id=None):
        result = copy.deepcopy(result)
        workspace = self.operator.ws(workspace_key)
        collection = workspace._get("sources", result["source_collection_id"])
        downloads, seen = [], set()
        for entry in collection.get("entries", []):
            descriptors = [("original", entry.get("body"))]
            descriptors.extend(("companion", row) for row in entry.get("companions", []))
            for role, descriptor in descriptors:
                if not isinstance(descriptor, dict) or not descriptor.get("object"):
                    continue
                # Tickets stream the retained original CAS bytes.  The public label
                # keeps the original filename; no all-source view materialization.
                path = relative_file(workspace.root, descriptor["object"])
                ticket = self.operator._ticket(
                    workspace_key, path, descriptor,
                    label=(entry.get("title") or entry["id"]) + " / " + descriptor["filename"])
                if ticket["id"] in seen:
                    continue
                seen.add(ticket["id"])
                downloads.append({**ticket, "source_id": entry["id"], "role": role,
                                  "format": Path(descriptor["filename"]).suffix.lower().lstrip("."),
                                  "source_collection_id": collection["id"]})
        result["files"] = downloads
        if task_id:
            result["task_id"] = task_id
        return result

    def invoke(self, task):
        if task.get("action") != "webmap.source.admit":
            raise self.fault("WEBMAP_ACTION", "Unknown published map action.", 404)
        key = task["workspace"]
        try:
            # Registry invocation is inside Operator._perform's workspace gate.
            result = webmap_sources.admit(self.operator.ws(key), task.get("payload") or {})
            return self._decorate_result(key, result, task["id"])
        except (ValueError, KeyError, TypeError, OSError) as error:
            raise self.fault("WEBMAP_ADMISSION", str(error)) from error

    def decorate_task(self, task):
        if task.get("action") != "webmap.source.admit" or task.get("state") != "complete":
            return task
        if not isinstance(task.get("result"), dict):
            return task
        result = self._decorate_result(task["workspace"], task["result"], task["id"])
        task = {**task, "result": result}
        existing = list(task.get("_downloads") or [])
        known = {row["id"] for row in existing}
        existing.extend(row for row in result["files"] if row["id"] not in known)
        task["_downloads"] = existing
        return task
