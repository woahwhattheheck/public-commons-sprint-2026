"""Rehearsal controls on the maintained operator's task and file stores.

Copyright 2026 TokenJunkieLabs. No additional worker, workspace or model engine.
"""
from __future__ import annotations
from copy import deepcopy

from model.common import identifier, relative_file
from model.rehearsal import Conflict, Rehearsal, _task_snapshot

ACTIONS = frozenset({
    "rehearsal.save", "rehearsal.begin", "rehearsal.record", "rehearsal.export",
})
READS = frozenset({"overview", "record"})


class Rehearsals:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def _workspace(self, key):
        try:
            return self.operator.ws(key)
        except self.fault as error:
            if error.code == "WORKSPACE_MISSING":
                raise ValueError("The original task workspace is unavailable on this operator; its saved teaching evidence is retained.") from error
            raise

    def _model(self, workspace):
        return Rehearsal(
            self.operator.ws(workspace),
            task_reader=self.operator.task,
            upload_reader=self.operator.upload,
            workspace_reader=self._workspace,
        )

    @staticmethod
    def _revision(value):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            if not value.isascii() or not value.isdecimal():
                raise ValueError("Choose a saved positive rehearsal revision")
            value = int(value)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError("Choose a saved positive rehearsal revision")
        return value

    def _available(self, workspace):
        ws = self.operator.ws(workspace)
        data = ws.overview()
        fields = {
            "sources": ("id", "title", "created_at", "schema"),
            "profiles": ("id", "title", "source_collection_id"),
            "grids": ("id", "state", "spec", "created_at", "completed_at"),
            "scenarios": ("id", "title", "kind", "source_collection_id"),
            "runs": ("id", "state", "selection", "created_at", "started_at", "completed_at"),
            "comparisons": ("id", "baseline_run_id", "direction"),
            "deliveries": ("id", "state", "selection", "created_at", "completed_at"),
            "spatial_reviews": ("id", "title", "created_at"),
        }
        available = {}
        for kind, names in fields.items():
            rows = []
            for original in data.get(kind, []):
                row = {name: deepcopy(original[name]) for name in names if name in original}
                if kind == "sources":
                    row["entries"] = len(original.get("entries", []))
                if kind == "comparisons":
                    row["alternatives"] = [
                        {name: deepcopy(item[name]) for name in ("run_id", "selection", "profile_changed") if name in item}
                        for item in original.get("alternatives", [])
                    ]
                rows.append(row)
            available[kind] = rows
        project_keys = {
            key for key, item in self.operator.registry.items()
            if item.get("project_id") == ws.project["id"]
        }
        available["tasks"] = []
        for task in self.operator.task_list():
            if task.get("workspace") not in project_keys:
                continue
            item = _task_snapshot(task)
            # The chooser uses the original action selection, not a reconstructed request.
            item["payload"] = deepcopy(task["payload"])
            available["tasks"].append(item)
        return available

    def _media_tickets(self, workspace, record):
        ws = self.operator.ws(workspace)
        output = {}
        for step in record.get("steps", []):
            for attempt in step.get("attempts", []):
                for member in attempt.get("files", []):
                    path = relative_file(ws.root, member["path"])
                    ticket = self.operator._ticket(
                        workspace, path, member, member["filename"])
                    output.setdefault(ticket["id"], ticket)
        return list(output.values())

    def read(self, workspace, operation, values=None):
        if operation not in READS:
            raise self.fault("REHEARSAL_READ", "Choose a maintained rehearsal read.")
        values = values or {}
        work = self._model(workspace)
        if operation == "overview":
            return {**work.overview(), "available": self._available(workspace)}
        key = identifier(values.get("id"))
        result = work.inspect(key, self._revision(values.get("revision")))
        return {**result, "_downloads": self._media_tickets(workspace, result["record"])}

    def invoke(self, task):
        action = task["action"]
        if action not in ACTIONS:
            raise self.fault("REHEARSAL_ACTION", "Choose a maintained rehearsal action.")
        payload = task["payload"]
        work = self._model(task["workspace"])
        try:
            if action == "rehearsal.export":
                return work.export(identifier(payload.get("id")), self._revision(payload.get("revision")))
            return work.apply(action.removeprefix("rehearsal."), payload, task["id"])
        except Conflict as error:
            raise self.fault(error.code, str(error), error.status) from error

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = deepcopy(task)
        body = task["result"]
        if task["action"] == "rehearsal.export":
            ws = self.operator.ws(task["workspace"])
            result["_downloads"] = [
                self.operator._ticket(
                    task["workspace"], relative_file(ws.root, member["path"]), member,
                    {"packet": "Complete operator walkthrough and media",
                     "WALKTHROUGH.md": "Editable walkthrough",
                     "walkthrough.html": "Printable operator walkthrough",
                     "rehearsal.json": "Exact saved rehearsal",
                     "history.json": "Complete retained teaching history",
                     "manifest": "Complete packet inventory"}.get(name, name),
                )
                for name, member in body["files"].items()
            ]
        else:
            result["_downloads"] = self._media_tickets(task["workspace"], body)
        return result
