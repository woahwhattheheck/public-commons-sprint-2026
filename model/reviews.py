"""Portable customer review of original scientific source editions and releases.

The original Workspace owns source files, native models and working archives.
This module selects its actual retained records, records review responses and
exports a self-contained review desk with the selected original files.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import importlib.util
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import stat
import tempfile
import zipfile

from .common import (atomic_json, canonical, describe_file, digest, file_digest,
                     held, identifier, now, read_json, relative_file, verify_file)

SELECTION_SCHEMA = "upstate.customer-review-selection/v1"
PACKET_SCHEMA = "upstate.customer-review-packet/v1"
RESPONSE_SCHEMA = "upstate.customer-review-response/v1"
PACKAGE_SCHEMA = "upstate.customer-review-package/v1"
DECISIONS = ("unreviewed", "accepted", "changes-requested", "question", "not-applicable")
DISPOSITIONS = ("in-review", "ready-for-purpose", "changes-requested")
PREVIEW_BYTES = 64 * 1024
JSON_BYTES = 32 * 1024 * 1024
PLACEHOLDER = "__UPSTATE_REVIEW_BOOTSTRAP__"
_UNSPECIFIED = object()
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")


def _text(value, field, *, required=False, maximum=20000):
    if not isinstance(value, str) or "\0" in value or len(value) > maximum:
        raise ValueError(field + " must be text of at most " + str(maximum) + " characters")
    if required and not value.strip():
        raise ValueError(field + " is required")
    return value


def _key(value, field):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(field + " must be a portable nonempty identifier")
    return value


def _list(value, field):
    if not isinstance(value, list):
        raise ValueError(field + " must be a list")
    return value


def _unique(values, field):
    if len(values) != len(set(values)):
        raise ValueError(field + " contains a duplicate selection")
    return values


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("File paths must use nonempty portable relative names")
    path = PurePosixPath(value)
    if (path.is_absolute() or PureWindowsPath(value).drive or str(path) != value
            or any(part in ("", ".", "..") for part in value.split("/"))):
        raise ValueError("File path must stay within its selected directory")
    return value


def _regular(root, relative):
    current = Path(root).resolve()
    parts = PurePosixPath(_relative(relative)).parts
    for position, part in enumerate(parts):
        current = current / part
        state = current.lstat()
        if stat.S_ISLNK(state.st_mode):
            raise ValueError("Selected file path contains a symbolic link: " + relative)
        if position < len(parts) - 1 and not stat.S_ISDIR(state.st_mode):
            raise ValueError("Selected file path crosses a non-directory: " + relative)
        if position == len(parts) - 1 and not stat.S_ISREG(state.st_mode):
            raise ValueError("Select a retained regular file: " + relative)
    return current


def _read_json_file(path):
    path = Path(path)
    if path.stat().st_size > JSON_BYTES:
        raise ValueError("Review JSON exceeds its 32 MiB document limit")
    with path.open("rb") as source:
        raw = source.read(JSON_BYTES + 1)
    if len(raw) > JSON_BYTES:
        raise ValueError("Review JSON grew while being read")
    return json.loads(raw)


def _media(path):
    suffix = Path(path).suffix.lower()
    return {".json": "application/json", ".geojson": "application/geo+json",
            ".md": "text/markdown", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
            ".xml": "application/xml", ".prj": "text/plain",
            ".tif": "image/tiff", ".tiff": "image/tiff", ".gpkg": "application/geopackage+sqlite3",
            ".shp": "application/x-esri-shape", ".zip": "application/zip"}.get(
                suffix, mimetypes.guess_type(path)[0] or "application/octet-stream")


def _kind(path, role=""):
    suffix = Path(path).suffix.lower()
    role = role.lower()
    if suffix in (".zip", ".gz", ".tar"):
        return "archive"
    if suffix in (".tif", ".tiff"):
        return "raster"
    if suffix in (".gpkg", ".shp", ".geojson", ".gdb"):
        return "vector"
    if suffix in (".csv", ".tsv"):
        return "table"
    if "map" in role and suffix == ".pdf":
        return "map"
    if suffix == ".pdf":
        return "report"
    if suffix in (".json", ".xml", ".prj", ".cpg"):
        return "metadata"
    if suffix in (".txt", ".md", ".html"):
        return "document"
    return "other"


def _selection(value):
    if not isinstance(value, dict) or value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Select an upstate.customer-review-selection/v1 document")
    known = {"schema", "title", "purpose", "source_collection_ids", "run_ids",
             "delivery_ids", "spatial_export_ids", "requirements", "notes"}
    if set(value) - known:
        raise ValueError("Unknown review selection field: " + ", ".join(sorted(set(value) - known)))
    selected = {"schema": SELECTION_SCHEMA,
                "title": _text(value.get("title"), "Review title", required=True, maximum=300),
                "purpose": _text(value.get("purpose"), "Selected review purpose", required=True)}
    for field in ("source_collection_ids", "run_ids", "delivery_ids", "spatial_export_ids"):
        selected[field] = _unique([identifier(key) for key in _list(value.get(field, []), field)], field)
    if not any(selected[field] for field in ("source_collection_ids", "run_ids", "delivery_ids", "spatial_export_ids")):
        raise ValueError("Select at least one retained source edition, completed run, completed delivery or completed map export")
    requirements = []
    for item in _list(value.get("requirements", []), "requirements"):
        if not isinstance(item, dict) or set(item) - {"id", "title", "detail"}:
            raise ValueError("Each requirement needs id, title and detail")
        requirements.append({"id": _key(item.get("id"), "Requirement ID"),
                             "title": _text(item.get("title"), "Requirement title", required=True, maximum=500),
                             "detail": _text(item.get("detail", ""), "Requirement detail")})
    _unique([item["id"] for item in requirements], "requirements")
    selected["requirements"] = requirements
    selected["notes"] = [_text(item, "Review note") for item in _list(value.get("notes", []), "notes")]
    return selected


def _artifact(locator, descriptor, *, export_root, native_path, label, kind=None,
              group, selection_kind, selection_id, role, origin=None, description=""):
    expected = {"bytes": descriptor["bytes"], "sha256": identifier(descriptor["sha256"])}
    if type(expected["bytes"]) is not int or expected["bytes"] < 0:
        raise ValueError("Original artifact needs its actual nonnegative byte count")
    path = _relative(export_root + "/" + _relative(native_path))
    key = digest({"locator": locator, **expected})
    return {"id": key, "label": label, "kind": kind or _kind(native_path, role),
            "group": group, "selection_kind": selection_kind, "selection_id": selection_id,
            "role": role, "path": path, "original_path": native_path, **expected,
            "media_type": _media(native_path), "description": description,
            "origin": origin or {}, "locator": locator}


def _file_artifact(workspace, kind, key, root, relative, *, role, label=None,
                   expected=None, group=None, origin=None, description=""):
    path = _regular(root, relative)
    descriptor = expected or describe_file(root, path)
    verify_file(root, {"path": relative, "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]})
    return _artifact({"kind": kind, "id": key, "path": relative}, descriptor,
                     export_root="files/" + digest({"kind": kind, "id": key}),
                     native_path=relative, label=label or relative, group=group or kind + " / " + key[:12],
                     selection_kind=kind, selection_id=key, role=role, origin=origin,
                     description=description)


def _source_selection(workspace, key):
    collection = workspace._get("sources", key)
    group_root = "files/" + digest({"kind": "sources", "id": key, "part": "manifest"})
    manifest = collection["original_manifest"]
    _regular(workspace.root, manifest["object"])
    verify_file(workspace.root, {"path": manifest["object"], "bytes": manifest["bytes"],
                                 "sha256": manifest["sha256"]})
    artifacts = [_artifact({"kind": "source-manifest", "id": key}, manifest,
        export_root=group_root, native_path=manifest["filename"], label="Original source edition manifest",
        kind="metadata", group=collection["title"], selection_kind="sources", selection_id=key,
        role="original-source-manifest", description="Original intake document retained by the Workspace.",
        origin={"captured_at": collection.get("captured_at"), "scope": collection.get("scope", {})})]
    for entry in collection["entries"]:
        workspace.source_file(key, entry["id"])
        export_root = "files/" + digest({"kind": "sources", "id": key, "source_id": entry["id"]})
        origin = {name: item for name, item in entry.items() if name not in ("body", "companions")}
        for position, body in enumerate([entry["body"]] + entry["companions"]):
            locator = {"kind": "source-entry", "id": key, "source_id": entry["id"], "part": position}
            native = body.get("view_path", body["filename"])
            companion = position != 0
            artifacts.append(_artifact(locator, body, export_root=export_root, native_path=native,
                label=(entry["title"] + " — " + native) if companion else entry["title"],
                kind=_kind(native) if companion else entry["kind"],
                group=collection["title"] + " / " + entry["title"],
                selection_kind="sources", selection_id=key,
                role=entry["id"] + (".companion" if companion else ".body"), origin=origin,
                description=entry.get("description", "") if not companion else
                            "Native companion retained beside its original source file."))
    pin = {"kind": "sources", "id": key, "title": collection["title"], "state": "retained",
           "record_sha256": digest(collection), "source": collection}
    return pin, artifacts


def _run_selection(workspace, key):
    record = workspace.inspect_run(key)
    if record.get("state") != "complete" or record.get("id") != key:
        raise ValueError("Select a completed original native run for output review")
    root = workspace.root / "runs" / key
    origin = dict(record["selection"])
    artifacts = [_file_artifact(workspace, "runs", key, root, "run.json",
                 role="original-run-record", label="Original native run and parameter selection",
                 group="Native run " + key[:12], origin=origin)]
    for role, descriptor in record["artifacts"].items():
        details = {**origin, **{name: item for name, item in descriptor.items()
                              if name not in ("path", "bytes", "sha256")}}
        artifacts.append(_file_artifact(workspace, "runs", key, root, descriptor["path"],
                         role=role, expected=descriptor, group="Native run " + key[:12],
                         origin=details, description="Completed original native run artifact."))
    return {"kind": "runs", "id": key, "title": "Native run " + key[:12], "state": "complete",
            "record_sha256": digest(record), "source": record}, artifacts


def _capture_module():
    source = Path(__file__).resolve().parent.parent / "delivery_snapshot.py"
    spec = importlib.util.spec_from_file_location("_upstate_review_original_snapshot", source)
    if spec is None or spec.loader is None:
        raise ValueError("Original delivery snapshot module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _delivery_record(workspace, key):
    identifier(key)
    record = read_json(_regular(workspace.root, "deliveries/" + key + "/delivery-state.json"))
    if record.get("schema") != "upstate.delivery/v1" or record.get("id") != key or record.get("state") != "complete":
        raise ValueError("Select a completed original delivery")
    return record


def _delivery_selection(workspace, key):
    record = _delivery_record(workspace, key)
    root = workspace.root / "deliveries" / key
    title = record["selection"].get("title", "Delivery " + key[:12])
    group = "Delivery / " + title
    artifacts = [_file_artifact(workspace, "deliveries", key, root, "delivery-state.json",
                 role="original-delivery-record", label="Original completed delivery record", group=group)]
    origin = {name: item for name, item in record.get("manifest", {}).get("model", {}).items()}
    for role, descriptor in record["files"].items():
        artifacts.append(_file_artifact(workspace, "deliveries", key, root, descriptor["path"],
                         role=role, expected=descriptor, group=group, origin=origin))
    package_relative = _relative(record["package"]["path"])
    package_root = root / package_relative
    index = _read_json_file(_regular(package_root, "package.json"))
    if index.get("packageSha256") != record["package"]["packageSha256"]:
        raise ValueError("Original delivery package identity differs from the selected completed delivery")
    _capture_module().verify_capture(package_root, index)
    for descriptor in index["artifacts"]:
        role = ", ".join(descriptor["roles"])
        artifacts.append(_file_artifact(workspace, "deliveries", key, root,
                         package_relative + "/" + descriptor["path"],
                         role=role, expected=descriptor, group=group + " / original package", origin=origin))
    for name, role in (("package.json", "original-package-index"), ("index.html", "original-delivery-navigator")):
        artifacts.append(_file_artifact(workspace, "deliveries", key, root, package_relative + "/" + name,
                         role=role, group=group + " / original package", origin=origin))
    audit = _read_json_file(_regular(package_root, "audit.json"))
    return {"kind": "deliveries", "id": key, "title": title, "state": "complete",
            "record_sha256": digest(record), "source": record, "audit": audit,
            "package_sha256": index["packageSha256"]}, artifacts



def _spatial_export_record(workspace, key, *, verify=False):
    from .spatial_exports import SpatialExports
    record = SpatialExports(workspace).inspect(identifier(key), verify=verify)
    if record.get("state") != "complete":
        raise ValueError("Select a completed original map export for review")
    return record


def _spatial_export_selection(workspace, key):
    # The native publisher verifies its complete file set and saved-review/source
    # binding once. Reuse those declared descriptors rather than hash each map
    # archive a second time while constructing the review request.
    record = _spatial_export_record(workspace, key, verify=True)
    root = workspace.root / "spatial-exports" / key
    group = "Saved map / " + record["title"]
    origin = {"project_id": record["project_id"], "review_id": record["review_id"],
              "review_sha256": record["review_sha256"], "selection": record["selection"]}
    artifacts = [_file_artifact(workspace, "spatial-exports", key, root, "export.json",
                 role="original-map-export-record", label="Original completed map export record",
                 group=group, origin=origin)]
    export_root = "files/" + digest({"kind": "spatial-exports", "id": key})
    for role, descriptor in record["files"].items():
        artifacts.append(_artifact(
            {"kind": "spatial-exports", "id": key, "path": descriptor["path"]},
            descriptor, export_root=export_root, native_path=descriptor["path"],
            label=descriptor.get("title") or role, group=group,
            selection_kind="spatial-exports", selection_id=key, role=role,
            origin=origin, description="Completed original saved map and retained context."))
    return {"kind": "spatial-exports", "id": key, "title": record["title"],
            "state": "complete", "record_sha256": digest(record), "source": record}, artifacts


def _spatial_export_artifact(record, artifact):
    """Bind a review locator to an original completed map member."""
    key = record["id"]
    locator = artifact.get("locator")
    if (not isinstance(locator, dict) or set(locator) != {"kind", "id", "path"}
            or locator["kind"] != "spatial-exports" or locator["id"] != key
            or artifact.get("selection_kind") != "spatial-exports"
            or artifact.get("selection_id") != key):
        raise ValueError("Map review artifact belongs to another original export")
    relative = _relative(locator["path"])
    target = "files/" + digest({"kind": "spatial-exports", "id": key}) + "/" + relative
    if artifact.get("original_path") != relative or artifact.get("path") != target:
        raise ValueError("Map review artifact changed its original portable path")
    if relative != "export.json":
        matches = [item for item in record["files"].values() if item["path"] == relative]
        if len(matches) != 1 or any(artifact.get(name) != matches[0][name] for name in ("bytes", "sha256")):
            raise ValueError("Map review artifact is outside the original completed file set")
    return relative

def _gather(workspace, selection):
    selections, artifacts = [], {}
    operations = (("source_collection_ids", _source_selection), ("run_ids", _run_selection),
                  ("delivery_ids", _delivery_selection),
                  ("spatial_export_ids", _spatial_export_selection))
    for field, operation in operations:
        for key in selection[field]:
            pin, selected_files = operation(workspace, key)
            selections.append(pin)
            for item in selected_files:
                previous = artifacts.get(item["id"])
                if previous and previous["path"] != item["path"]:
                    raise ValueError("One original artifact has conflicting export locations")
                if previous:
                    if item["role"] not in previous["role"].split(" / "):
                        previous["role"] += " / " + item["role"]
                else:
                    artifacts[item["id"]] = item
    names = {}
    for item in artifacts.values():
        key = item["path"].casefold()
        if key in names and names[key] != item["id"]:
            raise ValueError("Selected original files collide at a portable review path")
        names[key] = item["id"]
    for key in names:
        pieces = key.split("/")
        if any("/".join(pieces[:n]) in names for n in range(1, len(pieces))):
            raise ValueError("Selected review files conflict with a directory path")
    return selections, list(artifacts.values())


def _validate_bindings(workspace, review):
    if review.get("schema") != "upstate.reviews/v1" or review.get("project") != workspace.project:
        raise ValueError("Review belongs to another original scientific workspace")
    selected = _selection(review["selection"])
    if any(review.get(field) != selected[field] for field in ("title", "purpose", "notes", "requirements")):
        raise ValueError("Review title, purpose, requirements or notes differ from its selection")
    expected = {("sources", key) for key in selected["source_collection_ids"]}
    expected |= {("runs", key) for key in selected["run_ids"]}
    expected |= {("deliveries", key) for key in selected["delivery_ids"]}
    expected |= {("spatial-exports", key) for key in selected["spatial_export_ids"]}
    seen, spatial_records = set(), {}
    for pin in review["selections"]:
        kind, key = pin["kind"], identifier(pin["id"])
        if (kind, key) not in expected or (kind, key) in seen:
            raise ValueError("Review source selections differ from their original selection")
        seen.add((kind, key))
        record = (workspace._get("sources", key) if kind == "sources" else
                  workspace.inspect_run(key) if kind == "runs" else
                  _delivery_record(workspace, key) if kind == "deliveries" else
                  _spatial_export_record(workspace, key))
        if kind == "spatial-exports":
            spatial_records[key] = record
        if digest(record) != pin["record_sha256"] or record != pin["source"]:
            raise ValueError("A selected source record changed; create a review for its current edition")
    if seen != expected or not review["artifacts"]:
        raise ValueError("Review lacks its selected original records or artifacts")
    ids, paths = [], []
    for artifact in review["artifacts"]:
        ids.append(identifier(artifact["id"]))
        paths.append(_relative(artifact["path"]).casefold())
        if (artifact["selection_kind"], artifact["selection_id"]) not in seen:
            raise ValueError("Review artifact is outside the selected original records")
        if artifact["id"] != digest({"locator": artifact["locator"],
                                     "bytes": artifact["bytes"], "sha256": artifact["sha256"]}):
            raise ValueError("Review artifact identity differs")
        if artifact["selection_kind"] == "spatial-exports":
            _spatial_export_artifact(spatial_records[artifact["selection_id"]], artifact)
    _unique(ids, "review artifacts")
    _unique(paths, "review paths")


def _resolve(workspace, artifact, cache):
    locator = artifact["locator"]
    kind, key = locator["kind"], identifier(locator["id"])
    if kind in ("source-entry", "source-manifest"):
        if ("sources", key) not in cache:
            cache[("sources", key)] = workspace._get("sources", key)
        collection = cache[("sources", key)]
        if kind == "source-manifest":
            body = collection["original_manifest"]
        else:
            entry_key = (key, locator["source_id"])
            if entry_key not in cache:
                cache[entry_key] = workspace.source_file(key, locator["source_id"])[1]
            entry = cache[entry_key]
            position = locator["part"]
            if type(position) is not int or position < 0:
                raise ValueError("Invalid original source companion selection")
            body = ([entry["body"]] + entry["companions"])[position]
        path = _regular(workspace.root, body["object"])
        if body["bytes"] != artifact["bytes"] or body["sha256"] != artifact["sha256"]:
            raise ValueError("Review source differs from its original retained object")
    elif kind == "spatial-exports":
        identity = ("spatial-exports", key)
        if identity not in cache:
            cache[identity] = _spatial_export_record(workspace, key)
        relative = _spatial_export_artifact(cache[identity], artifact)
        path = _regular(workspace.root / "spatial-exports" / key, relative)
    elif kind in ("runs", "deliveries"):
        path = _regular(workspace.root / kind / key, locator["path"])
    else:
        raise ValueError("Unknown original review artifact location")
    return path


def create_review(workspace, value, *, created_at=None):
    """Retain a selected review, reusing a caller's original request time.

    The online operator passes its retained task creation time on recovery,
    so the same selected original records produce the same review identity.
    Direct callers that omit it create a new review at the current time.
    """
    selection = _selection(value)
    selected_time = _date(created_at, "Review creation time") if created_at is not None else now()
    with held(workspace.root / ".workspace.lock", blocking=False):
        selections, artifacts = _gather(workspace, selection)
        return workspace._save("reviews", {"project": workspace.project, "created_at": selected_time,
            "title": selection["title"], "purpose": selection["purpose"], "notes": selection["notes"],
            "requirements": selection["requirements"], "selection": selection,
            "selections": selections, "artifacts": artifacts})


def _date(value, field="Response creation time"):
    value = _text(value, field, required=True, maximum=80)
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(field + " needs its UTC offset")
    return value


def _decision(item, key_field, allowed):
    if not isinstance(item, dict) or set(item) - {key_field, "decision", "comment", "requested_change", "assignee"}:
        raise ValueError("Each decision needs its selected ID, decision and review text")
    key = item.get(key_field)
    if key not in allowed:
        raise ValueError("Decision refers to an item outside this selected review")
    decision = item.get("decision")
    if decision not in DECISIONS:
        raise ValueError("Unsupported customer review decision")
    result = {key_field: key, "decision": decision,
              "comment": _text(item.get("comment", ""), "Decision comment"),
              "requested_change": _text(item.get("requested_change", ""), "Requested change"),
              "assignee": _text(item.get("assignee", ""), "Correction assignee", maximum=500)}
    if decision == "changes-requested" and not result["requested_change"].strip():
        raise ValueError("A changes-requested decision needs the specific requested change")
    if decision in ("question", "not-applicable") and not (result["comment"].strip() or result["requested_change"].strip()):
        raise ValueError("A question or not-applicable decision needs its explanation")
    return result


def _checked_response(value, review):
    fields = {"schema", "review_id", "project_id", "previous_response_id", "reviewer", "disposition",
              "summary", "artifact_decisions", "requirement_decisions", "corrections", "created_at"}
    if not isinstance(value, dict) or value.get("schema") != RESPONSE_SCHEMA or set(value) - fields:
        raise ValueError("Import an upstate.customer-review-response/v1 document")
    if value.get("review_id") != review["id"] or value.get("project_id") != review["project"]["id"]:
        raise ValueError("Customer response belongs to a different review or project")
    previous = value.get("previous_response_id")
    if previous is not None:
        identifier(previous)
    reviewer = value.get("reviewer")
    if not isinstance(reviewer, dict) or set(reviewer) - {"name", "role", "organization"}:
        raise ValueError("Reviewer needs a name, role and organization")
    reviewer = {"name": _text(reviewer.get("name"), "Reviewer name", required=True, maximum=300),
                "role": _text(reviewer.get("role", ""), "Reviewer role", maximum=300),
                "organization": _text(reviewer.get("organization", ""), "Reviewer organization", maximum=500)}
    disposition = value.get("disposition")
    if disposition not in DISPOSITIONS:
        raise ValueError("Select in-review, ready-for-purpose or changes-requested")
    artifact_ids = {item["id"] for item in review["artifacts"]}
    requirement_ids = {item["id"] for item in review["requirements"]}
    decisions = {}
    for field, key_field, allowed in (("artifact_decisions", "artifact_id", artifact_ids),
                                      ("requirement_decisions", "requirement_id", requirement_ids)):
        items = [_decision(item, key_field, allowed) for item in _list(value.get(field), field)]
        keys = [item[key_field] for item in items]
        if set(keys) != allowed or len(keys) != len(allowed):
            raise ValueError("Response must include each selected " + key_field + " exactly once")
        decisions[field] = sorted(items, key=lambda item: item[key_field])
    corrections = []
    correction_fields = {"id", "title", "description", "artifact_ids", "requirement_ids",
                         "assignee", "priority", "state", "resolution"}
    for item in _list(value.get("corrections", []), "corrections"):
        if not isinstance(item, dict) or set(item) - correction_fields:
            raise ValueError("Unknown correction field")
        artifacts = _unique(_list(item.get("artifact_ids", []), "Correction artifact IDs"), "Correction artifact IDs")
        requirements = _unique(_list(item.get("requirement_ids", []), "Correction requirement IDs"), "Correction requirement IDs")
        if set(artifacts) - artifact_ids or set(requirements) - requirement_ids:
            raise ValueError("Correction refers to an item outside this selected review")
        priority, state = item.get("priority", "normal"), item.get("state", "open")
        if priority not in ("normal", "high") or state not in ("open", "resolved"):
            raise ValueError("Correction priority or state is unsupported")
        correction = {"id": _key(item.get("id"), "Correction ID"),
                      "title": _text(item.get("title"), "Correction title", required=True, maximum=500),
                      "description": _text(item.get("description", ""), "Correction description"),
                      "artifact_ids": sorted(artifacts), "requirement_ids": sorted(requirements),
                      "assignee": _text(item.get("assignee", ""), "Correction assignee", maximum=500),
                      "priority": priority, "state": state,
                      "resolution": _text(item.get("resolution", ""), "Correction resolution")}
        if state == "resolved" and not correction["resolution"].strip():
            raise ValueError("A resolved correction needs the actual resolution")
        corrections.append(correction)
    _unique([item["id"] for item in corrections], "corrections")
    all_decisions = decisions["artifact_decisions"] + decisions["requirement_decisions"]
    if disposition == "ready-for-purpose":
        if any(item["decision"] not in ("accepted", "not-applicable") for item in all_decisions):
            raise ValueError("Finish each selected artifact and requirement decision before marking this purpose ready")
        if not any(item["decision"] == "accepted" for item in decisions["artifact_decisions"]):
            raise ValueError("Ready-for-purpose requires acceptance of an actual selected artifact")
        if any(item["state"] == "open" for item in corrections):
            raise ValueError("Resolve the listed open corrections before marking this purpose ready")
    if disposition == "changes-requested" and not (
        any(item["decision"] == "changes-requested" for item in all_decisions)
        or any(item["state"] == "open" for item in corrections)
    ):
        raise ValueError("Record the actual requested change or open correction")
    return {"schema": RESPONSE_SCHEMA, "review_id": review["id"], "project_id": review["project"]["id"],
            "previous_response_id": previous, "reviewer": reviewer, "disposition": disposition,
            "summary": _text(value.get("summary", ""), "Review summary"), **decisions,
            "corrections": sorted(corrections, key=lambda item: item["id"]),
            "created_at": _date(value.get("created_at"))}


def history(workspace, review_id):
    review = workspace._get("reviews", identifier(review_id))
    records = [record for record in workspace._list("review-responses") if record.get("review_id") == review_id]
    return history_from_records(workspace, review, records)


def history_from_records(workspace, review, records):
    """Validate one review's already-retained records using the original chain rules."""
    _validate_bindings(workspace, review)
    if any(record.get("review_id") != review["id"] for record in records):
        raise ValueError("Review history contains records from another selected review")
    by_previous = {}
    for record in records:
        checked = _checked_response(record["response"], review)
        if (record.get("project_id") != workspace.project["id"] or checked != record["response"]
                or record.get("request_sha256") != digest(checked)
                or record.get("previous_response_id") != checked["previous_response_id"]):
            raise ValueError("Retained review response differs from its original input")
        previous = checked["previous_response_id"]
        if previous in by_previous:
            raise ValueError("Review has conflicting response branches; preserve both and reconcile the selected history")
        by_previous[previous] = record
    ordered, previous, seen = [], None, set()
    while previous in by_previous:
        record = by_previous[previous]
        if record["id"] in seen:
            raise ValueError("Review response history contains a cycle")
        seen.add(record["id"])
        ordered.append(record)
        previous = record["id"]
    if len(ordered) != len(records):
        raise ValueError("Review response history lacks a retained predecessor")
    return ordered


def import_response(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Import the complete customer response document")
    with held(workspace.root / ".workspace.lock", blocking=False):
        review = workspace._get("reviews", identifier(value.get("review_id")))
        _validate_bindings(workspace, review)
        checked = _checked_response(value, review)
        previous = history(workspace, review["id"])
        request_sha = digest(checked)
        for record in previous:
            if record["request_sha256"] == request_sha:
                return record
        latest = previous[-1]["id"] if previous else None
        if checked["previous_response_id"] != latest:
            raise ValueError("A newer response is already retained. Reopen its exported review and reconcile this draft.")
        return workspace._save("review-responses", {"project_id": workspace.project["id"],
            "review_id": review["id"], "previous_response_id": latest, "request_sha256": request_sha,
            "imported_at": now(), "response": checked})


def response_prefix(records, through_response_id=_UNSPECIFIED):
    """Select an existing immutable response generation, including its prefix."""
    if through_response_id is _UNSPECIFIED:
        return records
    if through_response_id is None:
        return []
    identifier(through_response_id)
    for index, record in enumerate(records):
        if record["id"] == through_response_id:
            return records[:index + 1]
    raise ValueError("Selected historical customer response is not in this review")


def response_template(workspace, review_id, *, through_response_id=_UNSPECIFIED):
    review = workspace._get("reviews", identifier(review_id))
    previous = response_prefix(history(workspace, review_id), through_response_id)
    if previous:
        value = copy.deepcopy(previous[-1]["response"])
        value.update(previous_response_id=previous[-1]["id"], created_at=now(),
                     reviewer={"name": "", "role": "", "organization": ""}, disposition="in-review")
        return value
    def decision(key, value):
        return {key: value, "decision": "unreviewed", "comment": "", "requested_change": "", "assignee": ""}
    return {"schema": RESPONSE_SCHEMA, "review_id": review_id, "project_id": workspace.project["id"],
            "previous_response_id": None, "reviewer": {"name": "", "role": "", "organization": ""},
            "disposition": "in-review", "summary": "", "created_at": now(), "corrections": [],
            "artifact_decisions": [decision("artifact_id", item["id"]) for item in review["artifacts"]],
            "requirement_decisions": [decision("requirement_id", item["id"]) for item in review["requirements"]]}


def _preview(path, artifact):
    media = artifact["media_type"]
    if not (media.startswith("text/") or media in ("application/json", "application/geo+json", "application/xml")):
        return None
    # HTML and XML remain text. The review desk never executes a source preview.
    with path.open("rb") as source:
        raw = source.read(PREVIEW_BYTES + 4)
    try:
        text = raw[:PREVIEW_BYTES].decode("utf-8")
    except UnicodeDecodeError:
        text = raw[:PREVIEW_BYTES].decode("utf-8", errors="replace")
    return {"text": text, "truncated": artifact["bytes"] > PREVIEW_BYTES, "media_type": media}


def show_review(workspace, review_id, *, previews=True):
    review = workspace._get("reviews", identifier(review_id))
    _validate_bindings(workspace, review)
    records = history(workspace, review_id)
    result = copy.deepcopy(review)
    cache = {}
    for item in result["artifacts"]:
        path = _resolve(workspace, item, cache)
        if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
            raise ValueError("Selected original review file differs: " + item["label"])
        if previews:
            preview = _preview(path, item)
            if preview is not None:
                item["preview"] = preview
    return {"schema": PACKET_SCHEMA, "review": result, "responses": records,
            "latest_response_id": records[-1]["id"] if records else None,
            "files": [{"artifact_id": item["id"], "path": item["path"],
                       "bytes": item["bytes"], "sha256": item["sha256"]} for item in review["artifacts"]]}


def review_file(workspace, review_id, artifact_id):
    """Resolve one selected original for the existing operator download route.

    Return (Path, artifact), matching Workspace.source_file. The private
    native locator is served through the maintained operator download ticket;
    the copied artifact preserves its original portable review descriptor.
    """
    review = workspace._get("reviews", identifier(review_id))
    _validate_bindings(workspace, review)
    key = identifier(artifact_id)
    artifact = next((item for item in review["artifacts"] if item["id"] == key), None)
    if artifact is None:
        raise ValueError("The selected artifact does not belong to this review")
    path = _resolve(workspace, artifact, {})
    if path.stat().st_size != artifact["bytes"] or file_digest(path) != artifact["sha256"]:
        raise ValueError("Selected original review file differs: " + artifact["label"])
    return path, copy.deepcopy(artifact)


def _copy_file(path, target, expected):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size != expected["bytes"]:
        raise ValueError("Selected file changed before review export")
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    h, count = hashlib.sha256(), 0
    target.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(fd, "rb") as source, target.open("xb") as output:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise ValueError("Selected file changed while review export opened it")
        for block in iter(lambda: source.read(1024 * 1024), b""):
            count += len(block)
            if count > expected["bytes"]:
                raise ValueError("Selected file grew during review export")
            h.update(block)
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
        if identity(os.fstat(source.fileno())) != identity(before):
            raise ValueError("Selected file changed during review export")
    if (identity(path.lstat()) != identity(before) or count != expected["bytes"]
            or h.hexdigest() != expected["sha256"]):
        raise ValueError("Exported review file differs from its selected original")
    return {"path": target, "bytes": count, "sha256": h.hexdigest()}


def _html(packet):
    source = Path(__file__).resolve().parent.parent / "operator" / "review_app.html"
    text = source.read_text(encoding="utf-8")
    if text.count(PLACEHOLDER) != 1:
        raise ValueError("The original review app needs exactly one review bootstrap placeholder")
    payload = canonical(packet).decode("utf-8")
    for old, new in (("&", "\\u0026"), ("<", "\\u003c"), (">", "\\u003e"),
                     ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        payload = payload.replace(old, new)
    return text.replace(PLACEHOLDER, payload)


def _readme(packet):
    review = packet["review"]
    return (
        "# " + review["title"] + "\n\n" + review["purpose"] + "\n\n"
        "## Review this selection\n\n"
        "Open index.html in a browser. The review desk includes the retained source metadata, "
        "selected original files, previous responses and correction assignments. Original file links "
        "work from this extracted folder. Text previews are read-only excerpts; Download opens the full file.\n\n"
        "Enter your name and role, record the decisions for this stated purpose, and export the response JSON. "
        "Keep it with this review packet. Import it into the same scientific workspace with:\n\n"
        "    python application/model/review_cli.py --workspace WORKSPACE response-import RESPONSE.json\n\n"
        "Export the updated review to share its retained decisions:\n\n"
        "    python application/model/review_cli.py --workspace WORKSPACE export " + review["id"] +
        " NEW_REVIEW_DIRECTORY --zip NEW_REVIEW.zip\n\n"
        "## Reopen the working project\n\n"
        "Use the original scientific Workspace backup for the full project, models, original sources and runs. "
        "Its restore command recreates the workspace and application together:\n\n"
        "    python application/model/cli.py restore SCIENTIFIC_WORKSPACE.zip NEW_DIRECTORY\n"
        "    python NEW_DIRECTORY/application/model/review_cli.py --workspace NEW_DIRECTORY/workspace show " +
        review["id"] + "\n\n"
        "A response describes this selection and this purpose. A changed source edition or delivery gets its own "
        "review so the original decisions remain readable. The comparison command lists changed, added and removed files.\n\n"
        "## Files\n\n"
        "- index.html: complete offline review desk.\n"
        "- review.json: selected original records, files and retained response history.\n"
        "- response-template.json: editable current response format.\n"
        "- review-manifest.json: exact exported file inventory.\n"
        "- files/: original selected files with their native companion relationships.\n\n"
        "Project " + review["project"]["id"] + "\nReview " + review["id"] + "\n"
    )


def _package_manifest(root, packet):
    members = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            _regular(root, relative)
            descriptor = describe_file(root, path)
            members[relative] = {"bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    value = {"schema": PACKAGE_SCHEMA, "project_id": packet["review"]["project"]["id"],
             "review_id": packet["review"]["id"],
             "response_ids": [item["id"] for item in packet["responses"]],
             "created_at": now(), "members": members}
    return {**value, "package_sha256": digest(value)}


def export_review(workspace, review_id, destination, *, archive=None, expected_response_id=_UNSPECIFIED,
                  through_response_id=_UNSPECIFIED):
    """Export the selected review, optionally binding its response generation.

    An explicit None selects the original request with no recorded response.
    Omitting the argument keeps the direct caller\'s current-history behavior.
    through_response_id selects a retained historical prefix for an engineering
    handback; it does not change the current response history or its import rules.
    """
    if expected_response_id is not _UNSPECIFIED and through_response_id is not _UNSPECIFIED:
        raise ValueError("Select either a current-response guard or a retained historical prefix")
    if expected_response_id is not _UNSPECIFIED and expected_response_id is not None:
        identifier(expected_response_id)
    destination = Path(destination).absolute()
    source_root = Path(__file__).resolve().parent.parent
    if destination.resolve().is_relative_to(workspace.root) or destination.resolve().is_relative_to(source_root):
        raise ValueError("Choose a fresh review destination outside the workspace and application source")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Choose a new review export directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".review-", dir=destination.parent))
    try:
        with held(workspace.root / ".workspace.lock", blocking=False):
            packet = show_review(workspace, review_id)
            if expected_response_id is not _UNSPECIFIED and packet["latest_response_id"] != expected_response_id:
                raise ValueError("Review response changed before export; reopen the review and select its current response")
            if through_response_id is not _UNSPECIFIED:
                packet["responses"] = response_prefix(packet["responses"], through_response_id)
                packet["latest_response_id"] = packet["responses"][-1]["id"] if packet["responses"] else None
            cache, captured = {}, {}
            for item in packet["review"]["artifacts"]:
                path = _resolve(workspace, item, cache)
                target = pending / item["path"]
                original = captured.get((item["sha256"], item["bytes"]))
                if original is not None:
                    # Keep every original path while avoiding a second disk copy.
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        os.link(original, target)
                    except OSError:
                        _copy_file(path, target, item)
                else:
                    _copy_file(path, target, item)
                    captured[(item["sha256"], item["bytes"])] = target
            atomic_json(pending / "review.json", packet, immutable=True)
            atomic_json(pending / "response-template.json",
                        response_template(workspace, review_id, through_response_id=through_response_id), immutable=True)
            (pending / "index.html").write_text(_html(packet), encoding="utf-8")
            (pending / "README.md").write_text(_readme(packet), encoding="utf-8")
            manifest = _package_manifest(pending, packet)
            atomic_json(pending / "review-manifest.json", manifest, immutable=True)
            inspect_packet(pending)
            if destination.exists():
                raise ValueError("Review destination appeared during export")
            os.rename(pending, destination)
            pending = None
        result = _export_result(destination, manifest, packet)
        if archive is not None:
            result["archive"] = archive_packet(destination, archive)
        return result
    finally:
        if pending is not None:
            shutil.rmtree(pending)


def _export_result(directory, manifest, packet):
    return {"schema": PACKAGE_SCHEMA, "review_id": manifest["review_id"], "project_id": manifest["project_id"],
            "directory": str(directory), "index": str(directory / "index.html"),
            "package_sha256": manifest["package_sha256"], "members": len(manifest["members"]),
            "artifact_count": len(packet["files"]), "latest_response_id": packet["latest_response_id"]}


def describe_export(directory, *, archive=None):
    """Inspect an existing complete export and return its original result shape.

    This reopens the exact retained generation without reading newer workspace
    responses. Call archive_packet first if an interrupted export lacks its ZIP.
    """
    directory = Path(directory).absolute()
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Select an original complete review export directory")
    inspected = inspect_packet(directory)
    result = _export_result(directory, inspected["manifest"], inspected["packet"])
    if archive is not None:
        archive = Path(archive).absolute()
        if archive.is_symlink() or not stat.S_ISREG(archive.lstat().st_mode):
            raise ValueError("Select an original ordinary review archive file")
        archived = inspect_packet(archive)
        if archived["manifest"]["package_sha256"] != inspected["manifest"]["package_sha256"]:
            raise ValueError("Review archive and exported directory describe different generations")
        result["archive"] = {"path": str(archive), "bytes": archive.stat().st_size,
                             "sha256": file_digest(archive), "package_sha256": result["package_sha256"]}
    return result


def _check_package_manifest(value):
    if not isinstance(value, dict) or value.get("schema") != PACKAGE_SCHEMA:
        raise ValueError("Select an original customer review package")
    if value.get("package_sha256") != digest({key: item for key, item in value.items() if key != "package_sha256"}):
        raise ValueError("Review package inventory changed")
    members = value.get("members")
    if not isinstance(members, dict) or not {"review.json", "index.html", "response-template.json"} <= set(members):
        raise ValueError("Review package lacks its review, application or response template")
    folded = []
    for name, item in members.items():
        folded.append(_relative(name).casefold())
        if type(item.get("bytes")) is not int or item["bytes"] < 0:
            raise ValueError("Review package member needs its actual byte count")
        identifier(item.get("sha256"))
    _unique(folded, "review package paths")
    return value


def inspect_packet(path):
    path = Path(path)
    if path.is_dir():
        manifest = _check_package_manifest(_read_json_file(_regular(path, "review-manifest.json")))
        actual = {item.relative_to(path).as_posix() for item in path.rglob("*") if item.is_file()}
        if actual != set(manifest["members"]) | {"review-manifest.json"}:
            raise ValueError("Review directory differs from its exact file inventory")
        for name, item in manifest["members"].items():
            _regular(path, name)
            verify_file(path, {"path": name, **item})
        packet = _read_json_file(_regular(path, "review.json"))
    else:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            _unique(names, "review archive members")
            for info in infos:
                _relative(info.filename)
                if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise ValueError("Review archives contain only ordinary unencrypted files")
            if archive.getinfo("review-manifest.json").file_size > JSON_BYTES:
                raise ValueError("Review manifest is too large")
            manifest = _check_package_manifest(json.loads(archive.read("review-manifest.json")))
            if set(names) != set(manifest["members"]) | {"review-manifest.json"}:
                raise ValueError("Review archive differs from its exact file inventory")
            for name, expected in manifest["members"].items():
                if archive.getinfo(name).file_size != expected["bytes"]:
                    raise ValueError("Review archive member length differs: " + name)
                h = hashlib.sha256()
                with archive.open(name) as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        h.update(block)
                if h.hexdigest() != expected["sha256"]:
                    raise ValueError("Review archive member differs: " + name)
            if archive.getinfo("review.json").file_size > JSON_BYTES:
                raise ValueError("Review document is too large")
            packet = json.loads(archive.read("review.json"))
    if packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("Review document schema differs")
    review = packet["review"]
    if (review.get("id") != manifest["review_id"] or review.get("project", {}).get("id") != manifest["project_id"]
            or [record["id"] for record in packet["responses"]] != manifest["response_ids"]):
        raise ValueError("Review package identity differs from its retained review document")
    # Preview is derived for offline display; it is outside the immutable request.
    clean = {key: item for key, item in review.items() if key != "id"}
    clean["artifacts"] = [{key: value for key, value in item.items() if key != "preview"} for item in review["artifacts"]]
    if digest(clean) != review["id"]:
        raise ValueError("Review request identity differs")
    expected_files = [{"artifact_id": item["id"], "path": item["path"],
                       "bytes": item["bytes"], "sha256": item["sha256"]}
                      for item in review["artifacts"]]
    if packet.get("files") != expected_files:
        raise ValueError("Review package files differ from its selected original artifacts")
    for item in packet["files"]:
        name = _relative(item["path"])
        expected = manifest["members"].get(name)
        if expected != {"bytes": item["bytes"], "sha256": item["sha256"]}:
            raise ValueError("Selected review file differs from the complete package inventory")
    return {"manifest": manifest, "packet": packet}


def archive_packet(directory, destination):
    directory, destination = Path(directory).resolve(), Path(destination).absolute()
    inspected = inspect_packet(directory)
    if destination.resolve().is_relative_to(directory) or destination.exists() or destination.is_symlink():
        raise ValueError("Choose a new review archive path outside its exported directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.parent / (".review-archive-" + destination.name + ".pending")
    created = False
    try:
        with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=3,
                             allowZip64=True) as archive:
            created = True
            for name in sorted(set(inspected["manifest"]["members"]) | {"review-manifest.json"}):
                archive.write(_regular(directory, name), name)
        inspect_packet(pending)
        os.link(pending, destination)
        return {"path": str(destination), "bytes": destination.stat().st_size,
                "sha256": file_digest(destination), "package_sha256": inspected["manifest"]["package_sha256"]}
    finally:
        if created:
            pending.unlink(missing_ok=True)


def receive_packet(path, destination, *, workspace=None):
    inspected = inspect_packet(path)
    destination = Path(destination).absolute()
    if Path(path).is_dir() and destination.resolve().is_relative_to(Path(path).resolve()):
        raise ValueError("Receive into a new directory outside the original review packet")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Receive the review into a new directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".review-receive-", dir=destination.parent))
    try:
        names = sorted(set(inspected["manifest"]["members"]) | {"review-manifest.json"})
        if Path(path).is_dir():
            for name in names:
                source = _regular(path, name)
                expected = {"bytes": source.stat().st_size, "sha256": file_digest(source)}
                _copy_file(source, pending / name, expected)
        else:
            with zipfile.ZipFile(path) as archive:
                for name in names:
                    target = pending / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(name) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
        inspected = inspect_packet(pending)
        joined = None
        if workspace is not None:
            joined = import_packet(workspace, inspected["packet"])
        if destination.exists():
            raise ValueError("Review receiving destination appeared during intake")
        os.rename(pending, destination)
        pending = None
        return {"schema": PACKAGE_SCHEMA, "directory": str(destination), "index": str(destination / "index.html"),
                "review_id": inspected["manifest"]["review_id"], "package_sha256": inspected["manifest"]["package_sha256"],
                "joined": joined}
    finally:
        if pending is not None:
            shutil.rmtree(pending)


def import_packet(workspace, packet):
    """Preflight and join a complete original review to its restored Workspace."""
    if not isinstance(packet, dict) or packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("Import the original complete review packet document")
    review = copy.deepcopy(packet["review"])
    for artifact in review["artifacts"]:
        artifact.pop("preview", None)
    expected_id = identifier(review["id"])
    if digest({key: value for key, value in review.items() if key != "id"}) != expected_id:
        raise ValueError("Incoming review request changed")
    with held(workspace.root / ".workspace.lock", blocking=False):
        _validate_bindings(workspace, review)
        cache = {}
        for item in review["artifacts"]:
            path = _resolve(workspace, item, cache)
            if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
                raise ValueError("Restore the original selected workspace files before joining this review")
        try:
            workspace._get("reviews", expected_id)
        except FileNotFoundError:
            current = []
        else:
            current = history(workspace, expected_id)
        incoming = packet.get("responses")
        if not isinstance(incoming, list):
            raise ValueError("Review packet needs its complete response history")
        current_ids = [item["id"] for item in current]
        incoming_ids, previous = [], None
        normalized = []
        for record in incoming:
            checked = _checked_response(record["response"], review)
            if (checked["previous_response_id"] != previous or record.get("previous_response_id") != previous
                    or record.get("request_sha256") != digest(checked)
                    or record.get("project_id") != workspace.project["id"]
                    or record.get("review_id") != expected_id
                    or record.get("schema") != "upstate.review-responses/v1"):
                raise ValueError("Incoming response history differs from the original review")
            if digest({key: value for key, value in record.items() if key != "id"}) != record.get("id"):
                raise ValueError("Incoming response record identity differs")
            previous = record["id"]
            incoming_ids.append(previous)
            normalized.append(record)
        if packet.get("latest_response_id") != previous:
            raise ValueError("Incoming review names another response generation")
        shared = min(len(current_ids), len(incoming_ids))
        if current_ids[:shared] != incoming_ids[:shared]:
            raise ValueError("Review response histories have diverged; preserve both and reconcile their decisions")
        # No record is published before every incoming response and original
        # source binding has passed.  An interrupted valid join resumes its
        # already-retained immutable prefix through the same original importer.
        original = workspace._save("reviews", review)
        for record in normalized[len(current_ids):]:
            retained = workspace._save("review-responses", record)
            if retained["id"] != record["id"]:
                raise ValueError("Receiving changed an original customer response")
        complete = history(workspace, original["id"])
        return {"review_id": original["id"], "responses": len(complete),
                "latest_response_id": complete[-1]["id"] if complete else None}


def validate_workspace(workspace, *, verify_files=False):
    count = 0
    for review in workspace._list("reviews"):
        _validate_bindings(workspace, review)
        count += len(history(workspace, review["id"]))
        if verify_files:
            show_review(workspace, review["id"], previews=False)
    from .review_handback import validate_workspace as validate_handbacks
    return {"project_id": workspace.project["id"], "reviews": len(workspace._list("reviews")),
            "responses": count, "selected_files_checked": bool(verify_files), **validate_handbacks(workspace)}


def list_reviews(workspace):
    result = []
    for review in workspace._list("reviews"):
        records = history(workspace, review["id"])
        result.append({"id": review["id"], "title": review["title"], "purpose": review["purpose"],
                       "created_at": review["created_at"], "artifacts": len(review["artifacts"]),
                       "requirements": len(review["requirements"]), "responses": len(records),
                       "latest_response_id": records[-1]["id"] if records else None,
                       "disposition": records[-1]["response"]["disposition"] if records else "in-review"})
    return sorted(result, key=lambda item: (item["created_at"], item["id"]))


def compare_reviews(workspace, before_id, after_id):
    before = workspace._get("reviews", identifier(before_id))
    after = workspace._get("reviews", identifier(after_id))
    _validate_bindings(workspace, before)
    _validate_bindings(workspace, after)
    def keyed(review):
        result = {}
        for item in review["artifacts"]:
            logical = (item["selection_kind"], item["origin"].get("id") or item["role"],
                       item["origin"].get("uri", ""), item["original_path"])
            key = digest(logical)
            if key in result:
                # Multiple selected generations remain distinct, rather than overwriting a row.
                key = digest([logical, item["selection_id"]])
            result[key] = item
        return result
    old, new = keyed(before), keyed(after)
    changed, unchanged = [], []
    for key in sorted(set(old) & set(new)):
        first, second = old[key], new[key]
        fields = [field for field in ("sha256", "bytes", "origin", "description") if first[field] != second[field]]
        (changed if fields else unchanged).append({"before": first["id"], "after": second["id"],
                                                   "label": second["label"], "changed_fields": fields})
    return {"schema": "upstate.customer-review-comparison/v1", "before_review_id": before_id,
            "after_review_id": after_id, "purpose_changed": before["purpose"] != after["purpose"],
            "changed": changed, "unchanged": unchanged,
            "added": [new[key] for key in sorted(set(new) - set(old))],
            "removed": [old[key] for key in sorted(set(old) - set(new))]}
