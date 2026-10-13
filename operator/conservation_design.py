"""Original task/read/download transport for editable Conservation designs."""
from __future__ import annotations

from pathlib import Path

from model import conservation_design as model
from model import conservation_design_editor as editor
from model.common import atomic_json, describe_file, held, identifier, verify_file
from model.reuse import copy_verified

ACTIONS = frozenset({"conservation.design.prepare", "conservation.design.receive",
                     "conservation.design.editor.open", "conservation.design.editor.write"})


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
        except editor.RevisionConflict as error:
            raise self.Fault("CONSERVATION_DESIGN_CONFLICT", str(error), 409) from error
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
        if operation == "editor":
            return self._call(editor.read, ws, value)
        if operation == "preparation":
            record = self._call(model.get_preparation, ws, self._one(value, "id"))
        elif operation == "receiving":
            record = self._call(model.get_receiving, ws, self._one(value, "id"))
        else:
            raise self.Fault("CONSERVATION_DESIGN_ROUTE", "Choose a retained design operation.", 404)
        return self._call(self._downloads, workspace_key, record)

    def _retain_upload(self, workspace, upload_id):
        upload = self.operator.upload(identifier(upload_id))
        if upload["bytes"] > model.MAX_BUNDLE_BYTES or upload["bytes"] <= 0:
            raise ValueError("Receive a complete original design input up to 100 MiB")
        original = Path(upload["path"])
        sha = identifier(upload["sha256"])
        filename = "original.json" if upload["mime_type"].split(";", 1)[0] == "application/json" else "original.zip"
        relative = "conservation-design/uploads/" + sha + "/" + filename
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
        return descriptor, {
            "id": upload["id"], "filename": upload["filename"],
            "bytes": upload["bytes"], "sha256": upload["sha256"],
            "file": descriptor, "receipt": describe_file(workspace.root, receipt_path)}

    def _receive(self, workspace, value):
        if "upload_id" not in value:
            return model.receive(workspace, value)
        if set(value) != {"upload_id"}:
            raise ValueError("Supply exactly the original upload_id for a browser handover")
        descriptor, receipt = self._retain_upload(workspace, value["upload_id"])
        result = model.receive(workspace, {"file": descriptor})
        return {**result, "operator_upload": receipt}

    def _editor_write(self, workspace, value, task_id):
        if set(value) - {"path", "upload_id", "expected_revision"}:
            raise ValueError("Supply the original editor path, retained upload and revision")
        selection = {key: value[key] for key in ("path", "expected_revision") if key in value}
        receipt = None
        if value.get("upload_id") is not None:
            selection["input"], receipt = self._retain_upload(workspace, value["upload_id"])
        result = editor.execute(workspace, selection, task_id)
        return {**result, "operator_upload": receipt} if receipt else result

    def editor_file(self, workspace_key, member_path):
        if member_path not in {"index.html", "app.js", "style.css", "transport.js"}:
            raise self.Fault("CONSERVATION_DESIGN_ROUTE", "Choose an original editor asset.", 404)
        workspace = self.operator.ws(workspace_key)
        files = self._call(editor.frame_assets, workspace)
        descriptor = files[member_path]
        path = verify_file(workspace.root, descriptor)
        ticket = self.operator._ticket(workspace_key, path, descriptor, member_path)
        policy = ("default-src 'self'; script-src 'self'; style-src 'self'; "
                  "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
                  "base-uri 'none'; form-action 'self'; frame-ancestors 'self'")
        return ticket, policy

    def invoke(self, task):
        value = task.get("payload")
        if not isinstance(value, dict):
            raise self.Fault("CONSERVATION_DESIGN_INPUT", "Supply the complete original design selection.")
        ws = self.operator.ws(task["workspace"])
        if task["action"] == "conservation.design.editor.open":
            if set(value) != {"preparation_id"}:
                raise self.Fault("CONSERVATION_DESIGN_INPUT", "Choose the original preparation.")
            return self._call(editor.execute, ws, {
                "operation": "open", "preparation_id": value["preparation_id"]}, task["id"])
        if task["action"] == "conservation.design.editor.write":
            return self._call(self._editor_write, ws, value, task["id"])
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
        if str(task.get("action", "")).startswith("conservation.design.editor."):
            value["_conservation_design_editor"] = {
                "id": result.get("id"), "workspace_id": result.get("workspace_id"),
                "project_id": result.get("response", {}).get("project", {}).get("id"),
            }
            return value
        value["_conservation"] = {
            **(task.get("_conservation") or {}),
            "plan_id": result.get("plan_id"), "study_id": result.get("study_id"),
        }
        value["_conservation_design"] = {
            "id": result.get("id"), "kind": result.get("kind"),
            "scenario_id": result.get("scenario_id"), "run_id": result.get("run_id"),
        }
        return value

    def verify_workspace(self, workspace):
        """Reopen the original retained designs after portable receiving."""
        from model import conservation_design as original_design
        summary = original_design.overview(workspace)
        preparations = [original_design.get_preparation(workspace, row["id"])
                        for row in summary["preparations"]]
        receivings = [original_design.get_receiving(workspace, row["id"])
                     for row in summary["receivings"]]
        return {
            "conservation_design_preparations": [row["id"] for row in preparations],
            "conservation_design_receivings": [row["id"] for row in receivings],
            "verified_count": len(preparations) + len(receivings),
        }
