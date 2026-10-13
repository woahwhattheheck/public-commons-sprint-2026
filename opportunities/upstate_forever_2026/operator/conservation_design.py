"""Original task/read/download transport for editable Conservation designs."""
from __future__ import annotations

from pathlib import Path

from model import conservation_design as model
from model.common import atomic_json, describe_file, held, identifier, verify_file
from model.reuse import copy_verified

ACTIONS = frozenset({"conservation.design.prepare", "conservation.design.receive"})


class ConservationDesign:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    @staticmethod
    def _one(value, key):
        result = value.get(key)
        if isinstance(result, list):
            if len(result) != 1:
                raise ValueError("Choose one " + key)
            return result[0]
        return result

    def _call(self, function, *args):
        try:
            return function(*args)
        except FileNotFoundError as error:
            raise self.Fault("CONSERVATION_DESIGN_MISSING", str(error), 404) from error
        except (ValueError, TypeError, KeyError) as error:
            raise self.Fault("CONSERVATION_DESIGN_INPUT", str(error)) from error

    def _downloads(self, workspace_key, record):
        ws = self.operator.ws(workspace_key)
        record = dict(record)
        downloads = []
        labels = {"binding": "Original saved-plan binding",
                  "project": "Complete editable project JSON",
                  "editable_project": "Complete editable project ZIP",
                  "handover": "Original edited native handover ZIP",
                  "native-receipt.json": "Original native scenario receipt",
                  "design.geojson": "Complete edited geometry",
                  "sources.json": "Original native source manifest"}
        for name, descriptor in record.get("files", {}).items():
            path = verify_file(ws.root, descriptor)
            downloads.append(self.operator._ticket(
                workspace_key, path, descriptor, labels.get(name, name)))
        record["_downloads"] = downloads
        return record

    def read(self, workspace_key, operation, payload=None):
        value = payload or {}
        if not isinstance(value, dict):
            raise self.Fault("CONSERVATION_DESIGN_INPUT", "Supply a design operation selection.")
        ws = self.operator.ws(workspace_key)
        if operation == "overview":
            return self._call(model.overview, ws)
        if operation == "preparation":
            record = self._call(model.get_preparation, ws, self._one(value, "id"))
        elif operation == "receiving":
            record = self._call(model.get_receiving, ws, self._one(value, "id"))
        else:
            raise self.Fault("CONSERVATION_DESIGN_ROUTE", "Choose a retained design operation.", 404)
        return self._call(self._downloads, workspace_key, record)

    def _receive(self, workspace, value):
        if "upload_id" not in value:
            return model.receive(workspace, value)
        if set(value) != {"upload_id"}:
            raise ValueError("Supply exactly the original upload_id for a browser handover")
        upload = self.operator.upload(identifier(value["upload_id"]))
        if upload["bytes"] > model.MAX_BUNDLE_BYTES or upload["bytes"] <= 0:
            raise ValueError("Receive a complete original design ZIP up to 100 MiB")
        original = Path(upload["path"])
        sha = identifier(upload["sha256"])
        relative = "conservation-design/uploads/" + sha + "/original.zip"
        directory = workspace.root / "conservation-design" / "uploads" / sha
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".upload.lock", blocking=False):
            descriptor = copy_verified(
                original.parent,
                {"path": original.name, "sha256": upload["sha256"], "bytes": upload["bytes"]},
                workspace.root, path=relative)
            receipt = {key: upload[key] for key in
                       ("id", "filename", "mime_type", "bytes", "sha256", "object")}
            receipt["workspace_file"] = descriptor
            receipt_path = directory / (identifier(upload["id"]) + ".json")
            atomic_json(receipt_path, receipt, immutable=True)
        result = model.receive(workspace, {"file": descriptor})
        return {**result, "operator_upload": {
            "id": upload["id"], "filename": upload["filename"],
            "bytes": upload["bytes"], "sha256": upload["sha256"],
            "file": descriptor, "receipt": describe_file(workspace.root, receipt_path)}}

    def invoke(self, task):
        value = task.get("payload")
        if not isinstance(value, dict):
            raise self.Fault("CONSERVATION_DESIGN_INPUT", "Supply the complete original design selection.")
        ws = self.operator.ws(task["workspace"])
        if task["action"] == "conservation.design.prepare":
            return self._call(model.prepare, ws, value)
        if task["action"] == "conservation.design.receive":
            return self._call(self._receive, ws, value)
        raise self.Fault("CONSERVATION_DESIGN_ACTION", "Choose a supported design operation.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        value = dict(task)
        result = task["result"]
        record = self._downloads(task["workspace"], result)
        value["_downloads"] = list(task.get("_downloads") or []) + record["_downloads"]
        value["_conservation"] = {
            **(task.get("_conservation") or {}),
            "plan_id": result.get("plan_id"), "study_id": result.get("study_id"),
        }
        value["_conservation_design"] = {
            "id": result.get("id"), "kind": result.get("kind"),
            "scenario_id": result.get("scenario_id"), "run_id": result.get("run_id"),
        }
        return value
