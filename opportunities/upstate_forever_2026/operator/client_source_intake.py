"""Guided original scientific files, on the existing operator queue and Workspace."""
from __future__ import annotations

from copy import deepcopy
import csv
import json
import os
from pathlib import Path
import tempfile

from model.common import (atomic_json, describe_file, digest, file_digest, held,
                          identifier, now, read_json, relative_file, retain_file,
                          verify_file)
from model.client_source_files import (ROLES, TABLE_FIELDS, TARGET_UNITS, checked_selection,
                                       inspect_file, need, options, project_table,
                                       select_band, text)
from model.model_selection import required_table_fields
from model import portable_fs as _fs

ACTIONS = {"client-source.inspect", "client-source.commit"}
SCHEMA = "upstate.client-source-operation/v1"
SIDECARS = {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qpj", ".xml"}


class ClientSourceIntake:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    @staticmethod
    def directory(ws, key):
        return ws.root / "client-source-intake" / identifier(key)

    @staticmethod
    def _raw(ws, body):
        path = relative_file(ws.root, body["object"])
        need(path.is_file() and path.stat().st_size == body["bytes"] and
             file_digest(path) == body["sha256"], "A retained original file changed. Restore its exact saved source.")
        return path

    def _view(self, ws, directory, body, filename):
        source = self._raw(ws, body)
        need(Path(filename).name == filename and "\\" not in filename and filename,
             "Keep an ordinary original filename.")
        if os.name == "nt":
            _fs.relative_name(filename, windows=True)
        path = _fs.native_path(directory) / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() and not path.is_symlink():
            try:
                _fs.publish_file(source, path)
            except FileExistsError:
                pass
            _fs.sync_directory(path.parent)
        need(path.is_file() and not path.is_symlink() and path.stat().st_size == body["bytes"] and
             file_digest(path) == body["sha256"],
             "An existing original view differs; retain it and restore the complete intake.")
        return path

    def _verify(self, ws, record, *, complete=False):
        need(record["project_id"] == ws.project["id"], "The source intake belongs to another original project.")
        for item in record.get("files", []):
            self._raw(ws, item["original"])
        if complete:
            need(record.get("files"), "The completed intake must retain its selected originals.")
            if record["action"] == "client-source.inspect":
                need(all(("inspection" in item) != ("error" in item) for item in record["files"]),
                     "The completed original inspection is missing a file outcome.")
            else:
                need(record.get("selection_file") and record.get("manifest_file") and
                     record.get("source_collection_id") and record.get("source_ids"),
                     "The completed source edition is missing its original outputs.")
        if record.get("selection_file"):
            verify_file(ws.root, record["selection_file"])
        if record.get("manifest_file"):
            verify_file(ws.root, record["manifest_file"])
        if record.get("source_collection_id"):
            collection = ws._get("sources", record["source_collection_id"])
            need(all(key in {entry["id"] for entry in collection["entries"]} for key in record["source_ids"]),
                 "The reviewed source selections are missing from their saved collection.")
            for entry in collection["entries"]:
                self._raw(ws, entry["body"])
                for body in entry.get("companions", []):
                    self._raw(ws, body)
        return record

    def _load(self, ws, key):
        record = read_json(self.directory(ws, key) / "operation.json")
        need(record["id"] == key, "The saved source intake identity differs.")
        return self._verify(ws, record, complete=record.get("state") == "complete")

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            rows = []
            for path in sorted((ws.root / "client-source-intake").glob("*/operation.json")):
                record = read_json(path)
                if record.get("project_id") == ws.project["id"]:
                    rows.append({key: record.get(key) for key in
                                 ("id", "action", "title", "created_at", "state", "source_collection_id",
                                  "inspection_id", "error")})
            return {"workspace_key": workspace_key, "project_id": ws.project["id"],
                    "operations": rows, "roles": ROLES, "table_fields": TABLE_FIELDS,
                    "required_table_fields": {model: required_table_fields([model])
                                              for model in ("ndr", "sdr")},
                    "target_units": TARGET_UNITS}
        if operation in {"rows", "table-export"}:
            return self._table_read(workspace_key, ws, operation, payload)
        need(operation == "result", "Choose a source intake result.")
        value = self._load(ws, identifier(payload["id"]))
        value = deepcopy(value)
        value["_downloads"] = self._downloads(workspace_key, ws, value)
        return value


    def _table_source(self, ws, payload):
        record = self._load(ws, identifier(payload["id"]))
        need(record.get("action") == "client-source.inspect" and record.get("state") == "complete",
             "Open the completed original inspection before reading its table.")
        fi, pi = payload.get("file_index"), payload.get("part_index")
        need(type(fi) is int and 0 <= fi < len(record["files"]), "Choose the original file.")
        item = record["files"][fi]
        parts = item.get("inspection", {}).get("parts", [])
        need(type(pi) is int and 0 <= pi < len(parts), "Choose the original worksheet or table.")
        part = parts[pi]
        need(part.get("kind") == "table" and not part.get("error"),
             "Choose a readable original worksheet or table.")
        path = self._view(ws, self.directory(ws, record["id"]) / "originals" / str(fi),
                          item["original"], item["filename"])
        identity = {"inspection_id": record["id"], "file_index": fi, "part_index": pi,
                    "original": deepcopy(item["original"])}
        identity["original"]["filename"] = item["filename"]
        return record, item, part, path, identity

    def _table_read(self, workspace_key, ws, operation, payload):
        from model.client_source_rows import read_rows, export_table
        record, item, part, path, identity = self._table_source(ws, payload)
        if operation == "rows":
            result = read_rows(path, item["options"], part.get("sheet"),
                               start_row=payload.get("start_row"),
                               page_size=payload.get("page_size", 100),
                               query=payload.get("query", ""),
                               case_sensitive=payload.get("case_sensitive", False))
            result.update(identity)
            return result
        selection = {**identity, "sheet": part.get("sheet"), "reading": options(item["options"]),
                     "schema": "upstate.client-source-table-export/v1"}
        directory = self.directory(ws, record["id"]) / "table-exports" / digest(selection)
        directory.mkdir(parents=True, exist_ok=True)
        saved = directory / "manifest.json"
        with held(directory / ".export.lock"):
            if saved.exists():
                result = read_json(saved)
                need(result.get("selection") == selection, "The saved whole-table export has a different source.")
            else:
                with tempfile.TemporaryDirectory(prefix=".table-", dir=directory) as temporary:
                    result = export_table(path, item["options"], part.get("sheet"), temporary,
                                          identity=identity["original"])
                    retained = []
                    for artifact in result.pop("files"):
                        body = retain_file(ws.root, artifact, file_digest(artifact))
                        body["filename"] = artifact.name
                        retained.append(body)
                    result.update(identity)
                    result["selection"], result["artifacts"] = selection, retained
                    atomic_json(saved, result, immutable=True)
            result = deepcopy(result)
            result["_downloads"] = [
                self.operator._ticket(workspace_key, self._raw(ws, body), body,
                                      body["filename"])
                for body in result["artifacts"]]
            result["_downloads"].append(self.operator._ticket(
                workspace_key, self._raw(ws, item["original"]),
                {**item["original"], "filename": item["filename"]},
                "Exact original: " + item["filename"]))
            return result

    def _downloads(self, workspace_key, ws, record):
        directory = self.directory(ws, record["id"])
        path = directory / "operation.json"
        from hashlib import sha256
        from model.common import atomic_bytes
        from model.client_source_inspection_report import render_inspection
        reviewed = None
        if record.get("selection_file"):
            reviewed = read_json(verify_file(ws.root, record["selection_file"]))
        readable = render_inspection(record, reviewed)
        presentation = directory / ("inspection-readable-" + sha256(readable).hexdigest() + ".html")
        atomic_bytes(presentation, readable, immutable=True)
        descriptor = {**describe_file(ws.root, presentation), "filename": "source-inspection.html"}
        report = self.operator._ticket(workspace_key, presentation, descriptor,
                                       "Source inspection and reviewed meaning")
        report.update(kind="html", role="source-inspection-report")
        result = [report, self.operator._ticket(workspace_key, path, describe_file(ws.root, path),
                                                "Complete source intake — technical JSON")]
        for row in record.get("files", []):
            body = row["original"]
            result.append(self.operator._ticket(workspace_key, self._raw(ws, body),
                                                body, "Original: " + row["filename"]))
        for name in ("selection_file", "manifest_file"):
            body = record.get(name)
            if body:
                result.append(self.operator._ticket(workspace_key, verify_file(ws.root, body),
                                                    body, "Reviewed mapping" if name == "selection_file" else "Scientific source edition"))
        return result

    def decorate_task(self, task):
        if task.get("action") in ACTIONS:
            ws = self.operator.ws(task["workspace"])
            path = self.directory(ws, task["id"]) / "operation.json"
            if path.exists():
                record = read_json(path)
                task["_client_source"] = {key: record.get(key) for key in
                                         ("id", "state", "action", "title", "source_collection_id", "error")}
                task.setdefault("_downloads", []).extend(self._downloads(task["workspace"], ws, record))
        return task

    def verify_workspace(self, workspace):
        for path in (workspace.root / "client-source-intake").glob("*/operation.json"):
            record = self._load(workspace, path.parent.name)
            for manifest in path.parent.glob("table-exports/*/manifest.json"):
                exported = read_json(manifest)
                selected = exported["selection"]
                _, item, part, _, identity = self._table_source(workspace, {"id": record["id"],
                    "file_index": selected["file_index"], "part_index": selected["part_index"]})
                need(selected == {**identity, "sheet": part.get("sheet"),
                                  "reading": options(item["options"]),
                                  "schema": "upstate.client-source-table-export/v1"},
                     "A whole-table export belongs to a different retained source.")
                for body in exported["artifacts"]:
                    self._raw(workspace, body)
        return True

    def invoke(self, task):
        need(task["action"] in ACTIONS, "Choose an original client-source action.")
        ws = self.operator.ws(task["workspace"])
        directory = self.directory(ws, task["id"])
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "operation.json"
        with held(directory / ".operation.lock", blocking=False):
            if path.exists():
                record = self._load(ws, task["id"])
                need(record["request_sha256"] == task["request_sha256"] and record["action"] == task["action"],
                     "Keep the exact original source intake request.")
                if record["state"] == "complete":
                    return record
            else:
                record = {"schema": SCHEMA, "id": task["id"], "project_id": ws.project["id"],
                          "action": task["action"], "request_sha256": task["request_sha256"],
                          "title": text(task["payload"].get("title", ""), "source edition title", True),
                          "created_at": now(), "state": "working", "files": []}
                atomic_json(path, record)
            try:
                if task["action"] == "client-source.inspect":
                    self._inspect(ws, directory, record, task["payload"])
                else:
                    self._commit(ws, directory, record, task["payload"])
                self._verify(ws, record, complete=True)
                record["state"] = "complete"
                record.pop("error", None)
                record["completed_at"] = now()
                atomic_json(path, record)
                self._load(ws, task["id"])
                return record
            except BaseException as error:
                record["state"] = "failed"
                record["error"] = {"code": type(error).__name__, "message": str(error)}
                atomic_json(path, record)
                raise

    def _inspect(self, ws, directory, record, payload):
        inputs = payload.get("uploads")
        need(isinstance(inputs, list) and bool(inputs), "Choose one or more original files.")
        need(len({item.get("upload_id") for item in inputs if isinstance(item, dict)}) == len(inputs),
             "Each original upload should appear once in this inspection.")
        files = []
        for index, item in enumerate(inputs):
            need(isinstance(item, dict), "Choose original uploaded files.")
            upload_id = identifier(item["upload_id"])
            reading = options(item.get("options"))
            input_path = directory / ("input-" + str(index) + ".json")
            if input_path.exists():
                retained = read_json(input_path)
                need(retained["upload_id"] == upload_id and retained["options"] == reading,
                     "The original file selection changed.")
                self._raw(ws, retained["original"])
            else:
                uploaded = self.operator.upload(upload_id)
                original = retain_file(ws.root, uploaded["path"], uploaded["sha256"])
                original["filename"] = uploaded["filename"]
                retained = {"upload_id": upload_id, "filename": uploaded["filename"],
                            "original": original, "options": reading}
                atomic_json(input_path, retained, immutable=True)
            files.append(retained)
            record["files"] = deepcopy(files)
            atomic_json(directory / "operation.json", record)
        for index, item in enumerate(files):
            if "inspection" in item or "error" in item:
                continue
            view_root = directory / "originals" / str(index)
            path = self._view(ws, view_root, item["original"], item["filename"])
            try:
                if path.suffix.lower() == ".shp":
                    for ext in (".shx", ".dbf", ".prj"):
                        matches = [f for f in files if Path(f["filename"]).stem.casefold() == path.stem.casefold()
                                   and Path(f["filename"]).suffix.lower() == ext]
                        need(len(matches) == 1, "Choose exactly one original " + path.stem + ext +
                             " alongside the shapefile. Inspect ambiguous same-name datasets separately.")
                    for other in files:
                        other_path = Path(other["filename"])
                        if other_path.stem.casefold() == path.stem.casefold() and other_path.suffix.lower() in SIDECARS:
                            self._view(ws, view_root, other["original"], other["filename"])
                item["inspection"] = inspect_file(path, item["options"])
            except (ValueError, OSError, ImportError, UnicodeError, csv.Error) as error:
                item["error"] = {"code": type(error).__name__, "message": str(error)}
            record["files"] = deepcopy(files)
            atomic_json(directory / "operation.json", record)
        # Every selected original is retained, including unreadable inputs and sidecars.
        for item in files:
            self._raw(ws, item["original"])
        record["files"] = files

    def _commit(self, ws, directory, record, payload):
        inspection_id = identifier(payload["inspection_id"])
        inspection = self._load(ws, inspection_id)
        need(inspection["action"] == "client-source.inspect" and inspection["state"] == "complete",
             "Open a completed inspection of these original files.")
        selected = payload.get("selections")
        need(isinstance(selected, list) and selected, "Select at least one reviewed source.")
        checked = [checked_selection(item, inspection) for item in selected]
        identities = [(item[0]["file_index"], item[0]["part_index"], item[0]["role"]) for item in checked]
        need(len(set(identities)) == len(identities), "A worksheet, layer or band is selected twice with the same scientific role.")
        record["files"] = deepcopy(inspection["files"])
        record["inspection_id"] = inspection_id
        selection_path = directory / "reviewed-selection.json"
        selection_value = {"schema": "upstate.client-source-selection/v1",
                           "inspection_id": inspection_id, "inspection_sha256": digest(inspection),
                           "project_id": ws.project["id"], "title": record["title"],
                           "selections": [item[0] for item in checked],
                           "originals": [{"filename": f["filename"], "sha256": f["original"]["sha256"],
                                         "bytes": f["original"]["bytes"]} for f in inspection["files"]]}
        atomic_json(selection_path, selection_value, immutable=True)
        record["selection_file"] = describe_file(ws.root, selection_path)
        entries = []
        original_entries = []
        materialized = {}
        for index, item in enumerate(inspection["files"]):
            path = self._view(ws, directory / "originals" / str(index), item["original"], item["filename"])
            materialized[index] = path
            original_entries.append({"id": "original-" + str(index) + "-" + item["original"]["sha256"][:16],
                                     "title": item["filename"], "kind": "document", "role": "ORIGINAL_CLIENT_FILE",
                                     "uri": "urn:sha256:" + item["original"]["sha256"],
                                     "vintage": inspection["created_at"],
                                     **describe_file(directory, path),
                                     "client_source_original": True})
        manifest_checkpoint = directory / "sources.json"
        previous_manifest = read_json(manifest_checkpoint) if manifest_checkpoint.exists() else None
        for index, (choice, file, part) in enumerate(checked):
            path = materialized[choice["file_index"]]
            source_id = "client-" + digest({"inspection": inspection_id, "selection": choice})[:32]
            entry = {key: choice[key] for key in ("title", "uri", "vintage", "units", "role")}
            entry.update(id=source_id, kind=part["kind"], client_source={
                "inspection_id": inspection_id, "source_sha256": file["original"]["sha256"],
                "filename": file["filename"], "part_name": part["name"], "selection": choice})
            if part["kind"] == "table":
                if previous_manifest is None:
                    saved_preview = {"schema": "upstate.client-source-preview/v1",
                                     "source_sha256": file["original"]["sha256"],
                                     "format": file["inspection"]["format"],
                                     "options": deepcopy(file["options"]), "part": deepcopy(part)}
                else:
                    # Resume an already checkpointed edition with its original metadata.
                    previous_entry = next((item for item in previous_manifest["entries"]
                                           if item["id"] == source_id), {})
                    saved_preview = previous_entry.get("client_source", {}).get("inspection")
                if saved_preview is not None:
                    entry["client_source"]["inspection"] = deepcopy(saved_preview)
            companions = [describe_file(directory, selection_path)]
            companions.extend({key: row[key] for key in ("path", "bytes", "sha256")} for row in original_entries)
            if part["kind"] == "vector":
                entry["layer"] = part["layer"]
                entry["original_fields"] = part["fields"]
                # Re-create same-name original sidecars in this selected native view.
                if path.suffix.lower() == ".shp":
                    for other in inspection["files"]:
                        other_path = Path(other["filename"])
                        if other_path.stem.casefold() == path.stem.casefold() and other_path.suffix.lower() in SIDECARS:
                            companion = self._view(ws, path.parent, other["original"], other["filename"])
                            if companion != path:
                                companions.append(describe_file(directory, companion))
            elif part["kind"] == "raster":
                if choice["role"] != "CONTEXT" and (len(file["inspection"]["parts"]) > 1 or part["band"] != 1):
                    projected = directory / (source_id + ".tif")
                    projection_path = directory / (source_id + "-band.json")
                    if projection_path.exists():
                        projection = read_json(projection_path)
                        verify_file(directory, projection["file"])
                    else:
                        pending = directory / (source_id + "-pending.tif")
                        pending.unlink(missing_ok=True)
                        projected.unlink(missing_ok=True)
                        try:
                            detail = select_band(path, pending, part["band"])
                            os.replace(pending, projected)
                            projection = {**detail, "file": describe_file(directory, projected),
                                          "original_sha256": file["original"]["sha256"]}
                            atomic_json(projection_path, projection, immutable=True)
                        finally:
                            pending.unlink(missing_ok=True)
                    companions.append(describe_file(directory, projection_path))
                    path = projected
                    entry["band_projection"] = {"original_band": part["band"], "source_sha256": file["original"]["sha256"]}
                if choice.get("conversion"):
                    entry["conversion"] = choice["conversion"]
                entry["resampling"] = choice["resampling"]
                entry["resampling_review"] = "Reviewed here and applied by the original grid preparation; no resampling occurs during intake."
            elif part["kind"] == "table" and choice["role"] == "BIOPHYSICAL":
                projected = directory / (source_id + ".csv")
                projection_path = directory / (source_id + "-projection.json")
                if projection_path.exists():
                    projection = read_json(projection_path)
                    verify_file(directory, projection["file"])
                else:
                    projected.unlink(missing_ok=True)
                    detail = project_table(path, projected, choice, part, file["options"])
                    projection = {"schema": "upstate.client-table-projection/v1", **detail,
                                  "file": describe_file(directory, projected),
                                  "original_sha256": file["original"]["sha256"]}
                    atomic_json(projection_path, projection, immutable=True)
                path = projected
                entry["field_projection"] = projection
                companions.append(describe_file(directory, projection_path))
            elif part["kind"] == "table":
                entry["sheet"] = part.get("sheet")
                entry["original_fields"] = part["fields"]
            entry.update(describe_file(directory, path))
            unique = {}
            for companion in companions:
                if companion["path"] == entry["path"]:
                    continue
                previous = unique.setdefault(companion["path"], companion)
                need(previous == companion, "An original companion has conflicting identities.")
            entry["companions"] = list(unique.values())
            entries.append(entry)
        entries.extend(original_entries)
        entries.append({"id": "reviewed-source-selection", "title": "Reviewed source interpretation",
                        "uri": "urn:sha256:" + file_digest(selection_path), "vintage": inspection["created_at"],
                        "kind": "document", "role": "CLIENT_SOURCE_SELECTION",
                        **describe_file(directory, selection_path)})
        manifest_path = directory / "sources.json"
        manifest = {"schema": "upstate.sources/v1", "title": record["title"],
                    "captured_at": inspection["created_at"], "entries": entries,
                    "scope": {"client_source_intake": record["id"], "inspection_id": inspection_id},
                    "notes": ["Original files remain byte-for-byte retained. Scientific meanings and transformations are explicitly reviewed.",
                              "Measurement tables remain available for the existing Measurements importer; this intake does not normalize observations."]}
        atomic_json(manifest_path, manifest, immutable=True)
        record["manifest_file"] = describe_file(ws.root, manifest_path)
        collection = ws.import_sources(manifest_path)
        record["source_collection_id"] = collection["id"]
        record["source_ids"] = [item["id"] for item in entries[:len(checked)]]
        record["next_steps"] = [
            "Open this source edition to inspect and download every original.",
            "Choose Prepare study inputs when native preparation is needed.",
            "Choose the original grid/profile/run views, selecting this source edition and the reviewed scientific settings.",
            "For measurements, open Prepare workbook measurements and select the retained source, then review its saved preparation in Measurements.",
            "Save/export the complete Workspace and reopen it with the existing restore workflow."]
        for entry in collection["entries"]:
            self._raw(ws, entry["body"])
            for body in entry.get("companions", []):
                self._raw(ws, body)

