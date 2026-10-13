"""Original-operator desk for selected editable scientific-study transfer.

TokenJunkieLabs. This provider uses the installed extension host, original
serial task queue, workspace registration and authenticated file tickets.
"""
from __future__ import annotations

import copy
from pathlib import Path

from model import study_transfer
from model.common import atomic_json, identifier, now, read_json

ACTION = "study.export"


class StudyTransfer:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _progress_path(self, task_id):
        return Path(self.operator.root) / "study-transfers" / (identifier(task_id) + ".json")

    def _task(self, workspace_key, task_id):
        task = self.operator.task(identifier(task_id))
        if task.get("workspace") != workspace_key or task.get("action") != ACTION:
            raise self.Fault("STUDY_TASK", "Select an export from this scientific workspace.", 404)
        return task

    @staticmethod
    def _integer(value, name, default):
        try:
            result = int(value.get(name, default))
        except (ValueError, TypeError) as error:
            raise ValueError("Use a whole number for " + name + ".") from error
        return result

    def read(self, workspace_key, operation, value=None):
        value = value or {}
        workspace = self.operator.ws(workspace_key)
        if operation in {"received", "received-detail"}:
            import study_receiving
            return study_receiving.read(self.operator, workspace_key, operation, value)
        if operation == "catalog":
            return study_transfer.catalog(
                workspace, kind=value.get("kind"), query=value.get("query", ""),
                offset=self._integer(value, "offset", 0), limit=self._integer(value, "limit", 200))
        if operation == "preview":
            return study_transfer.preview(workspace, value.get("selection", {}))
        if operation == "progress":
            task = self._task(workspace_key, value.get("task_id"))
            path = self._progress_path(task["id"])
            progress = read_json(path) if path.exists() else {"phase": task["state"]}
            return {"task_id": task["id"], "task_state": task["state"], **progress}
        if operation == "exports":
            offset = self._integer(value, "offset", 0)
            limit = self._integer(value, "limit", 100)
            if offset < 0 or limit < 1 or limit > 1000:
                raise ValueError("Use a nonnegative offset and page size from 1 to 1000.")
            tasks = [task for task in self.operator.task_list(workspace_key) if task.get("action") == ACTION]
            tasks.sort(key=lambda row: (row.get("created_at", ""), row["id"]), reverse=True)
            selected = [self.decorate_task(copy.deepcopy(task)) for task in tasks[offset:offset + limit]]
            next_offset = offset + len(selected)
            return {"items": selected, "total": len(tasks), "offset": offset,
                    "limit": limit, "next_offset": next_offset if next_offset < len(tasks) else None}
        raise self.Fault("STUDY_ROUTE", "Select an existing scientific-study transfer view.", 404)

    def _investigation_snapshot(self, workspace_key):
        # Reuse the configured scientific integration. Its Store may live
        # outside the Workspace; constructing another factory would lose it.
        integration = getattr(self.operator, "science_investigations", None)
        if integration is None:
            registry = getattr(self.operator, "extensions", None)
            entries = getattr(registry, "_extensions", {})
            provider = (entries.get("investigations") or {}).get("provider")
            integration = getattr(provider, "integration", None)
        if integration is None:
            return None
        prepare = getattr(integration, "prepare_study_snapshot", None)
        if not callable(prepare):
            raise ValueError("Update the installed scientific investigation integration before transferring its history.")
        # Original context binding takes the shared Workspace guard. Complete it
        # before export_study freezes native members under the exclusive guard.
        return prepare(workspace_key)

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("STUDY_ACTION", "Select the scientific-study export action.", 404)
        workspace = self.operator.ws(task["workspace"])
        selection = task["payload"]
        study_transfer.normalise(selection)
        progress_path = self._progress_path(task["id"])
        started = now()

        def progress(value):
            atomic_json(progress_path, {"task_id": task["id"], "workspace_key": task["workspace"],
                                        "started_at": started, "updated_at": now(), **value})

        destination = Path(self.operator.root) / "outputs" / (task["id"] + ".study.zip")
        try:
            snapshot = self._investigation_snapshot(task["workspace"])
            return study_transfer.export_study(
                workspace, destination, selection, progress=progress,
                investigation_snapshot=snapshot)
        except BaseException as error:
            progress({"phase": "failed", "error": {"type": type(error).__name__, "message": str(error)}})
            raise

    def decorate_task(self, task):
        if task.get("action") != ACTION:
            return task
        result = task.get("result") or {}
        task["_study_transfer"] = {
            "title": task.get("payload", {}).get("title", "Selected scientific study"),
            "roots": task.get("payload", {}).get("roots", []),
            "id": result.get("id"),
        }
        path = self._progress_path(task["id"])
        if path.exists():
            task["_study_progress"] = read_json(path)
        if task.get("state") == "complete" and result.get("path"):
            ticket = self.operator._ticket(
                task["workspace"], result["path"],
                {**result, "filename": "scientific-study-" + result["id"][:12] + ".zip"},
                "Editable scientific study")
            stream, _ = self.operator.open_download(ticket["id"])
            stream.close()
            task["_downloads"] = [ticket]
        return task

    def verify_workspace(self, workspace):
        return study_transfer.verify_received_studies(workspace)
