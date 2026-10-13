"""Management responses across retained annual forcing cases in the original operator."""
from __future__ import annotations

from copy import deepcopy

from model import climate_management
from model.common import identifier, relative_file

ACTION = "climate-management.build"
ITEM_KIND = "climate-management-reports"


def one(payload, name):
    value = payload.get(name)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Select one " + name)
        value = value[0]
    return value


def selection(payload):
    value = payload.get("selection")
    if not isinstance(value, dict):
        raise ValueError("Select the original reference, treatment and optional control forcing cases")
    return value


def downloads(operator, workspace_key, report):
    workspace = operator.ws(workspace_key)
    expected = ITEM_KIND + "/" + identifier(report["id"])
    if (report.get("workspace_id") != workspace.project["id"]
            or report.get("directory") != expected):
        raise ValueError("The management report belongs to another original workspace or directory")
    directory = workspace.root / expected
    values = []
    labels = {
        "report.html": "Management comparison — open report",
        "results.json": "Complete numerical result",
        "figure-data.json": "Saved figure specification and original values",
        "benefits.csv": "Management benefit and forcing interaction",
        "independent-totals.csv": "Independent annual export totals",
        "support.csv": "Exact finite support",
        "snapshot.json": "Original scientific selection and native records",
        "observed-report.json": "Scientific report source",
        "MANIFEST.json": "Complete member identities",
        "climate-management-results.zip": "Complete management result archive",
        "sources.json": "Original typed source manifest",
        "reporting-area.gpkg": "Original reporting geometry",
    }
    for name, item in report["files"].items():
        path = relative_file(directory, item["path"])
        # The saved report binds these descriptors; original open_download
        # verifies the exact opened bytes/SHA. Routine task refresh must not
        # repeatedly hash all original raster outputs.
        ticket = operator._ticket(workspace_key, path, item, labels.get(name, name))
        ticket["artifact_id"] = name
        values.append(ticket)
    return values


def decorate_report(operator, workspace_key, report):
    value = deepcopy(report)
    value["_downloads"] = downloads(operator, workspace_key, report)
    value["_item"] = {"kind": ITEM_KIND, "id": report["id"]}
    # Resolve the actual registered original collection. The GIS desk validates
    # it again and retains its complete companions through ordinary preparation.
    workspace = operator.ws(workspace_key)
    collection_id = identifier(report["source"]["source_collection_id"])
    collection = workspace._get("sources", collection_id)
    value["_gis_selection"] = {
        "title": (report["title"] + " — management GIS")[:240],
        "project_crs": report["lattice"]["crs_wkt"],
        "source_collection_id": collection_id,
        "sources": [{"source_collection_id": collection_id, "source_id": entry["id"]}
                    for entry in collection["entries"]],
        "notes": [
            "Original climate-management comparison " + report["id"] + ".",
            "Annual modeled export reaching streams; reference minus treatment.",
            "Signed benefit and interaction maps use the retained common finite support.",
            "The reporting-area selector filters the comparison tables; native raster files retain their complete original footprint.",
        ],
    }
    return value


def invoke(operator, task):
    if task.get("action") != ACTION:
        raise ValueError("Select the registered management comparison action")
    payload = task["payload"]
    if not isinstance(payload, dict) or set(payload) != {"selection", "expected_id"}:
        raise ValueError("Build the explicitly reviewed selection and its original preview identity")
    expected = identifier(payload.get("expected_id"))
    return climate_management.build(
        operator.ws(task["workspace"]), selection(payload), expected_id=expected)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if not isinstance(payload, dict):
        raise ValueError("Select a retained management comparison")
    if operation == "catalog":
        return climate_management.catalogue(workspace)
    if operation == "preview":
        return climate_management.preview(workspace, selection(payload))
    if operation == "report":
        report = climate_management.get_report(workspace, identifier(one(payload, "id")), verify=True)
        return decorate_report(operator, workspace_key, report)
    raise ValueError("Choose the management catalogue, preview or saved report")


def updates(workspace):
    return {"reports": climate_management.list_reports(workspace)}


def decorate_task(operator, task):
    if task.get("action") == ACTION and task.get("state") == "complete":
        key = identifier((task.get("result") or {}).get("id"))
        # Reopen the original saved record; do not trust a task's embedded file
        # paths or build a new report while decorating its existing completion.
        report = climate_management.get_report(operator.ws(task["workspace"]), key, verify=False)
        task["_downloads"] = downloads(operator, task["workspace"], report)
        task["_item"] = {"kind": ITEM_KIND, "id": key}
    return task


def verify_workspace(workspace):
    return climate_management.verify_all(workspace)
