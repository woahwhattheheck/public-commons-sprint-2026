"""Bind retained source-profile comparisons to the existing operator queue."""
from __future__ import annotations

from pathlib import Path
from model.common import identifier, read_json, verify_file
from model.profile_comparison import ProfileComparisons

ACTIONS = frozenset({"profile_comparison.create", "profile_comparison.export"})
POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-same-origin allow-downloads; base-uri 'none'; form-action 'none'"


class ProfileComparisonService:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _manager(self, workspace_key):
        return ProfileComparisons(self.operator.ws(workspace_key))

    def overview(self, workspace_key):
        return self._manager(workspace_key).list()

    def _release(self, manager, key):
        root = manager.workspace.root / "profile-comparison-reports" / identifier(key)
        path = root / "release.json"
        if not path.is_file():
            return root, None
        release = read_json(path)
        if release.get("id") != key or release.get("comparison_id") != key:
            raise self.Fault("PROFILE_REPORT_ID", "The retained report belongs to a different source comparison.", 409)
        return root, release

    def item(self, workspace_key, key):
        manager = self._manager(workspace_key)
        value = manager.inspect(identifier(key))
        root, release = self._release(manager, value["id"])
        value = {**value, "_downloads": []}
        if release:
            for name, record in release["files"].items():
                path = (root / record["path"]).resolve()
                path.relative_to(root.resolve())
                value["_downloads"].append(self.operator._ticket(workspace_key, path, record, name))
            value["_report_url"] = "/api/file/profile-comparison/" + workspace_key + "/" + value["id"] + "/index.html"
            value["_export"] = release
        return value

    def read(self, workspace_key, operation, payload):
        manager = self._manager(workspace_key)
        if operation == "catalog":
            return manager.catalog()
        if operation == "preview":
            return manager.preview(payload["selection"])
        if operation == "inspect":
            return self.item(workspace_key, payload.get("comparison_id") or payload.get("id"))
        if operation == "study":
            return {**manager.study_selection(payload.get("comparison_id") or payload.get("id"),
                                               payload.get("candidate_profile_ids")),
                    "workspace_key": workspace_key}
        raise self.Fault("PROFILE_COMPARISON_ROUTE", "Choose a registered source-profile operation.", 404)

    def invoke(self, task):
        manager = self._manager(task["workspace"])
        if task["action"] == "profile_comparison.create":
            record = manager.create(task["payload"]["selection"])
            release = manager.export(record["id"])
            return {"id": record["id"], "title": record["title"], "state": "complete",
                    "profile_count": len(record["profiles"]), "release": release}
        if task["action"] == "profile_comparison.export":
            key = identifier(task["payload"]["comparison_id"])
            return {"id": key, "state": "complete", "release": manager.export(key)}
        raise self.Fault("PROFILE_COMPARISON_ACTION", "Choose a registered source-profile action.", 404)

    def member(self, workspace_key, comparison_id, member_path):
        manager = self._manager(workspace_key)
        manager.inspect(identifier(comparison_id))
        root, release = self._release(manager, comparison_id)
        if not release or member_path not in release["files"]:
            raise self.Fault("PROFILE_COMPARISON_FILE", "Choose a retained source-profile report file.", 404)
        record = release["files"][member_path]
        path = verify_file(root, record)
        ticket = self.operator._ticket(workspace_key, path, record, path.name)
        return ticket, POLICY if path.suffix == ".html" else None

    def decorate_task(self, task):
        if task.get("action") in ACTIONS and task.get("state") == "complete":
            key = task.get("result", {}).get("id")
            if key:
                value = self.item(task["workspace"], key)
                task["_downloads"] = value["_downloads"]
                if value.get("_report_url"):
                    task["_report_url"] = value["_report_url"]
                task["_profile_comparison_id"] = key
        return task


def verify_workspace(workspace):
    manager = ProfileComparisons(workspace)
    count = 0
    for row in manager.list():
        value = manager.inspect(row["id"])
        if value["workspace_id"] != workspace.project["id"]:
            raise ValueError("The retained source comparison identifies a different workspace.")
        for profile in value["profiles"]:
            original = workspace._get("profiles", identifier(profile["id"]))
            if original["table_summary"]["sha256"] != profile["table"]["sha256"]:
                raise ValueError("The retained source comparison identifies a different original table.")
        if value["selection"]["grid_id"]:
            workspace.get_grid(value["selection"]["grid_id"])
        count += 1
    return {"profile_comparisons": count}
