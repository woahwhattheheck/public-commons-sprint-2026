"""GWMA study desk on the existing authorized operator task queue."""
from model import gwma_study
from model.common import verify_file

ACTIONS = {
    "gwma.study.save": gwma_study.save_study,
    "gwma.mapping.save": gwma_study.save_mapping,
    "gwma.intake": gwma_study.intake,
    "gwma.review.save": gwma_study.save_review,
    "gwma.contract.save": gwma_study.save_contract,
    "gwma.plan.save": gwma_study.save_plan,
    "gwma.handover.build": gwma_study.build_handover,
}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return {"workspace_key": workspace_key, **gwma_study.catalog(workspace)}
    if operation == "item":
        return gwma_study.item(workspace, payload["kind"], payload["id"])
    if operation == "rows":
        return gwma_study.rows(workspace, payload)
    raise ValueError("Choose an existing GWMA study view")


def invoke(operator, workspace_key, action, payload):
    if action not in ACTIONS:
        raise ValueError("Choose an existing GWMA study action")
    return ACTIONS[action](operator.ws(workspace_key), payload)


def overview(operator, workspace_key):
    return gwma_study.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task["action"] == "gwma.handover.build" and task["state"] == "complete":
        workspace = operator.ws(task["workspace"])
        result = gwma_study.item(workspace, "handover", task["result"]["id"])
        archive = result["archive"]
        path = verify_file(workspace.root, archive)
        task["_downloads"] = [operator._ticket(task["workspace"], path, archive,
                              "Complete GWMA study data, workplan and analytical handover")]
    return task
