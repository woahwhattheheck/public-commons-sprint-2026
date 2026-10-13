"""Community revision handovers in the original Operator queue and file transport."""
from __future__ import annotations

from model import community_revisions as revisions

ACTION = "community.plan.compare"
ITEM_KIND = "community_plan_comparisons"


class CommunityRevisions:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _workspace(self, key):
        return self.operator.ws(key)

    def catalog(self, workspace_key):
        return revisions.catalog(self._workspace(workspace_key))

    def _decorate(self, workspace_key, record):
        result = dict(record)
        result["workspace_key"] = workspace_key
        result["_downloads"] = self.operator._files(
            workspace_key, record, self._workspace(workspace_key).root)
        return result

    def read(self, workspace_key, operation, payload=None):
        value = payload or {}
        if not isinstance(value, dict):
            raise self.Fault("COMMUNITY_REVISION_INPUT", "Select original Community plan revisions.")
        workspace = self._workspace(workspace_key)
        try:
            if operation == "catalog":
                return {"workspace_key": workspace_key, "comparisons": revisions.catalog(workspace)}
            if operation == "preview":
                return {"workspace_key": workspace_key, "comparison": revisions.compare(workspace, value)}
            if operation == "inspect":
                return self._decorate(workspace_key, revisions.inspect(workspace, value.get("id")))
            raise self.Fault("COMMUNITY_REVISION_READ", "Choose an existing revision comparison.", 404)
        except (ValueError, TypeError, KeyError, OSError) as error:
            raise self.Fault("COMMUNITY_REVISION_INPUT", str(error)) from error

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("COMMUNITY_REVISION_ACTION", "Choose the original plan comparison action.")
        try:
            return revisions.build(self._workspace(task["workspace"]), task["payload"])
        except (ValueError, TypeError, KeyError, OSError) as error:
            raise self.Fault("COMMUNITY_REVISION_INPUT", str(error)) from error

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        record = self.read(task["workspace"], "inspect", {"id": task["result"]["id"]})
        task["_downloads"] = record["_downloads"]
        task["_item"] = {"kind": ITEM_KIND, "id": record["id"]}
        return task

    def verify_workspace(self, workspace):
        rows = revisions.catalog(workspace)
        for row in rows:
            revisions.inspect(workspace, row["id"])
        return {"community_plan_comparisons": len(rows)}
