"""Open the exact native-ensemble lineage retained by a selected Study.

This reader uses the existing Study resolver and original source package. It
does not prepare, compare, rerun, register or change the saved model study.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

CONTEXT = "native_ensemble_study"
SCHEMA = "upstate.received-native-ensemble/v1"


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    return {
        "native_ensemble_source_count": len(rows),
        "editable_native_ensemble_count": len({
            row["ensemble_id"] for row in rows if row.get("relationship") == "same_project"
        }),
    }


def _member(closure, item, *, label=None):
    path = item.get("object", item.get("path"))
    if not isinstance(path, str):
        raise ValueError("The received native source lost an original member path.")
    closure.add_file(path, item)
    actual = closure.files[path]
    if actual.get("sha256") is None:
        closure.read(path)
        actual = closure.files[path]
    return {"path": path, "bytes": actual["bytes"], "sha256": actual["sha256"],
            "label": label or item.get("view_path") or item.get("filename")
                     or PurePosixPath(path).name}


def _entry(closure, captured):
    key = identifier(captured["source_collection_id"])
    collection = closure.read("sources/" + key + ".json")
    if not isinstance(collection, dict) or digest(collection) != key:
        raise ValueError("The received native study changed its original source edition.")
    found = [entry for entry in collection.get("entries", [])
             if entry.get("id") == captured["source_id"]]
    if len(found) != 1:
        raise ValueError("The received native study lost its original scientific source.")
    entry = found[0]
    metadata = entry.get("metadata") or {}
    if (entry["body"]["sha256"] != captured["source_body_sha256"]
            or metadata.get("source_basis") != "saved_native_ensemble"
            or metadata.get("ensemble_id") != captured["ensemble_id"]
            or metadata.get("source_operation_id") != captured["source_operation_id"]):
        raise ValueError("The received native study changed its original source binding.")
    return entry


def _original(closure, members, name):
    item = members.get(name)
    if item is None:
        raise ValueError("The received native source lacks its original " + name)
    descriptor = _member(closure, item, label=name)
    return closure.read(descriptor["path"])


def augment(closure, retained, result):
    """Join the existing verified received-Study detail before assert_unchanged."""
    identity = retained["identity"]
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    resolved = getattr(closure, "report_source_records", {})
    result.update(summary(identity))
    result["native_ensemble_sources"] = []
    for captured in rows:
        token = (captured["source_collection_id"], captured["source_id"])
        if resolved.get(token) != captured:
            raise ValueError("The received Study changed its original native-ensemble lineage.")
        entry = _entry(closure, captured)
        source = {"source_collection_id": token[0], "source_id": token[1]}
        members = {}
        for item in entry.get("companions", []):
            name = item.get("view_path", item.get("filename"))
            if not isinstance(name, str) or name in members:
                raise ValueError("The received native source repeats an original companion.")
            members[name] = item
        recipe = closure.read(_member(closure, entry["body"])["path"])
        basis = recipe.get("basis")
        if (basis != captured["selection"] or digest(basis) != captured["source_operation_id"]):
            raise ValueError("The received native source changed its scientific report selection.")
        plan = _original(closure, members, "original/ensemble.json")
        content = _original(closure, members, "numeric/report.json")
        release = _original(closure, members, "numeric/release.json")
        report = content.get("report", {})
        if (plan.get("id") != captured["ensemble_id"]
                or content.get("ensemble_id") != plan["id"]
                or digest(content) != captured["report_id"]
                or release.get("id") != captured["report_id"]
                or release.get("ensemble_id") != plan["id"]
                or report.get("id") != plan["id"]
                or report.get("run_signature") != basis["run_signature"]
                or report.get("members") != plan.get("members")):
            raise ValueError("The received native source changed its captured physical results.")
        local = captured["relationship"] == "same_project"
        if local:
            if captured["source_project_id"] != closure.workspace.project["id"]:
                raise ValueError("Editable native lineage belongs to another original project.")
            key = identifier(plan["id"])
            original = closure.read("ensembles/" + key + ".json")
            expected = {name: value for name, value in plan.items() if name != "id"}
            if digest(original) != key or original != expected:
                raise ValueError("The received native design differs from its original report.")
            required = {("ensembles", key)}
            required.update(("runs", run["run_id"]) for member in plan["members"]
                            for run in member["runs"])
            actual = {(item["kind"], item["id"]) for item in captured["required_records"]}
            if not required.issubset(actual):
                raise ValueError("The received native lineage lost its editable run cohort.")
        elif captured["relationship"] != "external_project":
            raise ValueError("Choose an original native-study source relationship.")
        source_members = [_member(closure, entry["body"], label="Original scientific source recipe")]
        source_members.extend(_member(closure, item, label=name)
                              for name, item in sorted(members.items()))
        numeric_members = [_member(closure, item, label=name.removeprefix("numeric/"))
                           for name, item in sorted(members.items()) if name.startswith("numeric/")]
        # These are the captured report values, including partial/undefined rows,
        # source support hashes, original units and alternative-minus-baseline sign.
        # Do not substitute a newer latest-report pointer from the editable design.
        result["native_ensemble_sources"].append({
            "schema": SCHEMA, "source": source,
            "title": plan.get("title") or entry.get("title") or "Saved native model study",
            "source_project_id": captured["source_project_id"],
            "source_body_sha256": captured["source_body_sha256"],
            "relationship": captured["relationship"],
            "ensemble_id": plan["id"], "report_id": captured["report_id"],
            "source_operation_id": captured["source_operation_id"],
            "grid_id": plan["grid_id"],
            "lineage": deepcopy(captured),
            "report_ids": [row["id"] for row in result.get("reports", [])
                           if source in row.get("source_choices", [])],
            "model_scope": deepcopy(report.get("model_scope") or plan.get("model_scope") or {}),
            "state": report.get("state"), "member_count": len(plan["members"]),
            "alternative_count": len(plan.get("alternative_scenario_ids", [])),
            "landcover_rows": len(report.get("rows", [])),
            "parameter_rows": len(report.get("sensitivity", [])),
            "run_ids": list(dict.fromkeys(run["run_id"] for member in plan["members"]
                                         for run in member["runs"])),
            "source_members": source_members, "numeric_members": numeric_members,
            "captured": {"ensemble": deepcopy(plan), "summary": deepcopy(report),
                         "release": deepcopy(release)},
        })
    return result
