"""One command surface for the browser, CLI and original native receiving programme."""
from __future__ import annotations
from pathlib import Path
import uuid

from . import deployment, native, programme
from .editions import create_changed_edition, import_edition, save_review
from .util import require
from .workspace import compare_receiving, inspect_archive, receive_archive

class Controller:
    def __init__(self, workspace, source_root):
        self.workspace = workspace
        self.source_root = Path(source_root).resolve()

    def call(self, action, data=None):
        data = data or {}
        require(isinstance(data, dict), "Command data must be an object.")
        ws = self.workspace
        if action == "workspace.state":
            return {**ws.summary(), "root": str(ws.root)}
        if action == "workspace.verify":
            return ws.verify()
        if action == "edition.import":
            return import_edition(ws, data["directory"], data.get("name"))
        if action == "edition.change":
            destination = data.get("directory") or str(ws.root / "changed-editions" / uuid.uuid4().hex)
            return create_changed_edition(ws, data["edition"], destination, data["changes"], data["name"])
        if action == "configuration.review":
            return save_review(ws, data["edition"], data["decisions"], data["note"], data.get("expected"))
        if action == "native.prepare":
            return native.prepare(ws, data["edition"], data["binary"], data.get("name"), data.get("environment_names"))
        if action == "native.start":
            return native.start(ws, data["deployment"], self.source_root)
        if action == "native.status":
            return native.status(ws, data["deployment"])
        if action == "native.stop":
            return native.stop(ws, data["deployment"])
        if action == "native.reconcile":
            return native.reconcile(ws, data["deployment"])
        if action == "programme.run":
            return programme.run(ws, data["deployment"], data.get("run_id"), data.get("name"))
        if action == "programme.compare":
            return programme.compare(ws, data["baseline"], data["candidate"])
        if action == "programme.review":
            return programme.review(ws, data["programme"], data["decisions"], data["note"], data.get("expected"))
        if action == "deployment.cutover":
            return deployment.activate(ws, data["deployment"], data["programme"], data["note"], data.get("expected"))
        if action == "deployment.rollback":
            return deployment.rollback(ws, data["deployment"], data["programme"], data["note"], data.get("expected"))
        if action == "delivery.export":
            destination = data.get("destination") or str(ws.root / "deliveries" / ("Hive_Complete_Workspace_" + uuid.uuid4().hex[:10] + ".zip"))
            return ws.export(destination, self.source_root)
        if action == "delivery.inspect":
            return inspect_archive(data["archive"])
        if action == "delivery.compare":
            return compare_receiving(data["archive"], ws)
        if action == "delivery.receive":
            return receive_archive(data["archive"], data["destination"])
        raise ValueError("Unknown Hive workspace command: " + str(action))
