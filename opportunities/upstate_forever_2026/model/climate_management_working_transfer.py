"""Capture original unfinished Climate management histories through the existing Study archive."""
from __future__ import annotations
from copy import deepcopy
from .common import digest, identifier
from . import climate_management_working as working

KIND = working.KIND


def capture(closure, revision_id):
    key = identifier(revision_id)
    package = working.export_package(closure.workspace, key)
    records = getattr(closure, "climate_management_working_records", None)
    if records is None:
        records = {}
        closure.climate_management_working_records = records
    for original in package["records"]:
        member = KIND + "/" + original["id"] + ".json"
        raw = closure.read(member)
        if {**raw, "id": original["id"]} != original:
            raise ValueError("The original working revision changed during capture")
        fixed = original["bindings"]
        for study in fixed["studies"]:
            path = "climate-forcing-studies/" + study["id"] + "/selection.json"
            if closure.read(path) != study["identity"]:
                raise ValueError("A working role changed its original forcing-study selection")
            closure.need("climate-forcing-studies", study["id"], "Original working management role and complete forcing family")
        for source in fixed["sources"]:
            closure.need("sources", source["id"], "Original working reporting source and all companions")
        token = (KIND, original["id"])
        closure.nodes.setdefault(token, {"kind": KIND, "id": original["id"], "title": original["name"],
                                        "state": "working", "reasons": ["Original complete working history"]})
    head = package["records"][-1]
    records[key] = {"revision_id": key, "series_id": head["series_id"], "revision": head["revision"],
                    "name": head["name"], "author": head["author"], "note": head["note"],
                    "project_id": head["project_id"], "history_sha256": digest(package),
                    "history_ids": [row["id"] for row in package["records"]],
                    "study_ids": [row["id"] for row in head["bindings"]["studies"]],
                    "reference_period_id": head["draft"]["selection"]["reference_period_id"]}
    return records[key]


def visit(closure, kind, key, value, reason):
    if kind != KIND:
        return False
    capture(closure, key)
    closure.nodes[(kind, key)]["title"] = value["name"]
    return True


def receipt(closure):
    return [deepcopy(row) for _, row in sorted(getattr(closure, "climate_management_working_records", {}).items())]


def verify_receipt(closure, original):
    if receipt(closure) != original:
        raise ValueError("The received Study changed its original Climate management working histories")


def catalogue(workspace):
    return [{"kind": KIND, "id": row["id"], "title": row["name"],
             "state": "working", "updated_at": row["created_at"],
             "selection": {"series_id": row["series_id"], "revision": row["revision"], "author": row["author"]}}
            for row in working.list_series(workspace)]


def augment(closure, identity, result):
    original = identity.get("climate_management_working", [])
    verify_receipt(closure, original)
    result["climate_management_working"] = deepcopy(original)
    result["climate_management_working_count"] = len(original)
    return result
