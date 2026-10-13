"""Community revision handovers in the original Operator queue and file transport."""
from __future__ import annotations

import zipfile

from model import community_revisions as revisions
from model import community_revision_receiving as receiving

ACTION = "community.plan.compare"
RECEIVE_ACTION = "community.revision.receive"
ITEM_KIND = "community_plan_comparisons"
RECEIVED_KIND = "community_received_revisions"
ERRORS = (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile)


class CommunityRevisions:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _workspace(self, key):
        return self.operator.ws(key)

    def _limit(self):
        return self.operator.extraction_limit

    def catalog(self, workspace_key):
        workspace = self._workspace(workspace_key)
        return revisions.catalog(workspace) + receiving.catalog(workspace)

    def _decorate(self, workspace_key, record):
        result = dict(record)
        result["workspace_key"] = workspace_key
        result["received"] = record.get("schema") == receiving.SCHEMA
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
                return {"workspace_key": workspace_key, "comparisons": self.catalog(workspace_key)}
            if operation == "preview":
                return {"workspace_key": workspace_key, "comparison": revisions.compare(workspace, value)}
            if operation == "inspect":
                return self._decorate(workspace_key, revisions.inspect(workspace, value.get("id")))
            if operation == "received":
                return self._decorate(workspace_key, receiving.inspect(
                    workspace, value.get("id"), maximum_bytes=self._limit()))
            if operation == "receive-preview":
                uploaded = self.operator.upload(value.get("upload_id"))
                return {"workspace_key": workspace_key, **receiving.preview(
                    uploaded["path"], maximum_bytes=self._limit())}
            raise self.Fault("COMMUNITY_REVISION_READ", "Choose an existing revision comparison.", 404)
        except ERRORS as error:
            raise self.Fault("COMMUNITY_REVISION_INPUT", str(error)) from error

    def invoke(self, task):
        try:
            workspace = self._workspace(task["workspace"])
            if task.get("action") == ACTION:
                return revisions.build(workspace, task["payload"])
            if task.get("action") == RECEIVE_ACTION:
                value = task["payload"]
                if set(value) != {"upload_id", "archive_sha256"}:
                    raise ValueError("Receive the reviewed original upload and its exact archive SHA256")
                uploaded = self.operator.upload(value["upload_id"])
                if uploaded["sha256"] != value["archive_sha256"]:
                    raise ValueError("The original upload differs from the reviewed Community handover")
                return receiving.receive(workspace, uploaded["path"],
                    expected_sha256=value["archive_sha256"], maximum_bytes=self._limit())
            raise self.Fault("COMMUNITY_REVISION_ACTION", "Choose an original Community handover action.")
        except ERRORS as error:
            raise self.Fault("COMMUNITY_REVISION_INPUT", str(error)) from error

    def decorate_task(self, task):
        action = task.get("action")
        if action not in (ACTION, RECEIVE_ACTION) or task.get("state") != "complete":
            return task
        received = action == RECEIVE_ACTION
        record = self.read(task["workspace"], "received" if received else "inspect",
                           {"id": task["result"]["id"]})
        task["_downloads"] = record["_downloads"]
        task["_item"] = {"kind": RECEIVED_KIND if received else ITEM_KIND, "id": record["id"]}
        return task

    def verify_workspace(self, workspace):
        rows = revisions.catalog(workspace)
        for row in rows:
            revisions.inspect(workspace, row["id"])
        incoming = receiving.catalog(workspace)
        for row in incoming:
            receiving.inspect(workspace, row["id"], maximum_bytes=self._limit())
        return {"community_plan_comparisons": len(rows),
                "community_received_revisions": len(incoming)}
