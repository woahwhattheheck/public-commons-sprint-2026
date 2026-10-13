"""Original Flow routes view and source-bound task on the existing operator."""
from __future__ import annotations
from copy import deepcopy
import base64
import hashlib
from urllib.parse import quote
from model import flow_routing
from model.flow_routing_source import available_runs, source_view
from model.common import identifier, verify_file

ACTION = "flow-route.trace"


def product(operator, workspace_key, key):
    workspace = operator.ws(workspace_key)
    record, document = flow_routing.inspect(workspace, key)
    root = workspace.root / flow_routing.ROOT / record["id"]
    tickets = []
    for name, item in record["files"].items():
        ticket = operator._ticket(workspace_key, verify_file(root, item), item,
                                  "Readable routing explanation" if name == "index.html" else name)
        tickets.append({**ticket, "member": name})
    return {"schema": "upstate.flow-routing-product/v1",
            "workspace_key": workspace_key, "project_id": workspace.project["id"],
            "id": record["id"], "report": record, "document": document,
            "tickets": tickets, "_downloads": tickets,
            "report_url": "/api/file/flow-routing/" + quote(workspace_key, safe="") + "/" + record["id"] + "/index.html"}


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return {"schema": "upstate.flow-routing-catalog/v1",
                "workspace_key": workspace_key, "project_id": workspace.project["id"],
                "runs": available_runs(workspace), "reports": flow_routing.catalog(workspace)}
    if operation == "source":
        value = source_view(workspace, identifier(payload.get("run_id")), payload.get("model"))
        source = value["source"]
        directory = workspace.root / "runs" / source["run_id"]
        items = {"arguments": source["native_stage"]["arguments"], **source["files"]}
        for item in source["companions"]:
            items["companion:" + item["path"]] = item
        tickets = []
        for role, item in items.items():
            ticket = operator._ticket(workspace_key, verify_file(directory, item), item,
                                      "Original native " + role)
            tickets.append({**ticket, "role": role, "member": item["path"]})
        return {**value, "source_tickets": tickets,
                "workspace_key": workspace_key, "project_id": workspace.project["id"]}
    if operation == "report":
        return product(operator, workspace_key, identifier(payload.get("id")))
    raise ValueError("Choose the original routing catalogue, native source or saved report")


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError("Choose the original native routing explanation action")
    record = flow_routing.build(operator.ws(workspace_key), payload.get("selection"),
                               payload.get("expected_source_id"))
    return {"id": record["id"], "project_id": record["project_id"],
            "source_id": record["source_id"], "selection": deepcopy(record["selection"]),
            "summary": deepcopy(record["summary"])}


def decorate_task(operator, task):
    if task.get("action") != ACTION or task.get("state") != "complete":
        return task
    # State polling must not reopen every raster and replay every completed
    # routing graph. Opening this original saved item performs full validation
    # and supplies all actual file tickets on demand.
    task["_item"] = {"kind": "flow-routing-reports", "id": identifier(task["result"]["id"])}
    return task


def verify_workspace(workspace):
    return flow_routing.verify_all(workspace)


def report_preview(operator, workspace_key, report_id):
    """Render only this authored report with its exact script hash."""
    workspace = operator.ws(workspace_key)
    record, document = flow_routing.inspect(workspace, identifier(report_id))
    path = verify_file(workspace.root / flow_routing.ROOT / record["id"], record["files"]["index.html"])
    expected = flow_routing._html(document)
    if path.read_bytes() != expected:
        raise ValueError("Open this retained report using its complete original application edition")
    # _html emits one authored executable script. Source JSON escapes '<',
    # and every user-authored visible field is HTML-escaped.
    script = expected.decode("utf-8").rsplit("<script>", 1)[1].split("</script>", 1)[0]
    code_hash = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    policy = ("default-src 'none'; script-src 'sha256-" + code_hash +
              "'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; "
              "object-src 'none'; base-uri 'none'; form-action 'none'; "
              "frame-ancestors 'self'; sandbox allow-scripts")
    ticket = operator._ticket(workspace_key, path, record["files"]["index.html"],
                              "Readable original routing explanation")
    return ticket, policy
