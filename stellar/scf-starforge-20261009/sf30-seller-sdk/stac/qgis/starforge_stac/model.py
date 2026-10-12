# SPDX-License-Identifier: MIT
"""QGIS project state over the complete original STAC receiving files.

Only the Node original receiver prepares qgis-receiving.json. This reader
verifies that exact file closure for the desktop, and stores analyst choices.
It never retrieves an asset, resolves a source URL or evaluates a payment.
"""
from __future__ import annotations

import copy
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import time
import uuid
import zipfile

RECEIVING_SCHEMA = "starforge.stac-qgis-receiving.v1"
WORKSPACE_SCHEMA = "starforge.stac-qgis-workspace.v1"
SNAPSHOT_SCHEMA = "starforge.stac-qgis-workspace-snapshot.v1"
PACKAGE_SCHEMA = "starforge.stac-qgis-project-package.v1"
MANIFEST_NAME = "qgis-receiving.json"
MAX_JSON = 268435456
HASH = re.compile(r"^[a-f0-9]{64}$")
REQUEST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
CHUNK = 1024 * 1024


class QgisReceivingError(ValueError):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details


def require(ok, code, message, **details):
    if not ok:
        raise QgisReceivingError(code, message, **details)


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def value_sha(value):
    return sha_bytes(json_bytes(value))


def scene_key(collection, item_id):
    return json.dumps([collection, item_id], ensure_ascii=False, separators=(",", ":"))


def asset_key(collection, item_id, name):
    return json.dumps([collection, item_id, name], ensure_ascii=False, separators=(",", ":"))


def relative_name(value):
    require(isinstance(value, str) and 0 < len(value) <= 4096 and
            not any(ord(c) < 32 or ord(c) == 127 for c in value) and
            "\\" not in value and not value.startswith("/") and
            not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value) and
            all(part not in ("", ".", "..") for part in value.split("/")),
            "RELATIVE_FILE_REQUIRED", "Select an ordinary relative receiving file.", path=value)
    return value


def directory(path, create=False):
    value = Path(path).expanduser().absolute()
    if create:
        value.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(value.is_dir() and not value.is_symlink(), "DIRECTORY_REQUIRED",
            "Select an existing ordinary directory.", path=str(value))
    return value.resolve(strict=True)


def member(root, name, *, existing=True):
    relative_name(name)
    root = directory(root)
    result = root
    for part in name.split("/"):
        result = result / part
        if result.exists() or result.is_symlink():
            require(not result.is_symlink(), "SYMLINK_MEMBER",
                    "A receiving member must be an ordinary local file.", path=name)
    if existing:
        require(result.is_file(), "FILE_MISSING", "A declared receiving file is missing.", path=name)
    return result


def read_json(path, limit=MAX_JSON):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "FILE_REQUIRED",
            "Select an ordinary JSON file.", path=str(path))
    with path.open("rb") as stream:
        body = stream.read(limit + 1)
    require(len(body) <= limit, "JSON_LIMIT", "The complete JSON exceeds the supported size.", path=str(path))
    try:
        value = json.loads(body.decode("utf-8"),
                           parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (UnicodeError, ValueError) as exc:
        raise QgisReceivingError("JSON_INVALID", "The original JSON could not be decoded.", path=str(path)) from exc
    return value, body


def descriptor(value):
    require(isinstance(value, dict), "FILE_DESCRIPTOR_INVALID", "A complete file descriptor is required.")
    relative_name(value.get("path"))
    require(type(value.get("bytes")) is int and value["bytes"] >= 0 and
            isinstance(value.get("sha256"), str) and HASH.fullmatch(value["sha256"]),
            "FILE_DESCRIPTOR_INVALID", "Retain the original byte count and SHA-256.", path=value.get("path"))
    return copy.deepcopy(value)


def file_digest(path, *, progress=None, phase="verify", name=None, expected=None):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "FILE_REQUIRED",
            "Select an ordinary local file.", path=str(path))
    total = path.stat().st_size
    if expected:
        require(total == expected["bytes"], "FILE_SIZE_CHANGED",
                "The retained file length changed.", path=name or str(path))
    digest = hashlib.sha256()
    count = 0
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "FILE_REQUIRED", "A regular file is required.")
        while True:
            block = stream.read(CHUNK)
            if not block:
                break
            digest.update(block)
            count += len(block)
            if progress:
                progress({"phase": phase, "path": name or str(path), "completedBytes": count, "totalBytes": total})
        after = os.fstat(stream.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and count == before.st_size,
            "FILE_CHANGED_DURING_READ", "The file changed while it was being read.", path=name or str(path))
    result = {"bytes": count, "sha256": digest.hexdigest()}
    require(not expected or (result["bytes"] == expected["bytes"] and result["sha256"] == expected["sha256"]),
            "FILE_HASH_CHANGED", "The retained file bytes no longer match their receipt.", path=name or str(path))
    return result


def retain_bytes(root, name, body):
    path = member(root, name, existing=False)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    expected = {"bytes": len(body), "sha256": sha_bytes(body)}
    if path.exists():
        file_digest(path, name=name, expected=expected)
        return {"path": name, **expected}
    fd, temporary = tempfile.mkstemp(prefix=".qgis-write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            file_digest(path, name=name, expected=expected)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"path": name, **expected}


def retain_copy(source, root, name, expected, progress=None):
    path = member(root, name, existing=False)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        file_digest(path, expected=expected, progress=progress, name=name, phase="reopen")
        return {"path": name, "bytes": expected["bytes"], "sha256": expected["sha256"]}
    fd, temporary = tempfile.mkstemp(prefix=".qgis-copy-", dir=path.parent)
    digest, count = hashlib.sha256(), 0
    try:
        with Path(source).open("rb") as src, os.fdopen(fd, "wb") as dst:
            while True:
                block = src.read(CHUNK)
                if not block:
                    break
                dst.write(block)
                digest.update(block)
                count += len(block)
                require(count <= expected["bytes"], "FILE_SIZE_CHANGED", "The original file length changed.", path=name)
                if progress:
                    progress({"phase": "copy", "path": name, "completedBytes": count, "totalBytes": expected["bytes"]})
            dst.flush()
            os.fsync(dst.fileno())
        require(count == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                "FILE_HASH_CHANGED", "The source file changed during the copy.", path=name)
        try:
            os.link(temporary, path)
        except FileExistsError:
            file_digest(path, expected=expected, name=name)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"path": name, "bytes": count, "sha256": digest.hexdigest()}


class ReceivingSource:
    def __init__(self, root, expected_manifest_sha256=None, progress=None, verify=True):
        self.root = directory(root)
        manifest, body = read_json(member(self.root, MANIFEST_NAME))
        self.manifest_sha256 = sha_bytes(body)
        require(expected_manifest_sha256 is None or self.manifest_sha256 == expected_manifest_sha256,
                "RECEIVING_MANIFEST_CHANGED", "The selected receiving manifest differs from the saved receipt.")
        require(isinstance(manifest, dict) and manifest.get("schema") == RECEIVING_SCHEMA and
                isinstance(manifest.get("source"), dict) and isinstance(manifest.get("files"), list),
                "RECEIVING_SCHEMA", "Prepare the original delivery with starforge stac-qgis export.")
        self.manifest, self.manifest_body = manifest, body
        self.id = self.manifest_sha256
        self.source = copy.deepcopy(manifest["source"])
        require(all(isinstance(self.source.get(key), str) and HASH.fullmatch(self.source[key]) for key in
                    ("bundleSha256", "selectionSha256", "editionDigest", "nativeBindingSha256")) and
                isinstance(self.source.get("editionId"), str), "ORIGINAL_SOURCE_IDENTITY",
                "The receiving manifest requires its original bundle, selection, edition and native binding.")
        self.files = {}
        for raw in manifest["files"]:
            record = descriptor(raw)
            require(record["path"] not in self.files and record["path"] != MANIFEST_NAME,
                    "DUPLICATE_MEMBER", "The receiving file set has a duplicate.", path=record["path"])
            self.files[record["path"]] = record
        for key, name in (("originalManifest", "manifest.json"), ("portableManifest", "scene-export.json")):
            require(manifest.get(key) == self.files.get(name), "MANIFEST_BINDING",
                    "The original manifest descriptor changed.", path=name)
        required_metadata = {"manifest.json", "scene-export.json"}
        for key in ("footprints", "asset-inventory", "collections"):
            name = manifest.get("paths", {}).get(key)
            require(name in self.files, "RECEIVING_METADATA_MISSING", "Keep the original scene metadata file.", path=name)
            required_metadata.add(name)
        checked = [record for record in self.files.values() if verify or record["path"] in required_metadata]
        if checked:
            for index, record in enumerate(checked, 1):
                file_digest(member(self.root, record["path"]), expected=record, progress=progress, name=record["path"])
                if progress:
                    progress({"phase": "file-complete", "path": record["path"],
                              "completedFiles": index, "totalFiles": len(checked)})
        original, _ = read_json(member(self.root, "manifest.json"))
        portable, _ = read_json(member(self.root, "scene-export.json"))
        require(original.get("schema") == "stellar-forge.stac-customer-delivery.v1" and
                all(original.get(key) == value for key, value in self.source.items()) and
                portable.get("schema") == "starforge.stac-portable-export.v1" and
                portable.get("sourceDelivery") == self.source and portable.get("paths") == manifest.get("paths"),
                "ORIGINAL_SOURCE_CHANGED", "The original customer and portable manifest identities differ.")
        expected = set(original.get("files", {})) | {"manifest.json", "scene-export.json"}
        expected.update(record["path"] for record in portable.get("files", []))
        require(expected == set(self.files), "COMPLETE_RECEIVING_REQUIRED",
                "Keep every original native and portable file in the receiving directory.")
        for name, record in original["files"].items():
            current = self.files.get(name, {})
            require(current.get("bytes") == record.get("bytes") and current.get("sha256") == record.get("sha256"),
                    "ORIGINAL_FILE_CHANGED", "The original customer member descriptor changed.", path=name)
        for record in portable["files"]:
            current = self.files.get(record["path"], {})
            require(current.get("bytes") == record.get("bytes") and current.get("sha256") == record.get("sha256"),
                    "PORTABLE_FILE_CHANGED", "The original portable member descriptor changed.", path=record["path"])
        self.edition = copy.deepcopy(portable.get("sourceEdition"))
        self.paths = copy.deepcopy(manifest["paths"])
        self.features, _ = read_json(self.path(self.paths["footprints"]))
        inventory, _ = read_json(self.path(self.paths["asset-inventory"]))
        collections, _ = read_json(self.path(self.paths["collections"]))
        require(self.features.get("type") == "FeatureCollection" and isinstance(self.features.get("features"), list) and
                inventory.get("schema") == "starforge.stac-asset-inventory.v1",
                "SCENE_SOURCE_INVALID", "The complete original scene and asset inventory is required.")
        self.scenes, self.assets = {}, {}
        for feature in self.features["features"]:
            require(isinstance(feature, dict) and feature.get("type") == "Feature" and
                    isinstance(feature.get("id"), str) and isinstance(feature.get("properties"), dict),
                    "SCENE_INVALID", "Use the original source Feature objects.")
            key = scene_key(feature.get("collection"), feature["id"])
            require(key not in self.scenes, "SCENE_IDENTITY_CONFLICT", "Select one edition of each Collection/Item identity.")
            self.scenes[key] = feature
        for item in inventory.get("assets", []):
            key = asset_key(item.get("collection"), item.get("itemId"), item.get("assetKey"))
            require(key not in self.assets, "ASSET_IDENTITY_CONFLICT", "A scene asset has more than one receiver outcome.")
            scene = self.scenes.get(scene_key(item.get("collection"), item.get("itemId")))
            require(scene is not None and scene.get("assets", {}).get(item.get("assetKey")) == item.get("original"),
                    "ASSET_SOURCE_CHANGED", "The asset metadata differs from its original scene.")
            if item.get("file") is not None:
                file = descriptor(item["file"])
                known = self.files.get(file["path"])
                require(known and all(known.get(k) == file.get(k) for k in ("bytes", "sha256")),
                        "ASSET_NOT_RECEIVED", "The asset is not in the original selected file closure.", path=file["path"])
            self.assets[key] = item
        self.collections = collections.get("collections", [])
        self.unbound_assets = inventory.get("unboundAssets", [])
        self.summary = copy.deepcopy(manifest.get("summary", {}))

    def path(self, name, verify=False, progress=None):
        require(name in self.files, "MEMBER_NOT_RECEIVED", "This file is outside the original receiving selection.", path=name)
        path = member(self.root, name)
        if verify:
            file_digest(path, expected=self.files[name], progress=progress, name=name)
        return path

    def scene_rows(self):
        return [{"key": key, "collection": feature.get("collection"), "itemId": feature["id"],
                 "datetime": feature["properties"].get("datetime"),
                 "startDatetime": feature["properties"].get("start_datetime"),
                 "endDatetime": feature["properties"].get("end_datetime"),
                 "cloudCover": feature["properties"].get("eo:cloud_cover"),
                 "assetCount": len(feature.get("assets", {})), "geometryType": (feature.get("geometry") or {}).get("type"),
                 "metadataSha256": value_sha(feature)} for key, feature in self.scenes.items()]

    def asset_rows(self, selected_scene=None):
        rows = []
        for key, item in self.assets.items():
            native_scene = scene_key(item.get("collection"), item["itemId"])
            if selected_scene is not None and native_scene != selected_scene:
                continue
            original = item["original"]
            file = item.get("file")
            extension = PurePosixPath(file["path"]).suffix.lower() if file else ""
            mime = (original.get("type") or (file or {}).get("contentType") or "").split(";")[0].lower()
            kind = ("raster" if extension in (".tif", ".tiff", ".jp2") or mime in ("image/tiff", "image/geotiff", "image/jp2")
                    else "vector" if extension in (".geojson", ".json", ".gpkg", ".fgb") or mime in
                    ("application/geo+json", "application/geopackage+sqlite3", "application/vnd.flatgeobuf")
                    else "preview" if mime.startswith("image/") or extension in (".png", ".jpg", ".jpeg", ".webp", ".avif")
                    else "other")
            rows.append({"key": key, "sceneKey": native_scene, "collection": item.get("collection"),
                         "itemId": item["itemId"], "assetKey": item["assetKey"],
                         "title": original.get("title") or item["assetKey"], "mime": mime,
                         "roles": original.get("roles", []), "kindHint": kind,
                         "outcome": item.get("outcome"), "reason": item.get("reason"),
                         "file": copy.deepcopy(file), "original": copy.deepcopy(original),
                         "receipt": copy.deepcopy(item.get("receipt"))})
        return rows


def compare_sources(left, right):
    scenes = []
    for key in sorted(set(left.scenes) | set(right.scenes)):
        old, new = left.scenes.get(key), right.scenes.get(key)
        status = "ADDED" if old is None else "REMOVED" if new is None else "UNCHANGED" if old == new else "CHANGED"
        scenes.append({"key": key, "status": status, "leftSha256": value_sha(old) if old else None,
                       "rightSha256": value_sha(new) if new else None,
                       "collection": (new or old).get("collection"), "itemId": (new or old)["id"]})
    assets = []
    for key in sorted(set(left.assets) | set(right.assets)):
        old, new = left.assets.get(key), right.assets.get(key)
        def facts(value):
            if value is None:
                return None
            file = value.get("file")
            return {"original": value.get("original"), "outcome": value.get("outcome"), "reason": value.get("reason"),
                    "file": {k: file.get(k) for k in ("bytes", "sha256", "contentType")} if file else None}
        status = "ADDED" if old is None else "REMOVED" if new is None else "UNCHANGED" if facts(old) == facts(new) else "CHANGED"
        same_bytes = bool(old and new and old.get("file") and new.get("file") and
                          all(old["file"].get(x) == new["file"].get(x) for x in ("bytes", "sha256")))
        assets.append({"key": key, "status": status, "sameReceivedBytes": same_bytes,
                       "left": copy.deepcopy(old), "right": copy.deepcopy(new)})
    return {"leftSourceId": left.id, "rightSourceId": right.id, "scenes": scenes, "assets": assets,
            "counts": {name.lower(): sum(row["status"] == name for row in scenes)
                       for name in ("ADDED", "REMOVED", "UNCHANGED", "CHANGED")},
            "sameQuery": (left.edition or {}).get("query") == (right.edition or {}).get("query")}


def historical_style_refs(snapshot):
    """Exact style descriptors from retained GIS definitions, never arbitrary source metadata."""
    result = {}
    def add(raw):
        record = descriptor(raw)
        require(record["path"].startswith("styles/"), "HISTORY_STYLE_PATH",
                "Historical native styles must belong to the project style closure.")
        previous = result.get(record["path"])
        require(previous is None or all(previous[k] == record[k] for k in ("bytes", "sha256")),
                "HISTORY_STYLE_CONFLICT", "A historical style path has conflicting original bytes.", path=record["path"])
        result[record["path"]] = record
    def layer(row):
        require(isinstance(row, dict), "HISTORY_LAYER", "Retain the complete original GIS layer definition.")
        if row.get("styleFile") is not None:
            add(row["styleFile"])
        dependencies = row.get("styleDependencies", [])
        require(isinstance(dependencies, list), "HISTORY_STYLE_RESOURCES", "Retain the complete historical style resource list.")
        for record in dependencies:
            add(record)
    def context(item):
        if not isinstance(item, dict):
            return
        for row in item.get("layers", []):
            layer(row)
        for project in item.get("projects", []):
            context(project)
        if item.get("project"):
            context(item["project"])
        for review in item.get("reviews", []):
            context(review)
        if item.get("review"):
            context(item["review"])
        for change in item.get("changes", []):
            if change.get("previousDefinition") is not None:
                layer(change["previousDefinition"])
    context(snapshot.get("state", {}))
    for event in snapshot.get("events", []):
        context(event.get("details", {}))
    for request in snapshot.get("requests", []):
        context(request.get("result", {}))
    return [result[name] for name in sorted(result)]


class QgisWorkspace:
    """One desktop project workspace, with native choices and original source files."""

    def __init__(self, root, *, create=False, title="STAC GIS project"):
        self.root = directory(root, create=create)
        self.db_path = self.root / "workspace.sqlite"
        require(not self.db_path.is_symlink(), "WORKSPACE_DATABASE", "Use the ordinary project database.")
        if not self.db_path.exists():
            require(create, "WORKSPACE_MISSING", "Create a new project workspace or open its existing directory.")
            require(not any(self.root.iterdir()), "NEW_WORKSPACE_DIRECTORY", "Choose a new empty project directory.")
            with self._connect() as db:
                db.executescript("""
                    CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
                    CREATE TABLE events (revision INTEGER PRIMARY KEY, body TEXT NOT NULL);
                    CREATE TABLE requests (request_id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, result TEXT NOT NULL);
                """)
                state = {"schema": WORKSPACE_SCHEMA, "id": "qgis-" + uuid.uuid4().hex,
                         "title": str(title).strip() or "STAC GIS project", "revision": 0,
                         "createdAt": utc_now(), "activeSourceId": None, "sources": [], "layers": [],
                         "projects": [], "reviews": []}
                db.execute("INSERT INTO workspace VALUES(1,?)", (json.dumps(state, ensure_ascii=False),))
        state = self.read()
        require(state.get("schema") == WORKSPACE_SCHEMA and isinstance(state.get("revision"), int),
                "WORKSPACE_SCHEMA", "The directory is not a Starforge QGIS project workspace.")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=30)
        try:
            db.execute("PRAGMA busy_timeout=30000")
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db
        finally:
            db.close()

    def read(self):
        with self._connect() as db:
            row = db.execute("SELECT body FROM workspace WHERE id=1").fetchone()
            require(row is not None, "WORKSPACE_SCHEMA", "The project state is missing.")
            return json.loads(row[0])

    def operation(self, request_id, action=None, payload=None):
        with self._connect() as db:
            row = db.execute("SELECT input_sha256,result FROM requests WHERE request_id=?", (request_id,)).fetchone()
        if row is None:
            return None
        if action is not None:
            require(row[0] == value_sha({"action": action, "payload": payload}),
                    "REQUEST_REUSED", "This request ID already belongs to a different project change.")
        return json.loads(row[1])

    def _mutate(self, revision, request_id, actor, action, payload, update):
        require(type(revision) is int and revision >= 0 and isinstance(request_id, str) and
                REQUEST.fullmatch(request_id), "MUTATION_ID_REQUIRED",
                "Use the displayed revision and one stable request ID for this action.")
        require(isinstance(actor, str) and 0 < len(actor.strip()) <= 240, "ACTOR_REQUIRED",
                "Enter the analyst name for the retained project history.")
        signature = value_sha({"action": action, "payload": payload})
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT input_sha256,result FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if previous:
                require(previous[0] == signature, "REQUEST_REUSED",
                        "This request ID already belongs to a different project change.")
                return json.loads(previous[1])
            state = json.loads(db.execute("SELECT body FROM workspace WHERE id=1").fetchone()[0])
            require(state["revision"] == revision, "REVISION_CHANGED",
                    "The project changed in another session. Refresh its current revision before saving.",
                    expected=revision, actual=state["revision"])
            details = update(state) or {}
            state["revision"] += 1
            event = {"revision": state["revision"], "at": utc_now(), "actor": actor.strip(),
                     "action": action, "requestId": request_id, "details": details}
            self._validate_state(state)
            body = json.dumps(state, ensure_ascii=False, allow_nan=False)
            require(len(body.encode("utf-8")) <= MAX_JSON, "WORKSPACE_LIMIT",
                    "The complete project state exceeds the supported JSON size.")
            result = {"revision": state["revision"], "event": event, **details}
            db.execute("UPDATE workspace SET body=? WHERE id=1", (body,))
            db.execute("INSERT INTO events VALUES(?,?)", (state["revision"], json.dumps(event, ensure_ascii=False)))
            db.execute("INSERT INTO requests VALUES(?,?,?)",
                       (request_id, signature, json.dumps(result, ensure_ascii=False)))
            return result

    @staticmethod
    def _validate_state(state):
        require(state.get("schema") == WORKSPACE_SCHEMA and isinstance(state.get("sources"), list) and
                isinstance(state.get("layers"), list) and isinstance(state.get("projects"), list) and
                isinstance(state.get("reviews"), list), "WORKSPACE_SCHEMA", "The complete project state is invalid.")
        sources = {row["id"] for row in state["sources"]}
        require(len(sources) == len(state["sources"]) and
                (state["activeSourceId"] is None or state["activeSourceId"] in sources),
                "SOURCE_IDENTITY", "The current edition must belong to this project workspace.")
        require(len({row["id"] for row in state["layers"]}) == len(state["layers"]),
                "LAYER_IDENTITY", "Project layer IDs must remain unique.")
        for source in state["sources"]:
            require(HASH.fullmatch(source.get("manifestSha256", "")) and source["id"] == source["manifestSha256"] and
                    source.get("path") == "sources/" + source["id"], "SOURCE_IDENTITY",
                    "The project source path must retain its exact receiving manifest.")
        for layer in state["layers"]:
            require(layer["sourceId"] in sources and layer["kind"] in ("footprints", "raster", "vector"),
                    "LAYER_SOURCE", "Every GIS layer must bind an imported source edition.")
            if layer.get("styleFile"):
                descriptor(layer["styleFile"])
            for dependency in layer.get("styleDependencies", []):
                descriptor(dependency)
        for project in state["projects"]:
            descriptor(project["file"])
            require(all(source in sources for source in project["sourceIds"]),
                    "PROJECT_SOURCE", "A saved map requires its original source editions.")

    def source(self, source_id=None, *, verify=False, progress=None):
        state = self.read()
        source_id = source_id or state["activeSourceId"]
        row = next((x for x in state["sources"] if x["id"] == source_id), None)
        require(row is not None, "SOURCE_NOT_SELECTED", "Select an imported source edition.")
        return ReceivingSource(self.root / row["path"], row["manifestSha256"], progress=progress, verify=verify)

    def import_source(self, source_root, *, revision, request_id, actor, expected_manifest_sha256=None, progress=None):
        if expected_manifest_sha256 is not None:
            previous = self.operation(request_id, "source.imported", {"sourceId": expected_manifest_sha256})
            if previous:
                return previous
        source = ReceivingSource(source_root, expected_manifest_sha256, progress=progress)
        payload = {"sourceId": source.id}
        previous = self.operation(request_id, "source.imported", payload)
        if previous:
            return previous
        target = self.root / "sources" / source.id
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name, record in source.files.items():
            retain_copy(source.path(name), target, name, record, progress)
        retain_bytes(target, MANIFEST_NAME, source.manifest_body)
        ReceivingSource(target, source.id, verify=False)
        def update(state):
            existing = next((x for x in state["sources"] if x["id"] == source.id), None)
            if existing is None:
                existing = {"id": source.id, "path": "sources/" + source.id, "manifestSha256": source.id,
                            "source": source.source, "summary": source.summary, "importedAt": utc_now(), "actor": actor}
                state["sources"].append(existing)
            if state["activeSourceId"] is None:
                state["activeSourceId"] = source.id
            return {"source": copy.deepcopy(existing)}
        return self._mutate(revision, request_id, actor, "source.imported", payload, update)

    def activate_source(self, source_id, *, revision, request_id, actor):
        def update(state):
            require(any(x["id"] == source_id for x in state["sources"]), "SOURCE_NOT_FOUND", "Select an imported edition.")
            previous = state["activeSourceId"]
            state["activeSourceId"] = source_id
            return {"sourceId": source_id, "previousSourceId": previous,
                    "retainedLayerIds": [x["id"] for x in state["layers"]]}
        return self._mutate(revision, request_id, actor, "source.selected", {"sourceId": source_id}, update)

    def normalize_layers(self, definitions):
        require(isinstance(definitions, list), "LAYER_LIST_REQUIRED", "Supply the complete selected layer list.")
        state = self.read()
        source_ids = {row["id"] for row in state["sources"]}
        cached, result = {}, []
        for original in definitions:
            require(isinstance(original, dict), "LAYER_INVALID", "Each selected layer needs its source and kind.")
            row = copy.deepcopy(original)
            row.setdefault("id", "layer-" + uuid.uuid4().hex)
            require(isinstance(row["id"], str) and REQUEST.fullmatch(row["id"]), "LAYER_ID_INVALID", "Use a stable layer ID.")
            require(row.get("sourceId") in source_ids, "LAYER_SOURCE", "Select an imported source edition.")
            if row["sourceId"] not in cached:
                cached[row["sourceId"]] = self.source(row["sourceId"])
            source = cached[row["sourceId"]]
            require(row.get("kind") in ("footprints", "raster", "vector"), "LAYER_KIND",
                    "Select footprints, a retained raster, or a retained vector layer.")
            row["label"] = str(row.get("label") or ("Scene footprints" if row["kind"] == "footprints" else row.get("assetKey", "Layer"))).strip()
            require(0 < len(row["label"]) <= 512, "LAYER_LABEL", "Use a layer label of up to 512 characters.")
            row.setdefault("visible", True)
            row.setdefault("opacity", 1.0)
            require(type(row["visible"]) is bool and type(row["opacity"]) in (int, float) and 0 <= row["opacity"] <= 1,
                    "LAYER_DISPLAY", "Choose visible or hidden and opacity from 0 to 1.")
            if row["kind"] == "footprints":
                row.setdefault("allScenes", True)
                require(type(row["allScenes"]) is bool, "SCENE_SCOPE", "Choose all scenes or an explicit scene list.")
                keys = list(source.scenes) if row["allScenes"] else row.get("sceneKeys")
                require(isinstance(keys, list) and len(keys) == len(set(keys)) and all(k in source.scenes for k in keys),
                        "SCENE_SCOPE", "Select unchanged original Collection/Item identities.")
                row["sceneKeys"] = keys
            else:
                key = asset_key(row.get("collection"), row.get("itemId"), row.get("assetKey"))
                item = source.assets.get(key)
                require(item is not None and item.get("file") is not None, "ASSET_NOT_RECEIVED",
                        "Choose an asset actually present in this received edition.")
                row["sceneKey"] = scene_key(row.get("collection"), row["itemId"])
                row["file"] = copy.deepcopy(item["file"])
                row.setdefault("vectorLayer", "")
                require(isinstance(row["vectorLayer"], str) and len(row["vectorLayer"]) <= 512 and
                        not any(c in row["vectorLayer"] for c in ("\x00", "|", "\n", "\r")),
                        "VECTOR_LAYER_NAME", "Select the actual native sublayer name.")
                row.setdefault("vectorSubsetString", "")
                require(isinstance(row["vectorSubsetString"], str) and len(row["vectorSubsetString"]) <= 65536 and "\x00" not in row["vectorSubsetString"],
                        "VECTOR_SUBSET_INVALID", "Retain an explicit native vector filter of up to 65,536 characters.")
                row.setdefault("bands", None)
                bands = row["bands"]
                require(bands is None or isinstance(bands, dict) and
                        ((set(bands) == {"gray"} and type(bands["gray"]) is int and bands["gray"] > 0) or
                         (set(bands) == {"rgb"} and isinstance(bands["rgb"], list) and len(bands["rgb"]) == 3 and
                          all(type(x) is int and x > 0 for x in bands["rgb"]))),
                        "RASTER_BANDS", "Select a native gray band or three native RGB band numbers.")
            row.setdefault("crsOverride", None)
            require(row["crsOverride"] is None or isinstance(row["crsOverride"], str) and 0 < len(row["crsOverride"]) <= 32000,
                    "CRS_SELECTION", "Use an explicit QGIS CRS definition only when the analyst selects one.")
            if row.get("styleFile"):
                record = descriptor(row["styleFile"])
                require(record["path"].startswith("styles/") and record["path"].endswith(".qml"),
                        "STYLE_SOURCE", "Use a retained native QGIS style.")
                file_digest(member(self.root, record["path"]), expected=record)
            row.setdefault("styleDependencies", [])
            require(isinstance(row["styleDependencies"], list), "STYLE_RESOURCES", "Retain the complete native style resource list.")
            for dependency in row["styleDependencies"]:
                descriptor(dependency)
                require(dependency["path"].startswith("styles/resources/"), "STYLE_RESOURCE_PATH", "Use the retained native style resources.")
                file_digest(member(self.root, dependency["path"]), expected=dependency)
            result.append(row)
        require(len({x["id"] for x in result}) == len(result), "LAYER_IDENTITY", "Layer IDs must remain unique.")
        return result

    def save_layers(self, definitions, *, revision, request_id, actor):
        payload = {"layers": definitions}
        previous = self.operation(request_id, "layers.saved", payload)
        if previous:
            return previous
        normalized = self.normalize_layers(definitions)
        def update(state):
            state["layers"] = normalized
            return {"layers": copy.deepcopy(normalized)}
        return self._mutate(revision, request_id, actor, "layers.saved", payload, update)

    def compare(self, left_id, right_id):
        require(left_id != right_id, "SAME_SOURCE", "Select two different receiving editions to compare.")
        return compare_sources(self.source(left_id), self.source(right_id))

    def review_successor(self, left_id, right_id, decisions, *, revision, request_id, actor, note):
        require(isinstance(note, str) and note.strip(), "REVIEW_NOTE", "Record the reason for the selected edition changes.")
        payload = {"leftId": left_id, "rightId": right_id, "decisions": decisions, "note": note.strip()}
        previous = self.operation(request_id, "edition.reviewed", payload)
        if previous:
            return previous
        comparison = self.compare(left_id, right_id)
        right = self.source(right_id)
        left = self.source(left_id)
        require(isinstance(decisions, list) and len({d.get("layerId") for d in decisions if isinstance(d, dict)}) == len(decisions),
                "REVIEW_DECISIONS", "Choose one keep, update or remove decision for each affected map layer.")
        by_id = {d["layerId"]: d for d in decisions}
        state = self.read()
        affected = [x for x in state["layers"] if x["sourceId"] == left_id]
        require(set(by_id) == {x["id"] for x in affected}, "COMPLETE_REVIEW_REQUIRED",
                "Review every map layer bound to the prior edition.")
        layers, changes = [], []
        for old in state["layers"]:
            if old["sourceId"] != left_id:
                layers.append(copy.deepcopy(old))
                continue
            decision = by_id[old["id"]]
            choice = decision.get("decision")
            require(choice in ("keep", "update", "remove"), "REVIEW_DECISION", "Choose keep, update or remove.")
            if choice == "keep":
                layers.append(copy.deepcopy(old))
            elif choice == "update":
                row = copy.deepcopy(old)
                row["sourceId"] = right_id
                if row["kind"] == "footprints":
                    row["sceneKeys"] = list(right.scenes) if row.get("allScenes") else [k for k in row["sceneKeys"] if k in right.scenes]
                else:
                    key = asset_key(row.get("collection"), row["itemId"], row["assetKey"])
                    next_asset = right.assets.get(key)
                    require(next_asset and next_asset.get("file"), "SUCCESSOR_ASSET_UNAVAILABLE",
                            "The successor did not retain this asset. Keep the prior layer or remove it.", layerId=row["id"])
                    same_bytes = all(old["file"].get(k) == next_asset["file"].get(k) for k in ("bytes", "sha256"))
                    row["file"] = copy.deepcopy(next_asset["file"])
                    if not same_bytes:
                        row["styleFile"] = None
                        row["styleDependencies"] = []
                        row["bands"] = None
                        row["crsOverride"] = None
                        row["vectorLayer"] = decision.get("vectorLayer", "")
                        row["vectorSubsetString"] = decision.get("vectorSubsetString", "")
                layers.append(row)
            changes.append({"layerId": old["id"], "decision": choice, "oldSourceId": left_id,
                            "newSourceId": right_id if choice == "update" else old["sourceId"],
                            "previousDefinition": copy.deepcopy(old)})
        normalized = self.normalize_layers(layers)
        review = {"id": "review-" + request_id, "at": utc_now(), "actor": actor, "note": note.strip(),
                  "comparison": comparison, "changes": changes}
        def update(current):
            current["layers"] = normalized
            current["activeSourceId"] = right_id
            current["reviews"].append(review)
            return {"review": copy.deepcopy(review), "layers": copy.deepcopy(normalized)}
        return self._mutate(revision, request_id, actor, "edition.reviewed", payload, update)

    def retain_project(self, record, *, revision, request_id, actor, input_sha256):
        descriptor(record["file"])
        require(record["file"]["path"].startswith("projects/") and record["file"]["path"].endswith(".qgz"),
                "NATIVE_PROJECT_REQUIRED", "Retain a saved native QGIS project.")
        file_digest(member(self.root, record["file"]["path"]), expected=record["file"])
        payload = {"inputSha256": input_sha256}
        def update(state):
            project = copy.deepcopy(record)
            project.update({"id": "project-" + request_id, "at": utc_now(), "actor": actor,
                            "sourceIds": sorted({row["sourceId"] for row in state["layers"]}),
                            "inputRevision": revision, "layers": copy.deepcopy(state["layers"]),
                            "inputSha256": input_sha256})
            state["projects"].append(project)
            return {"project": copy.deepcopy(project)}
        return self._mutate(revision, request_id, actor, "project.saved", payload, update)

    def history(self):
        with self._connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT body FROM events ORDER BY revision")]

    def snapshot(self):
        with self._connect() as db:
            db.execute("BEGIN")
            state = json.loads(db.execute("SELECT body FROM workspace WHERE id=1").fetchone()[0])
            events = [json.loads(row[0]) for row in db.execute("SELECT body FROM events ORDER BY revision")]
            requests = [{"requestId": row[0], "inputSha256": row[1], "result": json.loads(row[2])}
                        for row in db.execute("SELECT request_id,input_sha256,result FROM requests ORDER BY request_id")]
        return {"schema": SNAPSHOT_SCHEMA, "state": state, "events": events, "requests": requests}


    def project_files(self, snapshot=None):
        snapshot = snapshot or self.snapshot()
        state = snapshot["state"]
        records = {}
        def add(record):
            record = descriptor(record)
            previous = records.get(record["path"])
            require(previous is None or all(previous[k] == record[k] for k in ("bytes", "sha256")),
                    "PACKAGE_FILE_CONFLICT", "A project file has two different retained identities.", path=record["path"])
            records[record["path"]] = record
        for row in state["sources"]:
            source = ReceivingSource(self.root / row["path"], row["manifestSha256"], verify=False)
            for name, value in source.files.items():
                add({"path": row["path"] + "/" + name, "bytes": value["bytes"], "sha256": value["sha256"]})
            add({"path": row["path"] + "/" + MANIFEST_NAME, "bytes": len(source.manifest_body), "sha256": source.id})
        all_layers = list(state["layers"])
        for project in state["projects"]:
            add(project["file"])
            all_layers.extend(project.get("layers", []))
            for value in project.get("derivedFiles", []):
                add(value)
        for layer in all_layers:
            if layer.get("styleFile"):
                add(layer["styleFile"])
            for dependency in layer.get("styleDependencies", []):
                add(dependency)
        for record in historical_style_refs(snapshot):
            add(record)
        return [records[name] for name in sorted(records)]

    def export_package(self, destination, *, expected_revision=None, progress=None):
        destination = Path(destination).expanduser().absolute()
        require(not destination.exists(), "OUTPUT_EXISTS", "Select a new complete project archive filename.", path=str(destination))
        require(not destination.is_relative_to(self.root), "PACKAGE_OUTPUT_DIRECTORY",
                "Save the receiving archive outside the active project workspace.")
        snapshot = self.snapshot()
        if expected_revision is not None:
            require(snapshot["state"]["revision"] == expected_revision, "REVISION_CHANGED",
                    "The project changed. Review the current revision before exporting.")
        records = self.project_files(snapshot)
        snapshot_body = json_bytes(snapshot)
        records.insert(0, {"path": "workspace-snapshot.json", "bytes": len(snapshot_body), "sha256": sha_bytes(snapshot_body)})
        software = {}
        plugin_root = Path(__file__).resolve().parent
        for name in ("__init__.py", "model.py", "qgis_project.py", "plugin.py", "cli.py", "metadata.txt"):
            path = plugin_root / name
            require(path.is_file() and not path.is_symlink(), "PLUGIN_SOURCE_MISSING",
                    "Keep the complete installed QGIS plugin with the project handover.", path=name)
            body = path.read_bytes()
            software["software/starforge_stac/" + name] = body
        for name in ("OPERATIONS.md", "LICENSE"):
            path = plugin_root / name
            if not path.is_file():
                path = plugin_root.parent / name
            require(path.is_file(), "PLUGIN_GUIDE_MISSING", "Keep the operator guide and license with the plugin.", path=name)
            software["software/starforge_stac/" + name] = path.read_bytes()
        for name, body in software.items():
            records.append({"path": name, "bytes": len(body), "sha256": sha_bytes(body)})
        records.sort(key=lambda x: x["path"])
        manifest = {"schema": PACKAGE_SCHEMA, "workspaceId": snapshot["state"]["id"],
                    "revision": snapshot["state"]["revision"], "title": snapshot["state"]["title"],
                    "files": records, "sources": [{"id": x["id"], "source": x["source"]} for x in snapshot["state"]["sources"]],
                    "projects": [{"id": x["id"], "file": x["file"]} for x in snapshot["state"]["projects"]],
                    "totalBytes": sum(x["bytes"] for x in records)}
        manifest_body = json_bytes(manifest)
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".qgis-package-", suffix=".zip", dir=destination.parent)
        os.close(fd)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for index, record in enumerate(records, 1):
                    name = record["path"]
                    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    # Imagery is already compressed. Store it without a costly second compression pass.
                    info.compress_type = zipfile.ZIP_STORED if name.endswith((".tif", ".tiff", ".jp2", ".png", ".jpg", ".qgz")) else zipfile.ZIP_DEFLATED
                    if name == "workspace-snapshot.json":
                        body = snapshot_body
                    else:
                        body = software.get(name)
                    if body is not None:
                        archive.writestr(info, body)
                    else:
                        digest, count = hashlib.sha256(), 0
                        with member(self.root, name).open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                            while True:
                                block = source.read(CHUNK)
                                if not block:
                                    break
                                target.write(block)
                                digest.update(block)
                                count += len(block)
                                require(count <= record["bytes"], "FILE_SIZE_CHANGED", "A project file changed while exporting.", path=name)
                                if progress:
                                    progress({"phase": "package", "path": name, "completedBytes": count,
                                              "totalBytes": record["bytes"], "completedFiles": index - 1, "totalFiles": len(records)})
                        require(count == record["bytes"] and digest.hexdigest() == record["sha256"],
                                "FILE_HASH_CHANGED", "A project file changed while exporting.", path=name)
                    if progress:
                        progress({"phase": "file-complete", "path": name, "completedFiles": index, "totalFiles": len(records)})
                info = zipfile.ZipInfo("qgis-package.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, manifest_body)
            with open(temporary, "rb") as stream:
                os.fsync(stream.fileno())
            os.link(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
        return {"path": str(destination), **file_digest(destination, progress=progress, phase="package-verify"),
                "manifestSha256": sha_bytes(manifest_body), "workspaceId": manifest["workspaceId"],
                "revision": manifest["revision"], "fileCount": len(records) + 1, "totalDecodedBytes": manifest["totalBytes"]}


def receive_package(archive_path, destination, *, expected_sha256=None, progress=None):
    archive_path = Path(archive_path).expanduser().absolute()
    measured = file_digest(archive_path, progress=progress, phase="archive")
    require(expected_sha256 is None or measured["sha256"] == expected_sha256,
            "PACKAGE_HASH_CHANGED", "The complete received archive differs from its transfer receipt.")
    target = Path(destination).expanduser().absolute()
    if target.exists():
        require(target.is_dir() and not target.is_symlink(), "NEW_WORKSPACE_DIRECTORY", "Select an ordinary project directory.")
        receipt = target / "received-package.json"
        if receipt.exists() and (target / "workspace.sqlite").exists():
            prior, _ = read_json(receipt)
            require(prior.get("sha256") == measured["sha256"], "WORKSPACE_ALREADY_RECEIVED",
                    "This directory contains a different received project. Select a new directory.")
            workspace = QgisWorkspace(target)
            for record in workspace.project_files():
                file_digest(member(target, record["path"]), expected=record, progress=progress, name=record["path"])
            return {"workspace": workspace, "receipt": prior, "replayed": True}
        require(not (target / "workspace.sqlite").exists() or (target / "receiving-operation.json").is_file(),
                "WORKSPACE_EXISTS", "Choose a new receiving directory for the complete project.")
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory(target)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and len(names) <= 1000000, "PACKAGE_MEMBERS",
                "The complete archive contains duplicate members or exceeds the supported member count.")
        require("qgis-package.json" in names, "PACKAGE_MANIFEST", "The original project package manifest is missing.")
        info = archive.getinfo("qgis-package.json")
        require(info.file_size <= MAX_JSON, "PACKAGE_MANIFEST_LIMIT", "The complete package manifest exceeds the supported size.")
        manifest_body = archive.read(info)
        manifest = json.loads(manifest_body.decode("utf-8"))
        require(manifest.get("schema") == PACKAGE_SCHEMA and isinstance(manifest.get("files"), list),
                "PACKAGE_SCHEMA", "Select a complete Starforge QGIS project package.")
        records = {}
        for raw in manifest["files"]:
            record = descriptor(raw)
            require(record["path"] not in records, "PACKAGE_MEMBERS", "The package declares a duplicate file.")
            records[record["path"]] = record
        require(set(names) == set(records) | {"qgis-package.json"} and "workspace-snapshot.json" in records,
                "PACKAGE_CLOSURE", "Every package member must have its original exact descriptor.")
        # All member/type/length decisions precede extraction.
        for name in names:
            relative_name(name)
            info = archive.getinfo(name)
            mode = (info.external_attr >> 16) & 0xFFFF
            require(not info.is_dir() and not stat.S_ISLNK(mode) and
                    (not stat.S_IFMT(mode) or stat.S_ISREG(mode)),
                    "PACKAGE_MEMBER_TYPE", "The complete project package accepts ordinary files only.", path=name)
            if name in records:
                require(info.file_size == records[name]["bytes"], "PACKAGE_MEMBER_SIZE",
                        "A package member differs from the retained size.", path=name)
        marker = {"sha256": measured["sha256"], "manifestSha256": sha_bytes(manifest_body)}
        marker_path = target / "receiving-operation.json"
        if marker_path.exists():
            old, _ = read_json(marker_path)
            require(old == marker, "RECEIVING_OPERATION_CHANGED",
                    "Continue the same complete archive in this receiving directory.")
        else:
            require(not any(target.iterdir()), "NEW_WORKSPACE_DIRECTORY", "Choose an empty receiving directory.")
            retain_bytes(target, "receiving-operation.json", json_bytes(marker))
        for index, (name, record) in enumerate(records.items(), 1):
            path = member(target, name, existing=False)
            if path.exists():
                file_digest(path, expected=record, progress=progress, name=name)
                continue
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".qgis-receive-", dir=path.parent)
            digest, count = hashlib.sha256(), 0
            try:
                with archive.open(name) as source, os.fdopen(fd, "wb") as output:
                    while True:
                        block = source.read(CHUNK)
                        if not block:
                            break
                        count += len(block)
                        require(count <= record["bytes"], "PACKAGE_MEMBER_SIZE", "The member expands beyond its declared size.", path=name)
                        digest.update(block)
                        output.write(block)
                        if progress:
                            progress({"phase": "receive", "path": name, "completedBytes": count,
                                      "totalBytes": record["bytes"], "completedFiles": index - 1, "totalFiles": len(records)})
                    output.flush()
                    os.fsync(output.fileno())
                require(count == record["bytes"] and digest.hexdigest() == record["sha256"],
                        "PACKAGE_MEMBER_HASH", "The original member bytes changed.", path=name)
                try:
                    os.link(temporary, path)
                except FileExistsError:
                    file_digest(path, expected=record, name=name)
            finally:
                Path(temporary).unlink(missing_ok=True)
        snapshot, snapshot_body = read_json(member(target, "workspace-snapshot.json"))
        require(sha_bytes(snapshot_body) == records["workspace-snapshot.json"]["sha256"] and
                snapshot.get("schema") == SNAPSHOT_SCHEMA and
                snapshot["state"]["id"] == manifest.get("workspaceId") and
                snapshot["state"]["revision"] == manifest.get("revision"),
                "SNAPSHOT_IDENTITY", "The complete workspace snapshot differs from the package.")
        QgisWorkspace._validate_state(snapshot["state"])
        require([x["revision"] for x in snapshot["events"]] == list(range(1, snapshot["state"]["revision"] + 1)),
                "HISTORY_INCOMPLETE", "The project must retain every original history revision.")
        require(len({x["requestId"] for x in snapshot["requests"]}) == len(snapshot["requests"]),
                "REQUEST_HISTORY", "The original operation history contains a duplicate identity.")
        # Bind all nested source and project/style references before publishing the database.
        for source in snapshot["state"]["sources"]:
            ReceivingSource(target / source["path"], source["manifestSha256"], verify=False)
        referenced = []
        for project in snapshot["state"]["projects"]:
            referenced.append(project["file"])
            referenced.extend(project.get("derivedFiles", []))
        for row in snapshot["state"]["layers"] + [layer for project in snapshot["state"]["projects"] for layer in project.get("layers", [])]:
            if row.get("styleFile"):
                referenced.append(row["styleFile"])
            referenced.extend(row.get("styleDependencies", []))
        referenced.extend(historical_style_refs(snapshot))
        for raw in referenced:
            record = descriptor(raw)
            require(record["path"] in records and all(records[record["path"]][k] == record[k] for k in ("bytes", "sha256")),
                    "SNAPSHOT_FILE_CLOSURE", "The project snapshot references a missing or changed native file.", path=record["path"])
        if (target / "workspace.sqlite").exists():
            # Resume only our already-published exact snapshot after a lost receipt write.
            current = QgisWorkspace(target).snapshot()
            require(current == snapshot, "RECEIVED_WORKSPACE_CHANGED",
                    "The received project changed before completion. Preserve it and use a new receiving directory.")
        else:
            fd, pending_db = tempfile.mkstemp(prefix=".qgis-db-", suffix=".sqlite", dir=target)
            os.close(fd)
            try:
                db = sqlite3.connect(pending_db)
                try:
                    db.executescript("""
                        CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
                        CREATE TABLE events (revision INTEGER PRIMARY KEY, body TEXT NOT NULL);
                        CREATE TABLE requests (request_id TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, result TEXT NOT NULL);
                    """)
                    with db:
                        db.execute("INSERT INTO workspace VALUES(1,?)", (json.dumps(snapshot["state"], ensure_ascii=False),))
                        db.executemany("INSERT INTO events VALUES(?,?)",
                                       [(e["revision"], json.dumps(e, ensure_ascii=False)) for e in snapshot["events"]])
                        db.executemany("INSERT INTO requests VALUES(?,?,?)",
                                       [(r["requestId"], r["inputSha256"], json.dumps(r["result"], ensure_ascii=False))
                                        for r in snapshot["requests"]])
                finally:
                    db.close()
                os.link(pending_db, target / "workspace.sqlite")
            finally:
                Path(pending_db).unlink(missing_ok=True)
    receipt = {"schema": "starforge.stac-qgis-project-received.v1", **marker,
               "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
               "receivedAt": utc_now(), "bytes": measured["bytes"], "files": len(records)}
    retain_bytes(target, "received-package.json", json_bytes(receipt))
    workspace = QgisWorkspace(target)
    return {"workspace": workspace, "receipt": receipt, "replayed": False}
