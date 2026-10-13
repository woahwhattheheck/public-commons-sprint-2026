"""Freeze the original completed field/QC inspection for the maintained recorder."""
from pathlib import Path

from model.common import atomic_bytes, canonical, file_digest, identifier, read_json, verify_file
from model.simulated_fieldwork import inspect_campaign

PATH = "uploads/simulated-headwaters/fieldwork-inspection.json"


def validate_choice(choice):
    expected = {"path", "bytes", "sha256", "operation_id", "plan_id", "project_id"}
    if not isinstance(choice, dict) or set(choice) != expected or choice["path"] != PATH:
        raise ValueError("Select the complete original field inspection descriptor")
    identifier(choice["operation_id"])
    identifier(choice["sha256"])
    if (isinstance(choice["bytes"], bool) or not isinstance(choice["bytes"], int)
            or choice["bytes"] <= 0):
        raise ValueError("Retain the original field inspection length")
    if any(not isinstance(choice[key], str) or not choice[key] for key in ("plan_id", "project_id")):
        raise ValueError("Retain the original field plan and scientific project identities")
    return choice


def verify_choice(workspace, output, choice):
    validate_choice(choice)
    root = Path(output)
    current = root
    for part in choice["path"].split("/"):
        current = current / part
        if current.is_symlink():
            raise ValueError("The original field inspection became a file alias")
    path = verify_file(root, {key: choice[key] for key in ("path", "bytes", "sha256")})
    frozen = read_json(path)
    if (frozen.get("schema") != "upstate.simulated-fieldwork/v1"
            or frozen.get("phase") != "closeout"
            or frozen.get("operation_id") != choice["operation_id"]
            or frozen.get("plan_id") != choice["plan_id"]
            or frozen.get("original_project_id") != choice["project_id"]
            or workspace.project["id"] != choice["project_id"]):
        raise ValueError("The field recording belongs to a different completed case")
    # The original engine validates every retained step/version before returning
    # the actual current plan. The recording must not silently use a later edit.
    actual = inspect_campaign(workspace, choice["operation_id"])
    original = {key: value for key, value in frozen.items() if key != "presentation"}
    if canonical(actual) != canonical(original):
        raise ValueError("The completed field plan advanced after this recording was bound; "
                         "retain the original course and bind a new edition to the current inspection")
    if "presentation" in frozen:
        from model.field_report_presentation import inspect_selection
        inspect_selection(workspace, choice["operation_id"], frozen["presentation"])
    return {**choice, "path": str(path.resolve())}


def bind_campaign(workspace, receipt, output, *, presentation=None):
    operation_id = receipt.get("fieldwork_operation_id")
    if operation_id is None:
        return None
    operation_id = identifier(operation_id)
    campaign = inspect_campaign(workspace, operation_id)
    if (campaign.get("phase") != "closeout"
            or campaign["original_project_id"] != workspace.project["id"]
            or campaign["plan_id"] != receipt.get("fieldwork_plan_id")):
        raise ValueError("Complete this original field campaign before recording its QC chapter")
    if presentation is not None:
        from model.field_report_presentation import inspect_selection
        supplied = read_json(Path(presentation)) if isinstance(presentation, (str, Path)) else presentation
        campaign = {**campaign, "presentation": inspect_selection(workspace, operation_id, supplied)}
    path = Path(output) / PATH
    current = Path(output)
    current.mkdir(parents=True, exist_ok=True)
    for part in Path(PATH).parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise ValueError("The field recording destination became an alias")
        current.mkdir(exist_ok=True)
    if path.is_symlink():
        raise ValueError("The original field inspection became an alias")
    atomic_bytes(path, canonical(campaign) + b"\n", immutable=True)
    choice = {"path": PATH, "bytes": path.stat().st_size, "sha256": file_digest(path),
              "operation_id": operation_id, "plan_id": campaign["plan_id"],
              "project_id": workspace.project["id"]}
    verify_choice(workspace, output, choice)
    return choice
