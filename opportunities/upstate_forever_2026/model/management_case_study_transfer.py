"""Editable named management designs in the original selected-Study archive.

The immutable design, exact sourced-profile materialization and actual experiment
plans retain their original identities. No native model is prepared or executed.
Received receipts freeze their selected experiment cohort; subsequent work does
not silently expand an older exported Study.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .common import canonical, digest, identifier, read_json
from . import management_cases

KIND = management_cases.KIND
ROOT_KINDS = (KIND,)
IMMUTABLE_KINDS = (KIND,)
LABELS = {KIND: "Management designs"}
SCHEMA = "upstate.management-case-study-lineage/v1"
MARKER = re.compile(r"(?:^|\s)Retained management design: ([0-9a-f]{64})(?![0-9a-f])")


def _file(closure, name):
    value = closure.files[name]
    return {"path": name, "bytes": value["bytes"], "sha256": value["sha256"]}


def _captured(closure, key):
    selected = closure.management_case_selection
    if selected is None:
        return None
    matches = [row for row in selected if row.get("id") == key]
    if len(matches) != 1:
        raise ValueError("The received Study lost its selected management design")
    return matches[0]


def _design_ids(plan):
    reason = plan.get("selection", {}).get("reason", "")
    return MARKER.findall(reason) if isinstance(reason, str) else []


def _experiment(closure, key, design, retained=None):
    key = identifier(key)
    name = "experiments/" + key + "/plan.json"
    if retained is not None:
        closure.add_file(name, retained["plan"])
    value = closure.read(name)
    profiles = {row["profile_id"] for row in design["profiles"]}
    profiles.add(design["baseline_profile_id"])
    selection = value.get("selection", {})
    if (value.get("schema") != "upstate.experiment-plan/v1"
            or digest(value) != key
            or value.get("workspace_id") != closure.workspace.project["id"]
            or _design_ids(value) != [design["id"]]
            or value.get("baseline", {}).get("profile_id") not in profiles
            or not set(selection.get("profile_ids", [])).issubset(profiles)
            or selection.get("axes") != []):
        raise ValueError("A management experiment differs from its original design and profile cohort")
    # Read the actual baseline selection, including a treatment used as the
    # reference of a matched comparison. A matching name alone is insufficient.
    baseline_id = identifier(value["baseline"]["run_id"])
    baseline = closure.read("runs/" + baseline_id + "/run.json")
    if (baseline.get("id") != baseline_id
            or digest(baseline.get("selection")) != baseline_id
            or baseline["selection"]["profile_id"] != value["baseline"]["profile_id"]):
        raise ValueError("The management experiment changed its original native reference")
    closure.need("experiments", key, "Original experiment explicitly bound to this management design")
    result = {"id": key, "plan": _file(closure, name)}
    if retained is not None and result != retained:
        raise ValueError("The captured management experiment plan changed")
    return result


def _discover_experiments(closure, design):
    result = []
    if not closure.selection["include_related_results"]:
        return result
    for path in sorted((closure.root / "experiments").glob("*/plan.json")):
        # Unrelated experiments do not become this design's dependencies.
        # A selected original marker must still pass the full typed validation.
        try:
            value = read_json(path)
            if not isinstance(value, dict):
                raise ValueError("The additional experiment is not an original plan")
        except (OSError, ValueError, TypeError) as error:
            closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(),
                                           "message": str(error)})
            continue
        if design["id"] in _design_ids(value):
            result.append(_experiment(closure, path.parent.name, design))
    return result


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    key = identifier(key)
    if (value.get("schema") != "upstate.management-cases/v1" or digest(value) != key
            or value.get("workspace_id") != closure.workspace.project["id"]):
        raise ValueError("The selected management design changed its original identity")
    design = management_cases.inspect(closure.workspace, key)
    if canonical(design) != canonical({**value, "id": key}):
        raise ValueError("The management design changed during Study capture")
    retained = _captured(closure, key)
    prefix = "sourced-profiles/" + identifier(design["profile_set_id"])
    selection_name, state_name = prefix + "/selection.json", prefix + "/state.json"
    definition = closure.read(selection_name)
    expected = management_cases.preview(closure.workspace, design["selection"])["profile_preview"]
    if canonical(definition) != canonical(expected):
        raise ValueError("The editable management profiles lost their original preparation selection")
    state = closure.read(state_name)
    if (state.get("id") != design["profile_set_id"]
            or state.get("workspace_id") != closure.workspace.project["id"]
            or state.get("state") != "complete"
            or canonical(state.get("profiles")) != canonical(design["profiles"])
            or state.get("profile_ids") != design["profile_ids"]):
        raise ValueError("The retained management profile materialization differs")
    record_name = KIND + "/" + key + ".json"
    closure.need("profiles", design["baseline_profile_id"], "Original management reference profile")
    for row in design["profiles"]:
        profile_id = identifier(row["profile_id"])
        closure.need("profiles", profile_id, "Original named management profile")
        profile = closure.read("profiles/" + profile_id + ".json")
        if digest(profile) != profile_id:
            raise ValueError("The management profile changed its original identity")
        if not row["is_baseline"]:
            derivation = profile.get("experiment_derivation", {})
            if (derivation.get("base_profile_id") != design["baseline_profile_id"]
                    or derivation.get("profile_set_id") != design["profile_set_id"]
                    or derivation.get("configuration_id") != row["configuration_id"]):
                raise ValueError("The management profile lost its exact original derivation")
        closure._source_refs(row, "Original management coefficient table and cell lineage")
        closure._descriptors(row.get("files", {}), prefix + "/")
    if retained is None:
        members = closure._tree_members(prefix)
        closure.trees[prefix] = members
        experiments = _discover_experiments(closure, design)
    else:
        members = retained.get("profile_members")
        if (not isinstance(members, list) or len(set(members)) != len(members)
                or any(not isinstance(name, str) or not name.startswith(prefix + "/") for name in members)):
            raise ValueError("The captured management profile directory changed selection")
        selected = retained.get("experiments")
        if (not isinstance(selected, list) or len({row["id"] for row in selected}) != len(selected)):
            raise ValueError("The received Study has an invalid management experiment cohort")
        experiments = [_experiment(closure, row["id"], design, row) for row in selected]
    required_members = {selection_name, state_name}
    for row in design["profiles"]:
        required_members.update(prefix + "/" + item["path"] for item in row.get("files", {}).values())
    if not required_members.issubset(members):
        raise ValueError("The selected Study omitted an original management table or lineage member")
    for name in members:
        closure.add_file(name)
    # Materialization can safely update its progress timestamps on resume.
    # Bind its immutable definition/profiles, not the mutable state.json bytes.
    result = {
        "schema": SCHEMA, "id": key, "workspace_id": closure.workspace.project["id"],
        "title": design["selection"]["title"],
        "baseline_profile_id": design["baseline_profile_id"],
        "profile_set_id": design["profile_set_id"],
        "table_sha256": design["selection"]["expected_table_sha256"],
        "profile_count": len(design["profiles"]),
        "case_count": len(design["selection"]["practices"]) + len(design["selection"]["combinations"]),
        "configuration_count": len(design["cases"]),
        "profile_ids": [row["profile_id"] for row in design["profiles"]],
        "record": _file(closure, record_name),
        "profile_selection": _file(closure, selection_name),
        "profile_members": list(members),
        "experiments": experiments, "experiment_ids": [row["id"] for row in experiments],
        "editable": True,
        "relationship": "Exact saved design, sourced-profile identities and explicitly bound native experiments",
    }
    if retained is not None and result != retained:
        raise ValueError("The received management Study changed its captured design lineage")
    closure.management_case_records[key] = result
    closure.nodes[(KIND, key)].update(
        state="prepared", profile_count=result["profile_count"],
        case_count=result["case_count"], experiment_count=len(experiments),
        view="profile-workbench")
    return True


def related(closure):
    # Historical receipts without this family are not retrospectively expanded.
    if closure.management_case_selection is not None:
        for row in closure.management_case_selection:
            closure.need(KIND, row["id"], "Management design retained in the original Study receipt")
        return
    for kind, key in list(closure.nodes):
        if kind != "experiments":
            continue
        plan = closure.read("experiments/" + key + "/plan.json")
        for design_id in _design_ids(plan):
            closure.need(KIND, design_id, "Saved design explicitly named by this original experiment")


def receipt(closure):
    return [deepcopy(row) for _, row in sorted(closure.management_case_records.items())]


def verify_receipt(closure, retained):
    if receipt(closure) != retained:
        raise ValueError("The received Study changed its original management-design selection")


def lock_paths(closure):
    return sorted({"sourced-profiles/" + identifier(row["profile_set_id"]) + "/.profiles.lock"
                   for row in closure.management_case_records.values()})


def receiving_summary(identity):
    return {"management_case_count": len(identity.get("management_case_studies", []))}


def augment_receiving(closure, retained, result):
    selected = retained["identity"].get("management_case_studies", [])
    verify_receipt(closure, selected)
    result["management_case_studies"] = receipt(closure)


def catalogue(workspace):
    rows = []
    for path in sorted((workspace.root / KIND).glob("*.json")):
        key = identifier(path.stem)
        try:
            design = management_cases.inspect(workspace, key)
            rows.append({
                "kind": KIND, "id": key, "title": design["selection"]["title"],
                "state": "prepared", "updated_at": "",
                "selection": {"profile_id": design["baseline_profile_id"],
                              "management_case_id": key, "profile_set_id": design["profile_set_id"],
                              "table_sha256": design["selection"]["expected_table_sha256"]},
                "counts": {"profiles": len(design["profiles"]),
                           "cases": len(design["selection"]["practices"]) + len(design["selection"]["combinations"]),
                           "configurations": len(design["cases"])},
                "view": "profile-workbench", "error": None,
            })
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"kind": KIND, "id": key, "title": key[:16], "state": "unreadable",
                         "updated_at": "", "error": {"message": str(error)}})
    return rows
