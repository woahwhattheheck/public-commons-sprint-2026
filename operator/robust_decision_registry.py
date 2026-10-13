"""Robust decision studies in the original operator and extension registry.

The retained optimizer, study revisions and exchange format are owned by
model.robust_decisions.eco_robust. This facade binds their original operations
to the existing workspace, task admission, uploads and authenticated files.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tempfile

from model.common import identifier
from model.robust_decisions.eco_robust.integration import ACTION_NAMES, dispatch
from model.robust_decisions.eco_robust.operations import DecisionWorkspace

ACTIONS = frozenset(ACTION_NAMES)
_EXPORTS = frozenset({
    "robust.project.export", "robust.selection.export", "robust.report.export",
})


class RobustDecisions:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def _service(self, workspace_key):
        return DecisionWorkspace(self.operator.ws(workspace_key))

    def read(self, workspace_key, operation, payload):
        operation = operation or payload.get("operation", "list")
        service = self._service(workspace_key)
        service.recover()
        if operation == "list":
            return {"studies": service.store.list()}
        if operation == "study":
            revision = payload.get("revision")
            if revision not in (None, ""):
                revision = int(revision)
                if revision < 1:
                    raise ValueError("Choose a positive retained revision")
            else:
                revision = None
            study_id = payload.get("study_id")
            if not isinstance(study_id, str) or not study_id:
                raise ValueError("Choose an original retained decision study")
            return service.store.read(study_id, revision)
        if operation == "experiments":
            from model.experiments import list_experiments
            return {"experiments": list_experiments(self.operator.ws(workspace_key))}
        raise ValueError("Choose a saved study, its revision or an original experiment")

    def state(self, workspace_key):
        workspace = self.operator.ws(workspace_key)
        if not (workspace.root / "robust_decisions" / "robust_decisions.sqlite3").is_file():
            return {"studies": []}
        service = DecisionWorkspace(workspace)
        return {"studies": service.store.list()}

    def _payload(self, task):
        payload = task.get("payload", {})
        if not isinstance(payload, dict):
            raise ValueError("Decision parameters must be an object")
        if "payload_upload_id" not in payload:
            return payload
        if set(payload) != {"payload_upload_id"}:
            raise ValueError("Use the complete retained parameter upload by itself")
        upload = self.operator.upload(payload["payload_upload_id"])
        with Path(upload["path"]).open("r", encoding="utf-8-sig") as stream:
            value = json.load(stream)
        if not isinstance(value, dict):
            raise ValueError("The retained decision parameters must be a JSON object")
        return value

    def _save_export(self, task, value):
        action = task["action"]
        if action == "robust.report.export":
            filename = value["filename"]
            if filename not in {"decision-report.html", "decision-report.csv"}:
                raise ValueError("Choose an original decision report format")
            data = value["content"].encode("utf-8")
        else:
            filename = ("decision-project.json" if action == "robust.project.export"
                        else "implementation-selection.json")
            data = (json.dumps(value, ensure_ascii=False, allow_nan=False,
                               indent=2) + "\n").encode("utf-8")
        relative = Path("outputs/robust-decisions") / identifier(task["workspace"]) / identifier(task["id"]) / filename
        target = self.operator.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".decision-", dir=target.parent, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                if target.read_bytes() != data:
                    raise ValueError("Another retained decision export owns this task")
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return {"relative_path": relative.as_posix(), "filename": filename,
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise ValueError("Choose a registered robust decision operation")
        value = dispatch(self.operator.ws(task["workspace"]), task["action"], self._payload(task))
        if task["action"] in _EXPORTS:
            value = dict(value)
            value["_robust_export"] = self._save_export(task, value)
        return value

    def decorate_task(self, task):
        if task.get("action") not in _EXPORTS or task.get("state") != "complete":
            return task
        result = task.get("result", {})
        artifact = result.get("_robust_export")
        if artifact is None:
            return task
        allowed = (self.operator.root / "outputs/robust-decisions").resolve()
        target = (self.operator.root / artifact["relative_path"]).resolve(strict=True)
        if not target.is_relative_to(allowed) or not target.is_file():
            raise ValueError("Choose the retained original decision output")
        data = target.read_bytes()
        if len(data) != artifact["bytes"] or hashlib.sha256(data).hexdigest() != artifact["sha256"]:
            raise ValueError("The retained decision output changed")
        record = {key: artifact[key] for key in ("filename", "bytes", "sha256")}
        ticket = self.operator._ticket(task["workspace"], target, record, "Robust decision " + artifact["filename"])
        public = deepcopy(task)
        public["result"].pop("_robust_export", None)
        public["result"]["download_url"] = "/api/file/" + ticket["id"] + "?download=1"
        public["_downloads"] = list(public.get("_downloads", [])) + [ticket]
        return public


def verify_workspace(workspace):
    """Read the actual restored database and verify each complete saved study."""
    if not (workspace.root / "robust_decisions" / "robust_decisions.sqlite3").is_file():
        return {"studies": 0, "revisions": 0, "runs": 0}
    from model.robust_decisions.eco_robust.engine import canonical_hash
    from model.robust_decisions.eco_robust.schema import Study
    service = DecisionWorkspace(workspace)
    with service.store.connect() as db:
        checked = db.execute("PRAGMA quick_check").fetchall()
        if [row[0] for row in checked] != ["ok"]:
            raise ValueError("The received decision database is incomplete")
    counts = {"studies": 0, "revisions": 0, "runs": 0}
    for item in service.store.list():
        bundle = service.store.export(item["id"])
        value = bundle["payload"]
        if canonical_hash(value) != bundle["sha256"]:
            raise ValueError("The received study export changed")
        revisions = value["revisions"]
        if [row["revision"] for row in revisions] != list(range(1, item["head"] + 1)):
            raise ValueError("The received study needs its complete revision history")
        hashes = {}
        for revision in revisions:
            Study.model_validate(revision["input"])
            if (revision["study_id"] != item["id"] or
                    canonical_hash(revision["input"]) != revision["sha256"]):
                raise ValueError("A received decision revision changed its original inputs")
            hashes[revision["revision"]] = revision["sha256"]
        for run in value["runs"]:
            if run["study_id"] != item["id"] or run["revision"] not in hashes:
                raise ValueError("A received decision result lost its original revision")
            if run["result"] is not None and run["result"].get("study_sha256") != hashes[run["revision"]]:
                raise ValueError("A received decision result changed its input binding")
        counts["studies"] += 1
        counts["revisions"] += len(revisions)
        counts["runs"] += len(value["runs"])
    return counts


def create(operator, fault):
    return RobustDecisions(operator, fault)
