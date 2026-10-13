"""Sample QC in the original Implementation desk, queue and retained report bank."""
from __future__ import annotations
from pathlib import Path
import re

from implementation_operator import ImplementationOperator
from model import implementation_qc as qc
from model import implementation_qc_actions as qca
from model import implementation_qc_comparison as qcc
from model.implementation_schema import ImplementationError
from model.common import digest

ACTIONS = {
    "comparison-save": "implementation.qc.comparison.save",
    "comparison-source": "implementation.qc.comparison.source",
    "comparison-export": "implementation.qc.comparison.export",
    "save": "implementation.qc.save",
    "source": "implementation.qc.source",
    "export": "implementation.qc.export",
    "actions-save": "implementation.qc.actions.save",
    "actions-source": "implementation.qc.actions.source",
    "actions-export": "implementation.qc.actions.export",
}


class ImplementationQC(ImplementationOperator):
    def queue(self, workspace, operation, value):
        if operation not in ACTIONS or not isinstance(value, dict):
            raise self.Fault("IMPLEMENTATION_QC_INPUT", "Choose a supported sample QC operation.")
        payload = value.get("payload")
        if payload is None:
            payload = {key: item for key, item in value.items() if key not in ("workspace", "operation_id")}
        if not isinstance(payload, dict):
            raise self.Fault("IMPLEMENTATION_QC_INPUT", "Supply an original QC selection.")
        return self.operator.submit(workspace, ACTIONS[operation], payload, value.get("operation_id"))

    def _parameters(self, value):
        if not isinstance(value, dict):
            raise ImplementationError("Supply original sample-QC parameters.")
        return value

    def read(self, workspace, operation, payload=None):
        value = self._parameters(payload or {})
        ws = self.operator.ws(workspace)
        try:
            if operation == "comparison-preview":
                return {"workspace_key": workspace, "comparison": qcc.preview(ws, value.get("selection", value))}
            if operation == "actions-validate":
                return {"workspace_key": workspace, "preview": qca.validate_selection(ws, value.get("selection", value))}
            if operation == "actions-preview":
                return {"workspace_key": workspace, "preview": qca.preview(ws, value.get("selection", value))}
            if operation == "preview":
                return {"workspace_key": workspace, "review": qc.preview(ws, value.get("selection", value))}
            plan_id = self._id(value.get("plan_id"))
            if operation == "comparisons":
                return {"workspace_key": workspace, "plan_id": plan_id, "comparisons": qcc.catalog(ws, plan_id)}
            if operation == "comparison-inspect":
                return self._decorate(workspace, qcc.inspect(ws, plan_id, value.get("comparison_report_id")))
            if operation == "actions":
                return {"workspace_key": workspace, **qca.context(ws, plan_id, value.get("report_id"))}
            if operation == "actions-inspect":
                return self._decorate(workspace, qca.inspect(ws, plan_id, value.get("action_report_id")))
            if operation == "records":
                revision = self._integer(value.get("revision"), "revision")
                plan = self.store(workspace).get(plan_id, revision)
                return {"workspace_key": workspace, "plan_id": plan_id, "revision": revision,
                        "plan_title": plan["title"], "records": qc.records(plan),
                        "reviews": qc.catalog(ws, plan_id), "relationships": qc.RELATIONSHIPS,
                        "metrics": qc.METRICS, "method_sources": qc.METHOD_SOURCES}
            if operation == "list":
                return {"workspace_key": workspace, "plan_id": plan_id, "reviews": qc.catalog(ws, plan_id)}
            if operation == "inspect":
                return self._decorate(workspace, qc.inspect(ws, plan_id, value.get("report_id")))
            raise self.Fault("IMPLEMENTATION_QC_READ", "Choose an original sample-QC read.", 404)
        except (ImplementationError, ValueError, TypeError) as error:
            raise self.Fault("IMPLEMENTATION_QC_INPUT", str(error)) from error

    def _decorate(self, workspace, result):
        result = dict(result)
        root = self.operator.ws(workspace).root
        result["workspace_key"] = workspace
        result["_downloads"] = [self._ticket(workspace, root / item["path"],
            Path(item["path"]).name, item) for item in result.get("files", [])]
        return result

    def invoke(self, task):
        action = task.get("action")
        if action not in ACTIONS.values():
            raise self.Fault("IMPLEMENTATION_QC_ACTION", "Choose an original sample-QC action.")
        workspace, value = task["workspace"], self._parameters(task["payload"])
        ws = self.operator.ws(workspace)
        try:
            if action == ACTIONS["comparison-save"]:
                result = qcc.save(ws, value.get("selection", value))
            elif action in (ACTIONS["comparison-source"], ACTIONS["comparison-export"]):
                plan_id = self._id(value.get("plan_id"))
                report_id = value.get("comparison_report_id")
                if action == ACTIONS["comparison-source"]:
                    result = qcc.scientific_source(ws, plan_id, report_id)
                else:
                    result = qcc.inspect(ws, plan_id, report_id)
                    task_id = task["id"]
                    if not isinstance(task_id, str) or not re.fullmatch(r"[a-f0-9]{64}", task_id):
                        raise ImplementationError("Use the original native task ID.")
                    destination = self.operator.root / "outputs" / "implementation-qc-comparison" / workspace / (task_id + ".zip")
                    result["archive"] = qcc.export(ws, plan_id, report_id, destination)
            elif action == ACTIONS["actions-save"]:
                result = qca.save(ws, value.get("selection", value))
            elif action in (ACTIONS["actions-source"], ACTIONS["actions-export"]):
                plan_id = self._id(value.get("plan_id"))
                action_report_id = value.get("action_report_id")
                if action == ACTIONS["actions-source"]:
                    result = qca.scientific_source(ws, plan_id, action_report_id)
                else:
                    result = qca.inspect(ws, plan_id, action_report_id)
                    task_id = task["id"]
                    if not isinstance(task_id, str) or not re.fullmatch(r"[a-f0-9]{64}", task_id):
                        raise ImplementationError("Use the original native task ID.")
                    destination = self.operator.root / "outputs" / "implementation-qc-actions" / workspace / (task_id + ".zip")
                    result["archive"] = qca.export(ws, plan_id, action_report_id, destination)
            elif action == ACTIONS["save"]:
                result = qc.save(ws, value.get("selection", value))
            else:
                plan_id = self._id(value.get("plan_id"))
                report_id = value.get("report_id")
                if action == ACTIONS["source"]:
                    result = qc.scientific_source(ws, plan_id, report_id)
                else:
                    result = qc.inspect(ws, plan_id, report_id)
                    task_id = task["id"]
                    if not isinstance(task_id, str) or not re.fullmatch(r"[a-f0-9]{64}", task_id):
                        raise ImplementationError("Use the original native task ID.")
                    destination = self.operator.root / "outputs" / "implementation-qc" / workspace / (task_id + ".zip")
                    result["archive"] = qc.export(ws, plan_id, report_id, destination)
            return self._decorate(workspace, result)
        except (ImplementationError, ValueError, TypeError) as error:
            raise self.Fault("IMPLEMENTATION_QC_INPUT", str(error)) from error

    def _archive_download(self, task, archive):
        """Read only the current operator output, with exact original transfer lineage."""
        family = ("implementation-qc-comparison" if task["action"].startswith("implementation.qc.comparison.") else
                  "implementation-qc-actions" if task["action"].startswith("implementation.qc.actions.") else "implementation-qc")
        pattern = re.compile(r"[a-f0-9]{64}")
        def identity(workspace, task_id, request):
            if not all(isinstance(v, str) and pattern.fullmatch(v) for v in (workspace, task_id, request)):
                raise ImplementationError("The QC export task identity is invalid.")
            if task_id != digest({"workspace": workspace, "operation_id": task.get("operation_id")}):
                raise ImplementationError("The QC export task differs from its original operation.")
            if request != digest({"workspace": workspace, "action": task["action"], "payload": task["payload"]}):
                raise ImplementationError("The QC export request differs from its original payload.")
            return workspace, task_id
        current = identity(task["workspace"], task["id"], task.get("request_sha256"))
        originals, seen = [], set()
        origin = task.get("transfer_origin")
        while origin is not None:
            if not isinstance(origin, dict) or not isinstance(origin.get("transfer_id"), str) or not pattern.fullmatch(origin["transfer_id"]):
                raise ImplementationError("The original QC transfer lineage is invalid.")
            key = identity(origin.get("workspace_key"), origin.get("task_id"), origin.get("request_sha256"))
            marker = (origin["transfer_id"], *key)
            if marker in seen:
                raise ImplementationError("The original QC transfer lineage repeats.")
            seen.add(marker)
            originals.append(key)
            origin = origin.get("previous")
        path = Path(archive.get("path", ""))
        if not path.is_absolute() or ".." in path.parts:
            raise ImplementationError("The retained QC archive path is invalid.")
        matched = next((pair for pair in [current] + originals
            if tuple(path.parts[-4:]) == ("outputs", family, pair[0], pair[1] + ".zip")), None)
        if matched is None:
            raise ImplementationError("The archive path differs from its original QC task.")
        own = self.operator.root / "outputs" / family
        # A transferred sender path is metadata, not permission to read a receiver's unrelated path.
        if not path.is_relative_to(own):
            if matched not in originals:
                raise ImplementationError("The original QC archive left its operator output root.")
            return None
        if path.is_symlink() or path.resolve() != path:
            raise ImplementationError("The original QC archive path traverses a symlink.")
        try:
            path.stat()
        except FileNotFoundError:
            if matched not in originals:
                raise
            return None
        return self._ticket(task["workspace"], path, "Complete sample-QC report and sources.zip", archive)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS.values() or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        followup = task["action"].startswith("implementation.qc.actions.")
        comparison = task["action"].startswith("implementation.qc.comparison.")
        current = (qcc.inspect(self.operator.ws(task["workspace"]), result["plan_id"], result["comparison_report_id"])
                   if comparison else qca.inspect(self.operator.ws(task["workspace"]), result["plan_id"], result["action_report_id"])
                   if followup else qc.inspect(self.operator.ws(task["workspace"]), result["plan_id"], result["report_id"]))
        decorated = self._decorate(task["workspace"], current)
        task["_downloads"] = decorated["_downloads"]
        if result.get("archive"):
            archive = result["archive"]
            download = self._archive_download(task, archive)
            if download is not None:
                task["_downloads"].append(download)
            else:
                task["_qc_export"] = {
                    "state": "reexport_required",
                    "message": "The complete QC report is retained in this received project. Create a new local ZIP from the saved report.",
                    "action": ACTIONS["comparison-export" if comparison else "actions-export" if followup else "export"],
                    "payload": {"plan_id": result["plan_id"],
                                ("comparison_report_id" if comparison else "action_report_id" if followup else "report_id"):
                                result["comparison_report_id" if comparison else "action_report_id" if followup else "report_id"]},
                }
        task["_item"] = {"kind": "implementation_plans", "id": result["plan_id"]}
        return task
