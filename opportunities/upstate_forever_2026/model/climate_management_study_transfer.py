"""Carry original climate-management comparisons in selected editable Studies.

The saved report is immutable. Its parent forcing families use their maintained
visitor, including unfinished cases, exact original source editions and frozen
report membership. This module never recalculates a result or discovers GIS receipts.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier
from . import climate_management, climate_forcing

KIND = climate_management.ROOT
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "record.json"}
LOCKS = {KIND: ".report.lock"}
LABELS = {KIND: "Climate and management comparisons"}
SCHEMA = "upstate.climate-management-study-lineage/v1"


def _file(closure, name):
    value = closure.files[name]
    return {"path": name, "bytes": value["bytes"], "sha256": value["sha256"]}


def _selection(closure, key):
    frozen = closure.climate_management_selection
    if frozen is None:
        return None
    matches = [item for item in frozen if item.get("report_id") == key]
    if len(matches) != 1:
        raise ValueError("The received Study lost its captured climate-management root")
    return matches[0]


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    key = identifier(key)
    prefix = KIND + "/" + key
    retained = _selection(closure, key)
    record_name, snapshot_name = prefix + "/record.json", prefix + "/snapshot.json"
    if retained is not None:
        if (retained.get("schema") != SCHEMA or retained.get("workspace_id") != closure.workspace.project["id"]
                or retained.get("report_id") != key):
            raise ValueError("The captured management report belongs to another original Workspace")
        closure.add_file(record_name, retained["record"])
    record = climate_management.get_report(closure.workspace, key, verify=False)
    if value != record or closure.read(record_name) != record:
        raise ValueError("The selected management report changed during capture")
    snapshot = closure.read(snapshot_name)
    if snapshot != record["identity"] or digest(snapshot) != key:
        raise ValueError("The original management snapshot changed")
    expected_names = sorted([record_name, *[prefix + "/" + item["path"]
                                         for item in record["files"].values()]])
    if len(expected_names) != len(set(expected_names)):
        raise ValueError("The original management report repeats a portable member")
    if retained is not None:
        if retained.get("members") != expected_names:
            raise ValueError("The received management report changed its captured file membership")
    for name, item in record["files"].items():
        closure.add_file(prefix + "/" + name, item)
    selected_studies = sorted(snapshot["studies"])
    for study_id in selected_studies:
        identifier(study_id)
        original = closure.read(climate_forcing.ROOT + "/" + study_id + "/selection.json")
        if original != snapshot["studies"][study_id]:
            raise ValueError("The saved benefit changed its original forcing-family selection")
        closure.need(climate_forcing.ROOT, study_id, "Original management comparison forcing family")
    periods = snapshot["selection"]["periods"]
    roles = snapshot["roles"]
    explicit = {(period["id"], role): period[role] for period in periods for role in roles}
    cells = snapshot["cells"]
    if len(cells) != len(explicit) or len({(cell["period_id"], cell["role"]) for cell in cells}) != len(cells):
        raise ValueError("The management report changed its complete period/role matrix")
    for cell in cells:
        pair = {"study_id": cell["study_id"], "case_id": cell["case_id"]}
        if explicit.get((cell["period_id"], cell["role"])) != pair:
            raise ValueError("A report role no longer names its explicit original forcing case")
        run_id = identifier(cell["run_id"])
        run = cell["run"]
        if (run.get("id") != run_id or digest(run["selection"]) != run_id or run.get("state") != "complete"
                or run["selection"].get("scenario_id") != cell["scenario_id"]
                or run["selection"].get("grid_id") != cell["grid_id"]):
            raise ValueError("The retained comparison changed a completed native case")
        closure.need("runs", run_id, "Original annual mass used in the management comparison")
        closure._native_selection(run["selection"], "Original forcing and management inputs")
        current = closure.read("runs/" + run_id + "/run.json")
        if current.get("selection") != run["selection"]:
            raise ValueError("The selected management run changed its original native inputs")
        for metric in snapshot["outputs"]:
            artifact = run["artifacts"][metric]
            actual = current.get("artifacts", {}).get(metric)
            if actual is None or any(actual.get(name) != artifact.get(name)
                                     for name in ("path", "bytes", "sha256", "units")):
                raise ValueError("The management report lost an original annual mass output")
            closure.add_file("runs/" + run_id + "/" + artifact["path"], artifact)
        landcover = cell.get("landcover_artifact")
        if landcover is not None:
            actual = current.get("stages", {}).get("landcover", {}).get("artifact")
            if actual is None or any(actual.get(name) != landcover.get(name)
                                     for name in ("path", "bytes", "sha256")):
                raise ValueError("The management report lost its original prepared scenario land cover")
            closure.add_file("runs/" + run_id + "/" + landcover["path"], landcover)
    # Includes actual forcing, inherited base inputs and independently selected
    # reporting polygons. Source visitors retain complete CAS originals/companions.
    closure._source_refs(snapshot, "Original climate-management source selections")
    source = record["source"]
    closure.need("sources", source["source_collection_id"], "Complete ordinary Scientific Report and GIS companions")
    source_record = closure.read("sources/" + identifier(source["source_collection_id"]) + ".json")
    original_manifest = source_record["original_manifest"]
    closure.add_file(original_manifest["object"], original_manifest)
    if closure.read(original_manifest["object"]) != closure.read(prefix + "/sources.json"):
        raise ValueError("The management result changed its original source manifest")
    result = {"schema": SCHEMA, "report_id": key, "workspace_id": closure.workspace.project["id"],
              "selection": deepcopy(snapshot["selection"]),
              "reference_period_id": snapshot["selection"]["reference_period_id"],
              "study_ids": selected_studies, "record": _file(closure, record_name),
              "snapshot": _file(closure, snapshot_name), "members": expected_names,
              "source": deepcopy(source)}
    if retained is not None and result != retained:
        raise ValueError("The received Study changed its original management comparison")
    closure.climate_management_records[key] = result
    closure.nodes[(KIND, key)].update(state="complete", periods=len(periods),
                                    scenario_roles=len(roles), completed_runs=len(cells),
                                    source_studies=len(selected_studies))
    return True


def receipt(closure):
    return [deepcopy(value) for _, value in sorted(closure.climate_management_records.items())]


def verify_receipt(closure, retained):
    if receipt(closure) != retained:
        raise ValueError("The received Study changed its captured climate-management reports")


def lock_paths(closure):
    return [KIND + "/" + identifier(key) + "/.report.lock"
            for key in sorted(closure.climate_management_records)]


def catalogue(workspace):
    rows = []
    for path in sorted((workspace.root / KIND).glob("*/record.json")):
        key = identifier(path.parent.name)
        try:
            record = climate_management.get_report(workspace, key, verify=False)
            rows.append({"kind": KIND, "id": key, "title": record["title"], "state": "complete",
                         "updated_at": "", "view": "climate-management",
                         "selection": {"reference_period_id": record["selection"]["reference_period_id"],
                                       "models": record["models"]},
                         "counts": {"periods": len(record["selection"]["periods"]),
                                    "roles": len(record["roles"]), "runs": len(record["cohort"])}})
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"kind": KIND, "id": key, "title": key[:16], "state": "unreadable",
                         "updated_at": "", "error": {"message": str(error)}})
    return rows
