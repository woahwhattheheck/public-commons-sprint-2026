"""Saved whole Implementation reports on the existing operator queue."""
from __future__ import annotations

from copy import deepcopy
import re

from model.common import verify_file
from model.implementation_report_source import (
    preview_report_source, import_report_source, get_report_source,
)
from model.implementation_schema import ImplementationError, _safe_id

ACTION = "implementation.report-source.import"


class ImplementationReportSource:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _selection(self, workspace, payload, *, preview):
        if not isinstance(payload, dict) or payload.get("workspace_key") not in (None, workspace):
            raise ImplementationError("Choose the original report in its native Workspace.")
        if any(name in payload for name in ("path", "directory", "document", "upload_id")):
            raise ImplementationError("Select a saved native report edition.")
        plan_id = _safe_id(payload.get("plan_id"), "plan_id")
        report_id = payload.get("report_id")
        if not isinstance(report_id, str) or not re.fullmatch(r"[0-9a-f]{64}", report_id):
            raise ImplementationError("Choose the original saved report edition.")
        selection = payload.get("existing_report_selection")
        if selection is not None and not isinstance(selection, dict):
            raise ImplementationError("Supply the original ordered delivery selection object.")
        ws = self.operator.ws(workspace)
        if preview:
            result = preview_report_source(ws, plan_id, report_id, existing_report_selection=selection)
        else:
            expected = payload.get("expected_operation_id")
            if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ImplementationError("Preview the saved report before registering its source.")
            result = import_report_source(ws, plan_id, report_id,
                existing_report_selection=selection, expected_operation_id=expected)
            result = self._public(workspace, result)
        return dict(result, workspace_key=workspace)

    def _public(self, workspace, result):
        ws = self.operator.ws(workspace)
        retained = get_report_source(ws, result["source_key"], result["operation_id"])
        downloads = []
        for item in retained["files"]:
            path = verify_file(ws.root, item)
            downloads.append(self.operator._ticket(workspace, path, item, item["path"]))
        return dict(retained, workspace_key=workspace, _downloads=downloads)

    def read(self, workspace, operation, payload):
        if operation == "preview":
            return self._selection(workspace, payload or {}, preview=True)
        if operation == "detail":
            value = payload or {}
            return self._public(workspace, value)
        raise self.Fault("IMPLEMENTATION_REPORT_SOURCE_READ", "Choose a report source operation.", 404)

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("IMPLEMENTATION_REPORT_SOURCE_ACTION", "Choose the registered report-source action.")
        return self._selection(task["workspace"], task["payload"], preview=False)

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        public = deepcopy(task)
        public["result"] = self._public(task["workspace"], task["result"])
        public["_downloads"] = public["result"]["_downloads"]
        return public
