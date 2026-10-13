"""Join complete project transfer and recovery to the shared operator registry."""
from project_continuity import ACTIONS, READS, ProjectContinuity


def create(context):
    service = ProjectContinuity(context.operator, context.Fault,
                               supported_actions=context.actions)

    def current():
        # Read the registry's current union, including later-loaded components.
        service.supported_actions = context.actions
        return service

    def invoke(task):
        return current().invoke(task)

    def reader(operation):
        def read(workspace_key, query):
            return current().read(workspace_key, operation, query)
        return read

    def state(workspace_key):
        return {"project_transfers": current().list(workspace_key),
                "project_transfer_actions": sorted(context.actions)}

    def decorate_task(task):
        return current().decorate_task(task)

    return {"actions": {name: invoke for name in ACTIONS},
            "reads": {name: reader(name) for name in READS},
            "state": state,
            "decorate_task": decorate_task}
