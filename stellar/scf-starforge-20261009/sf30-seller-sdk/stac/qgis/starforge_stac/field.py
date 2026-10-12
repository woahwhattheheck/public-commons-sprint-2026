# SPDX-License-Identifier: MIT
"""Field commissioning and receiving over the original QgisWorkspace.

Native geospatial conversion, offline logging and synchronization stay in
QGIS / libqfieldsync. This module retains the selected inputs, operator
decisions and complete native results in the existing workspace history.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import uuid

from .model import (QgisReceivingError, require, utc_now, json_bytes, value_sha,
                    read_json, file_digest, descriptor, member, retain_bytes,
                    retain_copy)

SCHEMA = "starforge.qfield.commissioning.v1"
BUNDLE_SCHEMA = "starforge.qfield.bundle.v1"
ROUND_SCHEMA = "starforge.qfield.round.v1"
MAX_FILES = 200000
MAX_MEMBER_BYTES = 64 * 1024**3
MAX_TOTAL_BYTES = 256 * 1024**3
ATTACHMENT_DIRS = ("attachments",)
REQUEST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$")
FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
NATIVE_ACTIONS = {"field.commission", "field.export", "field.receive", "field.accept"}
FIELD_ACTIONS = NATIVE_ACTIONS | {"field.close", "field.note"}
SOFTWARE_FILES = ("field.py", "field_native.py", "field_bridge.py", "field_ui.py")

def _text(value, label, maximum=4000, *, empty=False):
    require(isinstance(value, str) and len(value) <= maximum and
            not any(ord(c) < 32 and c not in "\n\t\r" for c in value),
            "FIELD_TEXT", "Enter valid " + label + ".", field=label)
    value = value.strip()
    require(empty or value, "FIELD_TEXT", "Enter " + label + ".", field=label)
    return value

def _names(values, label, *, maximum=300):
    require(isinstance(values, list) and len(values) <= maximum,
            "FIELD_SELECTION", "Select a supported list of " + label + ".")
    result = [_text(x, label, 160) for x in values]
    require(len(result) == len(set(result)), "FIELD_DUPLICATE", "Remove duplicate " + label + ".")
    return result

def _bool(value, label):
    require(type(value) is bool, "FIELD_BOOLEAN", "Choose yes or no for " + label + ".")
    return value

def configuration(raw):
    require(isinstance(raw, dict) and raw.get("schema", SCHEMA) == SCHEMA,
            "FIELD_CONFIGURATION", "Use the original field commissioning configuration.")
    out = {"schema": SCHEMA, "title": _text(raw.get("title"), "field project title", 240),
           "projectId": _text(raw.get("projectId"), "saved project", 200),
           "instructions": _text(raw.get("instructions", ""), "field instructions", 12000, empty=True),
           "attachmentInstructions": _text(raw.get("attachmentInstructions", ""), "attachment instructions", 8000, empty=True)}
    profiles = raw.get("profiles")
    require(isinstance(profiles, list) and 1 <= len(profiles) <= 20,
            "FIELD_PROFILES", "Configure at least one named field device profile.")
    out["profiles"] = []
    for row in profiles:
        require(isinstance(row, dict), "FIELD_PROFILE", "Use a named device profile.")
        out["profiles"].append({
            "id": _text(row.get("id"), "device profile ID", 100),
            "label": _text(row.get("label"), "device profile name", 160),
            "platform": _text(row.get("platform", ""), "device platform", 160, empty=True),
            "operatorInstructions": _text(row.get("operatorInstructions", ""), "device instructions", 8000, empty=True)})
    require(len({x["id"] for x in out["profiles"]}) == len(out["profiles"]),
            "FIELD_PROFILE", "Each device profile needs a distinct ID.")
    layers = raw.get("layers")
    require(isinstance(layers, list) and layers, "FIELD_LAYERS", "Select the editable feature layers and related tables.")
    require(len(layers) <= 100, "FIELD_LAYERS", "Split this field project into usable layer groups.")
    out["layers"] = []
    for source in layers:
        require(isinstance(source, dict), "FIELD_LAYER", "Use a native layer configuration.")
        row = {"layerId": _text(source.get("layerId"), "original layer ID", 200),
               "identityField": _text(source.get("identityField"), "stable feature identity field", 160),
               "editableFields": _names(source.get("editableFields", []), "editable fields"),
               "allowAdd": _bool(source.get("allowAdd", False), "new features"),
               "allowDelete": _bool(source.get("allowDelete", False), "feature deletion"),
               "allowGeometry": _bool(source.get("allowGeometry", False), "geometry editing"),
               "formTitle": _text(source.get("formTitle", ""), "form title", 240, empty=True)}
        require(row["identityField"] not in row["editableFields"], "FIELD_IDENTITY_READONLY",
                "Keep each existing feature identity read-only.")
        fields = source.get("fields", [])
        require(isinstance(fields, list) and len(fields) <= 300, "FIELD_FORM", "Configure supported form fields.")
        row["fields"] = []
        for f in fields:
            require(isinstance(f, dict), "FIELD_FORM", "Use one definition per form field.")
            item = {"name": _text(f.get("name"), "field name", 160),
                    "label": _text(f.get("label", f.get("name")), "field label", 240),
                    "group": _text(f.get("group", "Details"), "form group", 160),
                    "widget": f.get("widget", "text"),
                    "required": _bool(f.get("required", False), "required field")}
            require(item["widget"] in ("text", "multiline", "choice", "range", "date", "attachment", "image"),
                    "FIELD_WIDGET", "Choose a supported native QGIS form widget.")
            if f.get("addType") is not None:
                require(FIELD_NAME.fullmatch(item["name"]) is not None, "FIELD_NAME",
                        "Use a plain field name for a new inspection field.")
                require(f["addType"] in ("text", "integer", "real", "date", "datetime", "boolean"),
                        "FIELD_TYPE", "Choose the native type for the new field.")
                item["addType"] = f["addType"]
            if item["widget"] == "choice":
                require(isinstance(f.get("choices"), list) and 1 <= len(f["choices"]) <= 1000,
                        "FIELD_CHOICES", "Enter the actual allowed values.")
                choices = []
                for c in f["choices"]:
                    require(isinstance(c, dict) and isinstance(c.get("value"), (str, int, float, bool)),
                            "FIELD_CHOICE", "Each choice needs a label and scalar value.")
                    choices.append({"label": _text(c.get("label"), "choice label", 240), "value": c["value"]})
                require(len({value_sha(c["value"]) for c in choices}) == len(choices),
                        "FIELD_CHOICES", "Choice values must be distinct.")
                item["choices"] = choices
            if item["widget"] == "range":
                for name in ("min", "max", "step"):
                    require(type(f.get(name)) in (int, float) and abs(f[name]) < 1e100,
                            "FIELD_RANGE", "Enter a finite numeric range.")
                require(f["min"] <= f["max"] and f["step"] > 0, "FIELD_RANGE", "Use a positive step and ordered range.")
                item.update({name: f[name] for name in ("min", "max", "step")})
            row["fields"].append(item)
        require(len({f["name"] for f in row["fields"]}) == len(row["fields"]),
                "FIELD_FORM", "Each field may appear only once in the form.")
        out["layers"].append(row)
    require(len({x["layerId"] for x in out["layers"]}) == len(out["layers"]),
            "FIELD_LAYERS", "Select each native layer once.")
    out["referenceLayerIds"] = _names(raw.get("referenceLayerIds", []), "reference layers", maximum=100)
    require(not (set(out["referenceLayerIds"]) & {x["layerId"] for x in out["layers"]}),
            "FIELD_LAYERS", "A layer cannot be both a reference and editable.")
    relations = raw.get("relations", [])
    require(isinstance(relations, list) and len(relations) <= 100, "FIELD_RELATIONS", "Use native relation definitions.")
    out["relations"] = []
    for r in relations:
        require(isinstance(r, dict), "FIELD_RELATION", "Use a native relation definition.")
        relation = {name: _text(r.get(name), name, 200) for name in
                    ("id", "name", "parentLayerId", "childLayerId")}
        relation["strength"] = r.get("strength", "association")
        require(relation["strength"] in ("association", "composition"), "FIELD_RELATION_STRENGTH",
                "Choose native Association or Composition behavior for this relation.")
        pairs = r.get("fieldPairs", [{"parentField": r.get("parentField"), "childField": r.get("childField")}])
        require(isinstance(pairs, list) and 1 <= len(pairs) <= 20, "FIELD_RELATION",
                "Keep the complete native parent and child field pairs.")
        relation["fieldPairs"] = [{name: _text(pair.get(name), name, 200)
                                   for name in ("parentField", "childField")} for pair in pairs if isinstance(pair, dict)]
        require(len(relation["fieldPairs"]) == len(pairs) and
                len({p["childField"] for p in relation["fieldPairs"]}) == len(pairs),
                "FIELD_RELATION", "Use each child relation key once.")
        out["relations"].append(relation)
    require(len({x["id"] for x in out["relations"]}) == len(out["relations"]),
            "FIELD_RELATION", "Use distinct relation IDs.")
    # Reject implicit executable project hooks in the commissioning surface.
    # Expressions/defaults from the selected, verified original project remain original source.
    return out

def campaign_for(state, campaign_id):
    row = next((x for x in state.get("fieldCampaigns", []) if x["id"] == campaign_id), None)
    require(row is not None, "FIELD_CAMPAIGN", "Select a commissioned field project.")
    return row

def round_for(state, round_id):
    for campaign in state.get("fieldCampaigns", []):
        for row in campaign.get("rounds", []):
            if row["id"] == round_id:
                return campaign, row
    raise QgisReceivingError("FIELD_ROUND", "Select a retained field round.")

def field_file_refs(snapshot):
    records = {}
    def add(row):
        value = descriptor(row)
        require(value["path"].startswith("field/"), "FIELD_FILE_SCOPE", "Keep retained field artifacts in their field workspace.")
        old = records.get(value["path"])
        require(old is None or (old["bytes"], old["sha256"]) == (value["bytes"], value["sha256"]),
                "FIELD_FILE_CONFLICT", "A retained field member has two versions at the same path.")
        records[value["path"]] = value
    for campaign in snapshot["state"].get("fieldCampaigns", []):
        for row in campaign.get("files", []):
            add(row)
        for round_row in campaign.get("rounds", []):
            for row in round_row.get("files", []):
                add(row)
            for returned in round_row.get("returns", []):
                for row in returned.get("files", []):
                    add(row)
    return [records[k] for k in sorted(records)]

def ordinary_tree(root, *, progress=None, allow_empty=False):
    root = Path(root).absolute()
    require(root.is_dir() and not root.is_symlink(), "FIELD_DIRECTORY", "Select an ordinary field directory.")
    records, total = [], 0
    for folder, dirs, names in os.walk(root, followlinks=False):
        dirs.sort()
        names.sort()
        for name in dirs:
            path = Path(folder) / name
            require(not path.is_symlink(), "FIELD_LINK", "Field projects must contain actual directories.", path=str(path))
        for name in names:
            path = Path(folder) / name
            mode = path.lstat().st_mode
            require(stat.S_ISREG(mode) and not path.is_symlink(), "FIELD_MEMBER",
                    "Field packages contain ordinary files, not links or special devices.", path=str(path))
            rel = path.relative_to(root).as_posix()
            require(not name.endswith(("-wal", "-shm", "-journal")), "FIELD_DATABASE_OPEN",
                    "Close QField/QGIS and return a fully saved database before receiving.", path=rel)
            measured = file_digest(path, progress=progress, phase="field-files")
            total += measured["bytes"]
            require(measured["bytes"] <= MAX_MEMBER_BYTES and total <= MAX_TOTAL_BYTES and len(records) < MAX_FILES,
                    "FIELD_PACKAGE_SIZE", "This field package exceeds the supported complete transfer size.")
            records.append({"path": rel, **measured})
    require(allow_empty or records, "FIELD_EMPTY", "Select the complete field project directory.")
    return records

def verify_tree(root, records, *, progress=None, exact=True):
    expected = {r["path"]: descriptor(r) for r in records}
    require(len(expected) == len(records), "FIELD_FILE_DUPLICATE", "A field file inventory contains duplicate paths.")
    for r in expected.values():
        file_digest(member(Path(root), r["path"]), expected=r, progress=progress, phase="field-verify")
    if exact:
        current = ordinary_tree(root, progress=progress, allow_empty=True)
        require({x["path"] for x in current} == set(expected), "FIELD_TREE_CHANGED",
                "The complete field directory differs from its retained file inventory.")
    return records

def copy_tree(source, target, records, *, progress=None):
    source, target = Path(source), Path(target)
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for r in records:
        retain_copy(member(source, r["path"]), target, r["path"], r, progress)
    return verify_tree(target, records, progress=progress)

def bundle(root, *, kind, intent_sha, metadata, progress=None):
    root = Path(root)
    require(not (root / "field-bundle.json").exists(), "FIELD_BUNDLE_EXISTS", "This native bundle is already finalized.")
    rows = ordinary_tree(root, progress=progress, allow_empty=False)
    value = {"schema": BUNDLE_SCHEMA, "kind": kind, "intentSha256": intent_sha,
             "metadata": metadata, "files": rows, "at": utc_now()}
    retain_bytes(root, "field-bundle.json", json_bytes(value))
    return value

def read_bundle(root, *, intent_sha=None, progress=None):
    root = Path(root)
    value, body = read_json(root / "field-bundle.json")
    require(value.get("schema") == BUNDLE_SCHEMA, "FIELD_BUNDLE", "Use a complete retained native field bundle.")
    require(intent_sha is None or value.get("intentSha256") == intent_sha,
            "FIELD_INPUT_CHANGED", "This native bundle belongs to a different original request.")
    records = list(value["files"]) + [{"path": "field-bundle.json", "bytes": len(body),
                                      "sha256": hashlib.sha256(body).hexdigest()}]
    verify_tree(root, records, progress=progress)
    return value, records

def workspace_bundle(workspace, root, *, intent_sha=None, progress=None):
    value, records = read_bundle(root, intent_sha=intent_sha, progress=progress)
    prefix = Path(root).relative_to(workspace.root).as_posix()
    return value, [{**r, "path": prefix + "/" + r["path"]} for r in records]

@contextlib.contextmanager
def operation_lock(root):
    path = Path(root) / "native.lock"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if stream.read(1) == b"":
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise QgisReceivingError("FIELD_OPERATION_ACTIVE", "This original native field operation is already running.") from exc
            try:
                yield stream
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise QgisReceivingError("FIELD_OPERATION_ACTIVE", "This original native field operation is already running.") from exc
            try:
                yield stream
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

def _native_product(workspace, action, payload, common, operation, progress):
    require(REQUEST.fullmatch(common["request_id"]) is not None, "FIELD_REQUEST", "Use the original saved request ID.")
    job = workspace.root / "field" / "operations" / common["request_id"]
    job.mkdir(mode=0o700, parents=True, exist_ok=True)
    input_value = {"schema": "starforge.qfield.native-request.v1",
                   "workspaceId": workspace.read()["id"], "action": action, "payload": payload,
                   "requestId": common["request_id"], "actor": common["actor"]}
    input_sha = value_sha(input_value)
    with operation_lock(job):
        retain_bytes(job, "input.json", json_bytes(input_value))
        product = job / "product"
        if product.exists():
            return workspace_bundle(workspace, product, intent_sha=input_sha, progress=progress)
        # Every retry starts native writes in a NEW private stage seeded from
        # the same retained input. No partial synchronization is ever replayed.
        stage = job / ("work-" + uuid.uuid4().hex)
        stage.mkdir(mode=0o700)
        retain_bytes(stage, "operation-input.json", json_bytes(input_value))
        try:
            metadata = operation(stage, input_sha)
            bundle(stage, kind=action, intent_sha=input_sha, metadata=metadata, progress=progress)
            os.rename(stage, product)
            return workspace_bundle(workspace, product, intent_sha=input_sha, progress=progress)
        except BaseException as exc:
            failure = {"at": utc_now(), "requestId": common["request_id"], "action": action,
                       "stage": stage.name, "type": type(exc).__name__, "message": str(exc)}
            failure_path = job / ("failed-" + stage.name + ".json")
            retain_bytes(job, failure_path.name, json_bytes(failure))
            # Preserve this owned interrupted stage and the unchanged original
            # package. An operator may retire it after inspecting this record.
            raise

def _common(revision, request_id, actor):
    require(type(revision) is int and revision >= 0, "REVISION_CHANGED", "Use the current reviewed workspace revision.")
    return {"revision": revision, "request_id": _text(request_id, "saved request ID", 160),
            "actor": _text(actor, "operator name", 240)}

def _record(workspace, action, payload, common, update):
    return workspace._mutate(common["revision"], common["request_id"], common["actor"], action, payload, update)

def field_command(workspace, action, payload, *, revision, request_id, actor, progress=None):
    require(action in FIELD_ACTIONS and isinstance(payload, dict), "FIELD_ACTION", "Choose a supported field operation.")
    common = _common(revision, request_id, actor)
    previous = workspace.operation(request_id, action, payload)
    if previous:
        return previous
    state = workspace.read()
    if state["revision"] != revision:
        # A completed native result can rejoin after an unrelated workspace
        # change. Every callback below still binds the exact source/round/base.
        ready = workspace.root / "field" / "operations" / request_id / "product" / "field-bundle.json"
        require(action in NATIVE_ACTIONS and ready.is_file(), "REVISION_CHANGED",
                "Review the current workspace revision before continuing.")
        common["revision"] = state["revision"]
    if action == "field.commission":
        config = configuration(payload.get("configuration"))
        original = next((x for x in state["projects"] if x["id"] == config["projectId"]), None)
        require(original is not None, "FIELD_PROJECT", "Select an actual saved native QGIS project.")
        selected = {r["id"] for r in original["layers"]}
        require(({r["layerId"] for r in config["layers"]} | set(config["referenceLayerIds"])) <= selected,
                "FIELD_LAYER", "Select layers from the retained project.")
        from .field_native import commission_native
        value, files = _native_product(workspace, action, payload, common,
            lambda stage, sha: commission_native(workspace, original, config, stage, progress), progress)
        metadata = value["metadata"]
        campaign = {"id": "field-" + request_id, "title": config["title"], "configuration": config,
                    "sourceProjectId": original["id"], "sourceProjectSha256": original["file"]["sha256"],
                    "currentEdition": copy.deepcopy(metadata["edition"]), "commissionedAt": utc_now(),
                    "actor": actor, "files": files, "rounds": [], "notes": []}
        # Native metadata uses bundle-relative paths; bind them to the retained workspace.
        product_prefix = "field/operations/" + request_id + "/product/"
        campaign["currentEdition"] = _prefix_edition(campaign["currentEdition"], product_prefix)
        def update(current):
            source = next((x for x in current["projects"] if x["id"] == original["id"]), None)
            require(source is not None and source["file"]["sha256"] == original["file"]["sha256"],
                    "FIELD_SOURCE_CHANGED", "The selected original project changed.")
            current.setdefault("fieldCampaigns", []).append(copy.deepcopy(campaign))
            return {"campaign": campaign}
        return _record(workspace, action, payload, common, update)
    if action == "field.export":
        campaign = campaign_for(state, payload.get("campaignId"))
        require(not any(x["status"] in ("exported", "returned") for x in campaign["rounds"]),
                "FIELD_ROUND_ACTIVE", "Finish or close the current field round before creating the next export.")
        profile = next((x for x in campaign["configuration"]["profiles"] if x["id"] == payload.get("profileId")), None)
        require(profile is not None, "FIELD_PROFILE", "Select the actual device profile for this export.")
        from .field_native import export_native
        value, files = _native_product(workspace, action, payload, common,
            lambda stage, sha: export_native(workspace, campaign, profile, stage, request_id, progress), progress)
        prefix = "field/operations/" + request_id + "/product/"
        metadata = value["metadata"]
        binding = metadata.get("binding", {})
        expected_binding = {"workspaceId": state["id"], "campaignId": campaign["id"],
                            "roundId": "round-" + request_id, "profileId": profile["id"],
                            "baseEditionSha256": campaign["currentEdition"]["sha256"],
                            "configurationSha256": value_sha(campaign["configuration"])}
        require(all(binding.get(key) == selected for key, selected in expected_binding.items()),
                "FIELD_EXPORT_SELECTION_CHANGED",
                "The retained export was prepared from a different project edition or device configuration. "
                "Its original package is preserved; choose a fresh export from the current edition.")
        row = {"schema": ROUND_SCHEMA, "id": "round-" + request_id, "status": "exported", "number": len(campaign["rounds"]) + 1,
               "profile": profile, "baseEditionSha256": campaign["currentEdition"]["sha256"],
               "baseEdition": copy.deepcopy(campaign["currentEdition"]), "at": utc_now(), "actor": actor,
               "packageRoot": prefix + metadata["packageRoot"], "packageFiles": metadata["packageFiles"],
               "exportProject": metadata["exportProject"], "binding": metadata["binding"],
               "files": files, "returns": [], "acceptedReturnId": None}
        def update(current):
            item = campaign_for(current, campaign["id"])
            require(item["currentEdition"]["sha256"] == row["baseEditionSha256"] and
                    not any(x["status"] in ("exported", "returned") for x in item["rounds"]),
                    "FIELD_ROUND_CHANGED", "The field project changed while its export was being prepared.")
            item["rounds"].append(copy.deepcopy(row))
            return {"campaignId": item["id"], "round": row}
        return _record(workspace, action, payload, common, update)
    if action == "field.receive":
        campaign, round_row = round_for(state, payload.get("roundId"))
        require(round_row["status"] in ("exported", "returned"), "FIELD_ROUND_CLOSED",
                "This export has already been accepted or closed. Start a fresh export for another field round.")
        source = Path(_text(payload.get("directory"), "returned device directory", 4000))
        require(source.is_absolute(), "FIELD_RETURN_ABSOLUTE",
                "Use the absolute returned directory reported by field.inventory.")
        require(not source.resolve().is_relative_to(workspace.root.resolve()), "FIELD_RETURN_LOCATION",
                "Select the returned device copy outside the retained office workspace.")
        source_sha = payload.get("expectedFilesSha256")
        require(isinstance(source_sha, str) and re.fullmatch(r"[a-f0-9]{64}", source_sha),
                "FIELD_RETURN_IDENTITY", "Retain the selected device file inventory.")
        from .field_native import receive_native
        def receive_operation(stage, sha):
            source_files = ordinary_tree(source, progress=progress)
            require(source_sha == value_sha(source_files), "FIELD_RETURN_CHANGED",
                    "The returned files changed after selection. Review the complete saved device copy again.")
            return receive_native(workspace, campaign, round_row, source, source_files, stage, progress)
        value, files = _native_product(workspace, action, payload, common, receive_operation, progress)
        prefix = "field/operations/" + request_id + "/product/"
        metadata = value["metadata"]
        returned = {"id": "return-" + request_id, "at": utc_now(), "actor": actor,
                    "sourceFilesSha256": source_sha, "files": files, "bundleRoot": prefix[:-1],
                    "deviceRoot": prefix + metadata["deviceRoot"],
                    "review": {**metadata["review"], "path": prefix + metadata["review"]["path"]},
                    "summary": metadata["summary"], "ready": metadata["ready"],
                    "binding": metadata["binding"]}
        def update(current):
            item, current_round = round_for(current, round_row["id"])
            require(current_round["status"] in ("exported", "returned") and
                    current_round["baseEditionSha256"] == item["currentEdition"]["sha256"],
                    "FIELD_ROUND_CHANGED", "This field round changed while its returned files were being received.")
            current_round["returns"].append(copy.deepcopy(returned))
            current_round["status"] = "returned"
            return {"campaignId": item["id"], "roundId": current_round["id"], "return": returned}
        return _record(workspace, action, payload, common, update)
    if action == "field.accept":
        campaign, round_row = round_for(state, payload.get("roundId"))
        require(round_row["status"] == "returned", "FIELD_ROUND_CLOSED",
                "Accept one retained return from the current field round.")
        returned = next((x for x in round_row["returns"] if x["id"] == payload.get("returnId")), None)
        require(returned is not None and returned["ready"], "FIELD_RETURN_NOT_READY",
                "Resolve the actual returned-data or attachment issues before accepting this return.")
        require(payload.get("reviewSha256") == returned["review"]["sha256"], "FIELD_REVIEW_CHANGED",
                "Review the exact returned changes before acceptance.")
        note = _text(payload.get("note"), "office acceptance note", 12000)
        require(round_row["baseEditionSha256"] == campaign["currentEdition"]["sha256"],
                "FIELD_BASE_CHANGED", "The office edition changed after this field export.")
        from .field_native import accept_native
        value, files = _native_product(workspace, action, payload, common,
            lambda stage, sha: accept_native(workspace, campaign, round_row, returned, stage, progress), progress)
        prefix = "field/operations/" + request_id + "/product/"
        metadata = value["metadata"]
        edition = _prefix_edition(metadata["edition"], prefix)
        original = next(x for x in state["projects"] if x["id"] == campaign["sourceProjectId"])
        project = {"kind": "field", "id": "field-project-" + request_id, "at": utc_now(), "actor": actor,
                   "file": edition["project"], "sourceIds": sorted({x["sourceId"] for x in original["layers"]
                       if x["id"] in ({r["layerId"] for r in campaign["configuration"]["layers"]} |
                                      set(campaign["configuration"]["referenceLayerIds"]))}),
                   "inputRevision": revision, "layers": [copy.deepcopy(x) for x in original["layers"]
                       if x["id"] in ({r["layerId"] for r in campaign["configuration"]["layers"]} |
                                      set(campaign["configuration"]["referenceLayerIds"]))],
                   "inputSha256": value["intentSha256"], "derivedFiles": files,
                   "field": {"campaignId": campaign["id"], "roundId": round_row["id"], "returnId": returned["id"],
                             "edition": edition, "configuration": copy.deepcopy(campaign["configuration"])}}
        def update(current):
            item, current_round = round_for(current, round_row["id"])
            require(current_round["status"] == "returned" and
                    item["currentEdition"]["sha256"] == current_round["baseEditionSha256"],
                    "FIELD_ROUND_CHANGED", "The field round changed before its office acceptance committed.")
            chosen = next((x for x in current_round["returns"] if x["id"] == returned["id"]), None)
            require(chosen is not None and chosen["review"]["sha256"] == payload["reviewSha256"],
                    "FIELD_REVIEW_CHANGED", "The reviewed field return changed.")
            current_round.update({"status": "accepted", "acceptedReturnId": returned["id"],
                                  "acceptedAt": utc_now(), "acceptedBy": actor, "acceptanceNote": note,
                                  "nativeResult": metadata["synchronization"], "acceptedProjectId": project["id"]})
            current_round["files"].extend(copy.deepcopy(files))
            item["currentEdition"] = copy.deepcopy(edition)
            current["projects"].append(copy.deepcopy(project))
            return {"campaignId": item["id"], "round": copy.deepcopy(current_round),
                    "project": project, "edition": edition}
        return _record(workspace, action, payload, common, update)
    if action == "field.close":
        note = _text(payload.get("note"), "reason for closing this export", 12000)
        def update(current):
            campaign, row = round_for(current, payload.get("roundId"))
            require(row["status"] in ("exported", "returned"), "FIELD_ROUND_CLOSED", "This field round is already closed.")
            row.update({"status": "closed", "closedAt": utc_now(), "closedBy": actor, "closureNote": note})
            return {"campaignId": campaign["id"], "round": copy.deepcopy(row)}
        return _record(workspace, action, payload, common, update)
    note = _text(payload.get("note"), "field project note", 12000)
    def update(current):
        campaign = campaign_for(current, payload.get("campaignId"))
        row = {"at": utc_now(), "actor": actor, "note": note, "requestId": request_id}
        campaign["notes"].append(row)
        return {"campaignId": campaign["id"], "note": row}
    return _record(workspace, action, payload, common, update)

def _prefix_edition(edition, prefix):
    value = copy.deepcopy(edition)
    value["root"] = prefix + value["root"]
    value["project"]["path"] = prefix + value["project"]["path"]
    value["manifest"]["path"] = prefix + value["manifest"]["path"]
    value["files"] = [{**r, "path": prefix + r["path"]} for r in value["files"]]
    return value

def returned_inventory(directory, *, progress=None):
    source = Path(directory).expanduser().absolute()
    rows = ordinary_tree(source, progress=progress)
    return {"directory": str(source), "files": rows, "filesSha256": value_sha(rows),
            "totalBytes": sum(x["bytes"] for x in rows), "fileCount": len(rows)}

def copy_device_package(workspace, round_id, destination, *, progress=None):
    _, row = round_for(workspace.read(), round_id)
    require(row["status"] in ("exported", "returned"), "FIELD_ROUND_CLOSED",
            "Create a fresh field export for another collection round.")
    target = Path(destination).expanduser().absolute()
    require(not target.exists() and not target.is_symlink() and
            not target.resolve().is_relative_to(workspace.root.resolve()),
            "FIELD_DEVICE_DIRECTORY", "Choose a new device-transfer directory outside this workspace.")
    root = member(workspace.root, row["packageRoot"], existing=False)
    require(root.is_dir(), "FIELD_PACKAGE_DIRECTORY", "The retained field package directory is missing.")
    verify_tree(root, row["packageFiles"], progress=progress)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".qfield-device-", dir=target.parent))
    try:
        copy_tree(root, stage, row["packageFiles"], progress=progress)
        os.rename(stage, target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return {"directory": str(target), "roundId": row["id"], "filesSha256": value_sha(row["packageFiles"]),
            "fileCount": len(row["packageFiles"]), "totalBytes": sum(x["bytes"] for x in row["packageFiles"])}

def review_page(workspace, round_id, return_id, *, offset=0, limit=100, layer_id="", kind=""):
    _, row = round_for(workspace.read(), round_id)
    returned = next((x for x in row["returns"] if x["id"] == return_id), None)
    require(returned is not None, "FIELD_RETURN", "Select a retained device return.")
    require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 500,
            "FIELD_PAGE", "Use a valid review page.")
    path = member(workspace.root, returned["review"]["path"])
    file_digest(path, expected=returned["review"])
    clauses, values = [], []
    if layer_id:
        clauses.append("layer_id=?")
        values.append(layer_id)
    if kind:
        require(kind in ("added", "changed", "deleted", "attachment", "issue", "problems"), "FIELD_REVIEW_KIND", "Choose a known review filter.")
        if kind == "problems":
            clauses.append("(kind='issue' OR json_array_length(body,'$.issues')>0)")
        else:
            clauses.append("kind=?")
            values.append(kind)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        total = db.execute("SELECT count(*) FROM changes" + where, values).fetchone()[0]
        rows = [json.loads(x[0]) for x in db.execute("SELECT body FROM changes" + where +
                " ORDER BY sequence LIMIT ? OFFSET ?", (*values, limit, offset))]
    return {"items": rows, "offset": offset, "limit": limit, "total": total, "hasMore": offset + len(rows) < total,
            "summary": returned["summary"], "ready": returned["ready"], "reviewSha256": returned["review"]["sha256"]}
