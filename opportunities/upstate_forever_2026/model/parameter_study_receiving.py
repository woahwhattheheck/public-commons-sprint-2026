"""Original Parameter studies in the selected-Study receiving view.

Frozen report inputs stay tied to their captured edition. Same-project sources
also open the retained editable study through the ordinary Parameter studies desk.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier
from . import parameter_study_transfer as transfer

SCHEMA = "upstate.received-parameter-study/v1"


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == transfer.CONTEXT]
    return {
        "parameter_study_source_count": len(rows),
        "editable_parameter_study_count": len({
            row["experiment_id"] for row in rows
            if row.get("relationship") == "same_project"
        }),
    }


def _member(closure, item, label):
    path = item.get("object", item.get("path"))
    if not isinstance(path, str):
        raise ValueError("The received Parameter source lost an original member path.")
    closure.add_file(path, item)
    actual = closure.files[path]
    if actual.get("sha256") is None:
        closure.read(path)
        actual = closure.files[path]
    return {"path": path, "bytes": actual["bytes"], "sha256": actual["sha256"],
            "filename": item.get("filename") or PurePosixPath(label or path).name,
            "label": label or item.get("filename") or PurePosixPath(path).name}


def _state(state):
    cases = state["cases"]
    counts = Counter(row.get("state") or "unspecified" for row in cases)
    return {
        "state": state.get("state"), "case_count": len(cases),
        "case_states": dict(sorted(counts.items())),
        "progress": deepcopy(state.get("progress", {})),
        "comparison_id": state.get("comparison_id"),
    }


def augment(closure, retained, result):
    """Use the same verified source resolver and exact original source members."""
    identity = retained["identity"]
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == transfer.CONTEXT]
    result.update(summary(identity))
    result["parameter_study_sources"] = []
    for captured in rows:
        token = (captured["source_collection_id"], captured["source_id"])
        if closure.report_source_records.get(token) != captured:
            raise ValueError("The received Study changed its original Parameter lineage.")
        collection_id = identifier(token[0])
        collection = closure.read("sources/" + collection_id + ".json")
        if collection.get("schema") != "upstate.sources/v1" or digest(collection) != collection_id:
            raise ValueError("The received Parameter source collection changed.")
        entries = [entry for entry in collection.get("entries", []) if entry.get("id") == token[1]]
        if len(entries) != 1 or entries[0]["body"]["sha256"] != captured["source_body_sha256"]:
            raise ValueError("The received Parameter source lost its exact original document.")
        entry = entries[0]
        recipe, basis, checkpoint, cases, inventory, members, seen = transfer._captured(closure, entry)
        key = identifier(checkpoint["id"])
        if (key != captured["experiment_id"]
                or checkpoint["workspace_id"] != captured["source_project_id"]
                or basis["selection"] != captured["selection"]):
            raise ValueError("The received Parameter report changed its original study selection.")
        local = captured["relationship"] == "same_project"
        current = None
        if local:
            if captured["source_project_id"] != closure.workspace.project["id"]:
                raise ValueError("The editable Parameter study belongs to another original project.")
            required = {(row["kind"], row["id"]) for row in captured["required_records"]}
            if ("parameter-studies", key) not in required or ("parameter-studies", key) not in closure.nodes:
                raise ValueError("The received Parameter source lost its editable study.")
            current = closure.read("experiments/" + key + "/experiment.json")
            if current.get("id") != key or current.get("schema") != transfer.STUDY_SCHEMA:
                raise ValueError("The retained Parameter checkpoint changed its identity.")
        elif captured["relationship"] != "external_project":
            raise ValueError("Choose an original Parameter source relationship.")
        source = {"source_collection_id": collection_id, "source_id": token[1]}
        original_members = [_member(closure, entry["body"], "Scientific source recipe")]
        original_members.extend(_member(closure, item, name)
                                for name, item in sorted(members.items()))
        exported_members = [_member(closure, item, name.removeprefix("original-study/"))
                            for name, item in sorted(members.items())
                            if name.startswith("original-study/")]
        result["parameter_study_sources"].append({
            "schema": SCHEMA, "source": source, "experiment_id": key,
            "title": checkpoint["selection"]["title"],
            "purpose": checkpoint["selection"].get("purpose"),
            "design": checkpoint["selection"].get("design"),
            "source_project_id": captured["source_project_id"],
            "source_body_sha256": captured["source_body_sha256"],
            "source_result_sha256": basis["selection"]["expected_artifact_sha256"],
            "relationship": captured["relationship"], "editable": local,
            "baseline_run_id": checkpoint["selection"]["baseline_run_id"],
            "baseline_selection": deepcopy(checkpoint["baseline_selection"]),
            "models": deepcopy(checkpoint.get("models", [])),
            "pollutants": deepcopy(checkpoint.get("pollutants", [])),
            "selected_case_ids": deepcopy(basis["selection"]["case_ids"]),
            "selected_cases": [{"id": row["id"], "label": row["label"],
                               "run_id": row["run_id"], "profile_id": row["profile_id"],
                               "state": cases[row["id"]].get("state")}
                              for row in basis["cases"]],
            "captured_state": _state(checkpoint),
            "current_state": _state(current) if current is not None else None,
            "source_selection": deepcopy(basis["selection"]),
            "report_ids": [row["id"] for row in result.get("reports", [])
                           if source in row.get("source_choices", [])],
            "source_members": original_members, "result_members": exported_members,
        })
    return result
