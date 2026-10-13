"""Admit one received foreign comparison as a new local editable comparison.

The original received report is the input authority. Original source bytes enter
the maintained source importer; the maintained selected-HUC producer computes the
new local edition. No raster, annual analysis or foreign identity is replaced.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from .reuse import copy_verified

DIRECTORY = "observed-landcover-copies"
SCHEMA = "upstate.received-landcover-copy/v1"
EDITION = "received-original-landcover-copy/1"
ORIGIN_KEY = "received_landcover_copy"
BINDING_FIELDS = ("analysis_sha256", "source_domain_sha256", "rasters", "grid",
                  "coordinate_operation", "method", "original_huc_count",
                  "original_overlap_cells")


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _relative(value):
    _require(isinstance(value, str) and "\\" not in value and "\0" not in value,
             "Original source members need portable relative names")
    name = PurePosixPath(value)
    _require(name.parts and not name.is_absolute() and ".." not in name.parts
             and name.as_posix() == value and all(":" not in part for part in name.parts),
             "Original source member escapes its retained directory")
    return value


def _context(workspace, payload):
    from . import study_receiving
    _require(isinstance(payload, dict) and not set(payload) - {
        "study_id", "source_collection_id", "source_id", "source_body_sha256",
        "title", "copy_id"}, "Select the received Study, exact original source and local title")
    key = identifier(payload.get("study_id"))
    collection_id = identifier(payload.get("source_collection_id"))
    source_id = payload.get("source_id")
    checksum = identifier(payload.get("source_body_sha256"))
    _require(isinstance(source_id, str) and source_id, "Choose the exact received source")
    detail = study_receiving.detail(workspace, key)
    rows = [row for row in detail.get("observed_landcover_sources", [])
            if row["source"] == {"source_collection_id": collection_id, "source_id": source_id}]
    _require(len(rows) == 1, "Choose a selected-watershed source captured in this received Study")
    captured = rows[0]
    _require(captured["relationship"] == "external_project"
             and captured["source_project_id"] != workspace.project["id"]
             and captured["native"] is None,
             "Open the original saved comparison for a source already local to this project")
    _require(captured["source_body_sha256"] == checksum,
             "Reopen the exact received source before creating its local comparison")
    title = payload.get("title")
    if title is None:
        title = ("Local copy: " + captured["title"])[:200]
    _require(isinstance(title, str) and title.strip() and len(title.strip()) <= 200
             and "\0" not in title, "Enter a local comparison title of at most 200 characters")
    title = title.strip()
    collection = workspace._get("sources", collection_id)
    entries = [row for row in collection["entries"] if row["id"] == source_id]
    _require(len(entries) == 1 and entries[0]["body"]["sha256"] == checksum,
             "Received source collection differs from its captured report")
    entry = entries[0]
    members = {row.get("view_path", row["filename"]): row for row in entry.get("companions", [])}
    _require(len(members) == len(entry.get("companions", [])),
             "Received source repeats an original companion")
    report_file = members["selection.json"]
    report = read_json(verify_file(workspace.root, {
        "path": report_file["object"], "bytes": report_file["bytes"], "sha256": report_file["sha256"]}))
    _require(report["selection"] == captured["selection"]
             and report["binding"]["analysis_sha256"] == captured["source_binding"]["analysis_sha256"],
             "Received comparison changed its original selection or analysis")
    originals = report["binding"]["inputs"]
    _require(len(originals) == 4, "Retain all four original analysis and annual input records")
    files, seen = [], set()
    for index, item in enumerate(originals):
        original = item["entry"]
        _require(item["source_id"] == original["id"] and original["id"] not in seen
                 and item["source_collection_id"] == report["binding"]["source_collection_id"],
                 "Original analysis input identities differ")
        seen.add(original["id"])
        for body in [original["body"], *original.get("companions", [])]:
            name = "originals/" + str(index) + "/" + _relative(body.get("view_path", body["filename"]))
            actual = members.get(name)
            _require(actual is not None and actual["bytes"] == body["bytes"]
                     and actual["sha256"] == body["sha256"],
                     "The received report lacks an exact original input: " + name)
            path = verify_file(workspace.root, {
                "path": actual["object"], "bytes": body["bytes"], "sha256": body["sha256"]})
            files.append({"path": name, "object": actual["object"],
                          "bytes": body["bytes"], "sha256": body["sha256"]})
    identity = {
        "edition": EDITION, "producer_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "study_id": key, "title": title,
        "source": {"source_collection_id": collection_id, "source_id": source_id},
        "source_body_sha256": checksum, "captured_lineage": deepcopy(captured["lineage"]),
        "original_selection_sha256": report_file["sha256"],
    }
    copy_id = digest(identity)
    if payload.get("copy_id") is not None:
        _require(identifier(payload["copy_id"]) == copy_id,
                 "The local-copy preview changed; verify the received source again")
    return identity, copy_id, report, originals, files


def preview(workspace, payload):
    identity, key, report, originals, files = _context(workspace, payload)
    existing = workspace.root / DIRECTORY / key / "receipt.json"
    return {
        "schema": SCHEMA, "id": key, "title": identity["title"],
        "project_id": workspace.project["id"],
        "source_project_id": identity["captured_lineage"]["source_project_id"],
        "source": identity["source"], "source_body_sha256": identity["source_body_sha256"],
        "original_selection_id": identity["captured_lineage"]["observed_landcover_selection_id"],
        "huc12s": deepcopy(report["selection"]["huc12s"]),
        "years": deepcopy(report["binding"]["rasters"]),
        "input_count": len(originals), "input_members": len(files),
        "input_bytes": sum(row["bytes"] for row in files),
        "existing_copy": get(workspace, key) if existing.exists() else None,
    }


def _manifest(identity, key, originals, created_at):
    entries = []
    for index, item in enumerate(originals):
        original = item["entry"]
        entry = {name: deepcopy(value) for name, value in original.items()
                 if name not in ("body", "companions")}
        metadata = deepcopy(entry.get("metadata") or {})
        lineage = {
            "schema": SCHEMA, "copy_id": key, "project_id": identity["project_id"],
            "source_project_id": identity["captured_lineage"]["source_project_id"],
            "original_source": deepcopy(identity["source"]),
            "original_source_body_sha256": identity["source_body_sha256"],
            "original_selection_id": identity["captured_lineage"]["observed_landcover_selection_id"],
            "original_input_collection_id": item["source_collection_id"],
            "original_input_source_id": item["source_id"],
            "original_input_entry_sha256": digest(original),
        }
        if ORIGIN_KEY in metadata:
            lineage["previous"] = metadata[ORIGIN_KEY]
        metadata[ORIGIN_KEY] = lineage
        entry["metadata"] = metadata
        body = original["body"]
        entry.update(path="originals/" + str(index) + "/" + _relative(
            body.get("view_path", body["filename"])),
            bytes=body["bytes"], sha256=body["sha256"])
        entry["companions"] = [
            {"path": "originals/" + str(index) + "/" + _relative(body.get("view_path", body["filename"])),
             "bytes": body["bytes"], "sha256": body["sha256"]}
            for body in original.get("companions", [])]
        entries.append(entry)
    return {
        "schema": "upstate.sources/v1",
        "title": identity["title"] + " — original received inputs",
        "captured_at": created_at, "entries": entries,
        "scope": {"received_landcover_copy": {"id": key, "identity": deepcopy(identity)}},
        "notes": ["Original publisher metadata and bytes are retained. This source edition admits "
                  "the captured original inputs into the receiving project."],
    }


def _same_science(original, current):
    _require(all(original["binding"][name] == current["binding"][name] for name in BINDING_FIELDS),
             "Local comparison changed the original source grid, years, method or data identity")
    _require(original["selection"]["huc12s"] == current["selection"]["huc12s"]
             and original["summary"] == current["summary"]
             and original["watersheds"] == current["watersheds"],
             "Local comparison changed the captured original quantities or selected watersheds")


def create(workspace, payload):
    from . import observed_landcover
    _require(isinstance(payload, dict) and payload.get("copy_id") is not None,
             "Verify this source through the local-copy preview first")
    identity, key, report, originals, files = _context(workspace, payload)
    directory = workspace.root / DIRECTORY / key
    with held(directory / ".copy.lock", blocking=False):
        if (directory / "receipt.json").exists():
            return get(workspace, key)
        plan_path = directory / "source-admission.json"
        previous = read_json(plan_path) if plan_path.exists() else None
        created_at = previous["created_at"] if previous else now()
        plan = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": created_at,
                "original_inputs": deepcopy(originals), "files": deepcopy(files)}
        atomic_json(plan_path, plan, immutable=True)
        for row in files:
            copy_verified(workspace.root,
                          {"path": row["object"], "bytes": row["bytes"], "sha256": row["sha256"]},
                          directory, path=row["path"])
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, _manifest(identity, key, originals, created_at), immutable=True)
        imported = workspace.import_sources(manifest_path)
        selection = {
            "source_collection_id": imported["id"],
            "analysis_source_id": report["binding"]["analysis_source_id"],
            "analysis_sha256": report["binding"]["analysis_sha256"],
            "huc12s": deepcopy(report["selection"]["huc12s"]), "title": identity["title"],
        }
        inputs = observed_landcover.load_inputs(workspace, selection)
        proposed = observed_landcover.summarize(inputs, selection)
        _same_science(report, proposed)
        edition = observed_landcover.build(workspace, selection)
        local = observed_landcover.inspect(workspace, edition["id"])
        _same_science(report, local["report"])
        receipt = {
            "schema": SCHEMA, "id": key, "state": "complete", "identity": identity,
            "created_at": created_at, "project_id": workspace.project["id"],
            "title": identity["title"], "original_source": deepcopy(identity["source"]),
            "original_source_body_sha256": identity["source_body_sha256"],
            "source_project_id": identity["captured_lineage"]["source_project_id"],
            "original_selection_id": identity["captured_lineage"]["observed_landcover_selection_id"],
            "local_selection_id": edition["id"], "local_source": deepcopy(edition["source"]),
            "input_collection_id": imported["id"], "selection": deepcopy(local["report"]["selection"]),
            "source_binding": deepcopy(local["report"]["binding"]),
            "summary": deepcopy(local["report"]["summary"]),
            "files": {"source_admission": describe_file(workspace.root, plan_path),
                      "source_manifest": describe_file(workspace.root, manifest_path)},
        }
        atomic_json(directory / "receipt.json", receipt, immutable=True)
    return get(workspace, key)


def _retained(workspace, key):
    """Validate admission records and CAS bytes without materializing source views."""
    from . import observed_landcover
    key = identifier(key)
    directory = workspace.root / DIRECTORY / key
    receipt = read_json(directory / "receipt.json")
    _require(receipt.get("schema") == SCHEMA and receipt.get("state") == "complete"
             and receipt.get("id") == key == digest(receipt.get("identity"))
             and receipt.get("project_id") == workspace.project["id"]
             and receipt["identity"].get("project_id") == workspace.project["id"],
             "Choose an original local comparison admission in this project")
    identity = receipt["identity"]
    _require(receipt["title"] == identity["title"]
             and receipt["original_source"] == identity["source"]
             and receipt["original_source_body_sha256"] == identity["source_body_sha256"]
             and receipt["source_project_id"] == identity["captured_lineage"]["source_project_id"]
             and receipt["original_selection_id"] == identity["captured_lineage"]["observed_landcover_selection_id"],
             "The admission changed its original report identity")
    _require(receipt["files"]["source_admission"]["path"] == DIRECTORY + "/" + key + "/source-admission.json"
             and receipt["files"]["source_manifest"]["path"] == DIRECTORY + "/" + key + "/sources.json",
             "The admission points outside its original records")
    for descriptor in receipt["files"].values():
        verify_file(workspace.root, descriptor)
    plan = read_json(workspace.root / receipt["files"]["source_admission"]["path"])
    manifest = read_json(workspace.root / receipt["files"]["source_manifest"]["path"])
    _require(plan["id"] == key and plan["identity"] == identity
             and plan["created_at"] == receipt["created_at"]
             and manifest == _manifest(identity, key, plan["original_inputs"], receipt["created_at"]),
             "The admitted original source manifest changed")
    imported = workspace._get("sources", receipt["input_collection_id"])
    _require(imported["scope"]["received_landcover_copy"] == {"id": key, "identity": identity},
             "The local source collection lost its original admission")
    original = workspace._get("sources", receipt["original_source"]["source_collection_id"])
    rows = [row for row in original["entries"] if row["id"] == receipt["original_source"]["source_id"]]
    _require(len(rows) == 1 and rows[0]["body"]["sha256"] == receipt["original_source_body_sha256"],
             "The copied comparison lost its original received report")
    selection_member = next(row for row in rows[0]["companions"]
                            if row.get("view_path", row["filename"]) == "selection.json")
    captured = read_json(verify_file(workspace.root, {
        "path": selection_member["object"], "bytes": selection_member["bytes"],
        "sha256": selection_member["sha256"]}))
    local_id = identifier(receipt["local_selection_id"])
    local_prefix = observed_landcover.KIND + "/" + local_id + "/"
    edition = observed_landcover._receipt(workspace, workspace.root / local_prefix / "receipt.json")
    for descriptor in edition["files"].values():
        _require(_relative(descriptor["path"]).startswith(local_prefix),
                 "Original local comparison member escapes its saved edition")
        verify_file(workspace.root, descriptor)
    report = read_json(workspace.root / edition["files"]["selection.json"]["path"])
    _require(edition["source"] == receipt["local_source"]
             and edition["identity"]["project_id"] == workspace.project["id"]
             and report["selection"] == edition["identity"]["selection"] == receipt["selection"]
             and report["binding"] == edition["identity"]["binding"] == receipt["source_binding"]
             and report["summary"] == edition["summary"] == receipt["summary"],
             "The local editable comparison differs from its retained admission")
    entries = {row["id"]: row for row in imported["entries"]}
    originals = report["binding"]["inputs"]
    _require(len(entries) == len(imported["entries"]) == len(originals) == 4
             and report["selection"]["source_collection_id"] == receipt["input_collection_id"]
             and all(row["source_collection_id"] == receipt["input_collection_id"]
                     and entries.get(row["source_id"]) == row["entry"] for row in originals),
             "The local comparison changed its original admitted input entries")
    for entry in entries.values():
        for body in [entry["body"], *entry.get("companions", [])]:
            verify_file(workspace.root, {"path": body["object"], "bytes": body["bytes"],
                                         "sha256": body["sha256"]})
    local_collection = workspace._get("sources", receipt["local_source"]["source_collection_id"])
    sources = [row for row in local_collection["entries"]
               if row["id"] == receipt["local_source"]["source_id"]]
    recipe = edition["files"]["observed-report.json"]
    _require(len(sources) == 1 and sources[0]["body"]["sha256"] == recipe["sha256"]
             and sources[0]["body"]["bytes"] == recipe["bytes"],
             "The local comparison lost its original report source")
    expected = {name: item for name, item in edition["files"].items()
                if name not in ("observed-report.json", "sources.json", "selected-huc-landcover.zip")}
    actual = {body.get("view_path", body["filename"]): body for body in sources[0].get("companions", [])}
    _require(len(actual) == len(sources[0].get("companions", [])) and set(actual) == set(expected)
             and all(actual[name]["sha256"] == item["sha256"] and actual[name]["bytes"] == item["bytes"]
                     for name, item in expected.items()),
             "The local comparison changed its retained report companions")
    for body in [sources[0]["body"], *sources[0].get("companions", [])]:
        verify_file(workspace.root, {"path": body["object"], "bytes": body["bytes"],
                                     "sha256": body["sha256"]})
    _same_science(captured, report)
    return {**receipt, "files": {**receipt["files"],
            "receipt": describe_file(workspace.root, directory / "receipt.json")}}


def get(workspace, key):
    from . import observed_landcover
    receipt = _retained(workspace, key)
    local = observed_landcover.inspect(workspace, receipt["local_selection_id"])
    inputs = observed_landcover.load_inputs(workspace, receipt["selection"])
    _require(local["edition"]["source"] == receipt["local_source"]
             and local["report"]["selection"] == receipt["selection"]
             and local["report"]["binding"] == receipt["source_binding"] == inputs["binding"]
             and local["report"]["summary"] == receipt["summary"],
             "The editable comparison no longer resolves to its admitted original inputs")
    return receipt


def list_copies(workspace, *, study_id=None, source=None):
    rows = []
    for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")):
        receipt = read_json(path)
        identity = receipt.get("identity", {})
        if study_id is not None and identity.get("study_id") != study_id:
            continue
        if source is not None and identity.get("source") != source:
            continue
        value = _retained(workspace, path.parent.name)
        rows.append({name: deepcopy(value[name]) for name in (
            "id", "title", "created_at", "project_id", "source_project_id",
            "original_source", "original_selection_id", "local_selection_id",
            "local_source", "input_collection_id", "selection")})
    return rows


def include_input(closure, original_entry):
    """Retain the original-to-local admission when its local report is exported."""
    marker = (original_entry.get("metadata") or {}).get(ORIGIN_KEY)
    if marker is None:
        return False
    _require(isinstance(marker, dict) and marker.get("schema") == SCHEMA
             and marker.get("project_id") == closure.workspace.project["id"],
             "Local copied input has another project admission")
    key = identifier(marker["copy_id"])
    prefix = DIRECTORY + "/" + key + "/"
    receipt = closure.read(prefix + "receipt.json")
    _require(receipt.get("schema") == SCHEMA and receipt.get("state") == "complete"
             and receipt.get("id") == key == digest(receipt.get("identity"))
             and receipt.get("project_id") == receipt["identity"].get("project_id") == closure.workspace.project["id"]
             and receipt["original_source"] == receipt["identity"].get("source")
             and receipt["original_source_body_sha256"] == receipt["identity"].get("source_body_sha256")
             and receipt["original_source"] == marker["original_source"]
             and receipt["original_source_body_sha256"] == marker["original_source_body_sha256"]
             and receipt["source_project_id"] == marker["source_project_id"]
             and receipt["original_selection_id"] == marker["original_selection_id"],
             "Local copied input differs from its captured admission")
    for descriptor in receipt["files"].values():
        closure.add_file(descriptor["path"], descriptor)
    plan = closure.read(receipt["files"]["source_admission"]["path"])
    originals = [row for row in plan["original_inputs"]
                 if row["source_id"] == marker["original_input_source_id"]]
    _require(plan["identity"] == receipt["identity"] and len(originals) == 1
             and originals[0]["source_collection_id"] == marker["original_input_collection_id"]
             and digest(originals[0]["entry"]) == marker["original_input_entry_sha256"],
             "The admission changed its original input entry")
    collection = closure.read("sources/" + identifier(receipt["input_collection_id"]) + ".json")
    _require(digest(collection) == receipt["input_collection_id"]
             and [row for row in collection["entries"] if row["id"] == original_entry["id"]] == [original_entry],
             "The editable comparison changed its admitted source entry")
    # A revised comparison can use these admitted inputs without being the
    # first local edition named by the admission. Keep that original edition
    # and its source as well, so the admission still reopens after a selected
    # revised-only Study transfer.
    local_id = identifier(receipt["local_selection_id"])
    local_prefix = "observed-landcover-selections/" + local_id + "/"
    local = closure.read(local_prefix + "receipt.json")
    _require(local.get("schema") == "upstate.observed-landcover-selection/v1"
             and local.get("state") == "complete"
             and local.get("id") == local_id == digest(local.get("identity"))
             and local.get("project_id") == closure.workspace.project["id"]
             and local.get("source") == receipt["local_source"]
             and local["identity"].get("selection") == receipt["selection"]
             and local["identity"].get("binding") == receipt["source_binding"]
             and local.get("summary") == receipt["summary"],
             "The admission lost its original local comparison")
    for descriptor in local["files"].values():
        _require(_relative(descriptor["path"]).startswith(local_prefix),
                 "Original local comparison member escapes its saved edition")
        closure.add_file(descriptor["path"], descriptor)
    closure.tree(local_prefix.rstrip("/"))
    local_collection_id = identifier(receipt["local_source"]["source_collection_id"])
    local_collection = closure.read("sources/" + local_collection_id + ".json")
    local_entries = [row for row in local_collection["entries"]
                     if row["id"] == receipt["local_source"]["source_id"]]
    _require(digest(local_collection) == local_collection_id and len(local_entries) == 1
             and local_entries[0]["body"]["sha256"] == local["files"]["observed-report.json"]["sha256"]
             and local_entries[0]["body"]["bytes"] == local["files"]["observed-report.json"]["bytes"],
             "The admission lost its original local report source")
    closure.need("sources", local_collection_id,
                 "Original local edition retained with its admitted inputs")
    parent_id = identifier(receipt["original_source"]["source_collection_id"])
    parent = closure.read("sources/" + parent_id + ".json")
    parents = [row for row in parent["entries"] if row["id"] == receipt["original_source"]["source_id"]]
    _require(digest(parent) == parent_id and len(parents) == 1
             and parents[0]["body"]["sha256"] == receipt["original_source_body_sha256"],
             "The admission lost its original foreign source collection")
    closure.need("sources", parent_id, "Original foreign comparison retained with its explicit local copy")
    return True


def verify_all(workspace):
    for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")):
        get(workspace, path.parent.name)
