"""Retain operator field choices against an existing native source and saved plans.

The retained original study remains the scientific producer. This module only
receives its exported selection and prepares an editable copy of its own desk.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

from .common import atomic_bytes, describe_file, digest, file_digest, held, relative_file, verify_file
from .monitoring_workspace import MonitoringWorkspace

COLLECTION = "monitoring_field_selections"
RECIPE = "upstate.monitoring-field-selection-retention/1"
SELECTION = "upstate.monitoring-field-selection/v1"
SUPPORT = "upstate.monitoring-field-support/v1"
MAX_SELECTION_BYTES = 100000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "The selection repeats a JSON member: " + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError("The selection must contain finite JSON values")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)


def _path(workspace, descriptor):
    path = relative_file(workspace.root, descriptor["object"])
    require(path.stat().st_size == descriptor["bytes"] and file_digest(path) == descriptor["sha256"],
            "An original field-study source member changed")
    return path


def _body(workspace, descriptor):
    return _path(workspace, descriptor).read_bytes()


def source(workspace, source_collection_id, source_id):
    """Read and verify retained objects directly; receiving never creates source views."""
    collection = workspace._get("sources", source_collection_id)
    entries = [entry for entry in collection["entries"] if entry["id"] == source_id]
    require(len(entries) == 1, "Choose an existing retained field-study source")
    entry = entries[0]
    require(entry.get("kind") == "document" and entry.get("role") == "monitoring_field_support",
            "Choose the original Monitoring field-planning document")
    bodies = [entry["body"], *entry.get("companions", [])]
    support = [body for body in bodies
               if body.get("view_path", body["filename"]) == "field-support.json"]
    require(len(support) == 1, "The original complete field-support.json companion is required")
    # Every original companion travels in the same Workspace; do not replace the
    # source edition with a reduced catalogue or reconstructed scientific data.
    for body in bodies:
        _path(workspace, body)
    data = _json(_body(workspace, support[0]))
    require(data.get("schema") == SUPPORT, "The retained source is not a field-support study")
    require(data.get("id") == sha256(canonical({key: value for key, value in data.items()
                                              if key != "id"})).hexdigest(),
            "The original field-support identity changed")
    require(data.get("project_id") == workspace.project["id"],
            "Receive this field selection in its original scientific project")
    service = MonitoringWorkspace(workspace)
    network = service.get("networks", data["network_id"])
    frontier = service.get("frontiers", data["frontier_id"])
    require(sha256(canonical(network)).hexdigest() == data["network_sha256"],
            "The original native Monitoring network differs")
    require(frontier["network_id"] == network["id"]
            and frontier["plan_ids"] == data["original_plan_ids"],
            "The original saved budget frontier differs")
    require(set(data["plans_sha256"]) == set(frontier["plan_ids"]),
            "The original plan inventory differs")
    study_plans = {plan["plan_id"]: plan for plan in data["plans"]}
    require(len(study_plans) == len(data["plans"]) and set(study_plans) == set(frontier["plan_ids"]),
            "The field study repeats or omits a saved original plan")
    for plan_id in frontier["plan_ids"]:
        plan = service.get("plans", plan_id)
        require(plan["network_id"] == network["id"]
                and sha256(canonical(plan)).hexdigest() == data["plans_sha256"][plan_id],
                "An original native Monitoring plan differs")
        copied = study_plans[plan_id]
        require(copied["selected_ids"] == plan["selected_ids"]
                and copied["original_calendar"] == plan["calendar"]
                and copied["original_cost"] == plan["cost"]
                and str(copied["budget_usd"]) == str(plan["configuration"]["budget"]),
                "The field study must retain the exact original plan, calendar and planning costs")
    binding = {"source_collection_id": source_collection_id, "source_id": source_id,
               "document_sha256": entry["body"]["sha256"],
               "support_sha256": support[0]["sha256"], "support_id": data["id"],
               "network_id": network["id"], "network_sha256": data["network_sha256"],
               "frontier_id": frontier["id"], "companion_count": len(entry.get("companions", []))}
    return data, entry, binding


def validate(data, value):
    require(isinstance(value, dict) and value.get("schema") == SELECTION,
            "Choose a saved Monitoring field selection JSON")
    require(value.get("support_id") == data["id"] and value.get("project_id") == data["project_id"]
            and value.get("frontier_id") == data["frontier_id"],
            "The selection names another project, source edition or original frontier")
    plans = [plan for plan in data["plans"] if plan["plan_id"] == value.get("plan_id")]
    require(len(plans) == 1, "The selected original plan is absent from this field study")
    plan = plans[0]
    require(str(value.get("budget_usd")) == str(plan["budget_usd"]),
            "The selected original budget differs")
    require(isinstance(value.get("choices"), dict) and isinstance(value.get("notes"), dict),
            "The choice and field-note inventories must be JSON objects")
    candidates = {"observation:" + row["id"]: row for row in data["microbial_stations"]}
    candidates.update({"assessment:" + row["id"]: row for row in data["assessment_stations"]})
    selected = set(plan["selected_ids"])
    for huc, key in value["choices"].items():
        require(huc in selected and isinstance(key, str) and key in candidates
                and candidates[key]["huc12"] == huc,
                "A chosen source station does not belong to its selected search area")
    for huc, note in value["notes"].items():
        require(huc in selected and isinstance(note, str)
                and len(note.encode("utf-16-le")) // 2 <= 2000,
                "A field note must belong to the selected plan and contain at most 2,000 characters")
    rounds = value.get("rounds")
    allowed = {row["round"] for row in plan["original_calendar"]["rounds"]}
    require(isinstance(rounds, list) and all(type(item) is int and item in allowed for item in rounds)
            and len(rounds) == len(set(rounds)), "Choose a subset of the original calendar rounds")
    visits = [deepcopy(row) for row in plan["original_calendar"]["visits"] if row["round"] in rounds]
    locations = [{"huc12": huc, "candidate_key": key, "source_kind": key.split(":", 1)[0],
                  "station": deepcopy(candidates[key])} for huc, key in sorted(value["choices"].items())]
    return {"plan_id": plan["plan_id"], "budget_usd": plan["budget_usd"],
            "selected_search_areas": len(plan["selected_ids"]), "selected_stations": len(locations),
            "field_notes": len([note for note in value["notes"].values() if note]),
            "rounds": rounds, "visits": len(visits), "calendar": visits, "locations": locations,
            "meaning": "Source-station choices for field review; original campaign assignments remain separate"}


def preview(workspace, *, source_collection_id, source_id, selection_text, title=""):
    require(isinstance(selection_text, str), "Read the original exported selection as UTF-8 text")
    raw = selection_text.encode("utf-8")
    require(0 < len(raw) <= MAX_SELECTION_BYTES, "Choose a complete selection of at most 100,000 bytes")
    value = _json(raw)
    data, entry, binding = source(workspace, source_collection_id, source_id)
    summary = validate(data, value)
    require(isinstance(title, str) and len(title.strip()) <= 200, "Use a field-selection title of at most 200 characters")
    return {"recipe": RECIPE, "project_id": workspace.project["id"],
            "title": title.strip() or "Field selection — $" + str(summary["budget_usd"]),
            "selection": value, "selection_sha256": sha256(raw).hexdigest(),
            "selection_bytes": len(raw), "source": binding, "summary": summary}


def _editable_desk(original, selection, selection_sha256):
    """Initialize the original delivered controls; retain its complete source separately."""
    text = original.decode("utf-8")
    storage = "KEY='monitoring-field-selection:'+D.id"
    finish = "fillRecordOptions();updateAll();"
    require(text.count(storage) == 1 and text.count(finish) == 1,
            "This original field desk needs its maintained selection-opening join before receiving")
    encoded = json.dumps(selection, ensure_ascii=False, separators=(",", ":"),
                         allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    text = text.replace(storage, storage + "+':" + selection_sha256 + "'")
    opening = ("const receivedSelection=validateSelection(" + encoded + ");"
               "planIndex=receivedSelection.index;"
               "if(!states[plan().plan_id])states[plan().plan_id]=receivedSelection.next;"
               "currentArea=plan().selected_ids[0];")
    return text.replace(finish, opening + finish).encode("utf-8")


def receive(workspace, **selection):
    result = preview(workspace, **selection)
    raw = selection["selection_text"].encode("utf-8")
    original = workspace._get("sources", result["source"]["source_collection_id"])
    entry = next(item for item in original["entries"] if item["id"] == result["source"]["source_id"])
    desk = _editable_desk(_body(workspace, entry["body"]), result["selection"], result["selection_sha256"])
    artifact_id = digest({"recipe": RECIPE, "source": result["source"],
                          "selection_sha256": result["selection_sha256"], "desk_sha256": sha256(desk).hexdigest()})
    root = workspace.root / "monitoring-field-selections" / artifact_id
    with held(workspace.root / ".monitoring-field-selections.lock"):
        atomic_bytes(root / "selection.json", raw, immutable=True)
        atomic_bytes(root / "field-planning.html", desk, immutable=True)
        files = [describe_file(workspace.root, root / "selection.json", label="Original editable selection JSON"),
                 describe_file(workspace.root, root / "field-planning.html", label="Open selected field-planning desk")]
        return workspace._save(COLLECTION, {**result, "files": files})


def inspect(workspace, selection_id):
    record = workspace._get(COLLECTION, selection_id)
    require(record.get("recipe") == RECIPE and record["project_id"] == workspace.project["id"],
            "The saved field selection belongs to another project or recipe")
    data, entry, binding = source(workspace, record["source"]["source_collection_id"], record["source"]["source_id"])
    require(binding == record["source"] and validate(data, record["selection"]) == record["summary"],
            "The retained field-selection source or review details differ")
    paths = {Path(item["path"]).name: verify_file(workspace.root, item) for item in record["files"]}
    require(set(paths) == {"selection.json", "field-planning.html"}, "The saved field-selection file inventory differs")
    raw = paths["selection.json"].read_bytes()
    require(len(raw) == record["selection_bytes"] and sha256(raw).hexdigest() == record["selection_sha256"]
            and _json(raw) == record["selection"], "The original saved selection bytes differ")
    expected = _editable_desk(_body(workspace, entry["body"]), record["selection"], record["selection_sha256"])
    require(paths["field-planning.html"].read_bytes() == expected, "The selected working desk differs")
    return record


def catalog(workspace):
    sources = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry.get("kind") == "document" and entry.get("role") == "monitoring_field_support":
                sources.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                "title": entry["title"], "vintage": entry.get("vintage", ""),
                                "sha256": entry["body"]["sha256"]})
    return {"sources": sources, "selections": [
        {key: record[key] for key in ("id", "title", "project_id", "selection", "source", "selection_sha256")}
        for record in workspace._list(COLLECTION)]}


def verify_workspace(workspace):
    records = workspace._list(COLLECTION)
    for record in records:
        inspect(workspace, record["id"])
    return {"monitoring_field_selections": len(records)}
