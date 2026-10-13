"""Profile editions on the maintained operator's actions and download transport."""
from __future__ import annotations
from copy import deepcopy
import json

from model import profile_editions as model
from model.common import describe_file, verify_file

ACTIONS = frozenset({"profile.edition.save", "profile.edition.review"})
READS = frozenset({"catalog", "inspect", "table", "preview", "compare", "methods"})


class ProfileWorkbench:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        value = payload or {}
        if not isinstance(value, dict):
            raise self.Fault("PROFILE_REQUEST", "Use a profile selection object.")
        if operation == "catalog":
            result = model.catalog(ws)
        elif operation == "methods":
            result = model.methods()
        elif operation == "inspect":
            result = model.inspect(ws, value.get("profile_id"))
            profile_path = ws.root / "profiles" / (result["profile_id"] + ".json")
            table_path, entry = ws.source_file(result["profile"]["source_collection_id"],
                                               result["profile"]["biophysical_source_id"])
            result["_downloads"] = [
                self.operator._ticket(workspace_key, profile_path,
                                      describe_file(ws.root, profile_path), "Native parameter profile"),
                self.operator._ticket(workspace_key, table_path, entry["body"], "Original coefficient CSV")]
        elif operation == "table":
            active = value.get("models")
            if isinstance(active, str):
                active = json.loads(active) if active.startswith("[") else [part.strip() for part in active.split(",")]
            result = model.read_table(ws, value.get("source_collection_id"),
                                      value.get("biophysical_source_id") or value.get("source_id"),
                                      selected_models=active)
        elif operation == "preview":
            result = model.preview(ws, value)
        elif operation == "compare":
            result = model.compare(ws, value.get("left_profile_id"), value.get("right_profile_id"))
        else:
            raise self.Fault("PROFILE_READ", "Choose a supported profile workbench view.", 404)
        return {"workspace_key": workspace_key, **result}

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        action = task["action"]
        if action == "profile.edition.save":
            return model.save(ws, task["payload"], operation_id=task["id"])
        if action == "profile.edition.review":
            return model.review(ws, task["payload"], operation_id=task["id"])
        raise self.Fault("PROFILE_ACTION", "Choose a supported profile operation.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        value = deepcopy(task)
        result = value["result"]
        ws = self.operator.ws(value["workspace"])
        files = dict(result.get("files") or {})
        if task["action"] == "profile.edition.review" and result.get("review_id"):
            path = ws.root / "profile-reviews" / (result["review_id"] + ".json")
            files["review"] = describe_file(ws.root, path, media_type="application/json")
        downloads = list(value.get("_downloads") or [])
        existing = {row.get("id") for row in downloads}
        for label, record in files.items():
            path = verify_file(ws.root, record)
            ticket = self.operator._ticket(value["workspace"], path, record,
                                            "Profile " + label.replace("_", " "))
            if ticket["id"] not in existing:
                downloads.append(ticket)
                existing.add(ticket["id"])
        value["_downloads"] = downloads
        return value

    def verify_all(self, workspace):
        return model.verify_all(workspace)
