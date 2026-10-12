#!/usr/bin/env python3
"""Read and retain an accepted office edition through the maintained QGIS field reader.

This adapter does not collect observations, synchronize an offline database, or
open a map in QGIS. It consumes the original committed field.accept and its files.
"""
from __future__ import annotations
import contextlib
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

QGIS_ROOT = Path(__file__).resolve().parent.parent / "qgis"
sys.path.insert(0, str(QGIS_ROOT))
from starforge_stac.model import (QgisWorkspace, QgisReceivingError, require, member,
    descriptor, file_digest, read_json, json_bytes, value_sha, retain_bytes, retain_copy)
from starforge_stac.field import campaign_for, round_for, read_bundle, verify_tree, operation_lock
from starforge_stac.field_native import _edition

SCHEMA = "starforge.postgis-accepted-field-source.v1"
MAX_INPUT = 16 * 1024 * 1024


def ordinary(path):
    p = Path(path)
    require(p.is_absolute() and p.is_dir() and not any(x.is_symlink() for x in (p, *p.parents)),
            "FIELD_SOURCE_DIRECTORY", "Select the original ordinary absolute workspace.")
    return p


def checked_workspace(path):
    root = ordinary(path)
    db = root / "workspace.sqlite"
    require(db.is_file() and not db.is_symlink(), "FIELD_SOURCE_WORKSPACE_MISSING",
            "Open the existing office workspace; this read never initializes one.")
    return QgisWorkspace(root, create=False)


def selection(workspace, project_id, expected_id=None, expected_sha=None):
    snap = workspace.snapshot()
    state = snap["state"]
    require(expected_id is None or state["id"] == expected_id, "FIELD_SOURCE_WORKSPACE_CHANGED",
            "The selected original office workspace changed.")
    project = next((x for x in state["projects"] if x["id"] == project_id), None)
    require(project and project.get("kind") == "field", "FIELD_SOURCE_ACCEPTED_MAP_REQUIRED",
            "Select an accepted office map from the existing field workflow.")
    field = project["field"]
    campaign, round_row = round_for(state, field["roundId"])
    returned = next((x for x in round_row["returns"] if x["id"] == field["returnId"]), None)
    require(campaign["id"] == field["campaignId"] and round_row["status"] == "accepted" and
            round_row["acceptedProjectId"] == project_id and round_row["acceptedReturnId"] == field["returnId"] and
            returned and returned["ready"], "FIELD_SOURCE_ACCEPTANCE_CHANGED",
            "The field map must match its actual committed office acceptance.")
    edition = field["edition"]
    require(expected_sha is None or edition["sha256"] == expected_sha, "FIELD_SOURCE_EDITION_CHANGED",
            "The selected accepted office edition changed.")
    native = round_row["nativeResult"]
    require(native.get("engine") == "QgsOfflineEditing.synchronize" and
            native.get("allReviewedFeaturesMatched") is True and
            native.get("acceptedEditionSha256") == edition["sha256"] and
            native.get("reviewedReturnId") == returned["id"] and
            native.get("exportRoundId") == round_row["id"], "FIELD_SOURCE_NATIVE_ACCEPTANCE_REQUIRED",
            "Retain the original completed synchronization and reviewed edition.")
    matches = [r for r in snap["requests"] if r["result"].get("event", {}).get("action") == "field.accept" and
               r["result"].get("project", {}).get("id") == project_id]
    require(len(matches) == 1, "FIELD_SOURCE_ORIGINAL_ACCEPTANCE_REQUIRED",
            "Select the single original committed office acceptance.")
    acceptance = matches[0]
    payload = {"roundId": round_row["id"], "returnId": returned["id"],
               "reviewSha256": returned["review"]["sha256"], "note": round_row["acceptanceNote"]}
    require(acceptance["inputSha256"] == value_sha({"action": "field.accept", "payload": payload}) and
            acceptance["result"]["project"] == project and acceptance["result"]["edition"] == edition,
            "FIELD_SOURCE_ORIGINAL_ACCEPTANCE_CHANGED", "The original field request/result binding changed.")
    accepted_root, accepted_manifest, _ = _edition(workspace, edition)
    base_root, base_manifest, _ = _edition(workspace, round_row["baseEdition"])
    require(accepted_manifest["lineage"].get("previousEditionSha256") == round_row["baseEditionSha256"] and
            accepted_manifest["lineage"].get("reviewSha256") == returned["review"]["sha256"] and
            accepted_manifest["lineage"].get("returnId") == returned["id"],
            "FIELD_SOURCE_LINEAGE_CHANGED", "Preserve the actual accepted field lineage.")
    bundle, _ = read_bundle(member(workspace.root, returned["bundleRoot"], existing=False))
    require(bundle["metadata"]["review"]["sha256"] == returned["review"]["sha256"],
            "FIELD_SOURCE_REVIEW_CHANGED", "The accepted review must match the native return.")
    original_project = next(x for x in state["projects"] if x["id"] == campaign["sourceProjectId"])
    require(original_project["file"]["sha256"] == campaign["sourceProjectSha256"],
            "FIELD_SOURCE_ORIGINAL_MAP_CHANGED", "Preserve the original commissioned map.")
    all_files = {r["path"]: r for r in workspace.project_files(snap)}
    names = set()
    for group in (campaign.get("files", []), round_row.get("files", []), returned.get("files", []),
                  original_project.get("derivedFiles", []), project.get("derivedFiles", []),
                  round_row["baseEdition"]["files"], edition["files"]):
        names.update(r["path"] for r in group)
    names.update((original_project["file"]["path"], project["file"]["path"]))
    # Original selected source receipts travel with the accepted office lineage.
    for source_id in project["sourceIds"]:
        record = next(x for x in state["sources"] if x["id"] == source_id)
        names.update(p for p in all_files if p.startswith(record["path"] + "/"))
    files = [descriptor(all_files[p]) for p in sorted(names)]
    for row in files:
        file_digest(member(workspace.root, row["path"]), expected=row)
    review_path = returned["review"]["path"]
    require(review_path in names and edition["manifest"]["path"] in names and
            round_row["baseEdition"]["manifest"]["path"] in names,
            "FIELD_SOURCE_FILE_CLOSURE", "The complete accepted field context is required.")
    return {"workspaceId": state["id"], "observedRevision": state["revision"],
            "project": project, "campaign": campaign, "round": round_row, "returned": returned,
            "acceptance": acceptance, "configuration": field["configuration"],
            "acceptedManifest": accepted_manifest, "baseManifest": base_manifest,
            "acceptedEditionSha256": edition["sha256"], "reviewPath": review_path,
            "files": files}


def inspect(request):
    workspace = checked_workspace(request["workspaceDirectory"])
    snapshot = workspace.snapshot()
    projects = []
    for project in snapshot["state"]["projects"]:
        if project.get("kind") != "field":
            continue
        field = project["field"]
        campaign, round_row = round_for(snapshot["state"], field["roundId"])
        projects.append({"projectId": project["id"], "campaignId": campaign["id"], "title": campaign["title"],
                         "roundId": round_row["id"], "returnId": field["returnId"],
                         "fieldEditionSha256": field["edition"]["sha256"], "projectFile": project["file"],
                         "acceptedAt": round_row.get("acceptedAt"), "acceptedBy": round_row.get("acceptedBy"),
                         "status": round_row["status"], "configuration": field["configuration"]})
    return {"schema": "starforge.postgis-field-inventory.v1", "workspaceId": snapshot["state"]["id"],
            "revision": snapshot["state"]["revision"], "projects": projects}


def verify(directory, expected_sha=None):
    root = ordinary(directory)
    manifest, raw = read_json(root / "accepted-field.json")
    measured = {"path": "accepted-field.json", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    require(manifest.get("schema") == SCHEMA and
            (expected_sha is None or measured["sha256"] == expected_sha),
            "FIELD_SOURCE_MANIFEST_CHANGED", "Use the original accepted field source manifest.")
    refs = manifest["files"]
    require(len({r["path"] for r in refs}) == len(refs), "FIELD_SOURCE_DUPLICATE_FILE", "Duplicate retained field member.")
    for row in refs:
        file_digest(member(root, row["path"]), expected=row)
    context, _ = read_json(root / "context.json")
    require(context["workspaceId"] == manifest["workspaceId"] and
            context["acceptedEditionSha256"] == manifest["fieldEditionSha256"] and
            context["acceptance"]["requestId"] == manifest["acceptanceRequestId"] and
            context["returned"]["review"]["sha256"] == manifest["reviewSha256"],
            "FIELD_SOURCE_CONTEXT_CHANGED", "The selected source and original acceptance changed.")
    declared = {r["path"]: descriptor(r) for r in refs}
    for row in context["files"]:
        copied = {**descriptor(row), "path": "original/" + row["path"]}
        require(declared.get(copied["path"]) == copied, "FIELD_SOURCE_ORIGINAL_NOT_BOUND",
                "Every selected original field file must remain in the receiving package.")
    require(declared.get("context.json") and
            declared.get("original/" + context["reviewPath"]) and declared.get(manifest["changes"]["path"]) == manifest["changes"],
            "FIELD_SOURCE_REVIEW_NOT_BOUND", "The original review and complete changes are required.")
    return {"directory": str(root), "manifest": manifest, "manifestFile": measured, "context": context}


def export(request):
    root = ordinary(request["directory"])
    request_sha = request["requestSha256"]
    # The controller creates the same original request before this file-only child.
    claim, _ = read_json(root / "request.json")
    require(claim.get("sourceRequestSha256") == request_sha,
            "FIELD_SOURCE_REQUEST_CHANGED", "Continue the original source retention request.")
    if (root / "accepted-field.json").exists():
        return verify(root)
    context_path = root / "context.json"
    if context_path.exists():
        context, _ = read_json(context_path)
        require(context["workspaceId"] == request["workspaceId"] and
                context["project"]["id"] == request["fieldProjectId"] and
                context["acceptedEditionSha256"] == request["fieldEditionSha256"],
                "FIELD_SOURCE_SELECTION_CHANGED", "The retained original field selection changed.")
    else:
        workspace = checked_workspace(request["workspaceDirectory"])
        context = selection(workspace, request["fieldProjectId"], request["workspaceId"], request["fieldEditionSha256"])
        retain_bytes(root, "context.json", json_bytes(context))
    donor = ordinary(request["workspaceDirectory"])
    copied = []
    for row in context["files"]:
        destination = "original/" + row["path"]
        retain_copy(member(donor, row["path"]), root, destination, row)
        copied.append({"path": destination, "bytes": row["bytes"], "sha256": row["sha256"]})
    review_path = member(root, "original/" + context["reviewPath"])
    # Reuse the actual field review; do not reconstruct its comparison or geometry.
    rows = []
    with sqlite3.connect(review_path.as_uri() + "?mode=ro", uri=True) as db:
        summary = json.loads(db.execute("SELECT body FROM metadata WHERE key='summary'").fetchone()[0])
        require(summary == context["returned"]["summary"] and summary["issues"] == 0,
                "FIELD_SOURCE_ACCEPTED_REVIEW_REQUIRED", "The accepted original review changed.")
        for sequence, body in db.execute("SELECT sequence,body FROM changes ORDER BY sequence"):
            row = json.loads(body)
            require(not row.get("issues") and row["kind"] in ("added", "changed", "deleted", "attachment"),
                    "FIELD_SOURCE_UNRESOLVED_REVIEW", "The original office must accept a ready return.")
            rows.append(json_bytes({"sequence": sequence, "changeId": hashlib.sha256(
                (context["returned"]["review"]["sha256"] + ":" + str(sequence)).encode()).hexdigest(),
                "originalBody": body, "change": row}))
    retain_bytes(root, "changes.ndjson", b"".join(rows))
    files = copied + [{"path": name, **file_digest(root / name)} for name in ("context.json", "changes.ndjson")]
    files.sort(key=lambda x: x["path"])
    manifest = {"schema": SCHEMA, "workspaceId": context["workspaceId"], "fieldProjectId": context["project"]["id"],
                "campaignId": context["campaign"]["id"], "roundId": context["round"]["id"],
                "returnId": context["returned"]["id"], "fieldEditionSha256": context["acceptedEditionSha256"],
                "acceptanceRequestId": context["acceptance"]["requestId"],
                "acceptedAt": context["round"]["acceptedAt"], "acceptedBy": context["round"]["acceptedBy"],
                "reviewSha256": context["returned"]["review"]["sha256"], "summary": summary,
                "changes": next(x for x in files if x["path"] == "changes.ndjson"), "changeCount": len(rows),
                "files": files, "reader": {"path": "stac/postgis/field_source.py",
                    "sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
                "nativeReexecuted": False, "sourceScope": "Committed accepted office edition and its retained native context"}
    retain_bytes(root, "accepted-field.json", json_bytes(manifest))
    return verify(root)


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    require(len(raw) <= MAX_INPUT, "FIELD_SOURCE_REQUEST_LIMIT", "Use a bounded original request.")
    request = json.loads(raw)
    action = request.get("command")
    if action == "inspect":
        result = inspect(request)
    elif action == "export":
        with operation_lock(ordinary(request["directory"])):
            result = export(request)
    elif action == "verify":
        result = verify(request["directory"], request.get("expectedManifestSha256"))
    else:
        raise ValueError("Unknown accepted field source command.")
    sys.stdout.buffer.write(json_bytes({"ok": True, "result": result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stdout.buffer.write(json_bytes({"ok": False, "error": {
            "code": getattr(error, "code", "FIELD_SOURCE_READ_FAILED"), "message": str(error)}}))
        sys.exit(2)
