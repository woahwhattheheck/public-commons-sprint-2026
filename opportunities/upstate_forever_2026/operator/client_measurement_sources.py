"""Retained worksheets to the existing queued Measurements preparation workflow."""
from __future__ import annotations
import base64
from copy import deepcopy
import json
from pathlib import Path

from model.common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                          held, identifier, now, read_json, verify_file)
from model.client_source_files import need, text
from model.client_measurement_sources import (project_worksheet, preparation_value, checked_request,
                                               identifier_columns)
from client_source_intake import ClientSourceIntake

ACTION = "client-measurement.prepare"
SCHEMA = "upstate.client-measurement-preparation/v1"


class ClientMeasurementSources:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.sources = ClientSourceIntake(operator, fault)

    @staticmethod
    def directory(ws, key):
        return ws.root / "client-measurement-sources" / identifier(key)

    def _rpc(self, workspace_key, method, path, payload=None):
        value = self.operator.extensions.read("POST", "/api/measurements/rpc", workspace_key,
            {"method": method, "path": path, "payload": payload})
        need(isinstance(value, dict) and isinstance(value.get("status"), int),
             "The original Measurements provider did not return its result.")
        body = json.loads(value["body"])
        if value["status"] >= 400:
            raise ValueError("Measurements: " + str(body.get("error", body)))
        return body

    def _selected(self, ws, payload):
        collection = identifier(payload["source_collection_id"])
        source_id = text(payload["source_id"], "retained source", True)
        source, entry = ws.source_file(collection, source_id)
        bound = entry.get("client_source", {})
        need(entry.get("kind") == "table" and entry.get("role") == "MEASUREMENTS"
             and isinstance(bound, dict) and bound and not entry.get("field_projection"),
             "Choose a saved original table reviewed for Measurements.")
        key = identifier(bound["inspection_id"])
        choice = bound.get("selection")
        need(isinstance(choice, dict) and choice.get("role") == "MEASUREMENTS",
             "Keep the original reviewed measurement role.")
        need(all(type(choice.get(name)) is int and choice[name] >= 0
                 for name in ("file_index", "part_index")),
             "Retain the original reviewed file and worksheet positions.")
        saved = bound.get("inspection")
        if saved is not None:
            # The immutable source edition carries its actual selected native
            # inspection through a source-only Study. Do not manufacture or
            # require a producer operation directory in the receiving Workspace.
            from model.client_source_inspection_report import retained_table_preview
            preview = retained_table_preview(ws, entry)
            need(preview is not None, "Retain the original native worksheet evidence.")
            part = saved["part"]
            item = {"filename": bound["filename"],
                    "original": {"sha256": entry["body"]["sha256"],
                                 "bytes": entry["body"]["bytes"]},
                    "options": deepcopy(saved["options"])}
            # Downstream lineage uses the retained original identity only.
            inspection = {"id": key}
        else:
            # Earlier editions retain their exact original inspection record in
            # the maintained Study closure; its complete validation is unchanged.
            inspection = self.sources._load(ws, key)
            need(inspection["state"] == "complete" and inspection["action"] == "client-source.inspect",
                 "The complete original file inspection is unavailable.")
            fi, pi = choice["file_index"], choice["part_index"]
            need(fi < len(inspection["files"]),
                 "The retained source has no matching original file position.")
            item = inspection["files"][fi]
            parts = item.get("inspection", {}).get("parts", [])
            need(pi < len(parts), "The retained source has no matching original worksheet position.")
            part = parts[pi]
        need(part["kind"] == "table" and not part.get("error") and
             entry.get("sheet") == part.get("sheet") and
             part.get("header_row") == item["options"].get("header_row") and
             item["original"]["sha256"] == bound["source_sha256"] == entry["body"]["sha256"] and
             item["filename"] == bound["filename"] and part["name"] == bound["part_name"],
             "The retained worksheet differs from its original reviewed selection.")
        need(source.stat().st_size == item["original"]["bytes"] and
             file_digest(source) == item["original"]["sha256"], "The complete original source changed.")
        return source, entry, inspection, item, part

    def _verify(self, ws, record, *, complete=False):
        need(record.get("schema") == SCHEMA and record["project_id"] == ws.project["id"],
             "This preparation belongs to another original project.")
        source, entry, inspection, item, part = self._selected(ws, record["selection"])
        need(record["original"] == {k: item["original"][k] for k in ("sha256", "bytes")} |
             {"filename": item["filename"]}, "The retained preparation original changed.")
        for key in ("projection_file", "lineage_file", "request_file", "preparation_file"):
            if record.get(key):
                verify_file(ws.root, record[key])
        if complete:
            need(all(record.get(k) for k in ("projection_file", "lineage_file", "request_file",
                                             "preparation_file", "preparation_id", "target_workspace_id")),
                 "The complete preparation is missing its original outputs.")
            request = read_json(verify_file(ws.root, record["request_file"]))
            saved = read_json(verify_file(ws.root, record["preparation_file"]))
            self._check_packet(record, request, saved)
        return record

    @staticmethod
    def _check_packet(record, request, packet):
        need(packet["workspaceId"] == record["target_workspace_id"],
             "The original Measurements workspace changed.")
        need(request["value"]["lineage"].get("identifier_formatting", {}).get("columns", []) ==
             record.get("identifier_columns", []), "The retained identifier-column choice changed.")
        edition = next((e for e in packet["editions"]
                        if e["id"] == record["preparation_id"] and e["revision"] == 1), None)
        need(edition is not None and edition["value"] == request["value"],
             "The original saved preparation edition differs from this operation.")
        source = next((s for s in packet["sources"] if s["sha"] == request["value"]["sourceSha"]), None)
        need(source is not None and source["text"] == request["text"], "The retained worksheet projection changed.")
        original = next((f for f in packet.get("originals", []) if f["sha256"] == record["original"]["sha256"]), None)
        need(original is not None and original == request["originals"][0],
             "The original workbook is absent from the complete saved preparation.")
        return packet

    def _load(self, ws, key):
        value = read_json(self.directory(ws, key) / "operation.json")
        need(value["id"] == key, "Keep the original preparation operation.")
        return self._verify(ws, value, complete=value.get("state") == "complete")

    def _downloads(self, workspace_key, ws, value):
        files = [(self.directory(ws, value["id"]) / "operation.json", "Complete preparation operation")]
        source, entry, *_ = self._selected(ws, value["selection"])
        files.append((source, "Original: " + value["original"]["filename"]))
        for key, label in (("projection_file", "Selected worksheet CSV"),
                           ("lineage_file", "Original worksheet row and column map"),
                           ("preparation_file", "Complete saved Measurements preparation")):
            if value.get(key):
                files.append((verify_file(ws.root, value[key]), label))
        return [self.operator._ticket(workspace_key, path, describe_file(ws.root, path), label)
                for path, label in files]

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            entries, seen = [], set()
            # Source collections are the maintained scientific editions. A
            # selected Study carries them without the producer's commit queue.
            for collection in ws._list("sources"):
                for entry in collection["entries"]:
                    key = (collection["id"], entry["id"])
                    if entry.get("kind") != "table" or entry.get("role") != "MEASUREMENTS" or not entry.get("client_source") or entry.get("field_projection") or key in seen:
                        continue
                    seen.add(key)
                    preview = entry["client_source"].get("inspection")
                    if preview is None:
                        _, _, _, item, part = self._selected(ws, {
                            "source_collection_id": collection["id"], "source_id": entry["id"]})
                        preview = {"format": item["inspection"]["format"], "part": part}
                    entries.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                    "title": entry["title"], "sheet": entry.get("sheet"),
                                    "filename": entry["client_source"]["filename"],
                                    "format": preview["format"],
                                    "fields": deepcopy(preview["part"].get("fields", [])),
                                    "preview": deepcopy(preview["part"].get("rows", [])[:3]),
                                    "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"]})
            operations = []
            for path in sorted((ws.root / "client-measurement-sources").glob("*/operation.json")):
                row = read_json(path)
                if row.get("project_id") == ws.project["id"]:
                    operations.append({k: row.get(k) for k in ("id", "title", "state", "preparation_id", "error")})
            target = self._rpc(workspace_key, "GET", "/intake")
            return {"project_id": ws.project["id"], "sources": entries, "operations": operations,
                    "target_workspace_id": target["workspaceId"]}
        need(operation == "result", "Choose a retained Measurements preparation.")
        value = deepcopy(self._load(ws, identifier(payload["id"])))
        value["_downloads"] = self._downloads(workspace_key, ws, value)
        return value

    def decorate_task(self, task):
        if task.get("action") == ACTION:
            ws = self.operator.ws(task["workspace"])
            path = self.directory(ws, task["id"]) / "operation.json"
            if path.exists():
                value = read_json(path)
                task["_measurement_preparation"] = {k: value.get(k) for k in
                                                    ("id", "state", "preparation_id", "title", "error")}
                task.setdefault("_downloads", []).extend(self._downloads(task["workspace"], ws, value))
        return task

    def verify_workspace(self, workspace):
        # Local semantic verification only: restore does not start another service.
        for path in (workspace.root / "client-measurement-sources").glob("*/operation.json"):
            self._load(workspace, path.parent.name)
        return True

    def invoke(self, task):
        need(task["action"] == ACTION, "Choose an original worksheet preparation.")
        ws = self.operator.ws(task["workspace"])
        identifiers = identifier_columns(task["payload"].get("identifier_columns"))
        directory = self.directory(ws, task["id"])
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "operation.json"
        with held(directory / ".operation.lock", blocking=False):
            if path.exists():
                record = self._load(ws, task["id"])
                need(record["request_sha256"] == task["request_sha256"],
                     "Keep the exact original worksheet preparation request.")
            else:
                payload = task["payload"]
                source, entry, inspection, item, part = self._selected(ws, payload)
                record = {"schema": SCHEMA, "id": task["id"], "project_id": ws.project["id"],
                          "action": ACTION, "request_sha256": task["request_sha256"],
                          "title": text(payload["label"], "preparation name", True),
                          "selection": {k: payload[k] for k in ("source_collection_id", "source_id")},
                          "original": {k: item["original"][k] for k in ("sha256", "bytes")} |
                                      {"filename": item["filename"]},
                          "target_workspace_id": text(payload["target_workspace_id"], "Measurements workspace", True),
                          "preparation_id": "source-" + task["id"], "created_at": now(), "state": "working"}
                if identifiers:
                    record["identifier_columns"] = identifiers
                atomic_json(path, record)
            need(record.get("identifier_columns", []) == identifiers,
                 "Keep the exact original identifier-column choice.")
            try:
                target = self._rpc(task["workspace"], "GET", "/intake")
                need(target["workspaceId"] == record["target_workspace_id"],
                     "The selected Measurements workspace changed. Retain this request and choose its original workspace.")
                if record["state"] == "complete":
                    request = read_json(verify_file(ws.root, record["request_file"]))
                    packet = self._rpc(task["workspace"], "GET", "/intake/" + record["preparation_id"] + "/export")
                    self._check_packet(record, request, packet)
                    return record
                source, entry, inspection, item, part = self._selected(ws, record["selection"])
                request_path = directory / "native-request.json"
                if request_path.exists():
                    request = read_json(request_path)
                else:
                    projected = project_worksheet(source, sheet=part.get("sheet"), reading=item["options"],
                        original=record["original"], project_id=ws.project["id"],
                        source_collection_id=record["selection"]["source_collection_id"],
                        source_id=record["selection"]["source_id"], inspection_id=inspection["id"],
                        identifier_fields=identifiers)
                    payload = task["payload"]
                    value = preparation_value(projected, kind=payload["kind"], label=payload["label"],
                        reviewer=payload["reviewer"], note=payload.get("note", ""), context=payload.get("context", ""))
                    binary = source.read_bytes()
                    need(len(binary) == record["original"]["bytes"] and file_digest(source) == record["original"]["sha256"],
                         "The original workbook changed before complete native receiving.")
                    request = {"id": record["preparation_id"], "expectedRevision": 0, "value": value,
                               "text": projected["text"], "originals": [{
                                   "sha256": record["original"]["sha256"], "bytes": len(binary),
                                   "data": base64.b64encode(binary).decode("ascii")}]}
                    checked_request(request)
                    atomic_bytes(directory / "worksheet.csv", projected["text"].encode("utf-8"), immutable=True)
                    atomic_json(directory / "worksheet-lineage.json", projected["lineage"], immutable=True)
                    atomic_json(request_path, request, immutable=True)
                need(request["id"] == record["preparation_id"] and request["expectedRevision"] == 0 and
                     request["value"]["lineage"]["original"] == record["original"] and
                     request["value"]["lineage"]["project_id"] == ws.project["id"] and
                     request["value"]["lineage"]["source_collection_id"] == record["selection"]["source_collection_id"] and
                     request["value"]["lineage"]["source_id"] == record["selection"]["source_id"] and
                     request["value"]["kind"] == task["payload"]["kind"] and
                     request["value"]["label"] == task["payload"]["label"] and
                     request["value"]["reviewer"] == task["payload"]["reviewer"] and
                     request["value"]["note"] == task["payload"].get("note", "") and
                     request["value"]["context"] == task["payload"].get("context", "") and
                     request["value"]["lineage"].get("identifier_formatting", {}).get("columns", []) == identifiers,
                     "The retained native preparation request differs from its original selection.")
                need((directory / "worksheet.csv").read_bytes().decode("utf-8") == request["text"] and
                     read_json(directory / "worksheet-lineage.json") == request["value"]["lineage"],
                     "The retained worksheet or physical row map changed.")
                checked_request(request)
                record["projection_file"] = describe_file(ws.root, directory / "worksheet.csv")
                record["lineage_file"] = describe_file(ws.root, directory / "worksheet-lineage.json")
                record["request_file"] = describe_file(ws.root, request_path)
                atomic_json(path, record)
                # Replaying the exact expectedRevision=0 request recovers the original
                # first edition even if another view has since saved later editions.
                saved = self._rpc(task["workspace"], "PUT", "/intake/" + record["preparation_id"], request)
                need(saved["id"] == record["preparation_id"] and saved["revision"] == 1 and
                     saved["value"] == request["value"], "The native original preparation receipt differs.")
                packet = self._rpc(task["workspace"], "GET", "/intake/" + record["preparation_id"] + "/export")
                self._check_packet(record, request, packet)
                prepared_path = directory / "measurement-preparation.json"
                if not prepared_path.exists():
                    atomic_json(prepared_path, packet, immutable=True)
                else:
                    self._check_packet(record, request, read_json(prepared_path))
                record["preparation_file"] = describe_file(ws.root, prepared_path)
                self._verify(ws, record, complete=True)
                record["state"] = "complete"
                record.pop("error", None)
                record["completed_at"] = now()
                atomic_json(path, record)
                return self._load(ws, task["id"])
            except BaseException as error:
                record["state"] = "failed"
                record["error"] = {"code": type(error).__name__, "message": str(error)}
                atomic_json(path, record)
                raise
