"""Management responses across retained annual forcing cases in the original operator."""
from __future__ import annotations

from copy import deepcopy

from model import climate_management, climate_management_working as working
from model import climate_management_working_comparison as design_comparisons
from model.common import identifier, relative_file

ACTION = "climate-management.build"
WORKING_ACTIONS = {"climate-management.working.save", "climate-management.working.export"}
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


DESIGN_ACTION = "climate-management.working.compare"


def decorate_design_comparison(operator, workspace_key, record):
    value = deepcopy(record)
    workspace = operator.ws(workspace_key)
    value["_downloads"] = [operator._ticket(workspace_key, relative_file(workspace.root, item["path"]), item, name)
                            for name, item in record["files"].items()]
    value["_item"] = {"kind": design_comparisons.KIND, "id": record["id"]}
    return value


def invoke(operator, task):
    if task.get("action") == DESIGN_ACTION:
        payload = task["payload"]
        if not isinstance(payload, dict) or set(payload) != {"selection", "expected_id"}:
            raise ValueError("Build the exact reviewed saved-design comparison")
        return design_comparisons.build(operator.ws(task["workspace"]), selection(payload), identifier(payload["expected_id"]))
    if task.get("action") == "climate-management.working.save":
        return {**working.save(operator.ws(task["workspace"]), task["payload"]), "workspace_key": task["workspace"]}
    if task.get("action") == "climate-management.working.export":
        return working.export_files(operator.ws(task["workspace"]), identifier(task["payload"].get("revision_id")))
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
        return {**climate_management.catalogue(workspace), "working_designs": working.list_series(workspace),
                "working_comparison_revisions": design_comparisons.catalogue(workspace)["revisions"],
                "working_comparisons": design_comparisons.list_reports(workspace)}
    if operation == "working-comparison-catalog":
        return {**design_comparisons.catalogue(workspace), "workspace_key": workspace_key}
    if operation == "working-comparison-preview":
        return design_comparisons.preview(workspace, selection(payload))
    if operation == "working-comparison":
        record = design_comparisons.get_report(workspace, identifier(one(payload, "id")), verify=True)
        return {**decorate_design_comparison(operator, workspace_key, record), "workspace_key": workspace_key}
    if operation == "working-list":
        return {"workspace_key": workspace_key, "items": working.list_series(workspace)}
    if operation == "working-view":
        return {**working.inspect(workspace, identifier(one(payload, "id"))), "workspace_key": workspace_key}
    if operation == "preview":
        return climate_management.preview(workspace, selection(payload))
    if operation == "report":
        report = climate_management.get_report(workspace, identifier(one(payload, "id")), verify=True)
        return decorate_report(operator, workspace_key, report)
    raise ValueError("Choose the management catalogue, preview or saved report")


def updates(workspace):
    return {"reports": climate_management.list_reports(workspace), "working_designs": working.list_series(workspace),
            "working_comparisons": design_comparisons.list_reports(workspace)}


def decorate_task(operator, task):
    if task.get("action") == DESIGN_ACTION and task.get("state") == "complete":
        record = design_comparisons.get_report(operator.ws(task["workspace"]), identifier((task.get("result") or {}).get("id")), verify=False)
        decorated = decorate_design_comparison(operator, task["workspace"], record)
        task["_downloads"], task["_item"] = decorated["_downloads"], decorated["_item"]
    if task.get("action") == ACTION and task.get("state") == "complete":
        key = identifier((task.get("result") or {}).get("id"))
        # Reopen the original saved record; do not trust a task's embedded file
        # paths or build a new report while decorating its existing completion.
        report = climate_management.get_report(operator.ws(task["workspace"]), key, verify=False)
        task["_downloads"] = downloads(operator, task["workspace"], report)
        task["_item"] = {"kind": ITEM_KIND, "id": key}
    if task.get("action") == "climate-management.working.export" and task.get("state") == "complete":
        workspace = operator.ws(task["workspace"])
        result = task.get("result") or {}
        original = working.export_files(workspace, identifier(result.get("revision_id")))
        if original != result:
            raise ValueError("The retained working export differs from its original history")
        task["_downloads"] = [operator._ticket(task["workspace"], relative_file(workspace.root, item["path"]), item, name)
                              for name, item in original["files"].items()]
    return task


def verify_workspace(workspace):
    return {"reports": climate_management.verify_all(workspace), "working_designs": working.verify_all(workspace),
            "working_comparisons": design_comparisons.verify_all(workspace)}
