"""Reopen geographic cases already retained by the original Study closure.

Dependency capture and its scientific validation belong to
geographic_study_transfer. This reader exposes only exact prepared-case members
in that resolved selection, using the received project's original file paths.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .common import describe_file, digest, identifier

CASE_PATH = re.compile(r"geographic-headwaters/([0-9a-f]{64})/prepared\.json")
SCHEMA = "upstate.received-geographic-case/v1"
MEMBERS = (
    ("prepared.json", "Original prepared geographic case"),
    ("inputs/geographic-selection.json", "Original native geographic selection"),
    ("inputs/geographic-binding.json", "Original geographic support and source binding"),
    ("inputs/assumptions.json", "Declared physical and model assumptions"),
    ("inputs/input-receipt.json", "Complete original input receipt"),
    ("inputs/sources.json", "Original input source manifest"),
    ("inputs/biophysical.csv", "Original nutrient and sediment coefficients"),
)


def _member(closure, selected_members, path, label):
    if path not in selected_members:
        raise ValueError("The selected Study omitted an original geographic member: " + path)
    descriptor = describe_file(closure.root, closure.root / path)
    closure.add_file(path, descriptor)
    return {**descriptor, "label": label}


def augment(closure, retained, result):
    """Expose the original editable cases already selected by the native resolver."""
    selected_members = frozenset(closure.files)
    paths = [(name, CASE_PATH.fullmatch(name)) for name in selected_members]
    cases = []
    for path, match in sorted(paths):
        if match is None:
            continue
        key = identifier(match.group(1))
        prefix = "geographic-headwaters/" + key
        case = closure.read(path)
        receipt_path = prefix + "/inputs/input-receipt.json"
        if receipt_path not in selected_members:
            raise ValueError("The received geographic case needs its original input receipt.")
        receipt = closure.read(receipt_path)
        identity = receipt.get("identity")
        if (case.get("schema") != "upstate.geographic-headwaters-prepared/v1"
                or case.get("id") != key
                or case.get("state") != "prepared"
                or case.get("project_id") != closure.workspace.project["id"]
                or case.get("directory") != prefix
                or not isinstance(identity, dict)
                or identity.get("schema") != "upstate.geographic-headwaters/v1"
                or identity.get("id") != key
                or digest({name: value for name, value in identity.items() if name != "id"}) != key
                or identity.get("project_id") != case["project_id"]
                or identity.get("selection") != case.get("selection")
                or identity.get("geographic_binding") != case.get("geography")
                or receipt.get("geography") != case.get("geography")
                or receipt.get("input_summary") != case.get("input_summary")):
            raise ValueError("The received geographic case differs from its retained producer selection.")
        required = {
            ("sources", identifier(case["source_collection_id"])),
            ("grids", identifier(case["grid_id"])),
            ("profiles", identifier(case["profile_id"])),
            ("scenarios", identifier(case["baseline_scenario_id"])),
            ("runs", identifier(case["baseline_run_id"])),
            ("ensembles", identifier(case["ensemble_id"])),
        }
        required.update(("scenarios", identifier(value)) for value in case["alternative_scenario_ids"])
        required.update(("runs", identifier(value)) for value in case["alternative_run_ids"])
        if not required.issubset(closure.nodes):
            raise ValueError("The selected geographic Study lost its original editable native dependencies.")
        selection_path = prefix + "/inputs/geographic-selection.json"
        binding_path = prefix + "/inputs/geographic-binding.json"
        if (selection_path not in selected_members or binding_path not in selected_members
                or closure.read(selection_path) != case["selection"]
                or closure.read(binding_path) != case["geography"]):
            raise ValueError("The received geographic downloads differ from the prepared case.")
        value = deepcopy(case)
        value.update(
            receiving_schema=SCHEMA,
            title=case["selection"]["title"],
            study_id=retained["id"],
            members=[_member(closure, selected_members, prefix + "/" + name, label) for name, label in MEMBERS],
        )
        cases.append(value)
    result["geographic_cases"] = cases
    result["geographic_case_count"] = len(cases)
    return result
