"""Outcome evaluation in the existing operator queue and Implementation desk."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from model import implementation_outcomes
from model.common import verify_file

ACTION = "implementation.outcomes.build"


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
        if operation == "catalog":
            return dict(implementation_outcomes.catalog(
                workspace, plan_id, self._revision(value)), workspace_key=workspace_key)
        if operation == "list":
            return {"workspace_key": workspace_key, "plan_id": plan_id,
                    "outcomes": implementation_outcomes.list_outcomes(workspace, plan_id)}
        if operation == "detail":
            identity = value.get("id")
            if not isinstance(identity, str) or not identity:
                raise self.Fault("IMPLEMENTATION_OUTCOME_ID", "Choose a retained outcome evaluation.")
            result = implementation_outcomes.get(workspace, plan_id, identity)
            return self._public(workspace_key, result)
        raise self.Fault("IMPLEMENTATION_OUTCOME_READ", "Choose an outcome catalogue or retained evaluation.", 404)

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("IMPLEMENTATION_OUTCOME_ACTION", "Choose the registered outcome operation.")
        selection = self._payload(task["payload"].get("selection"))
        self._plan(selection)
        # The model rereads the declared immutable plan revision and checks its
        # digest. Browser row arrays never substitute for retained observations.
        return implementation_outcomes.build(self.operator.ws(task["workspace"]), selection)

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        result = task.get("result", {})
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

