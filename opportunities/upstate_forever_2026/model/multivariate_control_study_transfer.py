"""Typed editable control designs behind original selected studies/reports."""
from __future__ import annotations

from .common import digest, identifier
from . import multivariate_control_outcome_transfer as outcomes

KIND = "multivariate-controls"
ROOT_KINDS = (KIND, *outcomes.ROOT_KINDS)
DOCUMENTS = {KIND: "design.json", **outcomes.DOCUMENTS}
LOCKS = {KIND: ".design.lock", **outcomes.LOCKS}
LABELS = {KIND: "Matched-control designs", **outcomes.LABELS}
URI = "urn:upstate:multivariate-control:"


def visit(closure, kind, key, value):
    if kind != KIND:
        return outcomes.visit(closure, kind, key, value)
    from . import multivariate_control as controls
    from . import geographic_study_transfer as geographic
    checked = controls.inspect(closure.workspace, key)
    if {k: v for k, v in checked.items() if k != "adoption"} != value:
        raise ValueError("The selected control design changed during capture")
    prefix = KIND + "/" + identifier(key)
    closure.tree(prefix)
    bound = value["binding"]
    for name in ("baseline_run_id", "restoration_run_id"):
        closure.need("runs", bound[name], "Original matched-control cohort")
    closure.need("grids", bound["grid_id"], "Original matched-control grid")
    closure.need("profiles", bound["profile_id"], "Original matched-control profile")
    closure.need("sources", value["source"]["source_collection_id"], "Complete design and assessment source")
    closure._source_refs(bound, "Original matched-control scientific inputs")
    geographic._footprint(closure, bound["restoration_footprint_id"], bound["restoration_run_id"])
    if checked.get("adoption"):
        adoption = checked["adoption"]
        closure.need("scenarios", adoption["scenario_id"], "Adopted original control scenario")
        closure.need("runs", adoption["run_id"], "Adopted original control run")
        closure.need("experiments", adoption["experiment_id"], "Original control experiment and progress")
        geographic._footprint(closure, adoption["footprint_id"], adoption["run_id"])
    return True


def lock_paths(closure):
    yield from outcomes.lock_paths(closure)
    for kind, key in sorted(closure.nodes):
        if kind == KIND:
            yield KIND + "/" + key + "/.design.lock"
            yield KIND + "/" + key + "/.adopt.lock"


def include_source(closure, collection_id, entry):
    uri = entry.get("uri", "")
    if not isinstance(uri, str) or not uri.startswith(URI):
        return outcomes.include_source(closure, collection_id, entry)
    key = identifier(uri[len(URI):])
    metadata = entry.get("metadata") or {}
    if (entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT"
            or metadata.get("report_schema") != "upstate.observed-report/v1"
            or metadata.get("multivariate_control_id") != key):
        raise ValueError("Original matched-control scientific source identity changed")
    bodies = [entry["body"], *entry.get("companions", [])]
    members = {}
    for body in bodies:
        name = body.get("view_path", body["filename"])
        if name in members:
            raise ValueError("Control source repeats a native member")
        members[name] = body
        closure.add_file(body["object"], body)
    recipe = closure.read(entry["body"]["object"])
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ValueError("Control source is not its original scientific recipe")
    expected = {r["path"]: (r["bytes"], r["sha256"]) for r in recipe["inputs"]}
    actual = {name: (body["bytes"], body["sha256"]) for name, body in members.items()
              if body is not entry["body"]}
    if expected != actual or len(expected) != len(recipe["inputs"]):
        raise ValueError("Control source lost its full assessment/mask companions")
    assessment_body = members.get("assessment.json")
    if assessment_body is None:
        raise ValueError("Control source lost the original assessment")
    assessment = closure.read(assessment_body["object"])
    if (assessment.get("id") != key or digest(assessment["identity"]) != key
            or assessment["identity"]["project_id"] != metadata.get("project_id")):
        raise ValueError("Control source assessment differs from the original design")
    lineage = {"source_collection_id": collection_id, "source_id": entry["id"],
               "report_context_kind": "multivariate_control",
               "project_id": metadata["project_id"], "design_id": key,
               "assessment_sha256": assessment_body["sha256"],
               "relationship": "same_project" if metadata["project_id"] == closure.workspace.project["id"] else "external"}
    if lineage["relationship"] == "same_project":
        record = closure.read(KIND + "/" + key + "/design.json")
        if (record["identity"] != assessment["identity"] or record["summary"] != assessment["summary"]
                or record["strata"] != assessment["strata"] or record["balance"] != assessment["balance"]):
            raise ValueError("Selected control source no longer matches its native design")
        native = {r["path"].removeprefix(KIND + "/" + key + "/"): (r["bytes"], r["sha256"])
                  for r in record["files"]}
        if any(native.get(name) != (body["bytes"], body["sha256"]) for name, body in members.items()):
            raise ValueError("Equivalent imported control source differs from the complete original native edition")
        closure.need(KIND, key, "Editable design behind selected control report")
    closure.report_source_records[(collection_id, entry["id"])] = lineage
    return True
