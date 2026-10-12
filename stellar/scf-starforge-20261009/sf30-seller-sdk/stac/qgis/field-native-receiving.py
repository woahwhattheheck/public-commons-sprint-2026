#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run two explicitly commissioned field rounds on an actual received project.

Run this file with the selected QGIS Python environment, with the maintained
starforge_stac package and libqfieldsync importable. No packages are installed
and no cloud job, source download or customer/provider connection is created.

Input schema: starforge.qfield.native-receiving.v1
{
  "schema": "starforge.qfield.native-receiving.v1",
  "id": "one-retained-receiving-name",
  "actor": "Actual office operator",
  "provenance": "Purpose and authority for these explicit commissioning edits",
  "source": {
    "workspace": "/absolute/original/workspace",
    "workspaceId": "actual workspace id",
    "revision": 0,
    "projectId": "actual saved map id",
    "projectSha256": "original saved map SHA-256"
  },
  "configuration": { "...": "the actual field commissioning configuration" },
  "rounds": [
    {
      "profileId": "actual configured profile id",
      "actor": "Actual field operator",
      "note": "Actual office receiving decision",
      "edits": [
        {
          "layerId": "actual original layer id",
          "select": {"sourceFeatureId": 0},
          "expected": {"actual_editable_field": "actual before value"},
          "attributes": {"actual_editable_field": "explicit new value"}
        }
      ],
      "attachments": []
    },
    { "...": "second explicit round, with its actual values" }
  ]
}
The sample shows field shapes only; none of its identifiers or observations is
a supplied project. Each round updates explicitly selected EXISTING features.
A selector contains either identity (string/integer) or sourceFeatureId
(integer). Optional geometry is {expectedSha256: SHA-or-null, wkt: actual WKT}.
Attachment entries bind an actual local source, bytes, sha256, destination path
under attachments/, and previousSha256 (null for a new path). A configured
attachment attribute must explicitly reference that relative destination.

The source workspace stays unchanged. Its original export/receive interfaces
create an owned office, field_command executes the real native operations,
and QGIS edit-buffer commits write the original offline change log. Failed
device-edit attempts stay retained; an incomplete edit never becomes an office
acceptance. Completed attempts and original saved requests are reopened.
"""

from __future__ import annotations

import argparse
import contextlib
import gc
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import tempfile
import uuid
import zipfile

SCHEMA = "starforge.qfield.native-receiving.v1"
HASH = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
CHUNK = 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def ordinary(path, *, directory=False):
    path = Path(path).expanduser().absolute()
    require(path.resolve() == path and not path.is_symlink(),
            "Use the actual original path without aliases: " + str(path))
    require(path.is_dir() if directory else path.is_file(),
            "The selected original file or directory is missing: " + str(path))
    return path


def measured(path):
    path = ordinary(path)
    sha, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            sha.update(block)
            count += len(block)
    return {"bytes": count, "sha256": sha.hexdigest()}


def load(path):
    path = ordinary(path)
    require(path.stat().st_size <= 64 * CHUNK, "Selected JSON exceeds the retained input limit.")
    return json.loads(path.read_bytes())


def retain(path, value):
    path = Path(path)
    body = encoded(value) + b"\n"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        require(not path.is_symlink() and path.read_bytes() == body,
                "The retained original input/result changed: " + str(path))
        return value
    fd, name = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            require(not path.is_symlink() and path.read_bytes() == body,
                    "Another retained result occupies " + str(path))
        if os.name == "posix":
            fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        Path(name).unlink(missing_ok=True)
    return value


@contextlib.contextmanager
def ownership(root):
    root = Path(root).expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    ordinary(root, directory=True)
    require((root / "input.json").exists() or all(p.name == "receiving.lock" for p in root.iterdir()),
            "Use a new receiving directory or the original input-bound continuation.")
    lock = root / "receiving.lock"
    require(not lock.is_symlink(), "Keep the original receiving lock in place.")
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a+b") as stream:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if stream.read(1) == b"":
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            try:
                yield root
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield root
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def observe(phase, **values):
    print(json.dumps({"phase": phase, **values}, ensure_ascii=False,
                     allow_nan=False), flush=True)


def specification(raw):
    require(isinstance(raw, dict) and raw.get("schema") == SCHEMA, "Use the receiving input schema.")
    require(isinstance(raw.get("id"), str) and ID.fullmatch(raw["id"]), "Use one stable receiving ID.")
    for key in ("actor", "provenance"):
        require(isinstance(raw.get(key), str) and raw[key].strip(),
                "Retain the actual " + key + ".")
    source = raw.get("source")
    require(isinstance(source, dict) and isinstance(source.get("workspace"), str) and
            isinstance(source.get("workspaceId"), str) and type(source.get("revision")) is int and
            source["revision"] >= 0 and isinstance(source.get("projectId"), str) and
            isinstance(source.get("projectSha256"), str) and HASH.fullmatch(source["projectSha256"]),
            "Bind the actual donor workspace, revision and original native project SHA-256.")
    require(isinstance(raw.get("configuration"), dict) and
            raw["configuration"].get("projectId") == source["projectId"],
            "Commission the selected original saved project.")
    rounds = raw.get("rounds")
    require(isinstance(rounds, list) and len(rounds) == 2,
            "Supply the two actual commissioned field rounds.")
    for row in rounds:
        require(isinstance(row, dict) and all(isinstance(row.get(k), str) and row[k].strip()
                for k in ("profileId", "actor", "note")), "Name the actual device, field operator and office decision.")
        require(isinstance(row.get("edits"), list) and row["edits"],
                "Select actual existing features and explicit field values for each round.")
        for edit in row["edits"]:
            require(isinstance(edit, dict) and isinstance(edit.get("layerId"), str),
                    "Bind every edit to an actual original layer.")
            select = edit.get("select")
            require(isinstance(select, dict) and set(select) in ({"identity"}, {"sourceFeatureId"}),
                    "Choose one exact original identity or source feature ID.")
            value = next(iter(select.values()))
            require(type(value) in (str, int) and value != "" and
                    ("sourceFeatureId" not in select or type(value) is int),
                    "Keep source identities as their original string/integer values.")
            before, after = edit.get("expected", {}), edit.get("attributes", {})
            require(isinstance(before, dict) and isinstance(after, dict) and set(before) == set(after),
                    "Supply an exact expected-before value for every changed attribute.")
            geometry = edit.get("geometry")
            require(after or geometry is not None, "A selected field edit needs a real attribute or geometry change.")
            if geometry is not None:
                require(isinstance(geometry, dict) and set(geometry) == {"expectedSha256", "wkt"} and
                        (geometry["expectedSha256"] is None or isinstance(geometry["expectedSha256"], str) and
                         HASH.fullmatch(geometry["expectedSha256"])) and isinstance(geometry["wkt"], str),
                        "Bind native geometry to its original digest and actual replacement WKT.")
        attachments = row.get("attachments", [])
        require(isinstance(attachments, list), "Use the actual selected attachment list.")
        destinations = set()
        for attachment in attachments:
            require(isinstance(attachment, dict) and set(attachment) ==
                    {"source", "path", "bytes", "sha256", "previousSha256"},
                    "Bind each original attachment file, relative path, byte count and before/after SHA-256.")
            rel = PurePosixPath(attachment["path"])
            require(not rel.is_absolute() and ".." not in rel.parts and
                    len(rel.parts) >= 2 and rel.parts[0] == "attachments" and
                    rel.as_posix() == attachment["path"] and rel.as_posix() not in destinations,
                    "Use distinct relative attachment destinations under attachments/.")
            destinations.add(rel.as_posix())
            require(type(attachment["bytes"]) is int and attachment["bytes"] >= 0 and
                    isinstance(attachment["sha256"], str) and HASH.fullmatch(attachment["sha256"]) and
                    (attachment["previousSha256"] is None or
                     isinstance(attachment["previousSha256"], str) and HASH.fullmatch(attachment["previousSha256"])),
                    "Retain the actual attachment size and digests.")
    return raw


def verified_package(workspace, path, snapshot):
    """Use the original exporter; reconcile a complete ZIP after a lost return."""
    if not path.exists():
        workspace.export_package(path, expected_revision=snapshot["state"]["revision"])
    ordinary(path)
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("qgis-package.json"))
        captured = json.loads(archive.read("workspace-snapshot.json"))
    require(captured == snapshot and manifest.get("workspaceId") == snapshot["state"]["id"] and
            manifest.get("revision") == snapshot["state"]["revision"],
            "This complete original archive selects a different workspace edition.")
    return {**measured(path), "path": str(path), "workspaceId": snapshot["state"]["id"],
            "revision": snapshot["state"]["revision"]}


def exact_action(workspace, root, name, action, payload, actor, request_prefix):
    from starforge_stac.field import field_command
    path = root / "actions" / (name + ".json")
    if path.exists():
        saved = load(path)
        require(saved["action"] == action and saved["payload"] == payload and
                saved["actor"] == actor and saved["requestId"] == request_prefix + "." + name and
                saved["workspaceId"] == workspace.read()["id"],
                "The saved action selects different original inputs.")
    else:
        saved = {"action": action, "payload": payload, "actor": actor,
                 "requestId": request_prefix + "." + name, "revision": workspace.read()["revision"],
                 "workspaceId": workspace.read()["id"]}
        retain(path, saved)
    result = field_command(workspace, action, payload, revision=saved["revision"],
                           request_id=saved["requestId"], actor=actor)
    retain(root / "actions" / (name + ".result.json"), result)
    observe(name, request_id=saved["requestId"], revision=result["revision"])
    return result, saved


def attachments_to_device(root, values):
    from starforge_stac.model import member, retain_copy
    changed = 0
    for value in values:
        source = ordinary(value["source"])
        require(measured(source) == {"bytes": value["bytes"], "sha256": value["sha256"]},
                "The original selected attachment changed.")
        target = member(root, value["path"], existing=False)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = member(root, value["path"], existing=False)
        prior = measured(target)["sha256"] if target.exists() else None
        require(prior == value["previousSha256"], "The original device attachment before-value changed.")
        # The device directory belongs only to this fresh field edit attempt.
        # A replacement is staged and read back before replacing its exact file.
        stage = root.parent / ("attachment-" + uuid.uuid4().hex)
        stage.mkdir(mode=0o700)
        try:
            retain_copy(source, stage, "payload", value)
            os.replace(stage / "payload", target)
            require(measured(target) == {"bytes": value["bytes"], "sha256": value["sha256"]},
                    "The complete device attachment differs.")
            changed += prior != value["sha256"]
        finally:
            if not any(stage.iterdir()):
                stage.rmdir()
    return changed


def actual_edit(workspace, campaign, round_row, device, edits, attachment_changes=0):
    """QGIS edit-buffer commits, with its ORIGINAL offline logger attached."""
    from qgis.core import QgsProject, QgsVectorLayer, QgsGeometry, QgsOfflineEditing
    from starforge_stac.field_native import _source, _scalar, _geometry
    project = QgsProject.instance()
    project.clear()
    logger = QgsOfflineEditing()  # Constructor connects layerWasAdded -> setupLayer.
    warnings, changed, observations = [], 0, []
    logger.warning.connect(lambda title, message: warnings.append({"title": title, "message": message}))
    active = []
    try:
        require(project.read(str(device / round_row["exportProject"])), "The actual exported device project did not open.")
        require(logger.isOfflineProject(), "The selected device is not the original QGIS offline export.")
        configurations = {row["layerId"]: row for row in campaign["configuration"]["layers"]}
        lineages = {row["layerId"]: row for row in round_row["baseEdition"]["lineage"]["layers"]}
        bindings = {row["layerId"]: row for row in round_row["binding"]["offlineLayers"]}
        plans, selected = {}, set()
        for edit in edits:
            layer_id = edit["layerId"]
            require(layer_id in configurations and layer_id in bindings,
                    "The selected feature is outside the commissioned editable layers.")
            config, binding = configurations[layer_id], bindings[layer_id]
            layer = project.mapLayer(binding["nativeLayerId"])
            require(isinstance(layer, QgsVectorLayer) and layer.isValid() and
                    bool(layer.customProperty("isOfflineEditable", False)), "The original editable native layer is unavailable.")
            provider, _, path = _source(layer)
            require(provider == binding["provider"] and path == (device / binding["path"]).resolve(),
                    "The field edit must target this owned exported logging GeoPackage.")
            selector = edit["select"]
            field = config["identityField"] if "identity" in selector else lineages[layer_id]["originalFeatureIdField"]
            expected_identity = next(iter(selector.values()))
            require(layer.fields().indexFromName(field) >= 0, "The original selected identity field is missing.")
            found = [feature for feature in layer.getFeatures()
                     if digest(_scalar(feature[field])) == digest(expected_identity)]
            require(len(found) == 1, "The original feature selector must identify exactly one retained record.")
            feature = found[0]
            key = (layer_id, feature.id())
            require(key not in selected, "Combine edits to the same original feature before commissioning.")
            selected.add(key)
            before = {name: _scalar(feature[name]) for name in edit.get("expected", {})
                      if layer.fields().indexFromName(name) >= 0}
            require(digest(before) == digest(edit.get("expected", {})), "An actual field attribute differs from the selected before-value.")
            after = edit.get("attributes", {})
            require(set(after) <= set(config["editableFields"]) and config["identityField"] not in after,
                    "Only commissioned editable attributes may change.")
            geometry = edit.get("geometry")
            observed_geometry = _geometry(feature)
            if geometry is not None:
                require(config["allowGeometry"] and geometry["expectedSha256"] ==
                        (observed_geometry["sha256"] if observed_geometry else None),
                        "The native geometry before-value or commissioned permission differs.")
                target_geometry = QgsGeometry.fromWkt(geometry["wkt"])
                require(not target_geometry.isNull() and target_geometry.lastError() == "",
                        "Supply the actual valid replacement geometry.")
            else:
                target_geometry = None
            row = {"edit": edit, "layer": layer, "fid": feature.id(), "before": before,
                   "identity": _scalar(feature[config["identityField"]]), "geometry": target_geometry}
            plans.setdefault(layer_id, []).append(row)
        for rows in plans.values():
            layer = rows[0]["layer"]
            require(layer.startEditing(), "The actual native field layer did not enter editing mode.")
            active.append(layer)
            for row in rows:
                edit = row["edit"]
                for name, value in edit.get("attributes", {}).items():
                    if digest(row["before"][name]) != digest(value):
                        require(layer.changeAttributeValue(row["fid"], layer.fields().indexFromName(name), value),
                                "The native attribute edit was rejected.")
                        changed += 1
                if row["geometry"] is not None:
                    require(layer.changeGeometry(row["fid"], row["geometry"]), "The native geometry edit was rejected.")
                    changed += 1
            require(layer.commitChanges(), "Native field edits did not commit: " + "; ".join(layer.commitErrors()))
            active.remove(layer)
            require(not warnings, "The original offline logger reported: " + json.dumps(warnings))
            for row in rows:
                feature = layer.getFeature(row["fid"])
                require(feature.isValid(), "The changed original feature could not be reopened.")
                actual = {name: _scalar(feature[name]) for name in row["edit"].get("attributes", {})}
                require(digest(actual) == digest(row["edit"].get("attributes", {})),
                        "Native saved values differ from the explicitly authored field edit.")
                if row["geometry"] is not None:
                    expected = QgsGeometry(row["geometry"])
                    expected.normalize()
                    require(_geometry(feature)["sha256"] == hashlib.sha256(bytes(expected.asWkb())).hexdigest(),
                            "The complete native saved geometry differs.")
                observations.append({"layerId": row["edit"]["layerId"], "identity": row["identity"],
                    "selector": row["edit"]["select"], "before": row["before"], "after": actual,
                    "geometry": _geometry(feature)})
        require(changed > 0 or attachment_changes > 0, "This field round contains no actual new field change.")
        # Save native project state; office receiving reuses its trusted original
        # provider configuration and substitutes only the retained logging data.
        require(project.write(), "The actual saved field project did not write.")
        return {"engine": "QgsVectorLayer edit buffer + QgsOfflineEditing",
                "changedValues": changed, "changedAttachments": attachment_changes,
                "features": observations, "warnings": warnings}
    finally:
        for layer in active:
            layer.rollBack()
        project.clear()
        del logger
        gc.collect()


def completed_device(workspace, root, label, campaign, round_row, authored):
    from starforge_stac.field import copy_device_package, returned_inventory, verify_tree
    area = root / label
    area.mkdir(mode=0o700, parents=True, exist_ok=True)
    intent = {"schema": SCHEMA + "/field-edit", "roundBinding": round_row["binding"],
              "edits": authored["edits"], "attachments": authored.get("attachments", []),
              "actor": authored["actor"]}
    retain(area / "input.json", intent)
    for receipt_path in sorted(area.glob("attempt-*/complete.json")):
        receipt = load(receipt_path)
        require(receipt["intentSha256"] == digest(intent), "A completed edit belongs to another retained round.")
        device = receipt_path.parent / "device"
        actual = returned_inventory(device)
        require(actual["filesSha256"] == receipt["inventory"]["filesSha256"],
                "The completed actual device folder changed after its saved return.")
        return device, receipt
    # Any interrupted attempt remains intact. This new private attempt begins
    # with the same ORIGINAL export, never with a partially edited/synced office.
    attempt = area / ("attempt-" + uuid.uuid4().hex)
    attempt.mkdir(mode=0o700)
    retain(attempt / "input.json", intent)
    device = attempt / "device"
    copy_device_package(workspace, round_row["id"], device)
    attachment_changes = attachments_to_device(device, authored.get("attachments", []))
    observed = actual_edit(workspace, campaign, round_row, device, authored["edits"], attachment_changes)
    inventory = returned_inventory(device)
    databases = [{"path": path, **measured(device / path)} for path in round_row["binding"]["mutableFiles"]]
    receipt = {"intentSha256": digest(intent), "binding": round_row["binding"],
               "nativeEdits": observed, "inventory": inventory, "nativeDatabases": databases}
    retain(attempt / "complete.json", receipt)
    observe(label + "-device-saved", feature_edits=len(observed["features"]),
            changed_values=observed["changedValues"], files=inventory["fileCount"])
    return device, receipt


def native_project_reopen(workspace, project_id):
    from starforge_stac.qgis_project import reopen_project
    project, result = reopen_project(workspace, project_id)
    try:
        require(result.get("valid") is True, "The actual accepted native map did not reopen.")
        return result
    finally:
        project.clear()
        del project
        gc.collect()


def run(spec, root):
    from qgis.core import QgsApplication, QgsProject
    from starforge_stac.model import QgisWorkspace, receive_package, file_digest, member
    from starforge_stac.field import configuration, campaign_for, review_page, field_command
    from starforge_stac.field_native import inspect_field_project, native_versions
    normalized = configuration(spec["configuration"])
    profiles = {row["id"] for row in normalized["profiles"]}
    require(all(row["profileId"] in profiles for row in spec["rounds"]), "Use the actual commissioned device profiles.")
    retain(root / "input.json", spec)
    if (root / "result.json").exists():
        result = load(root / "result.json")
        require(result["inputSha256"] == digest(spec) and
                measured(result["delivery"]["path"]) == {key: result["delivery"][key] for key in ("bytes", "sha256")},
                "The completed original field delivery differs.")
        observe("completed-reopened", result=str(root / "result.json"), delivery=result["delivery"])
        return result
    for row in spec["rounds"]:
        references = {value for edit in row["edits"] for value in edit.get("attributes", {}).values()
                      if isinstance(value, str)}
        require(all(item["path"] in references for item in row.get("attachments", [])),
                "Each selected attachment must be explicitly used by a commissioned field attribute.")
    source = ordinary(spec["source"]["workspace"], directory=True)
    require(root != source and root not in source.parents and source not in root.parents,
            "Keep this receiving directory separate from the original donor workspace.")
    donor = QgisWorkspace(source)
    source_snapshot_path = root / "source-snapshot.json"
    if source_snapshot_path.exists():
        original = load(source_snapshot_path)
    else:
        original = donor.snapshot()
        require(original["state"]["id"] == spec["source"]["workspaceId"] and
                original["state"]["revision"] == spec["source"]["revision"],
                "The actual donor workspace/revision differs from the authored input.")
        project = next((row for row in original["state"]["projects"]
                        if row["id"] == spec["source"]["projectId"]), None)
        require(project and project["file"]["sha256"] == spec["source"]["projectSha256"],
                "The actual original saved map differs from the authored input.")
        retain(source_snapshot_path, original)
    baseline = verified_package(donor, root / "original-project.zip", original)
    received = receive_package(baseline["path"], root / "office", expected_sha256=baseline["sha256"])
    office = received["workspace"]
    retain(root / "original-project.json", baseline)
    observe("original-project-received", workspace_id=office.read()["id"],
            source_revision=original["state"]["revision"], source_archive_sha256=baseline["sha256"])
    app = None
    result = None
    try:
        app = QgsApplication([], False)
        app.initQgis()
        inspect_path = root / "original-native-map.json"
        if not inspect_path.exists():
            retain(inspect_path, inspect_field_project(office, spec["source"]["projectId"]))
        commissioned, _ = exact_action(office, root, "commission", "field.commission",
                                      {"configuration": normalized}, spec["actor"], spec["id"])
        campaign_id = commissioned["campaign"]["id"]
        rounds = []
        last_saved = last_result = None
        for number, authored in enumerate(spec["rounds"], 1):
            label = "round-" + str(number)
            exported, _ = exact_action(office, root, label + "-export", "field.export",
                {"campaignId": campaign_id, "profileId": authored["profileId"]}, authored["actor"], spec["id"])
            round_row = exported["round"]
            campaign = campaign_for(office.read(), campaign_id)
            device, edits = completed_device(office, root, label, campaign, round_row, authored)
            returned, _ = exact_action(office, root, label + "-receive", "field.receive",
                {"roundId": round_row["id"], "directory": str(device),
                 "expectedFilesSha256": edits["inventory"]["filesSha256"]}, authored["actor"], spec["id"])
            returned_row = returned["return"]
            require(returned_row["ready"], "The actual return has reviewable issues; retain it for office correction.")
            review = review_page(office, round_row["id"], returned_row["id"], limit=100)
            retain(root / label / "review-summary.json",
                   {"summary": review["summary"], "ready": review["ready"],
                    "reviewSha256": review["reviewSha256"], "total": review["total"]})
            observe(label + "-reviewed", changes=review["total"], summary=review["summary"],
                    review_sha256=review["reviewSha256"])
            accepted, saved = exact_action(office, root, label + "-accept", "field.accept",
                {"roundId": round_row["id"], "returnId": returned_row["id"],
                 "reviewSha256": review["reviewSha256"], "note": authored["note"]},
                spec["actor"], spec["id"])
            reopened = native_project_reopen(office, accepted["project"]["id"])
            # The same accepted map can reopen after later field revisions.
            # Retain the original readback; compare its stable map/edition identity.
            readback_path = root / label / "native-reopen.json"
            if readback_path.exists():
                previous = load(readback_path)
                require(all(previous.get(key) == reopened.get(key) for key in
                            ("projectId", "workspaceId", "fieldEditionSha256", "layers", "valid")),
                        "The selected accepted native map changed on reopen.")
                reopened = previous
            else:
                retain(readback_path, reopened)
            rounds.append({"number": number, "roundId": round_row["id"], "returnId": returned_row["id"],
                "acceptedProjectId": accepted["project"]["id"], "editionSha256": accepted["edition"]["sha256"],
                "nativeResult": accepted["round"]["nativeResult"], "reviewSha256": review["reviewSha256"],
                "deviceFilesSha256": edits["inventory"]["filesSha256"], "nativeReopen": reopened})
            last_saved, last_result = saved, accepted
        # Reopen the original workspace and recover its SAME accepted request.
        # Its native product/request ledger prevents another synchronization.
        reopened_office = QgisWorkspace(root / "office")
        before_recovery = reopened_office.snapshot()
        recovered = field_command(reopened_office, last_saved["action"], last_saved["payload"],
            revision=last_saved["revision"], request_id=last_saved["requestId"], actor=last_saved["actor"])
        require(recovered == last_result and reopened_office.snapshot() == before_recovery,
                "Original accepted-request recovery changed its retained workspace.")
        final_snapshot = before_recovery
        delivery = verified_package(reopened_office, root / "field-project-delivery.zip", final_snapshot)
        retain(root / "field-project-delivery.json", delivery)
        receiver = receive_package(delivery["path"], root / "independent-receiver",
                                   expected_sha256=delivery["sha256"])
        independent = receiver["workspace"]
        require(independent.snapshot() == final_snapshot,
                "Independent receiving did not retain the complete original state, requests and history.")
        independent_views = [native_project_reopen(independent, row["acceptedProjectId"]) for row in rounds]
        reopen_receive = receive_package(delivery["path"], root / "independent-receiver",
                                        expected_sha256=delivery["sha256"])
        require(reopen_receive["replayed"] is True and
                reopen_receive["workspace"].snapshot() == final_snapshot,
                "The original complete archive did not reopen in its existing receiver.")
        # This checks the unchanged donor selected at the start of this owned
        # journey. A concurrent external donor edit is reported, never overwritten.
        donor_unchanged = donor.snapshot() == original
        result = {"schema": SCHEMA + "/result", "inputSha256": digest(spec),
            "source": spec["source"], "provenance": spec["provenance"], "native": native_versions(),
            "originalArchive": baseline, "campaignId": campaign_id, "rounds": rounds,
            "delivery": delivery, "independentReceiver": str(independent.root),
            "independentReopen": independent_views, "completeStateRetained": True,
            "sameRequestRecovered": last_saved["requestId"], "donorUnchanged": donor_unchanged}
    finally:
        if app is not None:
            QgsProject.instance().clear()
            gc.collect()
            app.exitQgis()
            del app
    # A final success record is written only after the owned native app closes.
    retain(root / "result.json", result)
    observe("completed", result=str(root / "result.json"),
            delivery=result["delivery"], input_sha256=result["inputSha256"])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="Actual authored source/configuration/two-round JSON")
    parser.add_argument("--directory", required=True, help="Owned retained receiving directory, separate from donor")
    parser.add_argument("--qgis-prefix", help="Existing installed QGIS prefix; no environment installation")
    args = parser.parse_args(argv)
    spec = specification(load(args.input))
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    sys.dont_write_bytecode = True
    if args.qgis_prefix:
        from qgis.core import QgsApplication
        QgsApplication.setPrefixPath(str(ordinary(args.qgis_prefix, directory=True)), True)
    selected_root = Path(args.directory).expanduser().absolute().resolve()
    selected_source = Path(spec["source"]["workspace"]).expanduser().absolute().resolve()
    require(selected_root != selected_source and selected_root not in selected_source.parents and
            selected_source not in selected_root.parents,
            "Keep this receiving directory separate from the original donor before creating control files.")
    with ownership(args.directory) as root:
        return run(spec, root)


if __name__ == "__main__":
    main()
