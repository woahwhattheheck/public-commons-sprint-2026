"""Bind the completed original simulated QC comparison to the maintained recorder."""
from pathlib import Path

from model.common import atomic_bytes, canonical, file_digest, identifier, read_json, verify_file
from model.simulated_qc_comparison import inspect_comparison

PATH = "uploads/simulated-headwaters/qc-comparison-inspection.json"
IDENTITIES = ("project_id", "plan_id", "comparison_report_id", "comparison_id",
              "operation_id", "field_operation_id")
SCHEMA = "upstate.simulated-qc-comparison/v1"


def validate_choice(choice):
    expected = {"path", "bytes", "sha256", *IDENTITIES}
    if not isinstance(choice, dict) or set(choice) != expected or choice["path"] != PATH:
        raise ValueError("Select the complete original QC-comparison recording descriptor")
    for key in ("sha256", "comparison_report_id", "comparison_id", "operation_id", "field_operation_id"):
        identifier(choice[key])
    if (isinstance(choice["bytes"], bool) or not isinstance(choice["bytes"], int)
            or choice["bytes"] <= 0):
        raise ValueError("Retain the original comparison inspection length")
    if any(not isinstance(choice[key], str) or not choice[key] for key in ("plan_id", "project_id")):
        raise ValueError("Retain the original comparison plan and scientific project")
    return choice


def _identities(current):
    choice = current.get("browser_choice")
    if (current.get("schema") != SCHEMA or current.get("phase") != "complete"
            or not isinstance(choice, dict) or set(choice) != set(IDENTITIES)):
        raise ValueError("Complete this original QC comparison and its scientific source first")
    if choice["project_id"] != current.get("original_project_id"):
        raise ValueError("The comparison browser choice names another original project")
    for key in IDENTITIES[1:]:
        if current.get(key) != choice[key]:
            raise ValueError("The comparison browser choice differs from its original " + key)
    return choice


def verify_choice(workspace, output, choice):
    validate_choice(choice)
    root = Path(output)
    path = root
    if root.is_symlink():
        raise ValueError("Use the original ordinary recording output directory")
    for part in choice["path"].split("/"):
        path = path / part
        if path.is_symlink():
            raise ValueError("The original comparison inspection became a file alias")
    path = verify_file(root, {key: choice[key] for key in ("path", "bytes", "sha256")})
    frozen = read_json(path)
    identities = _identities(frozen)
    if identities != {key: choice[key] for key in IDENTITIES} or workspace.project["id"] != choice["project_id"]:
        raise ValueError("The comparison recording belongs to a different original case")
    # The original consumer verifies both retained QC reports, five journal members,
    # explicit source selection and original field context. Freeze its actual result.
    actual = inspect_comparison(workspace, choice["operation_id"])
    if canonical(actual) != canonical(frozen):
        raise ValueError("The original comparison or field context advanced after this recording "
                         "was bound; retain this course and bind the current original edition separately")
    return {**choice, "path": str(path.resolve())}


def bind_comparison(workspace, receipt, output):
    supplied = receipt.get("qc_comparison")
    if supplied is None:
        return None
    if not isinstance(supplied, dict):
        raise ValueError("Retain the complete original qc_comparison receipt")
    current = inspect_comparison(workspace, identifier(supplied.get("operation_id")))
    identities = _identities(current)
    if (_identities(supplied) != identities
            or supplied.get("report_source") != current.get("report_source")
            or supplied.get("archive_selection") != current.get("archive_selection")
            or identities["field_operation_id"] != receipt.get("fieldwork_operation_id")
            or identities["plan_id"] != receipt.get("fieldwork_plan_id")
            or identities["project_id"] != workspace.project["id"]):
        raise ValueError("The recording receipt differs from its exact field/QC comparison")
    root = Path(output)
    if root.is_symlink():
        raise ValueError("Use the original ordinary receiving directory")
    root.mkdir(parents=True, exist_ok=True)
    directory = root
    for part in Path(PATH).parts[:-1]:
        directory = directory / part
        if directory.is_symlink():
            raise ValueError("The comparison recording destination became an alias")
        directory.mkdir(exist_ok=True)
    path = root / PATH
    if path.is_symlink():
        raise ValueError("The comparison recording inspection became an alias")
    atomic_bytes(path, canonical(current) + b"\n", immutable=True)
    choice = {"path": PATH, "bytes": path.stat().st_size, "sha256": file_digest(path), **identities}
    verify_choice(workspace, root, choice)
    return choice
