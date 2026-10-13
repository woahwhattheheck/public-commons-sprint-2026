"""Customer review operations composed with the original Workspace and operator.

Review records, response chains and packages remain model.reviews objects.  This
adapter binds them to the operator's existing task identities and file tickets.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import urllib.parse

from model.common import atomic_json, canonical, digest, file_digest, identifier, read_json
from model import reviews, review_handback, review_receiving

ACTIONS = frozenset({
    "customer.review.create", "customer.review.export", "customer.review.response.import",
    "customer.review.handback.save", "customer.review.handback.export", "customer.review.handback.import",
    "customer.review.packet.receive", "customer.review.packet.open",
})
READS = frozenset({"catalog", "review", "template", "compare", "spatial-export",
                   "handbacks", "handback", "handback-template", "packets", "packet"})
APPLICATION = Path(__file__).resolve().parents[1]
EXPORT_ACTIONS = frozenset({"customer.review.export", "customer.review.handback.export"})
PACKET_ACTIONS = frozenset({"customer.review.packet.receive", "customer.review.packet.open"})


class ReceivedExportUnavailable(Exception):
    """The proven sender-local export was not part of this restored project."""



class CustomerReviews:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _id(self, value, field):
        try:
            return identifier(value.get(field))
        except (ValueError, TypeError) as error:
            raise self.Fault("REVIEW_SELECTION", "Choose the retained " + field.replace("_", " ") + ".") from error

    def _json_ticket(self, workspace, value, filename, label):
        directory = self.operator.root / "outputs" / "customer-review-documents" / digest(value)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / filename
        atomic_json(target, value, immutable=True)
        return self.operator._ticket(workspace, target, {
            "bytes": target.stat().st_size, "sha256": file_digest(target), "filename": filename,
        }, label)

    def _issuer(self):
        path = APPLICATION / "source" / "acceptance" / "20261012" / "review-requirements.json"
        if not path.is_file():
            return None
        value = read_json(path)
        if value.get("schema") != "upstate.rfp-review-requirements/v1":
            raise ValueError("The retained issuer requirement profile has a different schema")
        return {
            "profile_id": value["profile_id"], "title": value["title"],
            "requirements": value["requirements"], "sha256": file_digest(path),
            "filename": path.name,
        }


    def _export_identity(self, task):
        """Return only task IDs bound to the unchanged original export request."""
        action, payload = task.get("action"), task.get("payload")
        operation = task.get("operation_id")
        if (action not in EXPORT_ACTIONS or not isinstance(payload, dict)
                or not isinstance(operation, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation)):
            raise ValueError("Open an original retained review export operation")
        workspace = identifier(task.get("workspace"))
        key = identifier(task.get("id"))
        if (key != digest({"workspace": workspace, "operation_id": operation})
                or task.get("request_sha256") != digest({
                    "workspace": workspace, "action": action, "payload": payload})):
            raise ValueError("The export differs from its original task selection")
        originals, origin = [], task.get("transfer_origin")
        while origin is not None:
            if not isinstance(origin, dict):
                raise ValueError("The export has an invalid retained transfer history")
            identifier(origin.get("transfer_id"))
            old_workspace = identifier(origin.get("workspace_key"))
            old_key = identifier(origin.get("task_id"))
            if (old_key != digest({"workspace": old_workspace, "operation_id": operation})
                    or origin.get("request_sha256") != digest({
                        "workspace": old_workspace, "action": action, "payload": payload})):
                raise ValueError("The export differs from its original transferred request")
            originals.append(old_key)
            origin = origin.get("previous")
        return originals

    def _export_selection(self, task, *, completed=False):
        originals = self._export_identity(task)
        ws, payload = self.operator.ws(task["workspace"]), task["payload"]
        if task["action"] == "customer.review.handback.export":
            handback_id = self._id(payload, "handback_id")
            record = ws._get(review_handback.KIND, handback_id)
            if record["project_id"] != ws.project["id"] or record["state"] != "ready":
                raise ValueError("Choose the retained ready engineering edition in this project")
            selected = {"handback_id": handback_id}
            pins = {key: record[key] for key in
                    ("review_id", "response_id", "revised_review_id")}
            pins["handback_id"] = handback_id
        else:
            review_id = self._id(payload, "review_id")
            record = ws._get("reviews", review_id)
            if record["project"] != ws.project:
                raise ValueError("The export belongs to another original scientific project")
            if "expected_response_id" not in payload:
                raise ValueError("The export needs its original selected response generation")
            expected = payload["expected_response_id"]
            if expected is not None:
                response = ws._get("review-responses", identifier(expected))
                if response["review_id"] != review_id or response["project_id"] != ws.project["id"]:
                    raise ValueError("The selected response belongs to another original review")
            selected = {"review_id": review_id, "expected_response_id": expected}
            pins = {"review_id": review_id, "latest_response_id": expected}
        if completed:
            if task.get("state") != "complete" or not isinstance(task.get("result"), dict):
                raise ValueError("Open a completed original export")
            result = task["result"]
            if result.get("project_id") != ws.project["id"] or any(result.get(k) != v for k, v in pins.items()):
                raise ValueError("The completed export differs from its original selected edition")
            identifier(result.get("package_sha256"))
        return selected, originals

    def _rebuild_source(self, task, selected):
        """Resolve the selected export through original multi-machine task aliases."""
        source_id = self._id(task["payload"], "source_export_task_id")
        source = None
        try:
            candidate = self.operator.task(source_id)
        except FileNotFoundError:
            candidate = None
        if candidate is not None and candidate.get("workspace") == task["workspace"]:
            source = candidate
        if source is None:
            matches = []
            for candidate in self.operator.task_list(task["workspace"]):
                if candidate.get("action") != task["action"] or candidate.get("state") != "complete":
                    continue
                origin = candidate.get("transfer_origin")
                while isinstance(origin, dict) and origin.get("task_id") != source_id:
                    origin = origin.get("previous")
                if isinstance(origin, dict) and source_id in self._export_identity(candidate):
                    matches.append(candidate)
            if len(matches) != 1:
                raise ValueError("Restore the original completed export task before rebuilding its selected edition")
            source = matches[0]
        if source["id"] == task["id"] or source.get("action") != task["action"]:
            raise ValueError("Choose a distinct completed export of this original review kind")
        original, _ = self._export_selection(source, completed=True)
        if selected != original:
            raise ValueError("The rebuild must retain the source export's exact original selection")
        # Check any locally retained package before offering a replacement.
        # A missing proven sender directory is expected; changed local files are not.
        try:
            self._export_manifest(source)
            original_archive = Path(source["result"]["archive"]["path"])
            if file_digest(original_archive) != source["result"]["archive"]["sha256"]:
                raise self.Fault("REVIEW_ARCHIVE_CHANGED", "The original review archive changed.", 409)
        except ReceivedExportUnavailable:
            pass
        return source

    @staticmethod
    def _absolute_export_path(value):
        if not isinstance(value, str) or "\\" in value or "\0" in value:
            raise ValueError("The export has an invalid original file path")
        path = PurePosixPath(value)
        if not path.is_absolute() or str(path) != value or ".." in path.parts:
            raise ValueError("The export has an invalid original file path")
        return Path(value)

    @staticmethod
    def _export_descriptor(value, path):
        if (not isinstance(value, dict) or value.get("path") != str(path)
                or type(value.get("bytes")) is not int or value["bytes"] < 0):
            raise ValueError("The export file differs from its original task inventory")
        identifier(value.get("sha256"))

    def _export_availability(self, task):
        selected, _ = self._export_selection(task, completed=True)
        try:
            self._export_manifest(task)
        except ReceivedExportUnavailable:
            return {
                "export_status": "rebuild_from_retained_review",
                "export_message": (
                    "This received project retains the original review and engineering records. "
                    "The sender's exported desk is unavailable on this computer. "
                    "Rebuild this exact selected edition here to open or download its package."),
                "rebuild": {"action": task["action"],
                            "payload": {**selected, "source_export_task_id": task["id"]}},
            }
        return {"export_status": "available", "desk_url": self._desk_url(task["id"])}

    def _listed_export_availability(self, task):
        try:
            return self._export_availability(task)
        except (self.Fault, OSError, ValueError, KeyError, TypeError) as error:
            # A damaged historical export must not hide other saved reviews.
            # Opening the task, serving its files or rebuilding still raises
            # the original error from the strict operations.
            return {"export_status": "error", "export_message": str(error)}

    def _exports(self, workspace, review_id=None):
        result = []
        for task in self.operator.task_list(workspace):
            if task["action"] != "customer.review.export" or task["state"] != "complete":
                continue
            value = task["result"]
            if review_id is not None and value["review_id"] != review_id:
                continue
            result.append({
                "task_id": task["id"], "review_id": value["review_id"],
                "created_at": task["created_at"], "completed_at": task.get("ended_at"),
                "latest_response_id": value["latest_response_id"],
                "package_sha256": value["package_sha256"], "members": value["members"],
                "archive_bytes": value["archive"]["bytes"],
                **self._listed_export_availability(task),
            })
        return result

    def _handback_exports(self, workspace, handback_id=None):
        result = []
        for task in self.operator.task_list(workspace):
            if task["action"] != "customer.review.handback.export" or task["state"] != "complete":
                continue
            value = task["result"]
            if handback_id is not None and value["handback_id"] != handback_id:
                continue
            result.append({
                "task_id": task["id"], "review_id": value["review_id"], "handback_id": value["handback_id"],
                "created_at": task["created_at"], "completed_at": task.get("ended_at"),
                "package_sha256": value["package_sha256"], "members": value["members"],
                "archive_bytes": value["archive"]["bytes"], **self._listed_export_availability(task),
            })
        return result

    @staticmethod
    def _desk_url(task_id, member="index.html"):
        return "/api/file/review-desk/" + task_id + "/" + urllib.parse.quote(member, safe="/")


    def _packet_root(self):
        return self.operator.root / "outputs" / "customer-review-packet-views"

    def _packet_identity(self, task, *, completed=False):
        action, payload = task.get("action"), task.get("payload")
        operation = task.get("operation_id")
        if (action not in PACKET_ACTIONS or not isinstance(payload, dict)
                or not isinstance(operation, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation)):
            raise ValueError("Choose an original received-review operation")
        workspace, key = identifier(task.get("workspace")), identifier(task.get("id"))
        if (key != digest({"workspace": workspace, "operation_id": operation})
                or task.get("request_sha256") != digest({
                    "workspace": workspace, "action": action, "payload": payload})):
            raise ValueError("The receiving operation differs from its original selection")
        origin = task.get("transfer_origin")
        while origin is not None:
            if not isinstance(origin, dict):
                raise ValueError("The receiving operation has an invalid transfer history")
            identifier(origin.get("transfer_id"))
            old_workspace = identifier(origin.get("workspace_key"))
            if (identifier(origin.get("task_id")) != digest({
                    "workspace": old_workspace, "operation_id": operation})
                    or origin.get("request_sha256") != digest({
                        "workspace": old_workspace, "action": action, "payload": payload})):
                raise ValueError("The received task differs from its original transferred request")
            origin = origin.get("previous")
        if action == "customer.review.packet.receive":
            if set(payload) - {"upload_id", "review_id"}:
                raise ValueError("Choose only the original review upload and optional review")
            self._id(payload, "upload_id")
            if "review_id" in payload:
                self._id(payload, "review_id")
        else:
            if set(payload) != {"receipt_id"}:
                raise ValueError("Choose one original received-review receipt")
            self._id(payload, "receipt_id")
        if not completed:
            return None
        if task.get("state") != "complete" or not isinstance(task.get("result"), dict):
            raise ValueError("Open a completed received-review operation")
        ws, result = self.operator.ws(workspace), task["result"]
        receipt = review_receiving.record(ws, self._id(result, "receipt_id"))
        if action == "customer.review.packet.receive":
            if (receipt["upload_id"] != payload["upload_id"]
                    or receipt["operation_id"] != operation
                    or receipt["received_at"] != task["created_at"]
                    or receipt["expected_review_id"] != payload.get("review_id")):
                raise ValueError("The saved receipt differs from its original receiving request")
        elif receipt["id"] != payload["receipt_id"]:
            raise ValueError("The local viewer opened another received package")
        if (result.get("review_id") != receipt["review_id"]
                or result.get("project_id") != ws.project["id"]
                or result.get("package_sha256") != receipt["package_sha256"]
                or result.get("incoming_response_id") != receipt["incoming_response_id"]):
            raise ValueError("The received result differs from its exact original edition")
        view, _ = review_receiving._view_record(ws, self._id(result, "view_id"))
        if view["receipt_id"] != receipt["id"]:
            raise ValueError("The local viewer belongs to another received package")
        return receipt

    def _packet_files(self, workspace, receipt_id, packet=None):
        ws = self.operator.ws(workspace)
        archive, row = review_receiving.archive_file(ws, receipt_id)
        if packet is None:
            _, inspected = review_receiving.inspect_received(ws, receipt_id)
            packet = inspected["packet"]
        return [
            self.operator._ticket(workspace, archive, row["archive"], "Complete original received review ZIP"),
            self._json_ticket(workspace, packet, "received-review.json",
                              "Complete received review and original response history"),
        ]

    def _packet_view(self, task):
        self._packet_identity(task, completed=True)
        root = self._packet_root()
        view_id = task["result"]["view_id"]
        # Only the whole missing local materialization is an ordinary transfer
        # omission. Missing members inside a present edition remain errors.
        directory = root / view_id
        try:
            directory.lstat()
        except FileNotFoundError:
            return None
        return review_receiving.view(self.operator.ws(task["workspace"]), view_id, root)

    def _packet_availability(self, workspace, receipt_id):
        candidates = [task for task in self.operator.task_list(workspace)
                      if task.get("action") in PACKET_ACTIONS and task.get("state") == "complete"
                      and task.get("result", {}).get("receipt_id") == receipt_id]
        errors = []
        for task in sorted(candidates, key=lambda item: (item.get("ended_at", ""), item["id"]), reverse=True):
            try:
                if self._packet_view(task) is not None:
                    return {"status": "available", "url": self._desk_url(task["id"])}
            except (self.Fault, OSError, ValueError, KeyError, TypeError) as error:
                errors.append(str(error))
        if errors:
            return {"status": "error", "message": errors[0]}
        return {"status": "open_on_this_computer",
                "message": "The original ZIP and its received edition are retained. "
                           "Open this package on this computer to recreate its local review desk."}

    def _receive_packet(self, task):
        self._packet_identity(task)
        ws, payload = self.operator.ws(task["workspace"]), task["payload"]
        if task["action"] == "customer.review.packet.receive":
            # A transferred or interrupted receive can finish from its already
            # retained original ZIP even when the sender-local upload is absent.
            saved = [review_receiving.record(ws, row["id"]) for row in ws._list(review_receiving.KIND)
                     if row.get("operation_id") == task["operation_id"]
                     and row.get("upload_id") == payload["upload_id"]
                     and row.get("received_at") == task["created_at"]]
            if len(saved) > 1:
                raise ValueError("This original receiving operation has multiple retained receipts")
            if saved:
                receipt = saved[0]
                if receipt["expected_review_id"] != payload.get("review_id"):
                    raise ValueError("The received task changed its original review selection")
                _, inspected = review_receiving.inspect_received(ws, receipt["id"])
                reviews.import_packet(ws, inspected["packet"])
            else:
                uploaded = self.operator.upload(payload["upload_id"])
                receipt, _ = review_receiving.receive(
                    ws, uploaded["path"], sha256=uploaded["sha256"], filename=uploaded["filename"],
                    upload_id=payload["upload_id"], operation_id=task["operation_id"],
                    received_at=task["created_at"], expected_review_id=payload.get("review_id"))
        else:
            receipt = review_receiving.record(ws, payload["receipt_id"])
        opened = review_receiving.open_view(ws, receipt["id"], self._packet_root())
        current = reviews.history(ws, receipt["review_id"])
        return {
            "receipt_id": receipt["id"], "view_id": opened["view"]["id"],
            "review_id": receipt["review_id"], "project_id": ws.project["id"],
            "package_sha256": receipt["package_sha256"],
            "incoming_response_id": receipt["incoming_response_id"],
            "current_latest_response_id": current[-1]["id"] if current else None,
            "members": receipt["members"], "archive_bytes": receipt["archive"]["bytes"],
        }

    def read(self, workspace, operation, value=None):
        value = value or {}
        ws = self.operator.ws(workspace)
        if operation == "packets":
            selected = self._id(value, "review_id") if value.get("review_id") else None
            return {"workspace_key": workspace, "project": ws.project, "review_id": selected,
                    "receipts": review_receiving.list_receipts(ws, selected)}
        if operation == "packet":
            receipt_id = self._id(value, "receipt_id")
            result = review_receiving.show(ws, receipt_id)
            packet = result.pop("packet")
            result["_downloads"] = self._packet_files(workspace, receipt_id, packet)
            result["_desk"] = self._packet_availability(workspace, receipt_id)
            return result
        if operation == "catalog":
            overview = ws.overview()
            def choice(row, kind):
                title = row.get("title") or row.get("selection", {}).get("title")
                if not title and kind == "runs":
                    title = "Native run " + row["id"][:12]
                return {
                    "id": row["id"], "title": title or row["id"][:12],
                    "created_at": row.get("created_at") or row.get("captured_at"),
                    "state": row.get("state", "retained"),
                    "entries": len(row.get("entries", [])),
                    "selection": row.get("selection", {}),
                }
            spatial_exports = []
            for row in overview.get("spatial_exports", []):
                if row.get("state") != "complete":
                    continue
                original = self.operator.spatial_exports[workspace].inspect(row["id"])
                spatial_exports.append({
                    **choice(original, "spatial_exports"),
                    "review_id": original["review_id"],
                    "files": len(original["files"]),
                    "bytes": sum(item["bytes"] for item in original["files"].values()),
                    "summary": original.get("summary", {}),
                })
            return {
                "workspace_key": workspace, "project": ws.project,
                "reviews": reviews.list_reviews(ws),
                "sources": [choice(row, "sources") for row in overview["sources"]],
                "runs": [choice(row, "runs") for row in overview["runs"] if row.get("state") == "complete"],
                "deliveries": [choice(row, "deliveries") for row in overview["deliveries"] if row.get("state") == "complete"],
                "spatial_exports": spatial_exports,
                "issuer": self._issuer(), "exports": self._exports(workspace),
            }
        if operation == "handbacks":
            review_id = self._id(value, "review_id")
            return {"review_id": review_id, "handbacks": review_handback.list_handbacks(ws, review_id)}
        if operation == "handback-template":
            kwargs = {name: self._id(value, name) for name in ("response_id", "handback_id") if value.get(name)}
            if "revised_review_id" in value and value["revised_review_id"] is not None:
                kwargs["revised_review_id"] = self._id(value, "revised_review_id") if value["revised_review_id"] else None
            return review_handback.template(ws, self._id(value, "review_id"), **kwargs)
        if operation == "handback":
            handback_id = self._id(value, "handback_id")
            result = review_handback.show(ws, handback_id)
            result["_exports"] = self._handback_exports(workspace, handback_id)
            result["_downloads"] = [self._json_ticket(workspace, result["handback"], "engineering-handback.json",
                                                        "Complete retained engineering edition")]
            return result
        if operation == "spatial-export":
            export_id = self._id(value, "export_id")
            result = self.operator.item(workspace, "spatial_exports", export_id)
            if result.get("state") != "complete":
                raise self.Fault("REVIEW_MAP_PENDING", "Choose a completed saved map export.", 409)
            return result
        if operation == "review":
            review_id = self._id(value, "review_id")
            packet = reviews.show_review(ws, review_id, previews=True)
            downloads = []
            for item in packet["review"]["artifacts"]:
                path, original = reviews.review_file(ws, review_id, item["id"])
                downloads.append({
                    **self.operator._ticket(workspace, path, {**original, "filename": PurePosixPath(item["original_path"]).name}, item["label"]),
                    "artifact_id": item["id"], "kind": item["kind"], "group": item["group"],
                    "role": item["role"], "media_type": item["media_type"],
                })
            packet["_downloads"] = downloads
            packet["_packet_download"] = self._json_ticket(
                workspace, {key: packet[key] for key in ("schema", "review", "responses", "latest_response_id", "files")},
                "review.json", "Complete retained review and response history")
            packet["_response_downloads"] = [{
                "response_id": record["id"],
                **self._json_ticket(workspace, record["response"], "response.json",
                                    "Response by " + record["response"]["reviewer"]["name"]),
            } for record in packet["responses"]]
            packet["_exports"] = self._exports(workspace, review_id)
            packet["_handbacks"] = review_handback.list_handbacks(ws, review_id)
            return packet
        if operation == "template":
            review_id = self._id(value, "review_id")
            template = reviews.response_template(ws, review_id)
            return {"response": template, "_download": self._json_ticket(
                workspace, template, "response-template.json", "Current response template")}
        if operation == "compare":
            before_id, after_id = self._id(value, "before_id"), self._id(value, "after_id")
            result = reviews.compare_reviews(ws, before_id, after_id)
            before = ws._get("reviews", before_id)
            after = ws._get("reviews", after_id)
            old = {item["id"]: item for item in before["requirements"]}
            new = {item["id"]: item for item in after["requirements"]}
            result["requirements"] = {
                "added": [new[key] for key in sorted(set(new) - set(old))],
                "removed": [old[key] for key in sorted(set(old) - set(new))],
                "changed": [{"before": old[key], "after": new[key]}
                            for key in sorted(set(old) & set(new)) if old[key] != new[key]],
                "unchanged": [new[key] for key in sorted(set(old) & set(new)) if old[key] == new[key]],
            }
            result["before"] = {key: before[key] for key in ("id", "title", "purpose", "selection")}
            result["after"] = {key: after[key] for key in ("id", "title", "purpose", "selection")}
            result["_download"] = self._json_ticket(workspace, result, "review-comparison.json",
                                                     "Complete selected review comparison")
            return result
        raise self.Fault("REVIEW_READ", "Choose a supported customer review view.", 404)

    def invoke(self, task):
        workspace, payload = task["workspace"], task["payload"]
        ws = self.operator.ws(workspace)
        action = task["action"]
        if action in PACKET_ACTIONS:
            return self._receive_packet(task)
        if action == "customer.review.handback.save":
            record = review_handback.save(ws, payload.get("handback"), created_at=task["created_at"])
            return {"review_id": record["review_id"], "handback_id": record["id"], "handback": record}
        if action == "customer.review.handback.export":
            return self._export_handback(task)
        if action == "customer.review.handback.import":
            uploaded = self.operator.upload(self._id(payload, "upload_id"))
            directory = self.operator.root / "outputs" / "customer-review-handback-imports" / task["id"]
            directory.mkdir(parents=True, exist_ok=True)
            desk = directory / "desk"
            if desk.exists():
                inspected = review_handback.inspect_packet(desk)
                incoming = review_handback.inspect_packet(uploaded["path"])
                if inspected["manifest"] != incoming["manifest"]:
                    raise ValueError("This receiving task retained a different original handback")
                joined = review_handback._join(ws, inspected)
                return {**review_handback.describe_export(desk), "joined": joined}
            return review_handback.receive_packet(uploaded["path"], desk, workspace=ws)
        if action == "customer.review.create":
            selection = payload.get("selection")
            record = reviews.create_review(ws, selection, created_at=task["created_at"])
            return {"review_id": record["id"], "review": record}
        if action == "customer.review.response.import":
            review_id = self._id(payload, "review_id")
            if ("upload_id" in payload) == ("response" in payload):
                raise ValueError("Choose one complete response document or its retained upload")
            if "upload_id" in payload:
                uploaded = self.operator.upload(self._id(payload, "upload_id"))
                response = reviews._read_json_file(Path(uploaded["path"]))
            else:
                response = payload["response"]
            if not isinstance(response, dict) or response.get("review_id") != review_id:
                raise ValueError("The returned response belongs to a different selected review")
            record = reviews.import_response(ws, response)
            return {"review_id": review_id, "response_id": record["id"], "record": record}
        if action == "customer.review.export":
            return self._export(task)
        raise self.Fault("REVIEW_ACTION", "Choose a supported customer review operation.")

    def _export(self, task):
        ws = self.operator.ws(task["workspace"])
        payload, (selected, origins) = task["payload"], self._export_selection(task)
        review_id, expected = selected["review_id"], selected["expected_response_id"]
        historical = bool(origins) or "source_export_task_id" in payload
        if "source_export_task_id" in payload:
            self._rebuild_source(task, selected)
        directory = self.operator.root / "outputs" / "customer-review-exports" / task["id"]
        directory.mkdir(parents=True, exist_ok=True)
        desk, archive = directory / "desk", directory / "review-desk.zip"
        if desk.exists():
            result = reviews.describe_export(desk)
        else:
            generation = ({"through_response_id": expected} if historical
                          else {"expected_response_id": expected})
            result = reviews.export_review(ws, review_id, desk, **generation)
        if (result["review_id"] != review_id or result["project_id"] != ws.project["id"]
                or result["latest_response_id"] != expected):
            raise self.Fault("REVIEW_EXPORT_GENERATION",
                             "This export belongs to another review or response generation.", 409)
        if not archive.exists():
            pending = archive.parent / (".review-archive-" + archive.name + ".pending")
            if pending.exists():
                # This task exclusively owns this original helper temporary.
                # All published review members remain in its inspected desk.
                pending.unlink()
            reviews.archive_packet(desk, archive)
        result = reviews.describe_export(desk, archive=archive)
        manifest_path = desk / "review-manifest.json"
        result["manifest"] = {"path": str(manifest_path), "bytes": manifest_path.stat().st_size,
                              "sha256": file_digest(manifest_path)}
        return result

    def _export_handback(self, task):
        ws = self.operator.ws(task["workspace"])
        selected, _ = self._export_selection(task)
        handback_id = selected["handback_id"]
        if "source_export_task_id" in task["payload"]:
            self._rebuild_source(task, selected)
        directory = self.operator.root / "outputs" / "customer-review-handbacks" / task["id"]
        directory.mkdir(parents=True, exist_ok=True)
        desk, archive = directory / "desk", directory / "engineering-handback.zip"
        if desk.exists():
            result = review_handback.describe_export(desk)
        else:
            result = review_handback.export_handback(ws, handback_id, desk)
        if result["handback_id"] != handback_id or result["project_id"] != ws.project["id"]:
            raise ValueError("This export belongs to a different original engineering edition")
        if not archive.exists():
            review_handback.archive_packet(desk, archive)
        result = review_handback.describe_export(desk, archive=archive)
        manifest = desk / review_handback.MANIFEST
        result["manifest"] = {"path": str(manifest), "bytes": manifest.stat().st_size, "sha256": file_digest(manifest)}
        return result

    def _export_manifest(self, task):
        if task["action"] not in EXPORT_ACTIONS or task["state"] != "complete":
            raise self.Fault("REVIEW_EXPORT_PENDING", "Open a completed review export.", 409)
        _, origins = self._export_selection(task, completed=True)
        result = task["result"]
        engineering = task["action"] == "customer.review.handback.export"
        family = "customer-review-handbacks" if engineering else "customer-review-exports"
        manifest_name = review_handback.MANIFEST if engineering else "review-manifest.json"
        archive_name = "engineering-handback.zip" if engineering else "review-desk.zip"
        directory = self._absolute_export_path(result["directory"])
        parts = directory.parts
        if (len(parts) < 5 or parts[-4:-2] != ("outputs", family)
                or parts[-1] != "desk" or parts[-2] not in [task["id"], *origins]):
            raise self.Fault("REVIEW_EXPORT_PATH", "The export is outside its original task directory.", 409)
        original_task_id = parts[-2]
        file, archive = directory / manifest_name, directory.parent / archive_name
        self._export_descriptor(result.get("manifest"), file)
        self._export_descriptor(result.get("archive"), archive)
        if result["archive"].get("package_sha256") != result["package_sha256"]:
            raise ValueError("The original archive describes a different review package")
        local_root = self.operator.root.absolute()
        expected = local_root / "outputs" / family / original_task_id / "desk"
        if directory != expected:
            if original_task_id in origins:
                # Never follow a sender's absolute path on the receiving computer.
                raise ReceivedExportUnavailable()
            raise self.Fault("REVIEW_EXPORT_PATH", "The export is outside this original operator.", 409)
        try:
            cursor = local_root
            for part in directory.relative_to(local_root).parts:
                cursor = cursor / part
                status = cursor.lstat()
                if not stat.S_ISDIR(status.st_mode):
                    raise self.Fault("REVIEW_EXPORT_PATH", "The original export directory changed.", 409)
        except FileNotFoundError:
            if original_task_id in origins:
                raise ReceivedExportUnavailable() from None
            raise
        file = reviews._regular(local_root, file.relative_to(local_root).as_posix())
        descriptor = result["manifest"]
        if file.stat().st_size != descriptor["bytes"] or file_digest(file) != descriptor["sha256"]:
            raise self.Fault("REVIEW_MANIFEST_CHANGED", "The original review export inventory changed.", 409)
        manifest = read_json(file)
        if engineering and manifest.get("handback_id") != result.get("handback_id"):
            raise self.Fault("REVIEW_EXPORT_CHANGED", "The retained engineering edition changed.", 409)
        if (manifest["package_sha256"] != result["package_sha256"]
                or manifest["review_id"] != result["review_id"]
                or manifest["project_id"] != result["project_id"]):
            raise self.Fault("REVIEW_EXPORT_CHANGED", "The retained review export identity changed.", 409)
        try:
            original_archive = reviews._regular(local_root, archive.relative_to(local_root).as_posix())
        except FileNotFoundError:
            if original_task_id in origins:
                # A transferred desk may have been copied without its ZIP.
                # Verify the complete present desk before treating that omission
                # as recoverable; missing or changed members remain errors.
                if engineering:
                    review_handback.describe_export(directory)
                else:
                    reviews.describe_export(directory)
                raise ReceivedExportUnavailable() from None
            raise
        if original_archive.stat().st_size != result["archive"]["bytes"]:
            raise self.Fault("REVIEW_ARCHIVE_CHANGED", "The original review archive changed.", 409)
        return directory, manifest

    def decorate_task(self, task):
        if task["action"] not in ACTIONS or task["state"] != "complete":
            return task
        result = task["result"]
        task["_review"] = {"review_id": result["review_id"]}
        if task["action"] in PACKET_ACTIONS:
            receipt = self._packet_identity(task, completed=True)
            task["_review"].update(kind="received-review", receipt_id=receipt["id"],
                                  incoming_response_id=receipt["incoming_response_id"])
            opened = self._packet_view(task)
            if opened is not None:
                task["_review"]["desk_url"] = self._desk_url(task["id"])
            task["_downloads"] = self._packet_files(task["workspace"], receipt["id"])
            return task
        if task["action"].startswith("customer.review.handback."):
            task["_review"].update(handback_id=result["handback_id"], kind="engineering-handback")
        if task["action"] in EXPORT_ACTIONS:
            availability = self._export_availability(task)
            task["_review"].update(availability, package_sha256=result["package_sha256"])
            if task["action"] == "customer.review.export":
                task["_review"]["latest_response_id"] = result["latest_response_id"]
            if availability["export_status"] != "available":
                task["_downloads"] = []
                return task
        if task["action"] == "customer.review.handback.export":
            directory, manifest = self._export_manifest(task)
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], result["archive"]["path"], result["archive"],
                                      "Complete engineering handback with both original review desks"),
                self.operator._ticket(task["workspace"], directory / "handback.json",
                                      manifest["members"]["handback.json"], "Complete engineering history"),
                self.operator._ticket(task["workspace"], directory / "request-resolutions.csv",
                                      manifest["members"]["request-resolutions.csv"], "All request resolutions"),
            ]
            task["_review"].update(desk_url=self._desk_url(task["id"]), package_sha256=result["package_sha256"])
        elif task["action"] in ("customer.review.handback.save", "customer.review.handback.import"):
            record = review_handback.show(self.operator.ws(task["workspace"]), result["handback_id"])["handback"]
            task["_downloads"] = [self._json_ticket(task["workspace"], record, "engineering-handback.json",
                                                    "Retained engineering response")]
        elif task["action"] == "customer.review.export":
            directory, manifest = self._export_manifest(task)
            files = [self.operator._ticket(task["workspace"], result["archive"]["path"],
                                            result["archive"], "Complete offline review desk")]
            for name, label in (("review.json", "Complete selected review and history"),
                                ("response-template.json", "Current response template")):
                files.append(self.operator._ticket(task["workspace"], directory / name,
                                                    manifest["members"][name], label))
            files.append(self.operator._ticket(task["workspace"], result["manifest"]["path"],
                                                result["manifest"], "Original review file inventory"))
            task["_downloads"] = files
            task["_review"].update(desk_url=self._desk_url(task["id"]),
                                   latest_response_id=result["latest_response_id"],
                                   package_sha256=result["package_sha256"])
        elif task["action"] == "customer.review.response.import":
            task["_downloads"] = [self._json_ticket(task["workspace"], result["record"]["response"],
                                                     "response.json", "Retained customer response")]
        return task

    def desk_member(self, task_id, member):
        task = self.operator.task(identifier(task_id))
        received = task["action"] in PACKET_ACTIONS
        opened = None
        if received:
            opened = self._packet_view(task)
            if opened is None:
                raise self.Fault("REVIEW_PACKET_RECEIVED",
                                 "Open the received package on this computer first.", 409)
            directory, manifest = opened["directory"], opened["manifest"]
        else:
            try:
                directory, manifest = self._export_manifest(task)
            except ReceivedExportUnavailable as error:
                raise self.Fault("REVIEW_EXPORT_RECEIVED",
                                 "Open the retained review and rebuild this export on this computer.", 409) from error
        relative = PurePosixPath(member)
        if ("\\" in member or "\0" in member or relative.is_absolute()
                or str(relative) != member or any(part in (".", "..") for part in relative.parts)):
            raise self.Fault("REVIEW_MEMBER", "Choose an original review package member.", 404)
        if member == (review_handback.MANIFEST if task["action"] == "customer.review.handback.export" else "review-manifest.json"):
            descriptor = opened["receipt"]["original_manifest"] if received else task["result"]["manifest"]
        else:
            descriptor = manifest["members"].get(member)
        if descriptor is None:
            raise self.Fault("REVIEW_MEMBER", "This file is outside the selected review package.", 404)
        path = directory.joinpath(*relative.parts)
        if received and member == "index.html":
            # Execute only the installed application generated from checked
            # packet data. The sender's HTML remains untouched in the ZIP.
            directory = opened["scope"]
            path = opened["native_index"]
            descriptor = opened["view"]["native_index"]
        if not path.resolve().is_relative_to(directory.resolve()) or path.is_symlink():
            raise self.Fault("REVIEW_MEMBER_CHANGED", "The original review package member changed.", 409)
        ticket = self.operator._ticket(task["workspace"], path, descriptor, path.name)
        policy = None
        engineering_desk = (task["action"] == "customer.review.handback.export"
                            and re.fullmatch(r"reviews/[0-9a-f]{64}/(?:[0-9a-f]{64}|original)/index\.html", member))
        if member == "index.html" or engineering_desk:
            # Only the original exporter-created application gets executable
            # scripts.  Arbitrary selected HTML retains the normal file sandbox.
            content = path.read_bytes()
            if len(content) != descriptor["bytes"] or hashlib.sha256(content).hexdigest() != descriptor["sha256"]:
                raise self.Fault("REVIEW_APPLICATION_CHANGED", "The original review application changed.", 409)
            scripts = re.findall(r"<script\b[^>]*>(.*?)</script>", content.decode("utf-8"), re.S | re.I)
            hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii") + "'"
                      for script in scripts]
            policy = ("default-src 'none'; script-src " + " ".join(hashes)
                      + "; style-src 'unsafe-inline'; img-src 'self' data: blob:; "
                      "object-src 'self'; frame-src 'self'; connect-src 'none'; "
                      "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
        return ticket, policy
