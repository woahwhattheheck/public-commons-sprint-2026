"""Operator integration for retained native computation programmes.

The existing Operator owns authorization, task identities, native execution
serialization and authenticated downloads. This adapter shares those services.
"""
from __future__ import annotations

import json
import re

from model.compute_programme import ComputeProgrammes

ACTIONS = {
    "compute.programme.save",
    "compute.programme.experiment",
    "compute.programme.run",
    "compute.programme.report",
    "compute.programme.delivery",
}
READS = {"catalog", "detail", "report"}


class Programmes:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _manager(self, workspace):
        return ComputeProgrammes(self.operator.ws(workspace))

    def _id(self, payload):
        key = payload.get("programme_id")
        if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
            raise self.Fault("PROGRAMME_REQUIRED", "Choose a saved run programme.")
        return key

    def catalogue(self, workspace, *, include_completed_sources=False):
        from model.programme_experiments import catalog
        return {**self._manager(workspace).catalog(include_completed_sources=include_completed_sources),
                **catalog(self.operator.ws(workspace))}

    def _decorate(self, workspace, result):
        result = json.loads(json.dumps(result))
        ws = self.operator.ws(workspace)
        if isinstance(result, dict):
            result["_downloads"] = self.operator._files(workspace, result, ws.root)
            latest = result.get("latest_report")
            if isinstance(latest, dict):
                more = self.operator._files(workspace, latest, ws.root)
                known = {row["id"] for row in result["_downloads"]}
                result["_downloads"].extend(row for row in more if row["id"] not in known)
        return result

    def read(self, workspace, operation, payload):
        manager = self._manager(workspace)
        if operation == "catalog":
            include_sources = payload.get("include_sources") in (True, 1, "1", "true")
            return {"workspace_key": workspace, **self.catalogue(workspace, include_completed_sources=include_sources)}
        key = self._id(payload)
        if operation == "detail":
            return {"workspace_key": workspace, **self._decorate(workspace, manager.status(key))}
        if operation == "report":
            return {"workspace_key": workspace, **self._decorate(workspace, manager.read_report(key))}
        raise self.Fault("PROGRAMME_READ", "Choose a supported programme view.", 404)

    def preview(self, workspace, payload):
        selection = payload.get("selection")
        if not isinstance(selection, dict):
            raise self.Fault("PROGRAMME_SELECTION", "Import or create a programme selection.")
        return {"workspace_key": workspace, **self._manager(workspace).preview(selection)}

    def experiment_preview(self, workspace, payload):
        from model.programme_experiments import preview
        return {"workspace_key": workspace, **preview(self.operator.ws(workspace),
            payload.get("experiment_id"), payload.get("offset", 0), payload.get("limit", 100))}

    def pause(self, workspace, payload):
        # This signal deliberately runs on the request thread. Enqueueing it in
        # the native worker would put it behind the calculation it should pause.
        return {"workspace_key": workspace, **self._manager(workspace).pause(self._id(payload))}

    def delivery_preview(self, workspace, payload):
        selection = payload.get("selection")
        if not isinstance(selection, dict):
            raise self.Fault("DELIVERY_SELECTION", "Choose the saved release selections.")
        return {"workspace_key": workspace, **self._manager(workspace).delivery_preview(
            self._id(payload), selection)}

    def invoke(self, task):
        workspace = task["workspace"]
        manager = self._manager(workspace)
        payload = task["payload"]
        action = task["action"]
        if action == "compute.programme.experiment":
            from model.programme_experiments import create
            return create(self.operator.ws(workspace), payload.get("experiment_id"))
        if action == "compute.programme.save":
            selection = payload.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault("PROGRAMME_SELECTION", "Create or import a programme selection.")
            return manager.create(selection, source_reference=payload.get("source_reference"))
        key = self._id(payload)
        if action == "compute.programme.run":
            result = manager.resume(key, only_runs=payload.get("only_runs"))
            if result.get("state") == "failed" or result.get("counts", {}).get("failed", 0):
                counts = result.get("counts", {})
                raise self.Fault(
                    "PROGRAMME_INCOMPLETE",
                    "Programme retained with " + str(counts.get("complete", 0)) +
                    " completed runs and " + str(counts.get("failed", 0)) +
                    " failed runs. Open the programme to inspect each cause and resume.")
            if result.get("state") == "complete":
                from model.programme_experiments import sync_completed
                try:
                    synchronized = sync_completed(self.operator.ws(workspace), result)
                except Exception as exc:
                    raise self.Fault(
                        "EXPERIMENT_SUMMARY_INCOMPLETE",
                        "Native programme completed; experiment result synchronization needs correction: " + str(exc)) from exc
                if synchronized is not None:
                    result = {**result, "experiment_sync": synchronized}
            return result
        if action == "compute.programme.report":
            return self._decorate(workspace, manager.report(key))
        if action == "compute.programme.delivery":
            selection = payload.get("selection")
            if not isinstance(selection, dict):
                raise self.Fault("DELIVERY_SELECTION", "Choose the release selections.")
            return manager.prepare_delivery(key, selection)
        raise self.Fault("PROGRAMME_ACTION", "Choose a supported programme operation.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        task = json.loads(json.dumps(task))
        payload = task.get("payload", {})
        result = task.get("result", {})
        key = payload.get("programme_id")
        if not key and task["action"] in ("compute.programme.save", "compute.programme.experiment"):
            key = result.get("id")
        if key:
            try:
                row = self._manager(task["workspace"]).status(key)
                task["programme"] = {
                    "id": row["id"], "title": row.get("title"),
                    "state": row.get("state"), "phase": row.get("phase"),
                    "counts": row.get("counts", {}), "pause_requested": row.get("pause_requested", False),
                }
            except (FileNotFoundError, KeyError, ValueError):
                pass
        if task.get("state") == "complete" and isinstance(result, dict):
            downloads = self.operator._files(task["workspace"], result,
                                            self.operator.ws(task["workspace"]).root)
            if downloads:
                task["_downloads"] = downloads
        return task
