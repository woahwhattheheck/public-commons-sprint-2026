"""Original queue, catalogue and download integration for observed HUC changes."""
from model import observed_landcover, observed_landcover_handover

ACTIONS = {"observed.landcover.import", "observed.landcover.save", "observed.landcover.handover"}


def _downloads(operator, workspace_key, edition):
    workspace = operator.ws(workspace_key)
    from model.common import verify_file
    return [operator._ticket(workspace_key, verify_file(workspace.root, row), row, name)
            for name, row in edition["files"].items() if not name.startswith("originals/")]


def _handover_downloads(operator, workspace_key, value):
    workspace = operator.ws(workspace_key)
    from model.common import relative_file
    labels = {
        "Recipient_Package.zip": "Complete recipient package ZIP — extract and open START_HERE.html",
        "Report/Watershed_Scientific_Report.pdf": "Original scientific PDF",
        "Report/Watershed_Offline_Reader.html": "Standalone offline report and original sources",
        "Editable_Study.zip": "Original editable Study ZIP",
        "Report/Original_Saved_Report.zip": "Original saved scientific edition ZIP",
        "Comparison/selected-huc-landcover.zip": "Original comparison ZIP",
        "Package_Manifest.json": "Complete package inventory",
    }
    # Catalogues read immutable metadata only; the file transport reopens the
    # original retained bytes. Full inspect/build validates the complete package.
    return [{**operator._ticket(workspace_key, relative_file(workspace.root, value["files"][name]["path"]),
                                value["files"][name], label), "member": name}
            for name, label in labels.items()]


def _investigation_snapshot(operator, workspace_key):
    provider = getattr(operator.extensions, "_extensions", {}).get("study-transfer", {}).get("provider")
    method = getattr(provider, "_investigation_snapshot", None)
    if not callable(method):
        raise ValueError("Install the original Study transfer provider before preparing a recipient package")
    return method(workspace_key)


def invoke(operator, workspace_key, action, payload):
    workspace = operator.ws(workspace_key)
    if action == "observed.landcover.import":
        if payload:
            raise ValueError("Import the installed original completed land-cover source manifest")
        return observed_landcover.import_published(workspace)
    if action == "observed.landcover.save":
        return observed_landcover.build(workspace, payload)
    if action == "observed.landcover.handover":
        if set(payload) != {"comparison_id", "report_id"}:
            raise ValueError("Choose the saved comparison and its exact completed scientific report")
        snapshot = _investigation_snapshot(operator, workspace_key)
        return observed_landcover_handover.build(
            workspace, payload["comparison_id"], payload["report_id"],
            investigation_snapshot=snapshot)
    raise ValueError("Select an original observed land-cover action")


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == "catalog":
        return observed_landcover.catalog(workspace)
    if operation == "inputs":
        return observed_landcover.preview(workspace, payload["selection"])
    if operation == "edition":
        result = observed_landcover.inspect(workspace, payload["id"])
        result["_downloads"] = _downloads(operator, workspace_key, result["edition"])
        return result
    if operation == "handover-catalog":
        value = observed_landcover_handover.catalog(workspace, payload["id"])
        for row in value["handovers"]:
            row["_downloads"] = _handover_downloads(operator, workspace_key, row)
            row.pop("files", None)
        return value
    if operation == "handover":
        value = observed_landcover_handover.inspect(workspace, payload["id"])
        value["_downloads"] = _handover_downloads(operator, workspace_key, value)
        return value
    raise ValueError("Select an original observed land-cover reader")


def overview(operator, workspace_key):
    return observed_landcover.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task["action"] == "observed.landcover.save" and task["state"] == "complete":
        value = observed_landcover.inspect(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _downloads(operator, task["workspace"], value["edition"])
        task["_item"] = {"kind": observed_landcover.KIND, "id": value["edition"]["id"]}
    if task["action"] == "observed.landcover.handover" and task["state"] == "complete":
        value, _ = observed_landcover_handover._record(operator.ws(task["workspace"]), task["result"]["id"])
        task["_downloads"] = _handover_downloads(operator, task["workspace"], value)
        task["_item"] = {"kind": observed_landcover_handover.KIND, "id": value["id"]}
    return task
