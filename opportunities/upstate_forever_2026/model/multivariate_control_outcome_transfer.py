"""Editable outcome groups behind original selected studies and scientific sources.

TokenJunkieLabs. Uses the original view-free native inspector and typed designs.
"""
from __future__ import annotations

from .common import digest, identifier

KIND = "multivariate-control-outcomes"
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "outcome.json"}
LOCKS = {KIND: ".outcome.lock"}
LABELS = {KIND: "Matched-control outcomes"}
URI = "urn:upstate:multivariate-control-outcomes:"


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    from . import multivariate_control_outcomes as outcomes
    checked = outcomes.inspect(closure.workspace, key)
    if checked != value:
        raise ValueError("The selected native outcome group changed during capture")
    closure.tree(KIND + "/" + identifier(key))
    for design_id in value["selection"]["design_ids"]:
        closure.need("multivariate-controls", design_id, "Original editable design and complete native outcome cohort")
    closure.need("sources", value["source"]["source_collection_id"], "Complete outcome report, maps and data source")
    return True


def lock_paths(closure):
    for kind, key in sorted(closure.nodes):
        if kind == KIND:
            yield KIND + "/" + key + "/.outcome.lock"


def include_source(closure, collection_id, entry):
    uri = entry.get("uri", "")
    if not isinstance(uri, str) or not uri.startswith(URI):
        return False
    key = identifier(uri[len(URI):])
    metadata = entry.get("metadata") or {}
    if (entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT"
            or metadata.get("report_schema") != "upstate.observed-report/v1"
            or metadata.get("multivariate_control_outcomes_id") != key):
        raise ValueError("Original matched-control outcome source identity changed")
    members = {}
    for body in [entry["body"], *entry.get("companions", [])]:
        name = body.get("view_path", body["filename"])
        if name in members:
            raise ValueError("Outcome source repeats a retained member")
        members[name] = body
        closure.add_file(body["object"], body)
    recipe = closure.read(entry["body"]["object"])
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ValueError("Outcome source is not its original scientific recipe")
    expected = {row["path"]: (row["bytes"], row["sha256"]) for row in recipe["inputs"]}
    actual = {name: (body["bytes"], body["sha256"]) for name, body in members.items()
              if body is not entry["body"]}
    if expected != actual or len(expected) != len(recipe["inputs"]):
        raise ValueError("Outcome source lost original maps, tables, design bindings or report companions")
    descriptor = members.get("assessment.json")
    if descriptor is None:
        raise ValueError("Outcome source lost its frozen assessment")
    assessment = closure.read(descriptor["object"])
    if (assessment.get("schema") != "upstate.multivariate-control-outcomes/v1"
            or assessment.get("state") != "complete" or assessment.get("id") != key
            or digest(assessment["identity"]) != key
            or assessment["identity"]["project_id"] != metadata.get("project_id")
            or assessment["selection"] != assessment["identity"]["selection"]
            or assessment["binding"] != assessment["identity"]["binding"]
            or assessment["selection"]["design_ids"] != metadata.get("design_ids")):
        raise ValueError("Outcome source differs from its exact retained group")
    lineage = {"source_collection_id": collection_id, "source_id": entry["id"],
               "report_context_kind": "multivariate_control_outcomes",
               "project_id": metadata["project_id"], "outcome_id": key,
               "assessment_sha256": descriptor["sha256"],
               "relationship": "same_project" if metadata["project_id"] == closure.workspace.project["id"] else "external"}
    if lineage["relationship"] == "same_project":
        record = closure.read(KIND + "/" + key + "/outcome.json")
        if any(record.get(name) != value for name, value in assessment.items()):
            raise ValueError("Selected outcome source no longer matches its native complete assessment")
        prefix = KIND + "/" + key + "/"
        native = {row["path"].removeprefix(prefix): (row["bytes"], row["sha256"])
                  for row in record["files"]}
        if any(native.get(name) != (body["bytes"], body["sha256"]) for name, body in members.items()):
            raise ValueError("Equivalent outcome source differs from the full original native edition")
        closure.need(KIND, key, "Editable native outcome group behind selected scientific report")
    closure.report_source_records[(collection_id, entry["id"])] = lineage
    return True
