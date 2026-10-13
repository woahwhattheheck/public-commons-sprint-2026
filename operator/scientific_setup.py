"""Scientific setup source capture through the maintained operator extension host."""
from __future__ import annotations

from pathlib import Path

from model.common import identifier
from model import setup_review

ACTIONS = frozenset({"scientific.setup.create"})


class ScientificSetup:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _guard(self, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (ValueError, KeyError, TypeError) as error:
            raise self.Fault("SCIENTIFIC_SETUP_SELECTION", str(error), 422) from error

    def overview(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        return {"setups": [{"id": row["id"], "title": row["title"],
                            "created_at": row["created_at"], "review_id": row["review_id"],
                            "source_collection_id": row["source_collection_id"]}
                           for row in ws._list(setup_review.KIND)]}

    def _detail(self, workspace_key, setup_id):
        ws = self.operator.ws(workspace_key)
        result = self._guard(setup_review.detail, ws, identifier(setup_id))
        record = result["setup"]
        primary, entry = ws.source_file(record["source_collection_id"], record["source_id"])
        wanted = {
            "specification.json": "Scientific setup specification",
            "index.html": "Readable scientific setup",
            "source-inventory.csv": "Original source inventory",
            "prepared-inputs.csv": "Prepared grid input inventory",
            "scenario-changes.csv": "Baseline and alternative changes",
        }
        downloads = []
        bodies = [entry["body"], *entry.get("companions", [])]
        for item in bodies:
            relative = item.get("view_path") or item["filename"]
            if relative in wanted:
                downloads.append(self.operator._ticket(
                    workspace_key, primary.parent / relative,
                    {"bytes": item["bytes"], "sha256": item["sha256"],
                     "filename": Path(relative).name}, wanted[relative]))
        return {"workspace_key": workspace_key, **result, "_downloads": downloads}

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        payload = payload or {}
        if operation == "catalog":
            return {"workspace_key": workspace_key, **self._guard(setup_review.catalog, ws)}
        if operation == "preview":
            selection = dict(payload)
            transport_workspace = selection.pop("workspace", workspace_key)
            if transport_workspace != workspace_key:
                raise self.Fault("SCIENTIFIC_SETUP_WORKSPACE", "Preview belongs to a different selected Workspace.", 409)
            return {"workspace_key": workspace_key, **self._guard(setup_review.preview, ws, selection)}
        if operation == "detail":
            return self._detail(workspace_key, payload.get("setup_id") or payload.get("id"))
        raise self.Fault("SCIENTIFIC_SETUP_READ", "Choose a scientific setup catalog, preview or retained detail.", 404)

    def invoke(self, task):
        if task["action"] != "scientific.setup.create":
            raise self.Fault("SCIENTIFIC_SETUP_ACTION", "Choose the scientific setup capture action.", 404)
        ws = self.operator.ws(task["workspace"])
        result = self._guard(setup_review.create, ws, task["payload"],
                             operation_id=task["id"], created_at=task["created_at"])
        return {key: result[key] for key in (
            "setup_id", "source_collection_id", "review_id", "specification", "checks")}

    def decorate_task(self, task):
        if task.get("action") != "scientific.setup.create" or task.get("state") != "complete":
            return task
        result = task["result"]
        task["_review"] = {"review_id": result["review_id"]}
        task["_scientific_setup"] = {"view": "scientific-setup", "setup_id": result["setup_id"],
                                      "review_id": result["review_id"]}
        task["_downloads"] = self._detail(task["workspace"], result["setup_id"])["_downloads"]
        return task
