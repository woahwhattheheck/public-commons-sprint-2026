"""Ordered scientific sources from saved Economic comparisons on the native queue."""
from __future__ import annotations

from copy import deepcopy

from model.common import verify_file
from model.economic_comparison_source import (
    _id, preview_report_source, import_report_source, get_report_source, list_report_sources,
)

ACTION = "economic.comparison.report-source.import"


class EconomicComparisonSource:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _selection(self, workspace, payload, *, preview):
        if not isinstance(payload, dict) or payload.get("workspace_key") not in (None, workspace):
            raise ValueError("Choose the saved Economic comparison in its original Workspace.")
        if any(key in payload for key in ("path", "directory", "document", "upload_id")):
            raise ValueError("Select the retained native comparison identity.")
        comparison_id = _id(payload.get("comparison_id"))
        selection = payload.get("existing_report_selection")
        if selection is not None and not isinstance(selection, dict):
            raise ValueError("Supply the original ordered scientific-report selection.")
        ws = self.operator.ws(workspace)
        if preview:
            result = preview_report_source(ws, comparison_id, existing_report_selection=selection)
        else:
            operation_id, source_key = _id(payload.get("expected_operation_id")), _id(payload.get("expected_source_key"))
            result = import_report_source(ws, comparison_id, existing_report_selection=selection,
                                          expected_operation_id=operation_id, expected_source_key=source_key)
            result = self._public(workspace, result, payload=payload)
        return dict(result, workspace_key=workspace)

    def _public(self, workspace, result, *, payload=None):
        ws = self.operator.ws(workspace)
        value = get_report_source(ws, result["source_key"], result["operation_id"])
        if payload is not None and (
                value["comparison_id"] != payload.get("comparison_id")
                or value["operation_id"] != payload.get("expected_operation_id")
                or value["source_key"] != payload.get("expected_source_key")):
            raise ValueError("The source result differs from the original queued comparison.")
        files = [self.operator._ticket(workspace, verify_file(ws.root, item), item, item["path"])
                 for item in value["files"]]
        return dict(value, workspace_key=workspace, _downloads=files)

    def read(self, workspace, operation, payload):
        value = payload or {}
        if operation == "preview":
            return self._selection(workspace, value, preview=True)
        if operation == "list":
            comparison_id = _id(value.get("comparison_id"))
            return {"workspace_key": workspace, "comparison_id": comparison_id,
                    "items": list_report_sources(self.operator.ws(workspace), comparison_id)}
        if operation == "detail":
            return self._public(workspace, value)
        raise self.Fault("ECONOMIC_COMPARISON_SOURCE_READ", "Choose a comparison scientific-source operation.", 404)

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("ECONOMIC_COMPARISON_SOURCE_ACTION", "Choose the registered comparison source action.")
        return self._selection(task["workspace"], task["payload"], preview=False)

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        result = deepcopy(task)
        result["result"] = self._public(task["workspace"], task["result"], payload=task["payload"])
        result["_downloads"] = result["result"]["_downloads"]
        return result
