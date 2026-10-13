"""Bind retained project transfers to the shared operator extension registry.

The original ProjectTransfers implementation owns archive construction, receiving
and recovery.  This adapter supplies its current task handlers after all shared
extensions have been initialized.
"""
from project_transfer import ACTIONS as TRANSFER_ACTIONS, ProjectTransfers

ACTIONS = frozenset(TRANSFER_ACTIONS)


class ProjectContinuity:
    def __init__(self, operator, fault):
        self.operator = operator
        self.service = ProjectTransfers(operator, fault, supported_actions=frozenset())

    def _refresh_actions(self):
        registry = self.operator.extensions
        actions = frozenset(registry._builtin_actions) | registry.accepted_actions
        self.service.supported_actions = actions
        return actions

    def read(self, workspace_key, operation, payload):
        self._refresh_actions()
        return self.service.read(workspace_key, operation, payload)

    def invoke(self, task):
        self._refresh_actions()
        return self.service.invoke(task)

    def state(self, workspace_key):
        actions = self._refresh_actions()
        return {"transfers": self.service.list(workspace_key),
                "actions": sorted(actions)}

    def decorate_task(self, task):
        self._refresh_actions()
        return self.service.decorate_task(task)


def create(operator, fault):
    return ProjectContinuity(operator, fault)
