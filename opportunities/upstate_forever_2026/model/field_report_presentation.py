"""Select readable editions of the original retained field QC/action reports.

Selection reads the native report bank. It never edits a completed field step,
sample, reviewer decision, source registration, or earlier report.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from . import implementation_qc as qc
from . import implementation_qc_actions as actions
from .common import atomic_bytes, canonical, describe_file, digest, identifier, read_json
from .implementation import ImplementationStore
from .implementation_schema import ImplementationError
from .portable_implementation import report_edition
from .simulated_fieldwork import inspect_campaign

SELECTION_SCHEMA = "upstate.field-report-presentation-selection/v1"
SCHEMA = "upstate.field-report-presentation/v1"
KINDS = {"qc": (qc, "report_id", "qc-sources.json", "review"),
         "actions": (actions, "action_report_id", "qc-actions-sources.json", "action_review")}


def _ordinary(root, relative):
    """Keep every selected native member under its exact ordinary Workspace."""
    root = Path(root).resolve(strict=True)
    value = Path(relative)
    if value.is_absolute() or not value.parts or any(part in ("", ".", "..") for part in value.parts):
        raise ImplementationError("Select an original Workspace-relative presentation member.")
    path = root
    for part in value.parts:
        path = path / part
        if path.is_symlink():
            raise ImplementationError("A retained presentation member became a file alias.")
    if not path.is_file() or not path.resolve(strict=True).is_relative_to(root):
        raise ImplementationError("A retained presentation member is unavailable.")
    return path


def _inspect_pair(workspace, plan_id, kind, original_id, selected_id):
    module, id_key, source_name, value_key = KINDS[kind]
    store = ImplementationStore(workspace)
    original = module.inspect(workspace, plan_id, original_id)
    selected = module.inspect(workspace, plan_id, selected_id)
    for field in ("plan_id", "revision", value_key):
        if original[field] != selected[field]:
            raise ImplementationError("A presentation must retain the complete original review and native revision.")
    if kind == "actions" and (original["report_id"] != selected["report_id"]
                              or original["receipt"] != selected["receipt"]):
        raise ImplementationError("Keep the original action-to-QC relationship and decision receipt.")
    original_directory = _ordinary(store.root, original["directory"] + "/manifest.json").parent
    selected_directory = _ordinary(store.root, selected["directory"] + "/manifest.json").parent
    before_edition = report_edition(store, original_directory)
    after_edition = report_edition(store, selected_directory)
    before = read_json(original_directory / "manifest.json")
    after = read_json(selected_directory / "manifest.json")
    relation = after.get("presentation_successor")
    if not isinstance(relation, dict) or relation.get("original_report_id") != original_id:
        raise ImplementationError("Select an explicitly retained presentation successor of this original report.")
    renderer_sha256 = identifier(relation.get("renderer_sha256"))
    if not isinstance(relation.get("scope"), str) or not relation["scope"].strip():
        raise ImplementationError("Retain the original presentation scope.")
    original_meta = {key: value for key, value in before.items()
                     if key not in ("files", "presentation_successor")}
    selected_meta = {key: value for key, value in after.items()
                     if key not in ("files", "presentation_successor")}
    if original_meta != selected_meta:
        raise ImplementationError("A presentation changed original report metadata.")
    old_files = {row["name"]: row for row in before["files"]}
    new_files = {row["name"]: row for row in after["files"]}
    if set(old_files) != set(new_files):
        raise ImplementationError("Retain every original report filename in its presentation.")
    changed_names = {"report.html", "observed-report.json", source_name}
    for name in old_files:
        old_path = _ordinary(store.root, original["directory"] + "/" + name)
        new_path = _ordinary(store.root, selected["directory"] + "/" + name)
        before_item = old_files[name]
        after_item = new_files[name]
        if ({key: value for key, value in before_item.items() if key not in ("size_bytes", "sha256")}
                != {key: value for key, value in after_item.items() if key not in ("size_bytes", "sha256")}):
            raise ImplementationError("A presentation changed original file metadata.")
        if name not in changed_names and old_path.read_bytes() != new_path.read_bytes():
            raise ImplementationError("A presentation changed original scientific or field content: " + name)
    # Validate the exact existing source-descriptor update, not merely an
    # allow-list of filenames. Source roles, original IDs and other inputs stay.
    html_descriptor = describe_file(selected_directory, selected_directory / "report.html")
    old_observed = read_json(original_directory / "observed-report.json")
    expected_observed = copy.deepcopy(old_observed)
    inputs = expected_observed.get("inputs")
    if not isinstance(inputs, list) or sum(row.get("path") == "report.html" for row in inputs) != 1:
        raise ImplementationError("The original report lacks its unique HTML source binding.")
    expected_observed["inputs"] = [
        {**row, **html_descriptor} if row.get("path") == "report.html" else row for row in inputs]
    if read_json(selected_directory / "observed-report.json") != expected_observed:
        raise ImplementationError("A presentation changed the original scientific report recipe.")
    old_sources = read_json(original_directory / source_name)
    expected_sources = copy.deepcopy(old_sources)
    entries = expected_sources.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ImplementationError("The original report source manifest is incomplete.")
    observed_descriptor = describe_file(selected_directory, selected_directory / "observed-report.json")
    for entry in entries:
        if entry.get("path") != "observed-report.json":
            raise ImplementationError("Preserve the original supported report-source family.")
        entry.update(observed_descriptor)
        companions = entry.get("companions")
        if not isinstance(companions, list) or sum(row.get("path") == "report.html" for row in companions) != 1:
            raise ImplementationError("The original scientific source lacks its HTML companion.")
        entry["companions"] = [
            {**row, **html_descriptor} if row.get("path") == "report.html" else row for row in companions]
    if read_json(selected_directory / source_name) != expected_sources:
        raise ImplementationError("A presentation changed original source relationships or companion bindings.")
    # Native inspectors cover original manifest membership and saved plan bytes;
    # explicit paths here additionally reject aliases before portable selection.
    for row in original["files"] + selected["files"]:
        path = _ordinary(store.root, row["path"])
        if describe_file(store.root, path) != row:
            raise ImplementationError("A selected native report changed during presentation inspection.")
    return {
        "kind": kind, "plan_id": plan_id, "revision": original["revision"],
        "original_report_id": original_id, "presentation_report_id": selected_id,
        "original_qc_report_id": original["report_id"] if kind == "actions" else original_id,
        "renderer_sha256": renderer_sha256, "scope": relation["scope"],
        "original_manifest_sha256": before_edition["manifest_sha256"],
        "presentation_manifest_sha256": after_edition["manifest_sha256"],
        "original_files": original["files"], "presentation_files": selected["files"],
    }


def inspect_selection(workspace, field_operation_id, supplied):
    """Validate all five explicitly selected original presentation successors."""
    field_operation_id = identifier(field_operation_id)
    if not isinstance(supplied, dict):
        raise ImplementationError("Choose an explicit saved field presentation selection.")
    retained = supplied if supplied.get("schema") == SCHEMA else None
    selection = retained.get("selection") if retained is not None else supplied
    if not isinstance(selection, dict) or set(selection) != {"schema", "field_operation_id", "reports"}:
        raise ImplementationError("Use the complete field presentation selection shape.")
    if selection["schema"] != SELECTION_SCHEMA or selection["field_operation_id"] != field_operation_id:
        raise ImplementationError("Select the original completed field operation.")
    campaign = inspect_campaign(workspace, field_operation_id)
    if campaign["phase"] != "closeout" or campaign["original_project_id"] != workspace.project["id"]:
        raise ImplementationError("Complete this original native field campaign before choosing its presentation.")
    expected = [("qc", row["report_id"]) for row in campaign["qc_reports"]]
    expected += [("actions", row["action_report_id"]) for row in campaign["action_reports"]]
    if len(expected) != 5 or len(set(expected)) != 5:
        raise ImplementationError("Retain the original two QC and three action reports.")
    rows = selection["reports"]
    if not isinstance(rows, list) or len(rows) != len(expected):
        raise ImplementationError("Explicitly choose a presentation for each of the five original reports.")
    by_key = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"kind", "original_report_id", "presentation_report_id"}:
            raise ImplementationError("Use an exact original-to-presentation report pair.")
        key = (row["kind"], identifier(row["original_report_id"]))
        selected_id = identifier(row["presentation_report_id"])
        if key not in expected or key in by_key or selected_id == key[1]:
            raise ImplementationError("Select each original report once with its distinct readable successor.")
        by_key[key] = selected_id
    if len(set(by_key.values())) != len(expected):
        raise ImplementationError("Each selected presentation must retain its own original report.")
    normalized = {"schema": SELECTION_SCHEMA, "field_operation_id": field_operation_id,
                  "reports": [{"kind": kind, "original_report_id": original,
                               "presentation_report_id": by_key[(kind, original)]}
                              for kind, original in expected]}
    result = {
        "schema": SCHEMA, "field_operation_id": field_operation_id,
        "project_id": workspace.project["id"], "plan_id": campaign["plan_id"],
        "selection": normalized,
        "reports": [_inspect_pair(workspace, campaign["plan_id"], kind, original,
                                  by_key[(kind, original)]) for kind, original in expected],
    }
    result["presentation_id"] = digest(result)
    if retained is not None and canonical(result) != canonical(retained):
        raise ImplementationError("The retained presentation selection or original report bytes changed.")
    return result


def capture(workspace, field_operation_id, supplied, destination):
    """Retain one portable explicit choice outside the original Workspace."""
    result = inspect_selection(workspace, field_operation_id, supplied)
    path = Path(destination).expanduser().absolute()
    root = Path(workspace.root).resolve(strict=True)
    if path.resolve().is_relative_to(root):
        raise ImplementationError("Retain the recording selection outside the original Workspace.")
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise ImplementationError("The presentation selection destination became a file alias.")
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_bytes(path, canonical(result) + b"\n", immutable=True)
    if canonical(inspect_selection(workspace, field_operation_id, read_json(path))) != canonical(result):
        raise ImplementationError("The retained field presentation changed during capture.")
    return result


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--field-operation", required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path,
                        help="New complete portable selection JSON outside the original Workspace")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    supplied = read_json(args.selection)
    result = (capture(workspace, args.field_operation, supplied, args.output) if args.output
              else inspect_selection(workspace, args.field_operation, supplied))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
