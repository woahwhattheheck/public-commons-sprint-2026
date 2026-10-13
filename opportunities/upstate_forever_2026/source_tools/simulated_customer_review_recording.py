"""Bind complete original customer-review exports to the existing recorded course."""
from pathlib import Path

from model.common import atomic_bytes, file_digest, identifier
from model.simulated_customer_review import inspect_export, inspect_review

IDS = ("operation_id", "original_review_id", "response_id", "planning_handback_id",
       "revised_review_id", "handback_id")
DIRECTORY = "uploads/simulated-customer-review"


def validate_choice(choice):
    if (not isinstance(choice, dict)
            or set(choice) != {"directory", "manifest", "selected"}
            or choice["directory"] != DIRECTORY
            or not isinstance(choice["manifest"], dict)
            or set(choice["manifest"]) != {"bytes", "sha256"}
            or not isinstance(choice["selected"], dict)
            or set(choice["selected"]) != {"project_id", *IDS}):
        raise ValueError("Retain the original complete customer teaching descriptor")
    for key in IDS:
        identifier(choice["selected"][key])
    if not isinstance(choice["selected"]["project_id"], str) or not choice["selected"]["project_id"]:
        raise ValueError("Retain the original customer project ID")
    item = choice["manifest"]
    identifier(item["sha256"])
    if isinstance(item["bytes"], bool) or not isinstance(item["bytes"], int) or item["bytes"] <= 0:
        raise ValueError("Retain the complete original customer manifest length")
    return choice


def verify_choice(workspace, output, choice):
    validate_choice(choice)
    directory = Path(output) / choice["directory"]
    current = Path(output)
    for part in choice["directory"].split("/"):
        current = current / part
        if current.is_symlink():
            raise ValueError("The retained customer teaching directory became an alias")
    manifest = directory / "case-manifest.json"
    if (manifest.is_symlink() or not manifest.is_file()
            or manifest.stat().st_size != choice["manifest"]["bytes"]
            or file_digest(manifest) != choice["manifest"]["sha256"]):
        raise ValueError("The complete original customer manifest changed")
    exported = inspect_export(directory)
    selected = choice["selected"]
    if workspace.project["id"] != selected["project_id"]:
        raise ValueError("Select this same original scientific customer project")
    original = inspect_review(workspace, selected["operation_id"])
    if original.get("phase") != "ready":
        raise ValueError("Finish the selected original engineering handback")
    for key, value in selected.items():
        if exported.get(key) != value or original.get(key) != value:
            raise ValueError("The customer chapter lost its original " + key)
    return {"directory": str(directory.resolve()), "manifest": choice["manifest"],
            "selected": selected}


def bind_case(workspace, receipt, output, *, source=None):
    reference = receipt.get("customer_review")
    if reference is None:
        return None
    packages = receipt.get("customer_review_packages")
    if not isinstance(reference, dict) or not isinstance(packages, dict):
        raise ValueError("Retain the original ready customer export beside this demo receipt")
    directory = Path(source if source is not None else packages["directory"]).expanduser().resolve(strict=True)
    exported = inspect_export(directory)
    expected = {key: value for key, value in packages.items()
                if key not in {"directory", "original_index", "handback_index"}}
    if exported != expected:
        raise ValueError("The selected customer export differs from the complete original receipt")
    selected = {"project_id": workspace.project["id"], **{key: reference[key] for key in IDS}}
    for key, value in selected.items():
        if exported.get(key) != value:
            raise ValueError("The original customer export differs from " + key)
    destination = Path(output) / DIRECTORY
    # Keep a complete immutable companion in the original recorded course. Retry
    # reuses exact retained bytes and all native package checks, without exporting
    # a newer review generation or creating additional customer records.
    target_root = destination.resolve()
    if target_root != directory and (target_root.is_relative_to(directory) or directory.is_relative_to(target_root)):
        raise ValueError("Keep the customer source and copied companion separate")
    current = Path(output)
    current.mkdir(parents=True, exist_ok=True)
    for part in DIRECTORY.split("/"):
        current = current / part
        if current.is_symlink():
            raise ValueError("The customer companion destination contains an alias")
        current.mkdir(exist_ok=True)
    for path in ([] if target_root == directory else sorted(directory.rglob("*"))):
        if path.is_symlink():
            raise ValueError("The complete customer export contains a file alias")
        target = destination / path.relative_to(directory)
        if target.is_symlink():
            raise ValueError("The retained customer companion member became an alias")
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            atomic_bytes(target, path.read_bytes(), immutable=True)
        else:
            raise ValueError("The complete customer export contains an unsupported member")
    manifest = destination / "case-manifest.json"
    choice = {"directory": DIRECTORY,
              "manifest": {"bytes": manifest.stat().st_size, "sha256": file_digest(manifest)},
              "selected": selected}
    verify_choice(workspace, output, choice)
    return choice
