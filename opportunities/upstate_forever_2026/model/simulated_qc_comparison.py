"""Compare the original saved reviews in the completed simulated field case.

Needs expert review. Pairing and interpretation belong to the explicitly
authored teaching case. Native QC source, values and reviewer actions remain
unchanged. This consumer never creates a Workspace or runs a scientific model.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re

from . import implementation_qc as qc
from . import implementation_qc_comparison as comparison
from . import observed_context
from . import simulated_fieldwork as field
from .implementation import _file_lock
from .implementation_schema import ImplementationError, canonical_bytes

SCHEMA = "upstate.simulated-qc-comparison/v1"
EDITION = "simulated-qc-comparison-20261013-v1"
HEX = re.compile(r"[a-f0-9]{64}")
BEFORE_STEP = "04-initial-qc"
AFTER_STEP = "09-repeat-qc"
BEFORE_GROUP = "right-initial-duplicate"
AFTER_GROUP = "right-repeat-duplicate"


def _clone(value):
    return copy.deepcopy(value)


def _digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _context(workspace, field_operation_id):
    """Select the two named original steps, never guess a pair from group order."""
    case = field.inspect_campaign(workspace, field_operation_id)
    if (case["phase"] != "closeout" or case["demo_id"] != field.DEMO_ID
            or case["classification"] != field.LABEL):
        raise ImplementationError("Use the completed original simulated field case.")
    root = Path(workspace.root).resolve()
    directory = field._safe(root, case["directory"])
    _, manifest, raw, design, _ = field._inputs(directory / "inputs")
    original = {}
    for side, step, group_id in (
        ("before", BEFORE_STEP, BEFORE_GROUP),
        ("after", AFTER_STEP, AFTER_GROUP),
    ):
        # inspect_campaign verified every original request/result and its full
        # native report before these exact named step records are read.
        receipt = field._read(directory / (step + ".result.json"))
        request = field._read(directory / (step + ".request.json"))
        reference = receipt["result"]
        if (receipt.get("schema") != field.SCHEMA or receipt.get("step") != step
                or receipt.get("request_sha256") != _digest(request)
                or reference["plan_id"] != case["plan_id"]):
            raise ImplementationError("The named original QC step changed.")
        retained = qc.inspect(workspace, case["plan_id"], reference["report_id"])
        if field._qc_ref(retained) != reference:
            raise ImplementationError("The named QC report differs from its original field step.")
        definitions = [row for row in design["relationships"] if row.get("id") == group_id]
        groups = [row for row in retained["review"]["groups"] if row.get("id") == group_id]
        if len(definitions) != 1 or len(groups) != 1:
            raise ImplementationError("The original teaching design requires its named duplicate group.")
        declared, actual = definitions[0], groups[0]
        if (declared.get("kind") != "duplicate"
                or declared.get("relationship") != "field_duplicate"
                or any(actual.get(key) != declared.get(key)
                       for key in ("kind", "relationship", "observation_ids"))
                or actual.get("criterion") != design["criterion"]):
            raise ImplementationError("The retained original duplicate differs from its declared teaching design.")
        original[side] = {**field._qc_ref(retained), "group_id": group_id}
    selection = {
        "schema": comparison.SELECTION,
        "plan_id": case["plan_id"],
        "before_report_id": original["before"]["report_id"],
        "after_report_id": original["after"]["report_id"],
        "title": field.LABEL + " — original and repeat field-duplicate comparison",
        "purpose": "Describe the retained initial and repeat collection precision in the same "
                   "simulated headwaters field case; preserve original criteria and review outcomes.",
        "reviewer": manifest["actor"],
        "as_of": manifest["as_of"],
        "notes": field.LABEL + ". Needs expert review. After means the explicitly selected repeat "
                 "review. A precision difference does not establish environmental change, model "
                 "accuracy, causation, sample acceptance or corrective-task closure.",
        "pairs": [{
            "id": "original-repeat-right-field-duplicate",
            "before_group_id": BEFORE_GROUP,
            "after_group_id": AFTER_GROUP,
            "basis": "The original field-design.json explicitly declares both eastern-tributary "
                     "field-duplicate groups. The initial group precedes the separately retained "
                     "repeat collection recorded in repeat-field-record.md after the original "
                     "corrective task. These are different original sample results.",
            "notes": "Retain the initial exceeded-criterion review, the separate repeat review "
                     "and the censored initial blank. The blank is unpaired; its value is not imputed.",
        }],
    }
    source = {
        "schema": SCHEMA,
        "field_operation_id": field_operation_id,
        "original_project_id": case["original_project_id"],
        "plan_id": case["plan_id"],
        "recipe_sha256": case["recipe_sha256"],
        "inputs_sha256": hashlib.sha256(raw).hexdigest(),
        "input_files": _clone(manifest["files"]),
        "before": original["before"],
        "after": original["after"],
    }
    identity = {
        "schema": SCHEMA,
        "edition": EDITION,
        "original_project_id": case["original_project_id"],
        "field_operation_id": field_operation_id,
        "plan_id": case["plan_id"],
        "original_field_sha256": _digest(source),
        "selection_sha256": _digest(selection),
    }
    return case, source, selection, identity


def _root(workspace, operation_id, *, create=False):
    if not isinstance(operation_id, str) or not HEX.fullmatch(operation_id):
        raise ImplementationError("Use the original simulated comparison operation ID.")
    directory = field._safe(Path(workspace.root).resolve(),
                            "implementation/simulated-qc-comparisons/" + operation_id)
    if create:
        directory.mkdir(parents=True, exist_ok=True)
    if not directory.is_dir():
        raise ImplementationError("The original comparison operation is absent from this Workspace.")
    return directory


def _report_binding(result):
    return {
        "plan_id": result["plan_id"],
        "revision": result["revision"],
        "comparison_report_id": result["comparison_report_id"],
        "comparison_id": result["comparison_id"],
        "comparison_sha256": _digest(result["comparison"]),
        "directory": result["directory"],
        "files": _clone(result["files"]),
    }


def _source_selection(choice):
    if (not isinstance(choice, dict)
            or any(not isinstance(choice.get(key), str) or not choice[key].strip()
                   for key in ("source_collection_id", "source_id"))):
        raise ImplementationError("The comparison lacks its original scientific source identity.")
    selected = {key: choice[key] for key in ("source_collection_id", "source_id")}
    return {"source_roles": {observed_context.ROLE: selected},
            "observed_context_sources": [selected]}


def _inspect(workspace, directory, operation_id, identity, case, source, selection):
    for name, expected in (("identity.json", identity), ("original-field.json", source),
                           ("selection.json", selection)):
        if field._read(directory / name) != expected:
            raise ImplementationError("The retained comparison " + name + " changed.")
    saved_path, source_path = directory / "saved.json", directory / "scientific-source.json"
    saved, choice, bound = None, None, None
    if saved_path.exists():
        receipt = field._read(saved_path)
        if (receipt.get("schema") != SCHEMA or receipt.get("operation_id") != operation_id
                or receipt.get("selection_sha256") != identity["selection_sha256"]):
            raise ImplementationError("The original comparison save receipt changed.")
        original_report = receipt["report"]
        saved = comparison.inspect(workspace, case["plan_id"], original_report["comparison_report_id"])
        if _report_binding(saved) != original_report or saved["comparison"]["selection"] != selection:
            raise ImplementationError("The saved comparison differs from its original teaching selection.")
    if source_path.exists():
        if saved is None:
            raise ImplementationError("A comparison source requires its original saved report.")
        receipt = field._read(source_path)
        if (receipt.get("schema") != SCHEMA or receipt.get("operation_id") != operation_id
                or receipt.get("comparison_report_id") != saved["comparison_report_id"]):
            raise ImplementationError("The original scientific-source receipt changed.")
        choice = receipt["report_source"]
        expected_source_id = "field-qc-comparison-" + saved["comparison_id"][:24]
        if choice.get("source_id") != expected_source_id:
            raise ImplementationError("The retained source belongs to a different comparison.")
        bound = _source_selection(choice)
        bound["observed_context_binding"] = observed_context.bind(workspace, bound)
        if bound != receipt["delivery_selection"]:
            raise ImplementationError("The retained comparison scientific source changed.")
    phase = "complete" if choice else "saved" if saved else "prepared"
    browser_choice = None if saved is None else {
        "project_id": case["original_project_id"],
        "plan_id": case["plan_id"],
        "comparison_report_id": saved["comparison_report_id"],
        "comparison_id": saved["comparison_id"],
        "operation_id": operation_id,
        "field_operation_id": case["operation_id"],
    }
    retained_files = [field._descriptor(Path(workspace.root).resolve(), directory / name)
                      for name in ("identity.json", "original-field.json", "selection.json",
                                   "saved.json", "scientific-source.json")
                      if (directory / name).is_file()]
    archive_identity = None if phase != "complete" else {
        "operation_id": operation_id, "field_operation_id": case["operation_id"],
        "plan_id": case["plan_id"], "comparison_report_id": saved["comparison_report_id"],
        "comparison_id": saved["comparison_id"], "retained_files": _clone(retained_files),
    }
    return {
        "schema": SCHEMA, "edition": EDITION, "phase": phase,
        "operation_id": operation_id, "field_operation_id": case["operation_id"],
        "original_project_id": case["original_project_id"], "plan_id": case["plan_id"],
        "current_revision": case["current_revision"],
        "classification": field.LABEL,
        "original_field": _clone(source), "selection": _clone(selection),
        "comparison_report_id": saved["comparison_report_id"] if saved else None,
        "comparison_id": saved["comparison_id"] if saved else None,
        "comparison": saved,
        "report_source": _clone(choice), "delivery_selection": bound,
        "browser_choice": browser_choice,
        "retained_files": retained_files,
        "archive_selection": {"simulated_qc_comparison": archive_identity} if archive_identity else None,
        "directory": directory.relative_to(Path(workspace.root).resolve()).as_posix(),
        "operating_notes": [
            "Only the two explicitly declared saved teaching groups are paired.",
            "The original censored blank remains unpaired with its source.",
            "Original measurements, scientific review outcomes and corrective decisions remain unchanged.",
            "The existing authenticated Operator supplies its actual workspace_key to browser_choice.",
            "Open and visually inspect the complete outgoing report, both original review ZIPs, "
            "and the receiving application before presenting this edition.",
        ],
    }


def continue_comparison(workspace, field_operation_id):
    """Retain or resume the exact original comparison without editing field records."""
    case, source, selection, identity = _context(workspace, field_operation_id)
    operation_id = _digest(identity)
    directory = _root(workspace, operation_id, create=True)
    with _file_lock(directory / "operation.lock"):
        # Create-only writes preserve interrupted same-operation publication.
        for name, value in (("identity.json", identity), ("original-field.json", source),
                            ("selection.json", selection)):
            field._put(directory / name, value)
        current = _inspect(workspace, directory, operation_id, identity, case, source, selection)
        if current["phase"] == "prepared":
            saved = comparison.save(workspace, selection)
            field._put(directory / "saved.json", {
                "schema": SCHEMA, "operation_id": operation_id,
                "selection_sha256": identity["selection_sha256"],
                "report": _report_binding(saved),
            })
            current = _inspect(workspace, directory, operation_id, identity, case, source, selection)
        if current["phase"] == "saved":
            imported = comparison.scientific_source(workspace, case["plan_id"],
                                                    current["comparison_report_id"])
            field._put(directory / "scientific-source.json", {
                "schema": SCHEMA, "operation_id": operation_id,
                "comparison_report_id": current["comparison_report_id"],
                "report_source": imported["report_source"],
                "delivery_selection": imported["delivery_selection"],
            })
        return _inspect(workspace, directory, operation_id, identity, case, source, selection)


def inspect_comparison(workspace, operation_id):
    """Read the same complete sources after ordinary whole-Workspace receiving."""
    directory = _root(workspace, operation_id)
    identity = field._read(directory / "identity.json")
    if (identity.get("schema") != SCHEMA or identity.get("edition") != EDITION
            or _digest(identity) != operation_id):
        raise ImplementationError("The original simulated comparison identity changed.")
    case, source, selection, expected = _context(workspace, identity["field_operation_id"])
    if expected != identity:
        raise ImplementationError("Select the original project, field case and complete comparison sources.")
    return _inspect(workspace, directory, operation_id, identity, case, source, selection)


def _complete(workspace, operation_id):
    current = inspect_comparison(workspace, operation_id)
    if current["phase"] != "complete":
        raise ImplementationError("Continue the original comparison through its retained scientific source.")
    return current


def attach_to_delivery(workspace, operation_id, delivery_selection):
    """Preserve the selected document and append the five field sources plus comparison.

    Existing source entries and primary-role metadata are retained verbatim.
    Only the ordered observed source selection and its new exact binding change.
    """
    current = _complete(workspace, operation_id)
    case = field.inspect_campaign(workspace, current["field_operation_id"])
    if not isinstance(delivery_selection, dict):
        raise ImplementationError("Supply the original mapped-delivery selection.")
    selected = _clone(delivery_selection)
    existing = observed_context.source_choices(selected)
    explicit = selected.get("observed_context_sources")
    ordered = _clone(explicit) if explicit is not None else _clone(existing)
    identity = lambda value: (value["source_collection_id"], value["source_id"])
    keys = [identity(choice) for choice in existing]
    original = case["observation_context"]["report_source"]
    additions = [original] + [row["report_source"] for row in case["scientific_reports"]]
    if len(additions) != 5:
        raise ImplementationError("The completed original field chapter must retain all five scientific sources.")
    comparison_choice = _source_selection(current["report_source"])["observed_context_sources"][0]
    comparison_key = identity(comparison_choice)
    if comparison_key in keys:
        comparison_position = keys.index(comparison_key)
        if any(identity(choice) not in keys or keys.index(identity(choice)) >= comparison_position
               for choice in additions):
            raise ImplementationError("This delivery already orders the comparison before its five original "
                                      "field sources. Preserve that saved edition and choose the intended "
                                      "original mapped-delivery selection explicitly.")
    for choice in additions + [comparison_choice]:
        normalized = _source_selection(choice)["observed_context_sources"][0]
        key = identity(normalized)
        workspace.source_file(*key)
        if key not in keys:
            keys.append(key)
            ordered.append(normalized)
    roles = selected.setdefault("source_roles", {})
    if roles.get(observed_context.ROLE) is None:
        roles[observed_context.ROLE] = _clone(ordered[0])
    selected["observed_context_sources"] = ordered
    selected.pop("observed_context_binding", None)
    selected["observed_context_binding"] = observed_context.bind(workspace, selected)
    return selected


def attach_to_archive(workspace, operation_id, archive_selection):
    """Bind this actual case into the caller's existing whole-project export identity."""
    current = _complete(workspace, operation_id)
    if not isinstance(archive_selection, dict):
        raise ImplementationError("Supply the complete original project archive selection.")
    selected = _clone(archive_selection)
    key = "simulated_qc_comparison"
    identity = current["archive_selection"][key]
    if key in selected and selected[key] != identity:
        raise ImplementationError("The original archive selection names another comparison. Preserve that "
                                  "saved selection and explicitly choose the new complete archive edition.")
    selected[key] = _clone(identity)
    return selected


def export_comparison(workspace, operation_id, destination):
    """Export the ordinary complete report ZIP using this exact retained case."""
    current = _complete(workspace, operation_id)
    exported = comparison.export(workspace, current["plan_id"],
                                 current["comparison_report_id"], destination)
    return {**exported, "operation_id": operation_id,
            "field_operation_id": current["field_operation_id"],
            "comparison_id": current["comparison_id"]}


def _outside_output(workspace, value):
    path = Path(value).expanduser().absolute()
    if path.resolve().is_relative_to(Path(workspace.root).resolve()):
        raise ImplementationError("Save the outgoing delivery selection outside the original Workspace.")
    if path.is_symlink():
        raise ImplementationError("Use an ordinary outgoing selection file.")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--field-operation", help="Continue the original completed field operation.")
    source.add_argument("--inspect", help="Inspect the same retained comparison operation after receiving.")
    parser.add_argument("--export", help="Complete original comparison ZIP outside the Workspace.")
    parser.add_argument("--delivery-selection", help="Read the existing full mapped-delivery selection JSON.")
    parser.add_argument("--delivery-output", help="Create a new complete outgoing selection JSON.")
    args = parser.parse_args(argv)
    if bool(args.delivery_selection) != bool(args.delivery_output):
        parser.error("--delivery-selection and --delivery-output must be supplied together")
    workspace = Workspace(args.workspace)
    result = (inspect_comparison(workspace, args.inspect) if args.inspect else
              continue_comparison(workspace, args.field_operation))
    if args.export:
        result["archive"] = export_comparison(workspace, result["operation_id"], args.export)
    if args.delivery_selection:
        incoming = field._read(Path(args.delivery_selection).expanduser().absolute())
        selected = attach_to_delivery(workspace, result["operation_id"], incoming)
        output = _outside_output(workspace, args.delivery_output)
        field._put(output, selected)
        result["outgoing_delivery_selection"] = {
            **field._descriptor(output.parent, output), "path": str(output),
        }
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
