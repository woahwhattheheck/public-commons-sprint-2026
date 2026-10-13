"""Carry the operator's selected work and original inputs with a scientific project.

The original Workspace, native archive and action queue remain authoritative.
A transfer saves completed history and the original inputs needed by unfinished
tasks. Receiving reconstructs those inputs and reconciles retained native results
before an operator explicitly resumes the remaining work.
"""
from __future__ import annotations

import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from urllib.parse import quote

from model.common import (atomic_bytes, atomic_json, canonical, describe_file,
                          digest, file_digest, now, read_json, relative_file,
                          retain_file, verify_file)
from model.common import INVEST_VERSION
from model.record_catalog import ProjectedFileCache

ACTIONS = {"workspace.snapshot", "workspace.receive", "workspace.recovery.resume"}
READS = {"plan", "list", "inspect", "transport"}
INCREMENTAL_ACTIONS = frozenset({
    "project.transfer.capture", "project.transfer.accept", "project.transfer.receive",
    "project.transfer.parts", "project.transfer.archive", "project.transfer.restore",
    "project.transfer.report", "project.transfer.inspect", "project.transfer.diff",
})
FORMAT = "upstate.operator-project-transfer/v1"
RECOVERY_FORMAT = "upstate.operator-project-recovery/v1"
HISTORY_ONLY = ACTIONS | {"workspace.backup", "workspace.restore", "project.transfer.capture-study"} | INCREMENTAL_ACTIONS
UNFINISHED = {"queued", "running", "interrupted", "failed", "cancelled"}
RESUMABLE = {"interrupted", "failed"}
ID = re.compile(r"[0-9a-f]{64}")


def _safe(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A transfer member must be an ordinary relative path")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or any(p in (".", "..") for p in path.parts) or str(path) != value:
        raise ValueError("A transfer member must use a canonical relative path")
    return path


def _clone(value):
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("Select a complete saved transfer identity")
    return value


def _exact_copy(source, target, expected):
    source, target = Path(source), Path(target)
    if source.stat().st_size != expected["bytes"] or file_digest(source) != expected["sha256"]:
        raise ValueError("The retained transfer input changed")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        raise ValueError("A transfer destination cannot be a file alias")
    if target.exists():
        if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
            raise ValueError("Another original input already owns the transfer destination")
        return
    try:
        os.link(source, target)
    except FileExistsError:
        _exact_copy(source, target, expected)
    except OSError:
        pending = None
        try:
            with source.open("rb") as inp, tempfile.NamedTemporaryFile(
                    dir=target.parent, prefix=".transfer-", delete=False) as out:
                pending = Path(out.name)
                shutil.copyfileobj(inp, out, 1024 * 1024)
                out.flush()
                os.fsync(out.fileno())
            if pending.stat().st_size != expected["bytes"] or file_digest(pending) != expected["sha256"]:
                raise ValueError("A transfer input changed during copying")
            try:
                os.link(pending, target)
            except FileExistsError:
                if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
                    raise ValueError("Another original input owns the receiving destination")
        finally:
            if pending:
                pending.unlink(missing_ok=True)


class ProjectContinuity:
    def __init__(self, operator, fault, *, supported_actions):
        self.operator = operator
        self.fault = fault
        self.supported_actions = supported_actions
        self.catalogue = ProjectedFileCache()

    def _directory(self, workspace):
        return workspace.root / "project-transfers"

    def _record_path(self, workspace, transfer_id):
        return self._directory(workspace) / (_id(transfer_id) + ".json")

    def _retained_path(self, workspace, body):
        path = relative_file(workspace.root, body["object"])
        if path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
            raise ValueError("An original project-transfer input changed")
        return path

    def _verify(self, workspace, value, *, inputs=True):
        if value.get("schema") != FORMAT or value.get("project", {}).get("id") != workspace.project["id"]:
            raise ValueError("The selected transfer belongs to another scientific project")
        _id(value.get("id"))
        content = {k: v for k, v in value.items() if k != "content_sha256"}
        if digest(content) != value.get("content_sha256"):
            raise ValueError("The saved project-transfer record changed")
        if len({t["id"] for t in value["tasks"]}) != len(value["tasks"]):
            raise ValueError("The saved transfer contains duplicate original tasks")
        for task in value["tasks"]:
            request = {k: task[k] for k in ("workspace", "action", "payload")}
            if digest(request) != task["request_sha256"]:
                raise ValueError("A saved original operation selection changed")
            if task["workspace"] != value["original_workspace_key"]:
                raise ValueError("A saved task belongs to another workspace instance")
        if inputs:
            for upload in value["uploads"].values():
                self._retained_path(workspace, upload["retained"])
            for preview in value["previews"].values():
                for body in preview.get("members", {}).values():
                    self._retained_path(workspace, body)
            for item in value.get("files", {}).values():
                verify_file(workspace.root, item)
        return value

    def inspect(self, workspace_key, transfer_id, *, inputs=True):
        ws = self.operator.ws(workspace_key)
        return self._verify(ws, read_json(self._record_path(ws, transfer_id)), inputs=inputs)

    def list(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        values = []
        paths = [path for path in sorted(self._directory(ws).glob("*.json")) if path.stem != "HEAD"]
        self.catalogue.retain_paths(paths)

        def project(value):
            value = self._verify(ws, value, inputs=False)
            return {k: value[k] for k in ("id", "title", "created_at", "summary", "project")}

        for path in paths:
            value = self.catalogue.read(path, project)
            if value["project"]["id"] != ws.project["id"]:
                raise ValueError("The selected transfer belongs to another scientific project")
            values.append(value)
        return sorted(values, key=lambda row: (row["created_at"], row["id"]), reverse=True)

    def plan(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        with self.operator.lock:
            tasks = self.operator.task_list(workspace_key, compact=True)
        records = []
        for task in tasks:
            if task["action"] in HISTORY_ONLY:
                continue
            records.append({"id": task["id"], "operation_id": task["operation_id"],
                            "action": task["action"], "state": task["state"],
                            "created_at": task["created_at"],
                            "required_original_inputs": task["state"] != "complete",
                            "handler_available": task["action"] in self.supported_actions,
                            "origin": task.get("transfer_origin")})
        overview = ws.operator_overview()
        saved_view = getattr(self.operator, "operator_session", lambda key: None)(workspace_key)
        return {"project": ws.project, "workspace_key": workspace_key,
                "operator_session": _clone(saved_view),
                "tasks": records,
                "summary": {"tasks": len(records),
                            "complete": sum(t["state"] == "complete" for t in records),
                            "unfinished": sum(t["state"] in UNFINISHED for t in records)},
                "incomplete_runs": [{"id": r["id"], "state": r["state"], "selection": r["selection"]}
                                    for r in overview.get("runs", []) if r["state"] != "complete"],
                "transfers": self.list(workspace_key)}

    def _capture_upload(self, ws, key, uploads):
        _id(key)
        if key in uploads:
            return
        value = self.operator.upload(key)
        retained = retain_file(ws.root, value["path"], value["sha256"])
        record = {k: v for k, v in value.items() if k != "path"}
        if digest({"sha256": record["sha256"], "filename": record["filename"],
                   "media_type": record["mime_type"]}) != key:
            raise ValueError("The original upload identity differs from its saved filename and media type")
        uploads[key] = {"record": record, "retained": retained}

    def _capture_preview(self, ws, key, previews, uploads):
        _id(key)
        if key in previews:
            return
        preview = read_json(self.operator.root / "previews" / (key + ".json"))
        if digest({k: v for k, v in preview.items() if k != "id"}) != key:
            raise ValueError("An original source preview changed")
        value = {"record": preview, "members": {}}
        if preview["kind"] == "registered":
            manifest = Path(preview["path"]).resolve(strict=True)
            if file_digest(manifest) != preview["manifest_sha256"]:
                raise ValueError("The original registered source manifest changed")
            body = read_json(manifest)
            self.operator._manifest_summary(body)
            value["manifest_name"] = manifest.name
            value["members"][manifest.name] = retain_file(ws.root, manifest, preview["manifest_sha256"])
            for entry in body["entries"]:
                members = [(entry["path"], entry.get("sha256"))]
                members += [(c["path"], c.get("sha256")) for c in entry.get("companions", [])]
                for name, sha in members:
                    name = str(_safe(name))
                    retained = retain_file(ws.root, relative_file(manifest.parent, name), sha)
                    if name in value["members"] and value["members"][name]["sha256"] != retained["sha256"]:
                        raise ValueError("A source member collides with its original manifest")
                    value["members"][name] = retained
        elif preview["kind"] in {"archive", "file"}:
            self._capture_upload(ws, preview["upload_id"], uploads)
        else:
            raise ValueError("The original source-preview kind has no portable materializer")
        previews[key] = value

    def _capture_inputs(self, ws, task, previews, uploads):
        def visit(value, name=""):
            if isinstance(value, dict):
                for k, v in value.items():
                    visit(v, k)
            elif isinstance(value, list):
                for child in value:
                    visit(child, name)
            elif isinstance(value, str):
                if name == "upload_id" or name.endswith("_upload_id"):
                    self._capture_upload(ws, value, uploads)
                elif name == "preview_id":
                    self._capture_preview(ws, value, previews, uploads)
        visit(task["payload"])

    def _html(self, transfer):
        esc = lambda value: html.escape(str(value))
        rows = []
        for task in transfer["tasks"]:
            rows.append("<tr><td>" + esc(task["action"]) + "</td><td>" + esc(task["state"]) +
                        "</td><td><code>" + esc(task["operation_id"]) + "</code></td><td>" +
                        esc(len(task.get("attempts", []))) + "</td></tr>")
        summary = transfer["summary"]
        receive_step = ("Receive the original manifest and requested transfer parts, then choose Receive independent project."
                        if transfer.get("selection", {}).get("transport") == "incremental"
                        else "Choose Receive a project and upload the complete scientific-workspace ZIP.")
        return (
            "<!doctype html><html lang='en'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + esc(transfer["title"]) + "</title>"
            "<style>body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0}"
            "main{max-width:1120px;margin:auto;padding:36px}h1{font-size:28px}"
            "table{width:100%;border-collapse:collapse;margin-top:24px}td,th{text-align:left;"
            "vertical-align:top;padding:10px;border-bottom:1px solid #ccc}code{font-size:12px;"
            "overflow-wrap:anywhere}.meta{color:#444}.steps{border:1px solid #bbb;padding:18px}"
            "@media print{main{padding:0}tr{break-inside:avoid}}</style><main>"
            "<p class='meta'>TOKENJUNKIELABS · PROJECT TRANSFER</p><h1>" +
            esc(transfer["title"]) + "</h1><p>" + esc(transfer["project"]["title"]) +
            "</p><p class='meta'>Created " + esc(transfer["created_at"]) + " · Project <code>" +
            esc(transfer["project"]["id"]) + "</code></p><p>" +
            str(summary["complete"]) + " completed operations and " + str(summary["unfinished"]) +
            " unfinished operations accompany the scientific project. The package retains " +
            str(summary["uploads"]) + " original uploads and " + str(summary["previews"]) +
            " source previews needed by unfinished work.</p>"
            "<section class='steps'><h2>Continue this project</h2><ol>"
            "<li>Open the delivered application and choose Project continuity.</li>"
            "<li>" + receive_step + "</li>"
            "<li>Open the received workspace. Review the original operation history and completed results.</li>"
            "<li>Choose Resume unfinished work. The original action queue continues the retained selections.</li>"
            "</ol><p>Completed native outputs are reused. Cancelled operations remain cancelled unless "
            "specifically selected for resumption. The transfer records each original and receiving "
            "workspace identity.</p></section><h2>Saved work</h2><table><thead><tr>"
            "<th>Operation</th><th>Recorded state</th><th>Original request</th><th>Attempts</th>"
            "</tr></thead><tbody>" + "".join(rows) +
            "</tbody></table><p class='meta'>Transfer <code>" + esc(transfer["id"]) +
            "</code></p></main></html>")

    def _incremental(self):
        service = getattr(self.operator, "project_transfers", None)
        return service if service is not None and INCREMENTAL_ACTIONS.issubset(self.supported_actions) else None

    def transport(self, workspace_key, snapshot_id=None):
        self.operator.ws(workspace_key)
        service = self._incremental()
        if service is None:
            return {"available": False, "snapshots": []}
        store = service.store(workspace_key)
        if snapshot_id is not None:
            report = store.report(_id(snapshot_id))
            return {"available": True, **{k: v for k, v in report.items() if k != "files"}}
        return {"available": True, "snapshots": store.list_snapshots()}

    def snapshot(self, task):
        op = self.operator
        ws = op.ws(task["workspace"])
        transport = task["payload"].get("transport", "archive")
        if transport not in {"archive", "incremental"}:
            raise ValueError("Choose an ordinary archive or incremental project handover")
        if transport == "incremental" and self._incremental() is None:
            raise self.fault("PROJECT_TRANSPORT", "Install the original incremental handover component before selecting this transport.")
        path = self._record_path(ws, task["id"])
        if path.exists():
            transfer = self._verify(ws, read_json(path))
        else:
            with op.lock:
                tasks = _clone(op.task_list(task["workspace"]))
            chosen = task["payload"].get("task_ids")
            if chosen is not None:
                if not isinstance(chosen, list) or len(set(chosen)) != len(chosen):
                    raise ValueError("Choose each original task once")
                found = {t["id"] for t in tasks}
                if set(chosen) - found:
                    raise ValueError("A selected task is outside this workspace")
                tasks = [t for t in tasks if t["id"] in set(chosen)]
            tasks = [t for t in tasks if t["action"] not in HISTORY_ONLY]
            tasks.sort(key=lambda value: (value["created_at"], value["id"]))
            uploads, previews = {}, {}
            for selected in tasks:
                if selected["state"] != "complete":
                    self._capture_inputs(ws, selected, previews, uploads)
            if task["payload"].get("journey") is not None:
                saved_view = {"journey": _clone(task["payload"]["journey"]),
                              "revision": task["payload"].get("journey_revision")}
            else:
                saved_view = _clone(getattr(op, "operator_session", lambda key: None)(task["workspace"]))
            transfer = {"schema": FORMAT, "id": task["id"], "project": _clone(ws.project),
                        "title": task["payload"].get("title") or ws.project["title"] + " — complete project",
                        "created_at": now(), "original_workspace_key": task["workspace"],
                        "original_operation_id": task["operation_id"], "tasks": tasks,
                        "uploads": uploads, "previews": previews,
                        "operator_session": saved_view,
                        "selection": {"include_intermediates": bool(task["payload"].get("include_intermediates", True)),
                                      "transport": transport,
                                      "task_ids": [t["id"] for t in tasks]},
                        "summary": {"tasks": len(tasks),
                                    "complete": sum(t["state"] == "complete" for t in tasks),
                                    "unfinished": sum(t["state"] != "complete" for t in tasks),
                                    "uploads": len(uploads), "previews": len(previews)}}
            report = self._directory(ws) / task["id"] / "project-transfer.html"
            atomic_bytes(report, self._html(transfer).encode("utf-8"), immutable=True)
            transfer["files"] = {"operator_guide": describe_file(ws.root, report, media_type="text/html")}
            transfer["content_sha256"] = digest(transfer)
            atomic_json(path, transfer, immutable=True)
        atomic_json(self._directory(ws) / "HEAD.json", {"id": transfer["id"]})
        native_action = "project.transfer.capture" if transport == "incremental" else "workspace.backup"
        native_task = {**task, "action": native_action,
                       "payload": {"include_intermediates": transfer["selection"]["include_intermediates"]}}
        saved_view = transfer.get("operator_session")
        if saved_view is not None:
            native_task["payload"].update(journey=_clone(saved_view["journey"]),
                                          journey_revision=saved_view.get("revision"))
        result = op._invoke(native_task)
        if isinstance(result.get("files"), int):
            result = {**result, "member_count": result["files"]}
        return {**result, "transport": transport, "transfer_id": transfer["id"],
                "project_transfer": transfer["summary"], "files": transfer["files"]}

    def _restore_uploads(self, ws, transfer):
        for key, saved in transfer["uploads"].items():
            body = saved["record"]
            try:
                # The native reader verifies the receiving object's full bytes.
                existing = self.operator.upload(key)
            except FileNotFoundError:
                existing = None
            if existing is not None:
                received = {k: v for k, v in existing.items() if k != "path"}
                if received != body:
                    raise ValueError("A receiving upload differs from the original transfer identity")
                continue
            path = self._retained_path(ws, saved["retained"])
            with path.open("rb") as stream:
                actual = self.operator.receive_upload(stream, body["bytes"], quote(body["filename"], safe=""), body["mime_type"])
            if actual != body or actual["id"] != key:
                raise ValueError("A received original upload changed its immutable identity")

    def _restore_previews(self, ws, transfer):
        aliases = {}
        for old_key, saved in transfer["previews"].items():
            preview = _clone(saved["record"])
            if preview["kind"] == "registered":
                root = self.operator.root / "transfer-inputs" / transfer["id"] / old_key
                for name, body in saved["members"].items():
                    target = root.joinpath(*_safe(name).parts)
                    _exact_copy(self._retained_path(ws, body), target, body)
                manifest = root / saved["manifest_name"]
                preview["path"] = str(manifest.resolve())
                preview["registered_id"] = digest({"path": preview["path"], "sha256": preview["manifest_sha256"]})
                self.operator.registered[preview["registered_id"]] = {
                    "id": preview["registered_id"], "path": preview["path"],
                    "sha256": preview["manifest_sha256"], "title": preview["title"],
                    "entries": len(preview["entries"])}
            content = {k: v for k, v in preview.items() if k != "id"}
            new_key = digest(content)
            preview = {"id": new_key, **content}
            atomic_json(self.operator.root / "previews" / (new_key + ".json"), preview, immutable=True)
            aliases[old_key] = new_key
        return aliases

    def _remap(self, payload, previews):
        def visit(value, name=""):
            if isinstance(value, dict):
                return {k: visit(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [visit(v, name) for v in value]
            if name == "preview_id" and isinstance(value, str):
                return previews.get(value, value)
            return value
        return visit(_clone(payload))

    def _completed_result(self, ws, task, transfer):
        """Read exact retained outputs for a response lost before task journaling."""
        action, payload = task["action"], task["payload"]
        if action == "run.start":
            result = ws.inspect_run(payload["run_id"])
            if result["state"] == "complete":
                for artifact in result.get("artifacts", {}).values():
                    verify_file(ws.root / "runs" / result["id"], artifact)
                return result
        elif action == "run.prepare":
            selection = {"schema": "upstate.run-selection/v1", "grid_id": payload["grid_id"],
                         "profile_id": payload["profile_id"], "scenario_id": payload["scenario_id"],
                         "invest_version": INVEST_VERSION}
            try:
                from model.model_selection import normalize_selection, grid_models
            except ModuleNotFoundError as error:
                if error.name != "model.model_selection":
                    raise
            else:
                # Use the same native default and canonical model identity as prepare_run.
                _, active = normalize_selection(payload, default=grid_models(ws.get_grid(payload["grid_id"])))
                selection, _ = normalize_selection(selection, default=active)
            key = digest(selection)
            path = ws.root / "runs" / key / "run.json"
            if path.exists():
                return ws.inspect_run(key)
        elif action == "run.compare":
            from model.native_versions import run_comparison_identity, validate_run_comparison
            runs = [ws.inspect_run(key) for key in payload["run_ids"]]
            if any(run.get("state") != "complete" for run in runs):
                return None
            identity = run_comparison_identity(runs)
            keys = [digest(identity), digest({name: identity[name] for name in ("runs", "direction")})]
            for key in keys:
                path = ws.root / "comparisons" / key / "comparison.json"
                if path.exists():
                    result = read_json(path)
                    validate_run_comparison(ws, result, expected_id=key)
                    if (result["baseline_run_id"] != payload["run_ids"][0]
                            or [x["run_id"] for x in result["alternatives"]] != payload["run_ids"][1:]):
                        raise ValueError("The received comparison differs from its queued run selection")
                    for alternative in result["alternatives"]:
                        for artifact in alternative["artifacts"].values():
                            verify_file(path.parent, artifact)
                    return result
        elif action == "source.import":
            preview = transfer["previews"].get(payload.get("preview_id"), {}).get("record", {})
            expected = preview.get("manifest_sha256")
            if preview.get("kind") == "file":
                # atomic_json retains the original canonical document plus its newline.
                import hashlib
                expected = hashlib.sha256(canonical(preview["manifest"]) + b"\n").hexdigest()
            if expected:
                candidates = [s for s in ws.sources() if s["original_manifest"]["sha256"] == expected]
                if len(candidates) == 1:
                    return candidates[0]
        return None

    def recover(self, workspace_key, transfer_id=None):
        op = self.operator
        ws = op.ws(workspace_key)
        if transfer_id is None:
            head = self._directory(ws) / "HEAD.json"
            if not head.exists():
                return {"schema": RECOVERY_FORMAT, "project_id": ws.project["id"],
                        "workspace_key": workspace_key, "transfer_id": None,
                        "tasks": [], "summary": {"complete": 0, "unfinished": 0, "reconciled": 0}}
            transfer_id = read_json(head)["id"]
        transfer = self.inspect(workspace_key, transfer_id)
        self._restore_uploads(ws, transfer)
        aliases = self._restore_previews(ws, transfer)
        receiving = []
        for original in transfer["tasks"]:
            payload = self._remap(original["payload"], aliases) if original["state"] != "complete" else _clone(original["payload"])
            request = {"workspace": workspace_key, "action": original["action"], "payload": payload}
            key = digest({"workspace": workspace_key, "operation_id": original["operation_id"]})
            retained = _clone(original)
            retained.update(request)
            retained.update(id=key, request_sha256=digest(request))
            retained["transfer_origin"] = {
                "transfer_id": transfer["id"], "task_id": original["id"],
                "workspace_key": original["workspace"], "request_sha256": original["request_sha256"],
                "received_at": now(), "previous": original.get("transfer_origin")}
            reconciled = None
            if original["state"] != "complete" and original["state"] != "cancelled":
                try:
                    reconciled = self._completed_result(ws, original, transfer)
                except FileNotFoundError:
                    reconciled = None
            if reconciled is not None:
                retained.update(state="complete", result=reconciled,
                                ended_at=now(), reconciled_from_retained_native_output=True)
                retained.pop("error", None)
            elif original["state"] not in {"complete", "cancelled"}:
                retained["state"] = "interrupted"
                retained["error"] = {"code": "PROJECT_RECEIVED",
                                     "message": "The original selection and required inputs are restored. Resume this operation to continue."}
            retained["handler_available"] = original["action"] in self.supported_actions
            receiving.append(retained)
        with op.lock:
            for task in receiving:
                path = op.root / "tasks" / (task["id"] + ".json")
                if path.exists():
                    previous = read_json(path)
                    if previous["request_sha256"] != task["request_sha256"]:
                        raise self.fault("TRANSFER_OPERATION_CONFLICT",
                                         "The receiving operator already has another selection for an original request.", 409)
            for task in receiving:
                path = op.root / "tasks" / (task["id"] + ".json")
                if not path.exists():
                    atomic_json(path, task, immutable=True)
            actual = [op.task(t["id"]) for t in receiving]
        summary = {"complete": sum(t["state"] == "complete" for t in actual),
                   "unfinished": sum(t["state"] != "complete" for t in actual),
                   "reconciled": sum(bool(t.get("reconciled_from_retained_native_output")) for t in actual),
                   "cancelled": sum(t["state"] == "cancelled" for t in actual)}
        record = {"schema": RECOVERY_FORMAT, "project_id": ws.project["id"],
                  "workspace_key": workspace_key, "transfer_id": transfer["id"],
                  "tasks": [{"id": t["id"], "operation_id": t["operation_id"],
                             "action": t["action"], "state": t["state"],
                             "handler_available": t["action"] in self.supported_actions}
                            for t in actual], "summary": summary}
        atomic_json(op.root / "project-recovery" / digest({"workspace": workspace_key, "transfer": transfer["id"]}), record)
        return record

    def receive(self, task):
        payload = task["payload"]
        snapshot_id, upload_id = payload.get("snapshot_id"), payload.get("upload_id")
        if bool(snapshot_id) == bool(upload_id):
            raise ValueError("Choose one original archive upload or one received incremental edition")
        if snapshot_id:
            if self._incremental() is None:
                raise self.fault("PROJECT_TRANSPORT", "Install the original incremental handover component before receiving this edition.")
            result = self.operator._invoke({**task, "action": "project.transfer.restore",
                                            "payload": {"snapshot_id": _id(snapshot_id)}})
            registry = getattr(self.operator, "extensions", None)
            if registry is not None:
                registry.verify_workspace(self.operator.ws(result["workspace_key"]))
        else:
            result = self.operator._invoke({**task, "action": "workspace.restore"})
        recovery = self.recover(result["workspace_key"], payload.get("transfer_id"))
        return {**result, "recovery": recovery}

    def resume(self, task):
        transfer_id = _id(task["payload"]["transfer_id"])
        recovery = self.recover(task["workspace"], transfer_id)
        selected = task["payload"].get("task_ids")
        if selected is not None:
            if not isinstance(selected, list) or len(set(selected)) != len(selected):
                raise ValueError("Select each received task once")
            if set(selected) - {t["id"] for t in recovery["tasks"]}:
                raise ValueError("A requested operation is outside this received transfer")
        queued, complete, unavailable, cancelled = [], [], [], []
        ordered = sorted((self.operator.task(row["id"]) for row in recovery["tasks"]),
                         key=lambda value: (value["created_at"], value["id"]))
        for row in ordered:
            if selected is not None and row["id"] not in selected:
                continue
            original = self.operator.task(row["id"])
            if original["state"] == "complete":
                complete.append(original["id"])
            elif original["action"] not in self.supported_actions:
                unavailable.append({"id": original["id"], "action": original["action"]})
            elif original["state"] == "cancelled" and selected is None:
                cancelled.append(original["id"])
            elif original["state"] in RESUMABLE or original["state"] == "cancelled":
                queued.append(self.operator.resume(original["id"])["id"])
            elif original["state"] in {"queued", "running"}:
                queued.append(original["id"])
        return {"transfer_id": transfer_id, "workspace_key": task["workspace"],
                "queued": queued, "already_complete": complete,
                "handler_unavailable": unavailable, "cancelled": cancelled}

    def invoke(self, task):
        return {"workspace.snapshot": self.snapshot, "workspace.receive": self.receive,
                "workspace.recovery.resume": self.resume}[task["action"]](task)

    def read(self, workspace, operation, query=None):
        if operation == "plan":
            return self.plan(workspace)
        if operation == "list":
            return {"transfers": self.list(workspace)}
        if operation == "transport":
            return self.transport(workspace, (query or {}).get("snapshot_id"))
        if operation != "inspect":
            raise ValueError("Choose a project-transfer view")
        value = self.inspect(workspace, (query or {})["transfer_id"])
        ws = self.operator.ws(workspace)
        result = _clone(value)
        result["_downloads"] = self.operator._files(workspace, value, ws.root)
        manifest = self._record_path(ws, value["id"])
        result["_downloads"].append(self.operator._ticket(
            workspace, manifest, describe_file(ws.root, manifest), "Complete project-transfer record"))
        return result

    def decorate_task(self, task):
        if task["action"] == "workspace.snapshot" and task["state"] == "complete":
            result = task["result"]
            if result.get("transport") == "incremental":
                service = self._incremental()
                if service is None:
                    raise self.fault("PROJECT_TRANSPORT", "Reopen this edition with its original incremental handover component.")
                decorated = service.decorate_task({**task, "action": "project.transfer.capture"})
                task["_downloads"] = decorated.get("_downloads", [])
            else:
                task["_downloads"] = [self.operator._ticket(
                    task["workspace"], result["path"], result, "Complete project and outstanding work")]
            task["_downloads"] += self.operator._files(
                task["workspace"], {"files": result["files"]}, self.operator.ws(task["workspace"]).root)
        return task


def create(operator, fault, *, supported_actions):
    """Build the project-continuity service for the shared extension registry."""
    return ProjectContinuity(operator, fault, supported_actions=supported_actions)
