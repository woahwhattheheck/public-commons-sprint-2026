"""Outcome evaluation in the existing operator queue and Implementation desk."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from model import implementation_outcomes
from model.common import verify_file

ACTION = "implementation.outcomes.build"
REPORT_ACTION = "implementation.outcomes.report-import"


class ImplementationOutcomesOperator:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _payload(self, value):
        if not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_OUTCOME_INPUT", "Supply an outcome selection object.")
        return value

    def _plan(self, value):
        plan = value.get("plan_id")
        if not isinstance(plan, str) or not plan.strip():
            raise self.Fault("IMPLEMENTATION_OUTCOME_PLAN", "Choose an original saved plan.")
        return plan

    def _revision(self, value):
        revision = value.get("revision")
        if revision is None:
            return None
        if isinstance(revision, str) and re.fullmatch(r"[1-9][0-9]*", revision):
            revision = int(revision)
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise self.Fault("IMPLEMENTATION_OUTCOME_REVISION", "Choose a saved positive plan revision.")
        return revision

    def _outcome_id(self, value):
        identity = value.get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[0-9a-f]{64}", identity):
            raise self.Fault("IMPLEMENTATION_OUTCOME_ID", "Choose a retained outcome evaluation.")
        return identity

    def _report_context(self, workspace_key, value, *, preview):
        from model.implementation_outcome_context import (
            preview_outcome_context, import_outcome_context,
        )
        value = self._payload(value)
        plan_id, identity = self._plan(value), self._outcome_id(value)
        selection = value.get("existing_report_selection")
        if selection is not None and not isinstance(selection, dict):
            raise self.Fault("IMPLEMENTATION_OUTCOME_REPORT_SELECTION",
                             "Use the current saved report selection.")
        workspace = self.operator.ws(workspace_key)
        if preview:
            result = preview_outcome_context(
                workspace, plan_id, identity, existing_report_selection=selection)
        else:
            operation_id = value.get("expected_operation_id")
            if not isinstance(operation_id, str) or not re.fullmatch(r"[0-9a-f]{64}", operation_id):
                raise self.Fault("IMPLEMENTATION_OUTCOME_REPORT_PREVIEW",
                                 "Review the selected outcome and report context before importing.")
            result = import_outcome_context(
                workspace, plan_id, identity, existing_report_selection=selection,
                expected_operation_id=operation_id)
            if not isinstance(result, dict) or result.get("operation_id") != operation_id:
                raise ValueError("The imported outcome source differs from its reviewed operation")
        if not isinstance(result, dict):
            raise ValueError("The original outcome source adapter must return its result")
        original = implementation_outcomes.get(workspace, plan_id, identity)
        return dict(result, workspace_key=workspace_key, plan_id=plan_id, outcome_id=identity,
                    plan_binding=original["plan_binding"],
                    status="preview" if preview else "outcome_source_imported")

    def _public(self, workspace_key, result):
        """Issue fresh original-host tickets for each verified retained artifact."""
        workspace = self.operator.ws(workspace_key)
        public = deepcopy(result)
        downloads = []
        files = public.get("files", [])
        if not isinstance(files, list):
            raise ValueError("Outcome file inventory must be an original descriptor list")
        root = Path(workspace.root).resolve()
        seen = set()
        for item in files:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                raise ValueError("Outcome artifacts require retained file descriptors")
            path = verify_file(root, item)
            if not path.resolve().is_relative_to(root):
                raise ValueError("Outcome artifacts must remain inside their original Workspace")
            identity = (item["path"], item["bytes"], item["sha256"])
            if identity in seen:
                continue
            seen.add(identity)
            label = item.get("label") or Path(item["path"]).name
            downloads.append(self.operator._ticket(workspace_key, path, item, label))
        public["workspace_key"] = workspace_key
        public["_downloads"] = downloads
        return public

    def read(self, workspace_key, operation, payload):
        value = self._payload(payload or {})
        workspace = self.operator.ws(workspace_key)
        plan_id = self._plan(value)
        if operation == "report-preview":
            return self._report_context(workspace_key, value, preview=True)
        if operation == "catalog":
            return dict(implementation_outcomes.catalog(
                workspace, plan_id, self._revision(value)), workspace_key=workspace_key)
        if operation == "list":
            return {"workspace_key": workspace_key, "plan_id": plan_id,
                    "outcomes": implementation_outcomes.list_outcomes(workspace, plan_id)}
        if operation == "detail":
            identity = self._outcome_id(value)
            result = implementation_outcomes.get(workspace, plan_id, identity)
            return self._public(workspace_key, result)
        raise self.Fault("IMPLEMENTATION_OUTCOME_READ", "Choose an outcome catalogue or retained evaluation.", 404)

    def invoke(self, task):
        if task.get("action") == REPORT_ACTION:
            return self._report_context(task["workspace"], task["payload"], preview=False)
        if task.get("action") != ACTION:
            raise self.Fault("IMPLEMENTATION_OUTCOME_ACTION", "Choose the registered outcome operation.")
        selection = self._payload(task["payload"].get("selection"))
        self._plan(selection)
        # The model rereads the declared immutable plan revision and checks its
        # digest. Browser row arrays never substitute for retained observations.
        return implementation_outcomes.build(self.operator.ws(task["workspace"]), selection)

    def decorate_task(self, task):
        if task.get("action") not in (ACTION, REPORT_ACTION) or task.get("state") != "complete":
            return task
        result = task.get("result", {})
        if task["action"] == REPORT_ACTION:
            original = implementation_outcomes.get(
                self.operator.ws(task["workspace"]), result["plan_id"], result["outcome_id"])
            if original["plan_binding"] != result.get("plan_binding"):
                raise ValueError("The completed report import has a different original plan binding")
            public = deepcopy(task)
            public["result"] = self._public(task["workspace"], result)
            public["_downloads"] = public["result"]["_downloads"]
            return public
        binding = result.get("plan_binding", {})
        plan_id = binding.get("plan_id", result.get("selection", {}).get("plan_id"))
        identity = result.get("id")
        if not plan_id or not identity:
            raise ValueError("Completed outcome operation requires its original plan and evaluation")
        retained = implementation_outcomes.get(self.operator.ws(task["workspace"]), plan_id, identity)
        public = deepcopy(task)
        public["result"] = self._public(task["workspace"], retained)
        public["_downloads"] = public["result"]["_downloads"]
        return public

