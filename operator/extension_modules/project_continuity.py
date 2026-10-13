"""Bind project transfer and recovery to the maintained operator extension host."""
from pathlib import Path

from model.common import read_json
from project_continuity import ProjectContinuity


class ProjectContinuityExtension:
    def __init__(self, operator, fault):
        self.operator = operator
        self.service = ProjectContinuity(operator, fault, supported_actions=())

    def _current(self):
        # The original host assigns operator.extensions after load() finishes.
        # Resolve the union at invocation so later installed desks are included.
        registry = self.operator.extensions
        self.service.supported_actions = (
            set(registry._builtin_actions) | set(registry.accepted_actions))
        return self.service

    def invoke(self, task):
        return self._current().invoke(task)

    def read(self, workspace_key, operation, payload):
        return self._current().read(workspace_key, operation, payload)

    def state(self, workspace_key):
        service = self._current()
        return {"transfers": service.list(workspace_key),
                "accepted_actions": sorted(service.supported_actions)}

    def decorate_task(self, task):
        return self._current().decorate_task(task)

    def verify_workspace(self, workspace):
        # Restore verification receives the actual Workspace before registration.
        # No operator workspace key or action invocation is needed here.
        transfers = []
        directory = Path(workspace.root) / "project-transfers"
        for path in sorted(directory.glob("*.json")):
            if path.stem == "HEAD":
                continue
            record = self.service._verify(workspace, read_json(path))
            transfers.append(record["id"])
        return {"project_id": workspace.project["id"], "transfers": transfers}


def create(operator, fault):
    return ProjectContinuityExtension(operator, fault)
