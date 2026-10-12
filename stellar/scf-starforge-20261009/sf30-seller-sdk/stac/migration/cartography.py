# SPDX-License-Identifier: MIT
"""Reviewed native map publications in the original GIS migration workspace.

The publication namespace uses Workspace's existing journal and complete file
closure. Native QGIS work is delegated to cartography_native on the caller's
selected QGIS application thread.
"""
from __future__ import annotations

import copy
from decimal import Decimal
import math
from pathlib import Path

from .native import model, files as native_files

SCHEMA = "starforge.migration-cartography.v1"
SPEC_SCHEMA = "starforge.migration-publication-spec.v1"
PLAN_SCHEMA = "starforge.migration-publication-plan.v1"
RESULT_SCHEMA = "starforge.migration-publication.v1"
INPUT_SCHEMA = "starforge.migration-publication-input.v1"
PREFIX = "migration/cartography/"
STATUSES = frozenset(("started", "needs-attention", "complete"))
OUTPUTS = {
    "qgz": ("application/x-qgis-project", "map.qgz"),
    "qpt": ("application/xml", "layout.qpt"),
    "pdf": ("application/pdf", "map.pdf"),
    "png": ("image/png", "map.png"),
    "plan": ("application/json", "publication-plan.json"),
    "receipt": ("application/json", "publication-receipt.json"),
}


def _need(condition, code, message, **details):
    model.require(condition, code, message, **details)


def _text(value, name, maximum=2000, required=False):
    _need(isinstance(value, str) and "\x00" not in value and "[%" not in value and len(value) <= maximum
          and (not required or bool(value.strip())),
          "CARTOGRAPHY_TEXT", "Enter literal publication text without QGIS expression markers.", field=name)
    return value.strip()


def _state(state, create=False):
    migration = state.get("migration")
    if migration is None and not create:
        return {"schema": SCHEMA, "plans": [], "publications": [], "operations": []}
    _need(isinstance(migration, dict), "CARTOGRAPHY_MIGRATION",
          "Open the original migration workspace.")
    value = migration.get("cartography")
    if value is None:
        value = {"schema": SCHEMA, "plans": [], "publications": [], "operations": []}
        if create:
            migration["cartography"] = value
    _need(isinstance(value, dict) and value.get("schema") == SCHEMA,
          "CARTOGRAPHY_SCHEMA", "The retained publication namespace is invalid.")
    return value


def validate(state):
    """Validate only this additive namespace; the original validator owns the rest."""
    value = _state(state)
    project_ids = {row["id"] for row in state.get("projects", [])}
    software_ids = {row["id"] for row in state.get("migration", {}).get("software", [])}
    for kind in ("plans", "publications", "operations"):
        rows = value.get(kind)
        _need(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
              "CARTOGRAPHY_RECORDS", "Keep the complete publication records.", kind=kind)
        _need(all(isinstance(row.get("id"), str) and bool(row["id"]) for row in rows)
              and len({row["id"] for row in rows}) == len(rows),
              "CARTOGRAPHY_IDENTITY", "Publication identities must remain unique.", kind=kind)
        for row in rows:
            _need(isinstance(row.get("requestId"), str) and model.REQUEST.fullmatch(row["requestId"]),
                  "CARTOGRAPHY_REQUEST", "Retain each original publication request.", kind=kind)
            _need(row.get("softwareId") in software_ids, "CARTOGRAPHY_SOFTWARE",
                  "Retain the complete original publisher source for every publication record.", kind=kind)
            _need(isinstance(row.get("files"), list), "CARTOGRAPHY_FILE_CLOSURE",
                  "Retain the complete publication file closure.", kind=kind)
            declared = {}
            for record in row["files"]:
                record = model.descriptor(record)
                _need(record["path"].startswith(PREFIX), "CARTOGRAPHY_FILE_PATH",
                      "Publication files belong to their original workspace namespace.")
                _need(record["path"] not in declared or declared[record["path"]] == record,
                      "CARTOGRAPHY_FILE_CONFLICT", "Keep one exact identity for every retained file.")
                declared[record["path"]] = record
            required = ([row.get("file")] if kind != "operations" else [row.get("inputFile")])
            if kind == "publications":
                required += list(row.get("output", {}).values())
            if kind == "operations" and row.get("resultFile"):
                required.append(row["resultFile"])
            for raw in required:
                record = model.descriptor(raw)
                _need(declared.get(record["path"]) == record, "CARTOGRAPHY_FILE_CLOSURE",
                      "Every original input, result and downloadable output must remain declared.")
    plans = {row["id"]: row for row in value["plans"]}
    publications = {row["id"]: row for row in value["publications"]}
    for row in plans.values():
        _need(row.get("projectId") in project_ids, "CARTOGRAPHY_PROJECT",
              "A publication plan must retain its original saved project.")
        model.descriptor(row["file"])
        previous = row.get("predecessorPublicationId")
        _need(previous is None or previous in publications, "CARTOGRAPHY_PREDECESSOR",
              "Keep the previous publication selected by this correction.")
    for row in publications.values():
        _need(row.get("planId") in plans and row.get("projectId") == plans[row["planId"]]["projectId"],
              "CARTOGRAPHY_PUBLICATION_PLAN", "Keep the original plan and map binding.")
        _need(set(row.get("output", {})) == {"qgz", "qpt", "pdf", "png"},
              "CARTOGRAPHY_OUTPUTS", "Keep all four native publication outputs.")
        for record in [row["file"], *row["output"].values()]:
            model.descriptor(record)
    for row in value["operations"]:
        _need(row.get("planId") in plans and row.get("status") in STATUSES,
              "CARTOGRAPHY_OPERATION", "Keep the original render operation.")
        _need(type(row.get("startingRevision")) is int and row["startingRevision"] >= 0,
              "CARTOGRAPHY_OPERATION_REVISION", "Retain the original starting revision.")
        if row["status"] == "complete":
            _need(row.get("publicationId") in publications, "CARTOGRAPHY_OPERATION_RESULT",
                  "A completed render requires its retained publication.")
    return True


def files(snapshot):
    """Exact additional file descriptors for the inherited complete archive."""
    state = snapshot["state"]
    validate(state)
    records = {}
    for kind in ("plans", "publications", "operations"):
        for row in _state(state)[kind]:
            for raw in row.get("files", []):
                record = model.descriptor(raw)
                prior = records.get(record["path"])
                _need(prior is None or prior == record, "CARTOGRAPHY_FILE_CONFLICT",
                      "A publication path has conflicting retained bytes.", path=record["path"])
                records[record["path"]] = record
    return [records[name] for name in sorted(records)]


def _row(state, kind, identifier):
    result = next((row for row in _state(state)[kind] if row["id"] == identifier), None)
    _need(result is not None, "CARTOGRAPHY_NOT_FOUND",
          "Select an original retained publication record.", kind=kind, id=identifier)
    return result


def _read(workspace, descriptor):
    record = model.descriptor(descriptor)
    path = model.member(workspace.root, record["path"])
    model.file_digest(path, expected=record)
    return model.read_json(path)[0]


def _project(state, project_id):
    result = next((row for row in state.get("projects", []) if row["id"] == project_id), None)
    _need(result is not None, "CARTOGRAPHY_PROJECT_NOT_FOUND",
          "Select a saved native map from this workspace.", projectId=project_id)
    return result


def _project_summary(state, project):
    return {
        "id": project["id"], "title": project.get("title") or state["title"],
        "file": copy.deepcopy(project["file"]), "inputRevision": project["inputRevision"],
        "sourceIds": copy.deepcopy(project["sourceIds"]),
        "projectCrs": copy.deepcopy(project.get("readback", {}).get("projectCrs")),
        "layers": [{key: copy.deepcopy(layer.get(key)) for key in
                    ("id", "label", "kind", "sourceId", "collection", "itemId", "assetKey",
                     "visible", "styleFile")} for layer in project["layers"]],
    }


def inventory(workspace):
    state = workspace.read()
    validate(state)
    value = _state(state)
    return {
        "schema": SCHEMA, "workspaceId": state["id"], "revision": state["revision"],
        "projects": [_project_summary(state, row) for row in reversed(state.get("projects", []))],
        "plans": copy.deepcopy(list(reversed(value["plans"]))),
        "publications": copy.deepcopy(list(reversed(value["publications"]))),
        "operations": copy.deepcopy(list(reversed(value["operations"]))),
    }


def _normalize_spec(state, raw):
    _need(isinstance(raw, dict), "CARTOGRAPHY_SPEC", "Keep the complete publication plan.")
    allowed = {"schema", "projectId", "title", "subtitle", "attribution", "page", "map",
               "legend", "scaleBar", "predecessorPublicationId", "review"}
    _need(set(raw) <= allowed and raw.get("schema", SPEC_SCHEMA) == SPEC_SCHEMA,
          "CARTOGRAPHY_SPEC_FIELDS", "Review the supported publication fields.",
          unknown=sorted(set(raw) - allowed))
    project = _project(state, raw.get("projectId"))
    page = raw.get("page", {})
    map_options = raw.get("map", {})
    legend = raw.get("legend", {})
    scale_bar = raw.get("scaleBar", {})
    review = raw.get("review", {})
    for name, value, keys in (
        ("page", page, {"size", "orientation", "dpi"}),
        ("map", map_options, {"extent", "layerIds", "paddingPercent"}),
        ("legend", legend, {"show", "title"}),
        ("scaleBar", scale_bar, {"show"}),
        ("review", review, {"comparisonSha256", "note"}),
    ):
        _need(isinstance(value, dict) and set(value) <= keys, "CARTOGRAPHY_OPTIONS",
              "Keep the supported publication options.", field=name)
    size, orientation, dpi = page.get("size", "A4"), page.get("orientation", "landscape"), page.get("dpi", 150)
    _need(size in ("A4", "A3") and orientation in ("landscape", "portrait")
          and type(dpi) is int and dpi in (150, 300),
          "CARTOGRAPHY_PAGE", "Choose A4 or A3, page orientation, and 150 or 300 DPI.")
    extent = map_options.get("extent", "project")
    if extent != "project":
        _need(isinstance(extent, list) and len(extent) == 4
              and all(type(value) in (int, float, Decimal) and math.isfinite(value) for value in extent)
              and extent[0] < extent[2] and extent[1] < extent[3],
              "CARTOGRAPHY_EXTENT", "Enter xmin, ymin, xmax, ymax in the saved project CRS.")
        extent = [float(value) for value in extent]
        _need(all(math.isfinite(value) for value in extent) and extent[0] < extent[2] and extent[1] < extent[3],
              "CARTOGRAPHY_EXTENT_PRECISION", "Choose an extent distinguishable in native QGIS coordinates.")
    padding = map_options.get("paddingPercent", 5)
    _need(type(padding) in (int, float, Decimal) and math.isfinite(padding) and 0 <= padding <= 50,
          "CARTOGRAPHY_PADDING", "Choose map padding from zero to fifty percent.")
    padding = float(padding)
    layer_ids = map_options.get("layerIds")
    if "layerIds" not in map_options:
        layer_ids = [row["id"] for row in project["layers"] if row.get("visible", True)]
    _need(isinstance(layer_ids, list) and all(isinstance(value, str) for value in layer_ids),
          "CARTOGRAPHY_LAYER_SELECTION", "Select exact saved map layers.")
    _need(layer_ids and len(set(layer_ids)) == len(layer_ids)
          and set(layer_ids) <= {row["id"] for row in project["layers"]},
          "CARTOGRAPHY_LAYER_SELECTION", "Select at least one unique layer from the original map.")
    # Preserve the map's reviewed drawing order, rather than the browser's click order.
    layer_ids = [row["id"] for row in project["layers"] if row["id"] in layer_ids]
    show_legend, show_scale = legend.get("show", True), scale_bar.get("show", True)
    _need(type(show_legend) is bool and type(show_scale) is bool,
          "CARTOGRAPHY_BOOLEAN", "Choose whether to show the legend and scale bar.")
    previous = raw.get("predecessorPublicationId")
    _need(previous is None or isinstance(previous, str), "CARTOGRAPHY_PREDECESSOR",
          "Select the previous original publication or leave it empty.")
    if previous is not None:
        _row(state, "publications", previous)
    comparison_sha = review.get("comparisonSha256")
    _need(comparison_sha is None or isinstance(comparison_sha, str) and model.HASH.fullmatch(comparison_sha),
          "CARTOGRAPHY_REVIEW_IDENTITY", "Use the comparison returned by the original preview.")
    return {
        "schema": SPEC_SCHEMA, "projectId": project["id"],
        "title": _text(raw.get("title", state["title"]), "title", 240, True),
        "subtitle": _text(raw.get("subtitle", ""), "subtitle", 600),
        "attribution": _text(raw.get("attribution", ""), "attribution", 2000, True),
        "page": {"size": size, "orientation": orientation, "dpi": dpi},
        "map": {"extent": copy.deepcopy(extent), "layerIds": layer_ids, "paddingPercent": padding},
        "legend": {"show": show_legend, "title": _text(legend.get("title", "Legend"), "legend.title", 120)},
        "scaleBar": {"show": show_scale}, "predecessorPublicationId": previous,
        "review": {"comparisonSha256": comparison_sha, "note": _text(review.get("note", ""), "review.note", 5000)},
    }


def _bindings(project, layer_ids):
    native = {row["layerId"]: row.get("native", {}) for row in project.get("readback", {}).get("layers", [])}
    result = []
    for position, layer in enumerate(project["layers"]):
        if layer["id"] not in layer_ids:
            continue
        result.append({
            "layerId": layer["id"], "drawingOrder": position, "label": layer["label"],
            "kind": layer["kind"], "sourceId": layer["sourceId"],
            "selection": {key: copy.deepcopy(layer.get(key)) for key in
                          ("collection", "itemId", "assetKey", "sceneKeys", "vectorLayer")},
            "file": copy.deepcopy(layer.get("file")), "styleFile": copy.deepcopy(layer.get("styleFile")),
            "styleDependencies": copy.deepcopy(layer.get("styleDependencies", [])),
            "opacity": layer.get("opacity", 1), "visible": layer.get("visible", True),
            "subset": layer.get("vectorSubsetString", ""), "crsOverride": layer.get("crsOverride"),
            "bands": copy.deepcopy(layer.get("bands")),
            "native": copy.deepcopy(native.get(layer["id"], {})),
        })
    return result


def _comparison(workspace, state, spec, bindings, project):
    previous_id = spec["predecessorPublicationId"]
    if previous_id is None:
        return None
    previous_row = _row(state, "publications", previous_id)
    previous = _read(workspace, previous_row["file"])
    old_plan_row = _row(state, "plans", previous["planId"])
    old_plan = _read(workspace, old_plan_row["file"])
    old_bindings = old_plan["layerBindings"]
    changes = []
    # Exact source/native tuple groups retain repeated occurrences explicitly.
    def groups(rows):
        grouped = {}
        for row in rows:
            key = model.value_sha({"kind": row["kind"], "selection": row["selection"]})
            grouped.setdefault(key, []).append(row)
        return grouped
    left, right = groups(old_bindings), groups(bindings)
    for key in sorted(set(left) | set(right)):
        before, after = left.get(key, []), right.get(key, [])
        if model.value_sha(before) != model.value_sha(after):
            changes.append({"kind": "layer-binding", "key": key,
                            "before": copy.deepcopy(before), "after": copy.deepcopy(after),
                            "ambiguous": len(before) > 1 or len(after) > 1})
    for field in ("title", "subtitle", "attribution", "page", "map", "legend", "scaleBar"):
        if old_plan["spec"][field] != spec[field]:
            changes.append({"kind": "layout", "field": field,
                            "before": copy.deepcopy(old_plan["spec"][field]), "after": copy.deepcopy(spec[field])})
    old_crs = old_plan["project"].get("readback", {}).get("projectCrs")
    new_crs = project.get("readback", {}).get("projectCrs")
    if old_crs != new_crs:
        changes.append({"kind": "project-crs", "before": old_crs, "after": new_crs})
    value = {
        "priorPublicationId": previous_id, "priorPublicationFile": previous_row["file"],
        "priorPlanId": previous["planId"], "projectId": project["id"], "projectFile": project["file"],
        "changes": changes,
    }
    return {**value, "sha256": model.value_sha(value)}


def preview(workspace, spec):
    canonical_spec = native_files.canonical(copy.deepcopy(spec))
    frozen_spec = native_files.parse_json(canonical_spec)
    state = workspace.read()
    validate(state)
    normalized = _normalize_spec(state, frozen_spec)
    project = copy.deepcopy(_project(state, normalized["projectId"]))
    model.file_digest(model.member(workspace.root, project["file"]["path"]), expected=project["file"])
    bindings = _bindings(project, normalized["map"]["layerIds"])
    for layer in bindings:
        for descriptor in ([layer["styleFile"]] if layer.get("styleFile") else []) + layer["styleDependencies"]:
            model.file_digest(model.member(workspace.root, descriptor["path"]), expected=descriptor)
    comparison = _comparison(workspace, state, normalized, bindings, project)
    issues = []
    if comparison is not None:
        if normalized["review"]["comparisonSha256"] != comparison["sha256"]:
            issues.append({"code": "CARTOGRAPHY_COMPARISON_REVIEW",
                           "message": "Review this exact prior/current publication comparison before saving."})
        if not normalized["review"]["note"]:
            issues.append({"code": "CARTOGRAPHY_REVIEW_NOTE", "message": "Record the reason for this corrected publication."})
    return {
        "schema": "starforge.migration-publication-preview.v1", "workspaceId": state["id"],
        "revision": state["revision"], "spec": normalized, "project": project,
        "layerBindings": bindings, "comparison": comparison, "issues": issues, "ready": not issues,
        "sourceSpecCanonicalJson": canonical_spec,
    }


def save_plan(workspace, spec, *, revision, request_id, actor):
    # Freeze the exact parsed numeric input using the original Decimal-aware codec.
    # Only explicit native display numbers are converted by the normalized spec.
    canonical_spec = native_files.canonical(copy.deepcopy(spec))
    payload = {"specJson": canonical_spec}
    prior = workspace.operation(request_id, "cartography.plan-saved", payload)
    if prior:
        return prior
    reviewed = preview(workspace, native_files.parse_json(canonical_spec))
    _need(reviewed["ready"], "CARTOGRAPHY_REVIEW_REQUIRED",
          "Complete the corrected-publication review.", issues=reviewed["issues"])
    basis = {
        "schema": PLAN_SCHEMA, "workspaceId": reviewed["workspaceId"], "spec": reviewed["spec"],
        "sourceSpecCanonicalJson": canonical_spec, "project": reviewed["project"],
        "layerBindings": reviewed["layerBindings"], "comparison": reviewed["comparison"],
    }
    def update(state):
        _need(state["id"] == basis["workspaceId"], "CARTOGRAPHY_WORKSPACE_CHANGED",
              "Open the original migration workspace.")
        current_project = _project(state, basis["spec"]["projectId"])
        _need(current_project == basis["project"], "CARTOGRAPHY_PROJECT_CHANGED",
              "The original saved map changed; review its source again.")
        software = workspace._retain_software(state)
        document = {**basis, "softwareId": software["id"]}
        identifier = model.value_sha(document)
        value = _state(state, True)
        existing = next((row for row in value["plans"] if row["id"] == identifier), None)
        if existing:
            return {"plan": copy.deepcopy(existing), "existing": True}
        file = model.retain_bytes(workspace.root, PREFIX + "plans/" + identifier + ".json", model.json_bytes(document))
        row = {
            "id": identifier, "requestId": request_id, "title": document["spec"]["title"],
            "projectId": document["spec"]["projectId"], "file": file, "files": [file],
            "softwareId": software["id"], "predecessorPublicationId": document["spec"]["predecessorPublicationId"],
            "createdAt": model.utc_now(), "actor": actor, "inputRevision": revision, "status": "saved",
            "spec": copy.deepcopy(document["spec"]),
        }
        value["plans"].append(row)
        validate(state)
        return {"plan": copy.deepcopy(row), "existing": False}
    return workspace._mutate(revision, request_id, actor, "cartography.plan-saved", payload, update)


def _plan(workspace, state, plan_id):
    row = _row(state, "plans", plan_id)
    document = _read(workspace, row["file"])
    _need(document.get("schema") == PLAN_SCHEMA and model.value_sha(document) == plan_id
          and document.get("workspaceId") == state["id"]
          and document.get("softwareId") == row["softwareId"]
          and document["spec"]["projectId"] == row["projectId"],
          "CARTOGRAPHY_PLAN_CHANGED", "Keep the exact original publication plan.")
    return row, document


def _step(request_id, name):
    return "cartography-" + model.value_sha({"requestId": request_id, "step": name})


def _start(workspace, plan_id, *, revision, request_id, actor):
    payload = {"planId": plan_id, "startingRevision": revision, "actor": actor}
    prior = workspace.operation(request_id, "cartography.render-started", payload)
    if prior:
        state = workspace.read()
        return copy.deepcopy(_row(state, "operations", prior["operation"]["id"]))
    state = workspace.read()
    plan_row, document = _plan(workspace, state, plan_id)
    def update(current):
        _need(_row(current, "plans", plan_id) == plan_row, "CARTOGRAPHY_PLAN_CHANGED",
              "The selected original publication plan changed.")
        software = workspace._retain_software(current)
        native_input = {
            "schema": INPUT_SCHEMA, "workspaceId": current["id"], "planId": plan_id,
            "planFile": plan_row["file"], "projectId": plan_row["projectId"], "projectFile": document["project"]["file"],
            "requestId": request_id, "actor": actor, "startingRevision": revision, "softwareId": software["id"],
        }
        identifier = model.value_sha(native_input)
        relative = PREFIX + "renders/" + identifier
        file = model.retain_bytes(workspace.root, relative + "/native-input.json", model.json_bytes(native_input))
        row = {
            "id": identifier, "requestId": request_id, "planId": plan_id, "projectId": plan_row["projectId"],
            "title": document["spec"]["title"], "startingRevision": revision, "startedAt": model.utc_now(),
            "actor": actor, "status": "started", "directory": relative, "softwareId": software["id"],
            "inputSha256": model.value_sha(native_input), "inputFile": file, "files": [file],
        }
        _state(current, True)["operations"].append(row)
        validate(current)
        return {"operation": copy.deepcopy(row)}
    result = workspace._mutate(revision, request_id, actor, "cartography.render-started", payload, update)
    return result["operation"]


def _result(workspace, operation_row):
    path = model.member(workspace.root, operation_row["directory"] + "/publication.json", existing=False)
    if not path.exists():
        return None
    document, raw = model.read_json(path)
    _need(document.get("schema") == RESULT_SCHEMA and document.get("workspaceId") == workspace.read()["id"]
          and document.get("requestId") == operation_row["requestId"]
          and document.get("planId") == operation_row["planId"]
          and document.get("projectId") == operation_row["projectId"]
          and document.get("softwareId") == operation_row["softwareId"]
          and document.get("id") == "publication-" + operation_row["id"]
          and document.get("inputSha256") == operation_row["inputSha256"],
          "CARTOGRAPHY_RESULT_CHANGED", "The retained render belongs to another original input.")
    _need(set(document.get("output", {})) == {"qgz", "qpt", "pdf", "png"},
          "CARTOGRAPHY_OUTPUTS", "Keep the complete native publication.")
    _need(isinstance(document.get("files"), list), "CARTOGRAPHY_RESULT_FILES",
          "Retain the complete native rendering file closure.")
    declared = {}
    for record in document["files"]:
        record = model.descriptor(record)
        _need(record["path"].startswith(operation_row["directory"] + "/"),
              "CARTOGRAPHY_RESULT_FILE", "Render files must stay in their original operation directory.")
        _need(record["path"] not in declared, "CARTOGRAPHY_RESULT_DUPLICATE",
              "Declare each original render member once.", path=record["path"])
        declared[record["path"]] = record
        model.file_digest(model.member(workspace.root, record["path"]), expected=record)
    _need(declared.get(operation_row["inputFile"]["path"]) == operation_row["inputFile"],
          "CARTOGRAPHY_INPUT_CLOSURE", "Keep the exact original render input in its result.")
    for kind, raw_record in document["output"].items():
        record = model.descriptor(raw_record)
        _need(record["path"] == operation_row["directory"] + "/native-work/output/" + OUTPUTS[kind][1],
              "CARTOGRAPHY_OUTPUT_PATH", "Keep each native output at its original selected filename.")
        _need(declared.get(record["path"]) == record, "CARTOGRAPHY_OUTPUT_CLOSURE",
              "Every native output must be declared in the complete result.")
    return document, {"path": path.relative_to(workspace.root).as_posix(),
                      "bytes": len(raw), "sha256": model.sha_bytes(raw)}


def _finish(workspace, operation_row):
    result = _result(workspace, operation_row)
    _need(result is not None, "CARTOGRAPHY_RESULT_REQUIRED", "Complete the original native render first.")
    document, file = result
    payload = {"requestId": operation_row["requestId"], "resultFile": file}
    request = _step(operation_row["requestId"], "complete")
    previous = workspace.operation(request, "cartography.render-completed", payload)
    if previous:
        return {**previous, "replayed": True}
    def update(state):
        current = _row(state, "operations", operation_row["id"])
        _need(current["inputSha256"] == operation_row["inputSha256"],
              "CARTOGRAPHY_OPERATION_CHANGED", "Keep the original rendering input.")
        row = {
            "id": document["id"], "requestId": operation_row["requestId"], "planId": operation_row["planId"],
            "projectId": operation_row["projectId"], "title": document["title"],
            "softwareId": operation_row["softwareId"],
            "createdAt": document["completedAt"], "status": "complete", "file": file,
            "output": copy.deepcopy(document["output"]), "native": copy.deepcopy(document["native"]),
            "layout": copy.deepcopy(document["layout"]), "sourceBindings": copy.deepcopy(document["sourceBindings"]),
            "predecessorPublicationId": document.get("predecessorPublicationId"),
            "files": copy.deepcopy(document["files"]) + [file],
        }
        publications = _state(state, True)["publications"]
        existing = next((item for item in publications if item["id"] == row["id"]), None)
        _need(existing is None or existing == row, "CARTOGRAPHY_PUBLICATION_CONFLICT",
              "A retained publication has different output bytes.")
        if existing is None:
            publications.append(row)
        current.update(status="complete", publicationId=row["id"], completedAt=document["completedAt"],
                       completionRevision=state["revision"] + 1, resultFile=file, error=None)
        complete_files = {item["path"]: item for item in [current["inputFile"]] + row["files"]}
        current["files"] = [copy.deepcopy(complete_files[name]) for name in sorted(complete_files)]
        validate(state)
        return {"publication": copy.deepcopy(row), "operation": copy.deepcopy(current)}
    # Rendering only appends its immutable result; unrelated edits are preserved.
    current = workspace.read()
    completed = workspace._mutate(current["revision"], request, operation_row["actor"],
                                  "cartography.render-completed", payload, update)
    return {**completed, "replayed": False}


def _failure(workspace, operation_row, error):
    detail = {
        "code": getattr(error, "code", type(error).__name__),
        "message": str(error)[:4000],
    }
    payload = {"operationId": operation_row["id"], "inputSha256": operation_row["inputSha256"], "error": detail}
    request = _step(operation_row["requestId"], "error-" + model.value_sha(detail))
    def update(state):
        current = _row(state, "operations", operation_row["id"])
        if current["status"] != "complete":
            current.update(status="needs-attention", error=detail, lastObservedAt=model.utc_now())
        return {"operation": copy.deepcopy(current)}
    try:
        workspace._mutate(workspace.read()["revision"], request, operation_row["actor"],
                          "cartography.render-observed-error", payload, update)
    except Exception:
        # Keep the original rendering error; native-input and request already exist.
        pass


def publish(workspace, plan_id, *, revision, request_id, actor, progress=None):
    from .cartography_native import render
    return render(workspace, plan_id, revision=revision, request_id=request_id, actor=actor, progress=progress)


def operation(workspace, request_id):
    state = workspace.read()
    found = workspace.operation(request_id)
    if not found:
        return {"found": False, "workspaceId": state["id"], "revision": state["revision"], "operation": None}
    action = found.get("event", {}).get("action")
    if action == "cartography.plan-saved":
        return {"found": True, "workspaceId": state["id"], "revision": state["revision"],
                "operation": {"id": request_id, "requestId": request_id, "kind": "plan", "status": "complete"},
                "plan": copy.deepcopy(found["plan"]), "result": found}
    _need(action == "cartography.render-started", "CARTOGRAPHY_REQUEST_KIND",
          "This original request belongs to another workspace action.")
    row = copy.deepcopy(_row(state, "operations", found["operation"]["id"]))
    result = {"found": True, "workspaceId": state["id"], "revision": state["revision"], "operation": row}
    if row["status"] == "complete":
        result["publication"] = copy.deepcopy(_row(state, "publications", row["publicationId"]))
    else:
        retained = _result(workspace, row)
        if retained:
            row["status"] = "output-ready"
            row["resultFile"] = retained[1]
            row["publicationId"] = retained[0]["id"]
    return result


def publication(workspace, publication_id):
    state = workspace.read()
    row = _row(state, "publications", publication_id)
    document = _read(workspace, row["file"])
    _need(document.get("id") == publication_id and document.get("planId") == row["planId"],
          "CARTOGRAPHY_PUBLICATION_CHANGED", "Keep the exact original publication document.")
    for record in row["files"]:
        model.file_digest(model.member(workspace.root, record["path"]), expected=record)
    return {"workspaceId": state["id"], "revision": state["revision"],
            "publication": copy.deepcopy(row), "document": document}


def download(workspace, publication_id, kind):
    _need(kind in OUTPUTS, "CARTOGRAPHY_DOWNLOAD_KIND", "Select a retained publication output.")
    state = workspace.read()
    row = _row(state, "publications", publication_id)
    if kind == "plan":
        record = _row(state, "plans", row["planId"])["file"]
    elif kind == "receipt":
        record = row["file"]
    else:
        record = row["output"][kind]
    path = model.member(workspace.root, record["path"])
    model.file_digest(path, expected=record)
    mime, filename = OUTPUTS[kind]
    return {"path": str(path), "descriptor": copy.deepcopy(record), "mimeType": mime, "filename": filename}


def reopen_publications(workspace, *, progress=None, publication_id=None):
    from .cartography_native import reopen
    return reopen(workspace, progress=progress, publication_id=publication_id)


def execute(workspace, action, payload=None, progress=None):
    """Original migration CLI/router entry; request identity is supplied by its shell."""
    p = payload or {}
    _need(isinstance(p, dict), "CARTOGRAPHY_PAYLOAD", "Use a complete command object.")
    if action == "inventory":
        return inventory(workspace)
    if action == "preview":
        return preview(workspace, p["spec"])
    if action == "save-plan":
        return save_plan(workspace, p["spec"], revision=p["revision"], request_id=p["requestId"], actor=p["actor"])
    if action == "publish":
        return publish(workspace, p["planId"], revision=p["revision"], request_id=p["requestId"],
                       actor=p["actor"], progress=progress)
    if action == "operation":
        return operation(workspace, p["requestId"])
    if action == "publication":
        return publication(workspace, p["publicationId"])
    if action == "download":
        return download(workspace, p["publicationId"], p["kind"])
    if action == "reopen":
        return reopen_publications(workspace, publication_id=p.get("publicationId"), progress=progress)
    raise model.QgisReceivingError("CARTOGRAPHY_ACTION", "Choose a supported original publication command.")
